# База учётных записей

Единое хранилище данных пользователей приложения: учётные записи, прогресс по словам, опыт и статистика.

## Где хранится

- **Бэкенд:** `localStorage` (ключи заданы в `storageKeys.ts`).
- **Доступ:** через `userAccountDb` в коде; для авторизации и прогресса используются `authAdapter` и `progressService`, которые опираются на эту базу.

## «Таблицы»

### 1. Пользователи (`linguaMatch_users`)

Один объект: `Record<username, User>`.

| Поле в User | Описание |
|-------------|----------|
| `username` | Логин (уникальный) |
| `passwordHash` | Хэш пароля (для входа) |
| `createdAt` | Дата регистрации (ISO строка) |
| `stats` | Статистика: опыт, счётчики упражнений |
| `wordProgress` | Прогресс по словам (id слова → процент по трекам) |
| `gameSettings` | Настройки игр (опционально) |

**stats:**

- `totalXp` — суммарный опыт (XP)
- `exercisesCompleted`, `pairsCompleted`, `puzzlesCompleted` — счётчики
- `bestScore` — лучший результат за одну сессию (XP)

**wordProgress:**

- Ключ — id слова из словаря
- Значение — `{ beginner?, experienced?, expert? }` (0–100) или устаревший формат `number`

### 2. Сессия (`linguaMatch_session`)

Текущий пользователь: `{ username, loginTime }` или `null`, если никто не войти.

## API (`userAccountDb`)

- `getUsers()` — вся таблица пользователей
- `getUser(username)` — один пользователь
- `saveUsers(users)` — сохранить таблицу
- `saveUser(username, user)` — обновить/создать пользователя
- `removeUser(username)` — удалить пользователя
- `getSession()` / `setSession()` / `clearSession()` — работа с сессией

Расширение: при переходе на серверный бэкенд достаточно заменить реализацию в `userAccountDb` (и/или слой `storage`), не меняя типы и контракты.
