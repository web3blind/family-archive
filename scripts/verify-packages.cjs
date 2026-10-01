'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const asar=require('@electron/asar');
const root=path.resolve(__dirname,'..');
const files=['index.html','edit.html',...fs.readdirSync(path.join(root,'desktop')).filter(x=>x.endsWith('.cjs')).map(x=>'desktop/'+x)];
function walk(dir){for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true}))e.isDirectory()?walk(dir+'/'+e.name):files.push(dir+'/'+e.name);}
walk('assets');
for(const archive of process.argv.slice(2)){
 const entries=asar.listPackage(archive);
 assert.ok(!entries.some(file=>file.includes('/node_modules/@capacitor/')),archive+': Android dependencies leaked into desktop package');
 const unpacked=archive+'.unpacked';
 function checkUnpacked(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);
  assert.ok(!file.includes('@capacitor')&&!file.endsWith('.class'),file+': Android build artifact');
  if(entry.isDirectory())checkUnpacked(file);
 }}
 if(fs.existsSync(unpacked))checkUnpacked(unpacked);
 for(const file of files)assert.ok(asar.extractFile(archive,file).equals(fs.readFileSync(path.join(root,file))),archive+': stale '+file);
 const meta=JSON.parse(asar.extractFile(archive,'package.json'));
 assert.equal(meta.version,JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version);
 console.log(path.basename(path.dirname(archive))+': '+files.length+' runtime files match current sources, version '+meta.version);
}
