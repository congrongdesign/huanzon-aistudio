/** Import visually reviewed, individually cropped font references without paid auto-analysis.
 * pnpm exec tsx scripts/import-curated-fonts.ts <manifest.json> <owner-id>
 * Reuses the application's media routing, atomic index updates and index lock.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { uploadFont, updateFont, changeFontGroup, setFontAnalysis, listFonts, fontFilePath } from '../src/lib/font-library-store';

type Curated = { number:number; file:string; title:string; sampleText:string; group:string; style:string; tags:string[]; description:string; prompt:string; sourceUrl:string; author:string; crop:number[] };
async function main() {
 const [manifestPath, owner] = process.argv.slice(2);
 if (!manifestPath || !owner) throw new Error('Usage: import-curated-fonts.ts <manifest.json> <owner-id>');
 const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {cards:Curated[]};
 // Validate every input before changing the user's library.
 for (const item of manifest.cards) {
  if (!item.sampleText || !item.description.includes(item.sourceUrl) || !item.author || item.crop.length!==4) throw new Error(`Incomplete card ${item.number}`);
  await fs.access(item.file);
 }
 const before=await listFonts(owner,new URLSearchParams());
 let groups=before.groups;
 const existing=[];
 for(let page=1;page<=Math.ceil(before.total/24);page++)existing.push(...(await listFonts(owner,new URLSearchParams({page:String(page)}))).cards);
 const results=[];
 for(const item of manifest.cards) {
  const duplicate=existing.find(c=>c.title===item.title&&c.description===item.description);
  if(duplicate){results.push({id:duplicate.id,title:item.title,duplicate:true});continue;}
  if(!groups.some(g=>g.name===item.group))groups=await changeFontGroup(owner,'create','',item.group);
  const bytes=await fs.readFile(item.file);
  const card=await uploadFont(owner,new File([new Uint8Array(bytes)],item.title+'.webp',{type:'image/webp'}),groups.find(g=>g.name===item.group)!.id);
  await updateFont(owner,card.id,{title:item.title,sampleText:item.sampleText,style:item.style,tags:item.tags,description:item.description,prompt:item.prompt,version:card.version});
  await setFontAnalysis(owner,card.id,{status:'completed',model:'manual-visual-curation',analyzedAt:new Date().toISOString()});
  await fs.access(fontFilePath(card.cover.key,owner));
  results.push({id:card.id,title:item.title,sourceUrl:item.sourceUrl,author:item.author,group:item.group,coverKey:card.cover.key});
  console.log(`Imported ${results.length}/${manifest.cards.length}: ${item.title}`);
 }
 const after=await listFonts(owner,new URLSearchParams());
 const report={before:before.total,after:after.total,added:results.filter(r=>!r.duplicate).length,groups:after.groups,results};
 const reportPath=path.join(path.dirname(manifestPath),'import-report.json');
 await fs.writeFile(reportPath,JSON.stringify(report,null,2));
 console.log(JSON.stringify({before:report.before,after:report.after,added:report.added,reportPath}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
