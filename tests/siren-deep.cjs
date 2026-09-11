/* Install as tests/siren-deep.cjs. Offline synthetic pixels; actual canonical API/worker. */
const assert=require('node:assert/strict');
const E=require('../src/siren-recognition.js'),Scan=require('../src/siren-scan.js');
const C=require('../src/siren-core.js'),F=require('./siren-fixture.cjs'),decodePNG=require('./png.cjs');
const decode=a=>({...a,...decodePNG(Buffer.from(a.src.split(',')[1],'base64'))});
const templates={base:decode(F.assets.base),letters:Object.fromEntries(Object.entries(F.assets.letters).map(([k,a])=>[k,decode(a)])),path:F.path};
const engine=E.create(templates),inside=E.createRecognitionBoundary(templates.base,templates.path);
const normalize=a=>((a+180)%360+360)%360-180;

function sample(bitmap,x,y){
 const {width:w,height:h,ink}=bitmap;if(x<0||y<0||x>w-1||y>h-1)return 0;
 const ix=Math.floor(x),iy=Math.floor(y),dx=x-ix,dy=y-iy,j=iy*w+ix,xx=ix<w-1?1:0,yy=iy<h-1?w:0;
 return ink[j]*(1-dx)*(1-dy)+ink[j+xx]*dx*(1-dy)+ink[j+yy]*(1-dx)*dy+ink[j+xx+yy]*dx*dy;
}
function draw(bitmap,asset,pose){
 const template={width:asset.width,height:asset.height,ink:Float32Array.from({length:asset.width*asset.height},(_,i)=>asset.data[i*4+3]/255)};
 const angle=pose.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),scale=asset.width/pose.size;
 for(let y=0;y<bitmap.height;y++)for(let x=0;x<bitmap.width;x++){
  const dx=x-pose.x,dy=y-pose.y,ink=sample(template,(dx*c+dy*s)*scale+asset.width*asset.pivotX,(-dx*s+dy*c)*scale+asset.height*asset.pivotY);
  bitmap.ink[y*bitmap.width+x]=Math.max(bitmap.ink[y*bitmap.width+x],ink);
 }
}
function rgba(bitmap){return {width:bitmap.width,height:bitmap.height,data:Uint8ClampedArray.from({length:bitmap.width*bitmap.height*4},(_,i)=>i%4===3?255:Math.round(255*(1-bitmap.ink[i>>2])))};}
function audit(result,base){
 assert.equal(result.requiresReview,true);assert.equal(result.diagnostics.baseFixed,true);assert.deepEqual(result.base,base);
 for(const p of result.candidates){
  assert.equal(p.certain,false);assert.equal(p.requiresReview,true);assert(Object.hasOwn(templates.letters,p.letter));
  assert(Number.isFinite(p.score)&&p.score>=0&&p.score<=1);assert(Number.isFinite(p.pixelBenefit)&&p.pixelBenefit>0);
  assert.equal(p.passesCoverage,p.score>=.86);assert(inside(base,p));
  assert(p.x>=result.region.x-1e-6&&p.x<=result.region.x+result.region.width+1e-6);
  assert(p.y>=result.region.y-1e-6&&p.y<=result.region.y+result.region.height+1e-6);
  assert(p.size>=base.size*.33-1e-6&&p.size<=base.size*.44+1e-6);
  const bearing=Math.atan2(p.y-base.cy,p.x-base.cx)*180/Math.PI-90;
  assert(Math.abs(normalize(p.rotation-bearing))<=30+1e-6,'Region search must retain the normal bearing limit');
 }
}

const group=C.fromText('A').groups[0];F.geometry.arrange(group);
const scale=.6,sourceItem=group.items[0];
const base={cx:group.cx*scale,cy:group.cy*scale,size:group.baseSize*scale,rotation:group.baseRotation};
const item={x:sourceItem.x*scale,y:sourceItem.y*scale,size:sourceItem.size*scale,rotation:C.rotationFor(group,sourceItem)};
const source={width:360,height:360,ink:new Float32Array(360*360)};
draw(source,templates.base,{x:base.cx,y:base.cy,size:base.size,rotation:base.rotation});draw(source,templates.letters.A,item);
const image=rgba(source),bitmap=engine.binarize(image),region={x:item.x-7,y:item.y-7,width:14,height:14};
const beforeInk=bitmap.ink.slice(),beforeBase=JSON.stringify(base),beforeRegion=JSON.stringify(region);
const result=engine.deepRegion(bitmap,base,region);audit(result,base);
assert.equal(result.candidates[0]?.letter,'A');assert(result.candidates[0].passesCoverage);
assert.deepEqual(bitmap.ink,beforeInk);assert.equal(JSON.stringify(base),beforeBase);assert.equal(JSON.stringify(region),beforeRegion);

// The selection bounds the centre only: a subpixel rectangle still retains surrounding strokes.
const narrow=engine.deepRegion(bitmap,base,{x:item.x-.2,y:item.y-.2,width:.4,height:.4},{maxCandidates:3,seedLimit:3});
audit(narrow,base);assert.equal(narrow.candidates[0]?.letter,'A');assert(narrow.candidates.length<=3);
// Translation of the source crop must translate the returned centre, not the fitted base.
const dx=23,dy=17,shifted={width:400,height:390,ink:new Float32Array(400*390)};
for(let y=0;y<bitmap.height;y++)shifted.ink.set(bitmap.ink.subarray(y*bitmap.width,(y+1)*bitmap.width),(y+dy)*shifted.width+dx);
const shiftedBase={...base,cx:base.cx+dx,cy:base.cy+dy},shiftedRegion={...region,x:region.x+dx,y:region.y+dy};
const moved=engine.deepRegion(shifted,shiftedBase,shiftedRegion,{maxCandidates:3,seedLimit:3});audit(moved,shiftedBase);
assert.equal(moved.candidates[0]?.letter,'A');assert(Math.hypot(moved.candidates[0].x-dx-result.candidates[0].x,moved.candidates[0].y-dy-result.candidates[0].y)<3);

const blank={width:360,height:360,ink:new Float32Array(360*360)};
assert.deepEqual(engine.deepRegion(blank,base,region).candidates,[]);
assert.deepEqual(engine.deepRegion(bitmap,base,{x:0,y:0,width:5,height:5}).candidates,[]);
assert.deepEqual(engine.deepRegion(bitmap,base,{x:500,y:500,width:10,height:10}).candidates,[]);
assert.equal(engine.fitGroup({width:32,height:32,ink:new Float32Array(1024)}).base,null);
for(const bad of [{...region,width:0},{...region,height:-1},{...region,x:NaN}])assert.throws(()=>engine.deepRegion(bitmap,base,bad));
assert.throws(()=>engine.deepRegion(bitmap,{...base,size:0},region));
assert.throws(()=>engine.deepRegion({width:2,height:2,ink:Float32Array.from([0,0,NaN,1])},base,region));
for(const options of [{letter:'A'},{maxAngle:180},{seedLimit:1000},{maxCandidates:0}])assert.throws(()=>engine.deepRegion(bitmap,base,region,options));
assert.throws(()=>engine.deepRegion(bitmap,base,region,{cancelled:()=>true}),/取消/);

// Execute the actual self-contained transport. Deep search uses the supplied base/ROI;
// its object-shaped result cannot be confused with normal detection's group array.
const messages=[],self={postMessage:m=>messages.push(m)};
new Function('self',Scan.workerSource(E.workerSource()))(self);
self.onmessage({data:{templates,image,operation:'deep',base,region}});
const message=messages.at(-1);assert(!message.error,message.error);assert(!Array.isArray(message.result));
assert.deepEqual(message.result,result);assert(messages.some(m=>m.progress?.stage?.startsWith('region-')));
messages.length=0;
self.onmessage({data:{templates,image,operation:'deep',base,region:{...region,width:0}}});
assert.equal(typeof messages.at(-1).error,'string');assert(!messages.at(-1).result);
assert.equal(JSON.stringify(base),beforeBase);assert.equal(JSON.stringify(region),beforeRegion);
console.log('PASS Siren deep region: synthetic pixel candidates, centre ROI/context, fixed geometry, translation, immutable inputs, validation/cancellation, real worker transport.');
