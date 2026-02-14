# Деплой STroova на чистую Ubuntu — пошаговая инструкция

Инструкция для **чистой Ubuntu** (например 22.04). Репозиторий: **https://github.com/oceangamestv/stroova**.

**Боевой сервер:** https://stroova.ru (подключение по SSH: `ssh root@stroova.ru`).

Выполняй блоки по порядку. Команды вставляй в терминал по одной (или блоком, где написано «можно скопировать всё сразу»). После каждой команды смотри вывод — если будет ошибка, остановись и перечитай шаг.

---

## Что понадобится перед началом

- Доступ по **SSH** к серверу: логин и пароль (или SSH-ключ).
- Адрес сервера: **stroova.ru** (сайт и SSH по домену).
- Имя пользователя для SSH (часто `root`).

---

## Часть 1. Подключение к серверу

### Шаг 1.1. Открой терминал на своём компьютере

- **Windows:** PowerShell или CMD.
- **Mac/Linux:** Terminal.

### Шаг 1.2. Подключись по SSH

Подключение по **IP** (DNS может не отвечать на ping):

```bash
ssh пользователь@stroova.ru
```

Пример: `ssh root@stroova.ru`

При первом подключении спросят про «authenticity of host» — введи **yes** и Enter.  
Дальше введи пароль (если используешь ключ — пароль может не спросить).

Когда увидишь приглашение вроде `root@сервер:~#` или `пользователь@сервер:~$` — ты **на сервере**. Все следующие команды выполняй уже **на сервере** в этом окне.

### Шаг 1.3. Узнать своё имя пользователя (пригодится позже)

Введи:

```bash
whoami
```

Нажми Enter. Появится одно слово — например `root` или `ubuntu`. **Запиши** это — подставишь в настройку Nginx (шаг 7).

---

## Часть 2. Установка программ

### Шаг 2.1. Обновить список пакетов

```bash
sudo apt update
```

Подожди окончания. Если попросят пароль — введи пароль пользователя на сервере.

### Шаг 2.2. Установить Git и Nginx

```bash
sudo apt install -y git nginx
```

Дождись «Done» или возврата приглашения.

### Шаг 2.3. Установить Node.js 20

Выполни **по очереди** две команды:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
```

Подожди. Потом:

```bash
sudo apt install -y nodejs
```

Проверь версии (необязательно, но полезно):

```bash
node -v
npm -v
```

Должны быть номера версий (например `v20.x.x` и `10.x.x`).

### Шаг 2.4. Установить PM2 (менеджер процессов для API)

```bash
sudo npm install -g pm2
```

PM2 будет запускать твой API в фоне и после перезагрузки сервера.

### Шаг 2.5. Установить PostgreSQL и создать базу

API хранит пользователей и сессии в PostgreSQL. Установи и настрой один раз:

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

Создай пользователя и базу (пароль замени на свой надёжный, не используй «mypassword» в проде):

```bash
sudo -u postgres psql -c "CREATE USER stroova WITH PASSWORD 'ТВОЙ_ПАРОЛЬ_БД';"
sudo -u postgres psql -c "CREATE DATABASE stroova OWNER stroova;"
```

Подставь тот же пароль в шаг 3.4 в переменную `DATABASE_URL`.

---

## Часть 3. Клонирование проекта и первая настройка

### Шаг 3.1. Перейти в домашнюю папку

```bash
cd ~
```

`~` — это домашняя папка пользователя (например `/root` или `/home/ubuntu`).

### Шаг 3.2. Клонировать репозиторий с GitHub

```bash
git clone https://github.com/oceangamestv/stroova.git
```

Должны появиться строки про «Cloning into 'stroova'…» и «done». Если репозиторий приватный — Git попросит логин/пароль или токен; для публичного репо запроса не будет.

### Шаг 3.3. Зайти в папку проекта

```bash
cd stroova
```

Приглашение может стать таким: `…~/stroova#` или `…~/stroova$`. Дальше все команды — из этой папки, пока не написано иное.

### Шаг 3.4. Создать файл .env

Если **nano** не установлен (`nano: command not found`), установи: `sudo apt install -y nano`. Либо создай файл через `vi .env` (i — ввод, Esc, затем `:wq` — сохранить и выйти).

```bash
nano .env
```

Откроется редактор. **Вставь** туда эти строки (в `DATABASE_URL` подставь **тот же пароль**, что задал при создании пользователя БД в шаге 2.5). Используй домен сайта (например `https://stroova.ru`). **TELEGRAM_BOT_TOKEN** — токен от @BotFather (если бот не нужен, строку можно не добавлять; тогда в PM2 будет запускаться только API).

```env
VITE_API_URL=https://stroova.ru/api
PORT=3000
CORS_ORIGIN=https://stroova.ru,https://www.stroova.ru,capacitor://localhost,http://localhost
DATABASE_URL=postgresql://stroova:ТВОЙ_ПАРОЛЬ_БД@localhost:5432/stroova
TELEGRAM_BOT_TOKEN=токен_от_BotFather
APP_URL=https://stroova.ru
```

Сохранить и выйти (nano): **Ctrl+O**, Enter, **Ctrl+X**.

Проверь, что файл есть:

```bash
cat .env
```

Должны быть строки VITE_API_URL, PORT, CORS_ORIGIN, DATABASE_URL и при необходимости TELEGRAM_BOT_TOKEN, APP_URL.

---

## Часть 4. Первая сборка и запуск API

### Шаг 4.1. Установить зависимости проекта

```bash
npm ci
```

Подожди, пока установятся пакеты. Ошибок быть не должно.

### Шаг 4.2. Собрать фронтенд

```bash
npm run build
```

В конце должно быть что-то вроде «built in … ms». Появится папка `dist` с готовыми файлами.

### Шаг 4.3. Запустить API и Telegram-бота через PM2 (с переменными из .env)

Выполни **одной строкой** (запустятся оба процесса из `ecosystem.config.cjs` — API и бот; если в .env нет TELEGRAM_BOT_TOKEN, бот упадёт при старте — тогда добавь токен в .env и выполни `pm2 restart stroova-telegram-bot`):

```bash
set -a && source .env && set +a && pm2 start ecosystem.config.cjs
```

Должны появиться сообщения о запуске «stroova-api» и «stroova-telegram-bot».  
Проверка:

```bash
pm2 list
```

В списке должны быть `stroova-api` и `stroova-telegram-bot` со статусом **online**. Логи бота: `pm2 logs stroova-telegram-bot` — при успехе будет «Telegram-бот запущен».

### Шаг 4.4. Сохранить список процессов PM2 и включить автозапуск после перезагрузки

```bash
pm2 save
```

Потом:

```bash
pm2 startup
```

В конце команда выведет **ещё одну команду** вида:

```bash
sudo env PATH=... PM2_HOME=... pm2 startup systemd -u пользователь --hp /home/пользователь
```

**Скопируй и выполни эту команду целиком** (она будет своей у тебя). После этого при перезагрузке сервера API и Telegram-бот будут подниматься сами.

### Шаг 4.5. Сделать скрипт деплоя исполняемым

```bash
chmod +x deploy.sh
```

Ошибок быть не должно. Этот скрипт потом будешь запускать для обновления после `git push`.

---

## Часть 5. Настройка Nginx (раздача сайта и проксирование API)

### Шаг 5.1. Создать конфиг сайта

```bash
sudo nano /etc/nginx/sites-available/stroova
```

Откроется пустой файл. **Вставь** этот блок (путь уже для пользователя **root**). Копируй только строки начиная с `server {` — в файле не должно быть слова `nginx` отдельной строкой в начале.

```text
server {
    listen 80;
    server_name stroova.ru www.stroova.ru;
    root /root/stroova/dist;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

У тебя пользователь **root**, поэтому путь к сайту: `/root/stroova/dist`. Копируй блок выше как есть. Если бы был другой пользователь (например `ubuntu`), путь был бы `/home/ubuntu/stroova/dist`.

Сохрани: **Ctrl+O**, Enter, **Ctrl+X**.

### Шаг 5.2. Включить сайт и проверить конфиг Nginx

Включить сайт (создать ссылку):

```bash
sudo ln -s /etc/nginx/sites-available/stroova /etc/nginx/sites-enabled/
```

Проверить, что конфиг без ошибок:

```bash
sudo nginx -t
```

Должно быть: «syntax is ok», «test is successful». Если «test failed» — вернись к шагу 5.1 и проверь путь `root` и скобки.

Перезагрузить Nginx:

```bash
sudo systemctl reload nginx
```

### Шаг 5.2.1. Права доступа к папке dist (если сайт в /root)

Nginx работает от пользователя `www-data` и по умолчанию не может читать каталог `/root/`. Если видишь 500 и в логе «Permission denied» — выполни:

```bash
chmod 755 /root
chmod 755 /root/stroova
chmod -R 755 /root/stroova/dist
sudo systemctl reload nginx
```

Проверка: `sudo -u www-data ls /root/stroova/dist` — должен показать файлы без ошибки.

### Шаг 5.3. Проверка по HTTP

Открой в браузере на своём компьютере:

```text
https://stroova.ru
```

Должна открыться страница приложения (логин/регистрация). Если «сайт недоступен» — проверь firewall (ниже есть подсказка).

---

## Часть 6. HTTPS (Let's Encrypt)

Чтобы сайт открывался по **https://** и браузер не ругался.

### Шаг 6.1. Установить Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### Шаг 6.2. Получить сертификат и настроить Nginx

```bash
sudo certbot --nginx -d stroova.ru -d www.stroova.ru
```

Сертификат уже выдан для stroova.ru и www.stroova.ru. Если добавишь другой домен — расширь: `sudo certbot --nginx -d stroova.ru -d www.stroova.ru -d другой-домен.ru`.

- Введи email (для уведомлений о продлении).
- Согласись с условиями (Y).
- Редирект с HTTP на HTTPS выбери **2 (Redirect)** — рекомендуемый вариант.

В конце должно быть «Congratulations» — сертификат установлен.

### Шаг 6.3. Проверка по HTTPS

Открой в браузере:

```text
https://stroova.ru
```

Должно открыться приложение с замочком в адресной строке.

---

## Часть 7. Если что-то не работает

### Сайт не открывается (connection refused / таймаут)

- У хостинга (Jino и т.п.) проверь **firewall**: должны быть открыты порты **80** (HTTP) и **443** (HTTPS). Иногда порт 22 (SSH) уже открыт, а 80/443 нужно включить в панели.
- На сервере проверь Nginx:
  ```bash
  sudo systemctl status nginx
  ```
  Должно быть **active (running)**.

### Открывается Nginx, но не приложение (404 или пустая страница)

- Проверь путь `root` в конфиге (шаг 5.1): он должен вести в папку **dist** внутри клонированного репо, и пользователь в пути должен совпадать с `whoami`.
- Убедись, что сборка была: `ls ~/stroova/dist` — там должны быть файлы (index.html и др.).

### Приложение открывается, но логин/API не работают

- Проверь, что API и при необходимости бот запущены: `pm2 list` — stroova-api (и stroova-telegram-bot) в статусе **online**.
- Проверь `.env`: в нём должны быть правильные `VITE_API_URL`, `CORS_ORIGIN` и **`DATABASE_URL`** (PostgreSQL). Без `DATABASE_URL` сервер не стартует.
- Логи API: `pm2 logs stroova-api` — при ошибке подключения к БД там будет сообщение вроде «Не задана переменная DATABASE_URL» или «connection refused».

---

## Дальше: как обновлять проект

1. На своём компьютере: вносишь изменения в код, потом:
   ```bash
   git add .
   git commit -m "описание изменений"
   git push
   ```
2. Подключаешься к серверу по SSH и выполняешь:
   ```bash
   cd ~/stroova
   ./deploy.sh
   ```
   Скрипт подтянет код, пересоберёт фронт и перезапустит API. Данные пользователей в `server/data.json` сохраняются.

---

## Краткий чек-лист (для себя)

- [ ] Подключился по SSH
- [ ] Установил: git, nginx, nodejs (20), pm2
- [ ] Клонировал репо, создал `.env`, выполнил `npm ci` и `npm run build`
- [ ] Запустил API и Telegram-бота через PM2 (`pm2 start ecosystem.config.cjs`), выполнил `pm2 save` и команду из `pm2 startup`
- [ ] Настроил Nginx (конфиг с правильным путём `root`), включил сайт, перезагрузил nginx
- [ ] Открыл сайт по http, потом поставил HTTPS через certbot
- [ ] Открыл https://stroova.ru и проверил приложение

После этого сервер настроен; для обновлений достаточно пушить в Git и на сервере запускать `./deploy.sh`.
