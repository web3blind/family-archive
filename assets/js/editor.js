document.addEventListener('DOMContentLoaded', async () => {
  const core = window.FamilyArchive;
  let archive = await core.loadArchive();
  let currentPersonId = archive.people[0] ? archive.people[0].id : '';
  let currentStoryId = archive.stories[0] ? archive.stories[0].id : '';
  let currentMediaId = archive.media[0] ? archive.media[0].id : '';
  let archiveDirectoryHandle = null;
  let pendingMediaFile = null;

  const $ = (id) => document.getElementById(id);
  const fields = {
    archiveTitleInput: $('archiveTitleInput'), rootPersonInput: $('rootPersonInput'), editorStatus: $('editorStatus'), jsonOutput: $('jsonOutput'),
    personPicker: $('personPicker'), personForm: $('personForm'), personId: $('personId'), fullName: $('fullName'), birthDate: $('birthDate'), deathDate: $('deathDate'), country: $('country'), place: $('place'), motherId: $('motherId'), fatherId: $('fatherId'), primaryMediaId: $('primaryMediaId'), rememberFor: $('rememberFor'), bio: $('bio'), storyIds: $('storyIds'), mediaIds: $('mediaIds'),
    storyPicker: $('storyPicker'), storyForm: $('storyForm'), storyId: $('storyId'), storyTitle: $('storyTitle'), storyDate: $('storyDate'), storyAuthor: $('storyAuthor'), storyText: $('storyText'), storyPersonIds: $('storyPersonIds'), storyMediaIds: $('storyMediaIds'),
    mediaPicker: $('mediaPicker'), mediaForm: $('mediaForm'), mediaId: $('mediaId'), mediaTitle: $('mediaTitle'), mediaType: $('mediaType'), mediaPath: $('mediaPath'), mediaFileInput: $('mediaFileInput'), mediaFileHint: $('mediaFileHint'), mediaPersonIds: $('mediaPersonIds'), mediaStoryIds: $('mediaStoryIds')
  };

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }

  function status(message) {
    fields.editorStatus.textContent = message;
  }

  function options(items, selected, includeEmpty = true, excludeId = '') {
    const selectedSet = new Set(Array.isArray(selected) ? selected : [selected].filter(Boolean));
    const empty = includeEmpty ? '<option value="">Не указано</option>' : '';
    return empty + items.filter((item) => item.id !== excludeId).map((item) => `<option value="${escapeHtml(item.id)}" ${selectedSet.has(item.id) ? 'selected' : ''}>${escapeHtml(item.fullName || item.title || item.id)}</option>`).join('');
  }

  function selectedValues(select) {
    return Array.from(select.selectedOptions).map((option) => option.value).filter(Boolean);
  }

  function sanitizeFileName(fileName) {
    const safeName = String(fileName || 'media-file')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return safeName || `media-${Date.now()}`;
  }

  function detectMediaType(file) {
    const mime = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    if (mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name)) return 'photo';
    if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)$/i.test(name)) return 'audio';
    if (mime.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi)$/i.test(name)) return 'video';
    return 'document';
  }

  function mediaPathForFile(file) {
    return `media/${sanitizeFileName(file?.name)}`;
  }

  function setMediaHint(message) {
    fields.mediaFileHint.textContent = message;
  }

  async function ensureArchiveFolderPermission() {
    if (!archiveDirectoryHandle) return false;
    if (typeof archiveDirectoryHandle.queryPermission !== 'function') return true;
    const current = await archiveDirectoryHandle.queryPermission({ mode: 'readwrite' });
    if (current === 'granted') return true;
    if (typeof archiveDirectoryHandle.requestPermission !== 'function') return false;
    const requested = await archiveDirectoryHandle.requestPermission({ mode: 'readwrite' });
    return requested === 'granted';
  }

  async function copyFileToMedia(file) {
    if (!file || !archiveDirectoryHandle) return false;
    if (!(await ensureArchiveFolderPermission())) return false;
    const mediaDirectory = await archiveDirectoryHandle.getDirectoryHandle('media', { create: true });
    const fileHandle = await mediaDirectory.getFileHandle(sanitizeFileName(file.name), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();
    return true;
  }

  async function copyPendingMediaIfPossible() {
    if (!pendingMediaFile) return false;
    try {
      const copied = await copyFileToMedia(pendingMediaFile);
      if (copied) setMediaHint(`Файл скопирован в ${mediaPathForFile(pendingMediaFile)}.`);
      return copied;
    } catch (error) {
      setMediaHint(`Не удалось скопировать файл автоматически: ${error.message}. Скопируйте его вручную в media/.`);
      return false;
    }
  }

  function syncJsonOutput() {
    fields.jsonOutput.value = JSON.stringify(core.ensureArchiveShape(archive), null, 2);
  }

  function persist(message = 'Сохранено в браузере.') {
    archive = core.saveArchive(archive);
    syncJsonOutput();
    status(message);
  }

  function renderPickers() {
    fields.archiveTitleInput.value = archive.title;
    fields.rootPersonInput.innerHTML = options(archive.people, archive.rootPersonId, false);
    fields.personPicker.innerHTML = options(archive.people, currentPersonId, false);
    fields.storyPicker.innerHTML = options(archive.stories, currentStoryId, false);
    fields.mediaPicker.innerHTML = options(archive.media, currentMediaId, false);
    syncJsonOutput();
  }

  function renderPersonForm() {
    const person = archive.people.find((item) => item.id === currentPersonId) || emptyPerson();
    fields.personId.value = person.id;
    fields.fullName.value = person.fullName;
    fields.birthDate.value = person.birthDate;
    fields.deathDate.value = person.deathDate;
    fields.country.value = person.country;
    fields.place.value = person.place;
    fields.motherId.innerHTML = options(archive.people, person.motherId, true, person.id);
    fields.fatherId.innerHTML = options(archive.people, person.fatherId, true, person.id);
    fields.primaryMediaId.innerHTML = options(archive.media.filter((item) => item.type === 'photo'), person.primaryMediaId, true);
    fields.rememberFor.value = person.rememberFor;
    fields.bio.value = person.bio;
    fields.storyIds.innerHTML = options(archive.stories, person.storyIds, false);
    fields.mediaIds.innerHTML = options(archive.media, person.mediaIds, false);
  }

  function renderStoryForm() {
    const story = archive.stories.find((item) => item.id === currentStoryId) || emptyStory();
    fields.storyId.value = story.id;
    fields.storyTitle.value = story.title;
    fields.storyDate.value = story.date;
    fields.storyAuthor.value = story.author;
    fields.storyText.value = story.text;
    fields.storyPersonIds.innerHTML = options(archive.people, story.personIds, false);
    fields.storyMediaIds.innerHTML = options(archive.media, story.mediaIds, false);
  }

  function renderMediaForm() {
    const media = archive.media.find((item) => item.id === currentMediaId) || emptyMedia();
    fields.mediaId.value = media.id;
    fields.mediaTitle.value = media.title;
    fields.mediaType.value = media.type;
    fields.mediaPath.value = media.path;
    fields.mediaPersonIds.innerHTML = options(archive.people, media.personIds, false);
    fields.mediaStoryIds.innerHTML = options(archive.stories, media.storyIds, false);
    fields.mediaFileInput.value = '';
    pendingMediaFile = null;
    setMediaHint('Можно выбрать файл: редактор определит тип и путь. В Chromium после разрешения папки архива файл будет скопирован в media/.');
  }

  function renderAll() {
    renderPickers();
    renderPersonForm();
    renderStoryForm();
    renderMediaForm();
  }

  function emptyPerson() {
    return { id: core.createId('person'), fullName: '', birthDate: '', deathDate: '', country: '', place: '', motherId: null, fatherId: null, primaryMediaId: '', rememberFor: '', bio: '', storyIds: [], mediaIds: [] };
  }
  function emptyStory() {
    return { id: core.createId('story'), title: '', text: '', personIds: [], date: '', author: '', mediaIds: [] };
  }
  function emptyMedia() {
    return { id: core.createId('media'), type: 'photo', title: '', path: '', personIds: [], storyIds: [] };
  }

  function validateRequired(value, message, field) {
    if (!String(value || '').trim()) {
      if (field) field.focus();
      throw new Error(message);
    }
  }

  function validateMediaPath(path) {
    const value = path.trim();
    if (!value.startsWith('media/') || value === 'media/') {
      throw new Error('Путь медиа должен начинаться с media/, например media/photo.jpg.');
    }
    if (value.includes('..') || value.includes('\\')) {
      throw new Error('Путь медиа не должен содержать .. или обратные слэши. Используйте формат media/file.jpg.');
    }
    return value;
  }

  function mediaTypeFromPath(path) {
    const name = String(path || '').toLowerCase();
    if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name)) return 'photo';
    if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(name)) return 'audio';
    if (/\.(mp4|webm|mov|m4v|avi)$/i.test(name)) return 'video';
    return 'document';
  }

  function validateMediaTypeMatchesPath(type, path) {
    const detected = mediaTypeFromPath(path);
    if (detected !== 'document' && detected !== type) {
      throw new Error(`Тип медиа выглядит как “${detected}”, а выбран “${type}”. Проверьте тип или файл.`);
    }
  }

  function wouldCreateParentCycle(personId, parentId) {
    if (!personId || !parentId) return false;
    if (personId === parentId) return true;
    const peopleMap = core.byId(archive.people);
    const visited = new Set();
    const stack = [parentId];
    while (stack.length) {
      const currentId = stack.pop();
      if (!currentId) continue;
      if (currentId === personId) return true;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const current = peopleMap.get(currentId);
      if (current) stack.push(current.motherId, current.fatherId);
    }
    return false;
  }

  function validatePerson(person) {
    validateRequired(person.fullName, 'Укажите ФИО человека.', fields.fullName);
    validateRequired(person.rememberFor, 'Заполните “Чем запомнился семье” — это главный текст карточки.', fields.rememberFor);
    if (wouldCreateParentCycle(person.id, person.motherId)) throw new Error('Мать выбрана так, что возникает цикл в дереве. Проверьте родственные связи.');
    if (wouldCreateParentCycle(person.id, person.fatherId)) throw new Error('Отец выбран так, что возникает цикл в дереве. Проверьте родственные связи.');
    const mediaMap = core.byId(archive.media);
    const primary = mediaMap.get(person.primaryMediaId);
    if (person.primaryMediaId && (!primary || primary.type !== 'photo')) {
      throw new Error('Главное фото должно ссылаться на медиа типа “Фото”.');
    }
  }

  function validateStory(story) {
    validateRequired(story.title, 'Укажите название истории.', fields.storyTitle);
    validateRequired(story.text, 'Заполните текст истории.', fields.storyText);
    if (!story.personIds.length) throw new Error('Свяжите историю хотя бы с одним человеком.');
  }

  function validateMedia(media) {
    validateRequired(media.title, 'Укажите название медиа.', fields.mediaTitle);
    media.path = validateMediaPath(media.path);
    validateMediaTypeMatchesPath(media.type, media.path);
    if (!media.personIds.length && !media.storyIds.length) {
      throw new Error('Свяжите медиа хотя бы с одним человеком или историей.');
    }
  }

  function upsert(collection, item) {
    const index = collection.findIndex((existing) => existing.id === item.id);
    if (index >= 0) collection[index] = item;
    else collection.push(item);
  }

  function crossLinkPerson(person) {
    archive.stories.forEach((story) => {
      story.personIds = story.personIds.filter((id) => id !== person.id);
      if (person.storyIds.includes(story.id)) story.personIds.push(person.id);
    });
    archive.media.forEach((media) => {
      media.personIds = media.personIds.filter((id) => id !== person.id);
      if (person.mediaIds.includes(media.id) || person.primaryMediaId === media.id) media.personIds.push(person.id);
    });
  }

  function crossLinkStory(story) {
    archive.people.forEach((person) => {
      person.storyIds = person.storyIds.filter((id) => id !== story.id);
      if (story.personIds.includes(person.id)) person.storyIds.push(story.id);
    });
    archive.media.forEach((media) => {
      media.storyIds = media.storyIds.filter((id) => id !== story.id);
      if (story.mediaIds.includes(media.id)) media.storyIds.push(story.id);
    });
  }

  function crossLinkMedia(media) {
    archive.people.forEach((person) => {
      person.mediaIds = person.mediaIds.filter((id) => id !== media.id);
      if (media.personIds.includes(person.id) || person.primaryMediaId === media.id) person.mediaIds.push(media.id);
    });
    archive.stories.forEach((story) => {
      story.mediaIds = story.mediaIds.filter((id) => id !== media.id);
      if (media.storyIds.includes(story.id)) story.mediaIds.push(media.id);
    });
  }

  fields.archiveTitleInput.addEventListener('input', () => { archive.title = fields.archiveTitleInput.value; syncJsonOutput(); });
  fields.rootPersonInput.addEventListener('change', () => { archive.rootPersonId = fields.rootPersonInput.value; persist('Корневой человек обновлён.'); renderAll(); });
  $('saveArchiveButton').addEventListener('click', () => persist());
  $('resetDemoButton').addEventListener('click', () => {
    archive = core.resetArchive();
    currentPersonId = archive.people[0]?.id || '';
    currentStoryId = archive.stories[0]?.id || '';
    currentMediaId = archive.media[0]?.id || '';
    renderAll();
    status('Демо-данные восстановлены.');
  });

  fields.personPicker.addEventListener('change', () => { currentPersonId = fields.personPicker.value; renderAll(); status('Карточка человека загружена.'); });
  $('newPersonButton').addEventListener('click', () => {
    const person = emptyPerson();
    archive.people.push(person);
    currentPersonId = person.id;
    renderAll();
    fields.fullName.focus();
    status('Создана новая карточка. Заполните поля и сохраните.');
  });
  fields.personForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const person = {
      id: fields.personId.value || core.createId('person'),
      fullName: fields.fullName.value.trim(),
      birthDate: fields.birthDate.value.trim(),
      deathDate: fields.deathDate.value.trim(),
      country: fields.country.value.trim(),
      place: fields.place.value.trim(),
      motherId: fields.motherId.value || null,
      fatherId: fields.fatherId.value || null,
      primaryMediaId: fields.primaryMediaId.value,
      rememberFor: fields.rememberFor.value.trim(),
      bio: fields.bio.value.trim(),
      storyIds: selectedValues(fields.storyIds),
      mediaIds: selectedValues(fields.mediaIds)
    };
    try {
      validatePerson(person);
    } catch (error) {
      status(error.message);
      return;
    }
    if (person.primaryMediaId && !person.mediaIds.includes(person.primaryMediaId)) person.mediaIds.push(person.primaryMediaId);
    upsert(archive.people, person);
    currentPersonId = person.id;
    if (!archive.rootPersonId) archive.rootPersonId = person.id;
    crossLinkPerson(person);
    persist(`Сохранён человек: ${person.fullName || person.id}.`);
    renderAll();
  });
  $('deletePersonButton').addEventListener('click', () => {
    if (!currentPersonId) return;
    const person = archive.people.find((item) => item.id === currentPersonId);
    if (!window.confirm(`Удалить человека “${person?.fullName || currentPersonId}”? Это действие нельзя отменить кнопкой назад.`)) return;
    archive.people = archive.people.filter((person) => person.id !== currentPersonId);
    archive.people.forEach((person) => { if (person.motherId === currentPersonId) person.motherId = null; if (person.fatherId === currentPersonId) person.fatherId = null; });
    archive.stories.forEach((story) => { story.personIds = story.personIds.filter((id) => id !== currentPersonId); });
    archive.media.forEach((media) => { media.personIds = media.personIds.filter((id) => id !== currentPersonId); });
    if (archive.rootPersonId === currentPersonId) archive.rootPersonId = archive.people[0]?.id || null;
    currentPersonId = archive.people[0]?.id || '';
    persist('Человек удалён.');
    renderAll();
  });

  fields.storyPicker.addEventListener('change', () => { currentStoryId = fields.storyPicker.value; renderAll(); status('История загружена.'); });
  $('newStoryButton').addEventListener('click', () => { const story = emptyStory(); archive.stories.push(story); currentStoryId = story.id; renderAll(); fields.storyTitle.focus(); status('Создана новая история.'); });
  fields.storyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const story = { id: fields.storyId.value || core.createId('story'), title: fields.storyTitle.value.trim(), date: fields.storyDate.value.trim(), author: fields.storyAuthor.value.trim(), text: fields.storyText.value.trim(), personIds: selectedValues(fields.storyPersonIds), mediaIds: selectedValues(fields.storyMediaIds) };
    try {
      validateStory(story);
    } catch (error) {
      status(error.message);
      return;
    }
    upsert(archive.stories, story);
    currentStoryId = story.id;
    crossLinkStory(story);
    persist(`История сохранена: ${story.title || story.id}.`);
    renderAll();
  });
  $('deleteStoryButton').addEventListener('click', () => {
    const story = archive.stories.find((item) => item.id === currentStoryId);
    if (!story || !window.confirm(`Удалить историю “${story.title || currentStoryId}”?`)) return;
    archive.stories = archive.stories.filter((story) => story.id !== currentStoryId);
    archive.people.forEach((person) => { person.storyIds = person.storyIds.filter((id) => id !== currentStoryId); });
    archive.media.forEach((media) => { media.storyIds = media.storyIds.filter((id) => id !== currentStoryId); });
    currentStoryId = archive.stories[0]?.id || '';
    persist('История удалена.');
    renderAll();
  });

  fields.mediaPicker.addEventListener('change', () => { currentMediaId = fields.mediaPicker.value; renderAll(); status('Медиа загружено.'); });
  $('openArchiveFolderButton').addEventListener('click', async () => {
    if (typeof window.showDirectoryPicker !== 'function') {
      status('Этот браузер не поддерживает разрешение папки. Скопируйте файлы в media/ вручную.');
      return;
    }
    try {
      archiveDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const hasPermission = await ensureArchiveFolderPermission();
      status(hasPermission ? 'Папка архива разрешена. Новые выбранные файлы будут копироваться в media/.' : 'Нет разрешения на запись в папку архива.');
    } catch (error) {
      status(`Папка архива не выбрана: ${error.message}`);
    }
  });
  $('newMediaButton').addEventListener('click', () => { const media = emptyMedia(); archive.media.push(media); currentMediaId = media.id; renderAll(); fields.mediaTitle.focus(); status('Создана новая запись медиа.'); });
  fields.mediaFileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    pendingMediaFile = file;
    fields.mediaType.value = detectMediaType(file);
    fields.mediaPath.value = mediaPathForFile(file);
    if (!fields.mediaTitle.value.trim()) fields.mediaTitle.value = file.name.replace(/\.[^.]+$/, '');
    const copied = await copyPendingMediaIfPossible();
    if (!copied) setMediaHint(`Файл выбран. Положите его в папку media/ как ${sanitizeFileName(file.name)} или разрешите папку архива для автоматического копирования.`);
    syncJsonOutput();
  });
  fields.mediaForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    let mediaPath = '';
    try {
      mediaPath = validateMediaPath(fields.mediaPath.value);
    } catch (error) {
      status(error.message);
      fields.mediaPath.focus();
      return;
    }
    await copyPendingMediaIfPossible();
    const media = { id: fields.mediaId.value || core.createId('media'), title: fields.mediaTitle.value.trim(), type: fields.mediaType.value, path: mediaPath, personIds: selectedValues(fields.mediaPersonIds), storyIds: selectedValues(fields.mediaStoryIds) };
    try {
      validateMedia(media);
    } catch (error) {
      status(error.message);
      return;
    }
    upsert(archive.media, media);
    currentMediaId = media.id;
    crossLinkMedia(media);
    persist(`Медиа сохранено: ${media.title || media.id}.`);
    renderAll();
  });
  $('deleteMediaButton').addEventListener('click', () => {
    const mediaItem = archive.media.find((item) => item.id === currentMediaId);
    if (!mediaItem || !window.confirm(`Удалить медиа “${mediaItem.title || currentMediaId}”? Сам файл из папки media/ не удаляется.`)) return;
    archive.media = archive.media.filter((media) => media.id !== currentMediaId);
    archive.people.forEach((person) => { person.mediaIds = person.mediaIds.filter((id) => id !== currentMediaId); if (person.primaryMediaId === currentMediaId) person.primaryMediaId = ''; });
    archive.stories.forEach((story) => { story.mediaIds = story.mediaIds.filter((id) => id !== currentMediaId); });
    currentMediaId = archive.media[0]?.id || '';
    persist('Медиа удалено.');
    renderAll();
  });

  $('exportButton').addEventListener('click', () => {
    persist('Файл archive.json скачивается. Сохраните его рядом с index.html и edit.html.');
    core.downloadJson('archive.json', archive);
  });
  $('importFile').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      archive = core.parseArchiveJson(await file.text());
      currentPersonId = archive.people[0]?.id || '';
      currentStoryId = archive.stories[0]?.id || '';
      currentMediaId = archive.media[0]?.id || '';
      persist('JSON импортирован и сохранён.');
      renderAll();
    } catch (error) {
      status(`Ошибка импорта: ${error.message}`);
    }
  });
  $('loadFromTextareaButton').addEventListener('click', () => {
    try {
      archive = core.parseArchiveJson(fields.jsonOutput.value);
      currentPersonId = archive.people[0]?.id || '';
      currentStoryId = archive.stories[0]?.id || '';
      currentMediaId = archive.media[0]?.id || '';
      persist('JSON из поля загружен и сохранён.');
      renderAll();
    } catch (error) {
      status(`Ошибка JSON: ${error.message}`);
    }
  });

  renderAll();
  status('Редактор готов. Данные загружены.');
});
