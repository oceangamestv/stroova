#!/bin/bash
# Деплой STroova: обновление из Git, сборка фронта, перезапуск API.
# Запускать на сервере из корня проекта: ./deploy.sh

set -e
cd "$(dirname "$0")"

echo "→ git pull"
git pull

echo "→ npm ci"
npm ci

echo "→ npm run build"
npm run build

echo "→ pm2 restart stroova-api"
pm2 restart stroova-api

echo "Готово."
