import { NextRequest, NextResponse } from 'next/server';
import { BridgeError, checkBridgeAuth, listBridgePending } from '@/lib/a2a';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** VM poller intake: unclaimed SUBMITTED bridge tasks, oldest first. */
export async function GET(req: NextRequest) {
  try {
    checkBridgeAuth(req);
    const tasks = await listBridgePending();
    return NextResponse.json({ tasks });
  } catch (err) {
    if (err instanceof BridgeError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
