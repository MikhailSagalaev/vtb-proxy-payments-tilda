import { randomUUID } from 'crypto';
import { maskSensitive } from '@/lib/security';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function getRequestId(headers?: Headers): string {
  const existing = headers?.get('x-request-id') || headers?.get('x-correlation-id');
  if (existing && existing.trim()) return existing.trim();
  try {
    return randomUUID();
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

export function log(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>
) {
  const ts = new Date().toISOString();
  const payload = meta ? JSON.stringify(meta) : '';
  console[level === 'debug' ? 'log' : level](`[${ts}] ${message}${payload ? ` ${payload}` : ''}`);
}

export function logRequest(
  level: LogLevel,
  requestId: string,
  message: string,
  meta?: Record<string, unknown>,
  mask: boolean = true
) {
  const safeMeta = meta && mask ? maskSensitive(meta) : meta;
  log(level, `[req:${requestId}] ${message}`, safeMeta);
}

export function errorToMeta(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { error: String(error) };
}

