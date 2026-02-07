# Деплой STroova на Ubuntu 22.04 (через Git)

Дальше — один раз настроить сервер, потом обновления делаются через Git и одну команду (или автоматически по push).

---

## Что будет в итоге

- **Обновления:** ты пушишь код в репозиторий → на сервере запускаешь `./deploy.sh` (или деплой срабатывает сам по push, если настроишь GitHub Actions).
- **Данные:** `server/data.json` на сервере не трогаем при деплое — пользователи и прогресс сохраняются.

---

## Один раз: настройка сервера

Подставь свой хост вместо `5b5a1af3caf3.vps.myjino.ru` и URL репозитория вместо `https://github.com/ТВОЙ_ЛОГИН/stroova.git`.

### 1. Подключись по SSH

```bash
ssh твой_пользователь@5b5a1af3caf3.vps.myjino.ru
```

### 2. Установи Node.js 20, Git, Nginx

```bash
sudo apt update
sudo apt install -y git nginx

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2 (запуск API в фоне и автозапуск после перезагрузки)
sudo npm install -g pm2
```

### 3. Клонируй репозиторий

Если репозиторий **публичный**:

```bash
cd ~
git clone https://github.com/ТВОЙ_ЛОГИН/stroova.git
cd stroova
```

Если **приватный** — настрой доступ с сервера (SSH-ключ и добавь его в GitHub/GitLab как Deploy key, или используй токен).

### 4. Создай `.env` на сервере

```bash
nano .env
```

Вставь (подставь свой хост):

```env
VITE_API_URL=https://5b5a1af3caf3.vps.myjino.ru/api
PORT=3000
CORS_ORIGIN=https://5b5a1af3caf3.vps.myjino.ru
```

Сохрани: `Ctrl+O`, Enter, `Ctrl+X`.

### 5. Первая сборка и запуск API

```bash
npm ci
npm run build
set -a && source .env && set +a && pm2 start server/index.js --name stroova-api
pm2 save
pm2 startup
# Выполни команду, которую выведет pm2 startup (sudo env ...)
```
Так в процесс API попадут `PORT` и `CORS_ORIGIN` из `.env`.

### 6. Сделай `deploy.sh` исполняемым

```bash
chmod +x deploy.sh
```

### 7. Настрой Nginx

```bash
sudo nano /etc/nginx/sites-available/stroova
```

Вставь (замени хост на свой):

```nginx
server {
    listen 80;
    server_name 5b5a1af3caf3.vps.myjino.ru;
    root /home/ТВОЙ_ПОЛЬЗОВАТЕЛЬ/stroova/dist;
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

Включи сайт и перезапусти Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/stroova /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**Важно:** замени `ТВОЙ_ПОЛЬЗОВАТЕЛЬ` на реальное имя пользователя (команда `whoami` покажет).

### 8. HTTPS (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 5b5a1af3caf3.vps.myjino.ru
```

После этого открой в браузере `https://5b5a1af3caf3.vps.myjino.ru` — должно открываться приложение.

---

## Дальше: обновления через Git

### Вариант A: вручную (минимум действий)

1. На своём компьютере: вносишь изменения, коммитишь и пушишь в репозиторий.
2. На сервер по SSH:
   ```bash
   cd ~/stroova
   ./deploy.sh
   ```
   Готово: подтянулся код, пересобрался фронт, перезапустился API.

### Вариант B: автоматически по push (GitHub Actions)

Настроив один раз деплой по push в `main`, ты только пушишь код — сервер обновляется сам.

1. На сервере сгенерируй ключ для деплоя (без пароля):
   ```bash
   ssh-keygen -t ed25519 -C "deploy" -f ~/.ssh/deploy_stroova -N ""
   cat ~/.ssh/deploy_stroova.pub >> ~/.ssh/authorized_keys
   ```
2. В GitHub: репозиторий → Settings → Secrets and variables → Actions. Добавь секреты:
   - `SSH_HOST` — `5b5a1af3caf3.vps.myjino.ru`
   - `SSH_USER` — пользователь по SSH
   - `SSH_PRIVATE_KEY` — содержимое `~/.ssh/deploy_stroova` (приватный ключ, целиком).
3. В репозитории уже есть workflow `.github/workflows/deploy.yml` (см. ниже). В нём поправь путь к приложению на сервере, если клонировал не в `~/stroova` (переменная `APP_DIR` в workflow).

После этого при каждом push в ветку `main` GitHub Actions зайдёт на сервер и выполнит `./deploy.sh`.

---

## Кратко

| Действие | Что делать |
|----------|------------|
| Первый раз | Выполнить шаги 1–8 выше. |
| Обычное обновление | Push в Git → на сервере `cd ~/stroova && ./deploy.sh`. |
| Автодеплой | Один раз настроить секреты и workflow — дальше только push в `main`. |

Файл `server/data.json` при `git pull` и `deploy.sh` не перезаписывается (он в `.gitignore`), данные пользователей сохраняются.
