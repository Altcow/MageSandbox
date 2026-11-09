'use strict';
// 劍士進階招式(設計_職業進階技能.md §2-2、§4-2;設計_狀態效果系統.md §2-3 / §4 Z3-B):盾勢的 格擋反擊 / 震地 / 躍擊,
//   第 4 格絕技 不屈戰意,破空斬的強化判定,鬥氣流失與格擋 / 不屈的網路否決掛點。
// 載入順序:skills.js → skills_archer.js → skills_sword.js → skills_assassin.js → resources.js → status.js → classes.js(index.html)。
// 註冊:classes.js 的 CLASSES.swordsman.skills 以函式名直接引用(cast: castParry 等)。
// 約定:P 為施放資料,orb 為能量球;P.net 代表遠端重現,改動 G / mage 一律以 if (!P.net) 守門(遠端只畫視覺)。
// 掛點:netcombat.js 的 netApplyHit 呼叫 parryOn(from, rt) / onParry(from) / swHitK / swFxAdjust;game.js 的 strike、chargeTimeEff 呼叫 swParryStrike / swChargeK;
//       classes.js 的 classTick 呼叫 swordTick(dt)。

const SW = {
  parryWin: .5, parryOkCd: 1, parryFull: .6, parryGain: 20, parryRange: 3, parryDeg: 75,   // 格擋窗 / 成功後格擋冷卻 / 成功後下一招瞬間滿的窗 / 鬥氣獎勵 / 反擊距離 / 正面半角
  parryDmg: 30, parryStun: .6,                                                                 // 反擊盾擊原始傷害(× CHG.dmg(1))、暈眩秒數
  slamDmg: 30, slamLift: 1, slamDown: .5,                                                       // 震地:原始傷害、擊飛高度 × fxK、跌倒秒數
  leapT: .55, leapH: 3, leapDmg: 40, leapStun: .8, leapKnock: 1.5,                              // 躍擊:飛行時間、最高點、落地傷害 / 暈眩上限 / 擊退
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
    if (dist >= R + .4) continue;
    const l = dist || 1;
    d.hit(SW.slamDmg * P.dmgK * (1 - clamp(dist / (R + .4), 0, 1) * .7), dx, dz, 0, null);
    d.lift(SW.slamLift * P.fxK); d.knockDown(SW.slamDown, dx / l, dz / l);
  }
}

/* ---------- 躍擊(B-3,集氣,C 型:跳躍只在本機) ---------- */
// 本機:G.leap 每幀覆寫位置(swordTick 呼叫 leapTick,在 updatePlayer 之前),施放期間 cast 鎖定移動;落地時結算
// 遠端:不動位置(快照內插),只在落地時間點畫落地環
function castLeap(P, orb) {
  const E = casterAura(P), cfg = CFG.skills.leap;
  if (orb) dissolveOrb(orb, E);
  P.recover = .14 + SW.leapT + cfg.recover;   // 跳躍期間鎖住移動(updatePlayer 的 cast 鎖定)
  if (P.net) { after(SW.leapT, () => burstRing(new V3(P.target.x, P.target.y, P.target.z), E.hex, P.r)); return; }
  const p = mage.root.position;
  G.leap = { t: 0, x0: p.x, z0: p.z, y0: p.y, x1: P.target.x, z1: P.target.z, P: P, E: E };
  burstRing(new V3(p.x, p.y, p.z), E.hex, 1);
}
// 每幀(swordTick):拋物線位置;落地(t ≥ leapT)時結算落點範圍
function leapTick(dt) {
  const L = G.leap, p = mage.root.position;
  L.t += dt;
  const u = Math.min(1, L.t / SW.leapT);
  p.x = L.x0 + (L.x1 - L.x0) * u; p.z = L.z0 + (L.z1 - L.z0) * u;
  const gy = terrainH(p.x, p.z);
  p.y = L.y0 + (gy - L.y0) * u + 4 * SW.leapH * u * (1 - u);
  G.vy = 0; G.ground = false;
  fire.emit(p.x, p.y + .2, p.z, rnd(-.5, .5), rnd(0, .5), rnd(-.5, .5), .3, rnd(.08, .14), L.E.c0, L.E.c1, .9, .3, 0, .5);
  if (u >= 1) { G.leap = null; leapLand(L); }
}
// 落點範圍:傷害(距離衰減)+ 暈眩 0.4~0.8 s + 向外擊退 1.5 m(× fxK)
function leapLand(L) {
  const P = L.P, E = L.E, x = L.x1, z = L.z1, y = terrainH(x, z), R = P.r;
  burstRing(new V3(x, y, z), E.hex, R); hitFx(new V3(x, y + 1, z), 20);
  G.shake = Math.max(G.shake, .2 * CFG.shake);
  for (const d of DUMMIES) {
    if (d.dead || Math.abs(y - d.y) > R + 1.5) continue;
    const dx = d.x - x, dz = d.z - z, dist = Math.hypot(dx, dz);
    if (dist >= R + .4) continue;
    const l = dist || 1;
    d.hit(SW.leapDmg * P.dmgK * (1 - clamp(dist / (R + .4), 0, 1) * .7), dx, dz, 0, null);
    d.stun(SW.leapStun * P.fxK); d.knock(dx / l, dz / l, SW.leapKnock * P.fxK);
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
  if (G.cls !== 'swordsman') return;
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

