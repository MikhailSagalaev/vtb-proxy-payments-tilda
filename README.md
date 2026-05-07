# VTB KZ ↔ Tilda Payment Proxy Server

Прокси-сервер на Node.js (Next.js) для интеграции платёжного шлюза **VTB Bank Kazakhstan** с конструктором сайтов **Tilda**.

VTB KZ не имеет встроенного плагина для Tilda, поэтому этот сервер выступает мостом: он принимает платежи от Tilda, перенаправляет их в VTB KZ, а после оплаты отправляет уведомление обратно в Tilda.

---

## Архитектура

```
Tilda (клиент платит) 
  → POST /api/payment/create (HMAC подпись)
    → VTB KZ register.do (создание заказа)
      → возвращает formUrl (страница оплаты)
        → редирект клиента на страницу оплаты VTB KZ
          → клиент оплачивает
            → VTB KZ → POST /api/payment/callback (статус оплаты)
              → Прокси → POST в Tilda Notification URL (HMAC подпись)
                → Tilda помечает заказ как оплаченный
```

---

## Требования

- **Node.js** 18.17 или выше
- **npm** 9+ или **yarn** 1.22+
- Сервер с публичным HTTPS (обязательно для коллбэков)
- Аккаунт в **Sandbox VTB KZ**: https://sandbox.vtb-bank.kz
- Аккаунт **Tilda**: https://tilda.cc

---

## Быстрая установка

### 1. Разархивируйте проект

```bash
unzip vtb-kz-tilda-proxy.zip
cd vtb-kz-tilda-proxy
```

### 2. Установите зависимости

```bash
npm install
```

### 3. Настройте переменные окружения

```bash
cp .env.example .env
```

Отредактируйте `.env`:
```
# URL вашего сервера (без слеша на конце) — используется только на сервере
BASE_URL=https://payment.yourdomain.com
DATABASE_URL=file:./db/payment.db

# (Опционально, НЕ рекомендуется) Разрешить читать сохранённые секреты через API
# Используется только для кнопки "Загрузить" (показать сохранённый пароль) в админке.
# По умолчанию выключено.
ALLOW_SECRET_READ=false
```

### 4. Инициализируйте базу данных

```bash
npx prisma generate
npx prisma db push
```

### 5. Запустите сервер

```bash
npm run dev
```

Откройте `http://localhost:3000` — вы увидите панель управления прокси-сервером.

---

## Настройка (через веб-интерфейс)

### Вкладка «Безопасность» (сначала!)

1. Откройте `http://localhost:3000`
2. Перейдите на вкладку **Безопасность**
3. Нажмите **Сгенерировать секрет** рядом с Tilda Secret — скопируйте его
4. Нажмите **Сгенерировать ключ** рядом с Admin API Key — скопируйте его
5. Нажмите **Сохранить**

### Вкладка «Платёжный шлюз»

Заполните:

| Поле | Значение (тестовый режим) |
|------|--------------------------|
| VTB API Логин (userName) | `test_user` |
| VTB API Пароль (password) | `test_user_password` |
| Среда | Тестовый (sandbox) |
| Валюта | KZT (398) |
| Язык | Русский (ru) |

Нажмите **Сохранить**.

---

## Интеграция с Tilda (8 шагов)

### Шаг 1. Подготовьте секреты

На вкладке «Безопасность» сгенерируйте **Tilda Secret** — он понадобится при настройке шаблона в Tilda.

### Шаг 2. Создайте платёжную систему в Tilda

1. Откройте ваш сайт в Tilda
2. Перейдите: **Настройки сайта → Платёжные системы**
3. Нажмите **Универсальная платёжная система → Добавить новый шаблон**
4. В поле **API URL** вставьте:
   ```
   https://payment.yourdomain.com/api/payment/create
   ```

### Шаг 3. Расширенные настройки шаблона Tilda

В шаблоне нажмите **Расширенные настройки**:

**Список соответствия полей:**
- Номер заказа (payment_id) → `payment_id`
- Сумма платежа (payment_amount) → `payment_amount`
- Описание заказа (payment_subject) → `payment_subject`

**Подпись заказа:**
- Секрет для подписи → *вставьте ваш Tilda Secret из шага 1*
- Алгоритм: `MD5` или `HMAC`
- Сортировка: по алфавиту, исключить поле `signature`

**Показатель успешного платежа:**
- Поле: `payment_status`
- Значение: `success`

### Шаг 4. Скопируйте URL уведомлений из Tilda

После сохранения шаблона Tilda покажет **URL для уведомлений** (вида `https://forms.tildaapi.com/payment/custom/.../`). Скопируйте его.

### Шаг 5. Вставьте URL уведомлений в прокси

На вкладке «Платёжный шлюз» вставьте скопированный URL в поле **Tilda Notification URL**. Нажмите **Сохранить**.

### Шаг 6. Настройте Callback URL в VTB KZ

В личном кабинете VTB KZ (sandbox.vtb-bank.kz) укажите:
```
https://payment.yourdomain.com/api/payment/callback
```

### Шаг 7. Подключите к странице Tilda

На странице с формой заказа: выберите блок **Форма** → вкладка **Платёжные системы** → выберите ваш шаблон. Опубликуйте страницу.

### Шаг 8. Тестирование

Сделайте тестовый платёж. Данные тестовой карты VTB KZ:

| Параметр | Значение |
|----------|----------|
| Номер карты | 2201 3820 0000 0021 |
| CVC | 123 |
| Срок | 12/34 |
| 3DS-пароль | 12345678 |

Проверьте статус платежа на вкладке **Транзакции**.

---

## API Endpoints

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/` | Панель управления |
| POST | `/api/payment/create` | Создание платежа (принимает данные от Tilda) |
| POST | `/api/payment/callback` | Коллбэк от VTB KZ (статус оплаты) |
| GET | `/api/payment/status?orderId=...` | Проверка статуса заказа в VTB KZ |
| GET | `/api/settings` | Получение настроек |
| POST | `/api/settings` | Сохранение настроек (требует Admin API Key) |
| GET | `/api/transactions?key=...` | История транзакций (требует Admin API Key) |

### Авторизация

Для изменения настроек и просмотра транзакций необходим **Admin API Key**:
- Через заголовок: `Authorization: Bearer <ваш-ключ>` (рекомендуется)

> **Важно:** query-параметр `?key=` больше не поддерживается — ключ в URL попадает в логи сервера, историю браузера и Referer-заголовки.

---

## Безопасность

- **HMAC-SHA256** подписи для верификации запросов от Tilda
- **HMAC-SHA256** подписи для верификации коллбэков от VTB KZ
- **Admin API Key** для защиты панели настроек
- **Rate limiting** — ограничение запросов (30/мин для платежей, 100/мин для коллбэков)
- **Sanitization** — очистка входных данных от XSS
- **Timing-safe comparison** — защита от timing-атак на подписи

---

## Деплой на сервер

### Вариант 1: Node.js напрямую

```bash
npm run build
npm run start
```

Сервер запустится на порту 3000.

> Примечание: проект собирается в режиме `output: standalone`. Команда `npm run build` автоматически копирует `public/` и `._next/static` в папку `.next/standalone/`, чтобы ассеты (`/_next/static/*`) корректно раздавались в продакшене.

### Вариант 2: с Caddy (автоматический HTTPS)

В файле `Caddyfile` (включён в проект):
```
payment.yourdomain.com {
    reverse_proxy localhost:3000
}
```

Запустите:
```bash
caddy run
```

### Вариант 3: с Nginx

```nginx
server {
    listen 443 ssl;
    server_name payment.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Переход на продакшн

Когда VTB KZ одобрит ваш мерчант-аккаунт:

1. В панели прокси переключите **Среда** с «Тестовый» на «Продакшн»
2. URL шлюза автоматически сменится на `https://3dsec.vtb-bank.kz/payment/rest`
3. Замените логин и пароль на продакшн- credentials от VTB KZ
4. Нажмите **Сохранить**

---

## Структура проекта

```
vtb-kz-tilda-proxy/
├── .env.example              # Шаблон переменных окружения
├── .gitignore
├── Caddyfile                 # Конфиг Caddy для HTTPS
├── README.md                 # Этот файл
├── components.json           # Конфиг shadcn/ui
├── next.config.ts            # Настройки Next.js
├── package.json              # Зависимости
├── postcss.config.mjs        # PostCSS
├── tailwind.config.ts        # Tailwind CSS
├── tsconfig.json             # TypeScript
├── eslint.config.mjs         # ESLint
├── prisma/
│   └── schema.prisma         # Схема базы данных (SQLite)
├── public/
│   ├── logo.svg
│   └── robots.txt
└── src/
    ├── app/
    │   ├── globals.css       # Глобальные стили
    │   ├── layout.tsx        # Корневой layout
    │   ├── page.tsx          # Главная страница (панель управления)
    │   └── api/
    │       ├── payment/
    │       │   ├── create/route.ts    # Приём платежа от Tilda → VTB KZ
    │       │   ├── callback/route.ts  # Коллбэк VTB KZ → уведомление Tilda
    │       │   └── status/route.ts    # Проверка статуса заказа
    │       ├── settings/route.ts      # Настройки (GET/POST)
    │       └── transactions/route.ts  # История транзакций
    ├── components/ui/        # UI компоненты (shadcn/ui)
    ├── hooks/                # React хуки
    └── lib/
        ├── db.ts             # Подключение к Prisma (SQLite)
        ├── vtb.ts            # Логика VTB KZ API + Tilda notifications
        ├── security.ts       # HMAC подписи, rate limit, sanitization
        └── utils.ts          # Утилиты
```

---

## Решение проблем

**Ошибка 400 от VTB KZ:**
- Проверьте логин и пароль (test_user / test_user_password для sandbox)
- Убедитесь, что валюта соответствует вашему мерчант-аккаунту

**Не приходят уведомления в Tilda:**
- Проверьте, что Tilda Notification URL указан правильно
- Откройте логи сервера: ищите `Tilda notification FAILED`

**Подпись не проходит:**
- Убедитесь, что Tilda Secret в прокси совпадает с секретом в Tilda
- Проверьте алгоритм подписи в настройках Tilda (HMAC/MD5)

**Ошибка при npm install:**
- Убедитесь, что Node.js версии 18.17+
- Попробуйте `rm -rf node_modules && npm install`
