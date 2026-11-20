'use strict';
// 新武器招式:雙劍(設計_雙劍.md)、長劍 / 長弓 / 法杖的免費普攻(設計_武器技能系統 §3-3)、大絕招三招(設計_大絕招.md)。
// 約定同 skills_sword.js:P 為施放資料,P.net 代表遠端重現(只畫視覺,改動 G / mage 一律以 if (!P.net) 守門)。
// 載入順序:skills_assassin.js → skills_dual.js → resources.js → status.js → loadout.js → classes.js(classes.js 以函式名直接引用)。
// 掛點:classes.js 的 classTick 呼叫 dualTick(dt)(突進 / 亂舞 / 大招狀態);game.js release() 呼叫 sk.start(P)(出招動作)。

/* ---------- 連段狀態(三連斬 / 五連斬共用) ---------- */
G.combo = { ix: 0, t: -9 };
// 取下一段(0 起算);距離上一段結束超過 keep 秒就回第一段
function comboStep(n, keep) {
  const c = G.combo;
  if (G.time - c.t > (keep == null ? .4 : keep)) c.ix = 0;
  const i = c.ix % n; c.ix = (i + 1) % n; return i;
}
const comboEnd = rec => { G.combo.t = G.time + rec; };

/* ---------- 長劍普攻:三連斬(新;短判定、不集氣、免費) ---------- */
const SLASH3 = [{ dmg: 18, kb: .3, R: 1.5, tpl: 'slashA', act: 'sword.slash1' }, { dmg: 18, kb: .3, R: 1.5, tpl: 'slashB', act: 'sword.slash2' }, { dmg: 30, kb: 1.0, R: 1.7, tpl: 'vert', act: 'sword.slash3' }];
function startSlash(P) { P.ci = comboStep(3); actPlay(SLASH3[P.ci].act); }
function castSlash(P, orb) {
  const c = SLASH3[P.ci | 0], p = casterPos(P);
  if (orb) dissolveOrb(orb, casterAura(P));
  const cx = p.x + Math.sin(P.dir) * 1.1, cz = p.z + Math.cos(P.dir) * 1.1, cy = surfaceY(cx, cz, p.y + 2);
  areaHit(cx, cy, cz, c.R, c.dmg, c.kb, p.x, p.z, p);
  if (skOk(P)) skTrail(p, P.dir, SK_TPL[c.tpl]);
  comboEnd(.4 + P.recover);
}

/* ---------- 雙劍普攻:五連斬(左右交替;前 4 段不推人,第 5 段雙劍 X 斬) ---------- */
const DUALN = [{ dmg: 16, R: 1.3, kb: 0, act: 'dual.n1' }, { dmg: 16, R: 1.3, kb: 0, act: 'dual.n2' }, { dmg: 17, R: 1.4, kb: 0, act: 'dual.n3' }, { dmg: 17, R: 1.3, kb: 0, act: 'dual.n4' }, { dmg: 32, R: 1.5, kb: .3, act: 'dual.n5' }];
function startDualN(P) { P.ci = comboStep(5); P.recover = [.28, .28, .3, .3, .44][P.ci]; actPlay(DUALN[P.ci].act); const c = DUALN[P.ci]; if (skOk(P)) after(.04, () => skActFx(c.act, mage.root.position, P.dir)); }
function castDualN(P, orb) {
  const c = DUALN[P.ci | 0], p = casterPos(P);
  if (orb) dissolveOrb(orb, casterAura(P));
  const cx = p.x + Math.sin(P.dir) * 1.0, cz = p.z + Math.cos(P.dir) * 1.0, cy = surfaceY(cx, cz, p.y + 2);
  areaHit(cx, cy, cz, c.R, c.dmg, c.kb, p.x, p.z, p);
  comboEnd(.4 + P.recover);
}

/* ---------- 雙劍技能(兩段集氣:第一段 q = .4、第二段 q = 1) ---------- */
// 疾影突刺:沿面向突進 lerp(4, 9, q) m(26 m/s),穿過沿途敵人各吃一次 40 × dmgK;終點一記 X 斬(視覺)
function castDualDash(P, orb) {
  const E = casterAura(P), p = casterPos(P), dx = Math.sin(P.dir), dz = Math.cos(P.dir), want = lerp(4, 9, P.q);
  if (orb) dissolveOrb(orb, E);
  let L = want;
  if (!P.net) { L = Math.max(.5, Math.min(want, blockDist(p.x, p.z, p.y + 1, dx, dz, want + .5, false) - .5)); const rr = Math.hypot(p.x + dx * L, p.z + dz * L), lim = ARENA_R - .5; if (rr > lim) L = Math.max(.5, L - (rr - lim)); }
  const from = new V3(p.x, p.y + 1, p.z), to = new V3(p.x + dx * L, p.y + 1, p.z + dz * L);
  if (skOk(P)) { skLine(from, to, .45, .3, { grow: .12 }); after(L / 26, () => { skTrail(new V3(to.x, p.y, to.z), P.dir, SK_TPL.crossA); skTrail(new V3(to.x, p.y, to.z), P.dir, SK_TPL.crossB); }); }
  if (P.net) return;
  P.recover = .14 + L / 26 + .25;
  G.rush = { kind: 'dual', t: 0, dur: Math.max(.1, L / 26), x0: p.x, z0: p.z, dx, dz, L, hit: new Set(), dmg: 40 * P.dmgK, r: 1.3 };
}
// 千刃亂舞:原地連斬 floor(lerp(2, 6, q)) 次(每 .24 s 一次 17 × dmgK,視覺每 .12 s 一刀),收尾交叉斬 15 × dmgK + 擊退 1 m
function castDualFlurry(P, orb) {
  const E = casterAura(P), p = casterPos(P), n = Math.floor(lerp(2, 6, P.q) + 1e-6), dur = n * .24;
  if (orb) dissolveOrb(orb, E);
  const dir = P.dir;
  if (skOk(P)) {
    for (let i = 0; i < n * 2; i++) after(i * .12 + .03, () => skTrail(casterPos(P), dir, i % 2 ? SK_TPL.slashB : SK_TPL.slashA, { follow: P.net ? null : mage }));
    after(dur + .02, () => { skTrail(casterPos(P), dir, SK_TPL.crossA); skTrail(casterPos(P), dir, SK_TPL.crossB); burstRing(new V3(casterPos(P).x, casterPos(P).y, casterPos(P).z), SKC.main, 2); });
  }
  if (P.net) return;
  P.recover = .14 + dur + .35 + .3;
  G.flurry = { t: 0, n, hits: 0, dir, dmg: 17 * P.dmgK, endDmg: 15 * P.dmgK, ended: false };
  after(dur + .02, () => { if (mage._clip && mage._clip.c.name === 'dual.flurry') mage._clip = null; actPlay('dual.flurryEnd'); });
}
// 十字裂空:X 形劍氣沿面向直飛 lerp(6, 12, q) m(28 m/s)、寬 1.6、穿透;命中 35 × dmgK + 減速 2 s(20% → 40%)
function castDualCross(P, orb) {
  const E = casterAura(P), p = casterPos(P), dx = Math.sin(P.dir), dz = Math.cos(P.dir), L = lerp(6, 12, P.q), y0 = p.y + 1.2;
  if (orb) dissolveOrb(orb, E);
  const from = new V3(p.x + dx * .8, y0, p.z + dz * .8), to = new V3(from.x + dx * L, y0, from.z + dz * L);
  if (skOk(P)) { skTrail(p, P.dir, SK_TPL.crossA, { follow: P.net ? null : mage }); skTrail(p, P.dir, SK_TPL.crossB, { follow: P.net ? null : mage }); skLine(from, to, 1.2, .3, { grow: L / 28 }); }
  const mesh = arrowMesh(1.4, .05, SKC.main, 1.4), seen = new Set(), sl = lerp(.2, .4, P.q);
  flyProjectile(from, to, 28, {
    mesh, hitR: .8, pierce: true, solid: true, fade: true, stuck: .1, trail: 0, c0: E.c0, c1: E.c1,
    onHit: (d, b) => { hitFx(b, 10); if (P.net) return; d.hit(35 * P.dmgK, dx, dz, 0, null); d.slow(2, sl); }
  });
}

/* ---------- 大絕招(設計_大絕招.md;冷卻 75 s、開場 30 s、不扣 MP;兩段集氣 T1 / T2) ---------- */
const ULT = { cd: 75, open: 30 };
// 隕星天罰:落點圈(第一段 R 4.5 / 第二段 R 6.5)→ 1.6 s 後隕石墜落;核心(R ≈ 46%)95 / 外圈 55(第二段,實扣),第一段 60 / 35 無跌倒
function castMeteorUlt(P, orb) {
  const E = casterAura(P), full = P.q >= .99, R = full ? 6.5 : 4.5, Rc = R * .46, cx = P.target.x, cz = P.target.z, y = terrainH(cx, cz), T = 1.6;
  if (orb) dissolveOrb(orb, E);
  skyMarker(cx, cz, R, T, 0xff4a1a);
  const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), new THREE.MeshBasicMaterial({ color: 0xff7a2a })); rock.position.set(cx - 14, y + 30, cz - 8); scene.add(rock);
  let age = 0; const x0 = cx - 14, z0 = cz - 8, y0 = y + 30;
  addFx(dt => {
    age += dt; const u = Math.min(1, Math.max(0, (age - (T - .8)) / .8));
    rock.visible = u > 0; rock.position.set(lerp(x0, cx, u), lerp(y0, y + .5, u * u), lerp(z0, cz, u)); rock.rotation.x += dt * 6;
    if (u > 0) fire.emit(rock.position.x, rock.position.y, rock.position.z, rnd(-1, 1), rnd(0, 2), rnd(-1, 1), .5, rnd(.5, 1), EL.fire.c0, EL.fire.c1, .9, .5);
    if (age >= T) { scene.remove(rock); rock.geometry.dispose(); rock.material.dispose(); return false; }
    return true;
  });
  after(T, () => {
    burstRing(new V3(cx, y, cz), 0xff7a1a, R); burstRing(new V3(cx, y, cz), 0xffd27a, Rc); hitFx(new V3(cx, y + 1, cz), 30);
    if (!P.net) G.shake = Math.max(G.shake, .5 * CFG.shake);
    if (P.net) return;
    const core = full ? 95 : 60, outer = full ? 55 : 35;
    for (const d of DUMMIES) {
      if (d.dead || Math.abs(y - d.y) > 3) continue;
      const dx = d.x - cx, dz = d.z - cz, dist = Math.hypot(dx, dz);
      if (dist >= R + .2) continue;
      const l = dist || 1, inCore = dist <= Rc;
      d.hit((inCore ? core : lerp(outer, outer * .8, clamp((dist - Rc) / (R - Rc), 0, 1))) / NET_RULES.dmgK, dx, dz, 0, null);
      if (inCore && full) d.knockDown(1.2, dx / l, dz / l); else if (!inCore) d.knock(dx / l, dz / l, 3);
    }
  });
}
// 破軍龍突:直線突進 9 / 16 m(32 m/s),沿途撞擊 35、終點爆炸 R 3 的 45(第一段 30);突進中不被控制,收招 0.9 s
function castDragonUlt(P, orb) {
  const E = casterAura(P), p = casterPos(P), dx = Math.sin(P.dir), dz = Math.cos(P.dir), want = P.q >= .99 ? 16 : 9;
  if (orb) dissolveOrb(orb, E);
  let L = want;
  if (!P.net) { L = Math.max(1, Math.min(want, blockDist(p.x, p.z, p.y + 1, dx, dz, want + .5, false) - .6)); const rr = Math.hypot(p.x + dx * L, p.z + dz * L), lim = ARENA_R - .5; if (rr > lim) L = Math.max(1, L - (rr - lim)); }
  const from = new V3(p.x, p.y + 1, p.z), to = new V3(p.x + dx * L, p.y + 1, p.z + dz * L);
  skLine(from, to, 1.1, .5, { grow: L / 32 });
  after(L / 32, () => { burstRing(new V3(to.x, p.y, to.z), 0xffd27a, 3); hitFx(new V3(to.x, p.y + 1, to.z), 24); });
  if (P.net) return;
  P.recover = .14 + L / 32 + .9;
  G.rush = { kind: 'dragon', t: 0, dur: Math.max(.15, L / 32), x0: p.x, z0: p.z, dx, dz, L, hit: new Set(), dmg: 35 / NET_RULES.dmgK, r: 1.4, endDmg: (P.q >= .99 ? 45 : 30) / NET_RULES.dmgK, endR: 3 };
  G.unyT = Math.max(G.unyT, 0); G.rushImm = L / 32 + .05;
}
// 鬥神降臨:第一段 5 s / 第二段 8 s:造成傷害 ×1.3、冷卻 ×2、移速 +15%、不被控制、受傷 ×0.85、吸血 20%、模型 ×1.25;結束崩潰 3 s(移速 ×0.6、受傷 ×1.2)
function castGodUlt(P, orb) {
  const E = casterAura(P), p = casterPos(P), dur = P.q >= .99 ? 8 : 5;
  if (orb) dissolveOrb(orb, E);
  burstRing(new V3(p.x, p.y, p.z), 0xff3a3a, 4); burstRing(new V3(p.x, p.y, p.z), 0xffd27a, 2.5);
  if (P.net) { const rp = REMOTES[String(P.net)]; if (rp && rp.mage) { rp.mage.root.scale.setScalar(1.25); after(dur, () => rp.mage.root.scale.setScalar(1)); } return; }
  G.godT = dur; G.crashT = 0; mage.root.scale.setScalar(1.25);
  G.shake = Math.max(G.shake, .3 * CFG.shake);
}
const godOn = () => G.godT > 0;

/* ---------- 每幀(classes.js classTick 末尾呼叫) ---------- */
function distSeg(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz, t = l2 > 0 ? clamp(((px - ax) * vx + (pz - az) * vz) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}
function dualTick(dt) {
  const p = mage.root.position;
  if (G.down > 0 || G.stun > 0 && G.rush && G.rush.kind === 'dual') { if (G.rush) G.rush = null; if (G.flurry) G.flurry = null; }
  if (G.swapAct > 0 || G.state === 'ready') { if (G.flurry && G.state !== 'cast') G.flurry = null; }
  // 突進(疾影突刺 / 破軍龍突):每幀依時間插值位置,沿途判定
  const R = G.rush;
  if (R) {
    R.t += dt; const u = Math.min(1, R.t / R.dur), nx = R.x0 + R.dx * R.L * u, nz = R.z0 + R.dz * R.L * u, px = p.x, pz = p.z;
    p.x = nx; p.z = nz; p.y = Math.max(p.y, terrainH(nx, nz)); G.vy = 0;
    for (const d of DUMMIES) {
      if (d.dead || R.hit.has(d) || Math.abs(p.y - d.y) > 3) continue;
      if (distSeg(d.x, d.z, px, pz, nx, nz) < R.r) { R.hit.add(d); d.hit(R.dmg, R.dx, R.dz, 0, null); if (R.kind === 'dragon') d.knock(R.dx, R.dz, 3); hitFx(new V3(d.x, d.y + 1, d.z), 12); }
    }
    if (mage.opq >= .5 && R.kind === 'dragon') fire.emit(p.x, p.y + 1, p.z, rnd(-.5, .5), rnd(0, 1), rnd(-.5, .5), .5, rnd(.3, .5), [1, .85, .4], [.9, .5, .1], .9, .5);
    if (u >= 1) {
      if (R.kind === 'dragon') {
        burstRing(new V3(p.x, p.y, p.z), 0xffd27a, R.endR); G.shake = Math.max(G.shake, .3 * CFG.shake);
        for (const d of DUMMIES) { if (d.dead || Math.hypot(d.x - p.x, d.z - p.z) > R.endR + .2) continue; d.hit(R.endDmg, d.x - p.x, d.z - p.z, 0, null); d.lift(1.5 * .6); d.knockDown(1.0, R.dx, R.dz); }
      }
      G.rush = null; if (mage._clip && mage._clip.c.name === 'dual.dash') mage._clip = null;
    }
  }
  if (G.rushImm > 0) { G.rushImm -= dt; G.hardImmT = Math.max(G.hardImmT, .1); }   // 龍突中免控制(韌性)
  // 千刃亂舞:每 .24 s 前方扇形(圓)一次,結束交叉斬
  const F = G.flurry;
  if (F) {
    F.t += dt;
    while (F.hits < F.n && F.t >= (F.hits + 1) * .24 - .1) { F.hits++; const cx = p.x + Math.sin(F.dir) * 1.0, cz = p.z + Math.cos(F.dir) * 1.0; areaHit(cx, p.y, cz, 1.9, F.dmg, 0, p.x, p.z, p); }
    if (!F.ended && F.hits >= F.n && F.t >= F.n * .24) { F.ended = true; const cx = p.x + Math.sin(F.dir) * 1.0, cz = p.z + Math.cos(F.dir) * 1.0; areaHit(cx, p.y, cz, 2.0, F.endDmg, 1.0, p.x, p.z, p); }
    if (F.t >= F.n * .24 + .4) G.flurry = null;
  }
  // 鬥神降臨 / 崩潰
  if (G.godT > 0) {
    G.godT -= dt; G.hardImmT = Math.max(G.hardImmT, .1);
    if (mage.opq >= .5 && Math.random() < .6) fire.emit(p.x + rnd(-.4, .4), p.y + .2, p.z + rnd(-.4, .4), rnd(-.3, .3), rnd(1.5, 3), rnd(-.3, .3), .6, rnd(.2, .4), [1, .6, .2], [.9, .1, .05], .8, .5);
    if (G.godT <= 0) { G.godT = 0; G.crashT = 3; mage.root.scale.setScalar(1); banner('鬥神降臨 結束・崩潰', '#c0a080'); }
  } else if (G.crashT > 0) G.crashT = Math.max(0, G.crashT - dt);
  if (G.down > 0 && (G.godT > 0 || G.crashT > 0)) { G.godT = 0; G.crashT = 0; mage.root.scale.setScalar(1); }   // 倒下:立即結束,不進崩潰
}
// 倍率(掛在 classTick spdK、playerHurt、release dmgK、updateCasting 冷卻)
const godSpd = () => G.godT > 0 ? 1.15 : (G.crashT > 0 ? .6 : 1);
const godHurtK = () => G.godT > 0 ? .85 : (G.crashT > 0 ? 1.2 : 1);
const godDmgK = () => G.godT > 0 ? 1.3 : 1;

/* ---------- 出招動作(release 呼叫):沒有 start 的招式依表 / kind 播 poses.js 片段 ---------- */
const ACT_OF = { powerSlash: 'sword.slash3', skyLeap: 'sword.leap', parry: 'sword.parry', quickShot: 'bow.shoot', shockArrow: 'bow.bigShot', arrowRain: 'bow.rain', disengage: 'bow.backShot', dualDash: 'dual.dash', dualFlurry: 'dual.flurry', dualCross: 'dual.cross', meteorUlt: 'staff.sky', godUlt: 'gen.overhead', dragonUlt: 'dual.dash' };
const ACT_KIND = { bolt: 'staff.bolt', wall: 'staff.wall', sky: 'staff.sky', summon: 'staff.summon' };
function skStartAct(P) {
  const sk = P.skill;
  if (sk.start) { sk.start(P); return; }
  let a = ACT_OF[sk.id]; if (!a && G.cls === 'mage') a = ACT_KIND[sk.kind];
  if (a) actPlay(a, a === 'dual.flurry' ? { loop: true } : undefined);
}
// 吸血:鬥神降臨期間造成的實扣傷害 20% 回血(單人稻草人;多人由 netShowDmg 呼叫 godLifesteal)
function godLifesteal(real) { if (G.godT > 0 && real > 0 && G.down <= 0) playerHeal(real * .2); }
if (typeof Dummy === 'function' && !Dummy.prototype._godLs) {
  const hit1 = Dummy.prototype.hit;
  Dummy.prototype.hit = function (dmg, dx, dz, burn, el, src) { if (!this.dead && src !== 'dot' && !window.NETON) godLifesteal(dmg * NET_RULES.dmgK); return hit1.apply(this, arguments); };
  Dummy.prototype._godLs = true;
}
