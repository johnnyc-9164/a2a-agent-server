import { NextRequest, NextResponse } from 'next/server';
import {
  BridgeArtifactInput,
  BridgeError,
  checkBridgeAuth,
  completeBridgeTask,
} from '@/lib/a2a';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * VM poller commits a result: { taskId, text, artifacts?, state? }.
 * state defaults to TASK_STATE_COMPLETED; the poller may commit
 * TASK_STATE_FAILED (e.g. a refused non-registry instruction) — terminal
 * states only. Fails 409 when not claimed, 409 when already completed
 * (committed results are never overwritten), 410 when the lease expired.
 */
export async function POST(req: NextRequest) {
  try {
    checkBridgeAuth(req);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'bad-request' }, { status: 400 });
    }
    const p = body as { taskId?: unknown; text?: unknown; artifacts?: unknown; state?: unknown };
    if (typeof p.taskId !== 'string' || p.taskId.length === 0) {
      return NextResponse.json({ error: 'bad-request' }, { status: 400 });
    }
    if (typeof p.text !== 'string') {
      return NextResponse.json({ error: 'bad-request' }, { status: 400 });
    }
    const artifacts = Array.isArray(p.artifacts)
      ? (p.artifacts as BridgeArtifactInput[])
      : undefined;
    const state = typeof p.state === 'string' ? p.state : undefined;
    const task = await completeBridgeTask(p.taskId, p.text, artifacts, state);
    return NextResponse.json({ task });
  } catch (err) {
    if (err instanceof BridgeError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
