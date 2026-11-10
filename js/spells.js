'use strict';
// 六屬性招式表與元素效果(C0/C1)。
// 載入順序:fx.js → mage.js → world.js → scenes.js → game.js → spells.js → touch.js。
// 本檔只在執行期被呼叫(不在載入時讀 game.js 的變數),所以 game.js 頂層不可直接使用 SPELLS / ELMOD / EL_BURST。
// C2/C3:五個新屬性的投射 / 牆 / 大招已實作於本檔下半(火系三招仍在 game.js)。

// 屬性倍率(C-2):集氣時間、範圍、投射速度(speedMul 用於投射)
const ELMOD = {
  water: { chargeMul: 1.0, rangeMul: 1.0, speedMul: 0.9 },
  fire:  { chargeMul: 1.0, rangeMul: 1.0, speedMul: 1.0 },
  wind:  { chargeMul: 0.8, rangeMul: 1.10, speedMul: 1.5 },
  earth: { chargeMul: 1.2, rangeMul: 0.90, speedMul: 0.75 },
  light: { chargeMul: 0.9, rangeMul: 1.05, speedMul: 2.0 },
  dark:  { chargeMul: 1.1, rangeMul: 1.0, speedMul: 0.8 }
};

// 招式表(C-2):每屬性三招 [投射 bolt, 牆 wall, 大招 sky](形狀順序與 SKILLS 相同)
// preview(q):集氣條文字的第三項(效果),q 為集氣比例 0~1;img 圖檔沒有就 null,退回 icon emoji
const _f = q => CHG.fx(q), _pct = q => Math.round(50 * CHG.fx(q)), _m = (n, q) => (n * CHG.fx(q)).toFixed(1);
const SPELLS = {
  water: [
    { name: '水彈術', icon: '💧', img: 'assets/icons/sp_water_bolt.png', chant: '清泉之靈,凝於掌心,化為奔流之彈——', shout: '水彈術!', preview: q => '減速 ' + _pct(q) + '%' },
    { name: '水幕術', icon: '🌊', img: 'assets/icons/sp_water_wall.png', chant: '深潭之水,湧泉而起,化作阻敵之幕——', shout: '水幕術!', preview: q => '減速 ' + _pct(q) + '%' },
    { name: '水龍彈', icon: '🐉', img: 'assets/icons/sp_water_sky.png', chant: '深淵之龍,聽我呼喚,破浪而出——', shout: '水龍彈!', aim: 'line', line: (q, rs, m) => ({ len: 3.5 * rs * CHG.size(q, m), hw: 1.2 * CHG.thick(q, m), off: 2, maxLen: 3.5 * rs * (m === 'B' ? .6 : 1), maxHw: 1.2 * (m === 'A' ? 1.6 : 1) }), unit: 'copies', unitName: '條', preview: q => '減速 ' + _pct(q) + '%' },
    { name: '水精靈', icon: '🧚', img: 'assets/icons/summon_water.png', chant: '清泉之靈,應我之約,現身吧——', shout: '水精靈!', preview: q => '減速 ' + Math.round(30 * CHG.fx(q)) + '%' }
  ],
  fire: [
    { name: '火球術', icon: '🔥', img: 'assets/icons/sp_fire_bolt.png', chant: '火之精靈,聚於我手,化為灼熱之球——燃盡一切!', shout: '火球術!', preview: q => '燃燒 ' + _m(3, q) + ' s' },
    { name: '火牆術', icon: '🧱', img: 'assets/icons/sp_fire_wall.png', chant: '烈焰之壁,拔地而起,焚盡來犯之敵——', shout: '火牆術!', preview: q => '燃燒 ' + _m(3, q) + ' s' },
    { name: '隕石墜擊', icon: '☄️', img: 'assets/icons/sp_fire_sky.png', chant: '天外星辰,聽我召喚,墜落吧——毀滅之石!', shout: '隕石墜擊!', unit: 'copies', unitName: '顆', preview: q => '坑內減速 55%' },
    { name: '多頭火蛇', icon: '🐍', img: 'assets/icons/summon_fire.png', chant: '烈焰之蛇,三首同心,盤踞於此——', shout: '多頭火蛇!', preview: q => '燃燒 ' + _m(1.5, q) + ' s' }
  ],
  wind: [
    { name: '風刃術', icon: '🌀', img: 'assets/icons/sp_wind_bolt.png', chant: '疾風之刃,隨我意行,斬裂虛空——', shout: '風刃術!', preview: q => '擊退 ' + _m(5, q) + ' m' },
    { name: '颶風牆', icon: '🍃', img: 'assets/icons/sp_wind_wall.png', chant: '流轉之風,環繞成壁,拒敵於外——', shout: '風壁術!', preview: q => '推出 ' + _m(2.5, q) + ' m' },
    { name: '風刃切割', icon: '🌬️', img: 'assets/icons/sp_wind_sky.png', chant: '天穹之風,化為千刃,斬斷前路——', shout: '風刃切割!', aim: 'line', line: (q, rs, m) => ({ len: 20, hw: .5 * rs * CHG.size(q, m), off: 1, maxLen: 20, maxHw: .5 * rs * (m === 'B' ? .6 : 1) }), unit: 'copies', unitName: '波', preview: q => '傷害 ' + Math.round(100 * CHG.dmg(q)) },
    { name: '鎌鼬', icon: '🦦', img: 'assets/icons/summon_wind.png', chant: '疾風之子,藏刃於風,來去無蹤——', shout: '鎌鼬!', preview: q => '真空刃 ' + Math.round(80 * CHG.dmg(q)) }
  ],
  earth: [
    { name: '岩彈術', icon: '🪨', img: 'assets/icons/sp_earth_bolt.png', chant: '沉眠之岩,醒於我手,化為重擊之石——', shout: '岩彈術!', preview: q => '擊飛 ' + _m(1.2, q) + ' m' },
    { name: '石牆術', icon: '🗿', img: 'assets/icons/sp_earth_wall.png', chant: '大地之骨,拔地而起,築我屏障——', shout: '石牆術!', preview: q => '擊飛 ' + _m(1, q) + ' m' },
    { name: '土龍術', icon: '🐉', img: 'assets/icons/sp_earth_sky.png', chant: '大地之龍,破土而出,裂地千里——', shout: '土龍術!', aim: 'line', line: (q, rs, m) => ({ off: 1.5, len: 12 + 8 * q, hw: Math.max(.8, .3 * rs), maxLen: 20, maxHw: 1.8 }), unit: 'count', cntN: 3, unitName: '道', preview: q => '緩速 65% ・ 3 s' },
    { name: '石頭人', icon: '🗿', img: 'assets/icons/summon_earth.png', chant: '大地之骨,化為巨像,為我而戰——', shout: '石頭人!', preview: q => '暈眩 ' + _m(.4, q) + ' s' }
  ],
  light: [
    { name: '聖光彈', icon: '✨', img: 'assets/icons/sp_light_bolt.png', chant: '晨曦之光,凝為一點,穿透黑暗——', shout: '聖光彈!', preview: q => '連鎖 ' + Math.max(1, Math.round(2 * _f(q))) + ' 跳' },
    { name: '聖域結界', icon: '🔆', img: 'assets/icons/sp_light_wall.png', chant: '神聖之光,劃地為界,照見一切——', shout: '聖域結界!', preview: q => '易傷 +' + Math.round(25 * _f(q)) + '%' },
    { name: '聖光柱', icon: '🌟', img: 'assets/icons/sp_light_sky.png', chant: '天穹之光,垂落人間,審判降臨——', shout: '聖光柱!', unit: 'count', cntN: 10, unitName: '道', preview: q => '光柱 ' + CHG.count(10, q, curMode()) + ' 道' },
    { name: '六翼熾天使', icon: '👼', img: 'assets/icons/summon_light.png', chant: '六翼之光,降臨守護,照我前路——', shout: '熾天使!', preview: q => '治癒 ' + Math.round(12 * _f(q)) + ' / 2 s' }
  ],
  dark: [
    { name: '暗影彈', icon: '🟣', img: 'assets/icons/sp_dark_bolt.png', chant: '幽冥之影,聚於指尖,吞噬光明——', shout: '暗影彈!', preview: q => '吸引 ' + _m(1.5, q) + ' m' },
    { name: '暗影幕', icon: '🌫️', img: 'assets/icons/sp_dark_wall.png', chant: '無光之幕,自深淵升起,束縛來者——', shout: '暗影幕!', preview: q => '吸向中線 ' + _m(3, q) + ' m/s' },
    { name: '黑洞', icon: '🕳️', img: 'assets/icons/sp_dark_sky.png', chant: '虛無之核,吞星噬月,萬物歸一——', shout: '黑洞!', preview: q => '吸引 ' + _m(4, q) + ' m/s' },
    { name: '暗影', icon: '👤', img: 'assets/icons/summon_dark.png', chant: '影中之影,自我足下,甦醒吧——', shout: '暗影!', preview: q => '侵蝕 ' + _m(4, q) + ' s' }
  ]
};

// 爆炸參數(C-4 burstEl 表):bright 加亮粒子倍率、spark 火花倍率、smoke 煙倍率、ring 環色、flash 閃光色、light 光源色、lightK 光源強度倍率
// 火系的值即為現有 explode 的寫死值;其他屬性只換顏色與數量(水滴 / 風的水平化 / 土碎石 / 暗的先吸入 已於 C2/C3 實作)
const EL_BURST = {
  water: { bright: 0.8, spark: 0.5, smoke: 1.2, ring: 0x8fd8ff, flash: 0x6fc0ff, light: 0x4aa8ff, lightK: 0.7 },
  fire:  { bright: 1,   spark: 1,   smoke: 1,   ring: 0xffb050, flash: 0xffa040, light: 0xff8a30, lightK: 1 },
  wind:  { bright: 0.6, spark: 0.3, smoke: 0.8, ring: 0xc8ffe8, flash: 0xb0ffd8, light: 0x8affc8, lightK: 0.5 },
  earth: { bright: 0.3, spark: 0.6, smoke: 2,   ring: 0xe0b070, flash: 0xd09050, light: 0xd09050, lightK: 0.6 },
  light: { bright: 1.1, spark: 0.8, smoke: 0,   ring: 0xfff6c0, flash: 0xfff6c0, light: 0xfff2a0, lightK: 1.2 },
  dark:  { bright: 0.6, spark: 0.3, smoke: 1.5, ring: 0xb070ff, flash: 0x8a3aff, light: 0x9a4dff, lightK: 0.5 }
};

// 元素狀態效果(滿集氣值;除 FX_FIXED 外乘 P.fxK):水減速 + 寒意、風擊退、土擊飛與暈眩、光照亮、暗吸引與中毒(狀態效果文件 §2-1)
const EL_FX = {
  water: { slow: 3, chill: 1 },
  wind: { knock: 5 },
  earth: { lift: 1.2, stun: 0.8 },
  light: { lit: 4 },
  dark: { pull: 1.5, poison: 3 }
};
const FX_FIXED = { slow: 1, lit: 1 };   // 持續秒數固定,不隨集氣縮放
function elFx(el, fxK) {
  const o = {}, base = EL_FX[el] || {};
  for (const k in base) {
    if (k === 'poison') o.poison = [base[k] * fxK, 1];   // 中毒 = [秒 × fxK, 1 層]
    else if (k === 'chill') o.chill = base[k];           // 寒意層數不隨集氣縮放
    else o[k] = FX_FIXED[k] ? base[k] : base[k] * fxK;
  }
  if (el === 'water') o.slowPct = .5 * fxK;   // 水系減速幅度 25% → 50%(設計 §5-2)
  return o;
}

// 單一標靶受元素效果。dmg 已乘好倍率;fx 為已縮放的效果值;sx,sz 為由爆心 / 中線指向標靶的方向
function hitEl(d, dmg, el, sx, sz, fx) {
  d.hit(dmg, sx, sz, 0, el);
  if (!fx) return;
  if (fx.knock) d.knock(sx, sz, fx.knock);
  if (fx.lift) d.lift(fx.lift);
  if (fx.stun) d.stun(fx.stun);
  if (fx.slow) d.slow(fx.slow, fx.slowPct);
  if (fx.lit) d.light(fx.lit);
  ctlFx(d, fx, sx, sz);
}
// 狀態效果鍵(狀態效果文件 §4 Z0-8):root 定身秒、para 麻痺秒、silence 沉默秒、chill 寒意層、poison [秒, 層]、blind 致盲秒、down 跌倒秒(方向 sx, sz)
// 只呼叫目標上的同名方法(Dummy / RemotePlayer 都有);不造成傷害
function ctlFx(d, fx, sx, sz) {
  if (fx.root && d.root) d.root(fx.root);
  if (fx.para && d.paralyze) d.paralyze(fx.para);
  if (fx.silence && d.silence) d.silence(fx.silence);
  if (fx.chill && d.chill) d.chill(fx.chill);
  if (fx.poison && d.poison) d.poison(fx.poison[0], fx.poison[1]);
  if (fx.blind && d.blind) d.blind(fx.blind);
  if (fx.down && d.knockDown) d.knockDown(fx.down, sx, sz);
}

// 範圍內活標靶:距離衰減與 damageArea 相同;B 為基礎傷害,實際 = B × P.dmgK;pull 以反向位移實作(向爆心移動)
function areaEl(pos, R, B, el, P, fx) {
  const f = Object.assign({}, fx || elFx(el, P.fxK || 1));
  const pull = f.pull; delete f.pull;
  for (const d of DUMMIES) {
    if (d.dead) continue;
    if (Math.abs(pos.y - d.y) > R + 1.5) continue;
    const dx = d.x - pos.x, dz = d.z - pos.z, dist = Math.hypot(dx, dz);
    if (dist >= R + .2) continue;
    const dmg = B * (P.dmgK || 1) * (1 - clamp(dist / (R + .2), 0, 1) * .7) * rnd(.9, 1.1), l = dist || 1;
    if (pull) d.knock(-dx / l, -dz / l, pull);
    hitEl(d, dmg, el, dx / l, dz / l, f);
  }
}

// ================= C2/C3:水、風、土、光、暗的專屬招式(投射 / 牆 / 大招) =================
// 投射走 castBolt(共用引擎)、牆走 spawnZone(共用引擎)、大招各自一個函式(能量球先飛 → 時間軸)。
// 火球術 castFireBolt 在本檔;火牆 castFirewall 在 game.js;launchSpell 依 SHAPE_FN_NAME[元素][形狀] 查名稱、以 window[名稱] 呼叫。
// 本段只在執行期被呼叫;用到的 game.js / world.js / fx.js 全域都在那之後才會用到。

// 爆炸焦痕色(explode 讀取):RGB 乘數,焦痕貼圖本身很暗所以需要 >1 才看得出棕 / 紫;null = 不留焦痕
const EL_SCORCH = { fire: [1, 1, 1], water: null, wind: null, earth: [3, 2, 1.2], light: null, dark: [6, 2.5, 9] };
const BOLT_SPEED = 32;                       // 火球基準速度(m/s),各屬性 × ELMOD[el].speedMul
const CHAIN_R = 4.5, BEAM_MAX = 16;            // 連鎖跳躍範圍(m)、同時存在的連鎖光束上限
const LEAF0 = [.6, .75, .45], LEAF1 = [.35, .3, .15];
const BEAM_GEO = new THREE.BoxGeometry(1, 1, 1), MOON_GEO = new THREE.RingGeometry(.6, .75, 24, 1, 0, Math.PI);
const ROCK_GEO = new THREE.IcosahedronGeometry(.1, 0), SPIKE_GEO = new THREE.ConeGeometry(.45, 2.2, 5), BOX_GEO = new THREE.BoxGeometry(1, 2, 1);
const COL_GEO = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), SPH_GEO = new THREE.SphereGeometry(1, 20, 14), TORUS_GEO = new THREE.TorusGeometry(1.4, .05, 6, 48);
const STONE_MAT = new THREE.MeshStandardMaterial({ color: 0x7d7868, flatShading: true, roughness: 1 });
let BEAM_N = 0;

/* ---------- 共用小工具 ---------- */
const FXQ = () => CFG.fxq || 1;                                  // 新屬性粒子量(C-9)
const fq = n => Math.max(1, Math.round(n * FXQ()));
function after(t, fn) { let k = 0; addFx(dt => { k += dt; if (k < t) return true; fn(); return false; }); }
function nearestDummy(x, z, r) {
  let best = null, bd = r;
  for (const d of DUMMIES) { if (d.dead) continue; const dd = Math.hypot(d.x - x, d.z - z); if (dd < bd) { bd = dd; best = d; } }
  return best;
}
function disposeInd(wi) { scene.remove(wi.root); wi.mat.dispose(); wi.mesh.geometry.dispose(); }
function tpath(a, b, n, fn) { for (let i = 0; i < n; i++) { const t = Math.random(); fn(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t)); } }

// LIGHTS[4] 持續光源(牆 / 龍捲 / 黑洞):後施放者優先;只有 owner 會驅動亮度,結束時只關自己的燈
function claimLight(token, hex, pos, dist) { const L = LIGHTS[4]; L.userData.owner = token; L.color.setHex(hex); L.position.copy(pos); L.distance = dist; L.intensity = 0; }
function driveLight(token, inten) { const L = LIGHTS[4]; if (L.userData.owner === token) L.intensity = inten; }
function endLight(token) { const L = LIGHTS[4]; if (L.userData.owner === token) { L.intensity = 0; L.userData.owner = null; } }

// 連鎖光束:加亮細長 mesh + 沿線撒粒子;全場上限 BEAM_MAX 條(超過只不畫,傷害照算)
function beam(a, b, E, w, life) {
  if (BEAM_N >= BEAM_MAX) return;
  BEAM_N++;
  const m = new THREE.Mesh(BEAM_GEO, new THREE.MeshBasicMaterial({ color: E.hex, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.copy(a).add(b).multiplyScalar(.5); m.lookAt(b); m.scale.set(w, w, a.distanceTo(b) || .01); scene.add(m);
  tpath(a, b, fq(10), (x, y, z) => fire.emit(x, y, z, rnd(-.5, .5), rnd(-.5, .5), rnd(-.5, .5), rnd(.15, .25), rnd(.15, .3), E.c0, E.c1, 1, .3, 0, 1));
  let t = 0;
  addFx(dt => {
    t += dt / life;
    if (t >= 1) { scene.remove(m); m.material.dispose(); BEAM_N--; return false; }
    m.material.opacity = .9 * (1 - t);
  });
}
// 連鎖(C-6 光):從 from 往 CHAIN_R 內最近、這次連鎖還沒打過的活標靶跳,每跳間隔 .06 s、傷害 dmg;找不到就停止
function chainHop(from, seen, hops, dmg, el, fx) {
  if (hops <= 0) return;
  let best = null, bd = CHAIN_R;
  for (const d of DUMMIES) { if (d.dead || seen.has(d)) continue; const dd = Math.hypot(d.x - from.x, d.z - from.z); if (dd < bd) { bd = dd; best = d; } }
  if (!best) return;
  seen.add(best);
  after(.06, () => {
    beam(new V3(from.x, from.y + 1.1, from.z), new V3(best.x, best.y + 1.1, best.z), EL[el], .12, .18);
    best.hit(dmg, best.x - from.x, best.z - from.z, 0, el);
    if (fx) ctlFx(best, fx, best.x - from.x, best.z - from.z);   // 連鎖的狀態效果(Z2 聖光彈麻痺用)
    chainHop(best, seen, hops - 1, dmg, el, fx);
  });
}
function chainFrom(first, hops, dmg, el, fx) { chainHop(first, new Set([first]), hops, dmg, el, fx); }

/* ---------- 投射(C-4)共用引擎 ---------- */
// 能量球從杖頭飛向目標(end.y = 目標地面 + endY),弧高 = 距離 × arc,每幀 st.trail,到達後 st.impact(end, P)
function castBolt(P, orb, st) {
  const E = EL[P.el], gy = P.target.y, start = orb.position.clone(), end = P.target.clone(); end.y = gy + (st.endY || .4);
  const dist = start.distanceTo(end), dur = clamp(dist / st.speed, st.dmin || .2, st.dmax || .9), prev = start.clone();
  let t = 0;
  orb.setR(Math.max(orb.r, .3) * (.8 + P.power * .6));
  addFx(dt => {
    t += dt / dur; const u = Math.min(t, 1);
    orb.position.lerpVectors(start, end, u); orb.position.y += Math.sin(Math.PI * u) * dist * st.arc;
    st.trail(prev, orb.position, orb, E);
    prev.copy(orb.position);
    if (u >= 1) { scene.remove(orb); st.impact(end, P); return false; }
  });
}
// 飛行軌跡(每幀):a → b 為上一幀到這一幀,o 為能量球,E 為屬性表
const TRAIL = {
  fire: (a, b, o, E) => { trail(a, b, 6, o.r * 1.3, .45, 'fire'); smoke.emit(b.x, b.y, b.z, rnd(-.3, .3), rnd(0, .5), rnd(-.3, .3), 1, o.r * 1.5, [.25, .2, .18], [.08, .08, .09], .35, 2.2, -.2, .5); },
  water: (a, b, o, E) => {
    tpath(a, b, fq(4), (x, y, z) => fire.emit(x, y, z, rnd(-.6, .6), rnd(-.3, .8), rnd(-.6, .6), rnd(.3, .45), o.r * rnd(.8, 1.2), E.c0, E.c1, .9, .3, -.5, .4));
    smoke.emit(b.x, b.y, b.z, rnd(-.2, .2), 0, rnd(-.2, .2), .7, o.r * .6, E.s0, E.s1, .9, 1, 9, 0);   // 水滴(grav 9 往下掉)
  },
  wind: (a, b, o, E) => tpath(a, b, fq(3), (x, y, z) => fire.emit(x, y, z, rnd(-.8, .8), rnd(-.3, .3), rnd(-.8, .8), .25, rnd(.1, .18), E.c0, E.c1, 1, .3, 0, 4)),
  earth: (a, b, o, E) => {
    o.rotation.x += .25; o.rotation.y += .35;   // 岩塊翻滾
    for (let i = 0; i < fq(1); i++) smoke.emit(b.x + rnd(-.2, .2), b.y, b.z + rnd(-.2, .2), rnd(-.4, .4), rnd(0, .4), rnd(-.4, .4), .6, o.r * 1.2, E.s0, E.s1, .6, 1.5, 0, .3);
  },
  light: (a, b, o, E) => tpath(a, b, fq(8), (x, y, z) => fire.emit(x, y, z, rnd(-.3, .3), rnd(-.3, .3), rnd(-.3, .3), .2, rnd(.15, .3), E.c0, E.c1, 1, .5, 0, 1)),
  dark: (a, b, o, E) => { for (let i = 0; i < fq(2); i++) smoke.emit(b.x + rnd(-.15, .15), b.y + rnd(-.15, .15), b.z + rnd(-.15, .15), rnd(-.2, .2), rnd(.2, .5), rnd(-.2, .2), .6, o.r * 1.5, E.s0, E.s1, .6, 1, -.3, .3); }
};

// 爆炸後的碎石(土投射):拋物線飛散 0.6 s 後移除
function debris(p, n, col, size) {
  const mat = new THREE.MeshStandardMaterial({ color: col, flatShading: true, roughness: 1 }), parts = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(ROCK_GEO, mat);
    m.position.copy(p); m.scale.setScalar(size * rnd(.6, 1.2)); scene.add(m);
    parts.push({ m, v: new V3(rnd(-3, 3), rnd(4, 8), rnd(-3, 3)), s: new V3(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6)) });
  }
  let t = 0;
  addFx(dt => {
    t += dt;
    for (const k of parts) {
      k.v.y -= 20 * dt; k.m.position.addScaledVector(k.v, dt); k.m.rotation.x += k.s.x * dt; k.m.rotation.y += k.s.y * dt;
      const fy = terrainH(k.m.position.x, k.m.position.z) + .05; if (k.m.position.y < fy) { k.m.position.y = fy; k.v.set(0, 0, 0); }
    }
    if (t < .6) return true;
    for (const k of parts) scene.remove(k.m);
    mat.dispose(); return false;
  });
}

/* ---------- 牆類(C-5)共用引擎 ---------- */
// 沿用火牆的分段、啟動延遲、淡出、地面光圈與 LIGHTS[4];差異由 st 提供
// st:hex / indHex / alpha(地面光圈)、lightHex / lightInt(持續光源,0 = 不用)、tickInt + onTick(每跳)、
//     emit(seg, ramp, c)(每段每幀)、onSegOn(seg, c)(段第一次啟動)、frame(c)(每幀)、onStart(c) / onEnd(c)
// c:{ P, gy, ax, az, half, thick, dur, segs, age, dt, fade, token, plat };牆軸 = (ax, az),法線 across = (-az, ax)
function spawnZone(P, st) {
  if (P.ncopy == null) { forCopies(P, 'wall', .12, wallPlace, Qi => spawnZone(Qi, st)); return; }   // 牆的份數(B 模式多道):每道各自 spawnZone,由近到遠依序立起
  const gy = P.target.y, cfg = pcfg(P), half = P.r / 2, thick = cfg.thick * P.thickK, ax = Math.cos(P.wallYaw), az = -Math.sin(P.wallYaw);
  const n = Math.ceil(P.r / .7) + 1, segs = [];
  for (let i = 0; i < n; i++) { const o = (i / (n - 1) - .5) * P.r, x = P.target.x + ax * o, z = P.target.z + az * o; segs.push({ o, x, z, gy: surfaceY(x, z, gy + 1), on: Math.abs(o) / half * .4, acc: 0, went: false, mesh: null }); }
  const c = { P, gy, ax, az, half, thick, dur: cfg.duration * P.durK, segs, age: 0, dt: 0, fade: 1, tick: 0, token: {}, plat: null, emitK: (P.ncopy > 1 ? 1 / (P.ncopy * .6) : 1) * Math.sqrt(P.thickK) };
  const wi = new Indicator(scene);
  flashLight(new V3(P.target.x, gy + 1.5, P.target.z), st.hex, 4, .5, 20);
  G.shake = Math.max(G.shake, .08 * CFG.shake);
  if (st.lightInt && !P.copy) claimLight(c.token, st.lightHex, new V3(P.target.x, gy + 1.8, P.target.z), 10 + P.r * 1.3);
  if (st.onStart) st.onStart(c);
  addFx(dt => {
    c.age += dt; c.dt = dt; c.fade = c.age > c.dur - 1 ? Math.max(0, c.dur - c.age) : 1;
    if (c.age >= c.dur) { disposeInd(wi); if (st.onEnd) st.onEnd(c); if (st.lightInt) endLight(c.token); return false; }
    wi.set(P.target.x, P.target.z, 1, half, thick / 2, P.wallYaw, 0, (st.alpha || .35) * c.fade * (.8 + .2 * Math.sin(c.age * 12)), st.indHex, gy); wi.tick(c.age);
    if (st.lightInt) driveLight(c.token, st.lightInt * c.fade * (.85 + Math.random() * .3));
    if (st.frame) st.frame(c);
    for (const s of segs) {
      if (c.age < s.on) continue;
      if (!s.went) { s.went = true; if (st.onSegOn) st.onSegOn(s, c); }
      if (st.emit) st.emit(s, Math.min(1, (c.age - s.on) / .25) * c.fade, c);
    }
    if (st.tickInt && (c.tick += dt) >= st.tickInt) { c.tick = 0; st.onTick(c); }
  });
}
// 標靶是否在牆範圍內(高度差 > 2.5 m 不算),回傳沿牆 along / 垂直牆 across
function inZone(d, c) {
  if (d.dead || Math.abs(d.y - c.gy) > 2.5) return null;
  const dx = d.x - c.P.target.x, dz = d.z - c.P.target.z, along = dx * c.ax + dz * c.az, across = dx * -c.az + dz * c.ax;
  if (Math.abs(along) > c.half + .4 || Math.abs(across) > c.thick / 2 + .6) return null;
  return { along, across };
}
// 牆每跳傷害:B × dmgK,效果由牆外側推(擊退類 .6 s 冷卻,避免每跳重複推)
function zoneTick(c, B, el, fx) {
  for (const d of DUMMIES) {
    const r = inZone(d, c); if (!r) continue;
    const sg = Math.sign(r.across) || 1, f = Object.assign({}, fx);
    if (f.knock) { if (d.windT > 0) delete f.knock; else d.windT = .6; }
    hitEl(d, B * c.P.dmgK, el, -c.az * sg, c.ax * sg, f);
  }
}

/* ---------- 大招(C-6)共用 ---------- */
// 能量球飛到 to(time 秒),每幀小拖尾,到達後呼叫 done
function orbFly(orb, to, time, E, done) {
  const from = orb.position.clone(); let t = 0;
  addFx(dt => {
    t += dt / time; const u = Math.min(1, t);
    orb.position.lerpVectors(from, to, u);
    for (let i = 0; i < fq(3); i++) fire.emit(orb.position.x + rnd(-.2, .2), orb.position.y + rnd(-.2, .2), orb.position.z + rnd(-.2, .2), rnd(-.4, .4), rnd(-.4, .4), rnd(-.4, .4), .35, orb.r * rnd(1, 1.4), E.c0, E.c1, .9, .3, -.5, .4);
    if (u >= 1) { done(); return false; }
  });
}

/* ---------- 第一招:朝方向射出的子彈(無瞄準輔助,設計 §1) ---------- */
// 水平直線、固定高度(槍口高)、固定速度、無重力;不畫地面光圈 / 線 / 落點,只有飛行尾跡與 1.8 s 殘影
const SHOT_ANG = [0, -6, 6, -12, 12].map(a => a * Math.PI / 180);   // B 模式扇形固定角,依序取前 n 個(中心 0° 永遠與單發相同)
const TRACER_MAX = 6, TRACERS = [];
function dropTracer(o) {
  o.dead = true; const i = TRACERS.indexOf(o); if (i >= 0) TRACERS.splice(i, 1);
  scene.remove(o.m, o.s); o.m.material.dispose(); o.s.material.dispose();
}
// 彈道殘影:槍口 → 結束點的細光線 + 終點光點,1.8 s 線性淡出;全場最多 TRACER_MAX 條(超過移除最舊)
function addTracer(a, b, E) {
  while (TRACERS.length >= TRACER_MAX) dropTracer(TRACERS[0]);
  const m = new THREE.Mesh(BEAM_GEO, new THREE.MeshBasicMaterial({ color: E.hex, transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.copy(a).add(b).multiplyScalar(.5); m.lookAt(b); m.scale.set(.05, .05, a.distanceTo(b) || .01); scene.add(m);
  const s = glowSprite(E.hex, .8, .7); s.position.copy(b); scene.add(s);
  const o = { m, s, dead: false }; TRACERS.push(o);
  let t = 0;
  addFx(dt => {
    if (o.dead) return false;
    t += dt / 1.8;
    if (t >= 1) { dropTracer(o); return false; }
    m.material.opacity = .45 * (1 - t); s.material.opacity = .7 * (1 - t);
    return true;
  });
}
// 共用引擎:P.dir 方向、P.muzzle 槍口、P.copies 發數;st:{ speed, trail(a, b, orb, E), impact(end, P), done?(end) }
// 第 0 發用 orb,其餘發 makeOrb 複製;各發 dmgK × CHG.perK(n, 'bolt')
function castShot(P, orb, st) {
  const n = P.copies || 1, k = CHG.perK(n, 'bolt');
  for (let i = 0; i < n; i++) {
    const Pi = Object.assign({}, P, { copy: i, ncopy: n, dmgK: P.dmgK * k, target: P.target.clone() });
    let o = orb;
    if (i) { o = makeOrb(EL[P.el]); scene.add(o); }
    shotOne(Pi, o, st, P.dir + SHOT_ANG[i]);
  }
}
// 單發:每幀細分為 ≤ 0.5 m 的步長(光彈 64 m/s 不穿過標靶);標靶 > 地形 / 平台 / 裝飾柱 > 場地邊界 > 射程盡頭
function shotOne(P, orb, st, dir) {
  const E = EL[P.el], dx = Math.sin(dir), dz = Math.cos(dir), from = P.muzzle.clone(), Y = from.y, hitR = .3 * P.thickK;
  orb.setR(Math.max(orb.r, .3) * (.8 + .6 * P.power) * P.thickK); orb.position.copy(from);
  let cur = from.clone(), s = 0, ended = false;
  const stop = (pt, boom) => {
    ended = true; orb.position.copy(pt);
    if (boom) { scene.remove(orb); addTracer(from, pt, E); st.impact(pt, P); }
    else { dissolveOrb(orb, E); addTracer(from, pt, E); }
    if (st.done) st.done(pt);
  };
  const hitAt = (a, b) => {   // 這一小段 a → b:標靶先比(段內最早接觸);其餘在段尾判定
    let bt = 2, best = null;
    for (const d of DUMMIES) { if (d.dead) continue; const t = segHitT(a, b, d, hitR); if (t >= 0 && t < bt) { bt = t; best = d; } }
    if (best) return { pt: new V3(a.x + (b.x - a.x) * bt, Y, a.z + (b.z - a.z) * bt), boom: true };
    if (b.y < terrainH(b.x, b.z) + .1) return { pt: b, boom: true };
    for (const H of PLATFORMS) if (platContains(H, b.x, b.z, .1) && b.y <= platTop(H, b.x, b.z) && (H.bottom == null || b.y >= H.bottom)) return { pt: b, boom: true };
    for (const c of COLLIDERS) if (c.deco && Math.hypot(b.x - c.x, b.z - c.z) < c.r) return { pt: b, boom: true };
    return null;
  };
  addFx(dt => {
    if (ended) return false;
    const dist = st.speed * dt, steps = Math.max(1, Math.ceil(dist / .5)), step = dist / steps, f0 = cur.clone();
    for (let j = 0; j < steps; j++) {
      const a = cur.clone(); cur.x += dx * step; cur.z += dz * step; cur.y = Y; s += step;
      const h = hitAt(a, cur);
      if (h) { stop(h.pt, h.boom); return false; }
      if (Math.hypot(cur.x, cur.z) > ARENA_R) { stop(cur.clone(), false); return false; }   // 場地邊界:小煙消失,不爆炸
      if (s >= P.range) { stop(cur.clone(), true); return false; }                        // 射程盡頭:空中爆炸
    }
    orb.position.copy(cur);
    st.trail(f0, cur, orb, E);
    return true;
  });
}
// 火球術(第 1 招,與其他屬性同走 castShot);爆炸參數同舊 castFireball
function castFireBolt(P, orb) {
  castShot(P, orb, {
    speed: BOLT_SPEED * ELMOD.fire.speedMul, trail: TRAIL.fire,
    impact(end, Q) { explode(end, Q.r, Q.power, { dmg: 80, gy: Q.target.y, el: 'fire', mul: Q.dmgK, fxK: Q.fxK, burn: 3 * Q.fxK }); }
  });
}

/* ---------- 各屬性 3 招 ---------- */

// 水彈術:減速(3 s);爆炸水滴噴濺,無焦痕(第 1 招,朝方向射出)
function castWaterBolt(P, orb) {
  const E = EL.water;
  castShot(P, orb, {
    speed: BOLT_SPEED * ELMOD.water.speedMul, trail: TRAIL.water,
    impact(end, Q) {
      explode(end, Q.r, Q.power, { dmg: 0, el: 'water', gy: Q.target.y, fxK: Q.fxK });
      for (let i = 0; i < fq(30); i++) smoke.emit(end.x + rnd(-.4, .4), end.y, end.z + rnd(-.4, .4), rnd(-1.2, 1.2), rnd(4, 7), rnd(-1.2, 1.2), rnd(.6, .9), rnd(.12, .22), E.s0, E.s1, .9, 1, 9, .2);
      areaEl(end, Q.r, 70, 'water', Q);
    }
  });
}
// 水幕術:每段噴泉(加亮藍粒子向上、grav 9 拋物線落回),每 .3 s 減速 3 s
function castWaterWall(P, orb) {
  const E = EL.water;
  castBolt(P, orb, {
    speed: 36, arc: 0, endY: .5, dmin: .2, dmax: .6, trail: TRAIL.water,
    impact: (end, Q) => spawnZone(Q, {
      hex: E.hex, indHex: E.hex, alpha: .35, lightHex: 0x4aa8ff, lightInt: 1.8, tickInt: .3,
      emit(s, ramp, c) {
        s.acc += c.dt * 24 * ramp * FXQ() * c.emitK;
        while (s.acc >= 1) {
          s.acc -= 1; const lx = rnd(-c.thick / 2, c.thick / 2), x = s.x - c.az * lx, z = s.z + c.ax * lx;
          fire.emit(x, s.gy + rnd(0, .2), z, rnd(-.3, .3), rnd(4, 6), rnd(-.3, .3), rnd(.5, .8), rnd(.35, .6), E.c0, E.c1, .95, .35, 9, .3);
          if (Math.random() < .15) smoke.emit(x, s.gy + 1.2, z, rnd(-.2, .2), rnd(.3, .8), rnd(-.2, .2), 1.2, rnd(.8, 1.2), E.s0, E.s1, .25, 1.5, -.1, .5);
        }
      },
      onTick: c => zoneTick(c, 6, 'water', { slow: 3, chill: 1 })
    })
  });
}
// 間歇泉:地面水圈預告 → 多道小水柱(小擊飛)→ 中央大水柱(大擊飛 + 大範圍)
function castGeyser(P, orb) {
  const E = EL.water, gy = P.target.y, R = P.r, sched = [], n = CHG.count(10, P.q, P.mode);
  for (let i = 0; i < n; i++) sched.push({ t: .5 + (i / n) * 1.8 + prnd(P, 0, .2), big: false });
  sched.push({ t: 2.6, big: true });
  const geyser = (x, y, z, big) => {
    const h = big ? 7 : 4, rad = big ? 1.2 : .6, rr = big ? P.r * .8 : Math.max(1.6, P.r * .3), lift = (big ? 1.2 : .6) * P.fxK;
    areaEl(new V3(x, y, z), rr, big ? 90 : 40, 'water', P, { slow: 3, lift });
    const m = new THREE.Mesh(COL_GEO, new THREE.MeshBasicMaterial({ color: E.hex, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    scene.add(m);
    if (big) flashLight(new V3(x, y + 2, z), E.hex, 5, .4, 18);
    let t = 0, sprayed = false;
    addFx(dt => {
      t += dt;
      const k = t < .15 ? t / .15 : Math.max(0, 1 - (t - .15) / .35), H = Math.max(.01, h * k);
      m.scale.set(rad, H, rad); m.position.set(x, y + H / 2, z);
      if (!sprayed && t >= .12) {
        sprayed = true;
        for (let i = 0; i < fq(24); i++) fire.emit(x + rnd(-.3, .3), y + h, z + rnd(-.3, .3), rnd(-1.5, 1.5), rnd(8, 12), rnd(-1.5, 1.5), rnd(.4, .7), rnd(.2, .35), E.c0, E.c1, 1, .3, 12, .3);
        for (let i = 0; i < fq(10); i++) smoke.emit(x + rnd(-1, 1), y + h * .9, z + rnd(-1, 1), rnd(-1, 1), rnd(2, 5), rnd(-1, 1), rnd(.8, 1.2), rnd(.12, .2), E.s0, E.s1, .9, 1, 9, .2);
      }
      if (t >= .5) { scene.remove(m); m.material.dispose(); return false; }
    });
  };
  orbFly(orb, new V3(P.target.x, gy + .3, P.target.z), .3, E, () => {
    dissolveOrb(orb, E);
    const wi = new Indicator(scene); let t = 0;
    addFx(dt => {
      t += dt;
      const fin = t > 3.2 ? Math.max(0, 1 - (t - 3.2) / .5) : 1;
      wi.set(P.target.x, P.target.z, 0, R, 0, 0, Math.min(1, t / .5), .4 * fin, E.hex, gy); wi.tick(t);
      while (sched.length && t >= sched[0].t) {
        const e = sched.shift(), ang = prnd(P, 0, 6.283), rr = e.big ? 0 : Math.sqrt(prnd(P, 0, 1)) * R * .9;
        geyser(P.target.x + Math.cos(ang) * rr, gy, P.target.z + Math.sin(ang) * rr, e.big);
      }
      if (!sched.length && t > 3.8) { disposeInd(wi); return false; }
    });
  });
}

// 龍捲風:能量球升到上空成形,龍捲繞圈移動、持續吸引與抬升,結束時爆風擊退 4 → 2 m
function castTornado(P, orb) {
  const E = EL.wind, gy = P.target.y, R = P.r, Rm = R * .3, w = 1.2 / Rm, dur = 3.2 + 1.4 * P.q, token = {};
  orbFly(orb, new V3(P.target.x, gy + 2.5, P.target.z), .3, E, () => {
    scene.remove(orb);
    let t = 0, tick = 0, cx = P.target.x, cz = P.target.z;
    claimLight(token, E.hex, new V3(cx, gy + 2, cz), 14);
    addFx(dt => {
      t += dt;
      const a = t * w; cx = P.target.x + Math.cos(a) * Rm; cz = P.target.z + Math.sin(a) * Rm;
      const fade = Math.min(1, t / .3) * (t > dur - .5 ? Math.max(0, (dur - t) / .5) : 1);
      driveLight(token, 1.5 * fade);
      for (const d of DUMMIES) {
        if (d.dead) continue;
        const dist = Math.hypot(d.x - cx, d.z - cz);
        if (dist > R) continue;
        d.pull(cx, cz, 4 * P.fxK, dt);
        if (dist < 1.2) d.lift(1.2);
      }
      if ((tick += dt) >= .25) { tick = 0; for (const d of DUMMIES) if (!d.dead && Math.hypot(d.x - cx, d.z - cz) < R) d.hit(7 * P.dmgK, 0, 0, 0, 'wind'); }
      for (let i = 0; i < fq(10); i++) {
        const hh = rnd(0, 5), r = .4 + hh * .35, an = t * 8 + hh * 1.2 + rnd(-.2, .2), sp = r * 6;
        fire.emit(cx + Math.cos(an) * r, gy + hh, cz + Math.sin(an) * r, -Math.sin(an) * sp, rnd(-.3, .3), Math.cos(an) * sp, .25, rnd(.2, .4), E.c0, E.c1, .9 * fade, .5, 0, 2);
      }
      for (let i = 0; i < fq(2); i++) smoke.emit(cx + rnd(-1, 1) * R * .3, gy + .1, cz + rnd(-1, 1) * R * .3, rnd(-.5, .5), rnd(.5, 1.5), rnd(-.5, .5), .6, rnd(.6, 1), E.s0, E.s1, .5, 1.5, -.2, .5);
      for (let i = 0; i < fq(1); i++) fire.emit(cx + rnd(-1, 1) * R * .3, gy + rnd(0, 5), cz + rnd(-1, 1) * R * .3, rnd(-1, 1), rnd(0, 1), rnd(-1, 1), .8, rnd(.1, .18), LEAF0, LEAF1, .8 * fade, .5, 0, 1);
      if (t >= dur) {
        endLight(token);
        const c = new V3(cx, gy, cz);
        explode(c, R * .7, P.power, { dmg: 0, el: 'wind', gy, fxK: P.fxK, flatY: .3, smokeA: .25 });
        burstRing(c, EL_BURST.wind.ring, R);
        areaEl(c, R, 40, 'wind', P, { knock: 4 * P.fxK });
        G.shake = Math.max(G.shake, .3 * CFG.shake);
        return false;
      }
    });
  });
}

// 土:岩彈(擊飛 + 暈眩)(第 1 招,朝方向射出)
function castEarthBolt(P, orb) {
  castShot(P, orb, {
    speed: BOLT_SPEED * ELMOD.earth.speedMul, trail: TRAIL.earth,
    impact(end, Q) {
      const R = Q.r * .9;
      explode(end, R, Q.power, { dmg: 0, el: 'earth', gy: Q.target.y, fxK: Q.fxK });
      debris(end, IS_TOUCH ? 4 : 6, 0x8a6a48, .9);
      areaEl(end, R, 90, 'earth', Q);
    }
  });
}
// 石牆術:實體暫時平台(tmp),每段石柱依序升起、各判定一次(擊飛 + 推出),時間到下沉
function castStoneWall(P, orb) {
  const E = EL.earth;
  castBolt(P, orb, {
    speed: 36, arc: 0, endY: .5, dmin: .2, dmax: .6, trail: TRAIL.earth,
    impact: (end, Q) => spawnZone(Q, {
      hex: E.hex, indHex: E.hex, alpha: .35,
      onStart(c) {
        const sp = c.P.r / (c.segs.length - 1), segW = sp * .96;
        c.plat = addPlatform({ kind: 'box', x: c.P.target.x, z: c.P.target.z, hx: c.P.r / 2, hz: c.thick / 2, yaw: c.P.wallYaw, top: c.gy, tmp: true });
        for (const s of c.segs) {
          s.mesh = new THREE.Mesh(BOX_GEO, STONE_MAT); s.mesh.scale.set(segW, 1, c.thick);
          s.mesh.position.set(s.x, s.gy - 1.05, s.z); s.mesh.rotation.y = c.P.wallYaw; scene.add(s.mesh);
        }
      },
      frame(c) {
        const up = Math.min(1, c.age / .45), sink = Math.min(1, Math.max(0, (c.dur - c.age) / .5));
        c.plat.top = c.gy + 2 * up * sink;
        for (const s of c.segs) { const h = Math.min(1, Math.max(0, (c.age - s.on) / .3)) * sink; s.mesh.position.y = s.gy + 2 * h - 1.05; }
      },
      onSegOn(s, c) {
        for (let i = 0; i < fq(6); i++) smoke.emit(s.x + rnd(-.5, .5), s.gy + .2, s.z + rnd(-.5, .5), rnd(-1.5, 1.5), rnd(.5, 1.5), rnd(-1.5, 1.5), rnd(.8, 1.2), rnd(.8, 1.4), E.s0, E.s1, .55, 2, -.1, .6);
        const sp = c.P.r / (c.segs.length - 1);
        for (const d of DUMMIES) {
          const r = inZone(d, c); if (!r || Math.abs(r.along - s.o) > sp / 2 + .05) continue;
          const sg = Math.sign(r.across) || 1;
          hitEl(d, 50 * c.P.dmgK, 'earth', -c.az * sg, c.ax * sg, { lift: 1.0 * c.P.fxK, knock: 1.5 * c.P.fxK });
        }
      },
      onEnd(c) { removePlatform(c.plat); for (const s of c.segs) scene.remove(s.mesh); }
    })
  });
}
// 地裂石柱:地面裂紋預告 → 三圈石柱(中心 / R×.5 / R×.9),每個標靶只吃到所在那一圈
function castEarthSpikes(P, orb) {
  const E = EL.earth, gy = P.target.y, R = P.r, cnt = (IS_TOUCH ? [1, 5, 8] : [1, 6, 10]).map(c => CHG.count(c, P.q, P.mode));
  const RAD = [0, R * .5, R * .9], BAND = [[0, R * .25], [R * .25, R * .7], [R * .7, R * 1.05]], TIMES = [.6, .8, 1.0];
  const spike = (x, z) => {
    const m = new THREE.Mesh(SPIKE_GEO, STONE_MAT);
    m.rotation.set(rnd(-.15, .15), rnd(0, 6.283), rnd(-.15, .15)); m.position.set(x, gy - 1.1, z); m.scale.setScalar(P.thickK); scene.add(m);
    let t = 0;
    addFx(dt => {
      t += dt;
      let yy;   // 圓錐中心相對地面高度:埋入 -1.1、露出 .4、停留 2.5 s 後沉下
      if (t < .15) yy = lerp(-1.1, .4, easeOut(t / .15));
      else if (t < 2.65) yy = .4;
      else if (t < 3.15) yy = lerp(.4, -1.1, (t - 2.65) / .5);
      else { scene.remove(m); return false; }
      m.position.y = gy + yy;
      return true;
    });
  };
  const ring = k => {
    const r = RAD[k], n = cnt[k], lo = BAND[k][0], hi = BAND[k][1];
    for (let i = 0; i < n; i++) {
      const a = i / n * 6.283 + prnd(P, 0, .4), x = P.target.x + Math.cos(a) * r, z = P.target.z + Math.sin(a) * r;
      spike(x, z);
      for (let j = 0; j < fq(3); j++) smoke.emit(x + rnd(-.5, .5), gy + .2, z + rnd(-.5, .5), rnd(-1, 1), rnd(.5, 2), rnd(-1, 1), rnd(1, 1.6), rnd(1, 1.8), E.s0, E.s1, .55, 2, -.2, .6);
      for (let j = 0; j < fq(2); j++) fire.emit(x, gy + .3, z, rnd(-2, 2), rnd(1, 3), rnd(-2, 2), rnd(.3, .5), rnd(.1, .2), E.c0, E.c1, 1, .3, 9, .5);
    }
    for (const d of DUMMIES) {
      if (d.dead || Math.abs(d.y - gy) > 3) continue;
      const dx = d.x - P.target.x, dz = d.z - P.target.z, dist = Math.hypot(dx, dz);
      if (dist < lo || dist >= hi) continue;
      const l = dist || 1;
      hitEl(d, 60 * P.dmgK * rnd(.9, 1.1), 'earth', dx / l, dz / l, { lift: 1.8 * P.fxK, stun: 1.0 * P.fxK });
    }
    G.shake = Math.max(G.shake, .12 * CFG.shake);
    if (k === 2) flashLight(new V3(P.target.x, gy + 1.5, P.target.z), E.hex, 5, .5, 20);
  };
  orbFly(orb, new V3(P.target.x, gy + .3, P.target.z), .3, E, () => {
    dissolveOrb(orb, E);
    const wi = new Indicator(scene); let t = 0, k = 0;
    addFx(dt => {
      t += dt;
      wi.set(P.target.x, P.target.z, 0, R, 0, 0, Math.min(1, t / .6), .45 * (t > 1.4 ? Math.max(0, 1 - (t - 1.4) / .5) : 1), E.hex, gy); wi.tick(t);
      if (t < .6) for (let j = 0; j < fq(2); j++) { const a = rnd(0, 6.283), r = Math.sqrt(Math.random()) * R * .9; smoke.emit(P.target.x + Math.cos(a) * r, gy + .1, P.target.z + Math.sin(a) * r, rnd(-.3, .3), rnd(.2, .6), rnd(-.3, .3), .7, rnd(.6, 1), E.s0, E.s1, .4, 1.5, -.1, .4); }
      while (k < 3 && t >= TIMES[k]) { ring(k); k++; }
      if (k >= 3 && t > 1.9) { disposeInd(wi); return false; }
    });
  });
}

// 聖光彈:細長光痕 → 白金爆炸(無煙無焦痕),連鎖 1 → 2 跳(與預覽同公式 max(1, round(2 × fxK)))(第 1 招)
function castHolyBolt(P, orb) {
  castShot(P, orb, {
    speed: BOLT_SPEED * ELMOD.light.speedMul, trail: TRAIL.light,
    impact(end, Q) {
      const R = Q.r * .8, PARA = { para: 2.4 * Q.fxK };   // 首個目標與每個連鎖目標麻痺 1.2 → 2.4 s
      explode(end, R, Q.power, { dmg: 0, el: 'light', gy: Q.target.y, fxK: Q.fxK });
      areaEl(end, R, 55, 'light', Q, {});
      const first = nearestDummy(end.x, end.z, R + .4);
      if (first) { ctlFx(first, PARA, 0, 0); chainFrom(first, Math.max(1, Math.round(2 * Q.fxK)), 55 * Q.dmgK * .5, 'light', PARA); }
    }
  });
}
// 聖域結界:每 .4 s 照亮 4 s(受傷 ×1.25)
function castSanctuary(P, orb) {
  const E = EL.light;
  castBolt(P, orb, {
    speed: 36, arc: 0, endY: .5, dmin: .2, dmax: .6, trail: TRAIL.light,
    impact: (end, Q) => spawnZone(Q, {
      hex: E.hex, indHex: E.hex, alpha: .5, lightHex: 0xfff2a0, lightInt: 2.5, tickInt: .4,
      emit(s, ramp, c) {
        s.acc += c.dt * 20 * ramp * FXQ() * c.emitK;
        while (s.acc >= 1) {
          s.acc -= 1; const lx = rnd(-c.thick / 2, c.thick / 2);
          fire.emit(s.x - c.az * lx, s.gy + rnd(0, .2), s.z + c.ax * lx, rnd(-.2, .2), rnd(3, 5), rnd(-.2, .2), .5, rnd(.15, .3), E.c0, E.c1, .9, .3, 0, .5);
        }
      },
      onTick: c => zoneTick(c, 8, 'light', { lit: 4 })
    })
  });
}
// 聖光柱:能量球往上飛 → 多道小光柱(連鎖 1 跳)→ 中央大光柱(連鎖 1 → 3 跳)
function castHolyPillar(P, orb) {
  const E = EL.light, gy = P.target.y, R = P.r, n = CHG.count(10, P.q, P.mode), sched = [];
  for (let i = 0; i < n; i++) sched.push({ t: .4 + (i / n) * 1.6 + prnd(P, 0, .15), big: false });
  sched.push({ t: 2.3, big: true });
  const pillar = (x, z, rad, big) => {
    const m = new THREE.Mesh(COL_GEO, new THREE.MeshBasicMaterial({ color: 0xfff6c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(x, gy + 10, z); m.scale.set(rad, 20, rad); scene.add(m);
    burstRing(new V3(x, gy, z), 0xfff6c0, rad * 2.5);
    flashLight(new V3(x, gy + 2, z), 0xfff6c0, big ? 6 : 3, .5, big ? 22 : 14);
    let t = 0;
    addFx(dt => {
      t += dt;
      const o = t < .08 ? t / .08 : (t < .23 ? 1 : Math.max(0, 1 - (t - .23) / .35));
      m.material.opacity = .65 * o;
      if (t >= .58) { scene.remove(m); m.material.dispose(); return false; }
    });
  };
  const small = () => {
    const ang = prnd(P, 0, 6.283), rr = Math.sqrt(prnd(P, 0, 1)) * Math.max(1.4, R * .25), x = P.target.x + Math.cos(ang) * rr, z = P.target.z + Math.sin(ang) * rr;
    pillar(x, z, .35 * P.thickK, false);
    areaEl(new V3(x, gy, z), 1.0 * P.thickK, 45, 'light', P, {});
    const first = nearestDummy(x, z, 1.8);
    if (first) chainFrom(first, 1, 45 * P.dmgK * .5, 'light');
  };
  const big = () => {
    const rr = R * .8, x = P.target.x, z = P.target.z;
    pillar(x, z, .8, true);
    areaEl(new V3(x, gy, z), rr, 110, 'light', P, { blind: 2.5 * P.fxK });   // 大光柱致盲 1.25 → 2.5 s
    const first = nearestDummy(x, z, rr + .4);
    if (first) chainFrom(first, Math.round(1 + 2 * P.q), 110 * P.dmgK * .5, 'light');
    G.shake = Math.max(G.shake, .3 * CFG.shake);
  };
  orbFly(orb, new V3(P.target.x, gy + 20, P.target.z), .45, E, () => {
    dissolveOrb(orb, E);
    let t = 0;
    addFx(dt => {
      t += dt;
      while (sched.length && t >= sched[0].t) { const e = sched.shift(); if (e.big) big(); else small(); }
      return !(!sched.length && t > 3.0);
    });
  });
}

// 暗影彈:黑核紫邊的子彈;命中先吸入(0.25 s),再爆炸並把範圍內標靶拉向爆心、侵蝕(第 1 招)
function castShadowBolt(P, orb) {
  castShot(P, orb, {
    speed: BOLT_SPEED * ELMOD.dark.speedMul, trail: TRAIL.dark,
    impact(end, Q) {
      const E = EL.dark, R = Q.r, gy = Q.target.y;
      for (let i = 0; i < fq(24); i++) {   // 先吸入:粒子從 1.3R 處往爆心飛,0.3 s 到達
        const d = new V3(rnd(-1, 1), rnd(-.2, 1), rnd(-1, 1)).normalize(), k = R * 1.3;
        const sx = end.x + d.x * k, sy = end.y + d.y * k, sz = end.z + d.z * k;
        fire.emit(sx, sy, sz, (end.x - sx) / .3, (end.y - sy) / .3, (end.z - sz) / .3, .3, rnd(.15, .3), E.c0, E.c1, 1, .5, 0, 0);
      }
      after(.25, () => {
        explode(end, R, Q.power, { dmg: 0, el: 'dark', gy, fxK: Q.fxK });
        areaEl(end, R, 65, 'dark', Q);
      });
    }
  });
}
// 暗影幕:暗紫煙牆,每跳侵蝕 3 s;每幀把範圍內標靶拉向牆中線(3 → 1.5 m/s × fxK)
function castShadowCurtain(P, orb) {
  const E = EL.dark;
  castBolt(P, orb, {
    speed: 36, arc: 0, endY: .5, dmin: .2, dmax: .6, trail: TRAIL.dark,
    impact: (end, Q) => spawnZone(Q, {
      hex: E.hex, indHex: E.hex, alpha: .35, lightHex: 0x9a4dff, lightInt: 1.2, tickInt: .3,
      emit(s, ramp, c) {
        s.acc += c.dt * 12 * ramp * FXQ() * c.emitK;
        while (s.acc >= 1) {
          s.acc -= 1; const lx = rnd(-c.thick / 2, c.thick / 2), x = s.x - c.az * lx, z = s.z + c.ax * lx;
          smoke.emit(x, s.gy + rnd(.3, 1.2), z, rnd(-.3, .3), rnd(1, 2), rnd(-.3, .3), rnd(.8, 1.2), rnd(1.5, 2.5), E.s0, E.s1, .7, 1, -.3, .3);
          if (Math.random() < .2) fire.emit(x, s.gy + rnd(0, 1), z, rnd(-.3, .3), rnd(.5, 1), rnd(-.3, .3), .5, rnd(.3, .5), E.c0, E.c1, .7, .5, -.2, .5);
        }
      },
      frame(c) {
        for (const d of DUMMIES) {
          const r = inZone(d, c); if (!r) continue;
          const al = clamp(r.along, -c.half, c.half);
          d.pull(c.P.target.x + c.ax * al, c.P.target.z + c.az * al, 3 * c.P.fxK, c.dt);
        }
      },
      onTick: c => zoneTick(c, 6, 'dark', { poison: [3, 1] })
    })
  });
}
// 黑洞:能量球升到上空成形 → 吸引圈內標靶向心移動並侵蝕 → 坍縮爆炸(大傷害,之後標靶彈回原位)
// 份數(B 模式):垂直瞄準方向 0 / +0.9R / −0.9R 並排;只有第 0 份驅動持續光源;A 模式黑球 / 吸積環 ×thickK
function castBlackHole(P, orb) {
  forCopies(P, 'sky', .2, blackPlace, (Pi, i) => {
    let o = orb;
    if (i) { o = makeOrb(EL.dark); o.setR(orb.r); scene.add(o); o.position.copy(orb.position); }
    blackHoleOne(Pi, o);
  });
}
function blackPlace(Pi, i) {
  if (!i) return;
  const s = (i % 2 ? 1 : -1) * .9 * Pi.r, x = Pi.target.x + Math.cos(Pi.dir) * s, z = Pi.target.z - Math.sin(Pi.dir) * s;
  Pi.target = new V3(x, surfaceY(x, z, Pi.target.y + 1), z);
}
function blackHoleOne(P, orb) {
  const E = EL.dark, gy = P.target.y, R = P.r, pullR = R * 1.2, attr = 2.4 + P.q, ground0 = new V3(P.target.x, gy, P.target.z), tk = P.thickK;
  orbFly(orb, new V3(P.target.x, gy + 2.5, P.target.z), .3, E, () => {
    scene.remove(orb);
    const C = new V3(P.target.x, gy + 2.5, P.target.z), token = {};
    const sph = new THREE.Mesh(SPH_GEO, new THREE.MeshBasicMaterial({ color: 0x050008 }));
    sph.position.copy(C); sph.scale.setScalar(.01); scene.add(sph);
    const halo = glowSprite(0x9a4dff, 5, .5); halo.position.copy(C); scene.add(halo);
    const ring = new THREE.Mesh(TORUS_GEO, new THREE.MeshBasicMaterial({ color: 0xb070ff, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.copy(C); ring.rotation.x = Math.PI / 2 - .4; ring.scale.setScalar(tk); scene.add(ring);
    if (!P.copy) claimLight(token, 0x9a4dff, C, 14);
    const endAt = .4 + attr, boom = endAt + .15;
    let t = 0, tick = 0, ptick = 0, boomed = false;
    const poisoned = new Map();   // 每個標靶被本黑洞加的中毒層數(上限 2)
    addFx(dt => {
      t += dt;
      const grow = Math.min(1, t / .4), shrink = t > endAt ? Math.max(0, 1 - (t - endAt) / .15) : 1;
      sph.scale.setScalar(Math.max(.01, .7 * tk * grow * shrink)); ring.rotation.z += dt * 2.5;
      if (t <= endAt) {
        driveLight(token, 1);
        for (const d of DUMMIES) {
          if (d.dead) continue;
          const dist = Math.hypot(d.x - C.x, d.z - C.z);
          if (dist > pullR) continue;
          d.pull(C.x, C.z, 4 * P.fxK, dt);
        }
        if ((ptick += dt) >= 1) {   // 圈內每 1 s 中毒 +1 層(本黑洞上限 2 層,黑洞的吸引已很強,不再另外加傷害)
          ptick = 0;
          for (const d of DUMMIES) {
            if (d.dead || Math.hypot(d.x - C.x, d.z - C.z) >= R) continue;
            const n = poisoned.get(d) || 0;
            if (n < 2) { poisoned.set(d, n + 1); d.poison(3 * P.fxK, 1); }
          }
        }
        if ((tick += dt) >= .25) { tick = 0; for (const d of DUMMIES) if (!d.dead && Math.hypot(d.x - C.x, d.z - C.z) < R) d.hit(6 * P.dmgK, 0, 0, 0, 'dark'); }
        for (let i = 0; i < fq(8); i++) {
          const dd = new V3(rnd(-1, 1), rnd(-.3, 1), rnd(-1, 1)).normalize(), k = R * 1.2;
          const sx = C.x + dd.x * k, sy = C.y + dd.y * k, sz = C.z + dd.z * k;
          fire.emit(sx, sy, sz, (C.x - sx) / .6, (C.y - sy) / .6, (C.z - sz) / .6, .6, rnd(.15, .25), E.c0, E.c1, 1, .5, 0, 0);
        }
      }
      if (!boomed && t >= boom) {
        boomed = true; endLight(token);
        scene.remove(sph, halo, ring); sph.material.dispose(); halo.material.dispose(); ring.material.dispose();
        explode(ground0, R * .8, P.power, { dmg: 0, el: 'dark', gy, fxK: P.fxK });
        areaEl(ground0, R * .8, 100, 'dark', P, { silence: 1.5 * P.fxK });   // 坍縮沉默 0.75 → 1.5 s
        G.shake = Math.max(G.shake, .35 * CFG.shake);
        return false;
      }
    });
  });
}

/* ---------- 形狀查表(launchSpell 用):元素 → 形狀 → 函式名稱;執行期以 window[名稱] 取用,階段 1 的新檔可各自定義而不必改本檔 ---------- */
const SHAPE_FN_NAME = {
  fire:  { bolt: 'castFireBolt',   wall: 'castFirewall',      sky: 'castCraterMeteor', summon: 'castSummon' },
  water: { bolt: 'castWaterBolt',  wall: 'castWaterWall',     sky: 'castWaterDragon',  summon: 'castSummon' },
  wind:  { bolt: 'castWindBolt',   wall: 'castWindWall',      sky: 'castWindCut',      summon: 'castSummon' },
  earth: { bolt: 'castEarthBolt',  wall: 'castStoneWall',     sky: 'castEarthDragon',  summon: 'castSummon' },
  light: { bolt: 'castHolyBolt',   wall: 'castSanctuary',     sky: 'castHolyPillar',   summon: 'castSummon' },
  dark:  { bolt: 'castShadowBolt', wall: 'castShadowCurtain', sky: 'castBlackHole',    summon: 'castSummon' }
};
