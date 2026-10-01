'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const invoke=(method,...args)=>ipcRenderer.invoke(`family:${method}`,...args);
contextBridge.exposeInMainWorld('FamilyArchiveNative',Object.freeze({
 platform:'desktop',
 archiveIdentity:()=>invoke('archive-identity'),
 readArchive:()=>invoke('read'),
 writeArchive:archive=>invoke('write',archive),
 pickMedia:()=>invoke('pick-media'),
 pickMediaBatch:(options={})=>invoke('pick-media-batch',{folder:options.folder===true}),
 openMedia:relative=>invoke('open-media',relative),
 mediaUrl:relative=>`family://app/${String(relative).split('/').map(encodeURIComponent).join('/')}`,
 openArchive:()=>invoke('open'),
 importArchive:()=>invoke('import'),
 exportArchive:()=>invoke('export')
}));
