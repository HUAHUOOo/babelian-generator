  // Glyph identities stay fixed. Profiles change their readings, not their shapes.
  const GLYPH_IDS=Object.keys(GLYPHS);
  const DEFAULT_MAP=Object.fromEntries(GLYPH_IDS.map(key=>[key,'']));
  // Only used to identify the old automatically filled default during migration.
  const LEGACY_MAP=Object.fromEntries(GLYPH_IDS.map(key=>[key,SPECIALS[key] ?? key]));
  const MAPPING_STORE='ato-babelian-mapping-profiles-v2';
  const LEGACY_STORE='ato-babelian-mapping-profiles-v1';
  let workingMap={...DEFAULT_MAP}, baselineMap={...DEFAULT_MAP}, baseName='空白配置';
  let profileSlots=Array(5).fill(null), chosenSlot=0;
  let componentCounts=[0,3,1,0,0,0], showAllGlyphs=false, chosenGlyph='S';
  let storageAvailable=true;

  function validReading(value) {
    return typeof value==='string' && value.length<=40 && !/[\u0000-\u001f\u007f]/.test(value);
  }
  function checkedMapping(value) {
    if (!value || typeof value!=='object' || GLYPH_IDS.some(key=>!Object.hasOwn(value,key) || !validReading(value[key]))) throw new Error('配置需要包含58个字形的对应文本；未设置项使用空字符串。');
    return Object.fromEntries(GLYPH_IDS.map(key=>[key,value[key].trim()]));
  }
  function mappingsEqual(a,b) {return Object.keys(DEFAULT_MAP).every(key=>a[key]===b[key]);}
  function persistMappings() {
    try {
      STORAGE.setItem(MAPPING_STORE,JSON.stringify({version:2,workingMap,baselineMap,baseName,profileSlots,chosenSlot}));
      storageAvailable=true;
    } catch (_) {storageAvailable=false;}
  }
  function reading(glyph) {return workingMap[glyph] ?? '';}
  function glyphLabel(glyph) {return '字形 G'+String(GLYPH_IDS.indexOf(glyph)+1).padStart(2,'0');}
  function duplicatesFor(value,glyph=null) {return value ? GLYPH_IDS.filter(key=>key!==glyph && workingMap[key]===value) : [];}
  function conflictGroups(mapping=workingMap) {
    const groups=new Map();
    for(const glyph of GLYPH_IDS){const value=mapping[glyph];if(value){if(!groups.has(value))groups.set(value,[]);groups.get(value).push(glyph);}}
    return [...groups].filter(([,glyphs])=>glyphs.length>1);
  }
  function resolveReading(letter) {
    // Legacy profiles are preserved, but ambiguous readings are never guessed.
    const matches=duplicatesFor(letter);
    return matches.length===1 ? matches[0] : null;
  }
  function updateMappingBadge() {
    const dirty=!mappingsEqual(workingMap,baselineMap);
    $('active-map-label').textContent='当前映射：'+baseName+(dirty?' · 已修改，待存入栏位':'');
    const conflicts=conflictGroups();
    $('mapping-warning').hidden=!conflicts.length;
    $('mapping-warning-text').textContent='此配置有 '+conflicts.length+' 组重复对应。原数据已保留，冲突按键暂停使用，请选择一个字形修改。';
  }
  function fullGlyphSequence() {
    const spans=new Map(specialSpans.map(span=>[span.start,span]));
    const sequence=[];
    for(let pos=0;pos<currentText.length;) {
      const span=spans.get(pos);
      if(span){sequence.push({glyph:span.glyph,text:currentText.slice(span.start,span.end)});pos=span.end;}
      else {
        const text=currentText[pos++];
        sequence.push({glyph:/^[A-Za-z]$/.test(text)?resolveReading(text):null,text});
      }
    }
    return sequence;
  }
  function useMapping(next,{name=baseName,baseline=baselineMap}={}) {
    next=checkedMapping(next);
    const sequence=fullGlyphSequence();
    pushHistory();
    workingMap={...next};baseName=name;baselineMap={...baseline};
    let text='';const spans=[];
    for(const token of sequence) {
      if(!token.glyph){text+=token.text;continue;}
      // Keep the glyph even when its reading is cleared, including across reloads.
      const value=reading(token.glyph)||'?';
      const start=text.length;text+=value;
      spans.push({start,end:text.length,glyph:token.glyph,text:value});
    }
    // A custom word may be longer than its former one-letter reading.
    if(text.length>MAX_LENGTH){
      const old=history.pop();
      workingMap={...old.mappingState.workingMap};baselineMap={...old.mappingState.baselineMap};baseName=old.mappingState.baseName;
      notify('新对应文本会超出6000字符，请先缩短书写内容。');return false;
    }
    applyText(text,text.length,text.length,false,spans);
    makeKeyboard();renderFinder();updateMappingBadge();persistMappings();
    $('profile-status').textContent='当前使用：'+baseName+(!mappingsEqual(workingMap,baselineMap)?'，包含尚未存入栏位的修改。':'。');
    return true;
  }
  function candidateList() {
    if(showAllGlyphs)return Object.keys(GLYPHS);
    return Object.keys(GLYPHS).filter(key=>PARTS.counts[key]?.every((n,i)=>n===componentCounts[i]));
  }
  function showConflict() {
    const field=$('mapping-value'),value=field.value.trim();
    const duplicates=duplicatesFor(value,chosenGlyph);
    $('mapping-conflict').textContent=duplicates.length ?
      '“'+value+'”已分配给 '+duplicates.map(glyphLabel).join('、')+'。应用时将显示冲突字形，供你选择重新编辑。' :
      (chosenGlyph==='!/?'?'此斜楔是独立符号，不计入下面六类部件；可从全部字形中直接选择。':'留空可取消对应。未设置的字形插入后，英文暂用 ? 占位。');
  }
  function openConflict(glyph,value,others,pending=true) {
    const dialog=$('conflict-dialog'),root=$('conflict-options');root.replaceChildren();
    $('conflict-description').textContent=pending ?
      '“'+value+'”已有对应字形，本次修改尚未保存。请选择要重新编辑的一个字形；另一字形不会被覆盖。' :
      '“'+value+'”对应了多个字形。请选择其中一个重新编辑，直到每个对应只属于一个字形。';
    for(const [index,key] of [glyph,...others].entries()){
      const button=document.createElement('button');button.type='button';button.className='conflict-option';button.dataset.glyph=key;
      const img=imageFor(key,'');img.alt=glyphLabel(key);
      const caption=document.createElement('small');
      caption.textContent=glyphLabel(key)+' · 当前：'+(workingMap[key]||'未设置')+(index===0&&pending?' → 拟设为：'+value:'');
      const action=document.createElement('strong');action.textContent=index===0&&pending?'修改正在设置的字形':'修改已占用的字形';
      button.append(img,caption,action);
      button.addEventListener('click',()=>{
        dialog.close();switchTool('mapping');selectGlyph(key);
        if(index===0 && pending)$('mapping-value').value=value;
        showConflict();$('mapping-value').focus();$('mapping-value').select();
        $('mapping-conflict').textContent=index===0&&pending ? '请修改此字形的对应后重新应用，另一字形保持不变。' :
          '请修改或清除此字形的对应。'+(pending?'完成后可回到 '+glyphLabel(glyph)+' 设置“'+value+'”。':'');
      });
      root.append(button);
    }
    if(!dialog.open)dialog.showModal();
  }
  function openExistingConflict() {
    const first=conflictGroups()[0];
    if(first){const [value,glyphs]=first;openConflict(glyphs[0],value,glyphs.slice(1),false);return true;}
    return false;
  }
  function renderCatalog() {
    const root=$('glyph-catalog');root.replaceChildren();
    for(const glyph of Object.keys(GLYPHS)) {
      const button=document.createElement('button');button.type='button';button.className='catalog-key';button.dataset.glyph=glyph;
      button.setAttribute('aria-pressed',String(glyph===chosenGlyph));button.title=glyphLabel(glyph)+' → '+(workingMap[glyph]||'未设置');
      const img=imageFor(glyph,'');img.alt='';
      const label=document.createElement('span');label.textContent=workingMap[glyph]||'未设置';
      button.append(img,label);button.addEventListener('click',()=>selectGlyph(glyph));root.append(button);
    }
  }
  function renderFinder() {
    const matches=candidateList();
    if(!matches.includes(chosenGlyph))chosenGlyph=matches[0]??null;
    const valid=!!chosenGlyph;
    $('candidate-image').hidden=!valid;
    $('candidate-prev').disabled=matches.length<2;$('candidate-next').disabled=matches.length<2;
    $('mapping-value').disabled=!valid;
    for(const id of ['mapping-apply','mapping-insert','mapping-reset'])$(id).disabled=!valid;
    if(valid){
      $('candidate-image').src=GLYPHS[chosenGlyph].src;
      $('candidate-image').alt='候选'+glyphLabel(chosenGlyph);
      $('candidate-id').textContent=glyphLabel(chosenGlyph);
      $('candidate-meaning').textContent=workingMap[chosenGlyph]||'未设置';
      $('mapping-value').value=workingMap[chosenGlyph];
      $('mapping-reset').disabled=!workingMap[chosenGlyph];
    }else{
      $('candidate-id').textContent='没有符合全部数量条件的字形';
      $('candidate-meaning').textContent='—';$('mapping-value').value='';
    }
    $('candidate-position').textContent=valid?(matches.indexOf(chosenGlyph)+1)+' / '+matches.length+' 个候选':'0 个候选';
    $('filter-all').textContent=showAllGlyphs?'返回数量筛选':'浏览全部字形';
    PARTS.components.forEach((part,i)=>{$('part-'+part.id).value=componentCounts[i];});
    renderCatalog();showConflict();
  }
  function selectGlyph(glyph) {
    chosenGlyph=glyph;
    const counts=PARTS.counts[glyph];
    if(counts){componentCounts=[...counts];showAllGlyphs=false;}else showAllGlyphs=true;
    renderFinder();
  }
  function buildPartControls() {
    // Native image resolution must not determine the CSS size of the controls.
    const partScale=60/Math.max(...PARTS.components.map(part=>Math.max(part.width,part.height)));
    for(const [i,part] of PARTS.components.entries()) {
      const root=document.createElement('div');root.className='part-control';
      const img=document.createElement('img');img.src=part.src;img.alt=part.label;
      img.width=part.width;img.height=part.height;
      img.style.width=(part.width*partScale)+'px';img.style.height=(part.height*partScale)+'px';
      const symbolBox=document.createElement('div');symbolBox.className='part-symbol-box';symbolBox.append(img);
      const label=document.createElement('label');label.className='part-label';label.htmlFor='part-'+part.id;label.textContent=part.label;
      const stepper=document.createElement('div');stepper.className='part-stepper';
      const minus=document.createElement('button');minus.type='button';minus.textContent='−';minus.setAttribute('aria-label',part.label+'减少1');
      const field=document.createElement('input');field.id='part-'+part.id;field.type='number';field.min='0';field.max='9';field.step='1';field.inputMode='numeric';field.value=componentCounts[i];
      const plus=document.createElement('button');plus.type='button';plus.textContent='+';plus.setAttribute('aria-label',part.label+'增加1');
      const change=value=>{componentCounts[i]=Math.max(0,Math.min(9,Number.isFinite(value)?Math.floor(value):0));showAllGlyphs=false;renderFinder();};
      minus.addEventListener('click',()=>change(componentCounts[i]-1));plus.addEventListener('click',()=>change(componentCounts[i]+1));field.addEventListener('input',()=>change(field.valueAsNumber));
      stepper.append(minus,field,plus);root.append(symbolBox,label,stepper);$('part-controls').append(root);
    }
  }
  function renderProfiles(updateName=false) {
    const root=$('profile-slots');root.replaceChildren();
    profileSlots.forEach((slot,i)=>{
      const button=document.createElement('button');button.className='profile-slot';button.type='button';button.dataset.slot=i;
      button.setAttribute('aria-pressed',String(i===chosenSlot));
      const name=document.createElement('strong');name.textContent=(i+1)+' · '+(slot?.name??'空栏位');
      const detail=document.createElement('small');detail.textContent=slot ? GLYPH_IDS.filter(k=>slot.mapping[k]).length+' 个已设置对应'+(conflictGroups(slot.mapping).length?' · 有冲突':'') : '可保存一套映射';
      button.append(name,detail);button.addEventListener('click',()=>{chosenSlot=i;renderProfiles(true);persistMappings();});root.append(button);
    });
    if(updateName)$('profile-name').value=profileSlots[chosenSlot]?.name??'配置 '+(chosenSlot+1);
    $('profile-load').disabled=!profileSlots[chosenSlot];
  }
  function saveProfile() {
    if(openExistingConflict())return;
    const name=$('profile-name').value.trim()||'配置 '+(chosenSlot+1);
    profileSlots[chosenSlot]={name,mapping:{...workingMap},savedAt:new Date().toISOString()};
    baseName=name;baselineMap={...workingMap};persistMappings();renderProfiles(true);updateMappingBadge();
    $('profile-status').textContent=storageAvailable?'已写入栏位 '+(chosenSlot+1)+'：'+name+(runtime.integrated?'。ATO 同步结果以上方状态为准。':'。刷新后仍可载入。'):'保存未成功，请导出配置文件备份。';
    notify(storageAvailable?(runtime.integrated?'栏位已更新，等待 ATO 同步。':'配置已保存。'):'请导出配置文件备份。');
  }
  function switchTool(tool) {
    for(const name of ['write','mapping']) {
      $('tab-'+name).setAttribute('aria-selected',String(name===tool));
      $('panel-'+name).hidden=name!==tool;
    }
    if(tool==='mapping')renderFinder();
  }
  $('tab-write').addEventListener('click',()=>switchTool('write'));
  $('tab-mapping').addEventListener('click',()=>switchTool('mapping'));
  $('candidate-prev').addEventListener('click',()=>{const list=candidateList();chosenGlyph=list[(list.indexOf(chosenGlyph)-1+list.length)%list.length];renderFinder();});
  $('candidate-next').addEventListener('click',()=>{const list=candidateList();chosenGlyph=list[(list.indexOf(chosenGlyph)+1)%list.length];renderFinder();});
  $('filter-reset').addEventListener('click',()=>{componentCounts=[0,0,0,0,0,0];showAllGlyphs=false;renderFinder();});
  $('filter-all').addEventListener('click',()=>{showAllGlyphs=!showAllGlyphs;renderFinder();});
  $('mapping-value').addEventListener('input',showConflict);
  $('conflict-cancel').addEventListener('click',()=>$('conflict-dialog').close());
  $('resolve-conflicts').addEventListener('click',openExistingConflict);
  $('mapping-apply').addEventListener('click',()=>{
    const value=$('mapping-value').value.trim();
    if(!chosenGlyph || !validReading(value)){notify('请使用不超过40个字符的字母、词语或符号。');return;}
    const duplicates=duplicatesFor(value,chosenGlyph);
    if(duplicates.length){openConflict(chosenGlyph,value,duplicates);return;}
    if(useMapping({...workingMap,[chosenGlyph]:value}))notify(value?'已应用到此字形，可存入配置栏位。':'此字形的对应已清除。');
  });
  $('mapping-reset').addEventListener('click',()=>{if(chosenGlyph && useMapping({...workingMap,[chosenGlyph]:''}))notify('此字形的对应已清除，已输入字形保留。');});
  $('mapping-insert').addEventListener('click',()=>{if(chosenGlyph){insert(workingMap[chosenGlyph]||'?',chosenGlyph);notify(workingMap[chosenGlyph]?'已插入所选字形。':'已插入未设置字形，英文暂用 ? 占位。');}});
  $('profile-save').addEventListener('click',saveProfile);
  $('profile-load').addEventListener('click',()=>{
    const slot=profileSlots[chosenSlot];
    if(slot && useMapping(slot.mapping,{name:slot.name,baseline:slot.mapping})){$('profile-status').textContent='已载入 '+slot.name+'；现有巴别语字形保留，英文按此配置更新。';notify('已载入 '+slot.name+'。');openExistingConflict();}
  });
  $('profile-default').addEventListener('click',()=>{if(useMapping(DEFAULT_MAP,{name:'空白配置',baseline:DEFAULT_MAP}))notify('已新建空白配置。已保存栏位不受影响。');});
  $('profile-export').addEventListener('click',async()=>{
    const name=$('profile-name').value.trim()||baseName;
    const payload={format:'ato-babelian-mapping',version:2,name,mapping:workingMap};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
    try{await downloadBlob(blob,'巴别语映射-'+name.replace(/[\\/:*?"<>|]/g,'_')+'.json');notify('当前映射已导出。');}catch(error){notify(error.message);}
  });
  $('profile-import').addEventListener('click',()=>$('profile-file').click());
  $('profile-file').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;
    try{
      if(file.size>100000)throw new Error('配置文件过大。');
      const parsed=JSON.parse(await file.text());
      if(parsed.format!=='ato-babelian-mapping' || ![1,2].includes(parsed.version))throw new Error('不是本工具的映射配置文件。');
      const mapping=checkedMapping(parsed.mapping);
      const name=typeof parsed.name==='string'?parsed.name.trim().slice(0,30)||'导入配置':'导入配置';
      profileSlots[chosenSlot]={name,mapping,savedAt:new Date().toISOString()};
      renderProfiles(true);persistMappings();$('profile-status').textContent='已导入栏位 '+(chosenSlot+1)+'。点击“载入此配置”应用。'+(conflictGroups(mapping).length?'文件中存在重复对应，载入时将让你选择字形修改。':'');notify('配置已导入选中栏位。');
    }catch(error){notify('导入失败：'+error.message);}finally{event.target.value='';}
  });
  function loadMappingState(saved){
    workingMap={...DEFAULT_MAP};baselineMap={...DEFAULT_MAP};baseName='空白配置';profileSlots=Array(5).fill(null);chosenSlot=0;
    try{
    if(saved && [1,2].includes(saved.version)){
      workingMap=checkedMapping(saved.workingMap);baselineMap=checkedMapping(saved.baselineMap);
      baseName=typeof saved.baseName==='string'?saved.baseName.slice(0,30):'工作配置';
      chosenSlot=Number.isInteger(saved.chosenSlot)?Math.max(0,Math.min(4,saved.chosenSlot)):0;
      profileSlots=Array.from({length:5},(_,i)=>{const slot=saved.profileSlots?.[i];if(!slot)return null;try{return {name:String(slot.name).slice(0,30),mapping:checkedMapping(slot.mapping),savedAt:slot.savedAt};}catch(_){return null;}});
      // Do not erase named profiles or a customized working map. Keep v1 storage
      // untouched as a backup, even after a successful v2 migration.
      if(saved.version===1 && baseName==='原表配置' && mappingsEqual(workingMap,LEGACY_MAP)){
        // Retain the user's existing writing, including letters previously typed
        // into the textarea without an explicit glyph annotation.
        const previousSpans=new Map(specialSpans.map(span=>[span.start,span]));
        for(let pos=0;pos<currentText.length;){
          const span=previousSpans.get(pos);
          if(span){pos=span.end;continue;}
          const letter=currentText[pos];
          if(/^[A-Za-z]$/.test(letter))specialSpans.push({start:pos,end:pos+1,glyph:letter,text:letter});
          pos++;
        }
        specialSpans=validateSpans(specialSpans,currentText);
        workingMap={...DEFAULT_MAP};baselineMap={...DEFAULT_MAP};baseName='空白配置';
        $('profile-status').textContent='旧版自动预填的默认映射已改为空白；已保存的配置栏位保留。';
      }
    }
    }catch(_){}
  }
  try{loadMappingState(JSON.parse(STORAGE.getItem(MAPPING_STORE)??STORAGE.getItem(LEGACY_STORE)));}catch(_){}
  mappingApi={
    value:reading,resolve:resolveReading,
    loadWorkspace:saved=>{loadMappingState(saved);renderProfiles(true);renderFinder();updateMappingBadge();persistMappings();},
    snapshot:()=>({workingMap:{...workingMap},baselineMap:{...baselineMap},baseName}),
    restore:state=>{workingMap=checkedMapping(state.workingMap);baselineMap=checkedMapping(state.baselineMap);baseName=state.baseName;makeKeyboard();renderFinder();updateMappingBadge();persistMappings();}
  };
  buildPartControls();renderFinder();renderProfiles(true);updateMappingBadge();makeKeyboard();render();persistMappings();
