# PostgreSQL для STroova

API использует PostgreSQL для хранения пользователей и сессий. Таблицы создаются автоматически при первом запуске сервера.

---

## Установка PostgreSQL на Windows (пошагово)

Если ты разрабатываешь на **Windows**, делай так.

### Шаг 1. Скачать установщик

1. Открой в браузере: **https://www.postgresql.org/download/windows/**
2. Нажми **«Download the installer»** (или перейди по ссылке на edb или postgresql.org).
3. Выбери **последнюю стабильную версию** (например 16 или 17).
4. Скачай установщик для Windows (файл типа `postgresql-17-x64-windows.exe`).

### Шаг 2. Запустить установщик

1. Запусти скачанный файл (может потребоваться «Запуск от имени администратора»).
2. **Select Components:** оставь всё по умолчанию (PostgreSQL Server, pgAdmin, Command Line Tools и т.д.) → **Next**.
3. **Data Directory:** можно не менять → **Next**.
4. **Password:** задай **пароль для пользователя postgres**. Это пароль суперпользователя БД — **запомни его** (например запиши в блокнот). Введи два раза → **Next**.
5. **Port:** оставь **5432** → **Next**.
6. **Locale:** по умолчанию → **Next**.
7. Дождись окончания установки и нажми **Finish**. Можешь снять галочку «Launch Stack Builder» — он не нужен.

### Шаг 3. Добавить PostgreSQL в PATH (чтобы работала команда psql)

1. Нажми **Win + R**, введи `sysdm.cpl`, Enter.
2. Вкладка **«Дополнительно»** → кнопка **«Переменные среды»**.
3. В блоке **«Системные переменные»** найди переменную **Path** → выдели её → **Изменить**.
4. **Создать** → вставь путь к папке с утилитами PostgreSQL. Обычно это:
   ```text
   C:\Program Files\PostgreSQL\17\bin
   ```
   (цифра **17** может быть другой — та, что версия при установке). Нажми **ОК** везде.
5. **Закрой все окна терминала и Cursor** и открой заново — тогда PATH подхватится.

### Шаг 4. Создать пользователя и базу для STroova

Открой **PowerShell** или **CMD** и выполни по очереди (пароль `postgres` — тот, что задал при установке; когда попросит пароль — введи его):

```powershell
psql -U postgres -c "CREATE USER stroova WITH PASSWORD 'local';"
```

Если появится ошибка «psql не найден» — PATH не подхватился: закрой все терминалы, перезапусти Cursor и попробуй снова. Либо укажи полный путь, например:
```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "CREATE USER stroova WITH PASSWORD 'local';"
```
(подставь свою версию вместо 17.)

Потом создай базу:

```powershell
psql -U postgres -c "CREATE DATABASE stroova OWNER stroova;"
```

При каждой команде может спросить пароль пользователя **postgres** — введи тот, что задал при установке.

### Шаг 5. Прописать DATABASE_URL в проекте

В папке проекта открой файл **`.env`** (в корне, рядом с `package.json`) и добавь одну строку:

```env
DATABASE_URL=postgresql://stroova:Gopota@localhost:5432/stroova
```

**Что это значит (по частям):**

| Часть в строке   | Значение   | Объяснение |
|------------------|------------|------------|
| `postgresql://`  | протокол   | Так подключаются к PostgreSQL — не меняй. |
| `stroova`        | **пользователь** БД | Имя пользователя, которого мы создали командой `CREATE USER stroova ...`. |
| `Gopota`         | **пароль** | Пароль этого пользователя (тот, что ты задал при создании). |
| `localhost`     | **хост**   | Где крутится база: `localhost` = «на этом же компьютере». |
| `5432`           | **порт**   | Порт, на котором слушает PostgreSQL (по умолчанию 5432). |
| `stroova` (в конце) | **имя базы** | База, которую создали командой `CREATE DATABASE stroova ...`. |

Итого: «подключись к базе **stroova** на этом компьютере, под пользователем **stroova** с паролем **Gopota**». Если при создании пользователя ты задал другой пароль — замени в строке `Gopota` на свой пароль.

Сохрани `.env` и запусти API: `npm run server`. Таблицы в базе создадутся при первом запуске.

---

## Локально (кратко для Mac/Linux)

- **Mac:** установи PostgreSQL (например `brew install postgresql`), запусти сервис, затем в терминале:
  ```bash
  createuser -U postgres stroova
  psql -U postgres -c "ALTER USER stroova WITH PASSWORD 'local';"
  psql -U postgres -c "CREATE DATABASE stroova OWNER stroova;"
  ```
- **Linux (Ubuntu и т.п.):** `sudo apt install postgresql postgresql-client`, затем создай пользователя и БД так же, как на сервере (см. раздел «На сервере» ниже).

В `.env` добавь:
```env
DATABASE_URL=postgresql://stroova:local@localhost:5432/stroova
```
и запусти `npm run server`.

## На сервере (Ubuntu)

### Установка PostgreSQL

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### Создание пользователя и базы

```bash
sudo -u postgres psql -c "CREATE USER stroova WITH PASSWORD 'ВЫБЕРИ_НАДЁЖНЫЙ_ПАРОЛЬ';"
sudo -u postgres psql -c "CREATE DATABASE stroova OWNER stroova;"
```

Пароль замени на свой и **не коммить** его в репозиторий.

### Переменная DATABASE_URL

В `.env` на сервере добавь (подставь пароль и при необходимости хост):

```env
DATABASE_URL=postgresql://stroova:ТВОЙ_ПАРОЛЬ@localhost:5432/stroova
```

Если PostgreSQL на том же сервере, хост — `localhost`. Если БД на другом хосте — укажи его вместо `localhost`.

После этого перезапусти API (например `pm2 restart stroova-api`). При первом запуске таблицы `users` и `sessions` создадутся автоматически.

## Словари в БД

Слова хранятся в таблицах **languages** и **dictionary_entries** (например «словарь английского» — все строки с `language_id = 1`). Таблицы создаются при первом запуске сервера. Данные нужно один раз загрузить скриптом сидирования.

### Первая загрузка слов (английский A0)

Из корня проекта (должны быть настроены `.env` и PostgreSQL):

```bash
npm run seed
```

Скрипт читает слова из `src/data/dictionary.ts` (A0), `src/data/dictionary-a1.ts` (A1) и `src/data/dictionary-a2.ts` (A2) и вставляет их в `dictionary_entries`. Уровни A0 (70 слов), A1 (80 слов), A2 (80 слов). Повторный запуск обновляет существующие строки по паре (language_id, en).

### API для фронта

- **GET /api/languages** — список языков (id, code, name).
- **GET /api/dictionary/words?lang=en&accent=both&level=A0** — слова для языка; фильтры `accent` и `level` по желанию.

Фронт запрашивает слова при загрузке страницы словаря и упражнений. Если API недоступен или слова ещё не загружены, используется резервный статический список из кода.

### Добавление другого языка

1. Вставить запись в **languages**: `INSERT INTO languages (code, name) VALUES ('de', 'Немецкий');`
2. Заполнить **dictionary_entries** для нового `language_id` (своим скриптом или вручную).
3. На фронте при необходимости передавать `lang` в запрос (например `?lang=de`).

---

## Миграция с data.json (опционально)

Если у тебя уже есть пользователи в `server/data.json` и нужно перенести их в PostgreSQL, можно один раз выполнить скрипт миграции (его можно добавить в репозиторий отдельно) или вручную вставить данные через SQL. При необходимости можно написать скрипт `server/migrate-json-to-pg.js`.
