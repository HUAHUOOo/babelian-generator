(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LanguageNavigation=api;})(globalThis,function(){
  'use strict';
  function mount({document,onChange=()=>{}}){
    const $=id=>document.getElementById(id);let current='home',previous='babelian';
    function show(next,{focus=true}={}){
      if(!['home','babelian','siren'].includes(next))throw Error('未知语言工具。');
      const old=current;current=next;if(next!=='home')previous=next;
      $('language-home').hidden=next!=='home';$('language-babelian').hidden=next!=='babelian';$('panel-siren').hidden=next!=='siren';
      $('language-back').hidden=next==='home';$('babelian-backups').hidden=next!=='babelian';
      onChange(next,old);
      if(focus)(next==='home'?$('language-open-'+previous):$(next==='babelian'?'babelian-title':'siren-title')).focus({preventScroll:true});
    }
    for(const name of ['babelian','siren'])$('language-open-'+name).addEventListener('click',()=>show(name));
    $('language-back').addEventListener('click',()=>show('home'));
    show('home',{focus:false});return {show,current:()=>current};
  }
  return {mount};
});
