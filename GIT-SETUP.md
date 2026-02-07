# Настройка Git на Windows и загрузка проекта на GitHub

Пошагово: один раз настроить — потом только `git add` / `git commit` / `git push`.

---

## Шаг 1. Имя и почта в Git (уже нужно для коммитов)

В PowerShell или в терминале Cursor выполни (подставь свои данные):

```powershell
git config --global user.name "Твоё Имя"
git config --global user.email "твой@email.com"
```

Почту лучше указать ту же, что будет привязана к аккаунту GitHub. Проверка:

```powershell
git config --global user.name
git config --global user.email
```

---

## Шаг 2. Аккаунт на GitHub

- Если аккаунта нет: зайди на [github.com](https://github.com) и зарегистрируйся.
- Если есть — войди в аккаунт в браузере.

---

## Шаг 3. Вход в GitHub с компьютера (чтобы пушить без пароля каждый раз)

Есть два варианта: **GitHub CLI** (проще) или **токен / SSH**.

### Вариант A: GitHub CLI (рекомендуется)

1. Скачай и установи: [https://cli.github.com/](https://cli.github.com/) (Windows).
2. В PowerShell выполни:
   ```powershell
   gh auth login
   ```
3. Выбери:
   - **GitHub.com**
   - **HTTPS**
   - **Login with a web browser** — скопируй код, нажми Enter, в открывшейся вкладке введи код и подтверди вход.

После этого `git push` будет работать без ввода пароля.

### Вариант B: Без GitHub CLI — Personal Access Token (HTTPS)

1. На GitHub: **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)** → **Generate new token**.
2. Название любое, срок действия выбери сам (например 90 дней или No expiration).
3. Отметь право **repo** (полный доступ к репозиториям).
4. Сгенерируй токен и **скопируй его один раз** (потом не покажут).
5. При первом `git push` Git спросит логин и пароль:
   - **Username:** твой логин GitHub
   - **Password:** вставь **токен** (не пароль от аккаунта).

Чтобы Windows запомнил учётные данные:

```powershell
git config --global credential.helper manager
```

При следующем push введёшь логин и токен — система их сохранит.

### Вариант C: SSH-ключ

1. Создай ключ (если ещё нет):
   ```powershell
   ssh-keygen -t ed25519 -C "твой@email.com"
   ```
   Enter по всем вопросам (путь по умолчанию, пустой passphrase — по желанию).

2. Скопируй **публичный** ключ в буфер:
   ```powershell
   Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub | Set-Clipboard
   ```

3. На GitHub: **Settings** → **SSH and GPG keys** → **New SSH key** → вставь ключ, сохрани.

4. В проекте добавляй remote по SSH (см. шаг 5), например:
   ```text
   git@github.com:ТВОЙ_ЛОГИН/ИМЯ_РЕПО.git
   ```

---

## Шаг 4. Создать репозиторий на GitHub

1. На [github.com](https://github.com) нажми **+** → **New repository**.
2. **Repository name:** например `stroova`.
3. **Public.**
4. **НЕ** ставь галочки "Add a README", ".gitignore", "License" — репозиторий должен быть пустым.
5. Нажми **Create repository**.

На странице репозитория будет блок **"…or push an existing repository from the command line"**. Скопируй оттуда две строки (или запомни URL), например:

```text
https://github.com/ТВОЙ_ЛОГИН/stroova.git
```

или для SSH:

```text
git@github.com:ТВОЙ_ЛОГИН/stroova.git
```

---

## Шаг 5. Связать проект с GitHub и загрузить код

В терминале в папке проекта (`d:\Cursor`):

```powershell
cd d:\Cursor
git init
git add .
git status
git commit -m "Initial commit: STroova"
git branch -M main
git remote add origin https://github.com/ТВОЙ_ЛОГИН/stroova.git
git push -u origin main
```

Если используешь **SSH**, вместо `https://...` подставь:

```text
git@github.com:ТВОЙ_ЛОГИН/stroova.git
```

При первом push (при HTTPS) введи логин GitHub и пароль/токен. После успешного push проект будет на GitHub.

---

## Дальше: редактирование и обновления

- **Я (ассистент)** работаю с файлами в твоей папке `d:\Cursor` — это и есть «доступ к редактированию». Отдельно меня никуда входить не нужно.
- Ты заливаешь изменения на GitHub так:
  ```powershell
  git add .
  git commit -m "что сделано"
  git push
  ```
- На сервере обновление — по инструкции из **DEPLOY.md** (например `./deploy.sh` или автодеплой по push).

Итого: настроил Git (имя, почта) → вошёл в GitHub (CLI / токен / SSH) → создал пустой репозиторий → выполнил команды из шага 5. После этого проект на GitHub, а я по-прежнему редактирую код у тебя локально в `d:\Cursor`.
