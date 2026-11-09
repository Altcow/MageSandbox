'use strict';
// 火系大招「隕石墜擊」+ 暫時性隕石坑(設計_魔法調整.md 第 7 節)。地形改寫部分見 js/crater_terrain_patch.md。
// 載入順序:... spells.js → sp_water.js / sp_wind.js / sp_fire_crater.js / sp_earth.js / summons.js → skills.js → classes.js → touch.js
// 頂層只宣告 castCraterMeteor / addCrater / updateCraters 與 cr_ 前綴的名稱。只在執行期被呼叫。
// 保護性依賴(以 typeof 檢查,缺少時退回):
//   階段 0:forCopies、addSlowZone / removeSlowZone、P.copies / P.mode / P.thickK(未設定時退回 1 份 / 非 B 模式 / thickK 1)
//   world.js patch:CRATERS、rebuildTer、flushTer、refreshTerFlags(缺少時坑洞只有減速區與特效,地形不變形)
// 每幀入口:game.js updateWorld 內呼叫 updateCraters(dt)。

const cr_MAX = 6;                              // 同時最多坑洞數;第 7 個 → 最舊的立即恢復(7-6)
const cr_FORM = .2, cr_RESTORE = 1.5;          // 形成 0.2 s easeOut;恢復 1.5 s smoothstep(7-2、7-4)
const cr_SLOW = .55, cr_SLOW_HEX = 0xff6a20;   // 坑內減速 55% 固定、焦橘色(7-3)
const cr_list = typeof CRATERS !== 'undefined' ? CRATERS : [];   // 與 world.js 共用同一陣列物件(clearCraters 以 length = 0 清空)
const cr_METEOR_GEO = new THREE.IcosahedronGeometry(1, 0);
const cr_MET_MAT = new THREE.MeshStandardMaterial({ color: 0x2a1810, emissive: EL.fire.hex, emissiveIntensity: 1.3, flatShading: true, roughness: 1 });   // 全部隕石共用,不 dispose

const cr_ease = t => t <= 0 ? 0 : (t >= 1 ? 1 : t * t * (3 - 2 * t));   // smoothstep

// 份數迴圈:優先用階段 0 的 forCopies;缺少時照 2-4 節同樣的規則退回(sky 每份傷害 ×.5、第 i 份延遲 i × delay)
function cr_forCopies(P, delay, place, fn) {
  const n = P.copies || 1, k = n > 1 ? .5 : 1;
  for (let i = 0; i < n; i++) {
    const Pi = Object.assign({}, P, { copy: i, ncopy: n, dmgK: P.dmgK * k, target: P.target.clone() });
    if (place) place(Pi, i, n);
    if (i === 0) fn(Pi, i, n); else after(i * delay, () => fn(Pi, i, n));
  }
}

// 坑洞用的格點範圍:中心 ± 1.6R 再外擴 1 格(TER.X0 / CELL / N 來自 world.js)
function cr_bbox(x, z, r) {
  const N = TER.N, B = 1.6 * r + 1;
  const i0 = clamp(Math.floor((x - B - TER.X0) / TER.CELL), 0, N - 1), i1 = clamp(Math.ceil((x + B - TER.X0) / TER.CELL), 0, N - 1);
  const j0 = clamp(Math.floor((z - B - TER.X0) / TER.CELL), 0, N - 1), j1 = clamp(Math.ceil((z + B - TER.X0) / TER.CELL), 0, N - 1);
  return [i0, j0, i1, j1];
}

// 把坑洞從 CRATERS 中移除:偏移歸零並重算地形(只在 k 還不是 0 時)、拿掉減速區與焦橘光暈
function cr_finish(c) {
  if (c.k !== 0) {
    c.k = 0;
    if (typeof rebuildTer === 'function') rebuildTer(c.bb[0], c.bb[1], c.bb[2], c.bb[3]);
  }
  if (c.zone && typeof removeSlowZone === 'function') removeSlowZone(c.zone);
  c.zone = null;
  if (c.onClear) c.onClear(c);
  const i = cr_list.indexOf(c); if (i >= 0) cr_list.splice(i, 1);
  if (typeof refreshTerFlags === 'function') refreshTerFlags();
}

// 新增一個暫時坑洞(x,z 中心;r 半徑 Rc;depth 坑深 D;life 坑存在秒數,不含形成與恢復)
// 形成 0.2 s 由 updateCraters 推進;回傳坑洞紀錄(欄位見 crater_terrain_patch.md)
function addCrater(x, z, r, depth, life) {
  while (cr_list.length >= cr_MAX) cr_finish(cr_list[0]);   // 第 7 個:最舊的立即恢復
  const c = { x, z, R: r, D: depth, hold: life, k: 0, t: 0, age: 0, phase: 'form', zone: null, bb: cr_bbox(x, z, r), glow: null, emT: 0, smT: 0, onClear: null };
  c.glow = glowSprite(cr_SLOW_HEX, r * 1.2, .6); c.glow.position.set(x, terrainH(x, z) + .3, z); scene.add(c.glow);
  c.onClear = cc => { if (cc.glow) { scene.remove(cc.glow); cc.glow.material.dispose(); cc.glow = null; } };
  if (typeof addSlowZone === 'function') c.zone = addSlowZone({ kind: 'circle', x, z, r: 1.1 * r, pct: cr_SLOW, hex: cr_SLOW_HEX, fx: { burn: 1 } });   // 坑內站著每 0.5 s 刷新燃燒 1 s(§3-4 狀態區域)
  cr_list.push(c);
  return c;
}

// 每幀:推進生命週期(form → hold → restore → 移除)、更新 k 並重算受影響格點、拿掉減速區、坑緣餘燼與坑底煙
function updateCraters(dt) {
  for (let i = cr_list.length - 1; i >= 0; i--) {
    const c = cr_list[i];
    c.t += dt; c.age += dt;
    if (c.phase === 'form' && c.t >= cr_FORM) { c.t -= cr_FORM; c.phase = 'hold'; }
    if (c.phase === 'hold' && c.t >= c.hold) { c.t -= c.hold; c.phase = 'restore'; }
    if (c.phase === 'restore' && c.t >= cr_RESTORE) { cr_finish(c); continue; }
    let k = 1;
    if (c.phase === 'form') k = easeOut(c.t / cr_FORM);
    else if (c.phase === 'restore') k = 1 - cr_ease(c.t / cr_RESTORE);
    if (k !== c.k) {
      c.k = k;
      if (typeof rebuildTer === 'function') rebuildTer(c.bb[0], c.bb[1], c.bb[2], c.bb[3]);
    }
    if (c.zone && c.phase === 'restore' && k < .3 && typeof removeSlowZone === 'function') { removeSlowZone(c.zone); c.zone = null; }   // 坑消失速度恢復
    cr_fx(c, dt);
  }
  if (typeof flushTer === 'function') flushTer();   // 本幀所有坑的頂點變更一次上傳
}

// 坑的外觀:坑底焦橘光暈(3 s 內淡到 .25)、坑緣餘燼(每秒 6 顆 × FXQ)、坑底灰煙(每秒 2 顆 × FXQ)
function cr_fx(c, dt) {
  if (c.glow) {
    c.glow.position.set(c.x, terrainH(c.x, c.z) + .3, c.z);
    c.glow.material.opacity = (c.age < 3 ? lerp(.6, .25, c.age / 3) : .25) * clamp(c.k, 0, 1);
  }
  c.emT += dt * 6 * FXQ();
  while (c.emT >= 1) {
    c.emT -= 1;
    const a = rnd(0, 6.283), d = c.R * rnd(1.0, 1.1), x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
    fire.emit(x, terrainH(x, z) + .1, z, rnd(-.2, .2), rnd(1, 2), rnd(-.2, .2), .8, rnd(.1, .18), EL.fire.c0, EL.fire.c1, 1, .3, 0, .5);
  }
  c.smT += dt * 2 * FXQ();
  while (c.smT >= 1) {
    c.smT -= 1;
    const a = rnd(0, 6.283), d = c.R * .7 * Math.sqrt(Math.random());
    smoke.emit(c.x + Math.cos(a) * d, terrainH(c.x, c.z) + .2, c.z + Math.sin(a) * d, rnd(-.3, .3), rnd(1, 2), rnd(-.3, .3), rnd(1.4, 2.2), rnd(1.5, 2.5), [.25, .2, .18], [.08, .08, .09], .4, 2.2, -.3, .6);
  }
}

// 天空符文陣(沿用 startShower 的 sig):隕石落完前後顯示,總長隨份數增加
function cr_rune(P, n, E) {
  const gy = P.target.y, S = new V3(-9, 0, -6), skyY = gy + 16, total = .35 * (n - 1) + 1.5;
  const sig = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: RUNE_TEX, color: E.hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  sig.rotation.x = -Math.PI / 2; sig.position.set(P.target.x + S.x, skyY, P.target.z + S.z); sig.scale.setScalar(P.r * 2.6); scene.add(sig);
  let age = 0;
  addFx(dt => {
    age += dt;
    const fin = age > total - .6 ? Math.max(0, (total - age) / .6) : 1;
    sig.material.opacity = Math.min(1, age * 2) * .9 * fin; sig.rotation.z += dt * .6;
    if (age >= total) { scene.remove(sig); sig.material.dispose(); return false; }
  });
}

// 一顆隕石的完整時序(從它開始落下算 t = 0):0~0.85 s 加速落下(u²)、撞擊、坑洞形成、0.6 s 後光圈收掉
function cr_meteor(Pi, size, D, hold, E) {
  const tx = Pi.target.x, tz = Pi.target.z, gy = Pi.target.y, Rc = Pi.r, FALL = .85, END = .6;
  const endP = new V3(tx, gy + .3, tz), startP = new V3(tx - 7, gy + 22, tz - 5);   // target + (−7, 22, −5)
  const mesh = new THREE.Mesh(cr_METEOR_GEO, cr_MET_MAT);
  mesh.scale.setScalar(size); mesh.position.copy(startP); scene.add(mesh);
  const gs = glowSprite(E.hex, 5, .9); mesh.add(gs);
  const wi = new Indicator(scene), prev = startP.clone();
  let t = 0, hit = false, impactT = 0;
  addFx(dt => {
    t += dt;
    if (!hit) {
      const u = Math.min(1, t / FALL);
      mesh.position.lerpVectors(startP, endP, u * u);
      mesh.rotation.x += dt * 2.5; mesh.rotation.y += dt * 1.7;
      trail(prev, mesh.position, fq(14), size * 1.6, .5, 'fire');
      for (let i = 0; i < fq(2); i++) smoke.emit(mesh.position.x, mesh.position.y, mesh.position.z, rnd(-.3, .3), rnd(0, .4), rnd(-.3, .3), 1.2, size * 2.4, [.25, .2, .18], [.08, .08, .09], .35, 2, -.2, .5);
      prev.copy(mesh.position);
      wi.set(tx, tz, 0, Rc, 0, 0, u, .45 * Math.min(1, t * 2), E.hex, gy); wi.tick(t);
      if (u < 1) return true;
      // 撞擊
      hit = true; impactT = t;
      scene.remove(mesh); mesh.remove(gs); gs.material.dispose();
      explode(endP, 1.1 * Rc, 1, { dmg: 150, gy, el: 'fire', mul: Pi.dmgK, fxK: Pi.fxK, burn: 3 * (Pi.fxK || 1) });
      for (const d of DUMMIES) {
        if (d.dead) continue;
        const dx = d.x - tx, dz = d.z - tz, dd = Math.hypot(dx, dz), l = dd || 1;
        if (dd < 1.1 * Rc) d.lift(1.0 * (Pi.fxK || 1));
        if (dd < .5 * Rc) d.knockDown(1.0 * (Pi.fxK || 1), dx / l, dz / l);   // 爆心 0.5R 內跌倒 0.5 → 1.0 s
      }
      flashLight(new V3(tx, gy + 2, tz), E.hex, 9, .6, 30);
      G.shake = Math.max(G.shake, .5 * CFG.shake);
      addCrater(tx, tz, Rc, D, hold);
    }
    const a = t - impactT;
    if (a >= END) { disposeInd(wi); return false; }
    wi.set(tx, tz, 0, Rc, 0, 0, 1, .45 * (1 - a / END), E.hex, gy); wi.tick(t);
    return true;
  });
}

// 大招進入點(SHAPE_FN_NAME.fire.sky):能量球往上飛 0.55 s → 消散 → 依份數砸落
function castCraterMeteor(P, orb) {
  const gy = P.target.y, start = orb.position.clone(), top = new V3(P.target.x, gy + 30, P.target.z), E = EL.fire;
  let t = 0;
  addFx(dt => {
    t += dt / .55; const u = Math.min(t, 1);
    orb.position.lerpVectors(start, top, u * u);
    fire.emit(orb.position.x, orb.position.y, orb.position.z, rnd(-.5, .5), rnd(-1, 0), rnd(-.5, .5), .5, orb.r, E.c0, E.c1, 1, .3, 0, .5);
    orb.setR(orb.r * (1 + dt * 2));
    if (u >= 1) { dissolveOrb(orb, E); cr_sky(P); return false; }
  });
}

// 各份隕石:B 模式多顆沿垂直瞄準方向排列(中、+1.2Rc、−1.2Rc),依序間隔 0.35 s;size / 坑深 / 持續同一套
function cr_sky(P) {
  const E = EL.fire, Rc = P.r, thickK = P.thickK || 1, gy = P.target.y;
  const size = P.mode === 'B' ? 2.0 : 2.6 * thickK;                 // 7-3:B 固定 2.0;A 為 2.6 × thickK
  const D = clamp(.3 * Rc * Math.sqrt(thickK), .8, 3.0);            // 坑深 0.8~3.0 m
  const hold = 10 * (P.durK || 1);                                  // 坑存在 10 × durK 秒(9.1~13 s)
  const n = P.copies || 1, sp = 1.2 * Rc, dirA = P.dir || 0, px = Math.cos(dirA), pz = -Math.sin(dirA);
  cr_rune(P, n, E);
  const place = (Pi, i) => {
    if (i === 0) return;
    const s = (i === 1 ? 1 : -1) * sp, x = P.target.x + px * s, z = P.target.z + pz * s;
    Pi.target = new V3(x, surfaceY(x, z, gy + 1), z);
  };
  const fn = Pi => cr_meteor(Pi, size, D, hold, E);
  if (typeof forCopies === 'function') forCopies(P, 'sky', .35, place, fn);
  else cr_forCopies(P, .35, place, fn);
}
