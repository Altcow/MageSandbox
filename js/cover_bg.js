'use strict';
// 封面 3D 背景(任務 E):四職業(法師 / 弓箭手 / 劍士 / 刺客)對峙陣形 + 夜色叢林佈景。
// 角色沿用 Mage 類的職業外型(mage.js),待機姿勢算一次後烘焙成 2 個合併網格(啞光 / 金屬,頂點色);封面不做骨架動畫。
// 佈景:地面與站位圓台、剪影樹 / 遠山(實例化)、霧片(實例化 billboard)、火把(實例化)+ 火星粒子 + 光暈 + 3 盞點光源閃爍。
// start():隱藏場景內既有物件(含 scenes.js 載入時建的關卡;天空與光源保留)、主角移到原點當相機錨點、暫存霧 / 天空 / 光源參數。
// stop():移除並 dispose 本檔建立的幾何與材質,還原上述狀態。進入遊戲時 setScene 會重建關卡(clearDeco 釋放舊關卡)。
// 降級:prefers-reduced-motion 或 pointer:coarse(IS_TOUCH)→ 相機不環繞;手機粒子減少、火星與霧改 10 Hz 更新。
// 依賴(須先載入):fx.js(IS_TOUCH、EL、canvasTex、glowSprite)、world.js(scene、camera、sky、hemi、moonLight、LIGHTS)、
//   game.js(G、CFG、mage、seedRng)、classes.js(CLASSES)、mage.js(Mage)
(function () {
  const RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const STILL = RM || IS_TOUCH;   // 靜態降級:相機不環繞
  const TAU = Math.PI * 2;
  // 站位:角度(度,0 = +z)與待機姿勢;四人面向中心,對角相對 = 對峙
  const SLOTS = [
    { cls: 'mage', deg: 225, cast: .35, spin: .18, head: .3 },
    { cls: 'archer', deg: 315, cast: 0, spin: -.12, head: -.25 },
    { cls: 'swordsman', deg: 45, cast: 0, shieldUp: .8, spin: .1, head: -.3 },
    { cls: 'assassin', deg: 135, cast: .18, spin: -.2, head: .25 }
  ];
  const WEAPON = { mage: 'staff', archer: 'bow', swordsman: 'swordShield', assassin: 'daggers' };
  const RING_R = 2.3, TORCH = [30, 150, 270].map(d => { const a = d * Math.PI / 180; return { x: Math.sin(a) * 10, z: Math.cos(a) * 10 }; });
  const EMB_N = IS_TOUCH ? 14 : (RM ? 12 : 40);
  const MIST_N = IS_TOUCH ? 6 : 9;
  const rr = (a, b) => a + (b - a) * Math.random();
  const dummy = new THREE.Object3D(), mN = new THREE.Matrix3(), vA = new THREE.Vector3(), vN = new THREE.Vector3();
  let active = false, group = null, saved = null, mistTex = null, mist = null, mistBase = [], emb = null, torchL = [], embT = 0;
  const CAM_YAW0 = .6;

  /* ---------- 角色烘焙 ---------- */
  // 節點與其所有祖先皆 visible 才算(Mage 的職業外型 Group 只有當前職業為 visible)
  function visibleChain(o, root) { for (let p = o; p; p = p.parent) { if (!p.visible) return false; if (p === root) break; } return true; }
  const newBucket = () => ({ p: [], n: [], c: [], i: [], nv: 0 });
  // 把一個 Mesh 的幾何(已套世界矩陣)併入桶;顏色取材質色(頂點色)
  function bakeMesh(o, bk) {
    const geo = o.geometry, pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index, cc = o.material.color, n = pos.count;
    mN.getNormalMatrix(o.matrixWorld);
    for (let k = 0; k < n; k++) {
      vA.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld); bk.p.push(vA.x, vA.y, vA.z);
      if (nor) { vN.fromBufferAttribute(nor, k).applyMatrix3(mN).normalize(); bk.n.push(vN.x, vN.y, vN.z); } else bk.n.push(0, 1, 0);
      bk.c.push(cc.r, cc.g, cc.b);
    }
    const m = idx ? idx.count : n;
    for (let k = 0; k < m; k++) bk.i.push((idx ? idx.getX(k) : k) + bk.nv);
    bk.nv += n;
  }
  function bakeTree(root, B) {
    root.updateMatrixWorld(true);
    root.traverse(o => { if (o.isMesh && visibleChain(o, root)) bakeMesh(o, B[(o.material.metalness || 0) > .3 ? 'metal' : 'matte']); });
  }
  function disposeTree(root) {
    root.traverse(o => { if (o.geometry && !o.isSprite) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  function bucketGeo(bk) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bk.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(bk.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(bk.c, 3));
    g.setIndex(new THREE.Uint32BufferAttribute(bk.i, 1));
    return g;
  }
  // 四職業各建一個 Mage → 設外型 / 武器 / 袍色 / 姿勢 → 烘焙進桶 → 立即 dispose(不留在場景)
  function bakeCharacters(elKey) {
    const B = { matte: newBucket(), metal: newBucket() };
    SLOTS.forEach((s, k) => {
      const a = s.deg * Math.PI / 180, x = Math.sin(a) * RING_R, z = Math.cos(a) * RING_R, C = CLASSES[s.cls];
      const m = new Mage(scene); scene.remove(m.root);
      m.setClassLook(s.cls); m.setWeapon(WEAPON[s.cls], true); m.setRobeColor(C.robe);
      if (s.cls === 'mage') m.setElementColor(EL[elKey].hex);
      m.shieldUp = s.shieldUp || 0; m.spinY = s.spin; m.yaw = Math.atan2(-x, -z); m.root.position.set(x, 0, z);
      m.update(0, { move: 0, cast: s.cast, kick: 0, charge: 0, t: k * 1.3, hover: 0, roll: -1, flip: -1, sit: 0, down: 0 });
      m.head.rotation.y = s.head;
      bakeTree(m.root, B);
      disposeTree(m.root);
    });
    return B;
  }

  /* ---------- 佈景 ---------- */
  // 實例化矩陣:位置、Y 軸旋轉、縮放
  function setInst(im, i, x, y, z, sx, sy, sz, ry) {
    dummy.position.set(x, y, z); dummy.rotation.set(0, ry || 0, 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
  }
  function buildEnv(g, rng) {
    const std = (color) => new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
    const rnd = (a, b) => a + (b - a) * rng();
    // 地面與站位圓台(2 draw)
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 40).rotateX(-Math.PI / 2), std(0x1c2a23));
    const pad = new THREE.Mesh(new THREE.CircleGeometry(4.6, 36).rotateX(-Math.PI / 2), std(0x33413a));
    pad.position.y = .01;
    g.add(ground, pad);
    // 剪影樹(幹 / 冠各 1 個實例化)與遠山(1 個實例化),大部分落在霧裡
    const T = 18, trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.2, .3, 1, 6).translate(0, .5, 0), std(0x0f1714), T);
    const canopy = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7, 1).translate(0, .5, 0), std(0x12241d), T);
    for (let i = 0; i < T; i++) {
      const a = (i + rnd(0, .6)) / T * TAU, r = rnd(15, 25), h = rnd(5, 9), x = Math.cos(a) * r, z = Math.sin(a) * r, cr = rnd(2.2, 3.4);
      setInst(trunks, i, x, 0, z, 1, h, 1, 0);
      setInst(canopy, i, x, h * .45, z, cr, h * .7, cr, 0);
    }
    const H = 14, hills = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 10, 1).translate(0, .5, 0), std(0x17262a), H);
    for (let i = 0; i < H; i++) { const a = i / H * TAU + rnd(-.1, .1), r = rnd(40, 48), s = rnd(9, 16); setInst(hills, i, Math.cos(a) * r, 0, Math.sin(a) * r, s, rnd(5, 10), s, 0); }
    [trunks, canopy, hills].forEach(im => { im.frustumCulled = false; im.instanceMatrix.needsUpdate = true; g.add(im); });
    // 火把:竹桿 + 火盆(2 個實例化)與火光光暈(3 個 sprite)
    const sticks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.06, .09, 1.6, 6).translate(0, .8, 0), std(0x3b2a1a), 3);
    const cups = new THREE.InstancedMesh(new THREE.CylinderGeometry(.17, .1, .22, 8).translate(0, 1.7, 0), std(0x2a1e14), 3);
    TORCH.forEach((p, k) => { setInst(sticks, k, p.x, 0, p.z, 1, 1, 1, 0); setInst(cups, k, p.x, 0, p.z, 1, 1, 1, 0); });
    [sticks, cups].forEach(im => { im.frustumCulled = false; im.instanceMatrix.needsUpdate = true; g.add(im); });
    TORCH.forEach(p => { const s = glowSprite(0xff8a2a, 2.2, .55); s.position.set(p.x, 1.9, p.z); g.add(s); });
    // 火星粒子(1 個 Points,CPU 更新位置與顏色)
    const eg = new THREE.BufferGeometry(), ePos = new Float32Array(EMB_N * 3), eCol = new Float32Array(EMB_N * 3), list = [];
    for (let i = 0; i < EMB_N; i++) list.push({ t: i % 3, age: 0, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });   // life 0 → 第一次更新即重生
    eg.setAttribute('position', new THREE.BufferAttribute(ePos, 3).setUsage(THREE.DynamicDrawUsage));
    eg.setAttribute('color', new THREE.BufferAttribute(eCol, 3).setUsage(THREE.DynamicDrawUsage));
    const pts = new THREE.Points(eg, new THREE.PointsMaterial({ size: IS_TOUCH ? .11 : .08, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false; g.add(pts);
    emb = { pts, ePos, eCol, list };
    // 霧片(billboard,每幀依相機姿態更新矩陣)
    mistTex = canvasTex(128, (q, s) => { const gr = q.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); q.fillStyle = gr; q.fillRect(0, 0, s, s); });
    mist = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: mistTex, color: 0x9fb2c4, transparent: true, opacity: .26, depthWrite: false }), MIST_N);
    mistBase = [];
    for (let i = 0; i < MIST_N; i++) { const a = i / MIST_N * TAU + rnd(-.3, .3), r = rnd(5, 14); mistBase.push({ x: Math.cos(a) * r, y: rnd(.6, 1.8), z: Math.sin(a) * r, s: rnd(6, 10), ph: rnd(0, TAU) }); }
    mist.frustumCulled = false; g.add(mist);
  }
  // 火星:從火把頂端冒出、往上飄、淡出後重生
  function stepEmbers(dt) {
    if (!emb) return;
    const { ePos, eCol, list, pts } = emb;
    list.forEach((p, i) => {
      p.age += dt;
      if (p.age >= p.life) {
        const tp = TORCH[p.t];
        p.age = 0; p.life = rr(1.1, 2.2);
        p.x = tp.x + rr(-.07, .07); p.y = 1.75 + rr(-.03, .05); p.z = tp.z + rr(-.07, .07);
        p.vx = rr(-.12, .12); p.vy = rr(.5, 1.1); p.vz = rr(-.12, .12);
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = 1 - p.age / p.life, j = i * 3;
      ePos[j] = p.x; ePos[j + 1] = p.y; ePos[j + 2] = p.z;
      eCol[j] = k; eCol[j + 1] = k * k * .7; eCol[j + 2] = k * k * .2;
    });
    pts.geometry.attributes.position.needsUpdate = true; pts.geometry.attributes.color.needsUpdate = true;
  }
  // 霧片:緩慢飄動,朝向相機
  function updateMist(t) {
    if (!mist) return;
    const w = t * .00035;
    mistBase.forEach((b, i) => {
      dummy.position.set(b.x + Math.sin(w + b.ph) * .7, b.y + Math.sin(w * 1.7 + b.ph) * .12, b.z + Math.cos(w + b.ph) * .7);
      dummy.quaternion.copy(camera.quaternion); dummy.scale.setScalar(b.s); dummy.updateMatrix(); mist.setMatrixAt(i, dummy.matrix);
    });
    mist.instanceMatrix.needsUpdate = true;
  }
  function disposeGroup(g) {
    g.traverse(o => { if (o.geometry && !o.isSprite) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }

  /* ---------- 進入 / 離開 / 每幀 ---------- */
  function start() {
    if (active) return;
    const elKey = EL[G.el] ? G.el : 'fire', g = new THREE.Group();
    g.name = 'coverBg';
    try {
      const B = bakeCharacters(elKey), mats = {
        matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: .05 }),
        metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .35, metalness: .55 })
      };
      ['matte', 'metal'].forEach(k => { const m = new THREE.Mesh(bucketGeo(B[k]), mats[k]); m.frustumCulled = false; g.add(m); });
      buildEnv(g, seedRng(20261110));
    } catch (e) {
      disposeGroup(g); if (mistTex) { mistTex.dispose(); mistTex = null; }
      throw e;
    }
    // 暫存目前狀態(stop 還原)
    const U = sky.material.uniforms;
    saved = {
      hide: [], lights: LIGHTS.slice(0, 3).map(L => ({ L, c: L.color.getHex(), i: L.intensity, d: L.distance })),
      player: { pos: mage.root.position.clone(), yaw: mage.yaw },
      fog: [scene.fog.color.getHex(), scene.fog.near, scene.fog.far],
      hemi: [hemi.color.getHex(), hemi.groundColor.getHex(), hemi.intensity],
      moon: [moonLight.color.getHex(), moonLight.intensity, moonLight.castShadow],
      sky: [U.uHor.value.clone(), U.uTop.value.clone(), U.uGnd.value.clone(), U.uSunCol.value.clone()], skyVis: sky.visible
    };
    // 隱藏場景內既有物件(含主角與關卡);天空與光源保留
    scene.children.forEach(c => { if (c.visible && c !== sky && !c.isLight) { saved.hide.push(c); c.visible = false; } });
    mage.root.position.set(0, 0, 0); mage.yaw = 0;   // 主角移到原點當相機錨點(隱藏中)
    scene.fog.color.setHex(0x1b2238); scene.fog.near = 13; scene.fog.far = 44;
    U.uHor.value.setRGB(.24, .2, .4); U.uTop.value.setRGB(.03, .05, .16); U.uGnd.value.setRGB(.12, .1, .2); U.uSunCol.value.setRGB(0, 0, 0);
    sky.visible = true;
    hemi.color.setHex(0x8a9bff); hemi.groundColor.setHex(0x2a2438); hemi.intensity = .75;
    moonLight.color.setHex(0xaab8ff); moonLight.intensity = .95; moonLight.castShadow = false;   // 封面不畫陰影(省 draw call)
    torchL = LIGHTS.slice(0, 3).map((L, k) => { L.color.setHex(0xff8a2a); L.position.set(TORCH[k].x, 1.9, TORCH[k].z); L.distance = 14; return L; });
    scene.add(g); group = g; active = true;
    G.camYaw = CAM_YAW0; embT = 0;
    stepEmbers(0); updateMist(performance.now());
  }
  function stop() {
    if (!active) return;
    active = false;
    scene.remove(group); disposeGroup(group); group = null;
    emb = null; mist = null; mistBase = []; torchL = [];
    if (mistTex) { mistTex.dispose(); mistTex = null; }
    const s = saved; saved = null;
    s.hide.forEach(c => { c.visible = true; });
    s.lights.forEach(o => { o.L.color.setHex(o.c); o.L.intensity = o.i; o.L.distance = o.d; });
    scene.fog.color.setHex(s.fog[0]); scene.fog.near = s.fog[1]; scene.fog.far = s.fog[2];
    const U = sky.material.uniforms;
    U.uHor.value.copy(s.sky[0]); U.uTop.value.copy(s.sky[1]); U.uGnd.value.copy(s.sky[2]); U.uSunCol.value.copy(s.sky[3]);
    sky.visible = s.skyVis;
    hemi.color.setHex(s.hemi[0]); hemi.groundColor.setHex(s.hemi[1]); hemi.intensity = s.hemi[2];
    moonLight.color.setHex(s.moon[0]); moonLight.intensity = s.moon[1]; moonLight.castShadow = s.moon[2];
    mage.root.position.copy(s.player.pos); mage.yaw = s.player.yaw;
  }
  // 每幀(cover.js 的封面迴圈呼叫):相機環繞、距離依螢幕寬高比(手機直式也能框到四人)、火光閃爍、粒子與霧
  function update(t, dt) {
    if (!active) return;
    if (!STILL) G.camYaw += dt * .12;
    G.camPitch = .2; G.lookX = 0; G.lookY = 0; G.skill = -1;
    const tanH = Math.tan(camera.fov * Math.PI / 360) * camera.aspect;
    G.zoom = Math.min(13, Math.max(6.5, 3.4 / tanH)) / CFG.camDist;
    const f = t * .001;
    torchL.forEach((L, k) => { L.intensity = 9 + 2 * Math.sin(f * 7.3 + k * 2.1) + Math.sin(f * 13.7 + k); });
    embT += dt;
    const step = IS_TOUCH ? .1 : 0;   // 手機 10 Hz 更新粒子與霧;桌機每幀
    if (embT >= step) { const d = embT; embT = 0; stepEmbers(RM ? d * .4 : d); updateMist(t); }
  }
  window.CoverBG = { start, stop, update, isActive: () => active };
})();
