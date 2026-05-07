import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendTildaNotification, getOrderStatus } from '@/lib/vtb';
import { verifyWebhookSignature, checkRateLimit, getClientIp } from '@/lib/security';

// Sentinel value stored in callbackData to indicate Tilda was already notified
const TILDA_NOTIFIED_KEY = '__tilda_notified__';

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);

  try {
    // Rate limiting (higher limit for callbacks - VTB may retry)
    const { allowed } = await checkRateLimit(clientIp, 'payment_callback', 100);
    if (!allowed) {
      return new NextResponse('Rate limit exceeded', { status: 429 });
    }

    // Read raw body for signature verification
    const rawBody = await request.text();
    const formData = new URLSearchParams(rawBody);
    const callbackData: Record<string, string> = {};
    formData.forEach((value, key) => {
      callbackData[key] = value;
    });

    const orderId = callbackData['mdOrder'] || callbackData['orderNumber'] || '';
    const reportedStatus = parseInt(callbackData['orderStatus'] || '0');

    console.log(`[${new Date().toISOString()}] VTB KZ Callback from ${clientIp}: order=${orderId} reportedStatus=${reportedStatus}`);

    // Verify webhook signature if webhookSecret is configured
    const config = await db.paymentConfig.findUnique({ where: { id: 'default' } });
    if (config?.webhookSecret) {
      const signatureHeader = request.headers.get('x-signature') || '';
      const isValid = verifyWebhookSignature(rawBody, config.webhookSecret, signatureHeader);
      if (!isValid) {
        console.warn(`[${new Date().toISOString()}] INVALID WEBHOOK SIGNATURE from ${clientIp}`);
        return new NextResponse('Invalid signature', { status: 403 });
      }
    }

    // Update transaction in DB
    const transaction = await db.paymentTransaction.findFirst({
      where: { orderId },
    });

    if (!transaction) {
      console.warn(`[${new Date().toISOString()}] Unknown order in callback: ${orderId}`);
      // Still return OK — don't make VTB retry forever for unknown orders
      return new NextResponse('OK', { status: 200 });
    }

    // Source of truth: confirm actual payment status in VTB.
    // Callback payload should not be trusted (it can be spoofed if unsigned).
    let confirmedStatus: number | null = null;
    try {
      const vtbStatus = await getOrderStatus(orderId);
      confirmedStatus = typeof (vtbStatus as any)?.orderStatus === 'number'
        ? (vtbStatus as any).orderStatus
        : parseInt(String((vtbStatus as any)?.orderStatus ?? 'NaN'));
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Failed to confirm VTB status for order ${orderId}:`, e);
      // Return OK so VTB doesn't retry forever; we'll keep the callback data for later reconciliation.
    }

    const effectiveStatus = Number.isFinite(confirmedStatus as number) ? (confirmedStatus as number) : transaction.status;
    const isPaid = effectiveStatus === 2;

    // Parse existing callback metadata (may contain TILDA_NOTIFIED_KEY)
    let existingMeta: Record<string, string> = {};
    try {
      if (transaction.callbackData) {
        existingMeta = JSON.parse(transaction.callbackData);
      }
    } catch {/* ignore parse errors */}

    // Idempotency: check if we already sent Tilda notification for a successful payment
    const alreadyNotifiedSuccess = existingMeta[TILDA_NOTIFIED_KEY] === 'success';
    const shouldNotifyTilda = isPaid ? !alreadyNotifiedSuccess : true;

    // Update transaction record
    const newMeta = {
      ...existingMeta,
      ...callbackData,
      reportedStatus: String(reportedStatus),
      ...(confirmedStatus !== null ? { confirmedStatus: String(confirmedStatus) } : {}),
      ...(alreadyNotifiedSuccess ? { [TILDA_NOTIFIED_KEY]: 'success' } : {}),
    };

    await db.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: effectiveStatus,
        callbackData: JSON.stringify(newMeta),
      },
    });

    // Forward notification to Tilda (with retry)
    if (shouldNotifyTilda) {
      const result = await sendTildaNotification({
        tildaPaymentId: transaction.tildaPaymentId || transaction.orderNumber,
        success: isPaid,
        amount: transaction.amount,
        orderId,
      });

      if (result.ok) {
        console.log(`[${new Date().toISOString()}] Tilda notification sent (attempt ${result.attempts}) for order ${orderId} (status: ${isPaid ? 'SUCCESS' : 'FAILURE'})`);

        // Mark as notified to prevent duplicate success notifications
        if (isPaid) {
          const finalMeta = { ...newMeta, [TILDA_NOTIFIED_KEY]: 'success' };
          await db.paymentTransaction.update({
            where: { id: transaction.id },
            data: { callbackData: JSON.stringify(finalMeta) },
          });
        }
      } else {
        console.error(`[${new Date().toISOString()}] Tilda notification FAILED for order ${orderId} after ${result.attempts} attempts:`, result.error);
        // We return OK to VTB so it doesn't retry — the payment is recorded in DB
        // Manual reconciliation may be needed for failed Tilda notifications
      }
    } else {
      console.log(`[${new Date().toISOString()}] Skipping duplicate Tilda notification for order ${orderId} (already notified)`);
    }

    // VTB KZ expects OK response
    return new NextResponse('OK', { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ERROR] /api/payment/callback from ${clientIp}:`, message);
    return new NextResponse('ERROR', { status: 500 });
  }
}
