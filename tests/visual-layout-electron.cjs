/* Run: xvfb-run -a node_modules/.bin/electron --no-sandbox tests/visual-layout-electron.cjs
 * Isolated rendered regression for authored paragraphs and media path containment. */
'use strict';
const {app,BrowserWindow,protocol,net}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');let temporary,win;
protocol.registerSchemesAsPrivileged([{scheme:'family',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
(async()=>{try{
 temporary=await fs.mkdtemp(path.join(process.env.TMPDIR||'/home/assistent/.hermes/cache/scratch','visual-layout-'));app.setPath('userData',path.join(temporary,'profile'));await app.whenReady();
 protocol.handle('family',request=>{const relative=new URL(request.url).pathname.slice(1);if(relative.startsWith('media/'))return new Response('Synthetic missing document',{status:404});return net.fetch(pathToFileURL(path.join(root,relative)).href);});
 win=new BrowserWindow({show:false,width:1100,height:820,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 await win.loadURL('family://app/index.html');
 const run=code=>win.webContents.executeJavaScript(code);
 const media=[{id:'audio',type:'audio',title:'Synthetic audio',path:'media/'+('long-path-'.repeat(12))+'.wav',personIds:['person']},{id:'document',type:'document',title:'Synthetic document',path:'media/'+('long-path-'.repeat(12))+'.txt',personIds:['person']}];
 const data={version:1,title:'Synthetic layout regression',rootPersonId:'person',people:[{id:'person',fullName:'Демонстрационный человек',bio:'Первый абзац.\n\nВторой абзац.\n\nТретий абзац.',mediaIds:['audio','document'],storyIds:['story']}],stories:[{id:'story',title:'Демонстрационная история',text:'Первый абзац истории.\n\nВторой абзац истории.',personIds:['person']}],media};
 await run(`localStorage.setItem('familyArchiveDraft',${JSON.stringify(JSON.stringify(data))});undefined`);
 // Use the same public browser save adapter as editor persistence, not a private state hook.
 await run(`FamilyArchive.saveArchive(${JSON.stringify(data)})`);await win.reload();
 for(let n=0;n<100;n++){if(await run(`!!document.querySelector('.story-card')`))break;await new Promise(r=>setTimeout(r,25));}
 const results=[];
 for(const width of [1100,480]){
  win.setSize(width,820);await new Promise(r=>setTimeout(r,100));
  const r=await run(`(()=>{let bio=document.querySelector('.detail-card section > p'),story=document.querySelector('.story-card > p:not(.meta)');return {width:innerWidth,bioWhitespace:getComputedStyle(bio).whiteSpace,storyWhitespace:getComputedStyle(story).whiteSpace,bioParagraphs:bio.textContent.split('\\n\\n').length,storyParagraphs:story.textContent.split('\\n\\n').length,media:[...document.querySelectorAll('.media-card')].map(e=>({scroll:e.scrollWidth,client:e.clientWidth,wrap:getComputedStyle(e).overflowWrap})),pageOverflow:document.documentElement.scrollWidth>innerWidth};})()`);
  assert.equal(r.width,width);assert.equal(r.bioWhitespace,'pre-wrap');assert.equal(r.storyWhitespace,'pre-wrap');assert.equal(r.bioParagraphs,3);assert.equal(r.storyParagraphs,2);assert.equal(r.pageOverflow,false);if(width===480)assert.equal(await run(`getComputedStyle(document.querySelector('.media-grid')).gridTemplateColumns.split(' ').length`),1);for(const m of r.media){assert.equal(m.wrap,'anywhere');assert.ok(m.scroll<=m.client);}results.push(r);
 }
 console.log(JSON.stringify({visualLayoutRegression:'passed',results}));
 }finally{if(win)win.destroy();if(temporary)await fs.rm(temporary,{recursive:true,force:true});}})().then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1);});
