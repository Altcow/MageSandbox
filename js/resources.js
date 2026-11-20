'use strict';
// 玩家資源系統(設計_玩家資源HPMPSP.md R-1~R-5):HP / MP / SP、自然恢復、移動與施法消耗、資源 HUD、倒下 / 復活、打坐
// 掛點:game.js(frame / doJump / tryRoll / startCharge / updateCasting / release / strike / resetWorld / updatePlayer / updateHUD / PANEL)、
//       classes.js(setClass)、touch.js(打坐鈕與手把)、mage.js(sit / down 姿勢)、index.html(#pRes、#btnSit)
// 載入順序:skills.js → resources.js → classes.js(classes.js 最後呼叫 startLoop)。resInit() 在載入時執行一次。

const RES_MAX = { hp: 200, mp: 150, sp: 300 };
// 統一兩段集氣(設計_統一集氣系統.md):戰技與法術都吃 MP,SP 只管跑步 / 翻滾 / 二段跳 / 旋風疾行。
// 花費級(第二段 = 100%,第一段 = 80%):輕 10 / 中 20 / 重 35 / 長 CD 45(淨化 15 隨 v3,尚未實作)
const MP_TIER = { light: 10, mid: 20, heavy: 35, long: 45 };
// 招式表(以 CFG.skills 的鍵 / 招式 id 為索引):tier = MP 花費級;mv = 集氣中移速倍率(0 = 原地只能轉向);t1 / t2 = 覆寫兩段秒數(預設 T2 = chargeTime、T1 = 一半且 ≥ .25 s)
// 例外(不走兩段)由招式旗標決定:instant(格擋反擊 / 後躍射擊 / 影分身 按下即發)、hold(旋風疾行 按住持續)
const CHARGE2 = {
  fireball: { tier: 'light', mv: .3 }, firewall: { tier: 'mid', mv: 0 }, meteor: { tier: 'heavy', mv: 0 }, summon: { tier: 'heavy', mv: 0 },
  quickShot: { tier: 'light', mv: .3 }, shockArrow: { tier: 'mid', mv: .3 }, arrowRain: { tier: 'heavy', mv: 0 }, scatter: { tier: 'light', mv: .3 }, disengage: { tier: 'light', mv: 0 },
  snare: { tier: 'light', mv: .3 }, flare: { tier: 'long', mv: .3 },
  powerSlash: { tier: 'mid', mv: .5 }, whirlwind: { tier: 'mid', mv: .5 }, shieldCharge: { tier: 'mid', mv: .5 }, parry: { tier: 'light', mv: 0 }, slam: { tier: 'mid', mv: .5 },
  whirlRun: { tier: 'light', mv: 0 }, skyLeap: { tier: 'long', mv: 0 },
  backstab: { tier: 'light', mv: .5 }, knives: { tier: 'light', mv: .5 }, stealth: { tier: 'mid', mv: .5 }, shadowStep: { tier: 'light', mv: .5, t1: .25, t2: .55 },
  smoke: { tier: 'mid', mv: .5 }, eviscerate: { tier: 'light', mv: .5 }, decoy: { tier: 'mid', mv: 0 }
};

// 招式的資源種類與基準花費:全部 = MP(依招式表花費級)
function skillCost(i) {
  const e = CHARGE2[baseOf(i)];
  return { kind: 'mp', base: MP_TIER[e ? e.tier : 'light'] };
}
// 集氣花費:放手時 s = 第一段起點 → 第二段 0 → 1;base × lerp(0.8, 1.0, s);無限資源 = 0。開始集氣只檢查 costAt(base, 0)(= 第一段花費)
const costAt = (base, s) => (CFG.res.infinite && !window.NETON) ? 0 : base * lerp(.8, 1, s);
const resCan = (kind, n) => (CFG.res.infinite && !window.NETON) || G[kind] >= n - 1e-6;
// 啟動自檢:列出沒進招式表的招式(掉回預設「輕」)
function c2SelfCheck() {
  const miss = [];
  SKILLS.forEach(s => { if (!CHARGE2[s.id]) miss.push(s.id); });
  for (const c in CLASSES) if (CLASSES[c].skills) CLASSES[c].skills.forEach(s => { if (!CHARGE2[s.id]) miss.push(s.id); });
  if (miss.length) console.warn('[兩段集氣] 招式表缺列:', miss.join(', '));
  return miss;
}

// 不足回饋:條閃紅(0.8 s)+ 小字(同一種 1 s 內只顯示一次)
const _denyT = { mp: -9, sp: -9 };
function resDeny(kind) {
  const el = document.getElementById(kind === 'mp' ? 'pMP' : 'pSP');
  if (el) { el.classList.remove('deny'); void el.offsetWidth; el.classList.add('deny'); clearTimeout(el._dt); el._dt = setTimeout(() => el.classList.remove('deny'), 800); }
  if (G.time - _denyT[kind] >= 1) { _denyT[kind] = G.time; banner(kind === 'mp' ? 'MP 不足' : 'SP 不足', kind === 'mp' ? '#8fd0ff' : '#f0c030'); }
}
// 扣資源:夠就扣並重置自然恢復的延遲計時;不夠就閃紅並回傳 false
function resUse(kind, n) {
  if ((CFG.res.infinite && !window.NETON)) return true;
  if (!resCan(kind, n)) { resDeny(kind); return false; }
  G[kind] = Math.max(0, G[kind] - n); G[kind + 'Idle'] = 0;
  return true;
}
// 集氣上限:MP 夠第二段花費(= 基準 × 1.0)→ 1;只夠第一段 → .5(進度停在第一段起點,不可進第二段)。無限資源 = 1
function chargeMpCap() {
  if ((CFG.res.infinite && !window.NETON)) return 1;
  const c = skillCost(G.skill);
  return G[c.kind] >= c.base - 1e-6 ? 1 : .5;
}
// #chargeTxt 前綴:集氣中 MP 只夠第一段時顯示
function resCapTxt() { return G.state === 'charging' && chargeMpCap() < 1 ? 'MP 不足・停在第一段' : ''; }

// 跑步判斷(每幀):SP < 1 → 上鎖走路;上鎖後 SP 回到 15 才解鎖;移動時每秒扣 runCost
function runAllowed(dt, moving) {
  if ((CFG.res.infinite && !window.NETON)) return true;
  if (G.runLock) { if (G.sp < 15) return false; G.runLock = false; }
  if (G.sp < 1) { G.runLock = true; return false; }
  if (moving) { G.sp = Math.max(0, G.sp - CFG.res.runCost * dt); G.spIdle = 0; }
  return true;
}

/* ---------- 職業能量(非法師共用 API:弓專注 / 劍鬥氣 / 刺連擊點;只有 CLASSES[cls].energy 有值的職業生效) ---------- */
// 能量表 = CLASSES[cls].energy { kind, name, max, css, seg? };法師沒有能量
function energyCfg() { return G.cls === 'mage' ? null : (CLASSES[G.cls].energy || null); }
// 獲得:夾在 0~max,回傳實際增加量;獲得即重置 crIdle(流失計時由各職業寫手實作)
function gainEnergy(n) { const E = energyCfg(); if (!E || !(n > 0)) return 0; const b = G.cr; G.cr = Math.min(E.max, G.cr + n); G.crIdle = 0; return G.cr - b; }
// 消耗:不足回傳 false(不扣);足夠就扣除並回傳 true
function spendEnergy(n) { if (!energyCfg()) return false; if (n <= 0) return true; if (G.cr < n - 1e-6) return false; G.cr = Math.max(0, G.cr - n); G.crIdle = 0; return true; }
// 劍士鬥氣來源(§2-2):造成實扣傷害 ×1.0(netShowDmg 呼叫)、受到實扣傷害 ×1.5(playerHurt 呼叫)
function crOnDealt(n) { if (G.cls === 'swordsman') gainEnergy(n); }
function crOnHurt(n) { if (G.cls === 'swordsman') gainEnergy(n * 1.5); }
// 顯示用文字(連擊點取整數)
function energyTxt() { const E = energyCfg(); if (!E) return ''; return (E.kind === 'combo' ? Math.floor(G.cr) : Math.round(G.cr)) + '/' + E.max; }
// 快捷列金框:該格招式的強化門檻 exCost 已達到(exCost 由寫手在資料列設定;未設定則不亮)
function exReady(i) { const s = curSkill(i); return !!(s && s.exCost && G.cr >= s.exCost - 1e-6); }

/* ---------- 受擊 / 倒下 / 復活 / 治癒(取代 S-6 的 hurtPlayer) ---------- */
// 無敵或倒地中忽略;先扣護盾(護盾不耗 MP);來襲一律起身;血量歸零 → playerDown()
function playerHurt(n, src) {
  if (G.down > 0 || G.invulnT > 0) return { blocked: true, dmg: 0, src };
  const o = src && typeof src === 'object' ? src : {}, net = !!o.net, dot = !!o.dot;   // src 可為 'strike' 之類字串(單人)或 {by, net, dot}(多人,§2-7)
  const uny = G.unyT > 0;   // 不屈戰意:受傷 ×0.75、HP 不低於 1、免硬直(netApplyFx 另跳過控制)
  let rest = uny ? n * .75 : n;
  if (G.shield > 0) { const a = Math.min(G.shield, rest); G.shield -= a; rest -= a; if (G.shield <= 0) { G.shield = 0; G.shieldT = 0; } }
  sitBreak('hurt');
  if (rest <= 0) { banner('護盾擋下!', '#ffd27a'); return { blocked: true, dmg: 0, src }; }
  sfx.play('hurt'); if (!dot && window.padRumble) padRumble('hit');
  G.hp = Math.max(uny ? 1 : 0, G.hp - rest);
  if (!uny && !net && !dot) { G.stun = Math.max(G.stun, .6); G.vy = 5; }   // 單人:硬直取大(原為覆寫)、往上彈;DOT 不硬直
  else if (!uny && net && !dot && G.hardImmT <= 0 && G.hitStunCd <= 0) { G.stun = Math.max(G.stun, NET_RULES.hitStun); G.hitStunCd = NET_RULES.hitStunGap; }   // 多人:硬直取大、0.5 s 內只觸發一次、韌性期間不硬直(§1-6)
  if (G.frzT > 0 && rest >= ST.freezeBreak && G.frzAge >= ST.freezeGrace) stFreezeBreak();   // 凍結碎冰(§1-2 #3)
  crOnHurt(rest);
  if (mage.play && !dot) mage.play(rest >= 15 ? 'hitBig' : 'hitSmall');   // 人偶受擊動作(只本機看得到)
  if (G.hp <= 0) playerDown(); else if (!uny) banner('致命一擊!', '#ff5050');
  return { blocked: false, dmg: rest, src };
}
// 倒下:倒地 downTime 秒不能動;計入倒下次數;取消集氣與打坐;結束翻滾
function playerDown() {
  G.hp = 0; G.down = CFG.res.downTime; G.downs++;
  G.cr = 0; G.stance = 0; G.stanceBoostT = 0;   // 倒下:能量歸零、架勢回 A
  sitBreak('down');
  if (G.roll) { G.roll = null; G.invuln = false; }
  if (G.state === 'charging') cancelCharge();
  banner('倒下', '#ff5050');
  if (window.NETON && typeof netOnDown === 'function') netOnDown();   // 多人:送 down 事件、計分、擊殺訊息(netcombat.js)
}
// 復活:原地以 reviveHP 復活;MP / SP 不變;2 s 無敵
function playerRevive() {
  G.down = 0; G.hp = Math.min(G.hpMax, CFG.res.reviveHP); G.invulnT = 2;
  banner('復活', '#bff0a0');
  if (window.NETON && typeof netRespawn === 'function') netRespawn();   // 多人:改在出生點復活、清 debuff(netcombat.js,§5-4)
}
// 治癒:倒地中不能治癒;綠字顯示實際回復量(滿血不顯示)
function playerHeal(n, src) {
  if (G.down > 0) return 0;
  if (G.poisonT > 0 && G.poisonN > 0) n *= ST.poisonHealK;   // 中毒中受到治癒 ×0.5(§1-2 #8)
  const before = G.hp; G.hp = Math.min(G.hpMax, G.hp + n);
  const d = Math.round(G.hp - before);
  if (d > 0) { G.healUntil = G.time + 1.2; const p = mage.root.position; addDmgText(new V3(p.x, p.y + 2.2, p.z), '+' + d, '#7dff8a'); }
  return d;
}

// 護盾(熾天使 / 聖域等):加上護盾量,上限 60,seconds 秒後消失
function playerShield(amount, seconds) {
  if (G.down > 0) return 0;
  const before = G.shield; G.shield = Math.min(60, G.shield + amount); G.shieldT = Math.max(G.shieldT, seconds || 8);
  return Math.round(G.shield - before);
}
// 淨化(狀態效果文件 §1-4):清除暈眩、凍結、定身、麻痺、沉默、致盲、減速、寒意、灼燒、中毒、照亮、虛弱;不清跌倒(爬起動畫照走)與擊退;
// 之後 1 s 控制免疫;原有 2 秒區域減速免疫保留。有清掉東西才回傳 true(熾天使依此播放淨化特效)
function playerCleanse() {
  let c = false;
  const hit = (cond) => { if (cond) c = true; };
  hit(G.stun > 0 || G.hardT > 0 || G.paraT > 0 || G.silT > 0 || G.rootT > 0 || G.frzT > 0 || G.blindT > 0 || G.slowT > 0 || G.chill > 0 || G.burnT > 0 || G.poisonT > 0 || G.litT > 0 || G.weak > 0);
  G.stun = Math.min(G.stun, G.fallT || 0);   // 跌倒保留,其餘硬直 / 暈眩 / 凍結 / 麻痺抽搐清掉
  G.hardT = Math.min(G.hardT, G.fallT || 0);
  G.frzT = 0; G.frzAge = 0; G.paraT = 0; G.paraJolt = 0; G.paraNext = 0; G.silT = 0; G.rootT = 0;
  G.blindT = 0; G.slowT = 0; G.slowPct = 0; G.chill = 0; G.chillT = 0; G.burnT = 0; G.poisonT = 0; G.poisonN = 0; G.litT = 0; G.weak = 0;
  G.ccImmT = Math.max(G.ccImmT, ST.cleanseImm);
  if (typeof zoneSlowAt === 'function') { const p = mage.root.position; if (zoneSlowAt(p.x, p.z, p.y, NET_ME).pct > 0) { G.slowImmT = 2; c = true; } }
  return c;
}

/* ---------- 打坐 ---------- */
// 能坐下的條件(文件 3-2)
function canSit() {
  return G.state === 'ready' && G.ground && !G.roll && G.stun <= 0 && G.down <= 0 && !G.dash && !G.spin && !G.whirlRun && moveInput().s === 0;
}
// 起身(sitK 由 resTick 收回,起身約 0.3 s);reason 為觸發來源,目前只作紀錄用途
function sitBreak(reason) { G.sitting = false; }
function toggleSit() {
  if (G.sitting) { sitBreak('toggle'); return; }
  if (!canSit()) { banner('現在不能打坐', '#ffc46b'); return; }
  G.sitting = true; burstRing(mage.root.position, auraEl().hex, 1.4);
}
// 恢復倍率(熾天使在身邊 ×1.25 屬 R-6,尚未實作,此處只預留)
function resRegenK() { return 1; }

let _sitAcc = 0, _sitGlow = null, _sitGlowHex = -1, _invFx = false;
// 打坐氣場:往胸口聚集的粒子 + 胸口光點
function sitFx(dt) {
  const p = mage.root.position, E = auraEl(), rate = (IS_TOUCH ? 10 : 20) * G.sitK;
  _sitAcc += dt * rate;
  while (_sitAcc >= 1) {
    _sitAcc -= 1;
    const a = Math.random() * 6.2832, r = rnd(1.6, 2.2), x = p.x + Math.cos(a) * r, y = p.y + rnd(.2, 1.8), z = p.z + Math.sin(a) * r;
    const vx = (p.x - x) / .8, vy = (p.y + .9 - y) / .8, vz = (p.z - z) / .8, size = rnd(.1, .18);
    if (E.dark) smoke.emit(x, y, z, vx, vy, vz, .8, size * 2, E.c0, E.c1, .5, 1, 0, 0);
    else fire.emit(x, y, z, vx, vy, vz, .8, size, E.c0, E.c1, .6, 1, 0, 0);
  }
  if (!_sitGlow) { _sitGlow = glowSprite(E.hex, .9, .5); scene.add(_sitGlow); }
  if (_sitGlowHex !== E.hex) { _sitGlowHex = E.hex; _sitGlow.material.color.setHex(E.hex); }
  _sitGlow.visible = true; _sitGlow.position.set(p.x, p.y + .9, p.z);
  _sitGlow.material.opacity = (.35 + .15 * Math.sin(G.time * 2)) * Math.min(1, G.sitK * 2);
}
// #chargeBox 借用顯示打坐恢復速度(集氣中不顯示)
function resSitTxt() {
  if (G.state === 'charging' || G.sitK <= .02) return '';
  return '打坐中 ・ ' + (G.cls === 'mage' ? 'MP +' + Math.round(CFG.res.mpRegen * CFG.res.sitMp) + '/s ・ ' : '') + 'SP +' + Math.round(CFG.res.spRegen * CFG.res.sitSp) + '/s';
}

/* ---------- 每幀:倒下 / 無敵計時、打坐進度、自然與打坐恢復 ---------- */
function resTick(dt) {
  const R = CFG.res;
  if (G.invulnT > 0) G.invulnT = Math.max(0, G.invulnT - dt);
  if (G.down > 0) { G.down = Math.max(0, G.down - dt); if (G.down <= 0) playerRevive(); }
  G.downK = damp(G.downK, G.down > 0 || G.fallT > 0 ? 1 : 0, 6, dt);   // 倒地 / 跌倒動畫值(跌倒 = fallT,狀態效果文件 §1-2 #2)
  if (G.invulnT > 0) { mage.setOpacity(.5 + .5 * Math.sin(G.time * 20)); _invFx = true; }   // 復活無敵:角色閃爍
  else if (_invFx) { _invFx = false; mage.setOpacity(mage.opq); }
  G.sitK = clamp(G.sitK + (G.sitting && G.down <= 0 ? dt / .5 : -dt / .3), 0, 1);
  if (R.infinite && !window.NETON) { G.mp = G.mpMax; G.sp = G.spMax; }
  else {
    const full = G.sitting && G.sitK >= 1, k = resRegenK();   // 坐好才算打坐:倍率生效、不受延遲限制
    G.mpIdle += dt; G.spIdle += dt;
    if (full || G.mpIdle >= R.mpDelay) G.mp = Math.min(G.mpMax, G.mp + R.mpRegen * (full ? R.sitMp : 1) * k * dt);
    if (full || G.spIdle >= R.spDelay) G.sp = Math.min(G.spMax, G.sp + R.spRegen * (full ? R.sitSp : 1) * k * dt);
  }
  if (G.sitK > .02) sitFx(dt); else if (_sitGlow) _sitGlow.visible = false;
}

/* ---------- HUD:只在整數值 / 狀態變動時寫 DOM;填充用 transform ---------- */
const RH = {};
const rhEl = id => RH[id] || (RH[id] = document.getElementById(id));
function tog(el, name, on) { const k = '_c' + name; if (el[k] === on) return; el[k] = on; el.classList.toggle(name, on); }
// 數字文字每 100 ms 最多寫一次(清空字串立即寫)
function setTxt(el, s) { if (!el || el._tx === s) return; if (s !== '' && G.time - (el._tt || -9) < .1) return; el._tx = s; el._tt = G.time; el.textContent = s; }
// 一條資源條:cur 四捨五入後的整數變動才改填充;低於 20% 脈動;off = 非法師 MP 灰掉
function resBar(id, cur, max, off, txt, noLow) {
  const el = rhEl(id), k = Math.round(cur);
  if (el._v !== k) { el._v = k; rhEl(id + 'fg').style.transform = 'scaleX(' + clamp(cur / max, 0, 1) + ')'; }
  tog(el, 'low', !off && !noLow && cur / max < .2);
  tog(el, 'off', off);
  setTxt(rhEl(id + 'n'), txt);
}
// 目前狀態圖示列(緩速、暈眩、虛弱、潛行、倒地):只在組合改變時才寫 DOM
const ST_NAME = { slow: '緩速', stun: '暈眩', weak: '虛弱', stealth: '潛行', down: '倒地', shield: '護盾', heal: '治癒', root: '定身', lit: '照亮', unyield: '不屈',
  freeze: '凍結', knock: '跌倒', para: '麻痺', silence: '沉默', burn: '灼燒', poison: '中毒', chill: '寒意', blind: '致盲', ccimm: '控制免疫' };
const ST_ICON = { slow: 'st_slow', stun: 'st_stun', weak: 'st_weak', stealth: 'st_stealth', down: 'st_down', shield: 'buff_shield', heal: 'buff_heal', root: 'st_root', lit: 'st_lit', unyield: 'buff_unyield',
  freeze: 'st_freeze', knock: 'st_down', para: 'st_paralysis', silence: 'st_silence', burn: 'st_burn', poison: 'st_poison', chill: 'st_slow', blind: 'st_blind', ccimm: 'st_cleanse' };   // 缺圖時 onerror 退回文字,不報錯
const ST_ICON_BAD = {};   // 已確認缺圖的 ST_ICON 名稱(onerror 寫入)之後直接畫文字,不再重複發請求
function updateStatusBar() {
  const sb = rhEl('stBar'); if (!sb) return;
  // 排序(狀態效果文件 §3-6):控制 → DOT → 減益 → 增益;寒意 / 中毒的層數併入鍵(層數變動時重建)
  const ks = [], p = mage.root.position;
  if (G.down > 0) ks.push('down');
  if (G.frzT > 0) ks.push('freeze');
  if (G.stun > 0 && G.frzT <= 0) ks.push('stun');
  if (G.fallT > 0) ks.push('knock');
  if (G.paraT > 0) ks.push('para');
  if (G.silT > 0) ks.push('silence');
  if (G.rootT > 0) ks.push('root');
  if (G.burnT > 0) ks.push('burn');
  if (G.poisonT > 0 && G.poisonN > 0) ks.push('poison' + G.poisonN);
  if (G.blindT > 0) ks.push('blind');
  if (G.slowT > 0 || (typeof zoneSlowAt === 'function' && CFG.slowSelf && !(G.slowImmT > 0) && zoneSlowAt(p.x, p.z, p.y, NET_ME).pct > 0)) ks.push('slow');
  if (G.chill >= 1) ks.push('chill' + G.chill);
  if (G.litT > 0) ks.push('lit');
  if (G.weak > 0) ks.push('weak');
  if (G.shield > 0) ks.push('shield');
  if (G.time < (G.healUntil || 0)) ks.push('heal');
  if (G.unyT > 0) ks.push('unyield');
  if (G.stealth) ks.push('stealth');
  if (G.ccImmT > 0 || G.hardImmT > 0) ks.push('ccimm');
  const k = ks.join(',');
  if (sb._k === k) return; sb._k = k;
  // 每格一個 span:寒意 / 中毒的層數放 data-n(右下角角標由 index.html 的 CSS 畫);缺圖(ST_ICON_BAD)直接畫文字
  sb.innerHTML = ks.map(x => {
    const b = x.replace(/\d$/, ''), n = x.slice(b.length), nm = ST_NAME[b], ic = ST_ICON[b];
    const attr = 'class="sti s-' + b + '"' + (n ? ' data-n="' + n + '"' : '');
    if (ST_ICON_BAD[ic]) return '<span ' + attr + '>' + nm + '</span>';
    return '<span ' + attr + '><img src="assets/icons/' + ic + '.png" alt="' + nm + '" title="' + nm + '" data-ic="' + ic + '" onerror="ST_ICON_BAD[this.dataset.ic]=1;this.replaceWith(document.createTextNode(this.alt))"></span>';
  }).join('');
}

function updateResHUD() {
  const isMage = G.cls === 'mage', E = auraEl();
  const hpk = Math.round(G.hp), shk = Math.round(G.shield), sh = rhEl('pShield');
  resBar('pHP', G.hp, G.hpMax, false, hpk + '/' + G.hpMax + (shk > 0 ? ' +' + shk : ''));
  if (sh._v !== hpk * 1000 + shk) {   // 護盾疊在 HP 右端之後
    sh._v = hpk * 1000 + shk;
    const f = clamp(hpk / G.hpMax, 0, 1), s = clamp(shk / G.hpMax, 0, 1 - f);
    sh.style.transform = 'translateX(' + f * 100 + '%) scaleX(' + s + ')';
  }
  const EN = isMage ? null : CLASSES[G.cls].energy, enRow = rhEl('pENrr');
  resBar('pMP', G.mp, G.mpMax, false, Math.round(G.mp) + '/' + G.mpMax);   // 所有職業:MP 條(戰技 / 法術共用)
  if (enRow) {   // 非法師:職業能量(專注 / 鬥氣 / 連擊點)另開一條
    enRow.style.display = EN ? '' : 'none';
    if (EN) {
      resBar('pEN', G.cr, EN.max, false, energyTxt(), true);
      const efg = rhEl('pENfg'), eic = rhEl('pENi'), esrc = 'assets/icons/ui_' + EN.kind + '.png';
      if (eic && eic._s !== esrc) { eic._s = esrc; eic.src = esrc; }
      if (efg._c !== EN.css) { efg._c = EN.css; efg.style.background = EN.css; }
      tog(rhEl('pEN'), 'seg5', !!EN.seg);
    }
  }
  resBar('pSP', G.sp, G.spMax, false, Math.round(G.sp) + '/' + G.spMax);
  const pr = rhEl('pRes');
  tog(pr, 'sit', G.sitting); tog(pr, 'down', G.down > 0);
  if (pr._e !== E.css0) { pr._e = E.css0; pr.style.setProperty('--sit', E.css0); }
  setTxt(rhEl('pDownTx'), G.down > 0 ? '倒下 ' + G.down.toFixed(1) : '');
  // 快捷列:資源不夠的招式變灰
  const n = skillCount();
  slots.forEach((el, i) => {
    let poor = false;
    if (i < n && !(CFG.res.infinite && !window.NETON)) { const c = skillCost(i); poor = !resCan(c.kind, costAt(c.base, 0)); }
    tog(el, 'poor', poor);
    tog(el, 'ex', i < n && !isMage && exReady(i));
  });
  // 集氣條:qCap 紅刻度;打坐時 #chargeBar 隱藏(#chargeBox 改顯示打坐數值)
  const charging = G.state === 'charging', cap = charging ? chargeMpCap() : 1, ct = rhEl('capTick');
  const showCap = charging && cap < 1;   // MP 只夠第一段:50% 處亮紅刻度
  if (ct._s !== showCap) { ct._s = showCap; ct.style.display = showCap ? '' : 'none'; }
  if (showCap && ct._v !== 50) { ct._v = 50; ct.style.left = '50%'; }
  tog(rhEl('chargeBar'), 'hide', resSitTxt() !== '');
  const bs = rhEl('btnSit');
  updateStatusBar();
  if (bs) { tog(bs, 'on', G.sitting); const bt = G.sitting ? '起身' : '打坐'; if (bs._t !== bt) { bs._t = bt; bs.title = bt; } }   // 按鈕上是打坐圖示,狀態用 .on 亮框表示
}

/* ---------- 每幀資源 HUD 之外的初始化 ---------- */
// 全滿(開局、R 重置);倒下 / 打坐 / 跑步鎖一併清除。資源值不存檔(重新整理即全滿)
function resInit() {
  G.hpMax = RES_MAX.hp; G.hp = G.hpMax; G.shield = 0; G.shieldT = 0; G.downs = 0;
  G.mpMax = RES_MAX.mp; G.spMax = RES_MAX.sp; G.mp = G.mpMax; G.sp = G.spMax; G.mpIdle = 9; G.spIdle = 9;
  G.runLock = false; G.sitting = false; G.sitK = 0; G.down = 0; G.downK = 0; G.invulnT = 0;
  G.kvx = 0; G.kvz = 0; G.slowT = 0; G.slowPct = 0; G.burnT = 0; G.erodeT = 0; G.litT = 0;
  G.cr = 0; G.crIdle = 0; G.unyT = 0; G.parryT = 0; G.ccLog = [];   // 能量、不屈 / 格擋計時、多人控制紀錄
  if (typeof stClear === 'function') stClear();   // 狀態效果(status.js);載入時 status.js 尚未載入,由它自己的 stClear 初始化
}
resInit();
