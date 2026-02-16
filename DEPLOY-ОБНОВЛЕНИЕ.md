# Заливка обновления на сервер

Сервер настроен по инструкции **[DEPLOY-УБУНТУ-ПОШАГОВО.md](DEPLOY-УБУНТУ-ПОШАГОВО.md)**. Если понадобится заново поднять сервер с нуля — используй тот же документ.

**Боевой сервер:** https://stroova.ru (подключение по SSH: `ssh root@stroova.ru`).

Данные хранятся в **PostgreSQL** (не в `server/data.json`). При обновлении БД не пересоздаётся, только подтягивается код, пересобирается фронт и перезапускается API.

---

## Полный сброс и развёртывание текущей версии с нуля

Этот раздел нужен, если после обычного деплоя на сайте всё ещё открывается **старая** версия. Выполни шаги ниже один раз на сервере — после этого будет работать текущая версия (React/Vite, API с PostgreSQL). Дальше можно пользоваться обычными шагами 1–2 (push и `./deploy.sh`).

Все команды ниже выполняются **на сервере по SSH**. Для пользователя root каталог проекта — `/root/stroova`, для других — `~/stroova` (в примерах ниже `~/stroova`, при необходимости замени на `/root/stroova`).

### Шаг A. Подключиться к серверу и зайти в каталог проекта

```bash
ssh root@stroova.ru
cd ~/stroova
```

### Шаг B. Остановить и удалить старое приложение из PM2

Чтобы старый процесс точно не мешал:

```bash
pm2 stop stroova-api
pm2 delete stroova-api
```

Если команда пишет «process not found» — ничего страшного, переходим дальше.

### Шаг C. Взять с репозитория последний код

Принудительно подтянуть ветку `main` (все локальные изменения на сервере будут перезаписаны):

```bash
git fetch origin
git checkout main
git reset --hard origin/main
```

После этого на сервере будет ровно тот код, что в `origin/main`.

### Шаг D. Проверить файл .env

Должны быть все переменные (подставь свой пароль БД вместо `ТВОЙ_ПАРОЛЬ_БД`). **CORS_ORIGIN** — через запятую: сначала URL сайта, затем origin мобильного приложения (Capacitor). Для Telegram-бота нужны **TELEGRAM_BOT_TOKEN** (токен от @BotFather) и при необходимости **APP_URL** (URL сайта для кнопки Mini App):

```
VITE_API_URL=https://stroova.ru/api
PORT=3000
CORS_ORIGIN=https://stroova.ru,https://www.stroova.ru,capacitor://localhost,http://localhost
DATABASE_URL=postgresql://stroova:ТВОЙ_ПАРОЛЬ_БД@localhost:5432/stroova
TELEGRAM_BOT_TOKEN=токен_от_BotFather
APP_URL=https://stroova.ru
```

Без `https://stroova.ru` в CORS_ORIGIN браузер при запросах с https://stroova.ru получит «blocked by CORS policy». Проверка: `cat .env`. Редактирование: `nano .env` (если nano нет — `sudo apt install -y nano` или `vi .env`). **Важно:** PM2 не перечитывает `.env` при обычном `pm2 restart` — переменные берутся из окружения на момент старта. После правки .env перезапусти с подгрузкой файла: `cd ~/stroova && set -a && source .env && set +a && pm2 restart stroova-api stroova-telegram-bot --update-env` и `pm2 save`.

### Шаг E. Установить зависимости и собрать фронт заново

Это пересоберёт папку `dist/` из текущего кода (Vite/React). На сервере генерация аудио не используется, поэтому зависимости ставим с `--ignore-scripts` (без долгого postinstall пакета onnxruntime-node):

```bash
npm ci --ignore-scripts
npm run build
```

Дождись окончания без ошибок. После этого в `dist/` лежит актуальный фронт.

### Шаг F. Запустить API и Telegram-бота через PM2

Оба процесса подхватывают переменные из `.env` (API — DATABASE_URL и др., бот — TELEGRAM_BOT_TOKEN, APP_URL):

```bash
set -a && source .env && set +a && pm2 start ecosystem.config.cjs
```

Проверка: `pm2 list` — в списке должны быть **stroova-api** и **stroova-telegram-bot** в статусе **online**. Логи API: `pm2 logs stroova-api`; логи бота: `pm2 logs stroova-telegram-bot`. В логах API при успешном старте — «STroova API», «DB: PostgreSQL»; в логах бота — «Telegram-бот запущен».

### Шаг G. Сохранить список процессов PM2

```bash
pm2 save
```

### Шаг H. Проверить сайт

Открой в браузере https://stroova.ru. Должна открыться текущая версия приложения (логин, словарь, упражнения). Если видишь старый интерфейс — очисти кэш браузера (Ctrl+Shift+R или «Жёсткое обновление») или открой в режиме инкогнито.

**Если Nginx отдаёт не ту папку:** проверь конфиг Nginx (`root` должен указывать на каталог `dist` внутри проекта, например `/root/stroova/dist`). Путь из DEPLOY-УБУНТУ-ПОШАГОВО: в конфиге сайта строка `root /root/stroova/dist;` (или `/home/пользователь/stroova/dist`). После изменений: `sudo nginx -t` и `sudo systemctl reload nginx`.

---

## Инструкция для будущих обновлений

Используй эти шаги каждый раз, когда нужно выкатить новую версию на боевой сервер.

### 1. На своём компьютере (в Cursor или PowerShell)

Перейди в папку проекта и отправь изменения на GitHub:

```bash
cd d:\Cursor
git add .
git commit -m "описание изменений"
git push
```

(Команда именно **git**, не it. Описание в кавычках можно менять.)

### 2. На сервере (подключись по SSH)

**Обязательно перейди в каталог проекта.** Все команды `npm` и `./deploy.sh` должны выполняться из этой папки. Если запускать их из `/root/`, будет ошибка вроде `ENOENT: no such file or directory, open '/root/package.json'` или `npm ci ... only install with an existing package-lock.json`.

```bash
cd ~/stroova
```

(Для пользователя root это то же самое, что `cd /root/stroova`. Проверка: после `cd` выполни `pwd` — должно быть что-то вроде `/root/stroova`; и `ls package.json` — файл должен находиться.)

**Сначала обязательно подтяни код** — без `git pull` на сервере остаётся старый код, и визуально ничего не изменится:

```bash
git pull
```

**Если появилась ошибка** вроде:
`error: Your local changes to the following files would be overwritten by merge: ... Please commit your changes or stash them before you merge.`

Значит на сервере изменён файл (часто `node_modules/.package-lock.json` или `deploy.sh`). Отмени это изменение и снова выполни pull:

```bash
git checkout -- node_modules/.package-lock.json
git checkout -- deploy.sh
git pull
```

(Если в сообщении указан другой файл — добавь его в `git checkout -- …` или один раз `git stash` и затем `git pull`.)

Установи зависимости и пересобери фронт, перезапусти API:

```bash
npm ci --ignore-scripts
npm run build
pm2 restart stroova-api
```

Либо вместо трёх команд выше можно один раз выполнить скрипт деплоя (он сделает то же самое, включая `git pull`, `npm ci` и перезапуск обоих процессов PM2 — **stroova-api** и **stroova-telegram-bot**):

```bash
./deploy.sh
```

Но если перед этим `git pull` падал с ошибкой — сначала выполни `git checkout -- ...` и `git pull` вручную, как выше, затем уже `./deploy.sh` или вручную `npm ci --ignore-scripts`, `npm run build`, `pm2 restart stroova-api`.

**Если `npm ci` пишет**, что нужен `package-lock.json`, или `npm run build` — что не найден `package.json`: ты не в каталоге проекта. Выполни `cd ~/stroova` (или `cd /root/stroova`), затем снова `git pull` и команды выше. В репозитории есть `package-lock.json`, он появится на сервере после `git pull`, если ты в папке `stroova`.

### 3. Озвучка словаря (аудио)

Папка `public/audio/` не хранится в Git (чтобы не раздувать репозиторий). Озвучку на сервер нужно заливать отдельно по **FTP** (или SCP/rsync).

- **Куда загружать:** в каталог проекта на сервере — `public/audio/` (например `~/stroova/public/audio/`).
- **Структура:** внутри должны быть папки `female/` и `male/` с WAV-файлами (имена — по английским словам, например `hello.wav`, `ice_cream.wav`). То есть у тебя локально: `public/audio/female/`, `public/audio/male/` — залей их содержимое в такие же папки на сервере.
- **Когда:** один раз после первой настройки сервера и потом только когда обновляешь набор озвучки (заливаешь новые или изменённые WAV). После загрузки аудио пересобери фронт на сервере, чтобы файлы попали в `dist/`: `npm run build` (или `./deploy.sh`).

Если аудио не загружать, сайт будет работать, но кнопки озвучки слов не будут воспроизводить звук.

### 4. Проверка

Открой сайт в браузере и убедись, что всё работает. Логи API: `pm2 logs stroova-api` (выход — Ctrl+C).

**CORS для мобильного приложения:** в логах при старте API должны быть строки:
- `CORS_ORIGIN: https://stroova.ru,...`
- `CORS origins (4): ...` (число = сколько origin в списке). Если видишь только один origin — в `.env` поправь `CORS_ORIGIN` (несколько адресов через запятую). **Важно:** после изменения `.env` одного `pm2 restart` мало — окружение не перечитывается. Нужно перезапустить с загрузкой .env: `pm2 stop stroova-api && pm2 delete stroova-api`, затем `set -a && source .env && set +a && pm2 start server/index.js --name stroova-api` и `pm2 save`.

**CORS при доступе по домену (stroova.ru):** если сайт открыт по `https://stroova.ru`, а в консоли браузера ошибка «blocked by CORS policy» или «No 'Access-Control-Allow-Origin' header» — сделай два шага. (1) В `.env` в **CORS_ORIGIN** должен быть домен: `CORS_ORIGIN=https://stroova.ru,https://www.stroova.ru,capacitor://localhost,http://localhost`. Перезапусти API с загрузкой .env: `pm2 stop stroova-api && pm2 delete stroova-api`, затем `set -a && source .env && set +a && pm2 start server/index.js --name stroova-api` и `pm2 save`. (2) **Nginx:** preflight (OPTIONS) должен получать CORS-заголовки. В конфиге сайта (и для **HTTP**, и для **HTTPS** — оба блока `server`) нужен один и тот же `location /api` с обработкой OPTIONS. Пример полного блока — в `docs/nginx-stroova.conf.example`. В начале файла добавь `map $http_origin $api_cors_origin { ... }` (список origin как в примере), в `location /api` — блок `if ($request_method = OPTIONS) { add_header Access-Control-Allow-Origin $api_cors_origin; ... return 204; }` и `proxy_pass` на порт 3000. Проверка: `sudo nginx -t`, затем `sudo systemctl reload nginx`.

**Озвучка слов в мобильном приложении:** приложение грузит WAV с сайта (`https://ваш-домен/audio/...`). Nginx по умолчанию не отдаёт CORS для статики, из‑за этого WebView блокирует загрузку. В конфиг Nginx (например `/etc/nginx/sites-available/stroova`) добавь блок **до** `location /`: `location /audio/ { add_header Access-Control-Allow-Origin *; }`. Затем `sudo nginx -t` и `sudo systemctl reload nginx`. Подробнее — в `docs/ANDROID-APK.md`.

**Шпаргалка — команды по порядку:**

| Где | Команды |
|-----|--------|
| Компьютер | `cd d:\Cursor` → `git add .` → `git commit -m "описание"` → `git push` |
| Сервер | `cd ~/stroova` → `git pull` (при конфликте: `git checkout -- node_modules/.package-lock.json` и снова `git pull`) → `./deploy.sh` (миграции, сборка, перезапуск PM2) |

---

## Шаги заливки обновления (подробно)

### 1. Локально: push в репозиторий

```bash
git add .
git commit -m "описание изменений"
git push
```

### 2. На сервере: выполнить скрипт деплоя

Подключись по SSH и выполни:

```bash
cd ~/stroova
./deploy.sh
```

Скрипт [deploy.sh](deploy.sh) делает по порядку: `git pull` → **миграции БД** ([scripts/run-migrations.sh](scripts/run-migrations.sh)) → `npm ci --ignore-scripts` → `npm run build` → `pm2 startOrReload` → `pm2 save`.

**Если `./deploy.sh` не срабатывает из‑за конфликта при pull** (см. раздел «Инструкция для будущих обновлений» выше): сначала на сервере выполни `git checkout -- node_modules/.package-lock.json` и `git pull`, затем снова `./deploy.sh`.

(Если проект клонирован не в домашнюю папку, перейди в каталог проекта — например для пользователя root это `/root/stroova`.)

### 3. Миграции БД

При каждом запуске `./deploy.sh` автоматически выполняется [scripts/run-migrations.sh](scripts/run-migrations.sh): подгружается `.env`, и все миграции из `server/migrations/` применяются в фиксированном порядке. Нужны установленный `psql` и переменная `DATABASE_URL` в `.env` (на сервере это уже есть после настройки по DEPLOY-УБУНТУ-ПОШАГОВО).

**Порядок миграций:** 001 → 002 → 003_active_days_and_rewards → 003_add_dictionary_version → 004 → 005 → 006 → 007. Миграции идемпотентны (`IF NOT EXISTS` и т.д.), повторный прогон безопасен.

- **004** — флаг админа (`users.is_admin`) и таблица AI-подсказок для словаря.
- **005** — нормализованный словарь (леммы/значения/примеры и `dictionary_entry_links`); без неё «Мои слова» и лента «Сегодня» отдают 500.

Если по какой-то причине миграции нужно выполнить вручную:

```bash
cd ~/stroova
chmod +x scripts/run-migrations.sh
./scripts/run-migrations.sh
```

(Если появляется «Permission denied», можно вместо `./scripts/run-migrations.sh` выполнить: `bash scripts/run-migrations.sh`.)

#### Если после обновления 500 на «Мои слова» / «Сегодня» (user-dictionary)

Если при добавлении слова или открытии «Сегодня» приходят 500 на `GET /api/user-dictionary/today` или `GET /api/user-dictionary/my-words`, на боевой БД не применены миграции 005–007. Один раз выполни на сервере:

```bash
cd ~/stroova
./scripts/run-migrations.sh
pm2 restart stroova-api
```

**Если `psql` пишет `FATAL: role "root" does not exist`:** значит в текущей оболочке не подхватывается `DATABASE_URL` из `.env`, и psql подключается под пользователем ОС (root). Проверь: `cd ~/stroova && set -a && source .env && set +a && echo "DATABASE_URL length: ${#DATABASE_URL}"` — должно быть число больше 20. В `.env` должна быть строка вида `DATABASE_URL=postgresql://stroova:ПАРОЛЬ@localhost:5432/stroova` (без пробелов вокруг `=`, без кавычек). После этого снова запусти `./scripts/run-migrations.sh`.

**Если скрипт пишет «DATABASE_URL не задан»:** файл `.env` есть, но переменная не подхватывается. Проверь на сервере: `grep DATABASE_URL .env` — должна быть одна строка вида `DATABASE_URL=postgresql://stroova:ПАРОЛЬ@localhost:5432/stroova`. Без пробелов вокруг `=`. Если в пароле есть спецсимволы (`#`, `&`, `?`), возьми значение в одинарные кавычки: `DATABASE_URL='postgresql://stroova:пароль@localhost:5432/stroova'`. После правки сохрани файл и снова запусти `./scripts/run-migrations.sh`.

### 4. Обновление транскрипций IPA на боевой БД

Если в словаре в БД были некорректные или пустые транскрипции (ipa_uk, ipa_us), их можно один раз перезаполнить генератором IPA. **Сначала** залей обновление с новым кодом (шаги 1–2), чтобы на сервере оказались скрипт и зависимость `phonemizer`. Затем по SSH:

```bash
cd ~/stroova
set -a && source .env && set +a && npm run update-ipa
```

Скрипт прочитает все слова из `dictionary_entries` (language_id = 1), для каждого сгенерирует IPA (UK/US) и обновит поля. На ~2000 слов может уйти несколько минут; в консоли будет прогресс каждые 100 слов. API при этом может продолжать работать — скрипт только обновляет БД.

### 5. Проверка

Открой сайт в браузере, проверь логин и работу приложения. При проблемах с API смотри логи: `pm2 logs stroova-api`.

---

## Автодеплой по push (GitHub Actions)

Если настроен автодеплой: при push в ветку `main` GitHub Actions подключается к серверу и выполняет `./deploy.sh` (см. [.github/workflows/deploy.yml](.github/workflows/deploy.yml)). Секреты: `SSH_HOST` = **stroova.ru**, `SSH_USER`, `SSH_PRIVATE_KEY`; при необходимости — `APP_DIR` (путь к проекту на сервере).

При автодеплое миграции применяются автоматически (шаг внутри `./deploy.sh`).
