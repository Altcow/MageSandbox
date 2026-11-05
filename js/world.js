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
  vertexShader: 'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: 'varying vec3 vP;void main(){float h=normalize(vP).y;vec3 hor=vec3(.24,.2,.4);vec3 top=vec3(.03,.05,.16);vec3 c=mix(hor,top,smoothstep(0.,.55,h));c=mix(vec3(.12,.1,.2),c,smoothstep(-.1,.05,h));gl_FragColor=vec4(c,1.);}'
}));
sky.renderOrder = -10; scene.add(sky);
{
  const n = 500, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const th = Math.random() * 6.283, y = rnd(.06, 1), r = Math.sqrt(1 - y * y); a[i * 3] = Math.cos(th) * r * 380; a[i * 3 + 1] = y * 380; a[i * 3 + 2] = Math.sin(th) * r * 380; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  const st = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, depthWrite: false }));
  st.frustumCulled = false; sky.add(st);
  const moon = glowSprite(0xaab8ff, 70, .8); moon.position.set(-150, 190, 260); moon.material.fog = false; sky.add(moon);
}

// 燈光
scene.add(new THREE.HemisphereLight(0x8a9bff, 0x2a2438, .75));
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
const ARENA_R = 52;
// 圍牆石柱
for (let i = 0; i < 28; i++) {
  const a = i / 28 * 6.2832, h = rnd(3, 5.5);
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.4, h, 1.4), new THREE.MeshStandardMaterial({ color: 0x6a6f85, roughness: .9 }));
  m.position.set(Math.cos(a) * 56, h / 2, Math.sin(a) * 56); m.rotation.y = rnd(0, 3); m.castShadow = m.receiveShadow = true; scene.add(m);
}
// 樹
for (let i = 0; i < 70; i++) {
  const a = rnd(0, 6.283), r = rnd(62, 95), g = new THREE.Group();
  const h = rnd(5, 9);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.3, .4, 2, 6), new THREE.MeshStandardMaterial({ color: 0x4a3322 })); trunk.position.y = 1;
  g.add(trunk);
  for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry(2.4 - k * .5, h / 2.2, 8), new THREE.MeshStandardMaterial({ color: 0x1e3a33, roughness: 1 })); c.position.y = 2.6 + k * h / 4; g.add(c); }
  g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); scene.add(g);
}
// 內部柱子與火盆
const BRAZIERS = [];
[[-18, -6], [20, -10], [-24, 18], [26, 14], [0, 36], [-10, -30], [14, -34]].forEach(([x, z]) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(.5, .7, 2.2, 8), new THREE.MeshStandardMaterial({ color: 0x777c92, roughness: .9 }));
  m.position.set(x, 1.1, z); m.castShadow = m.receiveShadow = true; scene.add(m);
  COLLIDERS.push({ x, z, r: .8 }); BRAZIERS.push({ x, y: 2.3, z });
});

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
