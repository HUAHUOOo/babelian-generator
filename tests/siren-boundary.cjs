/* Exact reference-path geometry; no browser or semantic inference. */
const assert=require('node:assert/strict'),E=require('../src/siren-recognition.js'),F=require('./siren-fixture.cjs'),C=require('../src/siren-core.js');
const base={width:100,height:100,pivotX:.5,pivotY:.4};
const closed={points:[[50,40],[51,40],[50,41],[49,40],[50,39],[60,40],[60,50],[40,50],[40,30],[60,30],[60,40]]};
const square=E.createLocatorBoundary(base,closed),pose={cx:50,cy:40,size:100,rotation:0};
for(const p of [{x:50,y:40},{x:60,y:40},{x:59.99,y:49.99},{x:60,y:50}])assert(square(pose,p));
for(const p of [{x:60.01,y:40},{x:50,y:29.99},{x:40,y:50.01},{x:NaN,y:40}])assert(!square(pose,p));
// The outer path can end before closing a turn. Connecting endpoints would
// incorrectly make the upper centre belong to the group.
const open=E.createLocatorBoundary(base,{points:[[50,40],[51,40],[50,41],[49,40],[50,39],[70,40],[70,60],[30,60],[30,20]]});
assert(open(pose,{x:50,y:39}));assert(!open(pose,{x:50,y:35}));assert(open(pose,{x:50,y:55}));
// Rotation/scale/offset apply about the asset pivot (not the image centre).
for(const rotation of [-179,-90,-17,0,45,90,179])for(const size of [50,100,733]){
 const p={cx:208,cy:357,size,rotation},a=rotation*Math.PI/180;
 const place=(x,y)=>({x:p.cx+(x*Math.cos(a)-y*Math.sin(a))*size/100,y:p.cy+(x*Math.sin(a)+y*Math.cos(a))*size/100});
 assert(square(p,place(10,7)));assert(square(p,place(9.99,7)));assert(!square(p,place(10.01,7)));
}
const inside=E.createLocatorBoundary(F.assets.base,F.path),g=F.sample().groups[0];
assert.equal(g.items.filter(i=>inside(g,i)).map(i=>i.letter).join(''),'BDA');
// Import and generation preserve every old/manual item, including outside ones.
assert.equal(C.decode(F.sample()).groups[0].items.length,6);
for(const rotation of [-133,0,73])for(const size of [250,700]){
 const p={cx:420,cy:300,size,rotation},a=rotation*Math.PI/180,scale=size/g.baseSize;
 for(const i of g.items){const x=i.x-g.cx,y=i.y-g.cy,pt={x:p.cx+(x*Math.cos(a)-y*Math.sin(a))*scale,y:p.cy+(x*Math.sin(a)+y*Math.cos(a))*scale};assert.equal(inside(p,pt),inside(g,i));}
}
assert.throws(()=>E.createLocatorBoundary(base,{}),/参考路径/);
assert.throws(()=>E.createLocatorBoundary(base,closed,NaN),/余量/);
assert.throws(()=>E.createLocatorBoundary(base,closed,-.01),/余量/);
// Recognition alone gets a narrow radial band. The exact geometry helper
// remains strict; the allowance is scale/rotation/pivot invariant, not a circle.
const padded=E.createRecognitionBoundary(base,closed);
for(const rotation of [-179,-90,-17,0,45,90,179])for(const size of [50,100,733]){
 const p={cx:208,cy:357,size,rotation},a=rotation*Math.PI/180;
 const place=(x,y)=>({x:p.cx+(x*Math.cos(a)-y*Math.sin(a))*size/100,y:p.cy+(x*Math.sin(a)+y*Math.cos(a))*size/100});
 assert(padded(p,place(12.5,0)));assert(!square(p,place(12.5,0)));
 assert(!padded(p,place(12.51,0)),'Farther neighbour must remain excluded');
 assert(padded(p,place(10+2.49/Math.sqrt(2),10+2.49/Math.sqrt(2))));
 assert(!padded(p,place(10+2.51/Math.sqrt(2),10+2.51/Math.sqrt(2))));
}
const paddedOpen=E.createRecognitionBoundary(base,{points:[[50,40],[51,40],[50,41],[49,40],[50,39],[70,40],[70,60],[30,60],[30,20]]});
assert(!paddedOpen(pose,{x:50,y:35}),'Allowance must not close the open spiral');
assert(!padded(pose,{x:NaN,y:40}));
console.log('PASS Siren outer boundary: exact line/inside/outside, open end, noncircular extent, asset pivot, rotation/scale, old/manual preservation.');
