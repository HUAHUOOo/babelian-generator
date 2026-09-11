/* Selected-region image evidence only. No mapping, text, dictionary or persistence. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./ocr-engine.js'));else root.BabelianDeep=factory(root.BabelianOCR);})(globalThis,function(OCR){
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function pop(n){n-=(n>>>1)&0x55555555;n=(n&0x33333333)+((n>>>2)&0x33333333);return (((n+(n>>>4))&0x0f0f0f0f)*0x01010101)>>>24;}
function similarity(a,b){
 let overlap=0,nearA=0,nearB=0;
 for(let i=0;i<a.rows.length;i++){overlap+=pop(a.rows[i]&b.rows[i]);nearA+=pop(a.rows[i]&b.wide[i]);nearB+=pop(b.rows[i]&a.wide[i]);}
 const total=a.count+b.count;return total?.64*2*overlap/total+.36*(nearA+nearB)/total:0;
}
function sameMask(a,b){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
function checkBox(image,box){
 if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width*image.height>12000000||image.data?.length!==image.width*image.height*4)throw Error('Invalid image');
 if(!box||![box.x,box.y,box.width,box.height].every(Number.isInteger)||box.width<2||box.height<2||box.x<0||box.y<0||box.x+box.width>image.width||box.y+box.height>image.height)throw Error('Selected box is outside the image');
 if(box.width*box.height>1000000)throw Error('Select one glyph, not a full page');
}
function crop(image,box){
 const data=new Uint8ClampedArray(box.width*box.height*4);
 for(let y=0;y<box.height;y++)data.set(image.data.subarray(((box.y+y)*image.width+box.x)*4,((box.y+y)*image.width+box.x+box.width)*4),y*box.width*4);
 return {width:box.width,height:box.height,data};
}
function excluded(mask,box,boxes){
 for(const b of boxes){
  if(![b.x,b.y,b.width,b.height].every(Number.isFinite))throw Error('Invalid excluded box');
  const left=Math.max(0,Math.ceil(b.x-box.x)),top=Math.max(0,Math.ceil(b.y-box.y)),right=Math.min(mask.width,Math.ceil(b.x+b.width-box.x)),bottom=Math.min(mask.height,Math.ceil(b.y+b.height-box.y));
  if(left>=right||top>=bottom)continue;
  for(let y=top;y<bottom;y++)mask.data.fill(0,y*mask.width+left,y*mask.width+right);
 }
 return mask;
}
function deep(image,box,templateMasks,options={}){
 checkBox(image,box);
 const started=Date.now(),selection={x:box.x,y:box.y,width:box.width,height:box.height},local=crop(image,selection);
 // In the UI pass result.threshold/result.polarity: then this never reanalyses
 // adjacent glyphs and does not let the tight crop reverse text/background.
 const inherited=Number.isFinite(options.threshold)&&['dark','light'].includes(options.polarity)?options:OCR.binarize(image,options);
 const polarity=['dark','light'].includes(options.polarity)?options.polarity:inherited.polarity;
 const threshold=clamp(Number.isFinite(options.threshold)?options.threshold:inherited.threshold,0,254);
 const offsets=options.thresholdOffsets||[-24,-12,0,12,24];
 if(!Array.isArray(offsets)||!offsets.length||offsets.length>15||offsets.some(v=>!Number.isFinite(v)||Math.abs(v)>64))throw Error('Invalid threshold sweep');
 if(!Array.isArray(templateMasks)||!templateMasks.length||templateMasks.length>500)throw Error('Invalid template collection');
 const templates=OCR.prepareTemplates(templateMasks,{detail:true}),ids=[...new Set(templates.map(t=>t.id))];
 const variants=[],thresholds=[...new Set(offsets.map(d=>clamp(Math.round(threshold+d),0,254)))].sort((a,b)=>a-b);
 let emptyThresholds=0;
 for(const t of thresholds){
  if(options.cancelled?.())throw Error('Cancelled');
  const mask=excluded(OCR.binarize(local,{threshold:t,polarity}),selection,options.excludedBoxes||[]),tight=OCR.bounds(mask);
  if(!tight){emptyThresholds++;continue;}
  const same=variants.find(v=>sameMask(v.mask.data,mask.data));
  if(same){same.thresholds.push(t);continue;}
  variants.push({thresholds:[t],mask,tight});
 }
 const weights=[0,.3,1],scoreRows=[],evidence=[];
 for(let index=0;index<variants.length;index++){
  const v=variants[index],d=OCR.describe(v.mask,v.tight,true),byId=new Map(ids.map(id=>[id,{coarse:0,fine:0,mixed:0}]));
  for(const template of templates){
   if(!template.count||!d?.count)continue;
   const aspect=Math.abs(Math.log(d.ratio/template.ratio));if(aspect>.38)continue;
   const coarse=similarity(d,template),fine=similarity(d.fine,template.fine),penalty=.38*aspect,row=byId.get(template.id);
   row.coarse=Math.max(row.coarse,coarse-penalty,0);row.fine=Math.max(row.fine,fine-penalty,0);row.mixed=Math.max(row.mixed,.7*coarse+.3*fine-penalty,0);
  }
  for(const weight of weights){
   const field=weight===0?'coarse':weight===1?'fine':'mixed';
   const ranked=ids.map(id=>({id,score:byId.get(id)[field]})).sort((a,b)=>b.score-a.score);
   // Equal shapes do not get artificial votes from opaque-ID array order.
   const top=ranked[0]?.score||0,winners=ranked.filter(c=>top>0&&top-c.score<=1e-9).map(c=>c.id);
   scoreRows.push({mask:index,field,weight,ranked,winners});
  }
  evidence.push({index,thresholds:v.thresholds,inkBox:{x:selection.x+v.tight.x,y:selection.y+v.tight.y,width:v.tight.width,height:v.tight.height},inkPixels:v.mask.data.reduce((a,b)=>a+b,0)});
 }
 const candidates=ids.map(id=>{
  const scores=scoreRows.map(r=>r.ranked.find(c=>c.id===id)?.score||0),mean=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:0;
  const deviation=Math.sqrt(scores.length?scores.reduce((a,b)=>a+(b-mean)**2,0)/scores.length:0);
  const wins=scoreRows.filter(r=>r.winners.includes(id)),stableMasks=variants.filter((_,i)=>scoreRows.filter(r=>r.mask===i).every(r=>r.winners.includes(id))).length;
  return {id,score:mean-.12*deviation,meanScore:mean,minScore:Math.min(1,...scores),maxScore:Math.max(0,...scores),scoreDeviation:deviation,
   support:wins.length,variantCount:scoreRows.length,stableMasks,maskCount:variants.length,
   variantScores:scoreRows.map((r,i)=>({mask:r.mask,detail:r.field,score:scores[i],top:r.winners.includes(id)}))};
 }).filter(c=>c.maxScore>0).sort((a,b)=>b.score-a.score);
 const limit=Number.isInteger(options.limit)?clamp(options.limit,1,20):8;
 return {box:selection,polarity,threshold,thresholds,emptyThresholds,uniqueMasks:variants.length,evidence,candidates:candidates.slice(0,limit),
  requiresConfirmation:true,certain:false,elapsedMs:Date.now()-started,
  warning:variants.length?'Compare the candidate image and accept manually. Variant support is not a probability.':'No foreground in this fixed box.'};
}
return {deep};
});
