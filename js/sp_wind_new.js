'use strict';
// 風系三招(設計 第 4、5、6 節):風刃術(三片新月風刃)、颶風牆(大範圍減速風場)、風刃切割(超寬新月衝擊波,只扣血)。
// 載入順序:spells.js → skills.js → 本檔 → classes.js。施放函式為頂層 function,由 SHAPE_FN_NAME 以名稱查表。
// 階段 0 介面(SLOW_ZONES / addSlowZone / removeSlowZone、addTracer、CHG.copies / CHG.perK、P.thickK、P.muzzle、P.range)
// 尚未存在時以 typeof 保護退回,檔案在階段 0 之前載入也不報錯。
// 本檔自有常數與輔助函式一律以 ww_ 開頭;THREE 物件延後到第一次施放才建立(ww_init)。

const ww_N = { bolt: 5, wall: 4, sky: 3 };                             // 各形狀滿集氣份數(同 COPIES_N)
const ww_ANG = [0, -6, 6, -12, 12].map(a => a * Math.PI / 180);       // 同 SHOT_ANG
const ww_TAB = { bolt: .6, wall: .8, sky: .5 };                        // 份數 > 1 時的每份傷害倍率(同 CHG.perK)
const ww_CUT_V = 26, ww_CUT_LEN = 32;                                  // 風刃切割:波速(m/s)、掃過距離(m)
let ww_R = null, ww_ghostN = 0;

function ww_copies(shape, P) {
  return typeof CHG.copies === 'function' ? CHG.copies(ww_N[shape] || 1, P.q || 0, P.mode) : 1;
}
function ww_perK(n, shape) {
  if (typeof CHG.perK === 'function') return CHG.perK(n, shape);
  return n > 1 ? (ww_TAB[shape] || 1) : 1;
}
function ww_muzzle(P) {
  if (P.muzzle) return new V3(P.muzzle.x, P.muzzle.y, P.muzzle.z);
  const p = mage.root.position, d = P.dir || 0;
  return new V3(p.x + Math.sin(d) * .7, p.y + 1.25, p.z + Math.cos(d) * .7);
}
function ww_range(P) { return P.range || 30; }
function ww_speed() { return BOLT_SPEED * ELMOD.wind.speedMul; }
function ww_addSlow(o) { return typeof addSlowZone === 'function' ? addSlowZone(o) : null; }
function ww_rmSlow(z) { if (z && typeof removeSlowZone === 'function') removeSlowZone(z); }

// 共用 geometry / material / 貼圖(第一次施放時建立)
function ww_init() {
  if (ww_R) return ww_R;
  const addMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const cx = cv.getContext('2d');
  cx.clearRect(0, 0, 64, 64); cx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    cx.strokeStyle = 'rgba(255,255,255,' + (.5 + (i % 3) * .2) + ')'; cx.lineWidth = 2 + (i % 3);
    cx.beginPath(); cx.moveTo(i * 8 - 16, 0); cx.lineTo(i * 8 + 16, 64); cx.stroke();
  }
  const streak = new THREE.CanvasTexture(cv);
  streak.wrapS = streak.wrapT = THREE.RepeatWrapping; streak.repeat.set(2, 1);
  ww_R = {
    moonOut: new THREE.RingGeometry(.55, .75, 24, 1, -1.2, 2.4), moonIn: new THREE.RingGeometry(.62, .7, 24, 1, -1.2, 2.4),
    matOut: addMat(0xc8ffe8, .65), matIn: addMat(0xffffff, .9),
    cutCore: new THREE.RingGeometry(.93, 1, 48, 1, -1.1, 2.2), cutMid: new THREE.RingGeometry(.85, 1, 48, 1, -1.1, 2.2),
    matCore: addMat(0xeafff6, .95), matMid: addMat(0xc8ffe8, .55), matOutC: addMat(0xc8ffe8, .25),
    col: new THREE.CylinderGeometry(1.1, .45, 4.5, 16, 1, true),
    matCol: new THREE.MeshBasicMaterial({ map: streak, color: 0xc8ffe8, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    streak
  };
  return ww_R;
}

// 這一點是否被地形 / 平台 / 裝飾柱擋住
function ww_blocked(p) {
  if (p.y < terrainH(p.x, p.z) + .1) return true;
  for (const H of PLATFORMS) if (platContains(H, p.x, p.z, .1) && p.y <= platTop(H, p.x, p.z) && (H.bottom == null || p.y >= H.bottom)) return true;
  for (const c of COLLIDERS) if (c.deco && Math.hypot(p.x - c.x, p.z - c.z) < c.r) return true;
  return false;
}
// 命中火花 + 擴散環(風系水平化)
function ww_hitFx(p, E) {
  burstRing(p, EL_BURST.wind.ring, .8);
  for (let i = 0; i < fq(10); i++) fire.emit(p.x, p.y, p.z, rnd(-3, 3), rnd(-.3, .3), rnd(-3, 3), .3, rnd(.1, .18), E.c0, E.c1, 1, .3, 0, 4);
}

/* ---------- 4. 風刃術:三片新月風刃 ---------- */
// 每片沿固定軌跡飛行,不追蹤;中刃直線,左右刃 lat = ±1.6·sin(π·s/14)(s = 已飛距離)
// B 模式多出的直線刃依 ww_ANG 排列,傷害 ×0.6;各片各自判定、命中第一個標靶即消失
function castWindBolt(P, orb) {
  ww_init();
  const E = EL.wind, mz = ww_muzzle(P), dir = P.dir || 0, thick = P.thickK || 1, n = ww_copies('bolt', P);
  const blades = [{ a: dir, side: 0, mul: 1 }, { a: dir, side: 1, mul: 1 }, { a: dir, side: -1, mul: 1 }];
  for (let i = 1; i < n; i++) blades.push({ a: dir + ww_ANG[i], side: 0, mul: ww_TAB.bolt });
  if (orb) { orb.position.copy(mz); dissolveOrb(orb, E); }
  flashLight(mz, E.hex, 2.5, .25, 10);
  const base = { E, scale: .35 * (P.r || 1) * thick / .75, hitR: .45 * thick, range: ww_range(P), spd: ww_speed(), knock: 5 * (P.fxK || 1) / 3 };
  for (const b of blades) ww_blade(b, mz, Object.assign({}, base, { dmg: 60 * .45 * (P.dmgK || 1) * b.mul }));
}
// 一片風刃:b = { a 方向角, side 左 +1 / 右 -1 / 中 0, mul 傷害倍率 }
function ww_blade(b, mz, o) {
  const E = o.E, K = Math.PI / 14, sa = Math.sin(b.a), ca = Math.cos(b.a), L = b.side * 1.6;
  const at = s => { const l = L * Math.sin(K * s); return new V3(mz.x + sa * s + ca * l, mz.y, mz.z + ca * s - sa * l); };
  const tg = s => { const dl = L * K * Math.cos(K * s); return { x: sa + ca * dl, z: ca - sa * dl }; };
  const R = ww_init(), g = new THREE.Group();
  g.add(new THREE.Mesh(R.moonOut, R.matOut), new THREE.Mesh(R.moonIn, R.matIn));
  g.scale.setScalar(o.scale); scene.add(g);
  let s = 0, cur = at(0);
  const finish = (endS, hitD, endP) => {
    scene.remove(g);
    if (typeof addTracer === 'function' && endS > .5) for (let k = 0; k < 6; k++) addTracer(at(endS * k / 6), at(endS * (k + 1) / 6), E);
    if (!hitD) for (let i = 0; i < fq(6); i++) smoke.emit(endP.x + rnd(-.2, .2), endP.y, endP.z + rnd(-.2, .2), rnd(-.8, .8), rnd(.5, 1.5), rnd(-.8, .8), .6, rnd(.4, .6), E.s0, E.s1, .5, 1, -.2, .5);
    return false;
  };
  addFx(dt => {
    let rem = o.spd * dt;
    while (rem > 1e-6) {
      const st = Math.min(.5, rem); rem -= st;
      s = Math.min(o.range, s + st);
      const prev = cur; cur = at(s);
      let best = null, bt = 2;
      for (const d of DUMMIES) { if (d.dead) continue; const t = segHitT(prev, cur, d, o.hitR); if (t >= 0 && t < bt) { bt = t; best = d; } }
      if (best) {
        const q = tg(s), l = Math.hypot(q.x, q.z) || 1;
        hitEl(best, o.dmg, 'wind', q.x / l, q.z / l, { knock: o.knock });
        ww_hitFx(cur, E);
        return finish(s, true, cur);
      }
      if (ww_blocked(cur) || Math.hypot(cur.x, cur.z) > ARENA_R) return finish(s, false, cur);
      if (s >= o.range - 1e-6) return finish(s, false, cur);
    }
    const q = tg(s);
    g.position.copy(cur); g.lookAt(cur.x + q.x, cur.y, cur.z + q.z); g.rotateZ(b.side * .35);
    for (let i = 0; i < fq(3); i++) fire.emit(cur.x + rnd(-.1, .1), cur.y, cur.z + rnd(-.1, .1), rnd(-.8, .8), rnd(-.3, .3), rnd(-.8, .8), .25, rnd(.1, .18), E.c0, E.c1, 1, .3, 0, 4);
    return true;
  });
}

/* ---------- 5. 颶風牆:大範圍減速風場 ---------- */
// 場長 1.5·P.r、深 6·thickK、持續 cfg.duration·durK·1.25;區域減速 30%→60%(SLOW_ZONES),不推出,每 0.5 s 3·dmgK
function castWindWall(P, orb) {
  ww_init();
  const E = EL.wind, n = ww_copies('wall', P), cfg = sc(P.idx), dur = cfg.duration * (P.durK || 1) * 1.25;
  const yaw = P.wallYaw || 0, ax = Math.cos(yaw), az = -Math.sin(yaw), nx = -az, nz = ax;
  const p = mage.root.position, sg = Math.sign(nx * (P.target.x - p.x) + nz * (P.target.z - p.z)) || 1;   // 遠離施法者的方向
  const depth = 6 * (P.thickK || 1), half = .75 * P.r, gy = P.target.y;
  const pct = Math.min(.6, .6 * (P.fxK || 1)), dmgK = (P.dmgK || 1) * ww_perK(n, 'wall');
  const launch = () => {
    for (let i = 0; i < n; i++) {
      const dd = i * (depth + 1);
      const o = { cx: P.target.x + nx * sg * dd, cz: P.target.z + nz * sg * dd, half, depth, pct, dmgK, dur, gy, yaw, ax, az, nx, nz, r: P.r, lead: i === 0, multi: n > 1 };
      if (i === 0) ww_field(o); else after(i * .12, () => ww_field(o));
    }
  };
  if (orb) orbFly(orb, new V3(P.target.x, gy + .5, P.target.z), .3, E, () => { dissolveOrb(orb, E); launch(); });
  else launch();
}
// 一道風場:漏斗風柱(每 2.4 m 一根)、地面氣流、螺旋粒子、減速區、週期傷害
function ww_field(o) {
  const R = ww_init(), E = EL.wind, token = {}, L = 2 * o.half;
  const zone = ww_addSlow({ kind: 'rect', x: o.cx, z: o.cz, hx: o.half, hz: o.depth / 2, c: Math.cos(o.yaw), s: Math.sin(o.yaw), pct: o.pct, hex: E.hex });
  const cap = o.multi ? (IS_TOUCH ? 4 : 6) : (IS_TOUCH ? 7 : 10), cnt = clamp(Math.round(L / 2.4), 2, cap);
  const cols = [];
  for (let i = 0; i < cnt; i++) {
    const u = -o.half + (i + .5) * L / cnt, x = o.cx + o.ax * u, z = o.cz + o.az * u;
    const mesh = new THREE.Mesh(R.col, R.matCol);
    mesh.visible = false; scene.add(mesh);
    cols.push({ x, z, base: surfaceY(x, z, o.gy + 1), on: Math.abs(u) / o.half * .4, mesh, acc: 0, sg: i % 2 ? -1 : 1, ph: rnd(0, 6.28) });
  }
  const wi = new Indicator(scene), rate = fq(30);
  let age = 0, tick = 0, fg = 0, lf = 0;
  if (o.lead) {
    flashLight(new V3(o.cx, o.gy + 1.5, o.cz), E.hex, 4, .5, 20);
    G.shake = Math.max(G.shake, .08 * CFG.shake);
    claimLight(token, 0x8affc8, new V3(o.cx, o.gy + 1.8, o.cz), 10 + o.r * 1.3);
  }
  addFx(dt => {
    age += dt;
    const fade = age > o.dur - 1 ? Math.max(0, o.dur - age) : 1;
    if (age >= o.dur) {
      cols.forEach(c => scene.remove(c.mesh));
      ww_rmSlow(zone); disposeInd(wi);
      if (o.lead) endLight(token);
      return false;
    }
    wi.set(o.cx, o.cz, 1, o.half, o.depth / 2, o.yaw, 0, .3 * fade * (.8 + .2 * Math.sin(age * 12)), E.hex, o.gy); wi.tick(age);
    if (o.lead) { driveLight(token, 1.2 * fade * (.85 + Math.random() * .3)); R.streak.offset.y -= dt * 1.2; }
    for (const c of cols) {
      const r = clamp((age - c.on) / .25, 0, 1);
      if (r <= 0) continue;
      c.mesh.visible = true;
      const ramp = r * fade, sway = Math.sin(age * 6 + c.ph) * .25, x = c.x + o.nx * sway, z = c.z + o.nz * sway;
      c.mesh.position.set(x, c.base + 2.25 * r, z);
      c.mesh.scale.set(Math.max(.001, fade), Math.max(.001, r), Math.max(.001, fade));
      c.mesh.rotation.y += dt * 6 * c.sg;
      c.acc += dt * rate * ramp;
      while (c.acc >= 1) {
        c.acc -= 1;
        const h = rnd(0, 4.2) * r, a = age * 7 + h * 1.5 + rnd(0, .5), rr = .45 + h * .14, cs = Math.cos(a), sn = Math.sin(a);
        fire.emit(x + cs * rr, c.base + h, z + sn * rr, -sn * rr * 3, 3, cs * rr * 3, .8, rnd(.2, .35), E.c0, E.c1, .9, .5, -.2, .8);
      }
    }
    fg += dt * fq(20) * fade;
    while (fg >= 1) {
      fg -= 1;
      const u = rnd(-o.half, o.half), lx = rnd(-o.depth / 2, o.depth / 2), x = o.cx + o.ax * u + o.nx * lx, z = o.cz + o.az * u + o.nz * lx, vn = -Math.sign(lx || 1) * 3;
      smoke.emit(x, o.gy + .3, z, o.nx * vn, .3, o.nz * vn, 1.2, rnd(.8, 1.2), E.s0, E.s1, .2, 1.5, -.1, .5);
    }
    lf += dt * fq(8) * fade;
    while (lf >= 1) {
      lf -= 1;
      const u = rnd(-o.half, o.half), lx = rnd(-o.depth / 2, o.depth / 2);
      fire.emit(o.cx + o.ax * u + o.nx * lx, o.gy + rnd(.3, 2.5), o.cz + o.az * u + o.nz * lx, rnd(-.5, .5), rnd(0, .6), rnd(-.5, .5), rnd(.8, 1.2), rnd(.08, .14), LEAF0, LEAF1, .8, .5, -.4, .8);
    }
    tick += dt;
    if (tick >= .5) { tick = 0; for (const d of DUMMIES) if (ww_inField(d, o)) d.hit(3 * o.dmgK, 0, 0, 0, 'wind'); }
    return true;
  });
}
// 標靶是否在風場內(高度差 > 2.5 不算,同 inZone)
function ww_inField(d, o) {
  if (d.dead || Math.abs(d.y - o.gy) > 2.5) return false;
  const dx = d.x - o.cx, dz = d.z - o.cz;
  return Math.abs(dx * o.ax + dz * o.az) <= o.half + .4 && Math.abs(dx * o.nx + dz * o.nz) <= o.depth / 2 + .6;
}

/* ---------- 6. 風刃切割:超寬新月衝擊波(只扣血) ---------- */
// 起點角色前方 1 m、固定 26 m/s 掃過 32 m;寬 = P.r(已含 sizeK)的全寬 2·P.r;不擊退、不擊飛、不搖晃
function castWindCut(P, orb) {
  ww_init();
  const E = EL.wind, dir = P.dir || 0, sa = Math.sin(dir), ca = Math.cos(dir), p = mage.root.position;
  const ox = p.x + sa, oz = p.z + ca, y0 = p.y + 1, n = ww_copies('sky', P), dmg = 130 * (P.dmgK || 1) * ww_perK(n, 'sky');
  if (orb) { orb.position.set(ox, y0 + .4, oz); dissolveOrb(orb, E); }
  flashLight(new V3(ox, y0, oz), E.hex, 6, .4, 22);
  G.shake = Math.max(G.shake, .15 * CFG.shake);
  for (let i = 0; i < n; i++) {
    const w = { ox, oz, sa, ca, y0, hw: P.r || 4, dmg, lead: i === 0, E };
    if (i === 0) ww_wave(w); else after(i * .22, () => ww_wave(w));
  }
}
// 一波:前緣沿方向推進,每幀掃過的帶狀區域內標靶各受一次傷害
function ww_wave(w) {
  const R = ww_init(), E = w.E, sa = w.sa, ca = w.ca, hw = w.hw, hitSet = new Set(), token = {};
  const grp = new THREE.Group(), core = new THREE.Mesh(R.cutCore, R.matCore), mid = new THREE.Mesh(R.cutMid, R.matMid), out = new THREE.Mesh(R.cutMid, R.matOutC);
  core.rotation.x = mid.rotation.x = out.rotation.x = -Math.PI / 2; out.scale.setScalar(1.06);
  grp.add(core, mid, out); grp.scale.setScalar(hw); grp.rotation.y = Math.atan2(-ca, sa);
  scene.add(grp);
  let s = 0, y = w.y0, ghostT = 0;
  if (w.lead) claimLight(token, E.hex, new V3(w.ox, w.y0 + 1.5, w.oz), 14);
  addFx(dt => {
    const sPrev = s; s = Math.min(ww_CUT_LEN, s + ww_CUT_V * dt);
    const cx = w.ox + sa * s, cz = w.oz + ca * s;
    y = damp(y, surfaceY(cx, cz, w.y0 + 2), 8, dt);
    grp.position.set(cx, y, cz);
    for (const d of DUMMIES) {
      if (d.dead || hitSet.has(d)) continue;
      const dx = d.x - w.ox, dz = d.z - w.oz, al = dx * sa + dz * ca, ac = dx * ca - dz * sa;
      if (al > sPrev && al <= s && Math.abs(ac) < hw + .4 && Math.abs(d.y - terrainH(d.x, d.z)) < 3.5) {
        hitSet.add(d);
        d.hit(w.dmg, 0, 0, 0, 'wind');
        ww_slash(d, E, sa, ca);
      }
    }
    for (let i = 0; i < fq(16); i++) {
      const a = rnd(-1.1, 1.1), rr = hw * rnd(.85, 1), ca2 = Math.cos(a), sa2 = Math.sin(a);
      fire.emit(cx + rr * (ca2 * sa + sa2 * ca), y + .2, cz + rr * (ca2 * ca - sa2 * sa), sa * 10, 0, ca * 10, .25, rnd(.1, .18), E.c0, E.c1, 1, .3, 0, 4);
    }
    for (let i = 0; i < fq(4); i++) {
      const u = rnd(-hw, hw), sg = u >= 0 ? 1 : -1, px = cx + ca * u, pz = cz - sa * u;
      smoke.emit(px, terrainH(px, pz) + .3, pz, ca * sg * 3, .2, -sa * sg * 3, .6, rnd(.8, 1.2), E.s0, E.s1, .3, 1.5, -.1, .5);
    }
    ghostT += dt;
    if (ghostT >= .06) { ghostT = 0; ww_ghost(grp); }
    if (w.lead) driveLight(token, 2);
    if (s >= ww_CUT_LEN) { scene.remove(grp); if (w.lead) endLight(token); return false; }
    return true;
  });
}
// 殘影:每 0.06 s 留一片停在原地淡出 0.25 s,全場最多 5 片
function ww_ghost(src) {
  const R = ww_init();
  if (ww_ghostN >= 5) return;
  ww_ghostN++;
  const g = new THREE.Group(), m = new THREE.Mesh(R.cutMid, R.matMid.clone());
  m.rotation.x = -Math.PI / 2; g.add(m);
  g.position.copy(src.position); g.rotation.y = src.rotation.y; g.scale.copy(src.scale); scene.add(g);
  let k = 0;
  addFx(dt => {
    k += dt / .25;
    if (k >= 1) { scene.remove(g); m.material.dispose(); ww_ghostN--; return false; }
    m.material.opacity = .55 * (1 - k);
  });
}
// 命中標靶身上的一道斜切光(0.18 s 淡出)
function ww_slash(d, E, sa, ca) {
  const t = rnd(-.6, .6), pc = Math.cos(t), ps = Math.sin(t), hy = d.y + 1.2;
  const m = new THREE.Mesh(BEAM_GEO, new THREE.MeshBasicMaterial({ color: 0xeafff6, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.set(d.x, hy, d.z); m.scale.set(.06, .06, 1.6);
  m.lookAt(d.x + ca * pc, hy + ps, d.z - sa * pc);
  scene.add(m);
  let k = 0;
  addFx(dt => {
    k += dt / .18;
    if (k >= 1) { scene.remove(m); m.material.dispose(); return false; }
    m.material.opacity = .9 * (1 - k);
  });
  for (let i = 0; i < fq(8); i++) fire.emit(d.x, hy, d.z, rnd(-3, 3), rnd(0, 3), rnd(-3, 3), .3, rnd(.1, .16), E.c0, E.c1, 1, .3, 0, 4);
}
