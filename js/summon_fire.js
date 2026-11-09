'use strict';
// 多頭火蛇(任務 S-2 / S-4 / S-5 / S-8)。覆寫 SUMMON_KINDS.fire 註冊項;全部放在 IIFE 內,頂層不新增名稱。
// 外觀:盤繞身體 1 mesh + 三個蛇頭各 1 mesh(共用同一份 geometry)+ 胸口火光 sprite 1。
// 攻擊:三頭依序突刺噴火;攻擊間隔 def.interval(0.35 s)一頭,每頭每 1.05 s 輪一次;單次 atkBase 直線判定。
(function () {

const SF_CACHE = {};                                   // 每屬性快取的合併 geometry / material(共用,不 dispose)
const SF_HEADS = [                                     // 三個頭的脖子根部(身體座標,乘 K 後使用);a = 初始偏角(左右兩頭向內收,三頭朝前方同一點)
  { bx: -.28, by: .5, bz: .2, a: .1, ph: 0 },
  { bx: 0, by: .62, bz: .3, a: 0, ph: 2.1 },
  { bx: .28, by: .5, bz: .2, a: -.1, ph: 4.2 }
];
const SF_LUNGE = 1.0, SF_LUNGE_OUT = .12, SF_LUNGE_BACK = .2;   // 突刺 1.0 m(前 0.12 s)、收回 0.2 s(公尺)
const SF_HALF = .4 + .5;                               // 判定寬 0.8(半寬 .4)+ 標靶半徑 .5
const SF_HIT = { t: 0 };                               // sfFirst 輸出的沿線投影距離(不每次配置物件)
const SF_V = { x: 0, y: 0, z: 0 };                     // sfWorld 輸出的世界座標

// 身體座標(已乘 K、未乘 scale)→ 世界座標,寫入 SF_V
function sfWorld(u, lx, ly, lz) {
  const s = u.scale, c = Math.cos(u.yaw), n = Math.sin(u.yaw);
  const x = lx * s, y = ly * s, z = lz * s;
  SF_V.x = u.x + x * c + z * n; SF_V.y = u.y + y; SF_V.z = u.z - x * n + z * c;
  return SF_V;
}
// 直線判定:從 (ox,oz) 沿 (dx,dz) 前方 len 內、距中線 < hw 的第一個活標靶;投影距離寫入 SF_HIT.t
function sfFirst(ox, oz, dx, dz, len, hw) {
  let best = null, bt = Infinity;
  for (const d of DUMMIES) {
    if (d.dead) continue;
    const rx = d.x - ox, rz = d.z - oz, pr = rx * dx + rz * dz;
    if (pr < 0 || pr > len) continue;
    if (Math.abs(rx * dz - rz * dx) > hw) continue;
    if (pr < bt) { bt = pr; best = d; }
  }
  SF_HIT.t = bt; return best;
}

function sfCache() {
  if (SF_CACHE.mat) return SF_CACHE;
  const K = window.SUMMON_DEF.fire.size;
  const coil = mergeParts([
    { geo: new THREE.TorusGeometry(.5 * K, .16 * K, 6, 18, 4.9), pos: [0, .16 * K, 0], rot: [Math.PI / 2, 0, 0], color: 0x8c2a14 },
    { geo: new THREE.SphereGeometry(.34 * K, 8, 6), pos: [0, .42 * K, 0], scl: [1, .8, 1], color: 0xa8361a },
    { geo: new THREE.ConeGeometry(.14 * K, .9 * K, 5), pos: [0, .16 * K, -.6 * K], rot: [-Math.PI / 2, 0, 0], color: 0xff7a1a }
  ]);
  const head = mergeParts([                            // 原點 = 脖子根部,頭朝 +z
    { geo: new THREE.CylinderGeometry(.13 * K, .16 * K, .5 * K, 6), pos: [0, .25 * K, 0], color: 0x9a2a10 },
    { geo: new THREE.BoxGeometry(.34 * K, .26 * K, .56 * K), pos: [0, .62 * K, .14 * K], color: 0xb83a14 },
    { geo: new THREE.BoxGeometry(.3 * K, .1 * K, .42 * K), pos: [0, .46 * K, .14 * K], color: 0x7a1e12 },
    { geo: new THREE.BoxGeometry(.07 * K, .07 * K, .07 * K), pos: [-.12 * K, .7 * K, .36 * K], color: 0xffe27a },
    { geo: new THREE.BoxGeometry(.07 * K, .07 * K, .07 * K), pos: [.12 * K, .7 * K, .36 * K], color: 0xffe27a }
  ]);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .8, emissive: 0xff5a14, emissiveIntensity: .22 });
  coil.userData.shared = true; head.userData.shared = true; mat.userData.shared = true;
  SF_CACHE.coil = coil; SF_CACHE.head = head; SF_CACHE.mat = mat;
  return SF_CACHE;
}

function sfBuild(P, scale) {
  const C = sfCache(), K = window.SUMMON_DEF.fire.size;
  const root = new THREE.Group(); root.scale.setScalar(scale);
  const coil = new THREE.Mesh(C.coil, C.mat); coil.castShadow = true; root.add(coil);
  const heads = [];
  for (const hd of SF_HEADS) {
    const m = new THREE.Mesh(C.head, C.mat);
    const bx = hd.bx * K, by = hd.by * K, bz = hd.bz * K;
    m.position.set(bx, by, bz); m.rotation.y = hd.a; root.add(m);
    heads.push({ mesh: m, bx, by, bz, a: hd.a, ph: hd.ph, lt: -1 });
  }
  const spr = glowSprite(EL.fire.hex, 1.1, .6);
  spr.position.set(0, .45 * K, .3 * K); root.add(spr);
  root.userData.st = { coil, heads, spr, next: 0, emb: 0 };
  return root;
}

function sfAttack(u, t, dt) {
  if (u.atkT > 0) return;
  const st = u.body.userData.st, K = window.SUMMON_DEF.fire.size, E = EL.fire;
  u.atkT = u.def.interval;
  const h = st.heads[st.next]; st.next = (st.next + 1) % st.heads.length;
  h.lt = 0;                                            // 開始突刺
  const a = h.mesh.rotation.y, sa = Math.sin(a), ca = Math.cos(a);
  sfWorld(u, h.bx + .46 * K * sa, h.by + .52 * K, h.bz + .46 * K * ca);   // 口部
  const ox = SF_V.x, oy = SF_V.y, oz = SF_V.z;
  const dx = Math.sin(u.yaw + a), dz = Math.cos(u.yaw + a);
  for (let i = 0; i < fq(14); i++) {                   // 噴火錐:12 m/s、life .3
    const v = rnd(10, 14);
    fire.emit(ox + rnd(-.1, .1), oy + rnd(-.1, .1), oz + rnd(-.1, .1), dx * v + rnd(-.8, .8), rnd(-.5, .5), dz * v + rnd(-.8, .8), .3, rnd(.22, .36), E.c0, E.c1, 1, .3, 0, .3);
  }
  const d = sfFirst(ox, oz, dx, dz, u.def.range, SF_HALF);
  if (d) d.hit(u.atkBase, dx, dz, 1.5 * u.fxK, 'fire');   // 燃燒 1.5 × fxK 秒
}

function sfAnimate(u, dt) {
  const st = u.body.userData.st, K = window.SUMMON_DEF.fire.size, E = EL.fire, inv = 1 / u.scale;
  st.coil.rotation.y = Math.sin(u.age * 2.2) * .15;   // 身體蛇行 ±.15 rad
  for (const h of st.heads) {
    let off = 0;
    if (h.lt >= 0) {
      h.lt += dt;
      if (h.lt < SF_LUNGE_OUT) off = h.lt / SF_LUNGE_OUT;
      else if (h.lt < SF_LUNGE_OUT + SF_LUNGE_BACK) off = 1 - (h.lt - SF_LUNGE_OUT) / SF_LUNGE_BACK;
      else h.lt = -1;
    }
    const a = h.a + Math.sin(u.age * 1.3 + h.ph) * .12, sa = Math.sin(a), ca = Math.cos(a), L = off * SF_LUNGE * inv;
    h.mesh.rotation.y = a;
    h.mesh.position.set(h.bx + sa * L, h.by, h.bz + ca * L);
  }
  st.spr.material.opacity = .5 + .25 * Math.sin(u.age * 9);
  st.emb += dt * 8;                                    // 胸口飄火星
  while (st.emb >= 1) {
    st.emb -= 1;
    sfWorld(u, rnd(-.3, .3) * K, .6 * K, rnd(-.2, .2) * K);
    fire.emit(SF_V.x, SF_V.y, SF_V.z, rnd(-.3, .3), rnd(.8, 1.6), rnd(-.3, .3), rnd(.5, .8), rnd(.1, .16), E.c0, E.c1, 1, .3, 0, .5);
  }
}

function sfOnDeath(u) {                                // 化為火星與黑煙
  const E = EL.fire;
  for (let i = 0; i < fq(14); i++) fire.emit(u.x + rnd(-.6, .6), u.y + rnd(.2, 1.2), u.z + rnd(-.6, .6), rnd(-1, 1), rnd(2, 4), rnd(-1, 1), .9, rnd(.12, .2), E.c0, E.c1, 1, .3, 0, .4);
  for (let i = 0; i < fq(8); i++) smoke.emit(u.x + rnd(-.5, .5), u.y + .8, u.z + rnd(-.5, .5), rnd(-.4, .4), rnd(.8, 1.6), rnd(-.4, .4), 1.4, rnd(.9, 1.3), E.s0, E.s1, .55, 2, -.1, .6);
}

window.SUMMON_KINDS.fire = { build: sfBuild, attack: sfAttack, animate: sfAnimate, onDeath: sfOnDeath };

})();
