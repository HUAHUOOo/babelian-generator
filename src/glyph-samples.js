/* Explicit, local sample collection. Not a recognition model or campaign state. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GlyphSamples=api;})(globalThis,function(){
 'use strict';
 const FORMAT='ato-glyph-samples',VERSION=1,MAX_BYTES=7000000,MAX_ITEMS=100;
 const copy=value=>JSON.parse(JSON.stringify(value));
 function create({babelianIds=[]}={}){
  const alphabet={babelian:new Set(babelianIds),siren:new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZ')};
  let entries=[],serial=0,revision=0,saved=0;const listeners=new Set();
  const number=(v,max=1200)=>{if(!Number.isFinite(v)||v<0||v>max)throw Error('样本坐标无效。');return v;};
  const rotation=v=>{if(!Number.isFinite(v)||v< -180||v>180)throw Error('样本角度无效。');return v;};
  function point(p){if(!p)throw Error('样本缺少位置。');return {x:number(p.x),y:number(p.y)};}
  function pose(p){return {...point(p),size:number(p.size),rotation:rotation(p.rotation)};}
  function box(p){return {...point(p),width:number(p.width),height:number(p.height)};}
  function validate(record){
   if(!record||!alphabet[record.language]?.has(record.glyphId))throw Error('样本语言或字形编号无效。');
   if(typeof record.image!=='string'||record.image.length>3000000||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(record.image))throw Error('样本必须是3MB以内的PNG裁片。');
   let bytes;try{bytes=Uint8Array.from(atob(record.image.slice(22,66)),c=>c.charCodeAt(0));}catch(_){throw Error('样本PNG编码无效。');}
   if(bytes.length<24||bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71)throw Error('样本不是PNG。');
   const view=new DataView(bytes.buffer),width=view.getUint32(16),height=view.getUint32(20);
   if(!width||!height||width>1200||height>1200)throw Error('样本图片尺寸应在1–1200像素之间。');
   const a=record.annotation;let annotation;
   if(record.language==='siren'){
    if(a?.frame!==600)throw Error('螺旋样本缺少600单位定位坐标系。');
    annotation={frame:600,base:pose(a.base),glyph:pose(a.glyph),contact:a.contact==null?null:point(a.contact)};
    for(const p of [annotation.base,annotation.glyph])if(p.x>600||p.y>600||!p.size)throw Error('螺旋样本位置超出画布。');
   }else{
    if(!a?.box)throw Error('巴别语样本缺少裁片框。');
    annotation={box:box(a.box),excludedBoxes:(a.excludedBoxes||[]).map(box)};
    if(annotation.excludedBoxes.length>100)throw Error('样本排除区域过多。');
    for(const b of [annotation.box,...annotation.excludedBoxes])if(b.x+b.width>width||b.y+b.height>height)throw Error('样本框超出图片。');
   }
   if(record.include!==undefined&&typeof record.include!=='boolean')throw Error('样本训练标记无效。');
   if(record.note!==undefined&&(typeof record.note!=='string'||record.note.length>300))throw Error('样本备注最多300字。');
   return {language:record.language,glyphId:record.glyphId,image:record.image,width,height,annotation,include:record.include!==false,note:record.note||''};
  }
  const identity=e=>e.language+'|'+e.image+'|'+JSON.stringify(e.annotation);
  const serialized=items=>JSON.stringify({format:FORMAT,version:VERSION,samples:items.map(({key,...e})=>e)},null,2);
  function checked(next){if(next.length>MAX_ITEMS)throw Error('每份样本库最多100项，请分批导出。');if(serialized(next).length>MAX_BYTES)throw Error('样本库超过7MB，请先导出再删除已保存项。');return next;}
  const emit=()=>{revision++;for(const fn of listeners)fn();};
  function add(record){const value=validate(record);if(entries.some(e=>identity(e)===identity(value)))throw Error('此裁片与定位已收录，请在样本库中编辑原项。');const key='sample-'+Date.now().toString(36)+'-'+(++serial);entries=checked([...entries,{key,...value}]);emit();return key;}
  function update(key,patch){const old=entries.find(e=>e.key===key);if(!old)throw Error('样本已不存在。');const value={key,...validate({...old,...patch})};entries=checked(entries.map(e=>e.key===key?value:e));emit();}
  function remove(key){if(!entries.some(e=>e.key===key))return;entries=entries.filter(e=>e.key!==key);emit();}
  function merge(text){
   if(typeof text!=='string'||text.length>MAX_BYTES+1000)throw Error('样本库文件过大。');
   const input=JSON.parse(text);if(input?.format!==FORMAT||input.version!==VERSION||!Array.isArray(input.samples)||input.samples.length>MAX_ITEMS)throw Error('不是受支持的样本库文件。');
   const incoming=input.samples.map(validate),next=entries.slice();let added=0;
   for(const value of incoming){const old=next.find(e=>identity(e)===identity(value));if(old){if(old.glyphId!==value.glyphId)throw Error('导入字形与已有标注冲突，未导入；请先复核原项。');continue;}next.push({key:'sample-'+Date.now().toString(36)+'-'+(++serial),...value});added++;}
   checked(next);if(added){entries=next;emit();}return added;
  }
  return {add,update,remove,merge,snapshot:()=>copy(entries),subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);},
   encode:()=>serialized(entries),revision:()=>revision,markSaved:r=>{if(r===revision)saved=r;},dirty:()=>saved!==revision};
 }
 return {create,FORMAT,VERSION,MAX_ITEMS,MAX_BYTES};
});

globalThis.GlyphSamplesUI={mount({library,container,language,labels,download}){
 const el=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const details=el('details'),summary=el('summary','校正样本库'),help=el('p','只在本页内存中保存，请导出留存（每份最多100项、约7MB）。供后续训练使用，尚不自动训练或改变识别结果。');
 details.className='glyph-samples';help.className='siren-note';details.append(summary,help);
 const bar=el('div'),out=el('button','导出全部样本'),load=el('button','导入样本库'),input=el('input'),status=el('p'),list=el('div');
 bar.className='siren-actions';out.type=load.type='button';out.className=load.className='secondary';input.type='file';input.accept='.json,application/json';input.hidden=true;status.setAttribute('role','status');
 bar.append(out,load,input);details.append(bar,status,list);container.append(details);
 function render(){
  const all=library.snapshot(),rows=all.filter(e=>e.language===language);summary.textContent='校正样本库 · '+rows.length+' 项';out.disabled=!all.length;list.replaceChildren();
  for(const row of rows){
   const card=el('div'),img=el('img'),choice=el('select'),include=el('input'),incLabel=el('label','纳入后续训练 '),note=el('input'),remove=el('button','删除');
   card.className='glyph-sample-row';img.src=row.image;img.alt='确认样本原图';img.loading='lazy';
   for(const [id,label] of Object.entries(labels())){const opt=el('option',label);opt.value=id;choice.append(opt);}choice.value=row.glyphId;choice.setAttribute('aria-label','样本字形');
   include.type='checkbox';include.checked=row.include;incLabel.append(include);note.type='text';note.maxLength=300;note.value=row.note;note.placeholder='备注，如：朝向异常，不用于训练';note.setAttribute('aria-label','样本备注');remove.type='button';remove.className='text-button';
   const change=patch=>{try{library.update(row.key,patch);status.textContent='已修改，请导出保存。';}catch(e){status.textContent=e.message;render();}};
   choice.addEventListener('change',()=>change({glyphId:choice.value}));include.addEventListener('change',()=>change({include:include.checked}));note.addEventListener('change',()=>change({note:note.value}));
   remove.addEventListener('click',()=>{if(confirm('从当前样本库删除此项？已导出的文件不受影响。'))library.remove(row.key);});
   card.append(img,choice,incLabel,note,remove);list.append(card);
  }
 }
 library.subscribe(render);render();
 out.addEventListener('click',async()=>{const revision=library.revision();try{await download(new Blob([library.encode()],{type:'application/json'}),'字形校正样本库.json');library.markSaved(revision);status.textContent='已导出全部两种语言样本。';}catch(e){status.textContent=e.message;}});
 load.addEventListener('click',()=>input.click());input.addEventListener('change',async()=>{const file=input.files[0];if(!file)return;try{if(file.size>8*1024*1024)throw Error('样本库文件超过8MB。');const added=library.merge(await file.text());status.textContent='已合并 '+added+' 项，没有覆盖原有样本。';}catch(e){status.textContent=e.message;}finally{input.value='';}});
 return {refresh:render};
}};
