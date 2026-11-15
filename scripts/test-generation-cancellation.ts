import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {requestGeneration} from '../src/lib/generation-client';
async function main(){
 const original=globalThis.fetch;const cancelled:string[]=[];let release:(r:Response)=>void=()=>{};
 globalThis.fetch=(async(input,init)=>{const url=String(input);if(init?.method==='DELETE'){cancelled.push(url);return Response.json({success:true});}if(init?.method==='POST')return new Promise<Response>(r=>{release=r;});return Response.json({jobs:[]});}) as typeof fetch;
 try{
  const submitting=new AbortController();const first=requestGeneration({prompt:'test'}, {}, submitting.signal,'submit-race',true);const firstResult=first.catch(e=>e);submitting.abort();release(Response.json({jobId:'accepted-before-abort',status:'running'}));assert.equal((await firstResult).name,'AbortError');assert.ok(cancelled.some(u=>u.includes('accepted-before-abort')));
  const pending=new AbortController();const second=requestGeneration({prompt:'test'}, {}, pending.signal,'waiting',true);const secondResult=second.catch(e=>e);release(Response.json({jobId:'waiting-job',status:'queued'}));await delay(5);pending.abort();assert.equal((await secondResult).name,'AbortError');assert.ok(cancelled.some(u=>u.includes('waiting-job')));
  await delay(1100);assert.equal(cancelled.length,2);console.log('PASS: cancellation during submission and polling cancels server jobs and rejects late results.');
 }finally{globalThis.fetch=original;}
}
void main();
