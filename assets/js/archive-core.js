(function (global) {
  const STORAGE_KEY = 'familyArchive.v1';
  const storyCategories = Object.freeze({
    'family-stories': 'Семейные истории',
    letters: 'Письма потомкам',
    knowledge: 'Семейные знания',
    'place-home': 'Место и дом',
    'plans-results': 'Замыслы и итоги',
    'book-introduction': 'Начало родовой книги'
  });
  function storyCategoryLabel(category) {
    return Object.hasOwn(storyCategories, category || '') ? storyCategories[category] : 'Без категории';
  }
  function filterStoriesByCategory(stories, category = 'all') {
    return stories.filter(story => category === 'all' || (story.category || '') === category);
  }

  const fallbackArchive = {
    version: 1,
    title: 'Семейный архив',
    rootPersonId: null,
    people: [],
    stories: [],
    media: []
  };
  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  const native = () => global.FamilyArchiveNative || null;
  function validMediaPath(path) {
    return typeof path === 'string' && path.length <= 1024 && /^media\/[\p{L}\p{N} _.,()\-]+(?:\/[\p{L}\p{N} _.,()\-]+)*$/u.test(path) &&
      path.split('/').every((part) => part.length <= 160 && !part.startsWith('.')) && !/[\u0000-\u001f\u007f]/.test(path);
  }
  function mediaUrl(path) {
    if (!validMediaPath(path)) return null;
    if (!native()) return path.split('/').map(encodeURIComponent).join('/');
    try {
      const url = native().mediaUrl(path);
      const parsed = new URL(url, global.location?.href || 'https://localhost/');
      return typeof url === 'string' && ['https:', 'http:', 'file:', 'capacitor:', 'app-media:', 'family:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? url : null;
    } catch (_) { return null; }
  }
  function ensureArchiveShape(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Архив должен быть объектом.');
    if (source.version != null && source.version !== 1) throw new Error('Неподдерживаемая версия архива.');
    for (const key of ['people', 'stories', 'media']) {
      if (source[key] != null && !Array.isArray(source[key])) throw new Error(`${key}: ожидается список.`);
    }
    const text = (value, label, fallback = '') => {
      if (value == null) return fallback;
      if (typeof value !== 'string') throw new Error(`${label}: ожидается текст.`);
      return value;
    };
    const id = (value, label) => {
      if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error(`${label}: неверный ID.`);
      return value;
    };
    const optionalId = (value, label) => value == null || value === '' ? null : id(value, label);
    const ids = (value, label) => {
      if (value == null) return [];
      if (!Array.isArray(value)) throw new Error(`${label}: ожидается список ID.`);
      const result = value.map((entry) => id(entry, label));
      if (new Set(result).size !== result.length) throw new Error(`${label}: повторяющиеся ссылки.`);
      return result;
    };
    const normalized = {
      version: 1, title: text(source.title, 'Название', 'Семейное древо'),
      rootPersonId: optionalId(source.rootPersonId, 'Корень'),
      people: (source.people || []).map((p) => ({
        id: id(p?.id, 'Человек'), fullName: text(p.fullName, 'ФИО'), birthDate: text(p.birthDate, 'Дата рождения'), deathDate: text(p.deathDate, 'Дата смерти'),
        country: text(p.country, 'Страна'), place: text(p.place, 'Место'), motherId: optionalId(p.motherId, 'Мать'), fatherId: optionalId(p.fatherId, 'Отец'),
        primaryMediaId: text(p.primaryMediaId, 'Главное фото'), rememberFor: text(p.rememberFor, 'Воспоминание'), bio: text(p.bio, 'Биография'),
        storyIds: ids(p.storyIds, 'Истории человека'), mediaIds: ids(p.mediaIds, 'Медиа человека')
      })),
      stories: (source.stories || []).map((s) => ({
        id: id(s?.id, 'История'), title: text(s.title, 'Заголовок истории'), text: text(s.text, 'Текст истории'),
        personIds: ids(s.personIds, 'Люди истории'), date: text(s.date, 'Дата истории'), author: text(s.author, 'Автор'), mediaIds: ids(s.mediaIds, 'Медиа истории'),
        ...(s.category == null ? {} : { category: text(s.category, 'Категория истории') })
      })),
      media: (source.media || []).map((m) => ({
        id: id(m?.id, 'Медиа'), type: text(m.type, 'Тип медиа', 'photo'), title: text(m.title, 'Название медиа'),
        path: text(m.path, 'Путь медиа'), personIds: ids(m.personIds, 'Люди медиа'), storyIds: ids(m.storyIds, 'Истории медиа')
      }))
    };
    const maps = Object.fromEntries(['people', 'stories', 'media'].map((key) => {
      const map = new Map();
      for (const item of normalized[key]) {
        if (map.has(item.id)) throw new Error(`${key}: повторяющийся ID ${item.id}.`);
        map.set(item.id, item);
      }
      return [key, map];
    }));
    const check = (ref, map, label) => { if (ref && !map.has(ref)) throw new Error(`${label}: неизвестный ID ${ref}.`); };
    const checkMany = (refs, map, label) => refs.forEach((ref) => check(ref, map, label));
    if (!normalized.rootPersonId && normalized.people.length) normalized.rootPersonId = normalized.people[0].id;
    check(normalized.rootPersonId, maps.people, 'Корень');
    for (const p of normalized.people) {
      check(p.motherId, maps.people, 'Мать'); check(p.fatherId, maps.people, 'Отец');
      check(p.primaryMediaId, maps.media, 'Главное фото');
      if (p.primaryMediaId && maps.media.get(p.primaryMediaId).type !== 'photo') throw new Error('Главное медиа должно быть фото.');
      checkMany(p.storyIds, maps.stories, 'История человека'); checkMany(p.mediaIds, maps.media, 'Медиа человека');
    }
    for (const s of normalized.stories) {
      if (s.category && !Object.hasOwn(storyCategories, s.category)) throw new Error('Категория истории: неизвестная категория.');
      checkMany(s.personIds, maps.people, 'Человек истории'); checkMany(s.mediaIds, maps.media, 'Медиа истории');
    }
    for (const m of normalized.media) {
      if (!['photo', 'audio', 'video', 'document'].includes(m.type)) throw new Error('Неизвестный тип медиа.');
      if (!validMediaPath(m.path) || !/\.(jpg|jpeg|png|gif|webp|avif|bmp|svg|heic|heif|mp3|m4a|wav|ogg|opus|flac|aac|mp4|webm|mov|mkv|m4v|avi|pdf|txt|md|rtf|doc|docx|odt|xls|xlsx|ppt|pptx|csv)$/i.test(m.path)) throw new Error(`Небезопасный или неподдерживаемый путь медиа: ${m.path}.`);
      checkMany(m.personIds, maps.people, 'Человек медиа'); checkMany(m.storyIds, maps.stories, 'История медиа');
    }
    const active = new Set(), done = new Set();
    function visit(personId) {
      if (active.has(personId)) throw new Error('Цикл в родственных связях.');
      if (done.has(personId)) return;
      active.add(personId);
      const person = maps.people.get(personId);
      if (person.motherId) visit(person.motherId);
      if (person.fatherId) visit(person.fatherId);
      active.delete(personId); done.add(personId);
    }
    normalized.people.forEach((p) => visit(p.id));
    return normalized;
  }

  function createId(prefix) {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return `${prefix}-${global.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function getStoredArchive() {
    try {
      const raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      return raw ? ensureArchiveShape(JSON.parse(raw)) : null;
    } catch (error) {
      console.warn('Не удалось прочитать localStorage', error);
      return null;
    }
  }

  async function loadArchive() {
    if (native()) {
      const value = await native().readArchive();
      if (value != null) return ensureArchiveShape(value);
    } else {
      const stored = getStoredArchive();
      if (stored) return stored;
    }
    try {
      const response = await fetch('archive.json', { cache: 'no-store' });
      if (response.ok) return ensureArchiveShape(await response.json());
    } catch (error) {
      console.info('archive.json недоступен, используются демо-данные', error);
    }
    return deepClone(fallbackArchive);
  }

  let writeQueue = Promise.resolve();
  function saveArchive(archive) {
    const normalized = ensureArchiveShape(archive);
    if (!native()) {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized, null, 2));
      return Promise.resolve(normalized);
    }
    // Snapshot before queueing; a failed write must not poison the next write.
    const write = writeQueue.then(() => native().writeArchive(deepClone(normalized))).then(() => normalized);
    writeQueue = write.catch(() => {});
    return write;
  }

  function resetArchive() { return saveArchive(deepClone(fallbackArchive)); }

  function byId(items) {
    return new Map(items.map((item) => [item.id, item]));
  }

  function findPrimaryPhoto(person, mediaMap) {
    const direct = mediaMap.get(person.primaryMediaId);
    if (direct && direct.type === 'photo') return direct;
    return person.mediaIds.map((id) => mediaMap.get(id)).find((item) => item && item.type === 'photo') || null;
  }

  function getPersonStories(person, stories) {
    const ids = new Set(person.storyIds || []);
    return stories.filter((story) => ids.has(story.id) || (story.personIds || []).includes(person.id));
  }

  function getPersonMedia(person, media) {
    const ids = new Set(person.mediaIds || []);
    return media.filter((item) => ids.has(item.id) || (item.personIds || []).includes(person.id));
  }

  function buildAncestorTree(rootId, people, maxDepth = 5) {
    const peopleMap = byId(people);
    function build(personId, relation, depth, visited) {
      if (!personId) return { relation, person: null, children: [] };
      const person = peopleMap.get(personId) || null;
      if (!person) return { relation, person: null, children: [] };
      if (depth >= maxDepth || visited.has(personId)) return { relation, person, children: [] };
      const nextVisited = new Set(visited);
      nextVisited.add(personId);
      return {
        relation,
        person,
        children: [
          build(person.motherId, 'мать', depth + 1, nextVisited),
          build(person.fatherId, 'отец', depth + 1, nextVisited)
        ]
      };
    }
    return build(rootId, 'корень', 0, new Set());
  }

  function countKnownAncestors(tree) {
    if (!tree || !tree.children) return 0;
    return tree.children.reduce((sum, child) => sum + (child.person ? 1 : 0) + countKnownAncestors(child), 0);
  }

  function parseArchiveJson(text) {
    const parsed = JSON.parse(text);
    return ensureArchiveShape(parsed);
  }

  function downloadJson(filename, archive) {
    const blob = new Blob([JSON.stringify(ensureArchiveShape(archive), null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const api = {
    STORAGE_KEY,
    storyCategories,
    storyCategoryLabel,
    filterStoriesByCategory,
    fallbackArchive,
    deepClone,
    ensureArchiveShape,
    validMediaPath,
    mediaUrl,
    createId,
    loadArchive,
    saveArchive,
    resetArchive,
    byId,
    findPrimaryPhoto,
    getPersonStories,
    getPersonMedia,
    buildAncestorTree,
    countKnownAncestors,
    parseArchiveJson,
    downloadJson
  };

  global.FamilyArchive = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
