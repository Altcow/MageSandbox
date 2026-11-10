const VERSION = 'v12';
const CACHE = 'magesandbox-' + VERSION;
const PRECACHE = [
  './', './index.html', './manifest.webmanifest',
  './js/fx.js', './js/mage.js', './js/world.js', './js/scenes.js', './js/game.js', './js/spells.js', './js/skills.js', './js/skills_archer.js', './js/skills_sword.js', './js/skills_assassin.js', './js/resources.js', './js/status.js', './js/classes.js', './js/touch.js', './js/netcfg.js', './js/net.js', './js/remote.js', './js/netcombat.js', './js/netsummon.js','./js/qr.js', './js/cover.js', './js/sp_water.js', './js/sp_wind.js', './js/sp_fire.js', './js/summons.js', './js/summons_core.js', './js/sp_water_dragon.js', './js/sp_wind_new.js', './js/sp_fire_crater.js', './js/sp_earth_dragon.js', './js/summon_fire.js', './js/summon_water.js', './js/summon_earth.js', './js/summon_wind.js', './js/summon_light.js', './js/summon_dark.js',
  './lib/three.min.js', './lib/CopyShader.js', './lib/LuminosityHighPassShader.js', './lib/EffectComposer.js',
  './lib/RenderPass.js', './lib/ShaderPass.js', './lib/UnrealBloomPass.js',
  './assets/icons/el_water.png', './assets/icons/el_fire.png', './assets/icons/el_wind.png', './assets/icons/el_earth.png', './assets/icons/el_light.png', './assets/icons/el_dark.png', './assets/icons/archer_wave.png', './assets/icons/archer_rain.png', './assets/icons/shield_charge.png', './assets/icons/stealth.png', './assets/icons/backstab.png', './assets/icons/double_jump.png', './assets/icons/cls_mage.png', './assets/icons/cls_archer.png', './assets/icons/cls_swordsman.png', './assets/icons/cls_assassin.png', './assets/icons/buff_shield.png', './assets/icons/buff_heal.png', './assets/icons/st_slow.png', './assets/icons/st_stun.png', './assets/icons/st_weak.png', './assets/icons/st_cleanse.png', './assets/icons/st_stealth.png', './assets/icons/st_down.png', './assets/icons/ui_sit.png', './assets/icons/ui_mode_big.png', './assets/icons/ui_mode_many.png', './assets/icons/ui_hp.png', './assets/icons/ui_mp.png', './assets/icons/ui_sp.png', './assets/icons/summon_water.png', './assets/icons/summon_fire.png', './assets/icons/summon_earth.png', './assets/icons/summon_dark.png', './assets/icons/summon_wind.png', './assets/icons/summon_light.png', './assets/icons/sp_wind_bolt.png', './assets/icons/sp_wind_wall.png', './assets/icons/sp_wind_sky.png', './assets/icons/sp_earth_bolt.png', './assets/icons/sp_earth_wall.png', './assets/icons/sp_earth_sky.png', './assets/icons/sp_water_bolt.png', './assets/icons/sp_water_wall.png', './assets/icons/sp_water_sky.png', './assets/icons/sp_fire_bolt.png', './assets/icons/sp_fire_wall.png', './assets/icons/sp_fire_sky.png', './assets/icons/quick_shot.png', './assets/icons/power_slash.png', './assets/icons/whirlwind.png', './assets/icons/knives.png', './assets/icons/sp_light_bolt.png', './assets/icons/sp_light_wall.png', './assets/icons/sp_light_sky.png', './assets/icons/sp_dark_bolt.png', './assets/icons/sp_dark_wall.png', './assets/icons/sp_dark_sky.png',
  './icons/icon-192.png', './icons/icon-512.png'
];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('magesandbox-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
