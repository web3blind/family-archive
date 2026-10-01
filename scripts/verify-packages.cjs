'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const asar=require('@electron/asar');
const root=path.resolve(__dirname,'..');
const files=['index.html','edit.html',...fs.readdirSync(path.join(root,'desktop')).filter(x=>x.endsWith('.cjs')).map(x=>'desktop/'+x)];
function walk(dir){for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true}))e.isDirectory()?walk(dir+'/'+e.name):files.push(dir+'/'+e.name);}
walk('assets');
for(const archive of process.argv.slice(2)){
 for(const file of files)assert.ok(asar.extractFile(archive,file).equals(fs.readFileSync(path.join(root,file))),archive+': stale '+file);
 const meta=JSON.parse(asar.extractFile(archive,'package.json'));
 assert.equal(meta.version,JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version);
 console.log(path.basename(path.dirname(archive))+': '+files.length+' runtime files match current sources, version '+meta.version);
}
