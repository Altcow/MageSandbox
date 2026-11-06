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
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1 });
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xc9b17a, roughness: 1, emissive: 0xff3300, emissiveIntensity: 0 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; this.g.add(m); return m; };
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
  }
  hit(dmg, dx, dz, burn) {
    if (this.dead) return;
    this.hp -= dmg; this.flash = 1; this.hpShow = 4;
    const l = Math.hypot(dx, dz) || 1; this.vx += dx / l * .8; this.vz += dz / l * .8;
    if (burn) this.burn = Math.max(this.burn, burn);
    addDmgText(new V3(this.home.x, 2.3, this.home.z), Math.round(dmg));
    if (this.hp <= 0) this.die();
  }
  die() {
    this.dead = true; this.respawn = 4; this.g.visible = false; this.bar.visible = false;
    for (let i = 0; i < 50; i++) fire.emit(this.home.x, 1.2, this.home.z, rnd(-4, 4), rnd(1, 7), rnd(-4, 4), rnd(.5, 1), rnd(.2, .5), EL.fire.c0, EL.fire.c1, 1, .4, 8, .5);
    for (let i = 0; i < 8; i++) smoke.emit(this.home.x + rnd(-.3, .3), 1.2, this.home.z + rnd(-.3, .3), rnd(-.5, .5), rnd(.5, 2), rnd(-.5, .5), rnd(1, 2), rnd(1, 2), [.25, .2, .18], [.08, .08, .09], .5, 2, -.3, .8);
  }
  reset() { this.hp = this.max; this.dead = false; this.g.visible = true; this.burn = 0; this.ax = this.az = this.vx = this.vz = 0; this.g.scale.setScalar(.01); this.popping = true; }
  update(dt) {
    if (this.dead) { this.respawn -= dt; if (this.respawn <= 0) this.reset(); return; }
    if (this.popping) { const s = Math.min(1, this.g.scale.x + dt * 3); this.g.scale.setScalar(s); if (s >= 1) this.popping = false; }
    this.vx += (-60 * this.ax - 5 * this.vx) * dt; this.vz += (-60 * this.az - 5 * this.vz) * dt;
    this.ax += this.vx * dt; this.az += this.vz * dt;
    this.g.rotation.x = this.az; this.g.rotation.z = -this.ax;
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.burn > 0) {
      this.burn -= dt; this.burnT += dt;
      if (this.burnT > .5) { this.burnT = 0; this.hit(5, 0, 0, 0); if (this.dead) return; }
      for (let i = 0; i < 2; i++) fire.emit(this.home.x + rnd(-.25, .25), rnd(.6, 1.8), this.home.z + rnd(-.25, .25), rnd(-.3, .3), rnd(1, 2.5), rnd(-.3, .3), rnd(.4, .7), rnd(.4, .7), EL.fire.c0, EL.fire.c1, .9, .3, -.5, .5);
    }
    this.bodyMat.emissiveIntensity = Math.max(this.flash * .9, this.burn > 0 ? .35 : 0);
    this.hpShow -= dt;
    this.bar.visible = this.hpShow > 0 && this.hp < this.max;
    if (this.bar.visible) {
      this.bar.position.set(this.home.x, 2.5, this.home.z); this.bar.quaternion.copy(camera.quaternion);
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
