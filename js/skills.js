'use strict';
// 職業招式(任務 D2~D4):弓箭手、劍士(含盾)、刺客的 cast 函式與其每幀機制(衝鋒 / 閃身、旋轉、潛行與顯形)。
// 由 classes.js 的 CLASSES 表引用:launchSpell 在 P.skill.cast 有值時呼叫 P.skill.cast(P, orb)。
// 載入順序:game.js → spells.js → skills.js → classes.js → touch.js。本檔只定義函式與 window.onPlayerHit,不在載入時讀 game.js 變數。
// 統一集氣(C-0b):只讀 P.dmgK / P.sizeK / P.durK / P.fxK / P.q / P.r(= 選定範圍 × sizeK)與 CHG.count。

// 線段 a→b 與標靶(xz 距離 < r、高度相近)的最近接觸參數 t(0~1);沒碰到回傳 -1
const SEG_BODY_R = .2;   // 投射物命中判定:標靶身體半徑(加在 hitR 之上)
function segHitT(a, b, d, r) {
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-6;
  const t = clamp(((d.x - a.x) * dx + (d.z - a.z) * dz) / L2, 0, 1);
  const px = a.x + dx * t - d.x, pz = a.z + dz * t - d.z, yy = a.y + (b.y - a.y) * t - (d.y + 1);
  const R2 = r + SEG_BODY_R;
  return px * px + pz * pz < R2 * R2 && Math.abs(yy) < 1.2 ? t : -1;
}

// 圓形範圍內的活標靶受傷(距離衰減同 damageArea)。knock > 0 時沿 (kx,kz)→標靶 方向擊退(kx,kz 省略則以爆心為準)
function areaHit(cx, cy, cz, R, dmg, knock, kx, kz) {
  const ox = kx == null ? cx : kx, oz = kz == null ? cz : kz;
  for (const d of DUMMIES) {
    if (d.dead || Math.abs(cy - d.y) > R + 1.5) continue;
    const dx = d.x - cx, dz = d.z - cz, dist = Math.hypot(dx, dz);
    if (dist >= R + .2) continue;
    d.hit(dmg * (1 - clamp(dist / (R + .2), 0, 1) * .7) * rnd(.9, 1.1), dx, dz, 0, null);
    if (knock) { const ex = d.x - ox, ez = d.z - oz, l = Math.hypot(ex, ez) || 1; d.knock(ex / l, ez / l, knock); }
  }
}

// 命中火花(職業 / 屬性氣場色)
function hitFx(pos, n) {
  const E = auraEl(), k = IS_TOUCH ? Math.ceil(n * .6) : n;
  for (let i = 0; i < k; i++) fire.emit(pos.x, pos.y, pos.z, rnd(-3, 3), rnd(0, 4), rnd(-3, 3), rnd(.2, .4), rnd(.08, .16), E.c0, E.c1, 1, .3, 6, .5);
}

// 移除自建的 Group(含 geometry / material);不要傳入共用的 geometry 所屬物件以外的東西
function disposeObj(g) {
  scene.remove(g);
  g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
}

// 箭(程式模型):桿 + 箭頭,箭頭朝 +z;len 桿長、th 桿粗、hex 發光色
function arrowMesh(len, th, hex, scale) {
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: hex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(th, th, len, 6), m); shaft.rotation.x = Math.PI / 2; g.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(th * 3, len * .25, 6), m); head.rotation.x = Math.PI / 2; head.position.z = len / 2 + len * .125; g.add(head);
  g.scale.setScalar(scale || 1); return g;
}
// 衝擊巨箭(D2):巨箭 + 箭尾後方的弓形光弧 + 箭頭光暈;w 為線寬(弓弧半徑 = w/2)
function giantArrowMesh(w, hex, scale) {
  const g = arrowMesh(3.2, .08, hex, 1), m = new THREE.MeshBasicMaterial({ color: hex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const arc = new THREE.Mesh(new THREE.TorusGeometry(w / 2, .06, 6, 32, Math.PI), m); arc.position.z = -1.6; g.add(arc);
  const spr = glowSprite(hex, 1.8, .8); spr.position.z = 1.9; g.add(spr);
  g.scale.setScalar(scale); return g;
}

// 直線飛行的投射物(箭 / 飛刀 / 巨箭):沿 from→to 飛,每幀用 segHitT 判定。
// o:mesh(Group)、hitR(命中半徑)、pierce(穿透所有標靶,每個只判一次)、onHit(d, pos)、blocked(pos) → true 時立即停下、
//    onEnd(pos) 飛到終點或被擋時、stuck(停留秒數)、fade(停留時縮小淡出)、trail(每幀拖尾粒子數)、c0 / c1(拖尾色)
function flyProjectile(from, to, speed, o) {
  const g = o.mesh, dir = new V3().subVectors(to, from), L = Math.max(dir.length(), .01);
  dir.multiplyScalar(1 / L);
  g.position.copy(from); g.lookAt(to); scene.add(g);
  const base = g.scale.x, cur = new V3(), prev = from.clone(), hit = new Set();
  let s = 0, stuck = -1;
  addFx(dt => {
    if (stuck >= 0) {
      stuck += dt;
      if (o.fade) g.scale.setScalar(Math.max(.01, base * (1 - stuck / o.stuck)));
      if (stuck >= o.stuck) { disposeObj(g); return false; }
      return true;
    }
    const step = Math.min(speed * dt, L - s); s += step;
    cur.copy(from).addScaledVector(dir, s); g.position.copy(cur);
    if (o.trail) for (let i = 0; i < o.trail; i++) fire.emit(cur.x + rnd(-.1, .1), cur.y + rnd(-.1, .1), cur.z + rnd(-.1, .1), rnd(-.4, .4), rnd(-.2, .2), rnd(-.4, .4), .3, rnd(.08, .14), o.c0, o.c1, .9, .3, 0, .5);
    if (!TER.flat && cur.y < terrainH(cur.x, cur.z) + .05) { if (o.onEnd) o.onEnd(cur); stuck = 0; return true; }   // 碰到山坡就插住
    if (o.blocked && o.blocked(cur)) { if (o.onEnd) o.onEnd(cur); stuck = 0; return true; }
    let best = 2, bd = null;
    for (const d of DUMMIES) {
      if (d.dead || hit.has(d)) continue;
      const t = segHitT(prev, cur, d, o.hitR);
      if (t < 0) continue;
      if (o.pierce) { hit.add(d); o.onHit(d, cur); }
      else if (t < best) { best = t; bd = d; }
    }
    prev.copy(cur);
    if (bd) { o.onHit(bd, cur); stuck = 0; return true; }
    if (s >= L - 1e-6) { if (o.onEnd) o.onEnd(cur); stuck = 0; }
    return true;
  });
}

/* ---------- 弓箭手(D2) ---------- */
// 瞄準射擊:一支箭直線飛向落點,速度 45 → 70 m/s;命中第一個碰到的標靶,沒碰到就落地
// 穿雲箭(P.ex = 1,集氣 MAX 且專注 ≥ 40):速度 90 m/s、穿透、傷害 ×1.5(60)、命中照亮 2 s。命中專注 +6(skills_archer.js)
function castQuickShot(P, orb) {
  const E = casterAura(P), from = casterTip(P, new V3()), ex = P.ex | 0, rmt = archRemote(P), seen = new Set();
  if (orb) dissolveOrb(orb, E);
  const L = Math.hypot(P.target.x - from.x, P.target.z - from.z) || 1, reach = P.range || 26;
  const to = ex ? new V3(from.x + (P.target.x - from.x) / L * reach, P.target.y + .4, from.z + (P.target.z - from.z) / L * reach) : new V3(P.target.x, P.target.y + .4, P.target.z);
  flyProjectile(from, to, ex ? 90 : lerp(45, 70, P.q), {
    mesh: arrowMesh(1.1, .03, E.hex, 1), hitR: Math.max(.3, P.r), stuck: .6, fade: true, trail: IS_TOUCH ? 2 : 4, c0: E.c0, c1: E.c1, pierce: !!ex,
    onHit: (d, b) => {
      hitFx(b, 14);
      if (rmt) return;
      d.hit((ex ? 60 : 40) * P.dmgK, d.x - from.x, d.z - from.z, 0, null);
      if (ex) { d.light(2); archMark(d, '_archLit', 2); }
      archHitGain(P, d, seen);
    }
  });
}

// 衝擊巨箭:巨箭沿線飛出(40 m/s,飛完線長淡出),穿透所有標靶;命中傷害 + 強制跌倒 + 擊退;撞到高台側面就停下爆散
function castShockArrow(P, orb) {
  const E = casterAura(P), p = casterPos(P), cfg = CFG.skills.shockArrow, dx = Math.sin(P.dir), dz = Math.cos(P.dir), y0 = p.y + 1.3;
  if (orb) dissolveOrb(orb, E);
  const w = lerp(cfg.width0, cfg.width1, P.q), from = new V3(p.x + dx * .8, y0, p.z + dz * .8), to = new V3(from.x + dx * P.r, y0, from.z + dz * P.r);
  const mesh = giantArrowMesh(w, E.hex, lerp(.7, 1.2, P.q)), dir = new V3(dx, 0, dz);
  let flashed = false; const seen = new Set();
  flyProjectile(from, to, 40, {
    mesh, hitR: w / 2 + .1, pierce: true, fade: true, stuck: .15, trail: IS_TOUCH ? 5 : 8, c0: E.c0, c1: E.c1,
    blocked: b => PLATFORMS.some(H => platTop(H, b.x, b.z) > y0 - 1 && (H.bottom == null || H.bottom < y0 + .3) && platContains(H, b.x, b.z, .1)),
    onEnd: b => { hitFx(b, 20); burstRing(new V3(b.x, p.y, b.z), E.hex, 1.2); },
    onHit: (d, b) => {
      d.hit(70 * P.dmgK, dir.x, dir.z, 0, null); d.knock(dir.x, dir.z, 2.5 * P.fxK); d.knockDown(1.8 * P.fxK * (archLit(d) ? 1.5 : 1), dir.x, dir.z);   // 照亮中的目標跌倒 +50%(進階技能文件 §2-1)
      archHitGain(P, d, seen);
      hitFx(b, 20); burstRing(new V3(d.x, d.y, d.z), E.hex, 1.2);
      if (!flashed) { flashed = true; flashLight(b, E.hex, 5, .4, 12); G.shake = Math.max(G.shake, .1 * CFG.shake); }
    }
  });
}

// 箭雨每跳(本機判定):範圍傷害 9 × dmgK;每跳讓圈內目標減速 25% 1 s。暴雨(ex)箭數已在 castArrowRain 乘 1.5,
// 每跳傷害 ×1.25,定身 / 減速中的目標再 ×1.3(判斷在減速施加前做)。遠端重現不做任何目標判定。
function archRainTick(P, cx, gy, cz, R, ex, seen) {
  if (archRemote(P)) return;
  for (const d of DUMMIES) {
    if (d.dead || Math.abs(gy - d.y) > R + 1.5) continue;
    const dx = d.x - cx, dz = d.z - cz, dist = Math.hypot(dx, dz);
    if (dist >= R + .2) continue;
    const v = 9 * P.dmgK * (ex ? 1.25 : 1) * (ex && archSlowed(d) ? 1.3 : 1) * (1 - clamp(dist / (R + .2), 0, 1) * .7) * rnd(.9, 1.1);
    d.hit(v, dx, dz, 0, null);
    d.slow(1, .25); archMark(d, '_archSl', 1);
    archHitGain(P, d, seen);
  }
}
// 箭雨:落點上空 14 m 出現光圈陣(0~0.4 s);箭數 = CHG.count(40, q) 在 0.4~2.0 s 落下;每 0.2 s 範圍傷害一次(共 8 跳,每跳 9 × dmgK)
function castArrowRain(P, orb) {
  const E = casterAura(P), cx = P.target.x, cz = P.target.z, gy = P.target.y, R = P.r, ex = P.ex | 0, seen = new Set();
  if (orb) dissolveOrb(orb, E);
  const sig = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: RUNE_TEX, color: E.hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  sig.rotation.x = -Math.PI / 2; sig.position.set(cx, gy + 14, cz); sig.scale.setScalar(R * 2.6); scene.add(sig);
  const gi = new Indicator(scene);
  const n = Math.max(4, Math.round(CHG.count(40, P.q) * CFG.fxq * (ex ? 1.5 : 1)));
  const sched = []; for (let i = 0; i < n; i++) sched.push(.4 + i / n * 1.6 + prnd(P, 0, .08));
  sched.sort((a, b) => a - b);
  let age = 0, k = 0;
  addFx(dt => {
    age += dt;
    const fin = age > 2 ? Math.max(0, 1 - (age - 2) / .6) : 1, a0 = Math.min(1, age * 2.5);
    sig.material.opacity = a0 * .9 * fin; sig.rotation.z += dt * .6;
    gi.set(cx, cz, 0, R, 0, 0, 0, .45 * a0 * fin, E.hex, gy); gi.tick(age);
    while (sched.length && age >= sched[0]) { sched.shift(); rainArrow(cx, cz, gy, R, E, P); }
    while (k < 8 && age >= .4 + .2 * k) { k++; archRainTick(P, cx, gy, cz, R, ex, seen); }
    if (age > 3) {
      scene.remove(sig); sig.geometry.dispose(); sig.material.dispose(); gi.root.parent.remove(gi.root);
      return false;
    }
    return true;
  });
}
// 箭雨的一支箭:從天落到落點 0.35 s,插地 0.6 s 後消失,落地 3 顆煙塵
function rainArrow(cx, cz, gy, R, E, P) {
  const a = prnd(P, 0, 6.283), rr = Math.sqrt(prnd(P, 0, 1)) * R * .9, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr, gy2 = surfaceY(x, z, gy + 3), top = gy2 + 14;
  const mesh = arrowMesh(.9, .025, E.hex, 1);
  mesh.position.set(x, top, z); mesh.lookAt(x, gy2, z); scene.add(mesh);
  let t = 0, stuck = -1;
  addFx(dt => {
    if (stuck < 0) {
      t += dt / .35; const u = Math.min(1, t);
      mesh.position.set(x, lerp(top, gy2 + .2, u * u), z);
      if (u >= 1) { stuck = 0; for (let i = 0; i < 3; i++) smoke.emit(x, gy2 + .2, z, rnd(-1, 1), rnd(.3, 1), rnd(-1, 1), .6, rnd(.4, .8), [.5, .45, .4], [.3, .3, .3], .4, 2, 0, 1.5); }
      return true;
    }
    stuck += dt;
    if (stuck >= .6) { disposeObj(mesh); return false; }
    return true;
  });
}

/* ---------- 劍士(D3) ---------- */
// 弧形刀光(水平扇形,life 秒淡出);center 為圓心(地面),th 為朝向,R 外半徑
function arcSlash(center, R, th, hex, life) {
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.RingGeometry(R * .6, R, 24, 1, -.9, 1.8), m); mesh.rotation.x = -Math.PI / 2; g.add(mesh);
  g.position.set(center.x, center.y + 1, center.z); g.rotation.y = th - Math.PI / 2; scene.add(g);
  let t = 0;
  addFx(dt => {
    t += dt / life;
    if (t >= 1) { disposeObj(g); return false; }
    m.opacity = .9 * (1 - t); g.scale.setScalar(.8 + .2 * easeOut(t));
    return true;
  });
}

// 蓄力斬:圓心固定在角色前方 cfg.range(1.2 m);圓內標靶受傷並沿離開角色的方向擊退
function castPowerSlash(P, orb) {
  const E = casterAura(P), p = casterPos(P), cfg = CFG.skills.powerSlash;
  if (orb) dissolveOrb(orb, E);
  const cx = p.x + Math.sin(P.dir) * cfg.range, cz = p.z + Math.cos(P.dir) * cfg.range, cy = surfaceY(cx, cz, p.y + 2);
  areaHit(cx, cy, cz, P.r, 90 * P.dmgK, 1.5 * P.fxK, p.x, p.z);
  arcSlash(new V3(cx, cy, cz), P.r, P.dir, E.hex, .2);
  if (P.ex) {   // 破空斬(強化,P.ex 由 swordExFn 在施放時判定):沿方向射出劍氣,直線 9 m、穿透
    const dx = Math.sin(P.dir), dz = Math.cos(P.dir), from = new V3(p.x + dx * .8, p.y + 1, p.z + dz * .8), to = new V3(from.x + dx * SW.waveLen, from.y, from.z + dz * SW.waveLen);
    flyProjectile(from, to, 30, {
      mesh: arrowMesh(1.6, .05, E.hex, 1.6), hitR: .6, pierce: true, fade: true, stuck: .15, trail: IS_TOUCH ? 2 : 4, c0: E.c0, c1: E.c1,
      onHit: (d, b) => { d.hit(SW.waveDmg * P.dmgK, dx, dz, 0, null); hitFx(b, 10); }
    });
  }
}

// 旋風斬:自身圓(半徑 P.r);角色原地旋轉 0.6~1.8 s(4 圈/秒),每 0.3 s 對圈內打一次;旋轉中可移動(速度 ×0.5)
function castWhirlwind(P, orb) {
  const E = auraEl(), dur = lerp(.6, 1.8, P.q);
  if (orb) dissolveOrb(orb, E);
  P.recover = .14 + dur + CFG.skills.whirlwind.recover;
  G.spin = { t: 0, dur, n: Math.max(2, Math.round(dur / .3)), hits: 0, R: P.r, dmg: 22 * P.dmgK, hex: E.hex };
  burstRing(new V3(mage.root.position.x, mage.root.position.y, mage.root.position.z), E.hex, P.r);
}
// 旋風斬每幀(classTick 呼叫)
function spinTick(dt, p) {
  const S = G.spin, E = auraEl();
  S.t += dt; mage.spinY += Math.PI * 8 * dt;
  if (S.hits < S.n && S.t >= S.hits * .3) {
    S.hits++; areaHit(p.x, p.y, p.z, S.R, S.dmg); burstRing(new V3(p.x, p.y, p.z), E.hex, S.R * .8);
  }
  if (S.t >= S.dur) { G.spin = null; mage.spinY = 0; return; }
  const T = mage.tipWorld(new V3());
  for (let i = 0; i < (IS_TOUCH ? 1 : 2); i++) fire.emit(T.x, T.y, T.z, rnd(-1, 1), rnd(0, .5), rnd(-1, 1), .3, rnd(.1, .16), E.c0, E.c1, .9, .3, 0, .5);
}

// 衝鋒盾:舉盾以 18 m/s 沿線衝鋒 L × sizeK;撞到第一個標靶就停下(該標靶與其 1.5 m 內的標靶受傷 + 暈眩 + 擊退)
// 衝鋒中盾擋來襲測試(見 game.js strike 與 classes.js shieldOn);冷卻 3 s 從衝鋒結束開始計(endDash)
function castShieldCharge(P, orb) {
  const E = auraEl(), p = mage.root.position, dirx = Math.sin(P.dir), dirz = Math.cos(P.dir), dist = P.r;
  if (orb) dissolveOrb(orb, E);
  G.cd.shieldCharge = 0;   // release 時設的冷卻先清掉,衝鋒結束才開始計
  P.recover = .14 + dist / 18 + CFG.skills.shieldCharge.recover;
  burstRing(new V3(p.x, p.y, p.z), E.hex, 1.6);
  const glow = glowSprite(E.hex, 1.6, .8); glow.position.set(0, 0, .3); mage.shield.add(glow);
  G.dash = { kind: 'charge', dirx, dirz, yaw: P.dir, speed: 18, left: dist, t: 0, step: 0, s0x: p.x, s0z: p.z, dmgK: P.dmgK, fxK: P.fxK, glow };
}
// 衝鋒途中擋到的第一個標靶(前方 1.0 m + 半徑、寬 0.8 m 內)
function dashBlocker(p, D) {
  let best = null, bA = 9;
  for (const d of DUMMIES) {
    if (d.dead || Math.abs(d.y - p.y) > 1.6) continue;
    const dx = d.x - p.x, dz = d.z - p.z, along = dx * D.dirx + dz * D.dirz, across = -dx * D.dirz + dz * D.dirx;
    if (along > -.2 && along < 1.5 && Math.abs(across) < .9 && along < bA) { bA = along; best = d; }
  }
  return best;
}
// 盾擊:t 與其 1.5 m 內的標靶受傷 + 暈眩 + 擊退
function shieldBash(t, p, D) {
  const E = auraEl(), dmg = 50 * D.dmgK, st = 2.5 * D.fxK, kb = 1.5 * D.fxK;
  for (const e of DUMMIES) {
    if (e.dead || (e !== t && Math.hypot(e.x - t.x, e.z - t.z) > 1.5)) continue;
    const dx = e.x - p.x, dz = e.z - p.z, l = Math.hypot(dx, dz) || 1;
    e.hit(dmg, dx, dz, 0, null); e.stun(st); e.knock(dx / l, dz / l, kb);
  }
  hitFx(new V3(t.x, t.y + 1, t.z), 30); burstRing(new V3(t.x, t.y, t.z), E.hex, 1.2);
  flashLight(new V3(t.x, t.y + 1.5, t.z), E.hex, 5, .3, 10);
  G.shake = Math.max(G.shake, .2 * CFG.shake);
  G.comboT = SW.comboT;   // 盾擊連段窗(§2-2):1 s 內下一招集氣 ×0.4(swChargeK)
}

/* ---------- 位移(衝鋒盾 / 背刺閃身)每幀 ---------- */
// D.kind:'charge' 衝鋒盾(撞擊停下、撞牆停下);'blink' 背刺閃身(0.12 s 直線位移,不判定牆)
function dashTick(dt, p) {
  const D = G.dash;
  if (D.kind === 'charge') {
    if (D.t > 0 && Math.hypot(p.x - D.s0x, p.z - D.s0z) < .3 * D.step) { endDash(true); return; }   // 撞牆 / 高台側面:實際位移 < 30%
    const hit = dashBlocker(p, D);
    if (hit) { shieldBash(hit, p, D); endDash(true); return; }
  }
  const step = Math.min(D.speed * dt, D.left);
  D.s0x = p.x; D.s0z = p.z; D.step = step;
  p.x += D.dirx * step; p.z += D.dirz * step; D.left -= step; D.t += dt;
  const E = auraEl();
  if (D.kind === 'charge') {
    for (let i = 0; i < 2; i++) smoke.emit(p.x + rnd(-.3, .3), p.y + .1, p.z + rnd(-.3, .3), rnd(-.5, .5), rnd(.3, 1), rnd(-.5, .5), rnd(.5, .9), rnd(.4, .8), [.5, .45, .4], [.3, .3, .3], .4, 2, 0, 1.5);
    for (let i = 0; i < 2; i++) fire.emit(p.x - D.dirx * .5 + rnd(-.2, .2), p.y + 1 + rnd(-.3, .3), p.z - D.dirz * .5 + rnd(-.2, .2), -D.dirx * .5, rnd(-.2, .2), -D.dirz * .5, .35, rnd(.12, .2), E.c0, E.c1, .9, 1, 0, 2);
  } else if ((D.ghosts || 0) < 3) { D.ghosts = (D.ghosts || 0) + 1; ghostSprite(p, E.hex); }
  if (D.left <= 1e-4) endDash(false);
}
// 殘影:閃身途中的光點,0.2 s 淡出
function ghostSprite(p, hex) {
  const s = glowSprite(hex, 1.8, .6); s.position.set(p.x, p.y + 1, p.z); scene.add(s);
  let t = 0;
  addFx(dt => { t += dt / .2; if (t >= 1) { disposeObj(s); return false; } s.material.opacity = .6 * (1 - t); return true; });
}
// 結束位移:衝鋒盾 → 冷卻 3 s 從此刻起、盾收回;閃身 → 落點結算背刺
function endDash(stopped) {
  const D = G.dash; if (!D) return;
  G.dash = null;
  if (D.glow) { mage.shield.remove(D.glow); D.glow.material.dispose(); }
  if (D.kind === 'charge') { G.cd.shieldCharge = 3; G.dashEndT = G.time; }
  else if (D.end) D.end(stopped);
}
// 衝鋒盾 / 衝鋒中被來襲打中算盾擋(classes.js shieldOn 判斷):上面 classTick 會每幀呼叫 dashTick

/* ---------- 刺客(D4) ---------- */
// 背刺:閃身到落點(距離 ≤ range × sizeK,0.12 s),落點 1.6 m 內最近的標靶被刺擊;背後(±60°)倍率 ×2.5 → ×3.5,潛行中再 ×1.5
function castBackstab(P, orb) {
  const E = auraEl(), p = mage.root.position, cfg = CFG.skills.backstab;
  if (orb) dissolveOrb(orb, E);
  const dx = P.target.x - p.x, dz = P.target.z - p.z, d = Math.hypot(dx, dz), L = Math.min(d, cfg.range * P.sizeK);
  const dirx = d > .01 ? dx / d : Math.sin(P.dir), dirz = d > .01 ? dz / d : Math.cos(P.dir);
  P.recover = .14 + .12 + cfg.recover;
  G.tp = (G.tp | 0) + 1;   // 瞬移計數:遠端收到快照的 tp 改變時直接跳到新位置(§2-8)
  G.dash = { kind: 'blink', dirx, dirz, yaw: Math.atan2(dirx, dirz), speed: L / .12, left: L, t: 0, step: 0, s0x: p.x, s0z: p.z, hex: E.hex, ghosts: 0, end: () => backstabLand(P) };
}
function backstabLand(P) {
  const p = mage.root.position, E = auraEl();
  let best = null, bd = 1.6;
  for (const d of DUMMIES) {
    if (d.dead) continue;
    const dist = Math.hypot(d.x - p.x, d.z - p.z);
    if (dist < bd) { bd = dist; best = d; }
  }
  if (!best) return;   // 落點沒有標靶:只閃身
  const mp = typeof RemotePlayer !== 'undefined' && best instanceof RemotePlayer;   // 多人對他人:背後 ×2.0~2.8、潛行 ×1.3(NET_RULES.bsBack / bsStealth,狀態效果文件之前的 §3-4)
  const sb = G.shadowT > 0; if (sb) G.shadowT = 0;   // 暗影步後 1.5 s 內的下一刀視為背後
  const behind = behindOf(best, p) || sb;   // 標靶正面向量 · 指向攻擊者 ≤ -0.5(behindOf 在 skills_assassin.js)
  let dmg = 40 * P.dmgK;
  if (behind) {
    dmg *= mp ? lerp(NET_RULES.bsBack[0], NET_RULES.bsBack[1], P.q) : lerp(2.5, 3.5, P.q);
    if (G.stealth) dmg *= mp ? NET_RULES.bsStealth : 1.5; else if (inOwnSmoke()) dmg *= 1.3;   // 自己的煙中視同潛行加成
  }
  if (G.danceT > 0) { dmg *= 1.2; G.danceT = 0; }   // 影舞翻滾後的下一刀
  best.hit(dmg, best.x - p.x, best.z - p.z, 0, null);   // 會觸發 onPlayerHit → 潛行顯形
  gainEnergy(behind ? 2 : 1);   // 連擊點:命中 +1(背後 +2)
  if (behind) { best.poison(3, 1); }   // 淬毒(狀態效果文件 §2-4)
  if (behind) {
    banner('背刺!', '#ff4a4a');
    arcSlash(new V3(best.x, best.y, best.z), 1.6, Math.atan2(best.x - p.x, best.z - p.z), 0xff4a4a, .2);
    G.shake = Math.max(G.shake, .15 * CFG.shake);
  }
  hitFx(new V3(best.x, best.y + 1, best.z), 10);
}

// 飛刀:扇形平均射出 n 把(n = CHG.count(7, q),扇形角 = P.r 度),射程 cfg.range,各自命中第一個標靶後消失
function castKnives(P, orb) {
  const E = casterAura(P), cfg = CFG.skills.knives, n = CHG.count(7, P.q), A = P.r * Math.PI / 180, from = casterTip(P, new V3());
  if (orb) dissolveOrb(orb, E);
  let hits = 0; const poisoned = new Set();
  for (let i = 0; i < n; i++) {
    const a = P.dir + (n === 1 ? 0 : lerp(-A / 2, A / 2, i / (n - 1)));
    const dx = Math.sin(a), dz = Math.cos(a), to = new V3(from.x + dx * cfg.range, from.y, from.z + dz * cfg.range);
    flyProjectile(from, to, 40, {
      mesh: arrowMesh(.5, .025, 0xc08aff, 1), hitR: .3, stuck: .05, fade: false, trail: IS_TOUCH ? 1 : 2, c0: E.c0, c1: E.c1,
      onHit: d => {
        d.hit(18 * P.dmgK, d.x - from.x, d.z - from.z, 0, null); hitFx(new V3(d.x, d.y + 1, d.z), 6);
        if (!poisoned.has(d)) { poisoned.add(d); d.poison(2, 1); }   // 中毒 1 層 2 s(同一標靶只 +1)
        hits++; if (!P.net && (hits === 1 || hits === 3)) gainEnergy(1);   // 連擊點:命中 ≥1 把 +1、≥3 把再 +1
      }
    });
  }
}

// 潛行:持續 10 × fxK 秒(5 → 10 s);進入時記下位置(來襲測試以此為準);再次施放 = 手動顯形
function castStealth(P, orb) {
  const E = auraEl(), p = mage.root.position;
  if (orb) dissolveOrb(orb, E);
  G.cd.stealth = 0;
  if (G.stealth) { revealStealth('manual'); return; }
  const dur = 10 * P.fxK;
  G.stealth = { dur, left: dur, x: p.x, z: p.z };
  burstRing(new V3(p.x, p.y, p.z), E.hex, 1.6);
}
// 顯形:kind = 'time' | 'manual' | 'hit' | 'class'。除 'class' 外都進入虛弱 1.5 s;冷卻 6 s 從顯形開始計
function revealStealth(kind) {
  if (!G.stealth) return;
  const shadow = !!G.stealth.shadow;   // 影舞影遁(影分身):結束不虛弱、不進潛行冷卻
  G.stealth = null;
  const p = mage.root.position, n = IS_TOUCH ? 12 : 20;
  for (let i = 0; i < n; i++) {
    const a = rnd(0, 6.283), sp = rnd(1, 2.5);
    smoke.emit(p.x, p.y + 1, p.z, Math.cos(a) * sp, rnd(-.2, .8), Math.sin(a) * sp, rnd(.8, 1.2), rnd(.6, 1.2), [.35, .3, .4], [.1, .08, .12], .9, 2, 0, 1.2);
  }
  banner(shadow ? '影遁結束' : '顯形', '#c08aff');
  if (!shadow) G.cd.stealth = 6;
  if (kind !== 'class' && !shadow) G.weak = 1.5;
}
// 任何技能(非持續傷害)打中標靶 → 潛行中的玩家顯形(Dummy.hit 呼叫;持續傷害傳 'dot' 不呼叫);自己的煙中不顯形(skills_assassin.js)
window.onPlayerHit = () => { if (G.stealth && !inOwnSmoke()) revealStealth('hit'); };
