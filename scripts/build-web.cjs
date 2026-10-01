'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
async function main(){
 const root=path.resolve(__dirname,'..'),out=path.join(root,'www');
 await fs.mkdir(out,{recursive:true});
 for(const name of ['index.html','edit.html'])await fs.copyFile(path.join(root,name),path.join(out,name));
 await fs.cp(path.join(root,'assets'),path.join(out,'assets'),{recursive:true});
 // Distribution never includes the user's working archive or family media.
 await fs.writeFile(path.join(out,'archive.json'),JSON.stringify({version:1,title:'Семейный архив',rootPersonId:null,people:[],stories:[],media:[]},null,2));
 console.log('Web assets prepared without personal data: '+out);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
