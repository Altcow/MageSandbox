'use strict';
// 劍技青光特效與受擊反應(設計_劍技光效與受擊反應.md):
//   色票 SKC / SK_AURA(除法杖外所有武器技能的集氣光、出手光統一用螢光青 #3ee8ff:白熱核心 + 青藍外暈,加色混合)、
//   發動特效積木 skTrail(光軌)/ skLine(直線光)/ skFlash(閃光)與物件上限、可見度判斷 skOk、
//   受擊反應挑選 reactFromHit / mageReact(只動 Doll 外觀,不碰任何判定值)、動作 id 的本機紀錄 G.act(快照 a 欄位)。
// 載入順序:skills.js 之後、skills_archer.js 之前(只在執行期才讀 scene / G / REMOTES 等全域)。
const SKC = { main: 0x3ee8ff, core: 0xeaffff, deep: 0x0a9fd0 };
// 形狀同 auraOf() 回傳值(hex / core / c0 / c1 / s0 / s1 / css0 / css1 / dark),cast 函式透過 casterAura(P) 直接拿到青色
const SK_AURA = { name: '劍技', hex: SKC.main, core: SKC.core, c0: [.85, 1, 1], c1: [.1, .75, 1], s0: [.85, 1, 1], s1: [.1, .75, 1], css0: '#3ee8ff', css1: '#0a9fd0', dark: false };
const SK_CAP = { trail: IS_TOUCH ? 8 : 16, line: IS_TOUCH ? 6 : 12 };
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

/* ---------- 光軌:沿「相對面向的弧線」掃過的動態三角帶 ---------- */
// pos = 施放者位置(腳)、yaw = 面向;tpl = { a0, a1(度,相對面向,正 = 右側), r0, r1(m), y0, y1(高度 m), tilt(度,光帶傾角:0 平放、90 直立), dur(掃過秒數), life(殘留秒數), w(寬度倍率) }
// opt.mirror:左右鏡像;opt.follow(caster 物件 { root.position }):跟著施放者平移
function skTrail(pos, yaw, tpl, opt) {
  opt = opt || {};
  if (SK_STRENGTH.k <= 0) return;
  skShared();
  const N = IS_TOUCH ? 10 : 16, D = Math.PI / 180, sg = opt.mirror ? -1 : 1, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
  const P = new Float32Array((N + 1) * 6), C = new Float32Array((N + 1) * 6), UV = new Float32Array((N + 1) * 4), IX = [];
  const ox = pos.x, oy = pos.y, oz = pos.z, hw = .22 * (tpl.w || 1), tl = (tpl.tilt || 0) * D * sg;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, a = lerp(tpl.a0, tpl.a1, u) * D * sg, r = lerp(tpl.r0, tpl.r1, u), y = lerp(tpl.y0, tpl.y1, u);
    const dx = fx * Math.cos(a) + rx * Math.sin(a), dz = fz * Math.cos(a) + rz * Math.sin(a);
    pts.push([dx * r, y, dz * r, dx, dz]);
  }
  for (let i = 0; i <= N; i++) {
    const p = pts[i], q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(N, i + 1)];
    let tx = q1[0] - q0[0], ty = q1[1] - q0[1], tz = q1[2] - q0[2]; const tL = Math.hypot(tx, ty, tz) || 1; tx /= tL; ty /= tL; tz /= tL;
    let wx = p[3] * Math.cos(tl), wy = Math.sin(tl), wz = p[4] * Math.cos(tl);   // 寬度方向 = 徑向與垂直方向依 tilt 混合,再與切線正交
    const d = wx * tx + wy * ty + wz * tz; wx -= tx * d; wy -= ty * d; wz -= tz * d;
    let wl = Math.hypot(wx, wy, wz);
    if (wl < .25) { wx = -tz; wy = 0; wz = tx; wl = Math.hypot(wx, wz) || 1; }   // 退化(光帶與切線平行):改用水平側向
    wx = wx / wl * hw; wy = wy / wl * hw; wz = wz / wl * hw;
    const j = i * 6; P[j] = ox + p[0] + wx; P[j + 1] = oy + p[1] + wy; P[j + 2] = oz + p[2] + wz; P[j + 3] = ox + p[0] - wx; P[j + 4] = oy + p[1] - wy; P[j + 5] = oz + p[2] - wz;
    UV[i * 4] = i / N; UV[i * 4 + 1] = 0; UV[i * 4 + 2] = i / N; UV[i * 4 + 3] = 1;
    if (i < N) { const a = i * 2; IX.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  const ca = new THREE.BufferAttribute(C, 3); ca.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('color', ca); geo.setIndex(IX);
  const mesh = new THREE.Mesh(geo, SK_MAT); mesh.frustumCulled = false; mesh.renderOrder = 8; scene.add(mesh);
  let t = 0, dead = false, lastx = ox, lastz = oz;
  const inst = { kill() { if (dead) return; dead = true; scene.remove(mesh); geo.dispose(); skDone('trail', inst); } };
  skLimit('trail', inst);
  const dur = tpl.dur || .08, life = tpl.life || .2, K = SK_STRENGTH.k;
  addFx(dt => {
    if (dead) return false;
    t += dt;
    if (opt.follow) { const p = opt.follow.root ? opt.follow.root.position : opt.follow; mesh.position.set(p.x - ox, p.y - oy, p.z - oz); }
    const h = Math.min(1, t / dur), f = t > dur ? Math.max(0, 1 - (t - dur) / life) : 1;
    if (t > dur + life) { inst.kill(); return false; }
    for (let i = 0; i <= N; i++) {
      const u = i / N, b = u <= h ? Math.pow(Math.max(0, 1 - (h - u) / .9), 1.4) * f * K : 0;
      const j = i * 6; C[j] = C[j + 3] = b * .75; C[j + 1] = C[j + 4] = b * .97; C[j + 2] = C[j + 5] = b;   // 白熱青:加色混合疊亮
    }
    ca.needsUpdate = true;
    return true;
  });
}

/* ---------- 直線光:一片沿線拉長、繞線軸轉向鏡頭的四邊形(突進 / 閃身 / 射線殘光 / 箭拖尾) ---------- */
// from / to:V3;w:寬(m);life:殘留秒數;opt.grow:秒,終點從起點長出來;opt.caster:跟著 caster 位置當終點(衝鋒中用)
function skLine(from, to, w, life, opt) {
  opt = opt || {};
  if (SK_STRENGTH.k <= 0) return;
  skShared();
  const P = new Float32Array(12), C = new Float32Array(12), UV = new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]);
  const geo = new THREE.BufferGeometry(), pa = new THREE.BufferAttribute(P, 3), ca = new THREE.BufferAttribute(C, 3);
  pa.setUsage(THREE.DynamicDrawUsage); ca.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pa); geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); geo.setAttribute('color', ca); geo.setIndex([0, 1, 2, 1, 3, 2]);
  const mesh = new THREE.Mesh(geo, SK_MAT); mesh.frustumCulled = false; mesh.renderOrder = 8; scene.add(mesh);
  const a = from.clone(), b = to.clone(), cur = new V3(), ax = new V3(), mid = new V3(), sd = new V3(), cam = new V3();
  let t = 0, dead = false;
  const inst = { kill() { if (dead) return; dead = true; scene.remove(mesh); geo.dispose(); skDone('line', inst); } };
  skLimit('line', inst);
  const K = SK_STRENGTH.k, grow = opt.grow || 0;
  addFx(dt => {
    if (dead) return false;
    t += dt;
    if (t > life + grow) { inst.kill(); return false; }
    if (opt.caster) { const p = opt.caster.root ? opt.caster.root.position : opt.caster; b.set(p.x, p.y + (opt.dy == null ? 1 : opt.dy), p.z); }
    const g = grow ? Math.min(1, t / grow) : 1;
    cur.lerpVectors(a, b, g); ax.subVectors(cur, a);
    mid.addVectors(a, cur).multiplyScalar(.5); cam.subVectors(camera.position, mid);
    sd.crossVectors(ax, cam); if (sd.lengthSq() < 1e-6) sd.set(0, 1, 0); sd.normalize().multiplyScalar(w * .5);
    P[0] = a.x + sd.x; P[1] = a.y + sd.y; P[2] = a.z + sd.z; P[3] = a.x - sd.x; P[4] = a.y - sd.y; P[5] = a.z - sd.z;
    P[6] = cur.x + sd.x; P[7] = cur.y + sd.y; P[8] = cur.z + sd.z; P[9] = cur.x - sd.x; P[10] = cur.y - sd.y; P[11] = cur.z - sd.z;
    const f = (t > grow ? Math.max(0, 1 - (t - grow) / life) : 1) * K;
    C[0] = C[3] = f * .25; C[1] = C[4] = f * .3; C[2] = C[5] = f * .33;   // 起點暗、終點亮
    C[6] = C[9] = f * .75; C[7] = C[10] = f * .97; C[8] = C[11] = f;
    pa.needsUpdate = true; ca.needsUpdate = true;
    return true;
  });
}
// 出手閃光(0.12 s)
function skFlash(pos, s) {
  const sp = glowSprite(SKC.main, (s || 1.2), 1); sp.position.copy(pos); scene.add(sp);
  let t = 0;
  addFx(dt => { t += dt; if (t >= .12) { scene.remove(sp); sp.material.dispose(); return false; } sp.material.opacity = 1 - t / .12; return true; });
}
// 環形螢光光帶(旋風類:以施放者為中心繞一圈的光軌;連續取樣由呼叫端每 0.12 s 呼叫)
function skRing(pos, yaw, R, y, dur) {
  skTrail(pos, yaw, { a0: 0, a1: 340, r0: R, r1: R, y0: y, y1: y, tilt: 0, dur: dur || .12, life: .22, w: 1.1 });
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
function skActFx(name, pos, yaw) { const f = SK_ACT_FX[name]; if (f) f({ pos, yaw }); }

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
