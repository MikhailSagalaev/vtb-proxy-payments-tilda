'use client';

import { useEffect, useMemo, useState } from 'react';

export default function ReturnClient(props: { status: 'success' | 'fail'; title: string }) {
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const url = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const u = new URL(window.location.href);
    u.searchParams.set('status', props.status);
    return u;
  }, [props.status]);

  const nextUrl = useMemo(() => {
    if (!url) return null;
    const rawNext = url.searchParams.get('next');
    if (!rawNext) return null;
    try {
      const parsed = new URL(rawNext);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.toString();
      return null;
    } catch {
      return null;
    }
  }, [url]);

  useEffect(() => {
    if (!url) return;
    const apiUrl = new URL('/api/payment/return', url.origin);
    url.searchParams.forEach((v, k) => apiUrl.searchParams.set(k, v));

    fetch(apiUrl.toString(), { method: 'GET' })
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
        setResult(data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Unknown error'));
  }, [url]);

  useEffect(() => {
    if (!nextUrl) return;
    if (!result || error) return;
    const t = setTimeout(() => {
      window.location.href = nextUrl;
    }, 1200);
    return () => clearTimeout(t);
  }, [nextUrl, result, error]);

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 720, width: '100%', background: '#111', border: '1px solid #222', borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{props.title}</div>
        <div style={{ color: '#9ca3af', fontSize: 14, marginBottom: 16 }}>
          Сейчас зафиксируем статус платежа и отправим уведомление в Tilda (если нужно).
        </div>

        {error && (
          <div style={{ background: '#2a0f0f', border: '1px solid #7f1d1d', padding: 12, borderRadius: 8, marginBottom: 16 }}>
            Ошибка: {error}
          </div>
        )}

        {!error && !result && <div style={{ color: '#9ca3af' }}>Проверяем статус…</div>}

        {result && (
          <div style={{ background: '#0b1f12', border: '1px solid #14532d', padding: 12, borderRadius: 8 }}>
            <div style={{ marginBottom: 6 }}>orderId: <code>{result.orderId}</code></div>
            <div style={{ marginBottom: 6 }}>paid: <code>{String(result.isPaid)}</code></div>
            <div>status: <code>{String(result.effectiveStatus)}</code></div>
          </div>
        )}

        {nextUrl && !error && (
          <div style={{ marginTop: 14, color: '#9ca3af', fontSize: 13 }}>
            Перенаправление на сайт… Если не сработало:
            {' '}
            <a href={nextUrl} style={{ color: '#34d399', textDecoration: 'none' }}>открыть страницу</a>
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <a href="/" style={{ color: '#34d399', textDecoration: 'none' }}>Вернуться в панель</a>
        </div>
      </div>
    </div>
  );
}

