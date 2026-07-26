'use strict';
const VERSION='ct-pro-20260726-5';
const SHELL=[
  './','./index.html','./pro.css','./pro-addon.js','./pro-addon-main.js','./coverage-addon.js','./backend-setup-addon.js','./remote-auth-addon.js','./admin-addon.js','./team-admin-addon.js','./viewer-guard-addon.js','./startup-guard-addon.js','./manifest.webmanifest','./icon.svg',
  '../territorio-mobile-next/styles-v2.css?v=1','../territorio-mobile-next/core-v2.js?v=1',
  '../territorio-mobile-next/workspace-v2.js?v=1','../territorio-mobile-next/views-v2.js?v=1',
  '../territorio-mobile-next/main-v2.js?v=1'
];
self.addEventListener('install',event=>{event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ct-pro-')&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;
  const isData=/\/(lla-candidates-2025|election-results-2025)\.json$|\/map-(departments|municipalities-[12])\.js$/.test(url.pathname);
  if(isData){event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{const copy=response.clone();caches.open(VERSION).then(cache=>cache.put(event.request,copy));return response}).catch(()=>caches.match(event.request)));return}
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(VERSION).then(cache=>cache.put(event.request,copy))}return response})))
});
