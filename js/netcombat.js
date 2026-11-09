'use strict';
// 多人對戰:施放事件的送出與重現(設計 §2-4、§2-6、§2-9、§4-3)。
// 送出:netSendCast(P) 在 game.js updateCasting 出手瞬間呼叫(只在 NETON),事件 ev/<我的座位>/<key>,t = 'cast'。
// 接收:net.js 去重後發出 'ev' → netReplayCast:以該座位的 RemotePlayer 當施法者重現(P.net、P.rng 種子),
//   不扣資源、不寫 CD、不建 SmUnit(castSummon 在 P.net 時只播能量球與出場特效)。
// 遠端投射物只做視覺:重現時 NET_CTX 為對方座位,RemotePlayer 不記命中;傷害由攻擊者端判定、受害者端套用(N5,見檔案下半)。
// 位移招式(netFx:spin / dash / blink / stealth)不呼叫原函式,只播簡化特效(§2-9);旋轉與盾舉靠快照旗標 netFxTick 驅動。
// 依賴(全域):net.js(Net)、remote.js(REMOTES、NETON 旗標)、game.js(G、mage、NET_CTX、launchSpell、makeOrb、burstRing、
//   addDmgText、seedRng、scene)、spells.js(SPELLS、EL)、skills.js(arcSlash、ghostSprite)、classes.js(CLASSES、auraOf)、fx.js(V3、rnd)。
// 載入順序:remote.js 之後(index.html)。單人模式 NETON 為 false,本檔所有入口都直接 return,行為不變。

const NET_CAST_GAP = 500;      // 施放事件最短間隔(ms,每人 ≤ 2/s,§4-3);來不及的排隊依序送出
const NET_CAST_MAXWAIT = 1000; // 排隊超過這麼久(ms)就略過,避免事件堆積
const NET_SPIN_GAP = .3;       // 旋風斬的遠端弧光間隔(s,§2-9)
let netCastNext = 0, netCastWarned = false, netSeq = 0;
const netUnknownWarned = {};

const r3 = v => (v == null || !isFinite(v) ? null : Math.round(v * 1000) / 1000);
const vOut = v => (v ? [r3(v.x), r3(v.y), r3(v.z)] : null);
const vIn = a => (Array.isArray(a) && a.length === 3 ? new V3(a[0], a[1], a[2]) : null);

/* ================= 送出 ================= */
// 節流:相鄰兩則至少 NET_CAST_GAP 間隔;超過的排到下一個時段,排隊太久則略過
function netPostCast(m) {
  const now = Net.now();
  const at = Math.max(now, netCastNext);
  if (at - now > NET_CAST_MAXWAIT) {
    if (!netCastWarned) { netCastWarned = true; console.warn('[net] 施放事件排隊過長,略過部分事件'); }
    return;
  }
  netCastNext = at + NET_CAST_GAP;
  setTimeout(() => {
    if (!window.NETON || !Net.code) return;
    m.tm = Net.now();
    Net.emitEv(m);
  }, at - now);
}
// 施放事件(§2-4 欄位):P 為 G.pending,在 launchSpell 前呼叫;tip 取出手當下的杖頭位置
function netSendCast(P) {
  if (!window.NETON || !Net.me || !P || P.sd == null) return;
  if (P.skill && P.skill.netSilent) return;   // 瞬發的格擋 / 不屈不送 cast 事件(只靠快照位元)
  netLastK = P.spell && P.spell.name ? String(P.spell.name).slice(0, 12) : '';   // 最近一次施放的招式名,命中時帶給擊殺訊息用
  netPostCast({
    t: 'cast', sq: ++netSeq, cls: G.cls, el: P.el, ix: P.idx, bs: P.base, md: P.mode || null,
    T: vOut(P.target), tip: vOut(mage.tipWorld(new V3())), mz: vOut(P.muzzle),
    dir: r3(P.dir), wy: r3(P.wallYaw), q: r3(P.q), sz: r3(P.sizeK), th: r3(P.thickK), cp: P.copies || 1,
    r: r3(P.r), pw: r3(P.power), rg: r3(P.range), dk: r3(P.dmgK), uk: r3(P.durK), fk: r3(P.fxK), sd: P.sd, ex: P.ex | 0
  });
}

/* ================= 接收與重現 ================= */
// 招式表(不讀 G):法師 = SKILLS[ix] 合併屬性的 aim / line(同 game.js 的 mageSkill);其他職業 = CLASSES[cls].skills[ix]
function netSkill(cls, el, ix) {
  if (cls === 'mage') {
    const base = SKILLS[ix];
    if (!base) return null;
    const sp = SPELLS[el] && SPELLS[el][ix];
    return Object.assign({}, base, { aim: (sp && sp.aim) || base.aim, line: sp ? sp.line : undefined });
  }
  const C = CLASSES[cls];
  return (C && C.skills && C.skills[ix]) || null;
}
function netSpell(cls, el, ix) {
  if (cls === 'mage') return (SPELLS[el] || [])[ix] || null;
  const C = CLASSES[cls];
  return (C && C.skills && C.skills[ix]) || null;
}
// 收到他人的施放事件(Net 的 'ev'):只處理 cast
function netOnEv(e) {
  if (!window.NETON || !e || !e.data) return;
  const t = e.data.t;
  if (t === 'cast') netReplayCast(e.seat, e.data);
  else if (t === 'hit') netApplyHit(e.seat, e.data);      // 只有受害者會套用(N5)
  else if (t === 'dmg') netShowDmg(e.seat, e.data);       // 對方的傷害數字
  else if (t === 'down') netOnRemoteDown(e.seat, e.data); // 擊殺訊息與計分
  else if (!netUnknownWarned[t]) { netUnknownWarned[t] = true; console.warn('[net] 未知事件類型,忽略:' + t); }
}
// 以該座位的 RemotePlayer 當施法者重現(§2-4 接收端 1~7)
function netReplayCast(seat, m) {
  const rp = REMOTES[String(seat)];
  if (!rp || !rp.g) return;
  const cls = CLASSES[m.cls] ? m.cls : 'mage', el = EL[m.el] ? m.el : 'fire';
  const sk = netSkill(cls, el, m.ix | 0);
  const target = vIn(m.T);
  if (!sk || !target || typeof m.sd !== 'number' || sk.netSilent) return;
  const sp = netSpell(cls, el, m.ix | 0) || {};
  if (sk.netFx) { netFxPlay(sk.netFx, rp, sp, m); return; }   // 位移招式:只播簡化特效,不呼叫原函式(§2-9)
  const aura = auraOf(cls, el), tip = vIn(m.tip) || rp.g.position.clone();
  const P = {
    skill: sk, spell: sp, base: m.bs, idx: m.ix | 0, el, target, q: m.q || 0, charge: m.q || 0, mode: m.md || undefined,
    sizeK: m.sz, thickK: m.th, copies: m.cp || 1, r: m.r, power: m.pw, range: m.rg, muzzle: vIn(m.mz) || tip.clone(),
    dmgK: m.dk, durK: m.uk, fxK: m.fk, dir: m.dir, wallYaw: m.wy, dmgMul: 1, recover: 0,
    net: seat, sd: m.sd, rng: seedRng(m.sd),                       // 種子與發送端相同,決定位置 / 時間的亂數一致(§2-4)
    casterPos: rp.g.position, casterYaw: () => rp.yaw, tip: tip, aura: aura, ex: m.ex | 0
  };
  const orb = makeOrb(aura); scene.add(orb); orb.position.copy(tip); orb.setR(.3);
  if (sp.shout) addDmgText(new V3(rp.px, rp.py + 2.8, rp.pz), sp.shout, '#ffffff');   // 遠端喊招(白色、1 s)
  const prev = NET_CTX; NET_CTX = +seat;   // 擁有者上下文:這段法術的延後效果都歸屬於該座位(§2-6)
  try { launchSpell(P, orb); } finally { NET_CTX = prev; }
}
// 位移招式的遠端簡化特效(§2-9):位置由快照直接給,這裡只做起手的光效
function netFxPlay(kind, rp, sp, m) {
  const c = new V3(rp.px, rp.py, rp.pz), hex = auraOf(rp.cls, rp.el).hex;
  if (kind === 'spin') burstRing(c, hex, m.r || 2.4);
  else if (kind === 'dash' || kind === 'stealth') burstRing(c, hex, 1.6);
  else if (kind === 'blink') ghostSprite(c, hex);   // 閃身的起點殘影;落點由快照的 tp 直接跳過去
  else if (kind === 'guard' || kind === 'unyield') burstRing(c, hex, 1.4);   // 格擋 / 不屈的遠端光效(寫手 B 細化)
  if (sp.shout) addDmgText(new V3(rp.px, rp.py + 2.8, rp.pz), sp.shout, '#ffffff');
}
// 每幀(remote.js netTick 呼叫,只在 NETON):依快照旗標播旋風斬的旋轉 / 弧光、衝鋒盾的拖尾
function netFxTick(dt) {
  for (const k in REMOTES) {
    const rp = REMOTES[k], f = rp.gf | 0, mg = rp.mage;
    if (!mg) continue;
    // 格擋窗開始(GUARD 512):盾光圈一次;不屈中(UNYIELD 2048):紅色氣場脈衝每 0.4 s
    if ((f & 512) && !rp._gB) burstRing(new V3(rp.px, rp.py + 1, rp.pz), 0xffd27a, 1.4);
    rp._gB = f & 512;
    if (f & 2048) { rp._uT = (rp._uT || 0) - dt; if (rp._uT <= 0) { rp._uT = .4; burstRing(new V3(rp.px, rp.py + 1, rp.pz), 0xff3a3a, 1.2); } }
    if (f & 8) {   // 旋風斬(g & 8):模型自轉,腳下每 0.3 s 一圈弧光
      mg.spinY = (mg.spinY + Math.PI * 8 * dt) % (Math.PI * 2);
      rp._nfT = (rp._nfT || 0) - dt;
      if (rp._nfT <= 0) { rp._nfT = NET_SPIN_GAP; arcSlash(new V3(rp.px, rp.py, rp.pz), 2.4, rp.yaw, auraOf(rp.cls, rp.el).hex, .3); }
    } else if (mg.spinY) mg.spinY = 0;
    if (f & 4) {   // 衝鋒盾(g & 4):身後拖尾
      const E = auraOf(rp.cls, rp.el), dx = Math.sin(rp.yaw), dz = Math.cos(rp.yaw);
      smoke.emit(rp.px + rnd(-.3, .3), rp.py + .1, rp.pz + rnd(-.3, .3), rnd(-.5, .5), rnd(.3, 1), rnd(-.5, .5), rnd(.5, .9), rnd(.4, .8), [.5, .45, .4], [.3, .3, .3], .4, 2, 0, 1.5);
      fire.emit(rp.px - dx * .5 + rnd(-.2, .2), rp.py + 1 + rnd(-.3, .3), rp.pz - dz * .5 + rnd(-.2, .2), -dx * .5, rnd(-.2, .2), -dz * .5, .35, rnd(.12, .2), E.c0, E.c1, .9, 1, 0, 2);
    }
  }
}

// 接上 Net 的 'ev'(net.js 已去重、略過開啟前的舊事件)
/* ================= N5:命中、否決、debuff、倒下 / 復活、計分、擊殺訊息、小計分板(設計 §2-5 ~ §2-8、§5-2、§5-4) =================
   流程:攻擊者端 RemotePlayer.hit 等記入待送 → netCombatTick 每幀合併成一則 hit 事件(有命中的那一幀)→
   受害者端 netApplyHit:去重、否決(倒地 / 無敵 / 衝鋒盾)、扣血(playerHurt,傷害 × NET_RULES.dmgK)、套 debuff、回報 dmg →
   倒下:netOnDown 送 down 事件、房主計分(score/<座位> = "擊倒,死亡")、所有人看到擊殺訊息。 */
const NET_RULES = { dmgK: .4, hitStun: .2, burnDmg: 2, poisonDmg: 1.2, cancelDmg: 10, vetoMs: 60, invKeepMs: 1500, scoreWinS: 8, ccCap: 1.5, ccDR: .5, ccWin: 4, ccMaxN: 3, ccImm: .5, hitStunGap: .5, slowCap: .65, bsBack: [2, 2.8], bsStealth: 1.3 };   // §8 預設:傷害倍率、硬直 0.2 s(0.5 s 內一次)、DOT 每 0.5 s(灼燒 / 每層中毒,狀態效果文件 §1-7)、集氣中斷門檻、否決時間窗、擊倒歸屬 8 s;控制總則見 status.js
// 自己的減速區不減速自己(§8 #8):world.js 的 addSlowZone 與 classes.js 的 zoneSlowAt 以 NET_ME 排除自己的區域
Object.defineProperty(window, 'NET_ME', { get: () => (Net.me || 0), configurable: true });
const netInputLocked = () => !!(window.NETON && window.NET_LOCK);   // 開戰倒數中,觸控鈕等事件式入口也要擋(§5-1)
let netHitSeq = 0, netLastK = '';
const NET_HIT_SEEN = new Set(), NET_HIT_Q = [], NET_INV_LOG = [];

// 每幀(game.js frame 在 updatePlayer 之前):無敵紀錄、擊退位移、撞牆跌倒判定(status.js)。減速 / 灼燒 / 中毒 / 各計時在 status.js 的 stTick
function netPlayerTick(dt) {
  if (!window.NETON || !Net.me) return;
  const now = Net.now(), p = mage.root.position;
  NET_INV_LOG.push({ t: now, inv: !!(G.invuln || G.invulnT > 0) });
  while (NET_INV_LOG.length && now - NET_INV_LOG[0].t > NET_RULES.invKeepMs) NET_INV_LOG.shift();
  if (G._kbPend) stKnockCheck(p);   // 上一幀的擊退:實際位移不足預期 → 撞牆跌倒
  if (G.kvx || G.kvz) {   // 擊退:速度衰減(exp(−3.2 dt),總位移 ≈ 距離);碰撞與地形由 updatePlayer 照常處理
    G._kbPend = true; G._kbX = p.x; G._kbZ = p.z; G._kbSpd = Math.hypot(G.kvx, G.kvz); G._kbExp = G._kbSpd * dt;
    p.x += G.kvx * dt; p.z += G.kvz * dt;
    const k = Math.exp(-3.2 * dt); G.kvx *= k; G.kvz *= k;
    if (Math.abs(G.kvx) < .01) G.kvx = 0;
    if (Math.abs(G.kvz) < .01) G.kvz = 0;
  }
}

// 收到 hit 事件(只處理 to 是自己的):去重 → 否決 → 扣血 → debuff → 回報 dmg
function netApplyHit(from, m) {
  if (!window.NETON || !Net.me || +m.to !== Net.me || G.down > 0) return;
  const id = from + ':' + m.hq;
  if (NET_HIT_SEEN.has(id)) return;
  NET_HIT_SEEN.add(id); NET_HIT_Q.push(id);
  if (NET_HIT_Q.length > 512) NET_HIT_SEEN.delete(NET_HIT_Q.shift());
  const p = mage.root.position, rt = +m.rt || Net.now();
  // 否決(§2-5):現在無敵,或攻擊者看到的時間點 ±60 ms 內自己無敵 → 閃避;衝鋒盾中 → 盾擋
  let blk = null;
  if (G.invuln || G.invulnT > 0 || NET_INV_LOG.some(r => r.inv && Math.abs(r.t - rt) <= NET_RULES.vetoMs)) blk = 'dodge';
  else if (typeof parryOn === 'function' && parryOn(from, rt)) blk = 'parry';   // 格擋否決(skills_sword.js,寫手 B 實作)
  else if (shieldOn()) blk = 'shield';
  if (blk) {
    if (blk === 'dodge') banner('閃避!', '#8fe8ff'); else banner(blk === 'parry' ? '格擋!' : '盾擋!', '#ffd27a');
    Net.emitEv({ t: 'dmg', by: from, n: 0, b: 0, blk: blk });
    if (blk === 'parry' && typeof onParry === 'function') onParry(from);   // 擋下後的反擊(skills_sword.js)
    return;
  }
  const raw = (m.h || []).reduce((s, x) => s + (+x[0] || 0) * swHitK(+x[2] || 0, +x[3] || 0), 0);   // 盾勢正面 ×0.7(skills_sword.js)
  const sum = raw * NET_RULES.dmgK * (G.litT > 0 ? 1.25 : 1);
  G.lastHitBy = from; G.lastHitK = typeof m.k === 'string' ? m.k : ''; G.lastHitT = G.time;   // 先記下,倒下時 netOnDown 才算得出擊倒者
  if (window.onPlayerHit) window.onPlayerHit();   // 潛行中被打 → 顯形(skills.js)
  const sh0 = G.shield;
  const res = sum > 0 ? playerHurt(sum, { by: from, net: true }) : { blocked: false, dmg: 0 };
  const dealt = sum > 0 ? res.dmg : 0, absorbed = Math.min(sh0, sum), full = sum > 0 && res.blocked;
  const fx = m.fx || {};
  if (!full) netApplyFx(swFxAdjust(fx), m.h || [], from);   // 護盾全吸收時不套 debuff;旋風斬免擊退、盾勢擊退 ×0.5(skills_sword.js)
  if (!full && G.state === 'charging' && (sum >= NET_RULES.cancelDmg || fx.st || fx.dn)) cancelCharge();   // §8 #5
  if (dealt > 0) { const f = document.getElementById('flash'); if (f) { f.style.opacity = .6; setTimeout(() => f.style.opacity = 0, 120); } }
  if (!full) hitFx(new V3(p.x, p.y + 1, p.z), 10);
  if (dealt > 0) addDmgText(new V3(p.x, p.y + 2.2, p.z), '-' + Math.round(dealt), '#ff6b6b');
  else if (full) addDmgText(new V3(p.x, p.y + 2.2, p.z), '護盾', '#ffd27a');
  if (sum > 0) Net.emitEv({ t: 'dmg', by: from, n: Math.round(dealt * 10) / 10, b: Math.round(absorbed * 10) / 10, blk: full ? 'shield' : 0 });
}
// 受害者端的控制遞減(§3-3):ccWin 秒內每多一次控制,時間再乘 ccDR(第 2 次 ×0.5、第 3 次 ×0.25);回傳本次倍率並記下這次
// 第 4 次起(ccMaxN 次在 4 s 內已用完)回傳 0 = 免疫;不寫入紀錄
function netCcScale() {
  const now = G.time, log = G.ccLog || (G.ccLog = []);
  while (log.length && now - log[0] > NET_RULES.ccWin) log.shift();
  if (log.length >= NET_RULES.ccMaxN) return 0;
  const k = Math.pow(NET_RULES.ccDR, log.length);
  log.push(now);
  return k;
}
// 套用 debuff(§2-7 步驟 4):實作在 status.js 的 stApplyFx(控制總則、DOT、寒意 / 中毒 / 致盲等)
function netApplyFx(fx, h, from) { stApplyFx(fx, h, from); }

// 攻擊者端:合併本幀的待送命中(每個目標一則);吸引位移每 100 ms 送一次;小計分板更新
function netCombatTick(dt) {
  const now = Net.now();
  Object.keys(REMOTES).forEach(k => {
    const rp = REMOTES[k];
    if (rp.pendPull && now - rp._pullT >= 100) {
      const q = rp.pend || (rp.pend = { h: [], fx: {} });
      q.fx.pl = [Math.round(rp.pendPull[0] * 100) / 100, Math.round(rp.pendPull[1] * 100) / 100];
      rp.pendPull = null; rp._pullT = now;
    }
    const p = rp.pend;
    if (p) { rp.pend = null; if (p.h.length || Object.keys(p.fx).length) netSendHit(rp, p, now); }
  });
  netBoardTick(now);
}
function netSendHit(rp, p, now) {
  // 來源標記(N7):h 第 6 欄為召喚物名;整則都來自召喚物時 k 記召喚物名(擊殺訊息用),sm:1 表示含召喚物傷害
  const smK = p.h.length && p.h.every(x => x[5]) ? p.h[p.h.length - 1][5] : null;
  Net.emitEv({ t: 'hit', to: rp.seat, hq: ++netHitSeq, rt: Math.round(now - interpDelay()), k: smK || netLastK, sm: p.h.some(x => x[5]) ? 1 : 0, h: p.h, fx: p.fx });
}

// 受害者回報的傷害數字:所有看得到對方的人都在對方頭上顯示(自己的數字由 netApplyHit 直接顯示)
function netShowDmg(seat, d) {
  const rp = REMOTES[String(seat)]; if (!rp) return;
  const pos = new V3(rp.px, rp.py + 2.4, rp.pz);
  if (+d.by === Net.me && +d.n > 0 && typeof crOnDealt === 'function') crOnDealt(+d.n);   // 劍士鬥氣:自己造成的實扣傷害(§4-4)
  if (d.blk === 'parry') addDmgText(pos, '格擋', '#ffd27a');
  else if (d.blk === 'dodge') addDmgText(pos, '閃避', '#8fe8ff');
  else if (d.blk === 'shield') addDmgText(pos, '護盾', '#ffd27a');
  else if (+d.n > 0) addDmgText(pos, '-' + Math.round(+d.n), '#ffd35a');
}

// 倒下(本機):送 down 事件、房主計分、本機也顯示擊殺訊息。by 為 8 s 內最後攻擊者,否則 0(無人得分)
function netOnDown() {
  if (!window.NETON || !Net.me) return;
  const by = G.lastHitBy && G.time - G.lastHitT < NET_RULES.scoreWinS ? G.lastHitBy : 0, k = by ? (G.lastHitK || '') : '';
  Net.emitEv({ t: 'down', by: by, k: k });
  netKillMsg(by, Net.me, k);
  netScoreDown(by, Net.me);
}
// 收到他人倒下的事件:顯示擊殺訊息;房主計分
function netOnRemoteDown(seat, d) {
  const by = +d.by || 0, k = typeof d.k === 'string' ? d.k.slice(0, 12) : '';
  netKillMsg(by, seat, k);
  netScoreDown(by, seat);
}
// 計分(§5-2):只有房主寫 score/<座位> = "擊倒,死亡";被打後 8 s 內倒下算最後攻擊者的擊倒;沒有自傷
function netScoreDown(by, victim) {
  if (!Net.isHost) return;
  const S = Net.scores(), cur = s => { const a = String(S[s] || '0,0').split(','); return [+a[0] || 0, +a[1] || 0]; };
  if (by && by !== victim) { const c = cur(by); Net.setScore(by, (c[0] + 1) + ',' + c[1]); netKillAt[by] = Net.now(); }
  const v = cur(victim); Net.setScore(victim, v[0] + ',' + (v[1] + 1));
}
// 復活(§5-4):在離活著對手最遠的出生點復活(最近對手 < 3 m 時改取次佳),清 debuff,tp+1 讓遠端直接跳過去。
// 沒有 cover 的 2 s 無敵以外的額外效果;無敵與 HP 由 resources.js 的 playerRevive 設定
function netRespawn() {
  if (!window.NETON || !Net.me) return;
  const alive = Object.keys(REMOTES).map(k => REMOTES[k]).filter(r => !r.dead);
  const cand = spawnPts.map(q => ({ q, d: alive.length ? Math.min(...alive.map(r => Math.hypot(r.px - q.x, r.pz - q.z))) : 99 }));
  cand.sort((a, b) => b.d - a.d);
  placeLocal((cand.find(c => c.d >= 3) || cand[0]).q);
  netClearDebuffs();
  G.tp = (G.tp | 0) + 1;
  if (G.state === 'charging') cancelCharge();
}
function netClearDebuffs() {
  G.kvx = G.kvz = 0; G.litT = 0; G.stun = 0; G.weak = 0; G.downK = 0; G.fallT = 0;
  stClear();   // 減速 / 灼燒 / 中毒 / 寒意 / 致盲 / 控制計時與韌性(status.js)
}
// 離開對戰(remote.js clearRemotes):清 debuff、HP 回滿、關擊殺訊息與小計分板
function netOnClear() {
  netClearDebuffs();
  G.hp = G.hpMax; G.shield = 0; G.shieldT = 0; G.down = 0; G.invulnT = 0;
  NET_INV_LOG.length = 0;
  if (netKillBox) netKillBox.replaceChildren();
  if (netBoard) netBoard.style.display = 'none';
  if (typeof resInit === 'function') resInit();   // 新局 / 離開:HP、MP、SP 回滿(單人時的傷勢不帶進對戰)
  netRoundReset();                                 // N6:結算畫面、回合計時、同分排名記錄
}
// 對戰開始(remote.js enterMatch):房間登記的自己的職業 / 屬性生效(對戰中 setClass / setElement 鎖定,這裡暫開)
function netApplyProfile(players) {
  const me = players.find(p => p.id === Net.me);
  if (!me) return;
  window.NET_PROFILE_CHANGE = true;
  try {
    if (me.cls && CLASSES[me.cls] && me.cls !== G.cls) setClass(me.cls);
    if (G.cls === 'mage' && me.el && EL[me.el] && me.el !== G.el) setElement(me.el);
  } finally { window.NET_PROFILE_CHANGE = false; }
}

/* ---------- 擊殺訊息(左側,最多 4 條,5 s 消失)與小計分板(上方中央) ---------- */
let netKillBox = null, netBoard = null, netBoardT = 0, netBoardKey = '';
function netUiBox(id, css) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; el.style.cssText = css; document.body.appendChild(el); }
  return el;
}
function netKillAdd(txt, col) {
  if (!netKillBox) netKillBox = netUiBox('netKill', 'position:fixed;left:12px;top:' + (IS_TOUCH ? 120 : 170) + 'px;display:flex;flex-direction:column;gap:4px;align-items:flex-start;z-index:14;pointer-events:none');
  const d = document.createElement('div');
  d.textContent = txt;
  d.style.cssText = 'padding:3px 10px;border-radius:6px;background:rgba(10,12,30,.6);color:' + col + ';font:600 15px sans-serif;text-shadow:0 0 4px #000;white-space:nowrap';
  netKillBox.appendChild(d);
  while (netKillBox.children.length > 4) netKillBox.firstChild.remove();
  setTimeout(() => d.remove(), 5000);
}
function netKillMsg(by, victim, k) {
  const vn = Net.nameOf(victim), me = Net.me;
  const txt = !by ? vn + ' 倒下了' : Net.nameOf(by) + (k ? ' 以 ' + k : '') + ' 擊倒 ' + vn;
  const col = victim === me ? '#ff8a8a' : (by === me ? '#b8f08a' : '#ffe3b0');
  netKillAdd(txt, col);
}
// 6 人以內全部列出;7 人以上列前 5 名加自己(§5-2)。內容只在變動時重建
function netBoardTick(now) {
  if (!netBoard) netBoard = netUiBox('netBoard', 'position:fixed;left:50%;top:40px;transform:translateX(-50%);min-width:180px;background:rgba(10,12,30,.6);border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px 10px;font:13px sans-serif;color:#ffe3b0;text-shadow:0 0 3px #000;pointer-events:none;z-index:14;display:none');
  if (!window.NETON || !Net.me) { netBoard.style.display = 'none'; return; }
  if (now - netBoardT < 200) return;
  netBoardT = now;
  const S = Net.scores(), rows = [{ seat: Net.me, name: Net.nameOf(Net.me) }];
  Object.keys(REMOTES).forEach(k => rows.push({ seat: +k, name: REMOTES[k].name }));
  rows.forEach(r => { const a = String(S[r.seat] || '0,0').split(','); r.k = +a[0] || 0; r.d = +a[1] || 0; });
  rows.sort((a, b) => b.k - a.k || a.d - b.d || a.seat - b.seat);
  let show = rows;
  if (rows.length > 6) { show = rows.slice(0, 5); const me = rows.find(r => r.seat === Net.me); if (!show.includes(me)) show.push(me); }
  const key = show.map(r => r.seat + ':' + r.name + ':' + r.k + '/' + r.d).join('|') + '#' + rows.length;
  netBoard.style.display = '';
  if (key === netBoardKey) return;
  netBoardKey = key;
  netBoard.replaceChildren();
  const add = (a, b, me) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:14px;justify-content:space-between;white-space:nowrap' + (me ? ';color:#fff' : '');
    const x = document.createElement('span'), y = document.createElement('span');
    x.textContent = a; y.textContent = b; row.appendChild(x); row.appendChild(y); netBoard.appendChild(row);
  };
  add('名字', '擊倒 / 死亡', false);
  show.forEach(r => add(r.name, r.k + ' / ' + r.d, r.seat === Net.me));
}

Net.on('ev', netOnEv);

/* ================= N6:回合計時、結算畫面與計分板、再來一局、離開房間(設計 §5-1、§5-2、§5-5、§6-2) =================
   計時:round.t0 / tEnd 由房主在 startGame 寫入;HUD 上方顯示剩餘時間,最後 10 s 變紅。
   結束:房主的 setInterval(背景分頁也會跑)在 tEnd 後依 擊倒多 → 死亡少 → 先達到該分數者 排序,寫 meta/result 並把 state 改為 result;
   所有人依 result 顯示結算計分板;tEnd 後即 NET_LOCK(remote.js netTick 呼叫 netRoundOver)。非房主等待時顯示「等待房主…」。 */
const NET_CLS_NAME = { mage: '法師', archer: '弓箭手', swordsman: '劍士', assassin: '刺客' };
let netKillAt = {};        // 房主本機:座位 → 最後一次取得擊倒的時間(同分排名用,先達到者在前)
let netEndT = 0, netSceneOn = false, netTimerEl = null, netTimerTxt = '', netResEl = null, netResKey = '', netResHint = null;

// 回合已結束(時間到或房主已寫 result):遊戲層鎖定操作
function netRoundOver() {
  if (!Net.me) return false;
  const rd = Net.roundOf();
  return !!rd && (Net.now() >= rd.tEnd || Net.metaState() === 'result');
}
function netRoundReset() { netKillAt = {}; netEndT = 0; netResult(null); netTimer(null); }

// 結算資料(房主):[座位, 暱稱, 職業, 擊倒, 死亡] 的陣列 JSON,≤ 600 字元(§6-1 result 欄位上限)
function netBuildResult() {
  const S = Net.scores(), rows = [];
  const add = (seat, name, cls) => {
    const a = String(S[seat] || '0,0').split(',');
    rows.push({ seat: seat, name: name, cls: cls, k: +a[0] || 0, d: +a[1] || 0, at: netKillAt[seat] || 1e15 });
  };
  add(Net.me, Net.nameOf(Net.me), G.cls);
  Object.keys(REMOTES).forEach(k => add(+k, REMOTES[k].name, REMOTES[k].cls));
  rows.sort((a, b) => (b.k - a.k) || (a.d - b.d) || (a.at - b.at) || (a.seat - b.seat));
  let list = rows.map(r => [r.seat, String(r.name).slice(0, 8), r.cls, r.k, r.d]);
  let json = JSON.stringify(list);
  while (json.length > 600 && list.length) { list = list.slice(0, -1); json = JSON.stringify(list); }
  return json;
}
function netFinishRound() {
  netEndT = Net.now();
  Net.setResult(netBuildResult());
}

// 每 250 ms(setInterval,不依賴 rAF):HUD 計時、房主結算、結算畫面切換、單人時場景按鈕還原
function netRoundTick() {
  const on = !!(window.NETON && Net.me);
  if (on !== netSceneOn) {   // 對戰中隱藏場景按鈕(§5-6;畫質鈕保留)
    netSceneOn = on;
    document.querySelectorAll('#sceneBar > button').forEach(b => { if (b.id !== 'qBtn') b.style.display = on ? 'none' : ''; });
  }
  if (!on) { netTimer(null); netResult(null); return; }
  const rd = Net.roundOf(), st = Net.metaState(), now = Net.now();
  if (!rd) return;
  if (st === 'match' && now < rd.tEnd) { netTimer(rd.tEnd - now); netResult(null); return; }
  netTimer(null);
  if (st === 'match' && Net.isHost && now - netEndT > 2000) netFinishRound();   // 時間到:房主寫結算(寫失敗 2 s 後重試)
  netResult(st === 'result' ? Net.metaResult() : '');
}

function netTimer(ms) {
  if (ms == null) { if (netTimerEl) netTimerEl.style.display = 'none'; return; }
  if (!netTimerEl) netTimerEl = netUiBox('netTimer', 'position:fixed;left:50%;top:8px;transform:translateX(-50%);font:700 22px sans-serif;text-shadow:0 0 4px #000;pointer-events:none;z-index:14;display:none');
  const s = Math.max(0, Math.ceil(ms / 1000)), txt = '剩餘 ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  if (txt !== netTimerTxt) { netTimerTxt = txt; netTimerEl.textContent = txt; }
  netTimerEl.style.color = s <= 10 ? '#ff5050' : '#ffe3b0';
  netTimerEl.style.display = '';
}

// mode:null 隱藏;'' 等待結算;JSON 字串 顯示計分板
function netResult(mode) {
  if (mode == null) { if (netResEl && netResEl.style.display !== 'none') { netResEl.style.display = 'none'; netResKey = ''; } return; }
  if (!netResEl) netResEl = netUiBox('netResult', 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(8,10,24,.82);z-index:40;font:15px sans-serif;color:#ffe3b0');
  const key = (Net.isHost ? 'h' : 'g') + mode;
  if (key !== netResKey) { netResKey = key; netFillResult(mode); }
  netResEl.style.display = 'flex';
}
function netCell(t, head, me) {
  const s = document.createElement('span');
  s.textContent = t;
  s.style.cssText = 'padding:2px 8px;white-space:nowrap' + (head ? ';color:#9aa3c7' : '') + (me ? ';color:#fff;font-weight:700;background:rgba(255,255,255,.1);border-radius:4px' : '');
  return s;
}
function netBtn(text, fn, primary) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = text;
  b.style.cssText = 'font:600 15px sans-serif;padding:8px 14px;border-radius:8px;cursor:pointer;color:#fff;border:1px solid rgba(255,255,255,.25);background:' + (primary ? '#3d5fbf' : 'rgba(255,255,255,.08)');
  b.onclick = e => { e.stopPropagation(); fn(); };
  return b;
}
function netFillResult(mode) {
  netResEl.replaceChildren();
  const box = document.createElement('div');
  box.style.cssText = 'background:rgba(20,24,50,.96);border:1px solid rgba(255,255,255,.2);border-radius:12px;padding:18px 22px;max-width:92vw;text-align:center';
  const title = document.createElement('div');
  title.style.cssText = 'font:700 22px sans-serif;margin-bottom:12px';
  box.appendChild(title);
  const isHost = Net.isHost;
  if (!mode) title.textContent = '時間到,等待結算…';
  else {
    title.textContent = '本局結算';
    let rows = [];
    try { rows = JSON.parse(mode); } catch (e) { rows = []; }
    if (!Array.isArray(rows)) rows = [];
    const tb = document.createElement('div');
    tb.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto auto auto;gap:4px 6px;align-items:center;text-align:left;font:15px sans-serif';
    ['名次', '暱稱', '職業', '擊倒', '死亡'].forEach(h => tb.appendChild(netCell(h, true, false)));
    rows.forEach((r, i) => {
      const me = +r[0] === Net.me;
      [i + 1, r[1], NET_CLS_NAME[r[2]] || r[2], r[3], r[4]].forEach(v => tb.appendChild(netCell(String(v), false, me)));
    });
    box.appendChild(tb);
  }
  const btns = document.createElement('div');
  btns.style.cssText = 'margin-top:16px;display:flex;flex-wrap:wrap;gap:8px;justify-content:center';
  if (mode && isHost) {
    btns.appendChild(netBtn('再來一局(同場地)', () => netRematch(false), true));
    btns.appendChild(netBtn('換場地再來', () => netRematch(true), false));
  }
  btns.appendChild(netBtn('離開房間', netLeave, false));
  box.appendChild(btns);
  netResHint = document.createElement('div');
  netResHint.style.cssText = 'margin-top:8px;font-size:13px;min-height:16px;color:#ff8a8a';
  if (mode && !isHost) netResHint.textContent = '等待房主再來一局或離開…';
  box.appendChild(netResHint);
  netResEl.appendChild(box);
}
// 房主:新一局(同場地或隨機換另一個場地),新 seed、HP / MP / SP 重置與重新倒數都由 startGame + enterMatch 處理
function netRematch(rotate) {
  const cur = typeof window.getSceneIndex === 'function' ? window.getSceneIndex() : 0;
  let scene = cur;
  if (rotate) { const n = typeof window.getSceneCount === 'function' ? window.getSceneCount() : 2, c = Array.from({ length: n }, (_, i) => i).filter(i => i !== cur); if (c.length) scene = c[Math.floor(Math.random() * c.length)]; }
  Net.startGame({ scene: scene }).catch(e => { if (netResHint) netResHint.textContent = e && e.reason === 'notEnough' ? '至少需要 2 人才能再來一局' : '再來一局失敗,請再試一次'; });
}
// 離開房間回封面(cover.js 會呼叫 Net.leave,remote.js 清掉 REMOTES / 稻草人 / NETON,netOnClear 還原 HUD)
function netLeave() {
  if (window.COVER_API && typeof COVER_API.leaveRoom === 'function') COVER_API.leaveRoom();
  else Net.leave();
}
setInterval(netRoundTick, 250);
