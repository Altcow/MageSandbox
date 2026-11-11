'use strict';
// 場景:目前只啟用海島戰場(SCENES 索引 0);月夜訓練場 / 非洲叢林 收在 SCENES_ARCHIVE(停用,見下方)
// 場景只負責「看起來」與碰撞物;標靶與玩法不動。切換:N 鍵、上方按鈕(單場地時無場地按鈕)、?scene=N(目前只有 0)
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
  // 叢林地面:程序化可平鋪(tnFbm / tnNoise,world.js);顏色主要交給頂點色(設計 §3-3),貼圖只給中性微暖明暗、乾黃草塊與草葉細紋
  const jungleDetail = () => rep(canvasTex(256, (g, s) => {
    const lo = tnFbm(s, 4, 4, 11), mid = tnFbm(s, 12, 3, 23), patch = tnFbm(s, 3, 3, 41), blade = tnNoise(s, 96, 96, 31), blade2 = tnNoise(s, 48, 48, 37);
    const img = g.createImageData(s, s), d = img.data;
    for (let i = 0; i < s * s; i++) {
      const dry = clamp((patch[i] - .6) * 3, 0, 1) * .14, b = (blade[i] - .5) * .1 + (blade2[i] - .5) * .05, v = .78 + (lo[i] - .5) * .1 + b;
      d[i * 4] = (v * 1.04 + dry) * 255; d[i * 4 + 1] = v * (1 + (mid[i] - .5) * .2) * 255; d[i * 4 + 2] = (v * .9 - dry * .3) * 255; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }), 30, 30);
  // 月夜地面:程序化可平鋪的冷色暗苔地(顏色寫在貼圖上,頂點色為白);平鋪 45 次、anisotropy 8(同原 world.js 設定)
  const nightGroundTex = () => {
    const t = canvasTex(256, (g, s) => {
      const lo = tnFbm(s, 4, 4, 111), mid = tnFbm(s, 12, 3, 123), patch = tnFbm(s, 3, 3, 141), blade = tnNoise(s, 96, 96, 131), blade2 = tnNoise(s, 48, 48, 137);
      const img = g.createImageData(s, s), d = img.data;
      for (let i = 0; i < s * s; i++) {
        const k = .25 + .5 * mid[i] + .25 * lo[i], soil = clamp((patch[i] - .62) * 3, 0, 1) * .4, f = (blade[i] - .5) * 18 + (blade2[i] - .5) * 10;
        const r0 = 36 + 24 * k, g0 = 50 + 30 * k, b0 = 50 + 28 * k;   // 冷色暗苔地:青灰綠
        d[i * 4] = r0 + (44 - r0) * soil + f * .8; d[i * 4 + 1] = g0 + (44 - g0) * soil + f; d[i * 4 + 2] = b0 + (54 - b0) * soil + f * 1.1; d[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(45, 45); t.anisotropy = 8;
    return t;
  };

  // 海島地面:草地為主,顏色主要交給頂點色,貼圖只給中性微綠明暗與草葉細紋;平鋪 30 次
  const islandGroundTex = () => rep(canvasTex(256, (g, s) => {
    const lo = tnFbm(s, 4, 4, 311), mid = tnFbm(s, 12, 3, 323), blade = tnNoise(s, 96, 96, 331), blade2 = tnNoise(s, 48, 48, 337);
    const img = g.createImageData(s, s), d = img.data;
    for (let i = 0; i < s * s; i++) {
      const v = .9 + (lo[i] - .5) * .14 + (blade[i] - .5) * .08 + (blade2[i] - .5) * .05;
      d[i * 4] = v * 255; d[i * 4 + 1] = v * (1 + (mid[i] - .5) * .12) * 255; d[i * 4 + 2] = v * .86 * 255; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
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
  // ---- 海島戰場:海面 waterY = 1.0;海床 h ≈ 0(網格外也是 0);中央高原 h = 2.6(r ≤ 8 平坦,稻草人區);島緣約 r 40~48;小山丘 4~6.5 m;凹地底 1.5;南灣與東西沙灘 ----
  const ISLAND_WATER = 1;
  const ISLAND_T = [
    ['hill', 0, 0, 33, 20, 2.6],          // I1 中央高原(r < 33 平坦戰場;外緣 W 20 使海岸平均約 r 44.8)
    ['hill', -24, 17, 2.5, 13, 5.5],      // I2 西北小山丘
    ['hill', 25, -18, 3, 15, 6.5],        // I3 東南山丘
    ['hill', 6, 30, 2, 11, 4.6],          // I4 北方高地
    ['hill', -14, -24, 1.5, 10, 4.2],     // I5 西南小丘
    ['hill', -15, -4, 2.5, 10, 4],        // M1 掩體丘(西)
    ['hill', 12, 10, 1.5, 9, 3.6],        // M2 掩體丘(東北)
    ['hill', -9, -42, 2, 6, 2.6],         // 南灣東西兩側岬角(馬蹄形)
    ['hill', 9, -42, 2, 6, 2.6],
    ['basin', 20, 8, 3.5, 6, 1.5],        // 凹地(底 1.5,深約 1.1)
    ['basin', 0, -46, 3, 6, .8],          // 南灣(海水入侵;底 .8 仍在水面下,岸線最小 r ≈ 41)
    ['basin', 42, 0, 3, 4, 1.2],          // 東沙灘(低而寬的沙帶)
    ['basin', -42, 4, 3, 4, 1.2],         // 西沙灘
    ['noise', .25, 16, 36]                // 微起伏(中央 r < 16 不加)
  ];
  const ISLAND_SPAWNS = [[-1, 31], [10, -36], [-35, -9], [36, 3], [-5, -10], [-28, 19], [-16, -33], [24, 26], [29, -21], [13, 5], [-8, 11], [11, -18]];   // 12 點;省略 y(自動取地形高、驗坡度)
  const ISLAND_DUMMY = [];   // 單人稻草人 24 個:內圈 8 個 r4、外圈 16 個 r7.5(中央平地 r≤8 恆高 2.6,y 由 clearStatus 取地形高)
  for (let k = 0; k < 8; k++) { const a = (22.5 + 45 * k) * Math.PI / 180; ISLAND_DUMMY.push([4 * Math.cos(a), 4 * Math.sin(a)]); }
  for (let k = 0; k < 16; k++) { const a = 22.5 * k * Math.PI / 180; ISLAND_DUMMY.push([7.5 * Math.cos(a), 7.5 * Math.sin(a)]); }
  const ISLAND_PROBES = [['C', 0, 0], ['NW', -24, 17], ['SE', 25, -18], ['M1', -15, -4], ['E', 36, 3]];
  // 沙色:降亮度、提高飽和,不接近白色(避免泛光);乾沙 / 濕沙交錯的細帶讓沙地看得出起伏;草地偏深;丘頂灰綠岩色
  const ISLAND_BANDS = [[-1.5, 0x5e5238], [.85, 0x7a6a45], [1.05, 0x8f7a4c], [1.25, 0xb89a5a], [1.4, 0x9a8450], [1.6, 0xc9a868], [1.85, 0xa8905a], [2.2, 0x8fa860], [2.7, 0x6fa048], [4.2, 0x5f8a44], [5.6, 0x7a8068], [6.6, 0x8a8a78]];
  // 固定表(多人一致):樹 60 棵(手機前 34 棵,依序排好);木屋 4 座;岩 9 顆;擱淺船 2 艘;漂流木 8 根 [x, z, yaw, 長]
  const ISLAND_TREES = [[-33.1,2.8],[-25.9,0.7],[-27.4,8.6],[-31,8.6],[-30.7,1],[-28.5,2],[-25.2,9.2],[-28.1,-0.2],[14.4,19.2],[22.4,21.6],[15.5,23.7],[18.5,28.7],[18.8,17.5],[21.3,17.7],[23.9,17.5],[25.8,20.2],[-5.7,-32.4],[-8,-31],[-6,-28],[-10.4,-29.6],[-3.1,-29.4],[-3.8,-26.3],[-3.3,-32],[-9.8,-32.6],[2.5,34.1],[-25.8,-24.6],[30.4,15.3],[28.5,-11.4],[-15.3,-5],[35.8,10.4],[-9.2,-20.5],[6,29.4],[15.2,-28],[3.3,-25.9],[-24.5,5.6],[-30.5,6.4],[-26.4,4],[-23.7,0.1],[-22.4,4.5],[-22.8,7],[19.7,26.5],[19.5,20.6],[17.7,23.8],[16.5,18.5],[14,21.8],[17.2,26.2],[-8,-34],[-7.9,-26.8],[-5.8,-34.8],[-1.1,-30.4],[-5.9,-25.5],[-1.8,-27.6],[-27.5,14.1],[8.6,-27.1],[-5.6,31.2],[-35.3,12.7],[-14.8,-22.1],[-24.9,21.7],[-0.1,-37.4],[-11,27.9]];
  const ISLAND_HUTS = [[-22, -12], [10, -9], [-6, 17], [7, 20]];   // 破舊木屋(6×5 m,yaw 0)
  const ISLAND_ROCKS = [[28, 6, 2, 2.8], [30.5, 4, 1.6, 2.2], [-30, -6, 2.2, 3.2], [-32, -3.5, 1.8, 2.4], [-28, -4.5, 1.6, 2], [8, -32, 2, 2.6], [10.5, -31, 1.6, 2], [-14, 32, 2.2, 3], [-12, 33.5, 1.7, 2.2]];   // [x, z, 半徑, 高]
  const ISLAND_BOATS = [[34, -10, .4], [-36, 8, -.3]];   // [x, z, yaw]
  const ISLAND_DRIFT = [[16, -38, -.5, 4.5], [-19, 37, -.5, 4.5], [37, 18, -2, 4.5], [-37, -17, -2, 4.5], [-16, -39, .5, 4.5], [16, 37, .5, 4.5], [-37, 17, 2, 4.5], [35, -5.5, -1.5, 4.5]];
  let seaU = null, seaTex = [];   // 海面 shader uniform 與自建貼圖(buildIsland 設、sceneTick 更新時間與視點、clearDeco 釋放)

  // 已停用場地(保留為死碼,供日後復原):要恢復時,把這兩筆依原順序(月夜、叢林、海島)放回 SCENES,並同步恢復 cover.js 的 SCENE_INFO 與 sfx.js 的配樂判斷
  const SCENES_ARCHIVE = [
    { name: '月夜訓練場', build: buildNight, terrain: [...SOUTH_T, ['hill', 42, 20, 2, 7, 2.5], ['hill', -40, 22, 4, 7, 3], ['hill', 36, -32, 3, 6, 2.5], ['mesa', -26, -18, 4, 4, 0, 8, 3.5], ['mesa', 26, -18, 4, 4, 0, 8, 3.5], ['hill', 0, -20, 2, 9, 2.5]], terrainLook: { cliff: 0x6a6f85, dark: .35 }, bridges: SOUTH_BR(.5, 'rope'), bridgeCol: [0x5a4632, 0xb8a070], bridgeGlow: 0x9fd0ff, summit: [-11, -38, 5, 0x9fd0ff], ground: nightGroundTex, cloud: { on: true, cover: .42, lit: [.7, .78, 1], shade: [.28, .24, .42] }, gtint: 0xffffff, fog: [0x3d3466, 50, 160], hor: [.24, .2, .4], top: [.03, .05, .16], gnd: [.12, .1, .2], sunCol: [0, 0, 0], stars: true, clear: 0x000000, hemi: [0x8a9bff, 0x2a2438, .75], dir: [0xaab8ff, .95], sun: [-20, 40, 15], plats: [['box', -25.5, -16, .9, .9, 5.3, 0, 3.5], ['box', -28.5, -19, 1.5, 1.5, 7, 0, 3.5], ['box', 25.5, -16, .9, .9, 5.3, 0, 3.5], ['cyl', 28.5, -19, .9, 7.2, 3.5]], platCol: 0x454a62, platTrim: 0xb8c0ea, spawns: NIGHT_SPAWNS, terrainProbes: [['WS', -24, -16], ['ES', 24, -16], ['S', 0, -20]] },
    { name: '非洲叢林', build: buildJungle, terrain: JUNGLE_T, terrainLook: { cliff: 0x8a4a2a, dark: .3, bands: [[-1.5, 0x4a4630], [-.4, 0x6a6a3a], [.3, 0x86a04c], [3, 0x6f8f3e], [6, 0xa09a5c]], path: 0xb09468 }, bridges: [[-8.8, 16.5, -4.8, 14.6, 5.5, .8, .3, 'rope']], bridgeCol: [0x7a5a32, 0x3c5a22], ground: jungleDetail, cloud: { on: true, cover: .4, lit: [1, .97, .88], shade: [.6, .62, .7] }, gtint: 0xffffff, fog: [0x7a8450, 35, 135], hor: [.85, .72, .5], top: [.25, .5, .55], gnd: [.2, .25, .15], sunCol: [.45, .28, .12], bt: .93, bk: .55, clear: 0x7a8450, hemi: [0xa8d890, 0x3a3018, .85], dir: [0xffd9a0, 1.0], sun: [-32, 24, 22], plats: [['deck', -2, 14, 3.2, 3.2, 5.5, 0, .4]], platCol: 0x7d7868, platTrim: 0xb3ad94, arenaR: 32, flatZone: [-5, -5, 5, 5], dummyPos: JUNGLE_DUMMY, spawns: JUNGLE_SPAWNS, bushes: JUNGLE_BUSH, fogZones: JUNGLE_FOG, terrainProbes: JUNGLE_PROBES },
  ];
  // 目前生效場地:唯一一筆(索引 0)
  const SCENES = [
    { name: '海島戰場', build: buildIsland, atmo: true, terrain: ISLAND_T, terrainLook: { cliff: 0x9a8a6a, dark: 0, bands: ISLAND_BANDS, sandNoise: { amp: .1, band: [1.1, 1.9] } }, waterY: ISLAND_WATER, ground: islandGroundTex, cloud: { on: true, cover: .45, lit: [1, 1, 1], shade: [.62, .7, .82] }, gtint: 0xffffff, fog: [0xa9dcd6, 60, 220], clear: 0xa9dcd6, hor: [.72, .88, .86], top: [.28, .62, .9], gnd: [.25, .5, .55], sunCol: [1, .92, .7], hemi: [0xbfe9ff, 0x4a6a3a, 1.1], dir: [0xfff1d6, 1.6], sun: [-30, 40, 18], bt: .93, bk: .55, plats: [], platCol: 0x7d7868, platTrim: 0xb3ad94, arenaR: 56, flatZone: [-6, -6, 6, 6], dummyPos: ISLAND_DUMMY, spawns: ISLAND_SPAWNS, terrainProbes: ISLAND_PROBES },
  ];

  // ---- 海島戰場 ----
  // 確定性亂數(mulberry32):島上所有座標(含碰撞樹幹)都由 srand 決定,多人所有客戶端一致
  function srand(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // 海面深度(與 SEA_FS 同式):地形取樣;網格外以距離延伸成深海(20 m 內平滑過渡到 15 m)
  function seaDepth(x, z, wy) {
    const ext = Math.hypot(Math.max(Math.abs(x) - 60, 0), Math.max(Math.abs(z) - 60, 0)), k = clamp(ext / 20, 0, 1), s = k * k * (3 - 2 * k);
    return Math.max(wy - terrainH(x, z), 0) * (1 - s) + 15 * s;
  }
  // 淺灘波幅衰減(CPU 算好存成頂點屬性):深度 < .3 m 為 0(貼平沙灘),> 3 m 為 1
  function seaShore(x, z, wy) { const t = clamp((seaDepth(x, z, wy) - .3) / 2.7, 0, 1); return t * t * (3 - 2 * t); }
  // 海面 shader(ShaderMaterial):頂點 = Gerstner 波 + 淺灘衰減 + 遠處衰減;片段 = 深淺水色 / 菲涅爾 / 太陽閃光 / 泡沫 / 焦散 / 霧
  // defines:NW 波組數、DESK 桌機(第 2 層泡沫 + 焦散)、LACE 蕾絲泡沫(低精度裝置關閉)
  const SEA_VS = [
    'attribute float aShore;uniform vec4 uWP[6];uniform vec2 uWA[6];uniform float uTime,uWaterY;varying vec3 vWP,vN;varying float vCrest;',
    'void main(){vec2 xz=position.xz;vec3 dsp=vec3(0.),nn=vec3(0.,1.,0.);float cr=0.;',
    'for(int i=0;i<NW;i++){vec2 D=uWP[i].xy;float k=uWP[i].z,w=uWP[i].w,A=uWA[i].x,Q=uWA[i].y;',
    'float th=k*dot(D,xz)-w*uTime,s=sin(th),c=cos(th);',
    'dsp+=vec3(Q*A*D.x*c,A*s,Q*A*D.y*c);nn+=vec3(-D.x*k*A*c,-Q*k*A*s,-D.y*k*A*c);cr+=Q*k*A*s;}',
    'float g=aShore*(1.-smoothstep(120.,260.,length(xz)));',
    'dsp*=g;nn=normalize(mix(vec3(0.,1.,0.),nn,g));',
    'vec3 p=vec3(xz.x+dsp.x,uWaterY+dsp.y,xz.y+dsp.z);',
    'vWP=p;vN=nn;vCrest=cr*g;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}'
  ].join('\n');
  const SEA_FS = [
    'uniform sampler2D uHM,uNoise;uniform vec3 uCam,uSunDir,uSunCol,uSkyHor,uSkyTop,uFogCol;uniform float uTime,uWaterY,uFogN,uFogF;varying vec3 vWP,vN;varying float vCrest;',
    'void main(){vec3 V=normalize(uCam-vWP),L=normalize(uSunDir);',
    'float dist=length(vWP-uCam),ext=length(max(abs(vWP.xz)-60.,0.));',
    'float ht=texture2D(uHM,clamp(vWP.xz/121.+.5,0.,1.)).r*10.-2.;',
    'float d=mix(max(uWaterY-ht,0.),15.,smoothstep(0.,20.,ext));',
    'vec2 nu=vWP.xz*.21+uTime*vec2(.03,.02);',
    'float g0=texture2D(uNoise,nu).g,gx=texture2D(uNoise,nu+vec2(.01,0.)).g-g0,gz=texture2D(uNoise,nu+vec2(0.,.01)).g-g0;',
    'vec3 N=normalize(normalize(vN)+vec3(-gx,0.,-gz)*9.*(1.-smoothstep(60.,220.,dist)));',
    'float ndl=max(dot(N,L),0.),w=exp(-d*.7);',
    'vec3 col=mix(vec3(.015,.075,.165),vec3(.04,.42,.44),w);',
    'col=mix(col,vec3(.85,.78,.55),clamp(exp(-d*1.6)*.85,0.,.85));',
    'col*=.55+.45*ndl;',
    'col+=vec3(.05,.45,.35)*pow(max(dot(-V,L),0.),4.)*smoothstep(.08,.5,vCrest)*(.4+.6*w)*.6;',
    'vec3 Rf=reflect(-V,N);',
    'col=mix(col,mix(uSkyHor,uSkyTop,smoothstep(0.,.55,Rf.y)),(.02+.98*pow(1.-max(dot(N,V),0.),5.))*.9);',
    'float nh=max(dot(N,normalize(L+V)),0.);',
    'col+=uSunCol*(pow(nh,240.)*2.4+pow(nh,40.)*.12);',
    'float lc=1.,lc2=1.,crest=smoothstep(.08,.24,vCrest),sb=(1.-smoothstep(.12,.4,abs(d-(.25+.9*(.5+.5*sin(uTime*.8))))))*(1.-smoothstep(1.,1.8,d))+(1.-smoothstep(0.,.35,d))*.6;',
    '#if LACE',
    'lc=1.-smoothstep(.02,.22,texture2D(uNoise,vWP.xz*.06+uTime*vec2(.02,.012)).r);',
    '#if DESK',
    'lc2=1.-smoothstep(.02,.22,texture2D(uNoise,vWP.xz*.19+uTime*vec2(-.03,.04)).r);',
    '#endif',
    '#endif',
    'float fd=1.-smoothstep(120.,240.,dist),foam=(crest+sb)*lc*fd;',
    '#if DESK',
    'foam+=(crest*.6+sb*.5)*lc2*fd;',
    'vec2 cu=vWP.xz*.11+uTime*vec2(.05,-.03);',
    'float cau=(1.-smoothstep(.02,.2,texture2D(uNoise,cu).r))*(1.-smoothstep(.02,.2,texture2D(uNoise,cu*1.7+vec2(.3)).r));',
    'col+=vec3(.55,1.,.9)*cau*.35*(1.-smoothstep(.5,4.,d))*ndl;',
    '#endif',
    'col=mix(col,vec3(.93,.97,.96)*(.75+.25*ndl),clamp(foam,0.,.9));',
    'float fg=smoothstep(uFogN,uFogF,dist);col=mix(col,uFogCol,fg);',
    'gl_FragColor=vec4(col,mix(mix(.55,.93,smoothstep(.4,3.,d)),1.,fg));}'
  ].join('\n');
  // 海面 1 個 draw call;島樹幹 / 冠各 1 群組;灌木 / 沙灘石 / 遠島共用 1 群組(Icosahedron 實例)= 共 4 個 draw call
  function buildIsland(S) {
    const R = srand(20261111), rr = (a, b) => a + (b - a) * R(), pk = a => a[Math.floor(R() * a.length)];
    // 海面:同心圓放射網格(r 0~900 m、12 圈指數分佈;桌機 64 段、手機 32 段),ShaderMaterial 1 個 draw call;見 SEA_VS / SEA_FS
    const SEG = MOBILE ? 32 : 64, RR = [0], sPos = [], sShore = [], sIdx = [];
    for (let k = 0; k < 12; k++) RR.push(4 * Math.pow(225, k / 11));   // 4 m → 900 m 指數分佈
    RR.forEach(r => { for (let s = 0; s < SEG; s++) { const a = s / SEG * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r; sPos.push(x, 0, z); sShore.push(seaShore(x, z, S.waterY)); } });
    for (let k = 0; k < RR.length - 1; k++) for (let s = 0; s < SEG; s++) {
      const a = k * SEG + s, b = k * SEG + (s + 1) % SEG, c = (k + 1) * SEG + s, d = (k + 1) * SEG + (s + 1) % SEG;
      sIdx.push(a, b, c, b, d, c);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
    sg.setAttribute('aShore', new THREE.Float32BufferAttribute(sShore, 1));
    sg.setIndex(sIdx);
    // 地形高度圖:TER.H → 121×121 Luminance(編碼 (h+2)/10),線性濾波、夾緊;buildIsland 時產生一次
    const hd = new Uint8Array(TER.N * TER.N);
    for (let q = 0; q < hd.length; q++) hd[q] = Math.round(clamp((TER.H[q] + 2) / 10, 0, 1) * 255);
    const hmTex = new THREE.DataTexture(hd, TER.N, TER.N, THREE.LuminanceFormat, THREE.UnsignedByteType);
    hmTex.minFilter = hmTex.magFilter = THREE.LinearFilter; hmTex.generateMipmaps = false; hmTex.needsUpdate = true;
    // 海面噪聲貼圖 128²:R = Worley 邊緣(泡沫蕾絲)、G = fbm(微法線 / 細紋)、B = F1;8×8 週期 Worley,確定性亂數
    const nTex = (() => {
      const N = 128, C = 8, rn = srand(20261112), J = [], dat = new Uint8Array(N * N * 4), fb = tnFbm(N, 4, 3, 611);
      for (let q = 0; q < C * C; q++) J.push([rn(), rn()]);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const px = x / N * C, py = y / N * C, ix = Math.floor(px), iy = Math.floor(py);
        let f1 = 9, f2 = 9;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const cx = ix + ox, cy = iy + oy, j = J[((cy + C) % C) * C + (cx + C) % C];
          const dx = cx + j[0] - px, dy = cy + j[1] - py, dd = Math.sqrt(dx * dx + dy * dy);
          if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd;
        }
        const q = (y * N + x) * 4;
        dat[q] = clamp((f2 - f1) / .25, 0, 1) * 255; dat[q + 1] = fb[y * N + x] * 255; dat[q + 2] = clamp(f1, 0, 1) * 255; dat[q + 3] = 255;
      }
      const t = new THREE.DataTexture(dat, N, N, THREE.RGBAFormat);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
      return t;
    })();
    // 低精度裝置降級:2 組波、無蕾絲泡沫;手機 3 組波、1 層泡沫;桌機 6 組波、2 層泡沫 + 焦散
    const lowP = renderer.capabilities.precision !== 'highp', NWU = lowP ? 2 : (MOBILE ? 3 : 6);
    const SEA_L = [70, 28, 12, 5, 2.5, 18], SEA_DIR = [.35, .9, -.6, 1.5, 2.3, -1.9], wpv = [], wav = [];
    for (let q = 0; q < 6; q++) {
      const k = TAU / SEA_L[q], A = .009 * SEA_L[q], Q = Math.min(1, .95 / (k * A * NWU)), dir = SEA_DIR[q];
      wpv.push(Math.cos(dir), Math.sin(dir), k, Math.sqrt(9.81 * k) * .9);   // ω = √(g·k) × 風速係數 .9
      wav.push(q < NWU ? A : 0, Q);
    }
    const sk = sky.material.uniforms;
    seaU = {
      uWP: { value: new Float32Array(wpv) }, uWA: { value: new Float32Array(wav) }, uTime: { value: 0 }, uWaterY: { value: S.waterY },
      uHM: { value: hmTex }, uNoise: { value: nTex }, uCam: { value: new THREE.Vector3() },
      uSunDir: sk.uSunDir, uSunCol: sk.uSunCol, uSkyHor: sk.uHor, uSkyTop: sk.uTop,   // 與天空共用 uniform(太陽方向 / 色、天色)
      uFogCol: { value: scene.fog.color }, uFogN: { value: scene.fog.near }, uFogF: { value: scene.fog.far }
    };
    seaTex = [hmTex, nTex];
    const water = new THREE.Mesh(sg, new THREE.ShaderMaterial({ uniforms: seaU, vertexShader: SEA_VS, fragmentShader: SEA_FS, transparent: true, depthWrite: false,
      defines: { NW: NWU, DESK: !MOBILE && !lowP ? 1 : 0, LACE: lowP ? 0 : 1 } }));
    water.frustumCulled = false; water.renderOrder = 2; water.receiveShadow = false; deco.add(water);
    // 遠島:3 座,位於地形網格外 90~140 m;沙底 + 草丘(低面數、不投影、不碰撞)
    const IG = new THREE.IcosahedronGeometry(1, 0), misc = [];
    [[30, 96], [140, 118], [250, 128]].forEach(([deg, r]) => {
      const a = deg * Math.PI / 180, x = Math.cos(a) * r, z = Math.sin(a) * r;
      misc.push([x, S.waterY - .3, z, 0, 14, .9, 14, 0, 0, 0xe6d096]);
      misc.push([x + rr(-2, 2), S.waterY + .6, z + rr(-2, 2), rr(0, 3), 8.5, 3.6, 8.5, 0, 0, 0x5f9a3a]);
    });
    // 樹:固定表 ISLAND_TREES(多人一致);手機取前 34 棵、桌機 60 棵;樹幹碰撞 r .6
    const NT = MOBILE ? 34 : ISLAND_TREES.length;
    const TRUNK = [0x6b4f36, 0x7a5a3c], LEAF_D = [0x2f6b2c, 0x3a7a34], LEAF_L = [0x5fa04a, 0x74b04e], BUSH = [0x3a7a34, 0x4f8a3a, 0x5fa04a];
    const trunksI = [], canI = [];
    for (let q = 0; q < NT; q++) {
      const x = ISLAND_TREES[q][0], z = ISLAND_TREES[q][1], g = terrainH(x, z), h = rr(4, 6.5), t = rr(.55, .75), L = 2 + Math.floor(R() * 2);   // 粗樹幹 + 2~3 層扁球冠(深淺綠)
      trunksI.push([x, g + h / 2, z, 0, t, h, t, 0, 0, pk(TRUNK)]); col(x, z, .6);
      for (let k = 0; k < L; k++) { const cr = rr(2.2, 3) * (1 - k * .2); canI.push([x + rr(-.4, .4), g + h - .8 + k * 1.1, z + rr(-.4, .4), rr(0, 3), cr, cr * .62, cr, 0, 0, k === L - 1 ? pk(LEAF_L) : pk(LEAF_D)]); }
    }
    // 木屋 / 岩 / 船 / 漂流木:BOX(方塊群組,1 個 draw call)與 ROCKS_I(多面體群組,1 個 draw call)
    const BOX = [], box = (x, y, z, sx, sy, sz, c, rx, rz, ry) => BOX.push([x, y, z, ry || 0, sx, sy, sz, rx || 0, rz || 0, c]);
    const ROCKS_I = [];
    // 牆:沿線每 ~1.2 m 一顆 r .7 碰撞圈(skip 為門口)
    const wallCols = (ax, az, bx, bz, skip) => { const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 1.2)); for (let i = 0; i <= n; i++) { const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n; if (!skip || !skip(x, z)) col(x, z, .7); } };
    const RX = Math.atan(.35), DKW = 0x4a3524, ROOF = 0x5e452d;   // 屋頂坡度 .35(約 19°)
    // 木屋(yaw 0,6×5 m):地板、四面牆(前牆門口 ±1.1 m)、門楣、後牆右段破損、屋脊與兩面斜頂(一面缺角)
    ISLAND_HUTS.forEach(([hx, hz]) => {
      const g = terrainH(hx, hz), wood = pk([0x7a5a3c, 0x6b4e30, 0x5e452d]);
      box(hx, g + .06, hz, 5.6, .12, 4.6, DKW);
      box(hx - 2.05, g + 1.2, hz - 2.5, 1.9, 2.4, .2, wood); box(hx + 2.05, g + 1.2, hz - 2.5, 1.9, 2.4, .2, wood);
      box(hx, g + 2, hz - 2.5, 2.2, .8, .2, wood);
      box(hx - 1.3, g + 1.2, hz + 2.5, 3.4, 2.4, .2, wood); box(hx + 1.7, g + .65, hz + 2.5, 2.6, 1.3, .2, wood);
      box(hx - 3, g + 1.2, hz, .2, 2.4, 5, wood);
      box(hx + 3, g + 1.2, hz - .95, .2, 2.4, 3.1, wood); box(hx + 3, g + .5, hz + 1.75, .2, 1, 1.5, wood);
      box(hx, g + 3.5, hz, 6.4, .14, .14, DKW);
      box(hx, g + 2.94, hz + 1.6, 6.4, .12, 3.3, ROOF, RX);
      box(hx - 1.2, g + 2.94, hz - 1.6, 3.6, .12, 3.3, ROOF, -RX);
      wallCols(hx - 3, hz - 2.5, hx + 3, hz - 2.5, x => Math.abs(x - hx) < 1.1);
      wallCols(hx - 3, hz + 2.5, hx + 3, hz + 2.5);
      wallCols(hx - 3, hz - 2.5, hx - 3, hz + 2.5);
      wallCols(hx + 3, hz - 2.5, hx + 3, hz + 2.5);
    });
    // 岩群:每顆一個多面體(中心沉入地面 .4·高);碰撞 r = 半徑 × .75
    ISLAND_ROCKS.forEach(([x, z, s, sy]) => { const g = terrainH(x, z); ROCKS_I.push([x, g + sy * .4, z, rr(0, 3), s, sy, s, 0, 0, pk([0x6f6a5c, 0x7d7868, 0x5f5a4e])]); col(x, z, s * .75); });
    // 擱淺小船:船身 + 歪斜桅桿;碰撞 r 1.6
    ISLAND_BOATS.forEach(([x, z, yaw]) => { const g = terrainH(x, z); box(x, g + .45, z, 4.4, .9, 1.7, 0x6b4e30, .12, 0, yaw); box(x, g + 1.6, z, .14, 2.8, .14, DKW, 0, .25, yaw); col(x, z, 1.6); });
    // 漂流木:灰褐圓木(方塊近似)+ 兩段樹枝;平台高 .8 m(跳得過,走路會被擋);onHill 免除平地檢查
    ISLAND_DRIFT.forEach(([x, z, yaw, L]) => {
      const g = terrainH(x, z), top = g + .8, LOG = pk([0x5a4833, 0x4e3e2c]);
      box(x, g + .4, z, L, .8, .64, LOG, 0, 0, yaw);
      [-.3, .2].forEach(f => box(x + f * L * Math.cos(yaw), top + .18, z - f * L * Math.sin(yaw), .08, .45, .08, DKW, .5, 0, yaw));
      addPlatform({ kind: 'box', x, z, hx: L / 2, hz: .32, yaw, top, deco: true, onHill: true });
    });
    // 灌木(陸地,無碰撞)、沙灘邊小石(水線附近,無碰撞)
    for (let i = 0, t = 0, NB = MOBILE ? 24 : 40; i < NB && t < 800; t++) {
      const a = rr(0, TAU), r = rr(6, 36), x = Math.cos(a) * r, z = Math.sin(a) * r, y = terrainH(x, z);
      if (y < S.waterY + .5) continue; i++;
      const s = rr(1, 1.8); misc.push([x, y + s * .3, z, rr(0, 3), s, s * .7, s, 0, 0, pk(BUSH)]);
    }
    for (let i = 0, t = 0, NS = MOBILE ? 16 : 30; i < NS && t < 800; t++) {
      const a = rr(0, TAU), r = rr(10, 38), x = Math.cos(a) * r, z = Math.sin(a) * r, y = terrainH(x, z);
      if (y < S.waterY - .25 || y > S.waterY + .45) continue; i++;
      const s = rr(.35, .8); misc.push([x, y + s * .15, z, rr(0, 3), s * rr(1, 1.4), s * .7, s, 0, 0, pk([0x8a8478, 0x9a9488, 0x7a7468])]);
    }
    inst(IG, mat(0xffffff, { roughness: 1 }), misc, false);
    inst(new THREE.BoxGeometry(1, 1, 1), mat(0xffffff, { roughness: 1 }), BOX);
    inst(new THREE.DodecahedronGeometry(1, 0), mat(0xffffff, { roughness: 1 }), ROCKS_I);
    inst(new THREE.CylinderGeometry(.8, 1, 1, 6), mat(0xffffff, { roughness: 1 }), trunksI);
    inst(new THREE.IcosahedronGeometry(1, 1), mat(0xffffff, { roughness: 1 }), canI);
  }
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
    BRAZIERS.length = 0; BUSHES.length = 0; FOGZ.length = 0; fogState = null; seaU = null; seaTex.forEach(t => t.dispose()); seaTex = [];
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
    const cl = S.cloud; u.uCloudOn.value = cl && cl.on && !S.indoor ? 1 : 0;
    u.uAtmo.value = S.atmo ? 1 : 0;   // 大氣模式只給海島(world.js sky 的 uAtmo)
    if (cl) { u.uCover.value = cl.cover; u.uCloudLit.value.setRGB(cl.lit[0], cl.lit[1], cl.lit[2]); u.uCloudShade.value.setRGB(cl.shade[0], cl.shade[1], cl.shade[2]); }
    skyStars.visible = skyMoon.visible = !!S.stars;
    hemi.color.setHex(S.hemi[0]); hemi.groundColor.setHex(S.hemi[1]); hemi.intensity = S.hemi[2];
    moonLight.color.setHex(S.dir[0]); moonLight.intensity = S.dir[1];
    window.SUNOFF.x = S.sun[0]; window.SUNOFF.y = S.sun[1]; window.SUNOFF.z = S.sun[2];
    window.WATER_Y = S.waterY == null ? null : S.waterY; groundRing.visible = S.waterY == null;   // 水面:game.js terrainBlocked 讀 WATER_Y(海 = 牆);島戰場隱藏外圍草環
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
    [...document.querySelectorAll('#sceneBar button[data-scene]')].forEach((b, k) => b.classList.toggle('on', k === i));
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
    if (seaU) { seaU.uTime.value += dt; seaU.uCam.value.copy(camera.position); seaU.uFogN.value = scene.fog.near; seaU.uFogF.value = scene.fog.far; }   // 海面 shader:時間與視點(島戰場)
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
  // 單一場地時不建場地按鈕(只留畫質鈕);多筆時照舊逐一建立
  if (SCENES.length > 1) SCENES.forEach((s, k) => { const b = document.createElement('button'); b.dataset.scene = k; b.textContent = s.name; b.onclick = () => setScene(k); bar.appendChild(b); });
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
  setScene(SCENES[start] ? start : 0);
})();
