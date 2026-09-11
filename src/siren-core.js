/* Siren geometry only: no dictionary, semantic inference or automatic OCR. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SirenCore=api;})(globalThis,function(){
  'use strict';
  const SIZE=600,MAX_GROUPS=50,MAX_LETTERS=6,FORMAT='ato-siren-work',VERSION=6,GLYPH_RATIO=.38;
  let serial=0;
  const id=prefix=>prefix+'-'+Date.now().toString(36)+'-'+(++serial).toString(36);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const degrees=rad=>rad*180/Math.PI;
  const radians=deg=>deg*Math.PI/180;
  const normalize=angle=>((angle+180)%360+360)%360-180;
  const radius=(group,item)=>Math.hypot(item.x-group.cx,item.y-group.cy);
  const angle=(group,item)=>degrees(Math.atan2(item.y-group.cy,item.x-group.cx));
  // IMG_3491: the 420px letter frame is approximately 38% of the 700px base frame.
  const glyphSize=g=>GLYPH_RATIO*(g.baseSize??500);
  // Screen angles are clockwise. Below = original asset; above = half a turn.
  // Exactly at the center there is no bearing: use a deterministic zero, never history.
  const rotationFor=(g,item)=>item.rotationMode==='manual'?normalize(item.rotation):radius(g,item)<1e-9?0:normalize(angle(g,item)-90);
  const displayRotation=(g,item)=>item.rotationMode==='manual'?rotationFor(g,item):item.fit?.rotation??rotationFor(g,item);
  function setRotationMode(g,item,manual){if(item.positionLocked)return;const rotation=displayRotation(g,item);invalidateFit(item);item.contact=null;item.rotationMode=manual?'manual':'auto';item.rotation=manual?rotation:rotationFor(g,item);}
  const basePose=g=>({cx:g.cx,cy:g.cy,size:g.baseSize??500,rotation:g.baseRotation??0});
  function rememberPose(g,item,replace=false){
    if(!item.fit||item.rotationMode==='manual'||item.resetPose&&!replace)return;
    item.resetPose=JSON.parse(JSON.stringify({letter:item.letter,x:item.x,y:item.y,size:item.size,rotation:item.rotation,rotationMode:item.rotationMode??'auto',contact:item.contact,fit:item.fit,base:basePose(g)}));
  }
  const canReset=(g,item)=>!!item?.resetPose&&JSON.stringify(item.resetPose.base)===JSON.stringify(basePose(g));
  function resetPosition(g,item){
    if(item.positionLocked||!canReset(g,item))return false;
    const p=JSON.parse(JSON.stringify(item.resetPose));delete p.base;
    delete item.fit;delete item.contact;delete item.rotationMode;Object.assign(item,p);return true;
  }
  function orient(g,item){item.rotation=rotationFor(g,item);return item;}
  function invalidateFit(item){if(item.fit){delete item.fit;item.contact=null;}}
  function reorient(g){g.items.forEach(item=>{if(!item.positionLocked){orient(g,item);invalidateFit(item);}});}
  function resizeBase(g,size){if(g.items.some(i=>i.positionLocked))return false;const factor=size/(g.baseSize??500);g.items.forEach(item=>{item.size=clamp(item.size*factor,30,400);invalidateFit(item);});g.baseSize=size;return true;}
  function group(){return {id:id('g'),cx:300,cy:300,baseSize:500,baseRotation:0,items:[],image:null};}
  function create(mode='generate'){if(!['generate','review'].includes(mode))throw Error('未知工具模式。');return {format:FORMAT,version:VERSION,mode,groups:mode==='generate'?[group()]:[]};}
  function ordered(g,analysis){
    const metrics=new Map((analysis?.items||[]).map(m=>[m.id,m]));
    return g.items.map((item,index)=>({item,index,...metrics.get(item.id),at:metrics.get(item.id)?.at??null})).sort((a,b)=>(a.at??Infinity)-(b.at??Infinity)||a.index-b.index);
  }
  function read(doc,analyze){
    let ambiguous=false,unknown=0,unplaced=0;const unplacedGroups=[],partial=doc.mode==='review';
    const groups=doc.groups.map((g,index)=>{
      const all=ordered(g,analyze?.(g)),lost=all.filter(e=>e.at===null),missing=lost.length,ties=new Set();unplaced+=missing;
      if(missing)unplacedGroups.push({index,letters:lost.map(e=>e.item.letter||'?')});
      // Keep the relative order of located screenshot letters. Unlocated items
      // are reported separately, never appended as though their position were known.
      if(missing&&!partial){unknown+=all.length;return all.map(()=>'[?]').join('');}
      const row=partial?all.filter(e=>e.at!==null):all;if(partial)unknown+=missing;
      if(!row.length&&missing)return '[?]';
      for(let i=1;i<row.length;i++)if(row[i].at-row[i-1].at<1){ties.add(i-1);ties.add(i);ambiguous=true;}
      return row.map((entry,i)=>{if(!entry.item.letter||ties.has(i)){unknown++;return '[?]';}return entry.item.letter;}).join('');
    });
    return {text:groups.join(partial?' ':'').trim(),groups,ambiguous,unknown,unplaced,unplacedGroups};
  }
  function addGroup(doc){if(doc.groups.length>=MAX_GROUPS)throw Error('每份工作最多50组，请分段保存。');const g=group();doc.groups.push(g);return g;}
  function add(g,letter=null,point=null){
    if(g.items.length>=MAX_LETTERS)throw Error('这个大螺旋已有6个小螺旋，请新建下一组。');
    if(letter!==null&&!/^[A-Z]$/.test(letter))throw Error('请选择 A–Z 字母。');
    const n=g.items.length,r=106+n*21,deg=[30,150,270,60,180,300][n];
    const item={id:id('s'),letter,x:point?.x??g.cx+r*Math.cos(radians(deg)),y:point?.y??g.cy+r*Math.sin(radians(deg)),rotation:0,size:glyphSize(g),contact:null};
    item.x=clamp(item.x,0,SIZE);item.y=clamp(item.y,0,SIZE);orient(g,item);g.items.push(item);return item;
  }
  function move(g,item,point){
    if(item.positionLocked||!Number.isFinite(point.x)||!Number.isFinite(point.y))return false;
    rememberPose(g,item);
    item.x=clamp(point.x,0,SIZE);item.y=clamp(point.y,0,SIZE);
    orient(g,item);item.contact=null;invalidateFit(item);return true;
  }
  function polar(g,item,r,deg){
    if(!Number.isFinite(r)||!Number.isFinite(deg)||r<0||r>850)throw Error('距离应为0–850，角度应为有效数字。');
    const point={x:g.cx+r*Math.cos(radians(deg)),y:g.cy+r*Math.sin(radians(deg))};
    if(point.x< -1e-8||point.x>SIZE+1e-8||point.y< -1e-8||point.y>SIZE+1e-8)throw Error('该距离与角度会超出画布，请减小距离或调整角度。');
    return move(g,item,point);
  }
  function fromText(text){
    if(typeof text!=='string'||!/^[A-Za-z\s]*$/.test(text))throw Error('批量输入仅支持英文字母和空白；标点请在整理英文中添加。');
    const letters=text.toUpperCase().replace(/\s/g,'');
    if(letters.length>MAX_GROUPS*MAX_LETTERS)throw Error('每次最多300个字母，请分段生成。');
    const doc=create();doc.groups=[];
    for(let i=0;i<letters.length;i+=MAX_LETTERS){const g=addGroup(doc);for(const c of letters.slice(i,i+MAX_LETTERS))add(g,c);}
    if(!doc.groups.length)addGroup(doc);return doc;
  }
  function decode(value){
    if(!value||value.format!==FORMAT||![1,2,3,4,5,VERSION].includes(value.version)||!['generate','review'].includes(value.mode))throw Error('不是受支持的塞壬语工作文件。');
    const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
    function fitRecord(f){
      if(!f||!finite(f.rotation,-180,180)||!finite(f.score,0,1)||!Array.isArray(f.candidates)||f.candidates.length>3)throw Error('字形匹配记录无效。');
      if(f.method!==undefined&&f.method!=='joint-pixel')throw Error('字形匹配方式无效。');
      return {rotation:f.rotation,score:f.score,...(f.method?{method:f.method}:{}),candidates:f.candidates.map(c=>{
        if(!c||typeof c.letter!=='string'||!(/^[A-Z]$/.test(c.letter))||!finite(c.score,0,1)||!finite(c.x,0,SIZE)||!finite(c.y,0,SIZE)||!finite(c.size,30,400)||!finite(c.rotation,-180,180))throw Error('字形匹配候选无效。');
        return {letter:c.letter,score:c.score,x:c.x,y:c.y,size:c.size,rotation:c.rotation};
      })};
    }
    function resetRecord(p){
      if(!p||Object.keys(p).some(k=>!['letter','x','y','size','rotation','rotationMode','contact','fit','base'].includes(k))||!(p.letter===null||typeof p.letter==='string'&&/^[A-Z]$/.test(p.letter))||!finite(p.x,0,SIZE)||!finite(p.y,0,SIZE)||!finite(p.size,30,400)||!finite(p.rotation,-180,180)||!['auto','manual'].includes(p.rotationMode))throw Error('复位记录无效。');
      const b=p.base;if(!b||!finite(b.cx,0,SIZE)||!finite(b.cy,0,SIZE)||!finite(b.size,100,900)||!finite(b.rotation,-180,180))throw Error('复位基底无效。');
      let contact=null;if(p.contact!=null){if(!finite(p.contact.x,0,SIZE)||!finite(p.contact.y,0,SIZE))throw Error('复位交点无效。');contact={x:p.contact.x,y:p.contact.y};}
      if(p.rotationMode==='manual'&&p.fit!=null)throw Error('复位朝向与拟合记录冲突。');
      return {letter:p.letter,x:p.x,y:p.y,size:p.size,rotation:p.rotation,rotationMode:p.rotationMode,contact,fit:p.fit==null?null:fitRecord(p.fit),base:{cx:b.cx,cy:b.cy,size:b.size,rotation:b.rotation}};
    }
    if((value.version<3||value.gear!==undefined)&&!finite(value.gear,-4,4)||!Array.isArray(value.groups)||value.groups.length>MAX_GROUPS)throw Error('工作文件的组数或旋转参数无效。');
    let totalImageChars=0;
    const result=create(value.mode);
    result.groups=value.groups.map(g=>{
      if(!g||!finite(g.cx,0,SIZE)||!finite(g.cy,0,SIZE)||!Array.isArray(g.items)||g.items.length>6)throw Error('大螺旋数据无效（每组最多6项）。');
      const next=group();next.cx=g.cx;next.cy=g.cy;
      if(value.version>=2){if(!finite(g.baseSize,100,900)||!finite(g.baseRotation,-180,180))throw Error('大螺旋校准参数无效。');next.baseSize=g.baseSize;next.baseRotation=g.baseRotation;}
      if(g.image!=null){
        if(value.mode!=='review'||typeof g.image!=='string'||g.image.length>2800000||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(g.image))throw Error('截图裁片格式无效，只接受内嵌 PNG。');
        totalImageChars+=g.image.length;if(totalImageChars>7500000)throw Error('截图裁片过大，请分段保存。');next.image=g.image;
      }
      if(value.mode==='review'&&!next.image)throw Error('截图解读组缺少原图裁片。');
      next.items=g.items.map(item=>{
        if(!item||!(item.letter===null||typeof item.letter==='string'&&/^[A-Z]$/.test(item.letter))||!finite(item.x,0,SIZE)||!finite(item.y,0,SIZE)||!finite(item.rotation,-180,180)||!finite(item.size,30,value.version<3?200:400))throw Error('小螺旋数据无效。');
        let contact=null;if(value.version>=2&&item.contact!=null){if(!finite(item.contact.x,0,SIZE)||!finite(item.contact.y,0,SIZE))throw Error('交点标记无效。');contact={x:item.contact.x,y:item.contact.y};}
        // Upgrade only the legacy default size; keep deliberately customized sizes.
        const size=value.version<3&&Math.abs(item.size-110)<1e-6?glyphSize(next):item.size;
        const token=orient(next,{id:id('s'),letter:item.letter,x:item.x,y:item.y,rotation:0,size,contact});
        if(value.version>=5&&item.rotationMode!==undefined){if(!['auto','manual'].includes(item.rotationMode))throw Error('字形朝向模式无效。');token.rotationMode=item.rotationMode;if(item.rotationMode==='manual')token.rotation=normalize(item.rotation);}
        if(item.manualAdded!==undefined){if(typeof item.manualAdded!=='boolean'||value.mode!=='review')throw Error('人工新增标记无效。');token.manualAdded=item.manualAdded;}
        if(value.version>=4&&item.fit!=null){
          if(value.mode!=='review')throw Error('字形匹配记录无效。');token.fit=fitRecord(item.fit);
        }
        if(value.version>=6&&item.positionLocked!==undefined){if(typeof item.positionLocked!=='boolean')throw Error('位置锁定状态无效。');token.positionLocked=item.positionLocked;}
        if(value.version>=6&&item.resetPose!==undefined){if(value.mode!=='review')throw Error('复位记录只用于截图识别。');token.resetPose=resetRecord(item.resetPose);}
        if(token.rotationMode==='manual')delete token.fit;
        rememberPose(next,token);
        return token;
      });return next;
    });return result;
  }
  return {SIZE,MAX_GROUPS,MAX_LETTERS,FORMAT,VERSION,GLYPH_RATIO,glyphSize,rotationFor,displayRotation,setRotationMode,rememberPose,canReset,resetPosition,orient,invalidateFit,reorient,resizeBase,create,group,addGroup,add,move,polar,ordered,read,fromText,decode,radius,angle,normalize};
});
