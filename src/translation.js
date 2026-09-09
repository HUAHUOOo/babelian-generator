/* Optional text-only online translation. No request occurs until translate/run.
   API: https://mymemory.translated.net/doc/spec.php (GET only; never /set).
   Kept separate from pixel recognition and offline formatting. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BabelianTranslation=api;})(globalThis,function(){
  'use strict';
  const endpoint='https://api.mymemory.translated.net/get',MAX_CHARS=5000,MAX_BYTES=480;
  const bytes=text=>new TextEncoder().encode(text).length;
  function chunks(source){
    if(typeof source!=='string'||!source.trim())throw Error('请先整理需要翻译的英文。');
    if(source.length>MAX_CHARS)throw Error('每次最多翻译5000个字符，请分段整理后翻译。');
    const parts=[];
    // Keep unknown glyph markers literal; the service cannot fill them in.
    for(const segment of source.split(/(\[\?\]|\[未映射\])/)){
      if(!segment)continue;
      if(/^\[(?:\?|未映射)\]$/.test(segment)){parts.push({text:segment,literal:true});continue;}
      let rest=segment;
      while(rest){
        let end=0,size=0;
        for(const ch of rest){const n=bytes(ch);if(size+n>MAX_BYTES)break;size+=n;end+=ch.length;}
        if(end<rest.length){
          const head=rest.slice(0,end),sentences=[...head.matchAll(/[.!?;]\s+|\n+/g)];
          const boundary=sentences.at(-1);
          const word=head.search(/\s+\S*$/);
          const candidate=boundary?boundary.index+boundary[0].length:word;
          if(candidate>0)end=candidate;
        }
        const text=rest.slice(0,end);parts.push({text,literal:!text.trim()});rest=rest.slice(end);
      }
    }
    return parts;
  }
  function abortError(){const error=Error('已取消翻译。');error.name='AbortError';return error;}
  function createClient(transport=(...args)=>globalThis.fetch(...args),timeoutMs=25000){
    return async function translate(source,{signal,onProgress=()=>{}}={}){
      const parts=chunks(source),total=parts.filter(p=>!p.literal).length;let done=0;
      if(!total)throw Error('没有可翻译的英文；请先确认未知字形。');
      const result=[];
      for(const part of parts){
        if(signal?.aborted)throw abortError();
        if(part.literal){result.push(part.text);continue;}
        const controller=new AbortController(),abort=()=>controller.abort();
        signal?.addEventListener('abort',abort,{once:true});
        let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
        try{
          const url=new URL(endpoint);url.search=new URLSearchParams({q:part.text,langpair:'en|zh-CN',mt:'1'}).toString();
          const response=await transport(url.toString(),{method:'GET',mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:controller.signal});
          if(!response.ok)throw Error('翻译服务暂不可用（HTTP '+response.status+'）。');
          const body=await response.json();
          if(body.quotaFinished||Number(body.responseStatus)===429)throw Error('翻译服务额度已用完，请稍后重试。');
          if(Number(body.responseStatus)!==200||typeof body.responseData?.translatedText!=='string'||!body.responseData.translatedText.trim())throw Error('翻译服务未返回有效译文，请稍后重试。');
          if(signal?.aborted)throw abortError();
          // Preserve paragraph/chunk whitespace without trusting service markup.
          const leading=part.text.match(/^\s*/)[0],trailing=part.text.match(/\s*$/)[0];
          result.push(leading+body.responseData.translatedText.trim()+trailing);
          onProgress({done:++done,total});
        }catch(error){
          if(signal?.aborted)throw abortError();
          if(timedOut)throw Error('翻译请求超时，请检查网络后重试。');
          if(error instanceof TypeError)throw Error('无法连接翻译服务。请检查网络或浏览器跨域限制后重试。');
          throw error;
        }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
      }
      return result.join('');
    };
  }
  function createSession(translate,onChange=()=>{}){
    let revision=0,controller=null,state={source:'',value:'',status:'idle',error:'',progress:null};
    const emit=()=>{onChange({...state});return {...state};};
    function invalidate(message='英文已改变，请重新翻译。'){
      revision++;controller?.abort();controller=null;
      const existed=state.status!=='idle';state={source:'',value:'',status:existed?'stale':'idle',error:existed?message:'',progress:null};return emit();
    }
    return {
      state:()=>({...state}),invalidate,
      sync(source,valid=true){if(!valid||(state.source&&state.source!==source))return invalidate();return {...state};},
      cancel(){return invalidate('已取消翻译，尚未发出的分段不会发送。');},
      async run(source){
        revision++;controller?.abort();controller=new AbortController();
        const ticket=revision,signal=controller.signal;
        state={source,value:'',status:'busy',error:'',progress:null};emit();
        try{
          const value=await translate(source,{signal,onProgress:p=>{if(ticket===revision){state.progress=p;emit();}}});
          if(ticket===revision){state.value=value;state.status='done';emit();}
        }catch(error){if(ticket===revision){state.status='error';state.error=error.message;emit();}}
        finally{if(ticket===revision)controller=null;}
        return {...state};
      }
    };
  }
  return {chunks,createClient,createSession,endpoint,MAX_CHARS,MAX_BYTES};
});
