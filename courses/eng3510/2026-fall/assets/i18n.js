/* KO/EN toggle for the ENG3510 course site. Korean is the default; the choice persists in localStorage. */
(function(){
  var KEY='eng3510-lang';
  var root=document.documentElement;
  function get(){ try{ var q=new URLSearchParams(location.search).get('lang'); if(q==='en'||q==='ko'){ localStorage.setItem(KEY,q); return q; } return localStorage.getItem(KEY)||'ko'; }catch(e){ return 'ko'; } }
  function apply(lang){
    root.setAttribute('data-lang',lang); root.setAttribute('lang',lang);
    var t=root.getAttribute('data-title-'+lang); if(t) document.title=t.replace(/&amp;/g,'&').replace(/&quot;/g,'"');
    ['alt','aria-label'].forEach(function(a){
      document.querySelectorAll('[data-'+a+'-en]').forEach(function(el){
        if(!el.hasAttribute('data-'+a+'-ko')) el.setAttribute('data-'+a+'-ko',el.getAttribute(a)||'');
        el.setAttribute(a,el.getAttribute('data-'+a+'-'+lang));
      });
    });
    document.querySelectorAll('.lang-toggle').forEach(function(b){ b.textContent=b.getAttribute('data-'+lang); b.setAttribute('aria-label',lang==='ko'?'Switch to English':'한국어로 보기'); });
    try{ localStorage.setItem(KEY,lang); }catch(e){}
  }
  // early pass (in <head>) prevents a flash of Korean before the DOM is ready
  root.setAttribute('data-lang',get());
  if(document.currentScript && document.currentScript.hasAttribute('data-init')){
    apply(get());
    document.querySelectorAll('.lang-toggle').forEach(function(b){ b.addEventListener('click',function(){ apply(root.getAttribute('data-lang')==='ko'?'en':'ko'); }); });
  }
})();
