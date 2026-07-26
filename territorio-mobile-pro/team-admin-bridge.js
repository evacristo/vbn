(function(){
'use strict';
var CT=window.CT;
if(!CT||!CT.remoteLogin)return;
var baseRemoteLogin=CT.remoteLogin;
var baseRemoteLogout=CT.remoteLogout;
CT.remoteLogin=async function(username,password){
  var result=await baseRemoteLogin(username,password);
  window.dispatchEvent(new Event('online'));
  return result;
};
if(baseRemoteLogout){
  CT.remoteLogout=async function(){
    var result=await baseRemoteLogout();
    window.dispatchEvent(new Event('online'));
    return result;
  };
}
})();
