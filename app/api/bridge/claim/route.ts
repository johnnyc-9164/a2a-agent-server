import { NextRequest, NextResponse } from 'next/server';
import { BridgeError, checkBridgeAuth, claimBridgeTask } from '@/lib/a2a';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** VM poller claims one task: { taskId } -> full claimed task (WORKING, 5-min lease). */
export async function POST(req: NextRequest) {
  try {
    checkBridgeAuth(req);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'bad-request' }, { status: 400 });
    }
    const taskId = (body as { taskId?: unknown }).taskId;
    if (typeof taskId !== 'string' || taskId.length === 0) {
      return NextResponse.json({ error: 'bad-request' }, { status: 400 });
    }
    const task = await claimBridgeTask(taskId);
    return NextResponse.json({ task });
  } catch (err) {
    if (err instanceof BridgeError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
