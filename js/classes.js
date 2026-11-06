'use strict';
// 職業框架(任務 D1):職業資料表、切換(K 鍵 / #clsBar / 手把 − 短按)、集氣氣場、冷卻 HUD
// 各職業 3 招目前是「暫時」組合:沿用火球 / 火牆 / 隕石的既有行為(base),D2~D4 再把 skill.cast 填成專屬招式
// 載入順序:game.js → classes.js → touch.js。本檔最後呼叫 startLoop() 才開始主迴圈

const rgbOf = h => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
const curSkill = i => G.cls === 'mage' ? SKILLS[i] : CLASSES[G.cls].skills[i];
const baseOf = i => curSkill(i).base || curSkill(i).id;   // 法師招式沒有 base,直接用 id(fireball / firewall / meteor)
const moveCharge = () => !!CLASSES[G.cls].moveWhileCharging;   // 集氣中可移動(劍士、刺客)

// 暫時技能:base 指定沿用哪一招既有行為;cast 留給 D2~D4(有值時 launchSpell 改呼叫它)
function phSkill(id, name, icon, base, cd, chant, shout) {
  const b = SKILLS.find(s => s.id === base);
  return { id, name, icon, base, shape: b.shape, aim: b.shape === 'wall' ? 'wall' : 'circle', cd: cd || 0, chant, shout, cast: null, img: null };
}

const CLASSES = {
  mage: { name: '法師', icon: '🧙', robe: 0x3a3f9c, weapons: ['staff', 'book'], wpn: '法杖', elements: true, moveWhileCharging: false, skills: null, aura: null, img: null },
  archer: { name: '弓箭手', icon: '🏹', robe: 0x2f5a2a, weapons: ['bow'], wpn: '弓', elements: false, moveWhileCharging: false, img: null,
    skills: [phSkill('quickShot', '瞄準射擊', '🎯', 'fireball', 0, '箭已搭弦……', '瞄準射擊!'),
      phSkill('shockArrow', '衝擊巨箭', '🏹', 'firewall', 0, '拉滿弓弦……', '衝擊巨箭!'),
      phSkill('arrowRain', '箭雨', '🌧️', 'meteor', 0, '箭矢升空……', '箭雨!')],
    aura: { hex: 0xb8e03a, main: 0xb8e03a, sub: 0xf0ff8a, dark: false } },
  swordsman: { name: '劍士', icon: '⚔️', robe: 0x7a2a22, weapons: ['swordShield'], wpn: '劍與盾', elements: false, moveWhileCharging: true, img: null,
    skills: [phSkill('powerSlash', '蓄力斬', '⚔️', 'fireball', 0, '劍氣凝聚……', '蓄力斬!'),
      phSkill('whirlwind', '旋風斬', '🌀', 'firewall', 0, '旋身……', '旋風斬!'),
      phSkill('shieldCharge', '衝鋒盾', '🛡️', 'meteor', 3, '盾牌在前……', '衝鋒盾!')],
    aura: { hex: 0xff3a3a, main: 0xff3a3a, sub: 0xa01010, dark: false } },
  assassin: { name: '刺客', icon: '🗡️', robe: 0x2a2233, weapons: ['daggers'], wpn: '雙匕首', elements: false, moveWhileCharging: true, img: null,
    skills: [phSkill('backstab', '背刺', '🗡️', 'fireball', 1, '身影一閃……', '背刺!'),
      phSkill('knives', '飛刀', '🔪', 'firewall', 0, '扇形展開……', '飛刀!'),
      phSkill('stealth', '潛行', '👤', 'meteor', 6, '隱入暗影……', '潛行!')],
    aura: { hex: 0x9a40ff, main: 0x3a1a5a, sub: 0x9a40ff, dark: true } }
};
const CLASS_ORDER = ['mage', 'archer', 'swordsman', 'assassin'];

/* ---------- 氣場色(形狀同 fx.js 的 EL:hex / core / c0 / c1) ---------- */
const _aeCache = {};
// 法師沿用 EL.fire(任務 C 會改為目前屬性的 EL 表)
function auraEl() {
  if (G.cls === 'mage') return EL.fire;
  return _aeCache[G.cls] || (_aeCache[G.cls] = (() => { const a = CLASSES[G.cls].aura; return { hex: a.hex, core: a.sub, c0: rgbOf(a.main), c1: rgbOf(a.sub), dark: a.dark }; })());
}
// 集氣氣場:環繞粒子(集氣中)、放開後收束到武器尖端;同時存在的粒子桌機 ≤150、手機 ≤60
const AURA = { acc: 0, gather: 0 };
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
function auraGather() { AURA.gather = .25; }   // 放開施放時呼叫:環繞粒子在 0.25 s 內飛向武器尖端
function auraGatherTick(dt) {
  if (AURA.gather <= 0) return;
  AURA.gather -= dt;
  const rem = Math.max(.08, AURA.gather), AE = auraEl(), p = mage.root.position, T = mage.tipWorld(new V3());
  for (let i = 0; i < (IS_TOUCH ? 1 : 2); i++) {
    const a = Math.random() * 6.2832, r = rnd(.8, 1.3), x = p.x + Math.cos(a) * r, y = p.y + rnd(.2, 2), z = p.z + Math.sin(a) * r;
    fire.emit(x, y, z, (T.x - x) / rem, (T.y - y) / rem, (T.z - z) / rem, rem, rnd(.1, .16), AE.c0, AE.c1, .9, .4);
  }
}

/* ---------- 快捷列與冷卻 ---------- */
function refreshHotbar() {
  slots.forEach((el, i) => { const s = curSkill(i); el.querySelector('.ic').textContent = s.icon; el.querySelector('.nm').textContent = s.name; });
}
function updateCdHUD() {
  slots.forEach((el, i) => {
    const s = curSkill(i), left = s.cd ? (G.cd[s.id] || 0) : 0;
    if (!el._cm) { el._cm = el.querySelector('.cdmask'); el._ct = el.querySelector('.cdt'); }
    el._cm.style.height = s.cd ? (100 * left / s.cd) + '%' : '0';
    const tx = left > 0 ? left.toFixed(1) : ''; if (el._ct.textContent !== tx) el._ct.textContent = tx;
  });
}

/* ---------- 職業列 #clsBar ---------- */
function clsHex(c) { return '#' + (CLASSES[c].aura || EL.fire).hex.toString(16).padStart(6, '0'); }
function buildClsBar() {
  const bar = document.createElement('div'); bar.id = 'clsBar';
  CLASS_ORDER.forEach(c => { const b = document.createElement('button'); b.textContent = CLASSES[c].icon + ' ' + CLASSES[c].name; b.tabIndex = -1; b.onclick = () => { setClass(c); b.blur(); }; bar.appendChild(b); });
  document.body.appendChild(bar);
}
function refreshClsBar() {
  const bar = document.getElementById('clsBar'); if (!bar) return;
  [...bar.children].forEach((b, i) => {
    const c = CLASS_ORDER[i], on = c === G.cls, hx = clsHex(c);
    b.classList.toggle('on', on); b.style.borderColor = on ? hx : ''; b.style.boxShadow = on ? '0 0 10px ' + hx : '';
  });
}
function syncElBar() { const eb = document.getElementById('elBar'); if (eb) eb.style.display = CLASSES[G.cls].elements ? '' : 'none'; }   // 屬性列只給法師(任務 C 的 #elBar)

/* ---------- 切換職業 ---------- */
function setClass(c) {
  if (G.state !== 'ready' || !CLASS_ORDER.includes(c) || c === G.cls) return;
  const C = CLASSES[c];
  G.cls = c; try { localStorage.setItem('mageSandbox.cls', c); } catch (e) { }
  mage.setWeapon(c === 'mage' ? G.weapon : C.weapons[0]); mage.setRobeColor(C.robe); mage.setElementColor(auraEl().hex);
  G.skill = 0; G.lastSkill = 0; G.wallOff = 0;
  refreshHotbar(); refreshClsBar(); syncElBar();
  banner(C.name, clsHex(c));
}
function cycleClass(d) { const i = CLASS_ORDER.indexOf(G.cls); setClass(CLASS_ORDER[(i + d + CLASS_ORDER.length) % CLASS_ORDER.length]); }
function initClass() {
  let c = 'mage';
  try { const s = localStorage.getItem('mageSandbox.cls'); if (CLASS_ORDER.includes(s)) c = s; } catch (e) { }
  G.cls = c;
  mage.setWeapon(c === 'mage' ? G.weapon : CLASSES[c].weapons[0], true); mage.setRobeColor(CLASSES[c].robe);
  buildClsBar(); refreshHotbar(); refreshClsBar(); syncElBar();
}
initClass();
startLoop();
