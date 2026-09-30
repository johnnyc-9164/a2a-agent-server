import { NextRequest, NextResponse } from 'next/server';
import { buildAgentCard } from '@/lib/a2a';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const card = buildAgentCard(req.nextUrl.origin);
  return NextResponse.json(card);
}
