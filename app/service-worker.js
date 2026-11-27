const SHELL_CACHE='geotracia-shell-offline-v36-20261127';
const TILE_CACHE='geotracia-osm-tiles-v1';
const TILE_CACHE_LIMIT=1200;
const SHELL=[
 './','./index.html',
 './styles.css?v=inventory-gps-redesign-v2-20261115',
 './teams.css?v=teams-module-v1','./premium-ui.css?v=ss-premium-first-view-v4',
 './auth.css?v=legal-consent-v1','./roads.css?v=3.2','./roads.css?v=3.5','./sidebar-toggle.css?v=2.3',
 './map-gps.css','./map-gps-v06.css','./map-gps-v10-longitud-vial.css?v=2.6',
 './map-gps-v11-osm-longitud.css?v=3.4','./map-gps-google.css?v=1.0',
 './supabase-config.js','./auth.js?v=legal-consent-v1',
 './app.js?v=inventory-gps-redesign-v2-20261115',
 './roads.js?v=restore-rebuild-button-v3','./sidebar-toggle.js?v=2.3',
 './map-gps.js?v=3.2','./map-gps-v06.js','./map-gps-v10-longitud-vial.js?v=2.6',
 './map-gps-v11-osm-longitud.js?v=3.6','./google-maps-config.js?v=1.0',
 './map-gps-google.js?v=1.0','./geotracia-logo.png','./geotracia-symbol.png',
 './manifest.webmanifest','../legal/condiciones-de-uso.html','../legal/privacidad.html',
 '../legal/contrato-servicio.html','../assets/favicon-32.png','../assets/favicon-192.png',
 '../assets/favicon-512.png',
 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];
const TILE_HOSTS=['a.tile.openstreetmap.org','b.tile.openstreetmap.org','c.tile.openstreetmap.org'];
const isOsmTile=url=>TILE_HOSTS.includes(url.hostname)&&/^\/\d+\/\d+\/\d+\.png$/.test(url.pathname);
async function trimTileCache(cache){
 const keys=await cache.keys();
 if(keys.length<=TILE_CACHE_LIMIT)return;
 const remove=keys.length-TILE_CACHE_LIMIT;
 await Promise.all(keys.slice(0,remove).map(key=>cache.delete(key)));
}
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(SHELL_CACHE);
  await Promise.all(SHELL.map(async path=>{
   try{
    const url=new URL(path,self.registration.scope);
    const response=await fetch(new Request(url.href,{cache:'reload'}));
    if(response.ok||response.type==='opaque')await cache.put(url.href,response);
   }catch(error){console.warn('[GEOTRACIA SW] Recurso shell no precargado:',path)}
  }));
  await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith('geotracia-shell-')&&key!==SHELL_CACHE).map(key=>caches.delete(key)));
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(isOsmTile(url)){
  event.respondWith((async()=>{
   const cache=await caches.open(TILE_CACHE);
   const cached=await cache.match(req);
   if(cached)return cached;
   try{
    const response=await fetch(req);
    if(response.ok||response.type==='opaque'){
     await cache.put(req,response.clone());
     await trimTileCache(cache);
    }
    return response;
   }catch(error){return Response.error()}
  })());
  return;
 }
 if(url.origin===self.location.origin){
  event.respondWith((async()=>{
   const cached=await caches.match(req);
   if(cached)return cached;
   try{
    const response=await fetch(req);
    if(response.ok){
     const cache=await caches.open(SHELL_CACHE);
     await cache.put(req,response.clone());
    }
    return response;
   }catch(error){
    if(req.mode==='navigate'){
     const fallback=await caches.match(new URL('./index.html',self.registration.scope).href);
     if(fallback)return fallback;
    }
    return Response.error();
   }
  })());
  return;
 }
 if(['cdn.jsdelivr.net','unpkg.com','fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname)){
  event.respondWith((async()=>{
   const cached=await caches.match(req);
   if(cached)return cached;
   try{
    const response=await fetch(req);
    if(response.ok||response.type==='opaque'){
     const cache=await caches.open(SHELL_CACHE);
     await cache.put(req,response.clone());
    }
    return response;
   }catch(error){return Response.error()}
  })());
 }
});
