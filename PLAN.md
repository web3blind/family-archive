# PLAN.md — Семейное древо

## Очистка сборочных остатков — 2026-10-02

- Status: удалены 18 подтверждённых generated/scratch-целей, освобождено 11.07 GiB; после удаления свободно 46.20 GiB. Отсутствие выбранных целей и неизменность всех tracked-файлов проверены.
- Исключения: `family-release-0.2.0` сохранён — локальный Windows ZIP отличается от опубликованного; `android/app/build/` сохранён — файл lint-cache открыт процессом PID 1347920. Процесс не останавливался. Остальные небольшие QA-материалы и временные fixtures не удалялись.

- Scope: только локальные воспроизводимые сборки `dist-desktop/`, `www/`, `android/app/build/`, `android/build/`; scratch `family-packaged-portable-*`, локальные `family-release-0.2.0`/`0.3.0`/`0.3.1`/`0.3.2`/`0.3.3` и скачанный `family-jdk21.tar.gz`.
- Preservation: Git/исходники/семейные данные/backup не трогать; сохранить node_modules, установленный JDK, Gradle cache, старый Linux executable для migration-регрессии и небольшие QA-свидетельства. GitHub-релизы не удалять.
- Verification: до удаления проверить отсутствие использующих цели процессов, соответствие release ZIP/APK опубликованным assets (size/SHA-256), отсутствие tracked-файлов в generated-целях; после — отсутствие ровно выбранных путей, сохранность tracked-файлов, свободное место и чистый Git после docs-only commit.
- Stop: неизвестные данные, живой процесс в цели или непроверенный release asset — исключить соответствующую цель, а не удалять наугад.

## Актуализация AGENTS.md — 2026-10-02

- Status: выполнено; создан `AGENTS.md`, правила сверены с текущими исходниками и TESTING.md. Статические проверки путей, npm-команд, Android-классов и версии прошли; `git diff --check` без ошибок. Runtime-тесты не запускались: изменение только документационное.
- Outcome: создать отсутствующий проектный `AGENTS.md` по коду 0.3.3 и последней сессии, без изменения приложения и пользовательских данных.
- Scope: `AGENTS.md` и этот блок плана; прежние секции ниже — исторические планы этапов, их отметки «не опубликовано» не отражают состоявшийся релиз 0.3.3.
- Содержание: карта frontend/Electron/Android, точные команды, schema v1, привязки медиа/черновиков, переносимое `data/`, безопасная legacy-миграция, границы проверок и сборок.
- Verification: сверить правила с исходниками, package.json и TESTING.md; проверить пути/команды и `git diff --check`; приложение не пересобирать для документационного изменения.
- Boundaries: не менять код, README, TESTING.md, версии, релизы, runtime data или другие проекты; не запускать миграцию/приложение на реальном профиле.
- Definition of Done: инструкции соответствуют текущим исходникам, не повторяют устаревшие ограничения старого MVP; reviewed docs-only commit опубликован в существующий origin/main без нового релиза.


## Portable desktop storage — approved correction

Outcome: executable-adjacent data/ (macOS beside .app), including Chromium session/drafts, archive/media, imports and relative selected archive. First launch creates durable empty archive/config/identity. FAMILY_ARCHIVE_DATA_DIR isolates tests. Browser/Android unchanged. No version bump, commit, push or release.
Data safety: old Electron userData is read-only; stage a verified complete profile backup plus working profile/archive copy, validate JSON/media and SHA-256 bytes, atomically publish only absent data. Existing data has priority; malformed/missing selected legacy archives, unsafe paths/symlinks, concurrent/live migration and unwritable targets fail visibly without empty fallback. No real host profiles touched; synthetic fixtures under Hermes scratch only. Copy externally opened folders into data/imports; never depend on their continued presence. Preserve existing identity for migrated drafts, and stable portable archive identities across whole-folder relocation without accepting unrelated archive drafts.
Verification: RED/GREEN Node filesystem regression tests; npm test; Linux package; actual packaged Electron first-run/migration/restart/relocation/draft and media/export roundtrip under Xvfb; unwritable startup failure. Windows/macOS path derivation tested as pure behavior; native OS execution not claimed. Independent safety review/release remain parent-owned.

Draft-only blocking correction: default old archive with identity but no canonical/backup now migrates the same archive slot and old identity, materializing the exact old desktop fallback only in the staged working copy. Prior desktop protocol denies bundled archive.json (404); native core ignores browser localStorage and actually returns the empty «Семейный архив» fallback. Backup-only or identity-less missing-canonical archives fail visibly instead of guessing an empty family. Source/profile backups remain byte-exact. Verified `node --test tests/portable-storage.test.cjs` 17/17, `npm test` 61/61, `npm run build:linux`, packaged old→new genuine never-saved draft first-run/restart plus all previous packaged cases. QA fixtures `family-packaged-portable-j7EE3Q`; previous QA ASAR reproduced both bugs in synthetic `family-draft-red-Sdjw7Z`. Changes limited to portable bootstrap, regressions and these docs; no commit, push, version bump or release. Parent independent delta review remains required.

Status: implemented, no release. `npm test` 59/59; new filesystem tests 15/15; Linux build and packaged relocation/migration driver passed. Final fixtures: Hermes scratch `family-packaged-portable-6X3kZn`; old packaged executable retained as `family-portable-old-linux-f00f5af`. ASAR byte comparisons confirm main/store/portable/preload/core match working sources. SIGKILL interrupted-copy regression passed; old source/profile originals and backup checksums verified. `.gitignore` protects dev data/staging/lock. Archive/config/imports and Chromium session/drafts are portable; normal Linux shared font/GPU caches and NSS trust database can still be generated under HOME (not archive/draft state, no dependency; changing HOME relocation passed). First full suite encountered a Chromium timeout under host load; subsequent full runs passed without changes to browser/Android code. Native OS dialogs/Windows/macOS runtime and independent safety review remain unverified, not released.


## Native applications — approved scope (2026-09-30)

Status: implementation and five local 0.2.0 test builds are prepared. See TESTING.md for actual executed checks and remaining device/OS acceptance. Android/TalkBack and Windows/macOS/NVDA runtime acceptance is NOT claimed. No public release or push.

- Outcome: audit and improve the existing archive; desktop Windows/Linux/macOS and Android apps with native media selection, durable saving, full archive import/export and existing JSON compatibility.
- Architecture: retain HTML/CSS/JS and portable archive.json + media/. Electron desktop follows books-selection patterns (reference only); Capacitor Android uses a narrow native plugin for private storage and system file pickers. No backend/account/cloud sync/AI features.
- Boundaries: only family-tree repository; books-selection read-only. No production deployment, paid infrastructure, personal family fixtures or signing credentials. No main-host Android emulation.
- Backup: verified tar.gz of entire original repository under Hermes scratch before edits. User data archive.json and media must not be overwritten by fixtures.
- Shared bridge: window.FamilyArchiveNative exposes platform, readArchive(), writeArchive(archive), pickMedia(), mediaUrl(path), openArchive(), importArchive(), exportArchive(). readArchive resolves JSON object/null; writeArchive resolves after durable write; pickMedia resolves {path,type,title} or null (already copied safely); mediaUrl synchronous; archive picker/import resolves JSON object/null; export resolves status/null. Frontend must report durable save failures, serialize writes and preserve browser-only mode. Desktop API comes from isolated preload; Android adapter uses Capacitor plugin FamilyArchive.
- Audit roles: Engineering/security/data integrity; UX/accessibility/portability. Prioritize malformed imports, unsafe paths/HTML, overwrite collisions, stale localStorage, failed writes, focus and small-screen controls.
- Stages: 1 audit+core fixes; 2 native adapters and archive/media controls; 3 desktop packaging and Android project; 4 connected flows/tests/builds; 5 independent review, fix deltas, document precise verification and remaining platform limits.
- Verification: Node behavioral regression tests, real Chromium frontend smoke, actual Electron Linux launch and filesystem roundtrip, Linux/Windows build where available, Android APK compilation with official SDK if available; macOS build/runtime require macOS runner. Never conflate packaging, mocked bridge tests, structural accessibility and actual screen-reader/device execution.
- Stop conditions: paid testing infrastructure, app-store/public release, signing/credential changes, destructive user-data operations or missing platform-specific execution resources. Complete safe independent parts before reporting a concrete limitation.
- Status: implementation in progress; no platform claimed complete until its evidence is collected.


## 1. Идея проекта

**Семейное древо** — переносимый семейный цифровой архив без обязательного сервера, Node.js, базы данных и централизованного сервиса.

Цель: дать семье простой способ хранить и пополнять память о предках и родственниках в виде одного локального архива:

```text
family-archive/
  index.html
  edit.html
  archive.json
  assets/
    css/
    js/
  media/
    denis.svg
    interview.mp3
    family-video.mp4
    letter.pdf
```

Архив можно скопировать на флешку, телефон, компьютер, облако или отправить родственникам. Данные должны оставаться у семьи.

## 2. Главная ценность

- Семейная память не зависит от внешнего сервиса.
- Всё хранится в простой папке, которую можно копировать и архивировать.
- Обычный пользователь заполняет формы, а не разбирается с Node.js, серверами или GitHub.
- Главный вид — семейное древо.
- Главный смысл карточки человека — не только даты и связи, но и ответ: **что важно помнить об этом человеке**.

## 3. Формат MVP

MVP может быть разделён на два HTML-файла:

1. **`index.html` / View / Вид** — режим просмотра по умолчанию: древо, список людей, раскрытые карточки, истории и медиа.
2. **`edit.html` / Edit / Изменить** — отдельный режим заполнения и редактирования форм.

Такой вариант предпочтителен для продукта: просмотр остаётся чистым и простым, а редактор не перегружает основной интерфейс.

Важно: это должен быть полноценный проект семейного архива, а не только набор форм. Пользователь должен получать результат: просматриваемое древо, понятный список людей, раскрытые карточки, связанные истории и экспортируемый архив данных.

Дополнительные файлы:

- `archive.json` — данные архива.
- `assets/` — стили и JavaScript приложения.
- `media/` — единая папка для фото, аудио, видео и документов; тип хранится в JSON и определяется редактором по файлу.

## 4. Основные пользовательские сценарии

### 4.1 Просмотр

Пользователь открывает `index.html` и видит:

- семейное древо;
- список людей;
- поиск по ФИО;
- краткие карточки людей в списке;
- раскрытую карточку выбранного человека;
- связанные истории, фото, аудио и документы;
- просмотр изображений в полноразмерном режиме через доступный lightbox.

Краткая карточка человека в списке должна показывать только:

- основное фото;
- ФИО;
- место жизни;
- “Что важно помнить” / “Чем запомнился семье”.

Остальные данные показываются только после раскрытия/открытия полной карточки, чтобы список не был перегружен.

### 4.2 Редактирование

Пользователь открывает `edit.html` или переходит в редактор из `index.html` и может:

- добавить человека;
- указать мать и отца;
- заполнить карточку;
- добавить историю или воспоминание;
- прикрепить медиафайл;
- импортировать JSON;
- экспортировать JSON как скачиваемый файл `archive.json`, по dashboard-подходу;
- сохранить черновик/текущее состояние в `localStorage`;
- подготовить архив к копированию.

### 4.3 Передача архива

Базовый сценарий:

- пользователь экспортирует `archive.json`;
- копирует папку `family-archive/` целиком;
- передаёт родственникам через флешку, облако, Telegram/мессенджер или архив ZIP.

## 5. Древо

Главное представление данных — дерево предков:

```text
Я
├─ Родители: 2
├─ Бабушки/дедушки: 4
├─ Прабабушки/прадедушки: 8
├─ Следующее поколение: 16
└─ дальше, пока есть данные
```

Требования:

- выбрать корневого человека;
- показать родителей, родителей родителей и так далее;
- если данных нет — показывать “неизвестно”;
- карточка человека открывается из дерева;
- позже добавить режим потомков и ближайшей семьи.

## 6. Карточка человека

### 6.1 Краткая карточка в списке

Показывает только главное для быстрого узнавания человека:

- основное фото;
- ФИО;
- место жизни;
- “Что важно помнить” / “Чем запомнился семье”.

Краткая карточка должна быть кнопкой или содержать явную кнопку раскрытия с понятным доступным именем, например “Открыть карточку: Иван Петров”.

### 6.2 Полная карточка

Минимальные поля:

- ID;
- ФИО;
- дата рождения;
- дата смерти;
- страна;
- город / область / деревня;
- мать;
- отец;
- “Что важно помнить” / “Чем запомнился семье”;
- короткая биография;
- связанные истории;
- связанные медиа.

Поле “Что важно помнить” — ключевое отличие проекта от обычной генеалогической таблицы.

Примеры:

- красиво пел фронтовые песни;
- вырастила шестерых детей;
- прошёл войну;
- заменил отца;
- построил дом;
- сохранила семью в трудные годы.

## 7. Данные

Базовая структура `archive.json`:

```json
{
  "version": 1,
  "title": "Семейное древо",
  "rootPersonId": null,
  "people": [],
  "stories": [],
  "media": []
}
```

### 7.1 Person

```json
{
  "id": "person-1",
  "fullName": "",
  "birthDate": "",
  "deathDate": "",
  "country": "",
  "place": "",
  "motherId": null,
  "fatherId": null,
  "rememberFor": "",
  "bio": "",
  "storyIds": [],
  "mediaIds": []
}
```

### 7.2 Story

```json
{
  "id": "story-1",
  "title": "",
  "text": "",
  "personIds": [],
  "date": "",
  "author": "",
  "mediaIds": []
}
```

### 7.3 Media

```json
{
  "id": "media-1",
  "type": "photo|audio|video|document",
  "title": "",
  "path": "media/file.jpg",
  "personIds": [],
  "storyIds": []
}
```

## 8. Работа с файлами

### Production-вариант

- Все файлы лежат в единой папке `media/`, без обязательных подпапок по типам.
- В редакторе есть выбор файла через input.
- Редактор определяет тип файла по MIME type и/или расширению.
- Редактор формирует относительный путь вида `media/file-name.ext`.
- В Chromium/Chrome при поддержке File System Access API пользователь может разрешить папку архива, и редактор копирует выбранный файл в `media/`.
- В браузерах без File System Access API пользователь вручную кладёт файл в `media/`, а редактор помогает сформировать правильный путь.
- HTML сохраняет путь и тип в JSON/localStorage.

### Не делаем

- ZIP-экспорт как функцию приложения: пользователь может архивировать папку сайта средствами ОС.

## 9. Визуальный стиль и просмотр медиа

Визуал нужно делать сразу, не откладывая “на потом”. Настроение интерфейса: тёплый семейный архив, память, бережное хранение историй.

Ориентиры:

- мягкая тёплая палитра;
- спокойная типографика;
- ощущение семейного альбома, но без декоративной перегрузки;
- хороший контраст текста;
- аккуратные карточки, которые работают и визуально, и со скринридером;
- фотографии — важная часть эмоционального результата, а не второстепенное вложение.

Для режима просмотра нужен lightbox:

- открыть фото из карточки/галереи в полноразмерном виде;
- закрытие по кнопке, Escape и клику вне изображения;
- доступное имя диалога;
- фокус должен переноситься внутрь lightbox и возвращаться назад после закрытия;
- для скринридера обязательно показывать подпись/alt/название изображения.

## 10. Доступность

Проект должен быть удобен со скринридером.

Требования:

- семантический HTML;
- нормальные заголовки;
- кнопки именно `<button>`;
- поля с `<label>`;
- клавиатурная навигация;
- дерево не должно быть только визуальной схемой — нужен текстовый/иерархический режим;
- понятные сообщения об импорте, экспорте и ошибках.

## 11. Нефункциональные требования

- Работает без сервера.
- Работает как статический HTML насколько возможно.
- Данные человекочитаемые.
- Архив можно открыть и понять даже без приложения.
- Нельзя завязываться на SaaS как обязательную часть.
- Не использовать блокчейн в MVP.
- Не требовать установки Node.js от пользователя.
- Можно использовать идеи и подходы `/dashboard` для удобства интерфейса: вкладки, прогресс заполнения, localStorage, импорт/экспорт JSON, доступные элементы формы.
- Нельзя генерировать проект целиком через `/dashboard` как конечное решение: его возможности ограничены для этой задачи.
- Интерфейс должен быть продуктовым: не просто “формы для ввода”, а готовый просмотр семейной памяти и результата заполнения.

## 12. Фазы разработки

### Фаза 1 — прототип

- Создать `index.html` для просмотра.
- Создать `edit.html` для редактирования.
- Создать структуру `assets/css/` и `assets/js/` для стилей и логики.
- Добавить тёплый визуальный стиль семейного архива сразу в MVP.
- Добавить demo-данные внутри JS или отдельного JSON.
- Реализовать переход из просмотра в редактор и обратно.
- Реализовать список людей.
- Реализовать краткие карточки людей в списке: основное фото, ФИО, место жизни, чем запомнился семье.
- Реализовать раскрытие полной карточки человека без перегруза списка.
- Реализовать lightbox для полноразмерного просмотра изображений.
- Реализовать форму добавления/редактирования человека.
- Сохранять состояние в localStorage.
- Экспортировать JSON.
- Импортировать JSON.

### Фаза 2 — древо

- Выбор корневого человека.
- Построение дерева предков по `motherId` и `fatherId`.
- Отображение поколений: 2, 4, 8, 16 и дальше.
- Переход из узла дерева в карточку.
- Текстовый доступный режим дерева.

### Фаза 3 — истории и медиа

- Добавить сущность stories.
- Добавить сущность media.
- Связывать истории и медиа с людьми.
- Показывать истории в карточке человека.
- Показывать относительные пути к медиа.

### Фаза 4 — переносимость

- Подготовить структуру папки `family-archive/`.
- Добавить инструкцию для обычного пользователя.
- ZIP-экспорт не делать как функцию приложения: пользователь может архивировать папку сайта средствами ОС.
- Улучшить workflow добавления медиа: редактор должен помогать выбрать файл, определить тип контента, сформировать корректный относительный путь `media/...`, проверить доступность файла в просмотре и, где возможно, запросить у браузера разрешение на папку архива для копирования файла.
- Использовать единую папку `media/` без разделения на `photos/audio/video/documents`: тип определяется по MIME type и/или расширению файла, а пользователю проще не думать о подпапках.
- Продумать импорт изменений из другой копии архива.

### Фаза 5 — ИИ-помощник, позже

Не MVP.

Возможные функции:

- расшифровка аудио;
- оформление воспоминаний в аккуратный текст;
- вопросы для интервью родственников;
- генерация семейной книги PDF/HTML;
- поиск противоречий в датах и связях.

## 13. Риски

- Локальный HTML ограничен в записи файлов.
- На телефонах работа с папками может быть неудобной.
- Конфликты при редактировании несколькими родственниками.
- Нужно не усложнить UX техническими деталями.
- Дерево может стать сложным для визуального и screen reader представления.

## 14. Принятые решения

- Основной формат: `index.html` + `edit.html` + `archive.json` + `assets/` + `media/`.
- Все стили и JavaScript лежат в `assets/`, а не вперемешку с данными и медиа.
- `index.html` отвечает за чистый режим просмотра.
- `edit.html` отвечает за заполнение и редактирование данных.
- Основной режим просмотра: семейное древо.
- В списке людей показывается только краткая карточка: основное фото, ФИО, место жизни и чем человек запомнился семье.
- Все остальные данные показываются после раскрытия полной карточки.
- Данные хранятся локально, без обязательного сервера.
- MVP не использует блокчейн.
- MVP не требует Node.js от пользователя.
- Редактирование через формы в HTML.
- `/dashboard` можно использовать как UX-ориентир или вспомогательный прототип, но не как генератор конечного проекта.
- Конечный продукт должен давать полноценный результат просмотра: древо, карточки, истории и медиа, а не только заполнение полей.
- Визуал MVP сразу должен быть тёплым, ассоциироваться с семейной памятью и архивом.
- В режиме просмотра нужен lightbox для полноразмерного раскрытия изображений.
- Экспорт/импорт JSON обязателен.
- `localStorage` допустим как временное/удобное хранилище черновика, но не как единственный источник истины.
- Экспорт должен скачивать полноценный файл `archive.json`, который пользователь кладёт рядом с `index.html` и `edit.html`.
- ZIP-экспорт не нужен: переносимость решается копированием или архивированием всей папки средствами ОС.
- Media workflow production-pass: редактор выбирает файл, определяет тип, формирует путь `media/file-name.ext`; в Chromium через File System Access API может копировать файл в `media/` после разрешения папки архива.
- Используется единая папка `media/`: меньше ручных решений для пользователя, а тип контента определяется скриптом по MIME type/расширению.

## Person media isolation — approved refinement

Show only related attachments in each person card and select main photo only among that person's photographs. Add explicit accessible library-selection action to attach existing files (including shared photos) without copying or stealing links from others. Upload in person context remains automatically attached. Preserve drafts, reciprocal/legacy one-sided associations, photos during attach/unlink/cancel, existing archives and independent library. Verify with real Chromium: child photos absent from mother card; shared photo intentionally attached appears in both; unrelated photos remain hidden; upload/cancel/save/restart; no data loss. Publish updated Windows ZIP and Android APK after checks; no user archive mutation.

## Editor redesign — approved scope

Outcome: production-quality person-centred editor, no first-run wizard, numbered steps or prototype-only delivery. Preserve offline archive.json + media/, browser frontend, Windows and Android support and existing archives.

Scope: family overview/search; person screen with required name only, optional biography/dates; add/create/select mother and father with automatic relationship; cycle/duplicate prevention; change tree root; direct single/batch attachment upload in person card and independent media library; folder import where supported with honest Android fallback; choose existing attachments/main photo; stories in person context; shared attachments; accessible focus, inline errors, explicit destructive actions. No global discard of unrelated forms. Drafts survive navigation/restart, failed save keeps inputs. Imports/exports and viewer remain functional.

Boundaries: family-tree only. No real user data, unrelated projects, server/accounts/sync, broad storage permissions or private release-signing keys. Backup created at /home/assistent/.hermes/cache/scratch/family-editor-before.tar.gz. No migration/delete of user archives. Existing bridge extended compatibly. Release only after connected scenario checks; no claim NVDA/TalkBack verified without real evidence.

Implementation slices: (1) shared frontend/editor and scenario tests; (2) native batch file/folder bridge with bounded copying/tests; (3) integration/browser/Electron QA and independent review; (4) Windows ZIP and Android APK packaging, source publication and verified release assets. Other desktop builds only as necessary to keep shared packaging coherent.

Verification: npm test; native storage/adapter regressions; real browser/editor and isolated Electron scenarios (empty archive, name-only person, parents with existing/new choices, root, multi-file attachments and main photo, library unattached files, story, return/cancel, failed save/restart/draft, import/export). Android unit/lint/build and APK assets/signature; Windows ZIP entry/path checks. Keyboard/focus/accessible names checked; physical Windows/Android screen-reader evidence remains separately identified. Stop only for actual unavailable credentials or protected destructive actions.

## 15. Definition of Done для MVP

MVP считается готовым, если:

- пользователь может открыть `index.html` локально для просмотра;
- пользователь может открыть `edit.html` локально для редактирования;
- добавить минимум 3–5 человек;
- связать человека с матерью и отцом;
- увидеть дерево предков;
- открыть карточку человека;
- заполнить “Что важно помнить”;
- открыть фото в полноразмерном lightbox в режиме просмотра;
- увидеть тёплый, аккуратный визуальный стиль семейного архива;
- экспортировать JSON;
- импортировать JSON обратно;
- данные не теряются после перезагрузки страницы;
- интерфейс доступен с клавиатуры и screen reader.
