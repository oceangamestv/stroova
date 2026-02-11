#!/bin/bash
# Деплой STroova: обновление из Git, сборка фронта, перезапуск API.
# Запускать на сервере из корня проекта: ./deploy.sh

set -e
cd "$(dirname "$0")"

echo "→ git pull"
git pull

echo "→ npm ci --ignore-scripts"
npm ci --ignore-scripts

echo "→ npm run build"
npm run build

echo "→ pm2 startOrReload ecosystem.config.cjs --update-env"
pm2 startOrReload ecosystem.config.cjs --update-env

echo "→ pm2 save"
pm2 save

echo "Готово."
