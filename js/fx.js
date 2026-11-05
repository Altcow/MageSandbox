'use strict';
const V3 = THREE.Vector3;
const IS_TOUCH = (window.matchMedia && matchMedia('(pointer:coarse)').matches) || location.search.includes('touch=1');
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const easeOut = t => 1 - (1 - t) * (1 - t);

// 元素色表(之後要加冰/雷,在這裡加一筆即可)
const EL = {
  fire: { hex: 0xff7a1a, c0: [1, 0.92, 0.55], c1: [0.95, 0.22, 0.03], core: 0xffd890 }
};

function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  return new THREE.CanvasTexture(c);
}
const GLOW_TEX = canvasTex(128, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.55)');
  gr.addColorStop(.6, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
});
const SCORCH_TEX = canvasTex(128, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(10,6,4,.9)'); gr.addColorStop(.55, 'rgba(10,6,4,.55)'); gr.addColorStop(1, 'rgba(10,6,4,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
});
const RUNE_TEX = canvasTex(512, (g, s) => {
  g.translate(s / 2, s / 2); g.strokeStyle = '#fff'; g.lineCap = 'round';
  const circ = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke(); };
  circ(246, 6); circ(226, 2); circ(150, 3); circ(104, 2);
  for (let i = 0; i < 72; i++) {
    const a = i / 72 * 6.2832, l = i % 6 == 0 ? 16 : 8; g.lineWidth = i % 6 == 0 ? 3 : 1.5;
    g.beginPath(); g.moveTo(Math.cos(a) * 226, Math.sin(a) * 226); g.lineTo(Math.cos(a) * (226 - l), Math.sin(a) * (226 - l)); g.stroke();
  }
  for (let k = 0; k < 2; k++) {
    g.lineWidth = 3; g.beginPath();
    for (let i = 0; i <= 3; i++) { const a = (i / 3 + k / 6) * 6.2832 - 1.5708; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 150, Math.sin(a) * 150); }
    g.stroke();
  }
  let seed = 7; const rn = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 24; i++) {
    g.save(); g.rotate(i / 24 * 6.2832); g.translate(0, -190); g.lineWidth = 3; g.beginPath();
    g.moveTo(-6, -14); for (let j = 0; j < 4; j++) g.lineTo((rn() - .5) * 18, -14 + (j + 1) * 7); g.stroke(); g.restore();
  }
});

function glowSprite(hex, scale, opacity) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: hex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: opacity == null ? 1 : opacity }));
  s.scale.setScalar(scale); return s;
}

// ---------- 粒子系統 ----------
const PVERT = 'attribute float size;attribute vec4 color;varying vec4 vC;uniform float uScale;void main(){vC=color;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=min(size*uScale/(-mv.z),600.);gl_Position=projectionMatrix*mv;}';
const PFRAG = 'varying vec4 vC;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;float a=pow(1.-d,1.6);gl_FragColor=vec4(vC.rgb,vC.a*a);}';
class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0;
    const A = n => new Float32Array(max * n);
    this.gPos = A(3); this.gCol = A(4); this.gSize = A(1);
    this.Vv = A(3); this.C0 = A(3); this.C1 = A(3);
    this.life = A(1); this.age = A(1); this.s0 = A(1); this.grow = A(1); this.grav = A(1); this.drag = A(1); this.a0 = A(1);
    const geo = this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.gPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.gCol, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.gSize, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos); geo.setAttribute('color', this.aCol); geo.setAttribute('size', this.aSize);
    this.mat = new THREE.ShaderMaterial({ uniforms: { uScale: { value: 800 } }, vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.points = new THREE.Points(geo, this.mat); this.points.frustumCulled = false; this.points.renderOrder = additive ? 6 : 5;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size, c0, c1, a, grow, grav, drag) {
    if (this.n >= this.max) return;
    const i = this.n++, i3 = i * 3;
    this.gPos[i3] = x; this.gPos[i3 + 1] = y; this.gPos[i3 + 2] = z;
    this.Vv[i3] = vx; this.Vv[i3 + 1] = vy; this.Vv[i3 + 2] = vz;
    c1 = c1 || c0;
    this.C0[i3] = c0[0]; this.C0[i3 + 1] = c0[1]; this.C0[i3 + 2] = c0[2];
    this.C1[i3] = c1[0]; this.C1[i3 + 1] = c1[1]; this.C1[i3 + 2] = c1[2];
    this.life[i] = life; this.age[i] = 0; this.s0[i] = size;
    this.grow[i] = grow == null ? 1 : grow; this.grav[i] = grav || 0; this.drag[i] = drag || 0; this.a0[i] = a == null ? 1 : a;
  }
  _copy(s, d) {
    const s3 = s * 3, d3 = d * 3;
    for (let k = 0; k < 3; k++) { this.gPos[d3 + k] = this.gPos[s3 + k]; this.Vv[d3 + k] = this.Vv[s3 + k]; this.C0[d3 + k] = this.C0[s3 + k]; this.C1[d3 + k] = this.C1[s3 + k]; }
    this.life[d] = this.life[s]; this.age[d] = this.age[s]; this.s0[d] = this.s0[s]; this.grow[d] = this.grow[s];
    this.grav[d] = this.grav[s]; this.drag[d] = this.drag[s]; this.a0[d] = this.a0[s];
  }
  update(dt) {
    const P = this.gPos, V = this.Vv, C0 = this.C0, C1 = this.C1, gC = this.gCol;
    for (let i = 0; i < this.n;) {
      const a = (this.age[i] += dt), L = this.life[i];
      if (a >= L) { const l = --this.n; if (i !== l) this._copy(l, i); continue; }
      const i3 = i * 3, i4 = i * 4, dr = Math.exp(-this.drag[i] * dt);
      V[i3] *= dr; V[i3 + 1] = V[i3 + 1] * dr - this.grav[i] * dt; V[i3 + 2] *= dr;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      const t = a / L;
      gC[i4] = C0[i3] + (C1[i3] - C0[i3]) * t; gC[i4 + 1] = C0[i3 + 1] + (C1[i3 + 1] - C0[i3 + 1]) * t; gC[i4 + 2] = C0[i3 + 2] + (C1[i3 + 2] - C0[i3 + 2]) * t;
      gC[i4 + 3] = this.a0[i] * Math.min(1, a * 12) * Math.pow(1 - t, 1.4);
      this.gSize[i] = this.s0[i] * (1 + (this.grow[i] - 1) * t);
      i++;
    }
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = true;
    this.geo.setDrawRange(0, this.n);
  }
}

// ---------- 能量球 ----------
function makeOrb(el) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 16), new THREE.MeshBasicMaterial({ color: el.core }));
  g.add(core, glowSprite(el.hex, 3.2, 0.9), glowSprite(el.hex, 7, 0.35));
  g.r = 0.1; g.setR = r => { g.r = r; g.scale.setScalar(r); };
  g.setR(0.1); return g;
}

// ---------- 施法位置光圈(圓形 / 矩形) ----------
class Indicator {
  constructor(scene) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uMode: { value: 0 }, uR: { value: 3 }, uProg: { value: 0 }, uAlpha: { value: 1 }, uS: { value: 4 }, uCol: { value: new THREE.Color(0xff8a2a) }, uHalf: { value: new THREE.Vector2(4, 1) } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `precision highp float;varying vec2 vUv;
uniform float uT,uMode,uR,uProg,uAlpha,uS;uniform vec3 uCol;uniform vec2 uHalf;
float line(float d,float w){return 1.0-smoothstep(0.0,w,abs(d));}
void main(){
 vec2 p=(vUv-0.5)*2.0*uS;float a=0.0;float w=0.07+0.012*uR;
 if(uMode<0.5){
  float r=length(p);float ang=atan(p.y,p.x);float an=ang/6.2831853+0.5;
  float inside=1.0-smoothstep(uR-0.05,uR,r);
  a+=line(r-uR,w);
  a+=line(r-(uR-w*3.5),w*0.6)*0.35;
  a+=inside*0.10;
  a+=inside*(1.0-smoothstep(0.0,uR,r))*0.12;
  a+=line(r-(uR-w*3.5),w*1.8)*step(an,uProg)*1.1*step(0.001,uProg);
  a+=step(0.5,fract((an+uT*0.03)*40.0))*line(r-uR*0.86,w*1.2)*0.55;
  a+=pow(0.5+0.5*sin(ang*4.0-uT*1.6),8.0)*inside*(1.0-smoothstep(uR*0.3,uR*0.9,r))*0.35;
  a+=(1.0-smoothstep(0.0,0.18+0.03*uR,r))*0.8;
  a+=line(r-uR*0.5,w*0.7)*0.25;
 }else{
  vec2 q=abs(p)-uHalf;float sd=length(max(q,0.0))+min(max(q.x,q.y),0.0);
  float inside=1.0-smoothstep(-0.02,0.0,sd);
  a+=line(sd,w);
  a+=inside*0.12;
  a+=inside*step(abs(p.x)/uHalf.x,uProg)*0.35*step(0.001,uProg);
  a+=inside*(0.5+0.5*sin(p.x*3.0+uT*3.0))*0.10;
 }
 gl_FragColor=vec4(uCol*(1.0+uProg*0.8),clamp(a,0.0,1.0)*uAlpha);
}`
    });
    this.root = new THREE.Group();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.rotation.x = -Math.PI / 2; this.mesh.renderOrder = 3;
    this.root.add(this.mesh); this.root.visible = false; scene.add(this.root);
  }
  // mode 0: R 半徑;mode 1: halfX,halfY 為矩形半長寬,yaw 為矩形旋轉
  set(x, z, mode, a, b, yaw, prog, alpha, hex) {
    const u = this.mat.uniforms;
    this.root.position.set(x, 0.07, z); this.root.rotation.y = yaw || 0;
    u.uMode.value = mode; u.uProg.value = prog; u.uAlpha.value = alpha;
    if (hex != null) u.uCol.value.setHex(hex);
    let S;
    if (mode === 0) { u.uR.value = a; S = a + 0.6; }
    else { u.uHalf.value.set(a, b); u.uR.value = Math.max(a, b); S = Math.max(a, b) + 0.6; }
    u.uS.value = S; this.mesh.scale.set(S * 2, S * 2, 1);
    this.root.visible = true;
  }
  tick(t) { this.mat.uniforms.uT.value = t; }
  hide() { this.root.visible = false; }
}
