/* Compact whole-document layout. Pixel bounds come from clipped, transparent group tiles. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SirenStrip=api;})(globalThis,function(){
  'use strict';
  function inkBounds({width,height,data}){
    let left=width,top=height,right=0,bottom=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>2){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
    return right>left?{left:Math.max(0,left-1),top:Math.max(0,top-1),right:Math.min(width,right+1),bottom:Math.min(height,bottom+1)}:null;
  }
  function layout(bounds,{gap=6,padding=16,maxSide=8192,maxPixels=8000000}={}){
    if(!bounds.length)return {width:1,height:1,scale:1,items:[],gap,padding};
    const safe=bounds.map(b=>b||{left:299,top:299,right:301,bottom:301});
    if(safe.some(b=>![b.left,b.top,b.right,b.bottom].every(Number.isFinite)||b.right<=b.left||b.bottom<=b.top))throw Error('无效螺旋边界。');
    const top=Math.min(...safe.map(b=>b.top)),bottom=Math.max(...safe.map(b=>b.bottom));let x=padding;
    const items=safe.map(b=>{const width=b.right-b.left,entry={sx:b.left,sy:top,width,height:bottom-top,x,y:padding};x+=width+gap;return entry;});
    const naturalWidth=x-gap+padding,naturalHeight=bottom-top+padding*2;
    const scale=Math.min(1,maxSide/naturalWidth,maxSide/naturalHeight,Math.sqrt(maxPixels/(naturalWidth*naturalHeight)));
    return {items,top,bottom,naturalWidth,naturalHeight,width:Math.max(1,Math.floor(naturalWidth*scale)),height:Math.max(1,Math.floor(naturalHeight*scale)),scale,gap,padding};
  }
  return {inkBounds,layout};
});
