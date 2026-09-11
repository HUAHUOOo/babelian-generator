/* Private screenshot regression. Only cropped glyph pixels reach the engine.
 * Exact case and ligature IDs are checked, never inferred from English words. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),PNG=require('./png.cjs'),{masks}=require('./ocr.cjs'),fixtures=require('./fixtures/babelian-350x.json');
const directory=process.env.BABELIAN_REFERENCE_DIR;
if(!directory){console.log('SKIP private Babelian screenshots: set BABELIAN_REFERENCE_DIR');process.exit(0);}
const OCR=require(process.env.BABELIAN_REFERENCE_ENGINE?path.resolve(process.env.BABELIAN_REFERENCE_ENGINE):'../src/ocr-engine.js');
function crop(src,[x,y,width,height]){const data=new Uint8Array(width*height*4);for(let row=0;row<height;row++)data.set(src.data.subarray(((y+row)*src.width+x)*4,((y+row)*src.width+x+width)*4),row*width*4);return {width,height,data};}
function resize(src,factor){
 const width=Math.round(src.width*factor),height=Math.round(src.height*factor),data=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const sx=(x+.5)*src.width/width-.5,sy=(y+.5)*src.height/height-.5,ix=Math.floor(sx),iy=Math.floor(sy),dx=sx-ix,dy=sy-iy;
  for(let c=0;c<4;c++){let value=0;for(let yy=0;yy<=1;yy++)for(let xx=0;xx<=1;xx++){const px=Math.max(0,Math.min(src.width-1,ix+xx)),py=Math.max(0,Math.min(src.height-1,iy+yy));value+=src.data[(py*src.width+px)*4+c]*(xx?dx:1-dx)*(yy?dy:1-dy);}data[(y*width+x)*4+c]=Math.round(value);}
 }return {width,height,data};
}
function distance(a,b){let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const row=[i+1];for(let j=0;j<b.length;j++)row.push(Math.min(row[j]+1,prev[j+1]+1,prev[j]+(a[i]===b[j]?0:1)));prev=row;}return prev[b.length];}
(async()=>{
 const rows=[];
 for(const fixture of fixtures.samples){
  const image=PNG(fs.readFileSync(path.join(directory,fixture.file)));assert.deepEqual([image.width,image.height],fixture.dimensions,'Use the original attachment, not its reduced chat preview');
  const glyphs=crop(image,fixture.crop),expected=fixture.lines.map(s=>s.split(' ')),flat=expected.flat();
  for(const [scale,inverse] of [[1,false],[1,true],[.5,false],[.4,false],[.3,false]]){
   let input=resize(glyphs,scale);if(inverse)input={...input,data:Uint8Array.from(input.data,(v,i)=>i%4===3?v:255-v)};
   const start=Date.now(),result=await OCR.recognize(input,masks),tokens=result.lines.flatMap(l=>l.tokens),ids=tokens.map(t=>t.id),actual=result.lines.map(l=>l.tokens.map(t=>t.id||'?').join(' '));
   const row={file:fixture.file,scale,inverse,seconds:(Date.now()-start)/1000,expectedTokens:flat.length,lines:result.lines.length,tokens:tokens.length,certain:tokens.filter(t=>t.certain).length,tokenEdits:distance(flat,ids),actual};rows.push(row);
   if(!process.env.BABELIAN_REFERENCE_ENGINE){
    assert.equal(result.lines.length,expected.length,'Do not merge tightly spaced text rows');
    if(scale===1){assert.deepEqual(result.lines.map(l=>l.tokens.map(t=>t.id)),expected);assert.equal(row.certain,flat.length-(fixture.file==='IMG_3503.PNG'?2:0));}
    if(scale<.5)assert(tokens.every(t=>!t.certain),'Low resolution must not become confirmed by a relaxed threshold');
   }
   console.log(JSON.stringify(row));
  }
 }
 if(process.env.BABELIAN_REFERENCE_REPORT)fs.writeFileSync(process.env.BABELIAN_REFERENCE_REPORT,JSON.stringify(rows,null,2));
 console.log('PASS reference evaluation; native gold is 206 glyph IDs. Reduced images are stress tests, not independent unseen examples.');
})().catch(e=>{console.error(e);process.exitCode=1;});
