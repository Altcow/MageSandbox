'use strict';
// 多人對戰:施放事件的送出與重現(設計 §2-4、§2-6、§2-9、§4-3)。
// 送出:netSendCast(P) 在 game.js updateCasting 出手瞬間呼叫(只在 NETON),事件 ev/<我的座位>/<key>,t = 'cast'。
// 接收:net.js 去重後發出 'ev' → netReplayCast:以該座位的 RemotePlayer 當施法者重現(P.net、P.rng 種子),
//   不扣資源、不寫 CD、不建 SmUnit(castSummon 在 P.net 時只播能量球與出場特效)。
// 遠端投射物只做視覺:RemotePlayer.hit 等仍是空函式(傷害留給 N5),這裡不呼叫 playerHurt,不會傷到本機。
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
  netPostCast({
    t: 'cast', sq: ++netSeq, cls: G.cls, el: P.el, ix: P.idx, bs: P.base, md: P.mode || null,
    T: vOut(P.target), tip: vOut(mage.tipWorld(new V3())), mz: vOut(P.muzzle),
    dir: r3(P.dir), wy: r3(P.wallYaw), q: r3(P.q), sz: r3(P.sizeK), th: r3(P.thickK), cp: P.copies || 1,
    r: r3(P.r), pw: r3(P.power), rg: r3(P.range), dk: r3(P.dmgK), uk: r3(P.durK), fk: r3(P.fxK), sd: P.sd
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
  else if (!netUnknownWarned[t]) { netUnknownWarned[t] = true; console.warn('[net] 未知事件類型,忽略:' + t); }
}
// 以該座位的 RemotePlayer 當施法者重現(§2-4 接收端 1~7)
function netReplayCast(seat, m) {
  const rp = REMOTES[String(seat)];
  if (!rp || !rp.g) return;
  const cls = CLASSES[m.cls] ? m.cls : 'mage', el = EL[m.el] ? m.el : 'fire';
  const sk = netSkill(cls, el, m.ix | 0);
  const target = vIn(m.T);
  if (!sk || !target || typeof m.sd !== 'number') return;
  const sp = netSpell(cls, el, m.ix | 0) || {};
  if (sk.netFx) { netFxPlay(sk.netFx, rp, sp, m); return; }   // 位移招式:只播簡化特效,不呼叫原函式(§2-9)
  const aura = auraOf(cls, el), tip = vIn(m.tip) || rp.g.position.clone();
  const P = {
    skill: sk, spell: sp, base: m.bs, idx: m.ix | 0, el, target, q: m.q || 0, charge: m.q || 0, mode: m.md || undefined,
    sizeK: m.sz, thickK: m.th, copies: m.cp || 1, r: m.r, power: m.pw, range: m.rg, muzzle: vIn(m.mz) || tip.clone(),
    dmgK: m.dk, durK: m.uk, fxK: m.fk, dir: m.dir, wallYaw: m.wy, dmgMul: 1, recover: 0,
    net: seat, sd: m.sd, rng: seedRng(m.sd),                       // 種子與發送端相同,決定位置 / 時間的亂數一致(§2-4)
    casterPos: rp.g.position, casterYaw: () => rp.yaw, tip: tip, aura: aura
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
  if (sp.shout) addDmgText(new V3(rp.px, rp.py + 2.8, rp.pz), sp.shout, '#ffffff');
}
// 每幀(remote.js netTick 呼叫,只在 NETON):依快照旗標播旋風斬的旋轉 / 弧光、衝鋒盾的拖尾
function netFxTick(dt) {
  for (const k in REMOTES) {
    const rp = REMOTES[k], f = rp.gf | 0, mg = rp.mage;
    if (!mg) continue;
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
Net.on('ev', netOnEv);
