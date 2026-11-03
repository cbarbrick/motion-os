// Never cache authenticated pages, API requests, tokens, or workspace records.
const CACHE='motion-offline-v3';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/offline.html','/icon-192.png'])));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('motion-offline-')&&k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate'&&new URL(event.request.url).origin===self.location.origin){event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));}});

// Every push is visible; the encrypted payload contains no record titles or photos.
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch{}
 event.waitUntil(self.registration.showNotification('Motion OS',{
  body:typeof data.body==='string'?data.body.slice(0,240):'There is new team activity. Open Motion OS to view.',
  icon:'/icon-192.png',badge:'/icon-192.png',
  tag:typeof data.tag==='string'?data.tag.slice(0,80):'motion-update',
  data:{url:'/#notifications'},
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const url=new URL('/#notifications',self.location.origin).href;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(client=>new URL(client.url).origin===self.location.origin);
  if(existing){await existing.navigate(url);await existing.focus();}
  else await self.clients.openWindow(url);
 })());
});
