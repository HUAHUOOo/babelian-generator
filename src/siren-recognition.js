/* Pure pixel Siren fitting. No dictionaries, language models, or hardcoded glyph regions. */
(function(root,factory){const api=factory();api.workerSource=()=> '('+factory.toString()+')()';if(typeof module==='object'&&module.exports)module.exports=api;else root.SirenRecognition=api;})(globalThis,function(){
 'use strict';
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 const normalize=a=>((a+180)%360+360)%360-180;
 const rad=a=>a*Math.PI/180;
 // A locator belongs to the outer turn at its bearing, not to a bounding
 // circle. Keep the reference spiral open: never join its two endpoints.
 function createLocatorBoundary(base,path,marginRatio=0){
  if(!path?.points?.length)throw Error('缺少大螺旋参考路径。');
  if(!Number.isFinite(marginRatio)||marginRatio<0)throw Error('无效的边界余量。');
  const points=path.points.map(([x,y])=>[x-base.width*(base.pivotX??.5),y-base.height*(base.pivotY??.5)]);
  return (pose,locator)=>{
   const size=pose.baseSize??pose.size,angle=rad(pose.baseRotation??pose.rotation??0),scale=base.width/size;
   const dx=locator.x-pose.cx,dy=locator.y-pose.cy,c=Math.cos(angle),s=Math.sin(angle);
   const x=(dx*c+dy*s)*scale,y=(-dx*s+dy*c)*scale,r=Math.hypot(x,y);
   if(!Number.isFinite(r)||!(size>0))return false;
   if(r<1e-8)return true;
   const ux=x/r,uy=y/r;let outer=-Infinity;
   for(let i=1;i<points.length;i++){
    const [ax,ay]=points[i-1],[bx,by]=points[i],vx=bx-ax,vy=by-ay,den=ux*vy-uy*vx;
    if(Math.abs(den)<1e-10){
     if(Math.abs(ax*uy-ay*ux)<1e-8)outer=Math.max(outer,ax*ux+ay*uy,bx*ux+by*uy);
     continue;
    }
    const t=(ax*uy-ay*ux)/den,hit=(ax*vy-ay*vx)/den;
    if(t>=-1e-9&&t<=1+1e-9&&hit>=0)outer=Math.max(outer,hit);
   }
   return r<=outer+base.width*marginRatio+1e-7;
  };
 }
 // Fitted centres near the outer stroke may sit just beyond its reference
 // centreline. Allow 2.5% of base width radially; all pixel evidence and
 // confidence checks still apply. Never admit a locator beyond this band.
 function createRecognitionBoundary(base,path){return createLocatorBoundary(base,path,.025);}
 function binarize(image){
  const {width,height,data}=image;if(!width||!height||!data||data.length<width*height*4)throw Error('Invalid ImageData');
  const hist=new Uint32Array(256),lum=new Uint8Array(width*height);
  for(let i=0;i<lum.length;i++){
   const alpha=data[i*4+3]/255,v=Math.round((.2126*data[i*4]+.7152*data[i*4+1]+.0722*data[i*4+2])*alpha+255*(1-alpha));lum[i]=v;hist[v]++;
  }
  // A single foreground tone can outvote every separate bin of a textured
  // background. Estimate background from the border median, not the global mode.
  const edgeHist=new Uint32Array(256),border=Math.min(3,Math.max(1,Math.floor(Math.min(width,height)/4)));let edgeCount=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x<border||y<border||x>=width-border||y>=height-border){edgeHist[lum[y*width+x]]++;edgeCount++;}
  let background=0,edgeSum=0;for(let n=0;n<256;n++){edgeSum+=edgeHist[n];if(edgeSum>=edgeCount/2){background=n;break;}}
  // Polarity follows the observed background rather than a presumed text colour.
  const light=background<128,quantile=Math.max(3,lum.length*.002);let tail=light?255:0,n=0;
  if(light){for(let v=255;v>=0;v--){n+=hist[v];if(n>=quantile){tail=v;break;}}}
  else {for(let v=0;v<256;v++){n+=hist[v];if(n>=quantile){tail=v;break;}}}
  const contrast=Math.abs(tail-background);
  const ink=new Float32Array(lum.length);
  if(contrast<25)return {width,height,ink,background,polarity:light?'light':'dark'};
  // A high peak contrast does not imply crisp strokes: resized screenshots
  // can have mostly grey letter ink beside a bright, thick base. Detect a
  // majority of intermediate foreground tones, excluding the background.
  // Keep the established linear path for sharp high-contrast screenshots.
  let foreground=0,soft=0;
  if(contrast>=220)for(let v=0;v<256;v++){
   const signal=clamp((light?v-background:background-v)/contrast,0,1);
   if(signal>.1){foreground+=hist[v];if(signal<.9)soft+=hist[v];}
  }
  const softEdges=foreground>0&&soft>foreground*.5;
  // Separate luminance populations for low-contrast photos or soft strokes,
  // keeping an antialiased edge rather than lowering recognition thresholds.
  if(contrast<220||softEdges){
   const signalHist=light?hist:Uint32Array.from(hist).reverse();let total=0;
   for(let i=0;i<256;i++)total+=signalHist[i]*i;
   let weight=0,partial=0,best=-1,low=0,high=0;
   for(let i=0;i<255;i++){
    weight+=signalHist[i];partial+=signalHist[i]*i;if(!weight||weight===lum.length)continue;
    const meanA=partial/weight,meanB=(total-partial)/(lum.length-weight),score=weight*(lum.length-weight)*(meanA-meanB)**2;
    if(score>best+Math.max(1,Math.abs(best))*1e-12){best=score;low=high=i;}
    else if(Math.abs(score-best)<=Math.max(1,Math.abs(best))*1e-12)high=i;
   }
   const threshold=(low+high+1)/2,lo=threshold*.7,range=Math.max(1,threshold*.6);
   for(let i=0;i<ink.length;i++)ink[i]=clamp(((light?lum[i]:255-lum[i])-lo)/range,0,1);
   return {width,height,ink,background,polarity:light?'light':'dark',threshold,photometric:'otsu-soft',softEdgeNormalized:softEdges};
  }
  for(let i=0;i<ink.length;i++)ink[i]=clamp((light?lum[i]-background:background-lum[i])/contrast,0,1);
  return {width,height,ink,background,polarity:light?'light':'dark'};
 }
 function sample(bitmap,x,y){
  const {width:w,height:h,ink:a}=bitmap;if(x<0||y<0||x>w-1||y>h-1)return 0;
  const ix=x|0,iy=y|0,dx=x-ix,dy=y-iy,j=iy*w+ix,xx=ix<w-1?1:0,yy=iy<h-1?w:0;
  return a[j]*(1-dx)*(1-dy)+a[j+xx]*dx*(1-dy)+a[j+yy]*(1-dx)*dy+a[j+xx+yy]*dx*dy;
 }
 function scaled(bitmap,maxSide){
  const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
  if(scale===1)return {...bitmap,scale:1};
  const w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale)),ink=new Float32Array(w*h),sx=bitmap.width/w,sy=bitmap.height/h;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const px=(x+.5)*sx-.5,py=(y+.5)*sy-.5,d=.25*sx;
   ink[y*w+x]=(sample(bitmap,px-d,py-d)+sample(bitmap,px+d,py-d)+sample(bitmap,px-d,py+d)+sample(bitmap,px+d,py+d))/4;
  }
  return {width:w,height:h,ink,scale};
 }
 function dilate(bitmap,radius=1){
  const {width:w,height:h,ink:a}=bitmap,out=new Float32Array(a.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   let v=0;for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
    if(dx*dx+dy*dy>(radius+.4)**2)continue;
    const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h)v=Math.max(v,a[yy*w+xx]);
   }out[y*w+x]=v;
  }return {width:w,height:h,ink:out};
 }
 function inkBounds(bitmap){
  let x0=bitmap.width,y0=bitmap.height,x1=-1,y1=-1,count=0;
  for(let y=0;y<bitmap.height;y++)for(let x=0;x<bitmap.width;x++)if(bitmap.ink[y*bitmap.width+x]>.45){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);count++;}
  return count?{x:x0,y:y0,width:x1-x0+1,height:y1-y0+1,count}:null;
 }
 function separatedRegions(bitmap){
  const probe=scaled(bitmap,Math.min(1600,Math.max(768,768*Math.sqrt(bitmap.width/bitmap.height)))),w=probe.width,h=probe.height;
  const seen=new Uint8Array(w*h),queue=new Uint32Array(w*h),boxes=[];
  for(let start=0;start<seen.length;start++){
   if(seen[start]||probe.ink[start]<.45)continue;
   let head=0,tail=1,x0=w,y0=h,x1=0,y1=0;queue[0]=start;seen[start]=1;
   while(head<tail){
    const i=queue[head++],x=i%w,y=(i/w)|0;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
     const xx=x+dx,yy=y+dy,j=yy*w+xx;
     if(xx<0||xx>=w||yy<0||yy>=h||seen[j]||probe.ink[j]<.45)continue;seen[j]=1;queue[tail++]=j;
    }
   }
   if(tail>=50&&x1-x0>=24&&y1-y0>=24)boxes.push({x:x0,y:y0,width:x1-x0+1,height:y1-y0+1,count:tail});
  }
  const largest=Math.max(0,...boxes.map(b=>b.count));
  return boxes.filter(b=>b.count>=largest*.02&&b.width/b.height>.30&&b.width/b.height<3.5).map(b=>{
   const pad=Math.max(b.width,b.height)*.10,x=Math.max(0,Math.floor((b.x-pad)/probe.scale)),y=Math.max(0,Math.floor((b.y-pad)/probe.scale));
   return {x,y,width:Math.min(bitmap.width-x,Math.ceil((b.x+b.width+pad)/probe.scale)-x),height:Math.min(bitmap.height-y,Math.ceil((b.y+b.height+pad)/probe.scale)-y)};
  });
 }
 function cropBitmap(bitmap,box){
  const ink=new Float32Array(box.width*box.height);
  for(let y=0;y<box.height;y++)ink.set(bitmap.ink.subarray((box.y+y)*bitmap.width+box.x,(box.y+y)*bitmap.width+box.x+box.width),y*box.width);
  return {width:box.width,height:box.height,ink};
 }
 function asset(a,withNegative=false){
  const pixels=a.data||a.pixels;let alpha=a.alpha;
  if(!alpha){if(!pixels||pixels.length<a.width*a.height*4)throw Error('Asset pixels missing');alpha=Float32Array.from({length:a.width*a.height},(_,i)=>pixels[i*4+3]/255);}
  else if(alpha.some(v=>v>1))alpha=Float32Array.from(alpha,v=>v/255);
  const out={width:a.width,height:a.height,ink:alpha,pivotX:a.pivotX??.5,pivotY:a.pivotY??.5},all=[],negative=[];
  let left=a.width,right=0,top=a.height,bottom=0;
  for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)if(alpha[y*a.width+x]>.7){all.push(y*a.width+x);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  if(withNegative)for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)if(alpha[y*a.width+x]<.1)negative.push(y*a.width+x);
  if(all.length<10)throw Error('Asset contains too little ink');
  const pointsFrom=(indices,limit)=>{const n=Math.min(limit,indices.length),p=new Float32Array(n*2);for(let i=0;i<n;i++){const q=indices[Math.floor((i+.5)*indices.length/n)];p[i*2]=(q%a.width)/a.width-out.pivotX;p[i*2+1]=Math.floor(q/a.width)/a.width-a.height/a.width*out.pivotY;}return p;};
  out.points=limit=>pointsFrom(all,limit);
  out.negativePoints=limit=>pointsFrom(negative,limit);
  return out;
 }
 function placedMask(template,fit,bitmap){
  const w=bitmap.width,h=bitmap.height,ink=new Float32Array(w*h),c=Math.cos(rad(fit.rotation)),s=Math.sin(rad(fit.rotation)),scale=template.width/fit.size;
  const reach=fit.size*.8,x0=Math.max(0,Math.floor(fit.cx-reach)),x1=Math.min(w-1,Math.ceil(fit.cx+reach)),y0=Math.max(0,Math.floor(fit.cy-reach)),y1=Math.min(h-1,Math.ceil(fit.cy+reach));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const dx=x-fit.cx,dy=y-fit.cy;ink[y*w+x]=sample(template,(dx*c+dy*s)*scale+template.width*template.pivotX,(-dx*s+dy*c)*scale+template.height*template.pivotY);}
  return {width:w,height:h,ink};
 }
 function support(bitmap,pts,fit,baseMask=null,negativePts=null){
  const c=Math.cos(rad(fit.rotation))*fit.size,s=Math.sin(rad(fit.rotation))*fit.size,w=bitmap.width,h=bitmap.height,a=bitmap.ink,b=baseMask?.ink;
  let sum=0,unique=0,un=0,visible=0;
  for(let i=0;i<pts.length;i+=2){
   const x=Math.round(fit.cx+pts[i]*c-pts[i+1]*s),y=Math.round(fit.cy+pts[i]*s+pts[i+1]*c);
   if(x<0||x>=w||y<0||y>=h)continue;
   const j=y*w+x,v=a[j];visible++;sum+=v;
   if(!b||b[j]<.25){unique+=v;un++;}
  }
  const count=pts.length/2,full=sum/count,uniqueFraction=un/count,uniqueScore=un?unique/un:0;
  let score=baseMask?(full*.25+uniqueScore*.75)*Math.min(1,uniqueFraction/.40):full,negativeInk=0;
  if(negativePts?.length&&full>.5){
   for(let i=0;i<negativePts.length;i+=2){const x=Math.round(fit.cx+negativePts[i]*c-negativePts[i+1]*s),y=Math.round(fit.cy+negativePts[i]*s+negativePts[i+1]*c);if(x>=0&&x<w&&y>=0&&y<h)negativeInk+=a[y*w+x];}
   negativeInk/=negativePts.length/2;score-=Math.max(0,negativeInk-.38)*.85;
  }
  return {score,support:full,uniqueSupport:uniqueScore,uniqueFraction,visible:visible/count,negativeInk};
 }
 function insertTop(list,entry,limit,distance,angleDistance=Infinity){
  if(list.length>=limit&&entry.score<=list[list.length-1].score)return;
  const hit=list.findIndex(v=>Math.hypot(v.cx-entry.cx,v.cy-entry.cy)<distance&&Math.abs(Math.log(v.size/entry.size))<.20&&Math.abs(normalize(v.rotation-entry.rotation))<angleDistance);
  if(hit>=0){if(list[hit].score>=entry.score)return;list.splice(hit,1);}
  list.push(entry);list.sort((a,b)=>b.score-a.score);if(list.length>limit)list.length=limit;
 }
 function create(assets){
  const baseTemplate=asset(assets.base,true),letters=Object.fromEntries(Object.entries(assets.letters).map(([k,v])=>[k,asset(v)]));
  const containsLocator=createRecognitionBoundary(assets.base,assets.path);
  const strictLocator=createLocatorBoundary(assets.base,assets.path);
  const progress=(options,stage,value)=>options?.onProgress?.({stage,progress:value});
  function refine(bitmap,template,initial,baseMask,options={}){
   const pts=template.points(options.samples||240),bearing=options.bearingBase,negativePts=options.background?template.negativePoints(96):null;
   const evaluate=f=>{
    if(bearing){f.rotation=normalize(Math.atan2(f.cy-bearing.cy,f.cx-bearing.cx)*180/Math.PI-90+(f.delta??0));}
    if(options.containsCenter&&!options.containsCenter(f))return {...f,score:-Infinity,support:0,uniqueSupport:0,uniqueFraction:0,visible:0,negativeInk:0};
    return {...f,...support(bitmap,pts,f,baseMask,negativePts)};
   };
   let best=evaluate({...initial});
   for(const step of options.steps||[4,2,1,.5]){
    const candidates=[];
    for(const dx of [-step,0,step])for(const dy of [-step,0,step])for(const ds of [-step,0,step])for(const da of [-step,0,step]){
     const f={...best,cx:best.cx+dx,cy:best.cy+dy,size:best.size+ds};if(f.size<12)continue;
     if(bearing)f.delta=clamp((best.delta??0)+da,-30,30);else f.rotation=normalize(best.rotation+da);
     if(options.minSize&&f.size<options.minSize||options.maxSize&&f.size>options.maxSize)continue;
     candidates.push(evaluate(f));
    }
    candidates.sort((a,b)=>b.score-a.score);if(candidates[0]?.score>best.score)best=candidates[0];
   }return best;
  }
  function detectGroups(bitmap,options={}){
   const bound=inkBounds(bitmap);if(!bound||bound.count<80)return [];
   // A connected strip cannot be reduced to a 192px thumbnail: each spiral
   // becomes smaller than the search floor. Use overlapping windows determined
   // by image geometry, never by a presumed number of groups or known text.
   if(!options.noSplit&&Math.max(bitmap.width,bitmap.height)>Math.min(bitmap.width,bitmap.height)*3.2){
    const horizontal=bitmap.width>bitmap.height,span=horizontal?bitmap.width:bitmap.height,minor=horizontal?bitmap.height:bitmap.width;
    const windowSize=Math.min(span,Math.ceil(minor*2.2)),stride=Math.max(1,Math.floor(windowSize*.5)),starts=[];
    for(let start=0;start<span-windowSize;start+=stride)starts.push(start);starts.push(span-windowSize);
    const found=[];
    for(let k=0;k<starts.length;k++){
     const start=starts[k],box=horizontal?{x:start,y:0,width:windowSize,height:bitmap.height}:{x:0,y:start,width:bitmap.width,height:windowSize};
     for(const g of detectGroups(cropBitmap(bitmap,box),{...options,noSplit:true})){
      const entry={...g,cx:g.cx+box.x,cy:g.cy+box.y};
      found.push(entry);
     }
     progress(options,'base-windows',(k+1)/starts.length);
    }
    const merged=[];
    for(const entry of found.sort((a,b)=>b.score-a.score))if(!merged.some(v=>Math.hypot(v.cx-entry.cx,v.cy-entry.cy)<Math.min(v.size,entry.size)*.4))merged.push(entry);
    return merged.map(v=>{const size=v.size*1.55,x=clamp(v.cx-size/2,0,bitmap.width),y=clamp(v.cy-size/2,0,bitmap.height);return {...v,bbox:{x,y,width:Math.min(size,bitmap.width-x),height:Math.min(size,bitmap.height-y)}};}).sort((a,b)=>Math.abs(a.cy-b.cy)<Math.min(a.size,b.size)*.5?a.cx-b.cx:a.cy-b.cy);
   }
   if(!options.noSplit){
    const regions=separatedRegions(bitmap);
    if(regions.length>1&&regions.length<=50){
     const found=[];
     for(let i=0;i<regions.length;i++){
      const box=regions[i],groups=detectGroups(cropBitmap(bitmap,box),{...options,noSplit:true});
      for(const g of groups){const entry={...g,cx:g.cx+box.x,cy:g.cy+box.y,bbox:{...g.bbox,x:g.bbox.x+box.x,y:g.bbox.y+box.y}};
       if(!found.some(v=>Math.hypot(v.cx-entry.cx,v.cy-entry.cy)<Math.min(v.size,entry.size)*.4))found.push(entry);
      }progress(options,'base-regions',(i+1)/regions.length);
     }
     if(found.length)return found.sort((a,b)=>Math.abs(a.cy-b.cy)<Math.min(a.size,b.size)*.5?a.cx-b.cx:a.cy-b.cy);
    }
   }
   const coarse=scaled(bitmap,options.coarseSide||192),target=dilate(coarse,1),pts=baseTemplate.points(96),negativePts=baseTemplate.negativePoints(64),b=inkBounds(coarse);
   const maxDim=Math.max(b.width,b.height),sizes=[];
   for(let sz=Math.max(22,Math.min(b.width,b.height)*.22);sz<=maxDim*1.35;sz*=1.10)sizes.push(sz);
   const best=[],step=5;
   for(let si=0;si<sizes.length;si++){
    const size=sizes[si];
    for(let rotation=-180;rotation<180;rotation+=15)for(let cy=b.y;cy<=b.y+b.height;cy+=step)for(let cx=b.x;cx<=b.x+b.width;cx+=step){
     const f={cx,cy,size,rotation},m=support(target,pts,f,null,negativePts);if(m.score>.52&&m.visible>.92)insertTop(best,{...f,...m},64,10,15);
    }
    progress(options,'base-coarse',(si+1)/sizes.length);
   }
   const medium=scaled(bitmap,384),near=dilate(medium,1),factor=medium.scale/coarse.scale,refined=[];
   for(let i=0;i<best.length;i++){
    const p=best[i],initial={cx:p.cx*factor,cy:p.cy*factor,size:p.size*factor,rotation:p.rotation};
    const first=refine(near,baseTemplate,initial,null,{samples:200,steps:[6,4,2,1],background:true});
    const exact=refine(medium,baseTemplate,first,null,{samples:480,steps:[2,1,.5],background:true});
    if(exact.score>=(options.baseThreshold??.81)&&exact.visible>.97){
     const v={...exact,cx:exact.cx/medium.scale,cy:exact.cy/medium.scale,size:exact.size/medium.scale};
     insertTop(refined,v,50,v.size*.40);
    }progress(options,'base-refine',(i+1)/Math.max(1,best.length));
   }
   const accepted=[];
   for(const v of refined){
    if(accepted.some(a=>Math.hypot(v.cx-a.cx,v.cy-a.cy)<Math.min(v.size,a.size)*.42))continue;
    const size=v.size*1.55,x=clamp(v.cx-size/2,0,bitmap.width),y=clamp(v.cy-size/2,0,bitmap.height);
    accepted.push({...v,bbox:{x,y,width:Math.min(size,bitmap.width-x),height:Math.min(size,bitmap.height-y)}});
   }
   return accepted.sort((a,b)=>Math.abs(a.cy-b.cy)<Math.min(a.size,b.size)*.5?a.cx-b.cx:a.cy-b.cy);
  }
  function fitGroup(bitmap,hint=null,options={}){
   let base=hint?.base||hint;
   if(!base?.size)base=detectGroups(bitmap,options).sort((a,b)=>b.score-a.score)[0];
   if(!base)return {base:null,items:[],diagnostics:{reason:'No supported large spiral'}};
   const image=scaled(bitmap,options.fitSide||440),coarse=scaled(bitmap,options.letterCoarseSide||240),target=dilate(coarse,1);
   const baseSmall={cx:base.cx*coarse.scale,cy:base.cy*coarse.scale,size:base.size*coarse.scale,rotation:base.rotation};
   const baseFine={cx:base.cx*image.scale,cy:base.cy*image.scale,size:base.size*image.scale,rotation:base.rotation};
   const baseSmallMask=dilate(placedMask(baseTemplate,baseSmall,coarse),1),baseFineMask=dilate(placedMask(baseTemplate,baseFine,image),1);
   const defaultSize=baseSmall.size*.38,reach=baseSmall.size*.85;
   const x0=Math.max(0,baseSmall.cx-reach),x1=Math.min(coarse.width-1,baseSmall.cx+reach),y0=Math.max(0,baseSmall.cy-reach),y1=Math.min(coarse.height-1,baseSmall.cy+reach);
   const letterNames=Object.keys(letters),proposals=[],locations=[];
   // The boundary band has its own proposal budget: extra near-edge starts
   // must not evict established interior poses before pixel refinement.
   for(let cy=y0;cy<=y1;cy+=4)for(let cx=x0;cx<=x1;cx+=4)if(containsLocator(baseSmall,{x:cx,y:cy}))locations.push({cx,cy,edge:!strictLocator(baseSmall,{x:cx,y:cy})});
   for(let li=0;li<letterNames.length;li++){
    const letter=letterNames[li],pts=letters[letter].points(64),top=[],edgeTop=[];
    for(const {cx,cy,edge} of locations){
     const bearing=Math.atan2(cy-baseSmall.cy,cx-baseSmall.cx)*180/Math.PI-90;
     for(const ratio of [.94,1,1.06])for(const delta of [-25,-10,0,10,25]){
      const f={cx,cy,size:defaultSize*ratio,rotation:normalize(bearing+delta),delta},m=support(target,pts,f,baseSmallMask);
      if(m.score>.69&&m.uniqueFraction>.35&&m.visible>.95)insertTop(edge?edgeTop:top,{...f,...m,letter},8,defaultSize*.30);
     }
    }
    proposals.push(...top,...edgeTop);progress(options,'letters-coarse',(li+1)/letterNames.length);
   }
   const factor=image.scale/coarse.scale,near=dilate(image,1),refined=[];
   for(let i=0;i<proposals.length;i++){
    const p=proposals[i],template=letters[p.letter],initial={...p,cx:p.cx*factor,cy:p.cy*factor,size:p.size*factor};
    const settings={samples:180,steps:[4,2,1],bearingBase:baseFine,minSize:baseFine.size*.33,maxSize:baseFine.size*.44};
    let final=null;
    // A coarse score can put the same spiral on the wrong angular shoulder.
    // Independent angle restarts avoid freezing that winner during refinement.
    for(const delta of [-25,-10,0,10,25]){
     const first=refine(near,template,{...initial,delta},baseFineMask,settings);
     const next=refine(image,template,first,baseFineMask,{...settings,samples:420,steps:[2,1,.5]});
     if(containsLocator(baseFine,{x:next.cx,y:next.cy})&&(!final||next.score>final.score))final=next;
    }
    if(final&&final.score>.72&&final.uniqueFraction>.35)refined.push({...final,letter:p.letter});
    progress(options,'letters-refine',(i+1)/Math.max(1,proposals.length));
   }
   refined.sort((a,b)=>b.score-a.score);
   let chosen=[];const explained=baseFineMask.ink.slice(),diagnostics={proposals:proposals.length,refined:refined.length,topScores:refined.slice(0,12).map(p=>({letter:p.letter,score:p.score,x:p.cx/image.scale,y:p.cy/image.scale}))};
   for(const p of refined){
    if(chosen.length>=6)break;
    if(chosen.some(v=>Math.hypot(v.cx-p.cx,v.cy-p.cy)<Math.min(v.size,p.size)*.28))continue;
    if(p.score<(options.letterThreshold??.86)||p.visible<.97)continue;
    const points=letters[p.letter].points(420),novel=support(image,points,p,{width:image.width,height:image.height,ink:explained});
    if(novel.uniqueFraction<.24||novel.uniqueSupport<.78)continue;
    const alternatives=refined.filter(v=>Math.hypot(v.cx-p.cx,v.cy-p.cy)<p.size*.35),distinct=[],rivals=[];
    // Every accepted location is compared against all 26 letters, including
    // classes pruned by the global coarse search; a missing runner-up is not confidence.
    for(const letter of letterNames){
     let alternate=alternatives.filter(v=>v.letter===letter).sort((a,b)=>b.score-a.score)[0]||null;
     const first=refine(near,letters[letter],{...p,letter},baseFineMask,{samples:150,steps:[4,2],bearingBase:baseFine,minSize:baseFine.size*.33,maxSize:baseFine.size*.44});
     const next=refine(image,letters[letter],first,baseFineMask,{samples:420,steps:[2,1,.5],bearingBase:baseFine,minSize:baseFine.size*.33,maxSize:baseFine.size*.44});
     // A stronger excluded rival is still evidence of ambiguity. Removing its
     // locator must not turn a near-boundary wrong letter into a confident one.
     rivals.push({...next,letter,score:Math.max(alternate?.score??0,next.score),outside:!containsLocator(baseFine,{x:next.cx,y:next.cy})});
     if(containsLocator(baseFine,{x:next.cx,y:next.cy})&&(!alternate||next.score>alternate.score))alternate={...next,letter};
     if(alternate)distinct.push(alternate);
    }
    distinct.sort((a,b)=>b.score-a.score);
    if(!distinct.length)continue;
    const winner=distinct[0],margin=distinct.length>1?winner.score-Math.max(...rivals.filter(r=>r.letter!==winner.letter).map(r=>r.score)):0;
    const item={...winner,letter:margin<(options.marginThreshold??.04)?null:winner.letter,matchedLetter:winner.letter,margin,outsideRivals:rivals.filter(r=>r.outside),candidates:distinct.slice(0,26)};
    chosen.push(item);
    const mask=placedMask(letters[winner.letter],winner,image);for(let i=0;i<explained.length;i++)explained[i]=Math.max(explained[i],mask.ink[i]);
   }
   progress(options,'letters-joint',0);
   // Return to original local pixels for joint verification. Cap memory on
   // large uploads; do not enlarge small sources or invent missing detail.
   const verification=scaled(bitmap,900),verifyFactor=verification.scale/image.scale;
   const upscale=p=>({...p,cx:p.cx*verifyFactor,cy:p.cy*verifyFactor,size:p.size*verifyFactor});
   const downscale=p=>({...p,cx:p.cx/verifyFactor,cy:p.cy/verifyFactor,size:p.size/verifyFactor});
   const larger=chosen.map(p=>({...upscale(p),candidates:p.candidates.map(upscale),outsideRivals:p.outsideRivals.map(upscale)}));
   const jointBase=upscale(baseFine);
   chosen=jointRank(verification,jointBase,larger).map(p=>({...downscale(p),candidates:p.candidates.map(downscale)}));
   base={...base,cx:jointBase.cx/verification.scale,cy:jointBase.cy/verification.scale,size:jointBase.size/verification.scale,rotation:jointBase.rotation,score:jointBase.score,support:jointBase.support,uniqueSupport:jointBase.uniqueSupport,uniqueFraction:jointBase.uniqueFraction,visible:jointBase.visible,negativeInk:jointBase.negativeInk};
   progress(options,'letters-complete',1);
   const convert=p=>({letter:p.letter,x:p.cx/image.scale,y:p.cy/image.scale,size:p.size/image.scale,rotation:p.rotation,score:p.score});
   return {base,items:chosen.map(p=>({...convert(p),method:'joint-pixel',margin:p.margin,candidates:p.candidates.map(convert),uniqueSupport:p.uniqueSupport,uniqueFraction:p.uniqueFraction})),diagnostics};
  }
  function jointRank(bitmap,base,chosen){
   // Explain the full image as a union of base + letter masks. Unlike one-way
   // ink coverage, reconstruction penalizes both missing and invented strokes.
   // Keep outside poses ONLY as uncertainty evidence, never as selectable items.
   let bm=placedMask(baseTemplate,base,bitmap).ink;const emptyPose={indices:new Uint32Array(),values:new Float32Array(),outside:true};
   const pool=chosen.map(p=>[...p.candidates,...p.outsideRivals].map(c=>{
    const mask=placedMask(letters[c.letter],c,bitmap).ink,indices=[],values=[];
    for(let i=0;i<mask.length;i++)if(mask[i]>.005){indices.push(i);values.push(mask[i]);}
    return {...c,indices:Uint32Array.from(indices),values:Float32Array.from(values)};
   }));
   const selected=pool.map(cs=>cs[0]);
   function rank(slot){
    const other=bm.slice();
    selected.forEach((p,i)=>{if(i!==slot)for(let k=0;k<p.indices.length;k++){const j=p.indices[k];other[j]=Math.max(other[j],p.values[k]);}});
    return pool[slot].map(p=>{let benefit=0;
     for(let k=0;k<p.indices.length;k++){const j=p.indices[k],before=other[j],after=Math.max(before,p.values[k]),target=bitmap.ink[j];benefit+=(target-before)**2-(target-after)**2;}
     return {...p,benefit};
    }).sort((a,b)=>b.benefit-a.benefit);
   }
   for(let pass=0;pass<3;pass++)for(let i=0;i<selected.length;i++)selected[i]=rank(i).find(p=>!p.outside)||emptyPose;

   // Bounded pixel-objective coordinate descent; labels/centres are never supplied.
   function rendered(p,other){
    const template=p.letter?letters[p.letter]:baseTemplate,indices=[],values=[],w=bitmap.width,h=bitmap.height;
    const c=Math.cos(rad(p.rotation)),s=Math.sin(rad(p.rotation)),scale=template.width/p.size,reach=p.size*.8;
    let benefit=0;
    for(let y=Math.max(0,Math.floor(p.cy-reach));y<=Math.min(h-1,Math.ceil(p.cy+reach));y++)for(let x=Math.max(0,Math.floor(p.cx-reach));x<=Math.min(w-1,Math.ceil(p.cx+reach));x++){
     const dx=x-p.cx,dy=y-p.cy,v=sample(template,(dx*c+dy*s)*scale+template.width*template.pivotX,(-dx*s+dy*c)*scale+template.height*template.pivotY);
     if(v<=.005)continue;const j=y*w+x,before=other[j],after=Math.max(before,v),target=bitmap.ink[j];
     benefit+=(target-before)**2-(target-after)**2;indices.push(j);values.push(v);
    }
    return {...p,benefit,indices:Uint32Array.from(indices),values:Float32Array.from(values)};
   }

   function polish(passes){   for(let pass=0;pass<passes;pass++)for(let slot=0;slot<selected.length;slot++){
    const other=bm.slice();selected.forEach((p,i)=>{if(i!==slot)for(let k=0;k<p.indices.length;k++){const j=p.indices[k];other[j]=Math.max(other[j],p.values[k]);}});
    const alternatives=rank(slot).slice(0,3);
    for(const initial of alternatives){
     let best=rendered(initial,other);
     for(const step of [1,.5,.25])for(let repeat=0;repeat<2;repeat++){
      let next=best;
      for(const field of ['cx','cy','size','rotation'])for(const sign of [-1,1]){
       const trial={...best,[field]:best[field]+sign*step};trial.rotation=normalize(trial.rotation);
       if(Math.abs(trial.cx-initial.cx)>3||Math.abs(trial.cy-initial.cy)>3||Math.abs(trial.size-initial.size)>3||Math.abs(normalize(trial.rotation-initial.rotation))>3)continue;
       if(trial.size<base.size*.33||trial.size>base.size*.44)continue;
       const bearing=Math.atan2(trial.cy-base.cy,trial.cx-base.cx)*180/Math.PI-90;
       if(Math.abs(normalize(trial.rotation-bearing))>30)continue;
       if(containsLocator(base,{x:trial.cx,y:trial.cy})===!!initial.outside)continue;
       const candidate=rendered(trial,other);if(candidate.benefit>next.benefit)next=candidate;
      }
      if(next===best)break;best=next;
     }
     // The existing coverage floor still applies to the refined physical pose.
     const measured=support(bitmap,letters[best.letter].points(420),best,{width:bitmap.width,height:bitmap.height,ink:bm});
     best={...best,...measured};
     const index=pool[slot].findIndex(p=>p.letter===initial.letter&&!!p.outside===!!initial.outside);if(index>=0)pool[slot][index]=best;
    }
    selected[slot]=rank(slot).find(p=>!p.outside)||emptyPose;
   }
}
   polish(2);
   // Refine the base against ink not already owned by selected letter masks.
   const others=new Float32Array(bitmap.ink.length);
   selected.forEach(p=>{for(let k=0;k<p.indices.length;k++){const j=p.indices[k];others[j]=Math.max(others[j],p.values[k]);}});
   const initialBase={...base};let fittedBase=rendered(initialBase,others);
   for(const step of [2,1,.5,.25,.125])for(let repeat=0;repeat<3;repeat++){
    let next=fittedBase;
    for(const field of ['cx','cy','size','rotation'])for(const sign of [-1,1]){
     const trial={...fittedBase,[field]:fittedBase[field]+sign*step};trial.rotation=normalize(trial.rotation);
     if(Math.abs(trial.cx-initialBase.cx)>3||Math.abs(trial.cy-initialBase.cy)>3||Math.abs(trial.size-initialBase.size)>3||Math.abs(normalize(trial.rotation-initialBase.rotation))>5)continue;
     const candidate=rendered(trial,others);if(candidate.benefit>next.benefit)next=candidate;
    }
    if(next===fittedBase)break;fittedBase=next;
   }
   Object.assign(base,{cx:fittedBase.cx,cy:fittedBase.cy,size:fittedBase.size,rotation:fittedBase.rotation},support(bitmap,baseTemplate.points(480),fittedBase,null,baseTemplate.negativePoints(96)));
   bm=placedMask(baseTemplate,base,bitmap).ink;
   // The final pixel-supported base, not the earlier approximate base, owns locators.
   for(let slot=0;slot<pool.length;slot++){
    pool[slot]=pool[slot].map(p=>({...p,outside:!containsLocator(base,{x:p.cx,y:p.cy})}));
    selected[slot]=rank(slot).find(p=>!p.outside)||emptyPose;
   }
   polish(1);
   return chosen.map((p,i)=>{
    const ranked=rank(i),allowed=ranked.filter(p=>!p.outside).filter((p,i,a)=>a.findIndex(q=>q.letter===p.letter)===i);if(!allowed.length)return null;const best=allowed[0],rivals=ranked.filter(p=>p.letter!==best.letter);
    const margin=rivals.length?(best.benefit-rivals[0].benefit)/Math.max(1,best.benefit):0;
    // Relative reconstruction separation is not a calibrated probability.
    for(const candidate of allowed.slice(0,3))Object.assign(candidate,support(bitmap,letters[candidate.letter].points(420),candidate,{width:bitmap.width,height:bitmap.height,ink:bm}));
    const letter=p.margin>=0&&best.benefit>0&&best.score>=.86&&margin>=.08?best.letter:null;
    return {...p,...best,letter,margin,candidates:allowed.slice(0,3)};
   }).filter(Boolean);
  }
  function measurePlacement(bitmap,base,item){
   const template=letters[item.letter];if(!template)return null;
   const fit={cx:item.x,cy:item.y,size:item.size,rotation:item.rotation};
   const baseMask=placedMask(baseTemplate,{cx:base.cx,cy:base.cy,size:base.baseSize??base.size,rotation:base.baseRotation??base.rotation??0},bitmap);
   // Fixed placement, no search and no relabelling: match only against the
   // untouched source crop, excluding base ink as independent letter evidence.
   const points=template.points(1800),result=support(bitmap,points,fit,baseMask);
   return {overlap:result.support,independent:result.uniqueFraction>=.15?result.uniqueSupport:null,independentFraction:result.uniqueFraction,visible:result.visible};
  }
  // Insert inside create(assets). No expected letters or language are accepted.
  // The base is fixed and results require explicit user acceptance.
  function deepRegion(bitmap,base,region,options={}){
   const finite=Number.isFinite;
   if(!bitmap||!Number.isInteger(bitmap.width)||!Number.isInteger(bitmap.height)||bitmap.width<1||bitmap.height<1||bitmap.width*bitmap.height>12000000||bitmap.ink?.length!==bitmap.width*bitmap.height)throw Error('无效的区域识别图像。');
   for(const value of bitmap.ink)if(!finite(value)||value<0||value>1)throw Error('区域识别像素必须在0至1之间。');
   const fixed={cx:base?.cx,cy:base?.cy,size:base?.baseSize??base?.size,rotation:base?.baseRotation??base?.rotation??0};
   if(!Object.values(fixed).every(finite)||fixed.size<=0)throw Error('区域识别需要有效的大螺旋定位。');
   if(!region||!['x','y','width','height'].every(k=>finite(region[k]))||region.width<=0||region.height<=0)throw Error('请选择有效的识别区域。');
   const allowedOptions=new Set(['onProgress','cancelled','maxCandidates','seedLimit']);
   if(!options||Object.keys(options).some(k=>!allowedOptions.has(k)))throw Error('不支持的区域识别选项。');
   for(const k of ['onProgress','cancelled'])if(options[k]!==undefined&&typeof options[k]!=='function')throw Error('无效的区域识别回调。');
   const limit=options.maxCandidates??12,seeds=options.seedLimit??6;
   if(!Number.isInteger(limit)||limit<1||limit>24||!Number.isInteger(seeds)||seeds<1||seeds>12)throw Error('区域识别预算超出限制。');
   const x0=clamp(region.x,0,bitmap.width),y0=clamp(region.y,0,bitmap.height),x1=clamp(region.x+region.width,0,bitmap.width),y1=clamp(region.y+region.height,0,bitmap.height);
   const roi={x:x0,y:y0,width:Math.max(0,x1-x0),height:Math.max(0,y1-y0)};
   const diagnostics={centres:0,proposals:0,refined:0,source:'pixels-only',baseFixed:true};
   const result=candidates=>({base:{...fixed},region:{...roi},requiresReview:true,candidates,diagnostics});
   const check=()=>{if(options.cancelled?.())throw Error('已取消区域深度识别。');};check();
   if(!roi.width||!roi.height)return result([]);
   // ROI bounds candidate centres, not the visible strokes. Preserve the whole glyph.
   const pad=fixed.size*.44*.85+4,box={x:Math.max(0,Math.floor(x0-pad)),y:Math.max(0,Math.floor(y0-pad))};
   box.width=Math.min(bitmap.width,Math.ceil(x1+pad))-box.x;box.height=Math.min(bitmap.height,Math.ceil(y1+pad))-box.y;
   const crop=cropBitmap(bitmap,box),image=scaled(crop,900),coarse=scaled(crop,320);
   if(!crop.ink.some(v=>finite(v)&&v>.45))return result([]);
   const local=(p,s)=>({cx:(p.cx-box.x)*s,cy:(p.cy-box.y)*s,size:p.size*s,rotation:p.rotation});
   const imageBase=local(fixed,image.scale),coarseBase=local(fixed,coarse.scale);
   const localRegion=s=>({x:(x0-box.x)*s,y:(y0-box.y)*s,width:roi.width*s,height:roi.height*s});
   const ir=localRegion(image.scale),cr=localRegion(coarse.scale);
   const inRectangle=(r,x,y)=>x>=r.x-1e-7&&y>=r.y-1e-7&&x<=r.x+r.width+1e-7&&y<=r.y+r.height+1e-7;
   const centreAllowed=(r,b,p)=>inRectangle(r,p.cx,p.cy)&&containsLocator(b,{x:p.cx,y:p.cy});
   const fineAllowed=p=>centreAllowed(ir,imageBase,p);
   const coarseMask=dilate(placedMask(baseTemplate,coarseBase,coarse),1),fineMask=dilate(placedMask(baseTemplate,imageBase,image),1);
   const baseInk=placedMask(baseTemplate,imageBase,image).ink,target=dilate(coarse,1),near=dilate(image,1);
   const step=Math.max(1.5,Math.sqrt(cr.width*cr.height/600)),centres=[];
   // Include narrow rectangles and both end points without snapping them out of ROI.
   const nx=Math.max(1,Math.ceil(cr.width/step)),ny=Math.max(1,Math.ceil(cr.height/step));
   for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++){
    const p={cx:cr.x+cr.width*x/nx,cy:cr.y+cr.height*y/ny};
    if(centreAllowed(cr,coarseBase,p))centres.push(p);
   }
   diagnostics.centres=centres.length;if(!centres.length)return result([]);
   const names=Object.keys(letters),proposals=[];
   for(let n=0;n<names.length;n++){
    check();const letter=names[n],pts=letters[letter].points(96),top=[];
    for(const p of centres){const bearing=Math.atan2(p.cy-coarseBase.cy,p.cx-coarseBase.cx)*180/Math.PI-90;
     for(const ratio of [.33,.355,.38,.405,.44])for(const delta of [-30,-20,-10,0,10,20,30]){
      const pose={...p,size:coarseBase.size*ratio,rotation:normalize(bearing+delta),delta},m=support(target,pts,pose,coarseMask);
      if(m.score>.69&&m.uniqueFraction>.35&&m.visible>.95)insertTop(top,{...pose,...m,letter},seeds,coarseBase.size*.055,15);
     }
    }
    proposals.push(...top);progress(options,'region-coarse',(n+1)/Math.max(1,names.length));
   }
   diagnostics.proposals=proposals.length;
   const factor=image.scale/coarse.scale,refined=[];
   for(let i=0;i<proposals.length;i++){
    check();const p=proposals[i],initial={...p,cx:p.cx*factor,cy:p.cy*factor,size:p.size*factor};
    const settings={samples:180,steps:[4,2,1],bearingBase:imageBase,minSize:imageBase.size*.33,maxSize:imageBase.size*.44,containsCenter:fineAllowed};
    const first=refine(near,letters[p.letter],initial,fineMask,settings);
    const next=refine(image,letters[p.letter],first,fineMask,{...settings,samples:420,steps:[2,1,.5,.25]});
    if(fineAllowed(next)&&next.score>.72&&next.uniqueFraction>.35&&next.visible>.95)refined.push({...next,letter:p.letter});
    progress(options,'region-refine',(i+1)/Math.max(1,proposals.length));
   }
   diagnostics.refined=refined.length;
   // Compare a full rendered glyph against the untouched crop, excluding base ink.
   // Additional glyphs may overlap this region: this is evidence, never auto-acceptance.
   function pixelBenefit(p){
    const template=letters[p.letter],c=Math.cos(rad(p.rotation)),s=Math.sin(rad(p.rotation)),scale=template.width/p.size,reach=p.size*.8;let benefit=0;
    for(let y=Math.max(0,Math.floor(p.cy-reach));y<=Math.min(image.height-1,Math.ceil(p.cy+reach));y++)for(let x=Math.max(0,Math.floor(p.cx-reach));x<=Math.min(image.width-1,Math.ceil(p.cx+reach));x++){
     const dx=x-p.cx,dy=y-p.cy,v=sample(template,(dx*c+dy*s)*scale+template.width*template.pivotX,(-dx*s+dy*c)*scale+template.height*template.pivotY);if(v<=.005)continue;
     const at=y*image.width+x,before=baseInk[at],after=Math.max(before,v),observed=image.ink[at];benefit+=(observed-before)**2-(observed-after)**2;
    }return benefit;
   }
   let ranked=refined.map(p=>({...p,benefit:pixelBenefit(p)})).filter(p=>p.benefit>0).sort((a,b)=>b.benefit-a.benefit);
   const distinct=[];for(const p of ranked)if(!distinct.some(q=>q.letter===p.letter&&Math.hypot(q.cx-p.cx,q.cy-p.cy)<Math.min(q.size,p.size)*.08))distinct.push(p);
   ranked=distinct.slice(0,Math.max(limit,16));
   for(let n=0;n<ranked.length;n++){
    check();const initial=ranked[n];let best=initial;
    for(const step of [1,.5,.25])for(let repeat=0;repeat<2;repeat++){
     let next=best;
     for(const field of ['cx','cy','size','rotation'])for(const sign of [-1,1]){
      const p={...best,[field]:best[field]+step*sign};p.rotation=normalize(p.rotation);
      if(Math.abs(p.cx-initial.cx)>3||Math.abs(p.cy-initial.cy)>3||Math.abs(p.size-initial.size)>3||Math.abs(normalize(p.rotation-initial.rotation))>3)continue;
      const bearing=Math.atan2(p.cy-imageBase.cy,p.cx-imageBase.cx)*180/Math.PI-90;
      if(!fineAllowed(p)||p.size<imageBase.size*.33||p.size>imageBase.size*.44||Math.abs(normalize(p.rotation-bearing))>30)continue;
      const benefit=pixelBenefit(p);if(benefit>next.benefit)next={...p,benefit};
     }
     if(next===best)break;best=next;
    }
    ranked[n]={...best,...support(image,letters[best.letter].points(420),best,{width:image.width,height:image.height,ink:baseInk})};
    progress(options,'region-verify',(n+1)/Math.max(1,ranked.length));
   }
   ranked.sort((a,b)=>b.benefit-a.benefit);
   const candidates=[];
   for(const p of ranked){
    const candidate={letter:p.letter,x:p.cx/image.scale+box.x,y:p.cy/image.scale+box.y,size:p.size/image.scale,rotation:p.rotation,score:p.score,pixelBenefit:p.benefit,uniqueSupport:p.uniqueSupport,uniqueFraction:p.uniqueFraction,visible:p.visible,passesCoverage:p.score>=.86,certain:false,requiresReview:true};
    const bearing=Math.atan2(candidate.y-fixed.cy,candidate.x-fixed.cx)*180/Math.PI-90;
    if(!inRectangle(roi,candidate.x,candidate.y)||!containsLocator(fixed,candidate)||candidate.size<fixed.size*.33-1e-7||candidate.size>fixed.size*.44+1e-7||Math.abs(normalize(candidate.rotation-bearing))>30+1e-7)continue;
    if(candidates.some(q=>q.letter===candidate.letter&&Math.hypot(q.x-candidate.x,q.y-candidate.y)<Math.min(q.size,candidate.size)*.08))continue;
    candidates.push(candidate);if(candidates.length>=limit)break;
   }
   return result(candidates);
  }
  return {binarize,detectGroups,fitGroup,measurePlacement,deepRegion};
 }
 return {create,binarize,createLocatorBoundary,createRecognitionBoundary};
});
