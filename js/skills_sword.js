'use strict';
// 劍士進階招式(設計_職業進階技能.md §2-2、§4-2;設計_狀態效果系統.md §2-3 / §4 Z3-B):盾勢的 格擋反擊 / 震地,
//   劍勢第 3 格 旋風疾行、第 4 格絕技 震天躍擊(不屈戰意 castUnyield 保留但已不在快捷列),破空斬的強化判定,鬥氣流失與格擋 / 不屈的網路否決掛點。
// 載入順序:skills.js → skills_archer.js → skills_sword.js → skills_assassin.js → resources.js → status.js → classes.js(index.html)。
// 註冊:classes.js 的 CLASSES.swordsman.skills 以函式名直接引用(cast: castParry 等)。
// 約定:P 為施放資料,orb 為能量球;P.net 代表遠端重現,改動 G / mage 一律以 if (!P.net) 守門(遠端只畫視覺)。
// 掛點:netcombat.js 的 netApplyHit 呼叫 parryOn(from, rt) / onParry(from) / swHitK / swFxAdjust;game.js 的 strike、chargeTimeEff 呼叫 swParryStrike / swChargeK;
//       classes.js 的 classTick 呼叫 swordTick(dt)。

const SW = {
  parryWin: .5, parryOkCd: 1, parryFull: .6, parryGain: 20, parryRange: 3, parryDeg: 75,   // 格擋窗 / 成功後格擋冷卻 / 成功後下一招瞬間滿的窗 / 鬥氣獎勵 / 反擊距離 / 正面半角
  parryDmg: 30, parryStun: .6,                                                                 // 反擊盾擊原始傷害(× CHG.dmg(1))、暈眩秒數
  slamDmg: 30, slamLift: 1, slamDown: .5,                                                       // 震地:原始傷害、擊飛高度 × fxK、跌倒秒數
  waveDmg: 45, waveLen: 8,                                                                     // 破空斬劍氣:原始傷害、射程
  exCost: 30, exMin: .999,                                                                      // 破空斬:鬥氣門檻 / 集氣 MAX 判定
  unyMin: 50, unyBase: 2, unyPer: 25, unyWeak: 2,                                               // 不屈:最低鬥氣、基礎秒數 + 鬥氣 / 25、結束後虛弱秒數
  comboK: .4, comboT: 1,                                                                        // 盾擊後 1 s 內下一招集氣 ×0.4
  drainAfter: 5, drainPer: 8,                                                                   // 鬥氣流失:5 s 無收支後每秒 −8
  stanceFrontK: .7, stanceKbK: .5                                                               // 盾勢:正面 ±60° 傷害 ×0.7、擊退距離 ×0.5
};
const SW_LOG = [];   // 格擋窗紀錄 {t, yaw}(多人 parryOn 用;時間軸與 NET_INV_LOG 相同:Net.now())

/* ---------- 共用:方向 / 時間 ---------- */
const swNow = () => (window.NETON && Net.me ? Net.now() : G.time * 1000);
// 攻擊者 (ax,az) 是否在以 (bx,bz) 為原點、朝向 yaw 的正面錐內(半角 deg);距離太近視為正面
function swFrontOf(yaw, ax, az, bx, bz, deg) {
  const tx = ax - bx, tz = az - bz, l = Math.hypot(tx, tz);
  if (l < .3) return true;
  return (Math.sin(yaw) * tx + Math.cos(yaw) * tz) / l >= Math.cos(deg * Math.PI / 180);
}
// 盾勢正面減傷:dx,dz 為攻擊向量(受害者 − 攻擊者),攻擊者在正面 ±60° 時 ×0.7;(0,0)(DOT 等)視為非正面
function swHitK(dx, dz) {
  if (G.cls !== 'swordsman' || G.stance !== 1) return 1;
  const l = Math.hypot(dx, dz);
  if (l < 1e-3) return 1;
  return (Math.sin(mage.yaw) * dx + Math.cos(mage.yaw) * dz) / l <= -.5 ? SW.stanceFrontK : 1;
}
// 擊退的收件調整(netApplyHit 用):旋風斬中免擊退;盾勢擊退距離 ×0.5。回傳新物件,不改原 fx
function swFxAdjust(fx) {
  if (!fx || !fx.kb || G.cls !== 'swordsman') return fx;
  const k = G.spin ? 0 : (G.stance === 1 ? SW.stanceKbK : 1);
  return Object.assign({}, fx, { kb: [fx.kb[0] * k, fx.kb[1] * k] });
}
// 盾擊(格擋反擊的反擊):t 與其 1.5 m 內的標靶受傷 + 暈眩(原始傷害 dmg)
function swBash(t, dmg, st) {
  const E = auraEl(), p = mage.root.position;
  for (const e of DUMMIES) {
    if (e.dead || (e !== t && Math.hypot(e.x - t.x, e.z - t.z) > 1.5)) continue;
    e.hit(dmg, e.x - p.x, e.z - p.z, 0, null); e.stun(st);
  }
  hitFx(new V3(t.x, t.y + 1, t.z), 20); burstRing(new V3(t.x, t.y, t.z), E.hex, 1.2);
}

/* ---------- 格擋反擊(B-1,瞬發) ---------- */
// 格擋成功獎勵(窗內只給一次):鬥氣 +20、格擋冷卻改 1 s、0.6 s 內下一招集氣瞬間滿
function swParried() {
  if (G.parryOk) return false;
  G.parryOk = true;
  gainEnergy(SW.parryGain);
  G.cd.parry = Math.min(G.cd.parry || 0, SW.parryOkCd);
  G.parryFullT = SW.parryFull;
  return true;
}
// 反擊:攻擊者在 3.5 m 內時盾擊(39 原始 ≈ 15.6 實扣 + 暈 0.6 s);from 為攻擊者座位(多人),null = 單人來襲(取最近的稻草人)
function swCounter(from) {
  const p = mage.root.position;
  let t = null;
  if (from != null) { const rp = REMOTES[String(from)]; if (rp && !rp.dead) t = rp; }
  else {
    let bd = SW.parryRange;
    for (const d of DUMMIES) { if (d.dead) continue; const dd = Math.hypot(d.x - p.x, d.z - p.z); if (dd < bd) { bd = dd; t = d; } }
  }
  if (!t || Math.hypot(t.x - p.x, t.z - p.z) > SW.parryRange) return;
  swBash(t, SW.parryDmg * CHG.dmg(1), SW.parryStun);
}
// 網路格擋否決(netApplyHit 呼叫):攻擊者在我的正面 ±75° 且其看到的時間點 ±60 ms 內我處於格擋窗 → 擋下
function parryOn(from, rt) {
  const rp = REMOTES[String(from)];
  if (!rp) return false;
  const p = mage.root.position;
  return SW_LOG.some(e => Math.abs(e.t - rt) <= NET_RULES.vetoMs && swFrontOf(e.yaw, rp.px, rp.pz, p.x, p.z, SW.parryDeg));
}
// 擋下後的獎勵與反擊(netApplyHit 與單人來襲共用);同一格擋窗只給一次獎勵
function onParry(from) {
  if (swParried()) swCounter(from);
}
// 單人來襲(game.js strike):爆點在正面 ±75° 且格擋窗內 → 擋下
function swParryStrike(x, z) {
  if (!(G.parryT > 0)) return false;
  const p = mage.root.position;
  if (!swFrontOf(G.parryYaw, x, z, p.x, p.z, SW.parryDeg)) return false;
  onParry(null);
  return true;
}
function castParry(P, orb) {
  const E = casterAura(P), p = casterPos(P);
  if (orb) dissolveOrb(orb, E);
  burstRing(new V3(p.x, p.y, p.z), E.hex, 1.4);
  if (P.net) return;   // 遠端格擋只靠快照的 GUARD 位元畫盾光(netSilent,實際不會進來)
  G.parryT = SW.parryWin; G.parryYaw = P.dir; G.parryOk = false;
}

/* ---------- 震地(B-2,自身圓) ---------- */
// 自身圓內的標靶受傷 + 擊飛 0.5~1.0 m + 跌倒 0.5 s(不用暈眩;跌倒走控制遞減,同樣打斷集氣)
function castSlam(P, orb) {
  const E = casterAura(P), p = casterPos(P), R = P.r;
  if (orb) dissolveOrb(orb, E);
  burstRing(new V3(p.x, p.y, p.z), E.hex, R);
  if (!P.net) G.shake = Math.max(G.shake, .2 * CFG.shake);
  for (const d of DUMMIES) {
    if (d.dead || Math.abs(p.y - d.y) > R + 1.5) continue;
    const dx = d.x - p.x, dz = d.z - p.z, dist = Math.hypot(dx, dz);
    if (dist >= R + .2) continue;
    const l = dist || 1;
    d.hit(SW.slamDmg * P.dmgK * (1 - clamp(dist / (R + .2), 0, 1) * .7), dx, dz, 0, null);
    d.lift(SW.slamLift * P.fxK); d.knockDown(SW.slamDown, dx / l, dz / l);
  }
}

/* ---------- 震天躍擊(第 4 格絕技,兩架勢共用,集氣決定一切;C 型:跳躍只在本機) ---------- */
// q = 集氣量 0~1:距離 / 最高點 / 落地半徑 / 傷害 / 滯空時間全由 CFG.skills.skyLeap 的 min~max 線性插值
function skyStats(q) {
  const c = CFG.skills.skyLeap;
  return { dist: lerp(c.distMin, c.distMax, q), H: lerp(c.hMin, c.hMax, q), R: lerp(c.areaMin, c.areaMax, q), dmg: lerp(c.dmgMin, c.dmgMax, q), T: lerp(c.tMin, c.tMax, q) };
}
// 規劃:從 (x0,z0) 朝 dir 跳,落點夾在場地邊界內(本機瞄準圈、本機起跳、遠端重現共用,結果一致)
function skyPlan(q, x0, z0, dir) {
  const s = skyStats(q);
  let x1 = x0 + Math.sin(dir) * s.dist, z1 = z0 + Math.cos(dir) * s.dist;
  const rr = Math.hypot(x1, z1), lim = ARENA_R - .5;
  if (rr > lim) { x1 *= lim / rr; z1 *= lim / rr; }
  s.x1 = x1; s.z1 = z1; s.dist = Math.hypot(x1 - x0, z1 - z0);
  return s;
}
// 落點標記(本機與遠端都畫,讓對手看得到並用翻滾躲):地面的圈 + 由內往外逐漸填滿的圓盤,填滿瞬間 = 落地結算時刻
function skyMarker(x, z, R, T, hex) {
  const y = terrainH(x, z), gi = new Indicator(scene), disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: .3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2; disc.position.set(x, y + .06, z); disc.scale.setScalar(.01); scene.add(disc);
  gi.setMax(R, 0, 0);
  let age = 0;
  addFx(dt => {
    age += dt; const u = Math.min(1, age / T);
    gi.set(x, z, 0, R, 0, 0, u, .95, hex, y); gi.tick(age);
    disc.scale.setScalar(Math.max(.01, R * u)); disc.material.opacity = .15 + .3 * u;
    if (age >= T + .25) {
      gi.root.parent.remove(gi.root); gi.mat.dispose(); gi.mesh.geometry.dispose();
      scene.remove(disc); disc.geometry.dispose(); disc.material.dispose();
      return false;
    }
    return true;
  });
}
// 本機:G.leap 每幀覆寫位置(swordTick 呼叫 leapTick,在 updatePlayer 之前),施放期間 cast 鎖定移動;落地時結算
// 遠端:不動位置(快照內插),只畫落點標記(與本機相同的規劃,位置 / 方向 / q 來自 cast 事件)
function castSkyLeap(P, orb) {
  const E = casterAura(P), cfg = CFG.skills.skyLeap, p = casterPos(P), pl = skyPlan(P.q, p.x, p.z, P.dir);
  if (orb) dissolveOrb(orb, E);
  P.recover = .14 + pl.T + cfg.recover;   // 跳躍期間鎖住移動(updatePlayer 的 cast 鎖定)
  P.target.set(pl.x1, terrainH(pl.x1, pl.z1), pl.z1); P.r = pl.R;   // 施放中的光圈淡出以實際落點 / 半徑畫
  skyMarker(pl.x1, pl.z1, pl.R, pl.T, E.hex);
  if (P.net) return;
  G.leap = { t: 0, x0: p.x, z0: p.z, y0: p.y, x1: pl.x1, z1: pl.z1, px: p.x, pz: p.z, pl: pl, P: P, E: E };
  burstRing(new V3(p.x, p.y, p.z), E.hex, 1.4);
}
// 每幀(swordTick):拋物線位置;落地(t ≥ T)時結算落點範圍
// 撞牆:水平落點進入碰撞體或平台側面(判定同 updatePlayer 的推出)就停在撞點(上一個不重疊的點),並立即以撞點結算落地
function leapBlocked(x, z, y) {
  for (const c of COLLIDERS) { if (c.ref && c.ref.dead) continue; if (Math.hypot(x - c.x, z - c.z) < c.r + .4) return true; }
  for (const H of PLATFORMS) {
    if (platTop(H, x, z) <= y + (H.kind === 'ramp' ? RAMP_UP : STEP_UP) || (H.bottom != null && y + PLAYER_H < H.bottom)) continue;
    if (platContains(H, x, z, PLAYER_R)) return true;
  }
  return false;
}
function leapTick(dt) {
  const L = G.leap, p = mage.root.position;
  L.t += dt;
  const u = Math.min(1, L.t / L.pl.T);
  const nx = L.x0 + (L.x1 - L.x0) * u, nz = L.z0 + (L.z1 - L.z0) * u;
  const ny = L.y0 + (terrainH(nx, nz) - L.y0) * u + 4 * L.pl.H * u * (1 - u);
  if (leapBlocked(nx, nz, ny)) { L.x1 = L.px; L.z1 = L.pz; G.leap = null; G.vy = 0; G.ground = false; leapLand(L); return; }
  L.px = nx; L.pz = nz;
  p.x = nx; p.z = nz; p.y = ny;
  G.vy = 0; G.ground = false;
  fire.emit(p.x, p.y + .2, p.z, rnd(-.5, .5), rnd(0, .5), rnd(-.5, .5), .3, rnd(.08, .14), L.E.c0, L.E.c1, .9, .3, 0, .5);
  if (u >= 1) { G.leap = null; leapLand(L); }
}
// 落點範圍(走與震地相同的 d.hit / d.knockDown 路徑:多人時由受害者端的翻滾無敵窗否決):傷害中心 100% → 外圈 edgeK、跌倒 downT、螢幕震動
function leapLand(L) {
  const P = L.P, E = L.E, cfg = CFG.skills.skyLeap, x = L.x1, z = L.z1, y = terrainH(x, z), R = L.pl.R;
  burstRing(new V3(x, y, z), E.hex, R); hitFx(new V3(x, y + 1, z), 24);
  G.shake = Math.max(G.shake, .35 * CFG.shake);
  for (const d of DUMMIES) {
    if (d.dead || Math.abs(y - d.y) > R + 1.5) continue;
    const dx = d.x - x, dz = d.z - z, dist = Math.hypot(dx, dz);
    if (dist >= R + .2) continue;
    const l = dist || 1;
    d.hit(L.pl.dmg * (P.dmgMul || 1) * (1 - clamp(dist / (R + .2), 0, 1) * (1 - cfg.edgeK)), dx, dz, 0, null);
    d.knockDown(cfg.downT, dx / l, dz / l);
  }
}

/* ---------- 旋風疾行(劍勢第 3 格,按住持續型;不經集氣 / cast 狀態,G.state 維持 ready) ---------- */
// 按住施法鈕(手機 #btnAtk / 桌機左鍵 / 手把)立刻開始,放開或 SP 耗盡停止並進入冷卻。G.whirlRun 存在期間:
//   updatePlayer 以跑速 × speedK 前進(方向由搖桿 / 鍵盤)、每 tickT 對前方圓形範圍內目標造成傷害 + 輕微擊退、模型旋轉、SP 每秒 spPerSec 且不自然恢復
// 多人:位置本來就同步;快照 g 位元 8(同旋風斬)讓遠端畫旋轉與弧光,停止時位元消失即結束(無需另送事件);傷害走 d.hit,由受害者端否決
function whirlRunStart() {
  const sk = curSkill(G.skill), cfg = CFG.skills.whirlRun;
  if (G.cd[sk.id] > 0 || skillBlocked(sk)) return;
  if (!((CFG.res.infinite && !window.NETON) || G.sp >= cfg.minSp)) { resDeny('sp'); return; }
  if (G.sitting) sitBreak('cast');
  G.whirlRun = { t: 0, acc: 0, hits: 0, dmgK: CHG.dmg(1) * W().dmgMul, hex: auraEl().hex };
  G.shoutT = 1.0; const ch = document.getElementById('chant'); ch.textContent = sk.shout; ch.style.fontSize = '30px';
  if (window.padRumble) padRumble('cast');
  burstRing(new V3(mage.root.position.x, mage.root.position.y, mage.root.position.z), G.whirlRun.hex, 2);
}
function whirlRunEnd() {
  if (!G.whirlRun) return;
  G.whirlRun = null; mage.spinY = 0;
  G.cd.whirlRun = CLASSES.swordsman.skills.find(k => k.id === 'whirlRun').cd;   // 停止後才開始冷卻(4 s)
}
function whirlRunTick(dt) {
  const S = G.whirlRun, cfg = CFG.skills.whirlRun, p = mage.root.position;
  if (!G.atkHeld || G.state !== 'ready' || G.stun > 0 || G.down > 0 || G.roll || G.stance !== 0 || G.silT > 0) { whirlRunEnd(); return; }
  S.t += dt;
  if (!(CFG.res.infinite && !window.NETON)) { G.sp = Math.max(0, G.sp - cfg.spPerSec * dt); G.spIdle = 0; if (G.sp <= 0) { whirlRunEnd(); return; } }
  mage.spinY += Math.PI * 8 * dt;
  const E = auraEl(), dx = Math.sin(mage.yaw), dz = Math.cos(mage.yaw), sp = G.speedN > .2;
  // 前進方向的風刃 / 粒子:武器尖端與身後拖尾
  const T = mage.tipWorld(new V3());
  for (let i = 0; i < (IS_TOUCH ? 1 : 2); i++) fire.emit(T.x, T.y, T.z, dx * 3 + rnd(-1, 1), rnd(0, .5), dz * 3 + rnd(-1, 1), .3, rnd(.1, .16), E.c0, E.c1, .9, .3, 0, .5);
  if (sp) fire.emit(p.x - dx * .6 + rnd(-.3, .3), p.y + rnd(.4, 1.6), p.z - dz * .6 + rnd(-.3, .3), -dx * 2, rnd(-.2, .4), -dz * 2, .4, rnd(.12, .2), E.c0, E.c1, .8, 1, 0, 2);
  S.acc += dt;
  while (S.acc >= cfg.tickT) {   // 每 tickT 一次:前方圓形範圍(不經 meleeBlocked:障礙不擋範圍傷害)
    S.acc -= cfg.tickT; S.hits++;
    const cx = p.x + dx * cfg.hitFwd, cz = p.z + dz * cfg.hitFwd, R = cfg.hitR;
    arcSlash(new V3(cx, p.y, cz), R, mage.yaw, E.hex, .25);
    for (const d of DUMMIES) {
      if (d.dead || Math.abs(p.y - d.y) > R + 1.5) continue;
      const ex = d.x - cx, ez = d.z - cz;
      if (Math.hypot(ex, ez) >= R + .2) continue;
      const kx = d.x - p.x, kz = d.z - p.z, l = Math.hypot(kx, kz) || 1;
      d.hit(cfg.dmg * S.dmgK, kx, kz, 0, null);
      d.knock(kx / l, kz / l, cfg.knock);
    }
  }
}

/* ---------- 不屈戰意(第 4 格絕技,瞬發,C 型免除:netSilent) ---------- */
// 鬥氣 ≥ 50 時全部消耗,持續 2 + 鬥氣 / 25 s(4~6 s):HP 不低於 1、免控與位移與硬直、受傷 ×0.75(playerHurt / stApplyFx 讀 G.unyT)
function castUnyield(P, orb) {
  const E = casterAura(P), p = casterPos(P);
  if (orb) dissolveOrb(orb, E);
  burstRing(new V3(p.x, p.y, p.z), E.hex, 1.6);
  if (P.net) return;   // 遠端不屈只靠快照 UNYIELD 位元畫紅色氣場(netSilent,實際不會進來)
  const cr = G.cr;
  if (cr < SW.unyMin || !spendEnergy(cr)) { banner('鬥氣不足', '#ff8a8a'); return; }
  G.unyT = SW.unyBase + cr / SW.unyPer;
  flashLight(new V3(p.x, p.y + 1.5, p.z), E.hex, 4, .3, 8);
}

/* ---------- 破空斬強化判定(蓄力斬集氣 MAX 且鬥氣 ≥ 30) ---------- */
// release() 呼叫(sk.exFn):成立時扣鬥氣並回傳 1,否則 0
function swordExFn(q) { return q >= SW.exMin && spendEnergy(SW.exCost) ? 1 : 0; }
// 集氣時間倍率(game.js chargeTimeEff 呼叫):格擋成功後 0.6 s 內瞬間滿(×0.001);盾擊後 1 s 內 ×0.4
function swChargeK() { if (G.parryFullT > 0) return .001; if (G.comboT > 0) return SW.comboK; return 1; }

/* ---------- 每幀(classes.js classTick 末尾呼叫) ---------- */
function swordTick(dt) {
  if (G.cls !== 'swordsman') { if (G.whirlRun) whirlRunEnd(); return; }
  if (G.down > 0 || (G.leap && G.state !== 'cast')) { G.leap = null; G.comboT = 0; G.parryFullT = 0; }   // 倒下 / 重置(離開 cast 狀態)時中止躍擊位移
  // 鬥氣流失:5 s 內沒有造成也沒有受到傷害(gainEnergy / spendEnergy 會重置 crIdle)→ 每秒 −8
  G.crIdle = (G.crIdle || 0) + dt;
  if (G.crIdle >= SW.drainAfter && G.cr > 0) G.cr = Math.max(0, G.cr - SW.drainPer * dt);
  G.comboT = Math.max(0, (G.comboT || 0) - dt);
  G.parryFullT = Math.max(0, (G.parryFullT || 0) - dt);
  if (G.parryT > 0) { mage.shieldUp = 1; SW_LOG.push({ t: swNow(), yaw: G.parryYaw }); }
  const now = swNow();
  while (SW_LOG.length && now - SW_LOG[0].t > 1500) SW_LOG.shift();
  // 不屈結束 → 虛弱 2 s
  if (G._unyWas && !(G.unyT > 0)) G.weak = Math.max(G.weak, SW.unyWeak);
  G._unyWas = G.unyT > 0;
  if (G.leap) leapTick(dt);
  if (G.whirlRun) whirlRunTick(dt);
}

/* ---------- 單人:稻草人受到的傷害計入鬥氣(設計 §4-4:原始 × 0.4) ---------- */
// 多人的鬥氣由受害者回報的 dmg 事件計算(netShowDmg);這裡只補單人的稻草人命中
if (typeof Dummy === 'function' && !Dummy.prototype._swDealt) {
  const hit0 = Dummy.prototype.hit;
  Dummy.prototype.hit = function (dmg, dx, dz, burn, el, src) {
    if (!this.dead && src !== 'dot' && !window.NETON && G.cls === 'swordsman') crOnDealt(dmg * NET_RULES.dmgK);
    return hit0.apply(this, arguments);
  };
  Dummy.prototype._swDealt = true;
}

