import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyAdminKey, checkRateLimit, getClientIp, RATE_LIMIT_MAX_ADMIN } from '@/lib/security';

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);

  try {
    // Rate limiting on admin endpoint
    const { allowed } = await checkRateLimit(clientIp, 'transactions_read', RATE_LIMIT_MAX_ADMIN);
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    // Admin key must be provided via Authorization header only
    // (query params end up in server logs, browser history, and Referer headers)
    const isAuthorized = await verifyAdminKey(request);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const transactions = await db.paymentTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return NextResponse.json(transactions);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
