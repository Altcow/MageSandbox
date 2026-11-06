'use strict';
// 六屬性招式表與元素效果(C0/C1)。
// 載入順序:fx.js → mage.js → world.js → scenes.js → game.js → spells.js → touch.js。
// 本檔只在執行期被呼叫(不在載入時讀 game.js 的變數),所以 game.js 頂層不可直接使用 SPELLS / ELMOD / EL_BURST。
// C1 階段五個新屬性的招式仍借用火系三招的形狀與行為,只換顏色、數量倍率與元素狀態效果;各屬性專屬的投射 / 牆 / 大招留到 C2、C3。

// 屬性倍率(C-2):集氣時間、範圍、投射速度(speedMul 於 C2 投射實作時才使用)
const ELMOD = {
  water: { chargeMul: 1.0, rangeMul: 1.0, speedMul: 0.9 },
  fire:  { chargeMul: 1.0, rangeMul: 1.0, speedMul: 1.0 },
  wind:  { chargeMul: 0.8, rangeMul: 1.15, speedMul: 1.5 },
  earth: { chargeMul: 1.2, rangeMul: 0.85, speedMul: 0.75 },
  light: { chargeMul: 0.9, rangeMul: 1.1, speedMul: 2.0 },
  dark:  { chargeMul: 1.1, rangeMul: 1.0, speedMul: 0.8 }
};

// 招式表(C-2):每屬性三招 [投射 bolt, 牆 wall, 大招 sky](形狀順序與 SKILLS 相同)
// preview(q):集氣條文字的第三項(效果),q 為集氣比例 0~1;img 圖檔沒有就 null,退回 icon emoji
const _f = q => CHG.fx(q), _pct = q => Math.round(50 * CHG.fx(q)), _m = (n, q) => (n * CHG.fx(q)).toFixed(1);
const SPELLS = {
  water: [
    { name: '水彈術', icon: '💧', img: null, chant: '清泉之靈,凝於掌心,化為奔流之彈——', shout: '水彈術!', preview: q => '減速 ' + _pct(q) + '%' },
    { name: '水幕術', icon: '🌊', img: null, chant: '深潭之水,湧泉而起,化作阻敵之幕——', shout: '水幕術!', preview: q => '減速 ' + _pct(q) + '%' },
    { name: '間歇泉', icon: '⛲', img: null, chant: '大地之脈,沉睡之泉,聽我號令——噴湧吧!', shout: '間歇泉!', preview: q => '水柱 ' + CHG.count(10, q) + ' 道' }
  ],
  fire: [
    { name: '火球術', icon: '🔥', img: null, chant: '火之精靈,聚於我手,化為灼熱之球——燃盡一切!', shout: '火球術!', preview: q => '燃燒 ' + _m(3, q) + ' s' },
    { name: '火牆術', icon: '🧱', img: null, chant: '烈焰之壁,拔地而起,焚盡來犯之敵——', shout: '火牆術!', preview: q => '燃燒 ' + _m(3, q) + ' s' },
    { name: '隕石術', icon: '☄️', img: null, chant: '天外星辰,聽我召喚,墜落吧——毀滅之石!', shout: '隕石術!', preview: q => '燃燒 ' + _m(3, q) + ' s' }
  ],
  wind: [
    { name: '風刃術', icon: '🌀', img: null, chant: '疾風之刃,隨我意行,斬裂虛空——', shout: '風刃術!', preview: q => '擊退 ' + _m(5, q) + ' m' },
    { name: '風壁術', icon: '🍃', img: null, chant: '流轉之風,環繞成壁,拒敵於外——', shout: '風壁術!', preview: q => '推出 ' + _m(2.5, q) + ' m' },
    { name: '龍捲風', icon: '🌪️', img: null, chant: '天地之息,旋而不止,捲起萬物——', shout: '龍捲風!', preview: q => '吸引 ' + _m(4, q) + ' m/s' }
  ],
  earth: [
    { name: '岩彈術', icon: '🪨', img: null, chant: '沉眠之岩,醒於我手,化為重擊之石——', shout: '岩彈術!', preview: q => '擊飛 ' + _m(1.2, q) + ' m' },
    { name: '石牆術', icon: '🗿', img: null, chant: '大地之骨,拔地而起,築我屏障——', shout: '石牆術!', preview: q => '擊飛 ' + _m(1, q) + ' m' },
    { name: '地裂石柱', icon: '⛰️', img: null, chant: '撼地之力,裂土而出,石柱貫天——', shout: '地裂石柱!', preview: q => '擊飛 ' + _m(1.8, q) + ' m' }
  ],
  light: [
    { name: '聖光彈', icon: '✨', img: null, chant: '晨曦之光,凝為一點,穿透黑暗——', shout: '聖光彈!', preview: q => '連鎖 ' + Math.max(1, Math.round(2 * _f(q))) + ' 跳' },
    { name: '聖域結界', icon: '🔆', img: null, chant: '神聖之光,劃地為界,照見一切——', shout: '聖域結界!', preview: q => '易傷 +' + Math.round(25 * _f(q)) + '%' },
    { name: '聖光柱', icon: '🌟', img: null, chant: '天穹之光,垂落人間,審判降臨——', shout: '聖光柱!', preview: q => '光柱 ' + CHG.count(10, q) + ' 道' }
  ],
  dark: [
    { name: '暗影彈', icon: '🟣', img: null, chant: '幽冥之影,聚於指尖,吞噬光明——', shout: '暗影彈!', preview: q => '吸引 ' + _m(1.5, q) + ' m' },
    { name: '暗影幕', icon: '🌫️', img: null, chant: '無光之幕,自深淵升起,束縛來者——', shout: '暗影幕!', preview: q => '吸向中線 ' + _m(3, q) + ' m/s' },
    { name: '黑洞', icon: '🕳️', img: null, chant: '虛無之核,吞星噬月,萬物歸一——', shout: '黑洞!', preview: q => '吸引 ' + _m(6, q) + ' m/s' }
  ]
};

// 爆炸參數(C-4 burstEl 表):bright 加亮粒子倍率、spark 火花倍率、smoke 煙倍率、ring 環色、flash 閃光色、light 光源色、lightK 光源強度倍率
// 火系的值即為現有 explode 的寫死值;其他屬性只換顏色與數量(水滴 / 風的水平化 / 土碎石 / 暗的先吸入 留到 C2)
const EL_BURST = {
  water: { bright: 0.8, spark: 0.5, smoke: 1.2, ring: 0x8fd8ff, flash: 0x6fc0ff, light: 0x4aa8ff, lightK: 0.7 },
  fire:  { bright: 1,   spark: 1,   smoke: 1,   ring: 0xffb050, flash: 0xffa040, light: 0xff8a30, lightK: 1 },
  wind:  { bright: 0.6, spark: 0.3, smoke: 0.8, ring: 0xc8ffe8, flash: 0xb0ffd8, light: 0x8affc8, lightK: 0.5 },
  earth: { bright: 0.3, spark: 0.6, smoke: 2,   ring: 0xe0b070, flash: 0xd09050, light: 0xd09050, lightK: 0.6 },
  light: { bright: 1.1, spark: 0.8, smoke: 0,   ring: 0xfff6c0, flash: 0xfff6c0, light: 0xfff2a0, lightK: 1.2 },
  dark:  { bright: 0.6, spark: 0.3, smoke: 1.5, ring: 0xb070ff, flash: 0x8a3aff, light: 0x9a4dff, lightK: 0.5 }
};

// 元素狀態效果(滿集氣值;除 FX_FIXED 外乘 P.fxK):水減速、風擊退、土擊飛與暈眩、光照亮、暗吸引與侵蝕
const EL_FX = {
  water: { slow: 3 },
  wind: { knock: 5 },
  earth: { lift: 1.2, stun: 0.8 },
  light: { lit: 4 },
  dark: { pull: 1.5, erode: 3 }
};
const FX_FIXED = { slow: 1, lit: 1 };   // 持續秒數固定,不隨集氣縮放
function elFx(el, fxK) {
  const o = {}, base = EL_FX[el] || {};
  for (const k in base) o[k] = FX_FIXED[k] ? base[k] : base[k] * fxK;
  return o;
}

// 單一標靶受元素效果。dmg 已乘好倍率;fx 為已縮放的效果值;sx,sz 為由爆心 / 中線指向標靶的方向
function hitEl(d, dmg, el, sx, sz, fx) {
  d.hit(dmg, sx, sz, 0, el);
  if (!fx) return;
  if (fx.knock) d.knock(sx, sz, fx.knock);
  if (fx.lift) d.lift(fx.lift);
  if (fx.stun) d.stun(fx.stun);
  if (fx.slow) d.slow(fx.slow);
  if (fx.lit) d.light(fx.lit);
  if (fx.erode) d.erode(fx.erode);
}

// 範圍內活標靶:距離衰減與 damageArea 相同;B 為基礎傷害,實際 = B × P.dmgK;pull 以反向位移實作(向爆心移動)
function areaEl(pos, R, B, el, P, fx) {
  const f = Object.assign({}, fx || elFx(el, P.fxK || 1));
  const pull = f.pull; delete f.pull;
  for (const d of DUMMIES) {
    if (d.dead) continue;
    if (Math.abs(pos.y - d.y) > R + 1.5) continue;
    const dx = d.x - pos.x, dz = d.z - pos.z, dist = Math.hypot(dx, dz);
    if (dist >= R + .4) continue;
    const dmg = B * (P.dmgK || 1) * (1 - clamp(dist / (R + .4), 0, 1) * .5) * rnd(.9, 1.1), l = dist || 1;
    if (pull) d.knock(-dx / l, -dz / l, pull);
    hitEl(d, dmg, el, dx / l, dz / l, f);
  }
}
