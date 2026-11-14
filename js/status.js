'use strict';
// 狀態效果核心(設計_狀態效果系統.md §1、§3-1、§3-2、§4 Z0、§5):玩家端 13 種效果的套用、計時、DOT、
// PvP 控制總則(4 s 內 ×1 / ×0.5 / ×0.25 / 第 4 次免疫、硬控結束 0.5 s 韌性、淨化 1 s 免控)、撞牆跌倒、
// 快照狀態欄 stCode / stFlags(§3-2)、P 面板「狀態測試」(單人對自己套用)。
// 稻草人的同名方法在 world.js(Dummy),遠端角色的收件方法在 remote.js(RemotePlayer)。
// 依賴(全域,執行期才取用):game.js(G、mage、CFG、banner、cancelCharge、buildPanel)、resources.js(playerHurt、playerCleanse)、
//   netcombat.js(NET_RULES、netCcScale、NET_ME)、world.js(zoneSlowAt)。
// 載入順序:resources.js 之後、classes.js 之前(index.html)。本檔載入時 stClear() 並重建 P 面板(加上狀態測試區塊)。

// 數值表(§5):NET_RULES 內另有 ccMaxN / ccImm / hitStunGap / slowCap / burnDmg / poisonDmg / ccCap
const ST = {
  burnMax: 4, burnSolo: 5,                                    // 灼燒:時間上限、單人每 0.5 s 點數
  poisonMax: 6, poisonN: 3, poisonHealK: .5, poisonGap: .4, poisonSolo: 4,   // 中毒:時間上限、層數上限、中毒中治癒倍率、加層節流、單人每層每 0.5 s
  chillMax: 3, chillT: 4, chillGap: .5, chillImm: 3,          // 寒意:滿 3 層凍結、每層 4 s、加層節流、凍結後免疫
  freezeT: 1.2, freezeBreak: 10, freezeGrace: .25,            // 凍結:時間(× 遞減)、碎冰門檻(單次實扣)、凍結後 0.25 s 內不能碎
  paraGap: .6, paraJolt: .2, paraSpd: .8, paraMax: 3,         // 麻痺:抽搐間隔、抽搐長度、移速倍率、總長上限
  rootMax: 1.5, silMax: 1.5, blindMax: 3, blindWin: 4, blindDR: .5,   // 定身 / 沉默 / 致盲上限;致盲 4 s 內第 2 次 ×0.5
  slamV: 6, slamFrac: .4, slamDown: .6,                       // 撞牆跌倒:最低擊退速度、實際位移 / 預期位移門檻、跌倒秒數
  cleanseImm: 1, rollBurnCut: 1, dotTick: .5                  // 淨化後控制免疫秒數、翻滾減灼燒秒數、DOT 每跳間隔
};
const ST_TEST = [
  ['stun', '暈眩'], ['fall', '跌倒'], ['freeze', '凍結'], ['root', '定身'], ['para', '麻痺'], ['silence', '沉默'],
  ['burn', '灼燒'], ['poison1', '中毒 1 層'], ['poison3', '中毒 3 層'], ['slow', '減速 50%'], ['chill', '寒意 +1'],
  ['light', '照亮'], ['blind', '致盲'], ['weak', '虛弱'], ['hit10', '受 10 點傷'], ['cleanse', '淨化'], ['clear', '清除狀態']
];

// 清除全部狀態(載入、復活、離開對戰、R 重置、狀態測試清除共用);ccLog(控制遞減紀錄)不在此清除
function stClear() {
  Object.assign(G, {
    slowT: 0, slowPct: 0, burnT: 0, burnBy: 0, burnAcc: 0, litT: 0,
    poisonT: 0, poisonN: 0, poisonBy: 0, poisonAcc: 0, poisonAddT: -9,
    chill: 0, chillT: 0, chillAddT: -9, chillImmT: 0,
    blindT: 0, blindLog: G.blindLog || [],
    rootT: 0, paraT: 0, paraJolt: 0, paraNext: 0, silT: 0,
    hardT: 0, hardImmT: 0, hardPrev: 0, fallT: 0, frzT: 0, frzAge: 0, ccImmT: 0, hitStunCd: 0,
    _kbPend: false, _kbX: 0, _kbZ: 0, _kbExp: 0, _kbSpd: 0
  });
}

/* ---------- 控制閘門與各效果的套用(時間為已經乘過 DR 的值) ---------- */
// 同一則命中只呼叫一次 netCcScale;回傳 0 = 免疫 / 第 4 次起
// 硬控(暈眩 / 跌倒 / 凍結):寫 G.hardT 與 G.stun,集氣中取消(§1-2 #1)
function stApplyStun(t) {
  if (!(t > 0)) return;
  G.hardT = Math.max(G.hardT, t); G.stun = Math.max(G.stun, t);
  if (G.state === 'charging') cancelCharge();
}
// 跌倒:同硬控,另記 fallT 供倒地姿勢與 HUD 用(resTick 讀 fallT 決定 downK 目標)
function stApplyFall(t) { if (!(t > 0)) return; G.fallT = Math.max(G.fallT, t); stApplyStun(t); }
// 凍結:不疊;新凍結從 frzAge = 0 起算碎冰的 0.25 s 寬限
function stApplyFreeze(t) {
  if (!(t > 0)) return;
  if (G.frzT <= 0) G.frzAge = 0;
  G.frzT = Math.max(G.frzT, t); stApplyStun(t);
}
// 凍結被敲碎(受到單次實扣 ≥ 10,寬限後):解除凍結,硬控計時歸零(之後觸發 0.5 s 韌性)
function stFreezeBreak() {
  G.frzT = 0; G.frzAge = 0; G.hardT = 0; G.stun = Math.min(G.stun, G.fallT);
  banner('碎冰!', '#bfefff');
}
function stApplyRoot(t) { if (t > 0) G.rootT = Math.max(G.rootT, Math.min(t, ST.rootMax)); }
// 麻痺:套用當下抽搐立即一次(paraNext = 0),之後每 paraGap 一次
function stApplyPara(t) { if (!(t > 0)) return; if (G.paraT <= 0) G.paraNext = 0; G.paraT = Math.max(G.paraT, Math.min(t, ST.paraMax)); }
function stApplySilence(t) {
  if (!(t > 0)) return;
  G.silT = Math.max(G.silT, Math.min(t, ST.silMax));
  if (G.state === 'charging') cancelCharge();
}
// 減速:PvP pct 上限 NET_RULES.slowCap(定身已拆出,不再有 pct 1)
function stApplySlow(t, pct) {
  const cap = window.NETON ? NET_RULES.slowCap : 1;
  G.slowT = Math.max(G.slowT, t); G.slowPct = Math.max(G.slowPct, Math.min(pct, cap));
}
function stApplyBurn(t, by) { G.burnT = Math.max(G.burnT, Math.min(t, ST.burnMax)); G.burnBy = by; }
// 中毒:時間取大(上限 poisonMax)、層數相加(上限 poisonN);加層受 poisonGap 節流(同一則最多 +2)
function stApplyPoison(t, n, by) {
  if (G.time - G.poisonAddT >= ST.poisonGap) {
    G.poisonN = Math.min(ST.poisonN, G.poisonN + Math.min(2, n | 0)); G.poisonAddT = G.time;
  }
  G.poisonT = Math.min(ST.poisonMax, Math.max(G.poisonT, t));
  if (by) G.poisonBy = by;
}
// 寒意:每 chillGap 最多 +1 層;帶寒意的命中立即熄滅灼燒;滿 3 層 → 凍結 1.2 s × 遞減,寒意清空、3 s 免疫
function stApplyChill(n) {
  G.burnT = 0;
  if (!n || G.chillImmT > 0 || G.time - G.chillAddT < ST.chillGap) return;
  G.chillAddT = G.time; G.chill += Math.max(1, Math.min(2, n | 0)); G.chillT = ST.chillT;
  if (G.chill >= ST.chillMax) {
    G.chill = 0; G.chillT = 0; G.chillImmT = ST.chillImm;
    const k = stCcGate(true);
    if (k > 0) stApplyFreeze(ST.freezeT * k);
  }
}
// 致盲:不進控制遞減;4 s 內第 2 次起 ×0.5
function stApplyBlind(t) {
  const now = G.time, log = G.blindLog || (G.blindLog = []);
  while (log.length && now - log[0] > ST.blindWin) log.shift();
  const k = log.length ? ST.blindDR : 1; log.push(now);
  G.blindT = Math.max(G.blindT, Math.min(t, ST.blindMax) * k);
}
// 單獨的控制閘門(寒意觸發凍結用):不屈 / 淨化免控 / 硬控免疫 → 0,否則 netCcScale
function stCcGate(hard) {
  if (G.unyT > 0 || G.ccImmT > 0 || (hard && G.hardImmT > 0)) return 0;
  return netCcScale();
}

/* ---------- 命中效果套用(攻擊者端 fx 合併後的值;多人與單人測試共用) ---------- */
// fx 鍵:st 暈眩秒、fz 凍結秒、dn [秒,dx,dz] 跌倒、ro 定身、pa 麻痺、si 沉默、sl [秒,pct] 減速(sl[1] ≥ 1 = 舊格式定身)、
//        er 侵蝕秒(舊 = 中毒 1 層)、po [秒,層] 中毒、ch 寒意、li 照亮秒、bl 致盲秒、kb 擊退、lf 擊飛、pl 吸引
// h 為命中陣列(h[i][4] = 燃燒秒數);from 為攻擊者座位(DOT 歸屬與擊倒訊息用,單人為 undefined)
// 不屈戰意(G.unyT > 0)免疫 6 種控制 + 位移;DOT 與減益照吃。護盾全吸收時由呼叫端略過整個函式。
function stApplyFx(fx, h, from) {
  const by = from | 0, uny = G.unyT > 0;
  for (const x of h) if (x[4] > 0) stApplyBurn(x[4], by);
  const st = fx.st || 0, dn = fx.dn ? fx.dn[0] || 0 : 0;
  let ro = fx.ro || 0, sl = fx.sl || null;
  if (sl && sl[1] >= 1) { ro = Math.max(ro, sl[0]); sl = null; }   // 舊格式「減速 100%」一律轉成定身
  const pa = fx.pa || 0, si = fx.si || 0, fz = fx.fz || 0;   // fz 直接凍結秒(魔法箭矢冰;寒意累積凍結不經此)
  const hardOK = !uny && G.ccImmT <= 0 && G.hardImmT <= 0 && (st > 0 || dn > 0 || fz > 0);
  const softOK = !uny && G.ccImmT <= 0 && (ro > 0 || pa > 0 || si > 0);
  // 同一則命中的控制只計一次遞減;第 4 次(k = 0)整則控制無效,但傷害與 DOT 照算
  const k = hardOK || softOK ? netCcScale() : 0;
  if (k > 0) {
    const cap = t => Math.min(t, NET_RULES.ccCap) * k;
    if (hardOK && st > 0) stApplyStun(cap(st));
    if (hardOK && dn > 0) stApplyFall(cap(dn));
    if (hardOK && fz > 0) stApplyFreeze(cap(fz));
    if (softOK && ro > 0) stApplyRoot(cap(ro));
    if (softOK && pa > 0) stApplyPara(Math.min(pa, ST.paraMax) * k);
    if (softOK && si > 0) stApplySilence(cap(si));
  }
  if (fx.kb && !uny) { G.kvx += fx.kb[0] * 3.2; G.kvz += fx.kb[1] * 3.2; }
  if (fx.lf && !uny) { G.vy = Math.max(G.vy, Math.sqrt(2 * 20 * fx.lf)); G.ground = false; }
  if (sl) stApplySlow(sl[0], sl[1]);
  if (fx.er) stApplyPoison(fx.er, 1, by);
  if (fx.po) stApplyPoison(fx.po[0], fx.po[1], by);
  if (fx.ch) stApplyChill(fx.ch);
  if (fx.li) G.litT = Math.max(G.litT, fx.li);
  if (fx.bl) stApplyBlind(fx.bl);
  if (fx.pl && !uny) { const p = mage.root.position, x0 = p.x, z0 = p.z; p.x += fx.pl[0]; p.z += fx.pl[1]; terrainMove(p, x0, z0); }
}

/* ---------- DOT(多人係數已在 NET_RULES;單人用 ST 的單人值) ---------- */
// 持續傷害扣血:歸屬給施加者(by),並寫入擊倒者(8 s 內倒下算他的擊倒)
function stDot(n, by, k) {
  if (by) { G.lastHitBy = by; G.lastHitK = k; G.lastHitT = G.time; }
  playerHurt(n, { by: by || G.lastHitBy, net: !!window.NETON, dot: true });
}

/* ---------- 每幀計時(game.js frame 在 netPlayerTick 之後、classTick 之前) ---------- */
function stTick(dt) {
  const on = !!window.NETON;
  G.hitStunCd = Math.max(0, G.hitStunCd - dt);
  G.ccImmT = Math.max(0, G.ccImmT - dt);
  G.hardImmT = Math.max(0, G.hardImmT - dt);
  G.hardT = Math.max(0, G.hardT - dt);
  if (G.hardPrev > 0 && G.hardT <= 0) G.hardImmT = NET_RULES.ccImm;   // 硬控結束的瞬間起 0.5 s 韌性(§1-4)
  G.hardPrev = G.hardT;
  G.fallT = Math.max(0, G.fallT - dt);
  if (G.frzT > 0) { G.frzT = Math.max(0, G.frzT - dt); G.frzAge += dt; }
  G.rootT = Math.max(0, G.rootT - dt);
  G.silT = Math.max(0, G.silT - dt);
  G.blindT = Math.max(0, G.blindT - dt);
  if (G.slowT > 0) { G.slowT = Math.max(0, G.slowT - dt); if (G.slowT <= 0) G.slowPct = 0; }
  if (G.chillImmT > 0) G.chillImmT = Math.max(0, G.chillImmT - dt);
  if (G.chill > 0) { G.chillT -= dt; if (G.chillT <= 0) G.chill = 0; }
  // 麻痺:抽搐 = 暫時的暈眩(只寫 G.stun,不計入硬控遞減與韌性);抽搐中暫停集氣(updateCasting 讀 paraJolt)
  G.paraJolt = Math.max(0, G.paraJolt - dt);
  if (G.paraT > 0) {
    G.paraT = Math.max(0, G.paraT - dt); G.paraNext -= dt;
    if (G.paraNext <= 0 && G.paraT > 0) { G.paraNext = ST.paraGap; G.paraJolt = ST.paraJolt; G.stun = Math.max(G.stun, ST.paraJolt); }
  } else G.paraNext = 0;
  // 狀態區域(隕石坑等):多人時站在他人的 fx.burn 區內,每 0.5 s 刷新燃燒 1 s
  if (on && typeof zoneFxAt === 'function') { const pp = mage.root.position, zf = zoneFxAt(pp.x, pp.z, pp.y, NET_ME); G.zoneBurnAcc = (G.zoneBurnAcc || 0) + dt; if (zf.burn && G.zoneBurnAcc >= .5) { G.zoneBurnAcc = 0; stApplyBurn(1, zf.owner); } }
  // 灼燒 / 中毒:每 0.5 s 一跳
  if (G.burnT > 0) {
    G.burnT = Math.max(0, G.burnT - dt); G.burnAcc += dt;
    if (G.burnAcc >= ST.dotTick) { G.burnAcc -= ST.dotTick; stDot(on ? NET_RULES.burnDmg : ST.burnSolo, G.burnBy, '灼燒'); }
  } else G.burnAcc = 0;
  if (G.poisonT > 0) {
    G.poisonT = Math.max(0, G.poisonT - dt); G.poisonAcc += dt;
    if (G.poisonAcc >= ST.dotTick) { G.poisonAcc -= ST.dotTick; stDot((on ? NET_RULES.poisonDmg : ST.poisonSolo) * G.poisonN, G.poisonBy, '中毒'); }
    if (G.poisonT <= 0) G.poisonN = 0;
  } else { G.poisonN = 0; G.poisonAcc = 0; }
  // 視覺(§3-3):本機角色每幀呼叫一次(頭上圖示、身上粒子、#stFx、快捷列 .sil)
  stVis(ST_SELF, stCode(), stFlags() | (G.litT > 0 ? 256 : 0), dt);
}

// 撞牆跌倒(§1-5):netPlayerTick 在每幀開頭呼叫。上一幀擊退速度 ≥ 6 m/s,但實際位移 < 預期的 40% → 跌倒 0.6 s,並清掉剩餘擊退
function stKnockCheck(p) {
  const act = Math.hypot(p.x - G._kbX, p.z - G._kbZ);
  const hit = G._kbSpd >= ST.slamV && act < ST.slamFrac * G._kbExp && !G.roll;
  G._kbPend = false;
  if (!hit) return;
  G.kvx = G.kvz = 0;
  const k = stCcGate(true);
  if (k > 0) stApplyFall(Math.min(ST.slamDown, NET_RULES.ccCap) * k);
}

/* ---------- 快照狀態欄(§3-2):stCode 0~7 控制碼;stFlags 8~128 旗標;e = stCode() | stFlags() ---------- */
// 控制碼優先序:凍結 > 暈眩 > 跌倒 > 麻痺 > 沉默 > 定身;7 = 韌性 / 控制免疫中;0 = 無
function stCode() {
  if (G.frzT > 0) return 1;
  if (G.hardT > G.fallT + .001) return 2;
  if (G.fallT > 0) return 3;
  if (G.paraT > 0) return 4;
  if (G.silT > 0) return 5;
  if (G.rootT > 0) return 6;
  if (G.hardImmT > 0 || G.ccImmT > 0) return 7;
  return 0;
}
// 旗標:8 灼燒、16 中毒、32 寒意 ≥ 1 層、64 致盲、128 減速(含區域減速)
function stFlags() {
  let f = 0;
  if (G.burnT > 0) f |= 8;
  if (G.poisonT > 0 && G.poisonN > 0) f |= 16;
  if (G.chill >= 1) f |= 32;
  if (G.blindT > 0) f |= 64;
  const p = mage.root.position;
  const zone = CFG.slowSelf && typeof zoneSlowAt === 'function' && zoneSlowAt(p.x, p.z, p.y, NET_ME).pct > 0;
  if ((G.slowT > 0 && G.slowPct > 0) || zone) f |= 128;
  return f;
}

/* ---------- 視覺呈現(§3-3,Z1):stVis(host, code, flags, dt) ----------
   host 需提供 x / y / z(腳底世界座標)、yaw;選用 chillN(寒意層數,缺值視為 1)、jolt(抽搐中)、sil(沉默中)。
   self = true 為本機:另切 #stFx 的 class 與快捷列 .sil。code = 0~7 控制碼(stCode);flags = 8~128 旗標(stFlags)+ 256 照亮(JS 專用)。
   每個 host 的物件 lazy 建立並記在 host.stV;stVisHide 只隱藏(死亡、潛行、離線暫停),stVisDispose 才移出場景(RemotePlayer.destroy 用)。 */
const STV = { tex: {}, emo: {}, fxc: {}, silOn: null, fxEl: null, loader: null, shared: null };
const ST_HEAD = { 1: 'st_freeze', 2: 'st_stun', 3: 'st_down', 4: 'st_paralysis', 5: 'st_silence', 6: 'st_root' };   // 頭上圖示;圖缺時退回 ST_HEAD_EMO
const ST_HEAD_EMO = { 1: '🧊', 2: '💫', 3: '💤', 4: '⚡', 5: '🤐', 6: '⛓' };
// 本機角色的 host 介面(mage / G 為全域,即時讀取)
const ST_SELF = {
  self: true, stV: null,
  get x() { return mage.root.position.x; }, get y() { return mage.root.position.y; }, get z() { return mage.root.position.z; },
  get yaw() { return mage.yaw; }, get chillN() { return G.chill; }, get jolt() { return G.paraJolt > 0; }, get sil() { return G.silT > 0; }
};
// 共用幾何與材質(只建一次;標 shared 的材質在 stVisDispose 時不釋放)
function stShared() {
  if (STV.shared) return STV.shared;
  const ice = new THREE.MeshLambertMaterial({ color: 0x8fe0ff, transparent: true, opacity: .45, flatShading: true, depthWrite: false });
  const root = new THREE.MeshBasicMaterial({ color: 0x8a7a5a, transparent: true, opacity: .8, depthWrite: false });
  ice.userData.shared = root.userData.shared = true;
  return (STV.shared = { ice: ice, root: root, geoIce: new THREE.IcosahedronGeometry(.75, 1), geoRing: new THREE.RingGeometry(.3, .55, 24) });
}
// 頭上圖示貼圖:第一次要求時載入一次;載入失敗標 bad,之後一律用 emoji 貼圖(不重複發 404)
function stIcon(name, code) {
  let e = STV.tex[name];
  if (!e) {
    e = STV.tex[name] = { tex: null, bad: false };
    try {
      STV.loader = STV.loader || new THREE.TextureLoader();
      e.tex = STV.loader.load('assets/icons/' + name + '.png', undefined, undefined, () => { e.bad = true; });
    } catch (err) { e.bad = true; }
  }
  return e.bad || !e.tex ? stEmoTex(code) : e.tex;
}
function stEmoTex(code) {
  if (STV.emo[code]) return STV.emo[code];
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.font = '44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ST_HEAD_EMO[code] || '?', 32, 34);
  return (STV.emo[code] = new THREE.CanvasTexture(c));
}
function stHost(host) {
  return host.stV || (host.stV = { code: 0, spin: 0, ringT: 0, acc: {}, objs: [], spr: null, stars: null, ice: null, root: null, imm: null, immMat: null, lit: null, blind: null });
}
function stAdd(s, o) { s.objs.push(o); scene.add(o); return o; }
// 每秒 rate 次(小數累積);單幀最多 4 次,避免切分頁後 dt 很大時一次噴出太多
function stRate(s, key, rate, dt, emit) {
  if (!(rate > 0) || !(dt > 0)) { s.acc[key] = 0; return; }
  const a = (s.acc[key] || 0) + dt * rate, n = Math.floor(a);
  for (let i = 0; i < Math.min(n, 4); i++) emit();
  s.acc[key] = a - n;
}
// 碎冰 / 冰屑粒子
function stBurst(x, y, z, n, c0, c1) {
  for (let i = 0; i < n; i++) smoke.emit(x + rnd(-.4, .4), y + rnd(-.3, .3), z + rnd(-.4, .4), rnd(-2, 2), rnd(1, 3), rnd(-2, 2), .6, rnd(.08, .16), c0, c1, 1, 1, .8, .2);
}
function stFxClass(name, on) {
  if (STV.fxc[name] === on) return;
  STV.fxc[name] = on;
  if (!STV.fxEl) STV.fxEl = document.getElementById('stFx');
  if (STV.fxEl) STV.fxEl.classList.toggle(name, on);
}
// 本機專屬:#stFx 畫面效果、快捷列沉默鎖(只在狀態改變時寫 DOM)
function stSelfFx(code, flags, host) {
  stFxClass('frost', code === 1); stFxClass('burn', !!(flags & 8)); stFxClass('poison', !!(flags & 16));
  stFxClass('blind', !!(flags & 64)); stFxClass('jolt', !!host.jolt);
  const sil = !!host.sil;
  if (STV.silOn !== sil) { STV.silOn = sil; if (typeof slots !== 'undefined') slots.forEach(el => el.classList.toggle('sil', sil)); }
}
// 麻痺抖動:本機 mage / 遠端 RemotePlayer.mage 的頭部 ±0.03 m render offset;稻草人沒有 mage,略過
function stJit(host, on) {
  const M = host.self ? mage : host.mage;
  if (!M || !M.head) return;
  M.head.position.x = on ? rnd(-.03, .03) : 0; M.head.position.z = on ? rnd(-.03, .03) : 0;
}
function stVis(host, code, flags, dt) {
  const s = stHost(host), px = host.x, py = host.y, pz = host.z, mob = IS_TOUCH, t = dt > 0 ? dt : 0, sh = stShared(), yaw = host.yaw || 0;
  // 頭上圖示(1 個 Sprite,y + 3.0)
  if (ST_HEAD[code]) {
    const sp = s.spr || (s.spr = stAdd(s, new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }))));
    const map = stIcon(ST_HEAD[code], code);
    if (sp.material.map !== map) { sp.material.map = map; sp.material.needsUpdate = true; }
    sp.scale.set(.55, .55, 1); sp.visible = true; sp.position.set(px, py + 3, pz);
  } else if (s.spr) s.spr.visible = false;
  // 暈眩:頭上 3 顆金星繞圈(沿用稻草人原做法)
  if (code === 2) {
    if (!s.stars) { s.stars = []; for (let i = 0; i < 3; i++) s.stars.push(stAdd(s, glowSprite(0xffe066, .32, .95))); }
    s.spin += t * 4;
    s.stars.forEach((o, i) => { const a = s.spin + i * 2.094; o.visible = true; o.position.set(px + Math.cos(a) * .45, py + 2.25, pz + Math.sin(a) * .45); });
  } else if (s.stars) s.stars.forEach(o => o.visible = false);
  // 凍結:半透明冰殼;解除時噴 8 顆冰屑
  if (code === 1) {
    if (!s.ice) s.ice = stAdd(s, new THREE.Mesh(sh.geoIce, sh.ice));
    s.ice.visible = true; s.ice.position.set(px, py + .9, pz); s.ice.rotation.y += t * .4;
  } else if (s.ice) {
    if (s.ice.visible) stBurst(px, py + .9, pz, 8, [.8, .95, 1], [.3, .6, 1]);
    s.ice.visible = false;
  }
  // 定身:腳下灰褐環
  if (code === 6) {
    if (!s.root) { s.root = stAdd(s, new THREE.Mesh(sh.geoRing, sh.root)); s.root.rotation.x = -Math.PI / 2; }
    s.root.visible = true; s.root.position.set(px, py + .05, pz);
  } else if (s.root) s.root.visible = false;
  // 韌性 / 控制免疫:腳下白環 0.5 s 淡出(進入免疫的瞬間起算)
  if (code === 7 && s.code !== 7) s.ringT = .5;
  s.ringT = Math.max(0, s.ringT - t);
  if (s.ringT > 0) {
    if (!s.imm) { s.immMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }); s.imm = stAdd(s, new THREE.Mesh(sh.geoRing, s.immMat)); s.imm.rotation.x = -Math.PI / 2; }
    s.imm.visible = true; s.imm.position.set(px, py + .06, pz); s.immMat.opacity = s.ringT / .5 * .9;
  } else if (s.imm) s.imm.visible = false;
  // 照亮:頭上金色標記(depthTest 關閉,永遠看得到)
  if (flags & 256) {
    if (!s.lit) { s.lit = stAdd(s, glowSprite(0xffd76a, .45, .9)); s.lit.material.depthTest = false; s.lit.renderOrder = 30; }
    s.lit.visible = true; s.lit.position.set(px, py + 3.45, pz);
  } else if (s.lit) s.lit.visible = false;
  // 致盲:頭部一圈白色光帶
  if (flags & 64) {
    if (!s.blind) s.blind = stAdd(s, glowSprite(0xffffff, 1.1, .45));
    s.blind.visible = true; s.blind.position.set(px, py + 1.9, pz);
  } else if (s.blind) s.blind.visible = false;
  // 身上粒子(每角色每幀 ≤ 2;手機減量)
  if (flags & 8) for (let i = 0, n = mob ? 1 : 2; i < n; i++)   // 灼燒:火焰(沿用稻草人燃燒粒子)
    fire.emit(px + rnd(-.25, .25), py + rnd(.6, 1.8), pz + rnd(-.25, .25), rnd(-.3, .3), rnd(1, 2.5), rnd(-.3, .3), rnd(.4, .7), rnd(.4, .7), EL.fire.c0, EL.fire.c1, .9, .3, -.5, .5);
  stRate(s, 'po', flags & 16 ? (mob ? 5 : 10) : 0, t, () =>   // 中毒:綠色氣泡往上
    smoke.emit(px + rnd(-.3, .3), py + rnd(.4, 1.8), pz + rnd(-.3, .3), 0, rnd(.4, .8), 0, .9, rnd(.12, .2), [.5, .9, .3], [.3, .6, .15], .9, 1, -.3, 0));
  const layers = host.chillN != null ? host.chillN : 1;   // 寒意:雪花,層數越多越密(遠端只有「≥ 1 層」旗標,視為 1)
  stRate(s, 'ch', flags & 32 ? (mob ? 2 : 4) * Math.max(1, layers) : 0, t, () =>
    smoke.emit(px + rnd(-.4, .4), py + rnd(.5, 2.2), pz + rnd(-.4, .4), rnd(-.1, .1), -.4, rnd(-.1, .1), 1, rnd(.08, .14), [.92, .97, 1], [.6, .85, 1], .9, 1, .3, 0));
  stRate(s, 'sl', flags & 128 ? (mob ? 2 : 4) : 0, t, () =>   // 減速:腳邊藍色速度線(上飄小粒子)
    smoke.emit(px + rnd(-.35, .35), py + rnd(.05, .3), pz + rnd(-.35, .35), 0, rnd(.6, 1), 0, .6, rnd(.1, .16), EL.water.s0, EL.water.s1, .8, 1, 0, 0));
  stRate(s, 'si', code === 5 ? 5 : 0, t, () => {   // 沉默:雙手位置紫煙(約每 0.2 s 1 顆)
    const sd = Math.random() < .5 ? -1 : 1, hx = px + Math.cos(yaw) * .35 * sd, hz = pz - Math.sin(yaw) * .35 * sd;
    smoke.emit(hx, py + 1.1, hz, 0, .3, 0, .7, rnd(.12, .18), [.6, .4, 1], [.35, .2, .7], .8, 1, -.1, 0);
  });
  stRate(s, 'pa', code === 4 ? (mob ? 5 : 10) : 0, t, () =>   // 麻痺:金白電火花
    fire.emit(px + rnd(-.5, .5), py + rnd(1.2, 2.2), pz + rnd(-.5, .5), rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), .3, rnd(.08, .14), [1, 1, .7], [1, .85, .2], 1, 1, 0, 0));
  if (code === 4 || s.jit) { stJit(host, code === 4); s.jit = code === 4; }
  s.code = code;
  if (host.self) stSelfFx(code, flags, host);
}
// 只隱藏(死亡、倒下、潛行、離線暫停):保留物件池,之後再出現不重建
function stVisHide(host) {
  const s = host.stV; if (!s) return;
  s.objs.forEach(o => { o.visible = false; });
  s.ringT = 0; s.acc = {}; s.code = 0;
  if (s.jit) { stJit(host, false); s.jit = false; }
}
// 移出場景並釋放獨有材質(RemotePlayer.destroy 用);共用幾何 / 材質不釋放
function stVisDispose(host) {
  const s = host.stV; if (!s) return;
  s.objs.forEach(o => { scene.remove(o); const m = o.material; if (m && !m.userData.shared) m.dispose(); });
  host.stV = null;
}

/* ---------- P 面板「狀態測試」(單人對自己套用;對戰中不可用) ---------- */
function stDebug(key) {
  if (window.NETON) { banner('對戰中不能狀態測試', '#ffc46b'); return; }
  const label = (ST_TEST.find(r => r[0] === key) || [])[1] || key;
  switch (key) {
    case 'stun': stApplyFx({ st: 1.5 }, [], 0); break;
    case 'fall': stApplyFx({ dn: [.6, 0, 0] }, [], 0); break;
    case 'freeze': { const k = stCcGate(true); if (k > 0) stApplyFreeze(ST.freezeT * k); break; }
    case 'root': stApplyFx({ ro: 1.5 }, [], 0); break;
    case 'para': stApplyFx({ pa: 2.4 }, [], 0); break;
    case 'silence': stApplyFx({ si: 1.5 }, [], 0); break;
    case 'burn': stApplyFx({}, [[0, 0, 0, 0, 4, 0]], 0); break;
    case 'poison1': stApplyFx({ po: [3, 1] }, [], 0); break;
    case 'poison3': for (let i = 0; i < 3; i++) { G.poisonAddT = -9; stApplyFx({ po: [3, 1] }, [], 0); } break;
    case 'slow': stApplyFx({ sl: [4, .5] }, [], 0); break;
    case 'chill': stApplyChill(1); break;
    case 'light': stApplyFx({ li: 4 }, [], 0); break;
    case 'blind': stApplyFx({ bl: 3 }, [], 0); break;
    case 'weak': G.weak = 1.5; break;
    case 'hit10': playerHurt(10, 'test'); break;
    case 'cleanse': playerCleanse(); break;
    case 'clear': stClear(); G.stun = 0; G.weak = 0; break;
  }
  banner('狀態:' + label, '#ffe3b0');
}
function stBuildTestPanel(root) {
  const h = document.createElement('h4'); h.textContent = '狀態測試(單人:對自己套用)'; root.appendChild(h);
  const row = document.createElement('div'); row.className = 'row'; row.style.flexWrap = 'wrap';
  ST_TEST.forEach(([key, label]) => {
    const b = document.createElement('button'); b.textContent = label; b.onclick = () => stDebug(key); row.appendChild(b);
  });
  root.appendChild(row);
}

stClear();
if (typeof buildPanel === 'function') buildPanel();   // 把狀態測試區塊加進 P 面板(game.js 首次建面板時本檔尚未載入)
