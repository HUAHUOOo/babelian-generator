const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,'src',file),'utf8');
let html=read('template.html');
const replacements={
 '__BABELIAN_GLYPHS__':JSON.stringify(JSON.parse(read('glyphs.json'))),
 '__BABELIAN_PARTS__':JSON.stringify(JSON.parse(read('parts.json'))),
 '__MAPPING_EDITOR_JS__':read('mapping-editor.js'),
};
for(const [placeholder,content] of Object.entries(replacements)){
 if(html.split(placeholder).length!==2)throw new Error('Expected one placeholder: '+placeholder);
 html=html.replace(placeholder,()=>content);
}
fs.writeFileSync(path.join(root,'index.html'),html);
console.log('Built index.html ('+Buffer.byteLength(html)+' bytes)');
