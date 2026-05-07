import { NextRequest, NextResponse } from 'next/server';
import { getOrderStatus } from '@/lib/vtb';
import { verifyAdminKey, checkRateLimit, getClientIp, RATE_LIMIT_MAX_ADMIN, isInsecureMode } from '@/lib/security';
import { errorToMeta, getRequestId, logRequest } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const requestId = getRequestId(request.headers);

  try {
    logRequest('info', requestId, 'GET /api/payment/status', { clientIp, insecureMode: isInsecureMode() }, false);
    // Rate limiting on admin endpoint
    const { allowed } = await checkRateLimit(clientIp, 'payment_status', RATE_LIMIT_MAX_ADMIN);
    if (!allowed) {
      logRequest('warn', requestId, 'Rate limit exceeded on payment_status', { clientIp }, false);
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const orderId = request.nextUrl.searchParams.get('orderId');
    if (!orderId) {
      logRequest('warn', requestId, 'Missing orderId on payment/status', { clientIp }, false);
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }

    // Require admin key for status checks
    const isAuthorized = await verifyAdminKey(request);
    if (!isAuthorized) {
      logRequest('warn', requestId, 'Unauthorized GET /api/payment/status', { clientIp }, false);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const status = await getOrderStatus(orderId);
    logRequest('info', requestId, 'Returning VTB order status', { clientIp, orderId }, false);
    return NextResponse.json(status);
  } catch (error: unknown) {
    logRequest('error', requestId, 'GET /api/payment/status failed', { clientIp, ...errorToMeta(error) }, false);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
