(function(){
'use strict';
var CT=window.CT;
if(!CT)return;
var baseRenderSync=CT.renderSync;
var baseRemoteLogin=CT.remoteLogin;
var baseRemoteLogout=CT.remoteLogout;
var cache={users:[],sessions:[],history:[],loadedAt:0};

function workspace(){return CT.state.workspace}
function endpoint(){return String(workspace()&&workspace().sync&&workspace().sync.endpoint||'').replace(/\/$/,'')}
function token(){return workspace()&&workspace().sync&&workspace().sync.token||''}
function headers(extra){return Object.assign({Accept:'application/json',Authorization:token()?'Bearer '+token():''},extra||{})}
async function request(path,options){
  options=options||{};
  options.headers=Object.assign(headers(),options.headers||{});
  options.credentials='include';
  var response=await fetch(endpoint()+path,options);
  var data={};
  try{data=await response.json()}catch(error){}
  if(!response.ok){var e=new Error(data.message||data.error||('HTTP '+response.status));e.status=response.status;e.data=data;throw e}
  return data;
}
function user(){return workspace()&&workspace().sync&&workspace().sync.remoteUser}
function date(value){return value?new Date(value).toLocaleString('es-AR'):'—'}

CT.loadRemoteManagement=async function(){
  if(!endpoint()||!token()||!user())return;
  var tasks=[
    request('/api/sessions').then(function(data){cache.sessions=data.sessions||[]}),
    request('/api/history').then(function(data){cache.history=data.history||[]})
  ];
  if(user().role==='admin')tasks.push(request('/api/admin/users').then(function(data){cache.users=data.users||[]}));
  else cache.users=[];
  await Promise.all(tasks);
  cache.loadedAt=Date.now();
  renderManagement();
};

CT.remoteLogin=async function(username,password){
  var data=await baseRemoteLogin(username,password);
  try{await CT.loadRemoteManagement()}catch(error){}
  return data;
};
CT.remoteLogout=async function(){
  await baseRemoteLogout();
  cache={users:[],sessions:[],history:[],loadedAt:0};
  renderManagement();
};

function renderManagement(){
  var account=CT.$('remoteAccountPanel');
  var admin=CT.$('remoteAdminPanel');
  if(!account||!admin)return;
  var current=user();
  account.classList.toggle('hidden',!current);
  admin.classList.toggle('hidden',!(current&&current.role==='admin'));
  if(!current)return;

  CT.$('remoteSessionList').innerHTML=cache.sessions.map(function(session){
    return '<article class="list-card"><div class="row"><div><strong>'+CT.esc(session.current?'Este dispositivo':session.deviceId||'Dispositivo')+'</strong><p>'+CT.esc(session.userAgent||'Navegador no identificado')+'</p></div><span class="badge '+(session.revokedAt?'review':'official')+'">'+(session.revokedAt?'Revocada':'Activa')+'</span></div><small>Creada '+date(session.createdAt)+' · vence '+date(session.expiresAt)+'</small>'+(session.revokedAt?'':'<div class="card-actions"><button type="button" data-revoke-session="'+CT.esc(session.id)+'">'+(session.current?'Cerrar esta sesión':'Revocar')+'</button></div>')+'</article>';
  }).join('')||'<div class="muted">No se encontraron sesiones.</div>';

  CT.$('remoteHistoryList').innerHTML=cache.history.slice(0,20).map(function(item){
    var actor=item.actor_username||item.actorUsername||'usuario';
    return '<article class="list-card"><div class="row"><strong>Revisión '+CT.esc(item.revision)+'</strong><small>'+date(item.created_at||item.createdAt)+'</small></div><p>Modificada por '+CT.esc(actor)+'</p>'+(current.role==='viewer'?'':'<div class="card-actions"><button type="button" data-restore-revision="'+CT.esc(item.revision)+'">Restaurar</button></div>')+'</article>';
  }).join('')||'<div class="muted">Todavía no hay versiones anteriores.</div>';

  if(current.role==='admin'){
    CT.$('remoteUserList').innerHTML=cache.users.map(function(item){
      return '<article class="list-card remote-user-row" data-user-row="'+CT.esc(item.id)+'"><div class="row"><div><strong>'+CT.esc(item.username)+'</strong><p>Último acceso: '+date(item.lastLoginAt)+'</p></div><span class="badge '+(item.active?'official':'review')+'">'+(item.active?'Activa':'Desactivada')+'</span></div><div class="field-grid two compact"><label>Rol<select data-user-role="'+CT.esc(item.id)+'"><option value="admin"'+(item.role==='admin'?' selected':'')+'>Administrador</option><option value="editor"'+(item.role==='editor'?' selected':'')+'>Editor</option><option value="viewer"'+(item.role==='viewer'?' selected':'')+'>Sólo lectura</option></select></label><label class="check-row"><input type="checkbox" data-user-active="'+CT.esc(item.id)+'"'+(item.active?' checked':'')+'> Activa</label></div><div class="card-actions"><button type="button" data-save-user="'+CT.esc(item.id)+'">Guardar</button><button type="button" data-user-sessions="'+CT.esc(item.id)+'">Ver sesiones</button></div></article>';
    }).join('')||'<div class="muted">No hay usuarios.</div>';
  }
}

CT.renderSync=function(){baseRenderSync();renderManagement()};

function install(){
  var view=CT.$('view-sync');
  if(!view||CT.$('remoteAccountPanel'))return;

  var account=document.createElement('article');
  account.id='remoteAccountPanel';
  account.className='panel hidden';
  account.innerHTML='<div class="section-heading"><div><h2>Cuenta y dispositivos</h2><p>Sesiones activas e historial compartido</p></div><button id="refreshRemoteManagement" type="button" class="small-button">Actualizar</button></div><h3>Dispositivos</h3><div id="remoteSessionList" class="list"></div><h3>Versiones del equipo</h3><div id="remoteHistoryList" class="list"></div>';
  view.appendChild(account);

  var admin=document.createElement('article');
  admin.id='remoteAdminPanel';
  admin.className='panel hidden';
  admin.innerHTML='<h2>Administrar usuarios</h2><p class="muted">Las cuentas comparten el mismo espacio territorial. Los usuarios de sólo lectura no pueden modificar ni subir archivos.</p><div class="stack"><label>Usuario<input id="adminNewUser" autocomplete="off"></label><label>Contraseña inicial<input id="adminNewPassword" type="password" autocomplete="new-password"></label><label>Rol<select id="adminNewRole"><option value="editor">Editor</option><option value="viewer">Sólo lectura</option><option value="admin">Administrador</option></select></label><button id="adminCreateUser" type="button" class="primary">Crear usuario</button><div id="adminUserStatus" class="stack small"></div></div><h3>Usuarios del equipo</h3><div id="remoteUserList" class="list"></div>';
  view.appendChild(admin);

  CT.$('refreshRemoteManagement').onclick=async function(){
    this.disabled=true;
    try{await CT.loadRemoteManagement();CT.toast('Información remota actualizada.')}catch(error){CT.toast('No se pudo actualizar.')}finally{this.disabled=false}
  };

  CT.$('adminCreateUser').onclick=async function(){
    var button=this,username=CT.$('adminNewUser').value.trim(),password=CT.$('adminNewPassword').value,role=CT.$('adminNewRole').value;
    if(!username||password.length<3){CT.toast('Completá usuario y contraseña.');return}
    button.disabled=true;
    try{
      await request('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username,password:password,role:role})});
      CT.$('adminUserStatus').innerHTML='<div>✓ Usuario '+CT.esc(username)+' creado como '+CT.esc(role)+'</div>';
      CT.$('adminNewUser').value='';
      CT.$('adminNewPassword').value='';
      await CT.loadRemoteManagement();
      CT.toast('Usuario remoto creado.');
    }catch(error){
      CT.$('adminUserStatus').innerHTML='<div class="form-error">'+CT.esc(error.message)+'</div>';
      CT.toast('No se pudo crear el usuario.');
    }finally{button.disabled=false}
  };

  document.addEventListener('click',async function(event){
    var target=event.target.closest('[data-revoke-session],[data-restore-revision],[data-save-user],[data-user-sessions]');
    if(!target||!user())return;
    try{
      if(target.dataset.revokeSession){
        if(!confirm('¿Revocar esta sesión?'))return;
        await request('/api/sessions/'+encodeURIComponent(target.dataset.revokeSession),{method:'DELETE'});
        if(cache.sessions.some(function(item){return item.id===target.dataset.revokeSession&&item.current})){
          await CT.remoteLogout();
          CT.toast('Sesión remota cerrada.');
          return;
        }
        await CT.loadRemoteManagement();
        CT.toast('Sesión revocada.');
      }else if(target.dataset.restoreRevision){
        if(!confirm('¿Restaurar esta versión para todo el equipo? La versión actual quedará en el historial.'))return;
        var data=await request('/api/history/'+encodeURIComponent(target.dataset.restoreRevision)+'/restore',{method:'POST'});
        if(data.workspace){data.workspace.sync={revision:Number(data.revision||0)};CT.mergeSyncedWorkspace(data.workspace)}else await CT.pullSync();
        await CT.loadRemoteManagement();
        CT.toast('Versión restaurada.');
      }else if(target.dataset.saveUser){
        var id=target.dataset.saveUser;
        var roleEl=document.querySelector('[data-user-role="'+id+'"]');
        var activeEl=document.querySelector('[data-user-active="'+id+'"]');
        var role=roleEl?roleEl.value:'editor';
        var active=!!(activeEl&&activeEl.checked);
        await request('/api/admin/users/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:role,active:active})});
        await CT.loadRemoteManagement();
        CT.toast('Usuario actualizado.');
      }else if(target.dataset.userSessions){
        var data2=await request('/api/sessions?userId='+encodeURIComponent(target.dataset.userSessions));
        cache.sessions=data2.sessions||[];
        renderManagement();
        CT.$('remoteAccountPanel').scrollIntoView({behavior:'smooth'});
      }
    }catch(error){CT.toast('Operación remota fallida: '+error.message)}
  });

  CT.renderSync();
  if(user())CT.loadRemoteManagement().catch(function(){});
}
document.addEventListener('DOMContentLoaded',install);
})();