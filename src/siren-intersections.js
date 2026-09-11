/* Ordered crossings against the original large spiral path and actual glyph ink.
   No center-distance sorting, bounding-box collisions or language inference. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./siren-core.js'):root.SirenCore);if(typeof module==='object'&&module.exports)module.exports=api;else root.SirenIntersections=api;})(globalThis,function(C){
  'use strict';
  const rad=angle=>angle*Math.PI/180;
  function prepare({base,letters,path,masks}){
    if(!path?.points?.length||!masks)throw Error('缺少螺旋路径或字形墨迹。');
    const cache=new WeakMap(),candidateCache=new Map();
    function basePoints(group){
      const size=group.baseSize??500,rotation=rad(group.baseRotation??0),c=Math.cos(rotation),s=Math.sin(rotation),scale=size/base.width;
      const pts=[];let distance=0;
      for(let i=0;i<path.points.length;i++){
        const raw=path.points[i],x=(raw[0]-base.width*base.pivotX)*scale,y=(raw[1]-base.height*base.pivotY)*scale;
        const p={x:group.cx+x*c-y*s,y:group.cy+x*s+y*c};
        if(!pts.length){pts.push({...p,at:0});continue;}
        const prev=pts.at(-1),length=Math.hypot(p.x-prev.x,p.y-prev.y),steps=Math.max(1,Math.ceil(length/.5));
        for(let j=1;j<=steps;j++)pts.push({x:prev.x+(p.x-prev.x)*j/steps,y:prev.y+(p.y-prev.y)*j/steps,at:distance+length*j/steps});
        distance+=length;
      }
      return pts;
    }
    function sampleMask(mask,x,y){
      if(x<0||y<0||x>=mask.width-1||y>=mask.height-1)return 0;
      const ix=Math.floor(x),iy=Math.floor(y),dx=x-ix,dy=y-iy,at=iy*mask.width+ix,a=mask.alpha;
      return a[at]*(1-dx)*(1-dy)+a[at+1]*dx*(1-dy)+a[at+mask.width]*(1-dx)*dy+a[at+mask.width+1]*dx*dy;
    }
    function crossings(points,item){
      const glyph=letters[item.letter],mask=masks[item.letter];if(!glyph||!mask)return [];
      const angle=rad(item.rotation),c=Math.cos(angle),s=Math.sin(angle),scale=glyph.width/item.size,half=item.size*Math.SQRT2;
      const hits=[];let run=null;
      for(const p of points){
        const dx=p.x-item.x,dy=p.y-item.y;
        const ink=Math.abs(dx)<=half&&Math.abs(dy)<=half&&sampleMask(mask,(dx*c+dy*s)*scale+glyph.width*glyph.pivotX,(-dx*s+dy*c)*scale+glyph.height*glyph.pivotY)>=128;
        if(ink){if(!run)run={first:p,last:p};else run.last=p;}
        else if(run){hits.push({x:run.first.x,y:run.first.y,at:run.first.at,end:run.last.at});run=null;}
      }
      if(run)hits.push({x:run.first.x,y:run.first.y,at:run.first.at,end:run.last.at});
      // Tiny raster gaps on the same crossing do not make multiple distinct crossings.
      const merged=[];for(const hit of hits){const last=merged.at(-1);if(last&&hit.at-last.end<1.5)last.end=hit.end;else merged.push({...hit});}return merged;
    }
    function project(points,point){
      let best=null;for(const p of points){const distance=Math.hypot(p.x-point.x,p.y-point.y);if(!best||distance<best.distance)best={...p,distance};}return best;
    }
    function analyze(group,review=false){
      const signature=JSON.stringify([group.cx,group.cy,group.baseSize,group.baseRotation,group.items,review]),old=cache.get(group);
      if(old?.signature===signature)return old.result;
      const points=basePoints(group),total=points.at(-1)?.at||1;
      const items=group.items.map(item=>{
        let hits=[],reason='';
        if(review){
          if(item.contact){const match=project(points,item.contact);if(match&&match.distance<=12)hits=[{...match,end:match.at,manual:true}];else reason='标记未落在对齐后的大螺旋路径上';}
          else if(item.fit&&(item.letter||item.fit.candidates?.[0])){hits=crossings(points,{...item,letter:item.letter||item.fit.candidates[0].letter,rotation:item.fit.rotation});if(!hits.length)reason='拟合字形没有可靠交点，请人工复核';}
          else if((item.manualAdded||item.rotationMode)&&item.letter){hits=crossings(points,{...item,rotation:C.rotationFor(group,item)});if(!hits.length)reason='人工调整字形尚未与大螺旋相交，请调整或标记交点';}
          else reason='请确认字母并标记该小螺旋的最内侧交点';
        }else {hits=crossings(points,{...item,rotation:C.rotationFor(group,item)});if(!hits.length)reason=item.letter?'未与大螺旋相交':'尚未选择字母，无法判断交点';}
        return {id:item.id,first:hits[0]||null,hits,at:hits[0]?.at??null,total,reason};
      });
      const result={items,points,total};cache.set(group,{signature,result});return result;
    }
    function candidates(letter){
      if(candidateCache.has(letter))return candidateCache.get(letter);
      const g={cx:300,cy:300,baseSize:500,baseRotation:0},points=basePoints(g),total=points.at(-1).at,list=[];
      for(let n=10;n<=94;n+=2){
        const p=points[Math.round((points.length-1)*n/100)],dx=p.x-300,dy=p.y-300,length=Math.hypot(dx,dy)||1;
        for(const offset of [0,26,52]){
          const item=C.orient(g,{letter,x:p.x+dx/length*offset,y:p.y+dy/length*offset,size:C.glyphSize(g)});
          const margin=item.size/2;
          if(item.x<margin||item.x>600-margin||item.y<margin||item.y>600-margin)continue;
          const first=crossings(points,item)[0];if(first)list.push({...item,at:first.at,total});
        }
      }
      list.sort((a,b)=>a.at-b.at);candidateCache.set(letter,list);return list;
    }
    function arrange(group){
      // Search geometry-derived placements, never relabel glyphs to force a reading.
      let previous=-1;const placements=[];group.cx=300;group.cy=300;group.baseSize=500;group.baseRotation=0;
      for(let i=0;i<group.items.length;i++){
        const item=group.items[i],list=candidates(item.letter),target=(.06+i*.125)*(list[0]?.total||1);
        const choices=list.filter(c=>c.at>previous+8).map(c=>({c,cost:Math.abs(c.at-target)+placements.reduce((sum,p)=>sum+Math.max(0,c.size*.8-Math.hypot(c.x-p.x,c.y-p.y))*2,0)})).sort((a,b)=>a.cost-b.cost);
        if(!choices.length)return false;
        const chosen=choices[0].c;Object.assign(item,{x:chosen.x,y:chosen.y,size:chosen.size,rotation:chosen.rotation,contact:null});placements.push(chosen);previous=chosen.at;
      }
      return true;
    }
    return {analyze,basePoints,crossings,project,arrange};
  }
  return {prepare};
});
