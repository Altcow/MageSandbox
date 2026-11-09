'use strict';
// 暗影(設計_魔法調整.md 第 14 節 S-2、S-4「暗影」列、S-8)。覆寫 SUMMON_KINDS.dark 整筆。
//   · build:斗篷 + 兜帽 + 碎尖 + 兩點亮紫眼合併成 1 mesh(MeshBasic、不加亮、深藍紫);腳下影池 1 mesh;頭部紫光暈 1 sprite。
//   · attack:第一發 2 s 後;之後每 interval(7.5 s)一發。發射前最後 0.6 s 為蓄力(視覺在 animate)。發射瞬間加一支暗影長矛。
//   · animate:蓄力視覺、煙池、影池貼地、長矛逐幀直線飛行,命中第一個活標靶 → hit(atkBase, 'dark') + erode(4 × fxK);撞到高台或飛過 40 m / 2.5 s 消失。
//   · onDeath:長矛收回,身體沉回影池 0.8 s(框架 fade 同時進行)。
// 依賴:summons_core.js(SUMMON_KINDS、SUMMON_DEF、mergeParts)、fx.js(EL、glowSprite、rnd、damp、V3)、spells.js(fq、addFx)、game.js(burstRing)、world.js(DUMMIES、PLATFORMS、surfaceY、platContains、platTop)。

(function () {

const DK_SPEED = 24, DK_FIRST = 2, DK_CHARGE = .6, DK_LIFE = 2.5, DK_RANGE = 40;
const DK_UP = new THREE.Vector3(0, 1, 0);
let DK_C = null;   // 共用幾何 / 材質(userData.shared = true)

function dkCache() {
  if (DK_C) return DK_C;
  const made = [];
  const cone = (r, h, seg) => { const g = new THREE.ConeGeometry(r, h, seg); made.push(g); return g; };
  const sph = (r, w, h) => { const g = new THREE.SphereGeometry(r, w, h); made.push(g); return g; };
  const bodyParts = [
    { geo: cone(.5, 1.5, 8), pos: [0, .75, 0], color: 0x1b0c33 },              // 斗篷(寬底朝下)
    { geo: sph(.24, 12, 10), pos: [0, 1.62, 0], color: 0x2a1450 },             // 兜帽
    { geo: cone(.12, .5, 4), pos: [-.3, .22, .1], rot: [Math.PI, 0, 0], color: 0x14061f },   // 下擺碎尖(尖朝下)
    { geo: cone(.12, .5, 4), pos: [.3, .24, .1], rot: [Math.PI, 0, 0], color: 0x14061f },
    { geo: cone(.1, .45, 4), pos: [0, .2, -.3], rot: [Math.PI, 0, 0], color: 0x14061f },
    { geo: sph(.05, 6, 4), pos: [-.09, 1.66, .21], color: 0xd9b0ff },          // 兩點亮紫眼(MeshBasic 直接顯示)
    { geo: sph(.05, 6, 4), pos: [.09, 1.66, .21], color: 0xd9b0ff }
  ];
  const poolGeo = new THREE.CircleGeometry(.6, 20); poolGeo.rotateX(-Math.PI / 2); made.push(poolGeo);
  const C = {
    body: mergeParts(bodyParts),
    bodyMat: new THREE.MeshBasicMaterial({ vertexColors: true }),
    pool: poolGeo,
    poolMat: new THREE.MeshBasicMaterial({ color: 0x1a0a2e, transparent: true, opacity: .55, depthWrite: false }),
    spearGeo: new THREE.ConeGeometry(.15, 1.4, 6),
    spearMat: new THREE.MeshBasicMaterial({ color: 0xb070ff, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false })
  };
  made.forEach(g => g.dispose());
  C.spearGeo.userData.shared = true; C.spearMat.userData.shared = true;
  C.body.userData.shared = true; C.bodyMat.userData.shared = true;
  C.pool.userData.shared = true; C.poolMat.userData.shared = true;
  DK_C = C;
  return C;
}

// 煙 / 蓄力粒子的密度隨 CFG.fxq 縮放(同 fq 的規則)
function dkK() { return (typeof CFG !== 'undefined' && CFG.fxq) || 1; }

function dkBuild(P, scale) {
  const C = dkCache(), g = new THREE.Group();
  const body = new THREE.Mesh(C.body, C.bodyMat); body.castShadow = true; g.add(body);
  const pool = new THREE.Mesh(C.pool, C.poolMat); g.add(pool);
  const glow = glowSprite(0xb070ff, 1.1, .5); glow.position.set(0, 1.6, .15); g.add(glow);
  g.scale.setScalar(scale);
  g.userData.dk = { pool, glow, ph: rnd(0, 6) };
  return g;
}

// 發射:從肩上朝目標(胸口)直線射出一支長矛;方向在發射當下固定,不追蹤
function dkFire(u, tgt) {
  const C = dkCache(), E = EL.dark;
  if (!u.dkSp) u.dkSp = [];
  const ox = u.x, oy = u.y + 1.5 * u.scale, oz = u.z;
  const dx0 = tgt.x - ox, dy0 = tgt.y + 1 - oy, dz0 = tgt.z - oz, L = Math.hypot(dx0, dy0, dz0) || 1;
  const dx = dx0 / L, dy = dy0 / L, dz = dz0 / L;
  const m = new THREE.Mesh(C.spearGeo, C.spearMat);
  m.quaternion.setFromUnitVectors(DK_UP, new V3(dx, dy, dz));
  m.position.set(ox + dx * .8, oy + dy * .8, oz + dz * .8);
  scene.add(m);
  u.dkSp.push({ m, dx, dy, dz, t: 0, dist: 0 });
  burstRing(new V3(ox, oy, oz), E.hex, .6 * u.scale);
}

// 普攻槽位:第一發 2 s 後,之後每 interval 一發;冷卻由這裡自己管理(發射後 atkT = interval)
function dkAttack(u, tgt, dt) {
  if (!u.dkInit) { u.dkInit = true; u.atkT = DK_FIRST; return; }
  if (u.atkT > 0) return;
  u.atkT = u.def.interval;
  dkFire(u, tgt);
}

function dkAnimate(u, dt) {
  const g = u.body, d = g && g.userData.dk;
  if (!d) return;
  if (!u.dkSp) u.dkSp = [];
  const E = EL.dark, sc = u.scale, fx = u.fxK || 1, K = dkK();
  // 蓄力:發射前最後 0.6 s,身體微伸高、頭部周圍聚集紫粒子
  const ch = u.state === 'attack' && u.dkInit && u.atkT > 0 && u.atkT <= DK_CHARGE ? 1 - u.atkT / DK_CHARGE : 0;
  d.ph += dt;
  g.rotation.z = Math.sin(d.ph * .9) * .05;
  g.position.x = Math.sin(d.ph * 1.1) * .06;
  g.scale.set(sc * (1 - .03 * ch), sc * (1 + .12 * ch), sc * (1 - .03 * ch));
  if (ch > 0 && Math.random() < dt * 20 * K) {
    const a = rnd(0, 6.283), r = rnd(.6, 1.2) * sc, hy = u.y + 1.6 * sc;
    const x = u.x + Math.cos(a) * r, y = hy + rnd(-.5, .5), z = u.z + Math.sin(a) * r;
    fire.emit(x, y, z, (u.x - x) * 2, (hy - y) * 2, (u.z - z) * 2, .5, rnd(.2, .35), E.c0, E.c1, 1, .3, 0, 1);
  }
  // 影池:貼地(地面高度 - 身體本地座標);出場 0.4 s 內擴大
  const gy = surfaceY(u.x, u.z, u.y + 1);
  d.pool.position.y = (gy - u.y) / sc + .02;
  d.pool.scale.setScalar(Math.min(1, .4 + u.age / .4));
  // 下擺煙池(暗紫,一般混合的煙粒子)
  if (Math.random() < dt * 6 * K) smoke.emit(u.x + rnd(-.45, .45) * sc, gy + rnd(0, .3), u.z + rnd(-.45, .45) * sc, rnd(-.2, .2), rnd(0, .2), rnd(-.2, .2), rnd(.9, 1.3), rnd(.9, 1.3), E.s0, E.s1, .5, 1.5, -.1, .6);
  // 長矛逐幀飛行
  for (let i = u.dkSp.length - 1; i >= 0; i--) {
    const s = u.dkSp[i], p = s.m.position, step = DK_SPEED * dt;
    s.t += dt; s.dist += step;
    p.x += s.dx * step; p.y += s.dy * step; p.z += s.dz * step;
    let hit = null, gone = s.t > DK_LIFE || s.dist > DK_RANGE;
    if (!gone) {
      for (const dm of DUMMIES) {
        if (dm.dead) continue;
        if (Math.hypot(dm.x - p.x, dm.z - p.z) < .7 && p.y > dm.y - .2 && p.y < dm.y + 2.2) { hit = dm; break; }
      }
      if (!hit && PLATFORMS.some(P => platContains(P, p.x, p.z, 0) && platTop(P, p.x, p.z) > p.y)) gone = true;
    }
    if (hit) {
      hit.hit(u.atkBase, s.dx, s.dz, 0, 'dark');
      hit.erode(4 * fx);
      burstRing(new V3(p.x, p.y, p.z), E.hex, 1.1);
      for (let j = 0; j < fq(8); j++) smoke.emit(p.x + rnd(-.3, .3), p.y + rnd(-.3, .3), p.z + rnd(-.3, .3), rnd(-.8, .8), rnd(-.3, .6), rnd(-.8, .8), rnd(.8, 1.2), rnd(.8, 1.3), E.s0, E.s1, .5, 2, -.1, .6);
    } else if (gone) {
      for (let j = 0; j < fq(4); j++) smoke.emit(p.x, p.y, p.z, rnd(-.5, .5), rnd(0, .4), rnd(-.5, .5), rnd(.6, .9), rnd(.7, 1.1), E.s0, E.s1, .45, 2, -.1, .6);
    } else if (Math.random() < dt * 20 * K) {
      smoke.emit(p.x, p.y, p.z, rnd(-.3, .3), rnd(0, .3), rnd(-.3, .3), rnd(.6, 1), rnd(.5, .9), E.s0, E.s1, .45, 2, -.1, .6);   // 尾跡煙
    }
    if (hit || gone) { scene.remove(s.m); u.dkSp.splice(i, 1); }
  }
}

function dkDeath(u) {
  if (u.dkSp) { for (const s of u.dkSp) scene.remove(s.m); u.dkSp.length = 0; }
  const E = EL.dark, g = u.body;
  for (let i = 0; i < fq(10); i++) smoke.emit(u.x + rnd(-.5, .5), u.y + rnd(0, 1.2), u.z + rnd(-.5, .5), rnd(-.4, .4), rnd(.2, .8), rnd(-.4, .4), rnd(.9, 1.3), rnd(1, 1.5), E.s0, E.s1, .5, 2, -.1, .6);
  let t = 0;
  addFx(dt => {
    t += dt;
    if (g) g.position.y -= dt * 2.2;   // 沉回影池
    return t < .8;
  });
}

SUMMON_KINDS.dark = { build: dkBuild, attack: dkAttack, animate: dkAnimate, onDeath: dkDeath };

})();
