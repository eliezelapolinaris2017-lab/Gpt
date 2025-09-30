/* Service Worker — cache estático + fallback offline */
const CACHE = 'salon-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './assets/logo.svg',
  './assets/icon-maskable.svg',
  './assets/empty.svg'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))) );
  self.clients.claim();
});

self.addEventListener('fetch', (e)=>{
  const req = e.request;
  // Estrategia: cache-first para assets, network-first para otros GET
  if(req.method==='GET'){
    if(ASSETS.some(a=> req.url.endsWith(a.replace('./','')) )){
      e.respondWith(caches.match(req).then(r=> r || fetch(req)));
      return;
    }
    e.respondWith(
      fetch(req).then(res=>{
        const copy = res.clone();
        caches.open(CACHE).then(c=>c.put(req, copy));
        return res;
      }).catch(()=> caches.match(req).then(r=> r || caches.match('./index.html')))
    );
  }
});
