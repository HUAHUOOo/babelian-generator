/* Local pixel matching with manual review; no semantic glyph inference. */
globalThis.SirenUI={mount({assets,path,wordData,notify,samples}){
  const $=id=>document.getElementById(id),C=SirenCore,stage=$('siren-stage'),context=stage.getContext('2d');
  const containsLocator=SirenRecognition.createRecognitionBoundary(assets.base,path);
  const docs={generate:C.create(),review:C.create('review')},history={generate:[],review:[]},selections={generate:0,review:0};
  let mode='generate',groupIndex=0,itemId=null,images=null,geometry=null,ready=false,drag=null,centerMode=false,contactMode=false,pendingPoint=null,precisionEdit=null;
  const stripBounds=new WeakMap(),tile=document.createElement('canvas');tile.width=600;tile.height=600;
  let source=null,sourceTicket=0,sourceLoading=false,importTicket=0,loadingImport=false,keyboardPoint=null,templates=null,scanBusy=false,scanTicket=0;
  let deep=null;
  const keyboardImages=[];
  const manualImages=new Map(),overlapSources=new Map(),overlapCache=new WeakMap();let overlapEngine=null;
  const scan=SirenScan.create({engineSource:SirenRecognition.workerSource(),onProgress:p=>{
    const stages={'base-regions':'分割大螺旋','base-windows':'分窗寻找大螺旋','base-coarse':'寻找大螺旋','base-refine':'对齐大螺旋','group':'匹配分组','letters-coarse':'比较26个字形','letters-refine':'微调字形位置与大小','letters-joint':'整组像素核验','letters-complete':'整理候选'};
    const regionStages={'region-coarse':'细搜定位与字形','region-refine':'精调候选','region-verify':'原图像素核验'};
    $(deep?.running?'siren-deep-status':'siren-scan-status').textContent=(p.index?'第 '+p.index+'/'+p.count+' 组 · ':'')+(stages[p.stage]||regionStages[p.stage]||'正在匹配')+' '+Math.round((p.progress||0)*100)+'%';
  }});
  const revisions={generate:0,review:0},savedRevisions={generate:0,review:0};
  const backgrounds=new Map(),drafts={generate:null,review:null},formatter=BabelianTextFormat.create(wordData);
  drafts.generate=SirenFormat.createDraft(formatter,BabelianTextFormat);drafts.review=SirenFormat.createDraft(formatter,BabelianTextFormat);
  const translation=BabelianTranslation.createSession(BabelianTranslation.createClient(),renderTranslation);
  const doc=()=>docs[mode],g=()=>doc().groups[groupIndex],item=()=>g()?.items.find(i=>i.id===itemId),draft=()=>drafts[mode];
  const note=text=>{$('siren-status').textContent=text;};
  const analysis=group=>drag&&group===g()?drag.analysis:geometry?.analyze(group,mode==='review');
  const row=group=>C.ordered(group,analysis(group));
  const reading=()=>C.read(doc(),analysis);
  const payload=()=>({text:reading().groups.join(''),spans:[]});
  const incomplete=()=>mode==='review'&&reading().unplaced>0;
  const formatOptions=()=>({punctuate:true});
  function showKeyboard(open){$('siren-keyboard-panel').hidden=!open;$('siren-open-add').setAttribute('aria-expanded',String(open&&!itemId));$('siren-open-replace').setAttribute('aria-expanded',String(open&&!!itemId));}
  function selectItem(id=null,keepKeyboard=false){clearDeep();precisionEdit=null;itemId=id;pendingPoint=null;keyboardPoint=id?{x:item().x,y:item().y}:null;contactMode=false;$('siren-key-add').checked=!id;$('siren-key-replace').checked=!!id;if(!keepKeyboard)showKeyboard(false);}
  function renderKeyboardAngle(){
    const point=keyboardPoint||item(),angle=point&&g()?C.rotationFor(g(),point):0;
    for(const img of keyboardImages)img.style.transform='rotate('+angle+'deg)';
    $('siren-key-angle').textContent='对照朝向：'+Math.round(angle)+'°';
  }
  function scanControls(){
    $('siren-auto-scan').disabled=!source||!ready||scanBusy||sourceLoading;
    $('siren-fit-group').disabled=!g()?.image||scanBusy;$('siren-fit-group').hidden=mode!=='review';$('siren-scan-cancel').hidden=!scanBusy;
    $('siren-deep-toggle').hidden=mode!=='review';$('siren-deep-toggle').disabled=!g()?.image||scanBusy;
    $('siren-deep-run').disabled=!deep?.region||!!deep?.drag||scanBusy;
    $('siren-deep-apply').disabled=!deep?.preview||scanBusy||!!item()?.positionLocked;
    $('siren-add-sample').hidden=mode!=='review'||!samples;$('siren-add-sample').disabled=!g()?.image||!item()?.letter||scanBusy||!!drag;
  }
  function cancelScan(){scanTicket++;scan.cancel();scanBusy=false;scanControls();}
  function remember(){history[mode].push(JSON.stringify(doc()));if(history[mode].length>30)history[mode].shift();revisions[mode]++;}
  function changed(){clearDeep();translation.invalidate();if(draft().state())draft().update(payload(),formatOptions());render();}
  function image(src){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('图片无法读取，请重新选择。'));img.src=src;});}
  async function cropImage(src){
    if(backgrounds.has(src))return backgrounds.get(src);
    // Inspect the PNG IHDR before decoding to bound imported image dimensions.
    const head=atob(src.split(',')[1].slice(0,44)),bytes=Uint8Array.from(head,c=>c.charCodeAt(0));
    const view=new DataView(bytes.buffer);
    if(bytes.length<24||bytes[0]!==137||String.fromCharCode(...bytes.slice(1,4))!=='PNG'||view.getUint32(16)>1200||view.getUint32(20)>1200||!view.getUint32(16)||!view.getUint32(20))throw Error('工作文件裁片尺寸无效或超过1200像素。');
    const result=await image(src);backgrounds.set(src,result);return result;
  }
  function manualImage(letter){
    if(manualImages.has(letter))return manualImages.get(letter);
    const canvas=document.createElement('canvas'),a=assets.letters[letter];canvas.width=a.width;canvas.height=a.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(images[letter],0,0);ctx.globalCompositeOperation='source-in';ctx.fillStyle='#bb32d3';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.globalCompositeOperation='source-over';manualImages.set(letter,canvas);return canvas;
  }
  function placementOverlap(token){
    const group=g(),signature=JSON.stringify([group.cx,group.cy,group.baseSize,group.baseRotation,token.letter,token.x,token.y,token.size,C.displayRotation(group,token)]),old=overlapCache.get(token);
    if(old?.image===group.image&&old.signature===signature)return old.metric;
    if(!overlapEngine)overlapEngine=SirenRecognition.create(templates);
    let bitmap=overlapSources.get(group.image);
    if(!bitmap){
      const bg=backgrounds.get(group.image);if(!bg)return null;
      const canvas=document.createElement('canvas');canvas.width=600;canvas.height=600;const ctx=canvas.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(bg,0,0,600,600);bitmap=overlapEngine.binarize(ctx.getImageData(0,0,600,600));
      overlapSources.set(group.image,bitmap);if(overlapSources.size>3)overlapSources.delete(overlapSources.keys().next().value);
    }
    const metric=overlapEngine.measurePlacement(bitmap,group,{...token,rotation:C.displayRotation(group,token)});
    overlapCache.set(token,{image:group.image,signature,metric});return metric;
  }
  function renderOverlap(){
    const selected=item(),token=selected?.manualAdded?selected:!selected?g()?.items.filter(i=>i.manualAdded).at(-1):null,el=$('siren-manual-overlap');
    el.hidden=mode!=='review'||!token?.letter;if(el.hidden)return;
    if(drag?.saved){el.textContent='紫色为人工新增字形，松手后重新计算原图重合度。';return;}
    try{
      const m=placementOverlap(token);el.textContent=m?'人工新增 '+token.letter+'（紫色） · 原图墨迹重合度 '+(m.overlap*100).toFixed(1)+'% · 扣除本组大螺旋底线后：'+(m.independent===null?'独立笔画证据不足':(m.independent*100).toFixed(1)+'%')+'。这是固定位置的图像覆盖，不是字母正确率；邻组笔画也可能影响数值。':'原图尚未就绪。';
    }catch(_){el.textContent='当前原图无法计算重合度，人工新增字形仍可拖动和删除。';}
  }
  function paint(ctx,group,{guides=false,selected=null,overlay=false,review=mode==='review',transparent=false}={}){
    ctx.clearRect(0,0,C.SIZE,C.SIZE);if(!transparent){ctx.fillStyle='#fffdf7';ctx.fillRect(0,0,C.SIZE,C.SIZE);}
    if(!group||!images)return;
    if(review){const bg=backgrounds.get(group.image);if(bg)ctx.drawImage(bg,0,0,600,600);}
    else {ctx.save();ctx.translate(group.cx,group.cy);ctx.rotate((group.baseRotation||0)*Math.PI/180);const size=group.baseSize||500;ctx.drawImage(images.base,-size*assets.base.pivotX,-size*assets.base.pivotY,size,size*assets.base.height/assets.base.width);ctx.restore();}
    const entries=row(group);
    if(guides&&$('siren-path').checked){ctx.save();ctx.strokeStyle='#257b9388';ctx.lineWidth=1.5;ctx.beginPath();geometry.basePoints(group).forEach((p,i)=>{if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.stroke();ctx.restore();}
    for(let n=0;n<entries.length;n++){
      const token=entries[n].item,isSelected=selected===token.id;
      if(token.letter&&(!review||token.manualAdded||overlay&&isSelected)){
        ctx.save();ctx.translate(token.x,token.y);ctx.rotate((review?C.displayRotation(group,token):C.rotationFor(group,token))*Math.PI/180);
        if(review)ctx.globalAlpha=token.manualAdded ? 0.7 : 0.55;
        const asset=assets.letters[token.letter],img=review&&token.manualAdded?manualImage(token.letter):images[token.letter];
        // All letters keep the same source frame and the IMG_3491 calibrated scale.
        const w=token.size,h=w*asset.height/asset.width;
        ctx.drawImage(img,-w*(asset.pivotX??.5),-h*(asset.pivotY??.5),w,h);ctx.restore();
      }
      if(guides){
        ctx.save();ctx.strokeStyle=isSelected?'#a66a14':'#267184';ctx.fillStyle=isSelected?'#a66a14':'#267184';ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(token.x,token.y,10,0,Math.PI*2);ctx.stroke();
        ctx.fillRect(token.x-1,token.y-4,2,8);ctx.fillRect(token.x-4,token.y-1,8,2);
        const label=(entries[n].at===null?'?':String(n+1))+':'+(token.letter||'?');ctx.font='bold 20px sans-serif';const width=ctx.measureText(label).width+12;
        ctx.fillStyle='#fffdf7ee';ctx.fillRect(token.x+12,token.y-20,width,26);ctx.fillStyle='#174b56';ctx.fillText(label,token.x+18,token.y);ctx.restore();
        if(!drag){const hits=entries[n].hits||[];ctx.save();for(let j=0;j<hits.length;j++)if(j===0||isSelected){ctx.beginPath();ctx.strokeStyle=j===0?'#c0392b':'#bb8325';ctx.lineWidth=j===0?3:1.5;ctx.arc(hits[j].x,hits[j].y,j===0?7:4,0,Math.PI*2);ctx.stroke();}ctx.restore();}
      }
    }
    if(guides){ctx.strokeStyle='#c74333';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(group.cx-10,group.cy);ctx.lineTo(group.cx+10,group.cy);ctx.moveTo(group.cx,group.cy-10);ctx.lineTo(group.cx,group.cy+10);ctx.stroke();}
  }
  function draw(){context.save();context.setTransform(stage.width/600,0,0,stage.height/600,0,0);paint(context,g(),{guides:$('siren-guides').checked,selected:itemId,overlay:$('siren-overlay').checked});
    if(deep&&deep.group===g()){
      const r=deep.region;if(r){context.strokeStyle='#087bea';context.lineWidth=2;context.strokeRect(r.x,r.y,r.width,r.height);}
      const p=deep.preview;if(p){const a=assets.letters[p.letter],h=p.size*a.height/a.width;context.save();context.translate(p.x,p.y);context.rotate(p.rotation*Math.PI/180);context.globalAlpha=.65;context.drawImage(manualImage(p.letter),-p.size*(a.pivotX??.5),-h*(a.pivotY??.5),p.size,h);context.restore();}
    }context.restore();}
  function drawStrip(canvas,maxSide=8192,groups=doc().groups){
    const tileContext=tile.getContext('2d',{willReadFrequently:true});
    if(!tileContext)throw Error('无法生成螺旋图片。');
    const bounds=groups.map(group=>{
      const signature=JSON.stringify(group),cached=stripBounds.get(group);if(cached?.signature===signature)return cached.bounds;
      paint(tileContext,group,{review:false,transparent:true});const bounds=SirenStrip.inkBounds(tileContext.getImageData(0,0,600,600));stripBounds.set(group,{signature,bounds});return bounds;
    });
    const layout=SirenStrip.layout(bounds,{maxSide});canvas.width=layout.width;canvas.height=layout.height;
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('图片太长，无法分配画布。');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.save();ctx.scale(layout.scale,layout.scale);
    groups.forEach((group,i)=>{const p=layout.items[i];paint(tileContext,group,{review:false,transparent:true});ctx.drawImage(tile,p.sx,p.sy,p.width,p.height,p.x,p.y,p.width,p.height);});ctx.restore();return layout;
  }
  function button(text,action,pressed){const b=document.createElement('button');b.type='button';b.textContent=text;if(pressed!==undefined)b.setAttribute('aria-pressed',String(pressed));b.addEventListener('click',action);return b;}
  function renderGroups(){
    $('siren-groups').replaceChildren();const result=reading();
    doc().groups.forEach((group,index)=>{
      const b=button('',()=>{groupIndex=index;selectItem();centerMode=false;render();},index===groupIndex);
      const mini=document.createElement('canvas');mini.width=160;mini.height=160;const c=mini.getContext('2d');c.scale(160/600,160/600);paint(c,group);
      const caption=document.createElement('span');caption.textContent=(index+1)+' · '+(result.groups[index]||'空');b.append(mini,caption);b.title='第'+(index+1)+'组：'+(result.groups[index]||'空');$('siren-groups').append(b);
    });
  }
  function renderFields(){
    const current=item(),group=g(),entries=group?row(group):[],index=entries.findIndex(e=>e.item.id===itemId),metric=entries[index],locked=!!current?.positionLocked,groupLocked=group?.items.some(i=>i.positionLocked);
    $('siren-selection').textContent=current?(metric.at===null?'未定位':((entries.some(e=>e.at===null)?'已定位相对':'')+'第'+(index+1)+'项'))+'：'+(current.letter||'待确认')+'。'+(metric.reason||('首交点在大螺旋路径 '+(metric.at/metric.total*100).toFixed(1)+'% 处，'+(mode==='review'?(current.contact?'人工标记。':'基于拟合笔画，需复核。'):'共 '+metric.hits.length+' 处相交。'))):'先添加或选择一个小螺旋。';
    $('siren-key-add').checked=!current;$('siren-key-replace').checked=!!current;$('siren-key-replace').disabled=!current;
    for(const name of ['radius','angle','rotation']){
      const el=$('siren-'+name);el.disabled=!current||locked;
      const value=current?Math.round((name==='radius'?C.radius(group,current):name==='angle'?C.angle(group,current):C.displayRotation(group,current))*10)/10:0;
      if(document.activeElement!==el||name==='rotation'&&current?.rotationMode!=='manual')el.value=current?String(value):'';
      const slider=$('siren-'+name+'-slider');slider.disabled=!current||locked||name==='rotation'&&current.rotationMode!=='manual';if(name==='radius')slider.max=group&&current?maxRadius(group,current?C.angle(group,current):0):850;slider.value=value;
    }
    $('siren-rotation').readOnly=current?.rotationMode!=='manual';$('siren-rotation-mode').disabled=!current||locked;$('siren-rotation-mode').textContent=current?.rotationMode==='manual'?'可调':'自动';$('siren-rotation-mode').setAttribute('aria-pressed',String(current?.rotationMode==='manual'));
    $('siren-contact').disabled=!current||locked;$('siren-contact').hidden=mode!=='review';
    $('siren-delete-recognized').disabled=!current;$('siren-delete-recognized').hidden=mode!=='review';
    $('siren-contact').textContent=contactMode?'请点击最内侧交点（再点按钮可取消）':'标记最内侧交点';
    $('siren-open-add').disabled=!group||group.items.length>=6;
    const sizeField=$('siren-base-size');sizeField.disabled=!group||groupLocked;if(document.activeElement!==sizeField)sizeField.value=group?(group.baseSize??500):'';
    $('siren-base-size-slider').disabled=!group||groupLocked;$('siren-base-size-slider').value=group?.baseSize??500;
    $('siren-group-prev').disabled=!group||groupIndex===0;$('siren-group-next').disabled=!group||groupIndex===doc().groups.length-1;
    $('siren-delete-group').disabled=!group;$('siren-center').disabled=!group||groupLocked;
    $('siren-undo').disabled=!history[mode].length;
    $('siren-group-label').textContent=group?'第'+(groupIndex+1)+'组 · '+group.items.length+'/6':'请先载入图片并自动匹配';
    $('siren-items').replaceChildren();
    if(group)entries.forEach((e,n)=>{const b=button((e.at===null?'未定位':n+1)+' '+(e.item.letter||'?')+(e.item.manualAdded?' · 人工':'')+(e.item.positionLocked?' · 锁定':''),()=>{selectItem(e.item.id);renderFields();draw();},e.item.id===itemId);if(e.item.manualAdded)b.className='siren-manual-item';$('siren-items').append(b);});
    renderKeyboardAngle();renderMatch();renderOverlap();
  }
  function renderMatch(){
    const token=item();$('siren-match-review').hidden=!token;
    $('siren-match-candidates').replaceChildren();if(!token)return;
    const metric=row(g()).find(e=>e.item.id===token.id),reset=$('siren-reset-position');
    $('siren-position-lock').textContent=token.positionLocked?'解锁位置':'锁定位置';$('siren-position-lock').setAttribute('aria-pressed',String(!!token.positionLocked));
    $('siren-open-replace').disabled=!!token.positionLocked;
    reset.hidden=mode!=='review'||metric?.at!==null&&!!token.fit;reset.disabled=!!token.positionLocked||!C.canReset(g(),token);reset.title=token.positionLocked?'请先解锁':!token.resetPose?'旧记录无原位，请重新匹配本组':!C.canReset(g(),token)?'大螺旋校准已改变，请重新匹配本组':'恢复最近一次识别或候选位置';
    $('siren-match-status').textContent=token.fit?(token.letter||'待确认')+' · 笔画匹配 '+(token.fit.score*100).toFixed(1)+'（非正确率）'+(token.fit.method==='joint-pixel'?' · 候选按整组核验排序':''):(token.letter||'待确认')+(metric?.at===null?' · 未定位':'');
    if(!token.fit)return;
    for(const candidate of token.fit.candidates){
      const caption=candidate.letter+' · '+(candidate.score*100).toFixed(1);
      const b=button('',()=>{
        if(token.positionLocked)return;
        remember();const candidates=token.fit.candidates,method=token.fit.method;Object.assign(token,{letter:candidate.letter,x:candidate.x,y:candidate.y,size:candidate.size,contact:null,fit:{rotation:candidate.rotation,score:candidate.score,candidates,...(method?{method}:{})}});C.orient(g(),token);C.rememberPose(g(),token,true);keyboardPoint={x:token.x,y:token.y};showKeyboard(false);changed();note('已采用 '+candidate.letter+'。');
      });
      const preview=document.createElement('span');preview.className='siren-candidate-preview';
      const img=document.createElement('img');img.src=assets.letters[candidate.letter].src;img.alt='';img.draggable=false;
      img.style.transform='rotate('+candidate.rotation+'deg)';preview.append(img);
      const label=document.createElement('span');label.textContent=caption;
      b.className='secondary siren-match-candidate';b.disabled=!!token.positionLocked;b.append(preview,label);
      b.title=candidate.letter+'，拟合朝向 '+Math.round(candidate.rotation*10)/10+'°';
      b.setAttribute('aria-label','采用候选 '+candidate.letter+'，匹配度 '+(candidate.score*100).toFixed(1)+'，拟合朝向 '+Math.round(candidate.rotation*10)/10+'度');
      $('siren-match-candidates').append(b);
    }
  }
  function renderFormatted(){
    const s=draft().state();if(document.activeElement!==$('siren-formatted'))$('siren-formatted').value=s?.value||'';
    $('siren-formatted').readOnly=false;$('siren-format-status').textContent=s?.error||(incomplete()?'有未定位项，整理结果可能缺字。':'');
    $('siren-copy-formatted').disabled=!s||!!s.error||!s.value.trim();
    translation.sync(s?.value||'',!!s&&!s.error);renderTranslation(translation.state());
  }
  function renderReading(){
    const result=reading();$('siren-raw').value=result.text;
    $('siren-reading-groups').textContent=(result.unplaced?'未定位：'+result.unplacedGroups.map(x=>'第'+(x.index+1)+'组 '+x.letters.join('、')).join('；'):'')+(result.ambiguous?' 部分字形顺序待确认。':'');
    $('siren-copy-raw').disabled=!result.text;$('siren-format').disabled=!result.text;
    renderFormatted();
  }
  function render(){
    groupIndex=Math.min(groupIndex,Math.max(0,doc().groups.length-1));
    $('siren-generate-tools').hidden=mode!=='generate';$('siren-review-tools').hidden=mode!=='review';
    if(mode!=='generate'){$('siren-batch-panel').hidden=true;$('siren-batch-toggle').setAttribute('aria-expanded','false');}
    $('siren-export-png').disabled=!!drag;
    $('siren-center').hidden=mode!=='review';$('siren-overlay-label').hidden=mode!=='review';
    $('siren-mode-generate').setAttribute('aria-pressed',String(mode==='generate'));$('siren-mode-review').setAttribute('aria-pressed',String(mode==='review'));
    $('siren-center').textContent=centerMode?'请点击画布中的大螺旋中心（再点按钮可取消）':'设置大螺旋中心';
    $('siren-stage-hint').textContent='拖动调整位置；红圈为首交点。';
    renderGroups();renderFields();renderReading();draw();scanControls();
  }
  function switchMode(next){if(loadingImport||!ready)return;cancelScan();sourceTicket++;sourceLoading=false;selections[mode]=groupIndex;mode=next;groupIndex=selections[mode];selectItem();centerMode=false;drag=null;translation.invalidate();$('siren-path').checked=mode==='review';render();}
  function pick(letter){
    try{
      if($('siren-keyboard-panel').hidden)return;
      if(!g())throw Error(mode==='review'?'先在截图中框选大螺旋并加入解读。':'请先添加大螺旋。');
      if($('siren-key-replace').checked){
        if(!item())throw Error('先选择要替换的小螺旋。');if(item().positionLocked)return;remember();C.invalidateFit(item());item().letter=letter;item().rotationMode??='auto';
        // Keep a manually corrected letter when resetting its position, without
        // reusing another letter's fit score or contact as evidence.
        if(item().resetPose){const p=item().resetPose;p.letter=letter;p.fit=null;p.contact=null;p.rotationMode=item().rotationMode;if(p.rotationMode==='manual')p.rotation=item().rotation;}
        showKeyboard(false);
      }
      else {if(g().items.length>=6)throw Error(mode==='review'?'本组已有6项，可先删除误识别项再添加。':'本组已有6个小螺旋，请先添加新的大螺旋。');remember();const added=C.add(g(),letter,pendingPoint);if(mode==='review')added.manualAdded=true;selectItem(null,true);keyboardPoint={x:added.x,y:added.y};}
      changed();note('已设置 '+letter+'。');
    }catch(error){note(error.message);}
  }
  function point(event,canvas,width=600,height=600){const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(width,(event.clientX-r.left)*width/r.width)),y:Math.max(0,Math.min(height,(event.clientY-r.top)*height/r.height))};}
  function nearest(p){return g()?.items.map(i=>({i,d:Math.hypot(i.x-p.x,i.y-p.y)})).filter(x=>x.d<Math.max(24,x.i.size*.45)).sort((a,b)=>a.d-b.d)[0]?.i;}
  stage.addEventListener('pointerdown',event=>{
    if(!ready||loadingImport||!g()||event.button!==0)return;event.preventDefault();stage.focus({preventScroll:true});const p=point(event,stage);keyboardPoint=p;renderKeyboardAngle();
    if(deep){if(scanBusy)return;deep.drag={id:event.pointerId,start:p};deep.region=null;deep.preview=null;deep.candidates=[];$('siren-deep-candidates').replaceChildren();stage.setPointerCapture(event.pointerId);scanControls();draw();return;}
    if(contactMode&&item()){
      if(item().positionLocked)return;const match=geometry.project(geometry.basePoints(g()),p);if(!match||match.distance>12){note('标记离参考路径过远，请先对齐路径。');return;}
      remember();item().contact={x:p.x,y:p.y};contactMode=false;changed();note('已记录人工首交点，并重新计算语序。');return;
    }
    if(centerMode){if(g().items.some(i=>i.positionLocked))return;remember();g().cx=p.x;g().cy=p.y;C.reorient(g());centerMode=false;changed();note('中心已更新。');return;}
    const hit=nearest(p);
    if(!hit){selectItem(null,!$('siren-keyboard-panel').hidden);pendingPoint=p;keyboardPoint=p;renderFields();draw();note('');return;}
    selectItem(hit.id);keyboardPoint=p;
    if(hit.positionLocked){renderFields();draw();return;}
    drag={id:event.pointerId,start:p,offset:{x:hit.x-p.x,y:hit.y-p.y},saved:false,analysis:geometry.analyze(g(),mode==='review')};stage.setPointerCapture(event.pointerId);renderFields();draw();
  });
  stage.addEventListener('pointermove',event=>{
    if(deep?.drag){if(deep.drag.id===event.pointerId){updateDeepRegion(point(event,stage));draw();}return;}
    if(!drag||drag.id!==event.pointerId||!item()||item().positionLocked)return;const p=point(event,stage);
    if(!drag.saved&&Math.hypot(p.x-drag.start.x,p.y-drag.start.y)<2)return;
    if(!drag.saved){remember();drag.saved=true;}
    if(C.move(g(),item(),{x:p.x+drag.offset.x,y:p.y+drag.offset.y})){
      translation.invalidate();$('siren-format').disabled=true;$('siren-copy-formatted').disabled=true;$('siren-copy-raw').disabled=true;$('siren-translate').disabled=true;$('siren-export-png').disabled=true;
      keyboardPoint={x:item().x,y:item().y};renderFields();draw();note('');
    }
  });
  function finishDrag(event){if(deep?.drag?.id===event.pointerId){if(event.type==='pointerup'){if(Number.isFinite(event.clientX)&&Number.isFinite(event.clientY))updateDeepRegion(point(event,stage));}else deep.region=null;deep.drag=null;if(deep.region&&(deep.region.width<2||deep.region.height<2))deep.region=null;$('siren-deep-status').textContent=deep.region?'已框选中心范围，点击开始识别。':'请拖出至少2×2的框。';scanControls();draw();return;}if(drag&&event.pointerId===drag.id){
    if(event.type==='pointerup'&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)&&item()){
      const p=point(event,stage);if(drag.saved||Math.hypot(p.x-drag.start.x,p.y-drag.start.y)>=2){if(!drag.saved){remember();drag.saved=true;}C.move(g(),item(),{x:p.x+drag.offset.x,y:p.y+drag.offset.y});}
    }
    const moved=drag.saved;drag=null;if(moved){changed();note('');}else render();
  }}
  stage.addEventListener('pointerup',finishDrag);stage.addEventListener('pointercancel',finishDrag);stage.addEventListener('lostpointercapture',finishDrag);
  stage.addEventListener('keydown',event=>{
    if(!ready||loadingImport||event.ctrlKey||event.metaKey||event.altKey||event.isComposing)return;
    if(/^[A-Za-z]$/.test(event.key)){event.preventDefault();pick(event.key.toUpperCase());}
    else if(event.key==='Escape'){centerMode=false;selectItem();drag=null;changed();}
  });
  $('siren-key-add').addEventListener('change',()=>{if($('siren-key-add').checked){selectItem(null,true);renderFields();draw();}});
  $('siren-open-add').addEventListener('click',()=>{if(!g()||g().items.length>=6)return;const p=pendingPoint;selectItem();pendingPoint=p;keyboardPoint=p;showKeyboard(true);renderFields();draw();});
  $('siren-open-replace').addEventListener('click',()=>{if(!item()||item().positionLocked)return;showKeyboard(true);renderFields();});
  $('siren-keyboard-close').addEventListener('click',()=>showKeyboard(false));
  $('siren-position-lock').addEventListener('click',()=>{if(!item()||drag)return;remember();item().positionLocked=!item().positionLocked;precisionEdit=null;centerMode=false;contactMode=false;showKeyboard(false);changed();});
  $('siren-reset-position').addEventListener('click',()=>{if(!item()||item().positionLocked||!C.canReset(g(),item())||drag)return;remember();C.resetPosition(g(),item());keyboardPoint={x:item().x,y:item().y};showKeyboard(false);changed();note('已恢复识别位置。');});
  for(const [buttonId,panelId] of [['siren-precision-toggle','siren-precision-panel'],['siren-batch-toggle','siren-batch-panel']])$(buttonId).addEventListener('click',()=>{const open=$(panelId).hidden;$(panelId).hidden=!open;$(buttonId).setAttribute('aria-expanded',String(open));if(open&&panelId==='siren-batch-panel')$('siren-source-text').focus();});
  function maxRadius(group,deg){const rad=deg*Math.PI/180,dx=Math.cos(rad),dy=Math.sin(rad);return Math.max(0,Math.min(Math.abs(dx)<1e-9?850:(dx>0?600-group.cx:group.cx)/Math.abs(dx),Math.abs(dy)<1e-9?850:(dy>0?600-group.cy:group.cy)/Math.abs(dy)));}
  function adjust(name,el,sliding=false){
    if(!g()||name!=='base-size'&&(!item()||item().positionLocked)||name==='base-size'&&g().items.some(i=>i.positionLocked)||name==='rotation'&&item().rotationMode!=='manual')return;
    const v=Number(el.value);if(el.value===''||!Number.isFinite(v)||v<Number(el.min)||v>Number(el.max)){note('请输入控件范围内的数值。');el.blur();renderFields();return;}
    try{
      const next=item()?{...item()}:null;
      if(name==='radius'||name==='angle'){const angle=name==='angle'?v:C.angle(g(),next),radius=name==='radius'?v:C.radius(g(),next);C.polar(g(),next,sliding?Math.min(radius,maxRadius(g(),angle)):radius,angle);}
      if(name==='rotation'){next.rotation=C.normalize(v);next.contact=null;C.invalidateFit(next);}
      if(!sliding||precisionEdit!==name){remember();precisionEdit=sliding?name:null;}
      if(name==='base-size')C.resizeBase(g(),v);else{Object.assign(item(),next);C.invalidateFit(item());keyboardPoint={x:item().x,y:item().y};}
      changed();
    }catch(error){note(error.message);el.blur();renderFields();}
  }
  for(const name of ['radius','angle','rotation','base-size']){
    $('siren-'+name).addEventListener('change',()=>adjust(name,$('siren-'+name)));
    $('siren-'+name+'-slider').addEventListener('input',()=>adjust(name,$('siren-'+name+'-slider'),true));
    $('siren-'+name+'-slider').addEventListener('change',()=>{precisionEdit=null;});
  }
  $('siren-rotation-mode').addEventListener('click',()=>{if(!item()||item().positionLocked)return;remember();C.setRotationMode(g(),item(),item().rotationMode!=='manual');changed();});
  for(const id of ['siren-guides','siren-overlay','siren-path'])$(id).addEventListener('change',draw);
  $('siren-center').addEventListener('click',()=>{if(g()?.items.some(i=>i.positionLocked))return;centerMode=!centerMode;contactMode=false;pendingPoint=null;render();});
  $('siren-contact').addEventListener('click',()=>{if(!item()||item().positionLocked)return;contactMode=!contactMode;centerMode=false;pendingPoint=null;$('siren-guides').checked=true;$('siren-path').checked=true;render();});
  $('siren-add-group').addEventListener('click',()=>{try{if(doc().groups.length>=50)throw Error('最多50组，请分段保存。');remember();C.addGroup(doc());groupIndex=doc().groups.length-1;selectItem();changed();$('siren-groups').scrollLeft=$('siren-groups').scrollWidth;}catch(e){note(e.message);}});
  $('siren-delete-group').addEventListener('click',()=>{if(g()&&confirm('删除当前大螺旋及其全部小螺旋？可以撤销。')){remember();doc().groups.splice(groupIndex,1);selectItem();changed();}});
  $('siren-delete-recognized').addEventListener('click',()=>{if(mode!=='review'||!item()||drag)return;remember();g().items=g().items.filter(i=>i.id!==itemId);selectItem();changed();note('已移除所选小螺旋识别项；原始截图未改变，可撤销。');});
  for(const [id,delta] of [['siren-group-prev',-1],['siren-group-next',1]])$(id).addEventListener('click',()=>{const target=groupIndex+delta;if(target<0||target>=doc().groups.length)return;remember();[doc().groups[target],doc().groups[groupIndex]]=[doc().groups[groupIndex],doc().groups[target]];groupIndex=target;changed();});
  $('siren-undo').addEventListener('click',()=>{if(!history[mode].length)return;docs[mode]=JSON.parse(history[mode].pop());selectItem();revisions[mode]++;changed();});
  $('siren-from-text').addEventListener('click',()=>{
    try{const next=C.fromText($('siren-source-text').value);for(const group of next.groups)if(!geometry.arrange(group))throw Error('当前字形组合无法自动排出可靠交点顺序，请改为逐字添加。');if(doc().groups.some(g=>g.items.length)&&!confirm('重新生成会替换当前生成画布。可撤销；原英文空格不会编码。继续？'))return;remember();docs.generate=next;groupIndex=0;selectItem();$('siren-batch-panel').hidden=true;$('siren-batch-toggle').setAttribute('aria-expanded','false');changed();note('已按交点顺序生成，并将所有大螺旋横向连续排列。空格不编码，可自由拖动修改。');}catch(e){note(e.message);}
  });
  $('siren-mode-generate').addEventListener('click',()=>switchMode('generate'));$('siren-mode-review').addEventListener('click',()=>switchMode('review'));
  function renderSource(){
    const canvas=$('siren-source-canvas'),c=canvas.getContext('2d');if(!source)return;
    canvas.width=source.width;canvas.height=source.height;c.drawImage(source,0,0);
  }
  async function loadSourceFile(file){
    if(!file||!ready||loadingImport)return;cancelScan();const ticket=++sourceTicket;sourceLoading=true;scanControls();let url;
    try{
      if(file.size>16*1024*1024||!/^image\/(png|jpeg|webp)$/.test(file.type))throw Error('请选择16MB以内的 PNG / JPG / WebP 图片。');
      url=URL.createObjectURL(file);const img=await image(url);if(ticket!==sourceTicket)return;
      if(img.width*img.height>24000000||img.width>12000||img.height>12000)throw Error('图片尺寸过大，请先裁小到2400万像素以内。');
      source=img;renderSource();scanControls();$('siren-scan-status').textContent='图片已载入，点击“自动分割并匹配”。已有解读组保留。';note('图片仅在本机处理。');
    }catch(e){if(ticket===sourceTicket)note(e.message);}finally{if(url)URL.revokeObjectURL(url);if(ticket===sourceTicket){sourceLoading=false;scanControls();}}
  }
  $('siren-image-file').addEventListener('change',async event=>{await loadSourceFile(event.target.files[0]);event.target.value='';});
  const acceptsPaste=()=>!$('panel-siren').hidden&&mode==='review'&&ready&&!loadingImport;
  document.addEventListener('paste',event=>{
    if(!acceptsPaste())return;const file=[...(event.clipboardData?.items||[])].find(i=>i.kind==='file'&&/^image\/(png|jpeg|webp)$/.test(i.type))?.getAsFile();
    if(file){event.preventDefault();return loadSourceFile(file);}
  });
  $('siren-review-tools').addEventListener('dragover',e=>{if(acceptsPaste())e.preventDefault();});
  $('siren-review-tools').addEventListener('drop',e=>{if(!acceptsPaste())return;const file=[...(e.dataTransfer?.files||[])].find(f=>/^image\/(png|jpeg|webp)$/.test(f.type));if(file){e.preventDefault();loadSourceFile(file);}});
  $('siren-paste-image').addEventListener('click',async()=>{
    const ticket=sourceTicket;
    try{if(!navigator.clipboard?.read)throw Error('浏览器不支持按钮读取剪贴板，请使用 Ctrl+V 粘贴图片。');
      const entries=await navigator.clipboard.read();if(!acceptsPaste()||sourceTicket!==ticket)return;
      for(const entry of entries){const type=entry.types.find(t=>/^image\/(png|jpeg|webp)$/.test(t));if(type){const file=await entry.getType(type);if(acceptsPaste()&&sourceTicket===ticket)await loadSourceFile(file);return;}}
      throw Error('剪贴板中没有 PNG / JPG / WebP 图片，请先复制截图。');
    }catch(e){note('无法读取剪贴板：'+e.message+' 也可用 Ctrl+V 或选择文件。');}
  });
  function scanImage(operation){
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(operation==='fit'){
      const bg=backgrounds.get(g()?.image);if(!bg)throw Error('当前组没有可用截图。');canvas.width=bg.width;canvas.height=bg.height;ctx.drawImage(bg,0,0,canvas.width,canvas.height);
    }else{
      if(!source||source.width<8||source.height<8)throw Error('请先粘贴或选择要识别的图片。');
      const ratio=Math.min(1,3600/Math.max(source.width,source.height),Math.sqrt(12000000/(source.width*source.height)));canvas.width=Math.max(1,Math.round(source.width*ratio));canvas.height=Math.max(1,Math.round(source.height*ratio));
      ctx.drawImage(source,0,0,source.width,source.height,0,0,canvas.width,canvas.height);
    }
    return {canvas,image:ctx.getImageData(0,0,canvas.width,canvas.height)};
  }
  async function scanResultGroup(result,canvas,keepFrame){
    const base=result.base;if(!base||!Number.isFinite(base.cx)||!Number.isFinite(base.cy)||!Number.isFinite(base.size))throw Error('识别返回了无效的位置。');
    // Defence at the result boundary too; imported/manual groups are untouched.
    const items=result.items.filter(p=>containsLocator(base,p));
    let x=0,y=0,width=canvas.width,height=canvas.height;
    if(!keepFrame){
      const points=[{x:base.cx,y:base.cy,size:base.size},...items];
      x=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x-p.size*.78))));y=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y-p.size*.78))));
      width=Math.min(canvas.width,Math.ceil(Math.max(...points.map(p=>p.x+p.size*.78))))-x;height=Math.min(canvas.height,Math.ceil(Math.max(...points.map(p=>p.y+p.size*.78))))-y;
    }
    if(width<8||height<8)throw Error('识别区域太小，请改用更清晰的截图。');
    const scale=(keepFrame?600:560)/Math.max(width,height),dx=(600-width*scale)/2,dy=(600-height*scale)/2;
    // Geometry remains in 600 logical units; retain extra source pixels for a
    // later rematch instead of repeatedly resampling a 600px saved thumbnail.
    const out=document.createElement('canvas'),resolution=Math.max(600,Math.min(1200,keepFrame?Math.max(width,height):Math.ceil(600/scale)));
    const group=C.group();
    // Keep the same logical frame while reducing a noisy crop that exceeds the
    // existing work-file limit. Re-fitting a square crop preserves its pixel size.
    for(const pixels of [...new Set([resolution,900,600])].filter(n=>n<=resolution)){
      out.width=pixels;out.height=pixels;const c=out.getContext('2d');c.scale(pixels/600,pixels/600);
      c.fillStyle='#fffdf7';c.fillRect(0,0,600,600);c.drawImage(canvas,x,y,width,height,dx,dy,width*scale,height*scale);
      group.image=out.toDataURL('image/png');if(group.image.length<=2800000)break;
    }
    if(group.image.length>2800000)throw Error('截图裁片过大，请使用背景更干净的图片。');
    await cropImage(group.image);
    group.cx=(base.cx-x)*scale+dx;group.cy=(base.cy-y)*scale+dy;group.baseSize=base.size*scale;group.baseRotation=C.normalize(base.rotation);
    const convert=p=>({letter:p.letter,x:(p.x-x)*scale+dx,y:(p.y-y)*scale+dy,size:p.size*scale,rotation:C.normalize(p.rotation),score:Math.max(0,Math.min(1,p.score))});
    for(const raw of items){
      const p=convert(raw),token=C.add(group,p.letter,{x:p.x,y:p.y});token.size=p.size;
      token.fit={rotation:p.rotation,score:p.score,candidates:raw.candidates.filter(p=>containsLocator(base,p)).slice(0,3).map(convert),...(raw.method==='joint-pixel'?{method:raw.method}:{})};
    }
    // Reuse the work-file validator before any new result can mutate existing work.
    return C.decode({format:C.FORMAT,version:C.VERSION,mode:'review',groups:[group]}).groups[0];
  }
  function clearDeep(){const running=deep?.running;deep=null;$('siren-deep-panel').hidden=true;$('siren-deep-toggle').setAttribute('aria-expanded','false');$('siren-deep-candidates').replaceChildren();if(running)cancelScan();}
  function updateDeepRegion(p){const a=deep.drag.start;deep.region={x:Math.min(a.x,p.x),y:Math.min(a.y,p.y),width:Math.abs(a.x-p.x),height:Math.abs(a.y-p.y)};}
  $('siren-deep-toggle').addEventListener('click',()=>{
    if(!ready||scanBusy||loadingImport||mode!=='review'||!g()?.image)return;
    if(deep){clearDeep();draw();return;}
    centerMode=false;contactMode=false;showKeyboard(false);const t=item();
    const region=t?{x:Math.max(0,t.x-24),y:Math.max(0,t.y-24),width:Math.min(600,t.x+24)-Math.max(0,t.x-24),height:Math.min(600,t.y+24)-Math.max(0,t.y-24)}:null;
    deep={group:g(),itemId,revision:revisions.review,region,candidates:[],preview:null,running:false,drag:null};
    $('siren-deep-panel').hidden=false;$('siren-deep-toggle').setAttribute('aria-expanded','true');
    $('siren-deep-status').textContent=t?'已框住所选项中心，也可重新拖框。':'请在画布圈住待识别的小螺旋中心。';scanControls();draw();
  });
  $('siren-deep-close').addEventListener('click',()=>{clearDeep();scanControls();draw();});
  $('siren-deep-run').addEventListener('click',async()=>{
    if(!deep?.region||deep.drag||scanBusy||loadingImport||mode!=='review')return;
    const job=deep,ticket=++scanTicket;job.running=true;job.preview=null;job.candidates=[];scanBusy=true;scanControls();$('siren-deep-candidates').replaceChildren();
    try{
      const input=scanImage('fit'),scale=input.canvas.width/600;
      if(input.canvas.width!==input.canvas.height)throw Error('请先重新匹配本组，生成正方形校准裁片。');
      const base={cx:job.group.cx*scale,cy:job.group.cy*scale,size:job.group.baseSize*scale,rotation:job.group.baseRotation||0},region=Object.fromEntries(Object.entries(job.region).map(([k,v])=>[k,v*scale]));
      const result=await scan.run({operation:'deep',templates,image:input.image,base,region});
      if(ticket!==scanTicket||deep!==job||mode!=='review'||g()!==job.group||revisions.review!==job.revision)return;
      job.candidates=result.candidates.filter(p=>assets.letters[p.letter]&&[p.x,p.y,p.size,p.rotation,p.score].every(Number.isFinite)).map(p=>({...p,x:p.x/scale,y:p.y/scale,size:p.size/scale,rotation:C.normalize(p.rotation),score:Math.max(0,Math.min(1,p.score))})).filter(p=>containsLocator(g(),p)&&p.x>=0&&p.y>=0&&p.x<=600&&p.y<=600);
      for(const p of job.candidates){
        const b=button('',()=>{if(deep!==job||job.running)return;job.preview=p;$('siren-deep-status').textContent='预览 '+p.letter+' · 笔画覆盖 '+(p.score*100).toFixed(1)+'%（不是正确率）'+(p.passesCoverage?'':' · 低于常规覆盖门槛')+'；确认后才应用。';scanControls();draw();});
        const preview=document.createElement('span');preview.className='siren-candidate-preview';const img=document.createElement('img');img.src=assets.letters[p.letter].src;img.alt='';img.style.transform='rotate('+p.rotation+'deg)';preview.append(img);
        const label=document.createElement('span');label.textContent=p.letter+' · '+(p.score*100).toFixed(1);b.className='secondary siren-match-candidate';b.append(preview,label);$('siren-deep-candidates').append(b);
      }
      $('siren-deep-status').textContent=job.candidates.length?'点击候选预览；当前字母和位置尚未改变。':'此区域未找到符合几何约束的候选，可重画中心范围。';
    }catch(e){if(ticket===scanTicket&&deep===job)$('siren-deep-status').textContent=e.message;}
    finally{if(ticket===scanTicket){job.running=false;scanBusy=false;scanControls();}}
  });
  $('siren-deep-apply').addEventListener('click',()=>{
    const job=deep,p=job?.preview;if(!p||scanBusy||mode!=='review'||g()!==job.group||revisions.review!==job.revision)return;
    const existing=g().items.find(i=>i.id===job.itemId);if(existing?.positionLocked){note('请先解锁位置。');return;}
    if(!existing&&g().items.length>=6){note('本组已有6项，请先删除误识别项。');return;}
    try{
      const next=JSON.parse(JSON.stringify(g())),target=existing?next.items.find(i=>i.id===existing.id):C.add(next,p.letter,{x:p.x,y:p.y});
      const seen=new Set(),candidates=[p,...job.candidates].filter(c=>!seen.has(c.letter)&&seen.add(c.letter)).slice(0,3).map(c=>({letter:c.letter,x:c.x,y:c.y,size:c.size,rotation:c.rotation,score:c.score}));
      Object.assign(target,{letter:p.letter,x:p.x,y:p.y,size:p.size,contact:null,rotationMode:'auto',fit:{rotation:p.rotation,score:p.score,candidates}});if(!existing)target.manualAdded=true;
      C.orient(next,target);C.rememberPose(next,target,true);
      const validated=C.decode({format:C.FORMAT,version:C.VERSION,mode:'review',groups:[next]}).groups[0];
      const selectedId=validated.items[next.items.indexOf(target)].id;
      remember();doc().groups[groupIndex]=validated;selectItem(selectedId);changed();note('已采用 '+p.letter+'；可撤销。');
    }catch(e){note(e.message);}
  });
  if(samples){
    GlyphSamplesUI.mount({library:samples,container:$('siren-samples'),language:'siren',labels:()=>Object.fromEntries(Object.keys(assets.letters).map(id=>[id,id])),download:(blob,name)=>BabelianHost.download(blob,name)});
    $('siren-add-sample').addEventListener('click',()=>{
      const token=item(),group=g();if(scanBusy||drag||mode!=='review'||!group?.image||!token?.letter)return;
      try{const bg=backgrounds.get(group.image);if(!bg)throw Error('原图尚未就绪。');samples.add({language:'siren',glyphId:token.letter,image:group.image,width:bg.width,height:bg.height,annotation:{frame:600,base:{x:group.cx,y:group.cy,size:group.baseSize,rotation:group.baseRotation||0},glyph:{x:token.x,y:token.y,size:token.size,rotation:C.displayRotation(group,token)},contact:token.contact||null},include:true,note:''});note('已加入校正样本库；朝向异常样本可取消“纳入后续训练”。离开前请导出样本库。');}
      catch(e){note(e.message);}
    });
  }else $('siren-samples').hidden=true;
  async function runScan(operation){
    if(!ready||loadingImport||scanBusy||sourceLoading||mode!=='review')return;
    if(operation==='fit'&&g()?.items.length&&!confirm('重新匹配会替换本组全部识别项（包括已锁定项）。原图保留，可撤销。继续？'))return;
    clearDeep();
    const target=doc(),targetGroup=g(),revision=revisions.review,imageTicket=sourceTicket,ticket=++scanTicket;
    scanBusy=true;scanControls();$('siren-scan-status').textContent='正在本机匹配图形，可随时取消；尚未修改原有工作。';
    try{
      const input=scanImage(operation),limit=operation==='fit'?1:Math.min(20,50-target.groups.length);
      if(limit<1)throw Error('已达到50组，请分段保存。');
      const results=await scan.run({image:input.image,templates,operation,limit});
      if(ticket!==scanTicket)return;
      if(!results.length)throw Error('没有找到足够可靠的大螺旋。请使用更清晰、仅包含螺旋的图片。');
      const added=[];for(const result of results)added.push(await scanResultGroup(result,input.canvas,operation==='fit'));
      if(ticket!==scanTicket||imageTicket!==sourceTicket||mode!=='review'||doc()!==target)return;
      if(revision!==revisions.review)throw Error('识别期间工作已被修改，本次结果未应用。请重新识别。');
      remember();
      if(operation==='fit'){const index=target.groups.indexOf(targetGroup);if(index<0)throw Error('原组已变化，请重新识别。');target.groups[index]=added[0];groupIndex=index;}
      else{groupIndex=target.groups.length;target.groups.push(...added);}
      selectItem();centerMode=false;$('siren-path').checked=true;$('siren-guides').checked=true;changed();
      const total=added.reduce((n,g)=>n+g.items.length,0),unknown=added.reduce((n,g)=>n+g.items.filter(i=>!i.letter).length,0);
      $('siren-scan-status').textContent=added.length+' 组 · '+total+' 个小螺旋 · '+unknown+' 个待确认';note('');
    }catch(e){if(ticket===scanTicket){$('siren-scan-status').textContent=e.message;note(e.message);}}
    finally{if(ticket===scanTicket){scanBusy=false;scanControls();}}
  }
  $('siren-auto-scan').addEventListener('click',()=>runScan('detect'));
  $('siren-fit-group').addEventListener('click',()=>runScan('fit'));
  $('siren-scan-cancel').addEventListener('click',()=>{cancelScan();$('siren-scan-status').textContent='已取消，原有解读未改变。';});
  async function copy(el){try{await navigator.clipboard.writeText(el.value);note('已复制。');}catch(_){el.focus();el.select();note(document.execCommand('copy')?'已复制。':'请手动复制已选中的文本。');}}
  $('siren-copy-raw').addEventListener('click',()=>copy($('siren-raw')));
  $('siren-format').addEventListener('click',()=>{if(draft().state()?.dirty&&!confirm('重新生成会替换手动修改的分词与标点。继续？'))return;draft().generate(payload(),formatOptions());$('siren-formatted').value=draft().state().value;translation.invalidate();renderFormatted();});
  $('siren-formatted').addEventListener('input',()=>{if(!draft().state())draft().generate(payload(),formatOptions());draft().edit($('siren-formatted').value);renderFormatted();});
  $('siren-copy-formatted').addEventListener('click',()=>{if(draft().state()&&!draft().state().error)copy($('siren-formatted'));});
  function renderTranslation(state){
    const current=draft().state(),can=!!current&&!current.error&&!!current.value.trim();
    $('siren-chinese').value=state.value;$('siren-copy-chinese').disabled=state.status!=='done';
    $('siren-translate').disabled=!can||!$('siren-translate-consent').checked||state.status==='busy';
    $('siren-translate-cancel').hidden=state.status!=='busy';
    $('siren-translate-status').textContent=state.error||(state.status==='busy'?'正在翻译'+(state.progress?' '+state.progress.done+'/'+state.progress.total:'')+'…':state.status==='done'?'已翻译当前整理英文；机翻不作为密码校准依据。':'');
  }
  $('siren-translate-toggle').addEventListener('click',()=>{const open=$('siren-translate-panel').hidden;$('siren-translate-panel').hidden=!open;$('siren-translate-toggle').setAttribute('aria-expanded',String(open));if(!open)translation.cancel();});
  $('siren-translate-consent').addEventListener('change',()=>{if(!$('siren-translate-consent').checked)translation.cancel();renderTranslation(translation.state());});
  $('siren-translate').addEventListener('click',()=>{const d=draft().state();if($('siren-translate-consent').checked&&d&&!d.error)translation.run(d.value);});
  $('siren-translate-cancel').addEventListener('click',()=>translation.cancel());$('siren-copy-chinese').addEventListener('click',()=>copy($('siren-chinese')));
  $('siren-export-png').addEventListener('click',async()=>{
    try{
      const groups=JSON.parse(JSON.stringify(doc().groups));if(!groups.length)throw Error('请先添加大螺旋。');if(drag)throw Error('请松手完成拖动后再导出。');
      const canvas=document.createElement('canvas');let blob=null,layout;
      for(const limit of [8192,4096,2048]){try{layout=drawStrip(canvas,limit,groups);blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(blob)break;}catch(_){blob=null;}}
      if(!blob)throw Error('图片导出失败，请保存工作后减少组数再试。');
      await BabelianHost.download(blob,'塞壬语螺旋.png');note('已导出全部 '+groups.length+' 组的横向整幅 PNG，无中心标记和字母标签。'+(layout.scale<1?'图像过长，已等比缩小为 '+layout.width+'×'+layout.height+'。':''));
    }catch(e){note(e.message);}
  });
  $('siren-save').addEventListener('click',async()=>{
    try{if(!ready||loadingImport)return;const savedMode=mode,savedRevision=revisions[mode],data=JSON.stringify(doc(),null,2);if(data.length>7500000)throw Error('工作文件过大，请将截图解读分段保存。');await BabelianHost.download(new Blob([data],{type:'application/json'}),'塞壬语-'+(savedMode==='generate'?'生成':'解读')+'工作.json');savedRevisions[savedMode]=savedRevision;note('已导出'+(savedMode==='generate'?'生成':'解读')+'模式的螺旋、逐字对应和裁片；整理英文与机翻请另行复制。');}catch(e){note(e.message);}
  });
  $('siren-load').addEventListener('click',()=>{if(ready&&!loadingImport)$('siren-work-file').click();});
  $('siren-work-file').addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file)return;cancelScan();const ticket=++importTicket;loadingImport=true;$('siren-tools').disabled=true;
    try{
      if(file.size>8*1024*1024)throw Error('工作文件超过8MB。');const next=C.decode(JSON.parse(await file.text()));
      await Promise.all(next.groups.filter(g=>g.image).map(g=>cropImage(g.image)));
      if(ticket!==importTicket)return;
      if(!confirm('载入将替换“'+(next.mode==='generate'?'生成':'解读')+'”模式的当前工作，可撤销。继续？'))return;
      mode=next.mode;remember();docs[mode]=next;groupIndex=0;selectItem();centerMode=false;draft().clear();translation.invalidate();$('siren-path').checked=mode==='review';render();note('已载入：保留截图匹配参数及自动/可调朝向。旧版默认大小按原规则迁移，v1截图工作需补标首交点。巴别语存档不变。');
    }catch(error){note('载入失败：'+error.message);}finally{loadingImport=false;$('siren-tools').disabled=!ready;e.target.value='';}
  });
  window.addEventListener('beforeunload',event=>{if(Object.keys(revisions).some(key=>revisions[key]!==savedRevisions[key])){event.preventDefault();event.returnValue='';}});
  const loaded=Promise.all([['base',assets.base],...Object.entries(assets.letters)].map(async([key,a])=>[key,await image(a.src)]))
    .then(entries=>{images=Object.fromEntries(entries);const masks={};templates={base:null,letters:{},path};for(const [letter,asset] of [['base',assets.base],...Object.entries(assets.letters)]){
      const canvas=document.createElement('canvas');canvas.width=asset.width;canvas.height=asset.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(images[letter],0,0);const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data,alpha=new Uint8Array(canvas.width*canvas.height);for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3];masks[letter]={width:canvas.width,height:canvas.height,alpha};
      const template={width:asset.width,height:asset.height,pivotX:asset.pivotX,pivotY:asset.pivotY,data:rgba};if(letter==='base')templates.base=template;else templates.letters[letter]=template;
    }geometry=SirenIntersections.prepare({base:assets.base,letters:assets.letters,path,masks});ready=true;$('siren-tools').disabled=false;
      for(const letter of 'ABCDEFGHIJKLMZYXWVUTSRQPON'){
        const b=button('',()=>pick(letter)),img=document.createElement('img');img.src=assets.letters[letter].src;img.alt='';keyboardImages.push(img);const label=document.createElement('span');label.textContent=letter;b.append(img,label);b.title='塞壬字母 '+letter;b.setAttribute('aria-label','塞壬字母 '+letter);$('siren-keyboard').append(b);
      }render();note('');
    }).catch(e=>note('塞壬语素材加载失败：'+e.message+' 请检查模块素材是否完整。'));
  return {refresh:()=>{if(ready)render();},pause:()=>{cancelScan();sourceTicket++;sourceLoading=false;translation.cancel();drag=null;centerMode=false;contactMode=false;showKeyboard(false);if(ready)changed();},ready:loaded,snapshot:()=>JSON.parse(JSON.stringify(doc()))};
}};
