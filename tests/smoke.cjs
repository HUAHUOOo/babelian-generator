const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const url=pathToFileURL(path.resolve(__dirname,'../index.html')).href;
const STORE='ato-babelian-mapping-profiles-v2';
const OLD='ato-babelian-mapping-profiles-v1';
require('node:fs').mkdirSync(path.join(__dirname,'qa'),{recursive:true});

(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true});
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(url);
  await page.waitForFunction(()=>window.BABELIAN_APP?.restoreWorkspace);
  await page.locator('#language-open-babelian').click();
  const assetCheck=await page.evaluate(async()=>{
   const {glyphs:GLYPHS,parts:PARTS}=window.BABELIAN_APP.assets;
   const assets=[...Object.values(GLYPHS),...PARTS.components];
   const checks=await Promise.all(assets.map(async asset=>{
    const img=new Image();img.src=asset.src;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
    const context=canvas.getContext('2d');context.drawImage(img,0,0);
    const rgba=context.getImageData(0,0,img.width,img.height).data;
    let antialiased=false,transparent=false,ink=false;
    for(let i=3;i<rgba.length;i+=4){const a=rgba[i];antialiased ||= a>0&&a<255;transparent ||= a===0;ink ||= a===255;}
    return img.naturalWidth===asset.width&&img.naturalHeight===asset.height&&antialiased&&transparent&&ink;
   }));
   return {count:checks.length,valid:checks.every(Boolean),minHeight:Math.min(...Object.values(GLYPHS).map(g=>g.height))};
  });
  assert.equal(assetCheck.count,64);assert(assetCheck.valid);assert(assetCheck.minHeight>=190);
  const text=()=>page.locator('#english-input').inputValue();
  const glyphs=()=>page.locator('.cipher-glyph').evaluateAll(nodes=>nodes.map(n=>n.dataset.glyph));
  const data=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),STORE);
  const write=()=>page.locator('#tab-write').click();
  const editor=()=>page.locator('#tab-mapping').click();
  const key=letter=>page.locator('.letter-key[data-letter="'+letter+'"]');
  const word=glyph=>page.locator('.special-key[data-glyph="'+glyph+'"]');
  const slot=i=>page.locator('.profile-slot[data-slot="'+i+'"]');
  const choose=async glyph=>{
   await editor();
   if(!await page.locator('.catalog-details').evaluate(node=>node.open))await page.locator('.catalog-details summary').click();
   await page.locator('.catalog-key[data-glyph="'+glyph+'"]').click();
  };
  const apply=async value=>{await page.locator('#mapping-value').fill(value);await page.locator('#mapping-apply').click();};
  const assign=async(glyph,value)=>{await choose(glyph);await apply(value);};
  const reference=await data();
  const expected=await page.evaluate(()=>{const words={and:'AND',the:'THE',a_word:'A',OF:'OF',OR:'OR','!/?':'!/?'};return Object.fromEntries(Object.keys(window.BABELIAN_APP.assets.glyphs).map(id=>[id,words[id]??id]));});
  assert.deepEqual(reference.workingMap,expected);assert.deepEqual(reference.baselineMap,expected);assert.equal(reference.baseName,'默认字形表');
  assert.equal(await page.locator('.letter-key:enabled').count(),26);assert.equal(await page.locator('.special-key').count(),6);assert(!(await page.locator('#mapping-warning').isVisible()));
  await key('A').click();await word('a_word').click();assert.equal(await text(),'AA');assert.deepEqual(await glyphs(),['A','a_word']);
  await page.locator('#case-lower').click();assert.equal(await page.locator('.letter-key:enabled').count(),26);await key('a').click();assert.deepEqual(await glyphs(),['A','a_word','a']);
  await page.reload();await page.locator('#language-open-babelian').click();assert.deepEqual(await glyphs(),['A','a_word','a']);assert.deepEqual((await data()).workingMap,expected);
  await page.locator('#clear').click();await editor();await page.locator('#profile-default').click();await write();await page.locator('#case-upper').click();
  assert.equal(await page.locator('.letter-key').count(),26);
  assert.equal(await page.locator('.letter-key:disabled').count(),26);
  assert.equal(await page.locator('.letter-key img').count(),0);
  assert.equal(await page.locator('.special-key').count(),0);
  assert(Object.values((await data()).workingMap).every(value=>value===''));
  await editor();
  for(const icon of await page.locator('.part-control img').all()){
   const box=await icon.boundingBox();assert(box.height<=61&&box.width<=61);
  }
  assert.equal(await page.locator('#candidate-position').textContent(),'1 / 2 个候选');
  assert.equal(await page.locator('#mapping-value').inputValue(),'');
  assert.equal(await page.locator('#candidate-meaning').textContent(),'未设置');
  assert((await page.locator('#candidate-id').textContent()).startsWith('字形 G'));
  await page.locator('#candidate-next').click();
  assert.equal(await page.locator('#mapping-value').inputValue(),'');
  await page.locator('#filter-reset').click();
  assert.equal(await page.locator('#candidate-position').textContent(),'0 个候选');
  assert(await page.locator('#mapping-apply').isDisabled());
  await page.locator('#filter-all').click();
  assert((await page.locator('#candidate-position').textContent()).includes('/ 58'));
  console.log('PASS: first-use chart, all upper/lower letters and six ligatures, distinct A/article insertion and reload; explicit blank configuration and component finder remain usable.');

  await assign('S','A');await write();
  assert(await key('A').isEnabled());assert(await key('S').isDisabled());
  assert.equal(await key('A').getAttribute('data-glyph'),'S');
  assert.equal(await page.locator('.letter-key:enabled').count(),1);
  await key('A').click();await page.locator('#space').click();await key('A').click();
  assert.equal(await text(),'A A');assert.deepEqual(await glyphs(),['S','S']);
  await page.locator('#case-lower').click();assert(await key('a').isDisabled());
  await assign('s','a');await write();await page.locator('#case-lower').click();
  assert.equal(await key('a').getAttribute('data-glyph'),'s');
  await key('a').click();assert.equal(await text(),'A Aa');
  console.log('PASS: assigned glyph moves to matching English key; A/a independent; spaces add no glyph.');

  await assign('B','A');
  assert(await page.locator('#conflict-dialog').isVisible());
  assert.equal(await page.locator('.conflict-option').count(),2);
  assert.deepEqual(await page.locator('.conflict-option').evaluateAll(nodes=>nodes.map(n=>n.dataset.glyph)),['B','S']);
  assert.equal((await data()).workingMap.B,'');assert.equal((await data()).workingMap.S,'A');
  const before=await text();await page.keyboard.press('KeyR');assert.equal(await text(),before);
  await page.locator('.conflict-option[data-glyph="B"]').click();
  assert.equal(await page.locator('#mapping-value').inputValue(),'A');
  await apply('D');assert.equal((await data()).workingMap.B,'D');
  await assign('C','A');
  await page.locator('.conflict-option[data-glyph="S"]').click();
  assert.equal(await page.locator('#mapping-value').inputValue(),'A');
  await apply('Z');
  assert.equal((await data()).workingMap.C,'');
  assert.equal((await data()).workingMap.S,'Z');
  await assign('C','A');assert(!await page.locator('#conflict-dialog').isVisible());
  assert.equal((await data()).workingMap.C,'A');
  assert.equal(await text(),'Z Za');assert.deepEqual(await glyphs(),['S','S','s']);
  console.log('PASS: duplicate prompts show both glyphs; choosing either edits only that glyph; no silent overwrite.');

  await assign('B','AND');await write();await page.locator('#case-upper').click();
  assert(await key('D').isDisabled());
  assert.equal(await word('B').textContent(),'AND');
  assert.equal(await page.locator('.special-key').count(),1);
  await word('B').click();assert.equal(await text(),'Z ZaAND');
  assert.deepEqual(await glyphs(),['S','S','s','B']);
  await page.locator('#case-lower').click();assert.equal(await word('B').textContent(),'AND');
  await assign('and','AND');assert(await page.locator('#conflict-dialog').isVisible());
  await page.locator('#conflict-cancel').click();
  assert.equal((await data()).workingMap.and,'');
  await apply('and'); // Case is significant for words too.
  await assign('the','?');await assign('OF','xy z');
  await write();assert.equal(await page.locator('.special-key').count(),4);
  await word('OF').click();assert.equal((await text()).slice(-4),'xy z');
  await page.locator('#backspace').click();assert.equal(await text(),'Z ZaAND');
  await assign('OR','Q');await write();await page.locator('#case-upper').click();
  assert.equal(await key('Q').getAttribute('data-glyph'),'OR');assert.equal(await word('OR').count(),0);
  console.log('PASS: arbitrary words/symbols from any glyph go below; one-letter special glyphs go to alphabet; case and atomic deletion preserved.');

  await page.locator('#clear').click();await page.locator('#case-upper').click();
  await page.keyboard.press('KeyA');
  assert.equal(await text(),'a');assert.deepEqual(await glyphs(),['s']);
  await page.keyboard.press('Shift+KeyA');
  assert.equal(await text(),'aA');assert.deepEqual(await glyphs(),['s','C']);
  // Playwright's KeyA does not derive its key text from OS Caps Lock; dispatch
  // the browser event values that a real Caps Lock press produces instead.
  await page.evaluate(()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'A',code:'KeyA',modifierCapsLock:true,bubbles:true})));
  assert.equal(await text(),'aAA');
  await page.evaluate(()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',modifierCapsLock:true,shiftKey:true,bubbles:true})));
  assert.equal(await text(),'aAAa');
  console.log('PASS: physical letters follow Shift/Caps Lock, not manual keyboard case.');

  await editor();await page.locator('#profile-name').fill('部分对应');await page.locator('#profile-save').click();
  const savedMap={...(await data()).workingMap};
  await assign('C','');assert.equal((await data()).workingMap.C,'');
  assert.equal(await text(),'a??a');assert.deepEqual(await glyphs(),['s','C','C','s']);
  await page.locator('#undo').click();assert.equal(await text(),'aAAa');
  await slot(1).click();await page.locator('#profile-default').click();
  assert.equal(await text(),'????');assert.deepEqual(await glyphs(),['s','C','C','s']);
  await page.locator('#profile-name').fill('空白');await page.locator('#profile-save').click();
  assert(Object.values((await data()).profileSlots[1].mapping).every(value=>value===''));
  await page.reload();await page.locator('#language-open-babelian').click();await write();assert.equal(await page.locator('.letter-key:enabled').count(),0);
  assert.deepEqual(await glyphs(),['s','C','C','s']);
  await editor();await slot(0).click();await page.locator('#profile-load').click();
  assert.deepEqual((await data()).workingMap,savedMap);assert.equal(await text(),'aAAa');
  assert.equal((await data()).profileSlots[1].name,'空白');
  console.log('PASS: clear/reassign/undo preserve ciphertext; partial and blank named slots survive reload independently.');

  const downloading=page.waitForEvent('download');await page.locator('#profile-export').click();
  const file=await downloading;const exported=path.join(__dirname,'qa/blank-mapping-roundtrip.json');await file.saveAs(exported);
  await slot(2).click();await page.locator('#profile-file').setInputFiles(exported);
  await page.waitForFunction(()=>document.getElementById('profile-status').textContent.includes('已导入'));
  await page.locator('#profile-default').click();await page.locator('#profile-load').click();
  assert.deepEqual((await data()).workingMap,savedMap);
  await page.locator('#profile-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"format":"ato-babelian-mapping","version":2,"mapping":{"S":"test"}}')});
  await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('导入失败'));
  assert.deepEqual((await data()).workingMap,savedMap);
  console.log('PASS: partial/empty JSON round-trip; invalid imports do not mutate current mapping.');

  const beforeDefault=await data(),beforeDefaultText=await text(),beforeDefaultGlyphs=await glyphs();
  page.once('dialog',d=>d.dismiss());await page.locator('#profile-reference').click();assert.deepEqual(await data(),beforeDefault);
  page.once('dialog',d=>d.accept());await page.locator('#profile-reference').click();assert.deepEqual((await data()).workingMap,expected);assert.deepEqual((await data()).profileSlots,beforeDefault.profileSlots);
  await page.locator('#undo').click();assert.deepEqual((await data()).workingMap,beforeDefault.workingMap);assert.equal(await text(),beforeDefaultText);assert.deepEqual(await glyphs(),beforeDefaultGlyphs);
  console.log('PASS: explicit default load can be cancelled, preserves five saved slots and is undoable.');

  // Preserve saved v1 profiles and leave their original storage bytes as backup.
  const legacyMap=await page.evaluate(()=>{
   const specials={and:'AND',the:'THE',a_word:'A',OF:'OF',OR:'OR','!/?':'!/?'};
   return Object.fromEntries(Object.keys(window.BABELIAN_APP.assets.glyphs).map(key=>[key,specials[key]??key]));
  });
  const legacy={version:1,workingMap:legacyMap,baselineMap:legacyMap,baseName:'原表配置',chosenSlot:0,profileSlots:[{name:'原有保存栏位',mapping:{...legacyMap,S:'HELLO',C:'A'},savedAt:'2026-09-08'},null,null,null,null]};
  await page.evaluate(({old,key,payload})=>{
   localStorage.setItem(old,JSON.stringify(payload));localStorage.removeItem(key);
   localStorage.setItem('ato-babelian-writer-v1',JSON.stringify({text:'Ab c',keyboardCase:'upper',specialSpans:[]}));
  },{old:OLD,key:STORE,payload:legacy});
  await page.reload();
  await page.locator('#language-open-babelian').click();
  assert.deepEqual((await data()).workingMap,legacyMap);
  assert.equal(await text(),'Ab c');assert.deepEqual(await glyphs(),['A','b','c']);
  assert.deepEqual((await data()).profileSlots,legacy.profileSlots);
  assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),OLD),legacy);
  await editor();await page.locator('#profile-load').click();
  assert(await page.locator('#conflict-dialog').isVisible());
  assert(await page.locator('#mapping-warning').isVisible());
  assert.equal((await data()).workingMap.S,'HELLO');
  await page.locator('.conflict-option[data-glyph="C"]').click();await apply('C');
  assert(!await page.locator('#mapping-warning').isVisible());
  await write();await page.locator('#case-upper').click();assert(await key('A').isEnabled());
  console.log('PASS: legacy original chart, saved profiles and v1 backup preserved; custom duplicates still require explicit correction.');

  // Customized, unsaved v1 working drafts also survive migration.
  legacy.workingMap={...legacyMap,S:'CUSTOM',C:'A'};
  await page.evaluate(({old,key,payload})=>{localStorage.setItem(old,JSON.stringify(payload));localStorage.removeItem(key);},{old:OLD,key:STORE,payload:legacy});
  await page.reload();await page.locator('#language-open-babelian').click();assert.equal((await data()).workingMap.S,'CUSTOM');
  assert(await page.locator('#mapping-warning').isVisible());
  await editor();await page.locator('#profile-default').click();
  if(await text())await page.locator('#clear').click();
  await assign('S','A');await assign('s','a');await assign('B','AND');await assign('C','THE');
  await write();await page.locator('#case-upper').click();
  await key('A').click();await page.locator('#space').click();await word('B').click();
  const pngEvent=page.waitForEvent('download');await page.locator('#download').click();
  const png=await pngEvent;assert(png.suggestedFilename().endsWith('.png'));
  await page.waitForFunction(()=>!document.getElementById('status').classList.contains('show'));
  for(const width of [1440,768,390,320]){
   await page.setViewportSize({width,height:1100});await write();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const boxes=await page.locator('.letter-key').evaluateAll(nodes=>nodes.map(n=>({y:n.getBoundingClientRect().y})));
   assert.equal(boxes.filter(n=>n.y===boxes[0].y).length,10);
   assert.equal(boxes.filter(n=>n.y===boxes[10].y).length,9);
   assert.equal(boxes.filter(n=>n.y===boxes[19].y).length,7);
   if([1440,390].includes(width))await page.screenshot({path:path.join(__dirname,'qa/blank-keyboard-'+width+'.png'),fullPage:true});
   await assign('D','AND');
   assert(await page.locator('#conflict-dialog').isVisible());
   assert.equal(await page.locator('#conflict-dialog').evaluate(n=>n.scrollWidth>n.clientWidth),false);
   if([1440,390].includes(width))await page.screenshot({path:path.join(__dirname,'qa/blank-conflict-'+width+'.png'),fullPage:true});
   await page.locator('#conflict-cancel').click();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: customized legacy draft preserved; PNG export; QWERTY and conflict dialog fit desktop/tablet/phone; no JS errors.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
