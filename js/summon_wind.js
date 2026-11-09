'use strict';
// 鎌鼬(風系召喚物,設計_魔法調整.md 第 14 節 S-2 / S-4)。以覆寫 SUMMON_KINDS.wind 的方式掛入 summons_core.js 的註冊表。
// 載入順序:summons_core.js → summon_wind.js。頂層不新增名稱,全部在 IIFE 內。
// 外觀:細長青綠鼬鼠,前爪為彎月風刃,尾巴為三節風絲。每隻 3 mesh(身體、尾、風刃)+ 1 sprite(風光)。
// 行為:AI 為 caster(框架處理遊走與站定);attack 自己管理前搖、技能冷卻與貼身撲咬。
//   · 真空刃:前搖 0.25 s(風刃發光);沿瞄準方向直線飛 26 m、36 m/s,穿透,每標靶一次,不擊退。
//   · 普攻:貼身 1.5 m 內撲咬,間隔 def.interval。
// 真空刃用 skills.js 的 flyProjectile 飛(生命週期由 addFx 管理,鎌鼬消散後仍會飛完)。
// 私有狀態放在 WeakMap(不寫進 unit 欄位)。

(function () {

const W_PRE = .25;                    // 真空刃前搖(s)
const W_RANGE = 26, W_SPEED = 36;     // 真空刃射程(m)、飛行速度(m/s)
const W_BITE_R = 1.5;                 // 撲咬距離(m)
const W_ST = new WeakMap();
const W_GEO = {};                     // 共用 geometry(第一次 build 時建立)
let W_MAT = null;                     // 共用身體材質(頂點色)

function wst(u) {
  let s = W_ST.get(u);
  if (!s) { s = { wnd: 0, fl: 0, atkFlag: false, trT: 0, born: false }; W_ST.set(u, s); }
  return s;
}

function wShared() {
  if (W_MAT) return;
  const E = EL.wind;
  const legs = [];
  for (const sx of [-1, 1]) for (const sz of [-.25, .25])
    legs.push({ geo: new THREE.BoxGeometry(.07, .2, .09), pos: [sx * .13, .1, sz], color: 0x2f7d66 });
  W_GEO.body = mergeParts([
    { geo: new THREE.CylinderGeometry(.12, .16, .8, 8), pos: [0, .32, 0], rot: [Math.PI / 2, 0, 0], color: 0xa6f2d4 },
    { geo: new THREE.SphereGeometry(.14, 8, 6), pos: [0, .36, .52], scl: [1, .9, 1.2], color: 0xc8fff0 },
    { geo: new THREE.ConeGeometry(.04, .08, 4), pos: [-.07, .5, .48], color: 0x5fc9a2 },
    { geo: new THREE.ConeGeometry(.04, .08, 4), pos: [.07, .5, .48], color: 0x5fc9a2 }
  ].concat(legs));
  // 尾巴:以尾根為原點,三節往後上方捲起(每節方向 d = (0, sin a, −cos a),繞 x 旋轉 a − π/2)
  const tailParts = [];
  let py = 0, pz = 0;
  for (let i = 0; i < 3; i++) {
    const a = .3 + .35 * i, dy = Math.sin(a), dz = -Math.cos(a);
    tailParts.push({ geo: new THREE.CylinderGeometry(.04 - .008 * i, .05 - .008 * i, .22, 6), pos: [0, py + dy * .1, pz + dz * .1], rot: [a - Math.PI / 2, 0, 0], color: 0x7ff0cc });
    py += dy * .2; pz += dz * .2;
  }
  W_GEO.tail = mergeParts(tailParts);
  // 風刃:左右前爪各一片半圓彎月(獨立 mesh,因為需要每隻各自的發光材質)
  W_GEO.blade = mergeParts([
    { geo: new THREE.RingGeometry(.06, .17, 12, 1, 0, Math.PI), pos: [-.17, .3, .44], rot: [0, 0, -.5], color: 0xeafff6 },
    { geo: new THREE.RingGeometry(.06, .17, 12, 1, 0, Math.PI), pos: [.17, .3, .44], rot: [0, 0, .5], color: 0xeafff6 }
  ]);
  W_GEO.body.userData.shared = true; W_GEO.tail.userData.shared = true; W_GEO.blade.userData.shared = true;
  W_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .8, emissive: E.hex, emissiveIntensity: .1 });
  W_MAT.userData.shared = true;
}

// 視線:沿途不被高台擋住(同 summons_core 的 smLOS)
function wLOS(u, t) {
  for (let i = 1; i <= 4; i++) {
    const f = i / 5, x = u.x + (t.x - u.x) * f, z = u.z + (t.z - u.z) * f;
    for (const P of PLATFORMS) if (platContains(P, x, z, 0) && platTop(P, x, z) > u.y + 1.5) return false;
  }
  return true;
}

// 螺旋粒子:出場(rise = true,由下往上捲)或消散(rise = false,往下散)
function wSwirl(u, n, rise) {
  const E = EL.wind, k = u.body ? u.body.scale.x : 1;
  for (let i = 0; i < n; i++) {
    const f = i / n, a = f * Math.PI * 4, r = .25 + .6 * f;
    const cx = u.x + Math.cos(a) * r, cz = u.z + Math.sin(a) * r;
    const cy = rise ? u.y + .1 + f * 1.6 * k : u.y + .2 + (1 - f) * 1.2 * k;
    fire.emit(cx, cy, cz, -Math.sin(a) * 2.2, rise ? .6 : -.3, Math.cos(a) * 2.2, .6, rnd(.08, .14), E.c0, E.c1, 1, .3, 0, .8);
  }
}

// 普攻:貼身撲咬(atkBase = def.atk × dmgK × scale)
function wBite(u, t) {
  const E = EL.wind;
  u.atkT = u.def.interval;
  t.hit(u.atkBase, t.x - u.x, t.z - u.z, 0, u.el);
  for (let i = 0; i < fq(6); i++) fire.emit(t.x + rnd(-.3, .3), t.y + rnd(.8, 1.6), t.z + rnd(-.3, .3), rnd(-2, 2), rnd(1, 3), rnd(-2, 2), .25, rnd(.06, .1), E.c0, E.c1, 1, .3, 0, .5);
}

// 真空刃:沿瞄準方向直線飛 26 m,穿透,每標靶一次 dmg = skill.dmg × dmgK × scale,不擊退
function wFire(u, t, S) {
  const E = EL.wind, st = wst(u), k = u.body.scale.x;
  u.skT = S.cd;
  st.fl = .25;
  const dx = t.x - u.x, dz = t.z - u.z, L = Math.hypot(dx, dz) || 1, sx = dx / L, sz = dz / L;
  const dmg = S.dmg * u.dmgK * u.scale;
  const from = new V3(u.x + sx * .6, u.y + .45 * k, u.z + sz * .6);
  const to = new V3(from.x + sx * W_RANGE, from.y, from.z + sz * W_RANGE);
  const mat = new THREE.MeshBasicMaterial({ color: E.hex, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 24, 1, 0, Math.PI), mat);   // 新月 geometry ×2(同第 4 項)
  burstRing(from, E.hex, .9);
  flyProjectile(from, to, W_SPEED, {
    mesh, hitR: 1.0, pierce: true,
    onHit: d => hitEl(d, dmg, 'wind', sx, sz, { knock: 1.5 * u.fxK }),   // 真空刃擊退 1.5 m
    trail: fq(2), c0: E.c0, c1: E.c1, stuck: .05,
    onEnd: p => burstRing(p, E.hex, .7)
  });
}

// 攻擊入口(框架:state === 'attack' 且有目標時每幀呼叫)
function wAttack(u, t, dt) {
  const st = wst(u), S = window.SUMMON_DEF.wind.skill, d = Math.hypot(t.x - u.x, t.z - u.z);
  st.atkFlag = true;
  if (u.skT <= 0 && d <= u.def.range && wLOS(u, t)) {
    if (st.wnd <= 0) st.wnd = W_PRE;
    st.wnd -= dt;
    if (st.wnd > 0) return;
    st.wnd = 0;
    wFire(u, t, S);
    return;
  }
  st.wnd = 0;
  if (d <= W_BITE_R && u.atkT <= 0) wBite(u, t);
}

// 外觀:身體 1、尾 1、風刃 1(每隻獨立材質以做發光)、風光 sprite 1
function wBuild(P, scale) {
  wShared();
  const E = EL.wind, k = window.SUMMON_DEF.wind.size * scale;
  const g = new THREE.Group();
  g.scale.setScalar(k);
  const body = new THREE.Mesh(W_GEO.body, W_MAT); body.castShadow = true; g.add(body);
  const tail = new THREE.Mesh(W_GEO.tail, W_MAT); tail.position.set(0, .32, -.42); g.add(tail);
  const blade = new THREE.Mesh(W_GEO.blade, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .4, emissive: E.hex, emissiveIntensity: .2, side: THREE.DoubleSide }));
  g.add(blade);
  const glow = glowSprite(E.hex, 1.2, .35); glow.position.set(0, .4, .2); g.add(glow);
  g.userData = { tail, blade };
  return g;
}

function wAnimate(u, dt) {
  const st = wst(u), ud = u.body.userData, E = EL.wind, b = u.body, k = b.scale.x, t = u.age;
  const run = u.state === 'seek' ? 1 : 0;
  if (!st.born) { st.born = true; wSwirl(u, fq(30), true); }
  if (!st.atkFlag) st.wnd = 0;         // 這一幀沒有在攻擊 → 前搖取消
  st.atkFlag = false;
  st.fl = Math.max(0, st.fl - dt);
  // 跑動:前傾、上下小跳;尾巴左右擺(跑得快擺得大)
  b.rotation.x = .12 * run;
  b.position.y = run ? Math.abs(Math.sin(t * 16)) * .03 : 0;
  ud.tail.rotation.y = Math.sin(t * (run ? 11 : 4)) * (run ? .35 : .18);
  // 風刃:前搖時逐漸發光,發射後短暫閃光
  const charge = st.wnd > 0 ? 1 - st.wnd / W_PRE : 0;
  ud.blade.material.emissiveIntensity = .2 + 2.2 * charge + (st.fl > 0 ? 2 : 0);
  if (st.wnd > 0 && Math.random() < .7) {
    const s = Math.sin(u.yaw), c = Math.cos(u.yaw), side = rnd(-.3, .3);
    fire.emit(u.x + s * .5 * k + c * side, u.y + .3 * k, u.z + c * .5 * k - s * side, -s * .6, rnd(-.2, .2), -c * .6, .25, rnd(.05, .1), E.c0, E.c1, 1, .3, 0, .5);
  }
  // 跑動殘影:每 0.08 s 在身後留下淡綠粒子
  st.trT -= dt;
  if (run && st.trT <= 0) {
    st.trT = .08;
    const bx = u.x - Math.sin(u.yaw) * .4 * k, bz = u.z - Math.cos(u.yaw) * .4 * k;
    for (let i = 0; i < fq(4); i++) fire.emit(bx + rnd(-.25, .25), u.y + rnd(.1, .5) * k, bz + rnd(-.25, .25), rnd(-.3, .3), rnd(0, .3), rnd(-.3, .3), .4, rnd(.1, .18), E.c0, E.c1, 1, .3, 0, .6);
  }
}

function wOnDeath(u) { wSwirl(u, fq(30), false); }

window.SUMMON_KINDS.wind = { build: wBuild, attack: wAttack, animate: wAnimate, onDeath: wOnDeath };

})();
