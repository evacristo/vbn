(function(){
'use strict';
var CT=window.CT;
if(!CT)return;

var mutationSelector=[
  '[data-save-crm]','[data-save-person]','[data-save-territory]',
  '[data-delete-relation]','[data-toggle-agenda]','[data-delete-agenda]',
  '[data-start-visit]','[data-edit-visit]','[data-toggle-visit]','[data-delete-visit]',
  '[data-approve-import]','[data-dismiss-alert]','[data-verify-source]',
  '#resetWorkspace','#importJson','#pushSync'
].join(',');
var mutationForms=['relationshipForm','agendaForm','visitForm'];

function isViewer(){return CT.state.workspace&&CT.state.workspace.sync&&CT.state.workspace.sync.remoteUser&&CT.state.workspace.sync.remoteUser.role==='viewer'}
function deny(event){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();CT.toast('Esta cuenta remota es de sólo lectura.');return false}

document.addEventListener('click',function(event){if(!isViewer())return;var target=event.target.closest(mutationSelector);if(target)deny(event)},true);
document.addEventListener('submit',function(event){if(isViewer()&&mutationForms.includes(event.target&&event.target.id))deny(event)},true);
document.addEventListener('change',function(event){if(!isViewer())return;if(event.target&&event.target.matches('#visitFiles,#contactCsv,#importJson'))deny(event)},true);

function updateUi(){var viewer=isViewer();document.body.classList.toggle('remote-viewer',viewer);document.querySelectorAll(mutationSelector).forEach(function(element){element.setAttribute('aria-disabled',viewer?'true':'false');if(viewer)element.title='Cuenta remota de sólo lectura';else element.removeAttribute('title')});mutationForms.forEach(function(id){var form=document.getElementById(id);if(form)form.classList.toggle('read-only-form',viewer)})}

var observer=new MutationObserver(function(){updateUi()});
observer.observe(document.documentElement,{subtree:true,childList:true});
document.addEventListener('DOMContentLoaded',updateUi);
window.addEventListener('focus',updateUi);
setInterval(updateUi,3000);
})();
