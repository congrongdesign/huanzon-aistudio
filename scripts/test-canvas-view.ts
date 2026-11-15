import assert from 'node:assert/strict';
import { canvasViewport, canvasRectInView, fitCanvasView, inheritCanvasPlacement } from '../src/lib/canvas-view';
import { CanvasSpatialIndex } from '../src/lib/canvas-edge-scene';
import { arrangeCanvasFamilies } from '../src/lib/canvas-arrangement';
import type { CanvasImage } from '../src/lib/types';

const image=(id:string,x=5000,y=-1200):CanvasImage=>({id,project_id:'qa',image_url:'',image_key:null,reference_images:null,prompt:'generation',status:'pending',isGenerating:true,is_favorite:false,canvas_x:x,canvas_y:y,canvas_width:480,canvas_height:270,size:'16:9',model:'qa',created_at:new Date(0).toISOString(),updated_at:null});
const rect=(i:CanvasImage)=>({x:i.canvas_x,y:i.canvas_y,width:i.canvas_width,height:i.canvas_height});
for (const items of [[],[image('pending')],[{...image('source'),image_url:'/source',isGenerating:false},image('one'),image('two')]]) {
  const positions=arrangeCanvasFamilies(items,{getSize:i=>({w:i.canvas_width,h:i.canvas_height}),origin:{x:40,y:40}});
  const arranged=items.map(i=>({...i,canvas_x:positions.get(i.id)!.x,canvas_y:positions.get(i.id)!.y}));
  assert.equal(arranged.length,items.length);
  assert.deepEqual(arranged.map(i=>i.id),items.map(i=>i.id));
  for (const viewport of [{width:900,height:700},{width:430,height:400}]) {
    const view=fitCanvasView(arranged.map(rect),viewport);
    if (!items.length) { assert.equal(view,null); continue; }
    assert.ok(view);
    const visible=canvasViewport(viewport,view.offset,view.scale)!;
    for (const i of arranged) assert.ok(i.canvas_x+i.canvas_width>=visible.x&&i.canvas_x<=visible.right&&i.canvas_y+i.canvas_height>=visible.y&&i.canvas_y<=visible.bottom);
  }
}
const good={x:40,y:80,width:480,height:270};
assert.equal(canvasRectInView(good,null),true,'unmeasured viewport must not hide every image');
assert.equal(canvasRectInView(good,canvasViewport({width:800,height:600},{x:5000,y:0},1,0)),false,'offscreen state must use actual bounds, not overscan');
assert.equal(canvasRectInView(good,canvasViewport({width:800,height:600},{x:0,y:0},1,0)),true);
assert.equal(canvasRectInView({...good,x:NaN},null),false);
for(const bad of [NaN,Infinity,-Infinity]) {
  assert.equal(fitCanvasView([{...good,x:bad}],{width:800,height:600}),null);
  assert.deepEqual(fitCanvasView([good,{...good,x:bad}],{width:800,height:600}),fitCanvasView([good],{width:800,height:600}));
  const index=new CanvasSpatialIndex([{value:'bad',rect:{...good,x:bad}},{value:'good',rect:good}]);
  assert.deepEqual(index.query(good),['good']);
  assert.deepEqual(index.query({...good,x:bad}),[]);
}
const far={...good,x:1e100,y:-1e100};
assert.deepEqual(new CanvasSpatialIndex([{value:'far',rect:far}]).query(far),['far'],'unsafe grid coordinates must not enter increment loops');
assert.equal(fitCanvasView([good],{width:0,height:0}),null);
assert.equal(canvasViewport({width:800,height:600},{x:0,y:0},0),null);
// A result arriving after arrangement must inherit that task's current slot.
const submitted=image('task'),moved={...submitted,canvas_x:40,canvas_y:50,canvas_block_id:'board',block_order:3};
const result={...submitted,id:'result',image_url:'/result',status:'completed',isGenerating:false};
assert.deepEqual(rect(inheritCanvasPlacement(result,[moved],'task')),rect(moved));
assert.equal(inheritCanvasPlacement(result,[moved],'task').canvas_block_id,'board');
assert.equal(inheritCanvasPlacement(result,[result],'task').id,'result');
assert.equal(inheritCanvasPlacement(result,[],'task'),result);
// Very large scenes and negative positions still have a finite camera.
assert.ok(fitCanvasView(Array.from({length:10000},(_,i)=>({...good,x:-20000+i*40,y:i*30})),{width:1000,height:700}));
console.log('PASS: empty/active-only/mixed arrangement, camera/culling consistency, invalid geometry isolation, current task placement and 10,000 rectangles.');
