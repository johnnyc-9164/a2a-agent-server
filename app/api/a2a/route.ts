import { NextRequest, NextResponse } from 'next/server';
import {
  A2ATask,
  JsonRpcRequest,
  SendMessageParams,
  executeTask,
  handleTasksCancel,
  handleTasksGet,
  RpcError,
  rpcError,
  rpcResult,
} from '@/lib/a2a';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function handleStream(id: string | number | null, params: SendMessageParams) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(frame(event, data)));
      try {
        const { working, completed } = await executeTask(params);
        send('status-update', {
          taskId: working.id,
          contextId: working.contextId,
          status: working.status,
          final: false,
        });
        for (const artifact of completed.artifacts ?? []) {
          send('artifact-update', {
            taskId: completed.id,
            contextId: completed.contextId,
            artifact,
          });
        }
        send('status-update', {
          taskId: completed.id,
          contextId: completed.contextId,
          status: completed.status,
          final: true,
        });
        send('done', rpcResult(id, completed));
      } catch (err) {
        if (err instanceof RpcError) {
          send('error', rpcError(id, err.code, err.message, err.data));
        } else {
          send('error', rpcError(id, -32603, 'Internal error'));
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
      case 'message/send': {
        const { completed } = await executeTask((r.params ?? {}) as SendMessageParams);
        return NextResponse.json(rpcResult(id, completed satisfies A2ATask));
      }
      case 'message/stream': {
        return handleStream(id, (r.params ?? {}) as SendMessageParams);
      }
      case 'tasks/get': {
        const task = await handleTasksGet(r.params);
        return NextResponse.json(rpcResult(id, task));
      }
      case 'tasks/cancel': {
        const task = await handleTasksCancel(r.params);
        return NextResponse.json(rpcResult(id, task));
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
