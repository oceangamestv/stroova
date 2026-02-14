# Сборка APK для Android (STroova)

Приложение собрано как веб-клиент (Vite + React) и упаковано в Android через **Capacitor**. В APK встроена только фронтенд-часть; данные (аккаунты, прогресс, словарь) запрашиваются с вашего сервера по URL из переменной окружения.

## Требования

- **Node.js** и **npm** (уже есть, если собираете проект)
- **Android Studio** или **Android SDK** (command-line tools) для сборки APK
- В **.env** при сборке должен быть задан **VITE_API_URL** — URL вашего API (боевой: `https://stroova.ru/api`), чтобы приложение на телефоне подключалось к серверу

## Быстрая сборка APK

### 1. URL бэкенда

- **Боевой APK:** URL задаётся в `.env.production` (по умолчанию `https://stroova.ru/api`).
- **Тестовый APK с локальным сервером:** используется `.env.development` (`http://localhost:3000/api`). Сборка: `npm run android:sync:local`. На устройстве в одной сети с компьютером может понадобиться подставить IP компа вместо `localhost`.

### 1.1. CORS на сервере (обязательно для работы приложения)

Мобильное приложение шлёт запросы с `Origin: capacitor://localhost`. На **сервере** (где крутится API) в `.env` нужно разрешить этот origin:

```env
CORS_ORIGIN=https://stroova.ru,https://www.stroova.ru,capacitor://localhost,http://localhost
```

(первый — URL сайта или домена, остальные — Capacitor Android/iOS). Без этого браузер в приложении блокирует ответы API.

### 2. Собрать веб-приложение и синхронизировать с Android

**Боевой сервер** (для публикации / теста с продакшен-API):

```powershell
npm run android:sync
```

**Локальный сервер** (для теста на устройстве с API на вашем компе, `http://localhost:3000/api`):

```powershell
npm run android:sync:local
```

Команда выполняет сборку (с соответствующим URL из `.env.production` или `.env.development`) и копирует результат в папку `android/`.

### 3. Собрать APK

**Вариант A — через Android Studio (рекомендуется)**

```powershell
npm run android:open
```

Откроется Android Studio с проектом `android/`. Дальше:

**Если выдаёт «Unable to launch Android Studio. Is it installed?»:**

- Установите [Android Studio](https://developer.android.com/studio) (при первом запуске он установит Android SDK и всё нужное для сборки).
- Если Android Studio уже стоит, но в нестандартной папке, укажите путь в переменной окружения:
  ```powershell
  $env:CAPACITOR_ANDROID_STUDIO_PATH = "C:\Program Files\Android\Android Studio\bin\studio64.exe"
  npm run android:open
  ```
  (Подставьте свой путь к `studio64.exe`.)

1. **Build → Build Bundle(s) / APK(s) → Build APK(s)**
2. Готовый APK будет в  
   `android/app/build/outputs/apk/debug/app-debug.apk`  
   (или `release` при сборке Release).

**Если просят указать путь к Android SDK («Select SDKs» / «Please provide the path to the Android SDK»):**

- **Что это:** Android SDK — набор инструментов и библиотек для сборки приложений под Android. Без него APK собрать нельзя.
- **Где взять:** Проще всего установить [Android Studio](https://developer.android.com/studio): при установке он сам скачает и поставит SDK. Отдельно SDK можно взять на [developer.android.com/studio](https://developer.android.com/studio) (командные инструменты).
- **Куда указать путь в диалоге:** Если Android Studio уже ставили, SDK обычно лежит здесь:
  - **Windows:** `C:\Users\<ВашеИмя>\AppData\Local\Android\Sdk`
  - Подставьте своё имя пользователя вместо `<ВашеИмя>` или нажмите иконку папки в диалоге и выберите папку `Sdk` внутри `Android` (в `AppData\Local`).
  - После указания пути нажмите **OK**.

**Вариант B — из командной строки (если установлен Android SDK)**

```powershell
cd android
.\gradlew.bat assembleDebug
```

APK: `android\app\build\outputs\apk\debug\app-debug.apk`.

Для подписанного release-APK настройте подпись в Android Studio (Build → Generate Signed Bundle / APK) или в `app/build.gradle` (signingConfigs).

## Полезные команды

| Команда | Описание |
|--------|----------|
| `npm run android:sync` | Сборка с боевым API и копирование в `android/` |
| `npm run android:sync:local` | Сборка с локальным API (localhost) и копирование в `android/` |
| `npm run android:open` | Открыть проект в Android Studio |
| `npx cap run android` | Запуск на подключённом устройстве или эмуляторе (при установленном Android SDK) |

## Иконка приложения

**Как добавить логотип в этот билд:** положите картинку в `public/logo.png` (квадрат 512×512 px или больше), затем откройте проект в Android Studio и создайте иконку из этого файла (шаги ниже). После этого пересоберите APK.

Сейчас в приложении стоит стандартная иконка Capacitor. Чтобы поставить свою (например, логотип из `public/logo.png`):

### Способ 1: Android Studio (удобнее всего)

1. Откройте проект: `npm run android:open`.
2. В левом дереве: **app** → правый клик по папке **res** → **New** → **Image Asset**.
3. В окне **Asset Type** оставьте **Launcher Icons (Adaptive and Legacy)**.
4. В поле **Path** нажмите на иконку папки и выберите ваш файл (например `d:\Cursor\public\logo.png`). Иконка должна быть квадратной, лучше не меньше 512×512 px.
5. При необходимости подгоните **Trim** и **Padding** (отступы).
6. Нажмите **Next**, затем **Finish**. Android Studio сгенерирует все размеры и заменит `ic_launcher`, `ic_launcher_round` и foreground для адаптивной иконки.
7. Пересоберите APK (Build → Generate App Bundles or APKs → Build APK(s)).

### Способ 2: Генератор в браузере

1. Зайдите на [icon.kitchen](https://icon.kitchen) или [appicon.co](https://appicon.co).
2. Загрузите квадратную картинку (например `public/logo.png`, 512×512 или больше).
3. Скачайте архив с иконками для Android.
4. Распакуйте и скопируйте содержимое папок **mipmap-hdpi**, **mipmap-mdpi**, **mipmap-xhdpi**, **mipmap-xxhdpi**, **mipmap-xxxhdpi** в `android/app/src/main/res/`, подменяя файлы `ic_launcher.png`, `ic_launcher_round.png`, `ic_launcher_foreground.png` (если в архиве есть такие имена; иначе замените то, что соответствует иконке лаунчера).
5. Пересоберите APK.

Иконка задаётся в `AndroidManifest.xml` как `@mipmap/ic_launcher` (обычная) и `@mipmap/ic_launcher_round` (круглая); после замены файлов в `res` менять манифест не нужно.

## Размер APK

В APK **не попадают** предгенерированные WAV: перед `cap copy` папка `dist/audio` удаляется. Озвучка слов грузится **с сервера** по URL вида `https://ваш-домен/audio/female/slug.wav`. Чтобы в приложении звук воспроизводился, на сервере должны быть файлы в `dist/audio/` и **Nginx должен отдавать CORS** для пути `/audio/` (иначе WebView блокирует загрузку).

### CORS для озвучки на сервере (Nginx)

В конфиг сайта (например `/etc/nginx/sites-available/stroova`) добавь блок **до** `location /`:

```nginx
    location /audio/ {
        add_header Access-Control-Allow-Origin *;
    }
```

Проверка: `sudo nginx -t`, затем `sudo systemctl reload nginx`. После этого приложение сможет загружать WAV с сервера.

## Структура

- **capacitor.config.ts** — настройки Capacitor (appId: `ru.stroova.app`, webDir: `dist`)
- **android/** — нативный Android-проект; после `cap copy` в `android/app/src/main/assets/public` попадает собранный фронт (без папки `audio`)
- **vite.config.ts** — для мобильной сборки используется `base: "./"`, чтобы ресурсы корректно подгружались в WebView

## Если Gradle пишет «Could not read script capacitor.settings.gradle»

Такое бывает, если папка `android/` была скопирована без этих файлов или они удалились. В проекте уже должны быть созданы:

- `android/capacitor.settings.gradle`
- `android/app/capacitor.build.gradle`
- `android/capacitor-cordova-android-plugins/cordova.variables.gradle`

Если ошибка повторится, из корня проекта выполните `npx cap sync android` — Capacitor пересоздаст эти файлы.

## Важно

- Меняете фронт → снова выполните `npm run android:sync`, затем пересоберите APK в Android Studio или через `gradlew`.
- Меняете только сервер (без изменений фронта) → пересборка APK не нужна; приложение уже обращается к `VITE_API_URL`, заданному на шаге 1.
- Для публикации в Google Play нужен подписанный release-APK (или AAB) и настройка подписи в проекте.
