/* Pixel-only strip/photometric regression; no browser and no private images. */
const assert=require('node:assert/strict'),F=require('./siren-fixture.cjs'),PNG=require('./png.cjs'),E=require('../src/siren-recognition.js');
const decode=a=>({...a,...PNG(Buffer.from(a.src.split(',')[1],'base64'))}),base=decode(F.assets.base);
const templates={base,letters:Object.fromEntries(Object.entries(F.assets.letters).map(([k,a])=>[k,decode(a)])),path:F.path},engine=E.create(templates);
function strip(count,offset=0,vertical=false,dim=false){
 const h=140,side=130,step=110,w=count*step+40+offset,data=new Uint8Array(w*h*4).fill(255),centers=[];
 for(let k=0;k<count;k++){
  const cx=75+k*step+offset,cy=70;centers.push([cx+((base.pivotX??.5)-.5)*side,cy+((base.pivotY??.5)-.5)*side]);
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){
   const sx=Math.min(base.width-1,Math.floor((x+.5)*base.width/side)),sy=Math.min(base.height-1,Math.floor((y+.5)*base.height/side));
   const xx=Math.floor(cx-side/2+x),yy=Math.floor(cy-side/2+y),a=base.data[(sy*base.width+sx)*4+3],at=(yy*w+xx)*4;
   if(xx>=0&&xx<w&&yy>=0&&yy<h)data[at]=data[at+1]=data[at+2]=Math.min(data[at],255-a);
  }
 }
 if(dim)for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4,a=1-data[i]/255,bg=8+6*(1+Math.sin(x*.021)*Math.cos(y*.037));
  data[i]=Math.round(bg+(142-bg)*a);data[i+1]=Math.round(bg+7+(142-bg-7)*a);data[i+2]=Math.round(bg+(142-bg)*a);
 }
 if(!vertical)return {image:{width:w,height:h,data},centers};
 const out=new Uint8Array(data.length);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const a=(y*w+x)*4,b=(x*h+h-1-y)*4;out.set(data.subarray(a,a+4),b);}
 return {image:{width:h,height:w,data:out},centers:centers.map(([x,y])=>[h-1-y,x])};
}
for(const [count,offset,vertical,dim] of [[12,0,false,false],[12,50,false,false],[12,0,true,false],[6,0,false,true]]){
 const {image,centers}=strip(count,offset,vertical,dim),bitmap=engine.binarize(image),groups=engine.detectGroups(bitmap);
 assert.equal(groups.length,count,'Windows must not miss or duplicate connected bases');
 assert.equal(bitmap.photometric,dim?'otsu-soft':undefined,'High-contrast path stays unchanged');
 for(const [x,y] of centers)assert(Math.min(...groups.map(g=>Math.hypot(x-g.cx,y-g.cy)))<3,'Window coordinates/pivot must return to source frame');
 for(const g of groups){assert(g.bbox.x>=0&&g.bbox.y>=0);assert(g.bbox.x+g.bbox.width<=image.width+.001);assert(g.bbox.y+g.bbox.height<=image.height+.001);}
 if(dim){
  const inverse={...image,data:Uint8Array.from(image.data,(v,i)=>i%4===3?v:255-v)},dark=engine.binarize(inverse);
  assert.equal(bitmap.polarity,'light');assert.equal(dark.polarity,'dark');
  let delta=0;for(let i=0;i<bitmap.ink.length;i++)delta+=Math.abs(bitmap.ink[i]-dark.ink[i]);
  assert(delta/bitmap.ink.length<.005,'Equivalent polarity should preserve the ink signal');
  assert.equal(engine.detectGroups(dark).length,count);
 }
}
for(const value of [0,100,255]){
 const data=new Uint8Array(600*100*4).fill(value);for(let i=3;i<data.length;i+=4)data[i]=255;
 assert.equal(engine.detectGroups(engine.binarize({width:600,height:100,data})).length,0,'Flat fields are not spirals');
}
console.log('PASS Siren strip recognition: connected 12-base rows/columns, shifted window phase, no duplicates, original coordinate recovery, dim texture/inverse polarity, blank negatives.');
