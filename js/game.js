'use strict';
/* ================= 設定(可在遊戲內 P 面板調整,存 localStorage) ================= */
const GRAV = 20, COYOTE = 0.10;   // 重力加速度;離地後仍可地面跳的時間(s)
const DEFAULT_CFG = {
  jumpV: 9.5, airJumpV: 10, airRollDist: 3.5, airRollTime: 0.32, airRollGrav: 0.25, rollDist: 5, rollTime: 0.45, rollCD: 0.6,
  moveSpeed: 5, runMul: 1.7, camDist: 9, camSens: 0.005, autoFrame: true, shake: 1, bloom: true, bloomStrength: 0.85, minHold: 0.3,
  rad: [2.2, 9, 7], radById: {}, fxq: 1, dummyMove: false,
  skills: {
    fireball: { chargeTime: 1.4, range: 24, rMin: 1.2, rMax: 4.5, recover: 0.45 },
    firewall: { chargeTime: 1.5, range: 22, rMin: 4, rMax: 16, recover: 0.5, thick: 1.6, duration: 8 },
    meteor: { chargeTime: 2.4, range: 28, rMin: 4, rMax: 12, recover: 0.7 },
    quickShot: { chargeTime: 0.6, range: 30, rMin: 0.6, rMax: 1.2, recover: 0.25 },
    shockArrow: { chargeTime: 1.2, range: 28, rMin: 12, rMax: 28, recover: 0.45, width0: 1.6, width1: 3.0 },
    arrowRain: { chargeTime: 1.8, range: 30, rMin: 3, rMax: 10, recover: 0.6 },
    powerSlash: { chargeTime: 1.0, range: 1.6, rMin: 2, rMax: 4, recover: 0.4 },
    whirlwind: { chargeTime: 0.9, range: 0, rMin: 2.5, rMax: 5, recover: 0.3 },
    shieldCharge: { chargeTime: 1.0, range: 0, rMin: 5, rMax: 12, recover: 0.35, width: 1.6 },
    backstab: { chargeTime: 0.6, range: 5, rMin: 1, rMax: 1.6, recover: 0.3 },
    knives: { chargeTime: 0.7, range: 18, rMin: 20, rMax: 60, recover: 0.3 },
    stealth: { chargeTime: 0.8, range: 0, rMin: 0, rMax: 0, recover: 0.2 }
  }
};
const CFG = JSON.parse(JSON.stringify(DEFAULT_CFG));
const CFG_KEY = 'mageSandbox.cfg.v1';
function mergeCfg(dst, src) { for (const k in src) { if (dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) mergeCfg(dst[k], src[k]); else if (k in dst) dst[k] = src[k]; } }
if (IS_TOUCH) CFG.bloom = false;  // 手機預設關泛光(省效能),可在 P 面板打開
if (IS_TOUCH) CFG.fxq = 0.6;      // 手機預設粒子量 60%(只影響新屬性)
try { const s = JSON.parse(localStorage.getItem(CFG_KEY)); if (s) mergeCfg(CFG, s); } catch (e) { }
function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch (e) { } }

// 形狀槽位(kind:bolt 投射 / wall 牆 / sky 大招);名稱與咒語依屬性在 spells.js 的 SPELLS
const SKILLS = [
  { id: 'fireball', name: '火球術', icon: '🔥', el: 'fire', shape: 'circle', kind: 'bolt', chant: '火之精靈,聚於我手,化為灼熱之球——燃盡一切!', shout: '火球術!' },
  { id: 'firewall', name: '火牆術', icon: '🧱', el: 'fire', shape: 'wall', kind: 'wall', chant: '烈焰之壁,拔地而起,焚盡來犯之敵——', shout: '火牆術!' },
  { id: 'meteor', name: '隕石術', icon: '☄️', el: 'fire', shape: 'circle', kind: 'sky', chant: '天外星辰,聽我召喚,墜落吧——毀滅之石!', shout: '隕石術!' }
];
const sc = i => CFG.skills[baseOf(i)];   // 招式的數值表鍵(法師 = 自己的 id;職業暫時招式 = 沿用的 base)
// 統一集氣倍率(C-0b):q = 集氣比例 0~1;兩端 q=0 與 q=1 之間線性;所有招式只讀這套
const CHG = {
  dmg:   q => 0.5 + 0.8 * (0.35 + 0.65 * q),       // 0.78 → 1.30
  size:  q => lerp(0.6, 1.0, q),                    // 範圍:半徑 / 牆長 / 線長 / 位移距離
  dur:   q => 0.7 + 0.6 * (0.35 + 0.65 * q),        // 0.91 → 1.30(持續時間)
  fx:    q => lerp(0.5, 1.0, q),                    // 效果強度:減速%、推 / 拉 / 擊飛距離、暈眩 / 燃燒秒數、易傷%
  count: (n, q) => Math.max(1, Math.round(n * lerp(0.4, 1.0, q)))   // 數量:n = 滿集氣數量
};
// 換裝差異(法杖=重擊、魔法書=速唱);集氣時間與僵直只受 chargeMul / recoverMul 影響
const WEAPONS = {
  staff: { name: '法杖', tag: '重擊', chargeMul: 1.0, dmgMul: 1.2, rangeMul: 1.15, recoverMul: 1.0 },
  book:  { name: '魔法書', tag: '速唱', chargeMul: 0.7, dmgMul: 1.0, rangeMul: 1.0, recoverMul: 0.7 }
};
const NEUTRAL_W = { name: '', tag: '', chargeMul: 1, dmgMul: 1, rangeMul: 1, recoverMul: 1 };   // 非法師職業不套用法杖 / 書倍率
const NEUTRAL_EL = { chargeMul: 1, rangeMul: 1, speedMul: 1 };
const W = () => G.cls === 'mage' ? WEAPONS[G.weapon] : NEUTRAL_W;
const elm = () => G.cls === 'mage' ? ELMOD[G.el] : NEUTRAL_EL;   // ELMOD 在 spells.js(執行期才讀)
const skillRange = () => (G.skill >= 0 && curSkill(G.skill).aim === 'line' ? Math.max(sc(G.skill).range, skillRad()) : sc(G.skill).range) * W().rangeMul * elm().rangeMul;
const chargeTimeEff = () => sc(G.skill).chargeTime * W().chargeMul * elm().chargeMul;
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
  cls: 'mage', cd: {}, stealth: null, weak: 0, dash: null, spin: null,
  el: 'fire'   // 目前屬性(C-8,只有法師使用),存 localStorage mageSandbox.el
};
try { const v = localStorage.getItem('mageSandbox.el'); if (EL_ORDER.includes(v)) G.el = v; } catch (e) { }

/* ================= 角色與場景物件 ================= */
const mage = new Mage(scene);
mage.setElementColor(EL[G.el].hex);
const ind = new Indicator(scene);
const tmpV = new V3(), tmpV2 = new V3();

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
function onResize() {
  renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (composer) { composer.setSize(innerWidth, innerHeight); }
  const u = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
  fire.mat.uniforms.uScale.value = u; smoke.mat.uniforms.uScale.value = u;
}
addEventListener('resize', onResize); onResize();

/* ================= 輸入 ================= */
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (['Tab', 'Space'].includes(e.code)) e.preventDefault();
  if (e.ctrlKey && ['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract', 'Numpad0'].includes(e.code)) { e.preventDefault(); if (e.code === 'Digit0' || e.code === 'Numpad0') G.zoom = 1; return; }
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
  else if (e.code === 'KeyT') strike();
  else if (e.code === 'KeyY') toggleAuto();
  else if (e.code === 'KeyK') cycleClass(1);
});
addEventListener('keyup', e => { G.keys[e.code] = false; });
addEventListener('blur', () => { G.keys = {}; G.atkHeld = false; if (G.state === 'charging') cancelCharge(); });
addEventListener('contextmenu', e => e.preventDefault());
const fromTouch = () => performance.now() - G.lastTouch < 800;  // 觸控後瀏覽器會補發假滑鼠事件,忽略
function doJump() {
  if (G.state !== 'ready' || G.roll || G.stun > 0) return;
  if (G.ground || G.coyote > 0) { G.vy = CFG.jumpV; G.ground = false; G.coyote = 0; return; }
  if (G.airJumps > 0) { G.airJumps = 0; G.vy = CFG.airJumpV; G.flip = 0; airStepFx(mage.root.position); return; }
  G.jumpBuf = 0.12;
}
function moveInput() {
  const K = G.keys, ix = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0), iz = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0);
  if (ix || iz) return { ix, iz, s: 1, run: !!(K.ShiftLeft || K.ShiftRight) };
  if (G.stick.mag > .12) return { ix: G.stick.x / G.stick.mag, iz: -G.stick.y / G.stick.mag, s: Math.min(1, G.stick.mag * 1.15), run: G.stick.mag > .92 };
  return { ix: 0, iz: 0, s: 0, run: false };
}
addEventListener('mousemove', e => {
  if (fromTouch()) return; G.inputMode = 'mouse';
  G.mouse.x = e.clientX; G.mouse.y = e.clientY;
  if (G.rmb) { G.camYaw -= e.movementX * CFG.camSens; G.camPitch = clamp(G.camPitch + e.movementY * CFG.camSens, 0.08, 1.35); }
});
addEventListener('mousedown', e => {
  if (e.target.tagName !== 'CANVAS' || fromTouch()) return;
  G.inputMode = 'mouse';
  if (e.button === 2) G.rmb = true;
  if (e.button === 0) { G.atkHeld = true; startCharge(); }
});
addEventListener('mouseup', e => {
  if (e.button === 0) G.atkHeld = false;
  if (fromTouch()) return;
  if (e.button === 2) G.rmb = false;
  if (e.button === 0 && G.state === 'charging') { if (G.chargeT < CFG.minHold) G.queued = true; else release(); }
});
addEventListener('wheel', e => {
  if (e.ctrlKey) e.preventDefault();   // 擋瀏覽器頁面縮放(Ctrl+滾輪)
  if (e.target.tagName !== 'CANVAS') return;
  e.preventDefault();
  if (G.skill >= 0 && !e.ctrlKey && (G.state === 'ready' || G.state === 'charging')) {
    const c = sc(G.skill), step = (c.rMax - c.rMin) / 14;
    setRad(G.skill, clamp(getRad(G.skill) - Math.sign(e.deltaY) * step, c.rMin, c.rMax)); saveCfgSoon();
  } else G.zoom = clamp(G.zoom * (1 + Math.sign(e.deltaY) * .1), .5, 1.9);
}, { passive: false });
let saveTimer = 0; function saveCfgSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveCfg, 400); }

function selectSkill(i) {
  if (G.state !== 'ready') return;
  if (G.skill === i) G.skill = -1; else setSkill(i);
}
// 設定目前法術(不切換):記錄 lastSkill,並把牆角度歸零
function setSkill(i) { if (G.state !== 'ready') return; G.skill = i; G.lastSkill = i; G.wallOff = 0; }
// 手把 L / R:未選法術時選回上次那一招;已選則前後換一招
function cycleSkill(d) { if (G.skill < 0) setSkill(G.lastSkill); else setSkill((G.skill + d + SKILLS.length) % SKILLS.length); }
function toggleAuto() { G.autoStrike = !G.autoStrike; G.strikeT = 1; banner('自動來襲 ' + (G.autoStrike ? 'ON' : 'OFF'), '#ffe3b0'); }
function resetCam() { G.zoom = 1; G.camPitch = .42; G.camYaw = Math.PI; }
function toggleWeapon() {
  if (G.state !== 'ready') return;
  if (G.cls !== 'mage') { banner('此職業無換裝', '#ffc46b'); return; }
  G.weapon = G.weapon === 'staff' ? 'book' : 'staff'; mage.setWeapon(G.weapon); banner(W().name + '・' + W().tag, '#ffc46b');
}
// 範圍記憶:法師用 CFG.rad[槽位];其他職業用 CFG.radById[招式 id]
function getRad(i) { if (G.cls === 'mage') return CFG.rad[i]; const c = sc(i), v = CFG.radById[curSkill(i).id]; return v == null ? (c.rMin + c.rMax) / 2 : v; }
function setRad(i, v) { if (G.cls === 'mage') CFG.rad[i] = v; else CFG.radById[curSkill(i).id] = v; }
function skillRad() { const c = sc(G.skill); return clamp(getRad(G.skill), c.rMin, c.rMax); }
// 屬性切換(C-8):只在 ready 生效;保留目前形狀
function setElement(el) {
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
  if (G.state === 'charging') cancelCharge();
  G.state = 'ready';
  const mi = moveInput(); let ix = mi.ix, iz = mi.iz, dx, dz;
  if (ix || iz) {
    const l = Math.hypot(ix, iz); ix /= l; iz /= l;
    dx = -Math.sin(G.camYaw) * iz + Math.cos(G.camYaw) * ix; dz = -Math.cos(G.camYaw) * iz - Math.sin(G.camYaw) * ix;
  } else { dx = -Math.cos(mage.yaw); dz = Math.sin(mage.yaw); }  // 沒按方向:往角色右側翻
  if (air) { G.airRolls = 0; G.vy = 0; }
  G.roll = { t: 0, dx, dz, phi: angDiff(mage.yaw, Math.atan2(dx, dz)), dist: air ? CFG.airRollDist : CFG.rollDist, time: air ? CFG.airRollTime : CFG.rollTime, air };
  if (!G.stealth) for (let i = 0; i < 6; i++) smoke.emit(p.x + rnd(-.3, .3), p.y + .15, p.z + rnd(-.3, .3), rnd(-1, 1), rnd(.3, 1), rnd(-1, 1), rnd(.5, .9), rnd(.8, 1.4), [.5, .45, .4], [.3, .3, .3], .4, 2, 0, 1.5);
}
function banner(txt, color) {
  const b = document.getElementById('banner'); b.textContent = txt; b.style.color = color; b.style.opacity = 1; b._t = 1.2;
}
function strike() {
  const p = mage.root.position, S = G.stealth, pos = S ? new V3(S.x, surfaceY(S.x, S.z), S.z) : new V3(p.x, surfaceY(p.x, p.z), p.z), R = 2.4, W = 1.2, wi = new Indicator(scene); let t = 0;
  addFx(dt => {
    t += dt;
    if (t < W) { wi.set(pos.x, pos.z, 0, R, 0, 0, t / W, .9, 0xff2030, pos.y); wi.tick(G.time); return true; }
    wi.root.parent.remove(wi.root);
    explode(pos, R, .8, { dmg: 0, gy: pos.y }); G.shake = Math.max(G.shake, .25 * CFG.shake);
    const q = mage.root.position, inside = Math.hypot(q.x - pos.x, q.z - pos.z) < R && Math.abs(q.y - pos.y) < 3;
    if (inside && q.y - pos.y >= 1.2) { G.dodged++; banner('跳躍閃避!', '#8fe8ff'); }
    else if (inside && G.invuln) { G.dodged++; banner('翻滾閃避!', '#8fe8ff'); }
    else if (inside && shieldOn()) { G.dodged++; banner('盾擋!', '#ffd27a'); }
    else if (!inside) { G.dodged++; if (S) banner('目標遺失', '#c08aff'); else banner('走位躲開', '#bff0a0'); }
    else {
      if (G.stealth) revealStealth('hit');   // 潛行中被紅圈炸到:顯形
      G.hits++; G.stun = .6; G.vy = 5; banner('致命一擊!', '#ff5050');
      const f = document.getElementById('flash'); f.style.opacity = .6; setTimeout(() => f.style.opacity = 0, 120);
      if (G.state === 'charging') cancelCharge();
    }
    return false;
  });
}

/* ================= 瞄準:滑鼠 → 地面 ================= */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), gPlane = new THREE.Plane(new V3(0, 1, 0), 0);
function pickGround(out) {
  const p = mage.root.position;
  ndc.set(G.mouse.x / innerWidth * 2 - 1, -(G.mouse.y / innerHeight * 2 - 1)); ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d0 = ray.ray.direction; let best = Infinity, hx = 0, hz = 0;
  if (d0.y < -1e-4) { const t = -o.y / d0.y; if (t >= 0) { best = t; hx = o.x + d0.x * t; hz = o.z + d0.z * t; } }
  for (const P of PLATFORMS) {   // 高台頂面也參與取最近交點(只決定 xz)
    if (d0.y >= -1e-4 || o.y <= P.top) continue;
    const t = (P.top - o.y) / d0.y; if (t >= best) continue;
    const x = o.x + d0.x * t, z = o.z + d0.z * t;
    if (platContains(P, x, z, 0)) { best = t; hx = x; hz = z; }
  }
  if (best === Infinity) { camera.getWorldDirection(tmpV2); hx = p.x + tmpV2.x * skillRange(); hz = p.z + tmpV2.z * skillRange(); }
  tmpV.set(hx, 0, hz);
  let dx = tmpV.x - p.x, dz = tmpV.z - p.z, d = Math.hypot(dx, dz);
  const minD = curSkill(G.skill).shape === 'wall' ? 2 : 1.2;
  if (d < 1e-4) { dx = Math.sin(mage.yaw); dz = Math.cos(mage.yaw); d = 1; }
  const dd = clamp(d, minD, skillRange());
  const ox = p.x + dx / d * dd, oz = p.z + dz / d * dd; out.set(ox, surfaceY(ox, oz), oz);
}

// 搖桿/觸控瞄準:集氣時左搖桿的方向=光圈方向、推多少=離多遠;放開搖桿則光圈停在原地
function pickStick(out) {
  const p = mage.root.position, mc = moveCharge();
  if (G.state === 'charging' && G.stick.mag > .15 && !mc) {
    const ix = G.stick.x / G.stick.mag, iz = -G.stick.y / G.stick.mag;
    const fx = -Math.sin(G.camYaw), fz = -Math.cos(G.camYaw), rx = Math.cos(G.camYaw), rz = -Math.sin(G.camYaw);
    const dx = fx * iz + rx * ix, dz = fz * iz + rz * ix, minD = curSkill(G.skill).shape === 'wall' ? 2 : 1.2;
    const d = lerp(minD, skillRange(), Math.min(1, G.stick.mag));
    const x = p.x + dx * d, z = p.z + dz * d; G.stickHold.set(x, surfaceY(x, z), z);
  } else if (G.state === 'ready' || mc) {
    const x = p.x + Math.sin(mage.yaw) * skillRange() * .5, z = p.z + Math.cos(mage.yaw) * skillRange() * .5; G.stickHold.set(x, surfaceY(x, z), z);
  }
  out.copy(G.stickHold);
}

/* ================= 施法狀態機 ================= */
function startCharge() {
  if (G.state !== 'ready' || G.roll || G.stun > 0) return;
  if (G.skill < 0) G.skill = G.lastSkill;
  if (G.cd[curSkill(G.skill).id] > 0 || skillBlocked(curSkill(G.skill))) return;   // 冷卻中 / 虛弱中不能開始集氣
  G.state = 'charging'; G.chargeT = 0; G.charge = 0; G.queued = false; G.maxFlash = false; G.halfFlash = false;
  { const p = mage.root.position, x = p.x + Math.sin(mage.yaw) * skillRange() * .5, z = p.z + Math.cos(mage.yaw) * skillRange() * .5; G.stickHold.set(x, surfaceY(x, z), z); }
  G.orb = makeOrb(auraEl()); scene.add(G.orb);
}
function cancelCharge() {
  if (G.state !== 'charging') return;
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
function release() {
  const sk = curSkill(G.skill), sp = spellOf(G.skill), p = mage.root.position, q = G.charge;
  const dir = Math.atan2(G.target.x - p.x, G.target.z - p.z);
  G.pending = {
    skill: sk, spell: sp, base: baseOf(G.skill), idx: G.skill, el: G.cls === 'mage' ? G.el : 'fire', target: G.target.clone(), q, charge: q,
    r: skillRad() * CHG.size(q), power: 0.35 + 0.65 * q,
    dmgK: CHG.dmg(q) * W().dmgMul, sizeK: CHG.size(q), durK: CHG.dur(q), fxK: CHG.fx(q),
    dir, wallYaw: dir + G.wallOff, dmgMul: W().dmgMul, recover: sc(G.skill).recover * W().recoverMul
  };
  if (sk.cd) G.cd[sk.id] = sk.cd;   // 冷卻從施放開始計
  auraGather();                     // 氣場收束到武器尖端
  G.state = 'cast'; G.castT = 0; G.launched = false; G.queued = false;
  G.shoutT = 1.0; const ch = document.getElementById('chant'); ch.textContent = sp.shout; ch.style.fontSize = '30px';
}
function updateCasting(dt) {
  for (const k in G.cd) if (G.cd[k] > 0) G.cd[k] = Math.max(0, G.cd[k] - dt);
  if (G.state === 'charging') {
    G.chargeT += dt; G.charge = clamp(G.chargeT / chargeTimeEff(), 0, 1);
    if (G.charge >= .5 && !G.halfFlash) { G.halfFlash = true; burstRing(mage.root.position, auraEl().hex, 1.2); }
    if (G.charge >= 1 && !G.maxFlash) { G.maxFlash = true; G.shake = Math.max(G.shake, .05); burstRing(mage.root.position, 0xffd27a, 2.4); }
    if (G.queued && G.chargeT >= CFG.minHold) release();
  } else if (G.state === 'cast') {
    G.castT += dt;
    if (!G.launched && G.castT >= 0.14) {
      G.launched = true; G.kick = 1; launchSpell(G.pending, G.orb); G.orb = null;
      const kd = G.pending.skill.kind;
      G.frameT = kd === 'sky' ? 3.8 : (kd === 'wall' ? 1.6 : 1.1);
    }
    if (G.castT >= G.pending.recover) { G.state = 'ready'; if (G.atkHeld) startCharge(); }
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
function updatePlayer(dt) {
  // mc:劍士 / 刺客集氣中可移動;lock 為不能移動;face 為面向瞄準點
  const p = mage.root.position, K = G.keys, mc = G.state === 'charging' && moveCharge(), lock = (G.state === 'charging' && !mc) || (G.state === 'cast' && !G.spin), face = lock || mc;
  const mi = moveInput(); let ix = mi.ix, iz = mi.iz, speedN = 0, ty = mage.yaw;
  G.rollCD = Math.max(0, G.rollCD - dt); G.stun = Math.max(0, G.stun - dt);
  const free = !lock && !G.roll && G.stun <= 0;
  if (G.roll) {
    const R = G.roll; R.t += dt; const q = Math.min(1, R.t / R.time), v = 2 * R.dist / R.time * (1 - q);
    p.x += R.dx * v * dt; p.z += R.dz * v * dt; G.invuln = q > .05 && q < .8;
    for (let i = 0; i < 3; i++) fire.emit(p.x + rnd(-.2, .2), p.y + rnd(.3, 1.4), p.z + rnd(-.2, .2), -R.dx * 1.5, rnd(0, .8), -R.dz * 1.5, .35, rnd(.5, .9), [.6, .9, 1], [.2, .4, 1], .45, .3, 0, 2);
    if (q >= 1) { G.roll = null; G.rollCD = CFG.rollCD; G.invuln = false; }
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
  const gY = groundAt(p.x, p.z, p.y);             // 用積分前的 y 找支撐面
  const gMul = (G.roll && G.roll.air) ? CFG.airRollGrav : 1;
  const wasGround = G.ground;
  G.vy -= GRAV * gMul * dt; p.y += G.vy * dt;
  if (p.y <= gY) {
    p.y = gY; if (G.vy < 0) G.vy = 0;
    G.ground = true; G.groundY = gY; G.airJumps = 1; G.airRolls = 1;
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
  if (G.skill < 0 || (G.state !== 'ready' && G.state !== 'charging')) {
    if (G.state === 'cast' && G.pending) { /* 施放中:光圈保持並淡出(只畫實際範圍,不畫外圈) */
      const P = G.pending, a = Math.max(0, 1 - G.castT / Math.max(.2, P.recover)) * .9, hex = auraEl().hex;
      ind.setMax(0, 0, 0);
      if (P.skill.shape === 'wall') ind.set(P.target.x, P.target.z, 1, P.r / 2, sc(P.idx).thick / 2, P.wallYaw, 1, a, hex, P.target.y);
      else ind.set(P.target.x, P.target.z, 0, P.r, 0, 0, 1, a, hex, P.target.y);
    } else ind.hide();
    return;
  }
  if (G.inputMode === 'stick') pickStick(tmpV2); else pickGround(tmpV2);
  G.target.x = damp(G.target.x, tmpV2.x, 30, dt); G.target.z = damp(G.target.z, tmpV2.z, 30, dt);
  G.target.y = surfaceY(G.target.x, G.target.z);
  if (G.state === 'ready' && ind.root.visible === false) G.target.copy(tmpV2);
  const sk = curSkill(G.skill), c = sc(G.skill), p = mage.root.position, E = auraEl();
  const charging = G.state === 'charging', q = charging ? G.charge : 0, rs = skillRad();
  const pulse = charging && G.charge >= 1 ? .75 + .25 * Math.sin(G.time * 14) : 1;
  const alpha = (charging ? .95 : .55) * pulse;
  if (aimSpecial(sk, p, charging, q, rs, alpha, E)) return;   // 方向型 / 前方 / 自身 / 無光圈(classes.js)
  // 光圈雙層(C-0b):外圈 = 滿集氣範圍 R(setMax),內圈 = 實際範圍 R × CHG.size(q)
  if (sk.shape === 'wall') {
    if (G.keys.KeyQ) G.wallOff += dt * 1.8; if (G.keys.KeyE) G.wallOff -= dt * 1.8;
    const yaw = Math.atan2(G.target.x - p.x, G.target.z - p.z) + G.wallOff;
    ind.setMax(0, rs / 2, c.thick / 2);
    ind.set(G.target.x, G.target.z, 1, rs * CHG.size(q) / 2, c.thick / 2, yaw, charging ? G.charge : 0, alpha, E.hex, G.target.y);
  } else {
    ind.setMax(rs, 0, 0);
    ind.set(G.target.x, G.target.z, 0, rs * CHG.size(q), 0, 0, charging ? G.charge : 0, alpha, E.hex, G.target.y);
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
  runeMesh.material.opacity = a * .9; runeMesh.scale.setScalar(2.4 + a * 1.8); runeGrp.rotation.y = G.time * .9; runeGrp.visible = a > .02 && G.cls === 'mage';
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
  m.rotation.x = -Math.PI / 2; m.position.set(pos.x, pos.y + .1, pos.z); scene.add(m);
  let t = 0; addFx(dt => { t += dt / .5; if (t >= 1) { scene.remove(m); m.material.dispose(); return false; } m.scale.setScalar(Math.max(.01, R * easeOut(t))); m.material.opacity = .9 * (1 - t) * (1 - t); });
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
const FX = []; function addFx(fn) { FX.push(fn); }
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
    if (dist < R + .4) d.hit(dmg * (1 - clamp(dist / (R + .4), 0, 1) * .5) * rnd(.9, 1.1), dx, dz, burn, el);
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
  ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, gy + .08, pos.z); scene.add(ring);
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
    sc2.rotation.x = -Math.PI / 2; sc2.rotation.z = rnd(0, 6); sc2.position.set(pos.x, gy + .03 + (SCORCH.length % 7) * .002, pos.z); sc2.scale.setScalar(R * 2.4 * rnd(.9, 1.1)); scene.add(sc2);
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
  if (!orb) { orb = makeOrb(auraEl()); scene.add(orb); mage.tipWorld(orb.position); orb.setR(.3); }
  if (P.skill.cast) return P.skill.cast(P, orb);   // D2~D4 專屬招式
  // 元素 + 形狀查表(SHAPE_FN 在 spells.js);查不到退回火系原行為
  const row = SHAPE_FN[P.el] || SHAPE_FN.fire, f = row[P.skill.kind] || SHAPE_FN.fire[P.skill.kind];
  f(P, orb);
}

function trail(a, b, n, size, life, el) {
  const E = EL[el || 'fire'];
  for (let i = 0; i < n; i++) {
    const t = Math.random();
    fire.emit(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t), rnd(-.6, .6), rnd(-.3, .8), rnd(-.6, .6), rnd(life * .6, life), size * rnd(.6, 1.2), E.c0, E.c1, .9, .3, -.5, .4);
  }
}

function castFireball(P, orb) {
  const gy = P.target.y, start = orb.position.clone(), end = P.target.clone(); end.y = gy + .4;
  const dist = start.distanceTo(end), dur = clamp(dist / 32, .25, .9); let t = 0; const prev = start.clone(), r0 = Math.max(orb.r, .3);
  orb.setR(r0 * (.8 + P.power * .6));
  addFx(dt => {
    t += dt / dur; const u = Math.min(t, 1);
    orb.position.lerpVectors(start, end, u); orb.position.y += Math.sin(Math.PI * u) * dist * .06;
    trail(prev, orb.position, 6, orb.r * 1.3, .45, P.el); smoke.emit(orb.position.x, orb.position.y, orb.position.z, rnd(-.3, .3), rnd(0, .5), rnd(-.3, .3), 1, orb.r * 1.5, [.25, .2, .18], [.08, .08, .09], .35, 2.2, -.2, .5);
    prev.copy(orb.position);
    if (u >= 1) { scene.remove(orb); explode(end, P.r, P.power, { dmg: 80, gy, el: P.el, mul: P.dmgK, fxK: P.fxK, burn: 3 * P.fxK }); return false; }
  });
}

function castFirewall(P, orb) {
  const gy = P.target.y, start = orb.position.clone(), end = P.target.clone(); end.y = gy + .5; const dur = clamp(start.distanceTo(end) / 36, .2, .6); let t = 0; const prev = start.clone();
  addFx(dt => {
    t += dt / dur; const u = Math.min(t, 1);
    orb.position.lerpVectors(start, end, u); trail(prev, orb.position, 5, orb.r * 1.2, .4, P.el); prev.copy(orb.position);
    if (u >= 1) { scene.remove(orb); spawnWall(P); return false; }
  });
}
function spawnWall(P) {
  const gy = P.target.y, cfg = sc(P.idx), half = P.r / 2, thick = cfg.thick, ax = Math.cos(P.wallYaw), az = -Math.sin(P.wallYaw), E = EL[P.el];
  const n = Math.ceil(P.r / .7) + 1, segs = [], dur = cfg.duration * P.durK;
  for (let i = 0; i < n; i++) { const o = (i / (n - 1) - .5) * P.r; segs.push({ o, x: P.target.x + ax * o, z: P.target.z + az * o, on: Math.abs(o) / half * .4, acc: 0 }); }
  const wi = new Indicator(scene); let age = 0, tick = 0;
  const gl = []; for (let i = 0; i < n; i += 2) { const s = glowSprite(E.hex, 3, .5); s.position.set(segs[i].x, gy + .6, segs[i].z); scene.add(s); gl.push(s); }
  flashLight(new V3(P.target.x, gy + 2, P.target.z), E.hex, 5, .5, 25); G.shake = Math.max(G.shake, .08 * CFG.shake);
  const L = LIGHTS[4]; L.color.setHex(E.hex); L.position.set(P.target.x, gy + 1.8, P.target.z); L.distance = 10 + P.r * 1.3;
  addFx(dt => {
    age += dt; const fade = age > dur - 1 ? Math.max(0, dur - age) : 1;
    if (age >= dur) { wi.hide(); wi.root.parent.remove(wi.root); gl.forEach(s => { scene.remove(s); s.material.dispose(); }); L.intensity = 0; return false; }
    wi.set(P.target.x, P.target.z, 1, half, thick / 2, P.wallYaw, 0, .35 * fade * (.8 + .2 * Math.sin(age * 12)), E.hex, gy); wi.tick(age);
    L.intensity = 3.5 * fade * (.85 + Math.random() * .3);
    const H = (.7 + P.power * .6) * 1.2;
    for (const s of segs) {
      if (age < s.on) continue;
      const ramp = Math.min(1, (age - s.on) / .25) * fade; s.acc += dt * 38 * ramp;
      while (s.acc >= 1) {
        s.acc -= 1; const lx = rnd(-thick / 2, thick / 2);
        fire.emit(s.x + (-az) * lx, gy + rnd(0, .3), s.z + ax * lx, rnd(-.4, .4), rnd(2.5, 4.5) * H * ramp, rnd(-.4, .4), rnd(.6, 1.0), rnd(.9, 1.5), E.c0, E.c1, .95, .35, -.3, .6);
        if (Math.random() < .07) smoke.emit(s.x, gy + 1.8, s.z, rnd(-.3, .3), rnd(1, 2), rnd(-.3, .3), rnd(1.4, 2.2), rnd(1.5, 2.5), [.25, .2, .18], [.08, .08, .09], .4, 2.2, -.3, .6);
      }
    }
    gl.forEach((s, i) => { s.material.opacity = (.35 + Math.random() * .2) * fade; s.scale.setScalar(2.6 + Math.sin(age * 9 + i) * .4); });
    tick += dt;
    if (tick >= .3) {
      tick = 0;
      if (gy <= 1.5) for (const d of DUMMIES) {
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
  const gy = P.target.y, S = new V3(-9, 0, -6), skyY = gy + 16, E = EL[P.el], count = CHG.count(15, P.q), rock = [];
  const sig = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: RUNE_TEX, color: E.hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  sig.rotation.x = -Math.PI / 2; sig.position.set(P.target.x + S.x, skyY, P.target.z + S.z); sig.scale.setScalar(P.r * 2.6); scene.add(sig);
  const gi = new Indicator(scene);
  const sched = []; for (let i = 0; i < count; i++) sched.push(.5 + (i / count) * 2 + rnd(0, .25));
  sched.push(2.9);
  let age = 0, done = 0;
  const geo = new THREE.IcosahedronGeometry(1, 0);
  addFx(dt => {
    age += dt; const fin = age > 3.4 + .8 ? Math.max(0, 1 - (age - 4.2) / .6) : 1;
    sig.material.opacity = Math.min(1, age * 2) * .9 * fin; sig.rotation.z += dt * .6;
    gi.set(P.target.x, P.target.z, 0, P.r, 0, 0, 1, .45 * Math.min(1, age * 2) * fin, E.hex, gy); gi.tick(age);
    while (sched.length && age >= sched[0]) {
      const idx = sched.shift(), big = sched.length === 0;
      const ang = rnd(0, 6.283), rr = big ? 0 : Math.sqrt(Math.random()) * P.r * .92;
      const end = new V3(P.target.x + Math.cos(ang) * rr, gy + .3, P.target.z + Math.sin(ang) * rr);
      const sa = rnd(0, 6.283), sr = Math.sqrt(Math.random()) * P.r * 1.0;
      const st = new V3(P.target.x + S.x + Math.cos(sa) * sr, skyY, P.target.z + S.z + Math.sin(sa) * sr);
      if (big) { st.set(P.target.x + S.x * .8, skyY + 6, P.target.z + S.z * .8); }
      const s = big ? 1.9 : rnd(.45, .8);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2a1810, emissive: E.hex, emissiveIntensity: 1.3, flatShading: true, roughness: 1 }));
      mesh.scale.setScalar(s); mesh.castShadow = true; scene.add(mesh);
      const gs = glowSprite(E.hex, 5, .9); mesh.add(gs);
      rock.push({ mesh, st, end, s, big, t: 0, fall: big ? .9 : rnd(.55, .75), prev: st.clone(), spin: new V3(rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)) });
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
  for (const d of DUMMIES) d.update(dt);
  for (const s of SCORCH) { s.age += dt; if (s.age > 20) s.m.material.opacity = Math.max(0, .75 * (1 - (s.age - 20) / 6)); }
  for (const b of BRAZIERS) {
    if (Math.random() < dt * 25) fire.emit(b.x + rnd(-.25, .25), b.y, b.z + rnd(-.25, .25), rnd(-.2, .2), rnd(1.2, 2.4), rnd(-.2, .2), rnd(.5, .9), rnd(.4, .7), EL.fire.c0, EL.fire.c1, .8, .3, -.3, .5);
  }
}
function resetWorld() {
  G.dodged = G.hits = 0;
  DUMMIES.forEach(d => { d.hp = d.max; d.burn = 0; if (d.dead) d.reset(); else d.clearStatus(); });
  SCORCH.forEach(s => { scene.remove(s.m); s.m.material.dispose(); }); SCORCH.length = 0;
}

/* ================= 鏡頭 ================= */
function updateCamera(dt) {
  const p = mage.root.position;
  let fx = p.x, fy = p.y + 1.5, fz = p.z, dist = CFG.camDist * G.zoom;
  G.frameT = Math.max(0, G.frameT - dt);
  const aim = CFG.autoFrame && G.skill >= 0 && (G.state === 'charging' || G.state === 'cast' || G.frameT > 0);
  if (aim) {
    const t = G.state === 'cast' && G.pending ? G.pending.target : G.target, d = Math.hypot(t.x - p.x, t.z - p.z);
    fx = lerp(fx, t.x, .38); fz = lerp(fz, t.z, .38); dist += d * .45;
  }
  G.focus.x = damp(G.focus.x, fx, 7, dt); G.focus.y = damp(G.focus.y, fy, 7, dt); G.focus.z = damp(G.focus.z, fz, 7, dt);
  G.camD = damp(G.camD, dist, 4, dt);
  const cp = Math.cos(G.camPitch), sp = Math.sin(G.camPitch);
  camera.position.set(G.focus.x + Math.sin(G.camYaw) * cp * G.camD, Math.max(.6, G.focus.y + sp * G.camD), G.focus.z + Math.cos(G.camYaw) * cp * G.camD);
  G.shake = Math.max(0, G.shake - dt * .6);
  if (G.shake > 0) camera.position.add(new V3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(G.shake));
  camera.lookAt(G.focus);
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
// 把 0~255 色碼的 #rrggbb 調暗(k 為倍率)
function dimHex(c, k) { const n = parseInt(c.slice(1), 16); return '#' + [16, 8, 0].map(s => Math.round(((n >> s) & 255) * k).toString(16).padStart(2, '0')).join(''); }
let hotbarInit = false;   // SPELLS 在 spells.js(晚於 game.js 載入),快捷列第一次更新時才填入
function updateHUD() {
  if (!hotbarInit) { hotbarInit = true; refreshHotbar(); }
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
  cBox.classList.toggle('on', on); cBox.classList.toggle('max', max);
  cFill.style.width = '100%'; cFill.style.clipPath = 'inset(0 ' + ((1 - q) * 100) + '% 0 0)';
  const bg = max ? '#fff' : E.css0 + E.css1;
  if (cFill._bg !== bg) {
    cFill._bg = bg;
    cFill.style.background = max ? '#fff' : 'linear-gradient(90deg,' + dimHex(E.css1, .6) + ' 0%,' + dimHex(E.css1, .6) + ' 50%,' + E.css1 + ' 50%,' + E.css0 + ' 100%)';
    cFill.style.boxShadow = max ? '0 0 12px #ffd27a' : '';
  }
  // 集氣文字預覽:集氣 ・ 傷害倍率 ・ 第三項(效果)
  if (on) { const sp = spellOf(G.skill); cTxt.textContent = (max ? '集氣完成 MAX' : '集氣 ' + Math.round(q * 100) + '%') + ' ・ 傷害 ×' + CHG.dmg(q).toFixed(2) + (sp.preview ? ' ・ ' + sp.preview(q) : ''); }
  else cTxt.textContent = '';
  const ts = '0 0 8px ' + E.css1 + ',0 0 2px #000';
  if (chantEl._ts !== ts) { chantEl._ts = ts; chantEl.style.textShadow = ts; }
  let t = '職業:' + CLASSES[G.cls].name + ' ・ ' + (G.cls === 'mage' ? '屬性:' + E.name + ' ・ 裝備:' + W().name + '(' + W().tag + ')' + weaponDesc() : '裝備:' + CLASSES[G.cls].wpn);
  if (G.skill >= 0) { const sp = spellOf(G.skill), s = curSkill(G.skill); t += '<br>' + sp.name + ' ・ ' + (s.shape === 'wall' ? '長度 ' : '半徑 ') + skillRad().toFixed(1) + 'm ・ 射程 ' + skillRange().toFixed(1) + 'm'; }
  else t += '<br>未選擇法術(按 1/2/3)';
  t += '<br>' + (G.ground ? '跳躍 ● ●' : (G.airJumps > 0 ? '空中步 ●' : '空中步 ○'));
  t += '<br>閃避 ' + G.dodged + ' ・ 被擊中 ' + G.hits + (G.autoStrike ? ' ・ 自動來襲 ON' : '');
  t += classInfo();
  if (infoEl._t !== t) { infoEl.innerHTML = t; infoEl._t = t; }
  const air = !G.ground;
  btnJumpEl.classList.toggle('air', air && G.airJumps > 0); btnJumpEl.classList.toggle('spent', air && G.airJumps <= 0);
  btnRollEl.classList.toggle('air', air && G.airRolls > 0); btnRollEl.classList.toggle('spent', air && G.airRolls <= 0);
  const wt = G.state === 'charging' ? '取消' : '換裝'; if (btnWeapEl.textContent !== wt) btnWeapEl.textContent = wt;
  updateCdHUD();
  // 咒語字幕位置:角色頭上
  tmpV.copy(mage.root.position); tmpV.y += 3.1; tmpV.project(camera);
  chantEl.style.left = (tmpV.x * .5 + .5) * innerWidth + 'px'; chantEl.style.top = (-tmpV.y * .5 + .5) * innerHeight + 'px';
}

/* ================= 參數面板 ================= */
const PANEL = [
  ['鏡頭與操作'],
  ['camDist', '鏡頭距離', 4, 18, .5], ['camSens', '視角靈敏度', .002, .012, .0005], ['autoFrame', '施法自動拉鏡頭', 'bool'], ['shake', '震動強度', 0, 2, .1],
  ['moveSpeed', '移動速度', 2, 10, .5], ['jumpV', '跳躍力道', 5, 14, .5], ['airJumpV', '二段跳力道', 5, 12, .5], ['airRollDist', '空中翻滾距離', 1, 6, .5], ['rollDist', '翻滾距離', 2, 10, .5], ['rollTime', '翻滾時間(秒)', .25, .8, .05], ['rollCD', '翻滾冷卻(秒)', 0, 2, .1], ['minHold', '最短集氣(秒)', 0, 1, .05], ['bloom', '泛光特效', 'bool'], ['bloomStrength', '泛光強度', 0, 2, .05],
  ['fxq', '特效粒子量(新屬性)', .3, 1, .05], ['dummyMove', '標靶左右移動', 'bool'],
  ['投射類(火球等)'], ['skills.fireball.chargeTime', '集氣時間(秒)', .3, 4, .1], ['skills.fireball.range', '最大射程', 8, 45, 1], ['skills.fireball.rMin', '最小半徑', .5, 5, .1], ['skills.fireball.rMax', '最大半徑', 1, 10, .1], ['skills.fireball.recover', '施法後僵直(秒)', 0, 2, .05],
  ['牆類(火牆等)'], ['skills.firewall.chargeTime', '集氣時間(秒)', .3, 4, .1], ['skills.firewall.range', '最大射程', 8, 45, 1], ['skills.firewall.rMin', '最短長度', 2, 10, .5], ['skills.firewall.rMax', '最長長度', 6, 30, .5], ['skills.firewall.thick', '牆厚度', .5, 4, .1], ['skills.firewall.duration', '持續時間(秒)', 2, 20, .5], ['skills.firewall.recover', '施法後僵直(秒)', 0, 2, .05],
  ['大招類(隕石等)'], ['skills.meteor.chargeTime', '集氣時間(秒)', .3, 5, .1], ['skills.meteor.range', '最大射程', 8, 50, 1], ['skills.meteor.rMin', '最小半徑', 2, 10, .5], ['skills.meteor.rMax', '最大半徑', 4, 20, .5], ['skills.meteor.recover', '施法後僵直(秒)', 0, 3, .05]
];
function getPath(o, p) { return p.split('.').reduce((a, k) => a[k], o); }
function setPath(o, p, v) { const ks = p.split('.'), l = ks.pop(); ks.reduce((a, k) => a[k], o)[l] = v; }
function buildPanel() {
  const root = document.getElementById('panel'); root.innerHTML = '';
  PANEL.forEach(r => {
    if (r.length === 1) { const h = document.createElement('h4'); h.textContent = r[0]; root.appendChild(h); return; }
    const row = document.createElement('div'); row.className = 'row'; const lab = document.createElement('label'); lab.textContent = r[1]; row.appendChild(lab);
    const inp = document.createElement('input'), val = document.createElement('span');
    if (r[2] === 'bool') { inp.type = 'checkbox'; inp.checked = !!getPath(CFG, r[0]); inp.onchange = () => { setPath(CFG, r[0], inp.checked); saveCfg(); }; row.appendChild(inp); }
    else {
      inp.type = 'range'; inp.min = r[2]; inp.max = r[3]; inp.step = r[4]; inp.value = getPath(CFG, r[0]); val.textContent = inp.value;
      inp.oninput = () => { const v = parseFloat(inp.value); setPath(CFG, r[0], v); val.textContent = v; if (r[0] === 'bloomStrength' && bloom) bloom.strength = v; saveCfgSoon(); };
      row.appendChild(inp); row.appendChild(val);
    }
    root.appendChild(row);
  });
  const b = document.createElement('button'); b.textContent = '還原預設值';
  b.onclick = () => { mergeCfg(CFG, JSON.parse(JSON.stringify(DEFAULT_CFG))); saveCfg(); buildPanel(); }; root.appendChild(b);
  const rb = document.createElement('button'); rb.textContent = '重置標靶'; rb.onclick = () => resetWorld(); root.appendChild(rb);
}
buildPanel();
document.getElementById('gear').onclick = () => document.getElementById('panel').classList.toggle('on');

/* ================= 主迴圈 ================= */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, .05) * (window.TS || 1); last = now; G.time += dt;
  if (window.inputTick) inputTick(dt);
  classTick(dt); updatePlayer(dt); updateAim(dt); updateCasting(dt);
  mage.update(dt, { move: G.speedN || 0, cast: G.cb, kick: G.kick, charge: G.charge, t: G.time, hover: 0, roll: G.roll ? Math.min(1, G.roll.t / G.roll.time) : -1, rollPhi: G.roll ? G.roll.phi : 0, flip: G.flip });
  updateOrb(dt); updateCamera(dt); updateWorld(dt); updateFx(dt); updateLights(dt);
  fire.update(dt); smoke.update(dt); updateDmgTexts(dt); updateHUD();
  sky.position.copy(camera.position);
  moonLight.shadow.needsUpdate = true;
  if (bloom) bloom.strength = CFG.bloomStrength * (window.BLOOMK == null ? 1 : window.BLOOMK);
  if (CFG.bloom && composer) composer.render(dt); else renderer.render(scene, camera);
}
window.startLoop = () => requestAnimationFrame(frame);   // classes.js 載入後才開始(避免載入途中呼叫)
window.G = G; window.CFG = CFG;
