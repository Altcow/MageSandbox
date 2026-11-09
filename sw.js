const VERSION = 'v4';
const CACHE = 'magesandbox-' + VERSION;
const PRECACHE = [
  './', './index.html', './manifest.webmanifest',
  './js/fx.js', './js/mage.js', './js/world.js', './js/scenes.js', './js/game.js', './js/spells.js', './js/skills.js', './js/classes.js', './js/touch.js', './js/sp_water.js', './js/sp_wind.js', './js/sp_fire.js', './js/summons.js', './js/summon_fire.js', './js/summon_water.js', './js/summon_earth.js', './js/summon_wind.js', './js/summon_light.js', './js/summon_dark.js',
  './lib/three.min.js', './lib/CopyShader.js', './lib/LuminosityHighPassShader.js', './lib/EffectComposer.js',
  './lib/RenderPass.js', './lib/ShaderPass.js', './lib/UnrealBloomPass.js',
  './assets/icons/el_water.png', './assets/icons/el_fire.png', './assets/icons/el_wind.png', './assets/icons/el_earth.png', './assets/icons/el_light.png', './assets/icons/el_dark.png', './assets/icons/archer_wave.png', './assets/icons/archer_rain.png', './assets/icons/shield_charge.png', './assets/icons/stealth.png', './assets/icons/backstab.png', './assets/icons/double_jump.png', './assets/icons/sp_wind_bolt.png', './assets/icons/sp_wind_wall.png', './assets/icons/sp_wind_sky.png', './assets/icons/sp_earth_bolt.png', './assets/icons/sp_earth_wall.png', './assets/icons/sp_earth_sky.png', './assets/icons/sp_water_bolt.png', './assets/icons/sp_water_wall.png', './assets/icons/sp_water_sky.png', './assets/icons/sp_fire_bolt.png', './assets/icons/sp_fire_wall.png', './assets/icons/sp_fire_sky.png', './assets/icons/quick_shot.png', './assets/icons/power_slash.png', './assets/icons/whirlwind.png', './assets/icons/knives.png', './assets/icons/sp_light_bolt.png', './assets/icons/sp_light_wall.png', './assets/icons/sp_light_sky.png', './assets/icons/sp_dark_bolt.png', './assets/icons/sp_dark_wall.png', './assets/icons/sp_dark_sky.png',
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
