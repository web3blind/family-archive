'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../assets/js/archive-core.js');
const model=require('../assets/js/editor-model.js');
const categoryIds=['family-stories','letters','knowledge','place-home','plans-results','book-introduction'];
const base=()=>({version:1,title:'Synthetic',people:[{id:'p',fullName:'Человек',storyIds:['s'],mediaIds:['m']}],stories:[{id:'s',title:'Письмо',text:'Не забудьте: это воспоминание, а не доказанный факт.',date:'2001–2003',author:'Свидетель',personIds:['p'],mediaIds:['m']}],media:[{id:'m',title:'Источник',type:'document',path:'media/letter.txt',personIds:['p'],storyIds:['s']}]});
test('categories survive parsing, model saves and JSON roundtrip with story content and links unchanged',()=>{
  for(const category of categoryIds){
    const archive=core.ensureArchiveShape(base());
    const before=archive.stories[0];
    const changed=model.save(archive,'stories',{...before,category});
    assert.deepEqual(changed.stories[0],{...before,category});
    assert.deepEqual(changed.people,archive.people);
    assert.deepEqual(changed.media,archive.media);
    assert.deepEqual(core.parseArchiveJson(JSON.stringify(changed)),changed);
    const person=model.save(changed,'people',model.editable(changed,'people','p'));
    assert.equal(person.stories[0].category,category);
    assert.deepEqual(archive.stories[0],before);
  }
});
test('legacy stories remain uncategorized with exact base JSON preserved and empty category can clear assignment',()=>{
  const old=core.ensureArchiveShape(base());
  assert.equal(Object.hasOwn(old.stories[0],'category'),false);
  assert.equal(JSON.stringify(core.ensureArchiveShape(old)),JSON.stringify(old));
  assert.equal(model.empty('stories').category,'');
  const categorized=model.save(old,'stories',{...old.stories[0],category:'letters'});
  const cleared=model.save(categorized,'stories',{...categorized.stories[0],category:''});
  assert.equal(cleared.stories[0].category,'');
  assert.equal(JSON.stringify(old),JSON.stringify(core.ensureArchiveShape(base())));
});
test('invalid category values are rejected rather than silently stripped',()=>{
  for(const category of ['unknown','<script>',42,[],{},true]){
    const archive=base();archive.stories[0].category=category;
    assert.throws(()=>core.ensureArchiveShape(archive),/Категори/);
  }
});
test('category label and filter distinguish all, empty and chosen category without changing stories',()=>{
  const stories=[{title:'A',category:'letters'},{title:'B'},{title:'C',category:''},{title:'D',category:'place-home'}];
  assert.equal(core.storyCategoryLabel('place-home'),'Место и дом');
  assert.equal(core.storyCategoryLabel(''),'Без категории');
  assert.deepEqual(core.filterStoriesByCategory(stories,'all'),stories);
  assert.deepEqual(core.filterStoriesByCategory(stories,''),[stories[1],stories[2]]);
  assert.deepEqual(core.filterStoriesByCategory(stories,'letters'),[stories[0]]);
});
