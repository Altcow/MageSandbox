'use strict';
// 召喚系統框架(設計_魔法調整.md 第 14 節 S-1~S-5、S-4b、S-8、S-9)。
// 載入順序:... spells.js → sp_*.js → summons.js → summons_core.js → summon_fire.js … summon_dark.js → skills.js → classes.js → touch.js
//   · 本檔必須在 summons.js 之後(覆寫暫代的 castSummon / updateSummons),在 summon_*.js 之前(它們要改寫 SUMMON_KINDS)。
//   · 頂層只對外公開:castSummon、updateSummons、clearSummons、summonsHitArea、summonRegenK、mergeParts、SUMMON_DEF、SUMMON_KINDS、SUMMONS;其餘都在 IIFE 內。
//   · 依賴(執行期才取用,缺少時退回):CHG.perK、G.cd、playerHeal / playerShield / playerCleanse(S-6 / resources.js);
//     spells.js 的 areaEl、beam、fq、STONE_MAT;world.js 的 addSlowZone / removeSlowZone / zoneSlowAt。
//   · 石頭人砸地升牆、減速區、碰撞、暫時平台都在本檔(S-4b);各召喚物的外觀與專屬攻擊由 summon_<el>.js 經註冊表掛入。
//
// 註冊表契約 SUMMON_KINDS[元素]:寫手覆寫 SUMMON_KINDS.fire = { … } 整筆,或只改個別欄位皆可;框架每次呼叫時才讀取,不快取。
//   build(P, scale) → THREE.Object3D   召喚物模型,框架 add 進 unit.root 並存為 unit.body。每隻 ≤ 5 mesh + ≤ 3 sprite;零件用 mergeParts 合併。
//                                      共用的 geometry / material 必須設 userData.shared = true(消散時框架不 dispose);非共用的由框架 dispose。
//   attack(unit, tgt, dt)              (選用)unit.state === 'attack' 且有目標時每幀呼叫,tgt 為 Dummy。框架已先把 unit.atkT / skT / slamT 減 dt,
//                                      kind 自行判斷冷卻與前搖並重設(例:unit.atkT = unit.def.interval)。沒有 attack = 不普攻(石頭人)。
//   animate(unit, dt)                  (選用)每幀外觀動畫;unit.body 為 build 的回傳。
//   onDeath(unit)                      (選用)開始消散時呼叫;框架仍會做通用消散特效。
// unit 欄位(kind 只讀這些):el, def, E(= EL[el]), scale, multi(B 模式多隻), fxK, dmgK(= P.dmgK × perK), atkBase(= def.atk × dmgK × scale),
//   x, y, z, yaw, hp, hpMax, age, life, state, tgt, atkT, skT, slamT, root, body。其餘欄位為框架私有。

(function () {

// ---------- 數值表(S-2;scale = 1、q = 1 之前的基準,傷害另乘 P.dmgK) ----------
// move:'walk' 地面 | 'hover' 浮空(hoverH 公尺);ai:'melee' | 'slam' | 'ranged' | 'caster' | 'support'
const SUMMON_DEF = {
  water: { name: '水精靈',     hp: 140, speed: 3.6, move: 'hover', hoverH: .8, ai: 'ranged',  range: 12, keep: [8, 12],  atk: 32, interval: 1.6, dur: 20, size: 1.3 },
  fire:  { name: '多頭火蛇',   hp: 160, speed: 4.0, move: 'walk',               ai: 'ranged',  range: 5,  keep: [3.5, 5], atk: 14, interval: .35, dur: 16, size: 1.4 },
  earth: { name: '石頭人',     hp: 520, speed: 1.8, move: 'walk',               ai: 'slam',    range: 3.5,              atk: 20, interval: 4.5, dur: 22, size: 3.4,
           slam: { radius: 5.5, walls: 6, wallsTouch: 4, hMin: 1, hMax: 3, len: [2.0, 3.2], thick: .7, life: 6, slow: .6 } },
  wind:  { name: '鎌鼬',       hp: 90,  speed: 7.5, move: 'walk',               ai: 'caster',  range: 26, keep: [10, 18], atk: 6,  interval: 2.0, dur: 18, size: 1.0, skill: { dmg: 80, cd: 3.6, speed: 36 } },
  light: { name: '六翼熾天使', hp: 320, speed: 2.0, move: 'hover', hoverH: 1.2, ai: 'support', range: 2.2,              atk: 60, interval: 2.4, dur: 20, size: 2.6, aid: { follow: 3, guard: 8, heal: 12, healInt: 2, shield: 30, shieldInt: 8, cleanseInt: 6 } },
  dark:  { name: '暗影',       hp: 110, speed: 3.0, move: 'hover', hoverH: .15, ai: 'ranged', range: 22, keep: [14, 20], atk: 120, interval: 7.5, dur: 18, size: 1.9, dot: 4 }
};
const SUMMON_KINDS = {};
const SUMMONS = [];          // 活著的召喚物(上限 SM_MAX)
const SM_FADING = [];        // 消散中(不計上限、無 AI)
const SLABS = [];            // 石頭人土牆(S-4b)
const SM_ZONES = [];         // 砸地組:{ zone, wi, n, sunk, alive, x, z, gy, Rs, hex, age, sinkAt }

const SM_MAX = 2, SM_CD = 8, SM_SPAWN_T = .6, SM_FADE_T = .8, SM_RETARGET = .5, SM_BAR_T = 3;
const SM_MELEE_R = 1.5, SM_TP_CD = 1.5, SM_SLAB_RISE = .35, SM_SLAB_SINK = .5, SM_SLAB_MAX_N = 16, SM_ZONE_IND_MAX = 3;
const SM_SLAM_H = [1, 1.5, 2, 2.5, 3], SM_OFF = [0, .698, -.698, 1.396, -1.396];   // 轉向嘗試:0、±40°、±80°
const SM_ZERO = { x: 0, y: 0, z: 0 };
const SM_UP = new THREE.Vector3(0, 1, 0), SM_Q = new THREE.Quaternion(), SM_S = new THREE.Vector3(), SM_P = new THREE.Vector3(), SM_M = new THREE.Matrix4();
const SM_BAR_BG = new THREE.PlaneGeometry(1, .12), SM_BAR_FG = new THREE.PlaneGeometry(.94, .08);
SM_BAR_BG.userData.shared = true; SM_BAR_FG.userData.shared = true;
const SM_CACHE = {};
let SM_SEQ = 0, SM_IND_N = 0, SLAB_IM = null;

/* ---------- 小工具 ---------- */
function smPP() { return (typeof mage !== 'undefined' && mage.root) ? mage.root.position : SM_ZERO; }
function smZoneK(x, z) { return typeof zoneSlowAt === 'function' ? zoneSlowAt(x, z).pct : 0; }
// 單位可站的地面:地形,或頂面 ≤ y + 0.6 的平台(S-3 的 unitGround,台階上限 0.6)
function smGround(x, z, y) {
  let g = terrainH(x, z);
  for (const P of PLATFORMS) { if (!platContains(P, x, z, .15)) continue; const t = platTop(P, x, z); if (t > g && t <= y + .6) g = t; }
  return g;
}
// 頂面高於 y + 0.6 的平台 = 擋路(牆 / 高台側面)
function smWallAt(x, z, y, m) {
  for (const P of PLATFORMS) if (platContains(P, x, z, m) && platTop(P, x, z) > y + .6) return true;
  return false;
}
function smCanMove(u, nx, nz, step) {
  if (Math.hypot(nx, nz) > ARENA_R - 2) return false;
  if (u.def.move === 'hover') {
    for (const P of PLATFORMS) if (platContains(P, nx, nz, .25) && platTop(P, nx, nz) > u.y + 3) return false;
    return true;
  }
  if (smGround(nx, nz, u.y) - u.y > .6 + 1.2 * step) return false;
  return !smWallAt(nx, nz, u.y, .25);
}
// 沿 heading 前進一步(失敗時依序試 ±40°、±80°);成功設 u.heading 並清 stuckT,都失敗累計 stuckT
function smAdvance(u, dt, spd, heading) {
  const step = spd * dt * (1 - smZoneK(u.x, u.z));
  for (let i = 0; i < 5; i++) {
    const h = heading + SM_OFF[i], nx = u.x + Math.sin(h) * step, nz = u.z + Math.cos(h) * step;
    if (smCanMove(u, nx, nz, step)) { u.x = nx; u.z = nz; u.heading = h; u.stuckT = 0; return true; }
  }
  u.stuckT += dt; return false;
}
// 轉向(速率 turn rad/s)後前進;成功時面向實際前進方向
function smSteer(u, dt, tx, tz, spd, turn) {
  const want = Math.atan2(tx - u.x, tz - u.z);
  u.yaw += clamp(angDiff(u.yaw, want), -turn * dt, turn * dt);
  if (smAdvance(u, dt, spd, u.yaw)) u.yaw = u.heading;
}
function smFace(u, dt, tx, tz, rate) { u.yaw += clamp(angDiff(u.yaw, Math.atan2(tx - u.x, tz - u.z)), -rate * dt, rate * dt); }
// 高度:walk 貼地面(damp 12);hover 飄在 surfaceY + hoverH(damp 6)
function smFloor(u, dt) {
  if (u.def.move === 'hover') u.y = damp(u.y, surfaceY(u.x, u.z, u.y + 3) + u.def.hoverH, 6, dt);
  else u.y = damp(u.y, smGround(u.x, u.z, u.y), 12, dt);
}
function smLOS(u, t) {
  for (let i = 1; i <= 4; i++) {
    const f = i / 5, x = u.x + (t.x - u.x) * f, z = u.z + (t.z - u.z) * f;
    for (const P of PLATFORMS) if (platContains(P, x, z, 0) && platTop(P, x, z) > u.y + 1.5) return false;
  }
  return true;
}
function smPuff(x, y, z, hex) {
  burstRing(new V3(x, y + .05, z), hex, 1.1);
  for (let i = 0; i < fq(8); i++) smoke.emit(x + rnd(-.4, .4), y + rnd(.1, .8), z + rnd(-.4, .4), rnd(-.6, .6), rnd(.4, 1), rnd(-.6, .6), rnd(.7, 1.1), rnd(.8, 1.3), [.6, .6, .6], [.3, .3, .3], .5, 2, -.2, .8);
}

/* ---------- 瞬移(S-3):目標朝向自己那側 range × .8 的地面點;8 方向備援;找不到就不動 ---------- */
function smTeleport(u, t) {
  u.tpT = SM_TP_CD;
  const r = u.def.range * .8, base = Math.atan2(u.x - t.x, u.z - t.z);
  for (let i = 0; i < 9; i++) {
    const a = i === 0 ? base : base + (i - 1) * .785398;
    const cx = t.x + Math.sin(a) * r, cz = t.z + Math.cos(a) * r;
    if (Math.hypot(cx, cz) > ARENA_R - 2 || PLATFORMS.some(P => platContains(P, cx, cz, .3))) continue;
    smPuff(u.x, u.y, u.z, u.E.hex);
    u.x = cx; u.z = cz; u.y = surfaceY(cx, cz, t.y + .5); u.yaw = Math.atan2(t.x - cx, t.z - cz); u.stuckT = 0;
    smPuff(cx, u.y, cz, u.E.hex);
    return true;
  }
  u.stuckT = 0; return false;
}

/* ---------- 目標與通用 AI(S-1) ---------- */
function smPickTarget(u) {
  const pp = smPP(), sup = u.def.ai === 'support', lim = sup ? u.def.aid.guard : 40;
  let best = null, bd = Infinity;
  for (const d of DUMMIES) {
    if (d.dead) continue;
    const dd = sup ? Math.hypot(d.x - pp.x, d.z - pp.z) : Math.hypot(d.x - u.x, d.z - u.z);
    if (dd <= lim && dd < bd) { bd = dd; best = d; }
  }
  u.tgt = best;
}
function smIdle(u, dt, pp) {
  u.state = 'idle';
  if (Math.hypot(pp.x - u.x, pp.z - u.z) > 3) { u.state = 'seek'; smSteer(u, dt, pp.x, pp.z, u.def.speed, 3); }
}
function smMelee(u, dt, t) {
  if (Math.hypot(t.x - u.x, t.z - u.z) > u.def.range) { u.state = 'seek'; smSteer(u, dt, t.x, t.z, u.def.speed, 3); }
  else { u.state = 'attack'; smFace(u, dt, t.x, t.z, 6); }
}
// 遠程:> keep[1] 靠近;< keep[0] 後退(面向目標);中間原地攻擊 + 0.5 m/s 橫移小擺動
function smRanged(u, dt, t) {
  const S = u.def, d = Math.hypot(t.x - u.x, t.z - u.z), k0 = S.keep[0], k1 = S.keep[1];
  if (d > k1) { u.state = 'seek'; smSteer(u, dt, t.x, t.z, S.speed, 3); }
  else if (d < k0) { u.state = 'seek'; smAdvance(u, dt, S.speed, Math.atan2(u.x - t.x, u.z - t.z)); smFace(u, dt, t.x, t.z, 6); }
  else {
    u.state = 'attack'; smFace(u, dt, t.x, t.z, 3);
    u.swayT += dt;
    smAdvance(u, dt, .5, u.yaw + (Math.sin(u.swayT * .7) >= 0 ? 1.5708 : -1.5708));
  }
}
// 石頭人:走到 range 內;第一次砸地在到達後 0.8 s;冷卻中原地待機(轉向目標)
function smSlamAI(u, dt, t) {
  const inR = Math.hypot(t.x - u.x, t.z - u.z) <= u.def.range;
  if (inR && !u.inR) u.slamT = Math.max(u.slamT, .8);
  u.inR = inR;
  if (!inR) { u.state = 'seek'; smSteer(u, dt, t.x, t.z, u.def.speed, 3); return; }
  u.state = 'attack'; smFace(u, dt, t.x, t.z, 3);
  if (u.slamT <= 0) smSlam(u);
}
// 鎌鼬:每 1.5 s 換一個繞目標的點高速跑過去;技能好且視線無阻擋 → 站定(前搖由 kind.attack 處理)
function smCaster(u, dt, t) {
  const S = u.def, d = Math.hypot(t.x - u.x, t.z - u.z);
  u.wpT -= dt;
  if (u.wpT <= 0 || Math.hypot(u.wpX - u.x, u.wpZ - u.z) < 1.2) {
    const base = Math.atan2(u.x - t.x, u.z - t.z) + rnd(-1.047, 1.047), r = rnd(S.keep[0], S.keep[1]);
    u.wpX = t.x + Math.sin(base) * r; u.wpZ = t.z + Math.cos(base) * r; u.wpT = 1.5;
  }
  // 站定只在:技能可放(kind 處理前搖),或貼身且普攻好了(普攻後繼續跑,不會黏在目標身上)
  if ((u.skT <= 0 && d <= S.range && smLOS(u, t)) || (d <= SM_MELEE_R && u.atkT <= 0)) { u.state = 'attack'; smFace(u, dt, t.x, t.z, 10); return; }
  u.state = 'seek'; smSteer(u, dt, u.wpX, u.wpZ, S.speed, 10);
}
// 熾天使:跟隨玩家(距離 > follow 時去玩家身後 2 m);玩家 8 m 內有標靶就去打(只在 range 內攻擊)
function smSupport(u, dt, pp, t) {
  const aid = u.def.aid, dp = Math.hypot(u.x - pp.x, u.z - pp.z);
  if (t) {
    if (Math.hypot(t.x - u.x, t.z - u.z) > u.def.range) { u.state = 'seek'; smSteer(u, dt, t.x, t.z, u.def.speed, 3); }
    else { u.state = 'attack'; smFace(u, dt, t.x, t.z, 3); }
  } else if (dp > aid.follow) {
    const yaw = (typeof mage !== 'undefined' && typeof mage.yaw === 'number') ? mage.yaw : 0;
    u.state = 'seek'; smSteer(u, dt, pp.x - Math.sin(yaw) * 2, pp.z - Math.cos(yaw) * 2, u.def.speed, 3);
  } else u.state = 'idle';
  smAid(u, dt, pp);
}
// 輔助:治癒 2 s(玩家 10 m 內);護盾 8 s;淨化 6 s(玩家有 debuff 才生效,由 playerCleanse 判定)
function smAid(u, dt, pp) {
  const aid = u.def.aid, near = Math.hypot(u.x - pp.x, u.z - pp.z) <= 10;
  u.healT -= dt; if (u.healT <= 0) { u.healT = aid.healInt; if (near) smHeal(u, pp); }
  u.shT -= dt; if (u.shT <= 0) { u.shT = aid.shieldInt; if (near && typeof playerShield === 'function') playerShield(aid.shield * u.fxK, 8); }
  u.clT -= dt;
  if (u.clT <= 0) {
    u.clT = aid.cleanseInt;
    if (near && typeof playerCleanse === 'function' && playerCleanse()) {
      burstRing(new V3(pp.x, pp.y + .1, pp.z), 0xfff6c0, 1.6);
      banner('淨化', '#fff6c0');
    }
  }
}
function smHeal(u, pp) {
  const amt = u.def.aid.heal * u.fxK * u.scale;
  if (typeof beam === 'function') beam(new V3(u.x, u.y + 1.5, u.z), new V3(pp.x, pp.y + 1.2, pp.z), u.E, .08, .5);
  for (let i = 0; i < fq(10); i++) fire.emit(pp.x + rnd(-.4, .4), pp.y + rnd(.2, 1.6), pp.z + rnd(-.4, .4), 0, rnd(.5, 1.2), 0, .8, rnd(.1, .2), u.E.c0, u.E.c1, 1, .3, -.2, .4);
  for (const v of SUMMONS) if (v !== u && v.spawnT <= 0 && Math.hypot(v.x - u.x, v.z - u.z) <= 10) v.heal(amt);
  if (typeof playerHeal === 'function') playerHeal(amt, 'seraph');
}

// 每隻每幀 AI 入口:選目標、狀態分派、移動後的卡住 / 瞬移判定、呼叫 kind.attack
function smAI(u, dt) {
  const def = u.def, pp = smPP();
  u.tgtT -= dt;
  if (u.tgtT <= 0 || !u.tgt || u.tgt.dead) { smPickTarget(u); u.tgtT = SM_RETARGET; }
  const t = u.tgt;
  if (def.ai === 'support') smSupport(u, dt, pp, t);
  else if (!t) smIdle(u, dt, pp);
  else if (def.ai === 'melee') smMelee(u, dt, t);
  else if (def.ai === 'slam') smSlamAI(u, dt, t);
  else if (def.ai === 'ranged') smRanged(u, dt, t);
  else if (def.ai === 'caster') smCaster(u, dt, t);
  if (t && def.move === 'walk' && u.tpT <= 0 && (u.stuckT > 1.2 || t.y - u.y > 2.5)) smTeleport(u, t);
  if (t && u.state === 'attack') { const k = SUMMON_KINDS[u.el]; if (k && typeof k.attack === 'function') k.attack(u, t, dt); }
}

/* ---------- 石頭人砸地升土牆(S-4b) ---------- */
function smSlabIM() {
  if (!SLAB_IM) {
    const mat = typeof STONE_MAT !== 'undefined' ? STONE_MAT : new THREE.MeshStandardMaterial({ color: 0x7d7868, flatShading: true, roughness: 1 });
    SLAB_IM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, SM_SLAB_MAX_N);
    SLAB_IM.castShadow = true; SLAB_IM.receiveShadow = true; SLAB_IM.count = 0; SLAB_IM.frustumCulled = false;
    scene.add(SLAB_IM);
  }
  return SLAB_IM;
}
// 牆矩陣:底在 gy − 0.5(埋地),頂在 gy + h × riseK
function smWriteSlabs() {
  if (!SLAB_IM) return;
  const n = SLABS.length;
  for (let i = 0; i < n; i++) {
    const s = SLABS[i];
    SM_P.set(s.x, s.gy + s.h * s.riseK * .5 - .25, s.z);
    SM_Q.setFromAxisAngle(SM_UP, s.yaw);
    SM_S.set(s.len, s.h * s.riseK + .5, .7);
    SM_M.compose(SM_P, SM_Q, SM_S);
    SLAB_IM.setMatrixAt(i, SM_M);
  }
  SLAB_IM.count = n; SLAB_IM.instanceMatrix.needsUpdate = true;
}
function smSinking(s) { return s.sinkT >= 0 || s.forced; }
function smActiveSlabs() { let c = 0; for (const s of SLABS) if (!smSinking(s)) c++; return c; }
function smSinkStart(s) {
  s.sinkT = 0; s.sinkFrom = s.riseK; s.forced = false;
  for (let i = 0; i < fq(3); i++) smoke.emit(s.x + rnd(-.6, .6), s.gy + .2, s.z + rnd(-.6, .6), rnd(-.8, .8), rnd(.2, .6), rnd(-.8, .8), rnd(.8, 1.2), rnd(.8, 1.2), [.55, .45, .32], [.3, .25, .18], .45, 2, -.1, .6);
  const g = s.group;
  if (g && ++g.sunk >= g.n && g.zone) {
    if (typeof removeSlowZone === 'function') removeSlowZone(g.zone);
    g.zone = null; g.sinkAt = g.age;
  }
}
function smDropInd(g) {
  if (g.zone && typeof removeSlowZone === 'function') removeSlowZone(g.zone);
  g.zone = null;
  if (g.wi) { scene.remove(g.wi.root); g.wi.mat.dispose(); g.wi.mesh.geometry.dispose(); g.wi = null; SM_IND_N--; }
}
function smUpdateSlabs(dt) {
  if (!SLABS.length && !SM_ZONES.length) { if (SLAB_IM && SLAB_IM.count) smWriteSlabs(); return; }
  for (let i = SLABS.length - 1; i >= 0; i--) {
    const s = SLABS[i];
    s.t += dt;
    if (s.sinkT < 0 && (s.forced || s.t >= s.life)) smSinkStart(s);
    if (s.sinkT >= 0) {
      s.sinkT += dt;
      if (s.sinkT >= SM_SLAB_SINK) { removePlatform(s.plat); SLABS.splice(i, 1); s.group.alive--; continue; }
      s.riseK = s.sinkFrom * (1 - s.sinkT / SM_SLAB_SINK);
    } else if (s.t < 0) s.riseK = 0;
    else {
      if (s.t - dt < 0) for (let j = 0; j < fq(4); j++) smoke.emit(s.x + rnd(-.6, .6), s.gy + .2, s.z + rnd(-.6, .6), rnd(-1, 1), rnd(.3, .9), rnd(-1, 1), rnd(.7, 1.1), rnd(.8, 1.2), [.55, .45, .32], [.3, .25, .18], .45, 2, -.1, .6);
      s.riseK = easeOut(Math.min(1, s.t / SM_SLAB_RISE));
    }
    s.plat.top = s.gy + s.h * s.riseK;
  }
  if (SLAB_IM) smWriteSlabs();
  for (let j = SM_ZONES.length - 1; j >= 0; j--) {
    const g = SM_ZONES[j];
    g.age += dt;
    if (g.alive <= 0) { smDropInd(g); SM_ZONES.splice(j, 1); continue; }
    if (g.wi) {
      g.wi.set(g.x, g.z, 0, g.Rs, 0, 0, 0, g.zone ? .2 : .2 * Math.max(0, 1 - (g.age - g.sinkAt) / .5), g.hex, g.gy);
      g.wi.tick(G.time);
    }
  }
}
// 土牆位置:不與活標靶(+0.5 m 邊界)、召喚物(1.5 m)、其他土牆(.3 m)重疊;不在場外
function smSlabSpotOK(cx, cz, len) {
  if (Math.hypot(cx, cz) > ARENA_R - 1) return false;
  const hl = len / 2;
  for (const d of DUMMIES) if (!d.dead && Math.hypot(d.x - cx, d.z - cz) < hl + 1.0) return false;
  for (const v of SUMMONS) if (Math.hypot(v.x - cx, v.z - cz) < hl + 1.5) return false;
  for (const s of SLABS) if (Math.hypot(s.x - cx, s.z - cz) < hl + s.len / 2 + .3) return false;
  return true;
}
// 砸地(S-4b):傷害 areaEl(不擊飛不暈眩)、減速區、視覺、升牆(依距離錯開 0~0.3 s)
function smSlam(u) {
  const S = u.def.slam, sc = u.scale, E = u.E, touch = IS_TOUCH;
  u.slamT = u.def.interval;
  const hK = 1 + (sc - 1) * .55, Rs = u.multi ? S.radius * .8 : S.radius * Math.sqrt(sc);
  const gx = u.x + Math.sin(u.yaw) * 1.5 * sc, gz = u.z + Math.cos(u.yaw) * 1.5 * sc, gy = surfaceY(gx, gz, u.y + 1);
  if (typeof areaEl === 'function') areaEl(new V3(gx, gy, gz), Rs, u.def.atk, 'earth', { dmgK: u.dmgK, fxK: u.fxK }, {});
  burstRing(new V3(gx, gy, gz), 0xe0b070, Rs);
  for (let i = 0; i < fq(24); i++) {
    const a = rnd(0, 6.283);
    smoke.emit(gx + Math.cos(a) * Rs * .4, gy + .3, gz + Math.sin(a) * Rs * .4, Math.cos(a) * rnd(2, 4), rnd(.2, .6), Math.sin(a) * rnd(2, 4), rnd(.9, 1.4), rnd(.8, 1.4), E.s0, E.s1, .55, 2, -.1, .6);
  }
  debris(new V3(gx, gy, gz), 6, E.hex, .3);
  const pp = smPP();
  if (Math.hypot(pp.x - gx, pp.z - gz) < 20) G.shake = Math.max(G.shake, .2 * CFG.shake);

  const n = u.multi ? (touch ? 3 : 4) : Math.round((touch ? S.wallsTouch : S.walls) * hK);
  const cap = touch ? 10 : SM_SLAB_MAX_N;
  let act = smActiveSlabs();
  for (const s of SLABS) { if (act + n <= cap) break; if (!smSinking(s)) { s.forced = true; act--; } }
  smSlabIM();
  const mine = [];
  for (let w = 0; w < n; w++) {
    let ok = false, cx = gx, cz = gz, len = S.len[0], yaw = 0;
    for (let tr = 0; tr < 12 && !ok; tr++) {
      const a = rnd(0, 6.283), rr = Math.sqrt(Math.random()) * Rs;
      cx = gx + Math.cos(a) * rr; cz = gz + Math.sin(a) * rr; len = rnd(S.len[0], S.len[1]); yaw = rnd(0, Math.PI);
      ok = smSlabSpotOK(cx, cz, len);
    }
    if (!ok) continue;
    const h = SM_SLAM_H[(Math.random() * SM_SLAM_H.length) | 0] * hK, gc = terrainH(cx, cz);
    const s = { x: cx, z: cz, gy: gc, len, h, yaw, t: -Math.hypot(cx - gx, cz - gz) / Rs * .3, life: S.life, riseK: 0, sinkT: -1, sinkFrom: 0, forced: false, group: null, plat: null };
    s.plat = addPlatform({ kind: 'box', x: cx, z: cz, hx: len / 2, hz: S.thick / 2, yaw, top: gc, tmp: true });
    SLABS.push(s); mine.push(s);
  }
  if (!mine.length) return;
  const g = { zone: null, wi: null, n: mine.length, sunk: 0, alive: mine.length, x: gx, z: gz, gy, Rs, hex: E.hex, age: 0, sinkAt: 0 };
  for (const s of mine) s.group = g;
  if (typeof addSlowZone === 'function') g.zone = addSlowZone({ kind: 'circle', x: gx, z: gz, r: Rs, pct: S.slow * u.fxK, hex: E.hex });
  if (SM_IND_N < SM_ZONE_IND_MAX) { g.wi = new Indicator(scene); SM_IND_N++; }
  SM_ZONES.push(g);
  smWriteSlabs();
}

/* ---------- 單位 ---------- */
// 預設模型:單色球(暫代,給尚未實作的召喚物用)
function smPhBuild(P, scale) {
  const el = P.el, def = SUMMON_DEF[el], E = EL[el], key = 'ph_' + el;
  if (!SM_CACHE[key]) {
    const geo = new THREE.SphereGeometry(.5, 10, 8), mat = new THREE.MeshStandardMaterial({ color: E.hex, emissive: E.hex, emissiveIntensity: .35, roughness: .8 });
    geo.userData.shared = true; mat.userData.shared = true; SM_CACHE[key] = { geo, mat };
  }
  const m = new THREE.Mesh(SM_CACHE[key].geo, SM_CACHE[key].mat), s = def.size * scale * .8;
  m.scale.setScalar(s); m.position.y = s * .5; m.castShadow = true;
  return m;
}
// 預設普攻:直接對目標造成 atkBase;wind 同時設技能冷卻(只為讓鎌鼬的移動節奏可見)
function smPhAttack(u, t) {
  if (u.atkT > 0) return;
  u.atkT = u.def.interval;
  if (u.def.skill) u.skT = u.def.skill.cd;
  t.hit(u.atkBase, t.x - u.x, t.z - u.z, 0, u.el);
}
for (const el of Object.keys(SUMMON_DEF)) {
  SUMMON_KINDS[el] = { build: smPhBuild, attack: SUMMON_DEF[el].ai === 'slam' ? undefined : smPhAttack };
}

class SmUnit {
  constructor(P, def, x, y, z, scale, k, n) {
    const el = P.el, aid = def.aid;
    this.el = el; this.def = def; this.E = EL[el]; this.scale = scale; this.multi = n > 1;
    this.fxK = P.fxK || 1; this.dmgK = (P.dmgK || 1) * k; this.atkBase = def.atk * this.dmgK * scale;
    this.hpMax = def.hp * scale * (n > 1 ? .7 : 1); this.hp = this.hpMax;
    this.life = def.dur * (P.durK || 1); this.age = 0;
    this.x = x; this.y = y; this.z = z; this.yaw = typeof P.dir === 'number' ? P.dir : 0; this.heading = this.yaw;
    this.state = 'spawn'; this.spawnT = SM_SPAWN_T; this.dead = false; this.fadeT = 0; this.hpShow = 0;
    this.tgt = null; this.tgtT = 0; this.atkT = 0; this.skT = 0; this.slamT = 0; this.inR = false;
    this.stuckT = 0; this.tpT = 0; this.wpX = 0; this.wpZ = 0; this.wpT = 0; this.swayT = rnd(0, 6);
    this.healT = aid ? aid.healInt : 0; this.shT = aid ? aid.shieldInt : 0; this.clT = aid ? aid.cleanseInt : 0;
    this.rad = .4 * def.size * scale * .4;
    this.seq = ++SM_SEQ;
    this.root = new THREE.Group(); this.root.scale.setScalar(.05); scene.add(this.root);
    const kind = SUMMON_KINDS[el];
    this.body = (kind && typeof kind.build === 'function') ? kind.build(P, scale) : smPhBuild(P, scale);
    this.root.add(this.body);
    this.bar = new THREE.Group(); this.bar.visible = false; scene.add(this.bar);
    const bg = new THREE.Mesh(SM_BAR_BG, new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: .6, depthTest: false }));
    this.fg = new THREE.Mesh(SM_BAR_FG, new THREE.MeshBasicMaterial({ color: new THREE.Color(this.E.css0), depthTest: false }));
    bg.renderOrder = 20; this.fg.renderOrder = 21; this.fg.position.z = .001; this.bar.add(bg, this.fg);
    this.col = null;
    if (def.ai === 'slam') { this.col = { x, z, r: .7 * scale, ref: this }; COLLIDERS.push(this.col); }   // 只有石頭人擋玩家
  }
  update(dt) {
    if (this.spawnT > 0) {   // 出場 0.6 s:不行動、不受傷
      this.spawnT = Math.max(0, this.spawnT - dt);
      const k = 1 - this.spawnT / SM_SPAWN_T;
      this.root.scale.setScalar(Math.max(.05, easeOut(k)));
      this.root.position.set(this.x, this.y - (1 - k) * .5, this.z);
      return;
    }
    this.age += dt; this.atkT -= dt; this.skT -= dt; this.slamT -= dt; this.tpT -= dt; this.hpShow -= dt;
    if (this.age >= this.life || this.hp <= 0) { this.despawn(); return; }
    smAI(this, dt);
    smFloor(this, dt);
    const kind = SUMMON_KINDS[this.el];
    if (kind && typeof kind.animate === 'function') kind.animate(this, dt);
    this.syncView();
  }
  syncView() {
    this.root.position.set(this.x, this.y, this.z); this.root.rotation.y = this.yaw;
    if (this.col) { this.col.x = this.x; this.col.z = this.z; }
    const show = this.hpShow > 0 && this.hp < this.hpMax && !this.dead;
    this.bar.visible = show;
    if (show) {
      this.bar.position.set(this.x, this.y + 1.2 + this.def.size * this.scale, this.z);
      this.bar.quaternion.copy(camera.quaternion);
      const r = Math.max(0, this.hp / this.hpMax);
      this.fg.scale.x = Math.max(.001, r); this.fg.position.x = -.47 * (1 - r);
    }
  }
  hurt(n) {
    if (this.dead || this.spawnT > 0) return;
    this.hp -= n; this.hpShow = SM_BAR_T;
    if (this.hp <= 0) this.despawn();
  }
  heal(n) {
    if (this.dead || this.spawnT > 0) return;
    this.hp = Math.min(this.hpMax, this.hp + n); this.hpShow = SM_BAR_T;
  }
  // 開始消散:離開上限名單、移除碰撞、通知 kind,然後 0.8 s 縮小(走路者下沉)後 dispose
  despawn() {
    if (this.dead) return;
    this.dead = true;
    const i = SUMMONS.indexOf(this); if (i >= 0) SUMMONS.splice(i, 1);
    if (this.col) { const c = COLLIDERS.indexOf(this.col); if (c >= 0) COLLIDERS.splice(c, 1); this.col = null; }
    const kind = SUMMON_KINDS[this.el];
    if (kind && typeof kind.onDeath === 'function') kind.onDeath(this);
    smPuff(this.x, this.y, this.z, this.E.hex);
    this.syncView(); this.bar.visible = false;
    this.fadeT = SM_FADE_T; SM_FADING.push(this);
  }
}

function smDisposeTree(o) {
  o.traverse(m => {
    if (m.geometry && !m.isSprite && !m.geometry.userData.shared) m.geometry.dispose();
    if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mt => { if (!mt.userData.shared) mt.dispose(); });
  });
}
function smDispose(u) {
  scene.remove(u.root); smDisposeTree(u.root);
  scene.remove(u.bar); smDisposeTree(u.bar);
  if (u.col) { const c = COLLIDERS.indexOf(u.col); if (c >= 0) COLLIDERS.splice(c, 1); u.col = null; }
}

/* ---------- 施放 ---------- */
// 第 i 隻:垂直瞄準方向 [0, +1.8, −1.8] m;邊界夾回場內;出場特效
function smSpawn(c, i) {
  const off = i === 0 ? 0 : (i === 1 ? 1.8 : -1.8);
  let x = c.cx + c.px * off, z = c.cz + c.pz * off;
  const r = Math.hypot(x, z), lim = ARENA_R - 2;
  if (r > lim) { x *= lim / r; z *= lim / r; }
  const gy = surfaceY(x, z, c.cy + 1), hover = c.def.move === 'hover';
  const u = new SmUnit(c.P, c.def, x, hover ? gy + c.def.hoverH : gy, z, c.scale, c.k, c.n);
  SUMMONS.push(u);
  while (SUMMONS.length > SM_MAX) SUMMONS[0].despawn();   // 第 3 隻:最舊的立即消散
  burstRing(new V3(x, gy + .05, z), c.E.hex, c.def.size * c.scale * 1.2);
  for (let j = 0; j < fq(16); j++) fire.emit(x + rnd(-.6, .6), gy + rnd(0, .3), z + rnd(-.6, .6), rnd(-.5, .5), rnd(1.5, 3), rnd(-.5, .5), .7, rnd(.2, .35), c.E.c0, c.E.c1, 1, .3, -.5, .6);
}
// 施放:orb 飛到召喚點(0.3 s)後消散 → 生成;暗影的召喚點 = 玩家腳下
function castSummon(P, orb) {
  const el = P && P.el, def = el ? SUMMON_DEF[el] : null;
  if (!def || !P.target) return;
  const E = EL[el], n = Math.max(1, Math.min(SM_MAX, P.copies || 1));
  const k = n > 1 ? (typeof CHG !== 'undefined' && typeof CHG.perK === 'function' ? CHG.perK(n, 'summon') : .6) : 1;
  const dark = el === 'dark', pp = smPP();
  const cx = dark ? pp.x : P.target.x, cz = dark ? pp.z : P.target.z, cy = dark ? pp.y : P.target.y;
  const gy = surfaceY(cx, cz, cy + 1), dir = typeof P.dir === 'number' ? P.dir : 0;
  if (G.cd && (G.cd.summon || 0) < SM_CD) G.cd.summon = SM_CD;   // 共用冷卻 8 s,從施放起算
  const c = { P, def, E, n, k, scale: P.thickK || 1, cx, cz, cy, px: Math.cos(dir), pz: -Math.sin(dir) };
  const go = () => { for (let i = 0; i < n; i++) smSpawn(c, i); };
  if (orb && typeof orbFly === 'function') orbFly(orb, new V3(cx, gy + 1.2, cz), .3, E, () => { dissolveOrb(orb, E); go(); });
  else { if (orb) dissolveOrb(orb, E); go(); }
}

// 每幀(game.js updateWorld 呼叫)
function updateSummons(dt) {
  smUpdateSlabs(dt);
  for (let i = SUMMONS.length - 1; i >= 0; i--) SUMMONS[i].update(dt);
  smSeparate();
  smUpdateFading(dt);
}
// 互推(S-3):召喚物之間各半、與標靶之間只推召喚物
function smSeparate() {
  for (let i = 0; i < SUMMONS.length; i++) {
    const a = SUMMONS[i];
    if (a.spawnT > 0) continue;
    for (let j = i + 1; j < SUMMONS.length; j++) {
      const b = SUMMONS[j];
      if (b.spawnT > 0) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), m = a.rad + b.rad;
      if (d < m) {
        const ov = (m - d) / 2, ux = d > 1e-4 ? dx / d : 1, uz = d > 1e-4 ? dz / d : 0;
        a.x -= ux * ov; a.z -= uz * ov; b.x += ux * ov; b.z += uz * ov;
      }
    }
    for (const dm of DUMMIES) {
      if (dm.dead) continue;
      const dx = a.x - dm.x, dz = a.z - dm.z, dd = Math.hypot(dx, dz), m = a.rad + .5;
      if (dd < m) { const ov = m - dd, ux = dd > 1e-4 ? dx / dd : 1, uz = dd > 1e-4 ? dz / dd : 0; a.x += ux * ov; a.z += uz * ov; }
    }
    if (Math.hypot(a.x, a.z) > ARENA_R - 2) { const r = Math.hypot(a.x, a.z); a.x *= (ARENA_R - 2) / r; a.z *= (ARENA_R - 2) / r; }
  }
}
function smUpdateFading(dt) {
  for (let i = SM_FADING.length - 1; i >= 0; i--) {
    const u = SM_FADING[i];
    u.fadeT -= dt;
    const k = Math.max(0, u.fadeT / SM_FADE_T);
    u.root.scale.setScalar(Math.max(.01, k));
    if (u.def.move === 'walk') u.root.position.y = u.y - (1 - k) * .6;
    if (u.fadeT <= 0) { smDispose(u); SM_FADING.splice(i, 1); }
  }
}

// 來襲測試(strike)的紅圈傷害:與玩家同樣的範圍與高度判斷(S-2)
function summonsHitArea(pos, R, dmg) {
  for (const u of SUMMONS.slice()) {
    if (u.dead || u.spawnT > 0 || Math.abs(pos.y - u.y) > R + 1.5) continue;
    const dist = Math.hypot(u.x - pos.x, u.z - pos.z);
    if (dist < R + .4) u.hurt(dmg * (1 - clamp(dist / (R + .4), 0, 1) * .5));
  }
}
// 玩家資源掛點(設計_玩家資源HPMPSP.md §4):10 m 內有活的熾天使 → MP / SP 恢復 ×1.25
function summonRegenK() {
  const pp = smPP();
  for (const u of SUMMONS) if (u.el === 'light' && !u.dead && Math.hypot(u.x - pp.x, u.z - pp.z) <= 10) return 1.25;
  return 1;
}
// 換職業 / 換場景時呼叫:全部立即移除(含土牆、平台、減速區)
function clearSummons() {
  for (const u of SUMMONS.splice(0)) { try { const k = SUMMON_KINDS[u.el]; if (k && typeof k.onDeath === 'function') k.onDeath(u); } catch (e) { console.warn('[summon] onDeath', e); } u.dead = true; smDispose(u); }
  for (const u of SM_FADING.splice(0)) smDispose(u);
  for (let i = SLABS.length - 1; i >= 0; i--) removePlatform(SLABS[i].plat);
  SLABS.length = 0; smWriteSlabs();
  for (const g of SM_ZONES.splice(0)) smDropInd(g);
}

// 合併零件(S-4):parts = [{ geo, pos:[x,y,z], rot:[x,y,z], scl:[x,y,z], color: hex }] → 一個 BufferGeometry(position / normal / color)
// 輸入的 geo 不會被 dispose(呼叫端自己管理);合併後的結果由呼叫端快取並標 userData.shared = true
function mergeParts(parts) {
  const items = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const nm = new THREE.Matrix3(), v = new THREE.Vector3(), col = new THREE.Color();
  let total = 0;
  for (const pt of parts) {
    const g = pt.geo.index ? pt.geo.toNonIndexed() : pt.geo.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    items.push({ g, pt }); total += g.attributes.position.count;
  }
  const PA = new Float32Array(total * 3), NA = new Float32Array(total * 3), CA = new Float32Array(total * 3);
  let off = 0;
  for (const it of items) {
    const pt = it.pt, g = it.g, pa = g.attributes.position, na = g.attributes.normal, cnt = pa.count;
    p.fromArray(pt.pos || [0, 0, 0]); e.fromArray(pt.rot || [0, 0, 0]); q.setFromEuler(e); s.fromArray(pt.scl || [1, 1, 1]);
    m.compose(p, q, s); nm.getNormalMatrix(m); col.setHex(pt.color == null ? 0xffffff : pt.color);
    for (let i = 0; i < cnt; i++) {
      const j = (off + i) * 3;
      v.fromBufferAttribute(pa, i).applyMatrix4(m); PA[j] = v.x; PA[j + 1] = v.y; PA[j + 2] = v.z;
      v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); NA[j] = v.x; NA[j + 1] = v.y; NA[j + 2] = v.z;
      CA[j] = col.r; CA[j + 1] = col.g; CA[j + 2] = col.b;
    }
    off += cnt; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(PA, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(NA, 3));
  out.setAttribute('color', new THREE.BufferAttribute(CA, 3));
  out.computeBoundingSphere();
  return out;
}

window.castSummon = castSummon;
window.updateSummons = updateSummons;
window.clearSummons = clearSummons;
window.summonsHitArea = summonsHitArea;
window.summonRegenK = summonRegenK;
window.mergeParts = mergeParts;
window.SUMMON_DEF = SUMMON_DEF;
window.SUMMON_KINDS = SUMMON_KINDS;
window.SUMMONS = SUMMONS;

})();
