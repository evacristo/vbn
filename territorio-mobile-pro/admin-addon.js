(function(){
'use strict';
var CT=window.CT;
if(!CT)return;
var baseRenderSync=CT.renderSync;
function workspace(){return CT.state.workspace}
function endpoint(){return String(workspace()&&workspace().sync&&workspace().sync.endpoint||'').replace(/\/$/,'')}
function headers(){var token=workspace().sync.token||'';return {'Content-Type':'application/json',Accept:'application/json',Authorization:token?'Bearer '+token:''}}
CT.renderSync=function(){baseRenderSync();var panel=CT.$('remoteAdminPanel');if(!panel)return;var user=workspace()&&workspace().sync.remoteUser;panel.classList.toggle('hidden',!(user&&user.role==='admin'))};
function install(){
  var view=CT.$('view-sync');
  if(!view||CT.$('remoteAdminPanel'))return;
  var panel=document.createElement('article');
  panel.id='remoteAdminPanel';
  panel.className='panel hidden';
  panel.innerHTML='<h2>Crear usuario</h2><p class="muted">La cuenta se incorpora al mismo espacio territorial compartido. Las contraseñas no se guardan en esta aplicación.</p><div class="stack"><label>Usuario<input id="adminNewUser" autocomplete="off"></label><label>Contraseña inicial<input id="adminNewPassword" type="password" autocomplete="new-password"></label><label>Rol<select id="adminNewRole"><option value="editor">Editor</option><option value="viewer">Sólo lectura</option><option value="admin">Administrador</option></select></label><button id="adminCreateUser" type="button" class="primary">Crear usuario</button><div id="adminUserStatus" class="stack small"></div></div>';
  view.appendChild(panel);
  CT.$('adminCreateUser').onclick=async function(){
    var button=this,username=CT.$('adminNewUser').value.trim(),password=CT.$('adminNewPassword').value,role=CT.$('adminNewRole').value;
    if(!username||password.length<3){CT.toast('Completá usuario y contraseña.');return}
    button.disabled=true;
    try{
      var response=await fetch(endpoint()+'/api/admin/users',{method:'POST',headers:headers(),credentials:'include',body:JSON.stringify({username:username,password:password,role:role})});
      var data={};try{data=await response.json()}catch(error){}
      if(!response.ok)throw new Error(data.error||('HTTP '+response.status));
      CT.$('adminUserStatus').innerHTML='<div>✓ Usuario '+CT.esc(username)+' creado como '+CT.esc(role)+'</div>';
      CT.$('adminNewUser').value='';CT.$('adminNewPassword').value='';
      CT.toast('Usuario remoto creado.');
      var refresh=CT.$('refreshCollaboration');if(refresh)refresh.click();
    }catch(error){
      CT.$('adminUserStatus').innerHTML='<div class="form-error">'+CT.esc(error.message)+'</div>';
      CT.toast('No se pudo crear el usuario.');
    }finally{button.disabled=false}
  };
  CT.renderSync();
}
document.addEventListener('DOMContentLoaded',install);
})();