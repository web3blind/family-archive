document.addEventListener('DOMContentLoaded', async () => {
  'use strict';
  const core=window.FamilyArchive, model=window.FamilyEditorModel, native=window.FamilyArchiveNative || null;
  const $=id=>document.getElementById(id), main=$('main');
  const h=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone=core.deepClone, DRAFT_KEY='familyArchive.editorDrafts.v1';
  let archive, busy=false, folderHandle=null, parentRole='', parentReturn='', uploadContext=null;
  let database={version:1,sessions:[]}, session, archiveIdentity=null, recoveryUploadId=null;
  async function readArchiveIdentity() {
    if(!native)return null;
    try {const value=await native.archiveIdentity?.();return typeof value==='string' && value.length?value:null;}
    catch(_) {return null;}
  }
  function canRestoreSession(saved) {
    return !native ? !saved.native && !saved.archiveIdentity : !!archiveIdentity && saved.native===true && saved.archiveIdentity===archiveIdentity;
  }
  async function requireArchiveIdentity(expected=archiveIdentity) {
    if(native && (!expected || await readArchiveIdentity()!==expected))throw new Error('Черновик относится к другому архиву или его папку нельзя проверить. Откройте исходный полный архив; восстановление здесь заблокировано, чтобы не потерять файлы.');
  }
  const browserFiles=new Map();
  const kindName={people:'человека',stories:'историю',media:'файл'};
  const typeName={photo:'Фото',audio:'Аудио',video:'Видео',document:'Документ'};
  function status(message) { $('editorStatus').textContent=message; }
  function fail(error, formId) {
    const box=$(formId)?.querySelector('.form-error');
    if(box) {box.textContent=error.message; box.focus();}
    else status(error.message);
    const field=error.field && $(error.field);
    if(field) {field.setAttribute('aria-invalid','true'); field.closest('details')?.setAttribute('open',''); field.focus();}
  }
  try {archive=await core.loadArchive();}
  catch(error) {status(`Не удалось открыть архив: ${error.message}. Данные не перезаписаны. Перезапустите приложение, чтобы повторить открытие.`);return;}
  if(native)document.body.classList.add('native-mode');
  try {
    const stored=JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if(stored?.version===1 && Array.isArray(stored.sessions))database=stored;
  } catch(error) {status(`Не удалось прочитать черновики: ${error.message}. Сохранённый архив открыт.`);}
  function hasDrafts(value) {
    return Object.values(value.drafts||{}).some(items=>Object.keys(items).length) || value.pendingUploads?.length || Object.keys(value.parentDrafts||{}).length || value.settings?.jsonText!==undefined || value.settings?.titleTouched || value.settings?.rootTouched;
  }
  function getSession() {
    const base=JSON.stringify(archive);
    session=database.sessions.find(s=>s.base===base && canRestoreSession(s) && s.drafts?.people && s.drafts?.stories && s.drafts?.media && s.view && Array.isArray(s.pendingUploads));
    if(!session) {
      session={base,label:archive.title,native:!!native,archiveIdentity,drafts:{people:{},stories:{},media:{}},view:{type:'family'},settings:{title:archive.title},pendingUploads:[]};
      database.sessions.push(session);
    }
  }
  archiveIdentity=await readArchiveIdentity();
  getSession();
  function storeDrafts() {
    try {
      localStorage.setItem(DRAFT_KEY,JSON.stringify(database));
      const count=Object.values(session.drafts).reduce((sum,items)=>sum+Object.keys(items).length,0);
      $('draftStatus').textContent=count?`Черновики: ${count}. Поля сохраняются на этом устройстве; кнопка «Сохранить» добавляет их в архив.`:'';
      return true;
    } catch(error) {
      $('draftStatus').textContent=`Черновики не сохранены на устройстве: ${error.message}. Не закрывайте редактор до сохранения в архив.`;
      return false;
    }
  }
  function item(kind,id) {return session.drafts[kind][id] || (archive[kind].some(entry=>entry.id===id)?model.editable(archive,kind,id):undefined);}
  function all(kind) {
    const result=new Map(archive[kind].map(entry=>[entry.id,entry]));
    Object.entries(session.drafts[kind]).forEach(([id,draft])=>result.set(id,draft));
    return [...result.values()];
  }
  function draft(kind,id) {
    if(!session.drafts[kind][id])session.drafts[kind][id]=model.editable(archive,kind,id);
    return session.drafts[kind][id];
  }
  function markDraft(kind,value) {session.drafts[kind][value.id]=clone(value);storeDrafts();}
  function pruneReferences(value, target) {
    const maps=Object.fromEntries(['people','stories','media'].map(kind=>[kind,new Set([...target[kind].map(entry=>entry.id),...Object.keys(session.drafts[kind])])]));
    for(const key of ['personIds','storyIds','mediaIds'])if(value[key])value[key]=value[key].filter(id=>maps[{personIds:'people',storyIds:'stories',mediaIds:'media'}[key]].has(id));
    for(const key of ['motherId','fatherId'])if(value[key]&&!maps.people.has(value[key]))value[key]=null;
    if(value.primaryMediaId && !target.media.some(m=>m.id===value.primaryMediaId && m.type==='photo'))value.primaryMediaId='';
    return value;
  }
  function lock(value) {
    busy=value; main.inert=value; $('parentForm').inert=value; $('uploadPanel').inert=value;
    document.querySelector('.editor-nav').inert=value;
    main.setAttribute('aria-busy',String(value));
  }
  async function commit(next, message, clear=[]) {
    if(busy)return false;
    lock(true);status('Сохранение архива…');
    try {
      next=core.ensureArchiveShape(next);
      await requireArchiveIdentity();
      await core.saveArchive(next);
      const previous=archive;archive=next;
      for(const [kind,id] of clear)delete session.drafts[kind][id];
      for(const kind of Object.keys(session.drafts))for(const id of Object.keys(session.drafts[kind])) {
        const before=previous[kind].some(entry=>entry.id===id)?model.editable(previous,kind,id):undefined;
        const after=archive[kind].some(entry=>entry.id===id)?model.editable(archive,kind,id):undefined;
        session.drafts[kind][id]=pruneReferences(model.rebase(session.drafts[kind][id],before,after),archive);
      }
      if(session.settings.title===previous.title)session.settings.title=archive.title;
      if(session.settings.rootPersonId===undefined || session.settings.rootPersonId===previous.rootPersonId)session.settings.rootPersonId=archive.rootPersonId;
      session.base=JSON.stringify(archive);session.label=archive.title;
      storeDrafts();status(message);return true;
    } catch(error) {
      status(`Не удалось сохранить: ${error.message}. Все поля и выбранные файлы оставлены; повторите сохранение.`);
      return false;
    } finally {lock(false);}
  }
  function heading(title) {return `<h2 id="screenHeading" tabindex="-1">${h(title)}</h2>`;}
  function button(label,action,attrs='',secondary=true) {return `<button type="button" class="button${secondary?' button-secondary':''}" data-action="${action}" ${attrs}>${h(label)}</button>`;}
  function field(id,label,value,options={}) {
    const description=options.hint?`<span id="${id}Hint" class="field-hint">${h(options.hint)}</span>`:'';
    const attributes=`id="${id}" name="${options.key||id}" ${options.required?'required':''} aria-describedby="${options.hint?id+'Hint ':''}${options.error||'entityError'}"`;
    return `<label for="${id}">${h(label)}${options.area?`<textarea ${attributes} rows="${options.rows||3}">${h(value)}</textarea>`:`<input ${attributes} type="text" value="${h(value)}">`}${description}</label>`;
  }
  function choices(id,title,entries,selected,key,emptyText='Пока ничего нет.') {
    const ids=new Set(selected);
    return `<fieldset id="${id}" class="choice-group" data-key="${key}"><legend>${h(title)}</legend>${entries.length?`<div class="choice-list">${entries.map(entry=>`<label class="check-row"><input type="checkbox" value="${h(entry.id)}" ${ids.has(entry.id)?'checked':''}><span>${h(entry.fullName || entry.title || 'Без названия')}${session.drafts.people[entry.id]&&!archive.people.some(p=>p.id===entry.id)?' — черновик':''}</span></label>`).join('')}</div>`:`<p class="hint">${h(emptyText)}</p>`}</fieldset>`;
  }
  function formError() {return '<p id="entityError" class="form-error" role="alert" tabindex="-1"></p>';}
  function entityActions(kind,id) {
    const saved=archive[kind].some(entry=>entry.id===id);
    return `<div class="actions"><button id="saveEntityButton" class="button" type="submit">Сохранить ${kindName[kind]}</button>${button('Отменить изменения этой карточки','discard',`data-kind="${kind}" data-id="${h(id)}"`)}${saved?button(`Удалить ${kindName[kind]}`,'delete',`data-kind="${kind}" data-id="${h(id)}" data-danger="true"`):''}</div>`;
  }
  function linkPerson(id,label='') {
    const p=item('people',id);
    return p?button(label || p.fullName || 'Карточка без имени','open',`data-kind="people" data-id="${h(id)}"`):'<span class="hint">Не указан</span>';
  }
  function rootLabel() {return archive.people.find(p=>p.id===archive.rootPersonId)?.fullName || 'Не выбран';}
  function renderFamily() {
    main.innerHTML=`<section class="panel">${heading('Моя семья')}<p class="hint">Древо строится от: ${h(rootLabel())}. Черновики не видны в просмотре до сохранения.</p><div class="actions">${button('Добавить человека','new','id="newPersonButton" data-kind="people"',false)}${archive.rootPersonId?linkPerson(archive.rootPersonId,'Открыть начало дерева'):''}</div><label class="search-field" for="peopleSearch">Поиск по имени или месту<input id="peopleSearch" type="search" value="${h(session.search||'')}" aria-controls="familyResults"></label><p id="searchStatus" class="hint" role="status"></p><div id="familyResults"></div></section>`;
    familyResults();
  }
  function familyResults() {
    const term=(session.search||'').toLocaleLowerCase('ru');
    const people=all('people').filter(p=>`${p.fullName} ${p.country} ${p.place}`.toLocaleLowerCase('ru').includes(term));
    $('searchStatus').textContent=`Найдено людей: ${people.length}.`;
    $('familyResults').innerHTML=people.length?`<ul class="family-list">${people.map(p=>`<li><div>${button(p.fullName||'Новый человек — черновик','open',`data-kind="people" data-id="${h(p.id)}"`)}<span class="meta">${h([p.birthDate,p.place].filter(Boolean).join(' · '))}${session.drafts.people[p.id]?' · Есть черновик':''}${archive.rootPersonId===p.id?' · Начало дерева':''}</span></div><p>Мать: ${h(item('people',p.motherId)?.fullName||'не указана')}. Отец: ${h(item('people',p.fatherId)?.fullName||'не указан')}.</p></li>`).join('')}</ul>`:`<div class="empty-state">${term?'Нет совпадений. Измените поиск или добавьте человека.':'В семье пока нет карточек. Добавьте человека — достаточно имени.'}</div>`;
  }
  function mediaPreview(media) {
    const url=core.mediaUrl(media.path);
    if(!url)return '<p class="hint">Файл недоступен: проверьте путь.</p>';
    if(media.type==='photo')return `<img class="editor-photo" src="${h(url)}" alt="${h(media.title)}" data-preview>`;
    if(media.type==='audio'||media.type==='video')return `<${media.type} controls preload="none" src="${h(url)}" aria-label="${h(media.title)}" data-preview></${media.type}><p class="hint">Описание и расшифровку можно добавить в связанную историю.</p>`;
    return native?button('Открыть документ','document',`data-path="${h(media.path)}"`):`<a href="${h(url)}" target="_blank" rel="noopener">Открыть документ: ${h(media.title)} (${h(media.path.split('.').pop().toUpperCase())})</a>`;
  }
  function uploadButtons(context) {
    const attrs=context?`data-context="${h(context)}"`:'';
    const folderSupported=native?typeof native.pickMediaBatch==='function' && native.platform!=='android':'webkitdirectory' in $('mediaFolderInput');
    return `<div class="actions">${button('Загрузить файлы','upload',attrs,false)}${folderSupported?button('Загрузить папку','upload',`${attrs} data-folder="true"`):'<p class="hint">Для этой платформы используйте выбор нескольких файлов вместо папки.</p>'}${!native?button('Разрешить папку архива для копирования','folder','id="openArchiveFolderButton"'):''}</div>`;
  }
  function renderPerson(p) {
    const mother=item('people',p.motherId),father=item('people',p.fatherId);
    // item() resolves legacy one-sided links; a draft's explicit removals stay authoritative.
    const attachments=archive.media.filter(m=>p.mediaIds.includes(m.id));
    const photos=attachments.filter(m=>m.type==='photo');
    const children=all('people').filter(other=>other.motherId===p.id||other.fatherId===p.id);
    const stories=archive.stories.filter(s=>p.storyIds.includes(s.id)||s.personIds.includes(p.id));
    const photo=archive.media.find(m=>m.id===p.primaryMediaId);
    main.innerHTML=`<section class="panel">${button('К моей семье','family')}${heading(p.fullName || 'Новый человек')}<p class="hint">Обязательно только имя. Даты, биографию и воспоминания можно добавить позже.</p>${photo?mediaPreview(photo):''}
      <form id="personForm" data-kind="people" data-id="${h(p.id)}" class="stacked-form" novalidate><input id="personId" type="hidden" value="${h(p.id)}">${formError()}
      ${field('fullName','Имя / ФИО',p.fullName,{required:true})}<div class="form-grid two">${field('birthDate','Дата рождения',p.birthDate,{hint:'Можно указать год или примерную дату.'})}${field('deathDate','Дата смерти',p.deathDate)}${field('country','Страна',p.country)}${field('place','Место жизни',p.place)}</div>
      <fieldset class="relatives"><legend>Родители</legend><div class="form-grid two">${[['motherId','Мать',mother],['fatherId','Отец',father]].map(([key,label,parent])=>`<div><label for="${key}">${label}<select id="${key}" name="${key}" aria-describedby="entityError"><option value="">Не указан${key==='motherId'?'а':''}</option>${archive.people.filter(other=>other.id!==p.id).map(other=>`<option value="${h(other.id)}" ${p[key]===other.id?'selected':''}>${h(other.fullName)}</option>`).join('')}</select></label><div class="actions">${button(parent?'Выбрать другого или создать':'Добавить '+label.toLowerCase(),'parent',`data-role="${key}" id="add${key==='motherId'?'Mother':'Father'}Button"`)}${parent?linkPerson(parent.id,'Открыть: '+parent.fullName):''}</div></div>`).join('')}</div></fieldset>
      ${field('rememberFor','Что важно помнить — необязательно',p.rememberFor,{area:true})}${field('bio','Биография — необязательно',p.bio,{area:true,rows:5})}
      <fieldset class="choice-group"><legend>Главное фото карточки</legend><label class="check-row"><input type="radio" name="primaryMediaId" value="" ${!p.primaryMediaId?'checked':''}><span>Без главного фото</span></label>${photos.map(m=>`<label class="check-row"><input type="radio" name="primaryMediaId" value="${h(m.id)}" ${p.primaryMediaId===m.id?'checked':''}><span>${h(m.title||'Фото без названия')}</span></label>`).join('')}<p class="hint">Выберите главное фото из прикреплённых фотографий. Другие фото можно добавить из библиотеки.</p></fieldset>
      ${choices('mediaIds','Прикреплённые файлы',attachments,p.mediaIds,'mediaIds','Файлов пока нет. Загрузите их прямо здесь или добавьте из библиотеки.')}<p class="hint">Снятие отметки убирает связь только с этим человеком. Сам файл остаётся в библиотеке.</p>${button('Добавить из библиотеки','personLibrary','id="addFromLibraryButton"')}${uploadButtons(p.id)}
      ${choices('storyIds','Истории человека',archive.stories,p.storyIds,'storyIds','Пока нет историй. Напишите первое воспоминание.')}${entityActions('people',p.id)}</form>
      <section aria-labelledby="personStoriesHeading"><h3 id="personStoriesHeading">Воспоминания и истории</h3>${button('Написать историю о человеке','new',`id="newStoryButton" data-kind="stories" data-context="${h(p.id)}"`)}<ul class="entry-list">${stories.map(s=>`<li>${button(s.title,'open',`data-kind="stories" data-id="${h(s.id)}" data-context="${h(p.id)}"`)}<span class="meta">${h(core.storyCategoryLabel(s.category))}</span></li>`).join('')}</ul></section>
      <section aria-labelledby="familyConnectionsHeading"><h3 id="familyConnectionsHeading">Связи в семье</h3><p>Дети: ${children.length?'':'пока не указаны.'}</p><ul class="entry-list">${children.map(child=>`<li>${linkPerson(child.id)}</li>`).join('')}</ul>${button(archive.rootPersonId===p.id?'Этот человек — начало дерева':'Сделать началом дерева','root',`id="setRootButton" data-id="${h(p.id)}" ${archive.rootPersonId===p.id?'disabled':''}`)}</section></section>`;
  }
  function categoryOptions(value, filter=false) {
    return (filter ? `<option value="all" ${value==='all'?'selected':''}>Все категории</option>` : '') +
      [['','Без категории'],...Object.entries(core.storyCategories)].map(([id,label])=>`<option value="${h(id)}" ${value===id?'selected':''}>${h(label)}</option>`).join('');
  }
  function renderStory(s) {
    const context=session.view.context || s._contextPersonId;
    if(context)session.view.context=context;
    main.innerHTML=`<section class="panel">${button(context?'Вернуться к человеку':'Ко всем историям',context?'backPerson':'stories')}${heading(s.title||'Новая история')}<p class="hint">Запишите воспоминание. Можно связать его с несколькими людьми и файлами.${context&&!archive.people.some(p=>p.id===context)?' При сохранении истории также будет сохранена новая карточка этого человека.':''}</p><form id="storyForm" class="stacked-form" data-kind="stories" data-id="${h(s.id)}" novalidate><input id="storyId" type="hidden" value="${h(s.id)}">${formError()}${field('storyTitle','Название истории',s.title,{key:'title',required:true})}<label for="storyCategory">Категория — необязательно<select id="storyCategory" name="category" aria-describedby="entityError">${categoryOptions(s.category||'')}</select></label><div class="form-grid two">${field('storyDate','Дата / период',s.date,{key:'date'})}${field('storyAuthor','Автор воспоминания',s.author,{key:'author'})}</div>${field('storyText','Текст истории',s.text,{key:'text',area:true,rows:8,required:true})}${choices('storyPersonIds','Люди в истории',archive.people.concat(context&&!archive.people.some(p=>p.id===context)&&item('people',context)?[item('people',context)]:[]),s.personIds,'personIds')}${choices('storyMediaIds','Файлы к истории',archive.media,s.mediaIds,'mediaIds')}${entityActions('stories',s.id)}</form></section>`;
  }
  function renderMedia(m) {
    main.innerHTML=`<section class="panel">${button('К библиотеке файлов','library')}${heading(m.title||'Запись о файле')}<p class="hint">Файл может оставаться в библиотеке без связей или использоваться в нескольких карточках. Добавление записи не копирует файл.</p>${m.path?mediaPreview(m):''}<form id="mediaForm" class="stacked-form" data-kind="media" data-id="${h(m.id)}" novalidate><input id="mediaId" type="hidden" value="${h(m.id)}">${formError()}${field('mediaTitle','Название файла',m.title,{key:'title',required:true})}<label for="mediaType">Тип файла<select id="mediaType" name="type" aria-describedby="entityError">${Object.entries(typeName).map(([type,name])=>`<option value="${type}" ${m.type===type?'selected':''}>${name}</option>`).join('')}</select></label>${field('mediaPath','Путь к существующему файлу',m.path,{key:'path',required:true,hint:'Относительный путь внутри архива, например media/photo.jpg. Для нового файла используйте «Загрузить файлы» в библиотеке.'})}${choices('mediaPersonIds','Люди на файле',archive.people,m.personIds,'personIds')}${choices('mediaStoryIds','Истории с этим файлом',archive.stories,m.storyIds,'storyIds')}${entityActions('media',m.id)}</form></section>`;
  }
  function renderList(kind) {
    const isMedia=kind==='media';
    main.innerHTML=`<section class="panel">${heading(isMedia?'Библиотека файлов':'Все истории')}<p class="hint">${isMedia?'Фото, аудио, видео и документы. Файлам не обязательно назначать человека или историю.':'Все семейные воспоминания, включая истории без связей.'}</p>${isMedia?uploadButtons(null):''}<div class="actions">${button(isMedia?'Добавить запись о существующем файле':'Написать историю','new',`data-kind="${kind}" id="${isMedia?'newMediaButton':'newStoryButton'}"`)}</div><label class="search-field" for="librarySearch">${isMedia?'Поиск по названию файла':'Поиск по названию истории'}<input id="librarySearch" type="search" aria-controls="entryResults"></label>${!isMedia?`<label for="storyCategoryFilter">Категория историй<select id="storyCategoryFilter" aria-controls="entryResults">${categoryOptions(session.storyCategoryFilter??'all',true)}</select></label>`:''}<p id="listStatus" role="status" class="hint"></p><div id="entryResults"></div></section>`;
    listResults(kind,'');
  }
  function listResults(kind,term) {
    const candidates=kind==='stories'?core.filterStoriesByCategory(all(kind),session.storyCategoryFilter??'all'):all(kind);
    const entries=candidates.filter(entry=>entry.title.toLocaleLowerCase('ru').includes(term.toLocaleLowerCase('ru')));
    $('listStatus').textContent=`Найдено: ${entries.length}.`;
    $('entryResults').innerHTML=entries.length?`<ul class="entry-list">${entries.map(entry=>`<li>${button(entry.title||'Без названия — черновик','open',`data-kind="${kind}" data-id="${h(entry.id)}"`)}<span class="meta">${kind==='media'?h(typeName[entry.type])+' · ':h(core.storyCategoryLabel(entry.category))+' · '}${entry.personIds.length?'Людей: '+entry.personIds.length:'Без связи с человеком'}${session.drafts[kind][entry.id]?' · Есть черновик':''}</span></li>`).join('')}</ul>`:'<p class="empty-state">Пока ничего не найдено. Добавьте запись или измените поиск.</p>';
  }
  function renderSettings() {
    const pending=hasDrafts(session);
    const other=database.sessions.filter(s=>s!==session && hasDrafts(s));
    main.innerHTML=`<section class="panel">${heading('Архив и перенос')}<p class="hint">В архив и экспорт попадают только сохранённые карточки. ${pending?'Есть черновики: сохраните нужные карточки перед экспортом.':''}</p><form id="archiveForm" class="stacked-form" novalidate><label for="archiveTitleInput">Название архива<input id="archiveTitleInput" type="text" value="${h(session.settings.title)}"></label><label for="rootPersonInput">Начало дерева<select id="rootPersonInput"><option value="">Не выбрано</option>${archive.people.map(p=>`<option value="${h(p.id)}" ${p.id===(session.settings.rootPersonId===undefined?archive.rootPersonId:session.settings.rootPersonId)?'selected':''}>${h(p.fullName)}</option>`).join('')}</select></label><button id="saveArchiveButton" class="button" type="submit">Сохранить настройки архива</button><p class="form-error" tabindex="-1" role="alert"></p></form><h3>Импорт и экспорт</h3><p class="hint">${native?'Полный архив содержит данные и файлы.':'JSON содержит данные, но не сами файлы. Переносите вместе archive.json и папку media/. Сохранение в браузере не изменяет archive.json на диске.'} При замене архива черновики текущего архива сохраняются отдельно.</p><div class="actions">${button(native?'Экспортировать полный архив':'Скачать archive.json','export','id="exportButton"',false)}${native?button('Открыть полный архив','nativeOpen','id="nativeOpenArchiveButton"')+button('Импортировать полный архив','nativeImport','id="nativeImportArchiveButton"'):'<label for="importFile">Импортировать JSON<input id="importFile" type="file" accept="application/json,.json"></label>'}</div><details class="advanced-json"><summary>Посмотреть или вставить JSON</summary><label for="jsonOutput">JSON для просмотра или импорта<textarea id="jsonOutput" rows="12" spellcheck="false">${h(session.settings.jsonText ?? JSON.stringify(archive,null,2))}</textarea></label>${button('Загрузить JSON из поля','importText','id="loadFromTextareaButton"')}</details>${other.length?`<h3>Черновики других архивов</h3><p class="hint">${native?'Восстановление доступно только в исходной папке с совпадающим идентификатором и поколением архива. Откройте исходный полный архив; JSON-снимок не переносит файлы. Старые черновики без идентификатора заблокированы.':'Возврат восстанавливает сохранённый снимок данных и его черновики. Файлы должны оставаться в папке media/.'}</p><ul class="entry-list">${other.map(s=>`<li>${button('Вернуться: '+s.label,'restoreSession',`data-index="${database.sessions.indexOf(s)}" ${canRestoreSession(s)?'':'disabled'}`)}</li>`).join('')}</ul>`:''}<details><summary>Удаление данных</summary><p>Перед очисткой экспортируйте резервную копию. Самостоятельные файлы на диске не удаляются.</p>${button('Очистить сохранённый архив','reset','id="resetDemoButton"')}</details></section>`;
  }
  function render(focus='screenHeading') {
    const view=session.view;
    if(view.type==='person') {
      const p=item('people',view.id);if(p)renderPerson(p);else{session.view={type:'family'};renderFamily();}
    } else if(view.type==='story') {
      const s=item('stories',view.id);if(s)renderStory(s);else{session.view={type:'stories'};renderList('stories');}
    } else if(view.type==='media') {
      const m=item('media',view.id);if(m)renderMedia(m);else{session.view={type:'library'};renderList('media');}
    } else if(view.type==='library')renderList('media');
    else if(view.type==='stories')renderList('stories');
    else if(view.type==='settings')renderSettings();
    else renderFamily();
    const active={person:'family',story:'stories',media:'library'}[session.view.type] || session.view.type;
    document.querySelectorAll('[data-view]').forEach(b=>{if(b.dataset.view===active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    document.title=`${$('screenHeading').textContent} — семейный архив`;
    renderUploads();storeDrafts();
    if(focus)($(focus)||$('screenHeading')).focus();
  }
  function navigate(type,id,context) {if(busy)return;session.view={type,id,context};render();}
  function open(kind,id,context) {navigate({people:'person',stories:'story',media:'media'}[kind],id,context);}
  function create(kind,context) {
    const value=model.empty(kind);
    if(kind==='stories' && context) {
      if(!item('people',context)) {status('Карточка человека больше не доступна.');return;}
      value.personIds=[context];value._contextPersonId=context;
    }
    markDraft(kind,value);open(kind,value.id,context);$(kind==='people'?'fullName':kind==='stories'?'storyTitle':'mediaTitle').focus();
  }
  function capture(form) {
    if(!form?.dataset.kind)return;
    const {kind,id}=form.dataset,value=draft(kind,id);
    for(const field of form.querySelectorAll('input[name]:not([type="checkbox"]):not([type="radio"]),textarea[name],select[name]'))value[field.name]=field.value || (['motherId','fatherId'].includes(field.name)?null:'');
    for(const group of form.querySelectorAll('fieldset[data-key]'))value[group.dataset.key]=[...group.querySelectorAll('input:checked')].map(input=>input.value);
    const primary=form.querySelector('input[name="primaryMediaId"]:checked');
    if(primary) {value.primaryMediaId=primary.value;if(primary.value&&!value.mediaIds.includes(primary.value))value.mediaIds.push(primary.value);}
    storeDrafts();
  }
  main.addEventListener('input',event=>{
    const target=event.target;
    if(target.id==='peopleSearch') {session.search=target.value;familyResults();storeDrafts();}
    else if(target.id==='librarySearch')listResults(session.view.type==='library'?'media':'stories',target.value);
    else if(target.id==='archiveTitleInput') {session.settings.title=target.value;session.settings.titleTouched=true;storeDrafts();}
    else if(target.id==='jsonOutput') {session.settings.jsonText=target.value;storeDrafts();}
    else capture(target.closest('form'));
    if(target.getAttribute('aria-invalid')==='true')target.removeAttribute('aria-invalid');
  });
  main.addEventListener('change',event=>{
    const target=event.target;
    if(target.id==='storyCategoryFilter') {session.storyCategoryFilter=target.value;listResults('stories',$('librarySearch').value);storeDrafts();return;}
    if(target.id==='importFile') {const file=target.files[0];if(file)void file.text().then(text=>importArchive(core.parseArchiveJson(text))).catch(e=>status(`Ошибка импорта: ${e.message}`));target.value='';return;}
    if(target.id==='rootPersonInput') {session.settings.rootPersonId=target.value;session.settings.rootTouched=true;storeDrafts();return;}
    capture(target.closest('form'));
    if(target.name==='primaryMediaId' && target.value) {
      const checkbox=$('mediaIds')?.querySelector(`input[value="${CSS.escape(target.value)}"]`);if(checkbox)checkbox.checked=true;
    }
    if(target.closest('#mediaIds') && !target.checked) {
      const p=draft('people',session.view.id);
      if(p.primaryMediaId===target.value) {p.primaryMediaId='';p.mediaIds=p.mediaIds.filter(id=>id!==target.value);storeDrafts();}
      render('addFromLibraryButton');
      status('Связь с файлом убрана из карточки. Сохраните человека, чтобы закрепить изменение.');
    }
  });
  main.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const form=event.target;
    if(form.id==='archiveForm') {
      const next=clone(archive);next.title=$('archiveTitleInput').value.trim()||'Семейный архив';next.rootPersonId=$('rootPersonInput').value||archive.people[0]?.id||null;
      if(await commit(next,'Настройки архива сохранены.')) {session.settings.title=archive.title;delete session.settings.titleTouched;delete session.settings.rootTouched;storeDrafts();render('saveArchiveButton');}else fail(new Error($('editorStatus').textContent),'archiveForm');
      return;
    }
    if(!form.dataset.kind)return;
    capture(form);
    const {kind,id}=form.dataset;
    try {
      let next=archive;
      const clear=[[kind,id]], context=session.view.context || draft(kind,id)._contextPersonId;
      if(kind==='stories' && context && !archive.people.some(p=>p.id===context) && draft(kind,id).personIds.includes(context)) {
        next=model.save(next,'people',draft('people',context));
        clear.push(['people',context]);
      }
      next=model.save(next,kind,draft(kind,id));
      if(await commit(next,'Карточка сохранена в архиве.',clear))render('saveEntityButton');
      else fail(new Error($('editorStatus').textContent),form.id);
    } catch(error) {fail(error,form.id);}
  });
  let libraryPersonId=null, libraryCandidates=[], librarySelection=new Set();
  function renderPersonLibrary() {
    const term=$('personLibrarySearch').value.trim().toLocaleLowerCase('ru');
    const entries=libraryCandidates.filter(m=>m.title.toLocaleLowerCase('ru').includes(term));
    $('personLibraryResults').innerHTML=entries.length?entries.map(m=>`<label class="check-row"><input type="checkbox" value="${h(m.id)}" ${librarySelection.has(m.id)?'checked':''}><span>${h(m.title || 'Файл без названия')} — ${h(typeName[m.type])}</span></label>`).join(''):'<p class="hint">Нет файлов для добавления. Измените поиск или загрузите новые файлы в карточке.</p>';
    $('personLibraryStatus').textContent=`Найдено: ${entries.length}. Выбрано для добавления: ${librarySelection.size}.`;
    $('confirmPersonLibraryButton').disabled=!librarySelection.size;
  }
  function closePersonLibrary() {
    $('personLibraryDialog').close();libraryPersonId=null;libraryCandidates=[];librarySelection.clear();
    $('addFromLibraryButton')?.focus();
  }
  $('personLibrarySearch').addEventListener('input',renderPersonLibrary);
  $('personLibraryResults').addEventListener('change',event=>{
    const input=event.target;if(!input.matches('input[type="checkbox"]'))return;
    if(input.checked)librarySelection.add(input.value);else librarySelection.delete(input.value);
    $('personLibraryStatus').textContent=`Найдено: ${$('personLibraryResults').querySelectorAll('input').length}. Выбрано для добавления: ${librarySelection.size}.`;
    $('confirmPersonLibraryButton').disabled=!librarySelection.size;
  });
  $('cancelPersonLibraryButton').addEventListener('click',closePersonLibrary);
  $('personLibraryDialog').addEventListener('cancel',event=>{event.preventDefault();closePersonLibrary();});
  $('personLibraryDialog').addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const controls=[...$('personLibraryForm').querySelectorAll('input,button')].filter(control=>!control.disabled && control.getClientRects().length);
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey&&document.activeElement===first) {event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last) {event.preventDefault();first.focus();}
  });
  $('personLibraryForm').addEventListener('submit',event=>{
    event.preventDefault();if(busy || !librarySelection.size || session.view.type!=='person' || session.view.id!==libraryPersonId)return;
    capture($('personForm'));
    const p=draft('people',libraryPersonId);
    for(const id of librarySelection)if(archive.media.some(m=>m.id===id) && !p.mediaIds.includes(id))p.mediaIds.push(id);
    closePersonLibrary();render('addFromLibraryButton');
    status('Файлы добавлены в карточку. Сохраните человека, чтобы закрепить связи.');
  });
  function dialogClose() {if(busy)return;$('parentDialog').close();$(parentReturn)?.focus();}
  $('cancelParentButton').addEventListener('click',dialogClose);
  $('parentDialog').addEventListener('cancel',event=>{event.preventDefault();dialogClose();});
  $('parentDialog').addEventListener('keydown',event=>{
    if(event.key!=='Tab'||busy)return;
    const controls=[...$('parentForm').querySelectorAll('input,select,button')].filter(control=>!control.disabled);
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey&&document.activeElement===first) {event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last) {event.preventDefault();first.focus();}
  });
  function captureParent() {
    session.parentDrafts ||= {};
    session.parentDrafts[session.view.id+':'+parentRole]={name:$('parentName').value,existing:$('parentExisting').value};
    storeDrafts();
  }
  $('parentForm').addEventListener('input',captureParent);
  $('parentExisting').addEventListener('change',captureParent);
  $('parentForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const child=clone(draft('people',session.view.id)),existing=$('parentExisting').value,name=$('parentName').value.trim();
    $('parentError').textContent='';
    try {
      if(existing && name)throw Object.assign(new Error('Выберите существующего человека или введите новое имя, но не оба варианта.'),{field:'parentName'});
      if(!existing && !name)throw Object.assign(new Error('Выберите человека из семьи или укажите имя нового родителя.'),{field:'parentName'});
      model.validate('people',child);
      let next=archive,parent;
      if(existing)parent=archive.people.find(p=>p.id===existing);
      else {
        if(archive.people.some(p=>p.fullName.toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru')))throw Object.assign(new Error('В семье уже есть человек с этим именем. Выберите его из списка; если это другой человек, уточните имя.'),{field:'parentName'});
        parent={...model.empty('people'),fullName:name};next=model.save(next,'people',parent);
      }
      if(!parent)throw new Error('Выбранный родитель больше не доступен.');
      child[parentRole]=parent.id;
      next=model.save(next,'people',child);
      if(await commit(next,'Родитель добавлен и связан с человеком.',[['people',child.id]])) {
        delete session.parentDrafts?.[child.id+':'+parentRole];storeDrafts();$('parentDialog').close();render(parentReturn);
      } else {$('parentError').textContent=$('editorStatus').textContent;$('parentName').focus();}
    } catch(error) {
      $('parentError').textContent=error.message+(error.field==='fullName'?' Закройте это окно и заполните имя ребёнка.':'');
      const field=$(error.field);
      if(field && $('parentForm').contains(field)) {field.setAttribute('aria-invalid','true');field.focus();}
      else $('parentError').focus();
    }
  });
  // Archive replacement needs a separate commit: existing forms and upload queues belong to the old archive.
  async function replaceArchive(imported,message) {
    if(busy)return false;
    lock(true);status('Открываем архив…');storeDrafts();
    try {
      imported=core.ensureArchiveShape(imported);await requireArchiveIdentity();await core.saveArchive(imported);
      archive=imported;getSession();storeDrafts();status(message);return true;
    } catch(error) {status(`Не удалось заменить архив: ${error.message}. Текущие данные и черновики оставлены.`);return false;}
    finally {lock(false);}
  }
  async function importArchive(imported) {
    if(busy)return;
    if(!window.confirm('Заменить сохранённый архив? Сначала экспортируйте резервную копию. Черновики останутся в разделе «Архив и перенос».'))return;
    if(await replaceArchive(imported,'Архив импортирован.')){session.view={type:'settings'};render();}
  };
  async function deleteEntity(kind,id) {
    if(!window.confirm(`Удалить ${kindName[kind]} «${item(kind,id)?.fullName||item(kind,id)?.title||''}» и все связи этой карточки? Другие карточки и сами файлы останутся.`))return;
    if(await commit(model.remove(archive,kind,id),'Карточка удалена. Другие черновики оставлены.',[[kind,id]]))navigate(kind==='people'?'family':kind==='stories'?'stories':'library');
  }
  document.addEventListener('click',async event=>{
    const control=event.target.closest('[data-action],[data-view]');if(!control||busy)return;
    const data=control.dataset;
    if(data.view) {navigate(data.view);return;}
    try {
      switch(data.action) {
        case 'open':open(data.kind,data.id,data.context);break;
        case 'new':create(data.kind,data.context);break;
        case 'family':case 'library':case 'stories':navigate(data.action);break;
        case 'backPerson':open('people',session.view.context || item('stories',session.view.id)?._contextPersonId);break;
        case 'discard':
          if(window.confirm('Отменить только изменения этой карточки? Другие черновики останутся.')) {
            delete session.drafts[data.kind][data.id];storeDrafts();
            if(archive[data.kind].some(entry=>entry.id===data.id))render();else navigate(data.kind==='people'?'family':data.kind==='stories'?'stories':'library');
          }break;
        case 'delete':await deleteEntity(data.kind,data.id);break;
        case 'root': {
          if(!archive.people.some(p=>p.id===data.id)) {status('Сначала сохраните человека, затем сделайте его началом дерева.');break;}
          const next=clone(archive);next.rootPersonId=data.id;
          if(await commit(next,'Начало дерева изменено.'))render('setRootButton');break;
        }
        case 'personLibrary': {
          libraryPersonId=session.view.id;librarySelection.clear();
          const p=item('people',libraryPersonId);
          libraryCandidates=archive.media.filter(m=>!p.mediaIds.includes(m.id));
          $('personLibrarySearch').value='';renderPersonLibrary();
          $('personLibraryDialog').showModal();$('personLibrarySearch').focus();break;
        }
        case 'parent': {
          capture($('personForm'));parentRole=data.role;parentReturn=control.id;
          const saved=session.parentDrafts?.[session.view.id+':'+parentRole];
          $('parentDialogHeading').textContent=parentRole==='motherId'?'Добавить мать':'Добавить отца';
          $('parentExisting').innerHTML='<option value="">Создать нового человека</option>'+archive.people.filter(p=>p.id!==session.view.id).map(p=>`<option value="${h(p.id)}">${h(p.fullName)}</option>`).join('');
          $('parentExisting').value=saved?.existing||'';$('parentName').value=saved?.name||'';$('parentError').textContent='';
          $('parentDialog').showModal();$('parentExisting').focus();break;
        }
        case 'document':if(native?.openMedia)await native.openMedia(data.path);break;
        case 'folder':await chooseArchiveFolder();break;
        case 'upload':await selectUploads(data.context||null,data.folder==='true');break;
        case 'reselectUpload': {
          const entry=session.pendingUploads.find(e=>e.id===data.id && !e.copied);if(!entry || native)break;
          recoveryUploadId=entry.id;const input=$('mediaFileInput');input.value='';input.multiple=false;input.click();break;
        }
        case 'retryUploads':await saveUploads();break;
        case 'copyUploads':await copyQueuedFiles();break;
        case 'manualUploads':
          if(window.confirm('Вы подтверждаете, что вручную скопировали все перечисленные файлы в media/ с указанными именами? Без файлов они не откроются после перезапуска.')) {
            session.pendingUploads.forEach(entry=>{entry.copied=true;entry.error='';});storeDrafts();await saveUploads();
          }break;
        case 'dismissUploadErrors':session.uploadErrors=[];storeDrafts();renderUploads();break;
        case 'removeUpload':session.pendingUploads=session.pendingUploads.filter(e=>e.id!==data.id);browserFiles.delete(data.id);storeDrafts();renderUploads();break;
        case 'export':
          if(hasDrafts(session) && !window.confirm('Экспортировать только сохранённые карточки? Черновики останутся в редакторе и не попадут в эту копию.'))break;
          if(native) {const result=await native.exportArchive();status(result==null?'Экспорт отменён.':'Полный архив экспортирован.');}
          else {core.downloadJson('archive.json',archive);status('Файл archive.json экспортирован. Переносите его вместе с папкой media/.');}break;
        case 'importText':await importArchive(core.parseArchiveJson($('jsonOutput').value));break;
        case 'nativeOpen':case 'nativeImport': {
          if(!window.confirm('Открыть другой полный архив? Сохранённая копия будет заменена. Экспортируйте резервную копию; черновики останутся отдельно.'))break;
          lock(true);storeDrafts();
          try {const imported=await native[data.action==='nativeOpen'?'openArchive':'importArchive']();
            if(imported!=null){archive=core.ensureArchiveShape(imported);archiveIdentity=await readArchiveIdentity();getSession();session.view={type:'settings'};status('Полный архив открыт.');}
            else status('Открытие отменено.');
          } finally {lock(false);render();}break;
        }
        case 'restoreSession': {
          const saved=database.sessions[Number(data.index)];if(!saved)break;
          if(!canRestoreSession(saved))throw new Error('Восстановление заблокировано: откройте исходный полный архив. Идентификатор папки и поколения архива должен совпадать; для старых черновиков без идентификатора восстановление недоступно.');
          await requireArchiveIdentity(saved.archiveIdentity);
          if(window.confirm('Вернуть сохранённый снимок этого архива и его черновики? Сначала экспортируйте текущий архив.'))if(await replaceArchive(core.parseArchiveJson(saved.base),'Архив и его черновики восстановлены.'))render();break;
        }
        case 'reset':
          if(window.confirm('Очистить сохранённый архив? Перед этим экспортируйте копию. Черновики прежнего архива останутся отдельно; сами файлы не удаляются.'))if(await replaceArchive(clone(core.fallbackArchive),'Сохранённый архив очищен.')) {session.view={type:'family'};render();}break;
      }
    } catch(error) {status(`Не удалось выполнить действие: ${error.message}. Данные не потеряны.`);}
  });
  // Actual files are copied before their metadata is committed; failed metadata writes are retryable.
  async function chooseArchiveFolder() {
    if(typeof window.showDirectoryPicker!=='function') {status('Этот браузер не разрешает запись в папку. Скопируйте файлы в media/ вручную и подтвердите это в списке загрузки.');return false;}
    try {folderHandle=await window.showDirectoryPicker({mode:'readwrite'});status('Папка архива разрешена для копирования файлов.');return true;}
    catch(error) {if(error.name!=='AbortError')status(`Папка не открыта: ${error.message}`);else status('Выбор папки отменён.');return false;}
  }
  async function copyBrowserFile(entry,file) {
    if(!folderHandle)throw new Error('Разрешите папку архива или скопируйте файл вручную.');
    if(folderHandle.queryPermission && await folderHandle.queryPermission({mode:'readwrite'})!=='granted' && await folderHandle.requestPermission({mode:'readwrite'})!=='granted')throw new Error('Нет разрешения на запись в папку архива.');
    const directory=await folderHandle.getDirectoryHandle('media',{create:true});
    let name=model.fileName(file.name),dot=name.lastIndexOf('.'),stem=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):'';
    const reserved=new Set([...archive.media.map(m=>m.path),...session.pendingUploads.filter(e=>e.id!==entry.id).map(e=>e.path)]);
    for(let i=0;;i++) {
      const candidate=i?`${stem}-${i}${ext}`:name;
      if(reserved.has(`media/${candidate}`))continue;
      try {await directory.getFileHandle(candidate);}
      catch(error) {if(error.name==='NotFoundError'){name=candidate;break;}throw error;}
    }
    const handle=await directory.getFileHandle(name,{create:true});const writable=await handle.createWritable();
    try {await writable.write(file);await writable.close();}
    catch(error) {try {await writable.abort();}catch(_){}throw error;}
    entry.path=`media/${name}`;entry.copied=true;entry.error='';
  }
  async function copyQueuedFiles() {
    if(busy)return;
    if(!folderHandle && !await chooseArchiveFolder())return;
    lock(true);status('Копирование файлов…');
    try {
      for(const entry of session.pendingUploads.filter(e=>!e.copied)) {
        const file=browserFiles.get(entry.id);
        if(!file) {entry.error='После перезапуска выберите этот файл заново. Исходный файл не хранится в браузере.';continue;}
        try {await copyBrowserFile(entry,file);}catch(error){entry.error=error.message;}
        storeDrafts();
      }
    } finally {lock(false);renderUploads();}
    await saveUploads();
  }
  async function selectUploads(context,folder) {
    if(busy)return;
    if(context)capture($('personForm'));
    uploadContext=context;recoveryUploadId=null;
    if(native) {
      lock(true);status('Выбор файлов…');
      try {
        const result=typeof native.pickMediaBatch==='function'?await native.pickMediaBatch({folder}):{media:[await native.pickMedia()].filter(Boolean),errors:[]};
        if(!result) {status('Выбор файлов отменён.');return;}
        for(const media of result.media || []) {
          const entry={...model.empty('media'),...media,id:core.createId('media'),personIds:[],storyIds:[],context,copied:true,error:''};
          try {model.validate('media',entry);session.pendingUploads.push(entry);}
          catch(error){session.uploadErrors=(session.uploadErrors||[]).concat(`${media.title||media.path}: ${error.message}`);}
        }
        session.uploadErrors=(session.uploadErrors||[]).concat((result.errors||[]).map(e=>`${e.name}: ${e.message}`));storeDrafts();
      } finally {lock(false);renderUploads();}
      await saveUploads();
    } else {
      const input=$(folder?'mediaFolderInput':'mediaFileInput');input.multiple=true;input.value='';input.click();
    }
  }
  async function receivedBrowserFiles(files) {
    if(!files.length)return;
    const limit=500,maxBytes=512*1024*1024;
    if(files.length>limit) {status(`За один раз можно выбрать до ${limit} файлов. Выбрано ${files.length}; ничего не добавлено.`);return;}
    if(recoveryUploadId) {
      const entry=session.pendingUploads.find(e=>e.id===recoveryUploadId && !e.copied);recoveryUploadId=null;
      if(!entry)return;
      if(files.length!==1 || files[0].name!==entry.sourceName || files[0].size!==entry.sourceSize) {status('Выберите один исходный файл с тем же именем и размером для указанной записи. Очередь не изменена.');return;}
      browserFiles.set(entry.id,files[0]);entry.error='';storeDrafts();renderUploads();
      if(folderHandle)await copyQueuedFiles();else status('Исходный файл выбран для указанной записи. Разрешите папку архива для копирования.');
      return;
    }
    for(const file of files) {
      const type=model.fileType(file.name);
      if(!type || file.size>maxBytes) {session.uploadErrors=(session.uploadErrors||[]).concat(`${file.name}: ${!type?'формат не поддерживается':'файл больше 512 МБ'}`);continue;}
      // Each selected file is a distinct queue item, even for equal basename/size.
      // Recovery is an explicit per-entry action, never a metadata-based guess.
      let entry;
      {
        const filename=model.fileName(file.name), dot=filename.lastIndexOf('.');
        const stem=filename.slice(0,dot), ext=filename.slice(dot);
        const reserved=new Set([...archive.media,...session.pendingUploads].map(e=>e.path));
        let name=filename;
        for(let n=1;reserved.has('media/'+name);n++)name=stem+'-'+n+ext;
        entry={...model.empty('media'),title:file.name.replace(/\.[^.]+$/,'')||'Файл',type,path:'media/'+name,context:uploadContext,copied:false,error:'',sourceName:file.name,sourceSize:file.size,sourceRelativePath:file.webkitRelativePath||'',sourceLastModified:file.lastModified};
        session.pendingUploads.push(entry);
      }
      entry.error='';browserFiles.set(entry.id,file);
    }
    storeDrafts();renderUploads();
    if(folderHandle)await copyQueuedFiles();
    else status('Файлы выбраны, но ещё не скопированы и не сохранены. Разрешите папку архива или скопируйте их вручную.');
  }
  for(const id of ['mediaFileInput','mediaFolderInput'])$(id).addEventListener('change',event=>void receivedBrowserFiles([...event.target.files]).catch(e=>status(`Ошибка загрузки: ${e.message}`)));
  async function saveUploads() {
    if(busy)return;
    const ready=session.pendingUploads.filter(e=>e.copied);if(!ready.length){renderUploads();return;}
    try {
      let next=archive;
      for(const entry of ready) {
        const value={...model.empty('media',entry.id),title:entry.title,type:entry.type,path:entry.path,personIds:archive.people.some(p=>p.id===entry.context)?[entry.context]:[],storyIds:[]};
        next=model.save(next,'media',value);
      }
      if(await commit(next,`Файлы сохранены в библиотеке: ${ready.length}.`)) {
        for(const entry of ready) {
          if(entry.context && item('people',entry.context)) {
            const p=draft('people',entry.context);if(!p.mediaIds.includes(entry.id))p.mediaIds.push(entry.id);
          }
          browserFiles.delete(entry.id);
        }
        session.pendingUploads=session.pendingUploads.filter(e=>!ready.some(r=>r.id===e.id));storeDrafts();
        if(ready.some(e=>e.context&&!archive.people.some(p=>p.id===e.context)))status('Файлы сохранены в библиотеке. Сохраните новую карточку человека, чтобы закрепить связи.');
        render();
      } else renderUploads();
    } catch(error) {status(`Файлы не добавлены в архив: ${error.message}. Очередь загрузки оставлена для повторного сохранения.`);renderUploads();}
  }
  function renderUploads() {
    const panel=$('uploadPanel'),pending=session.pendingUploads,errors=session.uploadErrors||[];
    panel.hidden=!pending.length&&!errors.length;
    panel.innerHTML=`<h2 id="uploadHeading">Загрузка файлов</h2>${pending.length?`<ul class="entry-list">${pending.map(e=>`<li><strong>${h(e.sourceRelativePath||e.title)}</strong> — ${h(e.path)}<p>${e.copied?'Скопирован. Ожидает сохранения записи в архив.':'Не скопирован. Выбор файла не означает его сохранение.'}${e.error?' '+h(e.error):''}</p>${!native&&!e.copied?button('Выбрать заново для этой записи: '+(e.sourceRelativePath||e.title),'reselectUpload',`data-id="${h(e.id)}"`):''}${button('Убрать из очереди: '+e.title,'removeUpload',`data-id="${h(e.id)}"`)}</li>`).join('')}</ul><div class="actions">${pending.some(e=>e.copied)?button('Повторить сохранение файлов','retryUploads'):''}${!native&&pending.some(e=>!e.copied)?button('Скопировать в папку архива','copyUploads')+button('Файлы уже скопированы вручную','manualUploads'):''}</div>`:''}${errors.length?`<h3>Не удалось загрузить</h3><ul>${errors.map(e=>`<li>${h(e)}</li>`).join('')}</ul>${button('Закрыть сообщения о файлах','dismissUploadErrors')}`:''}`;
  }
  main.addEventListener('error',event=>{
    if(event.target.matches('[data-preview]')) {
      const message=document.createElement('p');message.className='media-error';message.textContent='Файл не удалось открыть. Проверьте, что он существует в media/ и поддерживается устройством.';event.target.replaceWith(message);
    }
  },true);
  window.addEventListener('beforeunload',event=>{if(!storeDrafts() || busy){event.preventDefault();event.returnValue='';}});
  render(null);
  status('Редактор готов. Сохранённый архив открыт; черновики восстановлены, если они были.');
});
