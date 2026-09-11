/* Offline crop-transform/encoding regression. Canvas and PNG decoding are doubles;
 * this does not claim browser rendering or image-recognition accuracy. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const repo=path.resolve(__dirname,'..');
const Core=require(path.join(repo,'src/siren-core.js'));
const source=fs.readFileSync(path.join(repo,'src/siren-ui.js'),'utf8');
const start=source.indexOf('  async function scanResultGroup('),end=source.indexOf('  function clearDeep(',start);
assert(start>=0&&end>start,'Cannot locate the production crop adapter');
const functionSource=source.slice(start,end).trim(),LIMIT=2800000;
const approximate=(actual,expected)=>assert(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
const shape=g=>JSON.parse(JSON.stringify(g,(key,value)=>key==='image'||key==='id'?undefined:value));

function harness(encodedLength=()=>100){
 const attempts=[],draws=[],cropCalls=[],created=[];let decodeCalls=0;
 const C={...Core,decode(value){decodeCalls++;return Core.decode(value);}};
 const document={createElement(tag){
  assert.equal(tag,'canvas');let width=0,height=0,transform=[1,1];
  const canvas={
   get width(){return width;},set width(value){width=value;transform=[1,1];},
   get height(){return height;},set height(value){height=value;transform=[1,1];},
   getContext(type){assert.equal(type,'2d');return context;},
   toDataURL(type){
    assert.equal(type,'image/png');assert.equal(width,height);
    // Only the data-URL format/length is material here; cropImage is a double.
    const prefix='data:image/png;base64,',length=encodedLength(width);
    const image=prefix+'A'.repeat(Math.max(4,Math.ceil((length-prefix.length)/4)*4));
    attempts.push({pixels:width,image});return image;
   }
  };
  const context={scale(x,y){transform=[transform[0]*x,transform[1]*y];},fillRect(){},drawImage(...args){draws.push({pixels:width,transform:[...transform],args});}};
  created.push(canvas);return canvas;
 }};
 const cropImage=async image=>{cropCalls.push(image);return {width:attempts.at(-1).pixels,height:attempts.at(-1).pixels};};
 // Boundary geometry has its own tests. This double only exercises the adapter's
 // existing result/candidate filtering without supplying hardcoded glyph answers.
 const containsLocator=(_base,pose)=>pose.allowed!==false;
 const scanResultGroup=vm.runInNewContext('('+functionSource+')',{C,document,cropImage,containsLocator});
 return {run:scanResultGroup,attempts,draws,cropCalls,created,get decodeCalls(){return decodeCalls;}};
}

function sample(){
 const candidate={letter:'G',x:1360,y:860,size:360,rotation:210,score:1.05};
 return {base:{cx:1200,cy:800,size:1000,rotation:-181},items:[
  {...candidate,method:'joint-pixel',candidates:[candidate,{...candidate,letter:'H',x:1370,y:865,size:350,rotation:-195,score:.88},{...candidate,letter:'I',allowed:false}]},
  {...candidate,allowed:false,candidates:[candidate]}
 ]};
}
function frameResult(pixels){
 const item={letter:'A',x:pixels*.42,y:pixels*.54,size:pixels*.22,rotation:7,score:.95};
 return {base:{cx:pixels*.5,cy:pixels*.46,size:pixels*.6,rotation:2},items:[{...item,candidates:[item,{...item,letter:'B',x:pixels*.43,score:.83}]}]};
}

(async()=>{
 const canvas={width:2400,height:1800},result=sample(),unchanged=JSON.stringify(result);
 const native=harness(),group=await native.run(result,canvas,false);
 assert.deepEqual(native.attempts.map(x=>x.pixels),[1200],'Large source crop should retain up to 1200 physical pixels');
 assert.equal(native.cropCalls.length,1);assert.equal(native.decodeCalls,1);
 assert.equal(native.cropCalls[0],group.image);
 const draw=native.draws[0];assert.deepEqual(draw.transform,[2,2]);
 assert.equal(draw.args[0],canvas);assert.deepEqual(draw.args.slice(1),[420,20,1560,1560,20,20,560,560]);
 approximate(group.cx,300);approximate(group.cy,300);approximate(group.baseSize,1000*560/1560);
 assert.equal(group.baseRotation,179);assert.equal(group.items.length,1);
 const token=group.items[0];approximate(token.x,(1360-420)*560/1560+20);approximate(token.y,(860-20)*560/1560+20);
 approximate(token.size,360*560/1560);assert.equal(token.fit.rotation,-150);assert.equal(token.fit.score,1);assert.equal(token.fit.method,'joint-pixel');
 assert.equal(token.fit.candidates.length,2,'Outside alternatives remain excluded');
 approximate(token.fit.candidates[1].x,(1370-420)*560/1560+20);
 approximate(token.fit.candidates[1].y,(865-20)*560/1560+20);
 approximate(token.fit.candidates[1].size,350*560/1560);assert.equal(token.fit.candidates[1].rotation,165);
 assert.equal(JSON.stringify(result),unchanged,'Crop conversion must not mutate the worker result');

 // 851 was a floating-point ceil regression: old rematches grew 851→852→853→854.
 const rematch=harness();let pixels=851,previous;
 for(let pass=0;pass<5;pass++){
  const current=await rematch.run(frameResult(pixels),{width:pixels,height:pixels},true);
  assert.equal(rematch.attempts.at(-1).pixels,851,'Repeated rematch must preserve physical frame size');
  approximate(current.cx,300);approximate(current.cy,276);approximate(current.baseSize,360);
  approximate(current.items[0].x,252);approximate(current.items[0].y,324);approximate(current.items[0].size,132);
  if(previous)assert.deepEqual(shape(current),shape(previous));previous=current;pixels=rematch.attempts.at(-1).pixels;
 }
 assert.deepEqual(rematch.attempts.map(x=>x.pixels),[851,851,851,851,851]);
 for(const entry of rematch.draws){approximate(entry.transform[0],851/600);approximate(entry.transform[1],851/600);assert.deepEqual(entry.args.slice(1),[0,0,851,851,0,0,600,600]);}

 // Encoder fallback changes physical pixels only, never the 600-unit geometry,
 // candidate coordinates, frame, fit method, or original worker result.
 for(const [accepted,expectedAttempts] of [[900,[1200,900]],[600,[1200,900,600]]]){
  const fallback=harness(p=>p>accepted?LIMIT+100:100),saved=await fallback.run(result,canvas,false);
  assert.deepEqual(fallback.attempts.map(x=>x.pixels),expectedAttempts);
  assert.deepEqual(shape(saved),shape(group),`Fallback to ${accepted} changed logical geometry`);
  assert.equal(fallback.cropCalls.length,1);assert.equal(fallback.decodeCalls,1);
  assert.equal(fallback.cropCalls[0],fallback.attempts.at(-1).image);
  for(const entry of fallback.draws){
   approximate(entry.transform[0],entry.pixels/600);approximate(entry.transform[1],entry.pixels/600);
   assert.deepEqual(entry.args.slice(1),draw.args.slice(1),'Fallback changed the source crop or logical frame');
  }
 }
 const smaller=harness(p=>p>600?LIMIT+100:100);
 const smallerGroup=await smaller.run(frameResult(851),{width:851,height:851},true);
 assert.deepEqual(smaller.attempts.map(x=>x.pixels),[851,600],'Fallback must not upscale 851 to 900');
 assert.deepEqual(shape(smallerGroup),shape(previous));

 const tooLarge=harness(()=>LIMIT+100);
 await assert.rejects(tooLarge.run(result,canvas,false),/截图裁片过大/);
 assert.deepEqual(tooLarge.attempts.map(x=>x.pixels),[1200,900,600]);
 assert.equal(tooLarge.cropCalls.length,0,'An oversized final image must not be decoded/cached');
 assert.equal(tooLarge.decodeCalls,0,'An oversized final image must not reach work-file validation');
 assert.equal(JSON.stringify(result),unchanged,'Failed encoding must not mutate source results');
 console.log('PASS Siren offline crop adapter: 1200px retention, stable 851px rematches, 900/600 encoding fallback, logical/candidate invariance, final-limit rejection before image decoding.');
})().catch(error=>{console.error(error);process.exitCode=1;});
