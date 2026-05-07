'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';

// ==============================
// Types
// ==============================

interface PaymentConfig {
  id: string;
  vtbUserName: string;
  vtbPassword: string;
  gatewayUrl: string;
  currency: string;
  language: string;
  tildaCallbackUrl: string;
  tildaSecret: string;
  webhookSecret: string;
  adminApiKey: string;
  successUrl: string;
  failUrl: string;
  isTestMode: boolean;
  updatedAt: string;
  createdAt: string;
}

interface PaymentTransaction {
  id: string;
  orderId: string;
  orderNumber: string;
  amount: number;
  currency: string;
  formUrl: string | null;
  status: number;
  tildaPaymentId: string | null;
  requestBody: string | null;
  callbackData: string | null;
  ipAddress: string | null;
  signatureValid: boolean | null;
  createdAt: string;
  updatedAt: string;
}

// ==============================
// Constants
// ==============================

const STATUS_MAP: Record<number, { label: string; color: string }> = {
  0: { label: 'Создан', color: 'bg-zinc-800 text-zinc-300 border border-zinc-700' },
  1: { label: 'Одобрен', color: 'bg-sky-500/15 text-sky-400 border border-sky-500/30' },
  2: { label: 'Оплачен', color: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' },
  3: { label: 'Отменён', color: 'bg-red-500/15 text-red-400 border border-red-500/30' },
  4: { label: 'Возврат', color: 'bg-orange-500/15 text-orange-400 border border-orange-500/30' },
  6: { label: 'Отклонён', color: 'bg-red-500/15 text-red-400 border border-red-500/30' },
};

// ==============================
// Components
// ==============================

function CopyButton({ text, variant = 'default' }: { text: string; variant?: 'default' | 'small' }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <Button
      variant="ghost"
      size={variant === 'small' ? 'sm' : 'default'}
      onClick={handleCopy}
      className={variant === 'small' ? 'h-7 px-2 text-xs shrink-0' : 'h-8 px-3 text-xs shrink-0'}
    >
      {copied ? '✓' : '📋'}
    </Button>
  );
}

function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function FormField({ id, label, children, hint }: { id: string; label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: number }) {
  const info = STATUS_MAP[status] || { label: `Неизвестный (${status})`, color: 'bg-zinc-800 text-zinc-400 border border-zinc-700' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${info.color}`}>{info.label}</span>;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Generate random hex string (works in non-secure HTTP contexts, unlike crypto.randomUUID) */
function generateRandomHex(length: number = 48): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}

function formatAmount(amount: number, currency: string) {
  const symbols: Record<string, string> = { '398': '₸', '643': '₽', '840': '$', '978': '€' };
  return `${(amount / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${symbols[currency] || currency}`;
}

function isMaskedValue(value: string): boolean {
  return value.includes('•');
}

function prettyJson(raw: string | null): string {
  if (!raw) return '—';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

// ==============================
// Main Page
// ==============================

export default function Home() {
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [insecureMode, setInsecureMode] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [adminKey, setAdminKey] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('vtb_admin_key') || '';
  });
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [showAdminKey, setShowAdminKey] = useState(false);
  const [showGeneratedKey, setShowGeneratedKey] = useState(false);
  const [showGeneratedSecret, setShowGeneratedSecret] = useState(false);
  const [showVtbPassword, setShowVtbPassword] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);

  const [form, setForm] = useState({
    vtbUserName: '', vtbPassword: '', gatewayUrl: '', currency: '398', language: 'ru',
    tildaCallbackUrl: '', tildaSecret: '', webhookSecret: '', adminApiKey: '',
    successUrl: '', failUrl: '', isTestMode: true,
  });

  // Validate that string is safe for HTTP headers (ASCII only)
  const isValidHeaderValue = (value: string): boolean => {
    return /^[\x20-\x7E]*$/.test(value);
  };

  const showMessage = (type: 'success' | 'error' | 'info', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const fetchConfig = useCallback(async () => {
    try {
      const headers: HeadersInit = {};
      if (adminKey && isValidHeaderValue(adminKey)) {
        headers['Authorization'] = `Bearer ${adminKey}`;
      }
      const res = await fetch('/api/settings', { headers });
      const data = await res.json();
      const insecure = !!data?.insecureMode;
      setInsecureMode(insecure);
      setConfig(data);
      setForm({
        vtbUserName: data.vtbUserName || '',
        vtbPassword: data.vtbPassword || '',
        gatewayUrl: data.gatewayUrl || '',
        currency: data.currency || '398',
        language: data.language || 'ru',
        tildaCallbackUrl: data.tildaCallbackUrl || '',
        tildaSecret: data.tildaSecret || '',
        webhookSecret: data.webhookSecret || '',
        adminApiKey: data.adminApiKey || '',
        successUrl: data.successUrl || '',
        failUrl: data.failUrl || '',
        isTestMode: data.isTestMode ?? true,
      });
      // If admin API key exists, show the auth field
      if (data.adminApiKey && data.adminApiKey !== '••••••••') {
        setAdminAuthenticated(true);
      }
      if (insecure) setAdminAuthenticated(true);
    } catch (err) {
      console.error('Failed to fetch config:', err);
    }
  }, [adminKey]);

  const revealSecrets = useCallback(async () => {
    if (!insecureMode && (!adminKey || !isValidHeaderValue(adminKey))) {
      showMessage('error', 'Введите корректный Admin API Key');
      return;
    }
    setRevealing(true);
    try {
      const headers: HeadersInit = {};
      if (adminKey && isValidHeaderValue(adminKey)) {
        headers['Authorization'] = `Bearer ${adminKey}`;
      }
      const res = await fetch('/api/settings/secrets', {
        headers,
      });
      const data = await res.json();
      if (!res.ok) {
        showMessage('error', data?.error || 'Не удалось получить секреты');
        return;
      }
      setForm((prev) => ({
        ...prev,
        vtbPassword: data.vtbPassword ?? prev.vtbPassword,
        tildaSecret: data.tildaSecret ?? prev.tildaSecret,
        webhookSecret: data.webhookSecret ?? prev.webhookSecret,
        adminApiKey: data.adminApiKey ?? prev.adminApiKey,
      }));
      setShowVtbPassword(true);
      setShowGeneratedKey(true);
      setShowGeneratedSecret(true);
      setShowWebhookSecret(true);
      showMessage('success', 'Секреты загружены и показаны локально в браузере');
    } catch {
      showMessage('error', 'Не удалось получить секреты');
    } finally {
      setRevealing(false);
    }
  }, [adminKey, insecureMode]);

  const fetchTransactions = useCallback(async () => {
    try {
      if (!insecureMode && (!adminKey || !isValidHeaderValue(adminKey))) return;
      const headers: HeadersInit = {};
      if (adminKey && isValidHeaderValue(adminKey)) {
        headers['Authorization'] = `Bearer ${adminKey}`;
      }
      const res = await fetch('/api/transactions', {
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        setTransactions(data);
      }
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
    }
  }, [adminKey, insecureMode]);

  const showSecretValue = (value: string, setVisible: (visible: boolean) => void, visible: boolean) => {
    if (!visible && isMaskedValue(value)) {
      revealSecrets();
      return;
    }
    setVisible(!visible);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchConfig().finally(() => setLoading(false));
  }, [fetchConfig]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (adminAuthenticated) fetchTransactions();
  }, [adminAuthenticated, fetchTransactions]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const isFirstSetup = (config as any)?.firstSetup === true;
      const effectiveKey = adminKey || (isFirstSetup ? (form.adminApiKey || '') : '');

      if (!insecureMode) {
        if (!effectiveKey) {
          showMessage('error', 'Введите Admin API Key');
          setSaving(false);
          return;
        }
        if (!isValidHeaderValue(effectiveKey)) {
          showMessage('error', 'Admin API Key должен содержать только латинские символы, цифры и спецсимволы (без кириллицы)');
          setSaving(false);
          return;
        }
      }
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(insecureMode ? {} : { 'Authorization': `Bearer ${effectiveKey}` }),
        },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        setConfig(data.config);
        if (!insecureMode) {
          setAdminAuthenticated(true);
          setAdminKey(effectiveKey);
          localStorage.setItem('vtb_admin_key', effectiveKey);
        }
        showMessage('success', 'Настройки сохранены');
        fetchTransactions();
      } else {
        showMessage('error', `Ошибка: ${data.error}`);
      }
    } catch {
      showMessage('error', 'Не удалось сохранить настройки');
    } finally {
      setSaving(false);
    }
  };

  const handleAdminAuth = async () => {
    if (!adminKey) {
      showMessage('error', 'Введите Admin API Key');
      return;
    }
    if (!isValidHeaderValue(adminKey)) {
      showMessage('error', 'Ключ должен содержать только латинские символы и цифры (без кириллицы)');
      return;
    }
    try {
      // Verify key against server by trying to fetch transactions
      const res = await fetch('/api/transactions', {
        headers: { 'Authorization': `Bearer ${adminKey}` },
      });
      if (res.ok) {
        setAdminAuthenticated(true);
        localStorage.setItem('vtb_admin_key', adminKey);
        const data = await res.json();
        setTransactions(data);
        showMessage('success', 'Авторизация успешна');
      } else {
        showMessage('error', 'Неверный Admin API Key');
      }
    } catch {
      showMessage('error', 'Ошибка подключения к серверу');
    }
  };

  // Use window.location.origin for UI display — BASE_URL env is for server-side redirects
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = `${baseUrl}/api/payment/create`;
  const callbackUrl = `${baseUrl}/api/payment/callback`;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-neutral-500 text-sm">Загрузка...</p>
        </div>
      </div>
    );
  }

  const hasSecurityConfig = !!(config?.tildaSecret || config?.webhookSecret || config?.adminApiKey);

  return (
    <div className="min-h-screen flex flex-col bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-950/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-emerald-500/20">
                V
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-white">VTB KZ ↔ Tilda</h1>
                <p className="text-xs text-neutral-500">Payment Proxy Server</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {config?.isTestMode && (
                <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs">
                  TEST MODE
                </Badge>
              )}
              <Badge variant="outline" className={`text-xs ${hasSecurityConfig ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-red-500/30 bg-red-500/10 text-red-400'}`}>
                {hasSecurityConfig ? 'SECURED' : 'NOT SECURED'}
              </Badge>
            </div>
          </div>
        </div>
      </header>

      {/* Message banner */}
      {message && (
        <div className="border-b">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2">
            <Alert
              variant={message.type === 'error' ? 'destructive' : 'default'}
              className={`${message.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : message.type === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-neutral-700 bg-neutral-900 text-neutral-300'}`}
            >
              <AlertTitle className="text-sm font-medium">{message.text}</AlertTitle>
            </Alert>
          </div>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">

        {/* Admin Auth */}
        {!adminAuthenticated && !insecureMode && (
          <Card className="border-neutral-800 bg-neutral-900/50">
            <CardContent className="pt-6">
              <div className="flex flex-col sm:flex-row gap-3 items-end">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-sm">Admin API Key</Label>
                  <p className="text-xs text-neutral-500">Введите ваш ключ (создайте его в блоке «Безопасность» ниже)</p>
                  <div className="flex gap-2">
                    <Input
                      type={showAdminKey ? 'text' : 'password'}
                      value={adminKey}
                      onChange={(e) => setAdminKey(e.target.value)}
                      placeholder="Введите ключ для доступа к настройкам"
                      className="bg-neutral-800 border-neutral-700 text-white"
                      onKeyDown={(e) => e.key === 'Enter' && handleAdminAuth()}
                    />
                    <Button variant="ghost" size="sm" className="shrink-0 text-xs text-neutral-400" onClick={() => setShowAdminKey(!showAdminKey)}>
                      {showAdminKey ? 'Скрыть' : 'Показать'}
                    </Button>
                  </div>
                </div>
                <Button onClick={handleAdminAuth} variant="outline" className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10">
                  Войти
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs defaultValue="integration" className="space-y-6">
          <TabsList className="bg-neutral-900 border border-neutral-800 p-1 h-auto">
            <TabsTrigger value="integration" className="text-xs data-[state=active]:bg-neutral-800 data-[state=active]:text-white data-[state=active]:shadow-sm px-3 py-2">
              Интеграция
            </TabsTrigger>
            <TabsTrigger value="settings" className="text-xs data-[state=active]:bg-neutral-800 data-[state=active]:text-white data-[state=active]:shadow-sm px-3 py-2">
              Платёжный шлюз
            </TabsTrigger>
            <TabsTrigger value="logs" className="text-xs data-[state=active]:bg-neutral-800 data-[state=active]:text-white data-[state=active]:shadow-sm px-3 py-2">
              Логи
            </TabsTrigger>
          </TabsList>

          {/* =================== TAB: Integration =================== */}
          <TabsContent value="integration">
            <div className="space-y-4">

              {/* Critical: Security warning */}
              {!hasSecurityConfig && (
                <Alert className="border-red-500/30 bg-red-500/10 text-red-300">
                  <AlertTitle className="text-sm font-semibold">Безопасность не настроена!</AlertTitle>
                  <AlertDescription className="text-xs text-red-400">
                    Перед подключением обязательно задайте Admin API Key и Tilda Secret в блоке «Безопасность» ниже.
                    Без этого любой сможет изменить ваши настройки.
                  </AlertDescription>
                </Alert>
              )}

              {/* Security */}
              <Card className="border-neutral-800 bg-neutral-900/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Безопасность</CardTitle>
                  <CardDescription className="text-xs">
                    Здесь создаются/задаются Admin API Key и секреты. Нажмите «Сохранить», чтобы записать их в базу.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <FormField id="adminApiKey" label="Admin API Key" hint="Этот ключ нужен, чтобы войти сверху и менять настройки в боевом режиме.">
                      <div className="flex gap-2">
                        <Input
                          type={showGeneratedKey ? 'text' : 'password'}
                          value={form.adminApiKey}
                          onChange={(e) => setForm({ ...form, adminApiKey: e.target.value })}
                          placeholder="Сгенерируйте или задайте свой ключ"
                          className="bg-neutral-800 border-neutral-700 text-white"
                        />
                        <Button type="button" variant="ghost" size="sm" className="shrink-0 text-xs text-neutral-400" onClick={() => showSecretValue(form.adminApiKey, setShowGeneratedKey, showGeneratedKey)} disabled={revealing}>
                          {revealing && !showGeneratedKey ? '...' : showGeneratedKey ? 'Скрыть' : 'Показать'}
                        </Button>
                        <Button type="button" variant="outline" size="sm" className="shrink-0 text-xs border-neutral-700 text-neutral-300 hover:bg-neutral-800" onClick={() => setForm({ ...form, adminApiKey: generateRandomHex(48) })}>
                          Сгенерировать
                        </Button>
                      </div>
                    </FormField>

                    <FormField id="tildaSecret" label="Tilda Secret" hint="Секрет для подписи запросов Tilda (создание платежа).">
                      <div className="flex gap-2">
                        <Input
                          type={showGeneratedSecret ? 'text' : 'password'}
                          value={form.tildaSecret}
                          onChange={(e) => setForm({ ...form, tildaSecret: e.target.value })}
                          placeholder="Секрет Tilda"
                          className="bg-neutral-800 border-neutral-700 text-white"
                        />
                        <Button type="button" variant="ghost" size="sm" className="shrink-0 text-xs text-neutral-400" onClick={() => showSecretValue(form.tildaSecret, setShowGeneratedSecret, showGeneratedSecret)} disabled={revealing}>
                          {revealing && !showGeneratedSecret ? '...' : showGeneratedSecret ? 'Скрыть' : 'Показать'}
                        </Button>
                        <Button type="button" variant="outline" size="sm" className="shrink-0 text-xs border-neutral-700 text-neutral-300 hover:bg-neutral-800" onClick={() => setForm({ ...form, tildaSecret: generateRandomHex(64) })}>
                          Сгенерировать
                        </Button>
                      </div>
                    </FormField>

                    <div className="sm:col-span-2">
                      <FormField id="webhookSecret" label="VTB Callback Secret (опционально)" hint="Если VTB KZ присылает подпись колбэка — задайте здесь. Если нет, можно оставить пустым.">
                        <div className="flex gap-2">
                          <Input
                            type={showWebhookSecret ? 'text' : 'password'}
                            value={form.webhookSecret}
                            onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
                            placeholder="Секрет для колбэков"
                            className="bg-neutral-800 border-neutral-700 text-white"
                          />
                          <Button type="button" variant="ghost" size="sm" className="shrink-0 text-xs text-neutral-400" onClick={() => showSecretValue(form.webhookSecret, setShowWebhookSecret, showWebhookSecret)} disabled={revealing}>
                            {revealing && !showWebhookSecret ? '...' : showWebhookSecret ? 'Скрыть' : 'Показать'}
                          </Button>
                          <Button type="button" variant="outline" size="sm" className="shrink-0 text-xs border-neutral-700 text-neutral-300 hover:bg-neutral-800" onClick={() => setForm({ ...form, webhookSecret: generateRandomHex(64) })}>
                            Сгенерировать
                          </Button>
                        </div>
                      </FormField>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[140px]">
                      {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Сохранить'}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Endpoints */}
              <Card className="border-neutral-800 bg-neutral-900/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">URL-адреса для настройки</CardTitle>
                  <CardDescription className="text-xs">Скопируйте эти URL и вставьте в соответствующие системы</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Tilda Webhook */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-sm font-medium">Tilda: API URL (создание платежа)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-xs font-mono text-emerald-400 break-all">
                        {webhookUrl}
                      </code>
                      <CopyButton text={webhookUrl} />
                    </div>
                    <p className="text-xs text-neutral-500">
                      Настройки Tilda → Платёжные системы → Универсальная → Создать новый шаблон → API URL
                    </p>
                  </div>

                  <Separator className="bg-neutral-800" />

                  {/* VTB KZ Callback */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span className="text-sm font-medium">VTB KZ: Callback URL (уведомления)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-xs font-mono text-amber-400 break-all">
                        {callbackUrl}
                      </code>
                      <CopyButton text={callbackUrl} />
                    </div>
                    <p className="text-xs text-neutral-500">
                      Sandbox VTB KZ → Личный кабинет → Callback уведомления → URL
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Instructions */}
              <Card className="border-neutral-800 bg-neutral-900/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Пошаговая инструкция настройки Tilda</CardTitle>
                  <CardDescription className="text-xs">Где что нажать и что куда вписать</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-1">
                    <div className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-mono text-xs font-bold shrink-0">1</div>
                      <div className="space-y-1 min-w-0">
                        <h4 className="text-sm font-semibold text-neutral-100">Подготовьте секреты</h4>
                        <p className="text-xs text-neutral-400 leading-relaxed">В блоке «Безопасность» (выше) сгенерируйте Tilda Secret и Admin API Key, затем нажмите «Сохранить».</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-mono text-xs font-bold shrink-0">2</div>
                      <div className="space-y-1 min-w-0">
                        <h4 className="text-sm font-semibold text-neutral-100">Настройте платёжный шлюз</h4>
                        <p className="text-xs text-neutral-400 leading-relaxed">На вкладке «Платёжный шлюз» укажите API логин (userName) и пароль (password) от VTB KZ (test_user / test_user_password для sandbox). Валюта: KZT (398). Нажмите «Сохранить».</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center font-mono text-xs font-bold shrink-0">3</div>
                      <div className="space-y-1 min-w-0">
                        <h4 className="text-sm font-semibold text-neutral-100">Создайте платёжную систему в Tilda</h4>
                        <p className="text-xs text-neutral-400 leading-relaxed">В Tilda откройте: <span className="text-sky-400 font-semibold">Настройки сайта → Платёжные системы → Универсальная платёжная система → Добавить новый шаблон</span></p>
                        <div className="mt-2 rounded-lg bg-neutral-800/60 border border-neutral-700/50 p-3 space-y-2">
                          <div className="flex justify-between items-start gap-2">
                            <span className="text-xs font-medium text-neutral-300 shrink-0">API URL:</span>
                            <code className="text-xs text-emerald-400 break-all">{webhookUrl}</code>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center font-mono text-xs font-bold shrink-0">4</div>
                      <div className="space-y-1 min-w-0">
                        <h4 className="text-sm font-semibold text-neutral-100">Настройте «Расширенные настройки» шаблона в Tilda</h4>
                        <p className="text-xs text-neutral-400 leading-relaxed">В шаблоне нажмите «Расширенные настройки» и заполните:</p>
                        <div className="mt-2 rounded-lg bg-neutral-800/60 border border-neutral-700/50 p-3 space-y-3">
                          <div>
                            <p className="text-xs font-semibold text-amber-400 mb-1.5">Список соответствия полей:</p>
                            <div className="space-y-1 text-xs text-neutral-400">
                              <p>Номер заказа (payment_id) → <code className="text-sky-400">payment_id</code></p>
                              <p>Сумма платежа (payment_amount) → <code className="text-sky-400">payment_amount</code></p>
                              <p>Описание заказа (payment_subject) → <code className="text-sky-400">payment_subject</code></p>
                            </div>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-amber-400 mb-1.5">Подпись заказа:</p>
                            <div className="space-y-1 text-xs text-neutral-400">
                              <p>Секрет для подписи заказа → <span className="text-emerald-400 font-medium">вставьте ваш Tilda Secret из шага 1</span></p>
                              <p>Алгоритм: <span className="text-sky-400">MD5</span> или <span className="text-sky-400">HMAC</span></p>
                              <p>Сортировка: по алфавиту, исключить поле signature</p>
                            </div>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-amber-400 mb-1.5">Показатель успешного платежа:</p>
                            <div className="space-y-1 text-xs text-neutral-400">
                              <p>Поле: <code className="text-sky-400">payment_status</code></p>
                              <p>Значение: <code className="text-sky-400">success</code></p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center font-mono text-xs font-bold shrink-0">5</div>
                      <div className="space-y-1 min-w-0">
                        <h4 className="text-sm font-semibold text-neutral-100">Скопируйте URL для уведомлений из Tilda</h4>
                        <p className="text-xs text-neutral-400 leading-relaxed">После сохранения шаблона Tilda покажет <span className="text-amber-400 font-semibold">URL для уведомлений</span> — это адрес вида <code className="text-xs text-sky-400">https://forms.tildaapi.com/payment/custom/.../</code>. Скопируйте его.</p>
                        <p className="text-xs text-neutral-400 leading-relaxed mt-1">Затем вставьте его на вкладке «Платёжный шлюз» в поле <span className="text-emerald-400 font-medium">Tilda Notification URL</span> и нажмите «Сохранить».</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center font-mono text-xs font-bold shrink-0">6</div>
                      <div className="space-y-1 min-w-0">
                        <h4 className="text-sm font-semibold text-neutral-100">Укажите Callback URL в VTB KZ</h4>
                        <p className="text-xs text-neutral-400 leading-relaxed">В личном кабинете VTB KZ (sandbox.vtb-bank.kz) настройте Callback URL для уведомлений об оплате:</p>
                        <div className="mt-2 rounded-lg bg-neutral-800/60 border border-neutral-700/50 p-3">
                          <div className="flex justify-between items-start gap-2">
                            <span className="text-xs font-medium text-neutral-300 shrink-0">Callback URL:</span>
                            <code className="text-xs text-amber-400 break-all">{callbackUrl}</code>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-mono text-xs font-bold shrink-0">7</div>
                      <div className="space-y-1 min-w-0">
                        <h4 className="text-sm font-semibold text-neutral-100">Подключите платёжную систему к странице Tilda</h4>
                        <p className="text-xs text-neutral-400 leading-relaxed">Откройте страницу с формой заказа в Tilda → выберите блок «Форма» → вкладка «Платёжные системы» → выберите ваш шаблон из списка. Сохраните и опубликуйте страницу.</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-mono text-xs font-bold shrink-0">8</div>
                      <div className="space-y-1 min-w-0">
                        <h4 className="text-sm font-semibold text-neutral-100">Тестирование</h4>
                        <p className="text-xs text-neutral-400 leading-relaxed">Сделайте тестовый платёж на сайте Tilda. Тестовые данные карты VTB KZ: 2201 3820 0000 0021, CVC: 123, Срок: 12/34. Проверьте статус на вкладке «Транзакции».</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Architecture */}
              <Card className="border-neutral-800 bg-neutral-900/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Схема работы</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg bg-neutral-800/50 border border-neutral-700/50 p-4 font-mono text-xs space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-400">Tilda</span>
                      <span className="text-neutral-500">→ POST (подпись) →</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Прокси</span>
                      <span className="text-neutral-500">→ register.do →</span>
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">VTB KZ</span>
                    </div>
                    <div className="pl-8 text-neutral-600">↓ возвращает formUrl → Прокси → редирект клиента на страницу оплаты</div>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">VTB KZ</span>
                      <span className="text-neutral-500">→ callback (подпись) →</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Прокси</span>
                      <span className="text-neutral-500">→ POST (HMAC) →</span>
                      <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-400">Tilda</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* =================== TAB: Settings =================== */}
          <TabsContent value="settings">
            <Card className="border-neutral-800 bg-neutral-900/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Платёжный шлюз VTB Bank Kazakhstan</CardTitle>
                <CardDescription className="text-xs">Настройки подключения к шлюзу. Документация: sandbox.vtb-bank.kz</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField id="vtbUserName" label="VTB API Логин (userName)" hint="Выдаётся в Sandbox VTB KZ при регистрации">
                    <Input value={form.vtbUserName} onChange={(e) => setForm({ ...form, vtbUserName: e.target.value })} placeholder="test_user" className="bg-neutral-800 border-neutral-700 text-white" />
                  </FormField>
                  <FormField id="vtbPassword" label="VTB API Пароль (password)" hint="Выдаётся в Sandbox VTB KZ при регистрации">
                    <div className="flex gap-2">
                      <Input
                        type={showVtbPassword ? 'text' : 'password'}
                        value={form.vtbPassword}
                        onChange={(e) => setForm({ ...form, vtbPassword: e.target.value })}
                        placeholder="••••••••"
                        className="bg-neutral-800 border-neutral-700 text-white"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-xs text-neutral-400"
                        onClick={() => showSecretValue(form.vtbPassword, setShowVtbPassword, showVtbPassword)}
                        disabled={revealing}
                      >
                        {revealing && !showVtbPassword ? '...' : showVtbPassword ? 'Скрыть' : 'Показать'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 text-xs border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                        onClick={revealSecrets}
                        disabled={revealing}
                        title="Требует включения ALLOW_SECRET_READ=true на сервере"
                      >
                        {revealing ? '...' : 'Загрузить'}
                      </Button>
                    </div>
                  </FormField>

                  <SectionHeader title="Режим и шлюз" />
                  <FormField id="gatewayMode" label="Среда">
                    <Select value={form.isTestMode ? 'test' : 'prod'} onValueChange={(val) => {
                      const isTest = val === 'test';
                      setForm({
                        ...form, isTestMode: isTest,
                        gatewayUrl: isTest ? 'https://vtbkz.rbsuat.com/payment/rest' : 'https://3dsec.vtb-bank.kz/payment/rest',
                      });
                    }}>
                      <SelectTrigger className="bg-neutral-800 border-neutral-700 text-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="test">Тестовый (sandbox.vtb-bank.kz)</SelectItem>
                        <SelectItem value="prod">Продакшн (3dsec.vtb-bank.kz)</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>

                  <div className="sm:col-span-2">
                    <FormField id="gatewayUrl" label="URL шлюза (Gateway URL)" hint="По умолчанию меняется при переключении среды">
                      <Input value={form.gatewayUrl} onChange={(e) => setForm({ ...form, gatewayUrl: e.target.value })} className="bg-neutral-800 border-neutral-700 text-white text-xs font-mono" />
                    </FormField>
                  </div>

                  <SectionHeader title="Параметры платежа" />
                  <FormField id="currency" label="Валюта" hint="Код валюты ISO 4217. KZT=398 (тенге), RUB=643 (рубль)">
                    <Select value={form.currency} onValueChange={(val) => setForm({ ...form, currency: val })}>
                      <SelectTrigger className="bg-neutral-800 border-neutral-700 text-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="398">KZT (398) — Казахстанский тенге</SelectItem>
                        <SelectItem value="643">RUB (643) — Российский рубль</SelectItem>
                        <SelectItem value="840">USD (840) — Доллар США</SelectItem>
                        <SelectItem value="978">EUR (978) — Евро</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField id="language" label="Язык платёжной страницы">
                    <Select value={form.language} onValueChange={(val) => setForm({ ...form, language: val })}>
                      <SelectTrigger className="bg-neutral-800 border-neutral-700 text-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ru">Русский</SelectItem>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="kk">Қазақша</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>

                  <SectionHeader title="URL-адреса" />
                  <div className="sm:col-span-2">
                    <FormField id="tildaCallbackUrl" label="Tilda Notification URL" hint="URL для отправки уведомлений об оплате в Tilda. Укажите URL из настроек Универсальной платёжной системы в Tilda.">
                      <Input value={form.tildaCallbackUrl} onChange={(e) => setForm({ ...form, tildaCallbackUrl: e.target.value })} placeholder="https://forms.tildaapi.com/payment/custom/vtb24ru/" className="bg-neutral-800 border-neutral-700 text-white text-xs font-mono" />
                    </FormField>
                  </div>
                  <FormField id="successUrl" label="URL после успешной оплаты (returnUrl)" hint="Куда вернуть клиента после оплаты на странице VTB KZ">
                    <Input value={form.successUrl} onChange={(e) => setForm({ ...form, successUrl: e.target.value })} placeholder="https://yoursite.com/success" className="bg-neutral-800 border-neutral-700 text-white" />
                  </FormField>
                  <FormField id="failUrl" label="URL при ошибке">
                    <Input value={form.failUrl} onChange={(e) => setForm({ ...form, failUrl: e.target.value })} placeholder="https://yoursite.com/fail" className="bg-neutral-800 border-neutral-700 text-white" />
                  </FormField>
                </div>

                <Separator className="bg-neutral-800" />
                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[140px]">
                    {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Сохранить'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* =================== TAB: Logs =================== */}
          <TabsContent value="logs">
            <Card className="border-neutral-800 bg-neutral-900/50">
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <CardTitle className="text-base font-semibold">Логи входящих платежей и вебхуков</CardTitle>
                    <CardDescription className="text-xs">
                      Последние запросы Tilda, ошибки register.do и callback-данные VTB. Секреты в payload не показываются.
                    </CardDescription>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="border-neutral-700 text-neutral-300 hover:bg-neutral-800" onClick={fetchTransactions}>
                    Обновить
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {transactions.length === 0 ? (
                  <Alert className="border-neutral-700 bg-neutral-900 text-neutral-300">
                    <AlertTitle className="text-sm">Пока логов нет</AlertTitle>
                    <AlertDescription className="text-xs text-neutral-500">
                      Сделайте тестовый платёж в Tilda, затем нажмите «Обновить».
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-3">
                    {transactions.map((tx) => (
                      <Card key={tx.id} className="border-neutral-800 bg-neutral-950/60">
                        <CardHeader className="pb-3">
                          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <StatusBadge status={tx.status} />
                                <code className="text-xs text-neutral-300">{tx.orderNumber}</code>
                                {tx.formUrl ? (
                                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs">formUrl получен</Badge>
                                ) : (
                                  <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-400 text-xs">без formUrl</Badge>
                                )}
                              </div>
                              <p className="text-xs text-neutral-500">
                                {formatDate(tx.createdAt)} · {formatAmount(tx.amount, tx.currency)} · IP: {tx.ipAddress || '—'} · signature: {tx.signatureValid === null ? 'не проверялась' : tx.signatureValid ? 'OK' : 'FAIL'}
                              </p>
                            </div>
                            <code className="text-xs text-neutral-500 break-all">orderId: {tx.orderId}</code>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div>
                            <p className="text-xs font-semibold text-neutral-400 mb-1">Входящий запрос / ошибка</p>
                            <pre className="max-h-64 overflow-auto rounded-md border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300 whitespace-pre-wrap">
                              {prettyJson(tx.requestBody)}
                            </pre>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-neutral-400 mb-1">Callback от VTB</p>
                            <pre className="max-h-64 overflow-auto rounded-md border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300 whitespace-pre-wrap">
                              {prettyJson(tx.callbackData)}
                            </pre>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-800 mt-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between text-xs text-neutral-600">
          <span>VTB KZ ↔ Tilda Payment Proxy</span>
          <span>Документация: sandbox.vtb-bank.kz</span>
        </div>
      </footer>
    </div>
  );
}
