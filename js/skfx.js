'use strict';
// 劍技青光特效與受擊反應(設計_劍技光效與受擊反應.md):
//   色票 SKC / SK_AURA(除法杖外所有武器技能的集氣光、出手光統一用螢光青 #3ee8ff:白熱核心 + 青藍外暈,加色混合)、
//   發動特效積木 skTrail(光軌)/ skLine(直線光)/ skFlash(閃光)與物件上限、可見度判斷 skOk、
//   受擊反應挑選 reactFromHit / mageReact(只動 Doll 外觀,不碰任何判定值)、動作 id 的本機紀錄 G.act(快照 a 欄位)。
// 載入順序:skills.js 之後、skills_archer.js 之前(只在執行期才讀 scene / G / REMOTES 等全域)。
const SKC = { main: 0x3ee8ff, core: 0xeaffff, deep: 0x0a9fd0 };
// 形狀同 auraOf() 回傳值(hex / core / c0 / c1 / s0 / s1 / css0 / css1 / dark),cast 函式透過 casterAura(P) 直接拿到青色
const SK_AURA = { name: '劍技', hex: SKC.main, core: SKC.core, c0: [.85, 1, 1], c1: [.1, .75, 1], s0: [.85, 1, 1], s1: [.1, .75, 1], css0: '#3ee8ff', css1: '#0a9fd0', dark: false };
const SK_CAP = { trail: IS_TOUCH ? 8 : 16, line: IS_TOUCH ? 8 : 18 };   // 同時數量上限(視覺放大後落地裂光多條,線上限略提高)
const SK_LIVE = { trail: [], line: [] };
let SK_TEX = null, SK_MAT = null;
const SK_STRENGTH = { k: 1 };   // P 面板「劍技光強度」(0~1.5)

function skShared() {
  if (SK_MAT) return;
  const c = document.createElement('canvas'); c.width = 64; c.height = 8;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 8);   // 橫切面:中心白芯 → 青 → 藍暈 → 透明
  gr.addColorStop(0, 'rgba(10,159,208,0)'); gr.addColorStop(.25, 'rgba(62,232,255,.75)'); gr.addColorStop(.5, 'rgba(234,255,255,1)'); gr.addColorStop(.75, 'rgba(62,232,255,.75)'); gr.addColorStop(1, 'rgba(10,159,208,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 8);
  SK_TEX = new THREE.CanvasTexture(c);
  SK_MAT = new THREE.MeshBasicMaterial({ map: SK_TEX, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
}
// 可見度(§2-3):潛行 / 煙霧圈內 / 透明 < .5 的施放者不畫任何青光;本機看 mage.opq,遠端看 RemotePlayer 的 _op 與 g.visible
function skOk(P) {
  if (!P || !P.net) return mage.opq >= .5;
  const rp = typeof REMOTES !== 'undefined' ? REMOTES[String(P.net)] : null;
  return !rp || (rp.g.visible && (rp._op == null || rp._op >= .5));
}
const skGlowK = () => mage.opq >= .5 ? mage.opq : 0;
function skLimit(kind, inst) {
  const L = SK_LIVE[kind]; L.push(inst);
  while (L.length > SK_CAP[kind]) { const o = L.shift(); o.kill(); }
}
function skDone(kind, inst) { const i = SK_LIVE[kind].indexOf(inst); if (i >= 0) SK_LIVE[kind].splice(i, 1); }

/* ---------- 光軌:沿「相對面向的弧線」掃過的動態三角帶(三層:白芯 + 青暈 + 外層淡暈;只放大視覺,不改判定) ---------- */
// pos = 施放者位置(腳)、yaw = 面向;tpl = { a0, a1(度,相對面向,正 = 右側), r0, r1(m), y0, y1(高度 m), tilt(度,光帶傾角:0 平放、90 直立), dur(掃過秒數), life(殘留秒數), w(寬度倍率) }
// opt.mirror:左右鏡像;opt.follow(caster 物件 { root.position }):跟著施放者平移
const SK_VIS = { r: 1.55, w: 2.1, spark: 1 };   // 視覺放大倍率:半徑(長度)、寬度、火花量(P 面板可調)
const SK_LAYERS = [{ k: 2.3, b: .32, c: [.1, .55, .95] }, { k: 1, b: 1, c: [.22, .9, 1] }, { k: .34, b: 1, c: [1, 1, 1] }];
function skTrail(pos, yaw, tpl, opt) {
  opt = opt || {};
  if (SK_STRENGTH.k <= 0) return;
  skShared();
  const N = IS_TOUCH ? 10 : 16, NL = IS_TOUCH ? 2 : 3, LY = IS_TOUCH ? [SK_LAYERS[0], SK_LAYERS[1]] : SK_LAYERS, V = (N + 1) * 2;
  const D = Math.PI / 180, sg = opt.mirror ? -1 : 1, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
  const P = new Float32Array(V * NL * 3), C = new Float32Array(V * NL * 3), UV = new Float32Array(V * NL * 2), IX = [];
  const ox = pos.x, oy = pos.y, oz = pos.z, hw0 = .22 * (tpl.w || 1) * SK_VIS.w, tl = (tpl.tilt || 0) * D * sg, RK = SK_VIS.r;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, a = lerp(tpl.a0, tpl.a1, u) * D * sg, r = lerp(tpl.r0, tpl.r1, u) * RK, y = lerp(tpl.y0, tpl.y1, u) * (1 + (RK - 1) * .35);
    const dx = fx * Math.cos(a) + rx * Math.sin(a), dz = fz * Math.cos(a) + rz * Math.sin(a);
    pts.push([dx * r, y, dz * r, dx, dz]);
  }
  for (let l = 0; l < NL; l++) {
    const hw = hw0 * LY[l].k;
    for (let i = 0; i <= N; i++) {
      const p = pts[i], q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(N, i + 1)];
      let tx = q1[0] - q0[0], ty = q1[1] - q0[1], tz = q1[2] - q0[2]; const tL = Math.hypot(tx, ty, tz) || 1; tx /= tL; ty /= tL; tz /= tL;
      let wx = p[3] * Math.cos(tl), wy = Math.sin(tl), wz = p[4] * Math.cos(tl);   // 寬度方向 = 徑向與垂直方向依 tilt 混合,再與切線正交
      const d = wx * tx + wy * ty + wz * tz; wx -= tx * d; wy -= ty * d; wz -= tz * d;
      let wl = Math.hypot(wx, wy, wz);
      if (wl < .25) { wx = -tz; wy = 0; wz = tx; wl = Math.hypot(wx, wz) || 1; }   // 退化(光帶與切線平行):改用水平側向
      wx = wx / wl * hw; wy = wy / wl * hw; wz = wz / wl * hw;
      const vi = (l * (N + 1) + i) * 2, j = vi * 3;
      P[j] = ox + p[0] + wx; P[j + 1] = oy + p[1] + wy; P[j + 2] = oz + p[2] + wz; P[j + 3] = ox + p[0] - wx; P[j + 4] = oy + p[1] - wy; P[j + 5] = oz + p[2] - wz;
      UV[vi * 2] = i / N; UV[vi * 2 + 1] = 0; UV[vi * 2 + 2] = i / N; UV[vi * 2 + 3] = 1;
      if (i < N) IX.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  const ca = new THREE.BufferAttribute(C, 3); ca.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('color', ca); geo.setIndex(IX);
  const mesh = new THREE.Mesh(geo, SK_MAT); mesh.frustumCulled = false; mesh.renderOrder = 8; scene.add(mesh);
  let t = 0, dead = false;
  const inst = { kill() { if (dead) return; dead = true; scene.remove(mesh); geo.dispose(); skDone('trail', inst); } };
  skLimit('trail', inst);
  const dur = tpl.dur || .08, life = (tpl.life || .2) * 1.3, K = SK_STRENGTH.k, sparkN = IS_TOUCH ? 1 : 2, headP = new V3(), vis = !opt.noSpark;
  addFx(dt => {
    if (dead) return false;
    t += dt;
    if (opt.follow) { const p = opt.follow.root ? opt.follow.root.position : opt.follow; mesh.position.set(p.x - ox, p.y - oy, p.z - oz); }
    const h = Math.min(1, t / dur), f = t > dur ? Math.max(0, 1 - (t - dur) / life) : 1;
    if (t > dur + life) { inst.kill(); return false; }
    for (let l = 0; l < NL; l++) for (let i = 0; i <= N; i++) {
      const u = i / N, b = (u <= h ? Math.pow(Math.max(0, 1 - (h - u) / .9), 1.4) * f * K : 0) * LY[l].b, c = LY[l].c, j = (l * (N + 1) + i) * 6;
      C[j] = C[j + 3] = b * c[0]; C[j + 1] = C[j + 4] = b * c[1]; C[j + 2] = C[j + 5] = b * c[2];
    }
    ca.needsUpdate = true;
    if (vis && t <= dur + .05 && SK_VIS.spark > 0) {   // 揮砍前端噴青白火花
      const pi = pts[Math.min(N, Math.round(h * N))], mp = opt.follow ? (opt.follow.root ? opt.follow.root.position : opt.follow) : pos;
      headP.set((opt.follow ? mp.x : ox) + pi[0], (opt.follow ? mp.y : oy) + pi[1], (opt.follow ? mp.z : oz) + pi[2]);
      for (let k = 0; k < sparkN * SK_VIS.spark; k++) fire.emit(headP.x + rnd(-.1, .1), headP.y + rnd(-.1, .1), headP.z + rnd(-.1, .1), pi[3] * rnd(.5, 2.5) + rnd(-1, 1), rnd(-.5, 1.5), pi[4] * rnd(.5, 2.5) + rnd(-1, 1), rnd(.25, .5), rnd(.05, .12), SK_AURA.c0, SK_AURA.c1, .95, .4, 0, 1);
    }
    return true;
  });
}

/* ---------- 直線光:一片沿線拉長、繞線軸轉向鏡頭的四邊形(突進 / 閃身 / 射線殘光 / 箭拖尾);外層淡暈 + 青身 + 白芯三片疊加 ---------- */
// from / to:V3;w:寬(m);life:殘留秒數;opt.grow:秒,終點從起點長出來;opt.caster:跟著 caster 位置當終點(衝鋒中用)
function skLine(from, to, w, life, opt) {
  opt = opt || {};
  if (SK_STRENGTH.k <= 0) return;
  skShared();
  w *= SK_VIS.w * .9;
  const NQ = IS_TOUCH ? 2 : 3, QK = [2.2, 1, .3], QB = [.3, 1, 1], QC = [[.1, .55, .95], [.22, .9, 1], [1, 1, 1]];
  const P = new Float32Array(12 * NQ), C = new Float32Array(12 * NQ), UV = [], IX = [];
  for (let q = 0; q < NQ; q++) { UV.push(0, 0, 0, 1, 1, 0, 1, 1); IX.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2); }
  const geo = new THREE.BufferGeometry(), pa = new THREE.BufferAttribute(P, 3), ca = new THREE.BufferAttribute(C, 3);
  pa.setUsage(THREE.DynamicDrawUsage); ca.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pa); geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(UV), 2)); geo.setAttribute('color', ca); geo.setIndex(IX);
  const mesh = new THREE.Mesh(geo, SK_MAT); mesh.frustumCulled = false; mesh.renderOrder = 8; scene.add(mesh);
  const a = from.clone(), b = to.clone(), cur = new V3(), ax = new V3(), mid = new V3(), sd = new V3(), cam = new V3();
  let t = 0, dead = false, sparked = false;
  const inst = { kill() { if (dead) return; dead = true; scene.remove(mesh); geo.dispose(); skDone('line', inst); } };
  skLimit('line', inst);
  const K = SK_STRENGTH.k, grow = opt.grow || 0, lf = life * 1.3;
  addFx(dt => {
    if (dead) return false;
    t += dt;
    if (t > lf + grow) { inst.kill(); return false; }
    if (opt.caster) { const p = opt.caster.root ? opt.caster.root.position : opt.caster; b.set(p.x, p.y + (opt.dy == null ? 1 : opt.dy), p.z); }
    const g = grow ? Math.min(1, t / grow) : 1;
    cur.lerpVectors(a, b, g); ax.subVectors(cur, a);
    mid.addVectors(a, cur).multiplyScalar(.5); cam.subVectors(camera.position, mid);
    sd.crossVectors(ax, cam); if (sd.lengthSq() < 1e-6) sd.set(0, 1, 0); sd.normalize();
    const f = (t > grow ? Math.max(0, 1 - (t - grow) / lf) : 1) * K;
    for (let q = 0; q < NQ; q++) {
      const hw = w * .5 * QK[q], j = q * 12, c = QC[q], bb = f * QB[q];
      P[j] = a.x + sd.x * hw; P[j + 1] = a.y + sd.y * hw; P[j + 2] = a.z + sd.z * hw; P[j + 3] = a.x - sd.x * hw; P[j + 4] = a.y - sd.y * hw; P[j + 5] = a.z - sd.z * hw;
      P[j + 6] = cur.x + sd.x * hw; P[j + 7] = cur.y + sd.y * hw; P[j + 8] = cur.z + sd.z * hw; P[j + 9] = cur.x - sd.x * hw; P[j + 10] = cur.y - sd.y * hw; P[j + 11] = cur.z - sd.z * hw;
      C[j] = C[j + 3] = bb * .25 * c[0]; C[j + 1] = C[j + 4] = bb * .25 * c[1]; C[j + 2] = C[j + 5] = bb * .25 * c[2];   // 起點暗、終點亮
      C[j + 6] = C[j + 9] = bb * c[0]; C[j + 7] = C[j + 10] = bb * c[1]; C[j + 8] = C[j + 11] = bb * c[2];
    }
    pa.needsUpdate = true; ca.needsUpdate = true;
    if (!sparked && g >= 1 && SK_VIS.spark > 0) {   // 沿線飛散火花(一次)
      sparked = true; const L = ax.length(), n = Math.min(IS_TOUCH ? 8 : 18, Math.ceil(L / .8)) * SK_VIS.spark;
      for (let i = 0; i < n; i++) { const u = Math.random(); fire.emit(a.x + ax.x * u, a.y + ax.y * u, a.z + ax.z * u, rnd(-1.2, 1.2), rnd(.2, 1.6), rnd(-1.2, 1.2), rnd(.3, .6), rnd(.06, .14), SK_AURA.c0, SK_AURA.c1, .9, .4, 0, 1); }
    }
    return true;
  });
}
// 出手閃光(0.12 s):大光點 + 小光圈
function skFlash(pos, s) {
  s = (s || 1.2) * 1.8;
  const sp = glowSprite(SKC.main, s, 1); sp.position.copy(pos); scene.add(sp);
  const sp2 = glowSprite(0xffffff, s * .45, 1); sp2.position.copy(pos); scene.add(sp2);
  let t = 0;
  addFx(dt => { t += dt; if (t >= .14) { scene.remove(sp); scene.remove(sp2); sp.material.dispose(); sp2.material.dispose(); return false; } const k = 1 - t / .14; sp.material.opacity = k; sp2.material.opacity = k; sp.scale.setScalar(s * (1 + t * 3)); return true; });
}
// 環形螢光光帶(旋風類:以施放者為中心繞一圈的光軌;連續取樣由呼叫端每 0.12 s 呼叫);雙層錯開角度 + 火花
function skRing(pos, yaw, R, y, dur) {
  skWhirlFx(pos, R);
  skTrail(pos, yaw, { a0: 0, a1: 340, r0: R, r1: R, y0: y, y1: y, tilt: 0, dur: dur || .12, life: .26, w: 1.3 });
  skTrail(pos, yaw + Math.PI, { a0: 0, a1: 340, r0: R * .8, r1: R * .8, y0: y + .5, y1: y + .5, tilt: 20, dur: dur || .12, life: .2, w: .8 }, { noSpark: true });
}
// 落地衝擊:雙層衝擊波圈 + 地面放射裂光 + 碎光火花(視覺放大,不改判定;R = 判定半徑)
function skImpact(pos, R, strong) {
  R = Math.max(1.5, R || 3);
  burstRing(pos, SKC.main, R * 1.25); burstRing(pos, SKC.core, R * .7);
  if (strong) after(.08, () => burstRing(pos, SKC.main, R * 1.7));
  if (strong) { skSprite(22, pos, R * 3.2, Math.random() * 6.28, .7, { ground: true, grow: .5 }); skSprite(24, pos, R * 3, Math.random() * 6.28, .7, { ground: true, grow: .5 }); }
  skSprite(strong ? 15 : 13, pos, R * 2.6, Math.random() * 6.28, .55, { ground: true, grow: .5 });
  skSprite(Math.random() < .5 ? 11 : 12, pos, R * 2.2, Math.random() * 6.28, .5, { ground: true, grow: .6 });
  const n = IS_TOUCH ? 6 : 10, a0 = Math.random() * 6.28;
  for (let i = 0; i < n; i++) {
    const a = a0 + i / n * 6.283, c = Math.cos(a), s = Math.sin(a), r1 = R * rnd(.5, .75), r2 = R * rnd(1.05, 1.5);
    skLine(new V3(pos.x + c * r1, pos.y + .12, pos.z + s * r1), new V3(pos.x + c * r2, pos.y + .12, pos.z + s * r2), .35, .45, { grow: .1 });
  }
  const sn = (IS_TOUCH ? 14 : 30) * SK_VIS.spark;
  for (let i = 0; i < sn; i++) { const a = Math.random() * 6.283, v = rnd(2, 6); fire.emit(pos.x, pos.y + .2, pos.z, Math.cos(a) * v, rnd(2, 6), Math.sin(a) * v, rnd(.4, .8), rnd(.08, .18), SK_AURA.c0, SK_AURA.c1, .95, .5, 0, 2); }
}

/* ---------- 光軌範本(度、m、s;§3-5 / 雙劍 §2-3) ---------- */
const SK_TPL = {
  slashA: { a0: 70, a1: -60, r0: .5, r1: 1.7, y0: 1.6, y1: .9, tilt: 35, dur: .07, life: .2, w: 1 },    // 右上 → 左下斜劈
  slashB: { a0: -70, a1: 60, r0: .5, r1: 1.7, y0: 1.6, y1: .9, tilt: -35, dur: .07, life: .2, w: 1 },   // 左上 → 右下
  sweepR: { a0: 85, a1: -85, r0: .5, r1: 1.8, y0: 1.15, y1: 1.15, tilt: 0, dur: .08, life: .2, w: 1 },  // 右 → 左水平橫掃
  upper: { a0: -60, a1: 50, r0: .5, r1: 1.7, y0: .6, y1: 1.7, tilt: -50, dur: .07, life: .2, w: .9 },   // 左下 → 右上挑斬
  crossA: { a0: 60, a1: -30, r0: .5, r1: 2.0, y0: 1.8, y1: .7, tilt: 40, dur: .09, life: .28, w: 1.3 },
  crossB: { a0: -60, a1: 30, r0: .5, r1: 2.0, y0: 1.8, y1: .7, tilt: -40, dur: .09, life: .28, w: 1.3 },
  power: { a0: -80, a1: 80, r0: .4, r1: 2.0, y0: 1.7, y1: .6, tilt: 30, dur: .1, life: .25, w: 1.2 },
  vert: { a0: 0, a1: 0, r0: .4, r1: 2.0, y0: 2.4, y1: .2, tilt: 85, dur: .1, life: .25, w: 1.2 }
};
// 依武器動作名在 caster 位置畫光軌(本機 / 遠端共用:遠端由 a 欄位的動作 id 觸發,見 remote.js)
const SK_ACT_FX = {
  'dual.n1': p => skTrail(p.pos, p.yaw, SK_TPL.slashA), 'dual.n2': p => skTrail(p.pos, p.yaw, SK_TPL.slashB),
  'dual.n3': p => skTrail(p.pos, p.yaw, SK_TPL.sweepR), 'dual.n4': p => skTrail(p.pos, p.yaw, SK_TPL.upper),
  'dual.n5': p => { skTrail(p.pos, p.yaw, SK_TPL.crossA); skTrail(p.pos, p.yaw, SK_TPL.crossB); },
  'sword.slash1': p => skTrail(p.pos, p.yaw, SK_TPL.slashA), 'sword.slash2': p => skTrail(p.pos, p.yaw, SK_TPL.slashB),
  'sword.slash3': p => skTrail(p.pos, p.yaw, Object.assign({}, SK_TPL.vert, { w: 1.2 }))
};
const SK_ACT_SP = { 'dual.n1': 0, 'dual.n2': 1, 'dual.n3': 2, 'dual.n4': 3, 'dual.n5': 5, 'sword.slash1': 0, 'sword.slash2': 1, 'sword.slash3': 3 };
function skActFx(name, pos, yaw) {
  const f = SK_ACT_FX[name]; if (f) f({ pos, yaw });
  const s = SK_ACT_SP[name]; if (s === 5) skSprite(6, new V3(pos.x + Math.sin(yaw) * 1.6, pos.y + 1.2, pos.z + Math.cos(yaw) * 1.6), 3.8, 0, .3);
  else if (s != null) skSlashFx(pos, yaw, s);
}

/* ================= 受擊反應(§4):只呼叫 Doll 片段,不讀寫任何判定值 ================= */
// 本機動作紀錄(快照 a 欄位):id / 序號 / 開始時間
G.act = { id: 0, seq: 0, t: -9 };
function actMark(name) {
  const id = typeof ACT_ID !== 'undefined' ? ACT_ID[name] : 0;
  if (!id) return;
  G.act = { id, seq: (G.act.seq + 1) & 7, t: G.time };
}
// 播動作並登記到 a 欄位(本機;opt 同 Doll.play)
function actPlay(name, opt) { const ok = mage.play(name, opt); if (ok) actMark(name); return ok; }
// 受害者端挑選反應(§4-2):rest = 實扣、fx = 合併後的效果、h = 命中陣列、fall / stun = 這次是否「實際生效」的跌倒 / 暈眩
function reactFromHit(rest, fx, h, fall, stun) {
  if (G.down > 0 || !(rest > 0)) return;
  let dx = 0, dz = 0, kbL = 0;
  if (fx && fx.kb) { dx = fx.kb[0]; dz = fx.kb[1]; kbL = Math.hypot(dx, dz); }
  if (kbL < 1e-3) { for (const x of h || []) { dx += +x[2] || 0; dz += +x[3] || 0; } }
  const l = Math.hypot(dx, dz), rear = l > 1e-3 && (dx * Math.sin(mage.yaw) + dz * Math.cos(mage.yaw)) / l > 0;   // 推力方向與面向同向 = 被從背後打
  const uny = G.unyT > 0;
  let name = null;
  if (!uny && ((fx && fx.lf) || (fall && kbL >= 2))) name = rear ? 'flyFwd' : 'flyBack';
  else if (!uny && fall) name = rear ? 'knockDownFace' : null;   // 正面跌倒由 downK 的倒姿處理(後倒)
  else if (!uny && stun) name = 'stagger';
  else if (!uny && kbL >= 1.2) name = rear ? 'hitBigRear+hitSlide' : 'hitBig+hitSlide';
  else if (!uny && rest >= 15) name = rear ? 'hitBigRear' : 'hitBig';
  else name = rear ? 'hitSmallRear' : 'hitSmall';
  if (!name) { return; }
  if (G.roll && !/^fly|knock/.test(name)) return;   // 翻滾姿勢優先
  const id = ACT_ID[name]; if (!id) return;
  const keep = (G.state === 'charging' && name.indexOf('hit') === 0) ? .5 : 1;   // 集氣中被打但沒取消:不洗掉集氣姿勢(上半身小抖即可)
  if (keep < 1) { mage.play('hitSmall'); G.act = { id: ACT_ID.hitSmall, seq: (G.act.seq + 1) & 7, t: G.time }; return; }
  mage.playAct(id); G.act = { id, seq: (G.act.seq + 1) & 7, t: G.time };
}
// 快照 a 欄位:12 位元 = aId 6 + aSeq 3 + aAge 3(已播時間 ÷ 0.1 s,上限 0.7 s);0 = 無
function actSnap() {
  const a = G.act, age = G.time - a.t;
  if (!a.id || age > .75) return { id: 0, seq: a.seq, age: 0 };
  return { id: a.id, seq: a.seq, age: Math.min(7, Math.floor(age / .1)) };
}

/* ================= 貼圖特效層(assets/fx/fx_01~16.png:黑底白青光圖集切出,亮度即 alpha,加色混合) =================
   疊加在程序式光帶上(不取代)。①斜向細劍光 ②C 形弧斬 ③大橢圓環繞斬 ④彎月弧斬 ⑤雙斜線劍痕 ⑥X 交叉斬 ⑦多環旋風環 ⑧漩渦螺旋斬
   ⑨衝刺箭矢+煙塵 ⑩箭頭右向直線衝擊 ⑪⑫地面尖刺爆發(左 / 右傾)⑬地面弧斬+煙 ⑭十字星光+單圈 ⑮多環衝擊波+尖刺 ⑯X 星芒閃光 */
const SKS_AR = [1.82, 1.82, 1.87, 1.38, 1.97, 1.95, 2.17, 1.71, 2.08, 2.22, 2.05, 1.51, 2.13, 2.12, 2.28, 1.97, 1.23, 1.0, 1.33, 4.3, 5.45, 1.89, 1.94, 1.77];   // 17~24 = 大型圖集 A~H(fxL_A~H.png)
const SKS_L = 'ABCDEFGH';   // 各張寬高比(切圖尺寸)
const SKS = { tex: {}, live: [], cap: IS_TOUCH ? 6 : 14, quad: null };
function skTex(id) {
  let t = SKS.tex[id]; if (t) return t;
  t = SKS.tex[id] = new THREE.TextureLoader().load(id > 16 ? 'assets/fx/fxL_' + SKS_L[id - 17] + '.png' : 'assets/fx/fx_' + String(id).padStart(2, '0') + '.png');   // 共用載入一次
  return t;
}
// skSprite(id 1~16, pos, scale(高 m), rot(弧度:面向鏡頭時 = 貼圖平面內旋轉;平貼地面時 = 繞 Y 的偏航,0 = 貼圖 +x 朝世界 +x), life(s), opt)
// opt:{ ground 平貼地面, dy 抬高, fade 淡出方式('out' 預設 / 'none'), grow 起始縮放比(0.6 = 由 60% 長到 115%), flip 左右鏡像, k 亮度 }
function skSprite(id, pos, scale, rot, life, opt) {
  opt = opt || {};
  if (SK_STRENGTH.k <= 0 || id < 1 || id > 24) return;
  if (!SKS.quad) SKS.quad = new THREE.PlaneGeometry(1, 1);
  const ar = SKS_AR[id - 1], mat = new THREE.MeshBasicMaterial({ map: skTex(id), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0 });
  const m = new THREE.Mesh(SKS.quad, mat); m.frustumCulled = false; m.renderOrder = 9;
  m.position.set(pos.x, pos.y + (opt.dy || 0) + (opt.ground ? .08 : 0), pos.z); m.rotation.order = 'YXZ';
  if (opt.ground) { m.rotation.set(-Math.PI / 2, rot || 0, 0); } else { m.rotation.set(0, 0, 0); }
  scene.add(m);
  let t = 0, dead = false; const g0 = opt.grow == null ? .75 : opt.grow, K = (opt.k == null ? 1 : opt.k) * SK_STRENGTH.k, fx = opt.flip ? -1 : 1;
  const inst = { kill() { if (dead) return; dead = true; scene.remove(m); mat.dispose(); const i = SKS.live.indexOf(inst); if (i >= 0) SKS.live.splice(i, 1); } };
  SKS.live.push(inst); while (SKS.live.length > SKS.cap) SKS.live.shift().kill();
  addFx(dt => {
    if (dead) return false;
    t += dt; const u = t / life; if (u >= 1) { inst.kill(); return false; }
    const s = scale * (g0 + (1.15 - g0) * (1 - Math.pow(1 - u, 2)));
    m.scale.set(s * ar * fx, s, 1);
    if (!opt.ground) { m.quaternion.copy(camera.quaternion); m.rotateZ(rot || 0); }   // 面向鏡頭
    mat.opacity = (opt.fade === 'none' ? 1 : Math.min(1, (1 - u) * 1.8) * Math.min(1, t / .03)) * K;
    return true;
  });
}
// 揮砍(②④⑤⑧ 依段數輪換方向):pos = 施放者腳下、yaw = 面向
const SKS_SLASH = [[2, .5], [4, -.3], [5, .2], [8, 0]];
function skSlashFx(pos, yaw, ix, k) {
  const e = SKS_SLASH[(ix | 0) % 4], s = 3.4 * (k || 1), f = new V3(Math.sin(yaw), 0, Math.cos(yaw));
  skSprite(e[0], new V3(pos.x + f.x * 1.5, pos.y + 1.2, pos.z + f.z * 1.5), s, e[1] + (ix & 1 ? 1 : -1) * .45, .28, { flip: !!(ix & 1) });
}
let _skwT = -9;
function skWhirlFx(pos, R) {   // 旋風(③ 大橢圓環繞斬 + ⑦ 多環旋風環,平貼身周);節流 0.3 s
  if (G.time - _skwT < .3) return; _skwT = G.time;
  skSprite(3, pos, (R || 2.4) * 2.2, G.time * 3, .35, { ground: true, dy: 1.0, grow: .8 });
  skSprite(7, pos, (R || 2.4) * 2.8, -G.time * 2, .4, { ground: true, dy: .4, grow: .8 });
  skSprite(20, pos, (R || 2.4) * 2.6, G.time * 4, .4, { ground: true, dy: .7, grow: .8 });
  skSprite(23, pos, (R || 2.4) * 3.2, -G.time * 3, .4, { ground: true, dy: .15, grow: .8 });
}
// 沿方向的直線衝擊(⑨ 衝刺箭矢+煙塵 / ⑩ 箭頭右向):平貼、貼圖 +x 對準 yaw
function skDashFx(id, pos, yaw, scale, life) { skSprite(id, pos, scale, yaw - Math.PI / 2, life || .35, { ground: true, dy: .9, grow: .6 }); }
