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
  ipAddress: string | null;
  signatureValid: boolean | null;
  createdAt: string;
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

// ==============================
// Main Page
// ==============================

export default function Home() {
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [adminKey, setAdminKey] = useState('');
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [showAdminKey, setShowAdminKey] = useState(false);
  const [showGeneratedKey, setShowGeneratedKey] = useState(false);
  const [showGeneratedSecret, setShowGeneratedSecret] = useState(false);
  const [showVtbPassword, setShowVtbPassword] = useState(false);

  const [form, setForm] = useState({
    vtbUserName: '', vtbPassword: '', gatewayUrl: '', currency: '398', language: 'ru',
    tildaCallbackUrl: '', tildaSecret: '', webhookSecret: '', adminApiKey: '',
    successUrl: '', failUrl: '', isTestMode: true,
  });

  // Restore admin key from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('vtb_admin_key');
    if (saved) {
      setAdminKey(saved);
    }
  }, []);

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
      const res = await fetch('/api/settings');
      const data = await res.json();
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
    } catch (err) {
      console.error('Failed to fetch config:', err);
    }
  }, []);

  const revealSecrets = useCallback(async () => {
    if (!adminKey || !isValidHeaderValue(adminKey)) {
      showMessage('error', 'Введите корректный Admin API Key');
      return;
    }
    setRevealing(true);
    try {
      const res = await fetch('/api/settings/secrets', {
        headers: { 'Authorization': `Bearer ${adminKey}` },
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
      }));
      setShowVtbPassword(true);
      showMessage('success', 'Секреты загружены (показ включен локально в браузере)');
    } catch {
      showMessage('error', 'Не удалось получить секреты');
    } finally {
      setRevealing(false);
    }
  }, [adminKey]);

  const fetchTransactions = useCallback(async () => {
    try {
      if (!adminKey || !isValidHeaderValue(adminKey)) return;
      const res = await fetch('/api/transactions', {
        headers: { 'Authorization': `Bearer ${adminKey}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTransactions(data);
      }
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
    }
  }, [adminKey]);

  useEffect(() => {
    fetchConfig().finally(() => setLoading(false));
  }, [fetchConfig]);

  useEffect(() => {
    if (adminAuthenticated) fetchTransactions();
  }, [adminAuthenticated, fetchTransactions]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (!adminKey) {
        showMessage('error', 'Введите Admin API Key для сохранения настроек');
        setSaving(false);
        return;
      }
      if (!isValidHeaderValue(adminKey)) {
        showMessage('error', 'Admin API Key должен содержать только латинские символы, цифры и спецсимволы (без кириллицы)');
        setSaving(false);
        return;
      }
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminKey}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        setConfig(data.config);
        setAdminAuthenticated(true);
        localStorage.setItem('vtb_admin_key', adminKey);
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
        {!adminAuthenticated && (
          <Card className="border-neutral-800 bg-neutral-900/50">
            <CardContent className="pt-6">
              <div className="flex flex-col sm:flex-row gap-3 items-end">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-sm">Admin API Key</Label>
                  <p className="text-xs text-neutral-500">Введите ваш ключ (при первом запуске — создайте на вкладке &quot;Безопасность&quot;)</p>
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
            <TabsTrigger value="security" className="text-xs data-[state=active]:bg-neutral-800 data-[state=active]:text-white data-[state=active]:shadow-sm px-3 py-2">
              Безопасность
            </TabsTrigger>
            <TabsTrigger value="transactions" className="text-xs data-[state=active]:bg-neutral-800 data-[state=active]:text-white data-[state=active]:shadow-sm px-3 py-2">
              Транзакции
            </TabsTrigger>
            <TabsTrigger value="test" className="text-xs data-[state=active]:bg-neutral-800 data-[state=active]:text-white data-[state=active]:shadow-sm px-3 py-2">
              Тест
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
                    Перед подключением обязательно задайте Admin API Key и Tilda Secret на вкладке &quot;Безопасность&quot;.
                    Без этого любой сможет изменить ваши настройки.
                  </AlertDescription>
                </Alert>
              )}

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
                        <p className="text-xs text-neutral-400 leading-relaxed">Перейдите на вкладку «Безопасность» в этом интерфейсе. Нажмите «Сгенерировать секрет» рядом с Tilda Secret — скопируйте его, он понадобится в шаге 3. Также сгенерируйте Admin API Key.</p>
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
                        onClick={() => setShowVtbPassword(!showVtbPassword)}
                      >
                        {showVtbPassword ? 'Скрыть' : 'Показать'}
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

          {/* =================== TAB: Security =================== */}
          <TabsContent value="security">
            <div className="space-y-4">
              <Alert className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                <AlertTitle className="text-sm font-semibold">Зачем это нужно?</AlertTitle>
                <AlertDescription className="text-xs text-emerald-400">
                  HMAC-подписи защищают от подделки платежей. Admin API Key защищает панель настроек.
                  Без этих настроек любой может отправить фейковые коллбэки или изменить конфигурацию сервера.
                </AlertDescription>
              </Alert>

              <Card className="border-neutral-800 bg-neutral-900/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Защита настроек</CardTitle>
                  <CardDescription className="text-xs">API ключ для доступа к изменению настроек и просмотру транзакций</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField id="adminApiKey" label="Admin API Key" hint="Используется для авторизации при сохранении настроек. Передаётся через заголовок Authorization: Bearer <key>">
                    <div className="flex gap-2">
                      <Input type={showGeneratedKey ? 'text' : 'password'} value={form.adminApiKey} onChange={(e) => setForm({ ...form, adminApiKey: e.target.value })} placeholder="Сгенерируйте случайный ключ..." className="bg-neutral-800 border-neutral-700 text-white font-mono text-xs" />
                      <Button variant="ghost" size="sm" className="shrink-0 text-xs text-neutral-400" onClick={() => setShowGeneratedKey(!showGeneratedKey)}>
                        {showGeneratedKey ? 'Скрыть' : 'Показать'}
                      </Button>
                    </div>
                  </FormField>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                      onClick={() => {
                        const key = generateRandomHex(48);
                        setForm({ ...form, adminApiKey: key });
                        setAdminKey(key);
                        setShowGeneratedKey(true);
                        navigator.clipboard.writeText(key);
                        showMessage('info', 'Ключ сгенерирован и скопирован в буфер. Нажмите Сохранить!');
                      }}
                    >
                      Сгенерировать новый ключ
                    </Button>
                    {form.adminApiKey && <CopyButton text={form.adminApiKey} variant="small" />}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-neutral-800 bg-neutral-900/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">HMAC-подписи</CardTitle>
                  <CardDescription className="text-xs">Подписи обеспечивают целостность данных между Tilda, прокси и VTB KZ</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField id="tildaSecret" label="Tilda Secret (секрет для подписи заказа)" hint="Этот же секрет укажите в Tilda в расширенных настройках шаблона. Используется для HMAC-SHA256 подписи запросов от Tilda и коллбэков к Tilda.">
                    <div className="flex gap-2">
                      <Input type={showGeneratedSecret ? 'text' : 'password'} value={form.tildaSecret} onChange={(e) => setForm({ ...form, tildaSecret: e.target.value })} placeholder="Секрет из настроек Tilda..." className="bg-neutral-800 border-neutral-700 text-white font-mono text-xs" />
                      <Button variant="ghost" size="sm" className="shrink-0 text-xs text-neutral-400" onClick={() => setShowGeneratedSecret(!showGeneratedSecret)}>
                        {showGeneratedSecret ? 'Скрыть' : 'Показать'}
                      </Button>
                    </div>
                  </FormField>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                      onClick={() => {
                        const secret = generateRandomHex(64);
                        setForm({ ...form, tildaSecret: secret });
                        setShowGeneratedSecret(true);
                        navigator.clipboard.writeText(secret);
                        showMessage('info', 'Tilda Secret сгенерирован и скопирован. Вставьте его в настройки Tilda.');
                      }}
                    >
                      Сгенерировать секрет
                    </Button>
                    {form.tildaSecret && <CopyButton text={form.tildaSecret} variant="small" />}
                  </div>
                  <Separator className="bg-neutral-800" />
                  <FormField id="webhookSecret" label="VTB KZ Webhook Secret" hint="Секрет для верификации коллбэков от VTB KZ. Настройте его в личном кабинете VTB KZ как дополнительный заголовок X-Signature в коллбэках.">
                    <Input type="password" value={form.webhookSecret} onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })} placeholder="Секрет для верификации от VTB KZ..." className="bg-neutral-800 border-neutral-700 text-white font-mono text-xs" />
                  </FormField>
                </CardContent>
              </Card>

              <Card className="border-neutral-800 bg-neutral-900/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Статус безопасности</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {[
                      { label: 'Admin API Key', ok: !!config?.adminApiKey && config.adminApiKey !== '••••••••', desc: 'Защищает настройки от несанкционированного изменения' },
                      { label: 'Tilda HMAC Secret', ok: !!config?.tildaSecret, desc: 'Верифицирует подписи запросов от Tilda' },
                      { label: 'Webhook Secret', ok: !!config?.webhookSecret, desc: 'Верифицирует подписи коллбэков от VTB KZ' },
                      { label: 'Rate Limiting', ok: true, desc: 'Защита от DDoS (30 req/min на endpoint)' },
                      { label: 'Input Sanitization', ok: true, desc: 'Очистка и валидация входных данных' },
                      { label: 'Timing-Safe Comparison', ok: true, desc: 'Защита от timing-атак на подписи' },
                    ].map(({ label, ok, desc }) => (
                      <div key={label} className="flex items-start gap-3">
                        <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        <div>
                          <p className="text-sm font-medium">{label}</p>
                          <p className="text-xs text-neutral-500">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* =================== TAB: Transactions =================== */}
          <TabsContent value="transactions">
            <Card className="border-neutral-800 bg-neutral-900/50">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">Транзакции</CardTitle>
                    <CardDescription className="text-xs">{transactions.length} записей</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={fetchTransactions} className="border-neutral-700 text-neutral-300 hover:bg-neutral-800 text-xs">
                    Обновить
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {transactions.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-neutral-500 text-sm">Транзакций пока нет</p>
                    <p className="text-neutral-600 text-xs mt-1">После первого платежа через Tilda здесь появится запись</p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-neutral-700 overflow-hidden">
                    <div className="max-h-[500px] overflow-x-auto overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-neutral-800/50 hover:bg-neutral-800/50">
                            <TableHead className="text-xs font-semibold text-neutral-400 h-9">Дата</TableHead>
                            <TableHead className="text-xs font-semibold text-neutral-400 h-9">Заказ</TableHead>
                            <TableHead className="text-xs font-semibold text-neutral-400 h-9">Сумма</TableHead>
                            <TableHead className="text-xs font-semibold text-neutral-400 h-9">Статус</TableHead>
                            <TableHead className="text-xs font-semibold text-neutral-400 h-9 hidden lg:table-cell">Подпись</TableHead>
                            <TableHead className="text-xs font-semibold text-neutral-400 h-9 hidden xl:table-cell">IP</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {transactions.map((tx) => (
                            <TableRow key={tx.id} className="border-neutral-800 hover:bg-neutral-800/30">
                              <TableCell className="text-xs text-neutral-400 whitespace-nowrap py-2">{formatDate(tx.createdAt)}</TableCell>
                              <TableCell className="text-xs font-mono text-neutral-300 whitespace-nowrap py-2">{tx.orderNumber}</TableCell>
                              <TableCell className="text-xs font-semibold text-white whitespace-nowrap py-2">{formatAmount(tx.amount, tx.currency)}</TableCell>
                              <TableCell className="py-2"><StatusBadge status={tx.status} /></TableCell>
                              <TableCell className="text-xs hidden lg:table-cell py-2">
                                {tx.signatureValid === true && <span className="text-emerald-400">✓</span>}
                                {tx.signatureValid === false && <span className="text-red-400">✗</span>}
                                {tx.signatureValid === null && <span className="text-neutral-600">—</span>}
                              </TableCell>
                              <TableCell className="text-xs text-neutral-500 hidden xl:table-cell py-2">{tx.ipAddress || '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* =================== TAB: Test =================== */}
          <TabsContent value="test">
            <div className="space-y-4">
              <Card className="border-neutral-800 bg-neutral-900/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Текущая конфигурация</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 text-sm">
                    <div className="flex justify-between"><span className="text-neutral-500">Среда:</span><span className={config?.isTestMode ? 'text-amber-400' : 'text-emerald-400'}>{config?.isTestMode ? 'Тестовый' : 'Продакшн'}</span></div>
                    <div className="flex justify-between"><span className="text-neutral-500">Валюта:</span><span className="text-white">{config?.currency === '398' ? 'KZT' : config?.currency === '643' ? 'RUB' : config?.currency}</span></div>
                    <div className="flex justify-between sm:col-span-2"><span className="text-neutral-500">Шлюз:</span><code className="text-xs text-neutral-300 break-all">{config?.gatewayUrl}</code></div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-neutral-800 bg-neutral-900/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Тестовые карты VTB KZ</CardTitle>
                  <CardDescription className="text-xs">Данные из sandbox.vtb-bank.kz/ru/integration/structure/test-cards.html</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-neutral-700 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="text-sm font-medium">Успешная оплата</span>
                      </div>
                      <div className="space-y-1.5 text-xs font-mono">
                        <div className="flex justify-between"><span className="text-neutral-500">Карта:</span><span className="text-neutral-200">2201 3820 0000 0021</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">CVC:</span><span className="text-neutral-200">123</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Срок:</span><span className="text-neutral-200">12/34</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">3DS:</span><span className="text-neutral-200">пароль 123456</span></div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-neutral-700 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-500" />
                        <span className="text-sm font-medium">Отказ (неверный CVC)</span>
                      </div>
                      <div className="space-y-1.5 text-xs font-mono">
                        <div className="flex justify-between"><span className="text-neutral-500">Карта:</span><span className="text-neutral-200">2201 3820 0000 0021</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">CVC:</span><span className="text-neutral-200">000</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Результат:</span><span className="text-red-400">Decline (71015)</span></div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-neutral-800 bg-neutral-900/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">API Endpoints</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg border border-neutral-700 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-neutral-800/50 hover:bg-neutral-800/50">
                          <TableHead className="text-xs font-semibold text-neutral-400 h-9">Метод</TableHead>
                          <TableHead className="text-xs font-semibold text-neutral-400 h-9">Endpoint</TableHead>
                          <TableHead className="text-xs font-semibold text-neutral-400 h-9">Описание</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[
                          { method: 'POST', path: '/api/payment/create', desc: 'Создание платежа (от Tilda, публичный)', color: 'bg-emerald-500/20 text-emerald-400' },
                          { method: 'POST', path: '/api/payment/callback', desc: 'Коллбэк от VTB KZ (публичный, верифицируется)', color: 'bg-amber-500/20 text-amber-400' },
                          { method: 'GET', path: '/api/payment/status', desc: 'Проверка статуса (требует Admin Key)', color: 'bg-sky-500/20 text-sky-400' },
                          { method: 'GET', path: '/api/settings', desc: 'Чтение настроек (публичный, пароли скрыты)', color: 'bg-neutral-500/20 text-neutral-400' },
                          { method: 'POST', path: '/api/settings', desc: 'Изменение настроек (требует Admin Key)', color: 'bg-red-500/20 text-red-400' },
                          { method: 'GET', path: '/api/transactions', desc: 'История транзакций (требует Admin Key)', color: 'bg-red-500/20 text-red-400' },
                        ].map(({ method, path, desc, color }) => (
                          <TableRow key={`${method}-${path}`} className="border-neutral-800 hover:bg-neutral-800/30">
                            <TableCell className="py-2"><span className={`px-1.5 py-0.5 rounded text-xs font-mono ${color}`}>{method}</span></TableCell>
                            <TableCell className="text-xs font-mono text-neutral-300 py-2">{path}</TableCell>
                            <TableCell className="text-xs text-neutral-400 py-2">{desc}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
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
