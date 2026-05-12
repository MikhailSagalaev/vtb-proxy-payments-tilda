import { createHmac, timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';

export function isInsecureMode(): boolean {
  return (process.env.INSECURE_MODE || '').toLowerCase() === 'true';
}

// ==============================
// HMAC-SHA256 Signature Utilities
// ==============================

/**
 * Generate Tilda-compatible HMAC signature.
 * Algorithm: sort params by key alphabetically, join values with newline,
 * HMAC-SHA256 with tildaSecret as key.
 */
export function generateTildaSignature(
  params: Record<string, string>,
  secret: string,
  excludedKeys: string[] = ['signature']
): string {
  // Tilda delimiter varies by gateway template settings.
  // Default is empty string (most common in custom templates).
  // Override via env: TILDA_SIGNATURE_DELIMITER="\n" (two chars) to use newline.
  const rawDelimiter = process.env.TILDA_SIGNATURE_DELIMITER ?? '';
  const delimiter = rawDelimiter === '\\n' ? '\n' : rawDelimiter;

  const filteredKeys = Object.keys(params)
    .filter((k) => !excludedKeys.includes(k) && params[k] !== undefined && params[k] !== '')
    .sort();

  const stringToSign = filteredKeys
    .map((k) => String(params[k]))
    .join(delimiter);

  return createHmac('sha256', secret).update(stringToSign).digest('hex');
}

/**
 * Verify a Tilda HMAC signature.
 */
export function verifyTildaSignature(
  params: Record<string, string>,
  secret: string,
  receivedSignature: string
): boolean {
  if (isInsecureMode()) return true;
  if (!secret) return true; // Allow unsigned requests when no secret configured (test mode)
  const expected = generateTildaSignature(params, secret);
  // Timing-safe comparison
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(receivedSignature, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Generate HMAC signature for VTB KZ webhook verification.
 */
export function generateWebhookSignature(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Verify VTB KZ webhook signature from header.
 */
export function verifyWebhookSignature(body: string, secret: string, signature: string): boolean {
  if (isInsecureMode()) return true;
  if (!secret) return true;
  const expected = generateWebhookSignature(body, secret);
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signature, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ==============================
// Rate Limiting (DB-backed, atomic)
// ==============================

const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30;        // requests per window for payment endpoints
const RATE_LIMIT_MAX_CB = 100;    // for callbacks (VTB may send retries)
const RATE_LIMIT_MAX_ADMIN = 20;  // for admin endpoints (settings, transactions)

export async function checkRateLimit(
  ipAddress: string,
  endpoint: string,
  maxRequests: number = RATE_LIMIT_MAX
): Promise<{ allowed: boolean; remaining: number }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW);
  const resetAt = new Date(now.getTime() + RATE_LIMIT_WINDOW);

  // Clean old entries (best-effort, non-blocking race is acceptable here)
  db.rateLimitEntry.deleteMany({
    where: { resetAt: { lt: windowStart } },
  }).catch(() => {/* ignore cleanup errors */});

  // Atomic: find existing entry in current window
  const existing = await db.rateLimitEntry.findFirst({
    where: { ipAddress, endpoint, resetAt: { gte: windowStart } },
  });

  if (!existing) {
    // First request in this window — create atomically
    try {
      await db.rateLimitEntry.create({
        data: { ipAddress, endpoint, count: 1, resetAt },
      });
    } catch {
      // Another request may have created it concurrently — re-check
      const race = await db.rateLimitEntry.findFirst({
        where: { ipAddress, endpoint, resetAt: { gte: windowStart } },
      });
      if (race && race.count >= maxRequests) {
        return { allowed: false, remaining: 0 };
      }
      if (race) {
        await db.rateLimitEntry.update({
          where: { id: race.id },
          data: { count: { increment: 1 } },
        });
        return { allowed: true, remaining: Math.max(0, maxRequests - race.count - 1) };
      }
    }
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (existing.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  // Atomic increment
  await db.rateLimitEntry.update({
    where: { id: existing.id },
    data: { count: { increment: 1 } },
  });

  return { allowed: true, remaining: maxRequests - existing.count - 1 };
}

// Export constants for use in route handlers
export { RATE_LIMIT_MAX_CB, RATE_LIMIT_MAX_ADMIN };

// ==============================
// Input Sanitization
// ==============================

export function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, '') // Strip angle brackets
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim()
    .slice(0, 1000); // Limit length
}

const CUSTOMER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim, strip control chars, cap length — do not HTML-escape (would break email). */
export function sanitizeCustomerEmail(input: string): string {
  return input
    .trim()
    .replace(/[\r\n\x00-\x1f]/g, '')
    .slice(0, 254);
}

export function isValidCustomerEmail(input: string): boolean {
  const s = sanitizeCustomerEmail(input);
  return s.length > 3 && s.length <= 254 && CUSTOMER_EMAIL_RE.test(s);
}

/**
 * Read buyer email from Tilda POST fields (add the field in «дополнительные поля» with a name containing email, e.g. Email).
 */
export function extractCustomerEmail(params: Record<string, string>): string | undefined {
  const preferredKeys = [
    'email',
    'Email',
    'EMAIL',
    'customer_email',
    'CustomerEmail',
    'payment_email',
    'E-mail',
    'contact_email',
    'user_email',
    'buyer_email',
  ];
  for (const key of preferredKeys) {
    const v = params[key];
    if (v && isValidCustomerEmail(v)) return sanitizeCustomerEmail(v);
  }
  for (const [key, v] of Object.entries(params)) {
    if (!v) continue;
    if (/email/i.test(key) && isValidCustomerEmail(v)) return sanitizeCustomerEmail(v);
  }
  return undefined;
}

export function sanitizeOrderId(input: string): string {
  return input.replace(/[^a-zA-Z0-9\-_.]/g, '').slice(0, 64);
}

export function parseAmount(raw: string): number | null {
  // Allow minus sign for validation, but reject if negative
  const cleaned = raw.replace(/[^\d.,-]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0 || num > 999_999_999) return null;
  return Math.round(num * 100);
}

// ==============================
// Auth Helpers
// ==============================

export async function verifyAdminKey(request: Request): Promise<boolean> {
  if (isInsecureMode()) return true;
  // Only accept key via Authorization header — query params end up in server logs
  const authHeader = request.headers.get('authorization');
  const providedKey = authHeader?.replace('Bearer ', '').trim() || '';

  const config = await db.paymentConfig.findUnique({ where: { id: 'default' } });

  // First-time setup: no admin key configured yet — allow access to set one
  if (!config?.adminApiKey) return true;

  if (!providedKey) return false;

  // Timing-safe comparison to prevent timing attacks on admin key
  try {
    const a = Buffer.from(providedKey, 'utf8');
    const b = Buffer.from(config.adminApiKey, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}

// ==============================
// Safe Logging (mask secrets)
// ==============================

export function maskSensitive(data: Record<string, unknown>, sensitiveKeys: string[] = ['password', 'secret', 'token']): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
      if (typeof value === 'string') {
        masked[key] = value ? `${value.slice(0, 3)}***` : '';
      } else {
        masked[key] = value == null ? value : '***';
      }
    } else {
      masked[key] = value;
    }
  }
  return masked;
}
