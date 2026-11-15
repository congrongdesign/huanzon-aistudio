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
assert.equal(new Set(children.map(i=>positions.get(i.id)!.x)).size,2);
assert.equal(new Set(children.map(i=>positions.get(i.id)!.y)).size,4);
assert.ok(positions.get(root.id)!.x<positions.get(children[0].id)!.x);
assert.equal(positions.get(edit.id)!.x-(positions.get(children[6].id)!.x+children[6].canvas_width),180,"edit stays beside its actual source");
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
console.log('PASS: source + 2-column contact sheet + aligned edits, no overlaps, stable sort/repeat, cycles/multi-reference/missing refs, pending, 1000 images and gutter routing.');

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
for(const edit of nearbyEdits){const source=branchItems.find(i=>i.image_url===JSON.parse(edit.reference_images!)[0])!,a=branchPositions.get(source.id)!,b=branchPositions.get(edit.id)!;assert.equal(b.x-a.x-source.canvas_width,180);assert.equal(a.y,b.y);}
for(let a=0;a<branchItems.length;a++)for(let b=a+1;b<branchItems.length;b++){const i=branchItems[a],j=branchItems[b],p=branchPositions.get(i.id)!,q=branchPositions.get(j.id)!;assert.ok(!(p.x<q.x+j.canvas_width&&p.x+i.canvas_width>q.x&&p.y<q.y+j.canvas_height&&p.y+i.canvas_height>q.y));}
console.log('PASS: 48 siblings with multiple edits stay beside their own source without overlaps.');
