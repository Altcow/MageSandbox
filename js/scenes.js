'use strict';
// 可切換場景:月夜訓練場 / 非洲叢林
// 場景只負責「看起來」與碰撞物;標靶與玩法不動。切換:N 鍵、上方按鈕、?scene=0~1
(function () {
  const TAU = Math.PI * 2, MOBILE = IS_TOUCH;
  let deco = null, cur = -1, fogState = null, fogK = 0;   // fogState:叢林霧區實例群組與飄動計時(buildJungle 建立)
  const nightGround = ground.material.map;
  const _o = new THREE.Object3D(), _c = new THREE.Color();
  const mat = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: .92 }, o || {}));
  const add = (m, cast) => { m.castShadow = cast !== false; m.receiveShadow = true; deco.add(m); return m; };
  const mesh = (geo, material, x, y, z, cast) => { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); return add(m, cast); };
  const col = (x, z, r) => COLLIDERS.push({ x, z, r, deco: true });
  const pick = a => a[Math.floor(Math.random() * a.length)];
  // 標靶區(不要放裝飾)
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
  const speck = (g, s, n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = Math.random() < .5 ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + a * 1.5 + ')'; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); } };
  function rep(t, x, y) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(x, y); t.anisotropy = 4; return t; }

  /* ---------- 貼圖 ---------- */
  // 叢林地面:中性細節貼圖(顏色全交給頂點色,設計 §3-3)
  const jungleDetail = () => rep(canvasTex(256, (g, s) => {
    g.fillStyle = '#c4bcac'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 420; i++) { g.fillStyle = pick(['rgba(90,90,90,.16)', 'rgba(255,255,255,.14)', 'rgba(60,60,60,.12)']); g.beginPath(); g.arc(Math.random() * s, Math.random() * s, rnd(3, 14), 0, TAU); g.fill(); }
    speck(g, s, 3000, .06);
  }), 30, 30);

  /* ---------- 場景 ---------- */
  // 月夜(設計_大面積地形 §3-1):石柱 28 根、外圈樹 70 棵(樹幹 / 樹冠各 1 群組,不投影)、火盆 7 座,全部實例化
  function buildNight() {
    const pillars = [];
    for (let i = 0; i < 28; i++) { const a = i / 28 * TAU, h = rnd(3, 5.5); pillars.push([Math.cos(a) * 56, h / 2, Math.sin(a) * 56, rnd(0, 3), 1.4, h, 1.4]); }
    inst(new THREE.BoxGeometry(1, 1, 1), mat(0x6a6f85), pillars);
    const trunks = [], cones = [];
    for (let i = 0; i < 70; i++) {
      const a = rnd(0, TAU), r = rnd(62, 95), h = rnd(5, 9), x = Math.cos(a) * r, z = Math.sin(a) * r;
      trunks.push([x, 1, z]);
      for (let k = 0; k < 3; k++) { const cr = 2.4 - k * .5; cones.push([x, 2.6 + k * h / 4, z, 0, cr, h / 2.2, cr]); }
    }
    inst(new THREE.CylinderGeometry(.3, .4, 2, 6), mat(0x4a3322, { roughness: 1 }), trunks, false);
    inst(new THREE.ConeGeometry(1, 1, 8), mat(0x1e3a33, { roughness: 1 }), cones, false);
    const braz = [[-18, -6], [20, -6], [-24, 18], [26, 14], [0, 36], [-14, -24], [24, -30]];
    inst(new THREE.CylinderGeometry(.5, .7, 2.2, 8), mat(0x777c92), braz.map(p => [p[0], terrainH(p[0], p[1]) + 1.1, p[1]]));
    braz.forEach(p => { col(p[0], p[1], .8); BRAZIERS.push({ x: p[0], y: terrainH(p[0], p[1]) + 2.3, z: p[1] }); });
  }

  // ---- 叢林(設計_大面積地形 §2-3~2-6、§3-1):地形由 terrain 高度場;物件實例化;y 一律取 terrainH ----
  const JUNGLE_T = [
    ['hill', -18, 20, 3, 16, 7.5],                     // M1 大山丘
    ['mesa', -24, -2, 5, 8, 0, 9, 3],                  // W  西緩坡台地
    ['mesa', 25, -5, 6, 8, 0, 1.6, 3.5],               // E  東懸崖台地
    ['hill', 20, 24, 13, 1, 1.2], ['hill', 20, 24, 9, 1, 2.4], ['hill', 20, 24, 5, 1, 3.6],   // T1~T3 梯田
    ['rim', 34, 42, 50, 57, 6],                        // 場外圍山
    ['noise', .35, 11, 16],                            // 微起伏(中央 r < 11 不加)
    ['trench', -14, -19, 18, -21, 2, 4, 6, -1.5],      // R  南河谷
    ['basin', -19, -21, 3, 3, -1.3],                   // S  西南沼澤
    ['path', 10, -9, 0, 20.5, -9, 3.5, 1.5, 1],        // PE1 東崖台西坡道(土堤)
    ['path', 24.5, 1.5, 3.5, 23.5, 11.6, 1.2, 1.5, 1], // PE2 東崖台北坡道
    ['path', 11, 13.2, 0, 17.4, 20.9, 3.6, 1.2, .8],   // PT  梯田登頂坡道
    ['path', -11.6, 17.7, 5.5, -8.4, 16.3, 5.5, 1.2, 1.2, 1]   // PB 吊橋土堤(不上路色)
  ];
  const JUNGLE_SPAWNS = [[-0.5, -27], [-16.5, 18.5], [28, 10], [-26, -2], [24, -4], [5, 26.5], [-12, -26], [20, 21], [-18, -10], [12.5, -13.5], [-24, 8], [-4, 30]];   // 省略 y:自動取地形高(remote.js validSpawnPts)
  const JUNGLE_DUMMY = [];   // 單人稻草人:內圈 8 個 r4、外圈 16 個 r8(設計_叢林地圖 §3-11)
  for (let k = 0; k < 8; k++) { const a = (22.5 + 45 * k) * Math.PI / 180; JUNGLE_DUMMY.push([4 * Math.cos(a), 4 * Math.sin(a)]); }
  for (let k = 0; k < 16; k++) { const a = 22.5 * k * Math.PI / 180; JUNGLE_DUMMY.push([8 * Math.cos(a), 8 * Math.sin(a)]); }
  const JUNGLE_BUSH = [[3, 24, 3.5], [-26, 12, 3], [12, -12, 3], [-18, -20, 3.5], [28, 10, 3.5], [-24, -8, 3], [-11, -3, 2.5], [27, 14, 2.5]];   // [x, z, r] 草叢
  const JUNGLE_FOG = [[-18, -21, 7]];   // 霧區:沼澤上方
  const JUNGLE_PROBES = [['M1', -16.5, 18.5], ['PB', -9, 16.6], ['W', -26, -2], ['E', 24, -4], ['T3', 20, 21], ['R', 0, -20], ['S', -19, -21]];
  function buildJungle(S) {
    const DARK = [0x1f3f1a, 0x25491f, 0x2b5423], MID = [0x3c6e2e, 0x4a7d34, 0x35612a], LIGHT = [0x5f8f3a, 0x6f9a40, 0x7aa84a];
    const trunksN = [], canN = [], trunksF = [], canF = [], vines = [];
    const decoOk = (x, z) => Math.hypot(x, z) >= 9.5 && !nearPlatform(x, z, .5);   // 中央 r < 9.5 留給稻草人與出生空地
    // 有碰撞的裝飾:不在平台旁、不在小路上、2 m 內無崖 / 坎(高差 ≤ 0.6 · 距離)
    const solidOk = (x, z) => !nearPlatform(x, z, 2) && pathPaint(S.terrain, x, z) < .05 && [[2, 0], [-2, 0], [0, 2], [0, -2], [1.4, 1.4], [-1.4, 1.4], [1.4, -1.4], [-1.4, -1.4]].every(o => Math.abs(terrainH(x + o[0], z + o[1]) - terrainH(x, z)) < Math.hypot(o[0], o[1]) * .6);
    // 一棵樹(near 投影 / far 低面數不投影);collide 時加樹幹碰撞圈 r = 樹幹 + 0.1
    const tree = (x, z, far, collide) => {
      const k = Math.random(), S2 = far ? 1.3 : 1, g = terrainH(x, z), T = far ? trunksF : trunksN, C = far ? canF : canN;
      let tr;
      if (k < .55) {   // 闊葉樹:粗樹幹 + 四層樹冠(下層深、上層淺)
        const h = rnd(11, 20) * S2; tr = rnd(.75, 1.05) * S2;
        T.push([x, g + h / 2, z, 0, tr, h, tr, 0, 0, 0x5a4330]);
        const layers = [pick(DARK), pick(DARK), pick(MID), pick(LIGHT)];
        for (let q = 0; q < 4; q++) { const cr = rnd(4.5, 6) * S2 * (1 - q * .15); C.push([x + rnd(-1.6, 1.6), g + h - 3.5 + q * 1.6 + rnd(-.4, .4), z + rnd(-1.6, 1.6), 0, cr, cr * .72, cr, 0, 0, layers[q]]); }
        if (!far && Math.random() < .5) { const L = rnd(5, 8); vines.push([x + rnd(-2, 2), g + h - 3 - L / 2, z + rnd(-2, 2), 0, 1, L, 1, 0, 0, 0x2c4a22]); }
      } else if (k < .85) {   // 傘形金合歡:細樹幹 + 扁平傘冠
        const h = rnd(6, 9) * S2; tr = rnd(.5, .62) * S2;
        T.push([x, g + h / 2, z, 0, tr, h, tr, 0, 0, 0x6a5238]);
        C.push([x, g + h + .2, z, 0, rnd(6, 7.5) * S2, 1.6 * S2, rnd(6, 7.5) * S2, 0, 0, pick(MID)]);
        C.push([x + rnd(-1, 1), g + h + 1.4, z + rnd(-1, 1), 0, rnd(4, 5) * S2, 1.2 * S2, rnd(4, 5) * S2, 0, 0, pick(LIGHT)]);
      } else {   // 猴麵包樹:粗壯樹幹 + 幾團厚實樹冠
        const h = rnd(8, 11) * S2; tr = rnd(2.3, 2.8) * S2;
        T.push([x, g + h / 2, z, 0, tr, h, tr, 0, 0, 0x7a6a55]);
        for (let q = 0; q < 4; q++) C.push([x + rnd(-2.2, 2.2), g + h + rnd(-.5, 1), z + rnd(-2.2, 2.2), 0, rnd(2.4, 3.2) * S2, rnd(1.6, 2.2) * S2, rnd(2.4, 3.2) * S2, 0, 0, pick(q < 2 ? DARK : MID)]);
      }
      if (collide && solidOk(x, z)) col(x, z, tr + .1);
    };
    // 場內樹(15 棵)與圍山樹牆(近景,投影)、遠樹(r 50~100,不投影)
    [[-22, 14], [-12, 24], [-24, 24], [-27, -8], [-20, 5], [-29, 4], [-6, -13], [7, -14], [-4, -27], [8, -28], [26, 19], [29, -10], [28, 1], [4, 19], [-15, 9]].forEach(p => tree(p[0], p[1], false, true));
    for (let i = 0; i < (MOBILE ? 35 : 55); i++) { const a = rnd(0, TAU), r = rnd(36, 52); tree(Math.cos(a) * r, Math.sin(a) * r, false, false); }
    for (let i = 0; i < (MOBILE ? 20 : 40); i++) { const a = rnd(0, TAU), r = rnd(50, 100); tree(Math.cos(a) * r, Math.sin(a) * r, true, false); }
    // 樹屋大樹 BT(−2, 14):樹幹穿過樓板;碰撞 r 1.3
    { const g = terrainH(-2, 14); trunksN.push([-2, g + 7, 14, 0, 1.2, 14, 1.2, 0, 0, 0x7a6a55]);
      for (let q = 0; q < 6; q++) { const a = q / 6 * TAU; canN.push([-2 + Math.cos(a) * 2, g + 11.5 + rnd(-.4, .4), 14 + Math.sin(a) * 2, 0, 2.6, 2, 2.6, 0, 0, pick(q < 3 ? DARK : MID)]); }
      canN.push([-2, g + 13.5, 14, 0, 3, 2.2, 3, 0, 0, pick(LIGHT)]);
      col(-2, 14, 1.3); }
    inst(new THREE.CylinderGeometry(.7, 1, 1, 8), mat(0xffffff), trunksN);
    inst(new THREE.IcosahedronGeometry(1, 1), mat(0xffffff, { roughness: 1 }), canN);
    inst(new THREE.CylinderGeometry(.7, 1, 1, 6), mat(0xffffff), trunksF, false);
    inst(new THREE.IcosahedronGeometry(1, 0), mat(0xffffff, { roughness: 1 }), canF, false);
    if (vines.length) inst(new THREE.CylinderGeometry(.06, .06, 1, 4), mat(0xffffff), vines, false);
    // 碎草(坡 > 0.9 的點跳過)
    const grass = [], nG = MOBILE ? 150 : 350, nrm = new THREE.Vector3();
    for (let i = 0, t = 0; i < nG && t < nG * 3; t++) {
      const a = rnd(0, TAU), r = rnd(7, 40), x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!decoOk(x, z) || groundNormal(x, z, null, .5, nrm).y < .743) continue; i++;
      for (let k = 0; k < 3; k++) { const sy = rnd(.6, 1.3); grass.push([x + rnd(-.3, .3), terrainH(x, z) + sy / 2, z + rnd(-.3, .3), rnd(0, 3), 1, sy, 1, rnd(-.25, .25), rnd(-.25, .25), pick([0x5f8f3a, 0x7a9a40, 0x4a7a2a])]); }
    }
    inst(new THREE.ConeGeometry(.18, 1, 4, 1, true), mat(0xffffff, { roughness: 1 }), grass, false);
    // 灌木(不投影)
    const shrubs = [], nS = MOBILE ? 40 : 80;
    for (let i = 0, t = 0; i < nS && t < nS * 3; t++) {
      const a = rnd(0, TAU), r = rnd(10, 40), x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!decoOk(x, z)) continue; i++;
      const s = rnd(1, 2);
      shrubs.push([x, terrainH(x, z) + s * .35, z, rnd(0, 3), s, s * rnd(.6, .8), s * rnd(.9, 1.1), 0, 0, pick(DARK.concat(MID))]);
    }
    inst(new THREE.IcosahedronGeometry(1, 0), mat(0xffffff, { roughness: 1 }), shrubs, false);
    // 中央 4 顆低岩(有碰撞,與 r4 / r8 稻草人保持淨距)
    const rocks = [];
    [[3.9, 3.9], [-3.9, 3.9], [3.9, -3.9], [-3.9, -3.9]].forEach(([x, z]) => { rocks.push([x, terrainH(x, z) + .55, z, rnd(0, 3), 1.6, 1.1, 1.6]); col(x, z, 1.2); });
    inst(new THREE.DodecahedronGeometry(1, 0), mat(0x6f6a5c), rocks);
    // 坡上岩石 8 顆(沉入地面 .25·s;s > 1.8 且位置合格才有碰撞)
    const rocksS = [];
    for (let i = 0, t = 0; i < 8 && t < 200; t++) {
      const a = rnd(0, TAU), r = rnd(12, 40), x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!decoOk(x, z)) continue; i++;
      const s = rnd(1.2, 3);
      rocksS.push([x, terrainH(x, z) + s * .5 - s * .25, z, rnd(0, 3), s, s * .7, s * rnd(.8, 1.2)]);
      if (s > 1.8 && solidOk(x, z)) col(x, z, s * .9);
    }
    inst(new THREE.DodecahedronGeometry(1, 0), mat(0x6f6a5c), rocksS);
    // 石圖騰 2 座(平地,外圈)
    const tBox = [], tEye = [];
    for (let i = 0, t = 0; i < 2 && t < 300; t++) {
      const a = rnd(0, TAU), r = rnd(22, 31), x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!solidOk(x, z) || !terrainFlat(x, z, 3)) continue; i++;
      const g = terrainH(x, z);
      [[2.2, 1.2], [1.7, 1.2], [1.3, 1.1]].forEach((b, k) => { const y = g + .6 + k * 1.2, ry = k * .3; tBox.push([x, y, z, ry, b[0], b[1], b[0], 0, 0, 0x7d7868]); tEye.push([x - .35, y + .1, z + b[0] / 2 + .01, ry, .3, .25, .1, 0, 0, 0x1d1a14]); });
      col(x, z, 1.4);
    }
    inst(new THREE.BoxGeometry(1, 1, 1), mat(0xffffff, { roughness: 1 }), tBox);
    inst(new THREE.BoxGeometry(1, 1, 1), mat(0xffffff, { roughness: 1 }), tEye, false);
    // 竹火把 4 座(位置固定;y = terrainH)
    const tStick = [], tCup = [];
    [[9, -6], [-8, -8], [8, 8], [-6, 9]].forEach(([x, z]) => {
      const g = terrainH(x, z);
      tStick.push([x, g + 1.3, z, 0, 1, 2.6, 1]); tCup.push([x, g + 2.7, z, 0, 1, .35, 1]);
      BRAZIERS.push({ x, y: g + 2.9, z }); if (solidOk(x, z)) col(x, z, .4);
    });
    inst(new THREE.CylinderGeometry(.1, .15, 1, 6), mat(0x6b4a2a), tStick);
    inst(new THREE.CylinderGeometry(.35, .18, 1, 8), mat(0x3a2a18), tCup, false);
    // 水面:只在低於 −1.05 處露出(河谷、沼澤);不投影
    const water = mesh(new THREE.PlaneGeometry(52, 18), mat(0x3d4a2c, { roughness: .15, transparent: true, opacity: .8, depthWrite: false }), 2, -1.05, -21, false);
    water.rotation.x = -Math.PI / 2;
    // 草叢:每片一個 InstancedMesh(3 交叉片一簇)+ 自己的材質(好做淡出);登記到 BUSHES
    const bushGeo = new THREE.PlaneGeometry(1.4, 2.1).translate(0, 1.05, 0);
    const bushTex = canvasTex(128, (g, s) => {
      for (let q = 0; q < 14; q++) {
        const bx = rnd(s * .12, s * .88), top = rnd(s * .05, s * .6), w = rnd(s * .05, s * .1);
        g.fillStyle = pick(['#1f3f1a', '#2b5423', '#4a7d34', '#6f9a40']);
        g.beginPath(); g.moveTo(bx - w, s); g.lineTo(bx + rnd(-8, 8), top); g.lineTo(bx + w, s); g.fill();
      }
    });
    (S.bushes || []).forEach(([bx, bz, br]) => {
      const bm = mat(0xffffff, { map: bushTex, alphaTest: .45, side: THREE.DoubleSide, roughness: 1, transparent: true }), list = [], n = Math.round(Math.PI * br * br / 1.1);
      for (let q = 0; q < n; q++) {
        const a = rnd(0, TAU), d = br * Math.sqrt(Math.random()), x = bx + Math.cos(a) * d, z = bz + Math.sin(a) * d;
        if (nearPlatform(x, z, .3)) continue;
        const sc = rnd(.9, 1.15), c = pick(DARK.concat(MID)), y = terrainH(x, z);
        for (let k = 0; k < 3; k++) list.push([x, y, z, k * Math.PI / 3, sc, sc, sc, 0, 0, c]);
      }
      inst(bushGeo, bm, list, false);
      BUSHES.push({ x: bx, z: bz, r: br, mat: bm });
    });
    // 霧區:14 片(手機 8)大方片 InstancedMesh billboard;sceneTick 每幀更新矩陣與飄動
    (S.fogZones || []).forEach(f => FOGZ.push({ x: f[0], z: f[1], r: f[2] }));
    if (FOGZ.length) {
      const fogN = MOBILE ? 8 : 14, fogTex = canvasTex(128, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); });
      const fm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: fogTex, color: 0xc8d4b0, opacity: .2, transparent: true, depthWrite: false }), fogN), items = [];
      const f0 = FOGZ[0];
      for (let q = 0; q < fogN; q++) { const a = rnd(0, TAU), d = f0.r * .85 * Math.sqrt(Math.random()), x = f0.x + Math.cos(a) * d, z = f0.z + Math.sin(a) * d; items.push({ x, z, y: terrainH(x, z) + rnd(.8, 2.8), sc: rnd(6, 9), per: rnd(8, 14), ph: rnd(0, TAU) }); }
      fm.frustumCulled = false; add(fm, false);
      fogState = { im: fm, items, t: 0 };
    }
  }

  // 南側地形組(四個場景共用):山頂 A、台地 B、山谷 V;吊橋與山頂旗依場景另給
  const SOUTH_T = [['hill', -11, -38, 3, 10, 5], ['hill', 13, -38, 5, 3, 5], ['trench', 0, -30, 0, -40, 3, 3.5, 9, -4]];
  const SOUTH_BR = (sag, style) => [[-8.6, -38, 8.6, -38, 5.05, .8, sag, style]];
  const NIGHT_SPAWNS = [[-22, 13], [24, -13], [-11, -6], [-27, -13], [22, 13], [0, -20], [9, -6], [-21, -20], [-25, 0], [13, -22], [26, 0], [-10, -24]];   // 12 點;省略 y(自動取地形高、驗坡度),與稻草人至少 9 m(設計_大面積地形 §4-2 E)
  const SCENES = [
    { name: '月夜訓練場', build: buildNight, terrain: [...SOUTH_T, ['hill', 42, 20, 2, 7, 2.5], ['hill', -40, 22, 4, 7, 3], ['hill', 36, -32, 3, 6, 2.5], ['mesa', -26, -18, 4, 4, 0, 8, 3.5], ['mesa', 26, -18, 4, 4, 0, 8, 3.5], ['hill', 0, -20, 2, 9, 2.5]], terrainLook: { cliff: 0x6a6f85, dark: .35 }, bridges: SOUTH_BR(.5, 'rope'), bridgeCol: [0x5a4632, 0xb8a070], bridgeGlow: 0x9fd0ff, summit: [-11, -38, 5, 0x9fd0ff], ground: () => nightGround, gtint: 0xffffff, fog: [0x3d3466, 50, 160], hor: [.24, .2, .4], top: [.03, .05, .16], gnd: [.12, .1, .2], sunCol: [0, 0, 0], stars: true, clear: 0x000000, hemi: [0x8a9bff, 0x2a2438, .75], dir: [0xaab8ff, .95], sun: [-20, 40, 15], plats: [['box', -25.5, -16, .9, .9, 5.3, 0, 3.5], ['box', -28.5, -19, 1.5, 1.5, 7, 0, 3.5], ['box', 25.5, -16, .9, .9, 5.3, 0, 3.5], ['cyl', 28.5, -19, .9, 7.2, 3.5]], platCol: 0x454a62, platTrim: 0xb8c0ea, spawns: NIGHT_SPAWNS, terrainProbes: [['WS', -24, -16], ['ES', 24, -16], ['S', 0, -20]] },
    { name: '非洲叢林', build: buildJungle, terrain: JUNGLE_T, terrainLook: { cliff: 0x8a4a2a, dark: .3, bands: [[-1.5, 0x4a4630], [-.4, 0x6a6a3a], [.3, 0x86a04c], [3, 0x6f8f3e], [6, 0xa09a5c]], path: 0xb09468 }, bridges: [[-8.8, 16.5, -4.8, 14.6, 5.5, .8, .3, 'rope']], bridgeCol: [0x7a5a32, 0x3c5a22], ground: jungleDetail, gtint: 0xffffff, fog: [0x7a8450, 35, 135], hor: [.85, .72, .5], top: [.25, .5, .55], gnd: [.2, .25, .15], sunCol: [.45, .28, .12], bt: .93, bk: .55, clear: 0x7a8450, hemi: [0xa8d890, 0x3a3018, .85], dir: [0xffd9a0, 1.0], sun: [-32, 24, 22], plats: [['deck', -2, 14, 3.2, 3.2, 5.5, 0, .4]], platCol: 0x7d7868, platTrim: 0xb3ad94, arenaR: 32, flatZone: [-5, -5, 5, 5], dummyPos: JUNGLE_DUMMY, spawns: JUNGLE_SPAWNS, bushes: JUNGLE_BUSH, fogZones: JUNGLE_FOG, terrainProbes: JUNGLE_PROBES },
  ];

  // 組內網格(坡道 / 樓板用):座標為組的本地座標
  const gmesh = (parent, geo, material, x, y, z, rz) => { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); if (rz) m.rotation.z = rz; m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  // 可站立高台:box [kind,x,z,hx,hz,top,yaw,base] / cyl [kind,x,z,r,top,base];base = 外觀底部(丘上 / 沼澤用),有 base 即 onHill
  function buildPlats(S) {
    const pm = mat(S.platCol), tm = mat(S.platTrim);
    S.plats.forEach(e => {
      if (e[0] === 'deck') { buildDeck(e); return; }
      if (e[0] === 'box') {
        const x = e[1], z = e[2], hx = e[3], hz = e[4], top = e[5], yaw = e[6], base = e[7] || 0;
        mesh(new THREE.BoxGeometry(hx * 2, top - base, hz * 2), pm, x, (top + base) / 2, z).rotation.y = yaw;
        mesh(new THREE.BoxGeometry(hx * 2 + .3, .16, hz * 2 + .3), tm, x, top, z, false).rotation.y = yaw;
        addPlatform({ kind: 'box', x, z, hx, hz, top, yaw, deco: true, onHill: base > 0 });
      } else {
        const x = e[1], z = e[2], r = e[3], top = e[4], base = e[5] || 0;
        mesh(new THREE.CylinderGeometry(r, r * 1.05, top - base, 20), pm, x, (top + base) / 2, z);
        mesh(new THREE.CylinderGeometry(r + .15, r + .15, .16, 20), tm, x, top, z, false);
        addPlatform({ kind: 'cyl', x, z, r, top, deco: true, onHill: base > 0 });
      }
    });
  }
  // 樓板:['deck', x, z, hx, hz, top, yaw, thick];bottom = top − thick(預設 .4);四角支柱到地面,柱子進 COLLIDERS(r .25,內縮 .3 m)
  function buildDeck(e) {
    const x = e[1], z = e[2], hx = e[3], hz = e[4], top = e[5], yaw = e[6] || 0, th = e[7] || .4, bot = top - th;
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw; deco.add(g);
    gmesh(g, new THREE.BoxGeometry(hx * 2, th, hz * 2), mat(0x6b4a2c), 0, bot + th / 2, 0);
    gmesh(g, new THREE.BoxGeometry(hx * 2 + .06, .06, hz * 2 + .06), mat(0x8a6a3e), 0, top, 0);
    addPlatform({ kind: 'box', x, z, hx, hz, top, yaw, bottom: bot, deco: true });
    const c = Math.cos(yaw), s = Math.sin(yaw), pm = mat(0x5a3d22), poles = [];
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz]) => {
      const lx = sx * (hx - .3), lz = sz * (hz - .3), px = x + lx * c + lz * s, pz = z - lx * s + lz * c, g0 = terrainH(px, pz);   // 柱子從地形高度起(設計 §4-2 B)
      if (bot - g0 > .05) poles.push([px, (bot + g0) / 2, pz, 0, 1, bot - g0, 1]);
      col(px, pz, .25);
    });
    inst(new THREE.CylinderGeometry(.14, .14, 1, 6), pm, poles);
  }
  // 坡道:['ramp', x0, z0, y0, x1, z1, y1, w, style];local +x 由起點指向終點(與 buildBridges 同慣例)
  // style:stair / stone = 實心階梯(實例化);plank = 斜木板 + 支柱 + 外觀扶手;log = 斜放圓木
  function buildRamp(e) {
    const [x0, z0, y0, x1, z1, y1, w, style] = e.slice(1);
    const L = Math.hypot(x1 - x0, z1 - z0), H = L / 2, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, yaw = Math.atan2(-(z1 - z0), x1 - x0);
    const ym = (y0 + y1) / 2, sl = (y1 - y0) / L, a = Math.atan(sl), yAt = lx => ym + sl * lx, base = Math.min(y0, y1) - 1.2;
    addPlatform({ kind: 'ramp', x: cx, z: cz, hx: H, hz: w / 2, yaw, y0, y1, top: Math.max(y0, y1), deco: true });
    const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = yaw; deco.add(g);
    if (style === 'plank') {
      gmesh(g, new THREE.BoxGeometry(L, .18, w), mat(0x7a5a36), 0, ym - .09 / Math.cos(a), 0, a);
      [-1, 1].forEach(sd => gmesh(g, new THREE.BoxGeometry(L, .05, .05), mat(0x5a3d22), 0, ym + .6, sd * (w / 2 + .02), a));
      const posts = [];
      for (let lx = -H + .4; lx <= H - .4 + 1e-6; lx += 2.5) posts.push([lx, (yAt(lx) - .09 + base) / 2, 0, 0, 1, yAt(lx) - .09 - base, 1]);
      inst(new THREE.BoxGeometry(.2, 1, .2), mat(0x5a3d22), posts, true, g);
    } else if (style === 'log') {
      const tg = new THREE.Group(); tg.position.set(0, ym, 0); tg.rotation.z = a; g.add(tg);
      gmesh(tg, new THREE.CylinderGeometry(w / 2, w / 2, L, 10), mat(0x5e4630), 0, -w / 2, 0, Math.PI / 2);
    } else {
      const n = Math.max(1, Math.ceil(Math.abs(y1 - y0) / .25)), steps = [];
      for (let i = 0; i < n; i++) { const lx = -H + (i + .5) * L / n, t = yAt(lx); steps.push([lx, (t + base) / 2, 0, 0, L / n, t - base, w]); }
      inst(new THREE.BoxGeometry(1, 1, 1), mat(style === 'stone' ? 0x7d7868 : 0x7a5a36), steps, true, g);
    }
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
      const pm = mat(S.bridgeCol[0]), posts = [];
      [-1, 1].forEach(sx => [-1, 1].forEach(sz => {
        const lx = sx * (H - .4), lz = sz * (hw - .1);
        posts.push([lx, top + .6, lz, 0, 1, 1.4, 1]);
        if (S.bridgeGlow != null) { const s = glowSprite(S.bridgeGlow, 1.2, .8); s.position.set(lx, top + 1.4, lz); g.add(s); }
      }));
      // 繩橋靠山端:兩根粗木樁從地形落到橋底(設計 §2-4 注意,lx ≈ −H + 1)
      if (style === 'rope') [-1, 1].forEach(sd => {
        const lx = -H + 1, lz = sd * hw, wx = cx + lx * Math.cos(yaw) + lz * Math.sin(yaw), wz = cz - lx * Math.sin(yaw) + lz * Math.cos(yaw), gy = terrainH(wx, wz);
        if (ty(lx) - gy > .3) posts.push([lx, (gy + ty(lx)) / 2, lz, 0, 1.5, ty(lx) - gy, 1.5]);
      });
      inst(new THREE.CylinderGeometry(.12, .14, 1, 6), pm, posts, true, g);
    });
  }
  // 山頂旗:[x, z, top, flagHex]
  function buildSummit(S) {
    if (!S.summit) return;
    const [x, z, top, hex] = S.summit;
    mesh(new THREE.CylinderGeometry(.06, .08, 3, 6), mat(0x6a5a4a), x, top + 1.5, z);
    mesh(new THREE.PlaneGeometry(1.4, .8), mat(hex, { side: THREE.DoubleSide }), x + .72, top + 2.6, z);
  }

  // ?plat=1:平台 / 坡道 / 樓板 / 橋的線框(驗收用,只影響外觀;線段放在 deco 內,換場景即清掉)
  const PLAT_DBG = /[?&]plat=1/.test(location.search);
  function platWire() {
    const pts = [], seg = (a, b) => pts.push(new THREE.Vector3(a[0], a[1], a[2]), new THREE.Vector3(b[0], b[1], b[2]));
    const W = (P, lx, y, lz) => [P.x + lx * P.c + lz * P.s, y, P.z - lx * P.s + lz * P.c];
    PLATFORMS.forEach(P => {
      if (P.kind === 'cyl') {
        const lo = P.bottom != null ? P.bottom : 0, N = 24;
        for (let k = 0; k < N; k++) {
          const t0 = k / N * TAU, t1 = (k + 1) / N * TAU, c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
          seg([P.x + c0 * P.r, P.top, P.z + s0 * P.r], [P.x + c1 * P.r, P.top, P.z + s1 * P.r]);
          seg([P.x + c0 * P.r, lo, P.z + s0 * P.r], [P.x + c1 * P.r, lo, P.z + s1 * P.r]);
        }
      } else if (P.kind === 'bridge') {
        const yb = lx => P.top - P.sag * (1 - (lx / P.hx) * (lx / P.hx)), M = 16;
        for (let k = 0; k < M; k++) {
          const a = -P.hx + 2 * P.hx * k / M, b = -P.hx + 2 * P.hx * (k + 1) / M;
          [-1, 1].forEach(sd => seg(W(P, a, yb(a), sd * P.hz), W(P, b, yb(b), sd * P.hz)));
          seg(W(P, a, P.bottom, 0), W(P, b, P.bottom, 0));
        }
      } else if (P.kind === 'ramp') {
        const c4 = [[-P.hx, P.y0, -P.hz], [P.hx, P.y1, -P.hz], [P.hx, P.y1, P.hz], [-P.hx, P.y0, P.hz]];
        for (let k = 0; k < 4; k++) seg(W(P, c4[k][0], c4[k][1], c4[k][2]), W(P, c4[(k + 1) % 4][0], c4[(k + 1) % 4][1], c4[(k + 1) % 4][2]));
        seg(W(P, -P.hx, P.y0, 0), W(P, P.hx, P.y1, 0));
      } else {
        const lo = P.bottom != null ? P.bottom : 0, c4 = [[-P.hx, -P.hz], [P.hx, -P.hz], [P.hx, P.hz], [-P.hx, P.hz]];
        for (let k = 0; k < 4; k++) {
          const p = c4[k], q = c4[(k + 1) % 4];
          seg(W(P, p[0], P.top, p[1]), W(P, q[0], P.top, q[1]));
          seg(W(P, p[0], lo, p[1]), W(P, q[0], lo, q[1]));
          seg(W(P, p[0], lo, p[1]), W(P, p[0], P.top, p[1]));
        }
      }
    });
    const ls = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff00ff, depthTest: false, transparent: true }));
    ls.renderOrder = 50; deco.add(ls);
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
    BRAZIERS.length = 0; BUSHES.length = 0; FOGZ.length = 0; fogState = null;
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
    (S.ramps || []).forEach(buildRamp);
    if (!FLAT || S.bridgesAlways) buildBridges(S);
    if (!FLAT) buildSummit(S);
    S.build(S);
    placeDummies(S.dummyPos || null);
    checkTerrain(S.flatZone);
    cur = i;
    applyArenaR();
    if (PLAT_DBG) { platWire(); terrainAudit(S); }
    applyBloomScene();
    SCORCH.forEach(s => { scene.remove(s.m); s.m.material.dispose(); }); SCORCH.length = 0;
    [...document.querySelectorAll('#sceneBar button')].forEach((b, k) => b.classList.toggle('on', k === i));
    sfx.setScene(i);
    try { localStorage.setItem('mageSandbox.scene', i); } catch (e) { }
    if (window.banner && window.G) window.banner(S.name, '#ffe3b0');
  }
  // 場地半徑:單人 S.arenaR 或 52;多人 S.arenaR 或 32(remote.js 進出對戰時呼叫 applyArenaR)
  function applyArenaR() { const S = cur >= 0 ? SCENES[cur] : null; ARENA_R = (S && S.arenaR) || (window.NETON ? 32 : 52); }
  window.applyArenaR = applyArenaR;
  window.getSceneCount = () => SCENES.length;
  window.getSceneSpawns = () => (cur >= 0 && SCENES[cur].spawns) || null;   // 多人出生點 [[x,z,y],…];null = 沿用 remote.js 的 SPAWN_PTS
  window.getSceneCfg = () => (cur >= 0 ? SCENES[cur] : null);               // 目前場景的設定表(草叢 / 霧區等讀這裡)
  // 每幀(game.js 主迴圈 updatePlayer 之後):草叢半透明(自己或鏡頭在草裡)、霧區視距與霧片飄動(設計_叢林地圖 §4-3、§4-4)
  window.sceneTick = dt => {
    if (cur < 0) return;
    const S = SCENES[cur], p = mage.root.position, cp = camera.position;
    for (const b of BUSHES) {
      const near = Math.hypot(p.x - b.x, p.z - b.z) < b.r + 1 || Math.hypot(cp.x - b.x, cp.z - b.z) < b.r + 1, want = near ? .35 : 1;
      if (b.mat.opacity !== want) { b.mat.opacity = want; b.mat.depthWrite = !near; }
    }
    if (S.fog) {   // 自己在霧區:視距縮到 2 / 22、霧色偏綠灰;出霧慢慢還原場景值
      fogK = damp(fogK, fogAt(p.x, p.z) ? 1 : 0, 4, dt);
      scene.fog.near = lerp(S.fog[1], 2, fogK); scene.fog.far = lerp(S.fog[2], 22, fogK);
      scene.fog.color.setHex(S.fog[0]).lerp(_fogC.setHex(0x8a9670), fogK);
    }
    if (fogState) {
      fogState.t += dt;
      fogState.items.forEach((f, q) => {
        _o.position.set(f.x + Math.sin(fogState.t * TAU / f.per + f.ph) * .6, f.y, f.z + Math.cos(fogState.t * TAU / (f.per * 1.3) + f.ph) * .4);
        _o.quaternion.copy(camera.quaternion); _o.scale.setScalar(f.sc); _o.updateMatrix(); fogState.im.setMatrixAt(q, _o.matrix);
      });
      fogState.im.instanceMatrix.needsUpdate = true;
    }
  };
  const _fogC = new THREE.Color();
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
