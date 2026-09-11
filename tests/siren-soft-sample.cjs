/* Private reference: gold is used after recognition ONLY. No annotated boxes,
 * character count, centres, or text are provided to the worker. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const F=require('./siren-fixture.cjs'),PNG=require('./png.cjs'),Scan=require('../src/siren-scan.js'),C=require('../src/siren-core.js');
const file=process.env.SIREN_SOFT_FIXTURE;
if(!file){console.log('SKIP private soft-edge sample: set SIREN_SOFT_FIXTURE');process.exit(0);}
const E=require(process.env.SIREN_SOFT_ENGINE?path.resolve(process.env.SIREN_SOFT_ENGINE):'../src/siren-recognition.js');
const decode=a=>({...a,...PNG(Buffer.from(a.src.split(',')[1],'base64'))});
const templates={base:decode(F.assets.base),letters:Object.fromEntries(Object.entries(F.assets.letters).map(([k,a])=>[k,decode(a)])),path:F.path};
const expected=['SEVEN','TYNIN','ESIXT','YFIVE'];
// User-confirmed wrong-orientation V (first group, third glyph) is not a valid
// default-bearing target. Keep the full supplied text above for transparency.
const evaluable=['SEEN','TYNIN','ESIXT','YFIVE'];
function distance(a,b){let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,prev[j+1]+1,prev[j]+(a[i]!==b[j])));prev=next;}return prev[b.length];}
const image=PNG(fs.readFileSync(file));
if(process.env.SIREN_SOFT_INVERT==='1')for(let i=0;i<image.data.length;i++)if(i%4!==3)image.data[i]=255-image.data[i];
const start=Date.now(),messages=[],scope={postMessage:m=>{if(!m.progress)messages.push(m);}};
new Function('self',Scan.workerSource(E.workerSource()))(scope);
scope.onmessage({data:{templates,image,operation:'detect',limit:20}});
const end=messages.at(-1);assert(!end.error,end.error);
const contains=E.createRecognitionBoundary(templates.base,templates.path);
const rows=end.result.map((raw,index)=>{
 const doc=C.create('review'),g=C.addGroup(doc),s=500/raw.base.size,dx=300-raw.base.cx*s,dy=300-raw.base.cy*s;
 Object.assign(g,{cx:300,cy:300,baseSize:500,baseRotation:raw.base.rotation});
 const convert=p=>({...p,x:p.x*s+dx,y:p.y*s+dy,size:p.size*s});
 assert(raw.items.length<=6);
 for(const item of raw.items){
  assert(contains(raw.base,item));assert(item.candidates.every(p=>contains(raw.base,p)));
  assert.equal(new Set(item.candidates.map(p=>p.letter)).size,item.candidates.length);
  const p=convert(item),t=C.add(g,p.letter,p);t.size=p.size;t.fit={rotation:p.rotation,score:p.score,candidates:item.candidates.map(convert)};
 }
 const reading=F.read(doc).text.replaceAll('[?]','?');
 return {group:index+1,expected:expected[index]||'',evaluable:evaluable[index]||'',reading,items:raw.items.length,certain:raw.items.filter(p=>p.letter).length,edit:distance(expected[index]||'',reading),validEdit:distance(evaluable[index]||'',reading)};
});
const report={seconds:(Date.now()-start)/1000,dimensions:[image.width,image.height],rows,exactGroups:rows.filter(p=>p.reading===p.expected).length,items:rows.reduce((n,p)=>n+p.items,0),certainItems:rows.reduce((n,p)=>n+p.certain,0),edits:rows.reduce((n,p)=>n+p.edit,0)};
console.log(JSON.stringify(report,null,2));
if(process.env.SIREN_SOFT_REPORT)fs.writeFileSync(process.env.SIREN_SOFT_REPORT,JSON.stringify(report,null,2));
assert.equal(rows.length,4,'Find all four groups without reference crop boxes');
if(!process.env.SIREN_SOFT_ENGINE){
 assert(report.exactGroups>=3);assert(report.edits<=1);assert(report.certainItems>=19);
 for(const row of rows){let at=0;for(const letter of row.reading){at=row.expected.indexOf(letter,at);assert(at>=0,'Accepted letters must preserve gold order with no substitutions');at++;}}
 assert(rows.every(r=>r.validEdit===0),'All 19 normal-orientation letters remain correct');
 console.log('PASS soft-edge regression: 19/19 valid letters; user-excluded V remains absent from the full 20-letter text.');
}
