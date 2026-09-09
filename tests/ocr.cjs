const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const OCR=require('../src/ocr-engine.js');
const readPNG=require('./png.cjs');
const glyphs=require('../src/glyphs.json'),ids=Object.keys(glyphs);
const rasters=Object.fromEntries(ids.map(id=>[id,readPNG(Buffer.from(glyphs[id].src.split(',')[1],'base64'))]));
const masks=ids.map(id=>{
 const img=rasters[id],data=new Uint8Array(img.width*img.height);
 for(let i=0;i<data.length;i++)data[i]=Number(img.data[i*4+3]>=128);
 return {id,width:img.width,height:img.height,data};
});
function draw(lines,{height=56,gap=2,light=false,noise=false}={}){
 const margin=10,rowHeight=height+12,width=Math.max(...lines.map(line=>line.reduce((s,id)=>s+Math.round(rasters[id].width/rasters[id].height*height)+gap,margin*2)));
 const image={width,height:lines.length*rowHeight+margin*2,data:new Uint8Array(width*(lines.length*rowHeight+margin*2)*4)};
 for(let i=0;i<image.data.length;i+=4){image.data[i]=image.data[i+1]=image.data[i+2]=light?35:244;image.data[i+3]=255;}
 lines.forEach((line,row)=>{let x=margin;for(const id of line){const src=rasters[id],w=Math.round(src.width/src.height*height);
  for(let y=0;y<height;y++)for(let xx=0;xx<w;xx++){
   const sx=Math.min(src.width-1,Math.floor((xx+.5)*src.width/w)),sy=Math.min(src.height-1,Math.floor((y+.5)*src.height/height));
   const a=src.data[(sy*src.width+sx)*4+3]/255,v=Math.round(light?35+209*a:244-209*a),at=((margin+row*rowHeight+y)*width+x+xx)*4;
   const delta=noise?((xx*31+y*7)%7)-3:0;image.data[at]=image.data[at+1]=image.data[at+2]=Math.max(0,Math.min(255,v+delta));
  }x+=w+gap;
 }});return image;
}
async function run(){
 const templates=OCR.prepareTemplates(masks);
 for(const mask of masks){const best=OCR.matchDescriptor(OCR.describe(mask),templates);assert.equal(best[0].id,mask.id);assert(best[0].score>.99);}
 console.log('PASS OCR: all 58 native templates match their own opaque IDs.');
 let total=0,correct=0;
 for(const opts of [{height:64,gap:4},{height:40,gap:1,light:true},{height:28,gap:0,noise:true}]){
  const lines=[ids.slice(0,19),ids.slice(19,38),ids.slice(38)],result=await OCR.recognize(draw(lines,opts),masks);
  const got=result.lines.flatMap(l=>l.tokens.map(t=>t.id)),expected=lines.flat();
  const matches=got.filter((id,i)=>id===expected[i]).length;total+=expected.length;correct+=matches;
  console.log('OCR sample',opts,'glyphs',got.length,'correct IDs',matches+'/'+expected.length,'certain',result.lines.flatMap(l=>l.tokens).filter(t=>t.certain).length);
  if(got.join('|')!==expected.join('|'))console.log('Expected:',expected.join(' '),'\nActual:  ',got.join(' '));
  if(opts.height>=40)assert.deepEqual(got,expected);
  else result.lines.flatMap(l=>l.tokens).forEach((t,i)=>{if(t.id!==expected[i])assert.equal(t.certain,false,'Incorrect low-res result must remain uncertain');});
 }
 const random=ids.filter((_,i)=>i%3===0).reverse();
 const r=await OCR.recognize(draw([random]),masks);
 assert.deepEqual(r.lines[0].tokens.map(t=>t.id),random);
 const map=Object.fromEntries(ids.map((id,i)=>[id,i%2?'X':'x']));map[random[0]]='CUSTOM WORD';
 const confirmed={lines:r.lines.map(l=>({...l,tokens:l.tokens.map(t=>({...t,manual:true}))}))};
 const s=OCR.transcribe(confirmed,map);assert(s.startsWith('CUSTOM WORD'));assert(!s.includes('undefined'));
 const payload=OCR.toWriter(confirmed,map);assert.equal(payload.text,s);assert.equal(payload.spans.length,random.length);
 payload.spans.forEach((span,i)=>{assert.equal(span.glyph,random[i]);assert.equal(span.text,payload.text.slice(span.start,span.end));});
 map[random[0]]='';assert(OCR.transcribe(confirmed,map).startsWith('[未映射]'));
 confirmed.lines[0].tokens[0].manual=false;confirmed.lines[0].tokens[0].certain=false;
 assert(OCR.transcribe(confirmed,map).startsWith('[?]'));
 assert.equal(OCR.toWriter(confirmed,map).spans.length,random.length-1);
 const joined={lines:[confirmed.lines[0],confirmed.lines[0]]};
 assert.equal(OCR.transcribe(joined,map,{joinLines:true}),OCR.transcribe(confirmed,map).repeat(2));
 assert.equal(OCR.transcribe(joined,map),[OCR.transcribe(confirmed,map),OCR.transcribe(confirmed,map)].join('\n'));
 const blank=draw([[]]);assert.equal((await OCR.recognize(blank,masks)).lines.length,0);
 const bad={...blank,data:new Uint8Array(1)};await assert.rejects(OCR.recognize(bad,masks));
 await assert.rejects(OCR.recognize(draw([random]),masks,{cancelled:()=>true}),/取消/);
 const messages=[],workerContext={setTimeout,postMessage:value=>messages.push(value)};
 vm.createContext(workerContext);vm.runInContext(OCR.workerSource(),workerContext);
 await workerContext.onmessage({data:{image:draw([random]),templates:masks,options:{}}});
 assert(messages.some(m=>m.progress));assert.deepEqual(Array.from(messages.at(-1).result.lines[0].tokens,t=>t.id),random);
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const htmlIDs=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 for(const id of htmlIDs.filter(id=>id.startsWith('ocr-')))assert.equal(htmlIDs.filter(x=>x===id).length,1,'Duplicate HTML ID '+id);
 const ui=fs.readFileSync(path.join(__dirname,'../src/ocr-ui.js'),'utf8');
 for(const match of ui.matchAll(/\$\('(ocr-[^']+)'\)/g))assert(htmlIDs.includes(match[1]),'Missing control '+match[1]);
 assert(!/\b(fetch|XMLHttpRequest|localStorage|sessionStorage)\b/.test(ui),'OCR UI must not upload or persist source screenshots');
 assert(!/\bfetch\b/.test(fs.readFileSync(path.join(__dirname,'../src/ocr-engine.js'),'utf8')));
 console.log('PASS OCR integration: worker messages, cancellation, controls, span-safe append, no screenshot upload/storage.');
 console.log(`PASS OCR: ${correct}/${total} generated-sample glyph IDs; mixed case/word/current mapping; unknown markers; blank/invalid image; no language inference.`);
 // Optional local real-world fixtures, deliberately not bundled or uploaded.
 if(process.env.BABELIAN_OCR_FIXTURE){
  const image=readPNG(fs.readFileSync(process.env.BABELIAN_OCR_FIXTURE));
  const result=await OCR.recognize(image,masks);
  console.log('Local fixture:',result.lines.map(l=>l.tokens.map(t=>t.id||'?').join(' ')).join('\n'));
  console.log('Uncertain:',result.lines.flatMap(l=>l.tokens).filter(t=>!t.certain).length);
  if(process.env.BABELIAN_OCR_AUDIT)fs.writeFileSync(process.env.BABELIAN_OCR_AUDIT,JSON.stringify(result));
 }
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={masks,rasters,draw};
