const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
  await page.route(/^https?:/,r=>{requests.push(r.request().url());return r.abort();});
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await page.waitForFunction(()=>window.BABELIAN_APP?.navigation);
  assert.equal(await page.title(),'巴别语与塞壬语翻译器 · Babelian & Siren Translator');
  assert.deepEqual(await page.locator('.language-choice strong').allTextContents(),['巴别语生成','巴别语翻译','塞壬语生成','塞壬语翻译']);
  fs.mkdirSync(path.join(__dirname,'qa'),{recursive:true});
  for(const width of [1400,390]){
   await page.setViewportSize({width,height:1000});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(__dirname,'qa/home-'+width+'.png'),fullPage:true});
  }
  await page.setViewportSize({width:1400,height:1000});
  const enter=async id=>{if(!(await page.locator('#language-home').isVisible()))await page.locator('#language-back').click();await page.locator('#'+id).click();};
  await enter('language-open-babelian');assert(await page.locator('#babelian-writer').isVisible());assert(!(await page.locator('#panel-decode').isVisible()));
  await page.locator('#english-input').fill('Keep My Draft');
  await enter('language-open-babelian-translate');assert(await page.locator('#panel-decode').isVisible());assert(!(await page.locator('#babelian-writer').isVisible()));assert(!(await page.locator('#download').isVisible()));
  await page.locator('#tab-mapping').click();assert(await page.locator('#panel-mapping').isVisible());
  await page.locator('#babelian-title').focus();await page.keyboard.type('XYZ');
  assert.equal(await page.locator('#english-input').inputValue(),'Keep My Draft','Hidden writer must not consume translation-page keys');
  await page.locator('#tab-decode').click();
  await page.screenshot({path:path.join(__dirname,'qa/babelian-translate.png')});
  await enter('language-open-babelian');assert.equal(await page.locator('#english-input').inputValue(),'Keep My Draft');
  assert.equal(await page.locator('.letter-key:enabled').count(),26,'The supplied chart is ready on first use');
  await enter('language-open-siren-translate');await page.waitForFunction(()=>window.BABELIAN_APP.siren.snapshot().mode==='review');
  assert(await page.locator('#siren-review-tools').isVisible());assert(!(await page.locator('#siren-generate-tools').isVisible()));
  await page.screenshot({path:path.join(__dirname,'qa/siren-translate.png')});
  await enter('language-open-siren');await page.waitForFunction(()=>window.BABELIAN_APP.siren.snapshot().mode==='generate');
  await page.locator('#siren-open-add').click();await page.getByRole('button',{name:'塞壬字母 A',exact:true}).click();
  const generated=await page.evaluate(()=>JSON.stringify(window.BABELIAN_APP.siren.snapshot()));
  assert.equal(JSON.parse(generated).groups[0].items[0].letter,'A');
  await enter('language-open-siren-translate');await page.waitForFunction(()=>window.BABELIAN_APP.siren.snapshot().mode==='review');
  assert.equal((await page.evaluate(()=>window.BABELIAN_APP.siren.snapshot())).groups.length,0,'Generation does not leak into recognition');
  await enter('language-open-siren');await page.waitForFunction(()=>window.BABELIAN_APP.siren.snapshot().mode==='generate');
  assert.equal(await page.evaluate(()=>JSON.stringify(window.BABELIAN_APP.siren.snapshot())),generated);
  // Several entry requests in one turn must leave the last requested mode active.
  await page.evaluate(()=>{const n=window.BABELIAN_APP.navigation;n.show('siren-translate');n.show('siren-generate');n.show('siren-translate');});
  await page.waitForFunction(()=>window.BABELIAN_APP.siren.snapshot().mode==='review');
  assert.equal(await page.locator('#siren-title').textContent(),'塞壬语翻译');
  await page.locator('#language-back').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'language-open-siren-translate');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log('PASS four direct entries, desktop/mobile home, hidden-writer guards, supplied defaults, draft retention, independent Siren modes and latest-entry/focus behavior; no network.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
