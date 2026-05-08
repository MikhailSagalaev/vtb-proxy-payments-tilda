import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendTildaNotification, getOrderStatus } from '@/lib/vtb';
import { checkRateLimit, getClientIp, isInsecureMode } from '@/lib/security';
import { errorToMeta, getRequestId, logRequest } from '@/lib/logger';

// Sentinel value stored in callbackData to indicate Tilda was already notified
const TILDA_NOTIFIED_KEY = '__tilda_notified__';

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const requestId = getRequestId(request.headers);

  try {
    logRequest('info', requestId, 'GET /api/payment/return', { clientIp, insecureMode: isInsecureMode() }, false);

    // Rate limiting for browser returns (can be spammed)
    const { allowed } = await checkRateLimit(clientIp, 'payment_return', 60);
    if (!allowed) {
      logRequest('warn', requestId, 'Rate limit exceeded on payment_return', { clientIp }, false);
      return new NextResponse('Rate limit exceeded', { status: 429 });
    }

    const url = new URL(request.url);
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { params[k] = v; });

    const orderId = params['mdOrder'] || params['orderId'] || '';
    const orderNumber = params['orderNumber'] || '';
    const returnStatus = (params['status'] || '').toLowerCase(); // optional, set by our pages

    logRequest('info', requestId, 'VTB return received', { clientIp, orderId, orderNumber, returnStatus }, false);

    if (!orderId) {
      return NextResponse.json({ ok: false, error: 'Missing mdOrder' }, { status: 400 });
    }

    const transaction = await db.paymentTransaction.findFirst({ where: { orderId } });
    if (!transaction) {
      logRequest('warn', requestId, 'Unknown order in return', { clientIp, orderId }, false);
      return NextResponse.json({ ok: true, unknownOrder: true });
    }

    let confirmedStatus: number | null = null;
    try {
      const vtbStatus = await getOrderStatus(orderId);
      confirmedStatus = typeof (vtbStatus as any)?.orderStatus === 'number'
        ? (vtbStatus as any).orderStatus
        : parseInt(String((vtbStatus as any)?.orderStatus ?? 'NaN'));
    } catch (e) {
      logRequest('error', requestId, 'Failed to confirm VTB status (return)', { clientIp, orderId, ...errorToMeta(e) }, false);
    }

    const effectiveStatus = Number.isFinite(confirmedStatus as number) ? (confirmedStatus as number) : transaction.status;
    const isPaid = effectiveStatus === 2;

    let existingMeta: Record<string, string> = {};
    try {
      if (transaction.callbackData) existingMeta = JSON.parse(transaction.callbackData);
    } catch {/* ignore */}

    const alreadyNotifiedSuccess = existingMeta[TILDA_NOTIFIED_KEY] === 'success';
    const shouldNotifyTilda = isPaid ? !alreadyNotifiedSuccess : true;

    const newMeta: Record<string, string> = {
      ...existingMeta,
      ...params,
      returnStatus,
      ...(confirmedStatus !== null ? { confirmedStatus: String(confirmedStatus) } : {}),
      source: 'browser_return',
    };

    await db.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: effectiveStatus,
        callbackData: JSON.stringify(newMeta),
      },
    });
    logRequest('info', requestId, 'Transaction updated from return', { clientIp, orderId, effectiveStatus, isPaid }, false);

    if (shouldNotifyTilda) {
      const result = await sendTildaNotification({
        tildaPaymentId: transaction.tildaPaymentId || transaction.orderNumber,
        success: isPaid,
        amount: transaction.amount,
        orderId,
      });

      if (result.ok) {
        logRequest('info', requestId, 'Tilda notification sent (return)', { clientIp, orderId, isPaid, attempts: result.attempts }, false);
        if (isPaid) {
          const finalMeta = { ...newMeta, [TILDA_NOTIFIED_KEY]: 'success' };
          await db.paymentTransaction.update({
            where: { id: transaction.id },
            data: { callbackData: JSON.stringify(finalMeta) },
          });
        }
      } else {
        logRequest('error', requestId, 'Tilda notification failed (return)', { clientIp, orderId, attempts: result.attempts, error: result.error }, false);
      }
    } else {
      logRequest('info', requestId, 'Skipping duplicate Tilda success notification (return)', { clientIp, orderId }, false);
    }

    return NextResponse.json({ ok: true, orderId, effectiveStatus, isPaid });
  } catch (error: unknown) {
    logRequest('error', requestId, 'GET /api/payment/return failed', { clientIp, ...errorToMeta(error) }, false);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}

