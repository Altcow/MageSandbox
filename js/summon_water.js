'use strict';
// 水元素精靈(任務 S-2 / S-4 / S-5 / S-8)。覆寫 SUMMON_KINDS.water 註冊項;全部放在 IIFE 內,頂層不新增名稱。
// 外觀:水球身體(水滴形 + 雙手 + 頭上水滴冠)合併 1 mesh + 光環 1 mesh + 水柱 1 mesh + 核心光 sprite 1。
// 攻擊:遠距離噴水柱,直線命中第一個標靶;命中造成傷害並減速 2 s(0.3 × fxK);水柱 0.5 s 淡出。
(function () {

const SW_CACHE = {};                                   // 快取的合併 geometry / material(共用,不 dispose)
const SW_HIT = { t: 0 };                               // swFirst 輸出的沿線投影距離
const SW_V = { x: 0, y: 0, z: 0 };                     // swWorld 輸出的世界座標
const SW_BEAM_T = .5, SW_HALF = .5 + .12;              // 水柱時間 0.5 s;判定半寬 = 標靶半徑 .5 + 水柱半寬 .12

// 身體座標(已乘 K、未乘 scale)→ 世界座標,寫入 SW_V
function swWorld(u, lx, ly, lz) {
  const s = u.scale, c = Math.cos(u.yaw), n = Math.sin(u.yaw);
  const x = lx * s, y = ly * s, z = lz * s;
  SW_V.x = u.x + x * c + z * n; SW_V.y = u.y + y; SW_V.z = u.z - x * n + z * c;
  return SW_V;
}
// 直線判定:從 (ox,oz) 沿 (dx,dz) 前方 len 內、距中線 < hw 的第一個活標靶;投影距離寫入 SW_HIT.t
function swFirst(ox, oz, dx, dz, len, hw) {
  let best = null, bt = Infinity;
  for (const d of DUMMIES) {
    if (d.dead) continue;
    const rx = d.x - ox, rz = d.z - oz, pr = rx * dx + rz * dz;
    if (pr < 0 || pr > len) continue;
    if (Math.abs(rx * dz - rz * dx) > hw) continue;
    if (pr < bt) { bt = pr; best = d; }
  }
  SW_HIT.t = bt; return best;
}

function swCache() {
  if (SW_CACHE.mat) return SW_CACHE;
  const E = EL.water, K = window.SUMMON_DEF.water.size;
  const body = mergeParts([
    { geo: new THREE.SphereGeometry(.42 * K, 12, 9), pos: [0, .62 * K, 0], color: 0x9fdcff },
    { geo: new THREE.ConeGeometry(.42 * K, .6 * K, 8), pos: [0, .3 * K, 0], rot: [Math.PI, 0, 0], color: 0x3aa8ff },
    { geo: new THREE.CylinderGeometry(.07 * K, .07 * K, .45 * K, 5), pos: [-.5 * K, .62 * K, 0], rot: [0, 0, -.6], color: 0x9fdcff },
    { geo: new THREE.CylinderGeometry(.07 * K, .07 * K, .45 * K, 5), pos: [.5 * K, .62 * K, 0], rot: [0, 0, .6], color: 0x9fdcff },
    { geo: new THREE.ConeGeometry(.14 * K, .36 * K, 6), pos: [0, 1.16 * K, 0], color: 0xbfe8ff }
  ]);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .8, emissive: E.hex, emissiveIntensity: .25, transparent: true, opacity: .8 });
  const ring = new THREE.TorusGeometry(.5 * K, .04 * K, 6, 22);
  const ringMat = new THREE.MeshBasicMaterial({ color: E.core, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false });
  const beamGeo = new THREE.BoxGeometry(1, 1, 1);
  body.userData.shared = true; mat.userData.shared = true; ring.userData.shared = true; ringMat.userData.shared = true; beamGeo.userData.shared = true;
  SW_CACHE.body = body; SW_CACHE.mat = mat; SW_CACHE.ring = ring; SW_CACHE.ringMat = ringMat; SW_CACHE.beamGeo = beamGeo;
  return SW_CACHE;
}

function swBuild(P, scale) {
  const C = swCache(), K = window.SUMMON_DEF.water.size, E = EL.water;
  const root = new THREE.Group(); root.scale.setScalar(scale);
  const core = new THREE.Mesh(C.body, C.mat); core.castShadow = true; root.add(core);
  const spin = new THREE.Group(); spin.position.y = .62 * K; root.add(spin);   // 光環:外層自轉、內層傾斜
  const tilt = new THREE.Group(); tilt.rotation.x = .35; spin.add(tilt);
  const ring = new THREE.Mesh(C.ring, C.ringMat); ring.rotation.x = Math.PI / 2; tilt.add(ring);
  const beam = new THREE.Mesh(C.beamGeo, new THREE.MeshBasicMaterial({ color: E.hex, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.visible = false; root.add(beam);
  const spr = glowSprite(E.hex, 1.4, .5);
  spr.position.set(0, .62 * K, 0); root.add(spr);
  root.userData.st = { core, spin, beam, spr, K, beamT: 0, beamL: 0 };
  return root;
}

function swAttack(u, t, dt) {
  if (u.atkT > 0) return;
  const st = u.body.userData.st, K = st.K, E = EL.water;
  u.atkT = u.def.interval;
  swWorld(u, 0, .66 * K, .44 * K);                     // 嘴部
  const ox = SW_V.x, oy = SW_V.y, oz = SW_V.z;
  const dx = Math.sin(u.yaw), dz = Math.cos(u.yaw);
  const d = swFirst(ox, oz, dx, dz, u.def.range, SW_HALF);
  const L = d ? SW_HIT.t : u.def.range;
  st.beamL = L / u.scale; st.beamT = SW_BEAM_T;
  for (let i = 0; i < fq(10); i++) {                   // 沿水柱的水滴
    const s = Math.random() * L;
    fire.emit(ox + dx * s + rnd(-.1, .1), oy + rnd(-.1, .1), oz + dz * s + rnd(-.1, .1), dx * rnd(4, 7), rnd(-.3, .3), dz * rnd(4, 7), .4, rnd(.12, .2), E.c0, E.c1, 1, .3, 0, .4);
  }
  if (!d) return;
  d.hit(u.atkBase, dx, dz, 0, 'water');
  d.slow(2, .3 * u.fxK);                               // 減速 2 s、0.3 × fxK
  if (d.chill) d.chill(1);                             // 寒意 +1
  const hx = ox + dx * L, hz = oz + dz * L;
  for (let i = 0; i < fq(12); i++) {                   // 命中處濺水
    fire.emit(hx + rnd(-.3, .3), oy + rnd(0, .4), hz + rnd(-.3, .3), rnd(-2.5, 2.5), rnd(1, 3.5), rnd(-2.5, 2.5), .6, rnd(.12, .2), E.c0, E.c1, 1, .3, 9, .3);
  }
}

function swAnimate(u, dt) {
  const st = u.body.userData.st, K = st.K, inv = 1 / u.scale;
  u.body.position.y = Math.sin(u.age * 2.4) * .15 * inv;   // 上下浮動 .15 m
  st.core.scale.setScalar(1 + .05 * Math.sin(u.age * 3));  // 身體呼吸 ±5%
  st.spin.rotation.y = u.age * 2;
  st.spr.material.opacity = .4 + .15 * Math.sin(u.age * 5);
  if (st.beamT > 0) {
    st.beamT -= dt;
    const p = Math.min(1, Math.max(0, 1 - st.beamT / SW_BEAM_T)), w = (.25 + (.1 - .25) * p) * inv;
    st.beam.visible = st.beamT > 0;
    st.beam.scale.set(w, w, st.beamL);
    st.beam.position.set(0, .66 * K, .44 * K + st.beamL / 2);
    st.beam.material.opacity = .9 * (1 - p);
  }
}

function swOnDeath(u) {                                // 化為水滴落下
  const E = EL.water;
  for (let i = 0; i < fq(20); i++) fire.emit(u.x + rnd(-.4, .4), u.y + rnd(.2, 1.2), u.z + rnd(-.4, .4), rnd(-.4, .4), rnd(0, 1), rnd(-.4, .4), .9, rnd(.12, .2), E.c0, E.c1, 1, .3, 9, .2);
}

window.SUMMON_KINDS.water = { build: swBuild, attack: swAttack, animate: swAnimate, onDeath: swOnDeath };

})();
