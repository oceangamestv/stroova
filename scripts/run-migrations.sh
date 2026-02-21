#!/bin/bash
# Применяет все миграции БД в фиксированном порядке.
# Вызывается из корня проекта (например из deploy.sh).
# Требует: .env с DATABASE_URL, установленный psql.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  echo "  .env не найден — миграции пропущены."
  exit 0
fi

set -a
# shellcheck source=/dev/null
source .env
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "  DATABASE_URL не задан — миграции пропущены."
  exit 0
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "  psql не найден — миграции пропущены."
  exit 0
fi

MIGRATIONS=(
  "server/migrations/001_dictionary_frequency_rarity_register.sql"
  "server/migrations/002_recreate_dictionary_entries.sql"
  "server/migrations/003_active_days_and_rewards.sql"
  "server/migrations/003_add_dictionary_version.sql"
  "server/migrations/004_admin_and_dictionary_ai.sql"
  "server/migrations/005_dictionary_normalized_v2.sql"
  "server/migrations/006_dictionary_review_and_admin_v2.sql"
  "server/migrations/007_dictionary_audit_log.sql"
  "server/migrations/008_internal_dictionary_sync_queue.sql"
)

for f in "${MIGRATIONS[@]}"; do
  if [ -f "$f" ]; then
    echo "  $f"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
  fi
done

echo "  Миграции применены."
