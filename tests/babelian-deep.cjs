const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {deep}=require('../src/babelian-deep.js'),OCR=require('../src/ocr-engine.js'),F=require('./ocr.cjs');
const report=[],cases=[];
const ids=F.masks.map(m=>m.id),prepared=OCR.prepareTemplates(F.masks);
for(const height of [64,40,28]){
 let baseline=0,enhanced=0,changed=0,improved=0,regressed=0,time=0;
 for(const id of ids){
  const image=F.draw([[id]],{height,light:height===40,noise:height===28}),mask=OCR.binarize(image),tight=OCR.bounds(mask),before=OCR.matchDescriptor(OCR.describe(mask,tight),prepared)[0]?.id;
  const beforeData=Buffer.from(image.data),frozen=Object.freeze({...tight});
  const result=deep(image,frozen,F.masks,{threshold:mask.threshold,polarity:mask.polarity});
  const after=result.candidates[0]?.id;time+=result.elapsedMs;baseline+=Number(before===id);enhanced+=Number(after===id);
  if(before!==after){changed++;improved+=Number(after===id);regressed+=Number(before===id);cases.push({height,id,before,after,candidates:result.candidates.slice(0,3)});}
  assert.deepEqual(result.box,tight);assert.deepEqual(Buffer.from(image.data),beforeData);assert.equal(result.certain,false);assert.equal(result.requiresConfirmation,true);
  assert.equal(Object.hasOwn(result,'id'),false,'No token assignment');
  assert(result.candidates.every(c=>c.variantCount===result.uniqueMasks*3));
 }
 report.push({height,total:ids.length,baseline,enhanced,changed,improved,regressed,totalMs:time,averageMs:time/ids.length});
}
// Templates with indistinguishable pixels but distinct IDs must retain a tie.
const image=F.draw([[ids[0]]],{height:64}),mask=OCR.binarize(image),box=OCR.bounds(mask);
const duplicated=[{...F.masks[0],id:'opaque-one'},{...F.masks[0],id:'opaque-two'}];
const tied=deep(image,box,duplicated,{threshold:mask.threshold,polarity:mask.polarity});
assert.equal(tied.candidates.length,2);assert.equal(tied.candidates[0].score,tied.candidates[1].score);assert.equal(tied.candidates[0].support,tied.candidates[1].support);
// Multiple saved samples of one ID do not multiply vote counts.
const one=deep(image,box,[duplicated[0]],{threshold:mask.threshold,polarity:mask.polarity});
const twice=deep(image,box,[duplicated[0],duplicated[0]],{threshold:mask.threshold,polarity:mask.polarity});
assert.deepEqual(one.candidates,twice.candidates);
// Excluded ownership is honored without changing the user's selected rectangle.
const excluded=deep(image,box,F.masks,{threshold:mask.threshold,polarity:mask.polarity,excludedBoxes:[box]});
assert.equal(excluded.candidates.length,0);assert.deepEqual(excluded.box,box);
assert.throws(()=>deep(image,{...box,x:-1},F.masks),/outside/);
assert.throws(()=>deep(image,box,F.masks,{cancelled:()=>true}),/Cancelled/);
console.log(JSON.stringify({report,cases,tie:tied.candidates.map(c=>({id:c.id,score:c.score,support:c.support})),integrity:'PASS fixed box, source bytes, no autoaccept, ties, sample dedup, exclusion, cancellation'},null,2));
assert.deepEqual(report.map(r=>r.enhanced),[58,58,57]);
