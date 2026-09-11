/* Optional private 16-group image. Gold text is evaluation-only, never used by
 * the image engine. This deliberately documents remaining errors, not 80/80. */
const assert=require('node:assert/strict'),fs=require('node:fs'),E=require('../src/siren-recognition.js'),Scan=require('../src/siren-scan.js'),F=require('./siren-fixture.cjs'),C=require('../src/siren-core.js'),PNG=require('./png.cjs');
const file=process.env.SIREN_INVERSE_FIXTURE;
if(!file){console.log('SKIP private inverse sample: set SIREN_INVERSE_FIXTURE');process.exit(0);}
const decode=a=>({...a,...PNG(Buffer.from(a.src.split(',')[1],'base64'))});
const templates={base:decode(F.assets.base),letters:Object.fromEntries(Object.entries(F.assets.letters).map(([k,a])=>[k,decode(a)])),path:F.path},contains=E.createRecognitionBoundary(templates.base,templates.path);
const expected='ELEVE NTHOU SANDF IVEHU NDRED NINET YNINE MINUS SEVEN THOUS ANDSI XHUND REDEI GHTYP LUSSI XTEEN'.split(' ');
function distance(a,b){let previous=Array.from({length:b.length+1},(_,n)=>n);for(let i=0;i<a.length;i++){const row=[i+1];for(let j=0;j<b.length;j++)row.push(Math.min(row[j]+1,previous[j+1]+1,previous[j]+(a[i]===b[j]?0:1)));previous=row;}return previous[b.length];}
const image=PNG(fs.readFileSync(file)),messages=[],start=Date.now(),scope={postMessage:m=>{if(!m.progress)messages.push(m);}};
new Function('self',Scan.workerSource(E.workerSource()))(scope);scope.onmessage({data:{templates,image,operation:'detect',limit:20}});
const end=messages.at(-1);assert(!end.error,end.error);assert.equal(end.result.length,16,'Find every group without fixed crop boxes');
const rows=end.result.map((raw,index)=>{
 const doc=C.create('review'),g=C.addGroup(doc),s=500/raw.base.size,dx=300-raw.base.cx*s,dy=300-raw.base.cy*s;
 g.cx=300;g.cy=300;g.baseSize=500;g.baseRotation=raw.base.rotation;
 const convert=p=>({...p,x:p.x*s+dx,y:p.y*s+dy,size:p.size*s});
 for(const p of raw.items){
  assert(contains(raw.base,p));assert(p.candidates.every(c=>contains(raw.base,c)));
  assert.equal(new Set(p.candidates.map(c=>c.letter)).size,p.candidates.length);
  const t=C.add(g,p.letter,convert(p));t.size=p.size*s;t.fit={rotation:p.rotation,score:p.score,candidates:p.candidates.map(convert)};
 }
 const reading=F.read(doc).text.replaceAll('[?]','?');return {group:index+1,expected:expected[index],reading,items:raw.items.length,certain:raw.items.filter(p=>p.letter).length,edit:distance(expected[index],reading)};
});
const edits=distance(expected.join(''),rows.map(g=>g.reading).join('')),exact=rows.filter(g=>g.reading===g.expected).length;
console.log(JSON.stringify({seconds:(Date.now()-start)/1000,rows,exactGroups:exact,items:rows.reduce((n,g)=>n+g.items,0),certainItems:rows.reduce((n,g)=>n+g.certain,0),edits},null,2));
assert(exact>=11,'Must not regress the eleven fully correct groups');assert(edits<=8,'Remaining edits must not exceed the measured baseline');
assert.equal(rows[1].reading,'NTHOU','Near-boundary U must be recovered without losing N/T/H/O');
const strict=E.createLocatorBoundary(templates.base,templates.path),second=end.result[1];
assert(second.items.some(p=>p.letter==='U'&&!strict(second.base,p)&&contains(second.base,p)),'Recover a pixel-fitted U inside the tolerance band, not a forced label');
console.log('PASS inverse-image regression floor; remaining errors are printed above. Certainty is not accuracy.');
