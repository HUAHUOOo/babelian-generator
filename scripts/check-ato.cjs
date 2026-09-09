/* Read-only compatibility check. Never reads saves, stories or user accounts. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),contract=require('../integration/module-contract.json');
function inspect(source){
  const reports=[],report=(ok,message)=>reports.push({ok,message});
  const read=file=>{const p=path.join(source,file);return fs.existsSync(p)?fs.readFileSync(p,'utf8'):'';};
  for(const file of contract.requiredHostFiles)report(!!read(file),'宿主文件 '+file);
  const git=process.env.BABELIAN_GIT||'git',patch=path.join(root,'integration/ato-assistant.patch');
  const check=args=>cp.spawnSync(git,['apply','--check','--ignore-space-change',...args,patch],{cwd:source,encoding:'utf8',windowsHide:true});
  const forward=check([]),reverse=check(['--reverse']);
  const patchState=reverse.status===0?'installed':forward.status===0?'ready':'incompatible';
  report(patchState!=='incompatible',patchState==='installed'?'宿主补丁已安装，无需重复应用':patchState==='ready'?'宿主补丁可应用；首次接入需先安装':'补丁与当前宿主不匹配，需人工合并（未修改任何文件）');
  const javaRoot='tools/packaging/android/app/src/main/';
  const activity=read(javaRoot+'java/com/ato/assistant/MainActivity.java');
  if(activity){
    report(activity.includes('onShowFileChooser')&&activity.includes('FileChooserParams.parseResult'),'Android 图片文件选择及取消回调');
    report(read(javaRoot+'AndroidManifest.xml').includes('android.permission.INTERNET'),'Android 网络权限（仅可选机翻联网）');
    const bridge=read('tools/packaging/android/fetch-bridge.js');
    report(bridge.includes('return nativeFetch(input, init)'),'Android 外部HTTPS请求保留原生网络通道');
  }
  const moduleRoot=path.join(source,'babelian'),manifestFile=path.join(moduleRoot,'babelian-module.json');
  if(fs.existsSync(manifestFile)){
    try{
      const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
      report(manifest.module==='babelian'&&manifest.contractVersion===1,'模块清单版本 '+manifest.version);
      report(!!manifest.files?.['index.html']&&Object.keys(manifest.files||{}).length===contract.assetCount+1,'模块清单包含页面及全部64个素材');
      for(const [file,record] of Object.entries(manifest.files||{})){
        if(!/^(index\.html|assets\/[a-z0-9-]+\.png)$/.test(file)){report(false,'清单中存在无效路径');continue;}
        const p=path.join(moduleRoot,file),ok=fs.existsSync(p)&&crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')===record.sha256;
        if(!ok)report(false,'模块文件缺失或与清单不符：'+file);
      }
    }catch(_){report(false,'模块清单无法读取');}
  }else report(true,'未安装带版本清单的模块；从构建产物复制 babelian/（保留现有存档）');
  return {patchState,reports};
}
if(require.main===module){
  if(!process.argv[2]){console.error('用法：node scripts/check-ato.cjs <ATO Assistant 根目录>');process.exitCode=2;}
  else{
    const source=path.resolve(process.argv[2]);
    if(!fs.existsSync(source)){console.error('目录不存在：'+source);process.exitCode=2;}
    else{const result=inspect(source);for(const r of result.reports)console.log((r.ok?'PASS ':'FAIL ')+r.message);console.log('只读检查完成；未安装补丁、未替换模块、未读取存档，不能替代实机测试。');if(result.reports.some(r=>!r.ok))process.exitCode=1;}
  }
}
module.exports={inspect};
