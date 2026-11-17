import assert from 'node:assert/strict';
import { arrangeCanvasFamilies } from '../src/lib/canvas-arrangement';
import { routedCanvasConnectionGeometry } from '../src/lib/canvas-lineage';
import { saveReferenceLayouts, restoreReferenceLayouts } from '../src/lib/canvas-reference-layouts';
import type { CanvasImage } from '../src/lib/types';

const image = (id:string, refs:string[] = [], index = 1, w=480, h=270):CanvasImage => ({id,project_id:'qa',image_url:`/qa/${id}`,reference_images:JSON.stringify(refs),canvas_x:index*137,canvas_y:index*-91,canvas_width:w,canvas_height:h,prompt:'test',size:'16:9',model:'test',status:'completed',is_favorite:false,image_key:null,created_at:new Date(index).toISOString(),updated_at:null});
const root=image('ref',[],0,240,135), children=Array.from({length:8},(_,i)=>image(`result-${i}`,[root.image_url],i+1)), edit=image('edit',[children[6].image_url],10);
const all=[root,...children,edit];
const size=(i:CanvasImage)=>({w:i.canvas_width,h:i.canvas_height});
const arrange=(items:CanvasImage[])=>arrangeCanvasFamilies(items,{getSize:size,origin:{x:40,y:80},batchFor:i=>i.id.startsWith('result')?{batchId:'batch',index:Number(i.id.split('-')[1])}:undefined});
const positions=arrange(all);
assert.ok(new Set(children.map(i=>positions.get(i.id)!.x)).size>=2);
assert.equal(new Set(children.map(i=>positions.get(i.id)!.y)).size,2);
assert.ok(positions.get(root.id)!.x<positions.get(children[0].id)!.x);
assert.equal(positions.get(edit.id)!.x-(positions.get(children[6].id)!.x+children[6].canvas_width),32,"edit stays beside its actual source");
assert.equal(positions.get(edit.id)!.y,positions.get(children[6].id)!.y);
assert.ok(Math.abs(positions.get(root.id)!.y+root.canvas_height/2-(positions.get(children[0].id)!.y+positions.get(children[6].id)!.y+children[6].canvas_height)/2)<=0.5);
const overlap=(a:CanvasImage,b:CanvasImage)=>{const p=positions.get(a.id)!,q=positions.get(b.id)!;return p.x<q.x+b.canvas_width&&p.x+a.canvas_width>q.x&&p.y<q.y+b.canvas_height&&p.y+a.canvas_height>q.y;};
for(let a=0;a<all.length;a++)for(let b=a+1;b<all.length;b++)assert.ok(!overlap(all[a],all[b]),`${all[a].id}/${all[b].id} overlap`);
assert.deepEqual(arrange([...all].reverse()),positions,'input ordering must not change layout');
assert.deepEqual(arrange(all.map(i=>({...i,canvas_x:positions.get(i.id)!.x,canvas_y:positions.get(i.id)!.y}))),positions,'arrangement must be repeatable');
const cycle=[image('a',['b']),image('b',['a']),image('multi',['a','b'])];
assert.equal(arrange(cycle).size,3);
assert.equal(arrange([image('broken',['missing']),{...image('bad'),reference_images:'{bad'}]).size,2);
const pending={...image('pending',[root.image_url],11),image_url:'',isGenerating:true};
assert.equal(arrange([...all,pending]).size,11);
const history=Array.from({length:1000},(_,i)=>image(`history-${i}`,i?[`/qa/history-${i-1}`]:[],i));
const start=performance.now();assert.equal(arrange(history).size,1000);console.log(`1000-image arrangement: ${Math.round(performance.now()-start)}ms`);
const source={x:0,y:200,width:240,height:135},target={x:1000,y:0,width:480,height:270},obstacle={x:420,y:0,width:480,height:270};
const route=routedCanvasConnectionGeometry(source,target,[source,target,obstacle]);
assert.match(route.d,/ L /,'blocked route must use gutters');
assert.ok(!/NaN|Infinity/.test(route.d));
const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { value: { getItem:(key:string)=>memory.get(key)||null, setItem:(key:string,value:string)=>memory.set(key,value) }, configurable:true });
const arrangedRef = { ...root, ...positions.get(root.id)!, canvas_x:positions.get(root.id)!.x,canvas_y:positions.get(root.id)!.y,is_reference:true };
saveReferenceLayouts('qa',[arrangedRef]);
const restored = restoreReferenceLayouts([{...root, is_reference:true}])[0];
assert.equal(restored.canvas_x,arrangedRef.canvas_x);assert.equal(restored.canvas_y,arrangedRef.canvas_y);
assert.equal(restoreReferenceLayouts([{...root,project_id:'other'}])[0].canvas_x,root.canvas_x);
console.log('PASS: source + four-column batch rows + aligned edits, no overlaps, stable sort/repeat, cycles/multi-reference/missing refs, pending, 1000 images and gutter routing.');

for (const count of [12, 48, 100, 300, 1000]) {
  const siblings = Array.from({length:count}, (_,i)=>image(`sibling-${i}`,[root.image_url],i+1,i%3===0?270:480,i%3===0?480:270));
  const collection = [root,...siblings], result = arrange(collection);
  const width = Math.max(...collection.map(i=>result.get(i.id)!.x+i.canvas_width))-40;
  const height = Math.max(...collection.map(i=>result.get(i.id)!.y+i.canvas_height))-80;
  assert.ok(width/height > 0.55 && width/height < 3.5, `${count}: unbalanced ${width}x${height}`);
  assert.ok(new Set(siblings.map(i=>result.get(i.id)!.x)).size>2);
  for (let a=0;a<collection.length;a++) for(let b=a+1;b<collection.length;b++) {
    const i=collection[a],j=collection[b],p=result.get(i.id)!,q=result.get(j.id)!;
    assert.ok(!(p.x<q.x+j.canvas_width&&p.x+i.canvas_width>q.x&&p.y<q.y+j.canvas_height&&p.y+i.canvas_height>q.y), `${count}: ${i.id}/${j.id} overlap`);
  }
  assert.deepEqual(arrange([...collection].reverse()),result);
  console.log(`${count} related images: ${width}x${height}, ratio ${(width/height).toFixed(2)}`);
}
const chainPositions=arrange(history);
const chainWidth=Math.max(...history.map(i=>chainPositions.get(i.id)!.x+i.canvas_width))-40;
const chainHeight=Math.max(...history.map(i=>chainPositions.get(i.id)!.y+i.canvas_height))-80;
assert.ok(chainWidth/chainHeight<4&&chainWidth/chainHeight>0.5,'long edit chains must wrap');
console.log('PASS: large mixed-ratio families, compact blocks, no overlaps, stable order and wrapped edit chains.');
const editedSiblings=Array.from({length:48},(_,i)=>image(`near-${i}`,[root.image_url],i+1));
const nearbyEdits=editedSiblings.filter((_,i)=>i%6===0).map((source,i)=>image(`near-edit-${i}`,[source.image_url],100+i));
const branchItems=[root,...editedSiblings,...nearbyEdits],branchPositions=arrange(branchItems);
for(const edit of nearbyEdits){const source=branchItems.find(i=>i.image_url===JSON.parse(edit.reference_images!)[0])!,a=branchPositions.get(source.id)!,b=branchPositions.get(edit.id)!;assert.equal(b.x-a.x-source.canvas_width,32);assert.equal(a.y,b.y);}
for(let a=0;a<branchItems.length;a++)for(let b=a+1;b<branchItems.length;b++){const i=branchItems[a],j=branchItems[b],p=branchPositions.get(i.id)!,q=branchPositions.get(j.id)!;assert.ok(!(p.x<q.x+j.canvas_width&&p.x+i.canvas_width>q.x&&p.y<q.y+j.canvas_height&&p.y+i.canvas_height>q.y));}
console.log('PASS: 48 siblings with multiple edits stay beside their own source without overlaps.');

// Screenshot regression: an edit on the right column must not widen every cell.
const six = Array.from({length:6}, (_,i)=>image(`six-${i}`,[root.image_url],i+1));
const lastEdit=image('last-edit',[six[3].image_url],20);
const screenshotItems=[root,...six,lastEdit], screenshotPositions=arrange(screenshotItems);
for(let row=0;row<3;row++) {
  const left=screenshotPositions.get(six[row*2].id)!, right=screenshotPositions.get(six[row*2+1].id)!;
  assert.equal(right.x-left.x-six[row*2].canvas_width,24,'a descendant must not create an empty image-wide column');
  assert.equal(right.y,left.y);
}
for(const count of [6,16,48]) {
  const mixed=Array.from({length:count},(_,i)=>image(`packed-${i}`,[],i+1,i%2?240:480,i%3?270:400));
  const result=arrange(mixed);
  assert.equal(result.get(mixed[1].id)!.x-result.get(mixed[0].id)!.x-mixed[0].canvas_width,24,'mixed widths use their actual row footprint');
}
console.log('PASS: six-result family + right-column edit stays tightly packed; mixed widths do not reserve empty columns.');
const compactSource={x:0,y:225,width:240,height:135}, compactTarget={x:616,y:0,width:320,height:180};
const compactBlockers=[0,204,408].map(y=>({x:272,y,width:320,height:180}));
assert.match(routedCanvasConnectionGeometry(compactSource,compactTarget,[compactSource,compactTarget,...compactBlockers]).d,/ Q /,'tight 24-unit gaps retain a rounded obstacle-free route');


// Several four-image jobs can share a source, and complete out of order.
const batchImages = Array.from({length:12}, (_,i)=>image(`batch-row-${i}`,[root.image_url],100+i%4*10+Math.floor(i/4),i%3?480:270,i%3?270:480));
const batchMeta = (i:CanvasImage) => {
  if (!i.id.startsWith('batch-row-')) return undefined;
  const n=Number(i.id.slice(10));
  return {batchId:`job-${Math.floor(n/4)}`,index:n%4};
};
const batchArrange = (items:CanvasImage[]) => arrangeCanvasFamilies(items,{getSize:size,origin:{x:40,y:80},batchFor:batchMeta});
const groupedItems=[root,...batchImages],grouped=batchArrange(groupedItems);
for(let group=0;group<3;group++) {
  const row=batchImages.slice(group*4,group*4+4);
  assert.equal(new Set(row.map(i=>grouped.get(i.id)!.y)).size,1,'all four images of a job share a row');
  for(let i=1;i<4;i++) assert.equal(grouped.get(row[i].id)!.x-grouped.get(row[i-1].id)!.x-row[i-1].canvas_width,24,'batch order has compact gaps');
}
assert.equal(new Set(batchImages.map(i=>grouped.get(i.id)!.y)).size,3,'separate jobs never share a row');
assert.deepEqual(batchArrange([...groupedItems].reverse()),grouped,'completion order cannot mix jobs');
for(let a=0;a<groupedItems.length;a++)for(let b=a+1;b<groupedItems.length;b++){
  const i=groupedItems[a],j=groupedItems[b],p=grouped.get(i.id)!,q=grouped.get(j.id)!;
  assert.ok(!(p.x<q.x+j.canvas_width&&p.x+i.canvas_width>q.x&&p.y<q.y+j.canvas_height&&p.y+i.canvas_height>q.y));
}
for(const count of [1,2,3,4,5,8]) {
  const items=batchImages.slice(0,count);
  const result=arrangeCanvasFamilies(items,{getSize:size,origin:{x:0,y:0},batchFor:i=>({batchId:'one-job',index:batchImages.indexOf(i)})});
  assert.equal(new Set(items.slice(0,4).map(i=>result.get(i.id)!.y)).size,1);
  if(count>4) assert.ok(result.get(items[4].id)!.y>result.get(items[0].id)!.y);
}
console.log('PASS: four-image batches own compact rows, mixed sizes and out-of-order completion stay grouped, partial batches and no-reference batches supported.');


// Generation placeholders and old pending DB records must also be horizontal.
for(const restored of [false,true,'failed']) {
  const items=Array.from({length:4},(_,i)=>({...image(`waiting-${i}`,[root.image_url],100+i),image_url:'',status:restored==='failed'?'failed':'pending',isGenerating:restored!=='failed',
    ...(restored?{}:{generationBatch:{batchId:'waiting-job',index:i,total:4}})}));
  const result=arrangeCanvasFamilies([root,...items],{getSize:size,origin:{x:0,y:0}});
  assert.equal(new Set(items.map(i=>result.get(i.id)!.y)).size,1,'pending batch must arrange horizontally');
  for(let i=1;i<4;i++)assert.equal(result.get(items[i].id)!.x-result.get(items[i-1].id)!.x-items[i-1].canvas_width,24);
}
const familyA=[image('family-a',[],1),image('a-result',['/qa/family-a'],2)];
const familyB=[image('family-b',[],3),image('b-result',['/qa/family-b'],4)];
const spaced=arrangeCanvasFamilies([...familyA,...familyB],{getSize:size,origin:{x:0,y:0},rowWidth:100});
assert.equal(spaced.get('family-b')!.y-spaced.get('family-a')!.y-270,128,'different families have a visible separator');
console.log('PASS: live and restored pending batches use four horizontal slots; distinct families have 128-unit separation.');
