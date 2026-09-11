/* Siren-only presentation adapter. Raw letters and Babelian validation are unchanged. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SirenFormat=api;})(globalThis,function(){
  'use strict';
  const units=Object.fromEntries('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ').map((w,i)=>[w,i]));
  const tens=Object.assign(Object.create(null),{twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90}),scales=Object.assign(Object.create(null),{thousand:1000,million:1000000,billion:1000000000});
  function numbers(text){
    const words=[...text.matchAll(/[A-Za-z]+/g)].map(m=>({word:m[0].toLowerCase(),start:m.index,end:m.index+m[0].length}));
    const linked=(a,b)=>!!words[a]&&!!words[b]&&/^[\s-]+$/.test(text.slice(words[a].end,words[b].start));
    function low(i){
      const w=words[i]?.word;if(w in tens){let value=tens[w],end=i+1;const u=units[words[end]?.word];if(linked(i,end)&&u>0&&u<10){value+=u;end++;}return {value,end};}
      return Object.hasOwn(units,w)?{value:units[w],end:i+1}:null;
    }
    function chunk(i){
      let part=low(i);if(words[i]?.word==='hundred')part={value:100,end:i+1};
      else if(part&&part.value>0&&part.value<10&&linked(part.end-1,part.end)&&words[part.end]?.word==='hundred')part={value:part.value*100,end:part.end+1};
      if(!part||part.value<100)return part;
      let j=part.end;if(linked(j-1,j)&&words[j]?.word==='and')j++;
      const tail=linked(j-1,j)?low(j):null;if(tail&&tail.value>0)return {value:part.value+tail.value,end:tail.end};return part;
    }
    function cardinal(i){
      let part=chunk(i),total=0,last=Infinity;
      if(!part&&Object.hasOwn(scales,words[i]?.word))part={value:1,end:i};
      if(!part)return null;
      for(;;){
        const scale=scales[words[part.end]?.word];
        if(!scale||scale>=last||part.end!==i&&!linked(part.end-1,part.end))return {value:total+part.value,end:part.end};
        total+=part.value*scale;last=scale;const end=part.end+1;let j=end;
        if(linked(j-1,j)&&words[j]?.word==='and')j++;
        const next=linked(j-1,j)?chunk(j):null;
        if(!next||scales[words[next.end]?.word]>=last)return {value:total,end};
        part=next;
      }
    }
    let out='',cursor=0,previousNumber=false;
    for(let i=0;i<words.length;){
      const number=cardinal(i);if(!number){i++;continue;}
      const start=words[i].start,end=words[number.end-1].end,gap=text.slice(cursor,start);
      out+=(previousNumber&&/^[\s-]+$/.test(gap)?'':gap)+String(number.value);cursor=end;i=number.end;previousNumber=true;
    }
    return out+text.slice(cursor);
  }
  function createDraft(formatter,B){
    const draft=B.createDraft(formatter);let cache=null;
    function prepare(payload,options){
      const signature=JSON.stringify([payload,options]);if(cache?.signature===signature)return cache.args;
      // The first pass validates every original letter before changing presentation.
      const segmented=formatter.suggest(payload,{...options,punctuate:false});
      const args=[{text:numbers(segmented.text),spans:[]},{...options,sirenSourceKey:JSON.stringify(payload)}];cache={signature,args};return args;
    }
    return {...draft,generate:(p,o)=>draft.generate(...prepare(p,o)),update:(p,o)=>draft.update(...prepare(p,o)),clear:()=>{cache=null;draft.clear();}};
  }
  return {numbers,createDraft};
});
