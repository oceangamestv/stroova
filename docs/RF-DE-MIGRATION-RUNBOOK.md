# RF/DE migration runbook (from current DE prod)

Ниже только практические шаги, в строгом порядке.

---

## 0) Что где

- **DE-OLD-PROD**: текущий боевой сервер в Германии (сайт+API+БД).
- **RF-NEW-PROD**: новый боевой сервер в России (сайт+API+БД) — станет основным.
- **DE-NEW-WORKER**: новый пустой микро-сервер в Германии (только AI worker).
- **LOCAL**: ваш компьютер.

---

## 0.1) Проверка: открытие сайта по IP (тестовый сервер, без БД и сертификатов)

Чтобы только убедиться, что страница проекта открывается по IP (без HTTPS и без API/БД):

**На тестовом сервере:**

1. Установить git и Node.js (если ещё нет):
   ```bash
   apt update && apt install -y git
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   ```

2. Клонировать проект и собрать фронт:
   ```bash
   git clone git@github.com:oceangamestv/stroova.git ~/stroova
   cd ~/stroova
   npm ci --ignore-scripts
   npm run build
   ```

3. Запустить раздачу статики по всем интерфейсам (доступ по `http://<IP-сервера>:4173`):
   ```bash
   npx vite preview --host 0.0.0.0 --port 4173
   ```
   Или в фоне через `nohup`/`screen`/`tmux`:
   ```bash
   nohup npx vite preview --host 0.0.0.0 --port 4173 > preview.log 2>&1 &
   ```

4. Проверить: в браузере открыть `http://<IP-тестового-сервера>:4173`. Должна открыться SPA; запросы к API будут падать — это нормально для этой проверки.

**Важно:** порт 4173 должен быть открыт в файрволе (или использовать порт 80 с `sudo`). Без БД и бэкенда только проверяется, что статика отдаётся и страница открывается по IP.

---

## 1) Подготовка доступа к приватному репозиторию

### 1.1 На GitHub
- Создайте deploy key (read-only) для репозитория или используйте PAT.
- Рекомендуется deploy key для серверов.

### 1.2 На каждом сервере (RF-NEW-PROD и DE-NEW-WORKER)
```bash
ssh-keygen -t ed25519 -C "server-deploy-key" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```
- Публичный ключ добавьте в GitHub репозиторий как Deploy key (Allow write = off).

### 1.3 Проверка доступа на сервере
```bash
ssh -T git@github.com
git clone git@github.com:oceangamestv/stroova.git ~/stroova
```

---

## 2) Подготовка RF-NEW-PROD (новый основной прод в РФ)

Выполнять на **RF-NEW-PROD**:

```bash
sudo apt update
sudo apt install -y git nginx postgresql postgresql-contrib
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

Создать БД:
```bash
sudo systemctl enable --now postgresql
sudo -u postgres psql -c "CREATE USER stroova WITH PASSWORD 'CHANGE_ME_DB_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE stroova OWNER stroova;"
```

Клонировать проект:
```bash
git clone git@github.com:oceangamestv/stroova.git ~/stroova
cd ~/stroova
```

Создать `.env`:
```bash
cp docs/env/.env.rf-prod.example .env
nano .env
```
- Заполнить реальные значения.
- `INTERNAL_SYNC_ALLOWED_IPS` = публичный IP **DE-NEW-WORKER**.

Сборка и старт:
```bash
npm ci --ignore-scripts
npm run build
set -a && source .env && set +a && pm2 start ecosystem.config.cjs --update-env
pm2 save
```

Применить миграции:
```bash
chmod +x scripts/run-migrations.sh
./scripts/run-migrations.sh
pm2 restart stroova-api --update-env
```

---

## 3) Полный перенос данных с DE-OLD-PROD на RF-NEW-PROD (обязательный первый этап)

### 3.1 На DE-OLD-PROD: зафиксировать запись (короткое окно)
```bash
cd ~/stroova
pm2 stop stroova-api
```

### 3.2 На DE-OLD-PROD: сделать дамп БД
```bash
set -a && source .env && set +a
pg_dump "$DATABASE_URL" -Fc -f ~/stroova_backup.dump
```

### 3.3 Скопировать дамп на RF-NEW-PROD (выполнять на LOCAL)
```bash
scp root@<DE_OLD_IP>:~/stroova_backup.dump root@<RF_NEW_IP>:~/stroova_backup.dump
```

### 3.4 На RF-NEW-PROD: восстановить дамп
```bash
sudo -u postgres dropdb --if-exists stroova
sudo -u postgres createdb -O stroova stroova
set -a && source ~/stroova/.env && set +a
pg_restore -d "$DATABASE_URL" --clean --if-exists --no-owner --no-privileges ~/stroova_backup.dump
```

### 3.5 На RF-NEW-PROD: миграции и запуск
```bash
cd ~/stroova
./scripts/run-migrations.sh
set -a && source .env && set +a && pm2 restart stroova-api --update-env
pm2 restart stroova-telegram-bot --update-env
```

### 3.6 На DE-OLD-PROD: вернуть старый прод до cutover (если нужно)
```bash
pm2 start stroova-api
```

---

## 4) Поднять DE-NEW-WORKER (пустой микро-сервер в Германии)

Выполнять на **DE-NEW-WORKER**:

```bash
sudo apt update
sudo apt install -y git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
git clone git@github.com:oceangamestv/stroova.git ~/stroova
cd ~/stroova
npm ci --ignore-scripts
```

Создать `.env`:
```bash
cp docs/env/.env.de-worker.example .env
nano .env
```

Проверить отправку тестового payload:
```bash
cat > /tmp/payload.json <<'EOF'
{
  "payloadVersion": "1",
  "lang": "en",
  "actorUsername": "admin",
  "entries": [
    {
      "en": "hello",
      "ru": "привет",
      "level": "A0",
      "register": "разговорная"
    }
  ]
}
EOF

set -a && source .env && set +a
npm run de-sync:send -- --file /tmp/payload.json --wait
```

Если ок — можно запускать worker-процессом (пример):
```bash
pm2 start "bash -lc 'while true; do sleep 60; done'" --name stroova-de-worker
pm2 save
```

Примечание: реальный цикл обработки запросов админа запускайте вашим job-скриптом/cron, который вызывает `npm run de-sync:send`.

---

## 5) Cutover трафика на РФ прод

### 5.1 Подготовка перед переключением
- На RF-NEW-PROD проверить:
  - `pm2 list` (все online),
  - `curl http://127.0.0.1:3000/api/languages`,
  - сайт по IP/врем домену открывается.

### 5.2 Финальная синхронизация (минимальный даунтайм)
1. На DE-OLD-PROD: `pm2 stop stroova-api`.
2. Повторить шаги **3.2 -> 3.5** (финальный дамп/restore).
3. Переключить DNS `A` запись домена на IP RF-NEW-PROD.
4. На RF-NEW-PROD проверить `nginx`, SSL и сайт.

### 5.3 После переключения
- Держать DE-OLD-PROD выключенным для API (или read-only fallback).
- БД рабочая только на RF-NEW-PROD.

---

## 6) Nginx защита internal endpoint (на RF-NEW-PROD)

В `location /api/internal/dictionary-upserts` ограничить IP:
```nginx
location /api/internal/dictionary-upserts {
    allow <DE_NEW_WORKER_PUBLIC_IP>;
    deny all;
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Проверка:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 7) Проверка после запуска

На RF-NEW-PROD:
```bash
pm2 list
pm2 logs stroova-api --lines 100
curl -s "http://127.0.0.1:3000/api/admin/dictionary/internal-sync/stats"
```

На DE-NEW-WORKER:
```bash
cd ~/stroova
set -a && source .env && set +a
npm run de-sync:send -- --file /tmp/payload.json --wait
```

Ожидаемо:
- задача принимает статус `success`;
- запись появляется в словаре на RF;
- в `dictionary_audit_log` есть `meta.source = internal_sync`.
