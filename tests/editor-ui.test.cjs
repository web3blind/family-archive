/* Connected scenarios run the real frontend in an isolated Chromium profile.
 * Native adapter responses are controlled at the boundary; browser file inputs use real temporary files.
 * No package dependency, user archive, persistent browser profile or real data is used.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const chromium = process.env.CHROMIUM_BINARY || '/usr/bin/chromium';
const available = fsSync.existsSync(chromium);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function browser(t, native = false) {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'editor-ui-'));
  const media = path.join(dir, 'media'); await fs.mkdir(media);
  await fs.writeFile(path.join(media, 'Synthetic photo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#8f4d2e"/></svg>');
  await fs.writeFile(path.join(media, 'Synthetic note.txt'), 'Synthetic family test fixture.');
  await fs.writeFile(path.join(dir, 'unsupported.exe'), 'Synthetic unsupported fixture.');
  const server = http.createServer(async (req,res) => {
    try {
      const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(name.startsWith('/media/') ? dir : root, '.' + name);
      if(!file.startsWith(root + path.sep) && !file.startsWith(dir + path.sep)) {res.writeHead(403);res.end();return;}
      const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.txt':'text/plain'};
      const bytes=await fs.readFile(file);res.writeHead(200, {'Content-Type':mime[path.extname(file)] || 'application/octet-stream'});res.end(bytes);
    } catch(_) {res.writeHead(404);res.end();}
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const child = spawn(chromium, ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0',`--user-data-dir=${path.join(dir,'profile')}`,'about:blank'], {stdio:['ignore','ignore','pipe']});
  let stderr=''; child.stderr.on('data', data=>stderr+=data.toString());
  let socket;
  t.after(async () => {
    socket?.close();
    const stopped=child.exitCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve));
    child.kill('SIGTERM');server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    await Promise.race([stopped,delay(2000)]);
    if(child.exitCode===null)child.kill('SIGKILL');
    await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  });
  for(let i=0;i<150&&!stderr.includes('DevTools listening');i++)await delay(50);
  const match = stderr.match(/DevTools listening on ws:\/\/([^/]+)\//); assert.ok(match, stderr);
  const tabs = await (await fetch(`http://${match[1]}/json/list`)).json();
  socket = new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let id=0; const calls=new Map(), exceptions=[];
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.id) {const pending=calls.get(message.id);if(pending){calls.delete(message.id);message.error?pending.reject(new Error(JSON.stringify(message.error))):pending.resolve(message.result);}}
    else if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails);
    else if(message.method==='Page.javascriptDialogOpening')void send('Page.handleJavaScriptDialog',{accept:true});
  });
  function send(method,params={}) {return new Promise((resolve,reject)=>{const number=++id;calls.set(number,{resolve,reject});socket.send(JSON.stringify({id:number,method,params}));});}
  async function evaluate(expression) {
    const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;
  }
  async function wait(expression,description=expression) {
    for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(40);}throw new Error('Timed out: '+description+'\n'+await evaluate('document.body.innerText'));
  }
  const empty={version:1,title:'Synthetic test archive',rootPersonId:null,people:[],stories:[],media:[]};
  await send('Page.enable');await send('Runtime.enable');
  const source = `if(!localStorage.getItem('__seeded')){localStorage.setItem('__seeded','yes');localStorage.setItem('familyArchive.v1',JSON.stringify(${JSON.stringify(empty)}));}
    window.__set=(id,value)=>{const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
    ${native ? `window.FamilyArchiveNative={platform:'desktop',archiveIdentity:async()=>localStorage.getItem('__identityUnavailable')?null:localStorage.getItem('__nativeIdentity')||'synthetic-store-A:generation-1',readArchive:async()=>JSON.parse(localStorage.getItem('familyArchive.v1')),writeArchive:async a=>{window.__writeCount=(window.__writeCount||0)+1;if(window.__fail){window.__fail=false;throw new Error('Synthetic disk full');}localStorage.setItem('familyArchive.v1',JSON.stringify(a));},mediaUrl:p=>location.origin+'/'+p,pickMediaBatch:async options=>{window.__lastPicker=options;return window.__batch===undefined?null:window.__batch;},exportArchive:async()=>{window.__exported=JSON.parse(localStorage.getItem('familyArchive.v1'));return 'exported';},openArchive:async()=>{if(!window.__import)return null;if(window.__nextIdentity)localStorage.setItem('__nativeIdentity',window.__nextIdentity);localStorage.setItem('familyArchive.v1',JSON.stringify(window.__import));return window.__import;},importArchive:async()=>window.FamilyArchiveNative.openArchive()};` : ''}`;
  await send('Page.addScriptToEvaluateOnNewDocument',{source});
  async function navigate(page='edit.html') {await send('Page.navigate',{url:base+'/'+page});await wait(page==='edit.html'?`document.getElementById('screenHeading') && document.getElementById('editorStatus').textContent.includes('Редактор готов')`:`document.getElementById('archiveTitle')?.textContent==='Synthetic test archive'`);}
  await navigate();
  return {send,evaluate,wait,navigate,base,dir,media,exceptions,
    click:selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`),
    set:(id,value)=>evaluate(`__set(${JSON.stringify(id)},${JSON.stringify(value)})`),
    submit:id=>evaluate(`document.getElementById(${JSON.stringify(id)}).requestSubmit()`),
    saved:()=>evaluate(`JSON.parse(localStorage.getItem('familyArchive.v1'))`),
    focus:()=>evaluate('document.activeElement.id')};
}
test('Chromium connected browser: family, parents, cycles, drafts, file batches, main photo, stories, viewer, JSON', {skip:!available,timeout:60000}, async t=>{
  const b=await browser(t);
  assert.match(await b.evaluate('document.body.innerText'), /В семье пока нет карточек/);
  await b.evaluate("newPersonButton.focus()");
  await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
  await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await b.wait('document.getElementById("fullName")');
  assert.equal(await b.focus(),'fullName');
  await b.submit('personForm'); assert.equal(await b.focus(),'fullName');
  assert.equal(await b.evaluate('fullName.getAttribute("aria-invalid")'),'true');
  await b.set('fullName','Синтетическая Вера');await b.submit('personForm');
  await b.wait(`editorStatus.textContent.includes('Карточка сохранена')`);
  const child=(await b.saved()).people[0];assert.equal(child.rememberFor,'');
  await b.click('#addMotherButton');assert.equal(await b.focus(),'parentExisting');
  await b.evaluate('cancelParentButton.focus()');
  await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert.equal(await b.focus(),'parentExisting');
  const dialogAX=(await b.send('Accessibility.getFullAXTree')).nodes.find(n=>!n.ignored&&n.role?.value==='dialog');assert.match(dialogAX.name.value,/Добавить мать/);
  await b.set('parentName','Синтетическая мать');
  await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await b.wait('!parentDialog.open'); assert.equal(await b.focus(),'addMotherButton');
  await b.click('#addMotherButton');assert.equal(await b.evaluate('parentName.value'),'Синтетическая мать');
  await b.submit('parentForm');await b.wait('!parentDialog.open && editorStatus.textContent.includes("Родитель добавлен")');
  const mother=(await b.saved()).people.find(p=>p.fullName==='Синтетическая мать');assert.equal((await b.saved()).people[0].motherId,mother.id);
  await b.click('[data-view="family"]');await b.click('#newPersonButton');await b.set('fullName','Синтетический отец');await b.submit('personForm');await b.wait('editorStatus.textContent.includes("Карточка сохранена")');
  const father=(await b.saved()).people.find(p=>p.fullName==='Синтетический отец');
  await b.click('[data-view="family"]');await b.click(`[data-id="${child.id}"][data-action="open"]`);
  await b.click('#addFatherButton');await b.set('parentExisting',father.id);await b.submit('parentForm');await b.wait('!parentDialog.open');
  assert.equal((await b.saved()).people.find(p=>p.id===child.id).fatherId,father.id);
  await b.set('fatherId',mother.id);await b.submit('personForm');await b.wait('entityError.textContent.includes("одновременно")');assert.equal(await b.focus(),'fatherId');await b.set('fatherId',father.id);
  await b.click('[data-view="family"]');await b.click(`[data-id="${mother.id}"][data-action="open"]`);await b.set('motherId',child.id);await b.submit('personForm');await b.wait('entityError.textContent.includes("Цикл")');
  assert.equal((await b.saved()).people.find(p=>p.id===mother.id).motherId,null);
  await b.set('motherId','');await b.set('bio','Несохранённая биография матери');
  await b.click('[data-view="family"]');await b.set('peopleSearch','Вера');assert.equal(await b.evaluate('familyResults.querySelectorAll("li").length'),1);await b.click(`[data-id="${child.id}"][data-action="open"]`);
  await b.set('bio','Черновик Веры');await b.click('[data-view="library"]');await b.navigate();assert.equal(await b.evaluate('screenHeading.textContent'),'Библиотека файлов');
  await b.click('[data-view="family"]');await b.set('peopleSearch','');await b.click(`[data-id="${child.id}"][data-action="open"]`);assert.equal(await b.evaluate('bio.value'),'Черновик Веры');
  await b.click('[data-action="upload"]');
  const node=await b.send('DOM.getDocument');const input=await b.send('DOM.querySelector',{nodeId:node.root.nodeId,selector:'#mediaFileInput'});
  await b.send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[path.join(b.media,'Synthetic photo.svg'),path.join(b.media,'Synthetic note.txt'),path.join(b.dir,'unsupported.exe')]});
  await b.wait('!uploadPanel.hidden && uploadPanel.textContent.includes("формат не поддерживается")');assert.equal((await b.saved()).media.length,0);
  assert.match(await b.evaluate('editorStatus.textContent'),/ещё не скопированы/);
  await b.click('[data-action="manualUploads"]');await b.wait('JSON.parse(localStorage.getItem("familyArchive.v1")).media.length===2');
  const photo=(await b.saved()).media.find(m=>m.type==='photo');assert.ok(photo.personIds.includes(child.id));
  await b.click(`input[name="primaryMediaId"][value="${photo.id}"]`);await b.submit('personForm');await b.wait('editorStatus.textContent.includes("Карточка сохранена")');
  assert.equal((await b.saved()).people.find(p=>p.id===child.id).primaryMediaId,photo.id);
  await b.click('#newStoryButton');await b.set('storyTitle','Синтетическое воспоминание');await b.set('storyText','Синтетический текст семейной истории.');await b.click(`#storyMediaIds input[value="${photo.id}"]`);await b.submit('storyForm');await b.wait('editorStatus.textContent.includes("Карточка сохранена")');
  const story=(await b.saved()).stories[0];assert.ok(story.personIds.includes(child.id));assert.ok((await b.saved()).people.find(p=>p.id===child.id).storyIds.includes(story.id));
  await b.click('[data-action="backPerson"]');assert.equal(await b.evaluate('personId.value'),child.id);
  await b.click('[data-view="family"]');await b.click(`[data-id="${father.id}"][data-action="open"]`);await b.click(`#mediaIds input[value="${photo.id}"]`);await b.submit('personForm');await b.wait('editorStatus.textContent.includes("Карточка сохранена")');await b.click('#setRootButton');await b.wait('editorStatus.textContent.includes("Начало дерева изменено")');assert.equal((await b.saved()).rootPersonId,father.id);
  await b.click('[data-view="family"]');await b.click(`[data-id="${mother.id}"][data-action="open"]`);assert.equal(await b.evaluate('bio.value'),'Несохранённая биография матери');
  await b.click('[data-view="library"]');await b.click('#newMediaButton');await b.set('mediaTitle','Самостоятельный документ');await b.set('mediaType','document');await b.set('mediaPath','media/Synthetic note.txt');await b.submit('mediaForm');await b.wait('editorStatus.textContent.includes("Карточка сохранена")');assert.equal((await b.saved()).media.at(-1).personIds.length,0);
  await b.click('[data-view="settings"]');
  const saved=await b.saved();assert.equal(await b.evaluate('JSON.parse(jsonOutput.value).people.length'),3);
  await b.click('#exportButton');await b.wait('editorStatus.textContent.includes("экспортирован")');
  const imported={...saved,title:'Synthetic imported archive'};await b.set('jsonOutput',JSON.stringify(imported));await b.click('#loadFromTextareaButton');await b.wait('editorStatus.textContent.includes("Архив импортирован")');assert.equal((await b.saved()).title,imported.title);
  assert.match(await b.evaluate('document.body.innerText'),/Черновики других архивов/);
  // Restore previous archive and its unrelated person draft, then exercise the unchanged viewer.
  await b.click('[data-action="restoreSession"]');await b.wait('editorStatus.textContent.includes("восстановлены")');assert.equal((await b.saved()).title,'Synthetic test archive');
  await b.click('[data-view="family"]');await b.click(`[data-id="${mother.id}"][data-action="open"]`);assert.equal(await b.evaluate('bio.value'),'Несохранённая биография матери');
  // Runtime semantics: no duplicate IDs; visible fields are labelled; dialog and heading focus are usable.
  const semantics=await b.evaluate(`(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return {unique:new Set(ids).size===ids.length,unlabelled:[...document.querySelectorAll('main input:not([type="hidden"]),main select,main textarea')].filter(e=>!e.labels.length).map(e=>e.id),h1:document.querySelectorAll('h1').length};})()`);
  assert.deepEqual(semantics,{unique:true,unlabelled:[],h1:1});
  const ax=await b.send('Accessibility.getFullAXTree');assert.ok(ax.nodes.some(n=>n.role?.value==='textbox'&&n.name?.value==='Имя / ФИО'));
  await b.send('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:false});assert.equal(await b.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),true);
  await b.navigate('index.html');await b.wait('document.getElementById("personDetail")');await b.click(`[data-person-id="${child.id}"]`);await b.wait(`personDetail.textContent.includes('Синтетическое воспоминание')`);assert.match(await b.evaluate('personDetail.textContent'),/Синтетическая мать/);
  await b.click(`[data-media-id="${photo.id}"]`);await b.wait('!lightbox.hidden');assert.equal(await b.focus(),'lightboxClose');
  await b.navigate();await b.click('[data-view="library"]');const documentMedia=(await b.saved()).media.find(m=>m.type==='document');await b.click(`[data-id="${documentMedia.id}"][data-action="open"]`);await b.click('[data-action="delete"]');await b.wait('!JSON.parse(localStorage.getItem("familyArchive.v1")).media.some(m=>m.id==='+JSON.stringify(documentMedia.id)+')');assert.ok((await b.saved()).media.some(m=>m.id===photo.id));
  await b.click('[data-view="family"]');await b.set('peopleSearch','');await b.click(`[data-id="${father.id}"][data-action="open"]`);await b.click('[data-action="delete"]');await b.wait('!JSON.parse(localStorage.getItem("familyArchive.v1")).people.some(p=>p.id==='+JSON.stringify(father.id)+')');assert.equal((await b.saved()).people.find(p=>p.id===child.id).fatherId,null);
  await b.click(`[data-id="${mother.id}"][data-action="open"]`);assert.equal(await b.evaluate('bio.value'),'Несохранённая биография матери');
  assert.deepEqual(b.exceptions,[]);
});
test('Chromium native boundary: cancelled picker, partial folder batch, failed save/restart, retry, unrelated drafts, new contextual story', {skip:!available,timeout:45000}, async t=>{
  const b=await browser(t,true);
  await b.click('#newPersonButton');await b.set('fullName','Синтетическая Нина');await b.submit('personForm');await b.wait('editorStatus.textContent.includes("Карточка сохранена")');const person=(await b.saved()).people[0];
  await b.set('bio','Восстановить после ошибки');await b.evaluate('window.__fail=true');await b.submit('personForm');await b.wait('entityError.textContent.includes("Synthetic disk full")');assert.equal(await b.evaluate('bio.value'),'Восстановить после ошибки');assert.equal((await b.saved()).people[0].bio,'');
  await b.navigate();assert.equal(await b.evaluate('bio.value'),'Восстановить после ошибки');await b.submit('personForm');await b.wait('editorStatus.textContent.includes("Карточка сохранена")');assert.equal((await b.saved()).people[0].bio,'Восстановить после ошибки');
  await b.click('[data-action="upload"]');await b.wait('editorStatus.textContent.includes("отменён")');assert.equal((await b.saved()).media.length,0);
  await b.evaluate(`window.__batch={media:[{path:'media/Synthetic photo.svg',type:'photo',title:'Синтетическое фото'},{path:'media/Synthetic note.txt',type:'document',title:'Синтетическая заметка'}],errors:[{name:'bad.exe',message:'Формат не поддерживается'}]};window.__fail=true;`);
  await b.click('[data-action="upload"][data-folder="true"]');await b.wait('editorStatus.textContent.includes("Synthetic disk full")');assert.equal((await b.saved()).media.length,0);assert.equal(await b.evaluate('__lastPicker.folder'),true);assert.match(await b.evaluate('uploadPanel.textContent'),/bad.exe/);
  await b.navigate();await b.click('[data-action="retryUploads"]');await b.wait('JSON.parse(localStorage.getItem("familyArchive.v1")).media.length===2');assert.ok((await b.saved()).media.every(m=>m.personIds.includes(person.id)));
  await b.click('[data-view="library"]');await b.evaluate(`window.__batch={media:[{path:'media/unattached.txt',type:'document',title:'Независимый файл'}],errors:[]}`);await b.click('[data-action="upload"]');await b.wait('JSON.parse(localStorage.getItem("familyArchive.v1")).media.length===3');assert.equal((await b.saved()).media.at(-1).personIds.length,0);
  await b.click('[data-view="family"]');await b.click('#newPersonButton');await b.set('fullName','Синтетический Олег');const newId=await b.evaluate('personId.value');await b.click('#newStoryButton');await b.set('storyTitle','История новой карточки');await b.set('storyText','Полностью синтетическая история.');const contextualStoryId=await b.evaluate('storyId.value');await b.click('[data-view="library"]');await b.evaluate(`window.__batch={media:[{path:'media/context-check.txt',type:'document',title:'Файл при открытом черновике'}],errors:[]}`);await b.click('[data-action="upload"]');await b.wait('JSON.parse(localStorage.getItem("familyArchive.v1")).media.length===4');await b.navigate();await b.click('[data-view="stories"]');await b.click(`[data-id="${contextualStoryId}"][data-action="open"]`);assert.equal(await b.evaluate(`storyPersonIds.querySelector('input[value="${newId}"]').checked`),true);await b.submit('storyForm');await b.wait('editorStatus.textContent.includes("Карточка сохранена")');assert.ok((await b.saved()).people.some(p=>p.id===newId));assert.deepEqual((await b.saved()).stories[0].personIds,[newId]);
  await b.click('[data-action="backPerson"]');await b.set('bio','Независимый черновик');await b.click('[data-view="stories"]');await b.click('[data-kind="stories"][data-action="open"]');await b.set('storyText','Черновик истории');await b.click('[data-action="discard"]');
  await b.click('[data-view="family"]');await b.click(`[data-id="${newId}"][data-action="open"]`);assert.equal(await b.evaluate('bio.value'),'Независимый черновик');
  assert.deepEqual(b.exceptions,[]);
});
async function setFiles(b, selector, files) {
  const doc=await b.send('DOM.getDocument');
  const input=await b.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector});
  await b.send('DOM.setFileInputFiles',{nodeId:input.nodeId,files});
}
const queueExpression=`JSON.parse(localStorage.getItem('familyArchive.editorDrafts.v1')).sessions.flatMap(s=>s.pendingUploads)`;
test('Chromium duplicate folder basenames/sizes remain distinct; restart recovery is explicit and copies both byte payloads', {skip:!available,timeout:45000}, async t=>{
  const b=await browser(t);
  const folder=path.join(b.dir,'duplicate-folder');
  for(const [sub,bytes] of [['a','AAAA'],['b','BBBB']]) {
    await fs.mkdir(path.join(folder,sub),{recursive:true});
    await fs.writeFile(path.join(folder,sub,'photo.jpg'),bytes);
    await fs.utimes(path.join(folder,sub,'photo.jpg'),1700000000,1700000000);
  }
  await b.click('[data-view="library"]');await b.click('[data-action="upload"][data-folder="true"]');
  await setFiles(b,'#mediaFolderInput',[folder]);
  await b.wait(`${queueExpression}.length===2`);
  const original=await b.evaluate(queueExpression);
  assert.equal(new Set(original.map(e=>e.id)).size,2);
  assert.equal(new Set(original.map(e=>e.path)).size,2);
  assert.deepEqual(original.map(e=>e.sourceRelativePath).sort(),['duplicate-folder/a/photo.jpg','duplicate-folder/b/photo.jpg']);
  assert.ok(original.every(e=>e.sourceSize===4));assert.equal(original[0].sourceLastModified,original[1].sourceLastModified);
  await b.navigate();await b.click('[data-view="library"]');
  assert.deepEqual((await b.evaluate(queueExpression)).map(e=>e.id),original.map(e=>e.id));
  // A normal re-selection creates distinct entries, never guesses which old queue item to overwrite.
  await b.click('[data-action="upload"]');
  await setFiles(b,'#mediaFileInput',[path.join(folder,'a','photo.jpg'),path.join(folder,'b','photo.jpg')]);
  await b.wait(`${queueExpression}.length===4`);
  const fresh=(await b.evaluate(queueExpression)).slice(2);
  for(const e of fresh)await b.click(`[data-action="removeUpload"][data-id="${e.id}"]`);
  // Real OPFS copy path: after restart no source bytes exist until an explicit entry is selected.
  await b.evaluate('window.showDirectoryPicker=async()=>navigator.storage.getDirectory();undefined');
  await b.click('[data-action="copyUploads"]');await b.wait('uploadPanel.textContent.includes("После перезапуска")');
  assert.equal((await b.saved()).media.length,0);
  for(const e of original) {
    await b.click(`[data-action="reselectUpload"][data-id="${e.id}"]`);
    const sub=e.sourceRelativePath.includes('/a/')?'a':'b';
    await setFiles(b,'#mediaFileInput',[path.join(folder,sub,'photo.jpg')]);
    await b.wait(`JSON.parse(localStorage.getItem('familyArchive.v1')).media.some(m=>m.id===${JSON.stringify(e.id)})`);
    const saved=(await b.saved()).media.find(m=>m.id===e.id);
    const bytes=await b.evaluate(`(async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('media');return (await (await d.getFileHandle(${JSON.stringify(saved.path.slice(6))})).getFile()).text();})()`);
    assert.equal(bytes,sub==='a'?'AAAA':'BBBB');
  }
  assert.equal((await b.saved()).media.length,2);assert.equal((await b.evaluate(queueExpression)).length,0);
  assert.deepEqual(b.exceptions,[]);
});
test('Chromium native archive identity: no replay into another store or replacement generation; returning to A retains drafts', {skip:!available,timeout:45000}, async t=>{
  const b=await browser(t,true);
  await b.click('#newPersonButton');await b.set('fullName','Synthetic identity person');await b.submit('personForm');await b.wait('editorStatus.textContent.includes("Карточка сохранена")');
  const a=await b.saved(), person=a.people[0];
  await b.set('bio','A-only unsaved biography');
  await b.evaluate(`window.__batch={media:[{path:'media/only-in-A.jpg',title:'A-only photo',type:'photo'}],errors:[]};window.__fail=true;`);
  await b.click('[data-action="upload"]');await b.wait('editorStatus.textContent.includes("Synthetic disk full")');
  const writes=await b.evaluate('__writeCount');
  await b.click('[data-view="settings"]');
  // B deliberately has IDENTICAL JSON: matching JSON is not a storage identity.
  await b.evaluate(`window.__import=${JSON.stringify(a)};window.__nextIdentity='synthetic-store-B:generation-1'`);
  await b.click('#nativeOpenArchiveButton');await b.wait('editorStatus.textContent.includes("Полный архив открыт")');
  assert.equal(await b.evaluate('uploadPanel.hidden'),true);
  assert.equal(await b.evaluate('document.querySelector("[data-action=restoreSession]").disabled'),true);
  assert.match(await b.evaluate('main.textContent'),/Откройте исходный полный архив/);
  // Bypass disabled UI to verify the action guard itself refuses the write.
  await b.evaluate('document.querySelector("[data-action=restoreSession]").disabled=false');await b.click('[data-action="restoreSession"]');
  await b.wait('editorStatus.textContent.includes("Восстановление заблокировано")');assert.equal(await b.evaluate('__writeCount'),writes);assert.deepEqual(await b.saved(),a);
  await b.click('[data-view="family"]');await b.click(`[data-id="${person.id}"][data-action="open"]`);assert.equal(await b.evaluate('bio.value'),'');
  await b.navigate();await b.click('[data-view="settings"]');assert.equal(await b.evaluate('document.querySelector("[data-action=restoreSession]").disabled'),true);
  await b.evaluate(`window.__import=${JSON.stringify(a)};window.__nextIdentity='synthetic-store-A:generation-1'`);await b.click('#nativeOpenArchiveButton');await b.wait('editorStatus.textContent.includes("Полный архив открыт")');
  assert.match(await b.evaluate('uploadPanel.textContent'),/A-only photo/);
  await b.click('[data-view="family"]');await b.click(`[data-id="${person.id}"][data-action="open"]`);assert.equal(await b.evaluate('bio.value'),'A-only unsaved biography');
  await b.navigate();assert.equal(await b.evaluate('bio.value'),'A-only unsaved biography');
  await b.click('[data-action="retryUploads"]');await b.wait('JSON.parse(localStorage.getItem("familyArchive.v1")).media.length===1');assert.equal((await b.saved()).media[0].path,'media/only-in-A.jpg');
  await b.click('[data-view="settings"]');
  // Android-style import: same store/root, a new generation, deliberately identical archive JSON.
  const before=await b.saved();await b.evaluate(`window.__import=${JSON.stringify(before)};window.__nextIdentity='synthetic-store-A:generation-2'`);
  await b.click('#nativeImportArchiveButton');await b.wait('editorStatus.textContent.includes("Полный архив открыт")');
  assert.equal(await b.evaluate('document.querySelector("[data-action=restoreSession]").disabled'),true);
  await b.evaluate('window.__writeCount=0;document.querySelector("[data-action=restoreSession]").disabled=false');await b.click('[data-action="restoreSession"]');await b.wait('editorStatus.textContent.includes("Восстановление заблокировано")');
  assert.equal(await b.evaluate('__writeCount'),0);assert.deepEqual(await b.saved(),before);
  assert.deepEqual(b.exceptions,[]);
});
test('Chromium native snapshots fail closed for legacy/unknown identity and recheck identity before same-store restoration', {skip:!available,timeout:45000}, async t=>{
  const b=await browser(t,true);
  await b.click('#newPersonButton');await b.set('fullName','Synthetic safety person');await b.submit('personForm');await b.wait('editorStatus.textContent.includes("Карточка сохранена")');
  const a=await b.saved(), person=a.people[0];await b.set('bio','Do not replay into B');await b.click('[data-view="settings"]');
  await b.set('jsonOutput',JSON.stringify({...a,title:'Same store JSON replacement'}));await b.click('#loadFromTextareaButton');await b.wait('editorStatus.textContent.includes("Архив импортирован")');
  assert.equal(await b.evaluate('document.querySelector("[data-action=restoreSession]").disabled'),false);
  await b.click('[data-action="restoreSession"]');await b.wait('editorStatus.textContent.includes("восстановлены")');assert.equal((await b.saved()).title,a.title);
  await b.click('[data-view="family"]');await b.click(`[data-id="${person.id}"][data-action="open"]`);assert.equal(await b.evaluate('bio.value'),'Do not replay into B');
  await b.click('[data-view="settings"]');await b.set('jsonOutput',JSON.stringify({...a,title:'Second same-store replacement'}));await b.click('#loadFromTextareaButton');await b.wait('editorStatus.textContent.includes("Архив импортирован")');
  const before=await b.saved();await b.evaluate('window.__writeCount=0;localStorage.setItem("__nativeIdentity","synthetic-store-B:generation-1")');
  await b.click('[data-action="restoreSession"]');await b.wait('editorStatus.textContent.includes("восстановление здесь заблокировано")');assert.equal(await b.evaluate('__writeCount'),0);assert.deepEqual(await b.saved(),before);
  // Legacy snapshots cannot be auto-selected or manually restored even with equal base JSON.
  const legacyScript=await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const d=JSON.parse(localStorage.getItem('familyArchive.editorDrafts.v1'));d.sessions.forEach(s=>{delete s.archiveIdentity;delete s.native;});localStorage.setItem('familyArchive.editorDrafts.v1',JSON.stringify(d));localStorage.setItem('familyArchive.v1',${JSON.stringify(JSON.stringify(a))});localStorage.setItem('__nativeIdentity','synthetic-store-A:generation-1');})()`});
  await b.navigate();await b.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:legacyScript.identifier});await b.click('[data-view="family"]');await b.click(`[data-id="${person.id}"][data-action="open"]`);assert.equal(await b.evaluate('bio.value'),'');await b.click('[data-view="settings"]');
  assert.equal(await b.evaluate('[...document.querySelectorAll("[data-action=restoreSession]")].every(e=>e.disabled)'),true);
  await b.evaluate('localStorage.setItem("__identityUnavailable","yes")');await b.navigate();await b.click('[data-view="settings"]');
  assert.equal(await b.evaluate('[...document.querySelectorAll("[data-action=restoreSession]")].every(e=>e.disabled)'),true);
  await b.evaluate('window.__writeCount=0;document.querySelector("[data-action=restoreSession]").disabled=false');await b.click('[data-action="restoreSession"]');await b.wait('editorStatus.textContent.includes("Восстановление заблокировано")');assert.equal(await b.evaluate('__writeCount'),0);assert.deepEqual(await b.saved(),a);
  assert.deepEqual(b.exceptions,[]);
});
test('Chromium genuine FileSystemDirectoryHandle copies bytes, imports folders, and never overwrites collisions', {skip:!available,timeout:45000}, async t=>{
  const b=await browser(t);
  // OPFS gives genuine Chromium file/directory handles without automating an OS permission dialog.
  // Only the chooser is substituted; the app exercises real getFileHandle/createWritable/write/close.
  await b.evaluate('window.showDirectoryPicker=async()=>navigator.storage.getDirectory();undefined');
  await b.click('[data-view="library"]');await b.click('#openArchiveFolderButton');await b.wait('editorStatus.textContent.includes("Папка архива разрешена")');
  await b.click('[data-action="upload"]');
  let doc=await b.send('DOM.getDocument'), node=await b.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#mediaFileInput'});
  await b.send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[path.join(b.media,'Synthetic photo.svg'),path.join(b.media,'Synthetic note.txt')]});
  await b.wait('JSON.parse(localStorage.getItem("familyArchive.v1")).media.length===2');
  const first=await b.saved();
  for(const m of first.media){
    const copied=await b.evaluate(`(async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('media');return await (await (await d.getFileHandle(${JSON.stringify(m.path.slice(6))})).getFile()).text();})()`);
    assert.equal(copied,await fs.readFile(path.join(b.media,m.path.slice(6)),'utf8'));
    assert.deepEqual(m.personIds,[]);
  }
  // Choosing the same source again creates a new safe destination; old bytes remain unchanged.
  await b.click('[data-action="upload"]');doc=await b.send('DOM.getDocument');node=await b.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#mediaFileInput'});
  await b.send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[path.join(b.media,'Synthetic photo.svg')]});await b.wait('JSON.parse(localStorage.getItem("familyArchive.v1")).media.length===3');
  assert.equal(new Set((await b.saved()).media.map(m=>m.path)).size,3);
  const nested=path.join(b.dir,'folder-fixture');await fs.mkdir(path.join(nested,'nested'),{recursive:true});await fs.writeFile(path.join(nested,'nested','nested.txt'),'Synthetic nested folder fixture.');await fs.writeFile(path.join(nested,'bad.exe'),'Unsupported synthetic fixture.');
  await b.click('[data-action="upload"][data-folder="true"]');doc=await b.send('DOM.getDocument');node=await b.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#mediaFolderInput'});
  await b.send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[nested]});await b.wait('JSON.parse(localStorage.getItem("familyArchive.v1")).media.length===4');
  assert.match(await b.evaluate('uploadPanel.textContent'),/bad.exe/);
  const last=(await b.saved()).media.at(-1);
  assert.equal(await b.evaluate(`(async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('media');return await (await (await d.getFileHandle(${JSON.stringify(last.path.slice(6))})).getFile()).text();})()`),'Synthetic nested folder fixture.');
  await b.navigate();assert.equal((await b.saved()).media.length,4);
  assert.deepEqual(b.exceptions,[]);
});
