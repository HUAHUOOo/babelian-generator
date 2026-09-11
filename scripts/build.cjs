const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,'src',file),'utf8');
const sourceGlyphs=JSON.parse(read('glyphs.json')),sourceParts=JSON.parse(read('parts.json'));
const sourceSiren=JSON.parse(read('siren-glyphs.json'));
const dictionary=fs.readFileSync(path.join(root,'src/english-words.txt.gz'));
if(crypto.createHash('sha256').update(dictionary).digest('hex')!==JSON.parse(read('english-words-source.json')).sha256)throw Error('English vocabulary checksum mismatch');
const wordData=zlib.gunzipSync(dictionary).toString('utf8').trim().split(/\s+/).filter(w=>/^[a-z]{2,32}$/.test(w)||w==='a'||w==='i').join(' ');
function htmlFor(mode,glyphs,parts,siren){
 let html=read('template.html');
 const replacements={
  '__BABELIAN_GLYPHS__':JSON.stringify(glyphs),
  '__BABELIAN_PARTS__':JSON.stringify(parts),
  '__SIREN_ASSETS__':JSON.stringify(siren),
  '__SIREN_CORE_JS__':read('siren-core.js'),
  '__SIREN_FORMAT_JS__':read('siren-format.js'),
  '__SIREN_INTERSECTIONS_JS__':read('siren-intersections.js'),
  '__SIREN_PATH__':read('siren-path.json').trim(),
  '__SIREN_UI_JS__':read('siren-ui.js'),
  '__SIREN_STRIP_JS__':read('siren-strip.js'),
  '__SIREN_RECOGNITION_JS__':read('siren-recognition.js'),
  '__SIREN_SCAN_JS__':read('siren-scan.js'),
  '__LANGUAGE_NAVIGATION_JS__':read('language-navigation.js'),
  '__SIREN_CSS__':read('siren.css'),
  '__SIREN_HTML__':read('siren-panel.html'),
  '__MAPPING_EDITOR_JS__':read('mapping-editor.js'),
  '__PLATFORM_JS__':read('runtime.js'),
  '__HOST_UI_JS__':read('host-ui.js'),
  '__OCR_ENGINE_JS__':read('ocr-engine.js'),
  '__BABELIAN_DEEP_JS__':read('babelian-deep.js'),
  '__GLYPH_SAMPLES_JS__':read('glyph-samples.js'),
  '__OCR_CORRECTION_JS__':read('ocr-correction.js'),
  '__TRANSLATION_JS__':read('translation.js'),
  '__OCR_UI_JS__':read('ocr-ui.js'),
  '__TEXT_FORMAT_JS__':read('text-format.js'),
  '__ENGLISH_WORD_DATA__':JSON.stringify(wordData),
  '__WORD_LICENSE__':read('wordninja-LICENSE.txt'),
  '__OCR_CSS__':read('ocr.css'),
  '__OCR_HTML__':read('ocr-panel.html'),
  '__BUILD_CONFIG__':JSON.stringify({mode}),
  '__ATO_ROUTER__':mode==='ato'?'<script src="../assets/page-focus-router.js"></script>':'',
 };
 for(const [placeholder,content] of Object.entries(replacements)){
  if(html.split(placeholder).length!==2)throw new Error('Expected one placeholder: '+placeholder);
  html=html.replace(placeholder,()=>content);
 }
 if(/__[A-Z_]+__/.test(html))throw Error('Unresolved build placeholder');
 return html;
}
const standalone=htmlFor('standalone',sourceGlyphs,sourceParts,sourceSiren);
fs.writeFileSync(path.join(root,'index.html'),standalone);
const out=path.join(root,'dist/ato/babelian');fs.mkdirSync(path.join(out,'assets'),{recursive:true});
const glyphs=structuredClone(sourceGlyphs),parts=structuredClone(sourceParts),siren=structuredClone(sourceSiren);
function extract(asset,name){
 if(!asset.src.startsWith('data:image/png;base64,'))throw Error('Expected embedded PNG');
 fs.writeFileSync(path.join(out,'assets',name+'.png'),Buffer.from(asset.src.split(',')[1],'base64'));
 asset.src='./assets/'+name+'.png';
}
Object.values(glyphs).forEach((asset,i)=>extract(asset,'g'+String(i+1).padStart(2,'0')));
parts.components.forEach(asset=>extract(asset,'part-'+asset.id));
extract(siren.base,'siren-base');Object.entries(siren.letters).forEach(([letter,asset])=>extract(asset,'siren-'+letter.toLowerCase()));
fs.writeFileSync(path.join(out,'index.html'),htmlFor('ato',glyphs,parts,siren));
const contract=JSON.parse(fs.readFileSync(path.join(root,'integration/module-contract.json'),'utf8'));
const files=['index.html',...fs.readdirSync(path.join(out,'assets')).filter(f=>f.endsWith('.png')).sort().map(f=>'assets/'+f)];
const manifest={...contract,version:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,
 files:Object.fromEntries(files.map(file=>[file,{sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(out,file))).digest('hex')}]))};
fs.writeFileSync(path.join(out,'babelian-module.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Built standalone index.html and dist/ato/babelian ('+(files.length-1)+' external PNG assets).');
