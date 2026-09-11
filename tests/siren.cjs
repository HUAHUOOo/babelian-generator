const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const C=require('../src/siren-core.js'),F=require('../src/text-format.js'),I=require('../src/siren-intersections.js'),real=require('./siren-fixture.cjs'),root=path.resolve(__dirname,'..');
const approx=(a,b)=>assert(Math.abs(a-b)<1e-6);
const doc=C.create(),g=doc.groups[0];for(const letter of 'ABCDEF')C.add(g,letter);
assert.throws(()=>C.add(g,'G'),/6个/);assert.equal(g.items.length,6);g.items.pop();C.add(g,'G');assert.equal(g.items.length,6);
// No geometry means no known ordering; never fall back to item-center radius.
assert.equal(C.read(doc).text,'[?]'.repeat(6));assert.equal(C.read(doc).unplaced,6);
assert(real.geometry.arrange(g));assert.equal(real.read(doc).text,'ABCDEG');
const orbit=C.create(),og=orbit.groups[0],ot=C.add(og,'M');
for(const [bearing,rotation] of [[90,0],[-90,-180],[0,-90],[180,90],[179,89],[-179,91]]){C.polar(og,ot,100,bearing);approx(ot.rotation,rotation);}
const prior=JSON.stringify(ot);assert.throws(()=>C.polar(og,ot,420,0),/超出画布/);assert.equal(JSON.stringify(ot),prior);
assert.equal(C.move(og,ot,{x:NaN,y:0}),false);assert.equal(JSON.stringify(ot),prior);
assert(C.move(og,ot,{x:500,y:500}));approx(ot.x,500);approx(ot.y,500);approx(ot.rotation,-45);approx(C.radius(og,ot),Math.hypot(200,200));
assert(C.move(og,ot,{x:300,y:300}));assert.equal(C.radius(og,ot),0);assert.equal(ot.rotation,0);
assert(C.move(og,ot,{x:250,y:260}));approx(ot.rotation,C.normalize(C.angle(og,ot)-90));assert.equal(ot.letter,'M');
// All 26 letters use one calibrated source-frame scale; same position is independent of insertion/drag history.
for(const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'){
 const group=C.group(),a=C.add(group,letter,{x:300,y:400}),b=C.add(group,letter,{x:300,y:400});
 approx(a.size,190);approx(b.size,190);approx(a.rotation,0);approx(b.rotation,0);
 for(const p of [{x:200,y:300},{x:300,y:200},{x:400,y:300},{x:300,y:300},{x:300,y:400}])C.move(group,a,p);
 approx(a.rotation,b.rotation);C.polar(group,a,200,90);approx(a.rotation,b.rotation);
 group.cx=200;group.cy=200;C.reorient(group);approx(a.rotation,C.rotationFor(group,a));approx(b.rotation,C.rotationFor(group,b));
 const rotation=a.rotation;C.resizeBase(group,900);approx(a.size,342);approx(a.rotation,rotation);
 group.baseRotation=90;approx(C.rotationFor(group,a),rotation);approx(C.add(group,letter).size,342);
}
const example=real.sample();assert.equal(real.read(example).text,'BDAEFC');
const fixture=require('./fixtures/siren-3491.json');assert.equal(Object.entries(fixture.letters).sort((a,b)=>a[1].centerDistance-b[1].centerDistance).map(x=>x[0]).join(''),'ADBFEC');
const metrics=real.geometry.analyze(example.groups[0]);assert(metrics.items.every(i=>i.hits.length>=2));
for(const m of metrics.items)assert.equal(m.at,Math.min(...m.hits.map(h=>h.at)));
const before=metrics.items[0].at;example.groups[0].items[0].rotation+=20;
assert.equal(real.geometry.analyze(example.groups[0]).items[0].at,before,'Stale saved rotation cannot override the position rule');
C.move(example.groups[0],example.groups[0].items[0],{x:400,y:200});assert.notEqual(real.geometry.analyze(example.groups[0]).items[0].at,before);
// Synthetic masks: farther center intersects first; only ink counts, not bounding boxes.
const glyph={width:10,height:10,pivotX:.5,pivotY:.5},alphaA=new Uint8Array(100),alphaB=new Uint8Array(100);
for(let y=0;y<10;y++){alphaA[y*10+1]=255;alphaA[y*10+2]=255;alphaB[y*10+7]=255;alphaB[y*10+8]=255;}
const synthetic=I.prepare({base:{...glyph,width:100,height:100},letters:{A:glyph,B:glyph},path:{points:[[0,50],[100,50]]},masks:{A:{width:10,height:10,alpha:alphaA},B:{width:10,height:10,alpha:alphaB}}});
const sd=C.create(),sg=sd.groups[0];sg.baseSize=100;const sa=C.add(sg,'A',{x:300,y:310}),sb=C.add(sg,'B',{x:300,y:300});sa.size=50;sb.size=50;
const synthRead=()=>C.read(sd,g=>synthetic.analyze(g));assert(C.radius(sg,sa)>C.radius(sg,sb));assert.equal(synthRead().text,'AB');
sa.y=400;assert.equal(synthRead().unplaced,1);assert.equal(synthRead().text,'[?][?]');
sa.y=300;sa.letter='B';sa.x=300;assert(synthRead().ambiguous);assert.equal(synthRead().text,'[?][?]');
for(const text of ['HELLOWORLD','ABCDEF','ZZZZZZ','MNOPQR','BDAEFC','ABCDEFGHIJKLMNOPQRSTUVWXYZ','A'.repeat(300)]){
 const generated=C.fromText(text);assert(generated.groups.every(g=>real.geometry.arrange(g)));assert.equal(real.read(generated).text,text);
}
const noWords=C.fromText('ABC DEFGHI JKL MN');assert(noWords.groups.every(g=>real.geometry.arrange(g)));assert.deepEqual(real.read(noWords).groups,['ABCDEF','GHIJKL','MN']);C.addGroup(noWords);assert.equal(real.read(noWords).text,'ABCDEFGHIJKLMN');
assert.equal(real.read(C.fromText('')).text,'');assert.throws(()=>C.fromText('HELLO!'),/标点/);assert.throws(()=>C.fromText('A'.repeat(301)),/300/);assert.throws(()=>C.add(C.group(),'<script>'),/A–Z/);
const restored=C.decode(JSON.parse(JSON.stringify(doc)));assert.equal(real.read(restored).text,real.read(doc).text);assert.notEqual(restored.groups[0].id,doc.groups[0].id);
const v1=JSON.parse(JSON.stringify(doc));v1.version=1;v1.gear=1;delete v1.groups[0].baseSize;delete v1.groups[0].baseRotation;assert.equal(C.decode(v1).version,6);assert.equal(C.decode(v1).groups[0].items[0].contact,null);
for(const version of [1,2]){
 const legacy=JSON.parse(JSON.stringify(doc));legacy.version=version;legacy.gear=-2;
 legacy.groups[0].items[0].size=110;legacy.groups[0].items[1].size=155;legacy.groups[0].items[0].rotation=0;
 const upgraded=C.decode(legacy),group=upgraded.groups[0];assert.equal(upgraded.version,6);assert(!('gear' in upgraded));
 approx(group.items[0].size,190);approx(group.items[1].size,155);group.items.forEach(i=>approx(i.rotation,C.rotationFor(group,i)));
 assert.deepEqual(group.items.map(i=>[i.letter,i.x,i.y]),legacy.groups[0].items.map(i=>[i.letter,i.x,i.y]));
}
const custom=C.create();C.add(custom.groups[0],'A').size=110;assert.equal(C.decode(custom).groups[0].items[0].size,110,'v3 manual size must be preserved');C.resizeBase(custom.groups[0],900);assert.equal(C.decode(custom).version,6);
const manual=C.create(),mg=manual.groups[0],mi=C.add(mg,'B',{x:300,y:400});C.setRotationMode(mg,mi,true);mi.rotation=47;
C.move(mg,mi,{x:300,y:200});approx(C.rotationFor(mg,mi),47);mg.cx=250;C.reorient(mg);approx(mi.rotation,47);C.resizeBase(mg,600);approx(mi.rotation,47);
const manualRestored=C.decode(manual);assert.equal(manualRestored.groups[0].items[0].rotationMode,'manual');approx(manualRestored.groups[0].items[0].rotation,47);
mi.rotationMode='invalid';assert.throws(()=>C.decode(manual));mi.rotationMode='manual';C.setRotationMode(mg,mi,false);approx(mi.rotation,C.normalize(C.angle(mg,mi)-90));
const legacy4=structuredClone(doc);legacy4.version=4;assert.equal(C.decode(legacy4).version,6);
for(const mutator of [v=>v.version=99,v=>v.gear=Infinity,v=>v.groups[0].cx=NaN,v=>v.groups[0].items[0].x=-1,v=>v.groups[0].items[0].rotation=1000,v=>v.groups[0].baseSize=3000,v=>v.groups[0].items[0].size=500,v=>v.groups[0].items[0].letter='AA',v=>v.groups[0].items[0].contact={x:NaN,y:0},v=>v.groups[0].items.push({...v.groups[0].items[0]}),v=>v.groups[0].image='https://example.org/private.png']){const value=JSON.parse(JSON.stringify(doc));mutator(value);assert.throws(()=>C.decode(value));}
const review=real.sample();review.mode='review';review.groups[0].image='data:image/png;base64,AAAA';assert.equal(real.read(review).unplaced,6);
const partial=C.create('review'),pg=C.addGroup(partial),later=C.addGroup(partial);for(const l of ['A','B',null,'D'])C.add(pg,l);C.add(later,'E');
const partialMetrics=group=>({items:group.items.map((i,n)=>({id:i.id,at:group===pg&&n===2?null:n*20+10}))});
assert.equal(C.read(partial,partialMetrics).text,'ABD E');assert.equal(C.read(partial,partialMetrics).unplaced,1);assert.deepEqual(C.read(partial,partialMetrics).unplacedGroups,[{index:0,letters:['?']}]);
assert.equal(C.read(partial,group=>({items:group.items.map((i,n)=>({id:i.id,at:n*20+10}))})).text,'AB[?]D E');
const points=real.geometry.basePoints(review.groups[0]);review.groups[0].items.forEach((i,n)=>i.contact={...points[100+n*600]});assert.equal(real.read(review).text,'BDAEFC');
assert.equal(real.read(C.decode(review)).text,'BDAEFC');C.move(review.groups[0],review.groups[0].items[0],{x:400,y:400});assert.equal(review.groups[0].items[0].contact,null);
assert.equal(F.reflow({text:'HELLOWORLD',spans:[]},'HELLO WORLD!').text,'HELLO WORLD!');assert.throws(()=>F.reflow({text:'HELLOWORLD'},'HELLO WORD!'));
const assets=real.assets;assert.deepEqual(Object.keys(assets.letters),[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']);
for(const [id,a] of [['base',assets.base],...Object.entries(assets.letters)]){const data=Buffer.from(a.src.split(',')[1],'base64');assert.equal(data.readUInt32BE(16),id==='base'?700:420);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),a.provenance.assetSha256);}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),ui=fs.readFileSync(path.join(root,'src/siren-ui.js'),'utf8'),markup=html.split('<script>')[0],ids=[...markup.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
for(const match of ui.matchAll(/\$\('(siren-[a-z-]+)'\)/g))assert(ids.includes(match[1]),'Missing UI element '+match[1]);
assert(!/siren-lock-radius|lockRadius|siren-gear/.test(ui));assert(!/localStorage|fetch\(/.test(ui));assert(html.includes('SirenIntersections.prepare'));
assert(/id="siren-rotation"[^>]*readonly/.test(markup));assert(markup.includes('id="siren-rotation-mode"'));assert(markup.includes('id="siren-radius-slider"'));
console.log('PASS Siren: BDAEFC fixture, uniform calibrated scale, all-letter cardinal bearings and path-independent rotation, real ink crossings, ties/detached glyphs, batch arrangement, legacy migration and v4 imports.');
