'use strict';
// Bootstrap runs before Electron opens Chromium databases. Legacy data is never modified.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const core=require('../assets/js/archive-core.js');
const {ArchiveStore,validateMediaPath,MAX_JSON}=require('./store.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const empty={version:1,title:'Семейный архив',rootPersonId:null,people:[],stories:[],media:[]};
function portableDataPath({packaged,platform=process.platform,executable=process.execPath,codeRoot,override}){
 if(override)return path.resolve(override);
 if(!packaged)return path.join(codeRoot,'data');
 const p=platform==='win32'?path.win32:path.posix;
 if(platform==='darwin'){
  let dir=p.dirname(executable);while(dir!==p.dirname(dir)&&!dir.endsWith('.app'))dir=p.dirname(dir);
  if(!dir.endsWith('.app'))throw new Error('Не найдена папка .app.');
  return p.join(p.dirname(dir),'data');
 }
 return p.join(p.dirname(executable),'data');
}
function safe(file){
 const absolute=path.resolve(file);let current=path.parse(absolute).root;
 for(const part of absolute.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);const s=fs.lstatSync(current);
  if(s.isSymbolicLink())throw new Error(`Небезопасная ссылка: ${current}`);
 }
 return fs.lstatSync(absolute);
}
function exists(file){try{safe(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function mkdir(dir){if(!exists(dir))fs.mkdirSync(dir,{recursive:true,mode:0o700});if(!safe(dir).isDirectory())throw new Error(`Не папка: ${dir}`);}
function syncDir(dir){if(process.platform==='win32')return;const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function write(file,bytes){const temp=file+'.'+crypto.randomUUID()+'.tmp';try{const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);syncDir(path.dirname(file));}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
function json(file){const stat=safe(file);if(!stat.isFile()||stat.size>MAX_JSON)throw new Error(`Неверный JSON: ${file}`);return JSON.parse(fs.readFileSync(file,'utf8'));}
function digest(file){const h=crypto.createHash('sha256'),buf=Buffer.alloc(1024*1024),fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null)))h.update(buf.subarray(0,n));return h.digest('hex');}finally{fs.closeSync(fd);}}
function inventory(root){const result={};const walk=(dir,rel,depth)=>{if(depth>64)throw new Error('Слишком глубокая папка профиля.');const st=safe(dir);if(!st.isDirectory())throw new Error(`Не папка: ${dir}`);for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),relative=rel?rel+'/'+name:name,s=safe(file);if(s.isDirectory()){result[relative+'/']='directory';walk(file,relative,depth+1);}else if(s.isFile())result[relative]={size:s.size,sha256:digest(file)};else throw new Error(`Специальный файл: ${file}`);}};walk(root,'',0);return result;}
function copyVerified(source,target){rejectNestedDestination(target,source);const before=inventory(source);mkdir(target);for(const [rel,meta]of Object.entries(before)){const file=path.join(target,rel);if(meta==='directory'){mkdir(file);continue;}mkdir(path.dirname(file));fs.copyFileSync(path.join(source,rel),file,fs.constants.COPYFILE_EXCL);fs.chmodSync(file,0o600);const fd=fs.openSync(file,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 if(JSON.stringify(before)!==JSON.stringify(inventory(target))||JSON.stringify(before)!==JSON.stringify(inventory(source)))throw new Error('Исходные файлы изменились во время копирования. Закройте старую версию и повторите.');
 for(const rel of Object.keys(before).filter(r=>r.endsWith('/')).reverse())syncDir(path.join(target,rel));syncDir(target);return before;
}
function validateArchive(root){if(!safe(root).isDirectory())throw new Error('Не папка архива.');const raw=json(path.join(root,'archive.json'));if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Неверный архив.');const archive=core.parseArchiveJson(JSON.stringify(raw));for(const media of archive.media){validateMediaPath(media.path);const f=path.join(root,media.path);if(!safe(f).isFile())throw new Error(`Отсутствует медиа: ${media.path}`);}return archive;}
function identity(root,{legacyRoot,reset=false,dataRoot,slot}={}){
 const marker=path.join(root,'.family-archive-identity');let uuid;
 if(!reset&&exists(marker)){uuid=fs.readFileSync(marker,'utf8');if(!UUID.test(uuid))throw new Error('Неверный идентификатор архива.');}else{uuid=crypto.randomUUID();write(marker,uuid);}
 const portable=path.join(root,'.family-portable-identity');
 const location=slot||(dataRoot?path.relative(dataRoot,root).split(path.sep).join('/'):null);
 if(reset||legacyRoot||!exists(portable))write(portable,JSON.stringify({uuid,slot:location,identity:crypto.createHash('sha256').update(legacyRoot||root).update('\0').update(uuid).digest('hex')}));
 const value=json(portable);if(value.uuid!==uuid||(dataRoot&&value.slot!==location)||!/^[a-f0-9]{64}$/.test(value.identity))throw new Error('Неверный переносимый идентификатор, папка или поколение архива.');return value.identity;
}
function selectedRoot(data){const cfg=json(path.join(data,'selected-archive.json'));if(typeof cfg.root!=='string'||!cfg.root)throw new Error('Неверная выбранная папка архива.');const root=path.resolve(data,cfg.root);if(root===data||!root.startsWith(data+path.sep))throw new Error('Выбранный архив вне data. Импортируйте его копию в переносимую папку.');safe(root);return root;}
function select(data,root){const relative=path.relative(data,root);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Архив должен находиться внутри data.');write(path.join(data,'selected-archive.json'),JSON.stringify({root:relative.split(path.sep).join('/')}));}
function ensure(data){
 const probe=path.join(data,'.write-probe-'+crypto.randomUUID());const fd=fs.openSync(probe,'wx',0o600);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);fs.unlinkSync(probe);}
 mkdir(path.join(data,'session'));mkdir(path.join(data,'imports'));const root=selectedRoot(data);validateArchive(root);mkdir(path.join(root,'media'));identity(root,{dataRoot:data});
 // Do not rewrite normal selection during a second-instance startup.
 if(path.isAbsolute(json(path.join(data,'selected-archive.json')).root))select(data,root);
}
function rejectNestedDestination(destination,source){
 const parent=path.resolve(destination),from=path.resolve(source);
 if(parent===from||parent.startsWith(from+path.sep))throw new Error('Папки назначения и исходного архива пересекаются. Переместите приложение вне старого архива.');
}
function preparePortable({data,legacy}){
 data=path.resolve(data);
 // Reject nesting before creating any directories in a protected old source.
 if(!exists(data)&&legacy&&exists(legacy)){
  rejectNestedDestination(path.dirname(data),legacy);
  const cfg=path.join(legacy,'selected-archive.json');
  if(exists(cfg)){const value=json(cfg);if(typeof value.root!=='string'||!value.root)throw new Error('Неверная выбранная папка старого архива.');rejectNestedDestination(path.dirname(data),path.resolve(legacy,value.root));}
 }
 mkdir(path.dirname(data));const lock=data+'.bootstrap-lock';safe(path.dirname(lock));let fd;
 try{fd=fs.openSync(lock,'wx',0o600);}catch(e){if(e.code!=='EEXIST')throw e;const value=json(lock);if(!Number.isInteger(value.pid)||value.pid<=0)throw new Error('Неверная блокировка запуска.');try{process.kill(value.pid,0);throw new Error('Приложение уже запущено (bootstrap running).');}catch(err){if(err.code!=='ESRCH')throw err;}fs.unlinkSync(lock);fd=fs.openSync(lock,'wx',0o600);}
 fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));fs.fsyncSync(fd);fs.closeSync(fd);
 let stage;
 try{
  if(exists(data)){ensure(data);return data;}
  stage=data+'.stage-'+crypto.randomUUID();mkdir(stage);let source,legacyDraftOnly=false,manifest=null;
  if(legacy&&path.resolve(legacy)!==data&&exists(legacy)){
   for(const f of ['SingletonLock','SingletonCookie','SingletonSocket'])if(fs.existsSync(path.join(legacy,f))||fs.readdirSync(legacy).includes(f))throw new Error('Закройте старую версию приложения. Обнаружена блокировка старого профиля.');
   const cfg=path.join(legacy,'selected-archive.json');
   if(exists(cfg)){const value=json(cfg);if(typeof value.root!=='string'||!value.root)throw new Error('Неверная выбранная папка старого архива.');source=path.resolve(legacy,value.root);validateArchive(source);}
   else if(exists(path.join(legacy,'archive'))){
    source=path.join(legacy,'archive');
    if(exists(path.join(source,'archive.json')))validateArchive(source);
    else{
     // Previous desktop protocol returns 404 for bundled archive.json. With no
     // canonical file the native core therefore used its exact empty fallback,
     // not browser localStorage or the demo archive. Only that known draft-only
     // state is recoverable; a backup indicates lost saved data, not a fresh base.
     if(exists(path.join(source,'archive.json.bak')))throw new Error('Отсутствует archive.json, но найден archive.json.bak. Восстановите архив из резервной копии в старой версии перед миграцией.');
     if(!exists(path.join(source,'.family-archive-identity')))throw new Error('Старый архив без archive.json и идентификатора требует ручного восстановления.');
     legacyDraftOnly=true;
    }
   }
   mkdir(path.join(stage,'legacy-backup'));manifest=copyVerified(legacy,path.join(stage,'legacy-backup/profile'));copyVerified(path.join(stage,'legacy-backup/profile'),path.join(stage,'working-profile'));
   // Move the verified working profile contents into the staged userData root.
   for(const name of fs.readdirSync(path.join(stage,'working-profile')))fs.renameSync(path.join(stage,'working-profile',name),path.join(stage,name));fs.rmdirSync(path.join(stage,'working-profile'));
   // Old Electron used userData itself as sessionData. Copy that complete
   // verified profile into the new dedicated sessionData, including LevelDB/WAL.
   if(exists(path.join(stage,'session')))fs.rmSync(path.join(stage,'session'),{recursive:true});
   copyVerified(path.join(stage,'legacy-backup/profile'),path.join(stage,'session'));
   if(source){copyVerified(source,path.join(stage,'legacy-backup/selected-archive'));}
  }
  // Reuse the verified in-profile selection; do not manufacture duplicate
  // archives with the same draft identity. External selections are copied in.
  const relative=source&&legacy?path.relative(legacy,source):null;
  const inProfile=relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);
  const active=inProfile?relative:(exists(path.join(stage,'archive'))?'portable-archive':'archive');const root=path.join(stage,active);
  if(source){if(!inProfile)copyVerified(path.join(stage,'legacy-backup/selected-archive'),root);if(legacyDraftOnly)write(path.join(root,'archive.json'),JSON.stringify(empty,null,2));validateArchive(root);identity(root,{legacyRoot:fs.realpathSync(source),dataRoot:stage});}
  else{mkdir(root);write(path.join(root,'archive.json'),JSON.stringify(empty,null,2));identity(root,{dataRoot:stage});}
  const skippedLegacyArchives=[];
  if(legacy&&manifest){
   const candidates=['archive'];const imports=path.join(stage,'imports');
   if(exists(imports))for(const name of fs.readdirSync(imports))if(safe(path.join(imports,name)).isDirectory())candidates.push(path.join('imports',name));
   for(const rel of candidates){const folder=path.join(stage,rel);if(folder===root||!exists(path.join(folder,'archive.json')))continue;
    try{validateArchive(folder);identity(folder,{legacyRoot:fs.realpathSync(path.join(legacy,rel)),dataRoot:stage});}
    catch(error){skippedLegacyArchives.push({root:rel,error:error.message});}
   }
  }
  mkdir(path.join(root,'media'));select(stage,root);ensure(stage);
  if(legacy&&manifest&&JSON.stringify(manifest)!==JSON.stringify(inventory(legacy)))throw new Error('Старый профиль изменился; закройте старую версию и повторите.');
  write(path.join(stage,'portable-migration.json'),JSON.stringify({version:1,legacy:legacy||null,profileManifest:manifest,selectedSource:source||null,skippedLegacyArchives}));syncDir(stage);
  // Bootstrap lock serializes publication. Never merge into an existing target.
  if(exists(data))throw new Error('Папка data появилась во время миграции. Повторите запуск.');fs.renameSync(stage,data);stage=null;syncDir(path.dirname(data));return data;
 }catch(error){throw new Error(`Не удалось подготовить переносимые данные в ${data}: ${error.message}. Исходные данные не удалены.`);}
 finally{if(stage)fs.rmSync(stage,{recursive:true,force:true});fs.unlinkSync(lock);}
}
function copyArchive(source,imports){
 validateArchive(source);mkdir(imports);
 const dataRoot=path.dirname(imports),stage=path.join(imports,'.stage-'+crypto.randomUUID()),dest=path.join(imports,crypto.randomUUID());
 try{
  copyVerified(source,stage);validateArchive(stage);
  identity(stage,{reset:true,dataRoot,slot:path.relative(dataRoot,dest).split(path.sep).join('/')});
  mkdir(path.join(stage,'media'));fs.renameSync(stage,dest);syncDir(imports);
  return new ArchiveStore(dest,{portable:true,dataRoot});
 }finally{if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});}
}
module.exports={portableDataPath,preparePortable,selectedRoot,select,copyArchive,identity};
