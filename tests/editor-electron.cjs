/* Run explicitly: xvfb-run -a node_modules/.bin/electron --no-sandbox tests/editor-electron.cjs
 * Isolated real Electron/preload/ArchiveStore integration; no user archives or picker UI are touched.
 */
'use strict';
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {ArchiveStore}=require('../desktop/store.cjs');
const root=path.resolve(__dirname,'..');
let temporary,win,store,failWrite=false,pick=null,destination;
protocol.registerSchemesAsPrivileged([{scheme:'family',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
async function main(){
  temporary=await fs.mkdtemp(path.join(process.env.TMPDIR||os.tmpdir(),'editor-electron-'));
  app.setPath('userData',path.join(temporary,'profile'));
  await app.whenReady();
  store=new ArchiveStore(path.join(temporary,'archive'));
  await store.writeArchive({version:1,title:'Synthetic Electron archive',rootPersonId:null,people:[],stories:[],media:[]});
  const fixtures=path.join(temporary,'fixtures');await fs.mkdir(fixtures);
  await fs.writeFile(path.join(fixtures,'synthetic.gif'),Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'));
  await fs.writeFile(path.join(fixtures,'synthetic.txt'),'Synthetic document fixture.');
  await fs.writeFile(path.join(fixtures,'unsupported.exe'),'Synthetic unsupported fixture.');
  protocol.handle('family',async request=>{
    const url=new URL(request.url),relative=decodeURIComponent(url.pathname.slice(1));
    try {
      const file=relative.startsWith('media/')?await store.resolveMedia(relative):path.resolve(root,relative);
      if(!relative.startsWith('media/')&&!file.startsWith(root+path.sep))return new Response('',{status:403});
      return net.fetch(pathToFileURL(file).href);
    }catch(_){return new Response('',{status:404});}
  });
  ipcMain.handle('family:read',()=>store.readArchive());
  ipcMain.handle('family:archive-identity',()=>store.archiveIdentity());
  ipcMain.handle('family:write',async(_,archive)=>{if(failWrite){failWrite=false;throw new Error('Synthetic write failure');}return store.writeArchive(archive);});
  ipcMain.handle('family:pick-media-batch',async(_,options)=>pick?store.addMediaBatch(pick,{folder:options.folder===true}):null);
  ipcMain.handle('family:export',()=>store.exportZip(destination));
  ipcMain.handle('family:import',async()=>{store=await ArchiveStore.importZip(destination,path.join(temporary,'imports'));return store.readArchive();});
  ipcMain.handle('family:open',()=>null);
  ipcMain.handle('family:open-media',()=>null);
  win=new BrowserWindow({show:false,width:1100,height:820,webPreferences:{preload:path.join(root,'desktop/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const exceptions=[];win.webContents.on('console-message',event=>{if(event.level==='error'&&!event.message.includes('Failed to load resource'))exceptions.push(event.message);});
  const run=code=>win.webContents.executeJavaScript(code);
  const wait=condition=>run(`(async()=>{for(let n=0;n<250;n++){if(${condition})return;await new Promise(r=>setTimeout(r,20));}throw new Error('UI timeout: '+document.body.innerText);})()`);
  const click=selector=>run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const set=(id,value)=>run(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const submit=id=>run(`document.getElementById(${JSON.stringify(id)}).requestSubmit()`);
  await win.loadURL('family://app/edit.html');await wait(`editorStatus.textContent.includes('Редактор готов')`);
  await click('#newPersonButton');await set('fullName','Синтетический родственник');await submit('personForm');await wait(`editorStatus.textContent.includes('Карточка сохранена')`);
  const child=(await store.readArchive()).people[0];assert.equal(child.rememberFor,'');
  await click('#addMotherButton');await set('parentName','Синтетическая мать');await submit('parentForm');await wait('!parentDialog.open');
  assert.equal((await store.readArchive()).people.length,2);assert.ok((await store.readArchive()).people[0].motherId);
  await set('bio','Черновик после отказа записи');failWrite=true;await submit('personForm');await wait(`entityError.textContent.includes('Synthetic write failure')`);
  await win.reload();await wait(`editorStatus.textContent.includes('Редактор готов')`);assert.equal(await run('bio.value'),'Черновик после отказа записи');
  await submit('personForm');await wait(`editorStatus.textContent.includes('Карточка сохранена')`);
  pick=[fixtures];failWrite=true;await click('[data-action="upload"][data-folder="true"]');await wait(`editorStatus.textContent.includes('Synthetic write failure')`);
  assert.equal((await store.readArchive()).media.length,0);assert.ok(await run(`uploadPanel.textContent.includes('unsupported.exe')`));
  await win.reload();await wait(`editorStatus.textContent.includes('Редактор готов')`);await click('[data-action="retryUploads"]');await wait(`(await FamilyArchiveNative.readArchive()).media.length===2`);
  const media=(await store.readArchive()).media,photo=media.find(m=>m.type==='photo');assert.ok(media.every(m=>m.personIds.includes(child.id)));
  for(const m of media)assert.deepEqual(await fs.readFile(await store.resolveMedia(m.path)),await fs.readFile(path.join(fixtures,m.type==='photo'?'synthetic.gif':'synthetic.txt')));
  await click(`input[name="primaryMediaId"][value="${photo.id}"]`);await submit('personForm');await wait(`editorStatus.textContent.includes('Карточка сохранена')`);
  await wait('document.querySelector("img.editor-photo")?.naturalWidth===1');
  await click('#newStoryButton');await set('storyTitle','Синтетическая история');await set('storyText','Полностью синтетическое воспоминание.');await submit('storyForm');await wait(`editorStatus.textContent.includes('Карточка сохранена')`);
  await click('[data-view="settings"]');destination=path.join(temporary,'export.zip');await click('#exportButton');await wait(`editorStatus.textContent.includes('Полный архив экспортирован')`);assert.ok((await fs.stat(destination)).size>0);
  await run('window.confirm=()=>true;undefined');await click('#nativeImportArchiveButton');await wait(`editorStatus.textContent.includes('Полный архив открыт')`);
  assert.equal((await store.readArchive()).people.length,2);assert.equal((await store.readArchive()).stories.length,1);assert.equal((await store.readArchive()).media.length,2);
  await win.loadURL('family://app/index.html');await wait(`document.getElementById('personDetail')?.textContent.includes('Синтетическая история')`);await wait('document.querySelector("#personDetail img")?.naturalWidth===1');
  console.log(JSON.stringify({electron:process.versions.electron,nameOnly:true,parentLinked:true,failedSaveAndReload:true,folderPartial:true,queueRetryAfterReload:true,copiedBytesVerified:true,mainPhotoLoaded:true,storyLinked:true,zipExportImport:true,viewer:true,consoleErrors:exceptions}));
  assert.deepEqual(exceptions,[]);
}
main().then(()=>app.exit(0)).catch(error=>{console.error(error.stack);app.exit(1);});
process.on('exit',()=>{if(temporary)require('node:fs').rmSync(temporary,{recursive:true,force:true});});
