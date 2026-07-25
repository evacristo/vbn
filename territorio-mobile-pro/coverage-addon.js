(function(){
'use strict';
var CT=window.CT;
if(!CT)return;
var previous=CT.municipalities;
CT.municipalities=function(){
  var canonical=new Map();
  function add(name){
    if(!name)return;
    var key=CT.canonJur(name);
    if(!canonical.has(key))canonical.set(key,name);
  }
  (previous?previous():[]).forEach(add);
  (CT.state.geometry.municipality||[]).forEach(function(row){add(row[0])});
  (CT.state.results.results||[]).forEach(function(row){if(row.jurisdictionType==='municipality')add(row.jurisdiction)});
  return Array.from(canonical.values()).sort(function(a,b){return a.localeCompare(b,'es')});
};
})();
