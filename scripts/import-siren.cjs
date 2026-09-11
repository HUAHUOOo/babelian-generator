/* Repackages already cropped user-supplied PNGs; never redraws the glyphs.
   Usage: node scripts/import-siren.cjs /path/to/extracted */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const source=process.argv[2];if(!source)throw Error('Specify the extracted Siren asset directory.');
const provenance=JSON.parse(fs.readFileSync(path.join(source,'provenance.json'),'utf8'));
function asset(id){
 const bytes=fs.readFileSync(path.join(source,id+'.png'));
 if(bytes[0]!==137||bytes.subarray(1,4).toString()!=='PNG')throw Error('Invalid PNG '+id);
 const record=provenance.find(r=>r.id===id);if(!record)throw Error('Missing provenance '+id);
 return {src:'data:image/png;base64,'+bytes.toString('base64'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),pivotX:.5,pivotY:id==='base'?.465:.5,
   provenance:{...record,assetSha256:crypto.createHash('sha256').update(bytes).digest('hex')}};
}
const value={version:1,calibration:'initial-frame-pivots; manually adjustable placement; no automatic OCR',base:asset('base'),letters:Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(id=>[id,asset(id)]))};
fs.writeFileSync(path.resolve(__dirname,'../src/siren-glyphs.json'),JSON.stringify(value)+'\n');
console.log('Imported 27 Siren PNG assets with source/crop provenance.');
