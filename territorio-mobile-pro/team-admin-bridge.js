(function(){
'use strict';
var CT=window.CT;
if(!CT||!CT.remoteLogin)return;
var baseRemoteLogin=CT.remoteLogin;
var baseRemoteLogout=CT.remoteLogout;

function refreshRemoteUi(){
  try{if(CT.renderSync)CT.renderSync()}catch(error){}
  window.dispatchEvent(new Event('online'));
  document.dispatchEvent(new CustomEvent('ct:remote-auth-changed'));
}
function refreshSequence(){
  refreshRemoteUi();
  setTimeout(refreshRemoteUi,250);
  setTimeout(refreshRemoteUi,800);
  setTimeout(refreshRemoteUi,1800);
}

CT.remoteLogin=async function(username,password){
  var result=await baseRemoteLogin(username,password);
  refreshSequence();
  return result;
};
if(baseRemoteLogout){
  CT.remoteLogout=async function(){
    var result=await baseRemoteLogout();
    refreshSequence();
    return result;
  };
}
})();