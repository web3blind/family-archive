'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {ArchiveStore}=require('../desktop/store.cjs');
const core=require('../assets/js/archive-core.js');
(async()=>{
 const [action,dir]=process.argv.slice(2);if(!dir)throw new Error('An isolated test directory is required');
 const source=path.join(dir,'desktop-source'), zip=path.join(dir,'desktop.zip');
 if(action==='create') {
  await fs.mkdir(path.join(source,'media','Альбом'),{recursive:true});
  for(const [name,bytes] of [['Альбом/Фото (1954).jpg','photo bytes'],['Голос.ogg','audio bytes'],['Письмо.pdf','document bytes'],['Альбом/Без записи.txt','retained orphan bytes']]) await fs.writeFile(path.join(source,'media',name),bytes);
  const archive=core.ensureArchiveShape({version:1,title:'Межплатформенный архив',rootPersonId:'p1',people:[{id:'p1',fullName:'Тестовый родственник',motherId:'p2',primaryMediaId:'m1',storyIds:['s1'],mediaIds:['m1','m2','m3']},{id:'p2',fullName:'Тестовая мать'}],stories:[{id:'s1',title:'Семейная история',text:'Текст воспоминания',personIds:['p1'],mediaIds:['m2']}],media:[{id:'m1',type:'photo',path:'media/Альбом/Фото (1954).jpg',personIds:['p1']},{id:'m2',type:'audio',path:'media/Голос.ogg',personIds:['p1'],storyIds:['s1']},{id:'m3',type:'document',path:'media/Письмо.pdf',personIds:['p1']}]});
  const store=new ArchiveStore(source);await store.writeArchive(archive);await store.exportZip(zip);console.log('Desktop portable fixture exported: '+zip);
 } else if(action==='verify') {
  const original=new ArchiveStore(source),returned=await ArchiveStore.importZip(path.join(dir,'android.zip'),path.join(dir,'desktop-return'));
  assert.deepEqual(await returned.readArchive(),await original.readArchive());
  const files=await original.listMedia();for(const name of files)assert.deepEqual(await fs.readFile(await returned.resolveMedia(name)),await fs.readFile(await original.resolveMedia(name)),name);
  assert.deepEqual((await returned.listMedia()).sort(),files.sort());console.log('Desktop -> Android storage -> Desktop: JSON, 2 people, story and all '+files.length+' media files identical.');
 } else throw new Error('Expected create or verify');
})().catch(error=>{console.error(error);process.exitCode=1;});
