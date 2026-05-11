(function (global) {
  const STORAGE_KEY = 'familyArchive.v1';

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

  function ensureArchiveShape(archive) {
    const normalized = archive && typeof archive === 'object' ? archive : {};
    normalized.version = Number(normalized.version) || 1;
    normalized.title = normalized.title || 'Семейное древо';
    normalized.rootPersonId = normalized.rootPersonId || null;
    normalized.people = Array.isArray(normalized.people) ? normalized.people : [];
    normalized.stories = Array.isArray(normalized.stories) ? normalized.stories : [];
    normalized.media = Array.isArray(normalized.media) ? normalized.media : [];
    normalized.people = normalized.people.map((person) => ({
      id: person.id || createId('person'),
      fullName: person.fullName || '',
      birthDate: person.birthDate || '',
      deathDate: person.deathDate || '',
      country: person.country || '',
      place: person.place || '',
      motherId: person.motherId || null,
      fatherId: person.fatherId || null,
      primaryMediaId: person.primaryMediaId || '',
      rememberFor: person.rememberFor || '',
      bio: person.bio || '',
      storyIds: Array.isArray(person.storyIds) ? person.storyIds : [],
      mediaIds: Array.isArray(person.mediaIds) ? person.mediaIds : []
    }));
    normalized.stories = normalized.stories.map((story) => ({
      id: story.id || createId('story'),
      title: story.title || '',
      text: story.text || '',
      personIds: Array.isArray(story.personIds) ? story.personIds : [],
      date: story.date || '',
      author: story.author || '',
      mediaIds: Array.isArray(story.mediaIds) ? story.mediaIds : []
    }));
    normalized.media = normalized.media.map((item) => ({
      id: item.id || createId('media'),
      type: item.type || 'photo',
      title: item.title || '',
      path: item.path || '',
      personIds: Array.isArray(item.personIds) ? item.personIds : [],
      storyIds: Array.isArray(item.storyIds) ? item.storyIds : []
    }));
    if (!normalized.people.some((person) => person.id === normalized.rootPersonId)) {
      normalized.rootPersonId = normalized.people[0] ? normalized.people[0].id : null;
    }
    return normalized;
  }

  function createId(prefix) {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return `${prefix}-${global.crypto.randomUUID().slice(0, 8)}`;
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
    const stored = getStoredArchive();
    if (stored) return stored;
    try {
      const response = await fetch('archive.json', { cache: 'no-store' });
      if (response.ok) return ensureArchiveShape(await response.json());
    } catch (error) {
      console.info('archive.json недоступен, используются демо-данные', error);
    }
    return deepClone(fallbackArchive);
  }

  function saveArchive(archive) {
    const normalized = ensureArchiveShape(deepClone(archive));
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized, null, 2));
    return normalized;
  }

  function resetArchive() {
    const archive = deepClone(fallbackArchive);
    saveArchive(archive);
    return archive;
  }

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
    fallbackArchive,
    deepClone,
    ensureArchiveShape,
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
