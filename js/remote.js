'use strict';
// 多人對戰:遠端角色 RemotePlayer、REMOTES、快照編碼 packSnap / unpackSnap(設計 §9-3)、內插(§2-2、§2-3)、
// 進出對戰(§6-3)、出生點(§5-3)、開戰倒數與鎖定(§5-1)。
// 依賴(全域):net.js 的 Net(setSnap / snapOf / roundOf)、world.js(DUMMIES、COLLIDERS、terrainH、surfaceY、nearPlatform、layFlat、scene)、
//   game.js(G、camera、mage、cancelCharge)、mage.js(Mage)、classes.js(CLASSES、auraOf)、fx.js(glowSprite、clamp、lerp、angDiff、V3)。
// 載入順序:net.js 之後、cover.js 之前。單人模式 window.NETON 為 false,netTick 不被呼叫,行為不變。
window.NETON = false;
window.NET_LOCK = false;
const REMOTES = {};              // 座位(字串)→ RemotePlayer
const SNAP_CHARS = 23;           // 快照字元數:137 位元(§9-3)補齊到 138 位元 = 23 個 base64url 字元
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const TAU = Math.PI * 2;
const NAME_COLORS = ['#ffd27a', '#8fd0ff', '#ff8a8a', '#b8f08a', '#ffa8e0', '#a8fff0', '#d0a8ff', '#ffe08a', '#8affb0', '#ff9a5a', '#9ab0ff', '#e0e0e0'];
const SPAWN_PTS = [[0, 22], [12.6, 18], [20.7, 7.5], [21.3, -5.7], [-21.3, -5.7], [-20.7, 7.5], [-12.6, 18], [11, -14], [0, -7], [-11, -14], [8, 7], [-8, 7]];

let spawnPts = [];               // 本場合格的出生點(enterMatch 時算好)
let sendAcc = 0, sendSeq = 0, roundT0 = 0, cdLast = '', cdEl = null, stashed = null;
let BLOB_GEO = null, BLOB_MAT = null;

/* ================= 快照編碼(§9-3):欄位依序位元打包,再轉 base64url ================= */
const qn = (v, lo, hi, bits) => Math.round(clamp((v - lo) / (hi - lo), 0, 1) * ((1 << bits) - 1));
const dq = (q, lo, hi, bits) => lo + q / ((1 << bits) - 1) * (hi - lo);
const qOpt = v => (v < 0 ? 0 : 1 + Math.round(clamp(v, 0, 1) * 30));   // -1(不用)→ 0;0~1 → 1~31
const dOpt = q => (q === 0 ? -1 : (q - 1) / 30);
const qYaw = v => Math.round((((v % TAU) + TAU) % TAU) / TAU * 256) & 255;
const dYaw = q => q / 256 * TAU;

// o:{n 序號, tm 送出時間(ms), x y z, r 朝向, m 走跑, c 施法, k 後座, q 集氣, o 翻滾進度(-1 無), p 翻滾方向, f 空翻(-1 無),
//    s 打坐, d 倒地, g 旗標, hp, sh 護盾, w 法杖 0 / 書 1, tp 傳送計數}
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
  put(o.g & 511, 9);
  put(clamp(Math.round(o.hp), 0, 127), 7);
  put(clamp(Math.round(o.sh || 0), 0, 63), 6);
  put(o.w ? 1 : 0, 1);
  put((o.tp | 0) & 15, 4);
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
  o.g = get(9);
  o.hp = get(7); o.sh = get(6);
  o.w = get(1);
  o.tp = get(4);
  if (nowRef != null) { let d = (nowRef - tm) % 65536; if (d < 0) d += 65536; if (d >= 32768) d -= 65536; o.t = nowRef - d; }
  else o.t = 0;
  return o;
}
window.packSnap = packSnap;
window.unpackSnap = unpackSnap;

/* ================= 送出與內插的共用參數 ================= */
// 2~4 人 10 Hz、5 人以上 8 Hz(§2-2、§9-2)
const sendHz = () => (Object.keys(REMOTES).length + 1 >= 5 ? 8 : 10);
// 內插緩衝:10 Hz → 150 ms、8 Hz → 200 ms(§2-2)
const interpDelay = () => (sendHz() === 8 ? 200 : 150);

function mixPose(a, b, u) {
  const L = (p, q) => p + (q - p) * u, pick = u < .5 ? a : b;
  return {
    t: L(a.t, b.t), x: L(a.x, b.x), y: L(a.y, b.y), z: L(a.z, b.z), r: a.r + angDiff(a.r, b.r) * u,
    m: L(a.m, b.m), c: L(a.c, b.c), k: L(a.k, b.k), q: L(a.q, b.q), s: L(a.s, b.s), d: L(a.d, b.d), sh: L(a.sh, b.sh),
    o: (a.o < 0 || b.o < 0) ? pick.o : L(a.o, b.o), f: (a.f < 0 || b.f < 0) ? pick.f : L(a.f, b.f), p: pick.p,
    g: pick.g, hp: pick.hp, w: pick.w, tp: pick.tp
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
function nameTexture(text, color, suffix) {
  const c = document.createElement('canvas'); c.width = 384; c.height = 64;
  const g = c.getContext('2d'), s = suffix ? text + suffix : text;
  g.font = 'bold 28px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(s, 192, 34);
  g.fillStyle = color; g.fillText(s, 192, 34);
  return new THREE.CanvasTexture(c);
}
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
    this._noShadow();                                                       // 遠端一律不投影(§2-3)
    blobShared();
    this.shadow = new THREE.Mesh(BLOB_GEO, BLOB_MAT); this.shadow.renderOrder = 1; scene.add(this.shadow);
    const color = NAME_COLORS[(this.seat - 1) % NAME_COLORS.length];
    this.nameTex = nameTexture(this.name, color, ''); this._awayT = null; this._away = false; this._color = color;
    this.nameSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.nameTex, transparent: true, depthWrite: false }));
    this.nameSpr.scale.set(2.4, .4, 1); this.nameSpr.renderOrder = 30; scene.add(this.nameSpr);
    this.bar = new THREE.Group(); scene.add(this.bar);
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, .12), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: .6, depthTest: false }));
    this.fg = new THREE.Mesh(new THREE.PlaneGeometry(.94, .08), new THREE.MeshBasicMaterial({ color: 0xe03030, depthTest: false }));
    this.shBar = new THREE.Mesh(new THREE.PlaneGeometry(.94, .08), new THREE.MeshBasicMaterial({ color: 0x66c8ff, depthTest: false }));
    bg.renderOrder = 20; this.fg.renderOrder = 21; this.shBar.renderOrder = 22;
    this.fg.position.z = .001; this.shBar.position.z = .002;
    this.bar.add(bg, this.fg, this.shBar);
    this.glow = glowSprite(auraOf(this.cls, this.el).hex, .15, 1); this.glow.visible = false; scene.add(this.glow);

    this.px = pos.x; this.py = terrainH(pos.x, pos.z); this.pz = pos.z; this.yaw = Math.atan2(-pos.x, -pos.z);
    this.home = new V3(pos.x, 0, pos.z);
    this.col = { x: pos.x, z: pos.z, r: .4, ref: this };
    this.hp = 100; this.max = 100; this.sh = 0;
    this.dead = true; this.buf = []; this.lastStr = ''; this.lastN = -1; this.lastRecv = 0; this._op = undefined; this._tmp = new V3();
    this.pend = null; this.pendPull = null; this._pullT = 0;   // 待送命中(只記本機攻擊,netcombat.js 每幀送出)
    // 以下欄位給 DUMMIES 的既有程式讀寫(N3 不處理命中)
    this.burn = 0; this.windT = 0; this.hpShow = 0; this.flash = 0; this.slowT = 0; this.slowPct = 0; this.zSlow = 0; this.zHex = 0;
    this.litT = 0; this.stunT = 0; this.erodeT = 0; this.downT = 0; this.downK = 0; this.ox = this.oz = 0;
    this.mage.root.position.set(this.px, this.py, this.pz); this.mage.yaw = this.yaw;
    this.g.visible = false; this.shadow.visible = false; this.nameSpr.visible = false; this.bar.visible = false; this.glow.visible = false;
  }
  get x() { return this.px; }
  get y() { return this.py; }
  get z() { return this.pz; }
  _noShadow() { this.mage.root.traverse(o => { if (o.isMesh) o.castShadow = false; }); }
  _awayTex() { if (!this._awayT) this._awayT = nameTexture(this.name, this._color, '(暫離)'); return this._awayT; }
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
    if (prev && prev.tp !== o.tp) this.buf.length = 0;                       // 傳送 / 瞬移:不內插,直接跳過去
    this.buf.push(o);
    if (this.buf.length > 12) this.buf.shift();
  }
  update(dt) {
    const now = Net.now();
    this._ingest(now);
    const B = this.buf, have = B.length > 0;
    const stale = !have || now - this.lastRecv > 3000;
    let p = null;
    if (have) {
      const rt = now - interpDelay(), L = B.length, last = B[L - 1];
      if (rt >= last.t) p = extrapPose(last, L >= 2 ? B[L - 2] : null, Math.min(rt - last.t, 200));
      else if (rt <= B[0].t) p = B[0];
      else { let j = 1; while (B[j].t < rt) j++; const a = B[j - 1], b = B[j]; p = mixPose(a, b, (rt - a.t) / ((b.t - a.t) || 1)); }
    }
    if (stale || !p) { this.gf = 0; this.dead = true; this.g.visible = false; this.shadow.visible = false; this.nameSpr.visible = false; this.bar.visible = false; this.glow.visible = false; return; }
    const g = p.g, stealth = !!(g & 2), away = !!(g & 256), down = !!(g & 64), inv = !!(g & 32);
    this.dead = down || away;
    this.gf = g;                                                   // 快照旗標(netcombat.js 的位移招式特效用)
    this.px = p.x; this.py = p.y; this.pz = p.z; this.yaw = p.r;
    this.col.x = p.x; this.col.z = p.z;
    this.hp = p.hp; this.sh = p.sh;
    const op = stealth ? .08 : (away ? .4 : 1);
    if (op !== this._op) { this._op = op; this.mage.setOpacity(op); this._noShadow(); }
    this.mage.root.position.set(p.x, p.y, p.z); this.mage.yaw = p.r;
    if (this.cls === 'mage') { const w = p.w ? 'book' : 'staff'; if (this.mage.weapon !== w) this.mage.setWeapon(w, false); }
    this.mage.shieldUp = (g & 4) ? 1 : 0;
    this.mage.update(dt, { move: p.m, cast: p.c, kick: p.k, charge: p.q, t: G.time, hover: 0, roll: p.o, rollPhi: p.p, flip: p.f, sit: p.s, down: p.d });
    // 顯示:無敵閃爍、潛行隱藏名牌 / 血條 / 假影
    const blink = inv && Math.floor(now / 120) % 2 === 0;
    this.g.visible = !blink;
    const vis = !blink && !stealth;
    this.nameSpr.position.set(p.x, p.y + 2.6, p.z);
    if (away !== this._away) { this._away = away; this.nameSpr.material.map = away ? this._awayTex() : this.nameTex; this.nameSpr.material.needsUpdate = true; }
    this.nameSpr.visible = vis && camera.position.distanceTo(this.nameSpr.position) < 45;
    this.bar.visible = vis;
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
    // 集氣光球在武器尖端(§2-3)
    this.glow.visible = vis && p.q > .01;
    if (this.glow.visible) { this.mage.tipWorld(this._tmp); this.glow.position.copy(this._tmp); this.glow.scale.setScalar(.15 + .6 * p.q); }
  }
  // 命中(§2-3、§2-7):只有本機的攻擊(NET_CTX === null)才記入待送命中,由 netCombatTick 合併送出;
  // 不在本機扣血、不顯示數字(等受害者回報 dmg)。重現他人法術時(NET_CTX 為座位號)一律忽略。
  _pend() { if (NET_CTX !== null) return null; return this.pend || (this.pend = { h: [], fx: {} }); }
  hit(dmg, dx, dz, burn, el) {
    const p = this._pend(); if (!p) return;
    p.h.push([Math.round(dmg * 10) / 10, el || 0, Math.round(dx * 100) / 100, Math.round(dz * 100) / 100, Math.round((burn || 0) * 10) / 10]);
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
  erode(t) { const p = this._pend(); if (p) p.fx.er = Math.max(p.fx.er || 0, t); }
  light(t) { const p = this._pend(); if (p) p.fx.li = Math.max(p.fx.li || 0, t); }
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
    scene.remove(this.g); disposeTree(this.g);
    scene.remove(this.shadow);
    scene.remove(this.nameSpr); this.nameSpr.material.dispose(); this.nameTex.dispose(); if (this._awayT) this._awayT.dispose();
    scene.remove(this.bar); disposeTree(this.bar);
    scene.remove(this.glow); this.glow.material.dispose();
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
function validSpawnPts(n) {
  const out = [];
  SPAWN_PTS.forEach(([x, z]) => { const q = fixSpawn(x, z); if (q) out.push(q); });
  if (out.length < Math.max(6, n)) console.error('[remote] 本場景合格出生點不足:' + out.length + ' 點');
  return out.length ? out : [{ x: 0, z: 0 }];
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
  window.NETON = false; window.NET_LOCK = false; sendAcc = 0;
  if (wasOn && typeof netOnClear === 'function') netOnClear();   // 離開對戰(原本在對戰中才處理):清 debuff、關小計分板與擊殺訊息(netcombat.js)
  if (cdEl) { cdEl.style.display = 'none'; cdLast = ''; }
  restoreDummies();
}
// 本機角色移到自己的出生點,面向場中
function placeLocal(pos) {
  if (!pos) return;
  mage.root.position.set(pos.x, terrainH(pos.x, pos.z), pos.z);
  mage.yaw = Math.atan2(-pos.x, -pos.z);
  G.vy = 0; G.ground = true; G.coyote = 0; G.speedN = 0;
  if (G.state === 'charging') cancelCharge();
}
function enterMatch(ev) {
  if (!Net.me) return;
  clearRemotes();
  const players = ev.players || [];
  const seats = players.map(p => p.id).sort((a, b) => a - b);
  if (typeof window.getSceneIndex === 'function' && ev.scene != null && window.getSceneIndex() !== ev.scene) setScene(ev.scene, true);   // 換場地再來(N6):先切場景,出生點驗證才用新場地
  spawnPts = validSpawnPts(players.length);
  const sp = assignSpawns(seats, spawnPts);
  const rd = Net.roundOf ? Net.roundOf() : null;
  roundT0 = rd && rd.t0 ? rd.t0 : Net.now();
  stashDummies();
  window.NETON = true;
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
  sendSeq = (sendSeq + 1) & 255;
  Net.setSnap(packSnap({
    n: sendSeq, tm: now, x: p.x, y: p.y, z: p.z, r: mage.yaw, m: G.speedN || 0, c: G.cb || 0, k: G.kick || 0,
    q: G.state === 'charging' ? (G.charge || 0) : 0,
    o: roll ? clamp(roll.t / roll.time, 0, 1) : -1, p: roll ? roll.phi : 0, f: G.flip, s: G.sitK || 0, d: G.downK || 0,
    g: g, hp: Math.ceil(G.hp), sh: Math.ceil(G.shield || 0), w: (G.cls === 'mage' && G.weapon === 'book') ? 1 : 0, tp: G.tp || 0
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
  if (txt !== cdLast) { cdLast = txt; cdEl.textContent = txt; cdEl.style.display = txt ? '' : 'none'; }
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
