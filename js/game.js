'use strict';
/* ================= 設定(可在遊戲內 P 面板調整,存 localStorage) ================= */
const GRAV = 20, COYOTE = 0.10;   // 重力加速度;離地後仍可地面跳的時間(s)
const DEFAULT_CFG = {
  jumpV: 9.5, airJumpV: 10, airRollDist: 3.5, airRollTime: 0.32, airRollGrav: 0.25, rollDist: 5, rollTime: 0.45, rollCD: 0.9, dodgeStart: 0.04, dodgeWin: 0.18,
  moveSpeed: 5, runMul: 1.7, camDist: 9, camSens: 0.008, showInfo: false, showInfoNet: false, camLock: true, camXhair: true, camInvY: false, camSmooth: 0, camShoulder: 0.7, camKeyTurn: 3, touchSens: 1.6, padSens: 1.4, autoFrame: true, shake: 1, bloom: true, bloomStrength: 0.85, minHold: 0.3,
  ver: 3, rangeK: 1, radK: 1,   // ver:存檔版本(< 2 的舊存檔會丟掉 skills / rad / radById);rangeK / radK:平衡測試用整體係數(預設 1)
  rad: [1.6, 6, 4, 1.2], radById: {}, fxq: 1, dummyMove: false, slowSelf: true,
  skills: {
    fireball: { chargeTime: 1.4, range: 20, rMin: 0.8, rMax: 2.4, recover: 0.45 },
    firewall: { chargeTime: 1.5, range: 13, rMin: 3, rMax: 9, recover: 0.5, thick: 1.2, duration: 6 },
    meteor: { chargeTime: 2.4, range: 14, rMin: 2.5, rMax: 6, recover: 0.7 },
    quickShot: { chargeTime: 0.6, range: 26, rMin: 0.45, rMax: 0.45, recover: 0.25 },
    shockArrow: { chargeTime: 1.2, range: 26, rMin: 8, rMax: 18, recover: 0.45, width0: 1.2, width1: 2.0 },
    arrowRain: { chargeTime: 1.8, range: 20, rMin: 2.5, rMax: 5, recover: 0.6 },
    powerSlash: { chargeTime: 1.0, range: 1.2, rMin: 1.6, rMax: 2.6, recover: 0.4 },
    whirlwind: { chargeTime: 0.9, range: 0, rMin: 2, rMax: 3.2, recover: 0.3 },
    shieldCharge: { chargeTime: 1.0, range: 0, rMin: 4, rMax: 9, recover: 0.35, width: 1.6 },
    backstab: { chargeTime: 0.6, range: 4, rMin: 1, rMax: 1.4, recover: 0.3 },
    knives: { chargeTime: 0.7, range: 12, rMin: 15, rMax: 40, recover: 0.3 },
    stealth: { chargeTime: 0.8, range: 0, rMin: 0, rMax: 0, recover: 0.2 },
    summon: { chargeTime: 1.3, range: 10, rMin: 1.2, rMax: 1.2, recover: 0.4 },
    scatter: { chargeTime: 0.5, range: 9, rMin: 20, rMax: 35, recover: 0.3 },
    disengage: { chargeTime: 0, range: 14, rMin: 5, rMax: 5, recover: 0.35 },
    snare: { chargeTime: 0.6, range: 8, rMin: 0.9, rMax: 0.9, recover: 0.3 },
    flare: { chargeTime: 1.0, range: 20, rMin: 3, rMax: 4.5, recover: 0.4 },
    parry: { chargeTime: 0, range: 3, rMin: 3, rMax: 3, recover: 0.35 },
    slam: { chargeTime: 0.9, range: 0, rMin: 2.5, rMax: 3.5, recover: 0.45 },
    leap: { chargeTime: 0.8, range: 8, rMin: 2, rMax: 2.5, recover: 0.3 },
    unyield: { chargeTime: 0, range: 0, rMin: 0, rMax: 0, recover: 0.2 },
    shadowStep: { chargeTime: 0.3, range: 8, rMin: 2, rMax: 2, recover: 0.2 },
    smoke: { chargeTime: 0.7, range: 10, rMin: 3, rMax: 4, recover: 0.3 },
    eviscerate: { chargeTime: 0.5, range: 1.2, rMin: 1.2, rMax: 1.6, recover: 0.35 },
    decoy: { chargeTime: 0, range: 0, rMin: 0, rMax: 0, recover: 0.15 }
  },
  sfx: { on: true, music: false, vol: .6, mvol: .4 },   // 音效 / 音樂(sfx.js):音效開關、音樂開關、音量 0~1
  res: { infinite: false, mpRegen: 6, spRegen: 15, mpDelay: 1.5, spDelay: 1.0, sitMp: 4, sitSp: 3, runCost: 12, airJump: 20, roll: 20, airRoll: 15, reviveHP: 200, downTime: 3 }   // 資源系統(resources.js),隨 CFG 存 localStorage
};
const CFG = JSON.parse(JSON.stringify(DEFAULT_CFG));
const CFG_KEY = 'mageSandbox.cfg.v1';
function mergeCfg(dst, src) { for (const k in src) { if (dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) mergeCfg(dst[k], src[k]); else if (k in dst) dst[k] = src[k]; } }
if (IS_TOUCH) CFG.bloom = false;  // 手機預設關泛光(省效能),可在 P 面板打開
if (IS_TOUCH) CFG.fxq = 0.6;      // 手機預設粒子量 60%(只影響新屬性)
try { const s = JSON.parse(localStorage.getItem(CFG_KEY)); if (s) { if ((s.ver | 0) < 2) { delete s.skills; delete s.rad; delete s.radById; } if ((s.ver | 0) < 3) { delete s.camSens; delete s.camKeyTurn; delete s.touchSens; delete s.padSens; } mergeCfg(CFG, s); CFG.ver = 3; } } catch (e) { }   // ver < 2:舊射程 / 半徑存檔丟棄,改用新預設(B-2 第 6 點)
while (CFG.rad.length < 4) CFG.rad.push(DEFAULT_CFG.rad[CFG.rad.length]);   // 存檔的陣列會整個覆蓋,補回第 4 格(召喚)預設
function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch (e) { } }

// 形狀槽位(kind:bolt 投射 / wall 牆 / sky 大招);名稱與咒語依屬性在 spells.js 的 SPELLS
const SKILLS = [
  { id: 'fireball', name: '火球術', icon: '🔥', el: 'fire', shape: 'circle', kind: 'bolt', aim: 'dir', chant: '火之精靈,聚於我手,化為灼熱之球——燃盡一切!', shout: '火球術!' },
  { id: 'firewall', name: '火牆術', icon: '🧱', el: 'fire', shape: 'wall', kind: 'wall', chant: '烈焰之壁,拔地而起,焚盡來犯之敵——', shout: '火牆術!' },
  { id: 'meteor', name: '隕石術', icon: '☄️', el: 'fire', shape: 'circle', kind: 'sky', chant: '天外星辰,聽我召喚,墜落吧——毀滅之石!', shout: '隕石術!' },
  { id: 'summon', name: '召喚', icon: '✨', el: 'fire', shape: 'circle', kind: 'summon', aim: 'circle', cd: 10, chant: '', shout: '' }
];
const sc = i => CFG.skills[baseOf(i)];   // 招式的數值表鍵(法師 = 自己的 id;職業暫時招式 = 沿用的 base)
// 統一集氣倍率(C-0b)+ 集氣模式(設計 §2):q = 集氣比例 0~1;mode:'A' 變大 / 'B' 變多(只有法師有 mode,其他職業 undefined = 舊公式)
const CHG = {
  dmg:   q => 0.4 + 0.9 * q,                        // 0.40 → 1.30(B0:快放不再比滿集氣強)
  fx:    q => lerp(0.5, 1.0, q),                    // 效果強度:減速%、推 / 拉 / 擊飛距離、暈眩 / 燃燒秒數、易傷%
  dur:   q => 0.7 + 0.6 * (0.35 + 0.65 * q),        // 0.91 → 1.30(持續時間)
  size:  (q, m) => m === 'B' ? 0.6 : lerp(0.6, 1.0, q),           // 範圍(半徑 / 牆長 / 線寬);B 固定在 0% 值
  thick: (q, m) => m === 'A' ? lerp(1.0, 1.25, q) : 1,             // 粗細(牆厚、子彈命中寬、子單位大小);只有 A 成長
  count: (n, q, m) => m === 'A' ? Math.max(1, Math.round(n * Math.pow(lerp(0.6, 1, q), 2)))
                    : m === 'B' ? Math.max(1, Math.round(n * lerp(0.36, 1.5, q)))
                    : Math.max(1, Math.round(n * lerp(0.4, 1.0, q))),   // 子單位數量(石柱 / 聖光柱 / 箭等)
  copies: (N, q, m) => m === 'B' ? 1 + Math.round((N - 1) * q) : 1,      // 本體份數(發數 / 道數 / 顆數 / 隻數):只有 B 成長
  perK: (n, shape) => n > 1 ? ({ bolt: .4, wall: .8, sky: .5, summon: .6 })[shape] : 1   // 份數 > 1 時每份傷害倍率(bolt 0.6 → 0.4,平衡必調 #3)
};
const COPIES_N = { bolt: 5, wall: 4, sky: 3, summon: 2 };   // 各形狀 B 模式份數上限
const curMode = () => G.cls === 'mage' ? G.chgMode : undefined;
// 份數共用實作:對每份呼叫 fn(Pi, i, n);Pi 為 P 的淺拷貝(dmgK 乘 perK、copy = i、ncopy = n);第 i 份延遲 i × delay 秒
function forCopies(P, shape, delay, place, fn) {
  const n = P.copies || 1, k = CHG.perK(n, shape);
  for (let i = 0; i < n; i++) {
    const Pi = Object.assign({}, P, { copy: i, ncopy: n, dmgK: P.dmgK * k, target: P.target.clone() });
    if (place) place(Pi, i, n);
    if (i === 0) fn(Pi, i, n); else after(i * delay, () => fn(Pi, i, n));
  }
}
// 施法者抽象(設計 §2-4):遠端重現時 P 帶施法者資訊;單人 P 沒有這些欄位,退回本機角色(行為不變)
const casterPos = P => P.casterPos || mage.root.position;
const casterAura = P => P.aura || auraEl();
const casterTip = (P, out) => P.tip ? out.copy(P.tip) : mage.tipWorld(out);
const casterYaw = P => P.casterYaw ? P.casterYaw() : mage.yaw;
const pcfg = P => CFG.skills[P.base];
// 決定位置 / 時間的亂數(設計 §2-4):有 P.rng(多人種子)用它,否則 Math.random
const prnd = (P, a, b) => a + (P && P.rng ? P.rng() : Math.random()) * (b - a);
function seedRng(a) { return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// 牆的第 i 道中心(B 模式並排):法線 (−az, ax) 朝遠離施法者的一側,間距 = 牆厚 × thickK + 1 m;第 0 道 = 選定點
function wallCopyPos(T, yaw, i, thick, from) {
  const p = from || mage.root.position, ax = Math.cos(yaw), az = -Math.sin(yaw), nx = -az, nz = ax;
  const sg = Math.sign(nx * (T.x - p.x) + nz * (T.z - p.z)) || 1, o = i * (thick + 1) * sg;
  const x = T.x + nx * o, z = T.z + nz * o;
  return new V3(x, surfaceY(x, z, T.y + 1), z);
}
function wallPlace(Pi, i) {
  if (!i) return;
  Pi.target = wallCopyPos(Pi.target, Pi.wallYaw, i, pcfg(Pi).thick * Pi.thickK, casterPos(Pi));
}

// 換裝差異(法杖=重擊、魔法書=速唱);集氣時間與僵直只受 chargeMul / recoverMul 影響
const WEAPONS = {
  staff: { name: '法杖', tag: '重擊', chargeMul: 1.0, dmgMul: 1.2, rangeMul: 1.10, recoverMul: 1.0 },
  book:  { name: '魔法書', tag: '速唱', chargeMul: 0.7, dmgMul: 1.0, rangeMul: 1.0, recoverMul: 0.7 }
};
const NEUTRAL_W = { name: '', tag: '', chargeMul: 1, dmgMul: 1, rangeMul: 1, recoverMul: 1 };   // 非法師職業不套用法杖 / 書倍率
const NEUTRAL_EL = { chargeMul: 1, rangeMul: 1, speedMul: 1 };
const W = () => G.cls === 'mage' ? WEAPONS[G.weapon] : NEUTRAL_W;
const elm = () => G.cls === 'mage' ? ELMOD[G.el] : NEUTRAL_EL;   // ELMOD 在 spells.js(執行期才讀)
const skillRange = () => (G.skill >= 0 && curSkill(G.skill).aim === 'line' ? Math.max(sc(G.skill).range, skillRad()) : sc(G.skill).range) * W().rangeMul * elm().rangeMul * (CFG.rangeK || 1);
const chargeTimeEff = () => sc(G.skill).chargeTime * W().chargeMul * elm().chargeMul * (G.stanceBoostT > 0 ? 1 / 1.5 : 1) * (typeof swChargeK === 'function' ? swChargeK() : 1);   // 劍士:格擋成功瞬間滿 / 盾擊連段 ×0.4(skills_sword.js)
function weaponDesc() {
  const w = W(), parts = [];
  if (w.chargeMul !== 1) parts.push('集氣×' + w.chargeMul);
  if (w.dmgMul !== 1) parts.push('傷害×' + w.dmgMul);
  if (w.rangeMul !== 1) parts.push('射程×' + w.rangeMul);
  if (w.recoverMul !== 1) parts.push('僵直×' + w.recoverMul);
  return parts.length ? ' ' + parts.join(' ') : '';
}

const G = {
  skill: 0, state: 'ready', chargeT: 0, charge: 0, castT: 0, pending: null, launched: false, queued: false,
  target: new V3(0, 0, 8), wallOff: 0, weapon: 'staff', camYaw: Math.PI, camPitch: 0.42, zoom: 1, camD: CFG.camDist,
  focus: new V3(0, 1.5, 0), shake: 0, mouse: { x: innerWidth / 2, y: innerHeight * 0.4 }, keys: {}, orb: null, rmb: false,
  stick: { x: 0, y: 0, mag: 0 }, stickHold: new V3(0, 0, 8), inputMode: IS_TOUCH ? 'stick' : 'mouse', lastTouch: 0,
  ground: true, groundY: 0, airJumps: 1, airRolls: 1, coyote: 0, jumpBuf: 0, flip: -1, lastSkill: 0,
  roll: null, rollCD: 0, invuln: false, stun: 0, dodged: 0, hits: 0, autoStrike: false, strikeT: 2,
  time: 0, cb: 0, kick: 0, vy: 0, frameT: 0, hover: 0, auraAmt: 0, maxFlash: false, halfFlash: false, shoutT: 0, atkHeld: false,
  cls: 'mage', cd: {}, stealth: null, weak: 0, dash: null, spin: null, px0: 0, pz0: 0, py0: 0, camK: 1, camLift: 0, lookX: 0, lookY: 0, aimFar: false, hurtFrom: null, rmbLock: false, rmbEnd: false, lockErr: false,
  el: 'fire', chgMode: 'A', hp: 100, hpMax: 100, shield: 0, shieldT: 0, downs: 0, slowImmT: 0, mp: 100, mpMax: 100, sp: 100, spMax: 100, mpIdle: 0, spIdle: 0, runLock: false, sitK: 0, sitting: false, down: 0, downK: 0, invulnT: 0, kvx: 0, kvz: 0, slowT: 0, slowPct: 0, burnT: 0, erodeT: 0, litT: 0, lastHitBy: 0, lastHitK: null, lastHitT: 0, tp: 0, stance: 0, stanceCd: 0, stanceBoostT: 0, cr: 0, crIdle: 0, parryT: 0, unyT: 0, ccLog: []   // 非法師:架勢 stance(0/1)、冷卻、加速計時;職業能量 cr;不屈 / 格擋計時;多人控制紀錄 ccLog。 // 目前屬性(C-8,只有法師使用),存 localStorage mageSandbox.el;chgMode = 集氣模式 A/B;hp / shield / downs = S-6 玩家狀態
};
try { const v = localStorage.getItem('mageSandbox.el'); if (EL_ORDER.includes(v)) G.el = v; } catch (e) { }
try { const m = localStorage.getItem('mageSandbox.chgMode'); if (m === 'A' || m === 'B') G.chgMode = m; } catch (e) { }

/* ================= 角色與場景物件 ================= */
const mage = new Mage(scene);
mage.setElementColor(EL[G.el].hex);
const ind = new Indicator(scene);
const indPool = [new Indicator(scene), new Indicator(scene), new Indicator(scene), new Indicator(scene)];   // 集氣 B 牆的多道預覽(第 1~3 道用)
function hideIndPool() { indPool.forEach(w => w.hide()); }
const tmpV = new V3(), tmpV2 = new V3(), tmpV3 = new V3();

// 施法時角色身上的光環與腳下魔法陣(顏色跟目前屬性)
const rings = [];
for (let i = 0; i < 3; i++) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(.8, .015, 6, 64), new THREE.MeshBasicMaterial({ color: EL[G.el].hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  mage.root.add(m); rings.push(m);
}
const runeGrp = new THREE.Group(); mage.root.add(runeGrp);
const runeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: RUNE_TEX, color: EL[G.el].hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
runeMesh.rotation.x = -Math.PI / 2; runeMesh.position.y = .06; runeGrp.add(runeMesh);

/* ================= 後製(泛光) ================= */
let composer = null, bloom = null;
function setupComposer() {
  if (!(THREE.EffectComposer && THREE.UnrealBloomPass && THREE.RenderPass)) return;
  composer = new THREE.EffectComposer(renderer);
  composer.addPass(new THREE.RenderPass(scene, camera));
  bloom = new THREE.UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), CFG.bloomStrength, .55, .78);
  composer.addPass(bloom);
}
setupComposer();
const aimCam = camera.clone();   // 瞄準用相機(不加震動、不進 scene;updateCamera 每格同步姿態)
let CAM_FOV0 = camera.fov, ADS_FOV_K = .12;   // 基準 FOV(world.js 58;直向由 applyFov 換算)與弓箭手集氣滿時縮小比例(派工單未給數字,待確認)
// 直向 FOV:aspect<1 時水平視野 = 16:9 時的水平視野,垂直 FOV 上限 95°;aspect>=1 維持 58(橫向與桌機不變)
const FOV_LAND = 58, FOV_REF_ASPECT = 16 / 9, FOV_PORTRAIT_MAX = 95;
function applyFov() {
  const a = innerWidth / innerHeight;
  let f = FOV_LAND;
  if (a < 1) f = Math.min(FOV_PORTRAIT_MAX, 2 * Math.atan(Math.tan(FOV_LAND * Math.PI / 360) * FOV_REF_ASPECT / a) * 180 / Math.PI);
  CAM_FOV0 = f;
  camera.fov = f; camera.aspect = a; camera.updateProjectionMatrix();
  aimCam.fov = f; aimCam.aspect = a; aimCam.updateProjectionMatrix();   // aimCam 維持基準 FOV,集氣縮放只作用於 camera,瞄準不變
}
function onResize() {
  renderer.setSize(innerWidth, innerHeight); applyFov();
  if (composer) { composer.setSize(innerWidth, innerHeight); }
  const u = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
  fire.mat.uniforms.uScale.value = u; smoke.mat.uniforms.uScale.value = u;
}
addEventListener('resize', onResize); onResize();

/* ================= 輸入 ================= */
addEventListener('keydown', e => {
  if (window.COVER_ON || (window.NETON && window.NET_LOCK)) return;   // 封面期間與多人開戰倒數不處理遊戲輸入
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'AltLeft' || e.code === 'AltRight') { e.preventDefault(); if (document.pointerLockElement === gameCv) document.exitPointerLock(); return; }   // 按住 Alt 暫時釋放滑鼠(點 UI 用;點畫面即回到遊戲)
  if (['Tab', 'Space'].includes(e.code)) e.preventDefault();
  if (e.ctrlKey && ['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract', 'Numpad0'].includes(e.code)) { e.preventDefault(); if (e.code === 'Digit0' || e.code === 'Numpad0') G.zoom = 1; else G.zoom = clamp(G.zoom * (e.code === 'Equal' || e.code === 'NumpadAdd' ? .85 : 1.18), .28, 1.9); return; }
  if (!e.ctrlKey && !e.altKey && e.code === 'KeyB' && !window.COVER_ON) { G.zoom = G.zoom > .4 ? .3 : 1; return; }   // B:近距離視角(接近第一人稱、仍看得到角色)/ 恢復
  if (!e.ctrlKey && !e.altKey && (e.code === 'BracketLeft' || e.code === 'BracketRight') && !window.COVER_ON) { G.zoom = clamp(G.zoom * (e.code === 'BracketLeft' ? .85 : 1.18), .28, 1.9); return; }
  if (e.repeat) return;
  if (e.code === 'KeyC' || e.code === 'Home') { resetCam(); return; }   // 鏡頭重置
  G.keys[e.code] = true;
  const dg = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[e.code];
  const de = { Digit4: 0, Digit5: 1, Digit6: 2, Digit7: 3, Digit8: 4, Digit9: 5, Numpad4: 0, Numpad5: 1, Numpad6: 2, Numpad7: 3, Numpad8: 4, Numpad9: 5 }[e.code];
  if (dg != null) selectSkill(dg);
  else if (de != null) setElement(EL_ORDER[de]);
  else if (e.code === 'KeyZ') cycleElement(-1);
  else if (e.code === 'KeyV') cycleElement(1);
  else if (e.code === 'Tab') toggleWeapon();
  else if (e.code === 'Escape' || e.code === 'KeyX') { if (G.state === 'charging') cancelCharge(); else if (G.state === 'ready') G.skill = -1; }
  else if (e.code === 'KeyP') document.getElementById('panel').classList.toggle('on');
  else if (e.code === 'KeyH') { const h = document.getElementById('hint'); h.style.display = h.style.display === 'none' ? '' : 'none'; }
  else if (e.code === 'KeyR') resetWorld();
  else if (e.code === 'Space') doJump();
  else if (e.code === 'KeyF') tryRoll();
  else if (e.code === 'KeyM') toggleSit();
  else if (e.code === 'KeyK') cycleClass(1);
  else if (e.code === 'KeyG') toggleChgMode();
  else if (e.code === 'Backquote') selectSkill(3);
});
addEventListener('keyup', e => { G.keys[e.code] = false; });
addEventListener('blur', () => { G.keys = {}; G.atkHeld = false; if (G.state === 'charging') cancelCharge(); });
addEventListener('contextmenu', e => e.preventDefault());
const fromTouch = () => performance.now() - G.lastTouch < 800;  // 觸控後瀏覽器會補發假滑鼠事件,忽略
function doJump() {
  if (G.state !== 'ready' || G.roll || G.stun > 0 || G.down > 0 || G.rootT > 0) return;   // 定身中不能跳(狀態效果文件 §1-2 #4)
  if (G.sitting) sitBreak('jump');
  if (G.ground || G.coyote > 0) { sfx.play('jump'); G.vy = CFG.jumpV; G.ground = false; G.coyote = 0; return; }
  if (G.airJumps > 0) { if (!resUse('sp', CFG.res.airJump)) return; sfx.play('jump'); G.airJumps = 0; G.vy = CFG.airJumpV; G.flip = 0; airStepFx(mage.root.position); return; }
  G.jumpBuf = 0.12;
}
function moveInput() {
  const K = G.keys, ix = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0), iz = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0);
  if (ix || iz) return { ix, iz, s: 1, run: !!(K.ShiftLeft || K.ShiftRight) };
  if (G.stick.mag > .12) return { ix: G.stick.x / G.stick.mag, iz: -G.stick.y / G.stick.mag, s: Math.min(1, G.stick.mag * 1.15), run: G.stick.mag > .92 };
  return { ix: 0, iz: 0, s: 0, run: false };
}
/* 鏡頭操作:pointer lock 與視角輸入(設計_鏡頭360操作 §2-1、§2-2) */
const gameCv = renderer.domElement;
const isLocked = () => document.pointerLockElement === gameCv || window.CAM_FAKE_LOCK === true;   // CAM_FAKE_LOCK 為測試掛鉤
const aimLock = () => !!CFG.camLock && isLocked();   // 準心模式且真的鎖定中
function lockNow() { try { const r = gameCv.requestPointerLock({ unadjustedMovement: true }); if (r && r.catch) r.catch(() => { try { gameCv.requestPointerLock(); } catch (e) { } }); } catch (e) { gameCv.requestPointerLock(); } }
// 所有視角來源(滑鼠 / 觸控 / 手把 / Q E)都經這裡,由 updateCamera 統一做平滑與俯仰限制
function addLook(dYaw, dPitch) { G.lookX += dYaw; G.lookY += dPitch * (CFG.camInvY ? -1 : 1); }
addEventListener('mousemove', e => {
  if (fromTouch()) return; G.inputMode = 'mouse';
  if (aimLock() || G.rmb) {   // 準心模式 / 右鍵拖曳:視角由 movementX/Y 驅動,游標位置凍結
    if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;   // Chrome 在 Windows 偶發位移尖峰
    const vk = aimLock() && G.camPitch < .25 ? lerp(.5, 1, clamp((G.camPitch + .1) / .35, 0, 1)) : 1;   // 近水平垂直減速,遠距瞄準不跳
    addLook(-e.movementX * CFG.camSens, e.movementY * CFG.camSens * vk);
    return;
  }
  G.mouse.x = e.clientX; G.mouse.y = e.clientY;
});
addEventListener('mousedown', e => {
  if (window.COVER_ON || (window.NETON && window.NET_LOCK)) return;
  if (e.target.tagName !== 'CANVAS' || fromTouch()) return;
  G.inputMode = 'mouse';
  if (CFG.camLock && e.isTrusted && !isLocked() && e.button === 0) { lockNow(); return; }   // 準心模式:未鎖定時的真實點擊只負責鎖定,不集氣
  if (e.button === 2) {
    if (aimLock()) { if (G.state === 'charging') cancelCharge(); return; }   // 準心模式:右鍵只用來取消集氣
    G.rmb = true; if (!isLocked()) { G.rmbLock = true; lockNow(); }   // 游標模式:右鍵拖曳暫時鎖定滑鼠(可無限轉)
  }
  if (e.button === 0) { G.atkHeld = true; startCharge(); }
});
addEventListener('mouseup', e => {
  if (e.button === 0) G.atkHeld = false;
  if (fromTouch()) return;
  if (e.button === 2) { G.rmb = false; if (G.rmbLock && document.pointerLockElement === gameCv) { G.rmbLock = false; G.rmbEnd = true; document.exitPointerLock(); } }   // 鎖定尚未生效時留給 pointerlockchange 解除
  if (e.button === 0 && G.state === 'charging') { if (G.chargeT < CFG.minHold) G.queued = true; else release(); }
});
document.addEventListener('pointerlockchange', () => {
  if (isLocked()) {
    G.lockErr = false;
    if (!G.rmb && G.rmbLock) { G.rmbLock = false; G.rmbEnd = true; document.exitPointerLock(); }   // 右鍵已放開但鎖定稍後才生效:立刻解鎖
    return;
  }
  const quiet = G.rmbEnd; G.rmbEnd = false; G.rmb = false; G.rmbLock = false;
  if (!quiet) { G.atkHeld = false; if (G.state === 'charging') cancelCharge(); }   // 失鎖(Esc / Alt / P 面板)時取消集氣(設計 §2-1)
});
document.addEventListener('pointerlockerror', () => { G.lockErr = true; G.rmbLock = false; });
addEventListener('wheel', e => {
  if (window.COVER_ON) return;
  if (e.ctrlKey) e.preventDefault();   // 擋瀏覽器頁面縮放(Ctrl+滾輪)
  if (e.target.tagName !== 'CANVAS') return;
  e.preventDefault();
  if (G.skill >= 0 && !e.ctrlKey && (G.state === 'ready' || G.state === 'charging')) {
    const c = sc(G.skill), step = (c.rMax - c.rMin) / 14;
    setRad(G.skill, clamp(getRad(G.skill) - Math.sign(e.deltaY) * step, c.rMin, c.rMax)); saveCfgSoon();
  } else G.zoom = clamp(G.zoom * (1 + Math.sign(e.deltaY) * .1), .28, 1.9);
}, { passive: false });
let saveTimer = 0; function saveCfgSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveCfg, 400); }

function selectSkill(i) {
  if (i >= skillCount()) return;
  if (G.cls !== 'mage' && curSkill(i).instant && (G.state === 'ready' || G.state === 'charging')) { castInstant(i); return; }   // 瞬發招(非法師):按下即發動
  if (G.state !== 'ready') return;
  if (G.skill === i) G.skill = -1; else setSkill(i);
}
// 設定目前法術(不切換):記錄 lastSkill,並把牆角度歸零
function setSkill(i) { if (G.state !== 'ready') return; G.skill = i; G.lastSkill = i; G.wallOff = 0; }
// 手把 L / R:未選法術時選回上次那一招;已選則前後換一招
function cycleSkill(d) { if (G.skill < 0) setSkill(G.lastSkill); else setSkill((G.skill + d + skillCount()) % skillCount()); }
function toggleAuto() {
  if (window.NETON) return;   // 多人對戰中停用自動來襲(見 strike)
  G.autoStrike = !G.autoStrike; G.strikeT = 1; banner('自動來襲 ' + (G.autoStrike ? 'ON' : 'OFF'), '#ffe3b0'); }
// 集氣模式(設計 §2-5):G 鍵 / 手機 #btnMode / 手把十字上;只套法師;全域一個,存 localStorage
function toggleChgMode() {
  if (G.cls !== 'mage') { banner('此職業無集氣模式', '#ffc46b'); return; }
  G.chgMode = G.chgMode === 'A' ? 'B' : 'A'; try { localStorage.setItem('mageSandbox.chgMode', G.chgMode); } catch (e) { }
  banner(G.chgMode === 'A' ? '集氣模式 A:變大' : '集氣模式 B:變多', '#ffe3b0');
  burstRing(mage.root.position, auraEl().hex, 1.0); syncModeUI();
}
let _modeKey = '';
// #modeTag(桌機)與 #btnMode(手機)依模式與職業顯示;只在變動時寫 DOM
function syncModeUI() {
  const on = G.cls === 'mage', key = on ? G.chgMode : '-';
  if (key === _modeKey) return; _modeKey = key;
  const A = G.chgMode === 'A', col = A ? '#ffc46b' : '#8fd0ff';
  const tag = document.getElementById('modeTag'), bt = document.getElementById('btnMode');
  if (tag) { tag.style.display = on ? '' : 'none'; tag.innerHTML = '<img src="assets/icons/' + (A ? 'ui_mode_big' : 'ui_mode_many') + '.png" alt="' + (A ? 'A' : 'B') + '" style="width:24px;height:24px;object-fit:contain">' + (A ? '<small>變大</small>' : '<small>變多</small>'); tag.style.borderColor = col; }
  if (bt) { bt.style.display = on ? '' : 'none'; bt.innerHTML = '<img class="bi" src="assets/icons/' + (A ? 'ui_mode_big' : 'ui_mode_many') + '.png" alt="' + (A ? 'A 大' : 'B 多') + '">'; bt.style.borderColor = col; bt.style.color = col; }
}
// #chargeTxt 第三段:A = 範圍 / 厚度;B = 份數(copies)或數量(count)
function modeTxt(q) {
  if (!curMode()) return '';
  const k = curSkill(G.skill).kind, sp = spellOf(G.skill);
  if (G.chgMode === 'A') return 'A 範圍 ' + Math.round(CHG.size(q, 'A') * 100) + '% 厚 ×' + CHG.thick(q, 'A').toFixed(2);
  if (sp.unit === 'count') return 'B 數量 ' + CHG.count(sp.cntN || 10, q, 'B');
  return 'B ×' + CHG.copies(COPIES_N[k] || 1, q, 'B') + ' ' + (sp.unitName || { bolt: '發', wall: '道', sky: '個', summon: '隻' }[k] || '');
}
// 玩家受擊 / 倒下 / 復活 / 治癒:見 resources.js(playerHurt / playerDown / playerRevive / playerHeal)
function resetCam() { G.zoom = 1; G.camPitch = .42; G.camYaw = mage.yaw + Math.PI; G.lookX = G.lookY = 0; }   // 轉到角色背後
function toggleWeapon() {
  if (G.cls !== 'mage') { if (G.state === 'charging') cancelCharge(); else toggleStance(); return; }   // 非法師:Tab / X / 換裝鈕 = 切換架勢(集氣中 = 取消)
  if (G.state !== 'ready') return;
  G.weapon = G.weapon === 'staff' ? 'book' : 'staff'; mage.setWeapon(G.weapon); banner(W().name + '・' + W().tag, '#ffc46b');
}
// 範圍記憶:法師用 CFG.rad[槽位];其他職業用 CFG.radById[招式 id]
function getRad(i) { if (G.cls === 'mage') return CFG.rad[i]; const c = sc(i), v = CFG.radById[curSkill(i).id]; return v == null ? (c.rMin + c.rMax) / 2 : v; }
function setRad(i, v) { if (G.cls === 'mage') CFG.rad[i] = v; else CFG.radById[curSkill(i).id] = v; }
function skillRad() { const c = sc(G.skill), K = CFG.radK || 1; return clamp(getRad(G.skill) * K, c.rMin * K, c.rMax * K); }
// 屬性切換(C-8):只在 ready 生效;保留目前形狀
function setElement(el) {
  if (window.NETON && !window.NET_PROFILE_CHANGE) return;   // 多人對戰中鎖定屬性(設計 §5-6、§6-2)
  if (G.cls !== 'mage' || G.state !== 'ready' || G.el === el || !EL[el]) return;
  G.el = el; try { localStorage.setItem('mageSandbox.el', el); } catch (e) { }
  applyElColors(); refreshHotbar(); burstRing(mage.root.position, EL[el].hex, 1.6);
  banner(EL[el].name + '屬性', EL[el].css0);
}
function cycleElement(d) { const i = EL_ORDER.indexOf(G.el); setElement(EL_ORDER[(i + d + EL_ORDER.length) % EL_ORDER.length]); }
// 屬性色同步到角色杖頭 / 書、腳下魔法陣與施法光環
function applyElColors() {
  const hex = auraEl().hex; mage.setElementColor(hex);
  rings.forEach(m => m.material.color.setHex(hex)); runeMesh.material.color.setHex(hex);
}

/* ================= 側翻滾(短暫無敵)與來襲測試 ================= */
function tryRoll() {
  const p = mage.root.position;
  if (G.rollCD > 0 || G.roll || G.stun > 0 || G.dash || G.spin) return;
  if (G.state === 'cast' && !G.launched) return;
  const air = !G.ground;
  if (air && G.airRolls <= 0) return;
  if (G.down > 0) return;
  if (!resUse('sp', air ? CFG.res.airRoll : (danceOn() ? 12 : CFG.res.roll))) return;   // 影舞架勢翻滾 SP 12(刺客被動)
  if (G.burnT > 0) G.burnT = Math.max(0, G.burnT - ST.rollBurnCut);   // 翻滾甩掉火焰:灼燒剩餘 -1 s(§1-2 #7)
  if (G.sitting) sitBreak('roll');
  if (G.state === 'charging') cancelCharge();
  G.state = 'ready';
  const mi = moveInput(); let ix = mi.ix, iz = mi.iz, dx, dz;
  if (ix || iz) {
    const l = Math.hypot(ix, iz); ix /= l; iz /= l;
    dx = -Math.sin(G.camYaw) * iz + Math.cos(G.camYaw) * ix; dz = -Math.cos(G.camYaw) * iz - Math.sin(G.camYaw) * ix;
  } else { dx = -Math.cos(mage.yaw); dz = Math.sin(mage.yaw); }  // 沒按方向:往角色右側翻
  if (air) { G.airRolls = 0; G.vy = 0; }
  { const ch = G.time - (G.rollAt || -9) < 1.6 ? Math.min(3, (G.rollChain | 0) + 1) : 0; G.rollChain = ch; G.rollAt = G.time; G.rollWinK = [1, .6, .35, .2][ch]; }   // 連續翻滾:閃避窗逐次縮短(防狂翻滾)
  G.roll = { t: 0, dx, dz, phi: angDiff(mage.yaw, Math.atan2(dx, dz)), dist: air ? CFG.airRollDist : CFG.rollDist, time: air ? CFG.airRollTime : CFG.rollTime, air, dance: !air && danceOn() };
  sfx.play('roll');
  if (G.roll.dance) G.danceT = .8;   // 影舞翻滾:0.8 s 內的下一刀(背刺 / 割喉)×1.2(skills.js / skills_assassin.js)
  if (!G.stealth) for (let i = 0; i < 6; i++) smoke.emit(p.x + rnd(-.3, .3), p.y + .15, p.z + rnd(-.3, .3), rnd(-1, 1), rnd(.3, 1), rnd(-1, 1), rnd(.5, .9), rnd(.8, 1.4), [.5, .45, .4], [.3, .3, .3], .4, 2, 0, 1.5);
}
function banner(txt, color) {
  sfx.play('banner', { txt });
  const b = document.getElementById('banner'); b.textContent = txt; b.style.color = color; b.style.opacity = 1; b._t = 1.2;
}
// 完美閃避(設計_縮範圍與第一人稱 C-3,派工單①):翻滾無敵窗內閃掉來襲 → SP 回復、0.3 s 小幅加速、橫幅;同一次翻滾只給一次獎勵
// 數值為派工單指定(設計文件為 SP 10 與下一招集氣 ×1.3 速 1.5 s,待確認)
const PERF = { sp: 8, t: .3, spdK: 1.15 };
function perfectDodge() {
  if (!G.roll || G.invulnT > 0) return false;   // 只認翻滾窗;復活無敵不算
  if (G.roll.pd) return true;
  G.roll.pd = true; G.perfT = PERF.t; G.sp = Math.min(G.spMax, G.sp + PERF.sp);
  banner('完美閃避!', '#ffe27a'); return true;
}
// 受擊方向(設計 C-9,派工單②):來源座標換算成相對視線的角度(0° = 正前、順時針),#hurtDir 旋轉後顯示一道紅弧
function showHurtDir(x, z) {
  const p = mage.root.position, dx = x - p.x, dz = z - p.z, s = Math.sin(G.camYaw), c = Math.cos(G.camYaw);
  const el = document.getElementById('hurtDir'); if (!el || (dx === 0 && dz === 0)) return;
  const fwd = -s * dx - c * dz, rgt = c * dx - s * dz;   // 視線前方 (-sin, -cos)、右方 (cos, -sin)
  el.style.setProperty('--hd', (Math.atan2(rgt, fwd) * 180 / Math.PI).toFixed(1) + 'deg');
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
}
function strike() {
  if (window.NETON) return;   // 多人:來襲是本機測試用,會直接扣自己血、不經過攻擊者判定,對戰中停用(T / Y / 來襲鈕 / 手把 Y)
  const p = mage.root.position, S = G.stealth, pos = S ? new V3(S.x, surfaceY(S.x, S.z, p.y + .5), S.z) : new V3(p.x, surfaceY(p.x, p.z, p.y + .5), p.z), R = 2.4, W = 1.2, wi = new Indicator(scene); let t = 0;
  addFx(dt => {
    t += dt;
    if (t < W) { wi.set(pos.x, pos.z, 0, R, 0, 0, t / W, .9, 0xff2030, pos.y); wi.tick(G.time); return true; }
    wi.root.parent.remove(wi.root);
    explode(pos, R, .8, { dmg: 0, gy: pos.y }); G.shake = Math.max(G.shake, .25 * CFG.shake);
    if (typeof summonsHitArea === 'function') summonsHitArea(pos, R, 30);   // 召喚物也會被來襲打到
    const q = mage.root.position, inside = Math.hypot(q.x - pos.x, q.z - pos.z) < R && Math.abs(q.y - pos.y) < 3;
    if (inside && q.y - pos.y >= 1.2) { G.dodged++; banner('跳躍閃避!', '#8fe8ff'); }
    else if (inside && G.invuln) { G.dodged++; if (!perfectDodge()) banner('翻滾閃避!', '#8fe8ff'); }
    else if (inside && (G.invulnT > 0 || G.down > 0)) { G.dodged++; if (G.invulnT > 0) banner('復活無敵!', '#8fe8ff'); }
    else if (inside && typeof swParryStrike === 'function' && swParryStrike(pos.x, pos.z)) { G.dodged++; banner('格擋!', '#ffd27a'); }   // 劍士格擋窗(skills_sword.js)
    else if (inside && shieldOn()) { G.dodged++; banner('盾擋!', '#ffd27a'); }
    else if (!inside) { G.dodged++; if (S) banner('目標遺失', '#c08aff'); else banner('走位躲開', '#bff0a0'); }
    else {
      if (G.stealth) revealStealth('hit');   // 潛行中被紅圈炸到:顯形
      G.hits++;
      if (!playerHurt(30 * swHitK(q.x - pos.x, q.z - pos.z), 'strike').blocked) { /* 盾勢正面 ×0.7(swHitK) */ const f = document.getElementById('flash'); f.style.opacity = .6; setTimeout(() => f.style.opacity = 0, 120); showHurtDir(pos.x, pos.z); }
      if (G.state === 'charging') cancelCharge();
    }
    return false;
  });
}

/* ================= 瞄準:滑鼠 → 地面 ================= */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), gPlane = new THREE.Plane(new V3(0, 1, 0), 0);
function pickGround(out) {
  const p = mage.root.position;
  ndc.set(G.mouse.x / innerWidth * 2 - 1, -(G.mouse.y / innerHeight * 2 - 1)); ray.setFromCamera(ndc, aimCam);
  const o = ray.ray.origin, d0 = ray.ray.direction;
  let best = rayTerrain(o, d0, 1e4), hx = 0, hz = 0, hy = 0;   // 1e4 = 原本無上限(平地行為相同)
  if (best < Infinity) { hx = o.x + d0.x * best; hz = o.z + d0.z * best; hy = o.y + d0.y * best; }
  for (const P of PLATFORMS) {   // 高台頂面也參與取最近交點(只決定 xz)
    if (d0.y >= -1e-4) continue;
    let t = (P.top - o.y) / d0.y;
    if (P.kind === 'bridge') for (let k = 0; k < 2; k++) t = (platTop(P, o.x + d0.x * t, o.z + d0.z * t) - o.y) / d0.y;   // 下垂修正
    if (t < 0 || t >= best) continue;
    const x = o.x + d0.x * t, z = o.z + d0.z * t;
    if (platContains(P, x, z, 0)) { best = t; hx = x; hz = z; hy = o.y + d0.y * t; }
  }
  G.aimFar = best === Infinity;   // 打到天空 = 最遠
  if (best === Infinity) { aimCam.getWorldDirection(tmpV2); hx = p.x + tmpV2.x * skillRange(); hz = p.z + tmpV2.z * skillRange(); hy = p.y; }
  tmpV.set(hx, 0, hz);
  let dx = tmpV.x - p.x, dz = tmpV.z - p.z, d = Math.hypot(dx, dz);
  const minD = curSkill(G.skill).shape === 'wall' ? 2 : 1.2;
  if (d < 1e-4) { dx = Math.sin(mage.yaw); dz = Math.cos(mage.yaw); d = 1; }
  G.aimFar = G.aimFar || d > skillRange();
  let dd = clamp(d, minD, skillRange()), yRef = dd === d ? hy : p.y + 2;
  if (aimLock() && G.skill >= 0 && d < 2.5 && ['dir', 'line', 'front'].includes(curSkill(G.skill).aim)) {   // 準心近距:低頭看腳下時方向改用鏡頭前方,避免指向角色側面
    dx = -Math.sin(G.camYaw); dz = -Math.cos(G.camYaw); dd = clamp(Math.max(d, minD), minD, skillRange()); yRef = p.y + 2; d = 1;
  }
  const ox = p.x + dx / d * dd, oz = p.z + dz / d * dd; out.set(ox, surfaceY(ox, oz, yRef), oz);
}

// 搖桿/觸控瞄準:集氣時左搖桿的方向=光圈方向、推多少=離多遠;放開搖桿則光圈停在原地
// 方向型(第 1 招 aim 'dir'):只取方向、距離固定 range × .6,推過 .3 才更新方向(手機 / 手把;設計 §1-2)
// 集氣中可移動(劍士 / 刺客 / 游擊弓手):瞄準方向 = 搖桿(=移動)方向;放開搖桿後保留相對鏡頭的角度,拖曳 / 右搖桿轉視角時一起轉
function mcAimYaw() {
  if (G.stick.mag > .3) {
    const ix = G.stick.x / G.stick.mag, iz = -G.stick.y / G.stick.mag;
    const fx = -Math.sin(G.camYaw), fz = -Math.cos(G.camYaw), rx = Math.cos(G.camYaw), rz = -Math.sin(G.camYaw);
    G.mcOff = Math.atan2(fx * iz + rx * ix, fz * iz + rz * ix) - G.camYaw;
  }
  return G.camYaw + (G.mcOff == null ? Math.PI : G.mcOff);
}
function pickStick(out) {
  const p = mage.root.position, mc = moveCharge(), dirA = G.skill >= 0 && curSkill(G.skill).aim === 'dir';
  if (mc && G.state === 'charging') {
    const yw = mcAimYaw(), d = Math.max(2, skillRange() * (dirA ? .6 : .5)), x = p.x + Math.sin(yw) * d, z = p.z + Math.cos(yw) * d;
    G.stickHold.set(x, surfaceY(x, z, p.y + 2), z); out.copy(G.stickHold); return;
  }
  if (dirA) {
    if (G.state === 'charging' && G.stick.mag > .3) {
      const ix = G.stick.x / G.stick.mag, iz = -G.stick.y / G.stick.mag;
      const fx = -Math.sin(G.camYaw), fz = -Math.cos(G.camYaw), rx = Math.cos(G.camYaw), rz = -Math.sin(G.camYaw);
      const dx = fx * iz + rx * ix, dz = fz * iz + rz * ix, d = skillRange() * .6;
      const x = p.x + dx * d, z = p.z + dz * d; G.stickHold.set(x, surfaceY(x, z, p.y + 2), z);
    } else if (G.state !== 'charging' || mc) {   // 集氣中可移動(劍士 / 刺客)且搖桿沒推:朝鏡頭前方,角色才會跟著視角左右轉
      const yw = mc && G.state === 'charging' ? G.camYaw + Math.PI : mage.yaw;
      const x = p.x + Math.sin(yw) * skillRange() * .5, z = p.z + Math.cos(yw) * skillRange() * .5; G.stickHold.set(x, surfaceY(x, z, p.y + 2), z);
    }
    out.copy(G.stickHold); return;
  }
  if (G.state === 'charging' && G.stick.mag > .15 && !mc) {
    const ix = G.stick.x / G.stick.mag, iz = -G.stick.y / G.stick.mag;
    const fx = -Math.sin(G.camYaw), fz = -Math.cos(G.camYaw), rx = Math.cos(G.camYaw), rz = -Math.sin(G.camYaw);
    const dx = fx * iz + rx * ix, dz = fz * iz + rz * ix, minD = curSkill(G.skill).shape === 'wall' ? 2 : 1.2;
    const d = lerp(minD, skillRange(), Math.min(1, G.stick.mag));
    const x = p.x + dx * d, z = p.z + dz * d; G.stickHold.set(x, surfaceY(x, z, p.y + 2), z);
  } else if (G.state === 'ready' || mc) {
    const yw = mc && G.state === 'charging' ? G.camYaw + Math.PI : mage.yaw;   // 集氣中可移動:面向鏡頭前方(拖曳 / 右搖桿轉視角 = 角色左右轉)
    const x = p.x + Math.sin(yw) * skillRange() * .5, z = p.z + Math.cos(yw) * skillRange() * .5; G.stickHold.set(x, surfaceY(x, z, p.y + 2), z);
  }
  out.copy(G.stickHold);
}

/* ================= 施法狀態機 ================= */
function startCharge() {
  if (G.state !== 'ready' || G.roll || G.stun > 0 || G.down > 0) return;
  if (G.skill < 0) G.skill = G.lastSkill;
  if (G.cls !== 'mage' && curSkill(G.skill).instant) { castInstant(G.skill); return; }   // 瞬發招(非法師):按下即發動
  if (curSkill(G.skill).stub) { banner('尚未實作', '#ffc46b'); return; }   // S 批空殼:尚未實作的招式不進入集氣
  if (G.cd[curSkill(G.skill).id] > 0 || skillBlocked(curSkill(G.skill))) return;   // 冷卻中 / 虛弱中不能開始集氣
  { const c = skillCost(G.skill); if (!resCan(c.kind, costAt(c.base, 0))) { resDeny(c.kind); return; } }   // MP / SP 不夠 → 不進入集氣
  if (G.sitting) sitBreak('cast');
  G.mcOff = Math.PI; G.state = 'charging'; G.chargeT = 0; G.charge = 0; G.queued = false; G.maxFlash = false; G.halfFlash = false;
  sfx.loop('charge', true);
  { const p = mage.root.position, x = p.x + Math.sin(mage.yaw) * skillRange() * .5, z = p.z + Math.cos(mage.yaw) * skillRange() * .5; G.stickHold.set(x, surfaceY(x, z, p.y + 2), z); }
  G.orb = makeOrb(auraEl()); scene.add(G.orb);
}
// 瞬發招(非法師 sk.instant):按下即以 q = 1 施放,集氣中先取消;仍走 release()(花費、冷卻、僵直、cast 事件都照常)
function castInstant(i) {
  const sk = curSkill(i);
  if (sk.stub) { banner('尚未實作', '#ffc46b'); return; }
  if (G.roll || G.stun > 0 || G.down > 0 || (G.state !== 'ready' && G.state !== 'charging')) return;
  if (G.cd[sk.id] > 0 || skillBlocked(sk)) return;
  if (G.state === 'charging') cancelCharge();
  if (G.sitting) sitBreak('cast');
  const c = skillCost(i);
  if (!resCan(c.kind, costAt(c.base, 1))) { resDeny(c.kind); return; }
  G.skill = i; G.lastSkill = i; G.charge = 1; G.chargeT = 0; G.queued = false;
  release();
}
function cancelCharge() {
  if (G.state !== 'charging') return;
  sfx.loop('charge', false);
  dissolveOrb(G.orb, auraEl()); G.orb = null; G.state = 'ready'; G.chargeT = 0; G.queued = false;
  document.getElementById('chant').style.opacity = 0;
}
function dissolveOrb(orb, E) {
  if (!orb) return;
  E = E || EL.fire;
  for (let i = 0; i < 25; i++) fire.emit(orb.position.x, orb.position.y, orb.position.z, rnd(-2, 2), rnd(-1, 3), rnd(-2, 2), rnd(.3, .6), rnd(.1, .25), E.c0, E.c1, 1, .3, 2, 1);
  scene.remove(orb);
}
// 施放:存下集氣比例 q,並算好統一倍率(C-0b)。所有招式只讀 P.dmgK / P.sizeK / P.durK / P.fxK 與 CHG.count
// 施放:存下集氣比例 q,並算好統一倍率(C-0b);集氣模式 mode 只在這裡決定 sizeK / thickK / copies(設計 §2-2)
function release() {
  const cs = skillCost(G.skill);
  if (!resUse(cs.kind, costAt(cs.base, G.charge))) { cancelCharge(); return; }   // 花費在施放當下扣(chargeCap 已保證夠)
  sfx.loop('charge', false); sfx.play('cast', { cls: G.cls, el: G.el }); if (window.padRumble) padRumble('cast');
  if (G.stealth && G.stealth.shadow) revealStealth('cast');   // 影遁中出招即解除(skills_assassin.js 影分身)
  const sk = curSkill(G.skill), sp = spellOf(G.skill), p = mage.root.position, q = G.charge, mode = curMode();
  const dir = Math.atan2(G.target.x - p.x, G.target.z - p.z), sizeK = CHG.size(q, mode);
  G.pending = {
    skill: sk, spell: sp, base: baseOf(G.skill), idx: skillIx(G.skill), el: G.cls === 'mage' ? G.el : 'fire', target: G.target.clone(), q, charge: q,
    mode, sizeK, thickK: CHG.thick(q, mode), copies: CHG.copies(COPIES_N[sk.kind] || 1, q, mode),
    r: skillRad() * sizeK, power: 0.35 + 0.65 * q, range: skillRange(),
    muzzle: new V3(p.x + Math.sin(dir) * .7, p.y + 1.25, p.z + Math.cos(dir) * .7),   // 第 1 招子彈的槍口(設計 §1-3)
    dmgK: CHG.dmg(q) * W().dmgMul, durK: CHG.dur(q), fxK: CHG.fx(q),
    dir, wallYaw: dir + G.wallOff, dmgMul: W().dmgMul, recover: sc(G.skill).recover * W().recoverMul, ex: sk.exFn ? (sk.exFn(q) | 0) : 0
  };
  if (window.NETON) { G.pending.sd = (Math.random() * 2147483648) | 0; G.pending.rng = seedRng(G.pending.sd); }   // 多人:種子與決定位置 / 時間的亂數(§2-4);單人不加
  if (sk.cd) G.cd[sk.id] = sk.cd;   // 冷卻從施放開始計
  auraGather();                     // 氣場收束到武器尖端
  G.state = 'cast'; G.castT = 0; G.launched = false; G.queued = false;
  G.shoutT = 1.0; const ch = document.getElementById('chant'); ch.textContent = sp.shout; ch.style.fontSize = '30px';
}
function updateCasting(dt) {
  for (const k in G.cd) if (G.cd[k] > 0) G.cd[k] = Math.max(0, G.cd[k] - dt);
  if (G.state === 'charging') {
    if (!(G.paraJolt > 0) && !window.PAD_LOST) G.chargeT += dt;   // 麻痺抽搐中暫停集氣進度(不取消,status.js)
    G.charge = Math.min(clamp(G.chargeT / chargeTimeEff(), 0, 1), chargeCap());   // MP / SP 不足時卡在買得起的上限
    if (G.charge >= .5 && !G.halfFlash) { G.halfFlash = true; burstRing(mage.root.position, auraEl().hex, 1.2); }
    if (G.charge >= 1 && !G.maxFlash) { G.maxFlash = true; G.shake = Math.max(G.shake, .05); burstRing(mage.root.position, 0xffd27a, 2.4); }
    if (G.queued && G.chargeT >= CFG.minHold) release();
  } else if (G.state === 'cast') {
    G.castT += dt;
    if (!G.launched && G.castT >= 0.14) {
      G.launched = true; G.kick = 1;
      if (window.NETON) netSendCast(G.pending);   // 多人:出手瞬間送出施放事件(netcombat.js)
      launchSpell(G.pending, G.orb); G.orb = null;
      const kd = G.pending.skill.kind;
      G.frameT = kd === 'sky' ? 3.8 : (kd === 'wall' ? 1.6 : 1.1);
    }
    if (G.castT >= G.pending.recover) { G.state = 'ready'; if (G.atkHeld && !G.pending.skill.instant) startCharge(); }   // 瞬發招不因按住而連發
  } else G.charge = damp(G.charge, 0, 10, dt);
  G.kick = Math.max(0, G.kick - dt * 3.5);
  const tcb = (G.state === 'charging' || (G.state === 'cast' && G.castT < .32)) ? 1 : 0;
  G.cb = damp(G.cb, tcb, tcb ? 10 : 6, dt);
  G.auraAmt = damp(G.auraAmt, G.state === 'charging' ? .15 + .85 * G.charge : 0, 8, dt);
  // 咒語字幕
  const ch = document.getElementById('chant');
  if (G.state === 'charging') {
    const t = spellOf(G.skill).chant, n = Math.ceil(t.length * Math.min(1, G.charge * 1.15));
    ch.textContent = t.slice(0, n); ch.style.fontSize = '17px'; ch.style.opacity = 1;
  } else if (G.shoutT > 0) { G.shoutT -= dt; ch.style.opacity = Math.min(1, G.shoutT * 2); } else ch.style.opacity = 0;
}

/* ================= 玩家移動 ================= */
// 地形水平阻擋:往上坡度超過上限(地面)或高差超過 STEP_UP(空中)就擋;先試只走 x、再試只走 z
function terrainBlocked(x, z, x0, z0, y) {
  const wy = window.WATER_Y;   // 島戰場:海 = 牆(水深處擋住;起點已在水中則放行,避免卡死)
  if (wy != null && terrainH(x, z) < wy - .15 && terrainH(x0, z0) >= wy - .15) return true;
  const rise = terrainH(x, z) - y; if (rise <= .02) return false;
  if (!G.ground) return rise > STEP_UP;
  const d = Math.hypot(x - x0, z - z0); return d > 1e-5 && rise / d > TER_MAX_TAN;
}
function terrainMove(p, x0, z0) {
  if (TER.flat || !terrainBlocked(p.x, p.z, x0, z0, p.y)) return;
  if (!terrainBlocked(p.x, z0, x0, z0, p.y)) { p.z = z0; return; }
  if (!terrainBlocked(x0, p.z, x0, z0, p.y)) { p.x = x0; return; }
  p.x = x0; p.z = z0;
}
function updatePlayer(dt) {
  // mc:劍士 / 刺客集氣中可移動;lock 為不能移動;face 為面向瞄準點
  const p = mage.root.position, K = G.keys, mc = G.state === 'charging' && moveCharge(), lock = (G.state === 'charging' && !mc) || (G.state === 'cast' && !G.spin), face = lock || mc;
  const mi = moveInput(); let ix = mi.ix, iz = mi.iz, speedN = 0, ty = mage.yaw;
  G.rollCD = Math.max(0, G.rollCD - dt); G.stun = Math.max(0, G.stun - dt);
  const free = !lock && !G.roll && G.stun <= 0 && G.down <= 0 && G.rootT <= 0;   // 定身:不能走(仍可施法、集氣、翻滾)
  if (G.sitting && (K.KeyW || K.KeyA || K.KeyS || K.KeyD || G.stick.mag > .3)) sitBreak('move');   // 移動輸入即起身
  mi.run = mi.run && runAllowed(dt, free && !!(ix || iz));   // 跑步:SP 扣與遲滯
  if (G.roll) {
    const R = G.roll; R.t += dt; const q = Math.min(1, R.t / R.time), v = 2 * R.dist / R.time * (1 - q);
    p.x += R.dx * v * dt; p.z += R.dz * v * dt; G.invuln = R.t >= CFG.dodgeStart && R.t < CFG.dodgeStart + CFG.dodgeWin * (G.rollWinK || 1);   // 只有短閃避窗內無傷害;窗外翻滾中仍會被打
    for (let i = 0; i < 3; i++) fire.emit(p.x + rnd(-.2, .2), p.y + rnd(.3, 1.4), p.z + rnd(-.2, .2), -R.dx * 1.5, rnd(0, .8), -R.dz * 1.5, .35, rnd(.5, .9), [.6, .9, 1], [.2, .4, 1], .45, .3, 0, 2);
    if (q >= 1) { G.roll = null; G.rollCD = R.dance ? .4 : CFG.rollCD; G.invuln = false; }   // 影舞翻滾冷卻 0.4 s
  }
  if (free && (ix || iz)) {
    const l = Math.hypot(ix, iz); ix /= l; iz /= l;
    const fx = -Math.sin(G.camYaw), fz = -Math.cos(G.camYaw), rx = Math.cos(G.camYaw), rz = -Math.sin(G.camYaw);
    const dx = fx * iz + rx * ix, dz = fz * iz + rz * ix;
    const sp = CFG.moveSpeed * (mi.run ? CFG.runMul : 1) * mi.s * (G.spdK || 1);
    p.x += dx * sp * dt; p.z += dz * sp * dt; ty = Math.atan2(dx, dz); speedN = sp / CFG.moveSpeed;
  }
  if (!G.roll && (face && G.skill >= 0 || (G.state === 'cast' && G.pending))) {
    const t = G.state === 'cast' ? G.pending.target : G.target; ty = Math.atan2(t.x - p.x, t.z - p.z);
  }
  if (G.dash) ty = G.dash.yaw;   // 衝鋒 / 閃身:面向位移方向(D3、D4)
  mage.yaw += angDiff(mage.yaw, ty) * Math.min(1, dt * (face ? 16 : 11));
  for (const c of COLLIDERS) {
    if (c.ref && c.ref.dead) continue;
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + .4;
    if (d < m && d > 1e-4) { p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; }
  }
  pushOutPlatforms(p);
  terrainMove(p, G.px0, G.pz0);
  // 陡坡下滑:站在地形(不是平台)上且坡度 > 42° → 往下坡滑
  if (G.ground && !TER.flat && Math.abs(p.y - terrainH(p.x, p.z)) < .05) {
    groundNormal(p.x, p.z, null, .5, tmpV3);
    if (tmpV3.y < TER_SLIDE_NY) { const l = Math.hypot(tmpV3.x, tmpV3.z) || 1; p.x += tmpV3.x / l * TER_SLIDE_V * dt; p.z += tmpV3.z / l * TER_SLIDE_V * dt; }
  }
  const gY = groundAt(p.x, p.z, p.y);             // 用積分前的 y 找支撐面
  const gMul = (G.roll && G.roll.air) ? CFG.airRollGrav : 1;
  const wasGround = G.ground, step = Math.hypot(p.x - G.px0, p.z - G.pz0);
  G.vy -= GRAV * gMul * dt; p.y += G.vy * dt;
  const cy = ceilAt(p.x, p.z, G.py0); if (cy != null && p.y + PLAYER_H > cy) { p.y = cy - PLAYER_H - .01; if (G.vy > 0) G.vy = 0; }   // 樓板下撞頭:停在天花板下,不被 pushOut 瞬移到邊緣
  const snap = wasGround && G.vy <= 0 && p.y - gY <= .05 + TER_MAX_TAN * step * 1.3 - G.vy * dt;   // 下坡貼地
  if (p.y <= gY || snap) {
    const impact = G.vy;
    p.y = gY; if (G.vy < 0) G.vy = 0;
    G.ground = true; G.groundY = gY; G.airJumps = 1; G.airRolls = 1;
    if (!wasGround && impact < -12) landFx(p, impact);
    if (!wasGround && G.jumpBuf > 0) { G.jumpBuf = 0; doJump(); }
  } else {
    if (wasGround) G.coyote = COYOTE;             // 剛離地(走下邊緣或剛起跳)
    G.ground = false;
  }
  G.coyote = Math.max(0, G.coyote - dt); G.jumpBuf = Math.max(0, G.jumpBuf - dt);
  if (G.flip >= 0) { G.flip += dt / 0.35; if (G.flip >= 1) G.flip = -1; }
  const r = Math.hypot(p.x, p.z); if (r > ARENA_R) { p.x *= ARENA_R / r; p.z *= ARENA_R / r; }
  G.speedN = damp(G.speedN || 0, speedN, 12, dt);
  moonLight.position.set(p.x + SUNOFF.x, SUNOFF.y, p.z + SUNOFF.z); moonLight.target.position.copy(p);
}

/* ================= 瞄準光圈更新 ================= */
function updateAim(dt) {
  ind.tick(G.time);
  if (aimLock()) { G.mouse.x = innerWidth / 2; G.mouse.y = innerHeight / 2; }   // 準心模式(已鎖定):落點 = 畫面中央準心
  if (G.skill < 0 || (G.state !== 'ready' && G.state !== 'charging')) {
    if (G.state === 'cast' && G.pending) { /* 施放中:光圈保持並淡出(只畫實際範圍,不畫外圈) */
      const P = G.pending, a = Math.max(0, 1 - G.castT / Math.max(.2, P.recover)) * .9, hex = auraEl().hex;
      ind.setMax(0, 0, 0);
      if (P.skill.aim === 'dir') ind.hide();   // 第 1 招:施放中不畫任何光圈
      else if (P.skill.shape === 'wall') ind.set(P.target.x, P.target.z, 1, P.r / 2, sc(P.idx).thick * P.thickK / 2, P.wallYaw, 1, a, hex, P.target.y);
      else ind.set(P.target.x, P.target.z, 0, P.r, 0, 0, 1, a, hex, P.target.y);
    } else ind.hide();
    hideIndPool();
    return;
  }
  if (G.inputMode === 'stick') pickStick(tmpV2); else pickGround(tmpV2);
  G.target.x = damp(G.target.x, tmpV2.x, 30, dt); G.target.z = damp(G.target.z, tmpV2.z, 30, dt);
  G.target.y = surfaceY(G.target.x, G.target.z, tmpV2.y);
  if (G.state === 'ready' && ind.root.visible === false) G.target.copy(tmpV2);
  const sk = curSkill(G.skill), c = sc(G.skill), p = mage.root.position, E = auraEl();
  const charging = G.state === 'charging', q = charging ? G.charge : 0, rs = skillRad(), mode = curMode();
  const pulse = charging && G.charge >= 1 ? .75 + .25 * Math.sin(G.time * 14) : 1;
  const alpha = (charging ? .95 : .55) * pulse, prog = charging ? G.charge : 0;
  hideIndPool();
  if (aimSpecial(sk, p, charging, q, rs, alpha, E)) return;   // 方向型(dir)/ 前方 / 自身 / 線型 / 無光圈(classes.js)
  // 光圈雙層(C-0b):外圈 = 滿集氣範圍 R(setMax),內圈 = 實際範圍 R × CHG.size(q, mode)
  if (sk.shape === 'wall') {
    if (G.keys.KeyQ) G.wallOff += dt * 1.8; if (G.keys.KeyE) G.wallOff -= dt * 1.8;
    const yaw = Math.atan2(G.target.x - p.x, G.target.z - p.z) + G.wallOff;
    const half = rs * CHG.size(q, mode) / 2, th = c.thick * CHG.thick(q, mode) / 2;
    ind.setMax(0, rs / 2, c.thick / 2);
    ind.set(G.target.x, G.target.z, 1, half, th, yaw, prog, alpha, E.hex, G.target.y);
    if (mode === 'B') {   // 集氣 B:牆的多道並排預覽;未達集氣的道數淡色(×.25)
      const n = CHG.copies(COPIES_N.wall, q, mode);
      for (let i = 1; i < 4; i++) {
        const pos = wallCopyPos(G.target, yaw, i, c.thick, mage.root.position);
        indPool[i - 1].set(pos.x, pos.z, 1, half, th, yaw, prog, i < n ? alpha : alpha * .25, E.hex, pos.y);
      }
    }
  } else {
    ind.setMax(rs, 0, 0);
    ind.set(G.target.x, G.target.z, 0, rs * CHG.size(q, mode), 0, 0, prog, alpha, E.hex, G.target.y);
  }
}

/* ================= 能量球、光環、聚氣粒子(顏色跟目前屬性) ================= */
function updateOrb(dt) {
  const a = G.auraAmt, p = mage.root.position, E = auraEl();
  mage.glow = a;
  rings.forEach((m, i) => {
    m.visible = a > .02 && G.cls === 'mage'; m.material.opacity = a * .8;   // 符文圈與光環只給法師
    m.scale.setScalar(.7 + a * .5 + i * .12);
    m.position.y = .5 + i * .6 + Math.sin(G.time * 2 + i) * .08;
    m.rotation.set(Math.PI / 2 + Math.sin(G.time * 1.3 + i * 2) * .35, Math.cos(G.time * 1.1 + i) * .3, G.time * (2 + i));
  });
  const sitRune = G.cls === 'mage' && G.sitK > .02;   // 打坐時腳下符文淡入(opacity 最多 .3)
  runeMesh.material.opacity = Math.max(a * .9, sitRune ? .3 * G.sitK : 0); runeMesh.scale.setScalar(2.4 + a * 1.8); runeGrp.rotation.y = G.time * .9; runeGrp.visible = (a > .02 || sitRune) && G.cls === 'mage';
  const L = LIGHTS[3]; L.color.setHex(E.hex); L.position.set(p.x, p.y + 1.4, p.z); L.intensity = a * 2.6; L.distance = 12;
  runeMesh.material.color.setHex(E.hex); rings.forEach(m => m.material.color.setHex(E.hex));
  if (G.state === 'charging') auraTick(dt);   // 集氣氣場(classes.js)
  auraGatherTick(dt);                          // 放開後收束到武器尖端
  const orb = G.orb;
  if (orb && G.state !== 'cast' || orb && !G.launched) {
    mage.tipWorld(orb.position);
    const r = .08 + .5 * easeOut(G.charge) + Math.sin(G.time * 18) * .015 * G.charge;
    orb.setR(damp(orb.r, r, 20, dt));
    const n = 1 + Math.floor(G.charge * 3);
    for (let i = 0; i < n; i++) {
      const d = new V3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize(), R = rnd(.9, 1.6);
      fire.emit(orb.position.x + d.x * R, orb.position.y + d.y * R, orb.position.z + d.z * R, -d.x * R / .35, -d.y * R / .35, -d.z * R / .35, .35, rnd(.1, .2), E.c0, E.c1, 1, .5);
    }
  }
}
function burstRing(pos, hex, R) {
  const m = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  layFlat(m, pos.x, pos.y, pos.z, R * .5, 0, .1); scene.add(m);
  let t = 0; addFx(dt => { t += dt / .5; if (t >= 1) { scene.remove(m); m.material.dispose(); return false; } m.scale.setScalar(Math.max(.01, R * easeOut(t))); m.material.opacity = .9 * (1 - t) * (1 - t); });
}

// 落地揚塵(落差大時):水平擴散的塵土 + 輕微震動
function landFx(p, v) {
  const n = IS_TOUCH ? 6 : 10;
  for (let i = 0; i < n; i++) smoke.emit(p.x, p.y + .1, p.z, rnd(-2, 2), rnd(.2, .8), rnd(-2, 2), rnd(.5, .9), rnd(.8, 1.4), [.5, .45, .4], [.3, .3, .3], .4, 2, 0, 1.5);
  G.shake = Math.max(G.shake, Math.min(.2, -v * .008) * CFG.shake);
}
// 二段跳(空氣步):兩圈水平光環 + 放射粒子 + 向下煙
function airStepFx(p) {
  const n = IS_TOUCH ? 10 : 16, k = IS_TOUCH ? 4 : 6;
  [[.3, 1.8, 0], [.2, 1.3, .06]].forEach(([s0, s1, delay]) => {
    const m = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(p.x, p.y + .05, p.z); m.visible = false; scene.add(m);
    let t = -delay;
    addFx(dt => {
      t += dt; if (t < 0) return true;
      m.visible = true; const u = Math.min(1, t / .3);
      m.scale.setScalar(Math.max(.01, s0 + (s1 - s0) * easeOut(u))); m.material.opacity = .9 * (1 - u) * (1 - u);
      if (u >= 1) { scene.remove(m); m.material.dispose(); return false; }
      return true;
    });
  });
  for (let i = 0; i < n; i++) {
    const a = rnd(0, 6.283), sp = rnd(4, 6);
    fire.emit(p.x, p.y + .1, p.z, Math.cos(a) * sp, rnd(0, .5), Math.sin(a) * sp, rnd(.25, .4), rnd(.25, .45), [.8, .95, 1], [.3, .6, 1], 1, 1, 0, 3);
  }
  for (let i = 0; i < k; i++) smoke.emit(p.x + rnd(-.3, .3), p.y, p.z + rnd(-.3, .3), rnd(-.5, .5), rnd(-2, -1), rnd(-.5, .5), rnd(.4, .6), rnd(.6, 1), [.7, .8, .9], [.4, .45, .5], .3, 1.5, 0, 1);
}

/* ================= 特效管理 ================= */
const RING_GEO = new THREE.RingGeometry(.85, 1, 48), ICO_GEO = new THREE.IcosahedronGeometry(1, 2);
// 擁有者上下文(設計 §2-6):NET_CTX = null 為本機;數字 = 正在重現該座位玩家的法術,延後執行時自動帶回
let NET_CTX = null;
const FX = []; function addFx(fn) {
  const o = NET_CTX;
  if (o === null) { FX.push(fn); return; }
  FX.push(dt => { const p = NET_CTX; NET_CTX = o; try { return fn(dt); } finally { NET_CTX = p; } });
}
function updateFx(dt) { for (let i = FX.length - 1; i >= 0; i--) if (FX[i](dt) === false) FX.splice(i, 1); }
let lightRR = 0;
function flashLight(pos, hex, inten, dur, dist) { const L = LIGHTS[(lightRR++) % 3]; L.userData = { t: 0, dur, peak: inten }; L.color.setHex(hex); L.position.copy(pos); L.distance = dist; L.intensity = inten; }
function updateLights(dt) { for (let i = 0; i < 3; i++) { const L = LIGHTS[i], u = L.userData; if (u.dur) { u.t += dt; const k = 1 - u.t / u.dur; L.intensity = k > 0 ? u.peak * k * k : 0; } } }

function addDmgText(pos, n, color) {
  const d = document.createElement('div'); d.className = 'dmg'; d.textContent = n; if (color) d.style.color = color; document.getElementById('dmgLayer').appendChild(d);
  DMGS.push({ el: d, pos: pos.clone(), t: 0, ox: rnd(-14, 14) });
}
const DMGS = [];
function updateDmgTexts(dt) {
  for (let i = DMGS.length - 1; i >= 0; i--) {
    const d = DMGS[i]; d.t += dt;
    if (d.t > 1) { d.el.remove(); DMGS.splice(i, 1); continue; }
    tmpV.copy(d.pos).project(camera);
    d.el.style.transform = 'translate(' + ((tmpV.x * .5 + .5) * innerWidth + d.ox) + 'px,' + ((-tmpV.y * .5 + .5) * innerHeight - d.t * 50) + 'px)';
    d.el.style.opacity = 1 - d.t * d.t;
  }
}

function damageArea(pos, R, dmg, burn, el) {
  for (const d of DUMMIES) {
    if (d.dead) continue;
    if (Math.abs(pos.y - d.y) > R + 1.5) continue;   // 標靶高度用目前的 y(可能被擊飛到空中)
    const dx = d.x - pos.x, dz = d.z - pos.z, dist = Math.hypot(dx, dz);
    if (dist < R + .2) { d.hit(dmg * (1 - clamp(dist / (R + .2), 0, 1) * .7) * rnd(.9, 1.1), dx, dz, burn, el); if (dmg > 0) sfx.play(d.dead ? 'kill' : 'hit'); }
  }
}

// 爆炸(C-4 burstEl 參數化):o.el 屬性(預設火)、o.gy 地面高度、o.dmg 基礎傷害(0 = 不傷人)、
// o.mul 傷害倍率(P.dmgK)、o.fxK 效果倍率、o.burn 火系燃燒秒數(預設 2.5)
function explode(pos, R, power, o) {
  o = o || {};
  const gy = o.gy != null ? o.gy : 0, el = o.el || 'fire', E = EL[el], B = EL_BURST[el], FXM = el === 'fire' ? 1 : CFG.fxq;
  const fy = o.flatY != null ? o.flatY : 1, smA = o.smokeA != null ? o.smokeA : .55;   // 風:水平化 / 煙較淡
  const k = Math.sqrt(R / 2), c0 = E.c0, c1 = E.c1, fireSm = el === 'fire';
  const sc0 = fireSm ? [.28, .22, .2] : (E.s0 || [.25, .2, .18]), sc1 = fireSm ? [.08, .08, .09] : (E.s1 || [.08, .08, .09]);
  const n = Math.floor(Math.min(260, Math.floor((50 + 30 * power) * R / 2.5)) * B.bright * FXM);
  for (let i = 0; i < n; i++) {
    const d = new V3(rnd(-1, 1), rnd(-.2, 1), rnd(-1, 1)).normalize(), sp = rnd(.3, 1) * R * 3.2;
    fire.emit(pos.x + d.x * R * .2, pos.y + d.y * R * .2, pos.z + d.z * R * .2, d.x * sp, d.y * sp * fy, d.z * sp, rnd(.35, .8), rnd(.8, 1.6) * k * .8, c0, c1, 1, 2.2, 0, 2.5);
  }
  const m = Math.floor(25 * power * k * B.spark * FXM), spc = fireSm ? [1, .95, .7] : c0;
  for (let i = 0; i < m; i++) {
    const d = new V3(rnd(-1, 1), rnd(.1, 1), rnd(-1, 1)).normalize(), sp = rnd(R * 1.5, R * 5);
    fire.emit(pos.x, pos.y, pos.z, d.x * sp, d.y * sp, d.z * sp, rnd(.6, 1.4), rnd(.12, .25), spc, c1, 1, .2, 9, .6);
  }
  const sm = Math.floor(10 * k * B.smoke * FXM);
  for (let i = 0; i < sm; i++) smoke.emit(pos.x + rnd(-R, R) * .4, pos.y + .3, pos.z + rnd(-R, R) * .4, rnd(-1, 1), rnd(.8, 2.2), rnd(-1, 1), rnd(1.6, 2.8), rnd(2, 4) * k * .8, sc0, sc1, smA, 2.5, -.3, .8);
  const ring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: B.ring, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  layFlat(ring, pos.x, gy, pos.z, R * .6, 0, .08); scene.add(ring);
  const flash = new THREE.Mesh(ICO_GEO, new THREE.MeshBasicMaterial({ color: B.flash, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.position.copy(pos); scene.add(flash);
  const spr = glowSprite(E.core, R * 5, 1); spr.position.copy(pos); scene.add(spr);
  const T = .45 + .1 * k; let t = 0;
  addFx(dt => {
    t += dt; const u = t / T;
    if (u >= 1) { scene.remove(ring, flash, spr); ring.material.dispose(); flash.material.dispose(); spr.material.dispose(); return false; }
    ring.scale.setScalar(Math.max(.01, R * 1.35 * easeOut(u))); ring.material.opacity = .9 * (1 - u) * (1 - u);
    flash.scale.setScalar(Math.max(.01, R * .95 * easeOut(Math.min(1, u * 2.2)))); flash.material.opacity = .85 * Math.pow(1 - u, 2);
    spr.scale.setScalar(R * 5 * (1 - u * .5)); spr.material.opacity = Math.pow(1 - u, 2.5);
  });
  flashLight(new V3(pos.x, pos.y + 1.5, pos.z), B.light, 6 * Math.min(2, k) * B.lightK, .5, 14 + R * 3);
  // 焦痕(EL_SCORCH 為 null 的屬性不留焦痕)
  const scH = EL_SCORCH[el];
  if (scH) {
    const sc2 = new THREE.Mesh(SCORCH_GEO, new THREE.MeshBasicMaterial({ map: SCORCH_TEX, color: new THREE.Color(scH[0], scH[1], scH[2]), transparent: true, depthWrite: false, opacity: .75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    layFlat(sc2, pos.x, gy, pos.z, R * .6, rnd(0, 6), .03 + (SCORCH.length % 7) * .002); sc2.scale.setScalar(R * 2.4 * rnd(.9, 1.1)); scene.add(sc2);
    SCORCH.push({ m: sc2, age: 0 }); if (SCORCH.length > 30) { const o2 = SCORCH.shift(); scene.remove(o2.m); o2.m.material.dispose(); }
  }
  const dc = Math.hypot(pos.x - camera.position.x, pos.z - camera.position.z);
  G.shake = Math.max(G.shake, .14 * k * power * CFG.shake / (1 + dc * .03));
  if (o.dmg !== 0) {
    const mul = o.mul || 1, base = o.dmg || 70;
    if (fireSm) damageArea(pos, R, base * mul, o.burn != null ? o.burn : 2.5, 'fire');
    else areaEl(pos, R, base, el, { dmgK: mul, fxK: o.fxK || 1 });
  }
}

/* ================= 三種形狀的施法(火系保留原函式;其他屬性先借用同一形狀) ================= */
function launchSpell(P, orb) {
  if (!orb) { orb = makeOrb(casterAura(P)); scene.add(orb); casterTip(P, orb.position); orb.setR(.3); }
  if (P.skill.cast) return P.skill.cast(P, orb);   // D2~D4 專屬招式
  // 元素 + 形狀查名稱表(SHAPE_FN_NAME 在 spells.js),執行期取 window[名稱];找不到 → 警告並退回火球術
  const row = SHAPE_FN_NAME[P.el] || SHAPE_FN_NAME.fire, name = row[P.skill.kind] || SHAPE_FN_NAME.fire[P.skill.kind];
  let f = window[name];
  if (typeof f !== 'function') { console.warn('[launchSpell] 找不到 ' + name + ',退回 castFireBolt'); f = castFireBolt; }
  f(P, orb);
}

function trail(a, b, n, size, life, el) {
  const E = EL[el || 'fire'];
  for (let i = 0; i < n; i++) {
    const t = Math.random();
    fire.emit(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t), rnd(-.6, .6), rnd(-.3, .8), rnd(-.6, .6), rnd(life * .6, life), size * rnd(.6, 1.2), E.c0, E.c1, .9, .3, -.5, .4);
  }
}

function castFirewall(P, orb) {
  const gy = P.target.y, start = orb.position.clone(), end = P.target.clone(); end.y = gy + .5; const dur = clamp(start.distanceTo(end) / 36, .2, .6); let t = 0; const prev = start.clone();
  addFx(dt => {
    t += dt / dur; const u = Math.min(t, 1);
    orb.position.lerpVectors(start, end, u); trail(prev, orb.position, 5, orb.r * 1.2, .4, P.el); prev.copy(orb.position);
    if (u >= 1) { scene.remove(orb); forCopies(P, 'wall', .12, wallPlace, spawnWall); return false; }
  });
}
function spawnWall(P) {
  const gy = P.target.y, cfg = pcfg(P), half = P.r / 2, thick = cfg.thick * P.thickK, ax = Math.cos(P.wallYaw), az = -Math.sin(P.wallYaw), E = EL[P.el];
  const n = Math.ceil(P.r / .7) + 1, segs = [], dur = cfg.duration * P.durK, emitK = (P.ncopy > 1 ? 1 / (P.ncopy * .6) : 1) * Math.sqrt(P.thickK);
  for (let i = 0; i < n; i++) { const o = (i / (n - 1) - .5) * P.r, x = P.target.x + ax * o, z = P.target.z + az * o; segs.push({ o, x, z, gy: surfaceY(x, z, gy + 1), on: Math.abs(o) / half * .4, acc: 0 }); }
  const wi = new Indicator(scene); let age = 0, tick = 0;
  const gl = []; for (let i = 0; i < n; i += 2) { const s = glowSprite(E.hex, 3, .5); s.position.set(segs[i].x, segs[i].gy + .6, segs[i].z); scene.add(s); gl.push(s); }
  flashLight(new V3(P.target.x, gy + 2, P.target.z), E.hex, 5, .5, 25); G.shake = Math.max(G.shake, .08 * CFG.shake);
  const L = LIGHTS[4];
  if (!P.copy) { L.color.setHex(E.hex); L.position.set(P.target.x, gy + 1.8, P.target.z); L.distance = 10 + P.r * 1.3; }   // 持續光源只由第 0 道驅動
  addFx(dt => {
    age += dt; const fade = age > dur - 1 ? Math.max(0, dur - age) : 1;
    if (age >= dur) { wi.hide(); wi.root.parent.remove(wi.root); gl.forEach(s => { scene.remove(s); s.material.dispose(); }); if (!P.copy) L.intensity = 0; return false; }
    wi.set(P.target.x, P.target.z, 1, half, thick / 2, P.wallYaw, 0, .35 * fade * (.8 + .2 * Math.sin(age * 12)), E.hex, gy); wi.tick(age);
    if (!P.copy) L.intensity = 3.5 * fade * (.85 + Math.random() * .3);
    const H = (.7 + P.power * .6) * 1.2;
    for (const s of segs) {
      if (age < s.on) continue;
      const ramp = Math.min(1, (age - s.on) / .25) * fade; s.acc += dt * 38 * ramp * emitK;
      while (s.acc >= 1) {
        s.acc -= 1; const lx = rnd(-thick / 2, thick / 2);
        fire.emit(s.x + (-az) * lx, s.gy + rnd(0, .3), s.z + ax * lx, rnd(-.4, .4), rnd(2.5, 4.5) * H * ramp, rnd(-.4, .4), rnd(.6, 1.0), rnd(.9, 1.5), E.c0, E.c1, .95, .35, -.3, .6);
        if (Math.random() < .07) smoke.emit(s.x, s.gy + 1.8, s.z, rnd(-.3, .3), rnd(1, 2), rnd(-.3, .3), rnd(1.4, 2.2), rnd(1.5, 2.5), [.25, .2, .18], [.08, .08, .09], .4, 2.2, -.3, .6);
      }
    }
    gl.forEach((s, i) => { s.material.opacity = (.35 + Math.random() * .2) * fade; s.scale.setScalar(2.6 + Math.sin(age * 9 + i) * .4); });
    tick += dt;
    if (tick >= .3) {
      tick = 0;
      if (Math.abs(gy) <= 1.5) for (const d of DUMMIES) {
        if (d.dead) continue;
        const dx = d.x - P.target.x, dz = d.z - P.target.z, along = dx * ax + dz * az, across = dx * -az + dz * ax;
        if (Math.abs(along) > half + .4 || Math.abs(across) > thick / 2 + .6) continue;
        const burnT = 3 * P.fxK;
        if (P.el === 'fire') { d.hit(9 * P.dmgK, across, 0, burnT, 'fire'); continue; }
        // 其他屬性:牆法線方向 = 由中線指向標靶;擊退類效果有 .6 s 冷卻,避免每跳重複推
        const s = Math.sign(across) || 1, f = elFx(P.el, P.fxK);
        if (f.knock) { if (d.windT > 0) delete f.knock; else d.windT = .6; }
        hitEl(d, 9 * P.dmgK, P.el, -az * s, ax * s, f);
      }
    }
  });
}

function castMeteor(P, orb) {
  const gy = P.target.y, start = orb.position.clone(), top = new V3(P.target.x, gy + 30, P.target.z), E = EL[P.el]; let t = 0;
  addFx(dt => {
    t += dt / .55; const u = Math.min(t, 1);
    orb.position.lerpVectors(start, top, u * u); fire.emit(orb.position.x, orb.position.y, orb.position.z, rnd(-.5, .5), rnd(-1, 0), rnd(-.5, .5), .5, orb.r, E.c0, E.c1, 1, .3, 0, .5);
    orb.setR(orb.r * (1 + dt * 2));
    if (u >= 1) { dissolveOrb(orb, E); startShower(P); return false; }
  });
}
function startShower(P) {
  const gy = P.target.y, S = new V3(-9, 0, -6), skyY = gy + 16, E = EL[P.el], count = CHG.count(15, P.q, P.mode), rock = [];
  const sig = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: RUNE_TEX, color: E.hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  sig.rotation.x = -Math.PI / 2; sig.position.set(P.target.x + S.x, skyY, P.target.z + S.z); sig.scale.setScalar(P.r * 2.6); scene.add(sig);
  const gi = new Indicator(scene);
  const sched = []; for (let i = 0; i < count; i++) sched.push(.5 + (i / count) * 2 + prnd(P, 0, .25));
  sched.push(2.9);
  let age = 0, done = 0;
  const geo = new THREE.IcosahedronGeometry(1, 0);
  addFx(dt => {
    age += dt; const fin = age > 3.4 + .8 ? Math.max(0, 1 - (age - 4.2) / .6) : 1;
    sig.material.opacity = Math.min(1, age * 2) * .9 * fin; sig.rotation.z += dt * .6;
    gi.set(P.target.x, P.target.z, 0, P.r, 0, 0, 1, .45 * Math.min(1, age * 2) * fin, E.hex, gy); gi.tick(age);
    while (sched.length && age >= sched[0]) {
      const idx = sched.shift(), big = sched.length === 0;
      const ang = prnd(P, 0, 6.283), rr = big ? 0 : Math.sqrt(prnd(P, 0, 1)) * P.r * .92;
      const end = new V3(P.target.x + Math.cos(ang) * rr, gy + .3, P.target.z + Math.sin(ang) * rr);
      const sa = prnd(P, 0, 6.283), sr = Math.sqrt(prnd(P, 0, 1)) * P.r * 1.0;
      const st = new V3(P.target.x + S.x + Math.cos(sa) * sr, skyY, P.target.z + S.z + Math.sin(sa) * sr);
      if (big) { st.set(P.target.x + S.x * .8, skyY + 6, P.target.z + S.z * .8); }
      const s = big ? 1.9 : rnd(.45, .8);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2a1810, emissive: E.hex, emissiveIntensity: 1.3, flatShading: true, roughness: 1 }));
      mesh.scale.setScalar(s); mesh.castShadow = true; scene.add(mesh);
      const gs = glowSprite(E.hex, 5, .9); mesh.add(gs);
      rock.push({ mesh, st, end, s, big, t: 0, fall: big ? .9 : prnd(P, .55, .75), prev: st.clone(), spin: new V3(rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)) });
    }
    for (let i = rock.length - 1; i >= 0; i--) {
      const m = rock[i]; m.t += dt / m.fall; const u = Math.min(1, m.t), e = u * u * .6 + u * .4;
      m.mesh.position.lerpVectors(m.st, m.end, e); m.mesh.rotation.x += m.spin.x * dt; m.mesh.rotation.y += m.spin.y * dt;
      trail(m.prev, m.mesh.position, m.big ? 14 : 7, m.s * 1.6, .5, P.el);
      smoke.emit(m.mesh.position.x, m.mesh.position.y, m.mesh.position.z, rnd(-.3, .3), rnd(0, .4), rnd(-.3, .3), 1.2, m.s * 2.4, [.25, .2, .18], [.08, .08, .09], .35, 2, -.2, .5);
      m.prev.copy(m.mesh.position);
      if (u >= 1) {
        scene.remove(m.mesh); m.mesh.material.dispose(); rock.splice(i, 1);
        const R = m.big ? P.r * .85 : Math.max(1.6, P.r * .27), pw = clamp(P.power + (m.big ? .2 : 0), .3, 1);
        explode(m.end, R, pw, { dmg: m.big ? 120 : 55, gy, el: P.el, mul: P.dmgK, fxK: P.fxK, burn: 3 * P.fxK });
        if (m.big) G.shake = Math.max(G.shake, .35 * CFG.shake);
      }
    }
    if (age > 4.8 && !rock.length && !sched.length) { scene.remove(sig); sig.material.dispose(); gi.root.parent.remove(gi.root); return false; }
  });
}

/* ================= 世界更新 ================= */
function updateWorld(dt) {
  if (G.autoStrike) { G.strikeT -= dt; if (G.strikeT <= 0) { strike(); G.strikeT = 2.2; } }
  const bn = document.getElementById('banner'); if (bn._t > 0) { bn._t -= dt; bn.style.opacity = Math.min(1, bn._t * 2); }
  updateSummons(dt);
  // 玩家狀態計時:護盾時效、區域減速免疫(倒下 / 復活 / 資源見 resources.js)
  if (G.shieldT > 0) { G.shieldT -= dt; if (G.shieldT <= 0) G.shield = 0; }
  if (G.slowImmT > 0) G.slowImmT = Math.max(0, G.slowImmT - dt);
  if (typeof updateCraters === 'function') updateCraters(dt);
  for (const d of DUMMIES) d.update(dt);
  for (const s of SCORCH) { s.age += dt; if (s.age > 20) s.m.material.opacity = Math.max(0, .75 * (1 - (s.age - 20) / 6)); }
  for (const b of BRAZIERS) {
    if (Math.random() < dt * 25) fire.emit(b.x + rnd(-.25, .25), b.y, b.z + rnd(-.25, .25), rnd(-.2, .2), rnd(1.2, 2.4), rnd(-.2, .2), rnd(.5, .9), rnd(.4, .7), EL.fire.c0, EL.fire.c1, .8, .3, -.3, .5);
  }
}
function resetWorld() {
  if (window.NETON) return;   // 多人對戰中不能 R 重置(會把自己的 HP 等狀態補滿)
  G.dodged = G.hits = 0; resInit(); G.slowImmT = 0;
  DUMMIES.forEach(d => { d.hp = d.max; d.burn = 0; if (d.dead) d.reset(); else d.clearStatus(); });
  SCORCH.forEach(s => { scene.remove(s.m); s.m.material.dispose(); }); SCORCH.length = 0;
}

/* ================= 鏡頭 ================= */
const CAM_PITCH_MAX = 1.35;
const camPitchMin = () => aimLock() ? -0.30 : -0.10;   // 準心模式可略仰視;游標 / 觸控 / 手把維持原本下限
// 相機位置是否被擋:地面(含平地)、平台與橋(橋只擋橋身高度區間,橋底下可通過)。COLLIDERS 不算(避免多人時別人站身後把鏡頭拉近)
function camBlocked(x, y, z) {
  if (y < terrainH(x, z) + .4) return true;
  for (const P of PLATFORMS) if (platContains(P, x, z, .2) && y < platTop(P, x, z) + .2 && (P.bottom == null || y > P.bottom - .3)) return true;   // 有 bottom 的(橋 / 樓板):頂下方的樣本才擋
  return false;
}
function updateCamera(dt) {
  const p = mage.root.position, lk = aimLock();
  // Q / E 轉鏡頭(選牆時 Q / E 仍旋轉牆,見 updateAim)
  const wallK = G.skill >= 0 && curSkill(G.skill).shape === 'wall' && (G.state === 'ready' || G.state === 'charging');
  const kt = (G.keys.KeyQ ? 1 : 0) - (G.keys.KeyE ? 1 : 0);
  if (kt && !wallK) addLook(kt * CFG.camKeyTurn * dt, 0);
  // 消化視角累積量:camSmooth 0 = 即時;撞到俯仰上下限就清掉剩餘量
  const kS = CFG.camSmooth <= 0 ? 1 : 1 - Math.exp(-dt * lerp(60, 8, CFG.camSmooth));
  G.camYaw += G.lookX * kS; G.lookX -= G.lookX * kS;
  const pRaw = G.camPitch + G.lookY * kS, pY = clamp(pRaw, camPitchMin(), CAM_PITCH_MAX);
  G.lookY = pY === pRaw ? G.lookY * (1 - kS) : 0; G.camPitch = pY;
  let fx = p.x, fy = p.y + 1.5 + (lk ? .5 : 0), fz = p.z, dist = CFG.camDist * G.zoom;
  G.frameT = Math.max(0, G.frameT - dt);
  const aim = CFG.autoFrame && G.skill >= 0 && (G.state === 'charging' || G.state === 'cast' || G.frameT > 0);
  if (aim) {
    const t = G.state === 'cast' && G.pending ? G.pending.target : G.target, d = Math.hypot(t.x - p.x, t.z - p.z);
    if (lk) dist += d * .3;   // 準心模式:只拉距離、不偏焦點(偏焦點會讓落點跟著漂,見設計 #4)
    else { fx = lerp(fx, t.x, .38); fz = lerp(fz, t.z, .38); dist += d * .45; }
  }
  if (lk) { fx += Math.cos(G.camYaw) * CFG.camShoulder; fz -= Math.sin(G.camYaw) * CFG.camShoulder; }   // 肩後偏移(角色靠左,準心越過右肩)
  G.focus.x = damp(G.focus.x, fx, 7, dt); G.focus.y = damp(G.focus.y, fy, 7, dt); G.focus.z = damp(G.focus.z, fz, 7, dt);
  G.camD = damp(G.camD, dist, 4, dt);
  const camAt = pit => { const cp = Math.cos(pit), sp = Math.sin(pit); return [G.focus.x + Math.sin(G.camYaw) * cp * G.camD, G.focus.y + sp * G.camD, G.focus.z + Math.cos(G.camYaw) * cp * G.camD]; };
  // 沿「焦點 → 相機」取樣,擋到回傳拉近係數(1 = 不擋)
  const sampleK = (cx, cy, cz) => { for (let i = 1; i <= 12; i++) { const s = i / 12; if (camBlocked(lerp(G.focus.x, cx, s), lerp(G.focus.y, cy, s), lerp(G.focus.z, cz, s))) return Math.max(.15, (i - 1) / 12); } return 1; };
  // 抬頭避讓(設計_大面積地形 §4-2 D):斜下看被坡擋住 → 試抬頭 .25 / .5;準心模式不抬(落點會跟著動)。不寫回 G.camPitch
  let liftT = 0;
  if (!lk && sampleK(...camAt(G.camPitch)) < .7) for (const dp of [.25, .5]) { const pit = Math.min(G.camPitch + dp, CAM_PITCH_MAX); if (sampleK(...camAt(pit)) >= .85) { liftT = pit - G.camPitch; break; } }
  G.camLift = damp(G.camLift, liftT, 4, dt);
  // 弓箭手集氣:FOV 隨 q 微縮(設計 C-5,派工單③);aimCam 維持基準 FOV,瞄準不變;放箭後 q 歸零即恢復
  G.adsK = damp(G.adsK || 0, G.state === 'charging' && G.cls === 'archer' ? G.charge : 0, 6, dt);
  camera.fov = CAM_FOV0 * (1 - ADS_FOV_K * G.adsK); camera.updateProjectionMatrix();
  let [cx, cy, cz] = camAt(G.camPitch + G.camLift);
  const k = sampleK(cx, cy, cz);
  G.camK = k < G.camK ? k : damp(G.camK, k, 3, dt);   // 被擋時立刻拉近、離開後慢慢退回
  cx = lerp(G.focus.x, cx, G.camK); cy = lerp(G.focus.y, cy, G.camK); cz = lerp(G.focus.z, cz, G.camK);
  camera.position.set(cx, Math.max(terrainH(cx, cz) + .6, cy), cz);   // 最後保險:地形高度下限
  camera.lookAt(G.focus);
  // 瞄準相機取震動前的姿態(震動不影響落點)
  aimCam.position.copy(camera.position); aimCam.quaternion.copy(camera.quaternion); aimCam.updateMatrixWorld();
  G.shake = Math.max(0, G.shake - dt * .6);
  if (G.shake > 0) camera.position.add(new V3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(G.shake));
}

/* ================= HUD ================= */
const hotbar = document.getElementById('hotbar');
SKILLS.forEach((s, i) => {
  const d = document.createElement('div'); d.className = 'slot';
  d.innerHTML = '<b>' + (i + 1) + '</b><span class="ic">' + s.icon + '</span><span class="nm">' + s.name + '</span><div class="cdmask"></div><span class="cdt"></span><i></i>';
  d.onclick = () => selectSkill(i); hotbar.appendChild(d);
});
const slots = [...hotbar.children], cBox = document.getElementById('chargeBox'), cFill = document.getElementById('chargeFill'), cTxt = document.getElementById('chargeTxt'), infoEl = document.getElementById('info'), chantEl = document.getElementById('chant');
const btnJumpEl = document.getElementById('btnJump'), btnRollEl = document.getElementById('btnRoll'), btnWeapEl = document.getElementById('btnWeap');
// 屬性列(C-8):點擊切換;集氣 / 施法中淡化(CSS .busy)
const elBar = document.getElementById('elBar');
EL_ORDER.forEach((k, i) => {
  const d = document.createElement('div'); d.className = 'elc';
  d.innerHTML = '<b>' + (i + 4) + '</b><span>' + (EL[k].img ? '<img src="' + EL[k].img + '" alt="' + EL[k].ch + '" style="width:26px;height:26px" onerror="this.replaceWith(document.createTextNode(this.alt))">' : EL[k].ch) + '</span>';
  d.onclick = () => setElement(k); elBar.appendChild(d);
});
const elBtns = [...elBar.children];
document.getElementById('modeTag').onclick = toggleChgMode;   // 桌機點擊切換集氣模式
// 把 0~255 色碼的 #rrggbb 調暗(k 為倍率)
function dimHex(c, k) { const n = parseInt(c.slice(1), 16); return '#' + [16, 8, 0].map(s => Math.round(((n >> s) & 255) * k).toString(16).padStart(2, '0')).join(''); }
const xhairEl = document.getElementById('xhair'), lockMsgEl = document.getElementById('lockMsg');
let hotbarInit = false;   // SPELLS 在 spells.js(晚於 game.js 載入),快捷列第一次更新時才填入
function updateHUD() {
  if (!hotbarInit) { hotbarInit = true; refreshHotbar(); }
  { // 準心 / 「點擊回到遊戲」遮罩;P 面板與封面期間解除鎖定(設計 §2-1、§3)
    const panelOn = document.getElementById('panel').classList.contains('on'), lk = aimLock();
    if ((panelOn || window.COVER_ON) && isLocked()) document.exitPointerLock();
    const xs = CFG.camXhair && lk && !window.COVER_ON ? 'block' : 'none';
    if (xhairEl._s !== xs) { xhairEl._s = xs; xhairEl.style.display = xs; }
    const far = !!(lk && G.skill >= 0 && G.aimFar);
    if (xhairEl._f !== far) { xhairEl._f = far; xhairEl.classList.toggle('far', far); }
    const ls = CFG.camLock && !IS_TOUCH && !lk && !panelOn && !window.COVER_ON ? 'block' : 'none';
    if (lockMsgEl._s !== ls) { lockMsgEl._s = ls; lockMsgEl.style.display = ls; }
    const lt = G.lockErr ? '再點一次' : '點擊回到遊戲';
    if (lockMsgEl._t !== lt) { lockMsgEl._t = lt; lockMsgEl.textContent = lt; }
  }
  const E = auraEl(), on = G.state === 'charging', q = G.charge, max = on && q >= 1;
  slots.forEach((el, i) => {
    const act = i === G.skill;
    el.classList.toggle('active', act);
    el.lastChild.style.width = (act && on ? q * 100 : 0) + '%';
    const key = act ? E.css0 : '';
    if (el._k !== key) { el._k = key; el.style.borderColor = act ? E.css0 : ''; el.style.boxShadow = act ? '0 0 16px ' + E.css0 : ''; }
  });
  elBtns.forEach((b, i) => {
    const k = EL_ORDER[i], sel = k === G.el, key = sel ? EL[k].css0 : '';
    if (b._k !== key) { b._k = key; b.classList.toggle('sel', sel); b.style.borderColor = sel ? EL[k].css0 : ''; b.style.boxShadow = sel ? '0 0 12px ' + EL[k].css0 : ''; }
  });
  elBar.classList.toggle('busy', G.state !== 'ready');
  // 集氣條三段(C-0b):0~50% 暗色、50~99% css1→css0 漸層、100% 白光;用 clip-path 露出 q 的部分
  const sitT = resSitTxt();   // 打坐時 #chargeBox 借用顯示 MP / SP 恢復速度
  cBox.classList.toggle('on', on || sitT !== ''); cBox.classList.toggle('max', max);
  cFill.style.width = '100%'; cFill.style.clipPath = 'inset(0 ' + ((1 - q) * 100) + '% 0 0)';
  const bg = max ? '#fff' : E.css0 + E.css1;
  if (cFill._bg !== bg) {
    cFill._bg = bg;
    cFill.style.background = max ? '#fff' : 'linear-gradient(90deg,' + dimHex(E.css1, .6) + ' 0%,' + dimHex(E.css1, .6) + ' 50%,' + E.css1 + ' 50%,' + E.css0 + ' 100%)';
    cFill.style.boxShadow = max ? '0 0 12px #ffd27a' : '';
  }
  // 集氣文字預覽:集氣 ・ 傷害倍率 ・ 第三項(效果)
  if (on) { const sp = spellOf(G.skill), mt = modeTxt(q), rc = resCapTxt(); cTxt.textContent = (rc ? rc + ' ・ ' : '') + (max ? '集氣完成 MAX' : '集氣 ' + Math.round(q * 100) + '%') + ' ・ 傷害 ×' + CHG.dmg(q).toFixed(2) + (mt ? ' ・ ' + mt : '') + (sp.preview ? ' ・ ' + sp.preview(q) : ''); }
  else if (cTxt._t !== sitT) { cTxt._t = sitT; cTxt.textContent = sitT; }
  const ts = '0 0 8px ' + E.css1 + ',0 0 2px #000';
  if (chantEl._ts !== ts) { chantEl._ts = ts; chantEl.style.textShadow = ts; }
  let t = '職業:' + CLASSES[G.cls].name + ' ・ ' + (G.cls === 'mage' ? '屬性:' + E.name + ' ・ 裝備:' + W().name + '(' + W().tag + ')' + weaponDesc() : '裝備:' + CLASSES[G.cls].wpn);
  if (G.cls === 'mage') t += ' ・ 集氣模式 ' + G.chgMode;
  if (G.skill >= 0) { const sp = spellOf(G.skill), s = curSkill(G.skill); t += '<br>' + sp.name + ' ・ ' + (s.shape === 'wall' ? '長度 ' : '半徑 ') + skillRad().toFixed(1) + 'm ・ 射程 ' + skillRange().toFixed(1) + 'm'; }
  else t += '<br>未選擇法術(按 1/2/3)';
  t += '<br>' + (G.ground ? '跳躍 ● ●' : (G.airJumps > 0 ? '空中步 ●' : '空中步 ○')) + ' ・ 高度 ' + mage.root.position.y.toFixed(1) + 'm';
  t += '<br>閃避 ' + G.dodged + ' ・ 被擊中 ' + G.hits + (G.autoStrike ? ' ・ 自動來襲 ON' : '');
  t += '<br>HP ' + Math.ceil(G.hp) + '/' + G.hpMax + (G.shield > 0 ? ' ・ 護盾 ' + Math.ceil(G.shield) : '') + (G.downs ? ' ・ 倒下 ' + G.downs : '');
  { const zs = CFG.slowSelf && !(G.slowImmT > 0) ? zoneSlowAt(mage.root.position.x, mage.root.position.z, undefined, NET_ME).pct : 0; if (zs > 0) t += '<br>減速 ' + Math.round(zs * 100) + '%'; }
  t += classInfo();
  if (infoEl._t !== t) { infoEl.innerHTML = t; infoEl._t = t; }
  { const showI = window.NETON ? CFG.showInfoNet : CFG.showInfo; if (infoEl._off !== !showI) { infoEl._off = !showI; infoEl.classList.toggle('off', !showI); const hb = document.getElementById('hint'); if (hb && window.NETON) hb.style.display = showI ? '' : 'none'; else if (hb && hb.style.display) hb.style.display = ''; }
    const lt = document.getElementById('locTag'); if (lt) { const sc = typeof getSceneCfg === 'function' ? getSceneCfg() : null, pp = mage.root.position, lx = '📍 ' + (sc ? sc.name : '') + ' (' + Math.round(pp.x) + ', ' + Math.round(pp.z) + ') 高 ' + pp.y.toFixed(1) + 'm'; if (lt._t !== lx) { lt._t = lx; lt.textContent = lx; } } }
  const air = !G.ground;
  btnJumpEl.classList.toggle('air', air && G.airJumps > 0); btnJumpEl.classList.toggle('spent', air && G.airJumps <= 0);
  btnRollEl.classList.toggle('air', air && G.airRolls > 0); btnRollEl.classList.toggle('spent', air && G.airRolls <= 0);
  const wt = G.state === 'charging' ? '取消' : (G.cls === 'mage' ? '換裝' : '架勢'); if (btnWeapEl.textContent !== wt) btnWeapEl.textContent = wt; const ww = G.state === 'charging' ? 'x' : (G.cls === 'mage' ? 'm' : 's'); if (btnWeapEl.dataset.w !== ww) btnWeapEl.dataset.w = ww;
  syncModeUI();
  updateCdHUD();
  // 咒語字幕位置:角色頭上
  tmpV.copy(mage.root.position); tmpV.y += 3.1; tmpV.project(camera);
  chantEl.style.left = (tmpV.x * .5 + .5) * innerWidth + 'px'; chantEl.style.top = (-tmpV.y * .5 + .5) * innerHeight + 'px';
}

/* ================= 參數面板 ================= */
const PANEL = [
  ['鏡頭與操作'],
  ['camDist', '鏡頭距離', 2.5, 18, .5], ['camLock', '滑鼠鎖定(準心模式)', 'bool'], ['camXhair', '顯示準心', 'bool'], ['camSens', '視角靈敏度', .001, .015, .0005], ['camInvY', '反轉上下', 'bool'], ['camSmooth', '鏡頭平滑(0 = 即時)', 0, 1, .05], ['camShoulder', '肩後偏移(m)', 0, 1.5, .1], ['camKeyTurn', 'Q / E 轉向速度', 0, 5, .2], ['touchSens', '觸控靈敏度倍率', .5, 3, .1], ['padSens', '手把靈敏度倍率', .5, 2.5, .1],['autoFrame', '施法自動拉鏡頭', 'bool'], ['shake', '震動強度', 0, 2, .1],
  ['moveSpeed', '移動速度', 2, 10, .5], ['showInfo', '單人顯示詳細資訊', 'bool'], ['showInfoNet', '對戰顯示詳細資訊', 'bool'], ['dodgeWin', '閃避窗(秒)', .05, .45, .01], ['rollCD', '翻滾冷卻', .3, 2, .1], ['jumpV', '跳躍力道', 5, 14, .5], ['airJumpV', '二段跳力道', 5, 12, .5], ['airRollDist', '空中翻滾距離', 1, 6, .5], ['rollDist', '翻滾距離', 2, 10, .5], ['rollTime', '翻滾時間(秒)', .25, .8, .05], ['rollCD', '翻滾冷卻(秒)', 0, 2, .1], ['minHold', '最短集氣(秒)', 0, 1, .05], ['bloom', '泛光特效', 'bool'], ['bloomStrength', '泛光強度', 0, 2, .05],
  ['fxq', '特效粒子量(新屬性)', .3, 1, .05], ['dummyMove', '標靶左右移動', 'bool'], ['slowSelf', '風場 / 坑洞減速玩家', 'bool'], ['rangeK', '全域射程係數(測試用)', .5, 1.5, .05], ['radK', '全域半徑係數(測試用)', .5, 1.5, .05],
  ['投射類(火球等)'], ['skills.fireball.chargeTime', '集氣時間(秒)', .3, 4, .1], ['skills.fireball.range', '最大射程', 8, 45, 1], ['skills.fireball.rMin', '最小半徑', .5, 5, .1], ['skills.fireball.rMax', '最大半徑', 1, 10, .1], ['skills.fireball.recover', '施法後僵直(秒)', 0, 2, .05],
  ['牆類(火牆等)'], ['skills.firewall.chargeTime', '集氣時間(秒)', .3, 4, .1], ['skills.firewall.range', '最大射程', 8, 45, 1], ['skills.firewall.rMin', '最短長度', 2, 10, .5], ['skills.firewall.rMax', '最長長度', 6, 30, .5], ['skills.firewall.thick', '牆厚度', .5, 4, .1], ['skills.firewall.duration', '持續時間(秒)', 2, 20, .5], ['skills.firewall.recover', '施法後僵直(秒)', 0, 2, .05],
  ['大招類(隕石等)'], ['skills.meteor.chargeTime', '集氣時間(秒)', .3, 5, .1], ['skills.meteor.range', '最大射程', 8, 50, 1], ['skills.meteor.rMin', '最小半徑', 2, 10, .5], ['skills.meteor.rMax', '最大半徑', 4, 20, .5], ['skills.meteor.recover', '施法後僵直(秒)', 0, 3, .05],
  ['召喚類(第 4 格)'], ['skills.summon.chargeTime', '集氣時間(秒)', .3, 4, .1], ['skills.summon.range', '射程', 4, 30, 1], ['skills.summon.recover', '施法後僵直(秒)', 0, 2, .05],
  ['資源(測試 / 手感)'], ['res.infinite', '無限資源', 'bool'], ['res.mpRegen', 'MP 自然恢復 / 秒', 0, 30, 1], ['res.spRegen', 'SP 自然恢復 / 秒', 0, 60, 1], ['res.sitMp', '打坐 MP 倍率', 1, 10, .5], ['res.sitSp', '打坐 SP 倍率', 1, 10, .5], ['res.runCost', '跑步 SP 消耗 / 秒', 0, 40, 1],
  ['音效與音樂'], ['sfx.on', '音效', 'bool'], ['sfx.vol', '音效音量', 0, 1, .05], ['sfx.music', '音樂(場地氛圍)', 'bool'], ['sfx.mvol', '音樂音量', 0, 1, .05]
];
function getPath(o, p) { return p.split('.').reduce((a, k) => a[k], o); }
function setPath(o, p, v) { const ks = p.split('.'), l = ks.pop(); ks.reduce((a, k) => a[k], o)[l] = v; }
function buildPanel() {
  const root = document.getElementById('panel'); root.innerHTML = '';
  {   // 新版介面開關(body.hud2,存 localStorage mageSandbox.hud2;關閉 = 舊版版面)
    const h = document.createElement('h4'); h.textContent = '介面'; root.appendChild(h);
    const row = document.createElement('div'); row.className = 'row'; const lab = document.createElement('label'); lab.textContent = '新版介面'; row.appendChild(lab);
    const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = document.body.classList.contains('hud2');
    inp.onchange = () => { document.body.classList.toggle('hud2', inp.checked); try { localStorage.setItem('mageSandbox.hud2', inp.checked ? '1' : '0'); } catch (e) { } };
    row.appendChild(inp); root.appendChild(row);
  }
  PANEL.forEach(r => {
    if (r.length === 1) { const h = document.createElement('h4'); h.textContent = r[0]; root.appendChild(h); return; }
    const row = document.createElement('div'); row.className = 'row'; const lab = document.createElement('label'); lab.textContent = r[1]; row.appendChild(lab);
    const inp = document.createElement('input'), val = document.createElement('span');
    if (r[2] === 'bool') { inp.type = 'checkbox'; inp.checked = !!getPath(CFG, r[0]); inp.onchange = () => { setPath(CFG, r[0], inp.checked); saveCfg(); if (r[0] === 'camLock' && !inp.checked && isLocked()) document.exitPointerLock(); sfx.sync(); }; row.appendChild(inp); }
    else {
      inp.type = 'range'; inp.min = r[2]; inp.max = r[3]; inp.step = r[4]; inp.value = getPath(CFG, r[0]); val.textContent = inp.value;
      inp.oninput = () => { const v = parseFloat(inp.value); setPath(CFG, r[0], v); val.textContent = v; if (r[0] === 'bloomStrength' && bloom) bloom.strength = v; saveCfgSoon(); sfx.sync(); };
      row.appendChild(inp); row.appendChild(val);
    }
    root.appendChild(row);
  });
  const b = document.createElement('button'); b.textContent = '還原預設值';
  b.onclick = () => { mergeCfg(CFG, JSON.parse(JSON.stringify(DEFAULT_CFG))); saveCfg(); buildPanel(); }; root.appendChild(b);
  if (typeof stBuildTestPanel === 'function') stBuildTestPanel(root);   // 狀態測試(status.js)
  if (typeof window.padPanelExtra === 'function') window.padPanelExtra(root);   // 手把按鍵說明(touch.js)
  const rb = document.createElement('button'); rb.textContent = '重置標靶'; rb.onclick = () => resetWorld(); root.appendChild(rb);
}
buildPanel();
document.getElementById('gear').onclick = () => document.getElementById('panel').classList.toggle('on');

/* ================= 主迴圈 ================= */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, .05) * (window.TS || 1); last = now; G.time += dt;
  if (window.inputTick && !(window.NETON && window.NET_LOCK)) inputTick(dt);   // 多人開戰倒數中鎖定輸入(remote.js)
  G.px0 = mage.root.position.x; G.pz0 = mage.root.position.z; G.py0 = mage.root.position.y;
  if (window.NETON) netPlayerTick(dt);   // 多人:擊退、撞牆跌倒、無敵紀錄(netcombat.js,在 updatePlayer 之前)
  stTick(dt);                            // 狀態效果計時與 DOT(status.js,單人也跑)
  if (G.perfT > 0) G.perfT = Math.max(0, G.perfT - dt);   // 完美閃避加速計時(perfectDodge / classTick 的 spdK)
  classTick(dt); resTick(dt); updatePlayer(dt); if (window.sceneTick) sceneTick(dt); updateAim(dt); updateCasting(dt);
  mage.update(dt, { move: G.speedN || 0, cast: G.cb, kick: G.kick, charge: G.charge, t: G.time, hover: 0, roll: G.roll ? Math.min(1, G.roll.t / G.roll.time) : -1, rollPhi: G.roll ? G.roll.phi : 0, flip: G.flip, sit: G.sitK, down: G.downK });
  updateOrb(dt); updateCamera(dt); updateWorld(dt); updateFx(dt); updateLights(dt);
  if (window.NETON) netTick(dt);   // 多人:送出快照、開戰倒數(remote.js);單人不執行
  fire.update(dt); smoke.update(dt); updateDmgTexts(dt); updateHUD(); updateResHUD();
  sky.position.copy(camera.position); sky.material.uniforms.uTime.value = G.time;
  { const sn = window.SHADOWN == null ? 1 : window.SHADOWN; G.shN = (G.shN || 0) + 1; moonLight.shadow.autoUpdate = false; moonLight.shadow.needsUpdate = sn > 0 && G.shN % sn === 0; }   // 陰影每 sn 格才重畫一次(省電)
  if (bloom) bloom.strength = CFG.bloomStrength * (window.BLOOMK == null ? 1 : window.BLOOMK);
  if (CFG.bloom && composer) composer.render(dt); else renderer.render(scene, camera);
}
window.startLoop = () => requestAnimationFrame(frame);   // classes.js 載入後才開始(避免載入途中呼叫)
window.G = G; window.CFG = CFG;
