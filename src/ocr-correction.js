/* Geometry-only corrections: no language, mapping or network dependency. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BabelianOCRCorrection=api;})(globalThis,function(){
  'use strict';
  function rectangle(start,end,crop){
    if(!crop||![start.x,start.y,end.x,end.y].every(Number.isFinite))throw Error('框选坐标无效。');
    const x=Math.floor(Math.min(start.x,end.x))-crop.x,y=Math.floor(Math.min(start.y,end.y))-crop.y;
    const right=Math.ceil(Math.max(start.x,end.x))-crop.x,bottom=Math.ceil(Math.max(start.y,end.y))-crop.y;
    if(x<0||y<0||right>crop.width||bottom>crop.height)throw Error('请在原识别区域（金色框）内框选字形；区域外需要重新识别。');
    if(right-x<2||bottom-y<2)throw Error('框选范围太小，请完整框住一个字形。');
    return {x,y,width:right-x,height:bottom-y};
  }
  function overlaps(result,position,box){
    const found=[];
    result.lines.forEach((row,li)=>row.tokens.forEach((t,ti)=>{
      if(li===position.line&&ti===position.token)return;
      const b=t.box;
      const area=Math.max(0,Math.min(box.x+box.width,b.x+b.width)-Math.max(box.x,b.x))*
        Math.max(0,Math.min(box.y+box.height,b.y+b.height)-Math.max(box.y,b.y));
      if(area)found.push({line:li,token:ti,ratio:area/(b.width*b.height),rematch:li===position.line&&area*5>b.width*b.height});
    }));
    return found;
  }
  function union(boxes){
    const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
    return {x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};
  }
  const contains=(b,x,y)=>x>=b.x&&x<b.x+b.width&&y>=b.y&&y<b.y+b.height;
  const sameBox=(a,b)=>a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;
  function exclusionsFor(tokens){
    const excluded=[];
    for(const t of tokens)for(const b of t.excludedBoxes||[]){
      if(!tokens.some(owner=>sameBox(owner.box,b))&&!excluded.some(other=>sameBox(other,b)))excluded.push({...b});
    }
    return excluded;
  }
  function exclude(mask,boxes){
    if(!boxes.length)return mask;
    const copy={...mask,data:new Uint8Array(mask.data)};
    for(const b of boxes)for(let y=Math.max(0,b.y);y<Math.min(mask.height,b.y+b.height);y++){
      copy.data.fill(0,y*mask.width+Math.max(0,b.x),y*mask.width+Math.min(mask.width,b.x+b.width));
    }
    return copy;
  }
  function released(mask,old,box){
    const mid=box.x+Math.floor(box.width/2),found={left:0,right:0,leftEnd:box.x,rightStart:box.x+box.width};
    // Only actual foreground leaving the old rectangle matters, not whitespace.
    // For strokes above/below the new rectangle, use the nearer horizontal side.
    for(let y=old.y;y<old.y+old.height;y++)for(let x=old.x;x<old.x+old.width;x++){
      if(!mask.data[y*mask.width+x]||contains(box,x,y))continue;
      if(x<mid){found.left++;found.leftEnd=Math.max(found.leftEnd,x+1);}
      else{found.right++;found.rightStart=Math.min(found.rightStart,x);}
    }
    return found;
  }
  function replace(OCR,result,position,box,image,templates){
    const tokens=result?.lines[position?.line]?.tokens;
    if(!tokens?.[position.token])throw Error('当前复核项已变化，请重新选择。');
    if(![box.x,box.y,box.width,box.height].every(Number.isInteger)||box.x<0||box.y<0||box.width<2||box.height<2||box.x+box.width>image.width||box.y+box.height>image.height)throw Error('字形框超出识别区域。');
    const mask=OCR.binarize(image,{threshold:result.threshold,polarity:result.polarity});
    const tight=OCR.bounds(mask,box.x,box.y,box.x+box.width,box.y+box.height);
    if(!tight)throw Error('框内没有可识别的笔画，请重新框选。');
    const candidates=OCR.matchDescriptor(OCR.describe(mask,tight),templates);
    const token={box:{...box},candidates,id:candidates[0]?.id||null,score:candidates[0]?.score||0,certain:false,manual:false};
    const overlap=overlaps(result,position,box),affected=overlap.filter(hit=>hit.rematch);
    const freed=released(exclude(mask,exclusionsFor([tokens[position.token]])),tokens[position.token].box,box);
    if(!affected.length&&!freed.left&&!freed.right){
      tokens[position.token]=token;
      return {token,position:{...position},overlap,rematched:false};
    }
    // The user's new rectangle is a fixed glyph, never part of automatic
    // segmentation. Rebuild a contiguous local span, including the old selected
    // footprint, so its leftover strokes can join the preceding/following glyph.
    const first=Math.min(position.token,...affected.map(hit=>hit.token),freed.left?Math.max(0,position.token-1):position.token);
    const last=Math.max(position.token,...affected.map(hit=>hit.token),freed.right?Math.min(tokens.length-1,position.token+1):position.token);
    const region=union([...tokens.slice(first,last+1).map(t=>t.box),box]);
    const row=result.lines[position.line],band=union(tokens.map(t=>t.box));
    // Bound the local search by the nearest untouched glyphs. Neither their
    // rectangles nor their manual choices may be consumed by resegmentation.
    const leftEdge=Math.max(region.x,first?tokens[first-1].box.x+tokens[first-1].box.width:0);
    const rightEdge=Math.min(region.x+region.width,last+1<tokens.length?tokens[last+1].box.x:image.width);
    const y=Math.max(0,band.y),bottom=Math.min(image.height,band.y+band.height);
    const excludedBoxes=[...exclusionsFor(tokens.slice(first,last+1)),{...box}];
    const remainder=exclude(mask,excludedBoxes);
    function segment(x,right){
      if(right<=x)return [];
      const area={x,y,width:right-x,height:bottom-y};
      if(!OCR.bounds(remainder,x,y,right,bottom))return [];
      // Use the original row height, including whitespace. Tightening first
      // would let a stray fragment masquerade as a full-height glyph.
      return OCR.recognizeLine(remainder,area,templates).map(t=>({...t,certain:false,manual:false,
        excludedBoxes:excludedBoxes.filter(b=>t.box.x<b.x+b.width&&t.box.x+t.box.width>b.x&&t.box.y<b.y+b.height&&t.box.y+t.box.height>b.y)}));
    }
    const left=segment(leftEdge,Math.min(freed.leftEnd,rightEdge));
    const right=segment(Math.max(freed.rightStart,leftEdge),rightEdge);
    const replacement=[...left,token,...right];
    const newTokens=[...tokens.slice(0,first),...replacement,...tokens.slice(last+1)];
    if(result.lines.reduce((n,line)=>n+line.tokens.length,0)-(last-first+1)+replacement.length>1500)throw Error('重匹配后字形过多，请缩小框选区域。');
    // Commit only once every local match has succeeded. An error must leave all
    // existing boxes, confirmed readings and the selected index unchanged.
    row.tokens=newTokens;row.box=union(newTokens.map(t=>t.box));
    const nextPosition={line:position.line,token:first+left.length};
    return {token,position:nextPosition,overlap:overlaps(result,nextPosition,box),rematched:true,
      affected:affected.length,released:freed.left+freed.right,replaced:last-first+1,generated:replacement.length,neighborCount:left.length+right.length};
  }
  return {rectangle,overlaps,released,exclusionsFor,exclude,replace};
});
