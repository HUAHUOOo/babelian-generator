const assert=require('node:assert/strict'),fs=require('node:fs');
const {chunks,createClient,createSession,MAX_BYTES}=require('../src/translation.js');
const {createDraft,create}=require('../src/text-format.js');
const ok=translatedText=>({ok:true,json:async()=>({responseStatus:200,responseData:{translatedText}})});
async function run(){
  for(const input of ['If you win, see paragraph 9301.\n\nIf you lose: proceed to Defeat!',('The Dragon coils in the Dark Below. ').repeat(60),'x'.repeat(1300),'甲🙂'.repeat(300),'a [?] b [未映射] c']){
    const parts=chunks(input);assert.equal(parts.map(p=>p.text).join(''),input);
    parts.forEach(p=>assert(Buffer.byteLength(p.text)<=MAX_BYTES));
  }
  assert.throws(()=>chunks(' '));assert.throws(()=>chunks('a'.repeat(5001)),/5000/);
  const calls=[];
  const client=createClient(async(url,options)=>{calls.push({url:new URL(url),options});return ok('中文');});
  assert.equal(calls.length,0,'initializing cannot send data');
  const edited='If you win: see paragraph 9301!\n\nIf you lose, proceed to Defeat.';
  assert.equal(await client(edited),'中文');
  assert.equal(calls[0].url.searchParams.get('q'),edited,'use exact edited source, not automatic formatting');
  assert.equal(calls[0].url.searchParams.get('langpair'),'en|zh-CN');
  assert.deepEqual([...calls[0].url.searchParams.keys()],['q','langpair','mt']);
  assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].url.pathname,'/get');
  calls.length=0;
  assert.equal(await client('Hello [?] world [未映射].'),'中文 [?] 中文 [未映射]中文');
  assert(calls.every(c=>!c.url.searchParams.get('q').includes('[?]')&&!c.url.searchParams.get('q').includes('未映射')));
  const long=('If you win, see paragraph 9301.\n').repeat(40);calls.length=0;
  const progress=[];await client(long,{onProgress:p=>progress.push(p)});
  assert(calls.length>1);assert.equal(calls.map(c=>c.url.searchParams.get('q')).join(''),long);
  assert.equal(progress.at(-1).done,progress.at(-1).total);
  await assert.rejects(createClient(async()=>({ok:false,status:503}))('Hello'),/503/);
  await assert.rejects(createClient(async()=>({ok:true,json:async()=>({responseStatus:429,quotaFinished:true})}))('Hello'),/额度/);
  await assert.rejects(createClient(async()=>({ok:true,json:async()=>({responseStatus:200,responseData:{translatedText:''}})}))('Hello'),/有效译文/);
  await assert.rejects(createClient(async()=>{throw new TypeError('Failed to fetch');})('Hello'),/跨域/);
  await assert.rejects(createClient((_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')))),5)('Hello'),/超时/);
  const abort=new AbortController();let count=0;
  const interrupted=createClient(async()=>{count++;return ok('中文');});
  await assert.rejects(interrupted(long,{signal:abort.signal,onProgress:()=>abort.abort()}),/取消/);assert.equal(count,1);

  const pending=[],states=[];
  const session=createSession((text,{signal})=>new Promise((resolve,reject)=>pending.push({text,signal,resolve,reject})),s=>states.push(s));
  // Use the same draft guard as UI. This is not a browser/DOM test.
  const draft=createDraft(create('if you win see paragraph'));
  draft.generate({text:'Ifyouwinseeparagraph9301',spans:[]},{punctuate:false});
  draft.edit('If you win: see paragraph 9301!');
  const task=session.run(draft.payload().text);assert.equal(pending[0].text,'If you win: see paragraph 9301!');
  assert.equal(session.state().status,'busy');
  draft.edit('If you win, see paragraph 9301.');session.sync(draft.payload().text);
  assert(pending[0].signal.aborted);pending[0].resolve('旧译文');await task;
  assert.equal(session.state().value,'');assert.equal(session.state().status,'stale');
  const newer=session.run(draft.payload().text);pending[1].resolve('新译文');await newer;
  assert.equal(session.state().value,'新译文');
  session.sync(draft.payload().text);assert.equal(session.state().status,'done');
  session.sync(draft.payload().text,false);assert.equal(session.state().value,'');
  const first=session.run('One.'),second=session.run('Two.');pending[3].resolve('二');await second;pending[2].resolve('一');await first;
  assert.equal(session.state().value,'二');assert.equal(session.state().source,'Two.');
  const cancelled=session.run('Cancel.');session.cancel();pending[4].resolve('不要显示');await cancelled;assert.equal(session.state().value,'');
  const failed=session.run('Fail.');pending[5].reject(Error('offline'));await failed;assert.equal(session.state().error,'offline');
  console.log('PASS translation: exact edited English, byte-safe chunks, literal unknown markers, text-only opt-in transport, progress, errors/quota/timeout/cancel, stale and racing response protection.');

  const ui=fs.readFileSync(require.resolve('../src/ocr-ui.js'),'utf8'),html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  assert(html.includes('id="ocr-translate-consent" type="checkbox">'),'consent must default to unchecked');
  const handler=ui.slice(ui.indexOf("$('ocr-translate-run').addEventListener"),ui.indexOf("$('ocr-translate-cancel').addEventListener"));
  assert(handler.includes('formattedDraft.payload().text'));assert(!handler.includes('generate('));assert(!handler.includes('refreshFormatted('));
  assert.equal((ui.match(/translation\.run\(/g)||[]).length,1,'only the explicit button invokes translation');
  console.log('PASS translation integration source checks: unchecked consent and single explicit call path, no regeneration of user edits.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
