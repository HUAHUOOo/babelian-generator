/* Real pixels and Node/worker doubles, not browser QA. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const E=require('../src/siren-recognition.js'),Scan=require('../src/siren-scan.js'),C=require('../src/siren-core.js'),F=require('./siren-fixture.cjs'),decodePNG=require('./png.cjs');
const decode=a=>({...a,...decodePNG(Buffer.from(a.src.split(',')[1],'base64'))});
const templates={base:decode(F.assets.base),letters:Object.fromEntries(Object.entries(F.assets.letters).map(([k,a])=>[k,decode(a)])),path:F.path},engine=E.create(templates);
const inside=E.createRecognitionBoundary(templates.base,templates.path);
function assertBounded(result){for(const item of result.items){assert.equal(item.method,'joint-pixel');assert(item.candidates.length<=3);assert(inside(result.base,item),'Outside locator entered result');for(const c of item.candidates)assert(inside(result.base,c),'Outside alternative entered result');}return result;}
function sample(bitmap,x,y){const {width:w,height:h,ink:a}=bitmap;if(x<0||y<0||x>w-1||y>h-1)return 0;const ix=x|0,iy=y|0,dx=x-ix,dy=y-iy,j=iy*w+ix,xx=ix<w-1?1:0,yy=iy<h-1?w:0;return a[j]*(1-dx)*(1-dy)+a[j+xx]*dx*(1-dy)+a[j+yy]*(1-dx)*dy+a[j+xx+yy]*dx*dy;}
function synthetic(text){
 const g=C.fromText(text).groups[0];F.geometry.arrange(g);const width=600,height=600,ink=new Float32Array(width*height);
 function draw(a,cx,cy,size,rotation){const bitmap={width:a.width,height:a.height,ink:Float32Array.from({length:a.width*a.height},(_,i)=>a.data[i*4+3]/255)},rad=rotation*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad),scale=a.width/size;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const dx=x-cx,dy=y-cy,v=sample(bitmap,(dx*c+dy*s)*scale+a.width*a.pivotX,(-dx*s+dy*c)*scale+a.height*a.pivotY);ink[y*width+x]=Math.max(ink[y*width+x],v);}}
 draw(templates.base,g.cx,g.cy,g.baseSize,g.baseRotation);for(const i of g.items)draw(templates.letters[i.letter],i.x,i.y,i.size,C.rotationFor(g,i));return {width,height,ink};
}
function reading(result){if(!result.base)return '';const points=F.geometry.basePoints({...result.base,baseSize:result.base.size,baseRotation:result.base.rotation});return result.items.map(i=>({letter:i.letter||'?',at:F.geometry.crossings(points,{...i,letter:i.letter||i.candidates[0]?.letter})[0]?.at??Infinity})).sort((a,b)=>a.at-b.at).map(i=>i.letter).join('');}
function image(bitmap){return {width:bitmap.width,height:bitmap.height,data:Uint8Array.from({length:bitmap.width*bitmap.height*4},(_,i)=>i%4===3?255:Math.round(255*(1-bitmap.ink[i>>2])))};}
assert.equal(engine.fitGroup({width:200,height:200,ink:new Float32Array(40000)}).base,null);
assert.equal(engine.fitGroup(engine.binarize(templates.base)).items.length,0);
// Fixed-pose overlap scores source pixels only: moving the template must not refit it.
const poseGroup=C.fromText('A').groups[0];F.geometry.arrange(poseGroup);
const poseItem={...poseGroup.items[0],rotation:C.rotationFor(poseGroup,poseGroup.items[0])};
const poseBase={cx:poseGroup.cx,cy:poseGroup.cy,size:poseGroup.baseSize,rotation:poseGroup.baseRotation};
const poseBitmap=synthetic('A'),matched=engine.measurePlacement(poseBitmap,poseBase,poseItem),shifted=engine.measurePlacement(poseBitmap,poseBase,{...poseItem,x:poseItem.x+40});
assert(matched.overlap>.9);assert(matched.independent>.85);assert(shifted.overlap<matched.overlap-.15);assert(shifted.independent<matched.independent-.3);
assert.equal(engine.measurePlacement({width:600,height:600,ink:new Float32Array(360000)},poseBase,poseItem).overlap,0);
let repeated;
// Pixel-refining the base now places C inside its actual final boundary.
// v1.9.2's slightly displaced base omitted C (ABDE); F and the last repeated A
// remain excluded, including with the narrow recognition allowance.
for(const [text,expected] of [['A','A'],['ABCDEF','ABCDE'],['AAAAAA','AAAAA']]){const result=assertBounded(engine.fitGroup(synthetic(text)));assert.equal(reading(result),expected);assert.equal(result.items.length,expected.length);assert(result.items.every(i=>i.candidates.length===3));if(text==='AAAAAA')repeated=result;}
const uncertain=assertBounded(engine.fitGroup(synthetic('MNOPQR')));assert.equal(reading(uncertain),'MNOPQ');
assert.equal(uncertain.items.filter(i=>i.letter==='P').length,1,'The admitted near-boundary O must not become a second wrong P');
assert(uncertain.items.filter(i=>!i.letter).every(i=>i.candidates.length>=1&&i.candidates.length<=3));
assert.equal(E.create({...templates,letters:{}}).fitGroup(poseBitmap,poseBase).items.length,0);
const single=E.create({...templates,letters:{A:templates.letters.A}}).fitGroup(poseBitmap,poseBase);assert.equal(single.items.length,1);assert.equal(single.items[0].letter,null);assert.equal(single.items[0].margin,0);
// Pixel fitting has separate rotation metadata; it survives saves, then expires on geometry edits.
const doc=C.create('review'),g=C.addGroup(doc);g.image='data:image/png;base64,AAAA';Object.assign(g,{cx:repeated.base.cx,cy:repeated.base.cy,baseSize:repeated.base.size,baseRotation:repeated.base.rotation});
for(const raw of repeated.items){const i=C.add(g,raw.letter,raw);i.size=raw.size;i.fit={rotation:raw.rotation,score:raw.score,candidates:raw.candidates};}
g.items[0].fit.method='joint-pixel';
assert.equal(C.decode(doc).groups[0].items[0].fit.method,'joint-pixel');
const invalidMethod=structuredClone(doc);invalidMethod.groups[0].items[0].fit.method='unknown';assert.throws(()=>C.decode(invalidMethod));
assert.equal(C.read(doc,g=>F.geometry.analyze(g,true)).text,'AAAAA');
const restored=C.decode(doc);assert.deepEqual(restored.groups[0].items[0].fit,g.items[0].fit);C.move(restored.groups[0],restored.groups[0].items[0],{x:200,y:200});assert(!restored.groups[0].items[0].fit);
const movedSave=C.decode(restored),restoreGroup=movedSave.groups[0],restoreItem=restoreGroup.items[0];assert(C.resetPosition(restoreGroup,restoreItem));assert.deepEqual(restoreItem.fit,g.items[0].fit);assert.equal(restoreItem.x,g.items[0].x);
restoreItem.positionLocked=true;const lockState=JSON.stringify(restoreItem);assert.equal(C.move(restoreGroup,restoreItem,{x:0,y:0}),false);assert.equal(C.resetPosition(restoreGroup,restoreItem),false);assert.equal(JSON.stringify(restoreItem),lockState);assert(C.decode(movedSave).groups[0].items[0].positionLocked);
for(const mutate of [i=>i.positionLocked='yes',i=>i.resetPose.x=NaN,i=>i.resetPose.fit.candidates[0].score=2,i=>i.resetPose.resetPose={},i=>i.resetPose.rotationMode='manual']){const bad=structuredClone(movedSave);mutate(bad.groups[0].items[0]);assert.throws(()=>C.decode(bad));}
const manual=structuredClone(doc);manual.groups[0].items[0].manualAdded=true;assert.equal(C.decode(manual).groups[0].items[0].manualAdded,true);
manual.groups[0].items[0].manualAdded='yes';assert.throws(()=>C.decode(manual));
const resized=C.decode(doc);C.resizeBase(resized.groups[0],400);assert(resized.groups[0].items.every(i=>!i.fit));
const changed=C.decode(doc);C.reorient(changed.groups[0]);assert(changed.groups[0].items.every(i=>!i.fit));
for(const mutate of [i=>i.fit.rotation=Infinity,i=>i.fit.candidates[0].score=2,i=>i.fit.candidates[0].letter='<script>',i=>i.fit.candidates[0].x=-2]){const invalid=structuredClone(doc);mutate(invalid.groups[0].items[0]);assert.throws(()=>C.decode(invalid));}
const old=structuredClone(doc);old.version=3;assert(C.decode(old).groups[0].items.every(i=>!i.fit));
let actual=synthetic('A');
if(process.env.SIREN_REAL_FIXTURE){
 const raw=decodePNG(fs.readFileSync(process.env.SIREN_REAL_FIXTURE));actual=engine.binarize(raw);assert.equal(reading(assertBounded(engine.fitGroup(actual))),'BDAE');
 const inverse={...raw,data:Uint8Array.from(raw.data,(v,i)=>i%4===3?v:255-v)};assert.equal(reading(assertBounded(engine.fitGroup(engine.binarize(inverse)))),'BDAE');
 console.log('PASS supplied real BDAEFC crop: near-boundary E admitted; farther F/C excluded, both polarities.');
}
// Exercise the actual self-contained worker program and local group crop coordinates.
const width=actual.width*2+30,height=actual.height,ink=new Float32Array(width*height);
for(let y=0;y<height;y++)for(let x=0;x<actual.width;x++)ink[y*width+x]=ink[y*width+x+actual.width+30]=actual.ink[y*actual.width+x];
const messages=[],scope={self:{postMessage:m=>messages.push(m)}};new Function('self',Scan.workerSource(E.workerSource()))(scope.self);
scope.self.onmessage({data:{templates,image:image({width,height,ink}),operation:'detect',limit:20}});
// The doubled real image's automatic crop changes the search grid; it still
// misses E in both groups. Preserve the measured BDA baseline, not an invented
// promise that admitting an edge pose guarantees it will always be discovered.
const message=messages.at(-1);assert(!message.error,message.error);assert.equal(message.result.length,2);assert(message.result.every(r=>reading(assertBounded(r))===(process.env.SIREN_REAL_FIXTURE?'BDA':'A')));
// Transport cancellation rejects and ignores an old worker response.
(async()=>{const workers=[];class WorkerDouble{constructor(){workers.push(this);}terminate(){this.terminated=true;}postMessage(p){this.payload=p;}}
 const client=Scan.create({engineSource:E.workerSource(),WorkerClass:WorkerDouble});const pending=client.run({image:{}});const rejected=assert.rejects(pending,/取消/);client.cancel();await rejected;assert(workers[0].terminated);
 const second=client.run({image:{}});workers[0].onmessage({data:{result:['stale']}});workers[1].onmessage({data:{result:['new']}});assert.deepEqual(await second,['new']);
 console.log('PASS Siren image-only recognition: empty/base-only negatives, single/repeated/six-source combinations with bounded tolerance, rivals, fit metadata, two-group worker, cancellation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
