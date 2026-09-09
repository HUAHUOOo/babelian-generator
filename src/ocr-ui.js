/* Pixels stay on device. Online translation is a separate, explicit text-only
   opt-in; only "append to writer" enters local/ATO draft persistence. */
globalThis.BabelianOCRUI={mount({glyphs,wordData,getMapping,editMapping,append,notify}){
  const $=id=>document.getElementById(id),OCR=BabelianOCR,ids=Object.keys(glyphs);
  const panel=$('panel-decode'),preview=$('ocr-preview'),ctx=preview.getContext('2d');
  let source=null,crop=null,result=null,resultImage=null,selected=null,drag=null,rebox=null;
  let templatesPromise=null,templates=null,prepared=null,worker=null,job=0,loading=0,busy=false;
  const formatter=BabelianTextFormat.create(wordData),formattedDraft=BabelianTextFormat.createDraft(formatter);
  const translation=BabelianTranslation.createSession(BabelianTranslation.createClient(),renderTranslation);
  const label=id=>'G'+String(ids.indexOf(id)+1).padStart(2,'0');
  const mapping=()=>getMapping();
  const options=()=>({polarity:$('ocr-polarity').value,threshold:$('ocr-auto').checked?null:Number($('ocr-threshold').value),oneLine:$('ocr-single').checked});
  const outputOptions=()=>({joinLines:$('ocr-join').checked});
  function message(text){$('ocr-status').textContent=text;}
  function imageElement(id){const img=document.createElement('img');img.src=glyphs[id].src;img.alt=label(id);return img;}
  function setBusy(value){busy=value;$('ocr-run').disabled=value||!source;$('ocr-cancel').hidden=!value;$('ocr-controls').disabled=value;panel.setAttribute('aria-busy',String(value));}
  function cancel(){job++;if(worker){worker.terminate();worker=null;}setBusy(false);}
  function clearResult(){
    formattedDraft.clear();$('ocr-formatted').value='';$('ocr-format-status').textContent='';
    translation.invalidate('识别结果已清除，请重新整理后翻译。');endRebox();
    result=null;resultImage=null;selected=null;$('ocr-results').hidden=true;$('ocr-review').hidden=true;$('ocr-inspection').hidden=true;
    setTranslationOpen(false);
    $('ocr-output').value='';$('ocr-tokens').replaceChildren();$('ocr-candidates').replaceChildren();
    $('ocr-piece').width=1;$('ocr-piece').height=1;$('ocr-choice-image').removeAttribute('src');
  }
  function updateCropFields(){if(!crop)return;for(const key of ['x','y','width','height'])$('ocr-crop-'+key).value=crop[key];}
  function changeCrop(next){
    if(!source||busy)return;
    const x=Math.max(0,Math.min(source.width-1,Math.round(next.x))),y=Math.max(0,Math.min(source.height-1,Math.round(next.y)));
    crop={x,y,width:Math.max(1,Math.min(source.width-x,Math.round(next.width))),height:Math.max(1,Math.min(source.height-y,Math.round(next.height)))};
    clearResult();updateCropFields();draw();message('框选区域已更新。点击“识别所选区域”。');
  }
  function draw(){
    if(!source)return;
    if(preview.width!==source.width||preview.height!==source.height){preview.width=source.width;preview.height=source.height;}
    ctx.clearRect(0,0,preview.width,preview.height);ctx.drawImage(source,0,0);
    const scale=preview.width/Math.max(1,preview.clientWidth),line=Math.max(1,scale*1.4);
    ctx.fillStyle='#10241d88';
    ctx.fillRect(0,0,preview.width,crop.y);ctx.fillRect(0,crop.y+crop.height,preview.width,preview.height-crop.y-crop.height);
    ctx.fillRect(0,crop.y,crop.x,crop.height);ctx.fillRect(crop.x+crop.width,crop.y,preview.width-crop.x-crop.width,crop.height);
    ctx.strokeStyle='#a57b37';ctx.lineWidth=line;ctx.strokeRect(crop.x,crop.y,crop.width,crop.height);
    if(result)result.lines.forEach((row,li)=>row.tokens.forEach((token,ti)=>{
      const b=token.box;ctx.strokeStyle=selected?.line===li&&selected?.token===ti?'#1768dc':token.manual||token.certain?'#188041':'#c86613';
      ctx.strokeRect(crop.x+b.x,crop.y+b.y,b.width,b.height);
    }));
    if(rebox?.box){const b=rebox.box;ctx.save();ctx.strokeStyle='#1768dc';ctx.lineWidth=line*2;ctx.setLineDash([scale*5,scale*3]);ctx.strokeRect(crop.x+b.x,crop.y+b.y,b.width,b.height);ctx.restore();}
  }
  function point(e){const r=preview.getBoundingClientRect();return {x:Math.max(0,Math.min(source.width,(e.clientX-r.left)*source.width/r.width)),y:Math.max(0,Math.min(source.height,(e.clientY-r.top)*source.height/r.height))};}
  preview.addEventListener('pointerdown',e=>{if(!source||busy||e.button!==0)return;if(rebox){rebox.box=null;$('ocr-rebox-apply').disabled=true;}drag={start:point(e),last:point(e)};preview.setPointerCapture(e.pointerId);});
  preview.addEventListener('pointermove',e=>{
    if(!drag)return;drag.last=point(e);draw();ctx.strokeStyle='#1768dc';ctx.strokeRect(drag.start.x,drag.start.y,drag.last.x-drag.start.x,drag.last.y-drag.start.y);
  });
  preview.addEventListener('pointerup',e=>{
    if(!drag)return;const start=drag.start,end=point(e);drag=null;
    if(rebox){
      try{
        rebox.box=BabelianOCRCorrection.rectangle(start,end,crop);$('ocr-rebox-apply').disabled=false;
        const hits=BabelianOCRCorrection.overlaps(result,rebox.position,rebox.box).filter(hit=>hit.rematch);
        const old=active(),freed=BabelianOCRCorrection.released(imageMask(BabelianOCRCorrection.exclusionsFor([old])),old.box,rebox.box);
        $('ocr-rebox-status').textContent=`新框 ${rebox.box.width} × ${rebox.box.height} 像素。`+
          (freed.left+freed.right?'旧框有笔画移出新框，会与本行邻近项一起重新识别。':'')+
          (hits.length?`覆盖本行 ${hits.length} 个其他识别框超过20%，会重新匹配附近字形。`:freed.left+freed.right?'':'仅替换当前项。')+'确认框住完整字形后，点击“应用新框”。';
      }
      catch(error){$('ocr-rebox-status').textContent=error.message;}draw();return;
    }
    if(Math.abs(end.x-start.x)>5&&Math.abs(end.y-start.y)>5)changeCrop({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)});
    else if(result){
      for(const [li,row] of result.lines.entries())for(const [ti,t] of row.tokens.entries()){
        const b=t.box;if(end.x>=crop.x+b.x&&end.x<crop.x+b.x+b.width&&end.y>=crop.y+b.y&&end.y<crop.y+b.y+b.height){select(li,ti);return;}
      }
    }draw();
  });
  preview.addEventListener('pointercancel',()=>{drag=null;draw();});
  function endRebox(){
    rebox=null;drag=null;$('ocr-rebox-bar').hidden=true;preview.classList.remove('reboxing');
    for(const id of ['ocr-full','ocr-rotate','ocr-crop-apply'])$(id).disabled=false;
  }
  $('ocr-rebox').addEventListener('click',()=>{
    if(!active()||busy)return;
    rebox={position:{...selected},box:null};drag=null;
    $('ocr-rebox-bar').hidden=false;$('ocr-rebox-apply').disabled=true;preview.classList.add('reboxing');
    for(const id of ['ocr-full','ocr-rotate','ocr-crop-apply'])$(id).disabled=true;
    $('ocr-rebox-status').textContent=`正在重新框选第 ${selected.line+1} 行第 ${selected.token+1} 项：请在截图上拖动。`;
    $('ocr-rebox-bar').scrollIntoView({block:'start'});$('ocr-rebox-cancel').focus({preventScroll:true});draw();
  });
  function cancelRebox(){endRebox();draw();message('已取消重新框选，原识别框保持不变。');}
  $('ocr-rebox-cancel').addEventListener('click',cancelRebox);
  document.addEventListener('keydown',e=>{if(!panel.hidden&&rebox&&e.key==='Escape'){e.preventDefault();cancelRebox();}});
  $('ocr-rebox-apply').addEventListener('click',()=>{
    if(!rebox?.box||busy)return;
    try{
      const position={...rebox.position};
      const update=BabelianOCRCorrection.replace(OCR,result,position,rebox.box,resultImage,prepared);
      endRebox();selected=update.position;renderResults();draw();
      const warning=update.overlap.length?'部分框仍有几何交叠，请核对裁片（已分配给新框的像素不会重复识别）。':'';
      const detail=update.rematched?`已按新框重新分割本行局部区域：${update.replaced} 个旧项更新为 ${update.generated} 项（含新框）。新框及附近候选需重新确认；其他区域和映射未改变。`:'已替换当前字形框，其他项未改动。请确认新候选。';
      message(detail+warning);notify(detail+warning);
      $('ocr-review').scrollIntoView({block:'start'});$('ocr-choice').focus({preventScroll:true});
    }catch(error){$('ocr-rebox-status').textContent=error.message;}
  });
  async function loadFile(file){
    if(!file)return;
    if(!/^image\/(png|jpeg|webp)$/.test(file.type)&&!(/\.(png|jpe?g|webp)$/i.test(file.name)&&!file.type)){message('请选择 PNG、JPG 或 WebP 图片。');return;}
    if(file.size>16*1024*1024){message('图片超过16MB，请先裁剪或压缩。');return;}
    if(result&&!confirm('载入新图将清除本次识别和手动校正（不会清除书写区或映射）。继续吗？'))return;
    const version=++loading;cancel();setBusy(true);message('正在读取图片…');
    const url=URL.createObjectURL(file),img=new Image();
    try{
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('图片无法读取，请换一张截图。'));img.src=url;});
      if(version!==loading)return;
      if(img.naturalWidth*img.naturalHeight>40000000)throw Error('图片尺寸过大，请先裁剪。');
      const scale=Math.min(1,2200/img.naturalWidth,Math.sqrt(6000000/(img.naturalWidth*img.naturalHeight)));
      source=document.createElement('canvas');source.width=Math.max(1,Math.round(img.naturalWidth*scale));source.height=Math.max(1,Math.round(img.naturalHeight*scale));
      source.getContext('2d').drawImage(img,0,0,source.width,source.height);
      crop={x:0,y:0,width:source.width,height:source.height};clearResult();updateCropFields();$('ocr-image-area').hidden=false;
      $('ocr-file-info').textContent=`${file.name} · ${source.width} × ${source.height}${scale<1?'（已缩小，请优先上传裁剪后的原尺寸密码图）':''}`;
      $('ocr-run').disabled=false;draw();message('请拖动框选纯巴别语区域，排除英文、标题、插图和边框。');
    }catch(e){if(version===loading)message(e.message);}
    finally{URL.revokeObjectURL(url);$('ocr-file').value='';if(version===loading)setBusy(false);}
  }
  $('ocr-upload').addEventListener('click',()=>$('ocr-file').click());
  $('ocr-file').addEventListener('change',e=>loadFile(e.target.files[0]));
  panel.addEventListener('dragover',e=>{e.preventDefault();});
  panel.addEventListener('drop',e=>{e.preventDefault();if(!busy)loadFile(e.dataTransfer.files[0]);});
  document.addEventListener('paste',e=>{if(panel.hidden||busy)return;const file=[...e.clipboardData.items].find(i=>i.kind==='file'&&i.type.startsWith('image/'))?.getAsFile();if(file){e.preventDefault();loadFile(file);}});
  $('ocr-full').addEventListener('click',()=>{if(source)changeCrop({x:0,y:0,width:source.width,height:source.height});});
  $('ocr-crop-apply').addEventListener('click',()=>{
    const next=Object.fromEntries(['x','y','width','height'].map(k=>[k,Number($('ocr-crop-'+k).value)]));
    if(Object.values(next).some(v=>!Number.isFinite(v))||next.width<1||next.height<1){message('请输入有效的框选坐标和尺寸。');return;}changeCrop(next);
  });
  $('ocr-auto').addEventListener('change',()=>{$('ocr-threshold').disabled=$('ocr-auto').checked;});
  $('ocr-threshold').addEventListener('input',()=>{$('ocr-threshold-value').textContent=$('ocr-threshold').value;});
  $('ocr-rotate').addEventListener('click',()=>{
    if(!source||busy)return;
    const canvas=document.createElement('canvas');canvas.width=source.height;canvas.height=source.width;const c=canvas.getContext('2d');c.translate(canvas.width,0);c.rotate(Math.PI/2);c.drawImage(source,0,0);source=canvas;
    changeCrop({x:0,y:0,width:source.width,height:source.height});
  });
  async function loadTemplates(){
    if(!templatesPromise)templatesPromise=Promise.all(ids.map(id=>new Promise((resolve,reject)=>{
      const img=new Image();img.onload=()=>{
        try{
        const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const c=canvas.getContext('2d');c.drawImage(img,0,0);
        const rgba=c.getImageData(0,0,canvas.width,canvas.height).data,data=new Uint8Array(canvas.width*canvas.height);
        for(let i=0;i<data.length;i++)data[i]=Number(rgba[i*4+3]>=128);
        resolve({id,width:canvas.width,height:canvas.height,data});
        }catch(e){reject(Error('无法读取本地字形模板：'+e.message));}
      };img.onerror=()=>reject(Error('字形模板载入失败，请检查素材是否完整。'));img.src=glyphs[id].src;
    }))).catch(e=>{templatesPromise=null;throw e;});
    templates=await templatesPromise;prepared=OCR.prepareTemplates(templates);return templates;
  }
  function progress(p){message(`正在按图形匹配：${p.done} / ${p.total} 行…`);}
  async function recognize(){
    if(!source||busy)return;
    if(result&&!confirm('重新识别会替换本次结果和手动校正，继续吗？'))return;
    clearResult();setBusy(true);const version=++job;message('正在准备字形模板…');
    try{
      await loadTemplates();if(version!==job)return;
      resultImage=source.getContext('2d').getImageData(crop.x,crop.y,crop.width,crop.height);
      let answer;
      // Blob workers support the offline single-file build. If unavailable, keep
      // the same engine and yield between lines; never send pixels to a service.
      if(typeof Worker!=='undefined'){
        let url;
        try{url=URL.createObjectURL(new Blob([OCR.workerSource()],{type:'text/javascript'}));worker=new Worker(url);}catch(_){worker=null;}finally{if(url)URL.revokeObjectURL(url);}
      }
      if(worker){
        try{answer=await new Promise((resolve,reject)=>{
          worker.onmessage=e=>{if(version!==job)return;if(e.data.progress)progress(e.data.progress);else if(e.data.error)reject(Error(e.data.error));else resolve(e.data.result);};
          worker.onerror=()=>reject(Error('本地识别进程无法启动。'));
          worker.postMessage({image:resultImage,templates,options:options()});
        });}catch(e){
          if(version!==job)return;worker?.terminate();worker=null;message('正在使用兼容模式识别…');
          answer=await OCR.recognize(resultImage,templates,{...options(),cancelled:()=>version!==job},p=>{if(version===job)progress(p);});
        }
      }else answer=await OCR.recognize(resultImage,templates,{...options(),cancelled:()=>version!==job},p=>{if(version===job)progress(p);});
      if(version!==job)return;result=answer;selected=null;renderResults();draw();
      if(!result.lines.length)message('未找到有效字形行。请检查框选范围、黑白方向或阈值。');
      else message(`识别完成，共 ${result.lines.length} 行。${result.polarity==='dark'?'深字浅底':'浅字深底'}，阈值 ${result.threshold}。请复核橙色项目及分割边界。`);
    }catch(e){if(version===job){message('识别失败：'+e.message);clearResult();}}
    finally{if(version===job){worker?.terminate();worker=null;setBusy(false);}}
  }
  $('ocr-run').addEventListener('click',recognize);
  $('ocr-cancel').addEventListener('click',()=>{loading++;cancel();message('已取消。可以调整框选后重新识别。');});
  function renderResults(){
    if(!result)return;
    const map=mapping(),list=$('ocr-tokens'),scroll=list.scrollTop;list.replaceChildren();let unknown=0,unmapped=0,total=0;
    result.lines.forEach((line,li)=>{
      const row=document.createElement('div');row.className='ocr-token-line';const title=document.createElement('span');title.className='ocr-row-label';title.textContent=`第 ${li+1} 行`;row.append(title);
      line.tokens.forEach((token,ti)=>{
        total++;const accepted=token.id&&(token.manual||token.certain),reading=OCR.tokenReading(token,map);if(!accepted)unknown++;else if(!map[token.id])unmapped++;
        const b=document.createElement('button');b.type='button';b.className='ocr-token';b.classList.toggle('uncertain',!accepted);b.classList.toggle('unmapped',!!accepted&&!map[token.id]);b.setAttribute('aria-pressed',String(selected?.line===li&&selected?.token===ti));
        const top=document.createElement('span');top.textContent=`${ti+1} · ${token.id?label(token.id):'未知'}`;
        if(token.id)b.append(imageElement(token.id));
        const text=document.createElement('strong');text.textContent=reading;b.append(top,text);
        b.title=`第${li+1}行第${ti+1}项 · ${token.manual?'已人工确认':accepted?'自动匹配，仍建议复核':'待确认'} · 点击核对原图`;
        b.addEventListener('click',()=>select(li,ti));row.append(b);
      });list.append(row);
    });
    $('ocr-results').hidden=!total;$('ocr-inspection').hidden=!total;$('ocr-summary').textContent=`${total} 个分割项 · ${unknown} 个待确认 · ${unmapped} 个未映射。相似度仅为图形评分，不是正确率。`;
    $('ocr-output').value=OCR.transcribe(result,map,outputOptions());
    refreshFormatted();
    list.scrollTop=scroll;
    if(selected)renderReview();
  }
  function select(line,token){endRebox();selected={line,token};renderResults();draw();}
  function active(){return selected&&result?.lines[selected.line]?.tokens[selected.token];}
  function renderReview(){
    const token=active();if(!token)return;$('ocr-review').hidden=false;
    $('ocr-review-title').textContent=`复核第 ${selected.line+1} 行 · 第 ${selected.token+1} 项`;
    const b=token.box,canvas=$('ocr-piece');canvas.width=b.width;canvas.height=b.height;
    const tmp=document.createElement('canvas');tmp.width=resultImage.width;tmp.height=resultImage.height;tmp.getContext('2d').putImageData(resultImage,0,0);
    canvas.getContext('2d').drawImage(tmp,b.x,b.y,b.width,b.height,0,0,b.width,b.height);
    const pieceContext=canvas.getContext('2d');pieceContext.fillStyle=result.polarity==='light'?'#232323':'#f4f4f4';
    for(const excluded of token.excludedBoxes||[])pieceContext.fillRect(excluded.x-b.x,excluded.y-b.y,excluded.width,excluded.height);
    $('ocr-piece-caption').textContent=token.excludedBoxes?.length?'原图裁片（隐去已分配给其他框的区域）':'原图裁片';
    const list=$('ocr-candidates');list.replaceChildren();const map=mapping();
    for(const candidate of token.candidates){
      const button=document.createElement('button');button.type='button';button.className='ocr-candidate';button.append(imageElement(candidate.id));
      const caption=document.createElement('span');caption.textContent=`${label(candidate.id)} · ${map[candidate.id]||'未映射'} · ${Math.round(candidate.score*100)} 分`;button.append(caption);
      button.addEventListener('click',()=>{$('ocr-choice').value=candidate.id;showChoice();});list.append(button);
    }
    $('ocr-choice').replaceChildren();
    for(const id of ids){const option=document.createElement('option');option.value=id;option.textContent=`${label(id)} · ${map[id]||'未映射'}`;$('ocr-choice').append(option);}
    $('ocr-choice').value=token.id||ids[0];showChoice();
    $('ocr-merge').disabled=selected.token>=result.lines[selected.line].tokens.length-1;
  }
  function showChoice(){const id=$('ocr-choice').value;$('ocr-choice-image').src=glyphs[id].src;$('ocr-choice-image').alt=label(id);}
  $('ocr-choice').addEventListener('change',showChoice);
  $('ocr-confirm').addEventListener('click',()=>{const t=active();if(!t)return;endRebox();t.id=$('ocr-choice').value;t.manual=true;t.certain=false;renderResults();draw();});
  $('ocr-unknown').addEventListener('click',()=>{const t=active();if(!t)return;endRebox();t.manual=false;t.certain=false;renderResults();draw();});
  $('ocr-edit-map').addEventListener('click',()=>{endRebox();if(active())editMapping($('ocr-choice').value);});
  function imageMask(excludedBoxes=[]){return BabelianOCRCorrection.exclude(OCR.binarize(resultImage,{threshold:result.threshold,polarity:result.polarity}),excludedBoxes);}
  function classify(box,excludedBoxes=BabelianOCRCorrection.exclusionsFor([active()])){
    const mask=imageMask(excludedBoxes);
    const tight=OCR.bounds(mask,box.x,box.y,box.x+box.width,box.y+box.height)||box;
    const candidates=OCR.matchDescriptor(OCR.describe(mask,tight),prepared);
    return {box:tight,candidates,id:candidates[0]?.id||null,score:candidates[0]?.score||0,certain:false,manual:false,excludedBoxes};
  }
  $('ocr-split').addEventListener('click',()=>{
    const t=active();if(!t||t.box.width<4)return;
    endRebox();
    const fraction=Number($('ocr-split-at').value);if(!Number.isFinite(fraction)||fraction<10||fraction>90){message('拆分位置应在10%至90%之间。');return;}
    const b=t.box,cut=Math.max(1,Math.min(b.width-1,Math.round(b.width*Number($('ocr-split-at').value)/100)));
    const parts=[classify({...b,width:cut}),classify({...b,x:b.x+cut,width:b.width-cut})];
    result.lines[selected.line].tokens.splice(selected.token,1,...parts);renderResults();draw();message('已拆成两个分割项，请分别确认候选。');
  });
  $('ocr-merge').addEventListener('click',()=>{
    const a=active(),list=result?.lines[selected?.line]?.tokens,b=list?.[selected.token+1];if(!a||!b)return;
    endRebox();
    const x=Math.min(a.box.x,b.box.x),y=Math.min(a.box.y,b.box.y),right=Math.max(a.box.x+a.box.width,b.box.x+b.box.width),bottom=Math.max(a.box.y+a.box.height,b.box.y+b.box.height);
    list.splice(selected.token,2,classify({x,y,width:right-x,height:bottom-y},BabelianOCRCorrection.exclusionsFor([a,b])));renderResults();draw();message('已合并，请确认新候选。');
  });
  $('ocr-join').addEventListener('change',renderResults);
  function formattingInput(){
    const map=mapping();
    // Word readings and optional game names only affect spacing suggestions,
    // never template recognition or the raw transcription.
    const extraWords=[...Object.values(map).flatMap(value=>value.match(/[A-Za-z]{2,40}/g)||[]),...($('ocr-extra-words').value.match(/[A-Za-z]{2,40}/g)||[])].slice(0,250);
    return {payload:OCR.toWriter(result,map,{joinLines:false}),options:{punctuate:$('ocr-punctuate').checked,extraWords}};
  }
  function renderFormattedState(state){
    if(!state)return;
    if($('ocr-formatted').value!==state.value)$('ocr-formatted').value=state.value;
    $('ocr-formatted-copy').disabled=!!state.error;$('ocr-formatted-append').disabled=!!state.error;
    $('ocr-format-status').textContent=state.error||(
      state.dirty?'已手动调整空格或标点；原文字母与大小写保持不变。':
      '自动整理建议。'+(state.meta.punctuationCount?` ${state.meta.punctuationCount} 处标点/句界由规则推测，不代表故事书原标点。`:' 本次仅补分词空格，未添加标点。')+
      (state.meta.unknown.length?` ${state.meta.unknown.length} 个片段未在词表中找到，请复核或补充词语。`:''));
    syncTranslation();
  }
  function refreshFormatted(force=false){
    $('ocr-formatted-block').hidden=!$('ocr-format-enabled').checked;
    if(!result||!$('ocr-format-enabled').checked){translation.invalidate('整理文本已关闭，请重新开启后翻译。');return;}
    try{
      const {payload,options}=formattingInput();
      renderFormattedState(force?formattedDraft.generate(payload,options):formattedDraft.update(payload,options));
    }catch(e){$('ocr-format-status').textContent='自动整理失败：'+e.message;$('ocr-formatted-copy').disabled=true;$('ocr-formatted-append').disabled=true;translation.invalidate('请先解决英文整理错误。');$('ocr-translate-run').disabled=true;}
  }
  $('ocr-format-enabled').addEventListener('change',()=>refreshFormatted());
  $('ocr-punctuate').addEventListener('change',()=>refreshFormatted());
  $('ocr-extra-words').addEventListener('change',()=>refreshFormatted());
  $('ocr-format-run').addEventListener('click',()=>{
    if(formattedDraft.state()?.dirty&&!confirm('重新生成会替换手动调整的空格和标点，继续吗？'))return;
    refreshFormatted(true);
  });
  $('ocr-formatted').addEventListener('input',()=>renderFormattedState(formattedDraft.edit($('ocr-formatted').value)));
  $('ocr-formatted-copy').addEventListener('click',async()=>{
    try{
      const payload=formattedDraft.payload();
      try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(payload.text);notify('已复制自动整理建议。');}
      catch(_){$('ocr-formatted').focus();$('ocr-formatted').select();notify(document.execCommand('copy')?'已复制整理文本。':'请全选并复制整理文本。');}
    }catch(e){notify(e.message);}
  });
  $('ocr-formatted-append').addEventListener('click',()=>{try{append(formattedDraft.payload());}catch(e){notify(e.message);}});
  function renderTranslation(state){
    const draft=formattedDraft.state(),running=state.status==='busy';
    $('ocr-translate-run').disabled=running||!$('ocr-translate-consent').checked||!draft||!!draft.error||!draft.value.trim();
    $('ocr-translate-cancel').hidden=!running;$('ocr-translate-copy').disabled=state.status!=='done';
    $('ocr-translation').value=state.value;$('ocr-translate-source').value=state.source;
    $('ocr-translate-source-details').hidden=!state.source;
    $('ocr-translate-status').textContent=running?(state.progress?`正在翻译：${state.progress.done} / ${state.progress.total} 段…`:'正在发送当前整理后的英文…'):
      state.status==='done'?'翻译完成，采用本次点击时的英文（含手动断句和标点）。机翻仅供参考；[?] 和 [未映射] 保留。':state.error||'尚未翻译。先调整上方英文，再点击翻译。';
  }
  function syncTranslation(){
    const draft=formattedDraft.state();translation.sync($('ocr-formatted').value,!!draft&&!draft.error);renderTranslation(translation.state());
  }
  function setTranslationOpen(open){
    $('ocr-translate-panel').hidden=!open;$('ocr-translate-toggle').setAttribute('aria-expanded',String(open));
    $('ocr-translate-toggle').textContent=open?'收起中文机翻':'中文机翻';
    if(!open&&translation.state().status==='busy')translation.cancel();
  }
  $('ocr-translate-toggle').addEventListener('click',()=>setTranslationOpen($('ocr-translate-panel').hidden));
  $('ocr-translate-consent').addEventListener('change',()=>{if(!$('ocr-translate-consent').checked)translation.cancel();renderTranslation(translation.state());});
  $('ocr-translate-run').addEventListener('click',async()=>{
    if(!$('ocr-translate-consent').checked)return;
    try{
      // Read the live edited field, validate it, and never regenerate suggestions.
      if(formattedDraft.state()?.value!==$('ocr-formatted').value)formattedDraft.edit($('ocr-formatted').value);
      const text=formattedDraft.payload().text;
      BabelianTranslation.chunks(text);await translation.run(text);
    }catch(error){$('ocr-translate-status').textContent=error.message;}
  });
  $('ocr-translate-cancel').addEventListener('click',()=>translation.cancel());
  $('ocr-translate-copy').addEventListener('click',async()=>{
    syncTranslation();if(translation.state().status!=='done')return;
    const field=$('ocr-translation');
    try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(field.value);notify('已复制中文译文。');}
    catch(_){field.focus();field.select();notify(document.execCommand('copy')?'已复制中文译文。':'请全选并复制中文译文。');}
  });
  $('ocr-copy').addEventListener('click',async()=>{
    const field=$('ocr-output');try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(field.value);notify('已复制识别英文，含未确认占位符。');}
    catch(_){field.focus();field.select();notify(document.execCommand('copy')?'已复制识别英文。':'请在结果框中全选并复制。');}
  });
  $('ocr-append').addEventListener('click',()=>{if(result)append(OCR.toWriter(result,mapping(),outputOptions()));});
  $('ocr-forget').addEventListener('click',()=>{
    if(result&&!confirm('清除本次截图与识别结果？映射及书写区保持不变。'))return;
    loading++;cancel();source=null;crop=null;clearResult();preview.width=1;preview.height=1;$('ocr-image-area').hidden=true;$('ocr-run').disabled=true;$('ocr-file-info').textContent='尚未选择图片';message('截图已从本页面清除。');
  });
  window.addEventListener('babelian-mapping-change',renderResults);
  window.addEventListener('resize',draw);
  return {refresh:()=>{renderResults();draw();}};
}};
