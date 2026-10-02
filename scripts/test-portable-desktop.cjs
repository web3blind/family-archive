'use strict';
// Real packaged application + real preload/IPC/Chromium profile; synthetic HOME only.
// Run: xvfb-run -a node scripts/test-portable-desktop.cjs --old=/path/to/old/linux-unpacked
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {ArchiveStore}=require('../desktop/store.cjs');
const root=path.resolve(__dirname,'..'),scratch=process.env.TMPDIR||os.tmpdir();
const temporary=fs.mkdtempSync(path.join(scratch,'family-packaged-portable-'));
const old=process.argv.find(a=>a.startsWith('--old='))?.slice(6);
const current=process.argv.find(a=>a.startsWith('--current='))?.slice(10)||path.join(root,'dist-desktop/linux-unpacked');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const active=new Set();
function manifest(dir){const m={};function walk(d,rel){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name),r=rel+e.name;if(e.isDirectory())walk(f,r+'/');else if(e.isFile())m[r]=crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');else throw new Error('Unexpected nonregular fixture: '+f);}}walk(dir,'');return m;}
async function launch(folder,home,extra={}){
 fs.mkdirSync(home,{recursive:true});
 const child=spawn(path.join(folder,'family-archive'),['--no-sandbox','--disable-dev-shm-usage','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0'],{env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config'),XDG_CACHE_HOME:path.join(home,'cache'),XDG_DATA_HOME:path.join(home,'share'),FAMILY_ARCHIVE_DATA_DIR:'',FAMILY_ARCHIVE_SMOKE:'',FAMILY_ARCHIVE_PORTABLE_QA:'1',...extra},stdio:['ignore','pipe','pipe']});
 active.add(child);let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);const exit=new Promise(r=>child.once('exit',(code,signal)=>{active.delete(child);r({code,signal});}));
 let wsUrl;
 for(let i=0;i<1200;i++){wsUrl=logs.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];if(wsUrl)break;if(child.exitCode!==null)throw new Error('Startup failed: '+logs);await delay(50);}
 if(!wsUrl)throw new Error('DevTools startup timed out: '+logs);
 const http='http://'+new URL(wsUrl).host;
 let target;
 for(let i=0;i<1200;i++){const targets=await(await fetch(http+'/json/list')).json();target=targets.find(t=>t.type==='page'&&t.url.startsWith('family://'));if(target)break;if(child.exitCode!==null)throw new Error('Startup failed: '+logs);await delay(50);}
 if(!target)throw new Error('No application page: '+logs);
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(new Error(JSON.stringify(m.error)));else p?.resolve(m.result);}});
 const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},30000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});ws.send(JSON.stringify({id,method,params}));});
 ws.addEventListener('close',()=>{for(const p of pending.values())p.reject(new Error('Application CDP closed'));pending.clear();});
 async function run(expression){const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||JSON.stringify(r.exceptionDetails));return r.result.value;}
 async function wait(condition){for(let i=0;i<1200;i++){if(await run(condition))return;await delay(50);}throw new Error('UI timeout: '+await run('document.body.innerText'));}
 async function edit(){await command('Page.navigate',{url:'family://app/edit.html'});await wait(`document.getElementById('editorStatus')?.textContent.includes('Редактор готов')`);}
 async function close(){void run('window.close()').catch(()=>{});let timer;try{const result=await Promise.race([exit,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Quit timeout: '+logs)),30000);})]);assert.equal(result.code,0,logs);}finally{clearTimeout(timer);ws.close();}}
 await wait(`typeof window.FamilyArchiveNative==='object' && document.readyState==='complete'`);
 return {child,run,wait,edit,close,logs:()=>logs};
}
const archive={version:1,title:'Synthetic portable family',rootPersonId:null,people:[],stories:[],media:[]};
async function seed(app){
 await app.run(`FamilyArchiveNative.writeArchive(${JSON.stringify(archive)})`);
 await app.edit();await app.run(`document.querySelector('#newPersonButton').click();fullName.value='Portable draft person';fullName.dispatchEvent(new Event('input',{bubbles:true}));bio.value='Unsaved portable biography';bio.dispatchEvent(new Event('input',{bubbles:true}));`);
 await app.wait(`JSON.parse(localStorage.getItem('familyArchive.editorDrafts.v1')).sessions.some(s=>Object.keys(s.drafts.people).length)`);
 return app.run('FamilyArchiveNative.archiveIdentity()');
}
async function checkDraft(app,id){await app.edit();assert.equal(await app.run('FamilyArchiveNative.archiveIdentity()'),id);assert.equal(await app.run('fullName.value'),'Portable draft person');assert.equal(await app.run('bio.value'),'Unsaved portable biography');assert.equal((await app.run('FamilyArchiveNative.readArchive()')).people.length,0);}
async function main(){
 const first=path.join(temporary,'first');fs.cpSync(current,first,{recursive:true});const home=path.join(temporary,'home-first');
 let app=await launch(first,home);const data=path.join(first,'data');
 for(const f of ['archive/archive.json','archive/media','imports','session','selected-archive.json','archive/.family-archive-identity','archive/.family-portable-identity'])assert.ok(fs.existsSync(path.join(data,f)),f);
 const initial=await app.run('FamilyArchiveNative.readArchive()');assert.ok(initial,'First launch must create durable empty archive.json');assert.equal(initial.people.length,0);
 const id=await seed(app);await app.close();
 app=await launch(first,home);await checkDraft(app,id);await app.close();
 const moved=path.join(temporary,'moved-application');fs.renameSync(first,moved);
 app=await launch(moved,path.join(temporary,'different-home'));await checkDraft(app,id);await app.close();
 assert.ok(fs.existsSync(path.join(moved,'data/session/Local Storage')));assert.ok(!path.isAbsolute(JSON.parse(fs.readFileSync(path.join(moved,'data/selected-archive.json'))).root));
 console.log('PASS packaged first run, eager layout, restart, executable-folder relocation, new HOME, unsaved real Chromium drafts');
 // Real never-saved legacy editor: no seed() and no writeArchive(). The old
 // desktop denies bundled archive.json, so capture the actual core fallback/base.
 assert.ok(old,'--old is required to verify migration with the previous packaged executable');
 const draftHome=path.join(temporary,'home-never-saved');app=await launch(old,draftHome);
 assert.equal(await app.run('FamilyArchiveNative.readArchive()'),null);
 assert.equal(await app.run(`fetch('archive.json').then(r=>r.status)`),404);
 const fallback=await app.run('FamilyArchive.loadArchive()');
 await app.edit();await app.run(`document.querySelector('#newPersonButton').click();fullName.value='Never saved draft';fullName.dispatchEvent(new Event('input',{bubbles:true}));bio.value='Never saved biography — exact recovery';bio.dispatchEvent(new Event('input',{bubbles:true}));`);
 await app.wait(`JSON.parse(localStorage.getItem('familyArchive.editorDrafts.v1')).sessions.some(s=>Object.keys(s.drafts.people).length)`);
 const draftId=await app.run('FamilyArchiveNative.archiveIdentity()');
 assert.equal(await app.run('FamilyArchiveNative.readArchive()'),null);await app.close();
 const draftConfig=path.join(draftHome,'config');const draftProfiles=fs.readdirSync(draftConfig).filter(n=>fs.existsSync(path.join(draftConfig,n,'archive/.family-archive-identity')));assert.equal(draftProfiles.length,1);
 const draftLegacy=path.join(draftConfig,draftProfiles[0]),draftBefore=manifest(draftLegacy);
 assert.ok(!fs.existsSync(path.join(draftLegacy,'archive/archive.json')));
 const draftMigration=path.join(temporary,'never-saved-migration');fs.cpSync(current,draftMigration,{recursive:true});
 for(let attempt=0;attempt<2;attempt++){
  app=await launch(draftMigration,draftHome);await app.edit();
  assert.equal(await app.run('FamilyArchiveNative.archiveIdentity()'),draftId);
  assert.equal(await app.run('fullName.value'),'Never saved draft');
  assert.equal(await app.run('bio.value'),'Never saved biography — exact recovery');
  assert.deepEqual(await app.run('FamilyArchiveNative.readArchive()'),fallback);
  await app.close();assert.deepEqual(manifest(draftLegacy),draftBefore);
 }
 assert.deepEqual(manifest(path.join(draftMigration,'data/legacy-backup/profile')),draftBefore);
 assert.deepEqual(manifest(path.join(draftMigration,'data/legacy-backup/selected-archive')),manifest(path.join(draftLegacy,'archive')));
 console.log('PASS actual old packaged never-saved Chromium draft (no archive writes), exact fallback base and identity, new first launch and restart, untouched source/backup');
 // Real legacy binary creates its real default userData/session profile and identity.
 assert.ok(old,'--old is required to verify migration with the previous packaged executable');
 const legacyHome=path.join(temporary,'home-legacy');app=await launch(old,legacyHome);const oldId=await seed(app);await app.close();
 const config=path.join(legacyHome,'config');const candidates=fs.readdirSync(config).filter(n=>fs.existsSync(path.join(config,n,'archive')));assert.equal(candidates.length,1);const legacy=path.join(config,candidates[0]);
 const external=path.join(temporary,'external-selected');fs.renameSync(path.join(legacy,'archive'),external);
 // Native old identity includes real absolute root. Persist selected external archive and re-seed
 // drafts with the actual old bridge so migration does not rely on fabricated browser storage.
 fs.writeFileSync(path.join(legacy,'selected-archive.json'),JSON.stringify({root:external}));
 app=await launch(old,legacyHome);const externalId=await seed(app);await app.close();assert.notEqual(externalId,oldId);
 fs.mkdirSync(path.join(external,'media'),{recursive:true});const bytes=Buffer.from('Synthetic media bytes\0\xff','utf8');fs.writeFileSync(path.join(external,'media','loose.txt'),bytes);
 const fixtureStore=new ArchiveStore(external);const saved=await fixtureStore.readArchive();saved.media=[{id:'m',type:'document',title:'Synthetic document',path:'media/loose.txt',personIds:[],storyIds:[]}];
 // Keep the draft base unchanged while testing missing media and metadata separately.
 fs.writeFileSync(path.join(external,'media','orphan.txt'),'Unreferenced preserved media');
 const before=manifest(legacy),externalBefore=manifest(external);
 const migration=path.join(temporary,'migration-app');fs.cpSync(current,migration,{recursive:true});app=await launch(migration,legacyHome);await checkDraft(app,externalId);await app.close();
 assert.deepEqual(manifest(legacy),before);assert.deepEqual(manifest(external),externalBefore);assert.deepEqual(manifest(path.join(migration,'data/legacy-backup/profile')),before);assert.deepEqual(manifest(path.join(migration,'data/legacy-backup/selected-archive')),externalBefore);
 const selected=JSON.parse(fs.readFileSync(path.join(migration,'data/selected-archive.json'))).root;
 assert.deepEqual(fs.readFileSync(path.join(migration,'data',selected,'media/loose.txt')),bytes);
 const migratedStore=new ArchiveStore(path.join(migration,'data',selected),{portable:true});await migratedStore.writeArchive(saved);await migratedStore.exportZip(path.join(temporary,'roundtrip.zip'));const imported=await ArchiveStore.importZip(path.join(temporary,'roundtrip.zip'),path.join(temporary,'zip-import'));
 assert.deepEqual(fs.readFileSync(path.join(imported.root,'media/loose.txt')),bytes);assert.equal(fs.readFileSync(path.join(imported.root,'media/orphan.txt'),'utf8'),'Unreferenced preserved media');assert.deepEqual(await imported.readArchive(),await migratedStore.readArchive());
 // Restore unchanged canonical base, keeping legitimate existing drafts recoverable.
 await migratedStore.writeArchive(archive);
 app=await launch(migration,legacyHome);await checkDraft(app,externalId);await app.close();const relocated=path.join(temporary,'relocated-migration');fs.renameSync(migration,relocated);
 app=await launch(relocated,path.join(temporary,'third-home'));await checkDraft(app,externalId);await app.close();assert.deepEqual(manifest(legacy),before);assert.deepEqual(manifest(external),externalBefore);
 console.log('PASS real legacy packaged migration, exact complete profile/archive backup SHA-256, external selection copied, original untouched, drafts, loose media, ZIP byte/metadata roundtrip, restart and relocation');
 // Foreign archive copied from the same source gets a new generation: never replay A's drafts.
 const {copyArchive,select}=require('../desktop/portable.cjs');const foreign=copyArchive(external,path.join(relocated,'data/imports'));select(path.join(relocated,'data'),foreign.root);app=await launch(relocated,path.join(temporary,'third-home'));await app.edit();assert.notEqual(await app.run('FamilyArchiveNative.archiveIdentity()'),externalId);assert.equal(await app.run(`!!document.getElementById('fullName')`),false);await app.close();
 console.log('PASS copied foreign archive cannot replay original drafts');
 // Launch failure is observable and never creates a fallback host profile.
 const denied=path.join(temporary,'denied-app');fs.cpSync(current,denied,{recursive:true});fs.chmodSync(denied,0o500);
 const failure=spawn(path.join(denied,'family-archive'),['--no-sandbox'],{env:{...process.env,HOME:path.join(temporary,'denied-home'),XDG_CONFIG_HOME:path.join(temporary,'denied-home/config'),FAMILY_ARCHIVE_DATA_DIR:'',FAMILY_ARCHIVE_SMOKE:'',FAMILY_ARCHIVE_PORTABLE_QA:'1'},stdio:['ignore','pipe','pipe']});active.add(failure);let error='';failure.stdout.on('data',d=>error+=d);failure.stderr.on('data',d=>error+=d);const status=await new Promise(r=>failure.once('exit',c=>{active.delete(failure);r(c);}));fs.chmodSync(denied,0o700);assert.equal(status,1,error);assert.match(error,/EACCES|permission denied/i);assert.ok(!fs.existsSync(path.join(denied,'data')));assert.ok(!fs.existsSync(path.join(temporary,'denied-home/config/family-archive/archive')));
 console.log('PASS unwritable executable directory fails visibly, no hidden fallback');
 console.log('Portable packaged QA fixtures: '+temporary);
}
main().catch(error=>{console.error(error.stack);console.error('Fixtures retained: '+temporary);process.exitCode=1;}).finally(()=>{for(const child of active)child.kill('SIGTERM');});
