# Семейный архив — инструкции проекта

## Контекст и архитектура

- Репозиторий: `web3blind/family-archive`; локальный проект: `/home/assistent/ai-projects/family-tree`. Текущая опубликованная версия — 0.3.3, а не прежний HTML-only MVP.
- Офлайн-приложение без обязательного сервера, аккаунтов и облачной синхронизации: общий HTML/JS frontend, Electron desktop и Capacitor 7 Android.
- `index.html` / `assets/js/view.js` — просмотр; `edit.html` / `assets/js/editor.js` — редактор; `assets/css/styles.css` — общие стили.
- `assets/js/archive-core.js` — schema v1, валидация и загрузка/сохранение; `editor-model.js` — чистые операции над карточками и двусторонними связями; `platform.js` — browser/native адаптер.
- `desktop/main.cjs` — bootstrap, `family://app`, IPC и системные диалоги; `preload.cjs` — ограниченный native bridge; `store.cjs` — файловый архив/медиа/ZIP; `portable.cjs` — переносимое хранение и legacy-миграция.
- Android native-код находится в `android/app/src/main/java/xyz/blinddev/familyarchive/`: `FamilyArchivePlugin`, `ArchiveStore`, `ArchiveValidator`, `MediaBatchImporter`.
- Источники frontend — корневые HTML и `assets/`; `www/` и Android `assets/public/` генерируются. Не исправлять только сгенерированные копии.

## Запуск и проверки

- Node.js: `>=22.12.0 <25`; зависимости: `npm ci`. Общие проверки: `npm test`.
- Browser: `python3 -m http.server 4177 --bind 127.0.0.1`, затем `/index.html` или `/edit.html`. `file://` может ограничивать загрузку JSON.
- Desktop: `npm run desktop:start`; для безопасных тестов задавать `FAMILY_ARCHIVE_DATA_DIR` в отдельной scratch-папке — override также отключает чтение старого профиля.
- Electron UI: `xvfb-run -a node_modules/.bin/electron --no-sandbox tests/editor-electron.cjs`; layout: аналогично `tests/visual-layout-electron.cjs`. `--no-sandbox` здесь — параметр Linux test harness, не изменение production-настроек окна.
- Переносимое хранилище: `node --test tests/portable-storage.test.cjs`. Packaged old→new: `xvfb-run -a node scripts/test-portable-desktop.cjs --old=/absolute/path/to/old-linux-package`; нужен прежний Linux пакет и новая сборка в `dist-desktop/linux-unpacked/`.
- Сборки: `npm run build:linux`, `npm run build:windows`, `npm run build:mac`; команды используют `--publish never`, результат в `dist-desktop/`. Упаковка не является публикацией релиза или доказательством запуска на целевой ОС.
- Android: JDK 21, SDK platform 35 / build-tools 35.0.0; `npm run android:sync`, затем из `android/`: `./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --no-daemon`. APK: `android/app/build/outputs/apk/debug/app-debug.apk`.
- `TESTING.md` содержит доказательства и ограничения прошлых проверок. Linux Chromium/Electron и JVM не заменяют Windows/macOS runtime, реальные Android picker/provider диалоги или NVDA/TalkBack.

## Данные и редактор

- Сохранять переносимый формат schema v1: `archive.json` + относительные файлы `media/`; browser/desktop/Android должны читать совместимые архивы. Для изменений валидатора обновлять JS/Java и общий корпус `tests/fixtures/archive-validation.json`.
- История поддерживает одну необязательную `category`: `family-stories`, `letters`, `knowledge`, `place-home`, `plans-results`, `book-introduction`; пустая строка — без категории. Отсутствие/null нормализуется без добавления поля, чтобы сохранять точную базу старых черновиков. JS/Java валидаторы отклоняют неизвестные ID и нестроковые значения. Метки определены в core; фильтр редактора хранится в локальной session, не JSON архива. Старое приложение при сохранении может потерять категории; текущие изменения исходников ещё не входят в опубликованную 0.3.3.
- Для человека обязательно только имя. Редактор ориентирован на карточку человека: родители, истории, пакетная загрузка файлов/папки, главное фото; общая библиотека может содержать непривязанные файлы.
- В карточке показывать только вложения этого человека; существующие файлы добавлять явно из библиотеки. Главное фото — связанное фото этого человека. Общий файл может иметь несколько связей без копирования байтов; снятие связи не удаляет файл или связи других людей.
- Не превращать metadata-дедупликацию в потерю файлов: одинаковые имя/размер/дата не доказывают одинаковые байты. Сохранять двусторонние ссылки людей, историй и медиа через модель.
- Черновики форм не равны подтверждённому архиву. Native-черновики привязаны к identity/поколению архива; повторно проверять identity перед восстановлением/сохранением, не восстанавливать чужие или устаревшие поля. Отмена, смена карточки и ошибка записи не должны незаметно очищать ввод.
- Native canonical JSON сохраняется на диск; browser использует localStorage/скачивание JSON. Не подменять native данные browser-черновиком или bundled demo `archive.json`.
- ZIP переносит JSON и все безопасные файлы `media/`, включая файлы без записей, но не Chromium-черновики. Удаление записи медиа само по себе не удаляет файл.

## Переносимое хранение и безопасность

- Desktop 0.3.3 хранит `data/` рядом с executable Windows/Linux; на macOS — рядом с `.app`, вне bundle; development — в корне проекта. Переносить закрытое приложение вместе с `data/`; обновление не должно удалять/включать пользовательскую `data/` в пакет.
- `data/` содержит рабочий архив (`archive/archive.json`, `archive/media/` при свежем запуске), `imports/`, относительный `selected-archive.json`, identity-маркеры и `session/` с Chromium/localStorage/черновиками. Выбранная внешняя папка копируется в `data/imports/`; оригинал не редактируется. Существующая внутренняя папка может открываться непосредственно.
- Bootstrap выполняется до открытия Chromium DB. При отсутствии `data/` legacy-профиль и выбранный архив копируются с проверкой SHA-256 в `legacy-backup/`; подготовленная рабочая копия публикуется атомарно. Оригинал не менять; существующая `data/` имеет приоритет.
- Не упрощать fail-closed сценарии: повреждённые JSON/identity, потерянные медиа, небезопасные ссылки, пересечение исходной/целевой папки и невозможность записи должны останавливать запуск, не создавать пустую семью и не переключаться скрыто на системный профиль.
- Draft-only legacy без canonical JSON восстанавливается только в известном состоянии с identity и без `.bak`, с точной пустой fallback-базой и прежней identity. `archive.json.bak` без canonical JSON требует ручного восстановления; не угадывать данные автоматически.
- Сохранять bootstrap/single-instance блокировки, identity/slot/generation проверки и безопасный повтор после прерванного переноса; `data.stage-*` не является рабочим архивом.
- Android хранит архив внутри приложения; удаление приложения уничтожает его. Обновлять APK поверх установки; до удаления нужен внешний полный ZIP. Debug-подпись не предназначена для магазина.
- Не трогать реальные семейные архивы, старые профили, `data/`, резервные копии и ключи подписи при QA. Test fixtures — только в изолированной scratch-папке. Эти данные не входят в Git/релиз.
- Сохранять sandbox/contextIsolation, отключённый nodeIntegration, проверки отправителя IPC, ограниченный `family://` protocol и безопасные media/ZIP пути. Ошибка импорта/записи не должна уничтожать текущий архив.

## Связанные изменения

- При изменении frontend синхронизировать Android web-assets перед сборкой; при изменении native bridge проверять путь frontend → preload/plugin → store, не только отдельный метод.
- При изменении хранения сохранять JSON, байты всех медиа, identity и черновики через migration → restart → relocation; полноценный ZIP не заменяет резервную копию session/черновиков.
- Для выпуска согласовывать `package.json`/lock и Android versionName/versionCode; сверять содержимое desktop ASAR, APK assets и опубликованные SHA-256. Не включать реальные архивы/профили в пакеты.
- Обновлять `README.md`, `TESTING.md` и этот файл при изменении соответствующих контрактов. `PLAN.md` содержит историю этапов: старые пункты «не опубликовано» не отменяют состоявшийся релиз; актуальное поведение проверять по коду и последним проверкам.
