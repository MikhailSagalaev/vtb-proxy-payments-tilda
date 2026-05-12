import { NextRequest, NextResponse } from 'next/server';
import { registerOrder, getConfig, extractTildaParams, logRequest } from '@/lib/vtb';
import { db } from '@/lib/db';
import { verifyTildaSignature, checkRateLimit, getClientIp, isInsecureMode, sanitizeOrderId, extractCustomerEmail } from '@/lib/security';
import { errorToMeta, getRequestId, logRequest as logReq } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  const requestId = getRequestId(request.headers);

  try {
    logReq('info', requestId, 'POST /api/payment/create', { clientIp, insecureMode: isInsecureMode() }, false);
    // Rate limiting
    const { allowed } = await checkRateLimit(clientIp, 'payment_create');
    if (!allowed) {
      logReq('warn', requestId, 'Rate limit exceeded on payment_create', { clientIp }, false);
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded' },
        { status: 429 }
      );
    }

    const formData = await request.formData();
    const { amount, paymentId, subject, allParams, signature } = extractTildaParams(formData);

    logRequest(clientIp, '/api/payment/create', allParams);
    const customerEmail = extractCustomerEmail(allParams);
    logReq('info', requestId, 'Parsed tilda params', {
      clientIp,
      paymentId,
      hasSignature: !!signature,
      hasCustomerEmail: Boolean(customerEmail),
    }, false);

    // Validate required fields
    if (amount === null) {
      logReq('warn', requestId, 'Invalid amount', { clientIp, paymentId }, false);
      return NextResponse.json(
        { success: false, error: 'Invalid or missing payment_amount' },
        { status: 400 }
      );
    }

    if (!paymentId) {
      logReq('warn', requestId, 'Missing payment_id', { clientIp }, false);
      return NextResponse.json(
        { success: false, error: 'Missing payment_id' },
        { status: 400 }
      );
    }

    // Verify Tilda signature if secret is configured
    const config = await getConfig();

    let signatureValid: boolean | null = null;

    const insecure = isInsecureMode();

    if (config.tildaSecret && !insecure) {
      if (!signature) {
        // Secret is configured but no signature provided — reject
        console.warn(`[${new Date().toISOString()}] MISSING SIGNATURE from ${clientIp} for order ${paymentId} (secret is configured)`);
        logReq('warn', requestId, 'Signature required but missing', { clientIp, paymentId }, false);
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
        logReq('warn', requestId, 'Invalid signature', { clientIp, paymentId }, false);
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
      logReq('info', requestId, 'Idempotent create: reusing formUrl', { clientIp, paymentId, orderId: existing.orderId }, false);
      const html = buildRedirectHtml(existing.formUrl);
      return new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Register order with VTB KZ
    const forwardedProto = request.headers.get('x-forwarded-proto');
    const forwardedHost = request.headers.get('x-forwarded-host');
    const host = forwardedHost || request.headers.get('host');
    const proto = forwardedProto || (request.nextUrl.protocol ? request.nextUrl.protocol.replace(':', '') : 'https');
    const inferredBaseUrl = host ? `${proto}://${host}` : '';
    const baseUrl = process.env.BASE_URL || inferredBaseUrl;

    const returnUrl = config.successUrl || `${baseUrl}/payment/success`;
    const failUrl = config.failUrl || `${baseUrl}/payment/fail`;

    let result: Awaited<ReturnType<typeof registerOrder>>;
    try {
      result = await registerOrder({
        amount,
        currency: config.currency,
        orderNumber: paymentId,
        description: subject,
        email: customerEmail,
        returnUrl,
        failUrl,
        language: config.language,
      });
    } catch (error) {
      const failureOrderId = `failed_${sanitizeOrderId(paymentId)}_${Date.now()}`;
      await db.paymentTransaction.create({
        data: {
          orderId: failureOrderId.slice(0, 128),
          orderNumber: paymentId,
          amount,
          currency: config.currency,
          formUrl: null,
          status: 6,
          tildaPaymentId: paymentId,
          requestBody: JSON.stringify({
            source: 'tilda_create',
            params: allParams,
            registerRequest: {
              returnUrl,
              failUrl,
              language: config.language,
              currency: config.currency,
              hasCustomerEmail: Boolean(customerEmail),
            },
            error: errorToMeta(error),
          }),
          ipAddress: clientIp,
          signatureValid,
        },
      });
      logReq('error', requestId, 'Failed create saved to transaction log', { clientIp, paymentId, failureOrderId, ...errorToMeta(error) }, false);
      throw error;
    }
    logReq('info', requestId, 'VTB order registered', { clientIp, paymentId, orderId: result.orderId }, false);

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
    logReq('info', requestId, 'Transaction saved', { clientIp, paymentId, orderId: result.orderId }, false);

    const html = buildRedirectHtml(result.formUrl);
    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ERROR] /api/payment/create from ${clientIp}:`, message);
    logReq('error', requestId, 'POST /api/payment/create failed', { clientIp, ...errorToMeta(error) }, false);

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
  // Tilda Universal Payment format: return HTML page that redirects to payment URL.
  // Using window.location is more robust than an empty GET form in some embedded contexts.
  const safeUrl = JSON.stringify(formUrl);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Redirecting to payment...</title></head>
<body style="font-family:sans-serif;padding:24px;color:#111">
<h3>Redirecting to payment page...</h3>
<p>If you are not redirected automatically, open this link:</p>
<p><a id="payLink" href="${formUrl}">${formUrl}</a></p>
<script>
  const url = ${safeUrl};
  try { window.location.replace(url); } catch (e) { window.location.href = url; }
</script>
</body></html>`;
}
