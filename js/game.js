'use strict';
/* ================= 設定(可在遊戲內 P 面板調整,存 localStorage) ================= */
const DEFAULT_CFG = {
  jumpV: 9.5, rollDist: 5, rollTime: 0.45, rollCD: 0.6,
  moveSpeed: 5, runMul: 1.7, camDist: 9, camSens: 0.005, autoFrame: true, shake: 1, bloom: true, bloomStrength: 0.85, minHold: 0.3,
  rad: [2.2, 9, 7],
  skills: {
    fireball: { chargeTime: 1.4, range: 24, rMin: 1.2, rMax: 4.5, recover: 0.45 },
    firewall: { chargeTime: 1.5, range: 22, rMin: 4, rMax: 16, recover: 0.5, thick: 1.6, duration: 8 },
    meteor: { chargeTime: 2.4, range: 28, rMin: 4, rMax: 12, recover: 0.7 }
  }
};
const CFG = JSON.parse(JSON.stringify(DEFAULT_CFG));
const CFG_KEY = 'mageSandbox.cfg.v1';
function mergeCfg(dst, src) { for (const k in src) { if (dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) mergeCfg(dst[k], src[k]); else if (k in dst) dst[k] = src[k]; } }
if (IS_TOUCH) CFG.bloom = false;  // 手機預設關泛光(省效能),可在 P 面板打開
try { const s = JSON.parse(localStorage.getItem(CFG_KEY)); if (s) mergeCfg(CFG, s); } catch (e) { }
function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch (e) { } }

const SKILLS = [
  { id: 'fireball', name: '火球術', icon: '🔥', el: 'fire', shape: 'circle', chant: '火之精靈,聚於我手,化為灼熱之球——燃盡一切!', shout: '火球術!' },
  { id: 'firewall', name: '火牆術', icon: '🧱', el: 'fire', shape: 'wall', chant: '烈焰之壁,拔地而起,焚盡來犯之敵——', shout: '火牆術!' },
  { id: 'meteor', name: '隕石術', icon: '☄️', el: 'fire', shape: 'circle', chant: '天外星辰,聽我召喚,墜落吧——毀滅之石!', shout: '隕石術!' }
];
const sc = i => CFG.skills[SKILLS[i].id];

const G = {
  skill: 0, state: 'ready', chargeT: 0, charge: 0, castT: 0, pending: null, launched: false, queued: false,
  target: new V3(0, 0, 8), wallOff: 0, weapon: 'staff', camYaw: Math.PI, camPitch: 0.42, zoom: 1, camD: CFG.camDist,
  focus: new V3(0, 1.5, 0), shake: 0, mouse: { x: innerWidth / 2, y: innerHeight * 0.4 }, keys: {}, orb: null, rmb: false,
  stick: { x: 0, y: 0, mag: 0 }, stickHold: new V3(0, 0, 8), inputMode: IS_TOUCH ? 'stick' : 'mouse', lastTouch: 0,
  roll: null, rollCD: 0, invuln: false, stun: 0, dodged: 0, hits: 0, autoStrike: false, strikeT: 2,
  time: 0, cb: 0, kick: 0, vy: 0, frameT: 0, hover: 0, auraAmt: 0, maxFlash: false, shoutT: 0
};

/* ================= 角色與場景物件 ================= */
const mage = new Mage(scene);
mage.setElementColor(EL.fire.hex);
const ind = new Indicator(scene);
const tmpV = new V3(), tmpV2 = new V3();

// 施法時角色身上的光環與腳下魔法陣
const rings = [];
for (let i = 0; i < 3; i++) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(.8, .015, 6, 64), new THREE.MeshBasicMaterial({ color: EL.fire.hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  mage.root.add(m); rings.push(m);
}
const runeGrp = new THREE.Group(); mage.root.add(runeGrp);
const runeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: RUNE_TEX, color: EL.fire.hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
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
  if (e.repeat) return;
  G.keys[e.code] = true;
  const dg = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[e.code];
  if (dg != null) selectSkill(dg);
  else if (e.code === 'Tab') { if (G.state === 'ready') { G.weapon = G.weapon === 'staff' ? 'book' : 'staff'; mage.setWeapon(G.weapon); } }
  else if (e.code === 'Escape' || e.code === 'KeyX') { if (G.state === 'charging') cancelCharge(); else if (G.state === 'ready') G.skill = -1; }
  else if (e.code === 'KeyP') document.getElementById('panel').classList.toggle('on');
  else if (e.code === 'KeyH') { const h = document.getElementById('hint'); h.style.display = h.style.display === 'none' ? '' : 'none'; }
  else if (e.code === 'KeyR') resetWorld();
  else if (e.code === 'Space') doJump();
  else if (e.code === 'ControlLeft' || e.code === 'KeyF') tryRoll();
  else if (e.code === 'KeyT') strike();
  else if (e.code === 'KeyY') { G.autoStrike = !G.autoStrike; G.strikeT = 1; }
});
addEventListener('keyup', e => { G.keys[e.code] = false; });
addEventListener('blur', () => { G.keys = {}; if (G.state === 'charging') cancelCharge(); });
addEventListener('contextmenu', e => e.preventDefault());
const fromTouch = () => performance.now() - G.lastTouch < 800;  // 觸控後瀏覽器會補發假滑鼠事件,忽略
function doJump() { if (G.state === 'ready' && !G.roll && G.stun <= 0 && mage.root.position.y <= 0.001) G.vy = CFG.jumpV; }
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
  if (e.button === 0) startCharge();
});
addEventListener('mouseup', e => {
  if (fromTouch()) return;
  if (e.button === 2) G.rmb = false;
  if (e.button === 0 && G.state === 'charging') { if (G.chargeT < CFG.minHold) G.queued = true; else release(); }
});
addEventListener('wheel', e => {
  if (e.target.tagName !== 'CANVAS') return;
  e.preventDefault();
  if (G.skill >= 0 && !e.ctrlKey && (G.state === 'ready' || G.state === 'charging')) {
    const c = sc(G.skill), step = (c.rMax - c.rMin) / 14;
    CFG.rad[G.skill] = clamp(CFG.rad[G.skill] - Math.sign(e.deltaY) * step, c.rMin, c.rMax); saveCfgSoon();
  } else G.zoom = clamp(G.zoom * (1 + Math.sign(e.deltaY) * .1), .5, 1.9);
}, { passive: false });
let saveTimer = 0; function saveCfgSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveCfg, 400); }

function selectSkill(i) {
  if (G.state !== 'ready') return;
  G.skill = (G.skill === i) ? -1 : i;
}
function skillRad() { const c = sc(G.skill); return clamp(CFG.rad[G.skill], c.rMin, c.rMax); }

/* ================= 側翻滾(短暫無敵)與來襲測試 ================= */
function tryRoll() {
  const p = mage.root.position;
  if (G.rollCD > 0 || G.roll || p.y > .05 || G.stun > 0) return;
  if (G.state === 'cast' && !G.launched) return;
  if (G.state === 'charging') cancelCharge();
  G.state = 'ready';
  const mi = moveInput(); let ix = mi.ix, iz = mi.iz, dx, dz;
  if (ix || iz) {
    const l = Math.hypot(ix, iz); ix /= l; iz /= l;
    dx = -Math.sin(G.camYaw) * iz + Math.cos(G.camYaw) * ix; dz = -Math.cos(G.camYaw) * iz - Math.sin(G.camYaw) * ix;
  } else { dx = -Math.cos(mage.yaw); dz = Math.sin(mage.yaw); }  // 沒按方向:往角色右側翻
  G.roll = { t: 0, dx, dz, phi: angDiff(mage.yaw, Math.atan2(dx, dz)) };
  for (let i = 0; i < 6; i++) smoke.emit(p.x + rnd(-.3, .3), .15, p.z + rnd(-.3, .3), rnd(-1, 1), rnd(.3, 1), rnd(-1, 1), rnd(.5, .9), rnd(.8, 1.4), [.5, .45, .4], [.3, .3, .3], .4, 2, 0, 1.5);
}
function banner(txt, color) {
  const b = document.getElementById('banner'); b.textContent = txt; b.style.color = color; b.style.opacity = 1; b._t = 1.2;
}
function strike() {
  const p = mage.root.position, pos = new V3(p.x, 0, p.z), R = 2.4, W = 1.2, wi = new Indicator(scene); let t = 0;
  addFx(dt => {
    t += dt;
    if (t < W) { wi.set(pos.x, pos.z, 0, R, 0, 0, t / W, .9, 0xff2030); wi.tick(G.time); return true; }
    wi.root.parent.remove(wi.root);
    explode(pos, R, .8, { dmg: 0 }); G.shake = Math.max(G.shake, .25 * CFG.shake);
    const q = mage.root.position, inside = Math.hypot(q.x - pos.x, q.z - pos.z) < R;
    if (inside && q.y >= 1.2) { G.dodged++; banner('跳躍閃避!', '#8fe8ff'); }
    else if (inside && G.invuln) { G.dodged++; banner('翻滾閃避!', '#8fe8ff'); }
    else if (!inside) { G.dodged++; banner('走位躲開', '#bff0a0'); }
    else {
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
  const p = mage.root.position, c = sc(G.skill);
  ndc.set(G.mouse.x / innerWidth * 2 - 1, -(G.mouse.y / innerHeight * 2 - 1)); ray.setFromCamera(ndc, camera);
  const hit = ray.ray.intersectPlane(gPlane, tmpV);
  if (!hit) { camera.getWorldDirection(tmpV2); tmpV.set(p.x + tmpV2.x * c.range, 0, p.z + tmpV2.z * c.range); }
  let dx = tmpV.x - p.x, dz = tmpV.z - p.z, d = Math.hypot(dx, dz);
  const minD = SKILLS[G.skill].shape === 'wall' ? 2 : 1.2;
  if (d < 1e-4) { dx = Math.sin(mage.yaw); dz = Math.cos(mage.yaw); d = 1; }
  const dd = clamp(d, minD, c.range);
  out.set(p.x + dx / d * dd, 0, p.z + dz / d * dd);
}

// 搖桿/觸控瞄準:集氣時左搖桿的方向=光圈方向、推多少=離多遠;放開搖桿則光圈停在原地
function pickStick(out) {
  const p = mage.root.position, c = sc(G.skill);
  if (G.state === 'charging' && G.stick.mag > .15) {
    const ix = G.stick.x / G.stick.mag, iz = -G.stick.y / G.stick.mag;
    const fx = -Math.sin(G.camYaw), fz = -Math.cos(G.camYaw), rx = Math.cos(G.camYaw), rz = -Math.sin(G.camYaw);
    const dx = fx * iz + rx * ix, dz = fz * iz + rz * ix, minD = SKILLS[G.skill].shape === 'wall' ? 2 : 1.2;
    const d = lerp(minD, c.range, Math.min(1, G.stick.mag));
    G.stickHold.set(p.x + dx * d, 0, p.z + dz * d);
  } else if (G.state === 'ready') {
    G.stickHold.set(p.x + Math.sin(mage.yaw) * c.range * .5, 0, p.z + Math.cos(mage.yaw) * c.range * .5);
  }
  out.copy(G.stickHold);
}

/* ================= 施法狀態機 ================= */
function startCharge() {
  if (G.state !== 'ready' || G.skill < 0 || G.roll || G.stun > 0) return;
  G.state = 'charging'; G.chargeT = 0; G.charge = 0; G.queued = false; G.maxFlash = false;
  { const p = mage.root.position, c = sc(G.skill); G.stickHold.set(p.x + Math.sin(mage.yaw) * c.range * .5, 0, p.z + Math.cos(mage.yaw) * c.range * .5); }
  G.orb = makeOrb(EL[SKILLS[G.skill].el]); scene.add(G.orb);
}
function cancelCharge() {
  if (G.state !== 'charging') return;
  dissolveOrb(G.orb); G.orb = null; G.state = 'ready'; G.chargeT = 0; G.queued = false;
  document.getElementById('chant').style.opacity = 0;
}
function dissolveOrb(orb) {
  if (!orb) return;
  for (let i = 0; i < 25; i++) fire.emit(orb.position.x, orb.position.y, orb.position.z, rnd(-2, 2), rnd(-1, 3), rnd(-2, 2), rnd(.3, .6), rnd(.1, .25), EL.fire.c0, EL.fire.c1, 1, .3, 2, 1);
  scene.remove(orb);
}
function release() {
  const sk = SKILLS[G.skill], p = mage.root.position;
  const dir = Math.atan2(G.target.x - p.x, G.target.z - p.z);
  G.pending = {
    skill: sk, idx: G.skill, target: G.target.clone(), r: skillRad(), power: 0.35 + 0.65 * G.charge, charge: G.charge,
    wallYaw: dir + G.wallOff
  };
  G.state = 'cast'; G.castT = 0; G.launched = false; G.queued = false;
  G.shoutT = 1.0; const ch = document.getElementById('chant'); ch.textContent = sk.shout; ch.style.fontSize = '30px';
}
function updateCasting(dt) {
  if (G.state === 'charging') {
    G.chargeT += dt; G.charge = clamp(G.chargeT / sc(G.skill).chargeTime, 0, 1);
    if (G.charge >= 1 && !G.maxFlash) { G.maxFlash = true; G.shake = Math.max(G.shake, .05); burstRing(mage.root.position, 0xffd27a, 2.4); }
    if (G.queued && G.chargeT >= CFG.minHold) release();
  } else if (G.state === 'cast') {
    G.castT += dt;
    if (!G.launched && G.castT >= 0.14) {
      G.launched = true; G.kick = 1; launchSpell(G.pending, G.orb); G.orb = null;
      G.frameT = G.pending.skill.id === 'meteor' ? 3.8 : (G.pending.skill.id === 'firewall' ? 1.6 : 1.1);
    }
    if (G.castT >= sc(G.pending.idx).recover) { G.state = 'ready'; }
  } else G.charge = damp(G.charge, 0, 10, dt);
  G.kick = Math.max(0, G.kick - dt * 3.5);
  const tcb = (G.state === 'charging' || (G.state === 'cast' && G.castT < .32)) ? 1 : 0;
  G.cb = damp(G.cb, tcb, tcb ? 10 : 6, dt);
  G.auraAmt = damp(G.auraAmt, G.state === 'charging' ? .15 + .85 * G.charge : 0, 8, dt);
  // 咒語字幕
  const ch = document.getElementById('chant');
  if (G.state === 'charging') {
    const t = SKILLS[G.skill].chant, n = Math.ceil(t.length * Math.min(1, G.charge * 1.15));
    ch.textContent = t.slice(0, n); ch.style.fontSize = '17px'; ch.style.opacity = 1;
  } else if (G.shoutT > 0) { G.shoutT -= dt; ch.style.opacity = Math.min(1, G.shoutT * 2); } else ch.style.opacity = 0;
}

/* ================= 玩家移動 ================= */
function updatePlayer(dt) {
  const p = mage.root.position, K = G.keys, lock = G.state === 'charging' || G.state === 'cast';
  const mi = moveInput(); let ix = mi.ix, iz = mi.iz, speedN = 0, ty = mage.yaw;
  G.rollCD = Math.max(0, G.rollCD - dt); G.stun = Math.max(0, G.stun - dt);
  const free = !lock && !G.roll && G.stun <= 0;
  if (G.roll) {
    const R = G.roll; R.t += dt; const q = Math.min(1, R.t / CFG.rollTime), v = 2 * CFG.rollDist / CFG.rollTime * (1 - q);
    p.x += R.dx * v * dt; p.z += R.dz * v * dt; G.invuln = q > .05 && q < .8;
    for (let i = 0; i < 3; i++) fire.emit(p.x + rnd(-.2, .2), p.y + rnd(.3, 1.4), p.z + rnd(-.2, .2), -R.dx * 1.5, rnd(0, .8), -R.dz * 1.5, .35, rnd(.5, .9), [.6, .9, 1], [.2, .4, 1], .45, .3, 0, 2);
    if (q >= 1) { G.roll = null; G.rollCD = CFG.rollCD; G.invuln = false; }
  }
  if (free && (ix || iz)) {
    const l = Math.hypot(ix, iz); ix /= l; iz /= l;
    const fx = -Math.sin(G.camYaw), fz = -Math.cos(G.camYaw), rx = Math.cos(G.camYaw), rz = -Math.sin(G.camYaw);
    const dx = fx * iz + rx * ix, dz = fz * iz + rz * ix;
    const sp = CFG.moveSpeed * (mi.run ? CFG.runMul : 1) * mi.s;
    p.x += dx * sp * dt; p.z += dz * sp * dt; ty = Math.atan2(dx, dz); speedN = sp / CFG.moveSpeed;
  }
  if (!G.roll && (lock && G.skill >= 0 || (G.state === 'cast' && G.pending))) {
    const t = G.state === 'cast' ? G.pending.target : G.target; ty = Math.atan2(t.x - p.x, t.z - p.z);
  }
  mage.yaw += angDiff(mage.yaw, ty) * Math.min(1, dt * (lock ? 16 : 11));
  G.vy -= 20 * dt; p.y += G.vy * dt; if (p.y < 0) { p.y = 0; G.vy = 0; }
  for (const c of COLLIDERS) {
    if (c.ref && c.ref.dead) continue;
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + .4;
    if (d < m && d > 1e-4) { p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; }
  }
  const r = Math.hypot(p.x, p.z); if (r > ARENA_R) { p.x *= ARENA_R / r; p.z *= ARENA_R / r; }
  G.speedN = damp(G.speedN || 0, speedN, 12, dt);
  moonLight.position.set(p.x - 20, 40, p.z + 15); moonLight.target.position.copy(p);
}

/* ================= 瞄準光圈更新 ================= */
function updateAim(dt) {
  ind.tick(G.time);
  if (G.skill < 0 || (G.state !== 'ready' && G.state !== 'charging')) {
    if (G.state === 'cast' && G.pending) { /* 施放中:光圈保持並淡出 */
      const P = G.pending, a = Math.max(0, 1 - G.castT / Math.max(.2, sc(P.idx).recover)) * .9;
      if (P.skill.shape === 'wall') ind.set(P.target.x, P.target.z, 1, P.r / 2, sc(P.idx).thick / 2, P.wallYaw, 1, a, EL.fire.hex);
      else ind.set(P.target.x, P.target.z, 0, P.r, 0, 0, 1, a, EL.fire.hex);
    } else ind.hide();
    return;
  }
  if (G.inputMode === 'stick') pickStick(tmpV2); else pickGround(tmpV2);
  G.target.x = damp(G.target.x, tmpV2.x, 30, dt); G.target.z = damp(G.target.z, tmpV2.z, 30, dt);
  if (G.state === 'ready' && ind.root.visible === false) G.target.copy(tmpV2);
  const sk = SKILLS[G.skill], c = sc(G.skill), p = mage.root.position;
  if (G.keys.KeyQ) G.wallOff += dt * 1.8; if (G.keys.KeyE) G.wallOff -= dt * 1.8;
  const charging = G.state === 'charging';
  const pulse = charging && G.charge >= 1 ? .75 + .25 * Math.sin(G.time * 14) : 1;
  const alpha = (charging ? .95 : .55) * pulse;
  if (sk.shape === 'wall') {
    const yaw = Math.atan2(G.target.x - p.x, G.target.z - p.z) + G.wallOff;
    ind.set(G.target.x, G.target.z, 1, skillRad() / 2, c.thick / 2, yaw, charging ? G.charge : 0, alpha, EL.fire.hex);
  } else ind.set(G.target.x, G.target.z, 0, skillRad(), 0, 0, charging ? G.charge : 0, alpha, EL.fire.hex);
}

/* ================= 能量球、光環、聚氣粒子 ================= */
function updateOrb(dt) {
  const a = G.auraAmt, p = mage.root.position;
  mage.glow = a;
  rings.forEach((m, i) => {
    m.visible = a > .02; m.material.opacity = a * .8;
    m.scale.setScalar(.7 + a * .5 + i * .12);
    m.position.y = .5 + i * .6 + Math.sin(G.time * 2 + i) * .08;
    m.rotation.set(Math.PI / 2 + Math.sin(G.time * 1.3 + i * 2) * .35, Math.cos(G.time * 1.1 + i) * .3, G.time * (2 + i));
  });
  runeMesh.material.opacity = a * .9; runeMesh.scale.setScalar(2.4 + a * 1.8); runeGrp.rotation.y = G.time * .9; runeGrp.visible = a > .02;
  const L = LIGHTS[3]; L.color.setHex(EL.fire.hex); L.position.set(p.x, p.y + 1.4, p.z); L.intensity = a * 2.6; L.distance = 12;
  if (G.state === 'charging') {
    const n = 1 + Math.floor(G.charge * 4);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * 6.283;
      fire.emit(p.x + Math.cos(ang) * .75, p.y + .1, p.z + Math.sin(ang) * .75, Math.cos(ang + 1.6) * .6, rnd(1.2, 2.8), Math.sin(ang + 1.6) * .6, rnd(.6, 1), rnd(.1, .22), EL.fire.c0, EL.fire.c1, .9, .3, 0, .3);
    }
  }
  const orb = G.orb;
  if (orb && G.state !== 'cast' || orb && !G.launched) {
    mage.tipWorld(orb.position);
    const r = .08 + .5 * easeOut(G.charge) + Math.sin(G.time * 18) * .015 * G.charge;
    orb.setR(damp(orb.r, r, 20, dt));
    const n = 1 + Math.floor(G.charge * 3);
    for (let i = 0; i < n; i++) {
      const d = new V3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize(), R = rnd(.9, 1.6);
      fire.emit(orb.position.x + d.x * R, orb.position.y + d.y * R, orb.position.z + d.z * R, -d.x * R / .35, -d.y * R / .35, -d.z * R / .35, .35, rnd(.1, .2), EL.fire.c0, EL.fire.c1, 1, .5);
    }
  }
}
function burstRing(pos, hex, R) {
  const m = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.set(pos.x, .1, pos.z); scene.add(m);
  let t = 0; addFx(dt => { t += dt / .5; if (t >= 1) { scene.remove(m); m.material.dispose(); return false; } m.scale.setScalar(Math.max(.01, R * easeOut(t))); m.material.opacity = .9 * (1 - t) * (1 - t); });
}

/* ================= 特效管理 ================= */
const RING_GEO = new THREE.RingGeometry(.85, 1, 48), ICO_GEO = new THREE.IcosahedronGeometry(1, 2);
const FX = []; function addFx(fn) { FX.push(fn); }
function updateFx(dt) { for (let i = FX.length - 1; i >= 0; i--) if (FX[i](dt) === false) FX.splice(i, 1); }
let lightRR = 0;
function flashLight(pos, hex, inten, dur, dist) { const L = LIGHTS[(lightRR++) % 3]; L.userData = { t: 0, dur, peak: inten }; L.color.setHex(hex); L.position.copy(pos); L.distance = dist; L.intensity = inten; }
function updateLights(dt) { for (let i = 0; i < 3; i++) { const L = LIGHTS[i], u = L.userData; if (u.dur) { u.t += dt; const k = 1 - u.t / u.dur; L.intensity = k > 0 ? u.peak * k * k : 0; } } }

function addDmgText(pos, n) {
  const d = document.createElement('div'); d.className = 'dmg'; d.textContent = n; document.getElementById('dmgLayer').appendChild(d);
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

function damageArea(pos, R, dmg, burn) {
  for (const d of DUMMIES) {
    if (d.dead) continue;
    const dx = d.home.x - pos.x, dz = d.home.z - pos.z, dist = Math.hypot(dx, dz);
    if (dist < R + .4) d.hit(dmg * (1 - clamp(dist / (R + .4), 0, 1) * .5) * rnd(.9, 1.1), dx, dz, burn);
  }
}

function explode(pos, R, power, o) {
  o = o || {};
  const k = Math.sqrt(R / 2), c0 = EL.fire.c0, c1 = EL.fire.c1;
  const n = Math.min(260, Math.floor((50 + 30 * power) * R / 2.5));
  for (let i = 0; i < n; i++) {
    const d = new V3(rnd(-1, 1), rnd(-.2, 1), rnd(-1, 1)).normalize(), sp = rnd(.3, 1) * R * 3.2;
    fire.emit(pos.x + d.x * R * .2, pos.y + d.y * R * .2, pos.z + d.z * R * .2, d.x * sp, d.y * sp, d.z * sp, rnd(.35, .8), rnd(.8, 1.6) * k * .8, c0, c1, 1, 2.2, 0, 2.5);
  }
  const m = Math.floor(25 * power * k);
  for (let i = 0; i < m; i++) {
    const d = new V3(rnd(-1, 1), rnd(.1, 1), rnd(-1, 1)).normalize(), sp = rnd(R * 1.5, R * 5);
    fire.emit(pos.x, pos.y, pos.z, d.x * sp, d.y * sp, d.z * sp, rnd(.6, 1.4), rnd(.12, .25), [1, .95, .7], c1, 1, .2, 9, .6);
  }
  for (let i = 0; i < Math.floor(10 * k); i++) smoke.emit(pos.x + rnd(-R, R) * .4, pos.y + .3, pos.z + rnd(-R, R) * .4, rnd(-1, 1), rnd(.8, 2.2), rnd(-1, 1), rnd(1.6, 2.8), rnd(2, 4) * k * .8, [.28, .22, .2], [.08, .08, .09], .55, 2.5, -.3, .8);
  const ring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: 0xffb050, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, .08, pos.z); scene.add(ring);
  const flash = new THREE.Mesh(ICO_GEO, new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.position.copy(pos); scene.add(flash);
  const spr = glowSprite(0xffd090, R * 5, 1); spr.position.copy(pos); scene.add(spr);
  const T = .45 + .1 * k; let t = 0;
  addFx(dt => {
    t += dt; const u = t / T;
    if (u >= 1) { scene.remove(ring, flash, spr); ring.material.dispose(); flash.material.dispose(); spr.material.dispose(); return false; }
    ring.scale.setScalar(Math.max(.01, R * 1.35 * easeOut(u))); ring.material.opacity = .9 * (1 - u) * (1 - u);
    flash.scale.setScalar(Math.max(.01, R * .95 * easeOut(Math.min(1, u * 2.2)))); flash.material.opacity = .85 * Math.pow(1 - u, 2);
    spr.scale.setScalar(R * 5 * (1 - u * .5)); spr.material.opacity = Math.pow(1 - u, 2.5);
  });
  flashLight(new V3(pos.x, pos.y + 1.5, pos.z), 0xff8a30, 6 * Math.min(2, k), .5, 14 + R * 3);
  // 焦痕
  const sc2 = new THREE.Mesh(SCORCH_GEO, new THREE.MeshBasicMaterial({ map: SCORCH_TEX, transparent: true, depthWrite: false, opacity: .75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  sc2.rotation.x = -Math.PI / 2; sc2.rotation.z = rnd(0, 6); sc2.position.set(pos.x, .03 + (SCORCH.length % 7) * .002, pos.z); sc2.scale.setScalar(R * 2.4 * rnd(.9, 1.1)); scene.add(sc2);
  SCORCH.push({ m: sc2, age: 0 }); if (SCORCH.length > 30) { const o2 = SCORCH.shift(); scene.remove(o2.m); o2.m.material.dispose(); }
  const dc = Math.hypot(pos.x - camera.position.x, pos.z - camera.position.z);
  G.shake = Math.max(G.shake, .14 * k * power * CFG.shake / (1 + dc * .03));
  if (o.dmg !== 0) damageArea(pos, R, (o.dmg || 70) * (.5 + power * .8), 2.5);
}

/* ================= 三種法術 ================= */
function launchSpell(P, orb) {
  if (!orb) { orb = makeOrb(EL.fire); scene.add(orb); mage.tipWorld(orb.position); orb.setR(.3); }
  ({ fireball: castFireball, firewall: castFirewall, meteor: castMeteor })[P.skill.id](P, orb);
}

function trail(a, b, n, size, life) {
  for (let i = 0; i < n; i++) {
    const t = Math.random();
    fire.emit(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t), rnd(-.6, .6), rnd(-.3, .8), rnd(-.6, .6), rnd(life * .6, life), size * rnd(.6, 1.2), EL.fire.c0, EL.fire.c1, .9, .3, -.5, .4);
  }
}

function castFireball(P, orb) {
  const start = orb.position.clone(), end = P.target.clone(); end.y = .4;
  const dist = start.distanceTo(end), dur = clamp(dist / 32, .25, .9); let t = 0; const prev = start.clone(), r0 = Math.max(orb.r, .3);
  orb.setR(r0 * (.8 + P.power * .6));
  addFx(dt => {
    t += dt / dur; const u = Math.min(t, 1);
    orb.position.lerpVectors(start, end, u); orb.position.y += Math.sin(Math.PI * u) * dist * .06;
    trail(prev, orb.position, 6, orb.r * 1.3, .45); smoke.emit(orb.position.x, orb.position.y, orb.position.z, rnd(-.3, .3), rnd(0, .5), rnd(-.3, .3), 1, orb.r * 1.5, [.25, .2, .18], [.08, .08, .09], .35, 2.2, -.2, .5);
    prev.copy(orb.position);
    if (u >= 1) { scene.remove(orb); explode(end, P.r, P.power, { dmg: 80 }); return false; }
  });
}

function castFirewall(P, orb) {
  const start = orb.position.clone(), end = P.target.clone(); end.y = .5; const dur = clamp(start.distanceTo(end) / 36, .2, .6); let t = 0; const prev = start.clone();
  addFx(dt => {
    t += dt / dur; const u = Math.min(t, 1);
    orb.position.lerpVectors(start, end, u); trail(prev, orb.position, 5, orb.r * 1.2, .4); prev.copy(orb.position);
    if (u >= 1) { scene.remove(orb); spawnWall(P); return false; }
  });
}
function spawnWall(P) {
  const cfg = sc(P.idx), half = P.r / 2, thick = cfg.thick, ax = Math.cos(P.wallYaw), az = -Math.sin(P.wallYaw);
  const n = Math.ceil(P.r / .7) + 1, segs = [], dur = cfg.duration * (.7 + P.power * .6);
  for (let i = 0; i < n; i++) { const o = (i / (n - 1) - .5) * P.r; segs.push({ o, x: P.target.x + ax * o, z: P.target.z + az * o, on: Math.abs(o) / half * .4, acc: 0 }); }
  const wi = new Indicator(scene); let age = 0, tick = 0;
  const gl = []; for (let i = 0; i < n; i += 2) { const s = glowSprite(0xff7a1a, 3, .5); s.position.set(segs[i].x, .6, segs[i].z); scene.add(s); gl.push(s); }
  flashLight(new V3(P.target.x, 2, P.target.z), 0xff8a30, 5, .5, 25); G.shake = Math.max(G.shake, .08 * CFG.shake);
  const L = LIGHTS[4]; L.color.setHex(0xff7a20); L.position.set(P.target.x, 1.8, P.target.z); L.distance = 10 + P.r * 1.3;
  addFx(dt => {
    age += dt; const fade = age > dur - 1 ? Math.max(0, dur - age) : 1;
    if (age >= dur) { wi.hide(); wi.root.parent.remove(wi.root); gl.forEach(s => { scene.remove(s); s.material.dispose(); }); L.intensity = 0; return false; }
    wi.set(P.target.x, P.target.z, 1, half, thick / 2, P.wallYaw, 0, .35 * fade * (.8 + .2 * Math.sin(age * 12)), EL.fire.hex); wi.tick(age);
    L.intensity = 3.5 * fade * (.85 + Math.random() * .3);
    const H = (.7 + P.power * .6) * 1.2;
    for (const s of segs) {
      if (age < s.on) continue;
      const ramp = Math.min(1, (age - s.on) / .25) * fade; s.acc += dt * 38 * ramp;
      while (s.acc >= 1) {
        s.acc -= 1; const lx = rnd(-thick / 2, thick / 2), px = s.x - az * lx * -1, pz = s.z + ax * lx * -1;
        fire.emit(s.x + (-az) * lx, rnd(0, .3), s.z + ax * lx, rnd(-.4, .4), rnd(2.5, 4.5) * H * ramp, rnd(-.4, .4), rnd(.6, 1.0), rnd(.9, 1.5), EL.fire.c0, EL.fire.c1, .95, .35, -.3, .6);
        if (Math.random() < .07) smoke.emit(s.x, 1.8, s.z, rnd(-.3, .3), rnd(1, 2), rnd(-.3, .3), rnd(1.4, 2.2), rnd(1.5, 2.5), [.25, .2, .18], [.08, .08, .09], .4, 2.2, -.3, .6);
      }
    }
    gl.forEach((s, i) => { s.material.opacity = (.35 + Math.random() * .2) * fade; s.scale.setScalar(2.6 + Math.sin(age * 9 + i) * .4); });
    tick += dt;
    if (tick >= .3) {
      tick = 0;
      for (const d of DUMMIES) {
        if (d.dead) continue;
        const dx = d.home.x - P.target.x, dz = d.home.z - P.target.z, along = dx * ax + dz * az, across = dx * -az + dz * ax;
        if (Math.abs(along) <= half + .4 && Math.abs(across) <= thick / 2 + .6) d.hit(9 * (.6 + P.power * .8), across, 0, 3);
      }
    }
  });
}

function castMeteor(P, orb) {
  const start = orb.position.clone(), top = new V3(P.target.x, 30, P.target.z); let t = 0;
  addFx(dt => {
    t += dt / .55; const u = Math.min(t, 1);
    orb.position.lerpVectors(start, top, u * u); fire.emit(orb.position.x, orb.position.y, orb.position.z, rnd(-.5, .5), rnd(-1, 0), rnd(-.5, .5), .5, orb.r, EL.fire.c0, EL.fire.c1, 1, .3, 0, .5);
    orb.setR(orb.r * (1 + dt * 2));
    if (u >= 1) { dissolveOrb(orb); startShower(P); return false; }
  });
}
function startShower(P) {
  const S = new V3(-9, 0, -6), skyY = 16, count = Math.round(6 + 9 * P.power), rock = [];
  const sig = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: RUNE_TEX, color: 0xff7a20, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  sig.rotation.x = -Math.PI / 2; sig.position.set(P.target.x + S.x, skyY, P.target.z + S.z); sig.scale.setScalar(P.r * 2.6); scene.add(sig);
  const gi = new Indicator(scene);
  const sched = []; for (let i = 0; i < count; i++) sched.push(.5 + (i / count) * 2 + rnd(0, .25));
  sched.push(2.9);
  let age = 0, done = 0;
  const geo = new THREE.IcosahedronGeometry(1, 0);
  addFx(dt => {
    age += dt; const fin = age > 3.4 + .8 ? Math.max(0, 1 - (age - 4.2) / .6) : 1;
    sig.material.opacity = Math.min(1, age * 2) * .9 * fin; sig.rotation.z += dt * .6;
    gi.set(P.target.x, P.target.z, 0, P.r, 0, 0, 1, .45 * Math.min(1, age * 2) * fin, EL.fire.hex); gi.tick(age);
    while (sched.length && age >= sched[0]) {
      const idx = sched.shift(), big = sched.length === 0;
      const ang = rnd(0, 6.283), rr = big ? 0 : Math.sqrt(Math.random()) * P.r * .92;
      const end = new V3(P.target.x + Math.cos(ang) * rr, .3, P.target.z + Math.sin(ang) * rr);
      const sa = rnd(0, 6.283), sr = Math.sqrt(Math.random()) * P.r * 1.0;
      const st = new V3(P.target.x + S.x + Math.cos(sa) * sr, skyY, P.target.z + S.z + Math.sin(sa) * sr);
      if (big) { st.set(P.target.x + S.x * .8, skyY + 6, P.target.z + S.z * .8); }
      const s = big ? 1.9 : rnd(.45, .8);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2a1810, emissive: 0xff5a10, emissiveIntensity: 1.3, flatShading: true, roughness: 1 }));
      mesh.scale.setScalar(s); mesh.castShadow = true; scene.add(mesh);
      const gs = glowSprite(0xff8030, 5, .9); mesh.add(gs);
      rock.push({ mesh, st, end, s, big, t: 0, fall: big ? .9 : rnd(.55, .75), prev: st.clone(), spin: new V3(rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)) });
    }
    for (let i = rock.length - 1; i >= 0; i--) {
      const m = rock[i]; m.t += dt / m.fall; const u = Math.min(1, m.t), e = u * u * .6 + u * .4;
      m.mesh.position.lerpVectors(m.st, m.end, e); m.mesh.rotation.x += m.spin.x * dt; m.mesh.rotation.y += m.spin.y * dt;
      trail(m.prev, m.mesh.position, m.big ? 14 : 7, m.s * 1.6, .5);
      smoke.emit(m.mesh.position.x, m.mesh.position.y, m.mesh.position.z, rnd(-.3, .3), rnd(0, .4), rnd(-.3, .3), 1.2, m.s * 2.4, [.25, .2, .18], [.08, .08, .09], .35, 2, -.2, .5);
      m.prev.copy(m.mesh.position);
      if (u >= 1) {
        scene.remove(m.mesh); m.mesh.material.dispose(); rock.splice(i, 1);
        const R = m.big ? P.r * .85 : Math.max(1.6, P.r * .27), pw = clamp(P.power + (m.big ? .2 : 0), .3, 1);
        explode(m.end, R, pw, { dmg: m.big ? 120 : 55 });
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
  DUMMIES.forEach(d => { d.hp = d.max; d.burn = 0; if (d.dead) d.reset(); });
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
  d.innerHTML = '<b>' + (i + 1) + '</b><span class="ic">' + s.icon + '</span><span class="nm">' + s.name + '</span><i></i>';
  d.onclick = () => selectSkill(i); hotbar.appendChild(d);
});
const slots = [...hotbar.children], cBox = document.getElementById('chargeBox'), cFill = document.getElementById('chargeFill'), cTxt = document.getElementById('chargeTxt'), infoEl = document.getElementById('info'), chantEl = document.getElementById('chant');
function updateHUD() {
  slots.forEach((el, i) => { el.classList.toggle('active', i === G.skill); el.lastChild.style.width = (i === G.skill && G.state === 'charging' ? G.charge * 100 : 0) + '%'; });
  const on = G.state === 'charging'; cBox.classList.toggle('on', on); cBox.classList.toggle('max', on && G.charge >= 1);
  cFill.style.width = G.charge * 100 + '%'; cTxt.textContent = on ? (G.charge >= 1 ? '集氣完成 MAX' : '集氣 ' + Math.round(G.charge * 100) + '%') : '';
  let t = '裝備:' + (G.weapon === 'staff' ? '法杖' : '魔法書');
  if (G.skill >= 0) { const s = SKILLS[G.skill]; t += '<br>' + s.name + ' ・ ' + (s.shape === 'wall' ? '長度 ' : '半徑 ') + skillRad().toFixed(1) + 'm ・ 射程 ' + sc(G.skill).range + 'm'; }
  else t += '<br>未選擇法術(按 1/2/3)';
  t += '<br>閃避 ' + G.dodged + ' ・ 被擊中 ' + G.hits + (G.autoStrike ? ' ・ 自動來襲 ON' : '');
  if (infoEl._t !== t) { infoEl.innerHTML = t; infoEl._t = t; }
  // 咒語字幕位置:角色頭上
  tmpV.copy(mage.root.position); tmpV.y += 3.1; tmpV.project(camera);
  chantEl.style.left = (tmpV.x * .5 + .5) * innerWidth + 'px'; chantEl.style.top = (-tmpV.y * .5 + .5) * innerHeight + 'px';
}

/* ================= 參數面板 ================= */
const PANEL = [
  ['鏡頭與操作'],
  ['camDist', '鏡頭距離', 4, 18, .5], ['camSens', '視角靈敏度', .002, .012, .0005], ['autoFrame', '施法自動拉鏡頭', 'bool'], ['shake', '震動強度', 0, 2, .1],
  ['moveSpeed', '移動速度', 2, 10, .5], ['jumpV', '跳躍力道', 5, 14, .5], ['rollDist', '翻滾距離', 2, 10, .5], ['rollTime', '翻滾時間(秒)', .25, .8, .05], ['rollCD', '翻滾冷卻(秒)', 0, 2, .1], ['minHold', '最短集氣(秒)', 0, 1, .05], ['bloom', '泛光特效', 'bool'], ['bloomStrength', '泛光強度', 0, 2, .05],
  ['火球術'], ['skills.fireball.chargeTime', '集氣時間(秒)', .3, 4, .1], ['skills.fireball.range', '最大射程', 8, 45, 1], ['skills.fireball.rMin', '最小半徑', .5, 5, .1], ['skills.fireball.rMax', '最大半徑', 1, 10, .1], ['skills.fireball.recover', '施法後僵直(秒)', 0, 2, .05],
  ['火牆術'], ['skills.firewall.chargeTime', '集氣時間(秒)', .3, 4, .1], ['skills.firewall.range', '最大射程', 8, 45, 1], ['skills.firewall.rMin', '最短長度', 2, 10, .5], ['skills.firewall.rMax', '最長長度', 6, 30, .5], ['skills.firewall.thick', '牆厚度', .5, 4, .1], ['skills.firewall.duration', '持續時間(秒)', 2, 20, .5], ['skills.firewall.recover', '施法後僵直(秒)', 0, 2, .05],
  ['隕石術'], ['skills.meteor.chargeTime', '集氣時間(秒)', .3, 5, .1], ['skills.meteor.range', '最大射程', 8, 50, 1], ['skills.meteor.rMin', '最小半徑', 2, 10, .5], ['skills.meteor.rMax', '最大半徑', 4, 20, .5], ['skills.meteor.recover', '施法後僵直(秒)', 0, 3, .05]
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
}
buildPanel();
document.getElementById('gear').onclick = () => document.getElementById('panel').classList.toggle('on');

/* ================= 主迴圈 ================= */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, .05) * (window.TS || 1); last = now; G.time += dt;
  if (window.inputTick) inputTick(dt);
  updatePlayer(dt); updateAim(dt); updateCasting(dt);
  mage.update(dt, { move: G.speedN || 0, cast: G.cb, kick: G.kick, charge: G.charge, t: G.time, hover: 0, roll: G.roll ? Math.min(1, G.roll.t / CFG.rollTime) : -1, rollPhi: G.roll ? G.roll.phi : 0 });
  updateOrb(dt); updateCamera(dt); updateWorld(dt); updateFx(dt); updateLights(dt);
  fire.update(dt); smoke.update(dt); updateDmgTexts(dt); updateHUD();
  sky.position.copy(camera.position);
  moonLight.shadow.needsUpdate = true;
  if (bloom) bloom.strength = CFG.bloomStrength;
  if (CFG.bloom && composer) composer.render(dt); else renderer.render(scene, camera);
}
requestAnimationFrame(frame);
window.G = G; window.CFG = CFG;
