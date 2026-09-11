const assets=require('../src/siren-glyphs.json'),path=require('../src/siren-path.json'),readPNG=require('./png.cjs'),C=require('../src/siren-core.js'),I=require('../src/siren-intersections.js');
const masks={};for(const [letter,asset] of Object.entries(assets.letters)){const rgba=readPNG(Buffer.from(asset.src.split(',')[1],'base64'));masks[letter]={width:rgba.width,height:rgba.height,alpha:Uint8Array.from({length:rgba.width*rgba.height},(_,i)=>rgba.data[i*4+3])};}
const geometry=I.prepare({base:assets.base,letters:assets.letters,path,masks});
function sample(){const f=require('./fixtures/siren-3491.json'),doc=C.create(),g=doc.groups[0],scale=.6;
 g.baseSize=420;g.cx=50+350*scale;g.cy=20+(496-700*(.5-assets.base.pivotY))*scale;
 // Keep independently fitted positions, then apply the user's uniform scale/absolute bearing rule.
 for(const [letter,record] of Object.entries(f.letters)){const [x,y]=record.transform,item=C.add(g,letter);Object.assign(item,{x:50+x*scale,y:20+y*scale,size:C.glyphSize(g)});C.orient(g,item);}
 return doc;}
module.exports={assets,path,masks,geometry,sample,read:doc=>C.read(doc,g=>geometry.analyze(g,doc.mode==='review'))};
