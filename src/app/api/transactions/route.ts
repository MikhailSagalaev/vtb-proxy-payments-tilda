import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyAdminKey, checkRateLimit, getClientIp, RATE_LIMIT_MAX_ADMIN, isInsecureMode } from '@/lib/security';
import { errorToMeta, getRequestId, logRequest } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const requestId = getRequestId(request.headers);

  try {
    logRequest('info', requestId, 'GET /api/transactions', { clientIp, insecureMode: isInsecureMode() }, false);
    // Rate limiting on admin endpoint
    const { allowed } = await checkRateLimit(clientIp, 'transactions_read', RATE_LIMIT_MAX_ADMIN);
    if (!allowed) {
      logRequest('warn', requestId, 'Rate limit exceeded on transactions_read', { clientIp }, false);
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    // Admin key must be provided via Authorization header only
    // (query params end up in server logs, browser history, and Referer headers)
    const isAuthorized = await verifyAdminKey(request);
    if (!isAuthorized) {
      logRequest('warn', requestId, 'Unauthorized GET /api/transactions', { clientIp }, false);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const transactions = await db.paymentTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    logRequest('info', requestId, 'Returning transactions', { clientIp, count: transactions.length }, false);
    return NextResponse.json(transactions);
  } catch (error: unknown) {
    logRequest('error', requestId, 'GET /api/transactions failed', { clientIp, ...errorToMeta(error) }, false);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
