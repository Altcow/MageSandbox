'use strict';
// 小地圖(設計_介面與畫風改版 §2-5):右上角圓形 2D canvas。底圖(地形高度色帶 + 水 + 場地邊界)進場景時畫一次,每 100 ms 依鏡頭方向旋轉重畫;
// 中心畫自己的箭頭,其他玩家畫職業色點。隱藏規則(潛行 / 煙霧彈 / 草叢 / 霧中 / 致盲)沿用 remote.js 的 netSeen 判定,結果存在 RemotePlayer.mapVis,這裡只讀不重算。
// 預設只在多人對戰(window.NETON)顯示;單人由 P 面板「小地圖」勾選(localStorage mageSandbox.minimap = '1')。
// 依賴(全域):world.js(terrainH、bandColor、ARENA_R)、scenes.js(getSceneCfg)、game.js(G、mage)、remote.js(REMOTES)、classes.js(clsHex)。載入順序:remote.js 之後。
(function () {
  const K = 3;                               // 底圖解析度:每公尺 3 px
  const VR = 26;                             // 顯示半徑(公尺)
  const MM_BANDS_FALLBACK = [.42, .55, .35]; // 場景沒設色帶時的底色
  let box = null, cv = null, cx = null, base = null, baseKey = null, baseR2 = 0, sizeCss = 0, dpr = 1;

  function on() {
    if (document.body.classList.contains('cover')) return false;
    if (window.NETON) return true;
    try { return localStorage.getItem('mageSandbox.minimap') === '1'; } catch (e) { return false; }
  }
  function ensureBox() {
    if (box) return;
    box = document.createElement('div'); box.id = 'miniMap'; box.style.display = 'none';
    cv = document.createElement('canvas'); box.appendChild(cv); document.body.appendChild(box);
    cx = cv.getContext('2d');
  }
  function fit() {
    const s = document.body.classList.contains('touch') ? 92 : 120, d = Math.min(2, window.devicePixelRatio || 1);
    if (s === sizeCss && d === dpr) return;
    sizeCss = s; dpr = d; cv.width = cv.height = Math.round(s * d); cv.style.width = cv.style.height = s + 'px';
  }
  // 底圖(北方朝上):範圍 [-R2, R2]²,R2 = 場地半徑 + 3
  function drawBase() {
    const cfg = typeof getSceneCfg === 'function' ? getSceneCfg() : null, R = ARENA_R;
    baseR2 = R + 3; baseKey = { cfg: cfg, R: R };
    const n = Math.ceil(baseR2 * 2 * K), bands = cfg && cfg.terrainLook ? cfg.terrainLook.bands : null, wy = window.WATER_Y;
    if (!base) base = document.createElement('canvas');
    base.width = base.height = n;
    const g = base.getContext('2d'), img = g.createImageData(n, n), d = img.data, col = new THREE.Color();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (i + .5) / K - baseR2, z = (j + .5) / K - baseR2, k = (j * n + i) * 4, h = terrainH(x, z);
      let r, gg, b;
      if (wy != null && h < wy) { const t = Math.min(1, (wy - h) / 1.5); r = 60 - 30 * t; gg = 130 - 50 * t; b = 190 - 50 * t; }
      else if (bands && bands.length) { bandColor(bands, h, col); r = col.r * 255; gg = col.g * 255; b = col.b * 255; }
      else { r = MM_BANDS_FALLBACK[0] * 255; gg = MM_BANDS_FALLBACK[1] * 255; b = MM_BANDS_FALLBACK[2] * 255; }
      if (Math.hypot(x, z) > R) { r *= .3; gg *= .3; b *= .35; }   // 場地外壓暗
      d[k] = r; d[k + 1] = gg; d[k + 2] = b; d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(255,230,140,.9)'; g.lineWidth = 1.5 * K / 1.5; g.beginPath(); g.arc(baseR2 * K, baseR2 * K, R * K, 0, Math.PI * 2); g.stroke();   // 場地邊界
  }
  function tick() {
    ensureBox();
    const show = on();
    document.body.classList.toggle('mm', show);
    box.style.display = show ? '' : 'none';
    if (!show || typeof mage === 'undefined' || typeof G === 'undefined') return;
    fit();
    const cfg = typeof getSceneCfg === 'function' ? getSceneCfg() : null;
    if (!baseKey || baseKey.cfg !== cfg || baseKey.R !== ARENA_R) drawBase();
    const S = cv.width, c = S / 2, sc = c / VR, p = mage.root.position, yaw = G.camYaw;
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, S, S);
    cx.save(); cx.beginPath(); cx.arc(c, c, c - 1, 0, Math.PI * 2); cx.clip();
    cx.fillStyle = '#0c1226'; cx.fillRect(0, 0, S, S);
    cx.translate(c, c); cx.rotate(yaw); cx.scale(sc, sc);   // 世界 x 軸 → 畫面 (cos yaw, sin yaw),鏡頭前方朝上
    cx.drawImage(base, -baseR2 - p.x, -baseR2 - p.z, baseR2 * 2, baseR2 * 2);
    cx.restore();
    // 其他玩家:只畫 mapVis 為真者(隱藏規則見 remote.js netSeen);超出顯示範圍的貼在圓邊
    const cs = Math.cos(yaw), sn = Math.sin(yaw), dotR = Math.max(2.5, S * .034);
    if (window.NETON && typeof REMOTES !== 'undefined') for (const k in REMOTES) {
      const rp = REMOTES[k]; if (!rp.mapVis || rp.dead) continue;
      const dx = rp.px - p.x, dz = rp.pz - p.z;
      let sx = (dx * cs - dz * sn) * sc, sy = (dx * sn + dz * cs) * sc;
      const m = Math.hypot(sx, sy), lim = c - dotR - 2, far = m > lim; if (far) { sx *= lim / m; sy *= lim / m; }
      cx.globalAlpha = far ? .6 : 1; cx.fillStyle = rp._clsHex || clsHex(rp.cls); cx.strokeStyle = '#fff'; cx.lineWidth = Math.max(1, S * .014);
      cx.beginPath(); cx.arc(c + sx, c + sy, dotR, 0, Math.PI * 2); cx.fill(); cx.stroke(); cx.globalAlpha = 1;
    }
    // 自己:箭頭(朝向 = 角色面向相對鏡頭前方)
    const ar = S * .07;
    cx.save(); cx.translate(c, c); cx.rotate(Math.PI - (mage.yaw - yaw));
    cx.fillStyle = '#ffe14a'; cx.strokeStyle = '#1a1a1a'; cx.lineWidth = Math.max(1, S * .018);
    cx.beginPath(); cx.moveTo(0, -ar); cx.lineTo(ar * .75, ar * .8); cx.lineTo(0, ar * .4); cx.lineTo(-ar * .75, ar * .8); cx.closePath(); cx.fill(); cx.stroke();
    cx.restore();
    cx.strokeStyle = 'rgba(120,160,255,.7)'; cx.lineWidth = Math.max(2, S * .025); cx.beginPath(); cx.arc(c, c, c - cx.lineWidth / 2, 0, Math.PI * 2); cx.stroke();   // 外框
  }
  window.mmRefresh = tick;
  setInterval(tick, 100);
})();
