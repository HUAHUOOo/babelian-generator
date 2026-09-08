(function(){
  'use strict';
  const pending=new Map();
  window.BabelianNativeFileResult=result=>{
    const task=pending.get(result.id);if(!task)return;
    pending.delete(result.id);clearTimeout(task.timer);
    if(result.ok)task.resolve();else task.reject(Error(result.cancelled?'已取消保存。':result.error||'保存失败。'));
  };
  async function download(blob,filename){
    if(window.ATOAndroid){
      if(typeof window.ATOAndroid.saveBabelianFile!=='function')throw Error('此 APK 尚未安装文件导出适配，请更新配套补丁。');
      if(blob.size>8*1024*1024)throw Error('文件超过8MB，请分段导出。');
      const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('文件读取失败。'));reader.readAsDataURL(blob);});
      const id='babelian-'+Date.now()+'-'+Math.random().toString(36).slice(2);
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);reject(Error('保存等待超时，请重试。'));},300000);
        pending.set(id,{resolve,reject,timer});
        try{window.ATOAndroid.saveBabelianFile(id,filename,blob.type.split(';')[0],base64);}catch(error){pending.delete(id);clearTimeout(timer);reject(error);}
      });
    }
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  function connect(runtime){
    const $=id=>document.getElementById(id);
    let app=null;
    $('host-home').hidden=!runtime.integrated;
    $('host-home').href=new URL('../index.html',location.href).href;
    $('host-retry').hidden=!runtime.integrated;
    $('host-reload').hidden=!runtime.integrated;
    $('runtime-mode').textContent=runtime.integrated?'ATO 接入版':'离线可用';
    runtime.subscribe(status=>{
      const identity=status.owner?' · '+status.owner+' / '+status.profileId:'';
      $('host-status').textContent=status.message+identity;
      $('host-bar').dataset.status=status.kind;
      $('host-retry').disabled=['saving','loading','conflict','blocked'].includes(status.kind);
      $('host-reload').disabled=status.kind==='saving';
    });
    $('workspace-export').addEventListener('click',async()=>{
      try{await download(new Blob([JSON.stringify(runtime.backup(),null,2)],{type:'application/json'}),'巴别语完整工作备份.json');}
      catch(error){$('host-status').textContent=error.message;}
    });
    $('workspace-import').addEventListener('click',()=>$('workspace-file').click());
    $('workspace-file').addEventListener('change',async event=>{
      const file=event.target.files[0];if(!file)return;
      try{
        if(!app)throw Error('请等待工具载入完成。');
        if(runtime.isSaving())throw Error('正在同步，请稍后导入。');
        if(file.size>1024*1024)throw Error('工作备份文件超过1MB。');
        const value=runtime.decodeBackup(JSON.parse(await file.text()));
        if(!confirm('导入完整工作备份会替换当前五个栏位及书写草稿。建议先下载现有工作备份。是否继续？'))return;
        runtime.replaceProfile(value);app.restore(value);updateStory();
        $('host-status').textContent=runtime.integrated?'完整工作已导入，等待同步到 ATO。':'完整工作已导入本机。';
      }catch(error){$('host-status').textContent='导入失败：'+error.message;}
      finally{event.target.value='';}
    });
    $('host-retry').addEventListener('click',()=>runtime.retry());
    $('host-reload').addEventListener('click',()=>{
      if(runtime.hasPending()&&!confirm('重新读取会放弃当前未同步的修改。请先下载完整工作备份。是否继续？'))return;
      try{runtime.discardPending();location.reload();}catch(error){$('host-status').textContent=error.message;}
    });
    window.addEventListener('beforeunload',event=>{if(runtime.hasPending()){event.preventDefault();event.returnValue='';}});
    for(const id of ['host-home','host-story'])$(id).addEventListener('click',async event=>{
      if(!runtime.hasPending())return;
      event.preventDefault();event.stopImmediatePropagation();
      await runtime.flush();
      if(runtime.hasPending()){$('host-status').textContent='仍有未同步工作，请先重试同步或下载完整工作备份。';return;}
      location.href=$(id).href;
    });
    function updateStory(){const href=runtime.integrated&&runtime.storyUrl();$('host-story').hidden=!href;if(href)$('host-story').href=href;}
    return {
      ready(hooks){app=hooks;updateStory();$('tool-surface').inert=false;$('workspace-import').disabled=false;$('workspace-export').disabled=false;},
      fail(error){$('host-status').textContent=error.message;$('host-reload').hidden=false;$('host-reload').disabled=false;},
    };
  }
  window.BabelianHost={connect,download};
})();
