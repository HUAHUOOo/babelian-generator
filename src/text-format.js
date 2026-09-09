/* Formatting is a separate suggestion layer. It cannot alter glyph recognition,
   case, non-whitespace source characters, or unresolved OCR placeholders. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BabelianTextFormat=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const DOMAIN='aeon trespass odyssey babelian siren sirens strider dahaka dionysian alchemy thnitos khrusos umbral ambrosia aether arcology irem poseidon poseidons argo argonaut argonauts titan titans primordial primordials ur fleece sisyphus pandora hermes trismegistus petrified dissipate coalesce seawater amorphous storybook unbestowed';
 function create(wordData){
  const words=typeof wordData==='string'?wordData.trim().split(/\s+/):wordData;
  const costs=new Map();let max=1;
  for(const [i,word] of words.entries())if(/^[a-z]{2,32}$/.test(word)||word==='a'||word==='i'){
   if(!costs.has(word))costs.set(word,Math.log((i+1)*Math.log(words.length+1)));max=Math.max(max,word.length);
  }
  for(const word of DOMAIN.split(' '))costs.set(word,Math.min(costs.get(word)||Infinity,8));
  function split(text,extra=[]){
   const lower=text.toLowerCase(),n=lower.length,local=new Map();
   for(const word of extra){const w=word.toLowerCase();if(/^[a-z]{2,40}$/.test(w))local.set(w,5.5);}
   const limit=Math.max(max,...Array.from(local.keys(),w=>w.length),1);
   const dp=new Float64Array(n+1).fill(Infinity),back=Array(n+1);dp[0]=0;
   for(let end=1;end<=n;end++){
    for(let size=1;size<=Math.min(end,limit);size++){
     const start=end-size,word=lower.slice(start,end),cost=local.get(word)??costs.get(word);
     if(cost===undefined)continue;
     if(dp[start]+cost<dp[end]){dp[end]=dp[start]+cost;back[end]={start,known:true};}
    }
    // Unknown strings remain present; do not spell-correct or invent letters.
    for(let size=1;size<=Math.min(end,40);size++){
     const start=end-size,cost=dp[start]+15+size*3;
     if(cost<dp[end]){dp[end]=cost;back[end]={start,known:false};}
    }
   }
   const parts=[];for(let at=n;at;){const step=back[at];parts.push({text:text.slice(step.start,at),known:step.known});at=step.start;}
   return parts.reverse();
  }
  function suggest(payload,{punctuate=true,extraWords=[]}={}){
   if(typeof payload.text!=='string'||payload.text.length>80000)throw Error('文本过长，请分段整理。');
   // Physical line wraps have no word-boundary meaning. Existing spaces inside
   // a user's word mapping still constrain the segmentation.
   const stream=payload.text.replace(/\r?\n/g,''),unknown=[];
   let text=stream.replace(/[A-Za-z]+/g,chunk=>split(chunk,extraWords).map(p=>{if(!p.known)unknown.push(p.text);return p.text;}).join(' '));
   text=text.replace(/\[\?\]|\[未映射\]/g,m=>' '+m+' ').replace(/[\t ]+/g,' ').trim();
   // Whitespace after existing punctuation; all source punctuation stays intact.
   text=text.replace(/([.,;:!?])(?=[A-Za-z])/g,'$1 ');
   text=text.replace(/([A-Za-z])(?=[0-9])/g,'$1 ').replace(/([0-9])(?=[A-Za-z])/g,'$1 ');
   let punctuationCount=0;
   if(punctuate){const result=sentenceSuggestions(text);text=result.text;punctuationCount=result.count;}
   const aligned=reflow(payload,text); // Fail closed if a formatting rule alters source letters.
   return {...aligned,unknown:[...new Set(unknown)],punctuationCount};
  }
  return {split,suggest};
 }
 function sentenceSuggestions(text){
  const words=[...text.matchAll(/[A-Za-z]+/g)].map(m=>({text:m[0],lower:m[0].toLowerCase(),start:m.index,end:m.index+m[0].length}));
  const inserts=new Map();let count=0,start=0,finite=false;
  const verbs=new Set('is are was were be been has have had can may must will would should falls coils stirs comes awaits turns carries treats want win lose see think granted saw ends remains knows know broken lies stands begins ends'.split(' '));
  for(let i=0;i<words.length;i++){
   const w=words[i],prior=words[i-1],gap=prior?text.slice(prior.end,w.start):'';
   if(/[.!?]/.test(gap)&&!gap.includes('[?]')){start=i;finite=false;}
   const prev=prior?.lower,n=i-start;
   const boundary=/^(if|however|otherwise|meanwhile|nevertheless|therefore|though)$/.test(w.lower)&&!['as','even','only','and','but'].includes(prev);
   const subject=/^(you|it|they|we|this|there)$/.test(w.lower)&&/^(can|may|must|will|should|is|are|was|were|has|have)$/.test(words[i+1]?.lower||'')&&!['that','which','when','because','if','though','as','so'].includes(prev);
   if(n>=5&&finite&&(boundary||subject)&&!/[.!?:;]|\[/.test(gap)){
    inserts.set(w.start,'.\n');count++;start=i;finite=false;
   }
   if(verbs.has(w.lower))finite=true;
  }
  // A short leading conditional followed by an instruction needs a comma.
  const commands=new Set('proceed see draw gain discard return choose apply resolve place remove take ignore'.split(' '));
  for(let i=0;i<words.length;i++)if(words[i].lower==='if'){
   for(let j=i+3;j<Math.min(words.length,i+15);j++){
    if(/[.!?;]|\[/.test(text.slice(words[i].end,words[j].start))||inserts.has(words[j].start))break;
    if(commands.has(words[j].lower)){
     if(!/[,;:]\s*$/.test(text.slice(0,words[j].start))){inserts.set(words[j].start,', ');count++;}break;
    }
   }
  }
  let out=text;
  for(const [at,value] of [...inserts].sort((a,b)=>b[0]-a[0]))out=out.slice(0,at).replace(/[ \t]+$/,'')+value+out.slice(at);
  if(words.length>=3&&/[A-Za-z0-9]$/.test(out)&&!out.endsWith('[未映射]')){out+='.';count++;}
  return {text:out,count};
 }
 function reflow(payload,formatted){
  if(typeof formatted!=='string'||formatted.length>100000)throw Error('整理文本过长。');
  const source=payload.text,positions=new Int32Array(source.length).fill(-1);let i=0,j=0;
  const added=/^[\s.,;:!?，。；：！？“”‘’"'()—-]$/;
  while(i<source.length){
   if(/\s/.test(source[i])){i++;continue;}
   const marker=source.startsWith('[?]',i)?'[?]':source.startsWith('[未映射]',i)?'[未映射]':null;
   if(marker){
    while(j<formatted.length&&added.test(formatted[j]))j++;
    if(formatted.slice(j,j+marker.length)!==marker)throw Error('请保留完整的 [?] / [未映射] 占位符。');
    for(let k=0;k<marker.length;k++)positions[i+k]=j+k;i+=marker.length;j+=marker.length;continue;
   }
   while(j<formatted.length&&formatted[j]!==source[i]&&added.test(formatted[j]))j++;
   if(formatted[j]!==source[i])throw Error('只能调整空格和标点，不能改动原文字母、大小写或数字；请到逐字复核或映射中修改。');
   positions[i]=j;i++;j++;
  }
  while(j<formatted.length&&added.test(formatted[j]))j++;
  if(j!==formatted.length)throw Error('整理文本中出现了原文没有的字母、数字或占位符。');
  const spans=(payload.spans||[]).map(span=>{
   const hits=[];for(let at=span.start;at<span.end;at++)if(positions[at]>=0)hits.push(positions[at]);
   if(!hits.length)return null;
   const start=hits[0],end=hits.at(-1)+1;return {...span,start,end,text:formatted.slice(start,end)};
  }).filter(Boolean);
  return {text:formatted,spans};
 }
 function createDraft(formatter){
  let draft=null;
  const key=(payload,options)=>JSON.stringify([payload,options]);
  function generate(payload,options){
   const output=formatter.suggest(payload,options);
   draft={payload,signature:key(payload,options),value:output.text,meta:output,dirty:false,stale:false};return state();
  }
  function state(){
   if(!draft)return null;
   let error='';
   if(draft.stale)error='逐字原文、映射或整理设置已变化。手动编辑已保留，请重新生成建议后再复制或追加。';
   else try{reflow(draft.payload,draft.value);}catch(e){error=e.message;}
   return {value:draft.value,dirty:draft.dirty,stale:draft.stale,meta:draft.meta,error};
  }
  return {
   state,generate,clear:()=>{draft=null;},
   update(payload,options){
    if(!draft)return generate(payload,options);
    if(key(payload,options)===draft.signature){draft.stale=false;return state();}
    if(draft.dirty){draft.stale=true;return state();}
    return generate(payload,options);
   },
   edit(value){if(!draft)return null;draft.value=value;draft.dirty=true;return state();},
   payload(){const current=state();if(!current||current.error)throw Error(current?.error||'尚无整理结果。');return reflow(draft.payload,draft.value);}
  };
 }
 return {create,reflow,sentenceSuggestions,createDraft};
});
