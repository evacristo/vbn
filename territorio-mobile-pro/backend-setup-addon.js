(function(){
'use strict';
var CT=window.CT;
if(!CT)return;
var DEPLOY_URL='https://deploy.workers.cloudflare.com/?url=https://github.com/evacristo/vbn/tree/chatgpt-mobile-app/territorio-backend';
var baseRenderSync=CT.renderSync;

function workspace(){return CT.state.workspace}
function endpoint(){return String(workspace()&&workspace().sync&&workspace().sync.endpoint||'').replace(/\/$/,'')}
function saveEndpoint(value){
  workspace().sync.endpoint=String(value||'').trim().replace(/\/$/,'');
  workspace().sync.lastError='';
  CT.saveWorkspace('Endpoint privado configurado',true);
  var input=CT.$('syncEndpoint');
  if(input)input.value=workspace().sync.endpoint;
  CT.renderSync();
}
async function parseJson(response){
  var data={};
  try{data=await response.json()}catch(error){}
  if(!response.ok){var e=new Error(data.message||data.error||('HTTP '+response.status));e.status=response.status;e.data=data;throw e}
  return data;
}
async function checkHealth(){
  if(!endpoint())throw new Error('Pegá primero la URL del Worker.');
  var response=await fetch(endpoint()+'/health',{headers:{Accept:'application/json'},cache:'no-store'});
  return parseJson(response);
}
async function bootstrapAdmin(secret,username,password){
  if(!endpoint())throw new Error('Pegá primero la URL del Worker.');
  if(!secret)throw new Error('Ingresá el secreto de arranque.');
  if(!username||password.length<3)throw new Error('Completá usuario y contraseña.');
  var response=await fetch(endpoint()+'/api/admin/users',{
    method:'POST',
    headers:{'Content-Type':'application/json',Accept:'application/json','X-Bootstrap-Secret':secret},
    body:JSON.stringify({username:username,password:password,role:'admin',organizationName:'Corrientes Territorial'})
  });
  return parseJson(response);
}

CT.renderSync=function(){
  baseRenderSync();
  var panel=CT.$('backendSetupPanel');
  if(!panel)return;
  var configured=!!endpoint();
  var user=workspace().sync.remoteUser;
  CT.$('backendSetupState').innerHTML=configured
    ?'<div><i class="sync-dot ok"></i>Endpoint: <strong>'+CT.esc(endpoint())+'</strong></div>'
    :'<div><i class="sync-dot"></i>Backend todavía no activado</div>';
  CT.$('bootstrapFields').classList.toggle('hidden',!!user);
};

function install(){
  var view=CT.$('view-sync');
  if(!view||CT.$('backendSetupPanel'))return;

  var queryEndpoint=new URLSearchParams(location.search).get('endpoint');
  if(queryEndpoint)saveEndpoint(queryEndpoint);

  var panel=document.createElement('article');
  panel.id='backendSetupPanel';
  panel.className='panel';
  panel.innerHTML='<div class="section-heading"><div><h2>Activar backend privado</h2><p>Usuarios reales, sincronización entre dispositivos y adjuntos compartidos</p></div><span class="badge official">1 vez</span></div>'
    +'<div id="backendSetupState" class="stack small"></div>'
    +'<div class="stack">'
    +'<button id="deployCloudflare" type="button" class="primary">1 · Desplegar en Cloudflare</button>'
    +'<p class="muted">Cloudflare abrirá su propio formulario. Conservá el valor de <code>BOOTSTRAP_SECRET</code> hasta completar el paso 3.</p>'
    +'<label>2 · URL entregada por Cloudflare<input id="setupEndpoint" type="url" inputmode="url" placeholder="https://corrientes-territorial-api....workers.dev"></label>'
    +'<div class="inline-actions"><button id="saveSetupEndpoint" type="button">Guardar URL</button><button id="testSetupEndpoint" type="button">Probar conexión</button></div>'
    +'<div id="setupHealthStatus" class="stack small"></div>'
    +'<div id="bootstrapFields" class="stack">'
    +'<h3>3 · Crear primer administrador</h3>'
    +'<label>Secreto de arranque<input id="bootstrapSecret" type="password" autocomplete="off"></label>'
    +'<label>Usuario administrador<input id="bootstrapUsername" autocomplete="username"></label>'
    +'<label>Contraseña inicial<input id="bootstrapPassword" type="password" autocomplete="new-password"></label>'
    +'<button id="bootstrapAdmin" type="button" class="primary">Crear administrador y conectar</button>'
    +'<small>El secreto no se guarda en el dispositivo ni se envía a GitHub.</small>'
    +'</div></div>';
  view.insertBefore(panel,view.firstChild);

  CT.$('setupEndpoint').value=endpoint();
  CT.$('bootstrapUsername').value=CT.state.user||'Ivo';

  CT.$('deployCloudflare').onclick=function(){window.open(DEPLOY_URL,'_blank','noopener')};
  CT.$('saveSetupEndpoint').onclick=function(){
    saveEndpoint(CT.$('setupEndpoint').value);
    CT.toast('URL del backend guardada.');
  };
  CT.$('testSetupEndpoint').onclick=async function(){
    var button=this;button.disabled=true;
    try{
      saveEndpoint(CT.$('setupEndpoint').value);
      var data=await checkHealth();
      CT.$('setupHealthStatus').innerHTML='<div>✓ Servicio disponible · versión '+CT.esc(data.version||'activa')+'</div>';
      CT.toast('Backend disponible.');
    }catch(error){
      CT.$('setupHealthStatus').innerHTML='<div class="form-error">'+CT.esc(error.message)+'</div>';
      CT.toast('No se pudo conectar.');
    }finally{button.disabled=false}
  };
  CT.$('bootstrapAdmin').onclick=async function(){
    var button=this;button.disabled=true;
    try{
      saveEndpoint(CT.$('setupEndpoint').value);
      var username=CT.$('bootstrapUsername').value.trim();
      var password=CT.$('bootstrapPassword').value;
      await bootstrapAdmin(CT.$('bootstrapSecret').value,username,password);
      CT.$('bootstrapSecret').value='';
      await CT.remoteLogin(username,password);
      CT.$('bootstrapPassword').value='';
      CT.toast('Backend activado y administrador conectado.');
      try{await CT.pushSync(false)}catch(error){}
    }catch(error){
      var message=error.message==='forbidden'?'El primer administrador ya existe o el secreto no coincide.':error.message;
      CT.$('setupHealthStatus').innerHTML='<div class="form-error">'+CT.esc(message)+'</div>';
      CT.toast('No se pudo crear el administrador.');
    }finally{button.disabled=false}
  };
  CT.renderSync();
}
document.addEventListener('DOMContentLoaded',install);
})();