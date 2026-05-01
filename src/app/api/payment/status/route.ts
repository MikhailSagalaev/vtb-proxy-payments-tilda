import { NextRequest, NextResponse } from 'next/server';
import { getOrderStatus } from '@/lib/vtb';
import { verifyAdminKey, checkRateLimit, getClientIp, RATE_LIMIT_MAX_ADMIN } from '@/lib/security';

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);

  try {
    // Rate limiting on admin endpoint
    const { allowed } = await checkRateLimit(clientIp, 'payment_status', RATE_LIMIT_MAX_ADMIN);
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const orderId = request.nextUrl.searchParams.get('orderId');
    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }

    // Require admin key for status checks
    const isAuthorized = await verifyAdminKey(request);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const status = await getOrderStatus(orderId);
    return NextResponse.json(status);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
