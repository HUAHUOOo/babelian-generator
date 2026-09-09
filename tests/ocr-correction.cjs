const assert=require('node:assert/strict');
const OCR=require('../src/ocr-engine.js'),correction=require('../src/ocr-correction.js');
const {draw,masks}=require('./ocr.cjs');
async function run(){
  const crop={x:50,y:70,width:250,height:150};
  assert.deepEqual(correction.rectangle({x:61.2,y:82.1},{x:81.1,y:110},crop),{x:11,y:12,width:21,height:28});
  assert.deepEqual(correction.rectangle({x:81.1,y:110},{x:61.2,y:82.1},crop),{x:11,y:12,width:21,height:28});
  assert.throws(()=>correction.rectangle({x:49,y:70},{x:60,y:80},crop),/金色/);
  assert.throws(()=>correction.rectangle({x:50,y:70},{x:301,y:80},crop),/金色/);
  assert.throws(()=>correction.rectangle({x:60,y:80},{x:60,y:80},crop),/太小/);
  const image=draw([['A','b','C'],['D','e','F']],{height:64,gap:6});
  const result=await OCR.recognize(image,masks),prepared=OCR.prepareTemplates(masks);
  const oldBox={...result.lines[1].tokens[1].box};
  const before=structuredClone(result),position={line:1,token:1};
  const fixed=correction.replace(OCR,result,position,oldBox,image,prepared);
  assert.equal(fixed.token.id,'e');assert(!fixed.token.certain&&!fixed.token.manual);
  assert.deepEqual(fixed.token.box,oldBox);assert.equal(fixed.overlap.length,0);
  for(const [li,line] of result.lines.entries())for(const [ti,t] of line.tokens.entries())if(li!==1||ti!==1)assert.deepEqual(t,before.lines[li].tokens[ti]);
  assert.equal(result.lines[1].tokens.length,before.lines[1].tokens.length);
  const snapshot=JSON.stringify(result);
  assert.throws(()=>correction.replace(OCR,result,position,{x:0,y:0,width:4,height:4},image,prepared),/笔画/);
  assert.equal(JSON.stringify(result),snapshot,'empty rectangle must not mutate any result');
  assert.throws(()=>correction.replace(OCR,result,position,{x:-1,y:0,width:10,height:10},image,prepared),/超出/);
  assert.throws(()=>correction.replace(OCR,result,{line:9,token:0},oldBox,image,prepared),/已变化/);
  assert.equal(JSON.stringify(result),snapshot);
  console.log('PASS rebox: reverse drag and crop coordinates, region limits, blank rejection, target-only replacement below threshold, cross-line preservation, candidate requires manual confirmation.');

  // Deterministic geometry: do not depend on a template's candidate score to
  // test the exact 20% threshold and which neighbors are authorized to change.
  const mockToken=(x,width,id)=>({box:{x,y:10,width,height:100},id,certain:true,manual:true,candidates:[{id,score:1}],score:1});
  const seed=()=>({lines:[{box:{x:10,y:10,width:540,height:100},tokens:[mockToken(10,100,'outerLeft'),mockToken(120,100,'left'),mockToken(230,100,'selected'),mockToken(340,100,'right'),mockToken(450,100,'outerRight')]},
    {box:{x:10,y:150,width:100,height:100},tokens:[{...mockToken(10,100,'otherLine'),box:{x:10,y:150,width:100,height:100}}]}],threshold:127,polarity:'dark'});
  const fakeImage={width:600,height:280},calls=[];
  const fakeOCR={
    binarize:()=>({width:600,height:280,data:new Uint8Array(600*280).fill(1)}),bounds:(_m,x,y,right,bottom)=>({x,y,width:right-x,height:bottom-y}),
    describe:()=>({}),matchDescriptor:()=>[{id:'anchor',score:1}],
    recognizeLine:(_m,box)=>{calls.push({...box});return [{...mockToken(box.x,box.width,'resegmented'),box:{...box}}];}
  };
  const pos={line:0,token:2};
  for(const overlapWidth of [19,20]){
    const r=seed(),previous=structuredClone(r),box={x:220-overlapWidth,y:10,width:130+overlapWidth,height:100};calls.length=0;
    const change=correction.replace(fakeOCR,r,pos,box,fakeImage,[]);
    assert.equal(change.rematched,false);assert.equal(calls.length,0);
    for(const i of [0,1,3,4])assert.deepEqual(r.lines[0].tokens[i],previous.lines[0].tokens[i]);
  }
  // Exactly one fifth of a glyph's area (not width or IoU) is still unchanged.
  const hits=correction.overlaps(seed(),pos,{x:120,y:10,width:210,height:20});
  assert.equal(hits.find(p=>p.token===1).ratio,.2);assert(!hits.find(p=>p.token===1).rematch);
  assert(correction.overlaps(seed(),pos,{x:120,y:10,width:210,height:21}).find(p=>p.token===1).rematch);
  for(const box of [{x:199,y:10,width:131,height:100},{x:230,y:10,width:131,height:100},{x:199,y:10,width:162,height:100}]){
    const r=seed(),previous=structuredClone(r);calls.length=0;
    const change=correction.replace(fakeOCR,r,pos,box,fakeImage,[]);
    assert(change.rematched);assert.equal(r.lines[0].tokens[change.position.token],change.token);
    assert.deepEqual(change.token.box,box);assert.equal(r.lines[0].tokens[0],r.lines[0].tokens.find(t=>t.id==='outerLeft'));
    for(const id of ['outerLeft','outerRight'])assert.deepEqual(r.lines[0].tokens.find(t=>t.id===id),previous.lines[0].tokens.find(t=>t.id===id));
    assert.deepEqual(r.lines[1],previous.lines[1]);
    for(const area of calls)assert(area.x+area.width<=box.x||area.x>=box.x+box.width,'automatic search must exclude the anchored glyph');
    for(const t of r.lines[0].tokens.filter(t=>t.id==='resegmented'))assert(!t.manual&&!t.certain);
    if(box.x===230)assert.deepEqual(r.lines[0].tokens[1],previous.lines[0].tokens[1],'untouched left keeps manual choice');
    if(box.x+box.width===330)assert.deepEqual(r.lines[0].tokens.at(-2),previous.lines[0].tokens.at(-2),'untouched right keeps manual choice');
  }
  // Fully absorbed old glyphs vanish; their ink is represented by the anchor,
  // and the selected index follows the new item count instead of the old index.
  const swallowed=seed(),whole={x:120,y:10,width:320,height:100};calls.length=0;
  const merged=correction.replace(fakeOCR,swallowed,pos,whole,fakeImage,[]);
  assert.equal(merged.affected,2);assert.equal(merged.replaced,3);assert.equal(merged.generated,1);assert.equal(merged.position.token,1);
  assert.deepEqual(swallowed.lines[0].tokens.map(t=>t.id),['outerLeft','anchor','outerRight']);assert.equal(calls.length,0);
  const all=seed();const allChange=correction.replace(fakeOCR,all,pos,{x:10,y:10,width:540,height:100},fakeImage,[]);
  assert.equal(allChange.position.token,0);assert.equal(all.lines[0].tokens.length,1);
  const atomic=seed(),original=JSON.stringify(atomic);
  assert.throws(()=>correction.replace({...fakeOCR,recognizeLine(){throw Error('cannot segment');}},atomic,pos,{x:199,y:10,width:162,height:100},fakeImage,[]),/cannot segment/);
  assert.equal(JSON.stringify(atomic),original,'failed local rematch must preserve all corrections');
  console.log('PASS overlap rematch: below/exactly/above 20%, area denominator, both directions, fixed anchor, absorbed frames, new selection index, unchanged remote/manual choices, atomic failure.');

  // Actual image-matching integration: simulate a wrong boundary that split one
  // real glyph across the target and its predecessor, then restore that glyph.
  const picture=draw([['D','E','F','G','H']],{height:64,gap:4});
  const truth=await OCR.recognize(picture,masks);
  assert.deepEqual(truth.lines[0].tokens.map(t=>t.id),['D','E','F','G','H']);
  const corrupted=structuredClone(truth),b=truth.lines[0].tokens[2].box;
  const splitAt=b.x+Math.ceil(b.width*.55),earlier=corrupted.lines[0].tokens[1];
  earlier.box.width=splitAt-earlier.box.x;
  corrupted.lines[0].tokens[2].box={...b,x:splitAt,width:b.x+b.width-splitAt};
  // Wider prior frame must be covered by >20% for this particular glyph raster.
  const coverage=correction.overlaps(corrupted,pos,b).find(p=>p.token===1);
  assert(coverage?.rematch,'real fixture should exercise the threshold');
  const restored=correction.replace(OCR,corrupted,pos,b,picture,prepared);
  assert(restored.rematched);assert.deepEqual(corrupted.lines[0].tokens.map(t=>t.id),['D','E','F','G','H']);
  assert.deepEqual(corrupted.lines[0].tokens[0],truth.lines[0].tokens[0]);
  assert.deepEqual(corrupted.lines[0].tokens.at(-1),truth.lines[0].tokens.at(-1));
  assert.deepEqual(corrupted.lines[0].tokens[restored.position.token].box,b);
  assert(!corrupted.lines[0].tokens[1].manual&&!corrupted.lines[0].tokens[1].certain);
  console.log('PASS real glyph resegmentation: misplaced split restored using image-only matching; no duplicate glyph or loss of preserved neighbors.');

  // No >20% overlap at all: old target stole strokes from both neighbors.
  // Shrinking it to the correct glyph must return those strokes to each side.
  for(const sides of ['left','right','both']){
    const r=structuredClone(truth),line=r.lines[0].tokens;
    if(sides!=='right'){
      const e=line[1].box,cut=e.x+Math.floor(e.width*.6);
      line[2].box={...line[2].box,x:cut,width:line[2].box.x+line[2].box.width-cut};e.width=cut-e.x;
    }
    if(sides!=='left'){
      const g=line[3].box,cut=g.x+Math.floor(g.width*.4);
      line[2].box.width=cut-line[2].box.x;g.width=g.x+g.width-cut;g.x=cut;
    }
    assert.equal(correction.overlaps(r,pos,b).filter(hit=>hit.rematch).length,0);
    const change=correction.replace(OCR,r,pos,b,picture,prepared);
    assert(change.rematched&&change.released>0);assert.equal(change.affected,0);
    assert.deepEqual(r.lines[0].tokens.map(t=>t.id),['D','E','F','G','H']);
    assert.deepEqual(r.lines[0].tokens[0],truth.lines[0].tokens[0]);assert.deepEqual(r.lines[0].tokens.at(-1),truth.lines[0].tokens.at(-1));
    assert.deepEqual(r.lines[0].tokens[change.position.token].box,b);
  }
  // Trimming whitespace alone does not reset the neighboring manual matches.
  const whitespace=structuredClone(truth),wb=whitespace.lines[0].tokens[2].box;
  wb.x-=1;wb.width+=2;const quiet=correction.replace(OCR,whitespace,pos,b,picture,prepared);
  assert(!quiet.rematched);assert.deepEqual(whitespace.lines[0].tokens[1],truth.lines[0].tokens[1]);
  // One old box, two real glyphs: preserve the released edge as a new item
  // when there is no adjacent box to receive it.
  for(const index of [0,1]){
    const img=draw([['F','G']],{height:64,gap:4}),clean=await OCR.recognize(img,masks),row=clean.lines[0];
    const old={...row.tokens[0],box:{...row.box}},r={...clean,lines:[{box:row.box,tokens:[old]}]};
    const answer=correction.replace(OCR,r,{line:0,token:0},row.tokens[index].box,img,prepared);
    assert.deepEqual(r.lines[0].tokens.map(t=>t.id),['F','G']);assert.equal(answer.position.token,index);
  }
  // Vertical exclusions: above/below strokes are kept, but anchor pixels must
  // not leak into a neighbor whose rectangular bounds geometrically overlap it.
  const vi={width:70,height:40,data:new Uint8Array(70*40*4).fill(255)};
  function ink(rect){for(let y=rect.y;y<rect.y+rect.height;y++)for(let x=rect.x;x<rect.x+rect.width;x++){const i=(y*70+x)*4;vi.data[i]=vi.data[i+1]=vi.data[i+2]=0;}}
  const vleft={x:5,y:12,width:12,height:20},vright={x:50,y:12,width:12,height:20},anchor={x:25,y:12,width:14,height:20};
  ink(vleft);ink(vright);ink(anchor);ink({x:25,y:5,width:4,height:4});
  const vtoken=box=>({box,id:'old',candidates:[],certain:true,manual:true});
  const vr={lines:[{box:{x:5,y:5,width:57,height:27},tokens:[vtoken(vleft),vtoken({x:25,y:5,width:14,height:27}),vtoken(vright)]}],threshold:127,polarity:'dark'};
  const vanswer=correction.replace(OCR,vr,{line:0,token:1},anchor,vi,prepared);
  assert(vanswer.released>0);assert.deepEqual(vr.lines[0].tokens[vanswer.position.token].box,anchor);
  const owned=(t,x,y)=>x>=t.box.x&&x<t.box.x+t.box.width&&y>=t.box.y&&y<t.box.y+t.box.height&&!(t.excludedBoxes||[]).some(e=>x>=e.x&&x<e.x+e.width&&y>=e.y&&y<e.y+e.height);
  for(let y=0;y<40;y++)for(let x=0;x<70;x++)if(vi.data[(y*70+x)*4]===0){
    const owners=vr.lines[0].tokens.filter(t=>owned(t,x,y));assert(owners.length>=1,`lost stroke ${x},${y}`);
    if(x>=anchor.x&&x<anchor.x+anchor.width&&y>=anchor.y&&y<anchor.y+anchor.height)assert.equal(owners.length,1,'anchor pixels must have a single owner');
  }
  // Merging the assigned fragment and its owner may restore excluded pixels;
  // otherwise follow-up split/review keeps those pixels out of classification.
  const excluded=[{box:{x:5,y:5,width:30,height:27},excludedBoxes:[anchor]},vtoken(anchor)];
  assert.deepEqual(correction.exclusionsFor(excluded),[]);
  assert.deepEqual(correction.exclusionsFor([excluded[0]]),[anchor]);
  console.log('PASS released strokes: left/right/both without overlap; blank-only shrink; missing edge neighbor; above/below pixels preserved; anchored pixels excluded from neighbors and later split/merge.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
