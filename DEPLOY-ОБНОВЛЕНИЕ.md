# Заливка обновления на сервер

Сервер настроен по инструкции **[DEPLOY-УБУНТУ-ПОШАГОВО.md](DEPLOY-УБУНТУ-ПОШАГОВО.md)**. Если понадобится заново поднять сервер с нуля (другой хост, переустановка) — используй тот же документ.

Данные хранятся в **PostgreSQL** (не в `server/data.json`). При обновлении БД не пересоздаётся, только подтягивается код, пересобирается фронт и перезапускается API.

---

## Шаги заливки обновления

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

### 4. Проверка

Открой сайт в браузере, проверь логин и работу приложения. При проблемах с API смотри логи: `pm2 logs stroova-api`.

---

## Автодеплой по push (GitHub Actions)

Если настроен автодеплой: при push в ветку `main` GitHub Actions подключается к серверу и выполняет `./deploy.sh` (см. [.github/workflows/deploy.yml](.github/workflows/deploy.yml)). В репозитории должны быть секреты: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`; при необходимости — `APP_DIR` (путь к проекту на сервере).

**Новые миграции** при автодеплое не применяются — их нужно один раз выполнить вручную по SSH (шаг 3 выше).
