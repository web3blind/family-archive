const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../assets/js/archive-core.js');
const model = require('../assets/js/editor-model.js');
const empty = () => core.deepClone(core.fallbackArchive);
const person = (id, name = id) => ({...model.empty('people', id), fullName:name});
test('name-only person and independent media/story preserve v1 schema', () => {
  let a = model.save(empty(), 'people', person('child'));
  a = model.save(a, 'media', {...model.empty('media','photo'),title:'Тест',path:'media/test.jpg'});
  a = model.save(a, 'stories', {...model.empty('stories','story'),title:'Тест',text:'Рассказ'});
  assert.equal(a.rootPersonId,'child');
  assert.equal(a.people[0].rememberFor,'');
  assert.deepEqual(a.media[0].personIds,[]);
  assert.equal(core.ensureArchiveShape(a).version,1);
});
test('cycles and duplicate parents reject atomically', () => {
  let a = model.save(empty(),'people',person('child'));
  a = model.save(a,'people',person('mother'));
  a = model.save(a,'people',{...a.people[0],motherId:'mother'});
  const before=JSON.stringify(a);
  assert.throws(()=>model.save(a,'people',{...a.people[1],fatherId:'child'}),/цикл/i);
  assert.throws(()=>model.save(a,'people',{...a.people[0],fatherId:'mother'}),/один/i);
  assert.equal(JSON.stringify(a),before);
});
test('shared media, main photo and story links are reciprocal; removal cleans references', () => {
  let a = model.save(empty(),'people',person('a'));
  a = model.save(a,'people',person('b'));
  a = model.save(a,'media',{...model.empty('media','m'),title:'Фото',path:'media/a.jpg',personIds:['a','b']});
  a = model.save(a,'people',{...a.people[0],primaryMediaId:'m'});
  a = model.save(a,'stories',{...model.empty('stories','s'),title:'Рассказ',text:'Текст',personIds:['a','b'],mediaIds:['m']});
  assert.deepEqual(a.people[1].mediaIds,['m']);
  assert.deepEqual(a.media[0].storyIds,['s']);
  a = model.remove(a,'media','m');
  assert.equal(a.people[0].primaryMediaId,'');
  assert.deepEqual(a.people[1].mediaIds,[]);
  assert.deepEqual(a.stories[0].mediaIds,[]);
});
test('rebasing unrelated drafts preserves edits and incorporates newly linked items', () => {
  const old = person('a');
  const draft = {...old,bio:'Не потерять',mediaIds:['old']};
  const now = {...old,mediaIds:['new'],storyIds:['s']};
  const next=model.rebase(draft,old,now);
  assert.equal(next.bio,'Не потерять');
  assert.deepEqual(next.mediaIds,['new','old']);
  assert.deepEqual(next.storyIds,['s']);
});
test('legacy one-sided associations stay selected and survive unrelated entity edits', () => {
  const a=core.ensureArchiveShape({version:1,title:'Synthetic legacy',rootPersonId:'p',people:[{...model.empty('people','p'),fullName:'Синтетический человек'}],stories:[{...model.empty('stories','s'),title:'Синтетическая история',text:'Тест',personIds:['p']}],media:[{...model.empty('media','m'),title:'Синтетическое фото',path:'media/photo.jpg',personIds:['p'],storyIds:['s']}]});
  const person=model.editable(a,'people','p');assert.deepEqual(person.mediaIds,['m']);assert.deepEqual(person.storyIds,['s']);
  const updated=model.save(a,'people',{...person,bio:'Изменена только биография'});assert.deepEqual(updated.media[0].personIds,['p']);assert.deepEqual(updated.stories[0].personIds,['p']);
  assert.deepEqual(model.editable(a,'stories','s').mediaIds,['m']);
  assert.equal(model.fileName('.jpg'),'file.jpg');assert.equal(model.fileName('.hidden.jpg'),'hidden.jpg');
});
test('person-scoped explicit sharing and unlink preserve the other person, media identity and legacy main-photo links', () => {
  let a=model.save(empty(),'people',person('child'));
  a=model.save(a,'people',person('mother'));
  a=model.save(a,'media',{...model.empty('media','shared'),title:'Общее фото',path:'media/shared.jpg',personIds:['child']});
  a=model.save(a,'people',{...model.editable(a,'people','child'),primaryMediaId:'shared'});
  const mediaBefore=core.deepClone(a.media[0]);
  a=model.save(a,'people',{...model.editable(a,'people','mother'),mediaIds:['shared'],primaryMediaId:'shared'});
  assert.deepEqual(a.media[0],{...mediaBefore,personIds:['child','mother']});
  a=model.save(a,'people',{...model.editable(a,'people','mother'),mediaIds:[],primaryMediaId:''});
  assert.deepEqual(a.media[0],mediaBefore);
  assert.equal(a.people.find(p=>p.id==='child').primaryMediaId,'shared');
  assert.deepEqual(a.people.find(p=>p.id==='child').mediaIds,['shared']);
  const legacy=core.deepClone(a);
  legacy.people.find(p=>p.id==='child').mediaIds=[];legacy.media[0].personIds=[];
  const p=model.editable(legacy,'people','child');assert.deepEqual(p.mediaIds,['shared']);
  const repaired=model.save(legacy,'people',{...p,bio:'Изменение биографии'});
  assert.equal(repaired.people.find(p=>p.id==='child').primaryMediaId,'shared');assert.deepEqual(repaired.media[0].personIds,['child']);
});
test('media path/type validation and sanitized filenames retain extensions', () => {
  assert.equal(model.fileType('picture.avif'),'photo');
  assert.equal(model.fileType('voice.opus'),'audio');
  assert.equal(model.fileType('book.pdf'),'document');
  assert.match(model.fileName('../a?.jpg'),/\.jpg$/);
  assert.ok(core.validMediaPath('media/'+model.fileName('../a?.jpg')));
  assert.throws(()=>model.save(empty(),'media',{...model.empty('media','m'),title:'X',path:'media/a.jpg',type:'audio'}),/тип/i);
});
