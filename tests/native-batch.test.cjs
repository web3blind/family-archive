const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {ArchiveStore}=require('../desktop/store.cjs');
const emptyArchive=()=>({version:1,title:'Identity',rootPersonId:null,people:[],stories:[],media:[]});
test('desktop preload exposes async identity over the trusted IPC method',async()=>{
 let exposed;const calls=[];
 const electron={contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'FamilyArchiveNative');exposed=value;}},ipcRenderer:{invoke:async(channel)=>{calls.push(channel);return 'opaque-generation';}}};
 const vm=require('node:vm');vm.runInNewContext(await fs.readFile(path.join(__dirname,'../desktop/preload.cjs'),'utf8'),{require:name=>{assert.equal(name,'electron');return electron;}});
 const identity=exposed.archiveIdentity();assert.equal(typeof identity.then,'function');assert.equal(await identity,'opaque-generation');assert.deepEqual(calls,['family:archive-identity']);
});
test('archive identity persists through writes/restart and distinguishes copied folders and import generations',async t=>{
 const dir=await fixture(t),root=path.join(dir,'archive'),store=new ArchiveStore(root);
 const ids=await Promise.all(Array.from({length:8},()=>new ArchiveStore(root).archiveIdentity()));
 assert.equal(new Set(ids).size,1);const identity=ids[0];assert.match(identity,/^[a-f0-9]{64}$/);
 await store.writeArchive(emptyArchive());assert.equal(await store.archiveIdentity(),identity);
 assert.equal(await new ArchiveStore(root).archiveIdentity(),identity);
 const copy=path.join(dir,'copy');await fs.cp(root,copy,{recursive:true});assert.notEqual(await new ArchiveStore(copy).archiveIdentity(),identity);
 await fs.symlink(root,path.join(dir,'alias'));await assert.rejects(new ArchiveStore(path.join(dir,'alias')).archiveIdentity());
 const destination=path.join(dir,'export.zip');await store.exportZip(destination);
 const a=await ArchiveStore.importZip(destination,path.join(dir,'imports')),b=await ArchiveStore.importZip(destination,path.join(dir,'imports'));
 assert.notEqual(await a.archiveIdentity(),identity);assert.notEqual(await a.archiveIdentity(),await b.archiveIdentity());
 const json=await ArchiveStore.importJson(path.join(root,'archive.json'),path.join(dir,'imports'));assert.notEqual(await json.archiveIdentity(),identity);
 const zip=require('yauzl');const names=await new Promise((resolve,reject)=>zip.open(destination,{lazyEntries:true},(e,z)=>{if(e)return reject(e);const out=[];z.on('entry',entry=>{out.push(entry.fileName);z.readEntry();});z.on('error',reject);z.on('end',()=>resolve(out));z.readEntry();}));
 assert.deepEqual(names,['archive.json']);
 await fs.writeFile(path.join(dir,'bad.zip'),'not a zip');await assert.rejects(ArchiveStore.importZip(path.join(dir,'bad.zip'),path.join(dir,'imports')));
 assert.equal(await store.archiveIdentity(),identity);
 assert.deepEqual(await store.addMediaBatch([]),{media:[],errors:[]});assert.equal(await store.archiveIdentity(),identity);
});
test('identity markers fail closed on corruption, symlinks and publication failures',async t=>{
 const dir=await fixture(t),store=new ArchiveStore(path.join(dir,'archive'));await fs.mkdir(store.root);
 const marker=path.join(store.root,'.family-archive-identity');await fs.writeFile(marker,'broken');await assert.rejects(store.archiveIdentity(),/identity/);
 await fs.unlink(marker);const external=path.join(dir,'external');await fs.writeFile(external,'12345678-1234-4123-8123-123456789abc');await fs.symlink(external,marker);await assert.rejects(store.archiveIdentity());
 await fs.unlink(marker);t.mock.method(fs,'link',async()=>{throw Object.assign(new Error('denied'),{code:'EACCES'});});await assert.rejects(store.archiveIdentity(),/denied/);assert.deepEqual(await fs.readdir(store.root),[]);
});
test('identity publication supports a filesystem without hardlinks',async t=>{
 const dir=await fixture(t),store=new ArchiveStore(path.join(dir,'archive'));
 t.mock.method(fs,'link',async()=>{throw Object.assign(new Error('unsupported'),{code:'ENOTSUP'});});
 const identity=await store.archiveIdentity();assert.equal(await new ArchiveStore(store.root).archiveIdentity(),identity);
});

async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'family-batch-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('batch partial success reports unsupported/missing/link names and preserves source bytes',async t=>{
 const dir=await fixture(t),source=path.join(dir,'picked');await fs.mkdir(path.join(source,'nested'),{recursive:true});
 await fs.writeFile(path.join(source,'nested','photo.jpg'),'photo');await fs.writeFile(path.join(source,'letter.pdf'),'letter');await fs.writeFile(path.join(source,'payload.exe'),'no');
 await fs.symlink(path.join(source,'nested'),path.join(source,'linked'));
 const store=new ArchiveStore(path.join(dir,'archive'));
 const result=await store.addMediaBatch([source],{folder:true});
 assert.equal(result.media.length,2);assert.equal(result.errors.length,2);
 assert.deepEqual(new Set(result.errors.map(e=>e.name)),new Set(['payload.exe','linked']));
 for(const item of result.media){assert.ok(['photo','document'].includes(item.type));assert.equal(await fs.realpath(await store.resolveMedia(item.path)),await store.resolveMedia(item.path));}
 assert.equal(await fs.readFile(path.join(source,'letter.pdf'),'utf8'),'letter');
 const missing=await store.addMediaBatch([path.join(dir,'missing.mp3')]);assert.equal(missing.errors[0].name,'missing.mp3');
});
test('batch file/total/count storage budgets preserve prior files and clean incomplete copies',async t=>{
 const dir=await fixture(t),store=new ArchiveStore(path.join(dir,'archive'));
 const files=[];for(const [name,bytes]of [['a.txt','1234'],['b.txt','5678'],['big.txt','123456789']]){const f=path.join(dir,name);await fs.writeFile(f,bytes);files.push(f);}
 const limits={file:5,total:7,count:3};
 let result=await store.addMediaBatch(files,{},limits);assert.equal(result.media.length,1);assert.equal(result.errors.length,2);
 assert.equal(await fs.readFile(await store.resolveMedia(result.media[0].path),'utf8'),'1234');
 result=await store.addMediaBatch([files[1]],{},limits);assert.equal(result.media.length,0);assert.equal(result.errors.length,1);
 result=await store.addMediaBatch([files[0]],{},{file:5,total:30,count:1});assert.equal(result.media.length,0);
 assert.equal((await fs.readdir(path.join(store.root,'media'))).length,1);
});
test('batch cannot traverse symlink ancestors and cancel/empty selection never creates storage',async t=>{
 const dir=await fixture(t);await fs.mkdir(path.join(dir,'source'));await fs.writeFile(path.join(dir,'source','x.jpg'),'x');await fs.symlink(path.join(dir,'source'),path.join(dir,'alias'));
 const store=new ArchiveStore(path.join(dir,'archive'));assert.deepEqual(await store.addMediaBatch([]),{media:[],errors:[]});await assert.rejects(fs.stat(store.root));
 const result=await store.addMediaBatch([path.join(dir,'alias','x.jpg')]);assert.equal(result.media.length,0);assert.equal(result.errors.length,1);
});
test('exclusive copy fallback supports filesystems without links and never replaces collisions',async t=>{
 const dir=await fixture(t),store=new ArchiveStore(path.join(dir,'archive')),source=path.join(dir,'photo.jpg');await fs.writeFile(source,'new');
 t.mock.method(fs,'link',async()=>{throw Object.assign(new Error('Links unavailable'),{code:'ENOTSUP'});});
 t.mock.method(require('node:crypto'),'randomUUID',()=> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
 const first=await store.addMediaBatch([source]);assert.equal(first.media.length,1);assert.equal(first.errors.length,0);
 const dest=await store.resolveMedia(first.media[0].path);await fs.writeFile(source,'changed');
 const second=await store.addMediaBatch([source]);assert.equal(second.media.length,0);assert.equal(second.errors.length,1);
 assert.equal(await fs.readFile(dest,'utf8'),'new');assert.equal((await fs.readdir(path.join(store.root,'media'))).length,1);
});
test('folder recursion excludes current destination and reports the depth budget',async t=>{
 const dir=await fixture(t),source=path.join(dir,'source');await fs.mkdir(source);
 let deep=source;for(let i=0;i<34;i++){deep=path.join(deep,'nested');await fs.mkdir(deep);}
 await fs.writeFile(path.join(deep,'x.jpg'),'not reached');
 const store=new ArchiveStore(path.join(source,'archive'));
 const result=await store.addMediaBatch([source],{folder:true});
 assert.equal(result.media.length,0);assert.equal(result.errors.length,2);
 assert.ok(result.errors.some(e=>/вложенность/.test(e.message)));assert.ok(result.errors.some(e=>e.name==='archive'));
});
