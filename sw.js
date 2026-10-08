// Offline support. Same-origin files: network first, cache fallback (always fresh when online).
// Versioned CDN libraries and fonts: cache first. Everything else (Supabase, peers, TTS/AI APIs) is never touched.
const CACHE = 'forbidden-library-v1';
const SHELL = ['./', 'index.html', 'app.html', 'manifest.webmanifest', 'supabase-config.js', 'icons/icon-192.png', 'icons/icon-512.png', 'css/app.css', 'css/features.css', 'css/home.css', 'css/library.css', 'css/social.css', 'css/study.css', 'css/theme.css', 'css/themes.css', 'css/tutorial.css', 'css/voice.css', 'js/ai.js', 'js/argument.js', 'js/audio.js', 'js/canvasops.js', 'js/collab.js', 'js/core.js', 'js/dictionary.js', 'js/epub.js', 'js/evidence.js', 'js/export.js', 'js/home.js', 'js/icons.js', 'js/journey.js', 'js/library.js', 'js/main.js', 'js/map.js', 'js/pdf.js', 'js/preview.js', 'js/shapes.js', 'js/sky.js', 'js/social.js', 'js/study.js', 'js/themes.js', 'js/translate.js', 'js/tts.js', 'js/tutorial.js', 'js/universe.js', 'js/voice.js', 'js/webimport.js'];
const CDN = /^(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
const put = (req, res) => { if (res.ok && res.status === 200) caches.open(CACHE).then((c) => c.put(req, res.clone())); return res; };
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || r.headers.has('range')) return;
  if (u.origin === location.origin) e.respondWith(fetch(r).then((res) => put(r, res)).catch(() => caches.match(r, { ignoreSearch: true })));
  else if (CDN.test(u.hostname)) e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) => put(r, res))));
});
