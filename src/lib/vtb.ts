import { db } from '@/lib/db';
import {
  generateTildaSignature,
  parseAmount,
  sanitizeString,
  sanitizeOrderId,
  getClientIp,
  maskSensitive,
} from '@/lib/security';
import { getRequestId, logRequest as logReq } from '@/lib/logger';

// ==============================
// Types
// ==============================

interface VTBRegisterParams {
  amount: number;
  currency: string;
  orderNumber: string;
  description?: string;
  returnUrl?: string;
  failUrl?: string;
  language?: string;
}

interface VTBRegisterResponse {
  orderId: string;
  formUrl: string;
  error?: string;
}

interface VTBStatusResponse {
  orderNumber: string;
  orderStatus: number;
  amount: number;
  actionCode: number;
  actionCodeDescription?: string;
  [key: string]: unknown;
}

// ==============================
// Config Cache (in-memory, TTL 60s)
// ==============================

const CONFIG_TTL_MS = 60_000; // 1 minute

// Cache stores non-null config — we always create default if not found
type PaymentConfig = NonNullable<Awaited<ReturnType<typeof db.paymentConfig.findUnique>>>;
let configCache: { data: PaymentConfig; expiresAt: number } | null = null;

/**
 * Get payment config with in-memory cache (TTL 60s).
 * Avoids repeated DB round-trips on every payment/callback request.
 */
export async function getConfig() {
  const now = Date.now();

  if (configCache && now < configCache.expiresAt && configCache.data) {
    return configCache.data;
  }

  let config = await db.paymentConfig.findUnique({ where: { id: 'default' } });
  if (!config) {
    config = await db.paymentConfig.create({ data: { id: 'default' } });
  }

  configCache = { data: config, expiresAt: now + CONFIG_TTL_MS };
  return config;
}

/**
 * Invalidate config cache — call after updating settings.
 */
export function invalidateConfigCache(): void {
  configCache = null;
}

export async function updateConfig(data: Record<string, unknown>) {
  // Only allow whitelisted fields to prevent injection
  const allowed = [
    'vtbUserName', 'vtbPassword', 'gatewayUrl', 'currency', 'language',
    'tildaCallbackUrl', 'tildaSecret', 'webhookSecret', 'adminApiKey',
    'successUrl', 'failUrl', 'isTestMode',
  ];
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (allowed.includes(key)) {
      filtered[key] = value;
    }
  }
  const result = await db.paymentConfig.upsert({
    where: { id: 'default' },
    update: filtered,
    create: { id: 'default', ...filtered },
  });

  // Invalidate cache so next request picks up new config
  invalidateConfigCache();

  return result;
}

// ==============================
// VTB KZ API
// ==============================

export async function registerOrder(params: VTBRegisterParams): Promise<VTBRegisterResponse> {
  const config = await getConfig();
  if ((process.env.MOCK_VTB || '').toLowerCase() === 'true') {
    const orderNumber = sanitizeOrderId(params.orderNumber);
    return {
      orderId: `mock_${orderNumber}_${Date.now()}`,
      formUrl: `https://mock-vtb.local/pay?orderNumber=${encodeURIComponent(orderNumber)}`,
    };
  }
  const gatewayUrl = config.gatewayUrl.replace(/\/$/, '');

  const formData = new URLSearchParams({
    userName: config.vtbUserName,
    password: config.vtbPassword,
    amount: params.amount.toString(),
    currency: params.currency || config.currency,
    orderNumber: sanitizeOrderId(params.orderNumber),
    returnUrl: params.returnUrl || '',
    language: params.language || config.language,
  });

  // Pass failUrl if provided — used when payment fails or is cancelled
  if (params.failUrl) {
    formData.append('failUrl', params.failUrl);
  }

  if (params.description) {
    formData.append('description', sanitizeString(params.description));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const requestId = getRequestId();
    logReq('info', requestId, 'VTB register.do request', maskSensitive({
      gatewayUrl,
      userName: config.vtbUserName,
      amount: String(params.amount),
      currency: params.currency || config.currency,
      orderNumber: sanitizeOrderId(params.orderNumber),
      returnUrl: params.returnUrl || '',
      failUrl: params.failUrl || '',
      language: params.language || config.language,
    } as any), true);

    const response = await fetch(`${gatewayUrl}/register.do`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let data: any = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = { _nonJson: rawText };
    }

    if (data.error) {
      throw new Error(data.errorMessage || `VTB error: ${data.error}`);
    }
    if (!data.orderId || !data.formUrl) {
      const details = typeof data === 'object' && data ? JSON.stringify(maskSensitive(data)) : String(data);
      throw new Error(`VTB response missing orderId/formUrl (status=${response.status}) ${details}`);
    }

    return {
      orderId: data.orderId,
      formUrl: data.formUrl,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getOrderStatus(orderId: string): Promise<VTBStatusResponse> {
  const config = await getConfig();
  if ((process.env.MOCK_VTB || '').toLowerCase() === 'true') {
    return {
      orderNumber: sanitizeOrderId(orderId),
      orderStatus: 2,
      amount: 1000,
      actionCode: 0,
      actionCodeDescription: 'MOCK OK',
    };
  }
  const gatewayUrl = config.gatewayUrl.replace(/\/$/, '');

  const formData = new URLSearchParams({
    userName: config.vtbUserName,
    password: config.vtbPassword,
    orderId: sanitizeOrderId(orderId),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${gatewayUrl}/getOrderStatusExtended.do`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
      signal: controller.signal,
    });

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ==============================
// Tilda Callback Sender (with retry)
// ==============================

const TILDA_NOTIFY_TIMEOUT_MS = 10_000; // 10 seconds per attempt
const TILDA_NOTIFY_MAX_RETRIES = 3;
const TILDA_NOTIFY_RETRY_DELAY_MS = 2_000; // 2 seconds between retries

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send signed notification to Tilda's callback URL with retry logic.
 * Tilda requires: payment_id, payment_status, payment_amount, and HMAC signature.
 * Retries up to TILDA_NOTIFY_MAX_RETRIES times on network failures.
 */
export async function sendTildaNotification(params: {
  tildaPaymentId: string;
  success: boolean;
  amount: number;
  orderId: string;
}): Promise<{ ok: boolean; error?: string; attempts: number }> {
  const config = await getConfig();
  const tildaCallbackUrl = config.tildaCallbackUrl;

  if (!tildaCallbackUrl) {
    return { ok: false, error: 'Tilda callback URL not configured', attempts: 0 };
  }

  const callbackParams: Record<string, string> = {
    payment_id: params.tildaPaymentId,
    payment_status: params.success ? 'success' : 'failure',
    payment_amount: (params.amount / 100).toFixed(2),
  };

  // Generate HMAC signature if tildaSecret is configured
  if (config.tildaSecret) {
    callbackParams['signature'] = generateTildaSignature(callbackParams, config.tildaSecret);
  }

  const formData = new URLSearchParams(callbackParams);
  const body = formData.toString();

  let lastError = '';

  for (let attempt = 1; attempt <= TILDA_NOTIFY_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TILDA_NOTIFY_TIMEOUT_MS);

    try {
      const response = await fetch(tildaCallbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        return { ok: true, attempts: attempt };
      }

      lastError = `HTTP ${response.status}`;
      console.warn(`[${new Date().toISOString()}] Tilda notification attempt ${attempt}/${TILDA_NOTIFY_MAX_RETRIES} failed: ${lastError} for order ${params.orderId}`);
    } catch (err) {
      clearTimeout(timeout);
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[${new Date().toISOString()}] Tilda notification attempt ${attempt}/${TILDA_NOTIFY_MAX_RETRIES} error: ${lastError} for order ${params.orderId}`);
    }

    if (attempt < TILDA_NOTIFY_MAX_RETRIES) {
      await sleep(TILDA_NOTIFY_RETRY_DELAY_MS * attempt); // exponential-ish backoff
    }
  }

  return { ok: false, error: `Failed after ${TILDA_NOTIFY_MAX_RETRIES} attempts: ${lastError}`, attempts: TILDA_NOTIFY_MAX_RETRIES };
}

// ==============================
// Helpers
// ==============================

export function extractTildaParams(formData: FormData): {
  amount: number | null;
  paymentId: string;
  subject: string;
  allParams: Record<string, string>;
  signature: string;
} {
  const allParams: Record<string, string> = {};
  formData.forEach((value, key) => {
    allParams[key] = value as string;
  });

  const rawAmount = allParams['payment_amount'] || '';
  const amount = parseAmount(rawAmount);
  const paymentId = allParams['payment_id'] || `tilda_${Date.now()}`;
  const subject = allParams['payment_subject'] || 'Оплата заказа';
  const signature = allParams['signature'] || allParams['Signature'] || '';

  return { amount, paymentId, subject, allParams, signature };
}

export function logRequest(ip: string, endpoint: string, data: unknown, sensitive = true) {
  const masked = sensitive && typeof data === 'object' ? maskSensitive(data as Record<string, string>) : data;
  console.log(`[${new Date().toISOString()}] ${ip} → ${endpoint}:`, JSON.stringify(masked));
}
