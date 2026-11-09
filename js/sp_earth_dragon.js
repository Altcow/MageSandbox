'use strict';
// 土龍術(設計_魔法調整.md 第 15 節):朝 P.dir 的長條地面裂縫。
// 能量球鑽入前方 1.5 m → 裂縫前端以 ED_SPEED 推進;後方蛇形岩塊、岩石龍頭、塵土與火花;
// 被前端掃到的標靶受傷 + 減速 ED_SLOW(固定 ED_SLOW_T 秒,不隨集氣);走廊在前端到終點後再保留 ED_SLOW_T 秒。
// 階段 0 介面以 typeof 保護:addSlowZone / removeSlowZone(world.js)、Dummy.slow(t, pct)、CHG.perK、P.copies / P.thickK / P.sizeK。
// 頂層除 castEarthDragon 外皆為 ED_ / ed_ 前綴。
// 依賴(全域):scene、terrainH、DUMMIES、LIGHTS、ARENA_R、camera(world.js);fire、smoke、addFx、rnd、fq、EL、IS_TOUCH、V3(fx.js / spells.js);
//   hitEl、orbFly、claimLight、driveLight、endLight、STONE_MAT(spells.js);G、CFG、CHG、mage、dissolveOrb、flashLight、layFlat(game.js / world.js);THREE。

const ED_SPEED = 22, ED_LEN = 36, ED_SLOW = .65, ED_SLOW_T = 3, ED_DMG = 70, ED_HW_EXTRA = .4;
const ED_SPREAD = [[0], [-6, 6], [0, -12, 12]];   // 份數 1 / 2 / 3 的偏角(度);3 道 = 中、左 −12°、右 +12°
const ED_ZERO = new THREE.Matrix4().makeScale(0, 0, 0);   // InstancedMesh 空位:縮放為 0
const ED_OBJ = new THREE.Object3D();                       // 共用暫存物件,組 instance 矩陣用
let ED_RES = null;                                         // 共用資源(惰性建立)

function ed_pool(geo, mat, n) {
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  for (let i = 0; i < n; i++) mesh.setMatrixAt(i, ED_ZERO);
  scene.add(mesh);
  const free = []; for (let i = n - 1; i >= 0; i--) free.push(i);
  return { mesh, free };
}
function ed_alloc(pool) { return pool.free.length ? pool.free.pop() : -1; }
function ed_release(pool, i) { pool.mesh.setMatrixAt(i, ED_ZERO); pool.free.push(i); }

function ed_init() {
  if (ED_RES) return ED_RES;
  // 裂縫貼圖 128×64:中央鋸齒主裂紋 + 兩側細分岔,左右淡出
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
  const g = cv.getContext('2d');
  g.strokeStyle = 'rgb(40,24,14)'; g.lineCap = 'round';
  g.lineWidth = 3; g.beginPath(); g.moveTo(64, 0);
  for (let y = 8; y < 64; y += 8) g.lineTo(64 + (Math.random() * 2 - 1) * 9, y);
  g.lineTo(64, 64); g.stroke();
  g.lineWidth = 1.5; g.globalAlpha = .6;
  for (let i = 0; i < 6; i++) {
    const y0 = 6 + i * 10 + Math.random() * 4, sd = i % 2 ? 1 : -1, len = 14 + Math.random() * 22;
    g.beginPath(); g.moveTo(64, y0); g.lineTo(64 + sd * len * .6, y0 + 4); g.lineTo(64 + sd * len, y0 + (Math.random() - .5) * 10); g.stroke();
  }
  g.globalAlpha = 1; g.globalCompositeOperation = 'destination-in';
  const gr = g.createLinearGradient(0, 0, 128, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(.3, '#000'); gr.addColorStop(.7, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 64);
  const crackMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), color: 0x2a1a10, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const n = IS_TOUCH ? 28 : 48;
  ED_RES = {
    crack: ed_pool(new THREE.PlaneGeometry(1, 1), crackMat, n),
    rock: ed_pool(new THREE.DodecahedronGeometry(1, 0), STONE_MAT, n),
    jaw: new THREE.ConeGeometry(.5, 1.6, 5)
  };
  return ED_RES;
}

// 土龍術施放入口(launchSpell 依 SHAPE_FN_NAME.earth.sky 查表呼叫):能量球鑽入前方 1.5 m 後開裂
function castEarthDragon(P, orb) {
  const E = EL.earth, p = mage.root.position, dir = P.dir || 0;
  const ox = p.x + Math.sin(dir) * 1.5, oz = p.z + Math.cos(dir) * 1.5, oy = terrainH(ox, oz);
  if (!orb) return ed_start(P, E, dir, ox, oz);
  orbFly(orb, new V3(ox, oy + .3, oz), .25, E, () => { dissolveOrb(orb, E); ed_start(P, E, dir, ox, oz); });
}

// 場地邊界截斷:沿 (fwx, fwz) 從 (ox, oz) 出發,最多到 ARENA_R − 1
function ed_len(ox, oz, fwx, fwz, len) {
  const Rb = ARENA_R - 1, bo = ox * fwx + oz * fwz, oo = ox * ox + oz * oz;
  const sMax = -bo + Math.sqrt(Math.max(0, bo * bo - (oo - Rb * Rb)));
  return Math.max(0, Math.min(len, sMax));
}

function ed_start(P, E, dir, ox, oz) {
  const R = ed_init(), n = Math.min(3, Math.max(1, P.copies || 1)), offs = ED_SPREAD[n - 1];
  const thickK = P.thickK || 1, aK = 1 + (thickK - 1) * .25;
  const dK = n > 1 ? (typeof CHG.perK === 'function' ? CHG.perK(n, 'sky') : .5) : 1;
  const S = { ox, oz, E, t: 0, nc: n, token: {}, lit: false, thick: thickK, sizeK: P.sizeK || 1, dmg: ED_DMG * (P.dmgK || 1) * aK * dK };
  const hw = (P.r || 4) / 2, cps = [];
  for (let i = 0; i < n; i++) {
    const ang = dir + offs[i] * Math.PI / 180, fwx = Math.sin(ang), fwz = Math.cos(ang);
    const cp = {
      i, ang, fwx, fwz, pxq: fwz, pzq: -fwx, hw, len: ed_len(ox, oz, fwx, fwz, ED_LEN * S.sizeK),
      s: 0, sPrev: 0, laid: 0, arrived: false, tArr: -1, tFade: -1, nextRock: 0, nextDeb: 0, side: 1,
      hit: new Set(), rocks: [], debris: [], pieces: [], zone: null, head: null
    };
    if (typeof addSlowZone === 'function') cp.zone = addSlowZone({ kind: 'rect', x: ox, z: oz, hx: hw + ED_HW_EXTRA, hz: .01, c: fwz, s: fwx, pct: ED_SLOW, hex: E.hex, ground: true });
    cp.head = ed_head(R, ang);
    cps.push(cp);
  }
  const oy = terrainH(ox, oz);
  if (typeof claimLight === 'function') { claimLight(S.token, 0xd09050, new V3(ox, oy + 1.8, oz), 16); S.lit = true; }
  flashLight(new V3(ox, oy + 1.5, oz), E.hex, 4, .5, 20);
  G.shake = Math.max(G.shake, .12 * CFG.shake);
  addFx(dt => {
    S.t += dt;
    let alive = false;
    for (const cp of cps) if (ed_step(cp, S, dt)) alive = true;
    if (S.lit) ed_light(S, cps[0]);
    R.crack.mesh.instanceMatrix.needsUpdate = true; R.rock.mesh.instanceMatrix.needsUpdate = true;
    if (alive) return true;
    if (S.lit) endLight(S.token);
    return false;
  });
}

function ed_light(S, c0) {
  const L = LIGHTS[4];
  if (!L || !L.userData || L.userData.owner !== S.token) return;
  const x = S.ox + c0.fwx * c0.s, z = S.oz + c0.fwz * c0.s;
  L.position.set(x, terrainH(x, z) + 1.2, z);
  driveLight(S.token, 1.2 * (c0.arrived ? Math.max(0, 1 - (S.t - c0.tArr) / ED_SLOW_T) : 1));
}

// 每幀推進一道:回傳 true 表示還沒結束
function ed_step(cp, S, dt) {
  const t = S.t;
  cp.sPrev = cp.s;
  if (!cp.arrived) {
    cp.s = Math.min(cp.len, cp.s + ED_SPEED * dt);
    if (cp.s >= cp.len) { cp.arrived = true; cp.tArr = t; }
  }
  const fxp = S.ox + cp.fwx * cp.s, fzp = S.oz + cp.fwz * cp.s;
  if (cp.s > cp.sPrev) ed_sweep(cp, S);
  ed_lay(cp, S);
  if (!cp.arrived) { ed_spawn(cp, S); ed_fx(cp, S, fxp, fzp); }
  ed_zone(cp, S);
  ed_pieces(cp, S);
  ed_rocks(cp, S);
  ed_debris(cp, S, dt);
  ed_headUpd(cp, S, fxp, fzp);
  return !(cp.tFade >= 0 && cp.pieces.length === 0 && cp.rocks.length === 0 && cp.debris.length === 0 && !cp.head);
}

// 前端掃過的帶狀區域:along ∈ (上一幀, 這一幀]、|across| < hw + .4、標靶貼地 → 每道每標靶一次
function ed_sweep(cp, S) {
  for (const d of DUMMIES) {
    if (d.dead || cp.hit.has(d)) continue;
    const dx = d.x - S.ox, dz = d.z - S.oz, a = dx * cp.fwx + dz * cp.fwz;
    if (a <= cp.sPrev || a > cp.s) continue;
    if (Math.abs(dx * cp.pxq + dz * cp.pzq) > cp.hw + ED_HW_EXTRA) continue;
    if (Math.abs(d.y - terrainH(d.x, d.z)) >= 2.5) continue;
    cp.hit.add(d);
    hitEl(d, S.dmg, 'earth', 0, 0, null);
    if (typeof d.slow === 'function') d.slow(ED_SLOW_T, ED_SLOW);
  }
}

// 走廊減速區跟著前端伸長;前端到終點後 ED_SLOW_T 秒移除,並讓裂縫片段 1 s 淡出
function ed_zone(cp, S) {
  if (cp.arrived && cp.tFade < 0 && S.t - cp.tArr >= ED_SLOW_T) {
    if (cp.zone && typeof removeSlowZone === 'function') removeSlowZone(cp.zone);
    cp.zone = null; cp.tFade = S.t;
    return;
  }
  if (cp.zone && cp.tFade < 0) {
    cp.zone.x = S.ox + cp.fwx * cp.s / 2; cp.zone.z = S.oz + cp.fwz * cp.s / 2; cp.zone.hz = Math.max(.01, cp.s / 2);
  }
}

// 裂縫片段:前端每過 1.5 m 放一片(坡度大時 0.75 m)
function ed_lay(cp, S) {
  for (let g = 0; g < 80 && cp.laid < cp.len - .01; g++) {
    let step = ed_steep(cp, S) ? .75 : 1.5;
    if (cp.laid + step > cp.len) step = cp.len - cp.laid;
    if (!cp.arrived && cp.laid + step > cp.s) break;
    ed_piece(cp, S, cp.laid + step / 2, step);
    cp.laid += step;
  }
}
function ed_steep(cp, S) {
  const a = cp.laid, b = Math.min(cp.len, a + 1.5);
  const ya = terrainH(S.ox + cp.fwx * a, S.oz + cp.fwz * a), yb = terrainH(S.ox + cp.fwx * b, S.oz + cp.fwz * b);
  return Math.abs(yb - ya) > .4;
}
function ed_piece(cp, S, mid, L) {
  const R = ED_RES, idx = ed_alloc(R.crack);
  if (idx < 0) return;
  const x = S.ox + cp.fwx * mid, z = S.oz + cp.fwz * mid;
  layFlat(ED_OBJ, x, terrainH(x, z), z, .75, cp.ang + Math.PI, .03);
  const pc = { idx, pos: ED_OBJ.position.clone(), q: ED_OBJ.quaternion.clone(), W: cp.hw * 1.2, L };
  cp.pieces.push(pc); ed_drawPiece(R.crack, pc, 1);
}
function ed_drawPiece(pool, pc, k) {
  ED_OBJ.position.copy(pc.pos); ED_OBJ.quaternion.copy(pc.q); ED_OBJ.scale.set(pc.W * k, pc.L * k, 1);
  ED_OBJ.updateMatrix(); pool.mesh.setMatrixAt(pc.idx, ED_OBJ.matrix);
}
function ed_pieces(cp, S) {
  if (cp.tFade < 0 || !cp.pieces.length) return;
  const R = ED_RES, k = 1 - (S.t - cp.tFade) / 1;
  if (k <= 0) { for (const pc of cp.pieces) ed_release(R.crack, pc.idx); cp.pieces = []; return; }
  for (const pc of cp.pieces) ed_drawPiece(R.crack, pc, k);
}

// 蛇形岩塊(每 .75 m 一段,最多約 8 段)與側邊翻土碎石
function ed_spawn(cp, S) {
  const R = ED_RES;
  while (cp.nextRock <= cp.s) {
    const idx = ed_alloc(R.rock);
    if (idx >= 0) cp.rocks.push({ idx, rs: cp.nextRock, dy: -1 });
    cp.nextRock += .75;
  }
  if (cp.nextDeb <= cp.s) {
    cp.nextDeb += IS_TOUCH ? 1 : .5; cp.side = -cp.side;
    if (cp.debris.length < 6 && R.rock.free.length > 12) {
      const w = cp.side * cp.hw * .8, x = S.ox + cp.fwx * cp.s + cp.pxq * w, z = S.oz + cp.fwz * cp.s + cp.pzq * w;
      const idx = ed_alloc(R.rock);
      if (idx >= 0) cp.debris.push({ idx, x, y: terrainH(x, z) + .2, z, vx: cp.pxq * cp.side * rnd(2, 4) + cp.fwx * rnd(0, 3), vy: rnd(3, 5), vz: cp.pzq * cp.side * rnd(2, 4) + cp.fwz * rnd(0, 3), life: 0 });
    }
  }
}
function ed_rocks(cp, S) {
  const R = ED_RES, t = S.t;
  for (let j = cp.rocks.length - 1; j >= 0; j--) {
    const k = cp.rocks[j];
    if (k.dy < 0 && (cp.arrived || cp.s - k.rs > 6)) k.dy = t;
    let sc = .45 * S.thick;
    if (k.dy >= 0) {
      const u = (t - k.dy) / .4;
      if (u >= 1) { ed_release(R.rock, k.idx); cp.rocks.splice(j, 1); continue; }
      sc *= 1 - u;
    }
    const s = k.rs, w = .35 * cp.hw * Math.sin(s * .9 - t * 10);
    const x = S.ox + cp.fwx * s + cp.pxq * w, z = S.oz + cp.fwz * s + cp.pzq * w;
    const kk = Math.min(8, Math.max(0, (cp.s - s) / .75));
    ED_OBJ.position.set(x, terrainH(x, z) + .5 + .6 * Math.sin(Math.PI * kk / 8), z);
    ED_OBJ.rotation.set(t * 3 + s, t * 2, 0); ED_OBJ.scale.setScalar(sc); ED_OBJ.updateMatrix();
    R.rock.mesh.setMatrixAt(k.idx, ED_OBJ.matrix);
  }
}
function ed_debris(cp, S, dt) {
  const R = ED_RES;
  for (let j = cp.debris.length - 1; j >= 0; j--) {
    const d = cp.debris[j];
    d.life += dt;
    if (d.life >= .6) { ed_release(R.rock, d.idx); cp.debris.splice(j, 1); continue; }
    d.vy -= 16 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
    const gy = terrainH(d.x, d.z) + .1;
    if (d.y < gy) { d.y = gy; d.vy = 0; d.vx *= .6; d.vz *= .6; }
    ED_OBJ.position.set(d.x, d.y, d.z); ED_OBJ.rotation.set(d.life * 9, d.life * 7, 0); ED_OBJ.scale.setScalar(.2 * S.thick); ED_OBJ.updateMatrix();
    R.rock.mesh.setMatrixAt(d.idx, ED_OBJ.matrix);
  }
}

// 前端塵土與火花(手機 fq 減量;多道時依道數分攤)
function ed_fx(cp, S, fxp, fzp) {
  const E = S.E, nd = Math.max(1, Math.round(fq(3) / S.nc)), ns = Math.max(1, Math.round(fq(4) / S.nc));
  for (let i = 0; i < nd; i++) {
    const w = rnd(-cp.hw, cp.hw), sg = w < 0 ? -1 : 1, x = fxp + cp.pxq * w, z = fzp + cp.pzq * w;
    smoke.emit(x, terrainH(x, z) + .2, z, cp.pxq * sg * rnd(1, 3), rnd(1, 2.5), cp.pzq * sg * rnd(1, 3), 1, rnd(.8, 1.2), E.s0, E.s1, .55, 2, -.1, .6);
  }
  for (let i = 0; i < ns; i++) {
    const w = rnd(-cp.hw, cp.hw), x = fxp + cp.pxq * w, z = fzp + cp.pzq * w;
    fire.emit(x, terrainH(x, z) + .3, z, rnd(-2, 2), rnd(1, 3), rnd(-2, 2), .4, rnd(.1, .2), E.c0, E.c1, 1, .3, 9, .5);
  }
  if (cp.i === 0 && Math.hypot(fxp - camera.position.x, fzp - camera.position.z) < 20) G.shake = Math.max(G.shake, .15 * CFG.shake);
}

// 龍頭:兩片錐體(上下顎),破土而出、張口一開一合、前端走完後下沉移除
function ed_head(R, ang) {
  const g = new THREE.Group(), up = new THREE.Mesh(R.jaw, STONE_MAT), lo = new THREE.Mesh(R.jaw, STONE_MAT);
  up.position.set(0, .12, .5); lo.position.set(0, -.12, .5);
  g.add(up, lo); g.rotation.y = ang; scene.add(g);
  return { g, up, lo };
}
function ed_headUpd(cp, S, fxp, fzp) {
  const h = cp.head;
  if (!h) return;
  const t = S.t, rise = Math.min(1, t / .25), sink = cp.arrived ? Math.min(1, (t - cp.tArr) / .4) : 0;
  const o = .15 + .15 * Math.sin(t * 12);
  h.g.position.set(fxp, terrainH(fxp, fzp) + .45 - (1 - rise) * 1.2 - sink * 1.2, fzp);
  h.up.rotation.x = Math.PI / 2 - o; h.lo.rotation.x = Math.PI / 2 + o;
  if (sink >= 1) { scene.remove(h.g); cp.head = null; }
}
