/* Unit checks for histogram routing, not an unseen-image accuracy claim. */
const assert=require('node:assert/strict'),E=require('../src/siren-recognition.js');
function field(soft=false,dim=false){
 const width=100,height=100,data=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const signal=x<70?0:x<90&&soft?.55:1;
  const value=dim?Math.round(12+signal*130):Math.round(255*(1-signal)),j=(y*width+x)*4;
  data[j]=data[j+1]=data[j+2]=value;data[j+3]=255;
 }
 return {width,height,data};
}
const sharp=E.binarize(field()),soft=E.binarize(field(true)),dim=E.binarize(field(false,true));
assert.equal(sharp.photometric,undefined,'Sharp high-contrast pixels retain linear normalization');
assert.equal(soft.photometric,'otsu-soft');assert.equal(soft.softEdgeNormalized,true);
assert.equal(dim.photometric,'otsu-soft');assert.equal(dim.softEdgeNormalized,false,'Old low-contrast path remains independent');
assert(soft.ink[75]>0.9,'Intermediate stroke ink is restored by foreground separation');
assert.equal(soft.ink[20],0,'Background must not be promoted to ink');
for(const input of [field(),field(true),field(false,true)]){
 const inverse={...input,data:Uint8Array.from(input.data,(v,i)=>i%4===3?v:255-v)},a=E.binarize(input),b=E.binarize(inverse);
 assert.notEqual(a.polarity,b.polarity);assert.equal(a.photometric,b.photometric);
 for(let i=0;i<a.ink.length;i++)assert(Math.abs(a.ink[i]-b.ink[i])<1e-6,'Routing and ink must be inversion symmetric');
}
console.log('PASS Siren normalization: sharp/soft routing, unchanged dim-image route, background exclusion, inversion symmetry.');
