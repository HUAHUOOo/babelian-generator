// Static markup contracts only; no browser, screenshots or DOM interaction.
const assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync(require.resolve('../src/ocr-panel.html'),'utf8');
const root={tag:'root',children:[]},stack=[root],ids=new Map();
for(const match of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi)){
  const [,closing,tag,attrs]=match;
  if(closing){assert.equal(stack.pop().tag,tag,'unbalanced markup');continue;}
  const node={tag,attrs,index:match.index,parent:stack.at(-1),children:[]};node.parent.children.push(node);
  const id=attrs.match(/\bid="([^"]+)"/)?.[1];
  if(id){assert(!ids.has(id),'duplicate id '+id);ids.set(id,node);}
  if(!['input','img','br','hr','meta','link'].includes(tag))stack.push(node);
}
assert.equal(stack.length,1,'all containers must close');
const get=id=>{assert(ids.has(id),'missing '+id);return ids.get(id);};
const inside=(node,parent)=>{for(let n=node;n;n=n.parent)if(n===parent)return true;return false;};
const decode=get('panel-decode'),inspection=get('ocr-inspection'),results=get('ocr-results');
assert.equal(inspection.parent,decode);assert.equal(results.parent,decode);
assert.equal(decode.children.at(-1),results,'recognized English must be the bottom section');
assert(inside(get('ocr-tokens'),inspection));assert(inside(get('ocr-review'),inspection));
assert(inspection.index<results.index);assert(inside(get('ocr-output'),results));
const toolbar=get('ocr-formatted-copy').parent;
assert.equal(get('ocr-formatted-append').parent,toolbar);assert.equal(get('ocr-translate-toggle').parent,toolbar);
assert(get('ocr-formatted-copy').index<get('ocr-formatted-append').index&&get('ocr-formatted-append').index<get('ocr-translate-toggle').index);
assert(/aria-expanded="false"/.test(get('ocr-translate-toggle').attrs));
assert(/aria-controls="ocr-translate-panel"/.test(get('ocr-translate-toggle').attrs));
assert(/\bhidden\b/.test(get('ocr-translate-panel').attrs));
assert(inside(get('ocr-translation'),get('ocr-translate-panel')));
const segmentation=get('ocr-segmentation');assert.equal(segmentation.tag,'details');assert(!/\bopen\b/.test(segmentation.attrs));
for(const id of ['ocr-split','ocr-merge','ocr-rebox'])assert(inside(get(id),segmentation));
assert(get('ocr-split').index<get('ocr-merge').index&&get('ocr-merge').index<get('ocr-rebox').index);
const ui=fs.readFileSync(require.resolve('../src/ocr-ui.js'),'utf8');
const toggle=ui.slice(ui.indexOf('function setTranslationOpen('),ui.indexOf("$('ocr-translate-consent').addEventListener"));
assert(toggle.includes("setAttribute('aria-expanded',String(open))"));assert(!toggle.includes('translation.run('));
assert(toggle.includes('translation.cancel()'),'collapse should stop future chunks of an active request');
console.log('PASS OCR markup: balanced containers; review before bottom results; translation button beside copy/append with collapsed panel; rebox after split/merge inside collapsed details; expansion cannot send text.');
