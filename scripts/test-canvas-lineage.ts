import assert from 'node:assert/strict';
import { canvasConnections, canvasConnectionGeometry } from '../src/lib/canvas-lineage';
import type { CanvasImage } from '../src/lib/types';

const image = (id: string, project = 'project', refs: unknown[] = [], time = 1): CanvasImage => ({
  id, project_id: project, image_url: `/images/${id}.png`, reference_images: JSON.stringify(refs),
  canvas_x:0, canvas_y:0, canvas_width:320, canvas_height:240, created_at:new Date(time).toISOString(),
  image_key:null,prompt:'',size:'4:3',model:'test',status:'completed',is_favorite:false,updated_at:null,
});
const source=image('source'), uploaded=image('ref-upload'), target=image('target','project',[source.image_url,'upload',source.image_url,'missing',{url:'/old-metadata'}],10);
assert.deepEqual(canvasConnections([source,uploaded,target]),[{source:'source',target:'target'},{source:'ref-upload',target:'target'}]);
const other=image('other','another',[source.image_url,'source'],10);
assert.deepEqual(canvasConnections([source,other]),[]);
assert.deepEqual(canvasConnections([source,{...target,reference_images:'broken'}]),[]);
assert.deepEqual(canvasConnections([source,{...target,reference_images:JSON.stringify(['target'])}]),[]);
// Duplicate image URLs choose the most recent previous occurrence, never a future copy.
const older={...image('older','project',[],0),image_url:source.image_url};
const copy={...image('future','project',[],20),image_url:source.image_url};
assert.deepEqual(canvasConnections([older,source,copy,{...target,reference_images:JSON.stringify([source.image_url])}]),[{source:'source',target:'target'}]);
assert.deepEqual(canvasConnections([{...source,deleted_at:new Date().toISOString()},target,uploaded]),[{source:'ref-upload',target:'target'}]);
for (const [x,y,axis,reverse] of [[500,50,'x',false],[-500,50,'x',true],[0,500,'y',false],[0,-500,'y',true]] as const) {
  const geometry=canvasConnectionGeometry({x:0,y:0,width:320,height:240},{x,y,width:320,height:240});
  assert.equal(geometry.axis,axis); assert.equal(geometry.reverse,reverse);
  assert.ok(geometry.width>0&&geometry.height>0&&!/NaN|Infinity/.test(geometry.d));
}
// A realistic history restores its relationships without quadratic all-pairs comparison.
const history=Array.from({length:1000},(_,n)=>image(String(n),'project',n?[`/images/${n-1}.png`]:[],n+1));
assert.equal(canvasConnections(history).length,999);
console.log('PASS: URL/id lineage, multiple references, duplicate URLs, project isolation, malformed/deleted/missing records, four directions and 1000-image history.');
