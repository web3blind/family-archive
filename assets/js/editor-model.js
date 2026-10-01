/* Pure v1 archive operations. The UI commits these snapshots only after a successful write. */
(function (global) {
  'use strict';
  const core = global.FamilyArchive || (typeof require === 'function' ? require('./archive-core.js') : null);
  const clone = core.deepClone;
  const types = {
    photo: /\.(jpg|jpeg|png|gif|webp|avif|bmp|svg|heic|heif)$/i,
    audio: /\.(mp3|m4a|wav|ogg|opus|flac|aac)$/i,
    video: /\.(mp4|webm|mov|mkv|m4v|avi)$/i,
    document: /\.(pdf|txt|md|rtf|doc|docx|odt|xls|xlsx|ppt|pptx|csv)$/i
  };
  function empty(kind, id = core.createId(kind.slice(0,-1))) {
    if (kind === 'people') return {id,fullName:'',birthDate:'',deathDate:'',country:'',place:'',motherId:null,fatherId:null,primaryMediaId:'',rememberFor:'',bio:'',storyIds:[],mediaIds:[]};
    if (kind === 'stories') return {id,title:'',text:'',date:'',author:'',personIds:[],mediaIds:[]};
    if (kind === 'media') return {id,title:'',type:'photo',path:'',personIds:[],storyIds:[]};
    throw new Error('Неизвестная карточка.');
  }
  function fileType(name) { return Object.keys(types).find(type => types[type].test(name)) || null; }
  function fileName(name) {
    const raw=String(name || 'file').normalize('NFC');
    const extension=raw.match(/\.[a-z0-9]+$/i)?.[0] || '';
    const safe=raw.replace(/[^\p{L}\p{N} _.,()\-]/gu,'-').replace(/^\.+/,'').trim() || 'file';
    const ext=extension, stem=ext && safe.toLowerCase().endsWith(ext.toLowerCase())?safe.slice(0,-ext.length):safe===ext.slice(1)?'file':safe;
    return (stem || 'file').slice(0,120-ext.length)+ext;
  }
  function error(message, field) { const e=new Error(message); e.field=field; throw e; }
  function validate(kind, item) {
    if (kind === 'people') {
      if (!item.fullName.trim()) error('Укажите имя человека. Остальные поля можно заполнить позже.','fullName');
      if (item.motherId && item.motherId === item.fatherId) error('Один человек не может быть одновременно матерью и отцом.','fatherId');
    } else if (kind === 'stories') {
      if (!item.title.trim()) error('Укажите название истории.','storyTitle');
      if (!item.text.trim()) error('Запишите текст истории.','storyText');
    } else {
      if (!item.title.trim()) error('Укажите название файла.','mediaTitle');
      if (!core.validMediaPath(item.path)) error('Укажите безопасный относительный путь media/имя-файла.ext.','mediaPath');
      if (!fileType(item.path)) error('Этот формат файла не поддерживается.','mediaPath');
      if (fileType(item.path) !== item.type) error('Тип не соответствует расширению файла. Выберите подходящий тип.','mediaType');
    }
  }
  function setLink(item, key, id, included) {
    item[key]=item[key].filter(value=>value!==id);
    if (included) item[key].push(id);
  }
  function save(source, kind, value) {
    const archive=clone(source), item=clone(value);
    for (const key of Object.keys(item)) {
      if (typeof item[key] === 'string' && key !== 'id') item[key]=item[key].trim();
      if (Array.isArray(item[key])) item[key]=[...new Set(item[key])];
    }
    validate(kind,item);
    const index=archive[kind].findIndex(entry=>entry.id===item.id);
    if (index<0) archive[kind].push(item); else archive[kind][index]=item;
    if (kind==='people') {
      if (item.primaryMediaId && !item.mediaIds.includes(item.primaryMediaId)) item.mediaIds.push(item.primaryMediaId);
      archive.stories.forEach(story=>setLink(story,'personIds',item.id,item.storyIds.includes(story.id)));
      archive.media.forEach(media=>setLink(media,'personIds',item.id,item.mediaIds.includes(media.id)));
    } else if (kind==='stories') {
      archive.people.forEach(person=>setLink(person,'storyIds',item.id,item.personIds.includes(person.id)));
      archive.media.forEach(media=>setLink(media,'storyIds',item.id,item.mediaIds.includes(media.id)));
    } else {
      archive.people.forEach(person=>{
        setLink(person,'mediaIds',item.id,item.personIds.includes(person.id));
        if (person.primaryMediaId===item.id && (!item.personIds.includes(person.id) || item.type!=='photo')) person.primaryMediaId='';
      });
      archive.stories.forEach(story=>setLink(story,'mediaIds',item.id,item.storyIds.includes(story.id)));
    }
    try { return core.ensureArchiveShape(archive); }
    catch(e) { if (/цикл/i.test(e.message)) e.field=kind==='people'?'motherId':null; throw e; }
  }
  function remove(source, kind, id) {
    const a=clone(source);
    a[kind]=a[kind].filter(item=>item.id!==id);
    if (kind==='people') {
      a.people.forEach(p=>{ if(p.motherId===id)p.motherId=null; if(p.fatherId===id)p.fatherId=null; });
      [...a.stories,...a.media].forEach(item=>setLink(item,'personIds',id,false));
      if(a.rootPersonId===id)a.rootPersonId=a.people[0]?.id || null;
    } else if(kind==='stories') {
      a.people.forEach(p=>setLink(p,'storyIds',id,false)); a.media.forEach(m=>setLink(m,'storyIds',id,false));
    } else {
      a.people.forEach(p=>{setLink(p,'mediaIds',id,false);if(p.primaryMediaId===id)p.primaryMediaId='';});
      a.stories.forEach(s=>setLink(s,'mediaIds',id,false));
    }
    return core.ensureArchiveShape(a);
  }
  // Incorporate external link changes without discarding a draft's explicit additions/removals.
  function rebase(draft, before, after) {
    if(!before || !after)return clone(draft);
    const next=clone(draft);
    for(const key of Object.keys(after)) {
      if(Array.isArray(after[key])) {
        const removed=before[key].filter(id=>!draft[key].includes(id));
        const added=draft[key].filter(id=>!before[key].includes(id));
        next[key]=[...new Set([...after[key].filter(id=>!removed.includes(id)),...added])];
      } else if(draft[key]===before[key])next[key]=after[key];
    }
    return next;
  }
  function editable(archive, kind, id) {
    const value = clone(archive[kind].find(entry => entry.id === id) || empty(kind, id));
    const union = (key, refs) => { value[key] = [...new Set([...value[key], ...refs])]; };
    if (kind === 'people') {
      union('mediaIds', archive.media.filter(m => m.personIds.includes(id) || m.id === value.primaryMediaId).map(m => m.id));
      union('storyIds', archive.stories.filter(s => s.personIds.includes(id)).map(s => s.id));
    } else if (kind === 'stories') {
      union('personIds', archive.people.filter(p => p.storyIds.includes(id)).map(p => p.id));
      union('mediaIds', archive.media.filter(m => m.storyIds.includes(id)).map(m => m.id));
    } else {
      union('personIds', archive.people.filter(p => p.mediaIds.includes(id) || p.primaryMediaId === id).map(p => p.id));
      union('storyIds', archive.stories.filter(s => s.mediaIds.includes(id)).map(s => s.id));
    }
    return value;
  }
  const api={empty,editable,fileType,fileName,validate,save,remove,rebase};
  global.FamilyEditorModel=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
