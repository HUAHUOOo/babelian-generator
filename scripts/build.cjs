const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,'src',file),'utf8');
const sourceGlyphs=JSON.parse(read('glyphs.json')),sourceParts=JSON.parse(read('parts.json'));
function htmlFor(mode,glyphs,parts){
 let html=read('template.html');
 const replacements={
  '__BABELIAN_GLYPHS__':JSON.stringify(glyphs),
  '__BABELIAN_PARTS__':JSON.stringify(parts),
  '__MAPPING_EDITOR_JS__':read('mapping-editor.js'),
  '__PLATFORM_JS__':read('runtime.js'),
  '__HOST_UI_JS__':read('host-ui.js'),
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
const standalone=htmlFor('standalone',sourceGlyphs,sourceParts);
fs.writeFileSync(path.join(root,'index.html'),standalone);
const out=path.join(root,'dist/ato/babelian');fs.mkdirSync(path.join(out,'assets'),{recursive:true});
const glyphs=structuredClone(sourceGlyphs),parts=structuredClone(sourceParts);
function extract(asset,name){
 if(!asset.src.startsWith('data:image/png;base64,'))throw Error('Expected embedded PNG');
 fs.writeFileSync(path.join(out,'assets',name+'.png'),Buffer.from(asset.src.split(',')[1],'base64'));
 asset.src='./assets/'+name+'.png';
}
Object.values(glyphs).forEach((asset,i)=>extract(asset,'g'+String(i+1).padStart(2,'0')));
parts.components.forEach(asset=>extract(asset,'part-'+asset.id));
fs.writeFileSync(path.join(out,'index.html'),htmlFor('ato',glyphs,parts));
console.log('Built standalone index.html and dist/ato/babelian (64 external PNG assets).');
