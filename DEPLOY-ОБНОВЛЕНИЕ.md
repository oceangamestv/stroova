# Заливка обновления на сервер

Сервер настроен по инструкции **[DEPLOY-УБУНТУ-ПОШАГОВО.md](DEPLOY-УБУНТУ-ПОШАГОВО.md)**. Если понадобится заново поднять сервер с нуля (другой хост, переустановка) — используй тот же документ.

Данные хранятся в **PostgreSQL** (не в `server/data.json`). При обновлении БД не пересоздаётся, только подтягивается код, пересобирается фронт и перезапускается API.

---

## Полный сброс и развёртывание текущей версии с нуля

Этот раздел нужен, если после обычного деплоя на сайте всё ещё открывается **старая** версия. Выполни шаги ниже один раз на сервере — после этого будет работать текущая версия (React/Vite, API с PostgreSQL). Дальше можно пользоваться обычными шагами 1–2 (push и `./deploy.sh`).

Все команды ниже выполняются **на сервере по SSH**. Для пользователя root каталог проекта — `/root/stroova`, для других — `~/stroova` (в примерах ниже `~/stroova`, при необходимости замени на `/root/stroova`).

### Шаг A. Подключиться к серверу и зайти в каталог проекта

```bash
ssh root@5b5a1af3caf3.vps.myjino.ru
cd ~/stroova
```

(Подставь свой логин и хост, если другие.)

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

Должны быть все четыре переменные (подставь свой пароль БД вместо `ТВОЙ_ПАРОЛЬ_БД`):

```
VITE_API_URL=https://5b5a1af3caf3.vps.myjino.ru/api
PORT=3000
CORS_ORIGIN=https://5b5a1af3caf3.vps.myjino.ru
DATABASE_URL=postgresql://stroova:ТВОЙ_ПАРОЛЬ_БД@localhost:5432/stroova
```

Проверка: `cat .env`. Если чего-то нет — открыть `nano .env` и дописать/исправить, сохранить (Ctrl+O, Enter), выйти (Ctrl+X).

### Шаг E. Установить зависимости и собрать фронт заново

Это пересоберёт папку `dist/` из текущего кода (Vite/React):

```bash
npm ci
npm run build
```

Дождись окончания без ошибок. После этого в `dist/` лежит актуальный фронт.

### Шаг F. Запустить API с переменными из .env

Чтобы процесс видел `DATABASE_URL` и остальное:

```bash
set -a && source .env && set +a && pm2 start server/index.js --name stroova-api
```

Проверка: `pm2 list` — stroova-api в статусе **online**. Логи: `pm2 logs stroova-api` (выход — Ctrl+C). В логах при успешном старте должно быть сообщение вроде «STroova API», «DB: PostgreSQL».

### Шаг G. Сохранить список процессов PM2

```bash
pm2 save
```

### Шаг H. Проверить сайт

Открой в браузере `https://5b5a1af3caf3.vps.myjino.ru` (или свой домен). Должна открыться текущая версия приложения (логин, словарь, упражнения). Если видишь старый интерфейс — очисти кэш браузера (Ctrl+Shift+R или «Жёсткое обновление») или открой в режиме инкогнито.

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

Перейди в папку проекта:

```bash
cd ~/stroova
```

Подтяни код с GitHub:

```bash
git pull
```

**Если появилась ошибка** вроде:
`error: Your local changes to the following files would be overwritten by merge: ... Please commit your changes or stash them before you merge.`

Значит на сервере изменён файл (часто `node_modules/.package-lock.json`). Отмени это изменение и снова выполни pull:

```bash
git checkout -- node_modules/.package-lock.json
git pull
```

(Если в сообщении об ошибке указан другой файл — подставь его путь вместо `node_modules/.package-lock.json`.)

Установи зависимости и пересобери фронт, перезапусти API:

```bash
npm ci
npm run build
pm2 restart stroova-api
```

Либо вместо трёх команд выше можно один раз выполнить скрипт деплоя (он сделает то же самое, включая `git pull` и `npm ci`):

```bash
./deploy.sh
```

Но если перед этим `git pull` падал с ошибкой — сначала выполни `git checkout -- ...` и `git pull` вручную, как выше, затем уже `./deploy.sh` или вручную `npm ci`, `npm run build`, `pm2 restart stroova-api`.

### 3. Проверка

Открой сайт в браузере и убедись, что всё работает. Логи API: `pm2 logs stroova-api` (выход — Ctrl+C).

**Шпаргалка — команды по порядку:**

| Где | Команды |
|-----|--------|
| Компьютер | `cd d:\Cursor` → `git add .` → `git commit -m "описание"` → `git push` |
| Сервер | `cd ~/stroova` → `git pull` (при ошибке: `git checkout -- node_modules/.package-lock.json` и снова `git pull`) → `npm ci` → `npm run build` → `pm2 restart stroova-api` |

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

Скрипт [deploy.sh](deploy.sh) делает по порядку: `git pull` → `npm ci` → `npm run build` → `pm2 restart stroova-api`.

**Если `./deploy.sh` не срабатывает из‑за конфликта при pull** (см. раздел «Инструкция для будущих обновлений» выше): сначала на сервере выполни `git checkout -- node_modules/.package-lock.json` и `git pull`, затем снова `./deploy.sh`.

(Если проект клонирован не в домашнюю папку, перейди в каталог проекта — например для пользователя root это `/root/stroova`.)

### 3. Миграции БД (если в репо появились новые)

После `git pull` в папке `server/migrations/` могут оказаться **новые** файлы `.sql` (например `004_...sql`). Их нужно применить **один раз вручную** (на сервере должен быть установлен `psql`, обычно он есть после установки PostgreSQL по DEPLOY-УБУНТУ-ПОШАГОВО):

```bash
cd ~/stroova
set -a && source .env && set +a
psql "$DATABASE_URL" -f server/migrations/001_dictionary_frequency_rarity_register.sql
psql "$DATABASE_URL" -f server/migrations/002_recreate_dictionary_entries.sql
psql "$DATABASE_URL" -f server/migrations/003_active_days_and_rewards.sql
```

Применяй только те миграции, которые ещё не выполнялись. Если все уже применены или схема полностью создаётся при первом запуске API через `initDb()` в [server/db.js](server/db.js) — этот шаг можно пропустить.

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

Если настроен автодеплой: при push в ветку `main` GitHub Actions подключается к серверу и выполняет `./deploy.sh` (см. [.github/workflows/deploy.yml](.github/workflows/deploy.yml)). В репозитории должны быть секреты: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`; при необходимости — `APP_DIR` (путь к проекту на сервере).

**Новые миграции** при автодеплое не применяются — их нужно один раз выполнить вручную по SSH (шаг 3 выше).
