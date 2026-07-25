(function(){
'use strict';
var files=['core-v2.js?v=1','workspace-v2.js?v=1','views-v2.js?v=1','main-v2.js?v=1'];
var index=0;
function next(){
  if(index>=files.length)return;
  var script=document.createElement('script');
  script.src=files[index++];
  script.async=false;
  script.onload=next;
  script.onerror=function(){
    var boot=document.getElementById('bootMessage');
    if(boot)boot.textContent='No se pudo cargar un módulo de la aplicación. Recargá la página.';
  };
  document.head.appendChild(script);
}
next();
})();
