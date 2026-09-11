/* Unit-level DOM/canvas doubles, not browser or visual QA. No pixel matching claims. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../src/siren-core.js'),F=require('../src/text-format.js'),T=require('../src/translation.js');
const I=require('../src/siren-intersections.js'),real=require('./siren-fixture.cjs'),readPNG=require('./png.cjs'),Strip=require('../src/siren-strip.js');
const createLocatorBoundary=require('../src/siren-recognition.js').createRecognitionBoundary;
const assets=require('../src/siren-glyphs.json'),markup=fs.readFileSync(require.resolve('../src/siren-panel.html'),'utf8');
const nodes=new Map(),windowEvents=new Map(),documentEvents=new Map(),downloads=[];let networkCalls=0,pendingSave=null,clips=0,scanPayload=null,scanDelay=null,overlapCalls=0;
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M8AAAICAQB7CY0KAAAAAElFTkSuQmCC';
const tileData={width:600,height:600,data:new Uint8Array(600*600*4)};tileData.data[(60*600+50)*4+3]=255;tileData.data[(539*600+549)*4+3]=255;
let drawn;const ctx=new Proxy({drawImage:img=>{drawn=img;},getImageData:(x,y,w,h)=>w===600&&h===600?tileData:readPNG(Buffer.from(drawn.value.split(',')[1],'base64')),measureText:s=>({width:s.length*10}),clip:()=>clips++},{get:(o,k)=>o[k]||(()=>{})});
let document;
class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.listeners=new Map();this.children=[];this.value='';this.hidden=false;this.disabled=false;this.width=900;this.height=900;this.attributes={};this.style={};this._checked=false;}
 get checked(){return this._checked;}
 set checked(v){this._checked=v;if(v&&['siren-key-add','siren-key-replace'].includes(this.id)){const other=nodes.get(this.id==='siren-key-add'?'siren-key-replace':'siren-key-add');if(other)other._checked=false;}}
 setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}
 addEventListener(k,fn){this.listeners.set(k,fn);}append(...c){this.children.push(...c);}replaceChildren(...c){this.children=[...c];}
 getContext(){return ctx;}getBoundingClientRect(){return {left:0,top:0,width:600,height:600};}
 setPointerCapture(){}focus(options){this.focusOptions=options;document.activeElement=this;}blur(){document.activeElement=null;}select(){}click(){return this.fire('click');}
 async fire(type,extra={}){return this.listeners.get(type)?.({type,target:this,button:0,pointerId:1,preventDefault(){},...extra});}
 toDataURL(){return png;}toBlob(fn){fn(new Blob([JSON.stringify({width:this.width,height:this.height})],{type:'image/png'}));}
}
for(const tag of markup.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
 const e=new Element(tag[1]);e.id=tag[3];e.hidden=/\shidden\b/.test(tag[2]);e.disabled=/\sdisabled\b/.test(tag[2]);e._checked=/\schecked\b/.test(tag[2]);
 for(const key of ['min','max','value']){const m=tag[2].match(new RegExp('\\b'+key+'="([^"]*)"'));if(m)e[key]=m[1];}nodes.set(e.id,e);
}
document={activeElement:null,addEventListener:(type,f)=>documentEvents.set(type,f),getElementById:id=>{assert(nodes.has(id),'Missing '+id);return nodes.get(id);},createElement:tag=>new Element(tag),execCommand:()=>true};
class ImageDouble{set src(v){this.value=v;this.width=600;this.height=600;queueMicrotask(()=>this.onload?.());}}
const scope={console,document,Image:ImageDouble,SirenCore:C,SirenIntersections:I,SirenStrip:Strip,SirenRecognition:{createLocatorBoundary,workerSource:()=>'',create:()=>({binarize:pixels=>pixels,measurePlacement:()=>{overlapCalls++;return {overlap:.8,independent:.7,independentFraction:.5,visible:1};}})},SirenScan:{create:()=>({cancel(){},run:async payload=>{scanPayload=payload;if(scanDelay)return scanDelay;const g=real.sample().groups[0];return [{base:{cx:g.cx,cy:g.cy,size:g.baseSize,rotation:g.baseRotation},items:g.items.map((i,n)=>({...i,letter:n===0?null:i.letter,score:.92,candidates:[{...i,score:.92}]}))}];}})},BabelianTextFormat:F,BabelianTranslation:{...T,createClient:()=>async()=>{networkCalls++;return '中文';}},
 BabelianHost:{download:async(blob,name)=>{downloads.push({blob,name});if(pendingSave)await pendingSave.promise;}},confirm:()=>true,window:{addEventListener:(k,f)=>windowEvents.set(k,f)},
 navigator:{clipboard:{writeText:async()=>{}}},Blob,URL,DataView,Uint8Array,atob,Math,JSON,Promise,setTimeout,clearTimeout};
scope.SirenRecognition.createRecognitionBoundary=createLocatorBoundary;
scope.SirenFormat=require('../src/siren-format.js');
vm.createContext(scope);vm.runInContext(fs.readFileSync(require.resolve('../src/siren-ui.js'),'utf8'),scope);
const el=id=>nodes.get('siren-'+id),click=id=>el(id).click();
async function key(index){if(el('keyboard-panel').hidden)await click(el('key-replace').checked?'open-replace':'open-add');return el('keyboard').children[index].click();}
const ui=scope.SirenUI.mount({assets,path:real.path,wordData:'hello world a b c',notify:()=>{}});
function warns(){let prevented=false;windowEvents.get('beforeunload')({preventDefault(){prevented=true;}});return prevented;}
(async()=>{
 await ui.ready;assert.equal(el('tools').disabled,false);assert.equal(el('keyboard').children.length,26);assert(!el('gear'));assert(!el('size'));assert(!el('base-rotation'));assert(el('rotation').readOnly);assert(el('rotation-slider').disabled);
 assert.equal(el('title').textContent,'塞壬语生成');
 assert(el('keyboard-panel').hidden);await el('keyboard').children[0].click();assert.equal(ui.snapshot().groups[0].items.length,0,'Hidden keyboard cannot add glyphs');await click('open-add');assert(!el('keyboard-panel').hidden);await click('keyboard-close');assert(el('keyboard-panel').hidden);
 for(const id of ['new-item','delete-item','unknown','strip-panel','strip','use-crop','crop-x','crop-y','crop-width','crop-height'])assert(!el(id),'Removed UI '+id);
 assert.equal(el('source-canvas').listeners.size,0,'Image preview is no longer an interactive crop tool');
 assert(el('batch-panel').hidden);assert(el('precision-panel').hidden);assert(el('key-add').checked);assert(el('key-replace').disabled);
 await click('precision-toggle');assert(!el('precision-panel').hidden);await click('precision-toggle');assert(el('precision-panel').hidden);
 await key(0);await key(1);assert.equal(el('raw').value,real.read(ui.snapshot()).text);assert(warns());
 assert.equal(ui.snapshot().groups[0].items.length,2);assert(el('key-add').checked,'Adding a letter must allow another addition');
 let first=ui.snapshot().groups[0].items[0],before=el('raw').value;await el('stage').fire('pointerdown',{clientX:first.x,clientY:first.y});await el('stage').fire('pointermove',{clientX:520,clientY:50});
 assert.equal(el('raw').value,before,'Reading must remain stable during drag');assert.equal(el('copy-raw').disabled,true);assert.equal(ui.snapshot().groups[0].items[0].x,520);assert.equal(ui.snapshot().groups[0].items[0].y,50);
 assert.equal(el('stage').focusOptions.preventScroll,true);assert(el('keyboard-panel').hidden,'Selecting a glyph must not open the keyboard');
 await el('stage').fire('pointerup');assert.equal(el('raw').value,real.read(ui.snapshot()).text);assert.notEqual(el('raw').value,before);
 let group=ui.snapshot().groups[0];assert.equal(group.items[0].size,190);assert.equal(group.items[0].rotation,C.rotationFor(group,group.items[0]));
 el('radius').value='100';await el('radius').fire('change');el('angle').value='90';await el('angle').fire('change');assert.equal(ui.snapshot().groups[0].items[0].rotation,0);
 el('angle').value='-90';await el('angle').fire('change');assert.equal(ui.snapshot().groups[0].items[0].rotation,-180);
 await click('rotation-mode');assert(!el('rotation').readOnly);assert(!el('rotation-slider').disabled);
 el('rotation-slider').value='40';await el('rotation-slider').fire('input');el('rotation-slider').value='65';await el('rotation-slider').fire('input');await el('rotation-slider').fire('change');assert.equal(el('rotation').value,'65');
 await click('undo');assert.equal(ui.snapshot().groups[0].items[0].rotation,-180,'One undo restores the whole slider gesture');
 await el('items').children[0].click();el('rotation').value='47';await el('rotation').fire('change');
 el('angle-slider').value='90';await el('angle-slider').fire('input');await el('angle-slider').fire('change');assert.equal(ui.snapshot().groups[0].items[0].rotation,47);
 el('radius-slider').value='120';await el('radius-slider').fire('input');await el('radius-slider').fire('change');assert.equal(ui.snapshot().groups[0].items[0].rotation,47);assert.equal(el('radius').value,'120');
 await click('rotation-mode');assert.equal(ui.snapshot().groups[0].items[0].rotation,0);assert(el('rotation').readOnly);
 el('angle').value='-90';await el('angle').fire('change');
 el('base-size').value='900';await el('base-size').fire('change');assert(ui.snapshot().groups[0].items.every(i=>i.size===342));await click('undo');assert(ui.snapshot().groups[0].items.every(i=>i.size===190));
 first=ui.snapshot().groups[0].items[0];await el('stage').fire('pointerdown',{clientX:first.x,clientY:first.y});await el('stage').fire('pointerup');await key(2);assert.equal(ui.snapshot().groups[0].items[0].letter,'C');
 assert(el('key-replace').checked);await el('stage').fire('pointerdown',{clientX:20,clientY:580});assert(el('key-add').checked);assert(el('key-replace').disabled);assert.equal(ui.snapshot().groups[0].items.length,2);
 await key(3);assert.equal(ui.snapshot().groups[0].items.length,3);assert.equal(ui.snapshot().groups[0].items[2].x,20);assert.equal(ui.snapshot().groups[0].items[2].letter,'D');assert(el('key-add').checked);
 await click('batch-toggle');assert(!el('batch-panel').hidden);el('source-text').value='HELLO WORLD';await click('from-text');assert.equal(el('raw').value,'HELLOWORLD');assert.equal(ui.snapshot().groups.length,2);assert(el('batch-panel').hidden);assert.equal(el('groups').children.length,2);assert(el('groups').children.every(b=>b.children[0].width===160),'Keep original thumbnail backing size');
 for(const group of ui.snapshot().groups)for(const i of group.items){assert.equal(i.size,190);assert.equal(i.rotation,C.rotationFor(group,i));}
 await click('format');assert(el('formatted').value);el('formatted').value='HELLO, WORLD!';await el('formatted').fire('input');assert.equal(el('copy-formatted').disabled,false);
 await click('translate-toggle');assert.equal(networkCalls,0);el('translate-consent').checked=true;await el('translate-consent').fire('change');await click('translate');assert.equal(networkCalls,1);assert.equal(el('chinese').value,'中文');
 el('formatted').value='HELLO WORLD.';await el('formatted').fire('input');assert.equal(el('chinese').value,'');
 await click('export-png');assert.equal(downloads.at(-1).blob.type,'image/png');const dimensions=JSON.parse(await downloads.at(-1).blob.text()),layout=Strip.layout([Strip.inkBounds(tileData),Strip.inkBounds(tileData)]);assert.equal(dimensions.width,layout.width);assert.equal(dimensions.height,layout.height);assert(dimensions.width>dimensions.height);
 await click('save');assert(!warns());
 // Saving an older revision while another edit occurs must not mark the new work saved.
 let resolve;pendingSave={promise:new Promise(r=>resolve=r)};const saving=click('save');await click('add-group');resolve();await saving;pendingSave=null;assert(warns());
 await click('mode-review');assert.equal(ui.snapshot().mode,'review');assert.equal(ui.snapshot().groups.length,0);
 el('image-file').files=[Object.assign(new Blob(['image'],{type:'image/png'}),{name:'test.png'})];await el('image-file').fire('change');
 // Existing manual work is still editable even though the manual crop UI is gone.
 const savedManual=C.create('review');C.addGroup(savedManual).image=png;
 el('work-file').files=[{size:200,text:async()=>JSON.stringify(savedManual)}];await el('work-file').fire('change');
 assert.equal(ui.snapshot().groups.length,1);assert.equal(el('center').hidden,false);await click('center');
 await el('stage').fire('pointerdown',{clientX:300,clientY:300}); // center
 await el('stage').fire('pointerdown',{clientX:400,clientY:300}); // inner small center
 assert.equal(el('raw').value,'');assert(el('key-add').checked);await key(0);assert.equal(el('raw').value,'A');assert(ui.snapshot().groups[0].items[0].manualAdded);assert(el('manual-overlap').textContent.includes('80.0%'));assert(overlapCalls>0);await el('stage').fire('pointerdown',{clientX:400,clientY:300});await el('stage').fire('pointerup');assert(el('key-replace').checked);
 const points=real.geometry.basePoints(ui.snapshot().groups[0]);if(el('precision-panel').hidden)await click('precision-toggle');await click('contact');await el('stage').fire('pointerdown',{clientX:points[1000].x,clientY:points[1000].y});assert.equal(el('raw').value,'A');
 await el('stage').fire('pointerdown',{clientX:300,clientY:450});assert(el('key-add').checked);await key(2);await el('stage').fire('pointerdown',{clientX:300,clientY:450});await el('stage').fire('pointerup');assert(el('key-replace').checked);await click('contact');await el('stage').fire('pointerdown',{clientX:points[2000].x,clientY:points[2000].y});assert.equal(el('raw').value,'AC');
 await click('center');await el('stage').fire('pointerdown',{clientX:310,clientY:320});group=ui.snapshot().groups[0];group.items.forEach(i=>assert.equal(i.rotation,C.rotationFor(group,i)));await click('undo');assert.equal(el('raw').value,'AC');
 await click('save');assert(warns(),'Saving review must not mark generate revision saved');
 const reviewFile=downloads.at(-1);assert.equal(JSON.parse(await reviewFile.blob.text()).mode,'review');
 el('work-file').files=[{size:10,text:async()=>'{"format":"bad"}'}];const old=C.read(ui.snapshot()).text;await el('work-file').fire('change');assert.equal(C.read(ui.snapshot()).text,old);assert.equal(el('tools').disabled,false);
 el('work-file').files=[{size:reviewFile.blob.size,text:()=>reviewFile.blob.text()}];await el('work-file').fire('change');assert.equal(el('raw').value,'AC');
 const preserved=JSON.stringify(ui.snapshot());ui.pause();ui.refresh();assert.equal(JSON.stringify(ui.snapshot()),preserved);
 // A new unlocated glyph preserves known letters but does not disable suggestions.
 await click('format');const completeDraft=el('formatted').value;
 await el('stage').fire('pointerdown',{clientX:10,clientY:10});await key(1);
 assert.equal(el('raw').value,'AC');assert(el('reading-groups').textContent.includes('未定位'));assert(!el('formatted').readOnly);assert(!el('format').disabled);assert.equal(el('formatted').value,completeDraft);await click('format');assert(!el('copy-formatted').disabled);
 el('formatted').value=completeDraft+'!';await el('formatted').fire('input');assert(!el('copy-formatted').disabled);assert(el('format-status').textContent.includes('可能缺字'));await click('format');
 await click('undo');assert.equal(el('raw').value,'AC');assert(!el('formatted').readOnly);
 // Clipboard respects language/mode visibility and only consumes image files.
 const file=Object.assign(new Blob(['pixels'],{type:'image/png'}),{name:'paste.png'});let consumed=0;
 const paste=()=>documentEvents.get('paste')({clipboardData:{items:[{kind:'file',type:'image/png',getAsFile:()=>file}]},preventDefault(){consumed++;}});
 await paste();assert.equal(consumed,0);el('mode-review').hidden=false;nodes.get('panel-siren').hidden=false;await paste();assert.equal(consumed,1);assert(!el('auto-scan').disabled);
 await documentEvents.get('paste')({clipboardData:{items:[{kind:'string',type:'text/plain'}]},preventDefault(){throw Error('Text paste was consumed');}});
 const count=ui.snapshot().groups.length;await click('auto-scan');assert.equal(ui.snapshot().groups.length,count+1);assert.equal(scanPayload.operation,'detect');assert.equal(scanPayload.templates.base.pivotY,assets.base.pivotY);assert(el('scan-status').textContent.includes('待确认'));
 const auto=ui.snapshot().groups.at(-1);assert.equal(auto.items.length,4);assert(auto.items[0].fit);assert.equal(auto.items[0].letter,null);
 assert.deepEqual(scanPayload.templates.path,real.path);assert.equal(scanPayload.image.width,600);assert.equal(scanPayload.image.height,600);
 const inside=createLocatorBoundary(assets.base,real.path);assert(auto.items.every(i=>inside(auto,i)&&i.fit.candidates.every(c=>inside(auto,c))));
 assert(auto.items.some(i=>i.letter==='E'),'Near-boundary E must also survive the UI filter');
 assert(!auto.items.some(i=>['F','C'].includes(i.letter)),'Centres beyond the allowance must not enter this group');
 await el('stage').fire('pointerdown',{clientX:auto.cx,clientY:auto.cy+130});assert.equal(el('keyboard').children[0].children[0].style.transform,'rotate(0deg)');await el('stage').fire('pointerup');
 await el('stage').fire('pointerdown',{clientX:auto.cx,clientY:auto.cy-130});assert.equal(el('keyboard').children[0].children[0].style.transform,'rotate(-180deg)');await el('stage').fire('pointerup');
 const uncertain=ui.snapshot().groups.at(-1).items[0];await el('stage').fire('pointerdown',{clientX:uncertain.x,clientY:uncertain.y});await el('stage').fire('pointerup');assert(!el('match-review').hidden);
 for(const [n,b] of el('match-candidates').children.entries()){
   const candidate=uncertain.fit.candidates[n],preview=b.children[0],img=preview.children[0],label=b.children[1];
   assert.equal(preview.className,'siren-candidate-preview');assert.equal(img.tagName,'IMG');assert.equal(img.src,assets.letters[candidate.letter].src);
   assert.equal(img.style.transform,'rotate('+candidate.rotation+'deg)');assert.equal(img.draggable,false);assert.equal(label.textContent,candidate.letter+' · '+(candidate.score*100).toFixed(1));
 }
 await el('match-candidates').children[0].click();assert.equal(ui.snapshot().groups.at(-1).items[0].letter,'B');
 const poseBefore=JSON.stringify(ui.snapshot().groups.at(-1).items[0].fit);el('angle-slider').value='45';await el('angle-slider').fire('input');await el('angle-slider').fire('change');assert(!ui.snapshot().groups.at(-1).items[0].fit,'Precision movement must drop stale candidate poses');await click('undo');assert.equal(JSON.stringify(ui.snapshot().groups.at(-1).items[0].fit),poseBefore);
 const restoredItem=ui.snapshot().groups.at(-1).items[0];await el('stage').fire('pointerdown',{clientX:restoredItem.x,clientY:restoredItem.y});await el('stage').fire('pointerup');
 await click('position-lock');const lockedSnapshot=JSON.stringify(ui.snapshot());assert(el('radius-slider').disabled);assert(el('base-size').disabled);
 await el('stage').fire('pointerdown',{clientX:restoredItem.x,clientY:restoredItem.y});await el('stage').fire('pointermove',{clientX:10,clientY:10});await el('stage').fire('pointerup',{clientX:10,clientY:10});
 el('angle-slider').value='10';await el('angle-slider').fire('input');await el('match-candidates').children[0].click();await click('open-replace');assert(el('keyboard-panel').hidden);assert.equal(JSON.stringify(ui.snapshot()),lockedSnapshot);
 await click('position-lock');const originalPose=JSON.stringify(ui.snapshot().groups.at(-1).items[0].fit);
 await el('stage').fire('pointerdown',{clientX:restoredItem.x,clientY:restoredItem.y});await el('stage').fire('pointermove',{clientX:10,clientY:10});await el('stage').fire('pointerup');assert(!ui.snapshot().groups.at(-1).items[0].fit);assert(!el('reset-position').hidden);assert(!el('reset-position').disabled);
 await click('reset-position');assert.equal(JSON.stringify(ui.snapshot().groups.at(-1).items[0].fit),originalPose);assert.equal(ui.snapshot().groups.at(-1).items[0].x,restoredItem.x);
 const beforeDelete=ui.snapshot(),originalCrop=beforeDelete.groups.at(-1).image;assert(!el('delete-recognized').disabled);await click('delete-recognized');assert.equal(ui.snapshot().groups.at(-1).items.length,beforeDelete.groups.at(-1).items.length-1);assert.equal(ui.snapshot().groups.at(-1).image,originalCrop);await click('undo');assert.equal(ui.snapshot().groups.at(-1).items.length,beforeDelete.groups.at(-1).items.length);
 await click('save');const v5=JSON.parse(await downloads.at(-1).blob.text());assert.equal(v5.version,6);assert.equal(C.decode(v5).groups.at(-1).items[0].fit.score,.92);
 // A cancelled/hidden or stale response cannot overwrite any work.
 let release;scanDelay=new Promise(r=>release=r);const oldState=JSON.stringify(ui.snapshot()),pending=click('auto-scan');await click('scan-cancel');release([]);await pending;assert.equal(JSON.stringify(ui.snapshot()),oldState);scanDelay=null;
 await click('mode-generate');await paste();assert.equal(consumed,1);await click('mode-review');
 const corrected=ui.snapshot().groups.at(-1).items[0];await el('stage').fire('pointerdown',{clientX:corrected.x,clientY:corrected.y});await el('stage').fire('pointerup');await key(15);assert(el('keyboard-panel').hidden);
 await el('stage').fire('pointerdown',{clientX:corrected.x,clientY:corrected.y});await el('stage').fire('pointermove',{clientX:20,clientY:20});await el('stage').fire('pointerup');await click('reset-position');assert.equal(ui.snapshot().groups.at(-1).items[0].letter,'X');assert(!ui.snapshot().groups.at(-1).items[0].fit,'Reset cannot attach the old letter score to a manually corrected letter');
 assert.equal(el('keyboard').children.map(b=>b.children[1].textContent).join(''),'ABCDEFGHIJKLMZYXWVUTSRQPON');
 // Deep suggestions are source-only previews until explicitly adopted, and can be cancelled.
 await el('stage').fire('pointerdown',{clientX:corrected.x,clientY:corrected.y});await el('stage').fire('pointerup');
 const beforeDeep=JSON.stringify(ui.snapshot());await click('deep-toggle');assert(!el('deep-panel').hidden);assert(!el('deep-run').disabled);
 await el('stage').fire('pointerdown',{clientX:corrected.x-12,clientY:corrected.y-12});await el('stage').fire('pointermove',{clientX:corrected.x+12,clientY:corrected.y+12});await el('stage').fire('pointerup',{clientX:corrected.x+12,clientY:corrected.y+12});assert.equal(JSON.stringify(ui.snapshot()),beforeDeep);
 const candidate={...corrected,letter:'B',rotation:corrected.rotation,score:.93,passesCoverage:true};
 scanDelay=Promise.resolve({candidates:[candidate]});await click('deep-run');scanDelay=null;assert.equal(scanPayload.operation,'deep',el('deep-status').textContent);assert.equal(scanPayload.region.width,24);assert.equal(el('deep-candidates').children.length,1);assert.equal(JSON.stringify(ui.snapshot()),beforeDeep);
 await el('deep-candidates').children[0].click();assert(!el('deep-apply').disabled);assert.equal(JSON.stringify(ui.snapshot()),beforeDeep);
 await click('deep-apply');assert(el('deep-panel').hidden);assert.equal(ui.snapshot().groups.at(-1).items[0].letter,'B');assert(!el('key-replace').disabled,'Accepted glyph must remain selected after validation replaces IDs');await click('undo');assert.equal(JSON.stringify(ui.snapshot()),beforeDeep);
 await click('deep-toggle');await el('stage').fire('pointerdown',{clientX:corrected.x-12,clientY:corrected.y-12});await el('stage').fire('pointerup',{clientX:corrected.x+12,clientY:corrected.y+12});
 scanDelay=new Promise(r=>release=r);const deepPending=click('deep-run');await click('deep-close');release({candidates:[candidate]});await deepPending;scanDelay=null;assert.equal(JSON.stringify(ui.snapshot()),beforeDeep);assert(el('deep-panel').hidden);assert.equal(el('deep-candidates').children.length,0);
 assert.equal(networkCalls,1);console.log('PASS Siren UI doubles including paired keyboard, manual deep preview/adoption/undo, non-mutating ROI and cancellation. No browser or visual QA performed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
