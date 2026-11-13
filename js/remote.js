'use strict';
// 多人對戰:遠端角色 RemotePlayer、REMOTES、快照編碼 packSnap / unpackSnap(設計 §9-3)、內插(§2-2、§2-3)、
// 進出對戰(§6-3)、出生點(§5-3)、開戰倒數與鎖定(§5-1)。
// 依賴(全域):net.js 的 Net(setSnap / snapOf / roundOf)、world.js(DUMMIES、COLLIDERS、terrainH、surfaceY、nearPlatform、layFlat、scene)、
//   game.js(G、camera、mage、cancelCharge)、mage.js(Mage)、classes.js(CLASSES、auraOf)、fx.js(glowSprite、clamp、lerp、angDiff、V3)。
// 載入順序:net.js 之後、cover.js 之前。單人模式 window.NETON 為 false,netTick 不被呼叫,行為不變。
window.NETON = false;
window.NET_LOCK = false;
const REMOTES = {};              // 座位(字串)→ RemotePlayer
const SNAP_CHARS = 25;           // 快照字元數:150 位元 = 25 個 base64url 字元(142 位元 + 狀態欄 e 8 位元;g 為 14 位元;協定變更,NET_BUILD 須提升)
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const TAU = Math.PI * 2;
const NAME_COLORS = ['#ffd27a', '#8fd0ff', '#ff8a8a', '#b8f08a', '#ffa8e0', '#a8fff0', '#d0a8ff', '#ffe08a', '#8affb0', '#ff9a5a', '#9ab0ff', '#e0e0e0'];
const SPAWN_PTS = [[0, 22], [12.6, 18], [20.7, 7.5], [21.3, -5.7], [-21.3, -5.7], [-20.7, 7.5], [-12.6, 18], [11, -14], [0, -7], [-11, -14], [8, 7], [-8, 7]];

let spawnPts = [];               // 本場合格的出生點(enterMatch 時算好)
let sendAcc = 0, sendSeq = 0, roundT0 = 0, cdLast = '', cdEl = null, stashed = null;
let BLOB_GEO = null, BLOB_MAT = null, FOOT_RING_GEO = null;

/* ================= 快照編碼(§9-3):欄位依序位元打包,再轉 base64url ================= */
const qn = (v, lo, hi, bits) => Math.round(clamp((v - lo) / (hi - lo), 0, 1) * ((1 << bits) - 1));
const dq = (q, lo, hi, bits) => lo + q / ((1 << bits) - 1) * (hi - lo);
const qOpt = v => (v < 0 ? 0 : 1 + Math.round(clamp(v, 0, 1) * 30));   // -1(不用)→ 0;0~1 → 1~31
const dOpt = q => (q === 0 ? -1 : (q - 1) / 30);
const qYaw = v => Math.round((((v % TAU) + TAU) % TAU) / TAU * 256) & 255;
const dYaw = q => q / 256 * TAU;

// o:{n 序號, tm 送出時間(ms), x y z, r 朝向, m 走跑, c 施法, k 後座, q 集氣, o 翻滾進度(-1 無), p 翻滾方向, f 空翻(-1 無),
//    s 打坐, d 倒地, g 旗標, hp, sh 護盾, w 法杖 0 / 書 1, tp 傳送計數, e 狀態欄(3 位元控制碼 + 5 旗標,見 status.js stCode / stFlags)}
function packSnap(o) {
  const bits = [], put = (v, k) => { for (let i = k - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  put(o.n & 255, 8);
  put(Math.round(o.tm) & 65535, 16);
  put(qn(o.x, -64, 64, 13), 13); put(qn(o.z, -64, 64, 13), 13); put(qn(o.y, -10, 30, 11), 11);
  put(qYaw(o.r), 8);
  put(qn(o.m, 0, 2, 4), 4); put(qn(o.c, 0, 1, 4), 4); put(qn(o.k, 0, 1, 4), 4); put(qn(o.s, 0, 1, 4), 4); put(qn(o.d, 0, 1, 4), 4);
  put(qn(o.q, 0, 1, 5), 5);
  put(qOpt(o.o), 5);
  put(qn(o.p, -Math.PI, Math.PI, 6), 6);
  put(qOpt(o.f), 5);
  put(o.g & 16383, 14);
  put(clamp(Math.round(o.hp), 0, 127), 7);
  put(clamp(Math.round(o.sh || 0), 0, 63), 6);
  put(o.w ? 1 : 0, 1);
  put((o.tp | 0) & 15, 4);
  put((o.e | 0) & 255, 8);
  while (bits.length % 6) bits.push(0);
  let s = '';
  for (let i = 0; i < bits.length; i += 6) { let v = 0; for (let j = 0; j < 6; j++) v = v * 2 + bits[i + j]; s += B64[v]; }
  return s;
}
// 回傳欄位物件(與 packSnap 的 o 同名,但 q/o/f/p 已還原;t 為接收端估計的送出時間);格式錯誤回 null
function unpackSnap(str, nowRef) {
  if (typeof str !== 'string' || str.length !== SNAP_CHARS) return null;
  const bits = [];
  for (let i = 0; i < str.length; i++) { const v = B64.indexOf(str[i]); if (v < 0) return null; for (let j = 5; j >= 0; j--) bits.push((v >> j) & 1); }
  let pos = 0;
  const get = k => { let v = 0; for (let i = 0; i < k; i++) v = v * 2 + bits[pos++]; return v; };
  const o = {};
  o.n = get(8);
  const tm = get(16);
  o.x = dq(get(13), -64, 64, 13); o.z = dq(get(13), -64, 64, 13); o.y = dq(get(11), -10, 30, 11);
  o.r = dYaw(get(8));
  o.m = dq(get(4), 0, 2, 4); o.c = dq(get(4), 0, 1, 4); o.k = dq(get(4), 0, 1, 4); o.s = dq(get(4), 0, 1, 4); o.d = dq(get(4), 0, 1, 4);
  o.q = dq(get(5), 0, 1, 5);
  o.o = dOpt(get(5));
  o.p = dq(get(6), -Math.PI, Math.PI, 6);
  o.f = dOpt(get(5));
  o.g = get(14);
  o.hp = get(7); o.sh = get(6);
  o.w = get(1);
  o.tp = get(4);
  o.e = get(8);
  if (nowRef != null) { let d = (nowRef - tm) % 65536; if (d < 0) d += 65536; if (d >= 32768) d -= 65536; o.t = nowRef - d; }
  else o.t = 0;
  return o;
}
window.packSnap = packSnap;
window.unpackSnap = unpackSnap;

/* ================= 送出與內插的共用參數 ================= */
// 送出頻率分級(12 人效能,派工單 C-①):2~4 人固定 10 Hz(維持現況);5 人以上依「離我最近的遠端」距離分級:
//   < 20 m 10 Hz、20~40 m 5 Hz、> 40 m 2.5 Hz。距離對稱,本端取最近者的頻率即涵蓋所有收端的需要。分級有 2 m 滯後,避免邊界來回切換。
// 內插緩衝改由各收端依對方的實測送出間隔決定(RemotePlayer.delayMs),不再全域共用。
const NET_TIER = { near: 20, mid: 40, hyst: 2, hz: [8, 5, 2.5], lodFar: 40, nameFade: [30, 45] };
let netTierLv = 0;
function sendHz() {
  if (Object.keys(REMOTES).length + 1 <= 4) return 10;
  const me = mage.root.position;
  let d = Infinity;
  for (const k in REMOTES) { const rp = REMOTES[k], dd = Math.hypot(rp.px - me.x, rp.pz - me.z); if (dd < d) d = dd; }
  const edge = [NET_TIER.near, NET_TIER.mid];
  let lv = netTierLv;
  while (lv < 2 && d >= edge[lv] + NET_TIER.hyst) lv++;
  while (lv > 0 && d < edge[lv - 1] - NET_TIER.hyst) lv--;
  netTierLv = lv;
  return NET_TIER.hz[lv];
}

function mixPose(a, b, u) {
  const L = (p, q) => p + (q - p) * u, pick = u < .5 ? a : b;
  return {
    t: L(a.t, b.t), x: L(a.x, b.x), y: L(a.y, b.y), z: L(a.z, b.z), r: a.r + angDiff(a.r, b.r) * u,
    m: L(a.m, b.m), c: L(a.c, b.c), k: L(a.k, b.k), q: L(a.q, b.q), s: L(a.s, b.s), d: L(a.d, b.d), sh: L(a.sh, b.sh),
    o: (a.o < 0 || b.o < 0) ? pick.o : L(a.o, b.o), f: (a.f < 0 || b.f < 0) ? pick.f : L(a.f, b.f), p: pick.p,
    g: pick.g, hp: pick.hp, w: pick.w, tp: pick.tp, e: pick.e
  };
}
// 超過最新一則時依最後兩則速度外插(最多 200 ms),之後停住
function extrapPose(last, prev, e) {
  const k = prev ? e / Math.max(1, last.t - prev.t) : 0;
  return Object.assign({}, last, { x: last.x + (last.x - (prev ? prev.x : last.x)) * k, y: last.y + (last.y - (prev ? prev.y : last.y)) * k, z: last.z + (last.z - (prev ? prev.z : last.z)) * k });
}

/* ================= 共用資源(第一次建立角色時才產生) ================= */
function blobShared() {
  if (BLOB_MAT) return;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  BLOB_GEO = new THREE.CircleGeometry(.55, 16);
  BLOB_MAT = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: .45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
}
// 名牌(設計_介面與畫風改版 §3-3):深藍圓角膠囊底 + 白字粗外框 + 職業色左側小條;color(座位色)目前不繪製,bar = 職業色字串
function nameTexture(text, color, suffix, bar) {
  const c = document.createElement('canvas'); c.width = 384; c.height = 64;
  const g = c.getContext('2d'), s = suffix ? text + suffix : text;
  let fs = 28; g.font = 'bold ' + fs + 'px sans-serif';
  while (fs > 16 && g.measureText(s).width > 280) { fs -= 2; g.font = 'bold ' + fs + 'px sans-serif'; }
  const tw = g.measureText(s).width, w = Math.min(372, Math.round(tw + 56)), h = 46, x0 = Math.round(192 - w / 2), y0 = 9, r = h / 2;
  g.beginPath(); g.moveTo(x0 + r, y0); g.arcTo(x0 + w, y0, x0 + w, y0 + h, r); g.arcTo(x0 + w, y0 + h, x0, y0 + h, r); g.arcTo(x0, y0 + h, x0, y0, r); g.arcTo(x0, y0, x0 + w, y0, r); g.closePath();
  g.fillStyle = 'rgba(16,24,58,.82)'; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(120,160,255,.55)'; g.stroke();
  g.fillStyle = bar || color; g.beginPath(); g.arc(x0 + 15, y0 + r, 7, 0, Math.PI * 2); g.fill();   // 職業色小條(圓端)
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.lineWidth = 6; g.strokeStyle = 'rgba(8,12,34,.95)'; g.strokeText(s, 204, 33);
  g.fillStyle = '#fff'; g.fillText(s, 204, 33);
  return new THREE.CanvasTexture(c);
}
// 腳下色圈(§3-3):扁平圓環,職業色;bright = 自己用較亮較大的版本。每人一個材質(顏色 / 透明度各自調)
function footRing(hex, bright) {
  if (!FOOT_RING_GEO) FOOT_RING_GEO = new THREE.RingGeometry(.5, .68, 32);
  const col = new THREE.Color(hex); if (bright) col.lerp(new THREE.Color(0xffffff), .35);
  const m = new THREE.Mesh(FOOT_RING_GEO, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: bright ? .95 : .75, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.renderOrder = 2; m.userData.base = bright ? .95 : .75; m.userData.k = bright ? 1.15 : 1; m.visible = false; scene.add(m);
  return m;
}
function placeRing(m, x, y, z, op) {
  const gy = surfaceY(x, z, y + .5), h = Math.max(0, y - gy);
  layFlat(m, x, gy, z, .5, 0, .045); m.scale.setScalar(m.userData.k * (1 - .4 * Math.min(1, h / 3)));
  m.material.opacity = m.userData.base * op; m.visible = op > .01;
}
// 本機角色腳下色圈(game.js frame 每幀呼叫);潛行 / 草叢半透明時跟著淡出,封面時隱藏
let selfRing = null, selfRingCls = '';
function footRingTick() {
  if (!selfRing) selfRing = footRing(0xffffff, true);
  if (selfRingCls !== G.cls) { selfRingCls = G.cls; selfRing.material.color.set(clsHex(G.cls)).lerp(new THREE.Color(0xffffff), .35); }
  const p = mage.root.position;
  if (document.body.classList.contains('cover')) { selfRing.visible = false; return; }
  placeRing(selfRing, p.x, p.y, p.z, clamp(mage.opq, 0, 1) * (G.down > 0 ? .4 : 1));
}
window.footRingTick = footRingTick;
// 觀看者(本機)看某遠端角色時的隱藏判定,remote.js 與 minimap.js 共用(minimap 讀 RemotePlayer.mapVis):
//   inSm 煙霧彈(圈內的人對圈外觀看者半隱形)、hid 草叢隱身(revealed = 集氣 / 出手 / 照亮 / 被打現形中)、blind 自己致盲、fogFar 霧中且 > 10 m;
//   blindFar = 名牌 / 血條要隱藏(致盲 8 m 外、霧中 10 m 外)。d = 觀看者到名牌高度(y + 2.6)的 3D 距離
function netSeen(x, y, z, revealed) {
  const me = mage.root.position, d = Math.hypot(x - me.x, y + 2.6 - me.y, z - me.z);
  const bi = bushAt(x, z, y), myBi = bushAt(me.x, me.z, me.y), blind = G.blindT > 0, fogFar = (fogAt(x, z) || fogAt(me.x, me.z)) && d > 10;
  return {
    inSm: typeof smokeAt === 'function' && smokeAt(x, z) && !smokeAt(me.x, me.z),
    hid: bi >= 0 && bi !== myBi && Math.hypot(x - me.x, z - me.z) > 2.5 && !revealed,
    blind: blind, fogFar: fogFar, blindFar: (blind && d > 8) || fogFar
  };
}
window.netSeen = netSeen;
function disposeTree(o) {
  o.traverse(c => { if (c.geometry && !c.isSprite) c.geometry.dispose(); if (c.material) c.material.dispose(); });
}

/* ================= RemotePlayer:別人的角色(外觀 + 名牌 + 血條 + 假影 + 內插) =================
   介面與 Dummy 相同(DUMMIES 內的物件都要能被法術讀寫):命中 / 位移 / 狀態相關方法在 N3 為空函式,之後的步驟再接命中判定。 */
class RemotePlayer {
  constructor(info, pos) {
    this.seat = info.id; this.name = info.name || '玩家'; this.cls = CLASSES[info.cls] ? info.cls : 'mage'; this.el = info.el || 'fire';
    const C = CLASSES[this.cls];
    this.mage = new Mage(scene);
    this.mage.setClassLook(this.cls);
    this.mage.setWeapon(this.cls === 'mage' ? 'staff' : C.weapons[0], true);
    this.mage.setRobeColor(C.robe);
    this.mage.setElementColor(auraOf(this.cls, this.el).hex);
    this.g = this.mage.root;
    this.mage.olReg();                                                      // 描邊(畫質中 / 高)
    this._noShadow();                                                       // 遠端一律不投影(§2-3)
    blobShared();
    this.shadow = new THREE.Mesh(BLOB_GEO, BLOB_MAT); this.shadow.renderOrder = 1; scene.add(this.shadow);
    const color = NAME_COLORS[(this.seat - 1) % NAME_COLORS.length];
    this._clsHex = clsHex(this.cls); this.nameTex = nameTexture(this.name, color, '', this._clsHex); this._awayT = null; this._offT = null; this._tag = ''; this._color = color; this.mapVis = false;
    this.ring = footRing(this._clsHex, false);
    this.nameSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.nameTex, transparent: true, depthWrite: false }));
    this.nameSpr.scale.set(2.4, .4, 1); this.nameSpr.renderOrder = 30; scene.add(this.nameSpr);
    this.bar = new THREE.Group(); scene.add(this.bar);
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, .2), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: .7, depthTest: false }));
    this.fg = new THREE.Mesh(new THREE.PlaneGeometry(.94, .16), new THREE.MeshBasicMaterial({ color: 0xe03030, depthTest: false }));
    this.shBar = new THREE.Mesh(new THREE.PlaneGeometry(.94, .16), new THREE.MeshBasicMaterial({ color: 0x66c8ff, depthTest: false }));
    bg.renderOrder = 20; this.fg.renderOrder = 21; this.shBar.renderOrder = 22;
    this.fg.position.z = .001; this.shBar.position.z = .002;
    this.bar.add(bg, this.fg, this.shBar);
    this.glow = glowSprite(auraOf(this.cls, this.el).hex, .15, 1); this.glow.visible = false; scene.add(this.glow);

    this.px = pos.x; this.py = surfaceY(pos.x, pos.z, (pos.y || 0) + .5); this.pz = pos.z; this.yaw = Math.atan2(-pos.x, -pos.z);
    this.home = new V3(pos.x, 0, pos.z);
    this.col = { x: pos.x, z: pos.z, r: .4, ref: this };
    this.hp = 100; this.max = 100; this.sh = 0;
    this.dead = true; this.buf = []; this.lastStr = ''; this.lastN = -1; this.lastRecv = 0; this._op = undefined; this._tmp = new V3();
    this.pend = null; this.pendPull = null; this._pullT = 0;   // 待送命中(只記本機攻擊,netcombat.js 每幀送出)
    // 以下欄位給 DUMMIES 的既有程式讀寫(N3 不處理命中)
    this.burn = 0; this.windT = 0; this.hpShow = 0; this.flash = 0; this.slowT = 0; this.slowPct = 0; this.zSlow = 0; this.zHex = 0;
    this.litT = 0; this.stunT = 0; this.erodeT = 0; this.downT = 0; this.downK = 0; this.ox = this.oz = 0;
    this.mage.root.position.set(this.px, this.py, this.pz); this.mage.yaw = this.yaw;
    this.g.visible = false; this.shadow.visible = false; this.ring.visible = false; this.nameSpr.visible = false; this.bar.visible = false; this.glow.visible = false;
  }
  // 內插緩衝 = 1.5 × 對方送出間隔(10 Hz → 150 ms,2.5 Hz → 600 ms)
  delayMs() { return clamp(Math.round((this._iv || 100) * 1.5), 150, 600); }
  get x() { return this.px; }
  get y() { return this.py; }
  get z() { return this.pz; }
  _noShadow() { this.mage.root.traverse(o => { if (o.isMesh) o.castShadow = false; }); }
  _awayTex() { if (!this._awayT) this._awayT = nameTexture(this.name, this._color, '(暫離)', this._clsHex); return this._awayT; }
  _offTex() { if (!this._offT) this._offT = nameTexture(this.name, this._color, '(離線中)', this._clsHex); return this._offT; }
  _ingest(now) {
    const s = Net.snapOf(this.seat);
    if (typeof s !== 'string' || s === this.lastStr) return;
    this.lastStr = s;
    const o = unpackSnap(s, now);
    if (!o) return;
    const stale = !this.buf.length || now - this.lastRecv > 1500;
    if (stale) this.buf.length = 0;
    else { const d = (o.n - this.lastN) & 255; if (d === 0 || d >= 128) return; }   // 亂序或重複的舊快照丟棄
    this.lastN = o.n; this.lastRecv = now;
    const prev = this.buf.length ? this.buf[this.buf.length - 1] : null;
    if (prev) { const dn = (o.n - prev.n) & 255; if (dn > 0 && dn < 64) { const sm = clamp((o.t - prev.t) / dn, 60, 1000); this._iv = this._iv ? this._iv + (sm - this._iv) * .2 : sm; } }   // 對方實測送出間隔(序號差 × 時間差)
    if (prev && prev.tp !== o.tp) this.buf.length = 0;                       // 傳送 / 瞬移:不內插,直接跳過去
    this.buf.push(o);
    if (this.buf.length > 12) this.buf.shift();
  }
  update(dt) {
    const now = Net.now();
    this._ingest(now);
    const B = this.buf, have = B.length > 0;
    // 對方在背景(presence 的 away 有效):快照停止時凍結在最後位置、名牌「離線中」,不隱藏、不外插(避免瞬移)
    const off = have && Net.awayOf(this.seat) && now - this.lastRecv > 3000;
    const stale = !have || (now - this.lastRecv > 3000 && !off);
    let p = null;
    if (off) p = B[B.length - 1];
    else if (have) {
      const rt = now - this.delayMs(), L = B.length, last = B[L - 1];
      if (rt >= last.t) p = extrapPose(last, L >= 2 ? B[L - 2] : null, Math.min(rt - last.t, 200));
      else if (rt <= B[0].t) p = B[0];
      else { let j = 1; while (B[j].t < rt) j++; const a = B[j - 1], b = B[j]; p = mixPose(a, b, (rt - a.t) / ((b.t - a.t) || 1)); }
    }
    if (stale || !p) { this.gf = 0; this.dead = true; this.mapVis = false; this.g.visible = false; this.shadow.visible = false; this.ring.visible = false; this.nameSpr.visible = false; this.bar.visible = false; this.glow.visible = false; stVisHide(this); return; }
    const g = p.g, stealth = !!(g & 2), away = !!(g & 256), down = !!(g & 64), inv = !!(g & 32);
    this.dead = down || away;
    this.gf = g; this.stE = p.e | 0; this.guard = !!(g & 512); this.lit = !!(g & 1024); this.unyield = !!(g & 2048); this.stanceB = !!(g & 4096);   // 新旗標欄位(S 批只記值,呈現留給寫手)                                                   // 快照旗標(netcombat.js 的位移招式特效用)
    this.px = p.x; this.py = p.y; this.pz = p.z; this.yaw = p.r;
    this.col.x = p.x; this.col.z = p.z;
    this.hp = p.hp; this.sh = p.sh;
    // 煙霧彈(skills_assassin.js)、草叢隱身(設計_叢林地圖 §4-3)、致盲 / 霧中:判定抽成 netSeen(小地圖共用)。草叢:對方在草叢內、離我 > 2.5 m、未集氣 / 出手 / 照亮 → 隱形;被打(hp 下降)1 s、集氣出手 0.6 s 內現形
    const me = mage.root.position;
    if (this._lastHp != null && p.hp < this._lastHp) this._revealUntil = now + 1000;
    this._lastHp = p.hp;
    if ((g & 128) || p.c >= .05) this._revealUntil = now + 600;
    const seen = netSeen(p.x, p.y, p.z, !!(g & 1024) || now <= (this._revealUntil || 0)), inSm = seen.inSm, hid = seen.hid;
    this.mapVis = !stealth && !inSm && !hid && !seen.blind && !seen.fogFar;   // 小地圖是否畫這個人的點(minimap.js)
    const op = stealth ? .08 : (inSm ? .35 : ((away || off) ? .4 : 1));
    if (op !== this._op) { this._op = op; this.mage.setOpacity(op); this._noShadow(); }
    this.mage.root.position.set(p.x, p.y, p.z); this.mage.yaw = p.r;
    if (this.cls === 'mage') { const w = p.w ? 'book' : 'staff'; if (this.mage.weapon !== w) this.mage.setWeapon(w, false); }
    this.mage.shieldUp = ((g & 4) || (g & 512)) ? 1 : 0;   // 衝鋒盾(4)或格擋窗(512 GUARD)舉盾
    // LOD(派工單 C-③):> 40 m 的遠端每 3 格才更新一次動畫(累積 dt)、武器細節隱藏;回到近距離時還原武器
    const far = Math.hypot(p.x - me.x, p.z - me.z) > NET_TIER.lodFar;
    this._lodAcc = (this._lodAcc || 0) + dt;
    this._lodN = ((this._lodN || 0) + 1) % 3;
    if (!far || this._lodN === 0) { this.mage.update(this._lodAcc, { move: p.m, cast: p.c, kick: p.k, charge: p.q, t: G.time, hover: 0, roll: p.o, rollPhi: p.p, flip: p.f, sit: p.s, down: p.d }); this._lodAcc = 0; }
    if (far) { const M = this.mage; [M.staff, M.book, M.bow, M.sword, M.shield].concat(M.daggers).forEach(g => { g.visible = false; }); this._wpnHid = true; }
    else if (this._wpnHid) { this._wpnHid = false; this.mage.setWeapon(this.mage.weapon, true); }
    // 顯示:無敵閃爍、潛行隱藏名牌 / 血條 / 假影
    const blink = inv && Math.floor(now / 120) % 2 === 0;
    this.g.visible = !blink && !hid;
    const vis = !blink && !stealth && !inSm && !hid;
    this.nameSpr.position.set(p.x, p.y + 2.6, p.z);
    const tag = off ? 'off' : (away ? 'away' : '');
    if (tag !== this._tag) { this._tag = tag; this.nameSpr.material.map = off ? this._offTex() : (away ? this._awayTex() : this.nameTex); this.nameSpr.material.needsUpdate = true; }
    const blindFar = seen.blindFar;   // 致盲:8 m 外隱藏名牌與血條(§3-3);霧中(設計 §4-4):10 m 外同樣隱藏
    const cd = camera.position.distanceTo(this.nameSpr.position), fa = clamp((NET_TIER.nameFade[1] - cd) / (NET_TIER.nameFade[1] - NET_TIER.nameFade[0]), 0, 1);   // 名牌距離淡出(30→45 m)
    this.nameSpr.material.opacity = fa;
    this.nameSpr.visible = vis && !blindFar && fa > 0;
    this.bar.visible = vis && !blindFar;
    this.bar.position.set(p.x, p.y + 2.2, p.z); this.bar.quaternion.copy(camera.quaternion);
    const r = clamp(this.hp / this.max, 0, 1);
    this.fg.scale.x = Math.max(.001, r); this.fg.position.x = -.47 * (1 - r);
    const s = clamp(this.sh / 60, 0, 1) * .5;
    this.shBar.visible = s > 0; this.shBar.scale.x = Math.max(.001, s); this.shBar.position.x = .47 - .47 * s;
    // 腳下假影:離地越高越小(§2-3);不投影
    this.shadow.visible = vis;
    if (vis) {
      const gy = surfaceY(p.x, p.z, p.y + .5), h = Math.max(0, p.y - gy);
      layFlat(this.shadow, p.x, gy, p.z, .5, 0, .03);
      this.shadow.scale.setScalar(1 - .5 * Math.min(1, h / 3));
    }
    placeRing(this.ring, p.x, p.y, p.z, vis ? ((away || off) ? .4 : 1) : 0);   // 腳下色圈:跟假影同條件(潛行 / 煙霧 / 草叢 / 無敵閃爍時隱藏,不洩漏位置)
    // 集氣光球在武器尖端(§2-3)
    this.glow.visible = vis && p.q > .01;
    if (this.glow.visible) { this.mage.tipWorld(this._tmp); this.glow.position.copy(this._tmp); this.glow.scale.setScalar(.15 + .6 * p.q); }
    // 狀態視覺(§3-3):潛行(照亮例外)與倒下時不畫,避免燃燒粒子暴露潛行者位置;照亮 flag 由快照 g & 1024 來
    if ((stealth && !this.lit) || down || hid) stVisHide(this);
    else stVis(this, this.stE & 7, (this.stE & 248) | (this.lit ? 256 : 0), dt);
  }
  // 命中(§2-3、§2-7):只有本機的攻擊(NET_CTX === null)才記入待送命中,由 netCombatTick 合併送出;
  // 不在本機扣血、不顯示數字(等受害者回報 dmg)。重現他人法術時(NET_CTX 為座位號)一律忽略。
  _pend() { if (NET_CTX !== null) return null; return this.pend || (this.pend = { h: [], fx: {} }); }
  hit(dmg, dx, dz, burn, el) {
    const p = this._pend(); if (!p) return;
    p.h.push([Math.round(dmg * 10) / 10, el || 0, Math.round(dx * 100) / 100, Math.round(dz * 100) / 100, Math.round((burn || 0) * 10) / 10, window.NET_SM_K || 0]);   // 第 6 欄:來源召喚物名(N7,0 = 非召喚物)
  }
  knock(dirx, dirz, dist) {
    const p = this._pend(); if (!p) return;
    const l = Math.hypot(dirx, dirz) || 1, k = p.fx.kb || (p.fx.kb = [0, 0]); k[0] += dirx / l * dist; k[1] += dirz / l * dist;
  }
  lift(h) { const p = this._pend(); if (p) p.fx.lf = Math.max(p.fx.lf || 0, h); }
  stun(t) { const p = this._pend(); if (p) p.fx.st = Math.max(p.fx.st || 0, t); }
  stunFx(t) { this.stun(t); }
  slow(t, pct) {
    const p = this._pend(); if (!p) return;
    const s = p.fx.sl || (p.fx.sl = [0, 0]); s[0] = Math.max(s[0], t); s[1] = Math.max(s[1], pct == null ? .5 : pct);
  }
  light(t) { const p = this._pend(); if (p) p.fx.li = Math.max(p.fx.li || 0, t); }
  // 狀態效果收件(status.js 的 stApplyFx 讀取;fx 鍵見該檔):定身 ro、麻痺 pa、沉默 si、寒意 ch、中毒 po [秒, 層]、致盲 bl
  root(t) { const p = this._pend(); if (p) p.fx.ro = Math.max(p.fx.ro || 0, t); }
  paralyze(t) { const p = this._pend(); if (p) p.fx.pa = Math.max(p.fx.pa || 0, t); }
  silence(t) { const p = this._pend(); if (p) p.fx.si = Math.max(p.fx.si || 0, t); }
  chill(n) { const p = this._pend(); if (p) p.fx.ch = (p.fx.ch || 0) + n; }
  poison(t, n) { const p = this._pend(); if (!p) return; const q = p.fx.po || (p.fx.po = [0, 0]); q[0] = Math.max(q[0], t); q[1] = Math.min(2, q[1] + (n == null ? 1 : n)); }
  blind(t) { const p = this._pend(); if (p) p.fx.bl = Math.max(p.fx.bl || 0, t); }
  erode(t) { this.poison(t, 1); }   // 舊侵蝕 = 中毒 1 層
  knockDown(t, dirx, dirz) {
    const p = this._pend(); if (!p) return;
    const d = p.fx.dn || (p.fx.dn = [0, 0, 0]); d[0] = Math.max(d[0], t); d[1] = dirx; d[2] = dirz;
  }
  // 吸引:累加位移向量,netCombatTick 每 100 ms 送一次 fx.pl(§2-7)
  pull(tx, tz, speed, dt) {
    if (NET_CTX !== null) return;
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
    if (d < .5) return;
    const s = Math.min(speed * dt, d - .5) / d, v = this.pendPull || (this.pendPull = [0, 0]);
    v[0] += dx * s; v[1] += dz * s;
  }
  clearStatus() {}
  reset() {}
  die() {}
  destroy() {
    this.mage.olUnreg(); scene.remove(this.g); disposeTree(this.g);
    scene.remove(this.shadow);
    scene.remove(this.ring); this.ring.material.dispose();
    scene.remove(this.nameSpr); this.nameSpr.material.dispose(); this.nameTex.dispose(); if (this._awayT) this._awayT.dispose(); if (this._offT) this._offT.dispose();
    scene.remove(this.bar); disposeTree(this.bar);
    scene.remove(this.glow); this.glow.material.dispose();
    stVisDispose(this);
  }
}

/* ================= 角色表、出生點、進出對戰 ================= */
// 出生點驗證(§5-3):平坦、不在平台邊緣;不合格就往原點每 2 m 移,最多 5 次
function fixSpawn(x, z) {
  const ok = (a, b) => Math.abs(terrainH(a, b)) < .3 && !nearPlatform(a, b, 2);
  for (let i = 0; i < 6 && !ok(x, z); i++) {
    if (i === 5) return null;
    const d = Math.hypot(x, z) || 1; x -= x / d * 2; z -= z / d * 2;
  }
  return { x, z };
}
// 高處出生點(y > 0,場景 spawns 設定):站得上去(surfaceY 與 y 相差 < .15)且 1.5 m 內沒有頂面高度不同的平台;不合格不移動、直接排除
function spawnOkHigh(x, z, y) {
  if (Math.abs(surfaceY(x, z, y + .5) - y) >= .15) return false;
  return !PLATFORMS.some(P => platContains(P, x, z, 1.5) && Math.abs(platTop(P, x, z) - y) >= .15);
}
function validSpawnPts(n) {
  const out = [], sp = typeof window.getSceneSpawns === 'function' ? window.getSceneSpawns() : null;
  if (sp) sp.forEach(([x, z, y]) => {
    if (y == null) {   // 省略 y:自動取地形高;法線 y ≥ .9(坡 ≤ 0.48)且不在平台邊緣才合格;不合格不移動、直接排除(設計 §4-2 E)
      if (groundNormal(x, z, null, .5, new V3()).y >= .9 && !nearPlatform(x, z, 2)) out.push({ x, z, y: terrainH(x, z) });
      else console.error('[remote] 出生點不合格(坡度或平台邊緣,已排除):' + x + ',' + z);
      return;
    }
    y = y || 0;
    if (y > .01) { if (spawnOkHigh(x, z, y)) out.push({ x, z, y }); else console.error('[remote] 高處出生點不合格(已排除):' + x + ',' + z + ' y=' + y); }
    else { const q = fixSpawn(x, z); if (q) out.push({ x: q.x, z: q.z, y: 0 }); }
  });
  else SPAWN_PTS.forEach(([x, z]) => { const q = fixSpawn(x, z); if (q) out.push({ x: q.x, z: q.z, y: 0 }); });
  if (out.length < Math.max(6, n)) console.error('[remote] 本場景合格出生點不足:' + out.length + ' 點');
  return out.length ? out : [{ x: 0, z: 0, y: 0 }];
}
// 開局分配:座位由小到大,第 1 人取第一點,之後每人取「與已分配點最近距離最大」的點(確定性)
function assignSpawns(seats, pts) {
  const out = {}, used = [];
  seats.forEach((s, i) => {
    let best = null;
    if (!used.length) best = pts[0];
    else {
      let bd = -1;
      pts.forEach(q => {
        if (used.indexOf(q) >= 0) return;
        const d = Math.min(...used.map(u => Math.hypot(u.x - q.x, u.z - q.z)));
        if (d > bd) { bd = d; best = q; }
      });
    }
    if (!best) best = pts[i % pts.length];
    used.push(best); out[s] = best;
  });
  return out;
}
// 中途加入者:離現有角色最遠的點(只影響本機對該角色的初始位置,之後以它的快照為準)
function farthestSpawn(pts) {
  const occ = Object.keys(REMOTES).map(k => ({ x: REMOTES[k].px, z: REMOTES[k].pz }));
  if (mage && mage.root) occ.push({ x: mage.root.position.x, z: mage.root.position.z });
  let best = pts[0], bd = -1;
  pts.forEach(q => {
    const d = occ.length ? Math.min(...occ.map(u => Math.hypot(u.x - q.x, u.z - q.z))) : 1e9;
    if (d > bd) { bd = d; best = q; }
  });
  return best;
}
// 移出稻草人(§6-3):對戰中不列入 DUMMIES、不碰撞;離開時還原
function stashDummies() {
  if (stashed) return;
  stashed = DUMMIES.splice(0, DUMMIES.length);
  stashed.forEach(d => { d.g.visible = false; d.bar.visible = false; const i = COLLIDERS.indexOf(d.col); if (i >= 0) COLLIDERS.splice(i, 1); });
}
function restoreDummies() {
  if (!stashed) return;
  stashed.forEach(d => { d.g.visible = !d.dead; DUMMIES.push(d); COLLIDERS.push(d.col); });
  stashed = null;
}
function addRemote(info, pos) {
  const k = String(info.id);
  if (REMOTES[k]) return;
  const rp = new RemotePlayer(info, pos || spawnPts[0]);
  REMOTES[k] = rp; DUMMIES.push(rp); COLLIDERS.push(rp.col);
}
function destroyRemote(k) {
  const rp = REMOTES[k]; if (!rp) return;
  delete REMOTES[k];
  let i = DUMMIES.indexOf(rp); if (i >= 0) DUMMIES.splice(i, 1);
  i = COLLIDERS.indexOf(rp.col); if (i >= 0) COLLIDERS.splice(i, 1);
  rp.destroy();
}
function clearRemotes() {
  const wasOn = window.NETON;
  Object.keys(REMOTES).forEach(destroyRemote);
  window.NETON = false; window.NET_LOCK = false; sendAcc = 0; if (typeof applyArenaR === 'function') applyArenaR();
  if (wasOn && typeof netSmReset === 'function') netSmReset();   // 離開對戰:傀儡、本機召喚物、sm 節點清除(netsummon.js,N7)
  if (wasOn && typeof netOnClear === 'function') netOnClear();   // 離開對戰(原本在對戰中才處理):清 debuff、關小計分板與擊殺訊息(netcombat.js)
  if (cdEl) { cdEl.style.display = 'none'; cdLast = ''; }
  restoreDummies();
}
// 本機角色移到自己的出生點,面向場中
function placeLocal(pos) {
  if (!pos) return;
  mage.root.position.set(pos.x, surfaceY(pos.x, pos.z, (pos.y || 0) + .5), pos.z);
  mage.yaw = Math.atan2(-pos.x, -pos.z);
  G.vy = 0; G.ground = true; G.coyote = 0; G.speedN = 0;
  if (G.state === 'charging') cancelCharge();
}
function enterMatch(ev) {
  if (!Net.me) return;
  clearRemotes();
  if (typeof clearSummons === 'function') clearSummons();   // 新局開始:清掉殘留的召喚物(§6-3)
  const players = ev.players || [];
  const seats = players.map(p => p.id).sort((a, b) => a - b);
  if (typeof window.getSceneIndex === 'function' && window.getSceneIndex() !== 0) setScene(0, true);   // 單場地:別人送來的 ev.scene 一律夾回 0(海島);換場地再來(N6):先切場景,出生點驗證才用新場地
  spawnPts = validSpawnPts(players.length);
  const sp = assignSpawns(seats, spawnPts);
  const rd = Net.roundOf ? Net.roundOf() : null;
  roundT0 = rd && rd.t0 ? rd.t0 : Net.now();
  stashDummies();
  window.NETON = true; if (typeof applyArenaR === 'function') applyArenaR();   // 多人場地半徑(場景 arenaR 或 32)
  if (typeof netOnClear === 'function') netOnClear();   // 新局開始:HP 回滿、清 debuff(單人時的傷勢不帶進對戰)
  players.forEach(p => { if (p.id !== Net.me) addRemote(p, sp[p.id]); });
  placeLocal(sp[Net.me]);
  if (typeof netApplyProfile === 'function') netApplyProfile(players);   // 對戰中的職業 / 屬性以房間登記為準(§6-2)
  window.NET_LOCK = Net.now() < roundT0;
  sendAcc = 0;
}
// 對戰中有人加入或離開:同步遠端角色
function syncRemotes(list) {
  const me = Net.me, want = {};
  list.forEach(p => { if (p.id !== me) want[p.id] = p; });
  Object.keys(REMOTES).forEach(k => { if (!want[k]) destroyRemote(k); });
  Object.keys(want).forEach(k => { if (!REMOTES[k]) addRemote(want[k], farthestSpawn(spawnPts)); });
}

/* ================= 送出快照、開戰倒數、每幀入口(game.js 主迴圈呼叫 netTick) ================= */
function sendSnap(now) {
  const p = mage.root.position, roll = G.roll;
  let g = 0;
  if (G.ground) g |= 1;
  if (G.stealth) g |= 2;
  if (G.dash && G.dash.kind === 'charge') g |= 4;
  if (G.spin) g |= 8;
  if (roll) g |= 16;
  if (G.invulnT > 0) g |= 32;
  if (G.down > 0) g |= 64;
  if (G.state === 'charging') g |= 128;
  if (document.hidden) g |= 256;
  if (G.stance === 1) g |= 4096;   // 非法師第 2 架勢(STANCE_B)
  if (G.parryT > 0) g |= 512;      // 格擋窗(GUARD)
  if (G.litT > 0) g |= 1024;       // 被照亮(LIT)
  if (G.unyT > 0) g |= 2048;       // 不屈戰意(UNYIELD)
  sendSeq = (sendSeq + 1) & 255;
  Net.setSnap(packSnap({
    n: sendSeq, tm: now, x: p.x, y: p.y, z: p.z, r: mage.yaw, m: G.speedN || 0, c: G.cb || 0, k: G.kick || 0,
    q: G.state === 'charging' ? (G.charge || 0) : 0,
    o: roll ? clamp(roll.t / roll.time, 0, 1) : -1, p: roll ? roll.phi : 0, f: G.flip, s: G.sitK || 0, d: G.downK || 0,
    g: g, hp: Math.ceil(G.hp / G.hpMax * 100), sh: Math.ceil(G.shield || 0), w: (G.cls === 'mage' && G.weapon === 'book') ? 1 : 0, tp: G.tp || 0,
    e: typeof stCode === 'function' ? (stCode() | stFlags()) : 0   // 狀態欄(status.js)
  }));
}
function countdownTick(left) {
  let txt = '';
  if (left > 0 && left <= 3000) txt = String(Math.ceil(left / 1000));
  else if (left <= 0 && left > -800) txt = '開戰!';
  if (!cdEl) {
    cdEl = document.createElement('div');
    cdEl.style.cssText = 'position:fixed;left:0;right:0;top:34%;text-align:center;font:700 72px sans-serif;color:#ffe3b0;text-shadow:0 0 12px #000;pointer-events:none;z-index:15;display:none';
    document.body.appendChild(cdEl);
  }
  if (txt !== cdLast) { cdLast = txt; cdEl.textContent = txt; cdEl.style.display = txt ? '' : 'none'; if (txt) sfx.play('count', { go: txt === '開戰!' }); }
}
function netTick(dt) {
  if (!window.NETON || !Net.me) return;
  const now = Net.now();
  const left = roundT0 - now;
  window.NET_LOCK = left > 0 || (typeof netRoundOver === 'function' && netRoundOver());   // 開戰前與回合結束後鎖定(netcombat.js,N6)
  if (window.NET_LOCK) {   // 開戰前鎖定:清掉按住的鍵 / 搖桿 / 攻擊,集氣中的取消
    G.keys = {}; G.atkHeld = false; G.stick.x = 0; G.stick.y = 0; G.stick.mag = 0;
    if (G.state === 'charging') cancelCharge();
  }
  countdownTick(left);
  const iv = 1 / sendHz();
  sendAcc += dt;
  if (sendAcc >= iv) { sendAcc = sendAcc >= 2 * iv ? 0 : sendAcc - iv; sendSnap(now); }
  if (typeof netFxTick === 'function') netFxTick(dt);   // 遠端位移招式特效(netcombat.js,§2-9)
  if (typeof netSmTick === 'function') netSmTick(dt);   // 召喚物快照與傀儡(netsummon.js,N7)
  if (typeof netCombatTick === 'function') netCombatTick(dt);   // 待送命中、吸引位移、小計分板(netcombat.js,N5)
}
window.netTick = netTick;

/* ================= 接上 Net 事件 ================= */
// start 比 cover.js 的 start 先註冊;延到微任務才做,確保 cover 已先切換場景與職業
Net.on('start', ev => { Promise.resolve().then(() => enterMatch(ev)); });
Net.on('players', list => { if (window.NETON) syncRemotes(list || []); });
Net.on('closed', () => clearRemotes());
const _netLeave = Net.leave;
Net.leave = function () { clearRemotes(); return _netLeave.apply(this, arguments); };
