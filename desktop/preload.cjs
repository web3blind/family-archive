'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const invoke=(method,...args)=>ipcRenderer.invoke(`family:${method}`,...args);
contextBridge.exposeInMainWorld('FamilyArchiveNative',Object.freeze({
 platform:'desktop',
 readArchive:()=>invoke('read'),
 writeArchive:archive=>invoke('write',archive),
 pickMedia:()=>invoke('pick-media'),
 openMedia:relative=>invoke('open-media',relative),
 mediaUrl:relative=>`family://app/${String(relative).split('/').map(encodeURIComponent).join('/')}`,
 openArchive:()=>invoke('open'),
 importArchive:()=>invoke('import'),
 exportArchive:()=>invoke('export')
}));
