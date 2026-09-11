const assert=require('node:assert/strict'),fs=require('node:fs'),N=require('../src/language-navigation.js');
const ids=['language-home','language-babelian','panel-siren','language-back','babelian-backups','language-open-babelian','language-open-siren','language-open-babelian-translate','language-open-siren-translate','babelian-title','siren-title'];
const nodes=new Map(ids.map(id=>[id,{id,hidden:false,events:{},addEventListener(k,fn){this.events[k]=fn;},focus(){focused=id;}}]));let focused='',changes=[];
const document={getElementById:id=>{assert(nodes.has(id));return nodes.get(id);}},get=id=>nodes.get(id);
const draft={text:'KEEP',groups:[{letter:'A'}]},before=JSON.stringify(draft);
const nav=N.mount({document,onChange:(next,old)=>changes.push([next,old])});
assert.equal(nav.current(),'home');assert(!get('language-home').hidden);assert(get('language-babelian').hidden);assert(get('panel-siren').hidden);assert(get('babelian-backups').hidden);
get('language-open-babelian').events.click();assert.equal(nav.current(),'babelian-generate');assert(get('language-home').hidden);assert(!get('language-babelian').hidden);assert(get('panel-siren').hidden);assert(!get('babelian-backups').hidden);assert.equal(focused,'babelian-title');
get('language-back').events.click();assert.equal(nav.current(),'home');assert.equal(focused,'language-open-babelian');
get('language-open-siren').events.click();assert(!get('panel-siren').hidden);assert(get('language-babelian').hidden);assert(get('babelian-backups').hidden);assert.equal(focused,'siren-title');
get('language-back').events.click();assert.equal(focused,'language-open-siren');assert.equal(JSON.stringify(draft),before);assert.throws(()=>nav.show('nope'));assert.equal(nav.current(),'home');
for(const language of ['babelian','siren']){
 get('language-open-'+language+'-translate').events.click();assert.equal(nav.current(),language+'-translate');
 assert.equal(get('language-babelian').hidden,language!=='babelian');assert.equal(get('panel-siren').hidden,language!=='siren');
 assert.equal(get('babelian-backups').hidden,language!=='babelian');assert.equal(focused,language+'-title');
 get('language-back').events.click();assert.equal(focused,'language-open-'+language+'-translate');
 nav.show(language);assert.equal(nav.current(),language+'-generate');nav.show('home');
}
// Parse built markup (not a browser) to ensure complete, disjoint language surfaces.
const source=fs.readFileSync(require.resolve('../src/template.html'),'utf8'),html=fs.readFileSync(require.resolve('../index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<style>[\s\S]*?<\/style>/g,'');
const root={tag:'root'},stack=[root],byId=new Map();
for(const match of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi)){
 const [,closing,tag,attrs]=match;if(closing){assert.equal(stack.pop().tag,tag,'unbalanced '+tag);continue;}
 const node={tag,attrs,parent:stack.at(-1),index:match.index},id=attrs.match(/\bid="([^"]+)"/)?.[1];if(id){assert(!byId.has(id),'duplicate '+id);byId.set(id,node);}
 if(!['input','img','br','hr','meta','link','wbr'].includes(tag))stack.push(node);
}
assert.equal(stack.length,1);const at=id=>{assert(byId.has(id),id);return byId.get(id);};
const inside=(id,parent)=>{for(let n=at(id);n;n=n.parent)if(n===at(parent))return true;return false;};
for(const id of ['english-input','panel-write','panel-mapping','panel-decode'])assert(inside(id,'language-babelian'));
assert.equal(at('panel-siren').parent,at('language-babelian').parent);assert.equal(at('language-home').parent,at('language-babelian').parent);
assert(!byId.has('tab-siren'));assert(!byId.has('siren-base-rotation'));assert(!byId.has('siren-size'));
for(const id of ['siren-new-item','siren-delete-item','siren-unknown','siren-strip-panel','siren-strip'])assert(!byId.has(id),'Removed '+id);
assert.equal(at('siren-items').parent,at('siren-selection-bar'));assert.equal(at('siren-precision-toggle').parent,at('siren-selection-bar'));assert(at('siren-stage').index<at('siren-selection-bar').index);
assert(inside('siren-contact','siren-precision-panel'));assert(inside('siren-selection','siren-precision-panel'));assert.equal(at('siren-stage').parent,at('siren-selection-bar').parent);
const css=fs.readFileSync(require.resolve('../src/siren.css'),'utf8');
assert(/\.siren-group-toolbar\s*\{[^}]*flex-direction:column/.test(css));assert(/\.siren-groups\s*\{[^}]*flex-wrap:nowrap;gap:0/.test(css));assert(/\.siren-groups canvas\s*\{[^}]*width:80px;height:80px/.test(css));
assert(/#siren-stage\s*\{[^}]*max-width:760px/.test(css));assert(/\.siren-items\s*\{[^}]*flex-wrap:nowrap/.test(css));assert(!css.includes('siren-strip'));
assert(/\bhidden\b/.test(at('siren-precision-panel').attrs));assert(/\bhidden\b/.test(at('siren-batch-panel').attrs));
for(const id of ['siren-radius','siren-angle','siren-rotation'])assert(inside(id,'siren-precision-panel'));assert(inside('siren-source-text','siren-batch-panel'));
assert.equal(at('siren-add-group').parent,at('siren-batch-toggle').parent);assert(at('siren-groups').index<at('siren-add-group').index);
assert.equal((source.match(/if\(\$\('language-babelian'\)\.hidden\|\|\$\('babelian-writer'\)\.hidden\)return;/g)||[]).length,2);
for(const id of ['language-open-babelian','language-open-babelian-translate','language-open-siren','language-open-siren-translate'])assert(inside(id,'language-home'));
assert.equal((source.match(/#host-bar,#language-back,#panel-decode,#panel-siren/g)||[]).length,2);
assert(source.includes("for(const name of ['write','mapping','decode'])$('panel-'+name).hidden=true"),'Hidden OCR must not catch global paste');
assert.equal((source.match(/SirenUI\.mount\(/g)||[]).length,1);assert.equal((source.match(/BabelianOCRUI\.mount\(/g)||[]).length,1);
console.log('PASS language navigation: home gate, isolated surfaces, retained state, keyboard/paste guards, focus return, hidden controls and shared thumbnail toolbar.');
