const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ArchiveStore, validateMediaPath, atomicWrite, copyBounded } = require('../desktop/store.cjs');
const empty = () => ({ version: 1, title: 'Тест', rootPersonId: null, people: [], stories: [], media: [] });
async function fixture(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'family-store-')); t.after(() => fs.rm(root,{recursive:true,force:true})); return root; }
test('legacy missing or null optional collections normalize and ZIP remains portable',async t=>{
 const root=await fixture(t),s=new ArchiveStore(path.join(root,'archive'));
 await s.writeArchive({version:1,title:'Тест',people:[],stories:null});
 assert.deepEqual(await s.readArchive(),empty());
 await s.exportZip(path.join(root,'legacy.zip'));
 const restored=await ArchiveStore.importZip(path.join(root,'legacy.zip'),path.join(root,'imports'));
 assert.deepEqual(await restored.readArchive(),empty());
});
test('durable JSON read/write and previous version backup', async t => {
 const root=await fixture(t); const s=new ArchiveStore(root); assert.equal(await s.readArchive(),null);
 await s.writeArchive(empty()); const next={...empty(),title:'После перезапуска'}; await s.writeArchive(next);
 assert.deepEqual(await new ArchiveStore(root).readArchive(),next);
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'archive.json.bak'),'utf8')).title,'Тест');
});
test('media copied with collision-free names, ZIP export/import preserves bytes',async t=>{
 const root=await fixture(t), src=path.join(root,'photo.jpg'); await fs.writeFile(src,Buffer.from([1,2,3,4]));
 const s=new ArchiveStore(path.join(root,'archive')); await s.writeArchive(empty());
 const a=await s.addMedia(src), b=await s.addMedia(src); assert.notEqual(a.path,b.path);
 const data=empty(); data.media=[{id:'media-a',type:a.type,title:a.title,path:a.path,personIds:[],storyIds:[]}];
 await s.writeArchive(data); const zip=path.join(root,'backup.zip'); await s.exportZip(zip);
 const target=await ArchiveStore.importZip(zip,path.join(root,'imports')); assert.deepEqual(await target.readArchive(),data);
 assert.deepEqual(await fs.readFile(await target.resolveMedia(a.path)),Buffer.from([1,2,3,4]));
 assert.deepEqual(await fs.readFile(await target.resolveMedia(b.path)),Buffer.from([1,2,3,4]));
});
test('reject traversal, unsupported media, symlinks and invalid archive, preserve saved data',async t=>{
 for(const value of ['../secret','media/../../secret','media\\evil.jpg','media/a.html','https://x/a.jpg','media/%2e%2e']) assert.throws(()=>validateMediaPath(value));
 const root=await fixture(t),s=new ArchiveStore(path.join(root,'archive')); await s.writeArchive(empty());
 await fs.mkdir(path.join(root,'archive','media')); await fs.writeFile(path.join(root,'outside.jpg'),'private');
 await fs.symlink(path.join(root,'outside.jpg'),path.join(root,'archive','media','link.jpg'));
 await assert.rejects(s.resolveMedia('media/link.jpg'));
 await assert.rejects(s.writeArchive({people:'not-array'})); assert.equal((await s.readArchive()).title,'Тест');
});
test('picked long and hidden names become portable without losing their extension',async t=>{
 const root=await fixture(t), s=new ArchiveStore(path.join(root,'archive'));
 for(const name of ['a'.repeat(180)+'.jpg','.hidden.jpg']) {
  const source=path.join(root,name);await fs.writeFile(source,'photo');const picked=await s.addMedia(source);
  assert.equal(validateMediaPath(picked.path),picked.path);assert.ok(path.basename(picked.path).length<=160);assert.ok(picked.path.endsWith('.jpg'));
 }
});
test('failed atomic write does not replace target',async t=>{
 const root=await fixture(t),dest=path.join(root,'archive.json'); await atomicWrite(dest,'old');
 await assert.rejects(atomicWrite(path.join(root,'missing','archive.json'),'new'));
 assert.equal(await fs.readFile(dest,'utf8'),'old');
});
test('legacy nested Unicode media photo and audio roundtrip across folder, ZIP and JSON',async t=>{
 const root=await fixture(t), archiveRoot=path.join(root,'archive'), s=new ArchiveStore(archiveRoot);
 await fs.mkdir(path.join(archiveRoot,'media','альбом'),{recursive:true});
 const photo='media/альбом/Фото (1).jpg',audio='media/Интервью.ogg';
 await fs.writeFile(path.join(archiveRoot,photo),'photo bytes');await fs.writeFile(path.join(archiveRoot,audio),'audio bytes');
 const a=empty();a.media=[{id:'p',type:'photo',title:'Фото',path:photo,personIds:[],storyIds:[]},{id:'a',type:'audio',title:'Звук',path:audio,personIds:[],storyIds:[]}];
 await s.writeArchive(a);await s.exportZip(path.join(root,'full.zip'));
 const zipped=await ArchiveStore.importZip(path.join(root,'full.zip'),path.join(root,'imports'));
 const json=await ArchiveStore.importJson(path.join(archiveRoot,'archive.json'),path.join(root,'imports'));
 for(const copy of [zipped,json]) {assert.deepEqual(await copy.readArchive(),a);assert.equal(await fs.readFile(await copy.resolveMedia(photo),'utf8'),'photo bytes');assert.equal(await fs.readFile(await copy.resolveMedia(audio),'utf8'),'audio bytes');}
});
test('missing media blocks save and export preserves existing destination on validation error',async t=>{
 const root=await fixture(t),s=new ArchiveStore(path.join(root,'archive'));await s.writeArchive(empty());
 const bad=empty();bad.media=[{id:'m',type:'photo',title:'missing',path:'media/missing.jpg',personIds:[],storyIds:[]}];
 await assert.rejects(s.writeArchive(bad));assert.deepEqual(await s.readArchive(),empty());
 await assert.rejects(s.exportZip(path.join(root,'archive','archive.json')));assert.deepEqual(await s.readArchive(),empty());
});
test('bounded streaming rejects byte and cumulative budgets without overwriting an existing target',async t=>{
 const root=await fixture(t),source=path.join(root,'large.txt'),target=path.join(root,'copy.txt');await fs.writeFile(source,'1234567890');
 await assert.rejects(copyBounded(source,target,5));await assert.rejects(fs.stat(target));
 await assert.rejects(copyBounded(source,target,20,()=>{throw new Error('total budget exceeded');}));
 await fs.rm(target,{force:true});await fs.writeFile(target,'keep');await assert.rejects(copyBounded(source,target,20));
 assert.equal(await fs.readFile(target,'utf8'),'keep');
});
