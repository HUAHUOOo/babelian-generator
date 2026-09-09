// Minimal test-only decoder for our 8-bit RGB/RGBA template PNGs (no browser).
const zlib=require('node:zlib');
module.exports=function readPNG(buf){
 let width,height,channels;const chunks=[];
 for(let at=8;at<buf.length;){
  const size=buf.readUInt32BE(at),type=buf.toString('ascii',at+4,at+8),data=buf.subarray(at+8,at+8+size);at+=size+12;
  if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);channels=data[9]===6?4:data[9]===2?3:0;if(data[8]!==8||!channels||data[12]!==0)throw Error('Unsupported test PNG');}
  if(type==='IDAT')chunks.push(data);
 }
 const raw=zlib.inflateSync(Buffer.concat(chunks)),stride=width*channels,decoded=new Uint8Array(stride*height);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){
  const filter=raw[y*(stride+1)];
  for(let x=0;x<stride;x++){
   const at=y*stride+x,a=x>=channels?decoded[at-channels]:0,b=y?decoded[at-stride]:0,c=y&&x>=channels?decoded[at-stride-channels]:0;
   const d=raw[y*(stride+1)+x+1],extra=[0,a,b,(a+b)>>1,paeth(a,b,c)][filter];if(extra===undefined)throw Error('Bad PNG filter');decoded[at]=(d+extra)&255;
  }
 }
 const data=new Uint8Array(width*height*4);
 for(let i=0;i<width*height;i++){data[i*4]=decoded[i*channels];data[i*4+1]=decoded[i*channels+1];data[i*4+2]=decoded[i*channels+2];data[i*4+3]=channels===4?decoded[i*channels+3]:255;}
 return {width,height,data};
};
