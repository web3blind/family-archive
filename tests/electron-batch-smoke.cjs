'use strict';
// Run with xvfb-run -a node_modules/.bin/electron tests/electron-batch-smoke.cjs
const {app,dialog}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const choices=[],properties=[];
let fixture;
dialog.showOpenDialog=async(_win,options)=>{properties.push(options.properties);const filePaths=choices.shift();return {canceled:!filePaths,filePaths:filePaths||[]};};
const timeout=setTimeout(()=>{console.error('Native batch smoke timed out');app.exit(1);},30000);
app.on('browser-window-created',(_event,win)=>{
 win.webContents.once('did-finish-load',()=>setImmediate(async()=>{
  try {
   const source=path.join(fixture,'source');await fs.mkdir(path.join(source,'album'),{recursive:true});
   const photo=path.join(source,'album','photo.jpg'),pdf=path.join(source,'letter.pdf'),bad=path.join(source,'payload.exe'),huge=path.join(source,'huge.mp4');
   await fs.writeFile(photo,'synthetic photo');await fs.writeFile(pdf,'synthetic letter');await fs.writeFile(bad,'unsupported');
   const handle=await fs.open(huge,'wx');await handle.truncate(512*1024*1024+1);await handle.close();
   await fs.symlink(path.join(source,'album'),path.join(source,'linked'));
   const invoke=code=>win.webContents.executeJavaScript(code);
   assert.equal(await invoke('window.FamilyArchiveNative.platform'),'desktop');
   choices.push([photo,pdf,bad,huge]);
   let result=await invoke('window.FamilyArchiveNative.pickMediaBatch({folder:false})');
   assert.equal(result.media.length,2);assert.equal(result.errors.length,2);assert.deepEqual(properties.at(-1),['openFile','multiSelections']);
   const copied=result.media;
   choices.push(null);assert.equal(await invoke('window.FamilyArchiveNative.pickMediaBatch({folder:true})'),null);
   choices.push([source]);result=await invoke('window.FamilyArchiveNative.pickMediaBatch({folder:true})');
   assert.equal(result.media.length,2);assert.equal(result.errors.length,3);assert.deepEqual(properties.at(-1),['openDirectory']);
   for(const item of copied){const dest=path.join(fixture,'archive',item.path);assert.equal(await fs.realpath(dest),dest);assert.ok((await fs.readFile(dest,'utf8')).startsWith('synthetic'));}
   choices.push([photo]);assert.equal((await invoke('window.FamilyArchiveNative.pickMedia()')).type,'photo');
   assert.equal((await fs.readdir(path.join(fixture,'archive','media'))).length,5);
   console.log('Electron native batch smoke: multi=2/2, folder=2/3, cancel=null, legacy=photo, canonical copies verified');
   clearTimeout(timeout);await fs.rm(fixture,{recursive:true,force:true});app.exit(0);
  }catch(error){console.error(error);clearTimeout(timeout);if(fixture)await fs.rm(fixture,{recursive:true,force:true});app.exit(1);}
 }));
});
(async()=>{
 fixture=await fs.mkdtemp(path.join(process.env.TMPDIR||require('node:os').tmpdir(),'family-electron-batch-'));
 process.env.FAMILY_ARCHIVE_DATA_DIR=fixture;
 delete process.env.FAMILY_ARCHIVE_SMOKE;
 require('../desktop/main.cjs');
})().catch(error=>{console.error(error);app.exit(1);});
