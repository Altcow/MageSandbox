'use strict';
// 職業框架(任務 D1 + D2~D4):職業資料表、切換(K 鍵 / #clsBar / 手把 − 短按)、集氣氣場、冷卻 HUD、
// 方向型瞄準(line / front / self / none)、每幀職業狀態(classTick:位移、旋轉、潛行、氣場)
// 招式實作在 skills.js;本檔只放資料表與框架
// 載入順序:game.js → spells.js → skills.js → classes.js → touch.js。本檔最後呼叫 startLoop() 才開始主迴圈

const rgbOf = h => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
// 法師招式 = SKILLS[i] 合併目前屬性的 aim / line(依屬性快取;切屬性時自然換一張)
const MAGE_SK = {};
function mageSkill(i) {
  if (!SKILLS[i]) return SKILLS[i];
  const el = G.el, row = MAGE_SK[el] || (MAGE_SK[el] = []);
  if (!row[i]) { const sp = SPELLS[el][i] || {}; row[i] = Object.assign({}, SKILLS[i], { aim: sp.aim || SKILLS[i].aim, line: sp.line }); }
  return row[i];
}
// 非法師快捷列:第 i 格 = 目前架勢 bars[stance][i] 指向的扁平 skills 索引(第 4 格絕技兩架勢共用);法師 = 格位本身
const stanceOf = () => { const C = CLASSES[G.cls]; return C.stances ? C.stances[G.stance | 0] : null; };
const skillIx = i => G.cls === 'mage' ? i : ((CLASSES[G.cls].bars || [])[G.stance | 0] || [])[i];   // 扁平索引(事件 ix / netSkill 用)
const curSkill = i => G.cls === 'mage' ? mageSkill(i) : CLASSES[G.cls].skills[skillIx(i)];
const skillCount = () => G.cls === 'mage' ? SKILLS.length : 4;   // 法師 4 格;其他職業 4 格(第 4 格 = 絕技)
const baseOf = i => curSkill(i).base || curSkill(i).id;
const spellOf = i => G.cls === 'mage' ? SPELLS[G.el][i] : curSkill(i);   // 名稱/圖示/咒語/喊招:法師依目前屬性,其他職業用目前架勢的招式   // 法師招式沒有 base,直接用 id(fireball / firewall / meteor)
const moveCharge = () => { const st = stanceOf(); return st ? !!st.mwc : !!CLASSES[G.cls].moveWhileCharging; };   // 集氣中可移動(依目前架勢;無架勢者用 moveWhileCharging)
// 架勢移速倍率(classTick 乘入 G.spdK):spdK 常駐;chgSpdK 只在集氣中
const stanceK = () => { const st = stanceOf(); if (!st) return 1; return st.spdK * (G.state === 'charging' ? st.chgSpdK : 1); };

// 職業招式:base = CFG.skills 的鍵(沿用 id);aim:'circle' 落點圓 | 'wall' 落點矩形 | 'line' 從角色往瞄準方向的矩形 |
// 'front' 角色前方固定圓心 | 'self' 以角色為中心的圓 | 'none' 不顯示光圈
function mkSkill(id, name, icon, o) {
  return Object.assign({ id, base: id, name, icon, shape: 'circle', kind: 'bolt', aim: 'circle', cd: 0, chant: '', shout: '', cast: null, preview: null, img: null, instant: false, stub: false }, o);
}

const CLASSES = {
  mage: { name: '法師', icon: '🧙', robe: 0x3a3f9c, weapons: ['staff', 'book'], wpn: '法杖', elements: true, moveWhileCharging: false, skills: null, aura: null, img: null },
  archer: { name: '弓箭手', icon: '🏹', robe: 0x2f5a2a, weapons: ['bow'], wpn: '弓', elements: false, moveWhileCharging: false, img: null,
    skills: [
      mkSkill('quickShot', '瞄準射擊', '🎯', { img: 'assets/icons/quick_shot.png', chant: '箭已搭弦……', shout: '瞄準射擊!', cast: castQuickShot, preview: q => '箭速 ' + Math.round(lerp(45, 70, q)) + ' m/s' }),
      mkSkill('shockArrow', '衝擊巨箭', '🏹', { img: 'assets/icons/archer_wave.png', aim: 'line', chant: '拉滿弓弦……', shout: '衝擊巨箭!', cast: castShockArrow, preview: q => '跌倒 ' + (1.8 * CHG.fx(q)).toFixed(1) + ' s' }),
      mkSkill('arrowRain', '箭雨', '🌧️', { img: 'assets/icons/archer_rain.png', kind: 'sky', chant: '箭矢升空……', shout: '箭雨!', cast: castArrowRain, preview: q => '箭 ' + CHG.count(40, q) + ' 支' }),
      // 游擊架勢 B 列與絕技(S 批空殼,寫手 A 實作後移除 stub: true;定義在 skills_archer.js)
      mkSkill('scatter', '散射', '🎇', { stub: true, aim: 'line', line: (q, rs) => { const L = CFG.skills.scatter.range; return { len: L, hw: L * Math.sin(rs * CHG.size(q) * Math.PI / 360), off: .6, maxLen: L, maxHw: L * Math.sin(rs * Math.PI / 360) }; }, chant: '箭矢扇開……', shout: '散射!', cast: castScatter }),
      mkSkill('disengage', '後躍射擊', '🦘', { stub: true, instant: true, aim: 'none', cd: 7, chant: '', shout: '後躍射擊!', cast: castDisengage }),
      mkSkill('snare', '捕獸夾', '🪤', { stub: true, aim: 'circle', cd: 4, chant: '機關就位……', shout: '捕獸夾!', cast: castSnare }),
      mkSkill('flare', '照明信號箭', '🎆', { stub: true, aim: 'circle', cd: 15, chant: '信號升空……', shout: '照明信號箭!', cast: castFlare })],
    stances: [{ name: '鷹眼', icon: '🦅', mwc: false, spdK: 1, chgSpdK: 1 }, { name: '游擊', icon: '🍃', mwc: true, spdK: 1, chgSpdK: .6 }],   // 第 1 架勢 = 現有招式;第 2 架勢集氣中可移動、移速 ×0.6
    bars: [[0, 1, 2, 6], [3, 4, 5, 6]],   // 快捷列第 1~4 格對應的扁平索引(第 4 格 = 絕技,兩架勢共用)
    energy: { kind: 'focus', name: '專注', max: 100, css: '#b8e03a' },
    aura: { hex: 0xb8e03a, main: 0xb8e03a, sub: 0xf0ff8a, dark: false } },
  swordsman: { name: '劍士', icon: '⚔️', robe: 0x7a2a22, weapons: ['swordShield'], wpn: '劍與盾', elements: false, moveWhileCharging: true, img: null,
    skills: [
      mkSkill('powerSlash', '蓄力斬', '⚔️', { img: 'assets/icons/power_slash.png', aim: 'front', chant: '劍氣凝聚……', shout: '蓄力斬!', cast: castPowerSlash, preview: q => '擊退 ' + (1.5 * CHG.fx(q)).toFixed(1) + ' m' }),
      mkSkill('whirlwind', '旋風斬', '🌀', { img: 'assets/icons/whirlwind.png', aim: 'self', netFx: 'spin', chant: '旋身……', shout: '旋風斬!', cast: castWhirlwind, preview: q => '次數 ' + Math.max(2, Math.round(lerp(.6, 1.8, q) / .3)) }),
      mkSkill('shieldCharge', '衝鋒盾', '🛡️', { img: 'assets/icons/shield_charge.png', aim: 'line', cd: 3, netFx: 'dash', chant: '盾牌在前……', shout: '衝鋒盾!', cast: castShieldCharge, preview: q => '暈眩 ' + (2.5 * CHG.fx(q)).toFixed(1) + ' s' }),
      // 盾勢 B 列與絕技(S 批空殼,寫手 B 實作;定義在 skills_sword.js)
      mkSkill('parry', '格擋反擊', '🛡️', { stub: true, instant: true, aim: 'front', cd: 6, chant: '', shout: '格擋反擊!', cast: castParry }),
      mkSkill('slam', '震地', '💥', { stub: true, aim: 'self', cd: 6, chant: '重心下沉……', shout: '震地!', cast: castSlam }),
      mkSkill('leap', '躍擊', '⤴️', { stub: true, aim: 'circle', cd: 8, chant: '蹬地躍起……', shout: '躍擊!', cast: castLeap }),
      mkSkill('unyield', '不屈戰意', '🔥', { stub: true, instant: true, aim: 'none', cd: 20, chant: '', shout: '不屈戰意!', cast: castUnyield })],
    stances: [{ name: '劍勢', icon: '⚔️', mwc: true, spdK: 1, chgSpdK: 1 }, { name: '盾勢', icon: '🧱', mwc: true, spdK: .85, chgSpdK: 1 }],
    bars: [[0, 1, 2, 6], [3, 4, 5, 6]],
    energy: { kind: 'rage', name: '鬥氣', max: 100, css: '#ff3a3a' },
    aura: { hex: 0xff3a3a, main: 0xff3a3a, sub: 0xa01010, dark: false } },
  assassin: { name: '刺客', icon: '🗡️', robe: 0x2a2233, weapons: ['daggers'], wpn: '雙匕首', elements: false, moveWhileCharging: true, img: null,
    skills: [
      mkSkill('backstab', '背刺', '🗡️', { img: 'assets/icons/backstab.png', cd: 1, netFx: 'blink', chant: '身影一閃……', shout: '背刺!', cast: castBackstab, preview: q => '背後 ×' + lerp(2.5, 3.5, q).toFixed(1) }),
      mkSkill('knives', '飛刀', '🔪', { img: 'assets/icons/knives.png', aim: 'line', chant: '扇形展開……', shout: '飛刀!', cast: castKnives, preview: q => '飛刀 ' + CHG.count(7, q) + ' 把' }),
      mkSkill('stealth', '潛行', '👤', { img: 'assets/icons/stealth.png', aim: 'none', cd: 6, netFx: 'stealth', kind: 'bolt', chant: '隱入暗影……', shout: '潛行!', cast: castStealth, preview: q => '潛行 ' + (10 * CHG.fx(q)).toFixed(1) + ' s' }),
      // 影舞 B 列與絕技(S 批空殼,寫手 C 實作;定義在 skills_assassin.js)
      mkSkill('shadowStep', '暗影步', '👣', { stub: true, aim: 'circle', cd: 8, chant: '身影溶入暗影……', shout: '暗影步!', cast: castShadowStep }),
      mkSkill('smoke', '煙霧彈', '💨', { stub: true, aim: 'circle', cd: 14, chant: '煙霧在掌心凝聚……', shout: '煙霧彈!', cast: castSmoke }),
      mkSkill('eviscerate', '割喉', '🩸', { stub: true, aim: 'front', cd: 3, chant: '刀刃貼近……', shout: '割喉!', cast: castEviscerate }),
      mkSkill('decoy', '影分身', '👥', { stub: true, instant: true, aim: 'none', cd: 18, chant: '', shout: '影分身!', cast: castDecoy })],
    stances: [{ name: '暗殺', icon: '🗡️', mwc: true, spdK: 1, chgSpdK: 1 }, { name: '影舞', icon: '🌀', mwc: true, spdK: 1, chgSpdK: 1 }],
    bars: [[0, 1, 2, 6], [3, 4, 5, 6]],
    energy: { kind: 'combo', name: '連擊點', max: 5, css: '#9a40ff', seg: 5 },
    aura: { hex: 0x9a40ff, main: 0x3a1a5a, sub: 0x9a40ff, dark: true } }
};
const CLASS_ORDER = ['mage', 'archer', 'swordsman', 'assassin'];

/* ---------- 氣場色(形狀同 fx.js 的 EL:hex / core / c0 / c1) ---------- */
const _aeCache = {};
// 法師用目前屬性的 EL 表;其他職業用自己的氣場色(欄位形狀與 EL 相同:hex / core / c0 / c1 / css0 / css1 / name)
const cssOf = h => '#' + h.toString(16).padStart(6, '0');
// 指定職業 / 屬性的氣場(不依賴 G;遠端重現用)
function auraOf(cls, el) {
  if (cls === 'mage') return EL[el];
  return _aeCache[cls] || (_aeCache[cls] = (() => { const a = CLASSES[cls].aura; return { name: CLASSES[cls].name, hex: a.hex, core: a.sub, c0: rgbOf(a.main), c1: rgbOf(a.sub), s0: rgbOf(a.main), s1: rgbOf(a.sub), css0: cssOf(a.hex), css1: cssOf(a.sub), dark: a.dark }; })());
}
function auraEl() { return auraOf(G.cls, G.el); }
// 集氣氣場:環繞粒子(集氣中)、放開後收束到武器尖端;同時存在的粒子桌機 ≤150、手機 ≤60
const AURA = { acc: 0, gather: 0, full: false };
function auraTick(dt) {
  const AE = auraEl(), p = mage.root.position, q = G.charge, B = IS_TOUCH ? 60 : 150;
  AURA.acc += B * (.3 + .7 * q) / .6 * dt;   // 存活數 ≈ 發射率 × 壽命(0.6 s):0% 約 30% 預算,100% 滿預算
  while (AURA.acc >= 1) {
    AURA.acc -= 1;
    const a = Math.random() * 6.2832, r = rnd(.8, 1.3), w = (1.2 + 2.2 * q) * rnd(.8, 1.2) * r;   // w = 切線速度(m/s)
    const x = p.x + Math.cos(a) * r, y = p.y + rnd(.2, 2), z = p.z + Math.sin(a) * r;
    const vx = -Math.sin(a) * w, vy = rnd(-.25, .25), vz = Math.cos(a) * w, size = rnd(.12, .2) * (.7 + .6 * q);
    if (AE.dark) {   // 黑色在加亮混合下看不見:主體用一般混合的煙,亮紫點綴才用加亮
      smoke.emit(x, y, z, vx, vy, vz, .6, size * 3, AE.c0, AE.c1, .5, 1, 0, .3);
      if (Math.random() < .15 + .35 * q) fire.emit(x, y, z, vx, vy, vz, .5, size * .8, AE.c1, AE.c1, .6 + .4 * q, 1, 0, .3);
    } else fire.emit(x, y, z, vx, vy, vz, .6, size, AE.c0, AE.c1, .5 + .5 * q, 1, 0, .3);
  }
}
function auraGather() { AURA.gather = .25; }   // 放開施放 / 集氣滿時呼叫:環繞粒子在 0.25 s 內飛向武器尖端
function auraGatherTick(dt) {
  if (AURA.gather <= 0) return;
  AURA.gather -= dt;
  const rem = Math.max(.08, AURA.gather), AE = auraEl(), p = mage.root.position, T = mage.tipWorld(new V3());
  for (let i = 0; i < (IS_TOUCH ? 1 : 2); i++) {
    const a = Math.random() * 6.2832, r = rnd(.8, 1.3), x = p.x + Math.cos(a) * r, y = p.y + rnd(.2, 2), z = p.z + Math.sin(a) * r;
    fire.emit(x, y, z, (T.x - x) / rem, (T.y - y) / rem, (T.z - z) / rem, rem, rnd(.1, .16), AE.c0, AE.c1, .9, .4);
  }
}
// 不能蓄力的狀態(衝鋒盾衝鋒中、潛行中):身體周圍少量同色粒子(粒子預算與集氣相同,見上)
let _sparkAcc = 0;
function auraSpark(dt, p, E) {
  _sparkAcc += dt * (IS_TOUCH ? 10 : 16);
  while (_sparkAcc >= 1) {
    _sparkAcc -= 1;
    const a = Math.random() * 6.2832, r = rnd(.5, .9), x = p.x + Math.cos(a) * r, y = p.y + rnd(.3, 1.8), z = p.z + Math.sin(a) * r;
    if (E.dark) smoke.emit(x, y, z, 0, rnd(.2, .5), 0, .7, rnd(.2, .35), E.c0, E.c1, .5, 1, 0, .3);
    else fire.emit(x, y, z, rnd(-.2, .2), rnd(.3, .8), rnd(-.2, .2), .5, rnd(.1, .15), E.c0, E.c1, .6, 1, 0, .3);
  }
}

/* ---------- 方向型瞄準(D2~D4 的 line / front / self / none) ---------- */
// 矩形光圈的幾何:line 型從角色前方 off 起、沿瞄準方向 len 長、半寬 hw
function lineShape(sk, q, rs) {
  if (sk.line) return sk.line(q, rs, curMode());   // 法師的線型招式(水龍彈 / 風刃切割)自帶尺寸表
  const cfg = CFG.skills[sk.id], sz = CHG.size(q, curMode());
  if (sk.id === 'knives') { const len = cfg.range, hw = len * Math.sin(rs * sz * Math.PI / 360); return { len, hw, off: .6, maxLen: len, maxHw: len * Math.sin(rs * Math.PI / 360) }; }
  if (sk.id === 'shieldCharge') return { len: rs * sz, hw: cfg.width / 2, off: 0, maxLen: rs, maxHw: cfg.width / 2 };
  return { len: rs * sz, hw: lerp(cfg.width0, cfg.width1, q) / 2, off: .8, maxLen: rs, maxHw: cfg.width1 / 2 };   // shockArrow
}
// 回傳 true 表示已處理光圈(updateAim 直接 return);circle / wall 回傳 false 走原本的路徑
function aimSpecial(sk, p, charging, q, rs, alpha, E) {
  const a = sk.aim;
  if (!a || a === 'circle' || a === 'wall') return false;
  const cfg = CFG.skills[sk.id], prog = charging ? q : 0, th = Math.atan2(G.target.x - p.x, G.target.z - p.z);
  if (a === 'dir') { ind.hide(); hideIndPool(); return true; }   // 第 1 招:方向型,不畫任何光圈 / 線 / 落點
  if (a === 'none') { ind.hide(); return true; }
  if (a === 'self') { ind.setMax(rs, 0, 0); ind.set(p.x, p.z, 0, rs * CHG.size(q, curMode()), 0, 0, prog, alpha, E.hex, surfaceY(p.x, p.z, p.y + .5)); return true; }
  if (a === 'front') {
    const cx = p.x + Math.sin(th) * cfg.range, cz = p.z + Math.cos(th) * cfg.range;
    ind.setMax(rs, 0, 0); ind.set(cx, cz, 0, rs * CHG.size(q, curMode()), 0, 0, prog, alpha, E.hex, surfaceY(cx, cz, p.y + 2)); return true;
  }
  // line:矩形(本地 x 軸 = 瞄準方向,yaw = θ − π/2)
  const L = lineShape(sk, q, rs), cx = p.x + Math.sin(th) * (L.off + L.len / 2), cz = p.z + Math.cos(th) * (L.off + L.len / 2);
  ind.setMax(0, L.maxLen / 2, L.maxHw);
  ind.set(cx, cz, 1, L.len / 2, L.hw, th - Math.PI / 2, prog, alpha, E.hex, surfaceY(cx, cz, p.y + 2));
  return true;
}

/* ---------- 冷卻 / 狀態查詢(game.js 與 touch.js 使用) ---------- */
// 不能開始的招式:潛行(虛弱中、照亮中不能進入潛行;潛行中再次施放 = 手動顯形,不在此擋);不屈戰意(鬥氣 < 50 不能開始)
function skillBlocked(s) { if (s.id === 'stealth') return G.weak > 0 || (G.litT > 0 && !G.stealth); return s.id === 'unyield' && G.cr < 50; }
// 架勢切換(非法師;Tab / 手把 X / 手機換裝鈕):只在 ready 生效,冷卻 0.8 s;切換後 1.5 s 內第一招集氣加速(chargeTimeEff 讀 stanceBoostT)
function toggleStance() {
  const C = CLASSES[G.cls];
  if (G.cls === 'mage' || !C.stances || G.state !== 'ready' || G.stanceCd > 0) return;
  G.stance = (G.stance + 1) % C.stances.length; G.stanceCd = .8; G.stanceBoostT = 1.5;
  refreshHotbar();
  const E = auraEl(), st = C.stances[G.stance];
  burstRing(mage.root.position, E.hex, 1.2);
  banner(st.name + '架勢', E.css0);
}
// 十字右(手把):目前架勢快捷列前 3 格中第一個瞬發招的格位;沒有回傳 -1
function instantSlot() { for (let i = 0; i < 3; i++) { const s = curSkill(i); if (s && s.instant) return i; } return -1; }
// 衝鋒盾中或剛結束 0.1 s 內:盾擋來襲測試(不暈眩、不擊飛,不是無敵)
function shieldOn() { return !!(G.dash && G.dash.kind === 'charge') || G.time - (G.dashEndT || -9) < .1; }
// #info 額外行:潛行剩餘 / 虛弱剩餘
function classInfo() {
  let s = '';
  if (G.stealth) s += '<br>潛行 ' + Math.max(0, G.stealth.left).toFixed(1) + ' s';
  if (G.cls !== 'mage') s += '<br>架勢 ' + CLASSES[G.cls].stances[G.stance | 0].name + ' ・ ' + CLASSES[G.cls].energy.name + ' ' + energyTxt();
  if (G.weak > 0) s += '<br>虛弱 ' + G.weak.toFixed(1) + ' s';
  return s;
}

/* ---------- 快捷列與冷卻 ---------- */
function refreshHotbar() {
  slots.forEach((el, i) => {
    const n = skillCount(), s = spellOf(i);
    el.style.display = i < n ? '' : 'none';   // 非法師隱藏第 4 格
    el.querySelector('b').textContent = i < 3 ? String(i + 1) : '~';   // 第 4 格(召喚)鍵位 ~
    if (i >= n) return;
    el.querySelector('.ic').innerHTML = s.img ? '<img src="' + s.img + '" alt="' + s.icon + '" style="width:34px;height:34px" onerror="this.replaceWith(document.createTextNode(this.alt))">' : s.icon;
    el.querySelector('.nm').textContent = s.name;
  });
}
function updateCdHUD() {
  slots.forEach((el, i) => {
    if (i >= skillCount()) return;
    const s = curSkill(i), st = s.id === 'stealth' && G.stealth ? G.stealth : null;   // 潛行中格子顯示剩餘潛行時間
    const tot = st ? st.dur : s.cd, left = st ? Math.max(0, st.left) : (tot ? (G.cd[s.id] || 0) : 0);
    if (!el._cm) { el._cm = el.querySelector('.cdmask'); el._ct = el.querySelector('.cdt'); }
    el._cm.style.height = tot ? (100 * left / tot) + '%' : '0';
    const tx = left > 0 ? left.toFixed(1) : ''; if (el._ct.textContent !== tx) el._ct.textContent = tx;
  });
}

/* ---------- 每幀職業狀態(game.js frame 在 updatePlayer 之前呼叫) ---------- */
let _sfx = '', _opWas = false;
function classTick(dt) {
  const p = mage.root.position, E = auraEl();
  if (G.weak > 0) G.weak = Math.max(0, G.weak - dt);
  if (G.stanceCd > 0) G.stanceCd = Math.max(0, G.stanceCd - dt);
  if (G.stanceBoostT > 0) G.stanceBoostT = Math.max(0, G.stanceBoostT - dt);
  if (G.parryT > 0) G.parryT = Math.max(0, G.parryT - dt);
  if (G.unyT > 0) G.unyT = Math.max(0, G.unyT - dt);
  if (G.litT > 0) G.litT = Math.max(0, G.litT - dt);   // 照亮計時(單人與多人都跑;原在 netPlayerTick)
  if (G.stealth) { G.stealth.left -= dt; if (G.stealth.left <= 0) revealStealth('time'); }
  if (G.dash) dashTick(dt, p);
  if (G.spin) spinTick(dt, p);
  G.spdK = (G.spin ? .5 : 1) * (G.stealth ? 1.3 : 1) * (G.weak > 0 ? .7 : 1) * (CFG.slowSelf && !(G.slowImmT > 0) ? 1 - zoneSlowAt(p.x, p.z, p.y, window.NETON ? NET_ME : undefined).pct : 1) * (G.slowT > 0 ? 1 - G.slowPct : 1) * stanceK();   // 區域減速(風場 / 坑洞),淨化後 slowImmT 內免疫   // 旋轉 ×0.5、潛行 ×1.3、虛弱 ×0.7
  if (G.state !== 'charging') AURA.full = false;
  else if (G.charge >= 1 && !AURA.full) { AURA.full = true; auraGather(); }   // 聚能收束:集氣滿時環繞粒子飛向武器尖端
  if (G.stealth || (G.dash && G.dash.kind === 'charge')) auraSpark(dt, p, E);
  mage.shieldUp = damp(mage.shieldUp, G.dash && G.dash.kind === 'charge' ? 1 : 0, 10, dt);
  mage.opq = damp(mage.opq, G.stealth ? .3 : 1, 10, dt);
  if (mage.opq < .999 || _opWas) mage.setOpacity(mage.opq);   // 只在半透明中或剛回到不透明時寫材質
  _opWas = mage.opq < .999;
  const sf = G.stealth ? '1' : '0';
  if (sf !== _sfx) { _sfx = sf; const el = document.getElementById('stealthFx'); if (el) el.style.opacity = sf; }
}

/* ---------- 職業列 #clsBar ---------- */
function clsHex(c) { return '#' + (CLASSES[c].aura || EL.fire).hex.toString(16).padStart(6, '0'); }
function buildClsBar() {
  const bar = document.createElement('div'); bar.id = 'clsBar';
  CLASS_ORDER.forEach(c => { const b = document.createElement('button'); b.innerHTML = '<img class="ci" src="assets/icons/cls_' + c + '.png" alt="' + CLASSES[c].icon + '" onerror="this.replaceWith(document.createTextNode(this.alt))"> ' + CLASSES[c].name; b.tabIndex = -1; b.onclick = () => { setClass(c); b.blur(); }; bar.appendChild(b); });
  document.body.appendChild(bar);
}
function refreshClsBar() {
  const bar = document.getElementById('clsBar'); if (!bar) return;
  [...bar.children].forEach((b, i) => {
    const c = CLASS_ORDER[i], on = c === G.cls, hx = clsHex(c);
    b.classList.toggle('on', on); b.style.borderColor = on ? hx : ''; b.style.boxShadow = on ? '0 0 10px ' + hx : '';
  });
}
function syncElBar() { const eb = document.getElementById('elBar'); if (eb) eb.style.display = CLASSES[G.cls].elements ? '' : 'none'; syncModeUI(); }   // 屬性列只給法師(任務 C 的 #elBar)

/* ---------- 切換職業 ---------- */
function setClass(c) {
  if (window.NETON && !window.NET_PROFILE_CHANGE) return;   // 多人對戰中鎖定職業(設計 §5-6、§6-2;對戰開始時 netApplyProfile 暫開)
  if (G.state !== 'ready' || G.down > 0 || !CLASS_ORDER.includes(c) || c === G.cls) return;
  const C = CLASSES[c];
  sitBreak('class'); if (typeof clearSummons === 'function') clearSummons();
  if (G.stealth) revealStealth('class');   // 切職業顯形,不進入虛弱
  G.cls = c; try { localStorage.setItem('mageSandbox.cls', c); } catch (e) { }
  mage.setWeapon(c === 'mage' ? G.weapon : C.weapons[0]); mage.setRobeColor(C.robe); applyElColors();
  mage.setClassLook(c);
  G.skill = 0; G.lastSkill = 0; G.wallOff = 0;
  G.stance = 0; G.stanceCd = 0; G.stanceBoostT = 0; G.cr = 0;   // 換職業:架勢回 A、能量歸零
  refreshHotbar(); refreshClsBar(); syncElBar();
  banner(C.name, clsHex(c));
}
function cycleClass(d) { const i = CLASS_ORDER.indexOf(G.cls); setClass(CLASS_ORDER[(i + d + CLASS_ORDER.length) % CLASS_ORDER.length]); }
function initClass() {
  let c = 'mage';
  try { const s = localStorage.getItem('mageSandbox.cls'); if (CLASS_ORDER.includes(s)) c = s; } catch (e) { }
  G.cls = c;
  mage.setWeapon(c === 'mage' ? G.weapon : CLASSES[c].weapons[0], true); mage.setRobeColor(CLASSES[c].robe);
  mage.setClassLook(c);
  buildClsBar(); applyElColors(); refreshHotbar(); refreshClsBar(); syncElBar();
}
initClass();
startLoop();
