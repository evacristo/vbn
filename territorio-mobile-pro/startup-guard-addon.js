(function(){
'use strict';
var CT=window.CT;
if(!CT||!CT.renderSync)return;
var renderSync=CT.renderSync;
CT.renderSync=function(){
  if(!CT.state.workspace)return;
  return renderSync();
};
})();
