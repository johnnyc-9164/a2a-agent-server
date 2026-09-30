import { NextRequest, NextResponse } from 'next/server';
import {
  JsonRpcRequest,
  RpcError,
  SendMessageEvent,
  SendMessageParams,
  executeTask,
  handleListTasks,
  handleTasksCancel,
  handleTasksGet,
  rpcError,
  rpcResult,
} from '@/lib/a2a';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One SSE frame: every `data:` line is a complete JSON-RPC 2.0 response
 *  whose `id` matches the request — no bare payloads, no named events. */
function dataFrame(id: string | number | null, result: unknown): string {
  return `data: ${JSON.stringify(rpcResult(id, result))}\n\n`;
}

function errorFrame(id: string | number | null, err: RpcError): string {
  return `data: ${JSON.stringify(rpcError(id, err.code, err.message, err.data))}\n\n`;
}

async function handleStream(id: string | number | null, params: SendMessageParams) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      try {
        const { working, completed } = await executeTask(params);
        const statusEvent: SendMessageEvent = {
          kind: 'status-update',
          taskId: working.id,
          contextId: working.contextId,
          status: working.status,
          final: false,
        };
        send(dataFrame(id, statusEvent));
        for (const artifact of completed.artifacts ?? []) {
          const artifactEvent: SendMessageEvent = {
            kind: 'artifact-update',
            taskId: completed.id,
            contextId: completed.contextId,
            artifact,
            append: false,
            lastChunk: true,
          };
          send(dataFrame(id, artifactEvent));
        }
        const finalEvent: SendMessageEvent = {
          kind: 'status-update',
          taskId: completed.id,
          contextId: completed.contextId,
          status: completed.status,
          final: true,
        };
        send(dataFrame(id, finalEvent));
      } catch (err) {
        if (err instanceof RpcError) {
          send(errorFrame(id, err));
        } else {
          send(errorFrame(id, new RpcError(-32603, 'Internal error')));
        }
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400 });
  }

  const r = body as Partial<JsonRpcRequest>;
  if (typeof r !== 'object' || r === null || r.jsonrpc !== '2.0' || typeof r.method !== 'string') {
    return NextResponse.json(rpcError(null, -32600, 'Invalid Request'), { status: 400 });
  }
  const id = r.id ?? null;

  try {
    switch (r.method) {
      // A2A v1.0 dialect (spec §5.3). The v0.3 names are accepted as aliases
      // but always answer in v1.0 shapes.
      case 'SendMessage':
      case 'message/send': {
        const { completed } = await executeTask((r.params ?? {}) as SendMessageParams);
        return NextResponse.json(rpcResult(id, { payload: { task: completed } }));
      }
      case 'SendStreamingMessage':
      case 'message/stream': {
        return handleStream(id, (r.params ?? {}) as SendMessageParams);
      }
      case 'GetTask':
      case 'tasks/get': {
        const task = await handleTasksGet(r.params);
        return NextResponse.json(rpcResult(id, task));
      }
      case 'CancelTask':
      case 'tasks/cancel': {
        const task = await handleTasksCancel(r.params);
        return NextResponse.json(rpcResult(id, task));
      }
      case 'ListTasks':
      case 'tasks/list': {
        const tasks = await handleListTasks(r.params);
        return NextResponse.json(rpcResult(id, tasks));
      }
      default:
        return NextResponse.json(rpcError(id, -32601, `Method not found: ${r.method}`));
    }
  } catch (err) {
    if (err instanceof RpcError) {
      return NextResponse.json(rpcError(id, err.code, err.message, err.data));
    }
    return NextResponse.json(rpcError(id, -32603, 'Internal error'));
  }
}
