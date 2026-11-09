'use strict';
// 六翼熾天使(光系召喚物,設計_魔法調整.md 第 14 節 S-2 / S-4 / S-6)。以覆寫 SUMMON_KINDS.light 的方式掛入 summons_core.js 的註冊表。
// 載入順序:summons_core.js → summon_light.js。頂層不新增名稱,全部在 IIFE 內。
// 外觀:金白色天使剪影,六片翅膀(左右各三片,合併成兩個 mesh 後繞根部拍動)、頭上光環、金色光劍。
//       每隻 5 mesh(身體、光環、左翼、右翼、劍臂)+ 2 sprite(光暈、光環光)。
// 行為:AI 為 support(框架處理跟隨 / 找標靶 / 治癒 / 護盾 / 淨化);本檔負責
//   · 普攻:近距離橫掃光劍(0.3 s),atkBase、間隔 def.interval,淡金扇形刀光(arcSlash)。
//   · 治癒 / 護盾 / 淨化發動時的視覺提示(由框架的計時欄位上跳偵測,不改框架)。
//   · 出場光柱、消散羽毛上升。
// 私有狀態放在 WeakMap(不寫進 unit 欄位)。

(function () {

const L_SWING = .3;                   // 劍臂橫掃時間(s)
const L_SHEAD = 1.98;                 // 光環中心高度(模型座標,未乘 k)
const L_ST = new WeakMap();
const L_GEO = {};                     // 共用 geometry(第一次 build 時建立)
let L_MAT = null;                     // 共用身體材質(頂點色)

function lst(u) {
  let s = L_ST.get(u);
  if (!s) { s = { sw: 0, flash: 0, born: false, hT: undefined, sT: 0, cT: 0 }; L_ST.set(u, s); }
  return s;
}

// 翅膀:單側三片羽(錐體壓扁),根部在原點,向外(sign = 1 左 / −1 右)展開;t 為與豎直軸夾角
function lWing(sign) {
  const parts = [], th = [-.35, -.1, .2], cols = [0xfff8e6, 0xffe39a, 0xffd27a];
  th.forEach((a, i) => {
    const t = Math.PI / 2 + a;
    const dx = -Math.sin(t) * sign, dy = Math.cos(t);
    parts.push({ geo: new THREE.ConeGeometry(.09, .8, 4), pos: [dx * .4, dy * .4, 0], rot: [0, 0, t * sign], scl: [1, 1, .4], color: cols[i] });
  });
  return mergeParts(parts);
}

function lShared() {
  if (L_MAT) return;
  const E = EL.light;
  L_GEO.body = mergeParts([
    { geo: new THREE.ConeGeometry(.42, 1.0, 10), pos: [0, .5, 0], color: 0xf4ecd8 },                  // 長袍(下寬上窄)
    { geo: new THREE.BoxGeometry(.5, .06, .34), pos: [0, .98, 0], color: 0xffd27a },                 // 腰帶
    { geo: new THREE.CylinderGeometry(.2, .24, .5, 10), pos: [0, 1.2, 0], color: 0xfff8e6 },         // 軀幹
    { geo: new THREE.CylinderGeometry(.07, .08, .12, 8), pos: [0, 1.5, 0], color: 0xffe9c8 },        // 頸
    { geo: new THREE.SphereGeometry(.18, 12, 10), pos: [0, 1.66, 0], color: 0xffe9c8 }               // 頭
  ]);
  L_GEO.wingL = lWing(1);
  L_GEO.wingR = lWing(-1);
  // 光劍臂:肩為原點,往前(+z)伸出;手臂 + 光劍細箱
  L_GEO.arm = mergeParts([
    { geo: new THREE.CylinderGeometry(.06, .05, .55, 6), pos: [0, 0, .275], rot: [Math.PI / 2, 0, 0], color: 0xf4ecd8 },
    { geo: new THREE.BoxGeometry(.03, .015, .6), pos: [0, 0, .85], color: 0xffe9a0 }
  ]);
  L_GEO.halo = new THREE.TorusGeometry(.3, .03, 8, 28);
  for (const k of ['body', 'wingL', 'wingR', 'arm', 'halo']) L_GEO[k].userData.shared = true;
  L_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .7, emissive: E.hex, emissiveIntensity: .12 });
  L_MAT.userData.shared = true;
}

// 螺旋 / 羽毛粒子:出場(光柱後的羽毛)與消散(羽毛上升)
function lFeathers(u, n, up) {
  const E = EL.light, k = u.body ? u.body.scale.x : 1;
  for (let i = 0; i < n; i++) {
    const x = u.x + rnd(-.4, .4), z = u.z + rnd(-.4, .4), y = u.y + rnd(.2, 1.6) * k;
    if (up) fire.emit(x, y, z, rnd(-.3, .3), rnd(.6, 1.2), rnd(-.3, .3), 1.2, rnd(.12, .2), E.c0, E.c1, 1, .3, -.1, .3);
    else fire.emit(x, y, z, rnd(-.6, .6), rnd(-.2, .2), rnd(-.6, .6), .8, rnd(.1, .18), E.c0, E.c1, 1, .3, .4, .6);
  }
}

// 普攻:橫掃光劍,命中當下扣血並播 0.3 s 淡金扇形刀光
function lAttack(u, t) {
  const st = lst(u);
  if (u.atkT > 0 || st.sw > 0) return;
  u.atkT = u.def.interval;
  st.sw = L_SWING;
  t.hit(u.atkBase, t.x - u.x, t.z - u.z, 0, u.el);
  arcSlash(new V3(u.x, u.y, u.z), 2.2, u.yaw, EL.light.hex, .35);
}

// 治癒 / 護盾 / 淨化的視覺提示。玩家在 10 m 內才顯示(框架內的判定相同)
function lHaloPos(u) { return new V3(u.x, u.y + L_SHEAD * u.body.scale.x, u.z); }
function lHealFx(u, pp) {
  const E = EL.light;
  burstRing(lHaloPos(u), 0xfff6c0, 2.0);
  for (let i = 0; i < fq(10); i++) fire.emit(pp.x + rnd(-.7, .7), pp.y + rnd(.1, .4), pp.z + rnd(-.7, .7), rnd(-.2, .2), rnd(1, 2.2), rnd(-.2, .2), .9, rnd(.12, .22), E.c0, E.c1, 1, .3, -.2, .4);
}
function lShieldFx(u, pp) {
  burstRing(new V3(pp.x, pp.y + 1.0, pp.z), 0xffe9a0, 1.6);
  for (let i = 0; i < fq(8); i++) {
    const a = rnd(0, 6.283);
    fire.emit(pp.x + Math.cos(a) * 1.0, pp.y + rnd(.6, 1.6), pp.z + Math.sin(a) * 1.0, 0, rnd(.2, .6), 0, .8, rnd(.1, .16), EL.light.c0, EL.light.c1, 1, .3, 0, .5);
  }
}
function lCleanseFx(u) {
  const E = EL.light;
  for (let i = 0; i < fq(14); i++) fire.emit(u.x + rnd(-.3, .3), u.y + rnd(.2, 1.2) * u.body.scale.x, u.z + rnd(-.3, .3), rnd(-.2, .2), rnd(1.5, 2.8), rnd(-.2, .2), .8, rnd(.12, .2), E.c0, E.c1, 1, .3, -.2, .4);
}

// 外觀:身體 1、光環 1、左翼 1、右翼 1、劍臂 1;光暈 sprite 1、光環光 sprite 1
function lBuild(P, scale) {
  lShared();
  const E = EL.light, k = window.SUMMON_DEF.light.size * scale * .55;
  const g = new THREE.Group();
  g.scale.setScalar(k);
  const body = new THREE.Mesh(L_GEO.body, L_MAT); body.castShadow = true; g.add(body);
  const wl = new THREE.Mesh(L_GEO.wingL, L_MAT); wl.position.set(-.12, 1.42, -.12); g.add(wl);
  const wr = new THREE.Mesh(L_GEO.wingR, L_MAT); wr.position.set(.12, 1.42, -.12); g.add(wr);
  const arm = new THREE.Mesh(L_GEO.arm, L_MAT); arm.position.set(.24, 1.36, 0); arm.rotation.x = .35; g.add(arm);
  const halo = new THREE.Mesh(L_GEO.halo, new THREE.MeshBasicMaterial({ color: 0xfff6c0, transparent: true, opacity: .85, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.position.set(0, L_SHEAD, 0); halo.rotation.x = Math.PI / 2; g.add(halo);
  const aura = glowSprite(E.hex, 2.8, .2); aura.position.set(0, 1.0, 0); g.add(aura);
  const hglow = glowSprite(0xffffff, .9, .45); hglow.position.set(0, L_SHEAD, 0); g.add(hglow);
  g.userData = { wingL: wl, wingR: wr, arm, halo, bodyMesh: body };
  return g;
}

function lAnimate(u, dt) {
  const st = lst(u), ud = u.body.userData, b = u.body, t = u.age;
  if (!st.born) { st.born = true; beam(new V3(u.x, u.y + 6, u.z), new V3(u.x, u.y + .3, u.z), EL.light, .25, .6); lFeathers(u, fq(20), true); }
  // 翅膀:1.2 Hz、±0.35 rad 拍動;左翼根在 −x,拍上時 rotation.z 取負,右翼相反
  const f = Math.sin(t * 7.54) * .35;
  ud.wingL.rotation.z = -f; ud.wingR.rotation.z = f;
  // 浮空上下 ±0.1 m(模型 0.2 m 振幅)
  b.position.y = Math.sin(t * 2.2) * .1;
  // 光劍橫掃:0.3 s 內從右往左掃過(rotation.y 由 1.0 → −1.0)
  if (st.sw > 0) {
    st.sw = Math.max(0, st.sw - dt);
    const p = 1 - st.sw / L_SWING, e = 1 - (1 - p) * (1 - p);
    ud.arm.rotation.y = 1.0 - 2.0 * e;
  } else ud.arm.rotation.y = damp(ud.arm.rotation.y, 0, 10, dt);
  // 光環:閃光衰減,平時微微脈動
  st.flash = Math.max(0, st.flash - dt);
  ud.halo.material.opacity = .75 + .25 * Math.sin(t * 3);
  ud.halo.material.color.setHex(st.flash > 0 ? 0xffffff : 0xfff6c0);
  // 治癒 / 護盾 / 淨化:框架在發動時把計時欄位跳回間隔值,這裡偵測上跳
  const pp = (typeof mage !== 'undefined' && mage.root) ? mage.root.position : null;
  const near = !!pp && Math.hypot(u.x - pp.x, u.z - pp.z) <= 10;
  if (st.hT === undefined) { st.hT = u.healT; st.sT = u.shT; st.cT = u.clT; }
  if (near && u.healT > st.hT) { lHealFx(u, pp); st.flash = .4; }
  if (near && u.shT > st.sT) { lShieldFx(u, pp); st.flash = .4; }
  if (u.clT > st.cT && typeof G !== 'undefined' && (G.stun || G.weak)) { lCleanseFx(u); st.flash = .6; }
  st.hT = u.healT; st.sT = u.shT; st.cT = u.clT;
}

function lOnDeath(u) { lFeathers(u, fq(20), true); }

window.SUMMON_KINDS.light = { build: lBuild, attack: lAttack, animate: lAnimate, onDeath: lOnDeath };

})();
