import { NextRequest, NextResponse } from 'next/server';
import { registerOrder, getConfig, extractTildaParams, logRequest } from '@/lib/vtb';
import { db } from '@/lib/db';
import { verifyTildaSignature, checkRateLimit, getClientIp } from '@/lib/security';

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);

  try {
    // Rate limiting
    const { allowed } = await checkRateLimit(clientIp, 'payment_create');
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded' },
        { status: 429 }
      );
    }

    const formData = await request.formData();
    const { amount, paymentId, subject, allParams, signature } = extractTildaParams(formData);

    logRequest(clientIp, '/api/payment/create', allParams);

    // Validate required fields
    if (amount === null) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing payment_amount' },
        { status: 400 }
      );
    }

    if (!paymentId) {
      return NextResponse.json(
        { success: false, error: 'Missing payment_id' },
        { status: 400 }
      );
    }

    // Verify Tilda signature if secret is configured
    const config = await getConfig();

    let signatureValid: boolean | null = null;

    if (config.tildaSecret) {
      if (!signature) {
        // Secret is configured but no signature provided — reject
        console.warn(`[${new Date().toISOString()}] MISSING SIGNATURE from ${clientIp} for order ${paymentId} (secret is configured)`);
        return NextResponse.json(
          { success: false, error: 'Signature required' },
          { status: 403 }
        );
      }

      const isValid = verifyTildaSignature(allParams, config.tildaSecret, signature);
      logRequest(clientIp, '/api/payment/create', {
        action: 'signature_check',
        valid: isValid,
        hasSecret: true,
      }, false);

      if (!isValid) {
        console.warn(`[${new Date().toISOString()}] INVALID SIGNATURE from ${clientIp} for order ${paymentId}`);
        return NextResponse.json(
          { success: false, error: 'Invalid signature' },
          { status: 403 }
        );
      }

      signatureValid = true;
    }
    // signatureValid remains null when no secret is configured (unsigned mode)

    // Idempotency: check if this orderNumber was already processed
    const existing = await db.paymentTransaction.findFirst({
      where: { orderNumber: paymentId },
    });

    if (existing?.formUrl) {
      // Already registered — return the existing payment URL (idempotent)
      console.log(`[${new Date().toISOString()}] Idempotent request for order ${paymentId} → reusing ${existing.orderId}`);
      const html = buildRedirectHtml(existing.formUrl);
      return new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Register order with VTB KZ
    const returnUrl = config.successUrl || `${process.env.BASE_URL || ''}/payment/success`;
    const failUrl = config.failUrl || `${process.env.BASE_URL || ''}/payment/fail`;

    const result = await registerOrder({
      amount,
      currency: config.currency,
      orderNumber: paymentId,
      description: subject,
      returnUrl,
      failUrl,
      language: config.language,
    });

    // Save transaction
    await db.paymentTransaction.create({
      data: {
        orderId: result.orderId,
        orderNumber: paymentId,
        amount,
        currency: config.currency,
        formUrl: result.formUrl,
        status: 0,
        tildaPaymentId: paymentId,
        requestBody: JSON.stringify(allParams),
        ipAddress: clientIp,
        signatureValid,
      },
    });

    console.log(`[${new Date().toISOString()}] Order registered: ${paymentId} → VTB ${result.orderId}`);

    const html = buildRedirectHtml(result.formUrl);
    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ERROR] /api/payment/create from ${clientIp}:`, message);

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Error</title></head>
<body><div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#333">
<div style="text-align:center;padding:2rem"><h2>Payment Error</h2><p>${message}</p></div>
</div></body></html>`;

    return new NextResponse(html, {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

function buildRedirectHtml(formUrl: string): string {
  // Tilda Universal Payment format: return HTML page that auto-submits to payment URL
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Redirecting to payment...</title></head>
<body>
<form id="paymentForm" method="GET" action="${formUrl}">
</form>
<script>document.getElementById('paymentForm').submit();</script>
<noscript>
<p>Redirecting to payment page...</p>
<a href="${formUrl}">Click here if not redirected automatically</a>
</noscript>
</body></html>`;
}
