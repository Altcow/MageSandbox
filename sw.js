const VERSION = 'v3';
const CACHE = 'magesandbox-' + VERSION;
const PRECACHE = [
  './', './index.html', './manifest.webmanifest',
  './js/fx.js', './js/mage.js', './js/world.js', './js/scenes.js', './js/game.js', './js/spells.js', './js/classes.js', './js/touch.js',
  './lib/three.min.js', './lib/CopyShader.js', './lib/LuminosityHighPassShader.js', './lib/EffectComposer.js',
  './lib/RenderPass.js', './lib/ShaderPass.js', './lib/UnrealBloomPass.js',
  './icons/icon-192.png', './icons/icon-512.png'
];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('magesandbox-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
