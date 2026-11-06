'use strict';
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x3d3466, 50, 160);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 600);

// 粒子:加亮(火光)與一般(煙)
const fire = new Particles(scene, IS_TOUCH ? 5000 : 9000, true);
const smoke = new Particles(scene, IS_TOUCH ? 1500 : 2500, false);

// 天空
const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uHor: { value: new THREE.Color(.24, .2, .4) }, uTop: { value: new THREE.Color(.03, .05, .16) }, uGnd: { value: new THREE.Color(.12, .1, .2) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(0, 0, 0) } },
  vertexShader: 'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: 'uniform vec3 uHor,uTop,uGnd,uSunDir,uSunCol;varying vec3 vP;void main(){vec3 n=normalize(vP);float h=n.y;vec3 c=mix(uHor,uTop,smoothstep(0.,.55,h));c=mix(uGnd,c,smoothstep(-.1,.05,h));float s=max(dot(n,normalize(uSunDir)),0.);c+=uSunCol*(pow(s,6.)*.35+pow(s,120.));gl_FragColor=vec4(c,1.);}'
}));
sky.renderOrder = -10; scene.add(sky);
{
  const n = 500, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const th = Math.random() * 6.283, y = rnd(.06, 1), r = Math.sqrt(1 - y * y); a[i * 3] = Math.cos(th) * r * 380; a[i * 3 + 1] = y * 380; a[i * 3 + 2] = Math.sin(th) * r * 380; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  const st = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, depthWrite: false }));
  st.frustumCulled = false; sky.add(st);
  const moon = glowSprite(0xaab8ff, 70, .8); moon.position.set(-150, 190, 260); moon.material.fog = false; sky.add(moon);
  var skyStars = st, skyMoon = moon;
}

// 燈光
const hemi = new THREE.HemisphereLight(0x8a9bff, 0x2a2438, .75); scene.add(hemi);
const moonLight = new THREE.DirectionalLight(0xaab8ff, .95);
moonLight.position.set(-20, 40, 15); moonLight.castShadow = true;
moonLight.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
Object.assign(moonLight.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 120 });
moonLight.shadow.bias = -0.0005;
scene.add(moonLight, moonLight.target);
// 動態光源池(固定數量,避免 shader 重編)
const LIGHTS = [];
for (let i = 0; i < 5; i++) { const L = new THREE.PointLight(0xff8a2a, 0, 30, 2); L.userData = { t: 0, dur: 0, peak: 0 }; scene.add(L); LIGHTS.push(L); }

// 地面
const groundTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#34443f'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 2500; i++) { g.fillStyle = Math.random() < .5 ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.06)'; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
  g.strokeStyle = 'rgba(160,190,185,.28)'; g.lineWidth = 2; g.strokeRect(1, 1, s - 2, s - 2);
});
groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping; groundTex.repeat.set(45, 45); groundTex.anisotropy = 8;
const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const COLLIDERS = [];
// 可站立平台(高台);deco:true = 場景裝飾(換場景時清掉);tmp:true = 法術產生的暫時平台(由法術自己移除)
const PLAYER_R = 0.4, STEP_UP = 0.25;
const PLATFORMS = [];
function addPlatform(o) { o.yaw = o.yaw || 0; o.c = Math.cos(o.yaw); o.s = Math.sin(o.yaw); PLATFORMS.push(o); return o; }
function removePlatform(o) { const i = PLATFORMS.indexOf(o); if (i >= 0) PLATFORMS.splice(i, 1); }
function platLocal(P, x, z) { const dx = x - P.x, dz = z - P.z; return { lx: dx * P.c - dz * P.s, lz: dx * P.s + dz * P.c }; }
function platContains(P, x, z, m) {
  if (P.kind === 'cyl') return Math.hypot(x - P.x, z - P.z) <= P.r + m;
  const L = platLocal(P, x, z); return Math.abs(L.lx) <= P.hx + m && Math.abs(L.lz) <= P.hz + m;
}
function surfaceY(x, z) { let y = 0; for (const P of PLATFORMS) if (P.top > y && platContains(P, x, z, 0)) y = P.top; return y; }
function groundAt(x, z, y) { let g = 0; for (const P of PLATFORMS) if (P.top > g && P.top <= y + STEP_UP && platContains(P, x, z, 0.15)) g = P.top; return g; }
function nearPlatform(x, z, m) { return PLATFORMS.some(P => platContains(P, x, z, m)); }
function pushOutPlatforms(p) {
  for (const P of PLATFORMS) {
    if (P.top <= p.y + STEP_UP) continue;
    if (P.kind === 'cyl') {
      const dx = p.x - P.x, dz = p.z - P.z, d = Math.hypot(dx, dz), m = P.r + PLAYER_R;
      if (d >= m) continue;
      if (d > 1e-4) { p.x = P.x + dx / d * m; p.z = P.z + dz / d * m; } else p.x = P.x + m;
      continue;
    }
    const L = platLocal(P, p.x, p.z);
    const qx = clamp(L.lx, -P.hx, P.hx), qz = clamp(L.lz, -P.hz, P.hz);
    const ex = L.lx - qx, ez = L.lz - qz, d = Math.hypot(ex, ez);
    if (d >= PLAYER_R) continue;
    let nx = L.lx, nz = L.lz;
    if (d > 1e-4) { nx = qx + ex / d * PLAYER_R; nz = qz + ez / d * PLAYER_R; }
    else { // 中心在盒子內:從穿透最淺的那一邊推出
      const px = P.hx - Math.abs(L.lx), pz = P.hz - Math.abs(L.lz);
      if (px < pz) nx = Math.sign(L.lx || 1) * (P.hx + PLAYER_R); else nz = Math.sign(L.lz || 1) * (P.hz + PLAYER_R);
    }
    p.x = P.x + nx * P.c + nz * P.s; p.z = P.z - nx * P.s + nz * P.c;
  }
}
let ARENA_R = 52;
const BRAZIERS = [];
// 場景裝飾由 scenes.js 建立

// 稻草人標靶
const DUMMIES = [];
const DMG_MAX = 220;
class Dummy {
  constructor(x, z) {
    this.home = new V3(x, 0, z); this.g = new THREE.Group(); this.g.position.copy(this.home); scene.add(this.g);
    this.g.rotation.y = Math.PI; this.pivot = new THREE.Group(); this.g.add(this.pivot);   // pivot:跌倒用,整個模型掛在腳底原點
    this.yaw = Math.PI; this.downK = 0; this.downT = 0; this.downAxis = new V3(1, 0, 0); this.stars = null;
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1 });
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xc9b17a, roughness: 1, emissive: 0xff3300, emissiveIntensity: 0 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; this.pivot.add(m); return m; };
    add(new THREE.CylinderGeometry(.55, .65, .18, 16), wood, 0, .09, 0);
    add(new THREE.CylinderGeometry(.07, .07, 1.5, 8), wood, 0, .9, 0);
    add(new THREE.CylinderGeometry(.3, .34, .95, 14), this.bodyMat, 0, 1.05, 0);
    add(new THREE.BoxGeometry(1.2, .1, .1), wood, 0, 1.35, 0);
    add(new THREE.SphereGeometry(.26, 14, 12), this.bodyMat, 0, 1.85, 0);
    const red = add(new THREE.CircleGeometry(.22, 20), new THREE.MeshBasicMaterial({ color: 0xc02020 }), 0, 1.1, .345);
    add(new THREE.CircleGeometry(.12, 20), new THREE.MeshBasicMaterial({ color: 0xf0f0f0 }), 0, 1.1, .35);
    add(new THREE.CircleGeometry(.05, 12), new THREE.MeshBasicMaterial({ color: 0xc02020 }), 0, 1.1, .355);
    this.hp = this.max = DMG_MAX; this.ax = this.az = this.vx = this.vz = 0; this.flash = 0; this.burn = 0; this.burnT = 0;
    this.dead = false; this.respawn = 0; this.hpShow = 0;
    this.bar = new THREE.Group(); scene.add(this.bar);
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, .12), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: .6, depthTest: false }));
    this.fg = new THREE.Mesh(new THREE.PlaneGeometry(.94, .08), new THREE.MeshBasicMaterial({ color: 0xe03030, depthTest: false }));
    bg.renderOrder = 20; this.fg.renderOrder = 21; this.fg.position.z = .001; this.bar.add(bg, this.fg); this.bar.visible = false;
    this.col = { x, z, r: .5, ref: this }; COLLIDERS.push(this.col);
    this.flashHex = 0xff3300; this.ph = Math.random() * 6.283; this.walkT = this.ph; this.walkX = 0; this.spin = 0; this.pAcc = 0; this.pAcc2 = 0;
    this.clearStatus();
  }
  // 實際位置 = 原位 + 位移(擊退 / 吸引)+ 左右移動選項(CFG.dummyMove)
  get x() { return this.home.x + this.ox + this.walkX; }
  get z() { return this.home.z + this.oz; }
  // 清除位移、離地與所有狀態(死亡、R 重置、重生時呼叫)
  clearStatus() {
    this.ox = this.oz = this.ovx = this.ovz = 0; this.y = this.vy = 0;
    this.slowT = this.stunT = this.erodeT = this.erodeAcc = this.litT = this.pushT = this.windT = 0;
    if (this.stars) this.stars.forEach(s => s.visible = false);
    if (this.litSpr) this.litSpr.visible = false;
  }
  // 受擊:el 決定閃光與傷害數字顏色(火系維持原本顏色);照亮中傷害 ×1.25
  hit(dmg, dx, dz, burn, el, src) {   // src === 'dot' 為持續傷害(不觸發 onPlayerHit)
    if (this.dead) return;
    if (this.litT > 0) dmg *= 1.25;
    this.hp -= dmg; this.flash = 1; this.hpShow = 4;
    const alt = el && el !== 'fire';
    this.flashHex = alt ? EL[el].hex : 0xff3300;
    const l = Math.hypot(dx, dz) || 1; this.vx += dx / l * .8; this.vz += dz / l * .8;
    if (burn) this.burn = Math.max(this.burn, burn);
    addDmgText(new V3(this.x, 2.3 + this.y, this.z), Math.round(dmg), alt ? EL[el].css0 : null);
    if (src !== 'dot' && window.onPlayerHit) window.onPlayerHit(this);   // 刺客潛行顯形用
    if (this.hp <= 0) this.die();
  }
  // 擊退:沿 (dirx,dirz) 滑行約 dist 公尺(阻尼 3.2/s,總距離 ≈ dist)
  knock(dirx, dirz, dist) {
    const l = Math.hypot(dirx, dirz) || 1;
    this.ovx += dirx / l * dist * 3.2; this.ovz += dirz / l * dist * 3.2; this.pushT = 0;
  }
  // 擊飛:離地速度至少能升到 h 公尺
  lift(h) { this.vy = Math.max(this.vy, Math.sqrt(2 * 20 * h)); }
  // 吸引:朝 (tx,tz) 移動,最多靠近到距離 0.5 m
  pull(tx, tz, speed, dt) {
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
    if (d < .5) return;
    const s = Math.min(speed * dt, d - .5) / d; this.ox += dx * s; this.oz += dz * s; this.pushT = 0;
  }
  stun(t) { this.stunT = Math.max(this.stunT, t); }
  slow(t) { this.slowT = Math.max(this.slowT, t); }
  erode(t) { this.erodeT = Math.max(this.erodeT, t); }
  light(t) { this.litT = Math.max(this.litT, t); }
  die() {
    this.dead = true; this.respawn = 4; this.g.visible = false; this.bar.visible = false;
    for (let i = 0; i < 50; i++) fire.emit(this.x, 1.2 + this.y, this.z, rnd(-4, 4), rnd(1, 7), rnd(-4, 4), rnd(.5, 1), rnd(.2, .5), EL.fire.c0, EL.fire.c1, 1, .4, 8, .5);
    for (let i = 0; i < 8; i++) smoke.emit(this.x + rnd(-.3, .3), 1.2 + this.y, this.z + rnd(-.3, .3), rnd(-.5, .5), rnd(.5, 2), rnd(-.5, .5), rnd(1, 2), rnd(1, 2), [.25, .2, .18], [.08, .08, .09], .5, 2, -.3, .8);
    this.clearStatus();
  }
  reset() { this.hp = this.max; this.dead = false; this.g.visible = true; this.burn = 0; this.ax = this.az = this.vx = this.vz = 0; this.clearStatus(); this.g.scale.setScalar(.01); this.popping = true; this.downK = this.downT = 0; this.yaw = Math.PI; this.pivot.rotation.set(0, 0, 0); }
  // 跌倒:沿推力方向倒下(pivot 繞與推力垂直的水平軸轉 85°),躺 t 秒後爬起
  knockDown(t, dirx, dirz) {
    if (this.dead) return;
    if (this.downK < .05 && this.downT <= 0) { const a = Math.atan2(dirx, dirz) - this.yaw; this.downAxis.set(Math.cos(a), 0, -Math.sin(a)); }
    this.downT = Math.max(this.downT, t);
  }
  stunFx(t) { this.stun(t); }   // 舊掛點,統一走 stun()
  update(dt) {
    if (this.dead) { this.respawn -= dt; if (this.respawn <= 0) this.reset(); return; }
    if (this.popping) { const s = Math.min(1, this.g.scale.x + dt * 3); this.g.scale.setScalar(s); if (s >= 1) this.popping = false; }
    this.vx += (-60 * this.ax - 5 * this.vx) * dt; this.vz += (-60 * this.az - 5 * this.vz) * dt;
    this.ax += this.vx * dt; this.az += this.vz * dt;
    // 朝向:刺客、玩家未潛行、距離 < 12 m 時緩慢轉向玩家;倒地 / 暈眩中不轉
    const pp = mage.root.position, pdx = pp.x - this.g.position.x, pdz = pp.z - this.g.position.z;
    if (G.cls === 'assassin' && !G.stealth && this.stunT <= 0 && this.downT <= 0 && this.downK < .05 && Math.hypot(pdx, pdz) < 12)
      this.yaw += clamp(angDiff(this.yaw, Math.atan2(pdx, pdz)), -1.5 * dt, 1.5 * dt);
    // 跌倒動畫:倒下 0.2 s、爬起 0.5 s;躺著的時間由 downT 倒數
    const tgtK = this.downT > 0 ? 1 : 0, stp = dt * (tgtK > this.downK ? 5 : 2);
    this.downK = tgtK > this.downK ? Math.min(tgtK, this.downK + stp) : Math.max(tgtK, this.downK - stp);
    if (this.downT > 0) this.downT -= dt;
    this.pivot.setRotationFromAxisAngle(this.downAxis, this.downK * 1.4835);
    const still = this.downK > .01 || this.downT > 0;   // 倒地中不搖晃
    this.g.rotation.x = still ? 0 : this.az; this.g.rotation.z = still ? 0 : -this.ax; this.g.rotation.y = this.yaw;
    this.flash = Math.max(0, this.flash - dt * 4);
    // 1) 位移:擊退 / 吸引後滑行,1.2 s 後彈回原位(減速中彈回較慢);位移上限 6 m
    this.ovx *= Math.exp(-3.2 * dt); this.ovz *= Math.exp(-3.2 * dt);
    this.ox += this.ovx * dt; this.oz += this.ovz * dt;
    this.pushT += dt;
    if (this.pushT > 1.2) { const k = this.slowT > 0 ? 1.25 : 2.5; this.ox = damp(this.ox, 0, k, dt); this.oz = damp(this.oz, 0, k, dt); }
    const L = Math.hypot(this.ox, this.oz); if (L > 6) { this.ox *= 6 / L; this.oz *= 6 / L; }
    // 2) 離地:重力;落地速度 > 3 時揚起塵土
    this.vy -= 20 * dt; this.y += this.vy * dt;
    if (this.y <= 0) {
      if (this.vy < -3) for (let i = 0; i < 6; i++) smoke.emit(this.x + rnd(-.3, .3), .1, this.z + rnd(-.3, .3), rnd(-1, 1), rnd(.3, 1), rnd(-1, 1), rnd(.5, .9), rnd(.8, 1.4), [.5, .45, .4], [.3, .3, .3], .4, 2, 0, 1.5);
      this.y = 0; this.vy = 0;
    }
    // 3) 計時器與侵蝕(每 .5 s 4 點紫色傷害)
    this.slowT = Math.max(0, this.slowT - dt); this.stunT = Math.max(0, this.stunT - dt); this.litT = Math.max(0, this.litT - dt); this.windT = Math.max(0, this.windT - dt);
    if (this.erodeT > 0) {
      this.erodeT -= dt; this.erodeAcc += dt;
      if (this.erodeAcc >= .5) { this.erodeAcc -= .5; this.hit(4, 0, 0, 0, 'dark', 'dot'); if (this.dead) return; }
    } else this.erodeAcc = 0;
    if (this.burn > 0) {
      this.burn -= dt; this.burnT += dt;
      if (this.burnT > .5) { this.burnT = 0; this.hit(5, 0, 0, 0, null, 'dot'); if (this.dead) return; }
      for (let i = 0; i < 2; i++) fire.emit(this.x + rnd(-.25, .25), this.y + rnd(.6, 1.8), this.z + rnd(-.25, .25), rnd(-.3, .3), rnd(1, 2.5), rnd(-.3, .3), rnd(.4, .7), rnd(.4, .7), EL.fire.c0, EL.fire.c1, .9, .3, -.5, .5);
    }
    // 4) 左右移動選項:減速時 ×0.5、暈眩時停止
    this.walkT += dt * (this.slowT > 0 ? .5 : 1) * (this.stunT > 0 ? 0 : 1);
    this.walkX = CFG.dummyMove ? Math.sin(this.walkT * .8) * 1.5 : 0;
    // 5) 狀態粒子(每標靶每秒上限 6 顆)
    if (this.slowT > 0) {
      this.pAcc += dt * 6;
      while (this.pAcc >= 1) { this.pAcc -= 1; smoke.emit(this.x + rnd(-.3, .3), this.y + rnd(1.2, 2), this.z + rnd(-.3, .3), 0, 0, 0, .7, rnd(.12, .2), EL.water.s0, EL.water.s1, .9, 1, 9, 0); }
    } else this.pAcc = 0;
    if (this.erodeT > 0) {
      this.pAcc2 += dt * 6;
      while (this.pAcc2 >= 1) { this.pAcc2 -= 1; smoke.emit(this.x + rnd(-.3, .3), this.y + rnd(.4, 1.8), this.z + rnd(-.3, .3), 0, rnd(.4, .8), 0, .9, rnd(.2, .35), EL.dark.s0, EL.dark.s1, .9, 1, -.3, 0); }
    } else this.pAcc2 = 0;
    // 6) 暈眩星星(頭上 3 顆繞圈,延遲建立)與照亮光點(延遲建立)
    if (this.stunT > 0) {
      if (!this.stars) { this.stars = []; for (let i = 0; i < 3; i++) { const s = glowSprite(0xffe066, .32, .95); scene.add(s); this.stars.push(s); } }
      this.spin += dt * 4;
      this.stars.forEach((s, i) => { const a = this.spin + i * 2.094; s.visible = true; s.position.set(this.x + Math.cos(a) * .45, this.y + 2.25, this.z + Math.sin(a) * .45); });
    } else if (this.stars) this.stars.forEach(s => s.visible = false);
    if (this.litT > 0) {
      if (!this.litSpr) { this.litSpr = glowSprite(0xfff0a0, 1.1, .85); scene.add(this.litSpr); }
      this.litSpr.visible = true; this.litSpr.position.set(this.x, this.y + 2.6, this.z);
    } else if (this.litSpr) this.litSpr.visible = false;
    // 7) 位置與碰撞圈
    this.g.position.set(this.x, this.y, this.z); this.col.x = this.x; this.col.z = this.z;
    // 8) 發光優先序:受擊閃光 > 燃燒 > 照亮 > 侵蝕 > 減速
    const bm = this.bodyMat;
    if (this.flash > .01) { bm.emissive.setHex(this.flashHex); bm.emissiveIntensity = this.flash * .9; }
    else if (this.burn > 0) { bm.emissive.setHex(0xff3300); bm.emissiveIntensity = .35; }
    else if (this.litT > 0) { bm.emissive.setHex(0xffe08a); bm.emissiveIntensity = .4; }
    else if (this.erodeT > 0) { bm.emissive.setHex(0x8a3aff); bm.emissiveIntensity = .35; }
    else if (this.slowT > 0) { bm.emissive.setHex(0x3aa8ff); bm.emissiveIntensity = .3; }
    else bm.emissiveIntensity = 0;
    this.hpShow -= dt;
    this.bar.visible = this.hpShow > 0 && this.hp < this.max;
    if (this.bar.visible) {
      this.bar.position.set(this.x, 2.5 + this.y, this.z); this.bar.quaternion.copy(camera.quaternion);
      const r = Math.max(0, this.hp / this.max); this.fg.scale.x = Math.max(.001, r); this.fg.position.x = -.47 * (1 - r);
    }
  }
}
const _dpos = [];
for (let i = 0; i < 7; i++) _dpos.push([-9 + i * 3, 16]);
for (let i = 0; i < 6; i++) _dpos.push([-12 + Math.cos(i / 6 * 6.283) * 5, 26 + Math.sin(i / 6 * 6.283) * 5]);
for (let i = 0; i < 6; i++) _dpos.push([14 + Math.cos(i / 6 * 6.283) * 4, 30 + Math.sin(i / 6 * 6.283) * 4]);
_dpos.push([-5, 8], [5, 8], [0, 10], [-16, 6], [16, 6]);
_dpos.forEach(p => DUMMIES.push(new Dummy(p[0], p[1])));

// 焦痕貼圖
const SCORCH = [];
const SCORCH_GEO = new THREE.PlaneGeometry(1, 1);
