# RF/DE: синхронизация словаря через internal API

Эта схема нужна, когда:
- прод API + PostgreSQL находятся в РФ;
- отдельный DE-сервис делает AI-обогащение и должен передавать изменения словаря в РФ.

## Принцип

Используем только контур `DE service -> RF API -> RF DB`.

- DE-сервис отправляет батч в `POST /api/internal/dictionary-upserts`.
- РФ API не пишет сразу в БД "в лоб", а кладет задачу в очередь `internal_dictionary_sync_jobs`.
- Воркер РФ API обрабатывает задачу асинхронно, делает upsert, sync v2 и bump версии словаря.
- Статус задачи: `GET /api/internal/dictionary-upserts/status?requestId=...`.

Прямой доступ DE к PostgreSQL не используется.

## Безопасность

Минимум:
- `INTERNAL_SYNC_SHARED_SECRET` (HMAC подпись);
- `INTERNAL_SYNC_ALLOWED_IPS` (allowlist DE-IP);
- короткое окно timestamp (`INTERNAL_SYNC_ALLOWED_SKEW_SECONDS`, по умолчанию 300).

Дополнительно (рекомендуется в проде):
- VPN (WireGuard) между DE и RF;
- mTLS на reverse proxy и заголовок подтверждения `x-internal-mtls-verified: 1`;
- закрытие internal endpoint на уровне firewall/security group.

## Переменные окружения (RF API)

```env
INTERNAL_SYNC_SOURCE=de-ai-worker
INTERNAL_SYNC_SHARED_SECRET=change_me_long_random_secret
INTERNAL_SYNC_REQUIRE_SIGNATURE=true
INTERNAL_SYNC_ALLOWED_IPS=203.0.113.10
INTERNAL_SYNC_REQUIRE_MTLS=false
INTERNAL_SYNC_ALLOWED_SKEW_SECONDS=300
INTERNAL_SYNC_WORKER_POLL_MS=3000
```

## Формат запроса (DE -> RF)

```json
{
  "requestId": "uuid-or-stable-idempotency-key",
  "source": "de-ai-worker",
  "payloadVersion": "1",
  "lang": "en",
  "actorUsername": "admin_username",
  "entries": [
    {
      "en": "hello",
      "ru": "привет",
      "level": "A0",
      "register": "разговорная",
      "accent": "both",
      "frequencyRank": 1200,
      "rarity": "не редкое",
      "ipaUk": "həˈləʊ",
      "ipaUs": "həˈloʊ",
      "example": "Hello, how are you?",
      "exampleRu": "Привет, как дела?"
    }
  ]
}
```

Обязательные заголовки:
- `x-sync-timestamp` (unix seconds),
- `x-sync-request-id` (должен совпадать с `requestId`),
- `x-sync-signature` (`sha256=<hmac_hex>`).

Подпись считается по строке:
- `${timestamp}.${requestId}.${sha256(JSON.stringify(payload))}`

## DE-клиент (готовый скрипт)

В репозитории есть отправщик: `server/de-dictionary-sync-client.mjs`.

Переменные окружения DE:
```env
RF_SYNC_URL=https://rf-host.example.com/api/internal/dictionary-upserts
RF_SYNC_SHARED_SECRET=change_me_long_random_secret
RF_SYNC_SOURCE=de-ai-worker
RF_SYNC_RETRIES=4
```

Запуск:
```bash
npm run de-sync:send -- --file ./payload.json --wait
```

`--wait` опрашивает статус задачи до `success/failed`.

## Наблюдаемость и алерты

- Админ-статистика очереди: `GET /api/admin/dictionary/internal-sync/stats` (требует admin auth).
- Статус конкретной задачи: `GET /api/internal/dictionary-upserts/status?requestId=...`.
- Логика словаря пишет audit-записи в `dictionary_audit_log` с `meta.source = "internal_sync"`.

Рекомендуемые алерты:
- `failed > 0` за последние 5-10 минут;
- `pending` растёт дольше заданного SLA;
- `processing` не меняется дольше N минут.

## E2E чеклист отказов

1. **Idempotency**: отправить один и тот же `requestId` дважды -> вторая попытка должна вернуть replay без дублей в БД.
2. **Signature fail**: отправить неправильный `x-sync-signature` -> `401`.
3. **Timestamp replay**: отправить старый `x-sync-timestamp` -> `401`.
4. **Network retry**: искусственно оборвать сеть у DE-клиента и проверить успешный повтор.
5. **Worker failure**: передать заведомо некорректную запись и убедиться, что задача переходит в `failed` с `errorMessage`.
