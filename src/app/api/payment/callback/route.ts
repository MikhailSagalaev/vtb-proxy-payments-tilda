import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendTildaNotification } from '@/lib/vtb';
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
    const orderStatus = parseInt(callbackData['orderStatus'] || '0');

    console.log(`[${new Date().toISOString()}] VTB KZ Callback from ${clientIp}: order=${orderId} status=${orderStatus}`);

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

    // Parse existing callback metadata (may contain TILDA_NOTIFIED_KEY)
    let existingMeta: Record<string, string> = {};
    try {
      if (transaction.callbackData) {
        existingMeta = JSON.parse(transaction.callbackData);
      }
    } catch {/* ignore parse errors */}

    // Prevent status downgrade (e.g., paid → not paid)
    const currentStatus = transaction.status;
    const shouldUpdateStatus = orderStatus === 2 || (orderStatus !== 2 && currentStatus !== 2);

    const isPaid = orderStatus === 2;

    // Idempotency: check if we already sent Tilda notification for a successful payment
    const alreadyNotifiedSuccess = existingMeta[TILDA_NOTIFIED_KEY] === 'success';
    const shouldNotifyTilda = isPaid ? !alreadyNotifiedSuccess : true;

    // Update transaction record
    if (shouldUpdateStatus) {
      const newMeta = {
        ...callbackData,
        ...(alreadyNotifiedSuccess ? { [TILDA_NOTIFIED_KEY]: 'success' } : {}),
      };

      await db.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: orderStatus,
          callbackData: JSON.stringify(newMeta),
        },
      });
    }

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
          const finalMeta = { ...callbackData, [TILDA_NOTIFIED_KEY]: 'success' };
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
