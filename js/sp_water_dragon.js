'use strict';
// 水龍彈(設計_魔法調整.md 第 3 節):五爪水龍從地面竄出,沿直線蛇行衝出;走廊內每個標靶命中一次,終點潛地濺爆。
// 載入順序:fx.js → mage.js → world.js → scenes.js → game.js → spells.js → sp_water_dragon.js → skills.js。
// 只在執行期被呼叫(launchSpell 依名稱查 castWaterDragon);頂層只建立共用幾何 / 材質,不讀 game.js / spells.js 的變數。
// 頂層輔助名稱一律加 wd_ 前綴。階段 0 介面(CHG.mode 系、forCopies、Dummy.slow 第二參數)未就緒時以 typeof 保護退回單份。

const wd_UP = new V3(0, 1, 0);
const wd_N = 22;                  // 身體節數
const wd_SPEED = 18;              // 龍頭衝刺速度 m/s
const wd_ANG = [0, -14, 14];      // B 模式多條龍的側偏角(度),依序 0 / −14 / +14
const wd_BODY_GEO = new THREE.SphereGeometry(1, 12, 8);
const wd_LEG_GEO = new THREE.CylinderGeometry(.12, .1, 1, 6);
const wd_CLAW_GEO = new THREE.ConeGeometry(.05, .35, 4);
const wd_FIN_GEO = new THREE.ConeGeometry(.08, .4, 4);
const wd_SNOUT_GEO = new THREE.ConeGeometry(.5, 1.6, 8).rotateX(Math.PI / 2);     // 尖端朝前(+Z)
const wd_JAW_GEO = new THREE.ConeGeometry(.3, 1.2, 8).rotateX(Math.PI / 2);
const wd_HORN_GEO = new THREE.ConeGeometry(.12, .9, 5).rotateX(-Math.PI / 2);     // 尖端朝後(−Z)
const wd_WHISK_GEO = new THREE.CylinderGeometry(.03, .01, 2.2, 4);
const wd_MANE_GEO = new THREE.ConeGeometry(.1, .4, 4);
const wd_WATER_MAT = new THREE.MeshStandardMaterial({ color: 0x2f8fff, emissive: 0x1a6cff, emissiveIntensity: .5, transparent: true, opacity: .8, roughness: .15, metalness: .1 });
const wd_SHELL_MAT = new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: .22, blending: THREE.AdditiveBlending, depthWrite: false });
const wd_BONE_MAT = new THREE.MeshStandardMaterial({ color: 0xe8f4ff, roughness: .4 });
const wd_m4 = new THREE.Matrix4(), wd_qt = new THREE.Quaternion(), wd_pv = new V3(), wd_sv = new V3(), wd_dv = new V3();

const wd_ss = t => t * t * (3 - 2 * t);

// 寫入一個實例:位置 (px,py,pz)、方向 (dx,dy,dz)(零向量 = 不旋轉)、尺寸 (sx,sy,sz)
function wd_put(im, i, px, py, pz, dx, dy, dz, sx, sy, sz) {
  wd_pv.set(px, py, pz); wd_sv.set(sx, sy, sz);
  if (dx || dy || dz) wd_qt.setFromUnitVectors(wd_UP, wd_dv.set(dx, dy, dz).normalize()); else wd_qt.identity();
  im.setMatrixAt(i, wd_m4.compose(wd_pv, wd_qt, wd_sv));
}

// 單隻水龍的零件(每次施放建立、結束時移除);頭部子零件以頭的本地座標擺放
function wd_rig(scale) {
  const r = {};
  const mk = (geo, mat, n) => { const im = new THREE.InstancedMesh(geo, mat, n); im.frustumCulled = false; return im; };
  r.body = mk(wd_BODY_GEO, wd_WATER_MAT, wd_N);
  r.shell = mk(wd_BODY_GEO, wd_SHELL_MAT, wd_N);
  r.legs = mk(wd_LEG_GEO, wd_WATER_MAT, 4);
  r.claws = mk(wd_CLAW_GEO, wd_BONE_MAT, 20);
  r.fins = mk(wd_FIN_GEO, wd_WATER_MAT, 10);
  r.horns = mk(wd_HORN_GEO, wd_BONE_MAT, 2);
  r.whisk = mk(wd_WHISK_GEO, wd_BONE_MAT, 2);
  r.mane = mk(wd_MANE_GEO, wd_WATER_MAT, 6);
  const snout = new THREE.Mesh(wd_SNOUT_GEO, wd_WATER_MAT); snout.position.set(0, .05, .7);
  const jaw = new THREE.Mesh(wd_JAW_GEO, wd_WATER_MAT); jaw.position.set(0, -.28, .55); jaw.rotation.x = -.3;
  r.eyes = [-1, 1].map(s => { const e = glowSprite(0xffffff, .35, .9); e.position.set(s * .32, .22, .42); return e; });
  r.head = new THREE.Group();
  r.head.add(snout, jaw, r.horns, r.whisk, r.mane, r.eyes[0], r.eyes[1]);
  for (let k = 0; k < 2; k++) wd_put(r.horns, k, (k ? 1 : -1) * .3, .4, -.3, 0, 0, 0, 1, 1, 1);
  for (let k = 0; k < 6; k++) wd_put(r.mane, k, 0, .4, -.1 - k * .22, 0, 1, -.4, 1, 1, 1);
  r.head.scale.setScalar(scale);
  return r;
}

// 沿路徑高度(相對 surfaceY):起點從 −2 竄出、中段 2.2 + .6 sin(.7 s)、終點 3 m 內俯衝到 −2
function wd_h(D, s) {
  const mid = 2.2 + .6 * Math.sin(s * .7);
  const up = wd_ss(clamp(s / 3, 0, 1)), dn = wd_ss(clamp((s - (D.Ld - 3)) / 3, 0, 1));
  return lerp(lerp(-2, mid, up), -2, dn);
}
// 龍頭位置:沿方向前進 s,加側向擺動 0.8 sin(0.5 s + φ),高度貼地形
function wd_head(D, s, out) {
  const lat = .8 * Math.sin(s * .5 + D.phi);
  out.x = D.ox + D.sn * s + D.cs * lat;
  out.z = D.oz + D.cs * s - D.sn * lat;
  out.y = surfaceY(out.x, out.z, D.gy + 2) + wd_h(D, s);
  return out;
}
// 點到線段(XZ 平面)的最近點與距離
function wd_seg(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
  const u = L2 > 1e-9 ? clamp(((px - ax) * vx + (pz - az) * vz) / L2, 0, 1) : 0;
  const x = ax + vx * u, z = az + vz * u;
  return { x, z, dist: Math.hypot(px - x, pz - z) };
}
// 路徑在場地邊界 (ARENA_R − 1) 處截斷,提前俯衝
function wd_arena(ox, oz, dx, dz, Ld) {
  const R = ARENA_R - 1, b = ox * dx + oz * dz, c = ox * ox + oz * oz - R * R;
  if (c > 0) return 1;
  const s = -b + Math.sqrt(b * b - c);
  return s < Ld ? Math.max(1, s) : Ld;
}

// 地面濺水(沿途每 2.5 m 與終點以外的純視覺)
function wd_splash(x, gy, z) {
  const E = EL.water;
  for (let k = 0; k < fq(12); k++) fire.emit(x + rnd(-.6, .6), gy + .2, z + rnd(-.6, .6), rnd(-2, 2), rnd(2, 5), rnd(-2, 2), rnd(.4, .7), rnd(.15, .25), E.c0, E.c1, 1, .3, 9, .3);
  burstRing(new V3(x, gy + .05, z), EL_BURST.water.ring, 1.4);
}

// 龍頭命中走廊內的標靶(每隻龍每個標靶一次)
function wd_hitAll(D, ax, az, bx, bz) {
  const E = EL.water;
  for (const d of DUMMIES) {
    if (d.dead || D.hit.has(d)) continue;
    const q = wd_seg(d.x, d.z, ax, az, bx, bz);
    if (q.dist >= D.hw + .4) continue;
    if (Math.abs(d.y - surfaceY(d.x, d.z, D.gy + 2)) >= 3) continue;
    D.hit.add(d);
    let nx = d.x - q.x, nz = d.z - q.z; const l = Math.hypot(nx, nz);
    if (l < 1e-4) { nx = D.sn; nz = D.cs; } else { nx /= l; nz /= l; }
    d.hit(D.dmg, nx, nz, 0, 'water');
    d.slow(3, .5 * D.fxK);          // 第二參數 pct 為階段 0 的 Dummy.slow(t, pct)
    d.lift(.8 * D.fxK);
    for (let k = 0; k < fq(8); k++) fire.emit(d.x + rnd(-.3, .3), 1 + d.y, d.z + rnd(-.3, .3), rnd(-1, 1), rnd(1, 3), rnd(-1, 1), rnd(.35, .6), rnd(.12, .2), E.c0, E.c1, 1, .3, 9, .3);
  }
}

// 終點潛地濺爆(只發生一次,龍頭到達終點時)
function wd_end(D, hp) {
  const sc = D.scale, gy = surfaceY(hp.x, hp.z, D.gy + 2);
  D.ended = true; D.tEnd = D.t;
  const c = new V3(hp.x, gy + .5, hp.z);
  explode(c, 2.5 * sc, D.Pi.power || .6, { dmg: 0, el: 'water', gy, fxK: D.fxK });
  areaEl(c, 2.5 * sc, 50, 'water', D.Pi);
  burstRing(new V3(hp.x, gy + .05, hp.z), EL_BURST.water.ring, 2.5 * sc);
  if (D.main) G.shake = Math.max(G.shake, .25 * CFG.shake);
}

// 身體節點:沿龍頭走過的路徑歷史取樣,節距 0.55 × 體型;同時算切線與終點下沉
function wd_nodes(D, hp, tt) {
  const N = wd_N, sp = .55 * D.scale, H = D.hist;
  let k = 0, acc = 0, a = H[H.length - 1];
  for (let q = H.length - 2; q >= 0 && k < N; q--) {
    const b = H[q], seg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    while (k < N && acc + seg >= (k + 1) * sp) {
      const u = ((k + 1) * sp - acc) / seg;
      D.px[k] = a.x + (b.x - a.x) * u; D.py[k] = a.y + (b.y - a.y) * u; D.pz[k] = a.z + (b.z - a.z) * u; k++;
    }
    acc += seg; a = b;
  }
  for (; k < N; k++) { D.px[k] = H[0].x; D.py[k] = H[0].y; D.pz[k] = H[0].z; }
  for (let i = 0; i < N; i++) {
    const ax = i === 0 ? hp.x : D.px[i - 1], az = i === 0 ? hp.z : D.pz[i - 1];
    const bx = i === N - 1 ? D.px[i] : D.px[i + 1], bz = i === N - 1 ? D.pz[i] : D.pz[i + 1];
    let tx = ax - bx, tz = az - bz; const l = Math.hypot(tx, tz);
    if (l < 1e-4) { tx = D.sn; tz = D.cs; } else { tx /= l; tz /= l; }
    D.tx[i] = tx; D.tz[i] = tz;
  }
  if (D.ended) for (let i = 0; i < N; i++) D.py[i] -= 4 * clamp((tt - i / (N - 1) * .45) / .25, 0, 1);   // 依序鑽入地面
}
function wd_body(D, rg) {
  const N = wd_N, sc = D.scale;
  for (let i = 0; i < N; i++) {
    const r = sc * lerp(.9, .25, i / (N - 1)), x = D.px[i], y = D.py[i], z = D.pz[i];
    wd_put(rg.body, i, x, y, z, 0, 0, 0, r, r, r);
    wd_put(rg.shell, i, x, y, z, 0, 0, 0, r * 1.25, r * 1.25, r * 1.25);
  }
  rg.body.instanceMatrix.needsUpdate = true; rg.shell.instanceMatrix.needsUpdate = true;
}
// 四腿五爪(前腿第 4、5 節,後腿第 12、13 節)與背鰭(第 2~20 節每兩節一個)
function wd_limbs(D, rg) {
  const sc = D.scale, LN = [4, 5, 12, 13], LS = [1, -1, 1, -1], N = wd_N;
  for (let j = 0; j < 4; j++) {
    const k = LN[j], sg = LS[j], tx = D.tx[k], tz = D.tz[k];
    const sx = tz * sg, sz = -tx * sg;                 // 側向(外側)
    let dx = sx * .8, dy = -1, dz = sz * .8; const il = 1 / Math.hypot(dx, dy, dz); dx *= il; dy *= il; dz *= il;
    const L = 2 * sc, px = D.px[k], py = D.py[k], pz = D.pz[k];
    wd_put(rg.legs, j, px + dx * L / 2, py + dy * L / 2, pz + dz * L / 2, dx, dy, dz, sc, L, sc);
    const fx = px + dx * L, fy = py + dy * L, fz = pz + dz * L;
    for (let q = 0; q < 5; q++) {
      const ss = Math.sin(-.6 + .3 * q) * .9;
      let cx = tx * .9 + sx * ss, cy = -.8, cz = tz * .9 + sz * ss; const cl = 1 / Math.hypot(cx, cy, cz); cx *= cl; cy *= cl; cz *= cl;
      wd_put(rg.claws, j * 5 + q, fx + cx * .175 * sc, fy + cy * .175 * sc, fz + cz * .175 * sc, cx, cy, cz, sc, sc, sc);
    }
  }
  for (let j = 0; j < 10; j++) {
    const k = 2 + 2 * j, r = sc * lerp(.9, .25, k / (N - 1));
    wd_put(rg.fins, j, D.px[k], D.py[k] + r * .9, D.pz[k], 0, 1, 0, sc, sc, sc);
  }
  rg.legs.instanceMatrix.needsUpdate = true; rg.claws.instanceMatrix.needsUpdate = true; rg.fins.instanceMatrix.needsUpdate = true;
}
// 龍鬚隨時間擺動(頭的本地座標)
function wd_whisk(rg, t) {
  for (let w = 0; w < 2; w++) {
    const s = w ? 1 : -1, dx = s * .25 + Math.sin(t * 3 + w * 2) * .12, dy = -.45, dz = -1;
    const il = 1 / Math.hypot(dx, dy, dz);
    wd_put(rg.whisk, w, s * .35 + dx * il * 1.1, -.2 + dy * il * 1.1, -.3 + dz * il * 1.1, dx, dy, dz, 1, 1, 1);
  }
  rg.whisk.instanceMatrix.needsUpdate = true;
}
// 每幀粒子:龍頭浪花 fq(3)、身體隨機噴水滴 fq(6)、煙池水霧 fq(1)
function wd_fx(D, hp) {
  const E = EL.water, sc = D.scale;
  for (let k = 0; k < fq(3); k++) fire.emit(hp.x + rnd(-.4, .4), hp.y + rnd(0, .4), hp.z + rnd(-.4, .4), rnd(-1.5, 1.5), rnd(1, 3), rnd(-1.5, 1.5), rnd(.3, .5), rnd(.15, .25) * sc, E.c0, E.c1, .9, .3, 9, .3);
  for (let k = 0; k < fq(6); k++) { const j = (Math.random() * wd_N) | 0; fire.emit(D.px[j] + rnd(-.3, .3), D.py[j] + rnd(0, .5), D.pz[j] + rnd(-.3, .3), rnd(-1, 1), rnd(0, 2), rnd(-1, 1), .5, rnd(.12, .2) * sc, E.c0, E.c1, 1, .5, 9, .4); }
  for (let k = 0; k < fq(1); k++) smoke.emit(hp.x + rnd(-.4, .4), hp.y, hp.z + rnd(-.4, .4), rnd(-.5, .5), rnd(.2, .8), rnd(-.5, .5), .9, rnd(.5, .8), E.s0, E.s1, .8, 1.5, -.1, .5);
}

function wd_dispose(D) {
  const rg = D.rig;
  for (const im of [rg.body, rg.shell, rg.legs, rg.claws, rg.fins]) { scene.remove(im); if (im.dispose) im.dispose(); }
  for (const im of [rg.horns, rg.whisk, rg.mane]) if (im.dispose) im.dispose();
  scene.remove(rg.head);
  for (const e of rg.eyes) e.material.dispose();
  disposeInd(D.wi);
  if (D.main && typeof endLight === 'function') endLight(D.token);
}

// 每幀更新:回傳 false 表示結束並清除
function wd_step(D, dt) {
  const E = EL.water, rg = D.rig, sc = D.scale;
  D.t += dt;
  const t = D.t, Ld = D.Ld, tEnd = Ld / wd_SPEED;
  D.sPrev = D.s; D.s = Math.min(Ld, wd_SPEED * t);
  const hp = wd_head(D, D.s, D.cur);
  if (D.s > D.sPrev) wd_hitAll(D, D.ox + D.sn * D.sPrev, D.oz + D.cs * D.sPrev, D.ox + D.sn * D.s, D.oz + D.cs * D.s);
  while (D.nextSp <= D.s) { const x = D.ox + D.sn * D.nextSp, z = D.oz + D.cs * D.nextSp; wd_splash(x, surfaceY(x, z, D.gy + 2), z); D.nextSp += 2.5; }
  if (!D.ended && t >= tEnd) wd_end(D, hp);
  const tt = D.ended ? t - D.tEnd : 0;

  D.hist.push({ x: hp.x, y: hp.y, z: hp.z });
  wd_nodes(D, hp, tt);
  wd_body(D, rg);
  wd_limbs(D, rg);

  // 龍頭朝前進方向(速度為零時用路徑方向)
  let fx = hp.x - D.pv.x, fy = hp.y - D.pv.y, fz = hp.z - D.pv.z;
  if (fx * fx + fy * fy + fz * fz < 1e-6) { fx = D.sn; fy = 0; fz = D.cs; }
  rg.head.position.set(hp.x, hp.y, hp.z);
  rg.head.lookAt(hp.x + fx, hp.y + fy, hp.z + fz);
  wd_whisk(rg, t);
  wd_fx(D, hp);

  const fin = Math.min(1, t / .3) * (D.ended ? Math.max(0, 1 - tt / .35) : 1);
  D.wi.set(D.ox + D.sn * Ld / 2, D.oz + D.cs * Ld / 2, 1, Ld / 2, D.hw, D.yaw, 0, .4 * fin, E.hex, D.gy);
  D.wi.tick(t);
  if (D.main && typeof driveLight === 'function') {
    driveLight(D.token, 2 * Math.min(1, t / .3) * (D.ended ? Math.max(0, 1 - tt / .35) : 1));
    if (LIGHTS[4].userData.owner === D.token) LIGHTS[4].position.set(hp.x, hp.y + 1, hp.z);
  }

  if (D.ended && tt > .65) { wd_dispose(D); return false; }
  D.pv.copy(hp);
  return true;
}

// 單隻龍的初始化:幾何參數依 P(第 3-1 / 3-4 節),份數已由 forCopies 拆好(Pi.copy / Pi.dmgK)
function wd_launch(Pi, i, n, ox, oz) {
  const E = EL.water, mode = Pi.mode, sizeK = Pi.sizeK || 1, rs = Pi.r ? Pi.r / sizeK : 4, thk = Pi.thickK || 1;
  const scale = mode === 'B' ? .8 : thk;
  const hw = 1.6 * (mode === 'A' ? thk : 1);
  const base = typeof Pi.dir === 'number' ? Pi.dir : 0;
  const th = base + (n > 1 ? (wd_ANG[i] || 0) : 0) * Math.PI / 180;
  const sn = Math.sin(th), cs = Math.cos(th);
  const Ld = Math.max(1, wd_arena(ox, oz, sn, cs, 2.5 * rs * sizeK));
  const D = {
    Pi, ox, oz, sn, cs, yaw: th - Math.PI / 2, gy: Pi.target.y, Ld, scale, hw,
    fxK: Pi.fxK || 1, dmg: 100 * (Pi.dmgK || 1), phi: prnd(Pi, 0, 6.283),
    main: !i, token: {}, s: 0, sPrev: 0, t: 0, ended: false, tEnd: 0, nextSp: 2.5, hit: new Set(), hist: [],
    px: new Float64Array(wd_N), py: new Float64Array(wd_N), pz: new Float64Array(wd_N),
    tx: new Float64Array(wd_N), tz: new Float64Array(wd_N),
    cur: new V3(), pv: new V3(), rig: wd_rig(scale), wi: new Indicator(scene)
  };
  const rg = D.rig;
  scene.add(rg.body, rg.shell, rg.legs, rg.claws, rg.fins, rg.head);
  wd_head(D, 0, D.pv); D.cur.copy(D.pv);
  D.hist.push({ x: D.pv.x, y: D.pv.y, z: D.pv.z });
  for (let i2 = 0; i2 < wd_N; i2++) { D.px[i2] = D.pv.x; D.py[i2] = D.pv.y; D.pz[i2] = D.pv.z; }

  // 竄出時的大濺水
  const sy = surfaceY(ox, oz, D.gy + 2);
  for (let k = 0; k < fq(40); k++) fire.emit(ox + rnd(-.8, .8), sy + rnd(0, .4), oz + rnd(-.8, .8), rnd(-3, 3), rnd(4, 8), rnd(-3, 3), rnd(.5, .9), rnd(.2, .4), E.c0, E.c1, 1, .3, 9, .3);
  for (let k = 0; k < fq(10); k++) smoke.emit(ox + rnd(-1, 1), sy + .3, oz + rnd(-1, 1), rnd(-1, 1), rnd(2, 5), rnd(-1, 1), rnd(.8, 1.2), rnd(.9, 1.4), E.s0, E.s1, .9, 1, 9, .2);
  if (D.main) {
    flashLight(new V3(ox, sy + 1, oz), E.hex, 4, .4, 18);
    G.shake = Math.max(G.shake, .15 * CFG.shake);
    if (typeof claimLight === 'function') claimLight(D.token, 0x4aa8ff, new V3(ox, sy + 2, oz), 14);
  }
  addFx(dt => wd_step(D, dt));
}

// 施放入口(launchSpell 依名稱查表呼叫):能量球鑽入前方 2 m 地面 → 每份龍竄出
function castWaterDragon(P, orb) {
  const E = EL.water, gy = P.target.y, pp = casterPos(P), th = typeof P.dir === 'number' ? P.dir : 0;
  const ox = pp.x + Math.sin(th) * 2, oz = pp.z + Math.cos(th) * 2;
  orbFly(orb, new V3(ox, gy + .3, oz), .25, E, () => {
    dissolveOrb(orb, E);
    burstRing(new V3(ox, gy + .05, oz), E.hex, 2);
    if (typeof forCopies === 'function') forCopies(P, 'sky', 0, null, (Pi, i, n) => wd_launch(Pi, i, n, ox, oz));
    else wd_launch(P, 0, 1, ox, oz);
  });
}
