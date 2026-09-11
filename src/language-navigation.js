(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LanguageNavigation=api;})(globalThis,function(){
  'use strict';
  function mount({document,onChange=()=>{}}){
    const $=id=>document.getElementById(id);let current='home',previous='babelian-generate';
    const entries={'babelian-generate':'language-open-babelian','babelian-translate':'language-open-babelian-translate','siren-generate':'language-open-siren','siren-translate':'language-open-siren-translate'};
    function show(next,{focus=true}={}){
      // Keep the old public language shortcuts as generation entry aliases.
      next=({babelian:'babelian-generate',siren:'siren-generate'})[next]||next;
      if(next!=='home'&&!Object.hasOwn(entries,next))throw Error('未知语言工具。');
      const old=current;current=next;if(next!=='home')previous=next;
      const babelian=next.startsWith('babelian-'),siren=next.startsWith('siren-');
      $('language-home').hidden=next!=='home';$('language-babelian').hidden=!babelian;$('panel-siren').hidden=!siren;
      $('language-back').hidden=next==='home';$('babelian-backups').hidden=!babelian;
      onChange(next,old);
      if(focus)(next==='home'?$(entries[previous]):$(babelian?'babelian-title':'siren-title')).focus({preventScroll:true});
    }
    for(const [name,id] of Object.entries(entries))$(id).addEventListener('click',()=>show(name));
    $('language-back').addEventListener('click',()=>show('home'));
    show('home',{focus:false});return {show,current:()=>current};
  }
  return {mount};
});
