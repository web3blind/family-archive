'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {portableDataPath,preparePortable,selectedRoot,copyArchive}=require('../desktop/portable.cjs');
const {ArchiveStore}=require('../desktop/store.cjs');
const empty={version:1,title:'Synthetic',rootPersonId:null,people:[],stories:[],media:[]};
function fixture(t){const p=fs.mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'portable-test-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;}
test('portable platform destinations',()=>{
 assert.equal(portableDataPath({packaged:true,platform:'win32',executable:'C:\\Family\\Family.exe'}),'C:\\Family\\data');
 assert.equal(portableDataPath({packaged:true,platform:'darwin',executable:'/Applications/Family.app/Contents/MacOS/Family'}),'/Applications/data');
 assert.equal(portableDataPath({packaged:true,platform:'linux',executable:'/opt/family/family'}),'/opt/family/data');
 assert.equal(portableDataPath({packaged:false,codeRoot:'/project'}),'/project/data');
});
test('first run eagerly creates files and survives relocation',async t=>{const p=fixture(t),data=path.join(p,'data');preparePortable({data});const s=new ArchiveStore(selectedRoot(data),{portable:true}),id=await s.archiveIdentity();assert.equal((await s.readArchive()).people.length,0);for(const f of ['archive/media','imports','session','selected-archive.json','archive/.family-archive-identity','archive/.family-portable-identity'])assert.ok(fs.existsSync(path.join(data,f)),f);fs.renameSync(data,path.join(p,'moved'));const next=new ArchiveStore(selectedRoot(path.join(p,'moved')),{portable:true});assert.equal(await next.archiveIdentity(),id);});
test('migration preserves full profile, selected external archive and old identity',async t=>{const p=fixture(t),legacy=path.join(p,'legacy'),external=path.join(p,'external'),data=path.join(p,'data');fs.mkdirSync(legacy);fs.writeFileSync(path.join(legacy,'draft-profile'),'draft bytes');const s=new ArchiveStore(external);await s.writeArchive(empty);const id=await s.archiveIdentity();fs.mkdirSync(path.join(external,'media'));fs.writeFileSync(path.join(external,'media','unreferenced.txt'),'loose bytes');fs.writeFileSync(path.join(legacy,'selected-archive.json'),JSON.stringify({root:external}));preparePortable({data,legacy});assert.equal(await new ArchiveStore(selectedRoot(data),{portable:true}).archiveIdentity(),id);assert.equal(fs.readFileSync(path.join(data,'draft-profile'),'utf8'),'draft bytes');assert.equal(fs.readFileSync(path.join(data,'legacy-backup','profile','draft-profile'),'utf8'),'draft bytes');assert.equal(fs.readFileSync(path.join(data,'archive/media/unreferenced.txt'),'utf8'),'loose bytes');assert.equal(fs.readFileSync(path.join(legacy,'draft-profile'),'utf8'),'draft bytes');preparePortable({data,legacy});assert.equal(fs.readFileSync(path.join(data,'draft-profile'),'utf8'),'draft bytes');});
test('missing/malformed selected legacy archive never becomes empty',t=>{const p=fixture(t),legacy=path.join(p,'legacy'),data=path.join(p,'data');fs.mkdirSync(legacy);fs.writeFileSync(path.join(legacy,'selected-archive.json'),'{bad');assert.throws(()=>preparePortable({data,legacy}));assert.ok(!fs.existsSync(data));fs.writeFileSync(path.join(legacy,'selected-archive.json'),JSON.stringify({root:path.join(p,'missing')}));assert.throws(()=>preparePortable({data,legacy}));assert.ok(!fs.existsSync(data));});
test('missing referenced media and symlink reject without publishing',t=>{const p=fixture(t),legacy=path.join(p,'legacy'),data=path.join(p,'data');fs.mkdirSync(path.join(legacy,'archive'),{recursive:true});fs.writeFileSync(path.join(legacy,'archive/archive.json'),JSON.stringify({...empty,media:[{id:'m',type:'document',title:'M',path:'media/missing.txt',personIds:[],storyIds:[]}]}));assert.throws(()=>preparePortable({data,legacy}));assert.ok(!fs.existsSync(data));fs.writeFileSync(path.join(legacy,'archive/archive.json'),JSON.stringify(empty));fs.symlinkSync(p,path.join(legacy,'escape'));assert.throws(()=>preparePortable({data,legacy}),/ссылк|link/i);assert.ok(!fs.existsSync(data));});
test('existing portable data wins; invalid selection does not fallback',t=>{const p=fixture(t),data=path.join(p,'data');preparePortable({data});fs.writeFileSync(path.join(data,'selected-archive.json'),JSON.stringify({root:'../escape'}));assert.throws(()=>preparePortable({data}));});
test('externally copied archive preserves loose media but cannot replay source drafts',async t=>{const p=fixture(t),data=path.join(p,'data'),external=path.join(p,'external');preparePortable({data});const s=new ArchiveStore(external);await s.writeArchive(empty);const sourceId=await s.archiveIdentity();fs.mkdirSync(path.join(external,'media'));fs.writeFileSync(path.join(external,'media','loose.txt'),'bytes');const next=copyArchive(external,path.join(data,'imports'));assert.notEqual(await next.archiveIdentity(),sourceId);assert.equal(fs.readFileSync(path.join(next.root,'media/loose.txt'),'utf8'),'bytes');});
test('live bootstrap lock refuses and dead lock is recoverable',t=>{
 const p=fixture(t),data=path.join(p,'data'),lock=data+'.bootstrap-lock';
 fs.writeFileSync(lock,JSON.stringify({pid:process.pid}));assert.throws(()=>preparePortable({data}),/running/);
 fs.writeFileSync(lock,JSON.stringify({pid:2147483647}));preparePortable({data});assert.ok(fs.existsSync(data));
});
test('portable identity rejects replacement archive generation',async t=>{
 const p=fixture(t),data=path.join(p,'data');preparePortable({data});const root=selectedRoot(data);
 fs.writeFileSync(path.join(root,'.family-archive-identity'),require('node:crypto').randomUUID());
 await assert.rejects(new ArchiveStore(root,{portable:true}).archiveIdentity(),/generation/);
 assert.throws(()=>preparePortable({data}),/поколение/);
});
test('legacy default archive retains original identity and complete session',async t=>{
 const p=fixture(t),legacy=path.join(p,'legacy'),data=path.join(p,'data');
 const old=new ArchiveStore(path.join(legacy,'archive'));await old.writeArchive(empty);const id=await old.archiveIdentity();
 fs.mkdirSync(path.join(legacy,'Local Storage'));fs.writeFileSync(path.join(legacy,'Local Storage','draft'),'profile bytes');
 preparePortable({data,legacy});assert.equal(await new ArchiveStore(selectedRoot(data),{portable:true}).archiveIdentity(),id);
 assert.equal(fs.readFileSync(path.join(data,'session/Local Storage/draft'),'utf8'),'profile bytes');
 assert.equal(fs.readFileSync(path.join(data,'legacy-backup/profile/Local Storage/draft'),'utf8'),'profile bytes');
});
test('legacy never-saved default materializes exact fallback while retaining identity and source',async t=>{
 const p=fixture(t),legacy=path.join(p,'legacy'),data=path.join(p,'data'),root=path.join(legacy,'archive');
 const old=new ArchiveStore(root);assert.equal(await old.readArchive(),null);const id=await old.archiveIdentity();
 const marker=fs.readFileSync(path.join(root,'.family-archive-identity'));
 preparePortable({data,legacy});const migrated=new ArchiveStore(selectedRoot(data),{portable:true});
 assert.equal(await migrated.archiveIdentity(),id);
 assert.deepEqual(await migrated.readArchive(),{...empty,title:'Семейный архив'});
 assert.deepEqual(fs.readFileSync(path.join(selectedRoot(data),'.family-archive-identity')),marker);
 assert.ok(!fs.existsSync(path.join(root,'archive.json')));
 assert.ok(!fs.existsSync(path.join(data,'legacy-backup/profile/archive/archive.json')));
 preparePortable({data,legacy});assert.equal(await migrated.archiveIdentity(),id);
});
test('backup-only default legacy archive fails closed, valid or corrupt, identity or not',async t=>{
 const p=fixture(t),legacy=path.join(p,'legacy'),data=path.join(p,'data'),root=path.join(legacy,'archive');
 fs.mkdirSync(root,{recursive:true});
 for(const backup of [JSON.stringify({...empty,title:'Saved family backup'}),'{broken']){
  for(const marker of [false,true]){
   const identityFile=path.join(root,'.family-archive-identity');
   if(marker)await new ArchiveStore(root).archiveIdentity();else fs.rmSync(identityFile,{force:true});
   fs.writeFileSync(path.join(root,'archive.json.bak'),backup);
   assert.throws(()=>preparePortable({data,legacy}),/archive.json.bak/);
   assert.ok(!fs.existsSync(data));assert.ok(!fs.existsSync(path.join(root,'archive.json')));
   assert.equal(fs.readFileSync(path.join(root,'archive.json.bak'),'utf8'),backup);
   assert.equal(fs.existsSync(identityFile),marker);
  }
 }
});
test('existing data wins over malformed old profile',t=>{
 const p=fixture(t),data=path.join(p,'data'),legacy=path.join(p,'legacy');preparePortable({data});
 fs.mkdirSync(legacy);fs.writeFileSync(path.join(legacy,'selected-archive.json'),'invalid');
 preparePortable({data,legacy});assert.ok(!fs.existsSync(path.join(data,'legacy-backup')));
});
test('killed migration publishes nothing and restart safely resumes',async t=>{
 const p=fixture(t),legacy=path.join(p,'legacy'),data=path.join(p,'data');
 fs.mkdirSync(path.join(legacy,'archive'),{recursive:true});fs.writeFileSync(path.join(legacy,'archive/archive.json'),JSON.stringify(empty));
 const before=fs.readFileSync(path.join(legacy,'archive/archive.json'));
 const {spawn}=require('node:child_process');const {once}=require('node:events');
 const child=spawn(process.execPath,['-e',`const fs=require('node:fs');const copy=fs.copyFileSync;fs.copyFileSync=(...args)=>{copy(...args);process.send('copied');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};require(${JSON.stringify(require.resolve('../desktop/portable.cjs'))}).preparePortable(${JSON.stringify({data,legacy})});`],{stdio:['ignore','ignore','inherit','ipc']});
 t.after(()=>child.kill('SIGKILL'));await once(child,'message');child.kill('SIGKILL');await once(child,'exit');
 assert.ok(!fs.existsSync(data));assert.deepEqual(fs.readFileSync(path.join(legacy,'archive/archive.json')),before);
 preparePortable({data,legacy});assert.equal((await new ArchiveStore(selectedRoot(data),{portable:true}).readArchive()).title,'Synthetic');
});
test('copied archive in another portable slot fails closed',async t=>{
 const p=fixture(t),data=path.join(p,'data');preparePortable({data});const source=selectedRoot(data),duplicate=path.join(data,'imports/duplicate');
 fs.cpSync(source,duplicate,{recursive:true});await assert.rejects(new ArchiveStore(duplicate,{portable:true,dataRoot:data}).archiveIdentity(),/slot/);
});
test('migration rejects destination nested in selected source',async t=>{
 const p=fixture(t),source=path.join(p,'source'),legacy=path.join(p,'legacy');await new ArchiveStore(source).writeArchive(empty);
 fs.mkdirSync(legacy);fs.writeFileSync(path.join(legacy,'selected-archive.json'),JSON.stringify({root:source}));
 assert.throws(()=>preparePortable({data:path.join(source,'app/data'),legacy}),/пересека|overlap/);
});
test('previous imports retain their draft identities when reopened',async t=>{
 const p=fixture(t),legacy=path.join(p,'legacy'),data=path.join(p,'data');
 const old=new ArchiveStore(path.join(legacy,'archive'));await old.writeArchive(empty);await old.archiveIdentity();
 const imported=new ArchiveStore(path.join(legacy,'imports/previous'));await imported.writeArchive(empty);const id=await imported.archiveIdentity();
 preparePortable({data,legacy});assert.equal(await new ArchiveStore(path.join(data,'imports/previous'),{portable:true,dataRoot:data}).archiveIdentity(),id);
});
