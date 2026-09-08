/* Shared platform adapter. No account credentials or game-state files embedded. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BabelianPlatform=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const WRITER='ato-babelian-writer-v1', MAP='ato-babelian-mapping-profiles-v2';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const emptyProfile=()=>({writer:null,mappings:null,context:null});
  function validateProfile(value,ids){
    if(!plain(value))throw Error('工作备份格式不正确。');
    const validMap=map=>plain(map)&&ids.every(id=>Object.hasOwn(map,id)&&typeof map[id]==='string'&&map[id].length<=40&&!/[\u0000-\u001f\u007f]/.test(map[id]));
    if(value.mappings!==null){
      const m=value.mappings;
      if(!plain(m)||m.version!==2||!validMap(m.workingMap)||!validMap(m.baselineMap)||typeof m.baseName!=='string'||m.baseName.length>100||!Array.isArray(m.profileSlots)||m.profileSlots.length!==5||!Number.isInteger(m.chosenSlot)||m.chosenSlot<0||m.chosenSlot>4)throw Error('映射或栏位数据不完整。');
      for(const slot of m.profileSlots)if(slot!==null&&(!plain(slot)||typeof slot.name!=='string'||slot.name.length>100||!validMap(slot.mapping)))throw Error('保存栏位格式不正确。');
    }
    if(value.writer!==null){
      const w=value.writer;
      if(!plain(w)||typeof w.text!=='string'||w.text.length>6000||!['upper','lower'].includes(w.keyboardCase)||!Array.isArray(w.specialSpans))throw Error('书写草稿格式不正确。');
      let end=0;
      for(const s of w.specialSpans){
        if(!plain(s)||!ids.includes(s.glyph)||!Number.isInteger(s.start)||!Number.isInteger(s.end)||s.start<end||s.end<=s.start||s.end>w.text.length||s.text!==w.text.slice(s.start,s.end))throw Error('草稿中的字形位置不正确。');
        end=s.end;
      }
    }
    const c=value.context??null;
    if(c!==null&&(!plain(c)||Object.keys(c).some(k=>!['book','entry','key','chapter','encounter'].includes(k)||typeof c[k]!=='string'||c[k].length>200)))throw Error('故事书来源格式不正确。');
    return copy({writer:value.writer,mappings:value.mappings,context:c});
  }
  function create(config,env){
    env=env||globalThis;
    const integrated=config.mode==='ato', ids=config.ids;
    let local;try{local=env.localStorage;}catch(_){local={getItem(){throw Error('本地存储不可用。');},setItem(){throw Error('本地存储不可用。');},removeItem(){}};}
    let profile=emptyProfile(), documentState={version:1,profiles:{}}, revision=0, owner=null, profileId=null;
    let ready=false, dirty=false, paused=false, inflight=null, timer=null, seq=0, status={kind:'loading',message:'正在载入…'};
    const localSession=new Map();
    const listeners=new Set();
    const emit=(kind,message)=>{status={kind,message,dirty,owner:owner?.username||'',profileId};listeners.forEach(fn=>fn({...status}));};
    const pendingKey=()=>`ato-babelian-pending-v1:${encodeURIComponent(owner.id)}:${encodeURIComponent(profileId)}`;
    function cache(){try{local.setItem(pendingKey(),JSON.stringify({ownerId:owner.id,profileId,revision,profile,blocked:paused}));return true;}catch(_){return false;}}
    const dropCache=()=>{try{local.removeItem(pendingKey());}catch(_){}};
    async function request(query,body){
      const url=new URL('../api/campaign-state.php'+query,env.location.href);
      if(url.origin!==new URL(env.location.href).origin)throw Error('不允许向站外同步存档。');
      const controller=new AbortController(),timeout=env.setTimeout(()=>controller.abort(),12000);
      try{
        const response=await env.fetch(url.href,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
        let payload;try{payload=await response.json();}catch(_){throw Error('ATO 接口未返回有效数据；请先安装配套补丁。');}
        if(!response.ok||!plain(payload)||payload.ok!==true){
          const error=Error(response.status===400?'ATO 尚未安装巴别语存档接口，请先安装配套补丁。':response.status===401?'请返回主控台登录。':response.status===409?'存档已在其他页面修改，请先导出工作备份，再读取最新存档。':payload.error||'存档请求失败。');
          error.status=response.status;error.code=payload.code;throw error;
        }
        return payload;
      }finally{env.clearTimeout(timeout);}
    }
    async function identity(){
      const me=await request('?action=me');
      if(!me.authenticated||typeof me.user?.id!=='string'||!me.user.id){const e=Error('请返回主控台登录；独立版不需要账号。');e.status=401;throw e;}
      return me.user;
    }
    function readContext(){
      const query=new URL(env.location.href).searchParams,context={};
      for(const key of ['book','entry','key','chapter','encounter'])if(query.has(key))context[key]=query.get(key).slice(0,200);
      return Object.keys(context).length?context:null;
    }
    function schedule(){
      env.clearTimeout(timer);
      if(ready&&!paused)timer=env.setTimeout(()=>flush(),450);
    }
    function changed(){
      dirty=true;seq++;const backed=cache();
      emit(paused?'conflict':'pending',paused?'自动同步已暂停；请导出工作备份后处理冲突。':backed?'有修改待同步（本机已留临时备份）。':'有修改待同步，本机缓存不可用，请勿关闭页面。');
      schedule();
    }
    async function initialize(){
      if(!integrated){ready=true;emit('local','独立版 · 本机保存');return;}
      try{
        owner=await identity();
        const dashboard=await request('?section=dashboard');
        if(dashboard.user?.id&&dashboard.user.id!==owner.id)throw Error('账号已切换，请重新载入。');
        profileId=String(dashboard.state?.activeProfileId||'default');
        const saved=await request('?section=babelian');
        if(!Object.hasOwn(saved,'state')||!Number.isInteger(saved.revision)||saved.revision<0)throw Error('ATO 存档响应不完整，未写入任何数据。');
        if(saved.user?.id&&saved.user.id!==owner.id)throw Error('账号已切换，请重新载入。');
        if(saved.state!==null&&saved.state!==undefined){
          if(!plain(saved.state)||saved.state.version!==1||!plain(saved.state.profiles))throw Error('ATO 巴别语存档版本不支持，未覆盖原存档。');
          documentState=copy(saved.state);
        }
        revision=Number(saved.revision)||0;
        if(Object.hasOwn(documentState.profiles,profileId))profile=validateProfile(documentState.profiles[profileId],ids);
        let pending;try{pending=JSON.parse(local.getItem(pendingKey()));}catch(_){}
        if(pending&&pending.ownerId===owner.id&&pending.profileId===profileId){
          profile=validateProfile(pending.profile,ids);dirty=true;seq++;
          paused=pending.blocked===true||pending.revision!==revision;
        }
        const context=readContext();
        if(context&&JSON.stringify(context)!==JSON.stringify(profile.context)){profile.context=context;dirty=true;seq++;}
        ready=true;
        if(dirty){cache();emit(paused?'conflict':'pending',paused?'已恢复本机未同步草稿，但服务器版本已变化；请导出备份后处理冲突。':'已恢复未同步工作，准备保存。');schedule();}
        else emit('saved','已载入 ATO 存档');
      }catch(error){emit('blocked',error.message);throw error;}
    }
    async function flush(){
      env.clearTimeout(timer);
      if(!integrated||!ready||!dirty||paused)return false;
      if(inflight)return inflight;
      const currentSeq=seq;
      inflight=(async()=>{
        emit('saving','正在同步到 ATO…');
        try{
          const user=await identity();
          if(user.id!==owner.id){const e=Error('账号已切换，已暂停同步以保护原账号草稿。请导出备份后重新载入。');e.status=403;throw e;}
          const next=copy(documentState);
          Object.defineProperty(next.profiles,profileId,{value:copy(profile),enumerable:true,configurable:true,writable:true});
          const result=await request('?section=babelian',{section:'babelian',ownerId:owner.id,profileId,expectedRevision:revision,state:next});
          if(!Number.isInteger(result.revision)||result.revision<=revision)throw Error('ATO 未确认新的存档版本，请保留工作备份后重试。');
          documentState=next;revision=result.revision;
          if(seq===currentSeq){dirty=false;dropCache();emit('saved','已同步到 ATO');}
          else{cache();emit('pending','仍有新修改待同步。');schedule();}
          return true;
        }catch(error){
          paused=[401,403,409].includes(error.status);
          cache();emit(paused?'conflict':'error',error.message||'同步失败，草稿已暂存在本机。');return false;
        }finally{inflight=null;}
      })();
      return inflight;
    }
    const storage={
      getItem(key){
        if(!integrated){
          if(localSession.has(key))return localSession.get(key);
          try{return local.getItem(key);}catch(_){emit('local-error','本地保存不可用，请下载完整工作备份。');return null;}
        }
        const value=key===WRITER?profile.writer:key===MAP?profile.mappings:null;
        return value===null?null:JSON.stringify(value);
      },
      setItem(key,value){
        if(!integrated){
          localSession.set(key,value);
          try{return local.setItem(key,value);}catch(error){emit('local-error','本地保存失败；工作暂留在页面中，请下载完整工作备份。');throw error;}
        }
        if(!ready)throw Error('ATO 存档尚未载入。');
        const name=key===WRITER?'writer':key===MAP?'mappings':null;
        if(!name)throw Error('未知的巴别语存储项。');
        const parsed=JSON.parse(value);
        if(JSON.stringify(profile[name])===JSON.stringify(parsed))return;
        profile[name]=parsed;changed();
      }
    };
    function backup(){
      const state=integrated?profile:{writer:JSON.parse(storage.getItem(WRITER)||'null'),mappings:JSON.parse(storage.getItem(MAP)||'null'),context:null};
      return {format:'ato-babelian-workspace',version:1,exportedAt:new Date().toISOString(),profile:copy(state)};
    }
    function decodeBackup(value){
      if(!plain(value)||value.format!=='ato-babelian-workspace'||value.version!==1)throw Error('不是本工具的完整工作备份。');
      return validateProfile(value.profile,ids);
    }
    function replaceProfile(value){
      const next=validateProfile(value,ids);
      if(integrated){if(!ready)throw Error('请先载入 ATO 存档。');profile=next;changed();}
      else{
        const previous=[WRITER,MAP].map(key=>local.getItem(key));
        try{for(const [key,part] of [[WRITER,next.writer],[MAP,next.mappings]]){if(part===null)local.removeItem(key);else local.setItem(key,JSON.stringify(part));}}
        catch(error){try{[WRITER,MAP].forEach((key,i)=>{if(previous[i]===null)local.removeItem(key);else local.setItem(key,previous[i]);});}catch(_){}throw error;}
        localSession.set(WRITER,next.writer===null?null:JSON.stringify(next.writer));localSession.set(MAP,next.mappings===null?null:JSON.stringify(next.mappings));
      }
      return copy(next);
    }
    function discardPending(){if(inflight)throw Error('正在同步，请稍后重试。');if(integrated&&owner){dropCache();dirty=false;}}
    function storyUrl(){
      const c=profile.context||readContext();if(!c)return null;
      const url=new URL('../story/index.html',env.location.href);
      for(const [key,value] of Object.entries(c))url.searchParams.set(key,value);
      return url.href;
    }
    return {integrated,storage,initialize,flush,backup,decodeBackup,replaceProfile,discardPending,storyUrl,
      subscribe(fn){listeners.add(fn);fn({...status});return()=>listeners.delete(fn);},
      hasPending:()=>dirty,isSaving:()=>!!inflight,canEdit:()=>ready,
      retry:()=>{if(paused)return Promise.resolve(false);return flush();},
      getStatus:()=>({...status}),
    };
  }
  return {create,validateProfile,WRITER,MAP};
});
