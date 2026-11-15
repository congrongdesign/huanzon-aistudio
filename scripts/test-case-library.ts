import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { uploadCaseImage,listCaseLibrary,updateCaseAssets,changeCaseFolder,migrateCase,caseLibraryDirectory } from '../src/lib/case-library-store';
import { collectStorageReferences } from '../src/lib/storage-lifecycle';
async function main(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'case-library-test-'));process.env.LOCAL_DATA_DIR=root;
 try{
 const bytes=await sharp({create:{width:360,height:240,channels:3,background:'#A22'}}).png().toBuffer();const file=new File([new Uint8Array(bytes)],'高质量海报.png');const owner='case-qa';
 const first=await uploadCaseImage(owner,file);assert.equal(first.duplicate,false);assert.equal(first.item.width,360);assert.equal(first.item.height,240);
 const folders=await changeCaseFolder(owner,'create-folder','','海报设计');
 const repeated=await Promise.all(Array.from({length:6},()=>uploadCaseImage(owner,file,[folders[0].id])));assert.ok(repeated.every(r=>r.duplicate));assert.equal((await listCaseLibrary(owner,new URLSearchParams())).total,1);
 assert.equal((await listCaseLibrary('other-owner',new URLSearchParams())).total,0);
 await updateCaseAssets(owner,[first.item.id],{tags:['运动','科技'],note:'黑底大字',favorite:true});
 const found=await listCaseLibrary(owner,new URLSearchParams({q:'运动 黑底',folder:folders[0].id,filter:'favorites',ratio:'wide'}));assert.equal(found.total,1);
 await assert.rejects(()=>updateCaseAssets(owner,[first.item.id],{folderIds:['missing']}));
 await changeCaseFolder(owner,'delete-folder',folders[0].id,'');assert.equal((await listCaseLibrary(owner,new URLSearchParams({filter:'unfiled'}))).total,1);
 await updateCaseAssets(owner,[first.item.id],{action:'delete'});assert.equal((await listCaseLibrary(owner,new URLSearchParams())).total,0);assert.equal((await listCaseLibrary(owner,new URLSearchParams({filter:'trash'}))).total,1);
 assert.ok(collectStorageReferences().used(first.item.key));
 await updateCaseAssets(owner,[first.item.id],{action:'restore'});await updateCaseAssets(owner,[first.item.id],{action:'used'});assert.equal((await listCaseLibrary(owner,new URLSearchParams({filter:'recent'}))).total,1);
 await assert.rejects(()=>uploadCaseImage(owner,new File(['invalid'],'invalid.png')));
 const legacy={id:'old',category:'品牌',title:'旧案例',description:'旧资料',prompt:'旧提示词',aspectRatio:'16:9',count:1,coverImage:'data:image/png;base64,'+bytes.toString('base64')};
 assert.equal((await migrateCase(owner,'old:1',legacy)).imported,1);assert.equal((await migrateCase(owner,'old:1',legacy)).skipped,true);assert.equal((await listCaseLibrary(owner,new URLSearchParams())).total,1);
 const indexPath=path.join(caseLibraryDirectory(owner),'index.json');const index=JSON.parse(await fs.readFile(indexPath,'utf8'));index.items=Array.from({length:1000},(_,n)=>({...first.item,id:`bench-${n}`}));await fs.writeFile(indexPath,JSON.stringify(index));
 const paged=await listCaseLibrary(owner,new URLSearchParams({page:'2'}));assert.equal(paged.total,1000);assert.equal(paged.items.length,48);
 await fs.writeFile(indexPath,'invalid');await assert.rejects(()=>listCaseLibrary(owner,new URLSearchParams()),/无法读取/);
 console.log('PASS: validation, original preservation, concurrent deduplication, ownership, compound search, classification, soft delete/restore, GC protection, recent use, migration idempotence, pagination, corrupt-index protection');
 }finally{await fs.rm(root,{recursive:true,force:true});}
}void main();
