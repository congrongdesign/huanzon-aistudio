import assert from 'node:assert/strict';
import { CanvasEdgeScene, CanvasSpatialIndex, flowingCanvasEdges } from '../src/lib/canvas-edge-scene';
import { arrangeCanvasFamilies } from '../src/lib/canvas-arrangement';
import type { CanvasImage } from '../src/lib/types';
const image=(id:string,x:number,y:number,refs:string[]=[]):CanvasImage=>({id,project_id:'qa',image_url:`/qa/${id}`,reference_images:JSON.stringify(refs),canvas_x:x,canvas_y:y,canvas_width:320,canvas_height:240,prompt:'',size:'4:3',model:'test',status:'completed',is_favorite:false,image_key:null,created_at:new Date(1).toISOString(),updated_at:null});
const size=(i:CanvasImage)=>({w:i.canvas_width,h:i.canvas_height});
const build=(images:CanvasImage[],previous?:CanvasEdgeScene)=>{const scene=new CanvasEdgeScene(images,size,previous);scene.connections.forEach(c=>scene.route(c));return scene.finish();};
const root=image('root',0,0), target=image('target',1000,0,['root']), far=image('far',10000,10000);
const original=build([root,target,far]);assert.equal(original.routeComputations,1);
const same=build([root,{...target,prompt:'changed'},far],original);assert.equal(same.routeComputations,0);
const shifted=build([root,target,{...far,canvas_x:11000}],same);assert.equal(shifted.routeComputations,0);
const blocked=build([root,target,{...far,canvas_x:500,canvas_y:0}],shifted);assert.equal(blocked.routeComputations,1);
assert.notEqual([...blocked.edges.values()][0].geometry.d,[...shifted.edges.values()][0].geometry.d);
const removed=build([root,target],blocked);assert.equal(removed.routeComputations,1,'removed obstacles invalidate their old corridors');
const moved=build([root,{...target,canvas_y:300}],removed);assert.equal(moved.routeComputations,1);
for(let n=0;n<1000;n++) moved.visible({x:n,y:0,right:n+800,bottom:600});
assert.equal(moved.routeComputations,1,'panning must never route');
const active=build([root,{...target,canvas_y:300,isGenerating:true}],moved);assert.equal(active.routeComputations,0);assert.ok([...active.edges.values()][0].active);
assert.equal(build([root,target],active).visible({x:-5000,y:-5000,right:-4000,bottom:-4000}).length,0);
const entries=Array.from({length:1000},(_,i)=>({value:i,rect:{x:(i%40)*440-4000,y:Math.floor(i/40)*350-3000,width:320,height:240}}));
entries.push({value:1000,rect:{x:-100000,y:-100000,width:200000,height:200000}});
const index=new CanvasSpatialIndex(entries);
for(let i=0;i<100;i++) {
 const r={x:i*125-5000,y:i*64-3500,width:1500,height:900};
 const expected=entries.filter(e=>e.rect.x<=r.x+r.width&&e.rect.x+e.rect.width>=r.x&&e.rect.y<=r.y+r.height&&e.rect.y+e.rect.height>=r.y).map(e=>e.value).sort((a,b)=>a-b);
 assert.deepEqual(index.query(r).sort((a,b)=>a-b),expected);
}
for(const n of [100,300,1000]) {
 const items=[root,...Array.from({length:n},(_,i)=>image(`large-${i}`,0,0,['root']))];
 const layout=arrangeCanvasFamilies(items,{getSize:size,origin:{x:0,y:0}});
 const positioned=items.map(i=>({...i,canvas_x:layout.get(i.id)!.x,canvas_y:layout.get(i.id)!.y}));
 const start=performance.now(),scene=build(positioned),elapsed=performance.now()-start;
 const t=performance.now();for(let i=0;i<200;i++)scene.visible({x:i*20,y:0,right:i*20+1800,bottom:1000});
 console.log(`${n} edges: initial ${elapsed.toFixed(1)}ms (sliced in UI); 200 viewport queries ${(performance.now()-t).toFixed(1)}ms`);
 assert.equal(scene.edges.size,n);assert.equal(build(positioned,scene).routeComputations,0);
}
const selectedTarget=new Set(['target']);const activeEdges=[...active.edges.values()];
assert.equal(flowingCanvasEdges([...original.edges.values()],selectedTarget).length,1,'completed result input flows when selected');
assert.equal(flowingCanvasEdges([...original.edges.values()],new Set()).length,0,'deselection removes completed edge animation');
assert.equal(flowingCanvasEdges(activeEdges,new Set()).length,1,'generation still flows');
assert.equal(flowingCanvasEdges(activeEdges,selectedTarget,true).length,0,'interaction pauses animation');
const many=Array.from({length:50},(_,i)=>({...activeEdges[0],source:`s${i}`,target:`t${i}`,key:String(i)}));
const priority={...activeEdges[0],source:'parent',target:'selected-result',key:'priority',active:false};
assert.equal(flowingCanvasEdges([...many,priority],new Set(['selected-result']))[0].key,'priority');
assert.equal(flowingCanvasEdges(many,new Set(many.map(e=>e.target))).length,12,'multi selection remains bounded');
assert.equal(original.routeComputations,1,'selection animation never changes routed geometry');
console.log('PASS: cache reuse, local invalidation, obstacle add/remove, viewport-only queries, active status, spatial index and large scenes.');
