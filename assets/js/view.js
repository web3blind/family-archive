document.addEventListener('DOMContentLoaded', async () => {
  const core = window.FamilyArchive;
  let archive;
  try { archive = await core.loadArchive(); }
  catch (error) {
    document.getElementById('treeSummary').textContent = `Не удалось открыть архив: ${error.message}`;
    return;
  }
  let selectedPersonId = archive.rootPersonId || (archive.people[0] && archive.people[0].id);
  let lastLightboxTrigger = null;

  const els = {
    archiveTitle: document.getElementById('archiveTitle'),
    rootSelect: document.getElementById('rootSelect'),
    treeSummary: document.getElementById('treeSummary'),
    ancestorTree: document.getElementById('ancestorTree'),
    peopleSearch: document.getElementById('peopleSearch'),
    peopleList: document.getElementById('peopleList'),
    personDetail: document.getElementById('personDetail'),
    lightbox: document.getElementById('lightbox'),
    lightboxClose: document.getElementById('lightboxClose'),
    lightboxImage: document.getElementById('lightboxImage'),
    lightboxCaption: document.getElementById('lightboxCaption')
  };

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }

  function renderRootSelect() {
    els.rootSelect.innerHTML = archive.people.map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.fullName || person.id)}</option>`).join('');
    if (selectedPersonId) els.rootSelect.value = selectedPersonId;
  }

  function renderPeopleList() {
    const query = els.peopleSearch.value.trim().toLowerCase();
    const mediaMap = core.byId(archive.media);
    const filtered = archive.people.filter((person) => {
      const haystack = `${person.fullName} ${person.place} ${person.country} ${person.rememberFor}`.toLowerCase();
      return !query || haystack.includes(query);
    });

    if (!filtered.length) {
      els.peopleList.innerHTML = '<p class="empty-state">Никого не найдено. Попробуйте другой поиск.</p>';
      return;
    }

    els.peopleList.innerHTML = filtered.map((person) => {
      const photo = core.findPrimaryPhoto(person, mediaMap);
      const photoUrl = photo && core.mediaUrl(photo.path);
      const img = photoUrl ? `<img class="portrait" src="${escapeHtml(photoUrl)}" alt="${escapeHtml(photo.title || `Фото: ${person.fullName}`)}">` : '<div class="portrait" role="img" aria-label="Фото пока не добавлено"></div>';
      return `<button class="person-card" type="button" data-person-id="${escapeHtml(person.id)}" aria-pressed="${person.id === selectedPersonId}" aria-label="Открыть карточку: ${escapeHtml(person.fullName)}">
        ${img}
        <span>
          <span class="card-name">${escapeHtml(person.fullName || 'Без имени')}</span>
          <span class="meta">${escapeHtml([person.place, person.country].filter(Boolean).join(', ') || 'Место не указано')}</span>
          <span class="remember">${escapeHtml(person.rememberFor || 'Воспоминание пока не заполнено')}</span>
        </span>
      </button>`;
    }).join('');
  }

  function renderTree() {
    const tree = core.buildAncestorTree(selectedPersonId, archive.people, 6);
    const known = core.countKnownAncestors(tree);
    els.treeSummary.textContent = known ? `В дереве найдено известных предков: ${known}. Неизвестные родители показаны отдельными узлами.` : 'Для выбранного человека родители пока не указаны.';
    els.ancestorTree.innerHTML = renderTreeList(tree);
  }

  function renderTreeList(node) {
    if (!node) return '';
    const label = node.relation === 'корень' ? 'Корневой человек' : node.relation;
    const content = node.person
      ? `<button type="button" data-person-id="${escapeHtml(node.person.id)}">${escapeHtml(node.person.fullName || node.person.id)}</button><span class="meta"> — ${escapeHtml(label)}</span>`
      : `<span class="unknown">${escapeHtml(label)}: неизвестно</span>`;
    const children = node.children && node.children.length ? `<ol>${node.children.map(renderTreeList).join('')}</ol>` : '';
    return `<li class="tree-node">${content}${children}</li>`;
  }

  function renderDetail() {
    const person = archive.people.find((item) => item.id === selectedPersonId);
    if (!person) {
      els.personDetail.innerHTML = '<p class="empty-state">Человек не найден.</p>';
      return;
    }
    const peopleMap = core.byId(archive.people);
    const mediaMap = core.byId(archive.media);
    const photo = core.findPrimaryPhoto(person, mediaMap);
    const stories = core.getPersonStories(person, archive.stories);
    const photoUrl = photo && core.mediaUrl(photo.path);
    const media = core.getPersonMedia(person, archive.media);
    const mother = peopleMap.get(person.motherId);
    const father = peopleMap.get(person.fatherId);
    const lifeDates = [person.birthDate, person.deathDate].filter(Boolean).join(' — ') || 'не указаны';

    els.personDetail.innerHTML = `<article class="detail-card" aria-labelledby="detailName">
      <div class="detail-header">
        ${photoUrl ? `<button class="media-open" type="button" data-media-id="${escapeHtml(photo.id)}" aria-label="Открыть главное фото: ${escapeHtml(photo.title)}"><img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(photo.title || `Фото: ${person.fullName}`)}"></button>` : '<div class="empty-state">Главное фото пока не добавлено.</div>'}
        <div>
          <h3 id="detailName">${escapeHtml(person.fullName || 'Без имени')}</h3>
          <p class="remember">${escapeHtml(person.rememberFor || 'Чем запомнился семье — пока не заполнено.')}</p>
          <dl class="fact-list">
            <dt>Годы жизни</dt><dd>${escapeHtml(lifeDates)}</dd>
            <dt>Место</dt><dd>${escapeHtml([person.place, person.country].filter(Boolean).join(', ') || 'не указано')}</dd>
            <dt>Мать</dt><dd>${mother ? escapeHtml(mother.fullName) : 'неизвестно'}</dd>
            <dt>Отец</dt><dd>${father ? escapeHtml(father.fullName) : 'неизвестно'}</dd>
          </dl>
        </div>
      </div>
      <section aria-labelledby="bioHeading"><h3 id="bioHeading">Короткая биография</h3><p>${escapeHtml(person.bio || 'Биография пока не заполнена.')}</p></section>
      <section aria-labelledby="storiesDetailHeading"><h3 id="storiesDetailHeading">Истории</h3>${renderStories(stories)}</section>
      <section aria-labelledby="mediaDetailHeading"><h3 id="mediaDetailHeading">Медиа</h3>${renderMedia(media)}</section>
    </article>`;
  }

  function renderStories(stories) {
    if (!stories.length) return '<p class="empty-state">Истории пока не связаны с этим человеком.</p>';
    return stories.map((story) => `<article class="story-card"><h4>${escapeHtml(story.title || 'Без названия')}</h4><p class="meta">${escapeHtml([story.date, story.author].filter(Boolean).join(' · '))}</p><p>${escapeHtml(story.text)}</p></article>`).join('');
  }

  function renderMedia(media) {
    if (!media.length) return '<p class="empty-state">Медиа пока не связано с этим человеком.</p>';
    return `<div class="media-grid">${media.map((item) => {
      const title = escapeHtml(item.title || item.path || 'Медиа');
      const safeUrl = core.mediaUrl(item.path);
      const path = safeUrl && escapeHtml(safeUrl);
      if (!path) return `<div class="media-card"><strong>${title}</strong><p class="media-error">Небезопасный или недоступный путь к файлу.</p></div>`;
      if (item.type === 'photo') {
        return `<figure class="media-card"><button type="button" data-media-id="${escapeHtml(item.id)}" class="media-open" aria-label="Открыть фото: ${title}"><img src="${path}" alt="${title}" data-media-path="${path}"></button><figcaption>${title}</figcaption><p class="media-error" role="status" hidden></p></figure>`;
      }
      if (item.type === 'audio') {
        return `<figure class="media-card"><figcaption><strong>${title}</strong></figcaption><audio controls preload="none" src="${path}" data-media-path="${path}">Ваш браузер не поддерживает аудио. <a href="${path}">Скачать аудио</a>.</audio><p class="media-error" role="status" hidden></p><p class="meta">audio · ${path}</p></figure>`;
      }
      if (item.type === 'video') {
        return `<figure class="media-card"><figcaption><strong>${title}</strong></figcaption><video controls preload="metadata" src="${path}" data-media-path="${path}">Ваш браузер не поддерживает видео. <a href="${path}">Скачать видео</a>.</video><p class="media-error" role="status" hidden></p><p class="meta">video · ${path}</p></figure>`;
      }
      return `<div class="media-card"><strong>${title}</strong><p class="meta">${escapeHtml(item.type)} · ${path}</p><a href="${path}" data-document-path="${escapeHtml(item.path)}">Открыть файл</a><p class="media-error" role="status" hidden></p></div>`;
    }).join('')}</div>`;
  }

  function selectPerson(personId, focusDetail = false) {
    if (!archive.people.some((person) => person.id === personId)) return;
    selectedPersonId = personId;
    renderAll();
    if (focusDetail) {
      document.getElementById('detailHeading').focus?.();
      els.personDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function openLightbox(mediaId, trigger) {
    const item = archive.media.find((media) => media.id === mediaId);
    const url = item && item.type === 'photo' && core.mediaUrl(item.path);
    if (!url) return;
    lastLightboxTrigger = trigger || document.activeElement;
    els.lightboxImage.src = url;
    els.lightboxImage.alt = item.title || 'Семейная фотография';
    els.lightboxCaption.textContent = `${item.title || 'Фотография'} — ${item.path}`;
    els.lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    els.lightboxClose.focus();
  }

  function closeLightbox() {
    els.lightbox.hidden = true;
    document.body.style.overflow = '';
    els.lightboxImage.removeAttribute('src');
    if (lastLightboxTrigger && typeof lastLightboxTrigger.focus === 'function') lastLightboxTrigger.focus();
  }

  function showMediaError(target) {
    const card = target.closest('.media-card');
    const error = card && card.querySelector('.media-error');
    const path = target.dataset.mediaPath || target.getAttribute('src') || '';
    if (!error) return;
    error.textContent = `Файл не найден или не открывается: ${path}. Проверьте, что файл лежит в папке media/ и путь указан правильно.`;
    error.hidden = false;
  }

  function renderAll() {
    els.archiveTitle.textContent = archive.title || 'Семейная память';
    renderRootSelect();
    renderTree();
    renderPeopleList();
    renderDetail();
  }

  els.rootSelect.addEventListener('change', () => { selectPerson(els.rootSelect.value); els.rootSelect.focus(); });
  els.peopleSearch.addEventListener('input', renderPeopleList);
  document.addEventListener('click', (event) => {
    const documentLink = event.target.closest('[data-document-path]');
    if (documentLink && window.FamilyArchiveNative?.openMedia) {
      event.preventDefault();
      const status = documentLink.closest('.media-card').querySelector('.media-error');
      window.FamilyArchiveNative.openMedia(documentLink.dataset.documentPath).catch((error) => {
        status.textContent = `Не удалось открыть документ: ${error.message}`;
        status.hidden = false;
      });
      return;
    }
    const personButton = event.target.closest('[data-person-id]');
    if (personButton) selectPerson(personButton.dataset.personId, true);
    const mediaButton = event.target.closest('[data-media-id]');
    if (mediaButton) openLightbox(mediaButton.dataset.mediaId, mediaButton);
    if (event.target.matches('[data-close-lightbox]')) closeLightbox();
  });
  els.lightboxClose.addEventListener('click', closeLightbox);
  document.addEventListener('error', (event) => {
    if (event.target && event.target.matches('img[data-media-path], audio[data-media-path], video[data-media-path]')) showMediaError(event.target);
  }, true);
  document.addEventListener('keydown', (event) => {
    if (!els.lightbox.hidden && event.key === 'Escape') closeLightbox();
    if (!els.lightbox.hidden && event.key === 'Tab') {
      const focusable = els.lightbox.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  renderAll();
});
