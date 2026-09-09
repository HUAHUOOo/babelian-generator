const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),vm=require('node:vm');
const {create,reflow,createDraft}=require('../src/text-format.js');
const data=zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../src/english-words.txt.gz'))).toString();
const formatter=create(data.trim().split(/\s+/).filter(w=>/^[a-z]{2,32}$/.test(w)||w==='a'||w==='i').join(' '));
const plain=text=>({text,spans:[]});
function perLetter(text){return {text,spans:Array.from(text,(ch,i)=>({glyph:'g'+i,start:i,end:i+1,text:ch})).filter(s=>/[A-Za-z]/.test(s.text))};}
function validSpans(old,next){
 assert.deepEqual(next.spans.map(s=>s.glyph),old.spans.map(s=>s.glyph));
 next.spans.forEach((span,i)=>{
  assert.equal(span.text,next.text.slice(span.start,span.end));assert.equal(span.text.replace(/[\s.,;:!?]/g,''),old.spans[i].text.replace(/[\s.,;:!?]/g,''));
  if(i)assert(next.spans[i-1].end<=span.start);
 });
}
const samples=[
 ['thequickbrownfoxjumpsoverthelazydog','the quick brown fox jumps over the lazy dog'],
 ['THISISTHEPOWEROFDIONYSIANALCHEMY','THIS IS THE POWER OF DIONYSIAN ALCHEMY'],
 ['WITHtheCURSEBROKENAfinalREWARDAWAITS','WITH the CURSE BROKEN A final REWARD AWAITS'],
 ['eleventhousandfivehundredninetynineminusseventhousandsixhundredeightyplussixteen','eleven thousand five hundred ninety nine minus seven thousand six hundred eighty plus sixteen'],
 ['ThnitosKhrusosisamineral','Thnitos Khrusos is a mineral'],
 ['seeparagraph9301','see paragraph 9301'],
 ['theDra\ngonfalls','the Dragon falls']
];
for(const [text,expected] of samples){const source=perLetter(text),frozen=JSON.stringify(source),result=formatter.suggest(source,{punctuate:false});assert.equal(result.text,expected);validSpans(source,result);assert.equal(JSON.stringify(source),frozen);}
const story=perLetter('TheDragoncoilsintheDarkBelowIfyouwantproceedtoaBattleIfyouloseproceedtoanormalDefeatIfyouwinseeparagraphninethreezeroone');
const punctuated=formatter.suggest(story);
assert(punctuated.text.includes('Below.\nIf you want, proceed'));assert(punctuated.text.includes('If you win, see paragraph nine three zero one.'));assert(punctuated.punctuationCount>=4);validSpans(story,punctuated);
assert.equal(formatter.suggest(plain('Ifyouwinseeparagraph9301')).text,'If you win, see paragraph 9301.');
const a=formatter.suggest(plain('the[?]dragon[未映射]falls'));assert(a.text.includes('[?]'));assert(a.text.includes('[未映射]'));
assert.equal(formatter.suggest(plain('abcXYZ123')).text.replace(/[\s.,]/g,''),'abcXYZ123');
assert.equal(formatter.suggest(plain('')).text,'');
const term=formatter.suggest(plain('theZyxarlthfalls'),{punctuate:false,extraWords:['Zyxarlth']});assert.equal(term.text,'the Zyxarlth falls');
// Word-mapped glyphs stay intact even if a user adds internal whitespace.
const word={text:'WITHtheCURSE',spans:[{glyph:'word',start:0,end:4,text:'WITH'},{glyph:'the',start:4,end:7,text:'the'},{glyph:'last',start:7,end:12,text:'CURSE'}]};
const output=reflow(word,'WITH the CURSE.');assert.equal(output.spans.length,3);assert.equal(output.spans[1].text,'the');assert.equal(output.spans[2].end,14);
assert.equal(reflow({text:'CUSTOMWORD',spans:[{glyph:'single',start:0,end:10,text:'CUSTOMWORD'}]},'CUSTOM WORD.').spans[0].text,'CUSTOM WORD');
const symbols=plain('a[?]B[未映射]9301!/?');assert.equal(reflow(symbols,'a [?] B [未映射] 9301 !/?').text,'a [?] B [未映射] 9301 !/?');
for(const bad of ['the dragon','the[!]dragon','the[ ? ]dragon','the[?]Dragon'])assert.throws(()=>reflow(plain('the[?]dragon'),bad));
assert.throws(()=>reflow(plain('9301'),'3935'));assert.throws(()=>reflow(plain('Hello!'),'Hello.'));assert.throws(()=>reflow(plain('ABC'),'XYZ'));
// A semantic-false but letter-valid suggestion must never flow back into OCR.
const unknown=formatter.suggest(plain('xxqz'),{punctuate:false});assert.equal(unknown.text.replace(/\s/g,''),'xxqz');
console.log('PASS formatting: ranked-word segmentation; case/digits/placeholders/source punctuation preserved; ATO terms; cross-line words; suggestion punctuation; span identity/order.');

const draft=createDraft(formatter),p=perLetter('theDragonfalls'),opt={punctuate:false,extraWords:[]};
draft.update(p,opt);draft.edit('the Dragon falls!');assert.equal(draft.payload().text,'the Dragon falls!');
assert(draft.update(p,opt).dirty);assert.equal(draft.state().value,'the Dragon falls!');
const p2=perLetter('theDragoncoils');assert(draft.update(p2,opt).stale);assert.equal(draft.state().value,'the Dragon falls!');assert.throws(()=>draft.payload(),/已变化/);
assert(!draft.update(p,opt).stale);assert.equal(draft.payload().text,'the Dragon falls!');
draft.update(p2,opt);draft.generate(p2,opt);assert.equal(draft.payload().text,'the Dragon coils');
draft.edit('the Dragon wins');assert(draft.state().error);assert.throws(()=>draft.payload());draft.clear();assert.equal(draft.state(),null);
draft.update(p,opt);draft.update(p2,opt);assert.equal(draft.payload().text,'the Dragon coils');
draft.edit('the Dragon coils.');assert(draft.update(p2,{...opt,punctuate:true}).stale);
console.log('PASS formatting drafts: unchanged refresh preserves edits; new mapping/recognition/settings cannot overwrite edited text; stale export blocked; explicit regeneration; clear.');

const start=Date.now(),long=formatter.suggest(plain('thequickbrownfoxjumpsoverthelazydog'.repeat(150)),{punctuate:false});
assert.equal(long.text.replace(/\s/g,''),'thequickbrownfoxjumpsoverthelazydog'.repeat(150));assert(Date.now()-start<10000);
assert.throws(()=>formatter.suggest(plain('x'.repeat(80001))),/过长/);
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
assert(html.includes('Copyright (c) 2017 Derek Anderson'));assert(html.includes('wordninja'));assert(!html.includes('__ENGLISH_WORD_DATA__'));
const source=fs.readFileSync(path.join(__dirname,'../src/text-format.js'),'utf8');assert(!/\b(fetch|XMLHttpRequest|localStorage)\b/.test(source));
console.log('PASS formatting build: offline dictionary and license embedded; bounded long input; no remote calls.');
