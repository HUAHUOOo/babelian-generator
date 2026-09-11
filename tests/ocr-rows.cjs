/* Image-only row boundaries and disconnected strokes; no browser or word model. */
const assert=require('node:assert/strict'),OCR=require('../src/ocr-engine.js'),{draw,masks}=require('./ocr.cjs');
function compactRows(ids,height,gap){
 const src=draw(ids.map(id=>[id]),{height}),width=src.width,h=20+ids.length*height+(ids.length-1)*gap,data=new Uint8Array(width*h*4);
 for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=244;data[i+3]=255;}
 ids.forEach((id,row)=>{for(let y=0;y<height;y++)data.set(src.data.subarray(((10+row*(height+12)+y)*width)*4,((11+row*(height+12)+y)*width)*4),((10+row*(height+gap)+y)*width)*4);});
 return {width,height:h,data};
}
(async()=>{
 for(const height of [64,40])for(const mask of masks){const r=await OCR.recognize(draw([[mask.id]],{height}),masks);assert.equal(r.lines.length,1);assert.deepEqual(r.lines[0].tokens.map(t=>t.id),[mask.id]);}
 // All native masks, including vertically detached ligatures, remain one glyph.
 for(const mask of masks){const padded={width:mask.width+8,height:mask.height+8,data:new Uint8Array((mask.width+8)*(mask.height+8)*4)};padded.data.fill(255);for(let y=0;y<mask.height;y++)for(let x=0;x<mask.width;x++)for(let c=0;c<3;c++)padded.data[((y+4)*padded.width+x+4)*4+c]=mask.data[y*mask.width+x]?0:255;const r=await OCR.recognize(padded,masks);assert.equal(r.lines.length,1);assert.equal(r.lines[0].tokens[0].id,mask.id);}
 for(const gap of [1,2])for(const height of [28,40]){
  const ids=['A','b','C','d'],image=compactRows(ids,height,gap),r=await OCR.recognize(image,masks);
  assert.equal(r.lines.length,ids.length);assert.deepEqual(r.lines.map(l=>l.tokens[0].id),ids);
 }
 // Preserve a genuinely too-wide fragment as unknown instead of throwing
 // away the entire line or inventing a label from an English word.
 const width=100,height=10,image={width,height,data:new Uint8Array(width*height*4)};image.data.fill(255);
 for(let y=2;y<8;y++)for(let x=5;x<95;x++)for(let c=0;c<3;c++)image.data[(y*width+x)*4+c]=0;
 const r=await OCR.recognize(image,masks);assert.equal(r.lines.length,1);assert.equal(r.lines[0].tokens.length,1);assert.equal(r.lines[0].tokens[0].id,null);assert.equal(r.lines[0].tokens[0].certain,false);assert.equal(r.lines[0].tokens[0].box.width,90);
 console.log('PASS OCR rows: 58 isolated glyphs at native/64/40px, detached ligatures, one-/two-pixel line gaps, wide unknown fallback.');
})().catch(e=>{console.error(e);process.exitCode=1;});
