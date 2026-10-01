'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {app,BrowserWindow,dialog,ipcMain,protocol,net,shell}=require('electron');
const {ArchiveStore,atomicWrite}=require('./store.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'family',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
if(process.env.FAMILY_ARCHIVE_DATA_DIR) app.setPath('userData',path.resolve(process.env.FAMILY_ARCHIVE_DATA_DIR));
const singleInstance=app.requestSingleInstanceLock();
let win,store; let queue=Promise.resolve();
let smokeChoice=null,smokeDestination=null;
if(process.env.FAMILY_ARCHIVE_SMOKE && !process.env.FAMILY_ARCHIVE_DATA_DIR) throw new Error('Smoke tests require an isolated FAMILY_ARCHIVE_DATA_DIR.');
const codeRoot=path.resolve(__dirname,'..');
const securityHeaders={
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
 'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'
};
function trusted(url){try{const u=new URL(url);return u.protocol==='family:'&&u.hostname==='app'&&['/index.html','/edit.html'].includes(u.pathname);}catch{return false;}}
function serial(fn){const result=queue.then(fn);queue=result.catch(()=>{});return result;}
function register(method,handler){ipcMain.handle(`family:${method}`,(event,...args)=>{
 if(event.sender!==win?.webContents || event.senderFrame?.parent || !trusted(event.senderFrame?.url)) throw new Error('Недоверенный источник запроса.');
 return serial(()=>handler(...args));
});}
async function selectStore(next){await atomicWrite(path.join(app.getPath('userData'),'selected-archive.json'),JSON.stringify({root:next.root}));store=next;}
async function choose(options){
 if(process.env.FAMILY_ARCHIVE_SMOKE==='all'){const selected=smokeChoice;smokeChoice=null;return {canceled:!selected,filePaths:selected?[selected]:[]};}
 return dialog.showOpenDialog(win,options);
}
async function saveDialog(options){
 if(process.env.FAMILY_ARCHIVE_SMOKE==='all')return {canceled:!smokeDestination,filePath:smokeDestination};
 return dialog.showSaveDialog(win,options);
}
async function initialize(){
 const home=app.getPath('userData');await fs.mkdir(home,{recursive:true,mode:0o700});
 let root=path.join(home,'archive');
 try{const cfg=JSON.parse(await fs.readFile(path.join(home,'selected-archive.json'),'utf8'));if(typeof cfg.root!=='string')throw new Error('Неверная папка архива.');root=cfg.root;}catch(error){if(error.code!=='ENOENT')throw error;}
 store=new ArchiveStore(root);await store.readArchive();
 protocol.handle('family',async request=>{
  try{
   const u=new URL(request.url);if(u.hostname!=='app'||!['GET','HEAD'].includes(request.method))return new Response('Forbidden',{status:403});
   const relative=decodeURIComponent(u.pathname).replace(/^\//,'');let file;
   if(relative.startsWith('media/')) file=await store.resolveMedia(relative);
   else{
    if(!['index.html','edit.html'].includes(relative)&&!/^assets\/(css|js)\/[a-zA-Z0-9_.-]+\.(css|js)$/.test(relative))return new Response('Not found',{status:404});
    file=path.join(codeRoot,relative);
   }
   const response=await net.fetch(pathToFileURL(file).toString());const headers=new Headers(response.headers);for(const [name,value]of Object.entries(securityHeaders))headers.set(name,value);
   return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
  }catch{return new Response('Файл недоступен',{status:404,headers:securityHeaders});}
 });
 register('read',()=>store.readArchive());
 register('write',archive=>store.writeArchive(archive));
 register('open-media',async relative=>{ const file=await store.resolveMedia(relative); if(process.env.FAMILY_ARCHIVE_SMOKE==='all')throw new Error('Проверка ошибки открытия документа'); const error=await shell.openPath(file); if(error)throw new Error(error); return true; });
 register('pick-media',async()=>{
  const result=await choose({title:'Добавить фото, аудио, видео или документ',properties:['openFile'],filters:[{name:'Семейные медиа',extensions:['jpg','jpeg','png','webp','gif','avif','bmp','svg','heic','heif','mp3','m4a','wav','ogg','opus','flac','aac','mp4','webm','mov','mkv','m4v','avi','pdf','txt','md','rtf','doc','docx','odt','xls','xlsx','ppt','pptx','csv']}]});
  return result.canceled?null:store.addMedia(result.filePaths[0]);
 });
 register('open',async()=>{
  const result=await choose({title:'Открыть папку семейного архива',properties:['openDirectory']});if(result.canceled)return null;
  const next=new ArchiveStore(result.filePaths[0]);const archive=await next.readArchive();if(!archive)throw new Error('В выбранной папке нет archive.json.');await next.checkMedia(archive);await selectStore(next);return archive;
 });
 register('import',async()=>{
  const result=await choose({title:'Импортировать семейный архив',properties:['openFile'],filters:[{name:'Семейный архив',extensions:['zip','json']}]});if(result.canceled)return null;
  const file=result.filePaths[0],root=path.join(app.getPath('userData'),'imports');
  const next=path.extname(file).toLowerCase()==='.zip'?await ArchiveStore.importZip(file,root):await ArchiveStore.importJson(file,root);
  const archive=await next.readArchive();await selectStore(next);return archive;
 });
 register('export',async()=>{
  const result=await saveDialog({title:'Сохранить полную копию архива',defaultPath:'family-archive.zip',filters:[{name:'ZIP-архив',extensions:['zip']}]});if(result.canceled)return null;
  return store.exportZip(result.filePath);
 });
 await createWindow();
}
async function createWindow(){
 win=new BrowserWindow({width:1100,height:820,minWidth:360,minHeight:480,title:'Семейный архив',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.on('will-navigate',(event,url)=>{if(!trusted(url)){event.preventDefault();void openMedia(url);}});
 win.webContents.setWindowOpenHandler(({url})=>{void openMedia(url);return{action:'deny'};});
 win.webContents.session.setPermissionRequestHandler((contents,permission,callback)=>callback(false));
 await win.loadURL('family://app/index.html');
 if(process.env.FAMILY_ARCHIVE_SMOKE==='all') {await runIntegratedSmoke();app.quit();return;}
 if(process.env.FAMILY_ARCHIVE_SMOKE==='restart') {
  const a=await store.readArchive();if(a?.people[0]?.fullName!=='Тестовый родственник'||a.media.length!==3||a.stories.length!==1)throw new Error('Restart lost data');
  console.log('Family Archive restart smoke: '+JSON.stringify({person:a.people[0].fullName,media:a.media.length,root:store.root}));app.quit();return;
 }
 if(process.env.FAMILY_ARCHIVE_SMOKE==='1'){
  const result=await win.webContents.executeJavaScript(`(async()=>{
   if(!window.FamilyArchiveNative || window.FamilyArchiveNative.platform!=='desktop')throw new Error('No preload bridge');
   const initial=await window.FamilyArchiveNative.readArchive();
   const archive={version:1,title:'Проверка Electron',rootPersonId:null,people:[],stories:[],media:[]};
   await window.FamilyArchiveNative.writeArchive(archive);
   const reread=await window.FamilyArchiveNative.readArchive();
   return {title:document.title,bridge:true,initialEmpty:initial===null,durableTitle:reread.title,peopleHeading:!!document.querySelector('#peopleHeading'),editorLink:document.querySelector('a[href="edit.html"]')?.textContent};
  })()`);
  if(result.durableTitle!=='Проверка Electron')throw new Error('Roundtrip failed');console.log('Family Archive Electron smoke: '+JSON.stringify(result));app.quit();
 }
}
async function runIntegratedSmoke(){
 const fixture=path.join(app.getPath('userData'),'fixture.gif');
 await fs.writeFile(fixture,Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'));
 const run=code=>win.webContents.executeJavaScript(code);
 const wait=condition=>run(`(async()=>{for(let i=0;i<200;i++){if(${condition})return true;await new Promise(r=>setTimeout(r,25));}throw new Error('UI timeout: '+document.body.innerText.slice(-500));})()`);
 await win.loadURL('family://app/edit.html');await wait(`document.getElementById('editorStatus').textContent.includes('Редактор готов')`);
 await run(`document.getElementById('newPersonButton').click();document.getElementById('fullName').value='Тестовый родственник';document.getElementById('rememberFor').value='Сохраняет семейную память';document.getElementById('personForm').requestSubmit();`);
 await wait(`document.getElementById('editorStatus').textContent.includes('Сохранён человек')`);
 const dirtyResult=await run(`(async()=>{
  const input=document.getElementById('rememberFor');input.value='Несохранённое воспоминание';input.dispatchEvent(new Event('input',{bubbles:true}));
  const root=document.getElementById('rootPersonInput');root.focus();root.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,100));
  const keptAfterRoot=input.value==='Несохранённое воспоминание'&&document.activeElement===root;
  document.getElementById('saveArchiveButton').click();const warns=document.getElementById('editorStatus').textContent.includes('несохранённые поля');
  window.confirm=()=>false;document.getElementById('newPersonButton').click();
  const keptAfterCancel=input.value==='Несохранённое воспоминание';
  document.getElementById('personForm').requestSubmit();return {keptAfterRoot,warns,keptAfterCancel};
 })()`);
 if(!dirtyResult.keptAfterRoot||!dirtyResult.warns||!dirtyResult.keptAfterCancel)throw new Error('Dirty state regression: '+JSON.stringify(dirtyResult));
 await wait(`document.getElementById('editorStatus').textContent.includes('Сохранён человек')`);
 smokeChoice=fixture;
 await run(`document.getElementById('newMediaButton').click();document.getElementById('nativePickMediaButton').click();`);
 await wait(`document.getElementById('mediaFileHint').textContent.includes('Файл скопирован')`);
 await run(`document.getElementById('mediaPersonIds').options[0].selected=true;document.getElementById('mediaForm').requestSubmit();`);
 await wait(`document.getElementById('editorStatus').textContent.includes('Медиа сохранено')`);
 const audio=path.join(app.getPath('userData'),'fixture.wav'),documentFile=path.join(app.getPath('userData'),'fixture.txt');
 const wav=Buffer.alloc(364);wav.write('RIFF',0);wav.writeUInt32LE(356,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(320,40);
 await fs.writeFile(audio,wav);await fs.writeFile(documentFile,'Тестовый семейный документ');
 let expectedMedia=1;
 for(const selected of [audio,documentFile]){
  smokeChoice=selected;
  await run(`document.getElementById('newMediaButton').click();document.getElementById('nativePickMediaButton').click();`);
  await wait(`document.getElementById('mediaPath').value.endsWith(${JSON.stringify(path.extname(selected))})`);
  await run(`document.getElementById('mediaPersonIds').options[0].selected=true;document.getElementById('mediaForm').requestSubmit();`);
  await wait(`(await window.FamilyArchiveNative.readArchive()).media.length===${++expectedMedia}`);
 }
 await run(`document.getElementById('newStoryButton').click();document.getElementById('storyTitle').value='Проверочная история';document.getElementById('storyText').value='Семейное воспоминание';document.getElementById('storyPersonIds').options[0].selected=true;document.getElementById('storyForm').requestSubmit();`);
 await wait(`(await window.FamilyArchiveNative.readArchive()).stories.length===1`);
 smokeDestination=path.join(app.getPath('userData'),'export.zip');
 await run(`document.getElementById('exportButton').click()`);
 await wait(`document.getElementById('editorStatus').textContent.includes('Полный архив экспортирован')`);
 const beforeRoot=store.root;
 await run(`window.confirm=()=>false;document.getElementById('nativeImportArchiveButton').click()`);
 if(store.root!==beforeRoot)throw new Error('Cancelled confirmation changed archive');
 smokeChoice=smokeDestination;
 await run(`window.confirm=()=>true;document.getElementById('nativeImportArchiveButton').click()`);
 await wait(`document.getElementById('editorStatus').textContent.includes('Архив импортирован. Данные сохранены')`);
 if(store.root===beforeRoot)throw new Error('Import did not select isolated new archive');
 const stored=await store.readArchive();if(stored.people.length!==1||stored.media.length!==3||stored.stories.length!==1)throw new Error('UI store mismatch');
 await win.loadURL('family://app/index.html');
 await wait(`document.querySelector('#personDetail img')?.naturalWidth===1`);
 await run(`const root=document.getElementById('rootSelect');root.focus();root.dispatchEvent(new Event('change',{bubbles:true}));if(document.activeElement!==root)throw new Error('View root lost focus');document.querySelector('audio').load();document.querySelector('[data-document-path]').click();`);
 await wait(`document.querySelector('audio').readyState>=1 && document.querySelector('[data-document-path]').closest('.media-card').querySelector('.media-error').textContent.includes('Проверка ошибки')`);
 const result=await run(`({audioLoaded:document.querySelector('audio').readyState>=1,storyShown:document.querySelector('.story-card').textContent.includes('Проверочная история'),documentErrorVisible:!document.querySelector('[data-document-path]').closest('.media-card').querySelector('.media-error').hidden,name:document.getElementById('detailName').textContent,photoLoaded:document.querySelector('#personDetail img').naturalWidth===1,native:window.FamilyArchiveNative.platform})`);
 if(!result.audioLoaded||!result.storyShown||!result.documentErrorVisible)throw new Error('Media/story UI integration failed: '+JSON.stringify(result));
 for(const [i,source] of [fixture,audio,documentFile].entries()) {const bytes=await fs.readFile(await store.resolveMedia(stored.media[i].path));if(!bytes.equals(await fs.readFile(source)))throw new Error('Media bytes changed');}
 const zipSize=(await fs.stat(smokeDestination)).size;
 console.log('Family Archive integrated Electron smoke: '+JSON.stringify({...result,dirtyForms:dirtyResult,mediaRoundtrip:true,zipBytes:zipSize,cancelPreserved:true}));
}
async function openMedia(url){try{const u=new URL(url);if(u.protocol!=='family:'||u.hostname!=='app')return;const relative=decodeURIComponent(u.pathname.slice(1));const file=await store.resolveMedia(relative);await shell.openPath(file);}catch{/* Untrusted links never leave the application. */}}
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('before-quit',event=>{if(!app._archiveFlushed){event.preventDefault();queue.finally(()=>{app._archiveFlushed=true;app.quit();});}});
app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0&&store)void createWindow().catch(error=>dialog.showErrorBox('Семейный архив',error.message));});
if(singleInstance)app.whenReady().then(initialize).catch(error=>{console.error('Family Archive startup:',error.message);if(process.env.FAMILY_ARCHIVE_SMOKE){app.exit(1);return;}dialog.showErrorBox('Семейный архив',`Не удалось открыть архив: ${error.message}`);app.quit();});
else app.quit();
