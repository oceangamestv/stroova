# Миграции БД (PostgreSQL)

## 001_dictionary_frequency_rarity_register.sql

**Назначение:** добавить в таблицу `dictionary_entries` три поля и индекс:

| Колонка           | Тип           | По умолчанию  | Описание |
|-------------------|---------------|---------------|----------|
| `frequency_rank`  | INT NOT NULL  | 15000         | Чем меньше — тем чаще слово (1 = самое частотное). |
| `rarity`          | VARCHAR(20)   | 'редкое'      | Допустимые значения: `не редкое`, `редкое`, `очень редкое`. |
| `register`        | VARCHAR(20)   | 'разговорная' | Допустимые значения: `официальная`, `разговорная`. |

- Добавлены CHECK-ограничения на `rarity` и `register`.
- Создан индекс `idx_dictionary_entries_frequency_rank` для сортировки/фильтрации по частотности.

**Существующие строки и импорт CSV:** у всех колонок заданы `NOT NULL` и `DEFAULT`, поэтому:
- старые строки после миграции автоматически получают значения по умолчанию;
- при импорте CSV без этих колонок они тоже заполнятся по умолчанию;
- если в CSV колонки есть (как в `dictionary_A0_A2_2000_unique_freq_register.csv`) — подставятся значения из файла.

---

## Как применить миграцию

### Вариант 1: psql из командной строки

```bash
psql -U stroova -d stroova -f server/migrations/001_dictionary_frequency_rarity_register.sql
```

(Подставь своего пользователя и базу при необходимости.)

### Вариант 2: DBVisualizer / DBeaver / pgAdmin

1. Открой файл `server/migrations/001_dictionary_frequency_rarity_register.sql`.
2. Подключись к нужной базе (stroova).
3. Выполни весь скрипт (Execute / Run).

Миграция идемпотентна: повторный запуск не упадёт (используются `IF NOT EXISTS` и `DROP CONSTRAINT IF EXISTS` перед добавлением ограничений).

---

## Импорт CSV после миграции

В DBVisualizer/DBViewer при импорте CSV с колонками  
`id, language_id, en, ru, accent, level, frequency_rank, rarity, register, ipa_uk, ipa_us, example, example_ru`:

- Укажи таблицу `dictionary_entries`.
- Сопоставь колонки CSV с колонками таблицы (в т.ч. `frequency_rank`, `rarity`, `register`).
- Для конфликтов по `(language_id, en)` выбери «UPDATE» или «Replace», если инструмент это поддерживает; иначе предварительно очисти таблицу или импортируй в временную и мержи через SQL.

Старые строки, оставшиеся в таблице и не затронутые импортом, сохранят значения по умолчанию для новых полей (15000, 'редкое', 'разговорная').
