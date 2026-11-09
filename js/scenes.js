'use strict';
// 可切換場景:月夜訓練場 / 羅馬競技場 / 宮廷訓練場 / 非洲叢林
// 場景只負責「看起來」與碰撞物;標靶與玩法不動。切換:N 鍵、上方按鈕、?scene=0~3
(function () {
  const TAU = Math.PI * 2, MOBILE = IS_TOUCH;
  let deco = null, cur = -1;
  const nightGround = ground.material.map;
  const _o = new THREE.Object3D(), _c = new THREE.Color();
  const mat = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: .92 }, o || {}));
  const add = (m, cast) => { m.castShadow = cast !== false; m.receiveShadow = true; deco.add(m); return m; };
  const mesh = (geo, material, x, y, z, cast) => { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); return add(m, cast); };
  const col = (x, z, r) => COLLIDERS.push({ x, z, r, deco: true });
  const pick = a => a[Math.floor(Math.random() * a.length)];
  // 標靶區(不要放裝飾)
  const clearOf = (x, z, m) => !(x > -22 - (m || 0) && x < 22 + (m || 0) && z > 0 - (m || 0) && z < 42 + (m || 0));
  // list 每項:[x,y,z,ry,sx,sy,sz,rx,rz,color]
  function inst(geo, material, list, cast, parent) {
    const im = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((a, i) => {
      _o.position.set(a[0], a[1], a[2]); _o.rotation.set(a[7] || 0, a[3] || 0, a[8] || 0);
      _o.scale.set(a[4] == null ? 1 : a[4], a[5] == null ? 1 : a[5], a[6] == null ? 1 : a[6]);
      _o.updateMatrix(); im.setMatrixAt(i, _o.matrix);
      if (a[9] != null) im.setColorAt(i, _c.set(a[9]));
    });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.frustumCulled = false;
    if (parent) { parent.add(im); im.castShadow = cast !== false; im.receiveShadow = true; return im; }
    return add(im, cast);
  }
  const faceCenter = (x, z) => Math.atan2(-x, -z);   // 平面法線朝向場中心
  const speck = (g, s, n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = Math.random() < .5 ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + a * 1.5 + ')'; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); } };
  function rep(t, x, y) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(x, y); t.anisotropy = 4; return t; }

  /* ---------- 貼圖 ---------- */
  const sandTex = () => rep(canvasTex(256, (g, s) => {
    g.fillStyle = '#cdb07a'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 500; i++) { g.fillStyle = Math.random() < .5 ? 'rgba(150,110,60,.07)' : 'rgba(255,240,200,.08)'; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, rnd(4, 16), 0, TAU); g.fill(); }
    speck(g, s, 3000, .06);
  }), 30, 30);
  const facadeTex = () => rep(canvasTex(256, (g, s) => {
    g.fillStyle = '#cdb88f'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 1800; i++) { g.fillStyle = Math.random() < .5 ? 'rgba(255,255,255,.05)' : 'rgba(70,50,20,.07)'; g.fillRect(Math.random() * s, Math.random() * s, 3, 2); }
    const rh = s / 3;
    for (let r = 0; r < 3; r++) {
      const y0 = r * rh;
      if (r === 0) { g.fillStyle = '#3a2f22'; [32, 96, 160, 224].forEach(x => g.fillRect(x - 9, y0 + 18, 18, 30)); }
      else {
        g.fillStyle = '#2b2218';
        [64, 192].forEach(cx => { g.beginPath(); g.moveTo(cx - 30, y0 + rh - 6); g.lineTo(cx - 30, y0 + 30); g.arc(cx, y0 + 30, 30, Math.PI, 0); g.lineTo(cx + 30, y0 + rh - 6); g.closePath(); g.fill(); });
      }
      g.fillStyle = 'rgba(70,50,25,.45)'; g.fillRect(0, y0 + rh - 5, s, 5);
    }
  }), 30, 1);
  const seatTex = () => rep(canvasTex(256, (g, s) => {
    g.fillStyle = '#d6c7a0'; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(90,70,40,.5)'; g.fillRect(0, 0, s, 6); g.fillRect(0, s / 2, s, 3);
    for (let i = 0; i < 8; i++) g.fillRect(i * 32, 0, 2, s);
    speck(g, s, 2000, .06);
  }), 22, 4);
  const brickTex = () => rep(canvasTex(256, (g, s) => {
    g.fillStyle = '#4d483f'; g.fillRect(0, 0, s, s);
    const bw = s / 4, bh = s / 8;
    for (let r = 0; r < 8; r++) for (let k = -1; k < 5; k++) {
      g.fillStyle = 'rgb(' + (122 + rnd(-14, 14)) + ',' + (115 + rnd(-14, 14)) + ',' + (102 + rnd(-14, 14)) + ')';
      g.fillRect(k * bw + (r % 2) * bw / 2 + 2, r * bh + 2, bw - 4, bh - 4);
    }
    speck(g, s, 1500, .05);
  }), 24, 1);
  const floorTex = () => rep(canvasTex(256, (g, s) => {
    const h = s / 2;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#4f4a42' : '#cfc3a3'; g.fillRect(i * h, j * h, h, h); }
    speck(g, s, 2500, .05);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3; g.strokeRect(0, 0, h, h); g.strokeRect(h, 0, h, h); g.strokeRect(0, h, h, h); g.strokeRect(h, h, h, h);
  }), 45, 45);
  const glassTex = () => canvasTex(128, (g, s) => {
    const gr = g.createLinearGradient(0, 0, 0, s); gr.addColorStop(0, '#dcecff'); gr.addColorStop(1, '#8fb2ee'); g.fillStyle = gr; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#33405a'; g.lineWidth = 4; for (let i = 0; i <= 3; i++) { g.beginPath(); g.moveTo(i * s / 3, 0); g.lineTo(i * s / 3, s); g.stroke(); }
    for (let i = 0; i <= 6; i++) { g.beginPath(); g.moveTo(0, i * s / 6); g.lineTo(s, i * s / 6); g.stroke(); }
  });
  const bannerTex = c => canvasTex(128, (g, s) => {
    g.fillStyle = c; g.fillRect(0, 0, s, s); g.strokeStyle = '#d9b14f'; g.lineWidth = 6; g.strokeRect(6, 6, s - 12, s - 12);
    g.fillStyle = '#d9b14f'; g.beginPath(); g.arc(s / 2, s / 2, 24, 0, TAU); g.fill(); g.fillStyle = c; g.beginPath(); g.arc(s / 2, s / 2, 12, 0, TAU); g.fill();
  });
  const jungleTex = () => rep(canvasTex(256, (g, s) => {
    g.fillStyle = '#4d3d24'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 420; i++) { g.fillStyle = pick(['rgba(60,110,40,.22)', 'rgba(30,20,10,.18)', 'rgba(130,90,40,.2)']); g.beginPath(); g.arc(Math.random() * s, Math.random() * s, rnd(3, 14), 0, TAU); g.fill(); }
    speck(g, s, 3000, .06);
  }), 30, 30);

  /* ---------- 場景 ---------- */
  function stoneBraz(x, z) {
    mesh(new THREE.CylinderGeometry(.5, .7, 2.2, 8), mat(0x777c92), x, 1.1, z);
    col(x, z, .8); BRAZIERS.push({ x, y: 2.3, z });
  }
  function buildNight() {
    const pm = mat(0x6a6f85);
    for (let i = 0; i < 28; i++) {
      const a = i / 28 * TAU, h = rnd(3, 5.5), m = mesh(new THREE.BoxGeometry(1.4, h, 1.4), pm, Math.cos(a) * 56, h / 2, Math.sin(a) * 56); m.rotation.y = rnd(0, 3);
    }
    for (let i = 0; i < 70; i++) {
      const a = rnd(0, TAU), r = rnd(62, 95), g = new THREE.Group(), h = rnd(5, 9);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.3, .4, 2, 6), new THREE.MeshStandardMaterial({ color: 0x4a3322 })); trunk.position.y = 1; g.add(trunk);
      for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry(2.4 - k * .5, h / 2.2, 8), new THREE.MeshStandardMaterial({ color: 0x1e3a33, roughness: 1 })); c.position.y = 2.6 + k * h / 4; g.add(c); }
      g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); deco.add(g);
    }
    [[-18, -6], [20, -10], [-24, 18], [26, 14], [0, 36], [-20, -24], [24, -28]].forEach(p => stoneBraz(p[0], p[1]));
  }

  function buildColosseum() {
    mesh(new THREE.CylinderGeometry(56, 56, 3.2, 64, 1, true), mat(0xbfa982, { side: THREE.BackSide }), 0, 1.6, 0, false);
    mesh(new THREE.CylinderGeometry(70, 56, 10, 64, 1, true), mat(0xffffff, { map: seatTex(), side: THREE.DoubleSide }), 0, 8.2, 0, false);
    mesh(new THREE.CylinderGeometry(70, 70, 28, 64, 1, true), mat(0xffffff, { map: facadeTex(), side: THREE.BackSide }), 0, 14, 0, false);
    // 地面環紋
    [[46.5, 47.3, 2.2, 2 * Math.PI - 1.15], [9, 9.6]].forEach(r => { const m = new THREE.Mesh(new THREE.RingGeometry(r[0], r[1], 64, 1, r[2] || 0, r[3] || 2 * Math.PI), new THREE.MeshBasicMaterial({ color: 0x8a6a3a, transparent: true, opacity: .5, fog: true })); m.rotation.x = -Math.PI / 2; m.position.y = .03; deco.add(m); });
    // 閘門
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + .5, x = Math.cos(a) * 55.6, z = Math.sin(a) * 55.6; const m = mesh(new THREE.BoxGeometry(7, 4.4, .6), mat(0x241a12), x, 2.2, z, false); m.rotation.y = faceCenter(x, z); }
    // 青銅火盆
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + .2, x = Math.cos(a) * 54, z = Math.sin(a) * 54;
      mesh(new THREE.CylinderGeometry(.12, .2, 2, 6), mat(0x6b4f2a, { metalness: .5 }), x, 1, z);
      mesh(new THREE.CylinderGeometry(.6, .35, .5, 10), mat(0x8a6a2a, { metalness: .6 }), x, 2.2, z);
      BRAZIERS.push({ x, y: 2.5, z });
    }
    // 殘破石柱
    [[-30, -12], [30, -14], [-38, 10], [40, 12], [-34, -30], [34, -30], [-44, -22], [44, -24], [-26, -44]].forEach(p => {
      const h = rnd(2, 5.5);
      mesh(new THREE.BoxGeometry(2.6, .6, 2.6), mat(0xd2c29a), p[0], .3, p[1]);
      mesh(new THREE.CylinderGeometry(.85, 1, h, 14), mat(0xd9caa0), p[0], .6 + h / 2, p[1]);
      col(p[0], p[1], 1.2);
    });
  }

  function buildHall() {
    mesh(new THREE.CylinderGeometry(60, 60, 24, 64, 1, true), mat(0xbbbbbb, { map: brickTex(), side: THREE.BackSide }), 0, 12, 0, false);
    const ceil = mesh(new THREE.CircleGeometry(60, 48), mat(0x2b1e15), 0, 24, 0, false); ceil.rotation.x = Math.PI / 2;
    const beamM = mat(0x1d140d);
    for (let i = 0; i < 8; i++) { const b = mesh(new THREE.BoxGeometry(118, .9, 1.2), beamM, 0, 23.4, 0, false); b.rotation.y = i * Math.PI / 8; }
    // 地毯
    const carpet = mesh(new THREE.PlaneGeometry(7, 72), mat(0x7a1a22), 0, .03, 16, false); carpet.rotation.x = -Math.PI / 2;
    [-3.1, 3.1].forEach(x => { const s = mesh(new THREE.PlaneGeometry(.35, 72), mat(0xc9a24a), x, .04, 16, false); s.rotation.x = -Math.PI / 2; });
    // 柱子(實例化)
    const sh = [], bs = [], cp = [];
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * TAU, x = Math.cos(a) * 56, z = Math.sin(a) * 56;
      sh.push([x, 11, z]); bs.push([x, .5, z, -a]); cp.push([x, 22.6, z, -a]);
    }
    inst(new THREE.CylinderGeometry(1.1, 1.2, 22, 14), mat(0xcfc5ad), sh);
    inst(new THREE.BoxGeometry(3, 1, 3), mat(0xb5aa90), bs);
    inst(new THREE.BoxGeometry(3, 1.2, 3), mat(0xb5aa90), cp);
    // 窗與旗幟(柱間)
    const gm = new THREE.MeshBasicMaterial({ map: glassTex() }), bA = mat(0xffffff, { map: bannerTex('#8a1a2a'), side: THREE.DoubleSide }), bB = mat(0xffffff, { map: bannerTex('#1d3a7a'), side: THREE.DoubleSide });
    for (let i = 0; i < 20; i++) {
      const a = (i + .5) / 20 * TAU, x = Math.cos(a) * 59.3, z = Math.sin(a) * 59.3;
      if (i % 2 === 0) { const w = mesh(new THREE.PlaneGeometry(5, 12), gm, x, 12.5, z, false); w.rotation.y = faceCenter(x, z); }
      else { const b = mesh(new THREE.PlaneGeometry(3.4, 10), (i % 4 === 1) ? bA : bB, x * .995, 13, z * .995, false); b.rotation.y = faceCenter(x, z); }
    }
    // 壁火把
    for (let i = 0; i < 20; i += 2) {
      const a = i / 20 * TAU, x = Math.cos(a) * 54.3, z = Math.sin(a) * 54.3;
      mesh(new THREE.CylinderGeometry(.1, .15, 1, 6), mat(0x3a2a1a), x, 3.7, z, false);
      mesh(new THREE.CylinderGeometry(.35, .2, .35, 8), mat(0x6b5a2a, { metalness: .5 }), x, 4.3, z, false);
      BRAZIERS.push({ x, y: 4.6, z });
    }
    // 吊燈
    [[0, 0], [-28, -10], [28, -10]].forEach(p => {
      mesh(new THREE.CylinderGeometry(.06, .06, 8, 4), mat(0x222222), p[0], 20, p[1], false);
      const ring = mesh(new THREE.TorusGeometry(3, .15, 6, 20), mat(0x8a6a2a, { metalness: .6 }), p[0], 16, p[1], false); ring.rotation.x = Math.PI / 2;
      for (let k = 0; k < 8; k++) { const s = glowSprite(0xffc070, 1.6, .9); s.position.set(p[0] + Math.cos(k / 8 * TAU) * 3, 16.6, p[1] + Math.sin(k / 8 * TAU) * 3); deco.add(s); }
    });
    // 訓練木樁 / 兵器架 / 乾草
    const wood = mat(0x7a5230);
    [[-34, 4], [34, 4], [-40, 20], [40, 20], [-30, -26], [30, -26]].forEach(p => {
      mesh(new THREE.CylinderGeometry(.35, .4, 2.2, 8), wood, p[0], 1.1, p[1]); mesh(new THREE.BoxGeometry(1.4, .18, .18), wood, p[0], 1.6, p[1]); col(p[0], p[1], .6);
    });
    [[-46, 8, 1.2], [46, 8, 1.8], [-30, -40, 0], [30, -40, 0]].forEach(p => {
      const r = mesh(new THREE.BoxGeometry(3.4, 1.8, .5), wood, p[0], .9, p[1]); r.rotation.y = p[2];
      for (let k = 0; k < 4; k++) { const s = mesh(new THREE.BoxGeometry(.1, 2.2, .1), mat(0x9aa0b0, { metalness: .7, roughness: .4 }), p[0] + (k - 1.5) * .7 * Math.cos(p[2]), 1.5, p[1] - (k - 1.5) * .7 * Math.sin(p[2]), false); s.rotation.z = .15; }
      col(p[0], p[1], 1.8);
    });
    for (let i = 0; i < 6; i++) { const x = pick([-1, 1]) * rnd(26, 46), z = rnd(-30, 44); if (!clearOf(x, z, 2) || nearPlatform(x, z, 2) || !terrainFlat(x, z, 2)) continue; const m = mesh(new THREE.CylinderGeometry(.9, .9, 1.2, 12), mat(0xc2a45a), x, .6, z); m.rotation.z = Math.PI / 2; m.rotation.y = rnd(0, 3); col(x, z, 1.1); }
  }

  function buildJungle() {
    const DARK = [0x1f3f1a, 0x25491f, 0x2b5423], MID = [0x3c6e2e, 0x4a7d34, 0x35612a], LIGHT = [0x5f8f3a, 0x6f9a40, 0x7aa84a];
    const trunks = [], canopies = [], vines = [];
    const nTree = MOBILE ? 90 : 150;
    for (let i = 0; i < nTree; i++) {
      const far = i >= nTree * .55, a = rnd(0, TAU), r = far ? rnd(68, 115) : rnd(57, 68), x = Math.cos(a) * r, z = Math.sin(a) * r, kind = Math.random(), S = far ? 1.3 : 1;
      if (kind < .55) {
        // 闊葉樹:粗樹幹 + 四層樹冠(下層深、上層淺,底部偏暗)
        const h = rnd(11, 20) * S, tr = rnd(.75, 1.05) * S;
        trunks.push([x, h / 2, z, 0, tr, h, tr, 0, 0, 0x5a4330]);
        const layers = [pick(DARK), pick(DARK), pick(MID), pick(LIGHT)];
        for (let k = 0; k < 4; k++) {
          const cr = rnd(4.5, 6) * S * (1 - k * .15);
          canopies.push([x + rnd(-1.6, 1.6), h - 3.5 + k * 1.6 + rnd(-.4, .4), z + rnd(-1.6, 1.6), 0, cr, cr * .72, cr, 0, 0, layers[k]]);
        }
        if (Math.random() < .5) { const L = rnd(5, 8); vines.push([x + rnd(-2, 2), h - 3 - L / 2, z + rnd(-2, 2), 0, 1, L, 1, 0, 0, 0x2c4a22]); }
      } else if (kind < .85) {
        // 傘形金合歡:看得見的細長樹幹 + 加厚的扁平傘冠
        const h = rnd(6, 9) * S, tr = rnd(.5, .62) * S;
        trunks.push([x, h / 2, z, 0, tr, h, tr, 0, 0, 0x6a5238]);
        canopies.push([x, h + .2, z, 0, rnd(6, 7.5) * S, 1.6 * S, rnd(6, 7.5) * S, 0, 0, pick(MID)]);
        canopies.push([x + rnd(-1, 1), h + 1.4, z + rnd(-1, 1), 0, rnd(4, 5) * S, 1.2 * S, rnd(4, 5) * S, 0, 0, pick(LIGHT)]);
      } else {
        // 猴麵包樹:粗壯樹幹 + 幾團厚實樹冠
        const h = rnd(8, 11) * S, tr = rnd(2.3, 2.8) * S;
        trunks.push([x, h / 2, z, 0, tr, h, tr, 0, 0, 0x7a6a55]);
        for (let k = 0; k < 4; k++) canopies.push([x + rnd(-2.2, 2.2), h + rnd(-.5, 1), z + rnd(-2.2, 2.2), 0, rnd(2.4, 3.2) * S, rnd(1.6, 2.2) * S, rnd(2.4, 3.2) * S, 0, 0, pick(k < 2 ? DARK : MID)]);
      }
    }
    inst(new THREE.CylinderGeometry(.7, 1, 1, 8), mat(0xffffff), trunks);
    inst(new THREE.IcosahedronGeometry(1, 1), mat(0xffffff, { roughness: 1 }), canopies);
    if (vines.length) inst(new THREE.CylinderGeometry(.06, .06, 1, 4), mat(0xffffff), vines, false);
    // 草叢
    const grass = [], nG = MOBILE ? 260 : 600;
    for (let i = 0, t = 0; i < nG && t < nG * 3; t++) {
      const a = rnd(0, TAU), r = rnd(7, 54), x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!clearOf(x, z, 1.5) || nearPlatform(x, z, .5)) continue; i++;
      for (let k = 0; k < 3; k++) { const sy = rnd(.6, 1.3); grass.push([x + rnd(-.3, .3), terrainH(x, z) + sy / 2, z + rnd(-.3, .3), rnd(0, 3), 1, sy, 1, rnd(-.25, .25), rnd(-.25, .25), pick([0x5f8f3a, 0x7a9a40, 0x4a7a2a])]); }
    }
    inst(new THREE.ConeGeometry(.18, 1, 4), mat(0xffffff, { roughness: 1 }), grass, false);
    // 低矮灌木與落葉色塊(增加地面層次)
    const shrubs = [], litter = [], nS = MOBILE ? 50 : 130;
    for (let i = 0, t = 0; i < nS && t < nS * 3; t++) {
      const a = rnd(0, TAU), r = rnd(9, 56), x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!clearOf(x, z, 2) || nearPlatform(x, z, 1.5)) continue; i++;
      const s = rnd(1, 2);
      shrubs.push([x, terrainH(x, z) + s * .35, z, rnd(0, 3), s, s * rnd(.6, .8), s * rnd(.9, 1.1), 0, 0, pick(DARK.concat(MID))]);
      if (Math.random() < .6) { const lx = x + rnd(-1.5, 1.5), lz = z + rnd(-1.5, 1.5); if (terrainFlat(lx, lz, 1.5)) litter.push([lx, .03, lz, rnd(0, 3), rnd(1, 2.2), rnd(1, 2.2), 1, -Math.PI / 2, 0, pick([0x8a6a2e, 0x6b4e22, 0x9a7a3a])]); }
    }
    inst(new THREE.IcosahedronGeometry(1, 0), mat(0xffffff, { roughness: 1 }), shrubs);
    inst(new THREE.CircleGeometry(1, 7), mat(0xffffff, { roughness: 1 }), litter, false);
    // 岩石
    for (let i = 0, t = 0; i < 12 && t < 100; t++) {
      const a = rnd(0, TAU), r = rnd(24, 50), x = Math.cos(a) * r, z = Math.sin(a) * r; if (!clearOf(x, z, 3) || nearPlatform(x, z, 3) || !terrainFlat(x, z, 3)) continue; i++;
      const s = rnd(1.2, 3), m = mesh(new THREE.DodecahedronGeometry(1, 0), mat(0x6f6a5c), x, s * .5, z); m.scale.set(s, s * .7, s * rnd(.8, 1.2)); m.rotation.y = rnd(0, 3); if (s > 1.8) col(x, z, s * .9);
    }
    // 石圖騰
    for (let i = 0, t = 0; i < 4 && t < 100; t++) {
      const a = rnd(0, TAU), r = rnd(36, 48), x = Math.cos(a) * r, z = Math.sin(a) * r; if (!clearOf(x, z, 3) || nearPlatform(x, z, 3) || !terrainFlat(x, z, 3)) continue; i++;
      const sm = mat(0x7d7868), dk = mat(0x1d1a14);
      [[2.2, 1.2], [1.7, 1.2], [1.3, 1.1]].forEach((b, k) => { const y = 0.6 + k * 1.2 + (k > 0 ? 0 : 0); const m = mesh(new THREE.BoxGeometry(b[0], b[1], b[0]), sm, x, y, z); m.rotation.y = k * .3; mesh(new THREE.BoxGeometry(.3, .25, .1), dk, x - .35, y + .1, z + b[0] / 2 + .01, false).rotation.y = k * .3; });
      col(x, z, 1.4);
    }
    // 竹火把
    for (let i = 0, t = 0; i < 8 && t < 200; t++) {
      const a = rnd(0, TAU), r = rnd(28, 48), x = Math.cos(a) * r, z = Math.sin(a) * r; if (!clearOf(x, z, 3) || nearPlatform(x, z, 3) || !terrainFlat(x, z, 3)) continue; i++;
      mesh(new THREE.CylinderGeometry(.1, .15, 2.6, 6), mat(0x6b4a2a), x, 1.3, z);
      mesh(new THREE.CylinderGeometry(.35, .18, .35, 8), mat(0x3a2a18), x, 2.7, z, false);
      col(x, z, .4); BRAZIERS.push({ x, y: 2.9, z });
    }
  }

  // 南側地形組(四個場景共用):山頂 A、台地 B、山谷 V;吊橋與山頂旗依場景另給
  const SOUTH_T = [['hill', -11, -38, 3, 10, 5], ['hill', 13, -38, 5, 3, 5], ['trench', 0, -30, 0, -40, 3, 3.5, 9, -4]];
  const SOUTH_BR = (sag, style) => [[-8.6, -38, 8.6, -38, 5.05, .8, sag, style]];
  const SCENES = [
    { name: '月夜訓練場', build: buildNight, terrain: [...SOUTH_T, ['hill', 42, 20, 2, 7, 2.5]], terrainLook: { cliff: 0x6a6f85, dark: .35 }, bridges: SOUTH_BR(.5, 'rope'), bridgeCol: [0x5a4632, 0xb8a070], bridgeGlow: 0x9fd0ff, summit: [-11, -38, 5, 0x9fd0ff], ground: () => nightGround, gtint: 0xffffff, fog: [0x3d3466, 50, 160], hor: [.24, .2, .4], top: [.03, .05, .16], gnd: [.12, .1, .2], sunCol: [0, 0, 0], stars: true, clear: 0x000000, hemi: [0x8a9bff, 0x2a2438, .75], dir: [0xaab8ff, .95], sun: [-20, 40, 15], plats: [['box', 0, -16, 2, 2, 1.2, 0], ['box', -28, -10, 3, 3, 3.5, 0], ['box', -29.5, -11.5, 1.5, 1.5, 7, 0], ['cyl', 28, -14, 2.5, 3.5]], platCol: 0x454a62, platTrim: 0xb8c0ea },
    { name: '羅馬競技場', build: buildColosseum, terrain: SOUTH_T, terrainLook: { cliff: 0xa08a64, dark: .3 }, bridges: SOUTH_BR(.12, 'wood'), bridgeCol: [0x8a6a3a, 0x6b4f2a], summit: [-11, -38, 5, 0xb0302a], ground: sandTex, gtint: 0x8f8670, fog: [0xe2d6bc, 90, 260], hor: [.78, .84, .9], top: [.25, .5, .85], gnd: [.7, .65, .55], sunCol: [.4, .3, .16], bt: .96, bk: .45, clear: 0xd8e4f0, hemi: [0xcfe0ff, 0xb89d70, .55], dir: [0xfff1d6, .8], sun: [-20, 40, 15], plats: [['box', 0, -16, 2, 2, 1.2, 0], ['box', -24, -24, 3, 3, 3.5, 0], ['box', -25.5, -25.5, 1.5, 1.5, 7, 0], ['cyl', 24, -26, 2.5, 3.5]], platCol: 0x6e6049, platTrim: 0xf6ecd0 },
    { name: '宮廷訓練場', build: buildHall, terrain: SOUTH_T, terrainLook: { cliff: 0x5a5248, dark: .3 }, bridges: SOUTH_BR(.1, 'wood'), bridgeCol: [0x5a3a22, 0xc9a24a], summit: [-11, -38, 5, 0xc9a24a], ground: floorTex, gtint: 0x8a8478, fog: [0x1a140e, 70, 220], indoor: true, bt: .92, bk: .6, hor: [0, 0, 0], top: [0, 0, 0], gnd: [0, 0, 0], sunCol: [0, 0, 0], clear: 0x1a140e, hemi: [0xc9b894, 0x5a4632, .7], dir: [0xcfd8ff, .55], sun: [-20, 40, 15], plats: [['box', 0, -16, 2, 2, 1.2, 0], ['box', -38, -12, 3, 3, 3.5, 0], ['box', -39.5, -13.5, 1.5, 1.5, 7, 0], ['cyl', 38, -12, 2.5, 3.5]], platCol: 0x6a4424, platTrim: 0xe0b85a },
    { name: '非洲叢林', build: buildJungle, terrain: [...SOUTH_T, ['hill', -42, 18, 2, 8, 3]], terrainLook: { cliff: 0x8a4a2a, dark: .35 }, bridges: SOUTH_BR(.7, 'rope'), bridgeCol: [0x7a5a32, 0x3c5a22], summit: [-11, -38, 5, 0xd86a2a], ground: jungleTex, gtint: 0xffffff, fog: [0x7a8450, 35, 135], hor: [.85, .72, .5], top: [.25, .5, .55], gnd: [.2, .25, .15], sunCol: [.45, .28, .12], bt: .93, bk: .55, clear: 0x7a8450, hemi: [0xa8d890, 0x3a3018, .85], dir: [0xffd9a0, 1.0], sun: [-32, 24, 22], plats: [['box', 0, -16, 2, 2, 1.2, 0], ['box', -28, -12, 3, 3, 3.5, 0], ['box', -29.5, -13.5, 1.5, 1.5, 7, 0], ['cyl', 28, -14, 2.5, 3.5]], platCol: 0x7d7868, platTrim: 0xb3ad94 }
  ];

  // 可站立高台:box [kind,x,z,hx,hz,top,yaw] / cyl [kind,x,z,r,top]
  function buildPlats(S) {
    const pm = mat(S.platCol), tm = mat(S.platTrim);
    S.plats.forEach(e => {
      if (e[0] === 'box') {
        const x = e[1], z = e[2], hx = e[3], hz = e[4], top = e[5], yaw = e[6];
        mesh(new THREE.BoxGeometry(hx * 2, top, hz * 2), pm, x, top / 2, z).rotation.y = yaw;
        mesh(new THREE.BoxGeometry(hx * 2 + .3, .16, hz * 2 + .3), tm, x, top, z, false).rotation.y = yaw;
        addPlatform({ kind: 'box', x, z, hx, hz, top, yaw, deco: true });
      } else {
        const x = e[1], z = e[2], r = e[3], top = e[4];
        mesh(new THREE.CylinderGeometry(r, r * 1.05, top, 20), pm, x, top / 2, z);
        mesh(new THREE.CylinderGeometry(r + .15, r + .15, .16, 20), tm, x, top, z, false);
        addPlatform({ kind: 'cyl', x, z, r, top, deco: true });
      }
    });
  }

  // 吊橋:[x0,z0,x1,z1,top,hw,sag,style];橋面是 bridge 平台,外觀全部放在同一個 Group(本地座標,之後可整組擺動)
  function buildBridges(S) {
    (S.bridges || []).forEach(b => {
      const [x0, z0, x1, z1, top, hw, sag, style] = b;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L, yaw = Math.atan2(-uz, ux), H = L / 2;
      addPlatform({ kind: 'bridge', x: cx, z: cz, hx: H, hz: hw, yaw, top, sag, bottom: top - sag - .35, deco: true });
      const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = yaw; deco.add(g);
      const ty = lx => top - sag * (1 - (lx / H) * (lx / H));
      const wood = style === 'wood', rr = wood ? .06 : .03, rc = S.bridgeCol[1];
      // 木板(1 個 draw call)
      const n = Math.round(L / .4), planks = [];
      for (let i = 0; i < n; i++) { const lx = -H + (i + .5) * L / n; planks.push([lx, ty(lx) - .04, 0, 0, null, null, null, 0, style === 'rope' ? rnd(-.03, .03) : 0]); }
      inst(new THREE.BoxGeometry(.32, .08, hw * 2), mat(S.bridgeCol[0]), planks, true, g);
      // 繩 / 扶手:兩側各一條橋面邊繩與一條扶手,各 16 段(1 個 draw call)
      const segs = [];
      [-1, 1].forEach(sd => {
        const lz = sd * (hw + .02);
        [[-.02, 0], [1.0, .15]].forEach(([dy, droop]) => {
          const yAt = lx => { const u = lx / H; return ty(lx) + dy - droop * (1 - u * u); };
          for (let k = 0; k < 16; k++) {
            const xa = -H + 2 * H * k / 16, xb = -H + 2 * H * (k + 1) / 16;
            const ya = yAt(xa), yb = yAt(xb), dxs = xb - xa, dys = yb - ya, len = Math.hypot(dxs, dys);
            segs.push([(xa + xb) / 2, (ya + yb) / 2, lz, 0, rr, len, rr, 0, Math.atan2(dys, dxs) - Math.PI / 2]);
          }
        });
      });
      inst(new THREE.CylinderGeometry(1, 1, 1, 4), mat(rc), segs, false, g);
      // 木橋扶手立柱:每 2 m 一根、兩側(1 個 draw call)
      if (wood) {
        const posts = [];
        for (let lx = -H + 1; lx <= H - 1; lx += 2) [-1, 1].forEach(sd => posts.push([lx, ty(lx) + .5, sd * (hw + .02), 0, null, null, null, 0, 0]));
        inst(new THREE.BoxGeometry(.08, 1, .08), mat(rc), posts, true, g);
      }
      // 橋柱:兩端四根;月夜另加柱頂光點
      const pm = mat(S.bridgeCol[0]);
      [-1, 1].forEach(sx => [-1, 1].forEach(sz => {
        const lx = sx * (H - .4), lz = sz * (hw - .1), p = new THREE.Mesh(new THREE.CylinderGeometry(.12, .14, 1.4, 6), pm);
        p.position.set(lx, top + .6, lz); p.castShadow = true; g.add(p);
        if (S.bridgeGlow != null) { const s = glowSprite(S.bridgeGlow, 1.2, .8); s.position.set(lx, top + 1.4, lz); g.add(s); }
      }));
    });
  }
  // 山頂旗:[x, z, top, flagHex]
  function buildSummit(S) {
    if (!S.summit) return;
    const [x, z, top, hex] = S.summit;
    mesh(new THREE.CylinderGeometry(.06, .08, 3, 6), mat(0x6a5a4a), x, top + 1.5, z);
    mesh(new THREE.PlaneGeometry(1.4, .8), mat(hex, { side: THREE.DoubleSide }), x + .72, top + 2.6, z);
  }

  function clearDeco() {
    if (!deco) return;
    scene.remove(deco);
    deco.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map && m.map !== nightGround) m.map.dispose(); m.dispose(); });
    });
    deco = null;
    for (let i = COLLIDERS.length - 1; i >= 0; i--) if (COLLIDERS[i].deco) COLLIDERS.splice(i, 1);
    for (let i = PLATFORMS.length - 1; i >= 0; i--) if (PLATFORMS[i].deco) PLATFORMS.splice(i, 1);
    BRAZIERS.length = 0;
  }
  let groundTex = null;
  const loadEl = document.createElement('div'); loadEl.id = 'sceneLoading'; loadEl.textContent = '載入場景…';
  loadEl.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(8,10,24,.78);color:#ffe3b0;font-size:22px;z-index:20;pointer-events:none';
  document.body.appendChild(loadEl);
  let loading = false;
  function setScene(i, now) {
    i = ((i % SCENES.length) + SCENES.length) % SCENES.length;
    if (loading) return;
    if (now || cur < 0) return buildScene(i);
    loading = true; clearDeco(); loadEl.style.display = 'flex';
    setTimeout(() => { try { buildScene(i); } finally { loading = false; loadEl.style.display = 'none'; } }, 60);
  }
  // 泛光依場景調整(白天場景門檻高、強度低,避免畫面被洗白);泛光物件在 game.js 才建立,所以載入後也要再套一次
  function applyBloomScene() {
    const S = SCENES[cur < 0 ? 0 : cur]; window.BLOOMK = S.bk == null ? 1 : S.bk;
    if (typeof bloom !== 'undefined' && bloom) bloom.threshold = S.bt == null ? .78 : S.bt;
  }
  function buildScene(i) {
    const S = SCENES[i];
    if (typeof clearSummons === 'function') clearSummons();
    clearDeco();
    if (groundTex && groundTex !== nightGround) groundTex.dispose();
    scene.fog.color.setHex(S.fog[0]); scene.fog.near = S.fog[1]; scene.fog.far = S.fog[2];
    sky.visible = !S.indoor; renderer.setClearColor(S.clear);
    const u = sky.material.uniforms;
    u.uHor.value.setRGB(S.hor[0], S.hor[1], S.hor[2]); u.uTop.value.setRGB(S.top[0], S.top[1], S.top[2]); u.uGnd.value.setRGB(S.gnd[0], S.gnd[1], S.gnd[2]);
    u.uSunCol.value.setRGB(S.sunCol[0], S.sunCol[1], S.sunCol[2]); u.uSunDir.value.set(S.sun[0], S.sun[1], S.sun[2]).normalize();
    skyStars.visible = skyMoon.visible = !!S.stars;
    hemi.color.setHex(S.hemi[0]); hemi.groundColor.setHex(S.hemi[1]); hemi.intensity = S.hemi[2];
    moonLight.color.setHex(S.dir[0]); moonLight.intensity = S.dir[1];
    window.SUNOFF.x = S.sun[0]; window.SUNOFF.y = S.sun[1]; window.SUNOFF.z = S.sun[2];
    groundTex = S.ground(); ground.material.map = groundTex; ground.material.color.setHex(S.gtint == null ? 0xffffff : S.gtint); ground.material.needsUpdate = true;
    deco = new THREE.Group(); scene.add(deco);
    setTerrain(FLAT ? [] : S.terrain, S.terrainLook);
    buildPlats(S);
    if (!FLAT) { buildBridges(S); buildSummit(S); }
    S.build();
    checkTerrain();
    cur = i;
    applyBloomScene();
    SCORCH.forEach(s => { scene.remove(s.m); s.m.material.dispose(); }); SCORCH.length = 0;
    [...document.querySelectorAll('#sceneBar button')].forEach((b, k) => b.classList.toggle('on', k === i));
    try { localStorage.setItem('mageSandbox.scene', i); } catch (e) { }
    if (window.banner && window.G) window.banner(S.name, '#ffe3b0');
  }
  window.SUNOFF = { x: -20, y: 40, z: 15 };
  window.setScene = setScene;
  window.nextScene = () => { if (window.NETON) return; setScene(cur + 1); };   // 多人對戰中停用換場(設計 §5-6)
  window.getSceneIndex = () => cur;   // 多人:對戰開始時比對場地、再來一局換場用(remote.js / netcombat.js)

  // 場景按鈕
  const bar = document.createElement('div'); bar.id = 'sceneBar';
  SCENES.forEach((s, k) => { const b = document.createElement('button'); b.textContent = s.name; b.onclick = () => setScene(k); bar.appendChild(b); });
  document.body.appendChild(bar);
  addEventListener('keydown', e => { if (window.COVER_ON || window.NETON) return; if (e.code === 'KeyN' && !e.ctrlKey && !e.repeat && e.target.tagName !== 'INPUT') setScene(cur + 1); });

  // ---- 畫質:0 低 / 1 中 / 2 高(存 localStorage mageSandbox.q)----
  const QN = ['低', '中', '高'];
  const _raf = window.requestAnimationFrame.bind(window); let _lastT = 0, _minDt = 0;
  window.requestAnimationFrame = cb => _raf(function f(t) { if (_minDt && t - _lastT < _minDt - 1) return _raf(f); _lastT = t; cb(t); });
  let quality = 1;
  try { const v = localStorage.getItem('mageSandbox.q'); if (v != null && +v >= 0 && +v <= 2) quality = +v; } catch (e) { }
  const qBtn = document.createElement('button'); qBtn.id = 'qBtn'; bar.appendChild(qBtn);
  function applyQuality() {
    qBtn.textContent = '畫質:' + QN[quality];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, [1, 1.25, IS_TOUCH ? 1.5 : 2][quality]));
    moonLight.castShadow = quality > 0;
    const ms = [512, 1024, IS_TOUCH ? 1024 : 2048][quality];
    if (moonLight.shadow.mapSize.x !== ms) { moonLight.shadow.mapSize.set(ms, ms); if (moonLight.shadow.map) { moonLight.shadow.map.dispose(); moonLight.shadow.map = null; } }
    if (window.CFG) CFG.bloom = quality === 2;   // 泛光只在「高」開(最吃 GPU)
    window.SHADOWN = [0, 2, 1][quality];          // 陰影重畫頻率:低=不畫、中=隔格、高=每格
    _minDt = quality === 0 ? 33 : 16;             // 幀率上限:低 30、中高 60(高更新率螢幕也不超過 60)
    if (window.onResize) onResize();
    applyBloomScene();
    try { localStorage.setItem('mageSandbox.q', quality); } catch (e) { }
  }
  qBtn.onclick = () => { quality = (quality + 1) % 3; applyQuality(); };
  addEventListener('load', applyQuality);

  let start = 0;
  try { const q = /[?&]scene=(\d)/.exec(location.search); start = q ? +q[1] : (+localStorage.getItem('mageSandbox.scene') || 0); } catch (e) { }
  setScene(start);
})();
