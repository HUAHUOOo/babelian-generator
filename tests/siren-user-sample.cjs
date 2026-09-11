/* Optional user-provided visual fixture. Labels exist ONLY in this test, never
   in the recognition engine. First-group rotated I is excluded by the user. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const F=require('./siren-fixture.cjs'),PNG=require('./png.cjs'),Scan=require('../src/siren-scan.js'),C=require('../src/siren-core.js');
const file=process.env.SIREN_BENCHMARK_FIXTURE;
if(!file){console.log('SKIP private Siren sample: set SIREN_BENCHMARK_FIXTURE');process.exit(0);}
const E=require(process.env.SIREN_BENCHMARK_ENGINE?path.resolve(process.env.SIREN_BENCHMARK_ENGINE):'../src/siren-recognition.js');
const decode=a=>({...a,...PNG(Buffer.from(a.src.split(',')[1],'base64'))});
const templates={base:decode(F.assets.base),letters:Object.fromEntries(Object.entries(F.assets.letters).map(([k,a])=>[k,decode(a)])),path:F.path};
const image=PNG(fs.readFileSync(file)),started=Date.now(),messages=[];
const scope={postMessage:m=>{messages.push(m);}};
new Function('self',Scan.workerSource(E.workerSource()))(scope);
scope.onmessage({data:{templates,image,operation:'detect',limit:20}});
const end=messages.at(-1);assert(!end.error,end.error);const groups=end.result;
const contains=E.createRecognitionBoundary(templates.base,templates.path);
const readings=groups.map(g=>{
 const points=F.geometry.basePoints({...g.base,baseSize:g.base.size,baseRotation:g.base.rotation});
 const order=g.items.map(i=>{
  assert(contains(g.base,i));assert(i.candidates.every(c=>contains(g.base,c)));
  const at=F.geometry.crossings(points,{...i,letter:i.letter||i.candidates[0]?.letter})[0]?.at??Infinity;
  return {at,letter:i.letter||'?',candidate:i.candidates[0]?.letter||'?'};
 }).sort((a,b)=>a.at-b.at);
 return {reading:order.map(i=>i.letter).join(''),top1:order.map(i=>i.candidate).join(''),items:g.items.length,certain:g.items.filter(i=>i.letter).length};
});
console.log(JSON.stringify({seconds:(Date.now()-started)/1000,dimensions:[image.width,image.height],readings},null,2));
if(!process.env.SIREN_BENCHMARK_ENGINE){
 assert.equal(groups.length,4,'No given group boxes: detect all four automatically');
 assert.deepEqual(readings.map(g=>g.reading),['FFT','YFOR','TYE','IGHT']);
 assert.equal(readings.reduce((sum,g)=>sum+g.certain,0),14);
 // Exercise the UI reading model too, including fitted rotation and tie handling,
 // after moving native-coordinate poses into a common 600-unit editing frame.
 const doc=C.create('review');
 for(const raw of groups){
  const g=C.addGroup(doc),s=500/raw.base.size,dx=300-raw.base.cx*s,dy=300-raw.base.cy*s;
  g.cx=300;g.cy=300;g.baseSize=500;g.baseRotation=raw.base.rotation;
  const convert=p=>({...p,x:p.x*s+dx,y:p.y*s+dy,size:p.size*s});
  for(const item of raw.items){const p=convert(item),t=C.add(g,p.letter,p);t.size=p.size;t.fit={rotation:p.rotation,score:p.score,candidates:item.candidates.map(convert)};}
 }
 assert.equal(F.read(doc).text,'FFT YFOR TYE IGHT','Normalized UI reading must agree, not only sorted detector poses');
 console.log('PASS 14/14 evaluable letters; deliberately rotated first-group I excluded, not repaired or inferred.');
}
