const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {create,WRITER,MAP,validateProfile}=require('../src/runtime.js');
const root=path.resolve(__dirname,'..');
const ids=Object.keys(JSON.parse(fs.readFileSync(path.join(root,'src/glyphs.json'))));
const clone=x=>JSON.parse(JSON.stringify(x));
const blank=()=>Object.fromEntries(ids.map(id=>[id,'']));
const mapping=()=>({version:2,workingMap:blank(),baselineMap:blank(),baseName:'空白配置',profileSlots:Array(5).fill(null),chosenSlot:0});
const writer=text=>({text,keyboardCase:'upper',specialSpans:[]});
function memory(){const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),clear:()=>values.clear(),values};}
function server(){
 return {who:'alice',active:'campaign-1',patched:true,offline:false,docs:{},posts:[],getLog:[],beforePost:null,
  account(){return this.docs[this.who]??={revision:0,state:null};},
  async fetch(url,options){
   const query=new URL(url).searchParams;
   if(this.offline)throw Error('network unavailable');
   const response=(status,payload)=>({status,ok:status<400,json:async()=>clone(payload)});
   const user={id:this.who,username:this.who};
   if(query.get('action')==='me')return response(200,{ok:true,authenticated:!!this.who,user:this.who?user:null});
   if(!this.who)return response(401,{ok:false});
   if(query.get('section')==='dashboard')return response(200,{ok:true,state:{activeProfileId:this.active},user});
   if(query.get('section')!=='babelian'||!this.patched)return response(400,{ok:false,error:'Unknown section.'});
   if(options.method==='GET'){this.getLog.push(this.who);return response(200,{ok:true,...this.account(),user});}
   if(this.beforePost)await this.beforePost();
   const body=JSON.parse(options.body),doc=this.account();
   if(body.ownerId!==this.who)return response(403,{ok:false,error:'Babelian account changed.'});
   if(body.profileId!==this.active||body.expectedRevision!==doc.revision)return response(409,{ok:false});
   assert.equal(options.credentials,'same-origin');
   this.posts.push(clone(body));doc.state=clone(body.state);doc.revision++;
   return response(200,{ok:true,revision:doc.revision});
  }
 };
}
function environment(s,local=memory(),url='https://ato.test/babelian/index.html'){
 let serial=0;const timers=new Map();
 return {localStorage:local,location:{href:url},fetch:s?((...args)=>s.fetch(...args)):()=>{throw Error('Independent mode must not fetch');},
  setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},timers};
}
function app(s,env){return create({mode:s?'ato':'standalone',ids},env||environment(s));}
async function run(){
 const local=memory(),offline=app(null,environment(null,local,'file:///offline/index.html'));
 await offline.initialize();offline.storage.setItem(MAP,JSON.stringify(mapping()));offline.storage.setItem(WRITER,JSON.stringify(writer('old text')));
 assert.equal(JSON.parse(local.getItem(WRITER)).text,'old text');assert.equal(offline.hasPending(),false);
 const backup=offline.backup(),target=app(null,environment(null));await target.initialize();target.replaceProfile(target.decodeBackup(backup));assert.deepEqual(target.backup().profile,backup.profile);
 const malformed=clone(backup);malformed.profile.mappings.profileSlots[2]={name:'bad',mapping:{}};
 assert.throws(()=>target.decodeBackup(malformed));assert.deepEqual(target.backup().profile,backup.profile);
 const partial=clone(backup);partial.profile.mappings.workingMap.A='AND';partial.profile.mappings.workingMap.a='a';partial.profile.writer={text:'AND a',keyboardCase:'lower',specialSpans:[{start:0,end:3,glyph:'A',text:'AND'}]};
 validateProfile(partial.profile,ids);target.replaceProfile(target.decodeBackup(partial));assert.deepEqual(target.backup().profile,partial.profile);
 console.log('PASS standalone: no HTTP; old keys unchanged; five-slot/workspace migration; malformed import is non-mutating.');
 const deniedEnv=environment(null);Object.defineProperty(deniedEnv,'localStorage',{get(){throw Error('denied');}});
 const denied=app(null,deniedEnv);await denied.initialize();assert.equal(denied.storage.getItem(WRITER),null);
 assert.throws(()=>denied.storage.setItem(WRITER,JSON.stringify(writer('in memory'))));assert.throws(()=>denied.storage.setItem(MAP,JSON.stringify(mapping())));
 assert.equal(denied.backup().profile.writer.text,'in memory');assert.equal(denied.getStatus().kind,'local-error');

 const s=server(),storage=memory(),env=environment(s,storage),one=app(s,env);await one.initialize();
 assert.equal(one.storage.getItem(MAP),null);assert.equal(s.posts.length,0);
 one.storage.setItem(MAP,JSON.stringify(mapping()));one.storage.setItem(WRITER,JSON.stringify(writer('cloud')));
 assert(one.hasPending());assert([...storage.values.keys()].every(k=>k.startsWith('ato-babelian-pending-v1:alice:campaign-1')));
 await one.flush();assert(!one.hasPending());assert.equal(s.posts.length,1);assert.equal(storage.values.size,0);
 storage.clear();const reloaded=app(s,environment(s,storage));await reloaded.initialize();assert.equal(JSON.parse(reloaded.storage.getItem(WRITER)).text,'cloud');
 s.who='bob';const bob=app(s,environment(s,local));await bob.initialize();assert.equal(bob.storage.getItem(WRITER),null);assert.equal(bob.storage.getItem(MAP),null);
 assert.equal(JSON.parse(local.getItem(WRITER)).text,'old text');
 s.who='alice';s.active='campaign-2';const otherCampaign=app(s);await otherCampaign.initialize();assert.equal(otherCampaign.storage.getItem(WRITER),null);
 otherCampaign.storage.setItem(WRITER,JSON.stringify(writer('two')));await otherCampaign.flush();
 assert.equal(s.account().state.profiles['campaign-1'].writer.text,'cloud');assert.equal(s.account().state.profiles['campaign-2'].writer.text,'two');
 console.log('PASS ATO: authoritative server save; independent/account/campaign isolation; logout-cleared cache reloads from server.');

 s.active='campaign-1';const shared=memory(),left=app(s,environment(s)),right=app(s,environment(s,shared));await left.initialize();await right.initialize();
 left.storage.setItem(WRITER,JSON.stringify(writer('first')));await left.flush();
 right.storage.setItem(WRITER,JSON.stringify(writer('second')));assert.equal(await right.flush(),false);assert.equal(right.getStatus().kind,'conflict');
 assert.equal(s.account().state.profiles['campaign-1'].writer.text,'first');assert.equal(right.backup().profile.writer.text,'second');
 const recovered=app(s,environment(s,shared));await recovered.initialize();assert.equal(recovered.getStatus().kind,'conflict');assert.equal(await recovered.retry(),false);
 const recoveredAgain=app(s,environment(s,shared));await recoveredAgain.initialize();assert.equal(recoveredAgain.getStatus().kind,'conflict');
 recoveredAgain.discardPending();const clean=app(s,environment(s,shared));await clean.initialize();assert.equal(JSON.parse(clean.storage.getItem(WRITER)).text,'first');
 console.log('PASS revision conflict: never overwrites; draft export/recovery; conflict stays paused through repeated reloads.');

 const retryStore=memory(),networkApp=app(s,environment(s,retryStore));await networkApp.initialize();networkApp.storage.setItem(WRITER,JSON.stringify(writer('retry')));
 s.offline=true;assert.equal(await networkApp.flush(),false);assert(networkApp.hasPending());s.offline=false;
 const retryApp=app(s,environment(s,retryStore));await retryApp.initialize();assert.equal(JSON.parse(retryApp.storage.getItem(WRITER)).text,'retry');await retryApp.flush();assert(!retryApp.hasPending());
 const accountGuard=app(s);await accountGuard.initialize();accountGuard.storage.setItem(WRITER,JSON.stringify(writer('alice only')));s.who='bob';const count=s.posts.length;
 assert.equal(await accountGuard.flush(),false);assert.equal(s.posts.length,count);
 s.who='alice';const race=app(s);await race.initialize();race.storage.setItem(WRITER,JSON.stringify(writer('race')));s.beforePost=async()=>{s.who='bob';};
 assert.equal(await race.flush(),false);assert.equal(s.posts.length,count);s.beforePost=null;s.who='alice';
 const campaignGuard=app(s);await campaignGuard.initialize();campaignGuard.storage.setItem(WRITER,JSON.stringify(writer('old campaign')));s.active='campaign-2';assert.equal(await campaignGuard.flush(),false);
 console.log('PASS failures: network retry; crash-recovered draft; account switch before/during POST; campaign-switch guard.');

 const missing=server();missing.patched=false;const missingApp=app(missing);await assert.rejects(missingApp.initialize(),/配套补丁/);assert.equal(missing.posts.length,0);assert(!missingApp.canEdit());
 const guest=server();guest.who='';await assert.rejects(app(guest).initialize(),/登录/);
 const corrupt=server();corrupt.account().state={version:99,profiles:{}};await assert.rejects(app(corrupt).initialize(),/未覆盖/);assert.equal(corrupt.posts.length,0);
 const broken=server();broken.account().revision=undefined;await assert.rejects(app(broken).initialize(),/响应不完整/);assert.equal(broken.posts.length,0);
 const context=app(server(),environment(server(),memory(),'https://ato.test/babelian/index.html?book=c5&entry=9301&return=javascript:alert(1)'));
 await context.initialize();assert.equal(context.storyUrl(),'https://ato.test/story/index.html?book=c5&entry=9301');
 console.log('PASS boot guards: missing interface/auth/invalid data cannot start or overwrite; story context is allowlisted.');

 for(const file of ['index.html','dist/ato/babelian/index.html']){
  const html=fs.readFileSync(path.join(root,file),'utf8');
  assert(!/__[A-Z_]+__/.test(html));
  for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
  if(file==='index.html'){assert(html.includes('data:image/png;base64,'));assert(!html.includes('<script src='));}
  else{
   assert(!html.includes('data:image/png;base64,'));assert(html.includes('"mode":"ato"'));assert(html.includes('../assets/page-focus-router.js'));
   const images=fs.readdirSync(path.join(root,'dist/ato/babelian/assets')).filter(n=>n.endsWith('.png'));assert.equal(images.length,91);
   for(const file of images)assert.equal(fs.readFileSync(path.join(root,'dist/ato/babelian/assets',file)).subarray(1,4).toString(),'PNG');
  }
 }
 console.log('PASS build: independent single file; ATO page has no embedded artwork; 91 separate PNG assets; JavaScript syntax valid.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
