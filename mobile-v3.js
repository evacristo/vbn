/* Corrientes Territorial · Mobile v3 controller */
'use strict';

var results = window.results = window.results || {};
var state = window.state = window.state || {level:'departments',contest:'2025-governor'};

function norm(value){
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function esc(value){
  return String(value ?? '').replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];});
}
function color(value){
  if(value == null || Number.isNaN(Number(value))) return '#e9edf3';
  var t=Math.max(0,Math.min(1,Number(value)/70));
  var a=[239,231,247],b=[92,39,132];
  return 'rgb('+a.map(function(x,i){return Math.round(x+(b[i]-x)*t);}).join(',')+')';
}
function currentRows(territoryType){
  var current=results[state.contest];
  if(!current) return {};
  if(current.rowsByType && current.rowsByType[territoryType]) return current.rowsByType[territoryType];
  if(current.type && current.type!==territoryType) return {};
  return current.rows || {};
}
function draw(){
  var svg=document.getElementById('mapSvg');
  if(!svg) return;
  var isDepartments=state.level==='departments';
  var features=isDepartments?(window.DEPT||[]):[].concat(window.MUNI1||[],window.MUNI2||[]);
  var territoryType=isDepartments?'department':'municipality';
  var rows=currentRows(territoryType);
  if(!features.length){
    svg.innerHTML='<text x="450" y="280" text-anchor="middle" fill="#667085">No se cargó la geometría local.</text>';
    return;
  }
  var html='<rect width="900" height="560" fill="#edf1f5"/>';
  features.forEach(function(feature){
    var name=feature[0],path=feature[1];
    var value=Object.prototype.hasOwnProperty.call(rows,norm(name))?rows[norm(name)]:null;
    html+='<path class="territory" data-name="'+esc(name)+'" data-value="'+(value==null?'':String(value))+'" d="'+path+'" fill="'+color(value)+'"><title>'+esc(name)+(value!=null?' · LLA '+Number(value).toFixed(2)+'%':' · sin resultado para esta categoría')+'</title></path>';
  });
  if(document.getElementById('showNational')?.checked && window.ROUTES?.rn) html+='<path class="route-national" d="'+window.ROUTES.rn+'"/>';
  if(document.getElementById('showProvincial')?.checked && window.ROUTES?.rp) html+='<path class="route-provincial" d="'+window.ROUTES.rp+'"/>';
  if(document.getElementById('showLabels')?.checked){
    features.forEach(function(feature){
      var name=feature[0],center=feature[2];
      html+='<text class="label" x="'+center[0]+'" y="'+center[1]+'">'+esc(name)+'</text>';
    });
  }
  svg.innerHTML=html;
  svg.querySelectorAll('.territory').forEach(function(element){
    element.addEventListener('click',function(){
      var detail=document.getElementById('mapDetail');
      if(!detail) return;
      detail.innerHTML='<strong>'+esc(element.dataset.name)+'</strong> · '+(element.dataset.value?'LLA '+Number(element.dataset.value).toFixed(2)+'%':'sin resultado LLA para esta categoría');
    });
  });
  var status=document.getElementById('status');
  if(status) status.textContent='Mapa listo · '+features.length+' territorios';
}
window.draw=draw;

function activateView(viewId){
  var section=document.getElementById(viewId);
  if(!section) return false;
  document.querySelectorAll('.app nav button').forEach(function(button){button.classList.toggle('active',button.dataset.view===viewId);});
  document.querySelectorAll('.app > section').forEach(function(node){node.classList.toggle('active',node.id===viewId);});
  if(viewId==='map') window.requestAnimationFrame(function(){try{draw();}catch(error){console.error('Map draw failed',error);}});
  return true;
}
window.activateCorrientesView=activateView;

document.addEventListener('click',function(event){
  var button=event.target.closest?.('.app nav button[data-view]');
  if(!button) return;
  activateView(button.dataset.view);
},false);

document.addEventListener('DOMContentLoaded',function(){
  var level=document.getElementById('level');
  var contest=document.getElementById('contest');
  level?.addEventListener('change',function(){
    state.level=level.value;
    var current=results[state.contest];
    var type=state.level==='departments'?'department':'municipality';
    if(current?.rowsByType){current.type=type;current.rows=current.rowsByType[type]||{};}
    draw();
  });
  contest?.addEventListener('change',function(){
    state.contest=contest.value;
    var current=results[state.contest];
    var type=state.level==='departments'?'department':'municipality';
    if(current?.rowsByType){current.type=type;current.rows=current.rowsByType[type]||{};}
    draw();
  });
  ['showNational','showProvincial','showLabels'].forEach(function(id){document.getElementById(id)?.addEventListener('change',draw);});
  activateView('summary');
});
