import assert from 'node:assert/strict';
import { nearbyCanvasPosition } from '../src/lib/canvas-nearby-placement';
const source={x:-500,y:50,width:320,height:240};
assert.deepEqual(nearbyCanvasPosition(source,320,240,[source]),{x:-140,y:50});
const blocker={x:-140,y:50,width:320,height:240};
const nearby=nearbyCanvasPosition(source,320,240,[source,blocker,{x:100000,y:0,width:320,height:240}]);
assert.ok(Math.abs(nearby.x-source.x)<=680&&Math.abs(nearby.y-source.y)<=520,'unrelated distant images must not pull results away');
const items=[source];
for(let i=0;i<16;i++){const p=nearbyCanvasPosition(source,320,240,items);assert.ok(items.every(r=>!(p.x<r.x+r.width+24&&p.x+344>r.x&&p.y<r.y+r.height+24&&p.y+264>r.y)));items.push({...p,width:320,height:240});}
console.log('PASS: nearby source insertion, negative coordinates, occupied slots, concurrent reserved areas and distant unrelated images.');
