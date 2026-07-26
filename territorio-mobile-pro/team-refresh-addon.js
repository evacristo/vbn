(function(){
'use strict';
var CT=window.CT;
if(!CT||!CT.remoteLogin)return;
var remoteLogin=CT.remoteLogin;
var remoteLogout=CT.remoteLogout;

function refreshSoon(){
  setTimeout(function(){
    if(CT.renderSync)CT.renderSync();
    var refresh=document.getElementById('teamRefreshUsers');
    if(refresh)refresh.click();
  },120);
}

CT.remoteLogin=async function(username,password){
  var result=await remoteLogin(username,password);
  refreshSoon();
  return result;
};

if(remoteLogout){
  CT.remoteLogout=async function(){
    var result=await remoteLogout();
    if(CT.renderSync)CT.renderSync();
    return result;
  };
}
})();
