/* Offline worker transport. No dictionary, networking, or clipboard reads here. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SirenScan=api;})(globalThis,function(){
  'use strict';
  function runWorker(){
    self.onmessage=event=>{
      try{
        const {templates,image,operation,limit=20,base,region}=event.data,engine=SirenRecognition.create(templates);
        const bitmap=engine.binarize(image);
        const report=p=>self.postMessage({progress:p});
        if(operation==='deep'){self.postMessage({result:engine.deepRegion(bitmap,base,region,{onProgress:report})});return;}
        const hints=operation==='fit'?[null]:engine.detectGroups(bitmap,{onProgress:report});
        if(hints.length>limit)throw Error('检测到的大螺旋过多，请拆成多张图片，分批识别。');
        const groups=[];
        for(let i=0;i<hints.length;i++){
          report({stage:'group',progress:i/hints.length,index:i+1,count:hints.length});
          const hint=hints[i],box=hint?.bbox;
          const x=box?Math.max(0,Math.floor(box.x)):0,y=box?Math.max(0,Math.floor(box.y)):0;
          const width=box?Math.min(bitmap.width-x,Math.ceil(box.width)):bitmap.width,height=box?Math.min(bitmap.height-y,Math.ceil(box.height)):bitmap.height;
          const ink=new Float32Array(width*height);
          for(let row=0;row<height;row++)ink.set(bitmap.ink.subarray((y+row)*bitmap.width+x,(y+row)*bitmap.width+x+width),row*width);
          const result=engine.fitGroup({width,height,ink},hint?{...hint,cx:hint.cx-x,cy:hint.cy-y}:null,{onProgress:p=>report({...p,index:i+1,count:hints.length})});
          if(result.base){result.base.cx+=x;result.base.cy+=y;for(const item of result.items){item.x+=x;item.y+=y;for(const c of item.candidates){c.x+=x;c.y+=y;}}}
          if(result.base)groups.push(result);
        }
        self.postMessage({result:groups});
      }catch(e){self.postMessage({error:e.message||'图像匹配失败。'});}
    };
  }
  function workerSource(engineSource){return 'const SirenRecognition='+engineSource+';\n('+runWorker.toString()+')();';}
  function create({engineSource,onProgress=()=>{},WorkerClass=globalThis.Worker}={}){
    let active=null;
    function cancel(){if(!active)return;const old=active;active=null;old.worker.terminate();old.reject(Error('已取消识别；原有解读未改变。'));}
    function run(payload){
      cancel();
      return new Promise((resolve,reject)=>{
        if(!WorkerClass){reject(Error('当前浏览器不支持本机后台识别，请使用支持 Web Worker 的浏览器。'));return;}
        let url,worker;
        try{url=URL.createObjectURL(new Blob([workerSource(engineSource)],{type:'text/javascript'}));worker=new WorkerClass(url);}catch(_){reject(Error('无法启动本机识别，请检查浏览器是否允许本地 Worker。'));return;}finally{if(url)URL.revokeObjectURL(url);}
        const job={worker,reject};active=job;
        const finish=(error,result)=>{if(active!==job)return;active=null;worker.terminate();if(error)reject(error);else resolve(result);};
        worker.onmessage=e=>{if(active!==job)return;if(e.data.progress)onProgress(e.data.progress);else if(e.data.error)finish(Error(e.data.error));else finish(null,e.data.result);};
        worker.onerror=()=>finish(Error('本机识别进程失败；请换用较小图片后重试。'));
        try{worker.postMessage(payload);}catch(e){finish(e);}
      });
    }
    return {run,cancel};
  }
  return {create,workerSource};
});
