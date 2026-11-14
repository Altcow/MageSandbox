'use strict';
// 弓箭手進階招式(設計_職業進階技能.md §2-1、§4-2;狀態效果見 設計_狀態效果系統.md §2-2、§4-1 Z3-A):
// 游擊架勢 B 列的 散射 / 後躍射擊 / 捕獸夾,第 4 格絕技 魔法箭矢,專注(弓能量)的獲得 / 流失,以及穿雲箭 / 暴雨的強化判定。
// 載入順序:skills.js → skills_archer.js → skills_sword.js → skills_assassin.js → resources.js → status.js → classes.js(index.html)。
// 招式註冊在 classes.js 的 CLASSES.archer.skills(cast 直接引用本檔函式);專注每幀由 classes.js 的 classTick 呼叫 archerTick(dt)。
// 遠端重現:P.net 有值時只播視覺,不改本機 G / mage、不扣專注、不對目標下效果;命中與狀態由攻擊者端判定、受害者端套用(netcombat.js)。
// 依賴(全域,執行期才取用):skills.js(flyProjectile、arrowMesh、hitFx、disposeObj、archRainTick 所用的 archMark 等)、
//   game.js(G、mage、CFG、CHG、moveInput、terrainBlocked、burstRing、flashLight、dissolveOrb、casterAura、casterTip、prnd)、
//   world.js(DUMMIES、COLLIDERS、PLATFORMS、platContains、platTop、surfaceY、ARENA_R)、resources.js(gainEnergy、spendEnergy)、status.js(無直接呼叫)。

/* ---------- 共用小工具 ---------- */
// 遠端重現(P.net 有值):只播視覺,不改本機 G / mage、不扣專注、不對目標下任何效果
const archRemote = P => P.net != null;
// 記號:本機施加在目標身上的定身 / 減速 / 照亮時限(遠端角色的 slowT 不在本機寫入,靠這個判斷暴雨加成與衝擊跌倒加成)
// 他人施加者:遠端角色的快照旗標(remote.js:stE 的 128 減速、lit 照亮)也計入
function archMark(d, k, t) { d[k] = Math.max(d[k] || 0, G.time + t); }
function archOn(d, k) { return (d[k] || 0) > G.time; }
function archSlowed(d) { return d.rootT > 0 || d.slowT > 0 || archOn(d, '_archSl') || ((d.stE | 0) & 128) !== 0; }
function archLit(d) { return d.litT > 0 || archOn(d, '_archLit') || d.lit === true; }
// 專注:命中 +6;同一次施放對同一目標只算一次(seen 為該次施放的 Set);遠端重現不加
function archHitGain(P, d, seen) { if (archRemote(P) || seen.has(d)) return; seen.add(d); gainEnergy(6); }
// 捕獸夾同時存在的上限與時間
const ARCH_SNARE_MAX = 2, ARCH_SNARE_ARM = .8, ARCH_SNARE_LIFE = 20, ARCH_SNARE_R = .9;
const ARCH_SNARES = [];   // { own: 'L' 本機 | 'R<座位>', gone }

/* ---------- 專注(弓能量) ---------- */
// 鷹眼架勢(stance 0)站定(地面、無移動輸入)滿 0.5 s 後每秒 +15;移動中每秒 −5;游擊架勢不累積站定專注
let archStillT = 0;
function archerTick(dt) {
  // 照亮中的潛行者立即顯形(任何職業都要跑:被照亮的可能是刺客)
  if (G.stealth && G.litT > 0) revealStealth('class');
  if (G.cls !== 'archer') { archStillT = 0; return; }
  archLeapTick(dt);
  const moving = moveInput().s > 0;
  if (moving) { archStillT = 0; if (G.cr > 0) G.cr = Math.max(0, G.cr - 5 * dt); return; }
  if (G.ground && (G.stance | 0) === 0) { archStillT += dt; if (archStillT >= .5) gainEnergy(15 * dt); }
  else archStillT = 0;
}
// 強化判定(release 時由資料列的 exFn 呼叫):集氣 MAX 且專注 ≥ need 時扣除專注並回傳 1,否則回傳 0 且不扣
// need:穿雲箭 40、暴雨 60
function archerExFn(q, need) { return q >= .999 && spendEnergy(need) ? 1 : 0; }

/* ---------- 後躍(本機位移,G.leap 每幀由 archerTick 推進) ---------- */
// 後躍 P.r(6 m)、0.3 s 拋物線(高 1.2 m);前 0.15 s 無敵(G.invuln,閃避否決沿用既有判定)
function archLeapStart(dist, ux, uz) {
  archLeapEnd();
  const p = mage.root.position;
  G.leap = { t: 0, dur: .3, dist, ux, uz, x0: p.x, z0: p.z, y0: p.y, hgt: 1.2, inv: true };
  G.invuln = true;
  burstRing(new V3(p.x, p.y, p.z), auraEl().hex, 1.2);
  for (let i = 0; i < (IS_TOUCH ? 6 : 10); i++) smoke.emit(p.x + rnd(-.3, .3), p.y + .1, p.z + rnd(-.3, .3), rnd(-1, 1), rnd(.3, 1), rnd(-1, 1), rnd(.5, .9), rnd(.8, 1.4), [.5, .45, .4], [.3, .3, .3], .4, 2, 0, 1.5);
}
function archLeapEnd() { const L = G.leap; if (L && L.inv) G.invuln = false; G.leap = null; }
// 後躍路徑會撞到的東西:場地邊界、碰撞體、高於腳下的平台、地形陡坡
function archLeapBlocked(x, z, y) {
  if (Math.hypot(x, z) > ARENA_R - .3) return true;
  for (const c of COLLIDERS) { if (c.ref && c.ref.dead) continue; if (Math.hypot(x - c.x, z - c.z) < c.r + .4) return true; }
  for (const H of PLATFORMS) if (platContains(H, x, z, .4) && platTop(H, x, z) > y + .3) return true;
  const p = mage.root.position;
  return terrainBlocked(x, z, p.x, p.z, y);
}
function archLeapTick(dt) {
  const L = G.leap; if (!L) return;
  if (G.down > 0) { archLeapEnd(); return; }
  const p = mage.root.position;
  L.t += dt; const u = Math.min(1, L.t / L.dur), e = easeOut(u);
  const nx = L.x0 + L.ux * L.dist * e, nz = L.z0 + L.uz * L.dist * e;
  if (u < 1 && archLeapBlocked(nx, nz, p.y)) { archLeapEnd(); return; }   // 撞到東西就停在原地,之後照重力落下
  p.x = nx; p.z = nz; p.y = L.y0 + 4 * L.hgt * u * (1 - u);
  G.vy = 0; G.ground = false;
  if (L.inv) G.invuln = L.t < .15;
  if (u >= 1) archLeapEnd();
}

/* ---------- 散射(B-1,集氣) ---------- */
// 扇形射出 CHG.count(5, q) 支(2~5),總角 P.r 度(同飛刀的扇形做法);每支 14 點;同一目標最多吃 3 支;每支擊退 0.6 m × fxK
function castScatter(P, orb) {
  const E = casterAura(P), cfg = CFG.skills.scatter, n = CHG.count(5, P.q), A = P.r * Math.PI / 180, from = casterTip(P, new V3()), rmt = archRemote(P);
  if (orb) dissolveOrb(orb, E);
  const cnt = new Map(), seen = new Set();
  for (let i = 0; i < n; i++) {
    const a = P.dir + (n === 1 ? 0 : lerp(-A / 2, A / 2, i / (n - 1)));
    const dx = Math.sin(a), dz = Math.cos(a), to = new V3(from.x + dx * cfg.range, from.y, from.z + dz * cfg.range);
    flyProjectile(from, to, 40, {
      mesh: arrowMesh(.5, .025, E.hex, 1), hitR: .3, stuck: .05, fade: false, trail: IS_TOUCH ? 1 : 2, c0: E.c0, c1: E.c1, solid: true,
      onHit: d => {
        hitFx(new V3(d.x, d.y + 1, d.z), 6);
        if (rmt) return;
        const k = cnt.get(d) || 0;
        if (k >= 3) return;
        cnt.set(d, k + 1);
        d.hit(14 * P.dmgK, dx, dz, 0, null);
        d.knock(dx, dz, .6 * P.fxK);
        archHitGain(P, d, seen);
      }
    });
  }
}

/* ---------- 後躍射擊(B-2,瞬發) ---------- */
// 往瞄準點的反方向後躍 P.r(本機);同時射出纏絆箭(射程 cfg.range,命中 18 × dmgK 並減速 50% 2 s)。遠端只重現箭。
function castDisengage(P, orb) {
  const E = casterAura(P), cfg = CFG.skills.disengage, rmt = archRemote(P), seen = new Set();
  if (orb) dissolveOrb(orb, E);
  const from = casterTip(P, new V3()), dx = Math.sin(P.dir), dz = Math.cos(P.dir);
  const to = new V3(from.x + dx * cfg.range, from.y, from.z + dz * cfg.range);
  flyProjectile(from, to, 45, {
    mesh: arrowMesh(.9, .03, E.hex, 1), hitR: .3, stuck: .5, fade: true, trail: IS_TOUCH ? 2 : 3, c0: E.c0, c1: E.c1, solid: true,
    onHit: (d, b) => {
      hitFx(b, 12);
      if (rmt) return;
      d.hit(18 * P.dmgK, dx, dz, 0, null);
      d.slow(2, .5); archMark(d, '_archSl', 2);
      archHitGain(P, d, seen);
    }
  });
  if (!rmt) archLeapStart(P.r, -dx, -dz);
}

/* ---------- 捕獸夾(B-3,集氣) ---------- */
// 落點放置陷阱:0.8 s 後上膛、存在 20 s;敵方進入 0.9 m 內(高差 < 1.6 m)觸發:20 × dmgK、定身 lerp(.75, 1.5, q)、照亮 3 s。
// 每人最多 2 個(放第 3 個時最舊的消失)。觸發只由擁有者端判定(命中走 hit 管道);遠端重現只播夾子的開合。
function castSnare(P, orb) {
  const E = casterAura(P), rmt = archRemote(P), own = rmt ? 'R' + P.net : 'L', R = ARCH_SNARE_R;
  if (orb) dissolveOrb(orb, E);
  const mine = ARCH_SNARES.filter(s => s.own === own);
  while (mine.length >= ARCH_SNARE_MAX) { const old = mine.shift(); old.gone = true; }
  const x = P.target.x, z = P.target.z, y = surfaceY(x, z, P.target.y + 1);
  const mat = new THREE.MeshBasicMaterial({ color: E.hex, transparent: true, opacity: rmt ? .35 : .9, depthWrite: false, side: THREE.DoubleSide });
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(R * .6, R, 24), mat); ring.rotation.x = -Math.PI / 2; ring.position.y = .03; g.add(ring);
  const jA = new THREE.Mesh(new THREE.BoxGeometry(R * 1.6, .04, .08), mat); jA.position.y = .04; jA.rotation.y = .7; g.add(jA);
  const jB = new THREE.Mesh(new THREE.BoxGeometry(R * 1.6, .04, .08), mat); jB.position.y = .04; jB.rotation.y = -.7; g.add(jB);
  g.position.set(x, y, z); scene.add(g);
  const S = { own, gone: false };
  ARCH_SNARES.push(S);
  const drop = () => { const i = ARCH_SNARES.indexOf(S); if (i >= 0) ARCH_SNARES.splice(i, 1); };
  const seen = new Set();
  let t = 0, spring = -1;
  addFx(dt => {
    if (spring >= 0) {   // 夾子合起來後消失
      spring += dt; const k = Math.min(1, spring / .3);
      g.scale.y = 1 - .7 * k;
      if (k >= 1) { disposeObj(g); drop(); return false; }
      return true;
    }
    t += dt;
    if (S.gone || t >= ARCH_SNARE_LIFE) { disposeObj(g); drop(); return false; }
    const armed = t >= ARCH_SNARE_ARM;
    mat.opacity = (rmt ? .35 : .9) * (armed ? 1 : .4);
    if (!armed) return true;
    let d = null;
    for (const e of DUMMIES) { if (e.dead || Math.hypot(e.x - x, e.z - z) >= R + .3 || Math.abs(e.y - y) >= 1.6) continue; d = e; break; }
    const p = mage.root.position, local = rmt && Math.hypot(p.x - x, p.z - z) < R + .3 && Math.abs(p.y - y) < 1.6;
    if (!d && !local) return true;
    spring = 0; hitFx(new V3(x, y + 1, z), 10);
    if (d && !rmt) {
      d.hit(20 * P.dmgK, d.x - x, d.z - z, 0, null);
      const rt = lerp(.75, 1.5, P.q);
      d.root(rt); archMark(d, '_archSl', rt);
      d.light(3); archMark(d, '_archLit', 3);
      archHitGain(P, d, seen);
    }
    return true;
  });
}

/* ---------- 魔法箭矢(第 4 格絕技,id 仍為 flare,集氣) ---------- */
// 朝面向(P.dir)射出一支附魔箭,命中第一個目標就停、被障礙擋住;施放者(本機)隨機 火 / 冰 / 風 / 雷 四選一,
// 傷害 CFG.skills.flare.damage × dmgK,並依元素施加:火 燃燒、冰 凍結、風 減速、雷 麻痺(數值全在 CFG.skills.flare)。
// 元素用 prnd(P)(多人時 P.rng 種子與遠端相同,發送端與重現端第一個亂數必然一致)→ 遠端箭色與本機一致;
// 命中與狀態只由擁有者端判定(遠端 rmt 只播視覺),傷害 / 狀態走既有的 d.hit / d.slow / d.paralyze / d.freeze(RemotePlayer 轉為 hit 事件)。
const MA_EL = [
  { k: 'fire', hex: 0xff5a1a, c0: [1, .8, .4], c1: [.95, .2, .03] },
  { k: 'ice', hex: 0x9fe0ff, c0: [.92, .98, 1], c1: [.4, .75, 1] },
  { k: 'wind', hex: 0x8affc8, c0: [.9, 1, .95], c1: [.35, .85, .6] },
  { k: 'thunder', hex: 0xffe030, c0: [1, 1, .75], c1: [1, .8, .1] }
];
function maSpark(pos, e, n) {
  const k = IS_TOUCH ? Math.ceil(n * .6) : n;
  for (let i = 0; i < k; i++) fire.emit(pos.x, pos.y, pos.z, rnd(-3, 3), rnd(0, 4), rnd(-3, 3), rnd(.2, .4), rnd(.08, .16), e.c0, e.c1, 1, .3, 6, .5);
}
function castMagicArrow(P, orb) {
  const E = casterAura(P), cfg = CFG.skills.flare, rmt = archRemote(P), seen = new Set();
  const e = MA_EL[Math.min(3, prnd(P, 0, 4) | 0)];
  if (orb) dissolveOrb(orb, E);
  const from = casterTip(P, new V3()), dx = Math.sin(P.dir), dz = Math.cos(P.dir);
  const to = new V3(from.x + dx * cfg.range, from.y, from.z + dz * cfg.range);
  flyProjectile(from, to, cfg.speed, {
    mesh: arrowMesh(1.1, .03, e.hex, 1), hitR: .3, stuck: .5, fade: true, trail: IS_TOUCH ? 2 : 4, c0: e.c0, c1: e.c1, solid: true,
    onEnd: b => maSpark(b, e, 8),
    onHit: (d, b) => {
      maSpark(b, e, 14); burstRing(new V3(b.x, b.y, b.z), e.hex, 1.2);
      if (rmt) return;
      const dmg = cfg.damage * P.dmgK;
      if (e.k === 'fire') d.hit(dmg, dx, dz, cfg.burn, null);
      else {
        d.hit(dmg, dx, dz, 0, null);
        if (e.k === 'ice') d.freeze(cfg.freeze);
        else if (e.k === 'wind') { d.slow(cfg.slowT, cfg.slowPct); archMark(d, '_archSl', cfg.slowT); }
        else d.paralyze(cfg.para);
      }
      archHitGain(P, d, seen);
    }
  });
}
