'use strict';
// 配裝(設計_武器技能系統與火柴人角色 §3):沒有職業,每人選 2 把武器 × (免費普攻 + 3 技能)+ 1 個大絕招。
// 遷移技巧:G.cls = 「手上那把武器的家族」(swordsman / archer / mage / dual),所以既有的 cast 函式與 ~110 處 G.cls 判斷照常運作;
//   快捷列格位表 SLOTS[w] = [{ fam, ix, el }] × 4(第 0 格 = 普攻),curSkill(i) / skillIx(i) / spellOf(i)(classes.js)改讀格位表。
//   第 4 格(i = 4)= 大絕招(按 Y / #btnUlt 按住兩段集氣)。
// 載入順序:skills_dual.js → resources.js → status.js → loadout.js → classes.js(classes.js 的 initClass 呼叫 loInit)。
const LO_KEY = 'mageSandbox.lo.v1';
const ULT_IDS = ['meteorUlt', 'dragonUlt', 'godUlt'];
// 武器表:fam = 家族(CLASSES 的鍵)、doll = 人偶武器鍵、basic = 免費普攻的扁平索引(法杖 = 魔力彈)、pool = 技能池(扁平索引;法杖 = 'el:ix')
const STAFF_POOL = (() => {   // 6 屬性 × 彈 0 / 天降 2 / 召喚 3 = 18,加火牆(fire:1)、石牆(earth:1)= 20 招;水 / 風 / 光 / 暗的牆槽原為增益(階段 4,尚未做),先不收
  const o = []; EL_ORDER.forEach(el => { [0, 2, 3].forEach(ix => o.push(el + ':' + ix)); if (el === 'fire' || el === 'earth') o.push(el + ':1'); }); return o;
})();
const WEAPON_DEFS = {
  sword: { name: '長劍', icon: '⚔️', fam: 'swordsman', doll: 'sword', basic: 7, pool: [0, 1, 5, 6, 3], tag: '近戰・均衡・三連斬' },
  bow: { name: '長弓', icon: '🏹', fam: 'archer', doll: 'bow', basic: 0, pool: [1, 2, 6, 5, 4], tag: '遠程・輸出・射擊' },
  staff: { name: '短法杖', icon: '🪄', fam: 'mage', doll: 'staff', basic: 'mbolt', pool: STAFF_POOL, tag: '中遠・屬性法術・魔力彈' },
  dual: { name: '雙劍', icon: '🗡️', fam: 'dual', doll: 'dual', basic: 0, pool: [1, 2, 3], tag: '近戰・連擊・五連斬' }
};
const WEAPON_ORDER = ['sword', 'bow', 'staff', 'dual'];
const FAM_WEAPON = { swordsman: 'sword', archer: 'bow', mage: 'staff', dual: 'dual', assassin: 'dual' };   // 舊職業 → 武器(setClass 相容)
const DEF_LO = { w: ['staff', 'sword'], sk: { sword: [0, 1, 6], bow: [1, 2, 6], staff: ['fire:0', 'fire:1', 'fire:2'], dual: [1, 2, 3] }, ult: 'meteorUlt' };
const LO = { w: DEF_LO.w.slice(), sk: JSON.parse(JSON.stringify(DEF_LO.sk)), ult: 'meteorUlt', slots: [[], []], lastEl: 'fire', pend: null };

function loValid(c) {   // 檢查一份配裝(不合法回 null)
  if (!c || !Array.isArray(c.w) || c.w.length !== 2 || c.w[0] === c.w[1] || !WEAPON_DEFS[c.w[0]] || !WEAPON_DEFS[c.w[1]] || !ULT_IDS.includes(c.ult)) return null;
  const out = { w: c.w.slice(), sk: {}, ult: c.ult };
  for (const w of WEAPON_ORDER) {
    const pool = WEAPON_DEFS[w].pool, s = (c.sk && c.sk[w] || []).filter((x, i, a) => pool.includes(x) && a.indexOf(x) === i).slice(0, 3);
    for (const x of DEF_LO.sk[w].concat(pool)) { if (s.length >= 3) break; if (pool.includes(x) && !s.includes(x)) s.push(x); }
    out.sk[w] = s;
  }
  return out;
}
function loBuildSlots() {
  LO.slots = LO.w.map(w => {
    const d = WEAPON_DEFS[w], row = [d.fam === 'mage' ? { fam: 'mage', ix: 0, el: 'fire', basic: true } : { fam: d.fam, ix: d.basic, basic: true }];
    LO.sk[w].forEach(x => { if (d.fam === 'mage') { const [el, ix] = String(x).split(':'); row.push({ fam: 'mage', ix: +ix, el }); } else row.push({ fam: d.fam, ix: x }); });
    return row;
  });
}
// 格位(i = 0~3;4 = 大絕招);法杖普攻的屬性 = 上次施放的屬性
function loSlotAt(i) {
  if (i === 4) return { fam: 'ult', ix: Math.max(0, ULT_IDS.indexOf(LO.ult)) };
  const s = (LO.slots[G.w | 0] || [])[i]; if (!s) return null;
  return s.basic && s.fam === 'mage' ? Object.assign({}, s, { el: LO.lastEl }) : s;
}
const loFamOf = w => WEAPON_DEFS[LO.w[w]].fam;
// 目前選中的格位屬性 → G.el(法杖不同格可不同屬性;杖頭色 / 氣場 / 符文都讀 G.el)
function loSyncEl() {
  const s = loSlotAt(G.skill < 0 ? (G.lastSkill || 0) : G.skill);
  if (s && s.fam === 'mage' && s.el && G.el !== s.el && EL[s.el]) { G.el = s.el; if (typeof applyElColors === 'function') applyElColors(); }
}
function loSave() { try { localStorage.setItem(LO_KEY, JSON.stringify({ w: LO.w, sk: LO.sk, ult: LO.ult })); } catch (e) { } }
// 套用配裝:immediate = 重置冷卻 / MP / SP / 能量(改配裝);大招冷卻照走(換大招時搬到新 id)
function loApply(cfg, fresh) {
  const c = loValid(cfg) || loValid(DEF_LO);
  const oldUlt = LO.ult, ultCd = Math.max(G.cd.meteorUlt || 0, G.cd.dragonUlt || 0, G.cd.godUlt || 0);
  LO.w = c.w; LO.sk = c.sk; LO.ult = c.ult; loBuildSlots(); loSave();
  G.w = 0; G.cls = loFamOf(0); G.crS = {}; G.cr = 0; G.swapCd = 0; G.swapAct = 0;
  if (typeof whirlRunEnd === 'function' && G.whirlRun) whirlRunEnd();
  G.spin = null; mage.spinY = 0; G.flurry = null; G.rush = null;
  mage.setLoadout(WEAPON_DEFS[LO.w[0]].doll, WEAPON_DEFS[LO.w[1]].doll, 0);
  G.skill = 0; G.lastSkill = 0; G.wallOff = 0; G.stance = 0; G.combo = { ix: 0, t: -9 };
  if (!fresh) { for (const k in G.cd) G.cd[k] = 0; G.mp = G.mpMax; G.sp = G.spMax; }   // 改配裝:技能冷卻與 MP / SP 歸零
  ULT_IDS.forEach(k => { G.cd[k] = 0; }); G.cd[LO.ult] = fresh ? ULT.open : ultCd;
  loSyncEl(); if (typeof refreshHotbar === 'function') { refreshHotbar(); refreshClsBar(); }
  if (typeof applyElColors === 'function') applyElColors();
}
function loInit() {
  if (!_ultBtn) loBuildHud();
  let c = null; try { c = loValid(JSON.parse(localStorage.getItem(LO_KEY))); } catch (e) { }
  loApply(c || DEF_LO, true);
}
// 換武(Tab / 手把換裝鍵 / #btnWeap):動作 0.35 s、之後冷卻 0.6 s;集氣中 = 取消集氣(不換);大招冷卻不受影響
function loSwap() {
  if (G.state === 'charging') { cancelCharge(); return; }
  if (G.state !== 'ready' || G.swapCd > 0 || G.down > 0 || G.roll || G.stun > 0 || G.leap || G.rush) return;
  if (G.sitting) sitBreak('swap');
  const oldFam = G.cls; G.crS = G.crS || {}; G.crS[oldFam] = G.cr;
  if (G.whirlRun) whirlRunEnd(); G.spin = null; mage.spinY = 0; G.parryT = 0;
  G.lastSkillW = G.lastSkillW || [0, 0]; G.lastSkillW[G.w] = G.lastSkill || 0;
  G.w ^= 1; G.cls = loFamOf(G.w); G.cr = G.crS[G.cls] || 0; G.combo = { ix: 0, t: -9 };
  G.skill = G.lastSkillW[G.w] || 0; G.lastSkill = G.skill; G.wallOff = 0;
  G.swapAct = .35; G.swapCd = .95;   // 動作 0.35 s + 完成後冷卻 0.6 s
  mage.swapHeld(); actMark('swapWeapon');
  loSyncEl(); refreshHotbar(); refreshClsBar();
  banner(WEAPON_DEFS[LO.w[G.w]].name, '#8fe8ff');
}
// 舊介面相容(cover.js / 測試 / netcombat):setClass(c) = 把該家族的武器換到手上;不在配裝內就替換武器 A
function loSetFam(c) {
  const w = FAM_WEAPON[c]; if (!w) return;
  const i = LO.w.indexOf(w);
  if (i === G.w) return;
  if (i >= 0) { loSwapTo(i); return; }
  const cfg = { w: [w, LO.w[1] === w ? LO.w[0] : LO.w[1]], sk: LO.sk, ult: LO.ult }; loApply(cfg, true);
}
function loSwapTo(i) {   // 直接換到第 i 把(不播動作、不進冷卻)
  if (G.state === 'charging') cancelCharge();
  if (G.state !== 'ready' || i === G.w) return;
  G.crS = G.crS || {}; G.crS[G.cls] = G.cr; if (G.whirlRun) whirlRunEnd(); G.spin = null; mage.spinY = 0;
  G.w = i; G.cls = loFamOf(i); G.cr = G.crS[G.cls] || 0; G.skill = 0; G.lastSkill = 0; G.combo = { ix: 0, t: -9 };
  mage.setLoadout(WEAPON_DEFS[LO.w[0]].doll, WEAPON_DEFS[LO.w[1]].doll, i); loSyncEl(); refreshHotbar(); refreshClsBar();
}
// 倒地重生時才套用的待套配裝(多人):resources.js playerRevive 呼叫
function loOnRevive() { if (LO.pend) { const c = LO.pend; LO.pend = null; loApply(c, false); banner('配裝已套用', '#8fe8ff'); } }

/* ---------- 大絕招操作(按住 = 兩段集氣;放開出手) ---------- */
function ultPress() {
  if (window.COVER_ON || (window.NETON && window.NET_LOCK)) return;
  const sk = curSkill(4);
  if (G.state !== 'ready' || G.down > 0) return;
  if (G.swapAct > 0) { banner('換武中', '#ffc46b'); return; }
  if (G.godT > 0 || G.crashT > 0) return;
  if ((G.cd[sk.id] || 0) > 0) { if (G.time - (G._ultBan || -9) > .8) { G._ultBan = G.time; banner('大招冷卻 ' + Math.ceil(G.cd[sk.id]) + ' s', '#ffc46b'); } return; }
  G.skill = 4; G.atkHeld = false; startCharge();
  if (G.state !== 'charging') G.skill = G.lastSkill || 0;
}
function ultRelease() { if (G.state === 'charging' && G.skill === 4) letGo(); }

/* ---------- HUD:#btnUlt(冷卻環 / 集氣 / 倒數)與 #btnLo ---------- */
let _ultBtn = null, _ultKey = '';
function loBuildHud() {
  const st = document.createElement('style');
  st.textContent = '#clsBar,#clsTog,#elBar{display:none !important}'
    + '#btnUlt{position:fixed;right:calc(20px + env(safe-area-inset-right));bottom:calc(150px + env(safe-area-inset-bottom));width:60px;height:60px;border-radius:50%;border:3px solid #ffd27a;background:#222;color:#fff;font-size:24px;display:flex;align-items:center;justify-content:center;touch-action:none;z-index:20;user-select:none;cursor:pointer;padding:0}'
    + 'body.touch #btnUlt{right:calc(16px + env(safe-area-inset-right));bottom:calc(120px + env(safe-area-inset-bottom));width:54px;height:54px}'
    + '#btnUlt .t{position:absolute;font-size:15px;font-weight:bold;text-shadow:0 0 4px #000}#btnUlt.rdy{box-shadow:0 0 16px #ffd27a}#btnUlt.off{filter:grayscale(1) brightness(.7)}'
    + 'body.cover #btnUlt,body.cover #btnLo{display:none !important}'
    + '#btnLo{position:fixed;left:calc(10px + env(safe-area-inset-left));top:76px;z-index:21;padding:4px 10px;border-radius:14px;border:2px solid #8fe8ff;background:rgba(10,20,40,.8);color:#8fe8ff;font-size:13px;cursor:pointer}'
    + '#loPage{position:fixed;inset:0;z-index:9000;background:rgba(6,10,22,.97);color:#e8f0ff;overflow:auto;padding:14px;display:none;font-size:14px}#loPage.on{display:block}'
    + '#loPage h2{margin:4px 0 8px;font-size:20px}#loPage h3{margin:14px 0 6px;font-size:15px;color:#8fe8ff}#loPage .row{display:flex;flex-wrap:wrap;gap:6px}'
    + '#loPage button{background:#16213a;color:#e8f0ff;border:2px solid #3a4a70;border-radius:10px;padding:7px 10px;font-size:14px;cursor:pointer}#loPage button.on{border-color:#3ee8ff;background:#0e3a4a;box-shadow:0 0 10px #3ee8ff80}#loPage button:disabled{opacity:.35;cursor:default}'
    + '#loPage .big{min-width:120px;padding:10px 12px}#loPage .sub{color:#9aa8c8;font-size:12px;display:block}#loPage .ok{border-color:#7aff9a;background:#0e3a22}';
  document.head.appendChild(st);
  const b = document.createElement('button'); b.id = 'btnUlt'; b.tabIndex = -1; b.innerHTML = '<span class="ic"></span><span class="t"></span>';
  b.addEventListener('pointerdown', e => { e.preventDefault(); if (typeof touchNow === 'function' && e.pointerType === 'touch') touchNow(); ultPress(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => b.addEventListener(t, () => ultRelease()));
  document.body.appendChild(b); _ultBtn = b;
  const lb = document.createElement('button'); lb.id = 'btnLo'; lb.textContent = '配裝 (L)'; lb.tabIndex = -1; lb.onclick = () => { loOpen(); lb.blur(); }; document.body.appendChild(lb);
}
const ULT_ICON = { meteorUlt: '☄️', dragonUlt: '🐉', godUlt: '🔥' };
// 每幀(classes.js updateCdHUD 呼叫):只在值變動時寫 DOM
function loHudTick() {
  if (!_ultBtn) return;
  const sk = curSkill(4), cd = G.cd[sk.id] || 0, on = G.godT > 0 || G.crashT > 0, chg = G.state === 'charging' && G.skill === 4;
  const txt = G.godT > 0 ? Math.ceil(G.godT) : G.crashT > 0 ? '崩' : cd > 0 ? Math.ceil(cd) : '';
  const frac = chg ? G.p : cd > 0 ? 1 - cd / ULT.cd : 1, key = sk.id + '|' + txt + '|' + Math.round(frac * 50) + '|' + (chg ? 1 : 0) + '|' + (G.swapAct > 0 ? 1 : 0);
  if (key === _ultKey) return; _ultKey = key;
  _ultBtn.querySelector('.ic').textContent = ULT_ICON[sk.id] || '★';
  _ultBtn.querySelector('.t').textContent = txt;
  _ultBtn.classList.toggle('rdy', cd <= 0 && !on); _ultBtn.classList.toggle('off', (cd > 0 && !chg) || on || G.swapAct > 0);
  const col = chg ? (G.p >= 1 ? '#ffd27a' : G.p >= .5 ? '#fff' : '#ff8a8a') : '#ffd27a';
  _ultBtn.style.background = 'conic-gradient(' + col + ' ' + Math.round(frac * 100) + '%,#2a2a2a 0)';
}

/* ---------- 配裝頁(滿版):武器 A / B、各 3 技能、大招 ---------- */
let _loUI = null, _loEl = 'fire';
function loOpen() {
  if (window.NETON && G.down <= 0) { banner('對戰中只有倒地時能改配裝', '#ffc46b'); return; }
  if (!window.NETON && G.state !== 'ready') return;
  _loUI = { w: LO.w.slice(), sk: JSON.parse(JSON.stringify(LO.sk)), ult: LO.ult, sel: 0 };
  if (document.pointerLockElement) try { document.exitPointerLock(); } catch (e) { }
  loRender(); document.getElementById('loPage').classList.add('on');
}
function loClose() { document.getElementById('loPage').classList.remove('on'); }
function loName(w, x) {
  if (WEAPON_DEFS[w].fam === 'mage') { const [el, ix] = String(x).split(':'); const sp = SPELLS[el][+ix]; return { n: sp.name, ic: sp.icon || EL[el].ch, sub: EL[el].name }; }
  const sk = CLASSES[WEAPON_DEFS[w].fam].skills[x]; return { n: sk.name, ic: sk.icon, sub: '' };
}
function loRender() {
  const P = document.getElementById('loPage'), U = _loUI; P.innerHTML = '';
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  P.appendChild(el('h2', '', '配裝'));
  P.appendChild(el('div', 'sub', '2 把武器(Tab / 換武鈕切換,0.6 s 冷卻)× 各 1 個免費普攻 + 3 技能,另選 1 個大絕招。戰技與法術共用 MP。'));
  [0, 1].forEach(slot => {
    P.appendChild(el('h3', '', slot ? '武器 B(背上)' : '武器 A(開場手上)'));
    const r = el('div', 'row');
    WEAPON_ORDER.forEach(w => { const d = WEAPON_DEFS[w], b = el('button', 'big' + (U.w[slot] === w ? ' on' : ''), d.icon + ' ' + d.name + '<span class="sub">' + d.tag + '</span>'); b.disabled = U.w[1 - slot] === w; b.onclick = () => { U.w[slot] = w; U.sel = slot; loRender(); }; r.appendChild(b); });
    P.appendChild(r);
    const w = U.w[slot], d = WEAPON_DEFS[w], sr = el('div', 'row'); sr.style.marginTop = '6px';
    P.appendChild(el('div', 'sub', '技能(選 3 個)' + (d.pool.length === 3 ? ':此武器固定 3 招' : '')));
    if (d.fam === 'mage') {
      const er = el('div', 'row'); EL_ORDER.forEach(e2 => { const b = el('button', e2 === _loEl ? 'on' : '', EL[e2].ch + ' ' + EL[e2].name); b.onclick = () => { _loEl = e2; loRender(); }; er.appendChild(b); }); P.appendChild(er);
    }
    const pool = d.fam === 'mage' ? d.pool.filter(x => x.split(':')[0] === _loEl) : d.pool;
    pool.forEach(x => {
      const nm = loName(w, x), on = U.sk[w].includes(x), b = el('button', on ? 'on' : '', nm.ic + ' ' + nm.n + (nm.sub ? '<span class="sub">' + nm.sub + '</span>' : ''));
      b.onclick = () => { const a = U.sk[w], i = a.indexOf(x); if (i >= 0) { if (d.pool.length > 3) a.splice(i, 1); } else if (a.length < 3) a.push(x); else a.shift(), a.push(x); loRender(); };
      sr.appendChild(b);
    });
    P.appendChild(sr);
    const sel = el('div', 'sub', '已選:' + U.sk[w].map(x => loName(w, x).n).join('、') + '(' + U.sk[w].length + '/3)'); P.appendChild(sel);
  });
  P.appendChild(el('h3', '', '大絕招(冷卻 75 s、開場 30 s 後可用、不扣 MP、按住兩段集氣)'));
  const ur = el('div', 'row');
  [['meteorUlt', '☄️ 隕星天罰', '指定落點,天降隕石;第一段小圈 / 第二段大圈'], ['dragonUlt', '🐉 破軍龍突', '直線突進 9 / 16 m,終點爆炸擊飛'], ['godUlt', '🔥 鬥神降臨', '5 / 8 s 強化,結束崩潰 3 s']].forEach(([id, n, t]) => {
    const b = el('button', 'big' + (U.ult === id ? ' on' : ''), n + '<span class="sub">' + t + '</span>'); b.onclick = () => { U.ult = id; loRender(); }; ur.appendChild(b);
  });
  P.appendChild(ur);
  const ok = U.sk[U.w[0]].length === 3 && U.sk[U.w[1]].length === 3, act = el('div', 'row'); act.style.marginTop = '16px';
  const bo = el('button', 'big ok', '確定'); bo.disabled = !ok; bo.onclick = () => {
    const c = { w: U.w.slice(), sk: U.sk, ult: U.ult };
    if (window.NETON) { LO.pend = loValid(c); loClose(); banner('復活時套用配裝', '#8fe8ff'); } else { loApply(c, false); loClose(); banner('配裝完成', '#8fe8ff'); }
  };
  const bc = el('button', 'big', '取消'); bc.onclick = loClose;
  act.appendChild(bo); act.appendChild(bc); P.appendChild(act);
}
(function buildLoPage() {
  const p = document.createElement('div'); p.id = 'loPage'; document.body.appendChild(p);
  addEventListener('keydown', e => { if (e.code === 'Escape' && p.classList.contains('on')) { loClose(); e.stopPropagation(); } }, true);
})();
