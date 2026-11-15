import assert from 'node:assert/strict';
import { clampComposerSize, readComposerSize, resizeComposer } from '../src/lib/composer-resize';

const limits={minWidth:440,maxWidth:1200,minHeight:160,maxHeight:600};
assert.deepEqual(readComposerSize('{bad'),{});
assert.deepEqual(readComposerSize('{"width":null,"height":-1}'),{});
assert.deepEqual(readComposerSize('{"width":700,"height":300}'),{width:700,height:300});
assert.deepEqual(resizeComposer({width:800,height:180},{},'ne',100,-140,limits),{width:1000,height:320});
assert.deepEqual(resizeComposer({width:800,height:180},{},'w',100,0,limits),{width:600});
assert.deepEqual(resizeComposer({width:800,height:180},{width:800},'n',0,-100,limits),{width:800,height:280});
assert.deepEqual(clampComposerSize({width:5000,height:5000},limits),{width:1200,height:600});
assert.deepEqual(clampComposerSize({width:20,height:20},limits),{width:440,height:160});
assert.deepEqual(clampComposerSize({width:800,height:400},{...limits,maxWidth:300,maxHeight:120}),{width:300,height:120});
assert.deepEqual(clampComposerSize({},limits),{},'default auto height and responsive width stay untouched');
assert.deepEqual(resizeComposer({width:1200,height:180},{width:1500},'n',0,-100,limits),{width:1500,height:280},'height-only adjustment retains the preferred width while the viewport constrains its display');
console.log('PASS: centred resize, axis isolation, viewport constraints, default sizing and invalid saved preferences.');
