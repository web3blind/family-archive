'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const { Transform } = require('node:stream');
const yauzl = require('yauzl');
const yazl = require('yazl');
const core = require('../assets/js/archive-core.js');
const MAX_JSON = 16 * 1024 * 1024;
const MAX_FILE = 512 * 1024 * 1024;
const MAX_TOTAL = 1024 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const extensions = {
 photo: ['jpg','jpeg','png','gif','webp','avif','bmp','svg','heic','heif'],
 audio: ['mp3','m4a','wav','ogg','opus','flac','aac'],
 video: ['mp4','webm','mov','mkv','m4v','avi'],
 document: ['pdf','txt','md','rtf','doc','docx','odt','xls','xlsx','ppt','pptx','csv']
};
function mediaType(name) { const ext=path.extname(name).slice(1).toLowerCase(); return Object.keys(extensions).find(type=>extensions[type].includes(ext)) || null; }
function validateMediaPath(value) {
 if(!core.validMediaPath(value) || !mediaType(value)) throw new Error('Недопустимый путь или тип медиафайла.');
 return value;
}
function archiveValue(value) {
 if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Неверный формат семейного архива.');
 const result=core.parseArchiveJson(JSON.stringify(value));
 for(const item of result.media) validateMediaPath(item.path);
 return result;
}
async function regularFile(file) { const stat=await fs.lstat(file); if(!stat.isFile() || stat.isSymbolicLink()) throw new Error('Ссылки и специальные файлы не поддерживаются.'); return stat; }
async function safeRoot(root,create=false) {
 if(create) await fs.mkdir(root,{recursive:true});
 const stat=await fs.lstat(root); if(!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Выберите обычную папку архива.');
 return fs.realpath(root);
}
async function syncDirectory(dir) {
 if(process.platform==='win32')return; // Windows does not expose directory fsync through Node.
 const handle=await fs.open(dir,'r');try{await handle.sync();}finally{await handle.close();}
}
async function atomicWrite(file,contents) {
 const temp=`${file}.${crypto.randomUUID()}.tmp`; let handle;
 try { handle=await fs.open(temp,'wx',0o600); await handle.writeFile(contents); await handle.sync(); await handle.close(); handle=null; await fs.rename(temp,file); await syncDirectory(path.dirname(file)); }
 finally { if(handle) await handle.close().catch(()=>{}); await fs.unlink(temp).catch(()=>{}); }
}
function limiter(limit,onBytes=()=>{}) { let bytes=0; return new Transform({transform(chunk,enc,cb){ bytes+=chunk.length; if(bytes>limit) return cb(new Error('Файл слишком большой.')); try {onBytes(chunk.length); cb(null,chunk);} catch(error){cb(error);} }}); }
async function copyBounded(source,target,limit=MAX_FILE,onBytes=()=>{}) {
 const flags=require('node:fs').constants;
 const handle=await fs.open(source,flags.O_RDONLY|(flags.O_NOFOLLOW||0));
 try {
  const stat=await handle.stat();if(!stat.isFile()||stat.size>limit)throw new Error('Медиафайл превышает допустимый размер.');
  await pipeline(handle.createReadStream({autoClose:false}),limiter(limit,onBytes),createWriteStream(target,{flags:'wx',mode:0o600}));
  const output=await fs.open(target,'r+');try{await output.sync();}finally{await output.close();}
 }finally{await handle.close();}
}
class ArchiveStore {
 constructor(root) { this.root=path.resolve(root); }
 async readArchive() {
  await safeRoot(this.root,true); const file=path.join(this.root,'archive.json');
  try { const st=await regularFile(file); if(st.size>MAX_JSON) throw new Error('JSON архива слишком большой.'); return archiveValue(JSON.parse(await fs.readFile(file,'utf8'))); }
  catch(error) { if(error.code==='ENOENT') return null; throw error; }
 }
 async writeArchive(value) {
  const archive=archiveValue(value); const text=JSON.stringify(archive,null,2); if(Buffer.byteLength(text)>MAX_JSON) throw new Error('JSON архива слишком большой.');
  await safeRoot(this.root,true); await this.checkMedia(archive); const file=path.join(this.root,'archive.json');
  try { await regularFile(file); const previous=await fs.readFile(file); await atomicWrite(path.join(this.root,'archive.json.bak'),previous); } catch(error){ if(error.code!=='ENOENT') throw error; }
  await atomicWrite(file,text); return archive;
 }
 async resolveMedia(relative) {
  validateMediaPath(relative); const root=await safeRoot(this.root); const media=path.join(root,'media');
  const dirStat=await fs.lstat(media); if(!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error('Недопустимая папка media.');
  const file=path.join(root,relative);
  let current=root;
  for(const segment of relative.split('/').slice(0,-1)) {
   current=path.join(current,segment); const st=await fs.lstat(current);
   if(!st.isDirectory() || st.isSymbolicLink()) throw new Error('Недопустимая папка медиа.');
  }
  await regularFile(file); const real=await fs.realpath(file);
  if(!real.startsWith(media+path.sep)) throw new Error('Медиа вне папки архива.'); return real;
 }
 async checkMedia(archive) { for(const item of archive.media) await this.resolveMedia(item.path); }
 async addMedia(source) {
  const st=await regularFile(source); if(st.size>MAX_FILE) throw new Error('Медиафайл превышает 512 МБ.');
  const type=mediaType(source); if(!type) throw new Error('Этот тип файла не поддерживается.');
  await safeRoot(this.root,true); const dir=path.join(this.root,'media'); await fs.mkdir(dir,{recursive:true});
  const ds=await fs.lstat(dir); if(!ds.isDirectory() || ds.isSymbolicLink()) throw new Error('Недопустимая папка media.');
  const base=path.basename(source).replace(/[^\p{L}\p{N} _.,()\-]/gu,'_').replace(/\.{2,}/g,'_').slice(-130);
  const ext=path.extname(base), stem=path.basename(base,ext).replace(/^[.]+/,'')||'file';
  let name=`${stem}-${crypto.randomUUID().slice(0,12)}${ext}`;
  const temp=path.join(dir,`.${crypto.randomUUID()}.tmp`),target=path.join(dir,name);
  try { await copyBounded(source,temp); await fs.rename(temp,target); await syncDirectory(dir); }
  finally {await fs.unlink(temp).catch(()=>{});}
  return {path:`media/${name}`,type,title:path.basename(source,path.extname(source))};
 }
 async listMedia(initialBytes=0) {
  const files=[];let total=initialBytes;
  const walk=async relative=>{
   const directory=path.join(this.root,relative);
   let entries;try{const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Недопустимая папка медиа.');entries=await fs.readdir(directory,{withFileTypes:true});}
   catch(error){if(error.code==='ENOENT'&&relative==='media')return;throw error;}
   for(const entry of entries){
    if(entry.name==='.gitkeep'||/^\.[a-f0-9-]+\.tmp$/.test(entry.name))continue;
    const name=relative+'/'+entry.name;
    if(entry.isSymbolicLink())throw new Error('Ссылки в media не поддерживаются.');
    if(entry.isDirectory()){if(!core.validMediaPath(name))throw new Error('Небезопасная папка медиа.');await walk(name);}
    else{const resolved=await this.resolveMedia(name),stat=await regularFile(resolved);total+=stat.size;if(stat.size>MAX_FILE||total>MAX_TOTAL||files.length>=MAX_ENTRIES-1)throw new Error('Архив превышает допустимый размер.');files.push(name);}
   }
  };await walk('media');return files;
 }
 async exportZip(destination) {
  destination=path.resolve(destination);
  if(path.extname(destination).toLowerCase()!=='.zip') throw new Error('Полную копию нужно сохранить как ZIP.');
  const archive=await this.readArchive(); if(!archive) throw new Error('Сначала сохраните архив.'); await this.checkMedia(archive);
  const json=Buffer.from(JSON.stringify(archive,null,2)); if(json.length>MAX_JSON)throw new Error('JSON архива слишком большой.');
  const media=await this.listMedia(json.length);
  const zip=new yazl.ZipFile(); zip.on('error',error=>zip.outputStream.destroy(error)); zip.addBuffer(json,'archive.json');
  for(const relative of media) zip.addFile(await this.resolveMedia(relative),relative);
  const tmp=`${destination}.${crypto.randomUUID()}.tmp`;
  try { const done=pipeline(zip.outputStream,createWriteStream(tmp,{flags:'wx',mode:0o600})); zip.end(); await done; const handle=await fs.open(tmp,'r+'); try{await handle.sync();}finally{await handle.close();} await fs.rename(tmp,destination); }
  finally{await fs.unlink(tmp).catch(()=>{});} return {saved:true};
 }
 static async importZip(source,importsRoot) {
  await regularFile(source); await safeRoot(importsRoot,true); const root=path.join(importsRoot,crypto.randomUUID()); await fs.mkdir(root,{mode:0o700});
  const store=new ArchiveStore(root); let zip,total=0,count=0; const seen=new Set();
  try {
   zip=await new Promise((resolve,reject)=>yauzl.open(source,{lazyEntries:true,validateEntrySizes:true},(e,z)=>e?reject(e):resolve(z)));
   await new Promise((resolve,reject)=>{
    zip.on('error',reject); zip.on('end',resolve);
    zip.on('entry',entry=>{ (async()=>{
     if(++count>MAX_ENTRIES) throw new Error('Слишком много файлов в ZIP.');
     const name=entry.fileName;
     if(name.endsWith('/')) {if(name!=='media/' && !core.validMediaPath(name.slice(0,-1))) throw new Error('Недопустимая папка ZIP.'); zip.readEntry();return;}
     if(name!=='archive.json') validateMediaPath(name);
     if(seen.has(name)) throw new Error('Повторяющийся файл в ZIP.'); seen.add(name);
     const mode=(entry.externalFileAttributes>>>16)&0xffff;
     if((mode&0xf000)===0xa000 || entry.generalPurposeBitFlag&1) throw new Error('Зашифрованные файлы и ссылки не поддерживаются.');
     const limit=name==='archive.json'?MAX_JSON:MAX_FILE;
     if(entry.uncompressedSize>limit || total+entry.uncompressedSize>MAX_TOTAL) throw new Error('ZIP превышает допустимый размер.');
     const target=path.join(root,name); await fs.mkdir(path.dirname(target),{recursive:true});
     const stream=await new Promise((res,rej)=>zip.openReadStream(entry,(e,s)=>e?rej(e):res(s)));
     await pipeline(stream,limiter(limit,bytes=>{total+=bytes;if(total>MAX_TOTAL)throw new Error('ZIP слишком большой.');}),createWriteStream(target,{flags:'wx',mode:0o600}));
     zip.readEntry();
    })().catch(reject); }); zip.readEntry();
   });
   const archive=await store.readArchive(); if(!archive) throw new Error('В ZIP отсутствует archive.json.'); await store.checkMedia(archive); return store;
  }catch(error){if(zip)zip.close();await fs.rm(root,{recursive:true,force:true});throw error;}
 }
 static async importJson(source,importsRoot) {
  const st=await regularFile(source); if(st.size>MAX_JSON)throw new Error('JSON слишком большой.');
  const archive=archiveValue(JSON.parse(await fs.readFile(source,'utf8')));
  const from=new ArchiveStore(path.dirname(source)); await from.checkMedia(archive);
  await safeRoot(importsRoot,true); const root=path.join(importsRoot,crypto.randomUUID()); const store=new ArchiveStore(root);
  let total=0;
  try {
   await fs.mkdir(path.join(root,'media'),{recursive:true});
   const files=new Set(archive.media.map(x=>x.path));if(files.size>=MAX_ENTRIES)throw new Error('Слишком много файлов.');
   for(const relative of files) {await fs.mkdir(path.dirname(path.join(root,relative)),{recursive:true});await copyBounded(await from.resolveMedia(relative),path.join(root,relative),MAX_FILE,bytes=>{total+=bytes;if(total>MAX_TOTAL)throw new Error('Медиа превышают 1 ГБ.');});}
   await store.writeArchive(archive); return store;
  }
  catch(error){await fs.rm(root,{recursive:true,force:true});throw error;}
 }
}
module.exports={ArchiveStore,validateMediaPath,mediaType,atomicWrite,copyBounded,MAX_JSON};
