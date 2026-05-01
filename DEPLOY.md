# 🚀 DEPLOY.md — Инструкция по деплою

## Часть 1. Пуш на GitHub

### 1.1. Инициализируем репозиторий

```bash
git init
git add .
git commit -m "feat: initial release — VTB KZ ↔ Tilda Payment Proxy"
```

### 1.2. Создаём репозиторий на GitHub

**Вариант A — GitHub CLI:**
```bash
gh repo create vtb-proxy-payments-tilda --private --source=. --push
```

**Вариант B — вручную:**
1. Открыть https://github.com/new → Private, без README
2. Затем:
```bash
git remote add origin https://github.com/ВАШ_ЛОГИН/vtb-proxy-payments-tilda.git
git branch -M main
git push -u origin main
```

> ⚠️ `.env` и `db/*.db` в `.gitignore` — они **не** попадут в репозиторий.

---

## Часть 2. Деплой на сервер (Ubuntu 22.04+)

### 2.1. Требования

- Ubuntu 22.04+ или Debian 12
- 1 GB RAM минимум
- Публичный домен с DNS → ваш IP (для HTTPS)

### 2.2. Установка зависимостей на сервере

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# PM2 — менеджер процессов
npm install -g pm2

# Caddy — автоматический HTTPS
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install caddy -y
```

### 2.3. Клонирование и настройка

```bash
# Создаём пользователя (не запускать под root)
useradd -m -s /bin/bash vtbproxy
su - vtbproxy

# Клонируем
git clone https://github.com/ВАШ_ЛОГИН/vtb-proxy-payments-tilda.git ~/app
cd ~/app

# Создаём папку для БД (вне папки приложения — не сбросится при deploy)
mkdir -p ~/data

# Настраиваем переменные окружения
cp .env.example .env
nano .env
```

Содержимое `.env` на сервере:
```env
BASE_URL=https://payment.yourdomain.com
DATABASE_URL=file:/home/vtbproxy/data/payment.db
```

### 2.4. Сборка и запуск

```bash
npm install --production=false
npm run setup    # инициализация БД
npm run build    # сборка

# Запуск через PM2
pm2 start npm --name vtb-proxy -- start
pm2 save

# Автозапуск при перезагрузке (выполнить как root):
pm2 startup systemd -u vtbproxy --hp /home/vtbproxy
# → скопировать и выполнить команду которую выведет PM2
```

### 2.5. Настройка Caddy (HTTPS)

Файл `/etc/caddy/Caddyfile`:
```
payment.yourdomain.com {
    reverse_proxy localhost:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

```bash
systemctl restart caddy
```

Caddy сам получит SSL-сертификат от Let's Encrypt.

---

## Часть 3. Обновление кода (повторный deploy)

```bash
su - vtbproxy && cd ~/app
git pull origin main
npm install --production=false
npm run build
npm run db:push      # только если изменилась схема prisma
pm2 reload vtb-proxy
```

---

## Часть 4. Первая настройка через веб-панель

Открываем `https://payment.yourdomain.com`:

1. **Вкладка «Безопасность»** (ПЕРВЫМ ДЕЛОМ):
   - Сгенерировать **Admin API Key** → сохранить
   - Сгенерировать **Tilda Secret** → сохранить (вставить в Tilda)
   - Нажать «Сохранить»

2. **Вкладка «Платёжный шлюз»**:
   - Логин: `test_user`, пароль: `test_user_password` (для sandbox)
   - Среда: Тестовый
   - Валюта: KZT (398)
   - Tilda Notification URL: вставить URL из настроек Tilda (шаг 5 инструкции во вкладке «Интеграция»)
   - Нажать «Сохранить»

3. **Вкладка «Интеграция»** — следовать 8-шаговой инструкции

---

## Часть 5. Чеклист перед запуском в бою

- [ ] `BASE_URL` → ваш реальный домен с HTTPS
- [ ] Admin API Key сгенерирован, Tilda Secret совпадает с Tilda
- [ ] Tilda Notification URL заполнен
- [ ] Callback URL указан в личном кабинете VTB KZ
- [ ] Тестовый платёж прошёл и виден во вкладке «Транзакции»
- [ ] PM2 `startup` настроен
- [ ] Caddy/Nginx работает, HTTPS активен
- [ ] При переходе в продакшн — замена логина/пароля VTB KZ на боевые

---

## Полезные команды

```bash
pm2 logs vtb-proxy --lines 50    # логи
pm2 monit                         # мониторинг
pm2 restart vtb-proxy             # перезапуск
pm2 stop vtb-proxy                # остановка
systemctl status caddy            # статус reverse proxy
```
