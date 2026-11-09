# world.js 套用說明:暫時性隕石坑(地形變形)

對象:`js/world.js`。配套檔:`js/sp_fire_crater.js`(隕石墜擊、坑洞生命週期與外觀)。
本檔只描述要加進 world.js 的程式;寫手沒有改動 world.js。依設計 7-4 與第 8 節,階段 0 的寫手也會改 `setTerrain` 與 `Dummy`,合併時以本檔的 `setTerrain` 為準(已包含階段 0 要求的 `TER.H0` / `TER.C0` / 原旗標儲存,不要重複加)。

## 設計要點

- 坑洞是**疊加在原地形上的偏移**。原地形存在 `TER.H0`(setTerrain 寫入),`TER.H` 為「原地形 + 所有坑洞偏移」的結果,`terrainH` 仍讀 `TER.H`,因此玩家、鏡頭、子彈、標靶、滑鼠取點都自動生效。
- 只重算受影響的格點範圍(坑中心 ±1.6R 再外擴 1 格),並只上傳那幾列頂點(`BufferAttribute.updateRange`)。
- **`terrainH` 本身不需要改。** 設計 7-4 的「terrainH 讀取坑洞列表」在此以「格點重建」實作:若 terrainH 另外用解析式疊加坑洞,玩家碰撞會與網格視覺不一致(網格是三角形內插)。因此 terrainH 只讀已含坑洞的 `TER.H`。
- `TER.flat` 在有坑時必須為 false(否則 terrainH 直接回傳 0)。`refreshTerFlags()` 負責依坑洞更新旗標。

## 坑洞紀錄欄位(由 sp_fire_crater.js 的 addCrater 建立)

`{ x, z, R, D, k, hold, t, age, phase, zone, bb, glow, emT, smT, onClear }`

- `x, z`:中心;`R`:半徑 Rc;`D`:坑深(m);`k`:0~1 形成 / 恢復係數;`bb`:格點範圍 `[i0, j0, i1, j1]`
- `zone`:addSlowZone 回傳的減速區(world.js 階段 0);`onClear(c)`:清除外觀(clearCraters 會呼叫)

---

## 1. 插入位置:`const TER = { ... };` 那一行之後(在 `const TER_MAX_TAN` 之前)

```js
TER.H0 = new Float32Array(TER.N * TER.N);              // 原地形高度(setTerrain 寫入),坑洞疊加的基準
TER.C0 = new Float32Array(TER.N * TER.N * 3).fill(1);  // 原頂點色(setTerrain 寫入)
TER.flat0 = true; TER.hMin0 = 0; TER.hMax0 = 0;        // 原地形旗標
TER.dirtyJ0 = 1e9; TER.dirtyJ1 = -1;                   // 本幀待上傳的列範圍(flushTer 清空)
const CRATERS = [];   // 暫時坑洞列表;由 sp_fire_crater.js 的 addCrater / updateCraters 維護,clearCraters 以 length = 0 清空(不可換成新陣列)
```

## 2. 插入位置:`terrainH` 函式之後(在 `function groundNormal` 之前)

新增以下函式(terrainH 本身不改)。

```js
// 單一坑洞在 (x,z) 的高度偏移(已乘 k):碗狀 −D·(1−u²)²(u<1)+ 坑緣隆起
function craterOff(c, x, z) {
  const d = Math.hypot(x - c.x, z - c.z), u = d / c.R;
  const bowl = u < 1 ? -c.D * Math.pow(1 - u * u, 2) : 0;
  const rim = 0.2 * c.D * Math.exp(-Math.pow((d - 1.05 * c.R) / (0.18 * c.R), 2));
  return (bowl + rim) * c.k;
}
// 旗標:無坑 → 還原原地形旗標;有坑 → 非平地,hMin / hMax 併入坑底與坑緣
function refreshTerFlags() {
  if (!CRATERS.length) { TER.flat = TER.flat0; TER.hMin = TER.hMin0; TER.hMax = TER.hMax0; return; }
  let lo = TER.hMin0, hi = TER.hMax0;
  for (const c of CRATERS) { lo = Math.min(lo, -c.D * c.k); hi = Math.max(hi, 0.2 * c.D * c.k); }
  TER.hMin = lo; TER.hMax = hi; TER.flat = false;
}
// 只重算格點範圍 [i0..i1] × [j0..j1]:高度 = H0 + 所有坑洞偏移;法線與頂點色重算範圍外擴一格
// 不呼叫 computeVertexNormals(整張太慢)。結果先標記為待上傳,由 flushTer 每幀上傳一次
function rebuildTer(i0, j0, i1, j1) {
  const N = TER.N, H = TER.H, H0 = TER.H0, C0 = TER.C0, geo = ground.geometry;
  const pos = geo.attributes.position, nrm = geo.attributes.normal, col = geo.attributes.color;
  i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(N - 1, i1); j1 = Math.min(N - 1, j1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * N + i, x = TER.X0 + i * TER.CELL, z = TER.X0 + j * TER.CELL;
    let off = 0; for (const c of CRATERS) off += craterOff(c, x, z);
    H[k] = H0[k] + off; pos.setY(k, H[k]);
  }
  const a0 = Math.max(0, i0 - 1), a1 = Math.min(N - 1, i1 + 1), b0 = Math.max(0, j0 - 1), b1 = Math.min(N - 1, j1 + 1);
  for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) {
    const k = j * N + i, x = TER.X0 + i * TER.CELL, z = TER.X0 + j * TER.CELL;
    const hl = H[j * N + Math.max(0, i - 1)], hr = H[j * N + Math.min(N - 1, i + 1)];
    const hd = H[Math.max(0, j - 1) * N + i], hu = H[Math.min(N - 1, j + 1) * N + i];
    const nx = hl - hr, nz = hd - hu, L = Math.sqrt(nx * nx + 4 + nz * nz);
    nrm.setXYZ(k, nx / L, 2 / L, nz / L);                      // 與 groundNormal 同一約定(span = 1)
    let sc = 0;                                                 // 焦黑:坑內與坑緣附近
    for (const c of CRATERS) sc = Math.max(sc, c.k * clamp((1.2 * c.R - Math.hypot(x - c.x, z - c.z)) / (0.5 * c.R), 0, 1));
    const f = 1 - 0.6 * sc;
    col.setXYZ(k, C0[k * 3] * f, C0[k * 3 + 1] * f, C0[k * 3 + 2] * f);
  }
  TER.dirtyJ0 = Math.min(TER.dirtyJ0, b0); TER.dirtyJ1 = Math.max(TER.dirtyJ1, b1);
  refreshTerFlags();
}
// 上傳本幀變動的列(position / normal / color 三個屬性,整列連續,offset 與 count 以陣列元素計)
function flushTer() {
  if (TER.dirtyJ1 < TER.dirtyJ0) return;
  const N = TER.N, j0 = TER.dirtyJ0, j1 = TER.dirtyJ1, geo = ground.geometry;
  for (const name of ['position', 'normal', 'color']) {
    const a = geo.attributes[name];
    a.updateRange = { offset: j0 * N * a.itemSize, count: (j1 - j0 + 1) * N * a.itemSize };
    a.needsUpdate = true;
  }
  TER.dirtyJ0 = 1e9; TER.dirtyJ1 = -1;
}
// 清空所有坑洞(setTerrain 換場景時呼叫):拿掉減速區與外觀,列表清空
function clearCraters() {
  CRATERS.forEach(c => { if (c.zone && typeof removeSlowZone === 'function') removeSlowZone(c.zone); if (c.onClear) c.onClear(c); });
  CRATERS.length = 0;
}
```

## 3. 取代整個 `setTerrain`(階段 0 的 `H0 / C0` 儲存與本段合併為此版本)

以下為**完整替換**原 `function setTerrain(feats, look) { ... }`。與原版差異:開頭 `clearCraters()`;寫入 `TER.H0` / `TER.C0` / 原旗標;結尾把 updateRange 還原為全量(避免之後的全量更新只上傳到局部範圍)。

```js
function setTerrain(feats, look) {
  clearCraters();                                   // 換場景:坑立即消失(減速區、外觀一併移除)
  feats = feats || []; look = look || {};
  const N = TER.N, H = TER.H, geo = ground.geometry, pos = geo.attributes.position, col = geo.attributes.color;
  let lo = 0, hi = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, h = feats.length ? evalTerrain(feats, TER.X0 + i * TER.CELL, TER.X0 + j * TER.CELL) : 0;
    H[k] = h; pos.setY(k, h); if (h < lo) lo = h; if (h > hi) hi = h;
  }
  TER.hMin = lo; TER.hMax = hi; TER.flat = hi - lo < 1e-6;
  TER.H0.set(H); TER.hMin0 = lo; TER.hMax0 = hi; TER.flat0 = TER.flat;
  pos.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
  const nrm = geo.attributes.normal, cc = new THREE.Color(look.cliff == null ? 0xffffff : look.cliff), dk = look.dark || 0;
  for (let k = 0; k < N * N; k++) {
    const st = clamp((.8 - nrm.getY(k)) / .3, 0, 1), sh = 1 - dk * clamp(-H[k] / 4, 0, 1);
    col.setXYZ(k, lerp(1, cc.r, st) * sh, lerp(1, cc.g, st) * sh, lerp(1, cc.b, st) * sh);
  }
  col.needsUpdate = true;
  TER.C0.set(col.array);
  for (const a of [pos, nrm, col]) a.updateRange = { offset: 0, count: -1 };   // 全量上傳(-1 = 整個陣列)
}
```

## 4. game.js 的 `updateWorld`(不在 world.js,但坑洞每幀入口在這裡)

階段 0 的寫手依第 8 節會加入;若沒有,請加在 `for (const d of DUMMIES) d.update(dt);` **之前**,讓標靶與玩家讀到本幀的地形:

```js
  if (typeof updateCraters === 'function') updateCraters(dt);
```

## 5. 不需要改的地方(已確認)

- `terrainH`、`groundNormal`、`rayTerrain`、`surfaceY`、`groundAt`:都讀 `TER.H` / `TER.flat` / `hMin` / `hMax`,由上面的函式維護即可。
- `checkTerrain`:只做警告,坑洞期間不影響。
- `updateCamera`:用 `terrainH` 與 `TER.flat` 防穿地,自動生效。
- `ground` 的 `computeBoundingSphere` 沒有在坑洞期間重算;坑只會在地面範圍內變形,視錐裁切不受影響。

## 6. 未套用本 patch 時的行為

- `CRATERS` 未定義:sp_fire_crater.js 改用自己的空陣列(`cr_list`),坑洞仍有減速區、焦橘光暈與煙火,但地形不變形。
- `rebuildTer` / `flushTer` / `refreshTerFlags` 未定義:同上,只跳過地形更新。
- `setTerrain` 未替換:`TER.H0` 不存在,`rebuildTer` 會報錯;**套用本 patch 時必須同時替換 setTerrain**。

## 7. 已知限制

- 坑只改地形格點,不改平台(`PLATFORMS`)。若隕石落在高台上(`P.target.y` 高於基礎地形),坑會挖在高台下方的基礎地形,高台本身不動。
- 坑洞 hold 期間不重算網格(effect 穩定);恢復期間每幀重算約 25×25 格、上傳約 25 列。
- 隕石落下途中若換場景,撞擊後仍會在新場景加入一個坑(7-6 未規定,暫不處理)。
