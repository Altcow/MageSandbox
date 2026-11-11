'use strict';
// 刺客進階招式空殼(S 批,寫手 C 實作):影舞的 暗影步 / 煙霧彈 / 割喉,第 4 格絕技 影分身,以及煙霧區域判定。
// 載入順序:skills.js → skills_archer.js → skills_sword.js → skills_assassin.js → resources.js → classes.js(index.html)。
// 註冊:classes.js 的 CLASSES.assassin.skills 以函式名直接引用(cast: castShadowStep 等),本檔只定義函式,不需另外登錄。
// 實作重點:P 為施放資料,orb 為能量球;P.net 代表遠端重現,只跑視覺,改動 G / 能量 / 狀態一律以 if (!P.net) 守門。
// 連擊點(CLASSES.assassin.energy,kind: 'combo',max 5):背刺 / 飛刀 / 暗影步在 skills.js / 本檔獲得;割喉以 exFn 在 release 時消耗全部點數(P.ex);8 s 無獲得歸零(assassinTick)。
// 煙霧區域:SMOKES 內的 addSlowZone 區域;smokeAt(x, z) 供 remote.js 判定半隱形,inOwnSmoke() 供傷害 / 顯形判定。

/* ---------- 連擊點計時、影舞架勢、背後判定 ---------- */
const COMBO_IDLE = 8;   // 連擊點:幾秒沒有獲得就歸零
// 每幀(classes.js classTick 呼叫,只刺客):暗影步背後計時、連擊點流失;潛行中不流失(計時凍結)
function assassinTick(dt) {
  if (G.shadowT > 0) G.shadowT = Math.max(0, G.shadowT - dt);
  if (G.danceT > 0) G.danceT = Math.max(0, G.danceT - dt);
  if (G.cr <= 0 || G.stealth) return;
  G.crIdle = (G.crIdle || 0) + dt;
  if (G.crIdle >= COMBO_IDLE) { G.cr = 0; G.crIdle = 0; }
}
// 影舞架勢(第 2 架勢):翻滾 SP 12、冷卻 0.4 s(game.js tryRoll / 翻滾結束讀取);翻滾後 0.8 s 內的下一刀傷害 ×1.2
const danceOn = () => G.cls === 'assassin' && G.stance === 1;
// 背後:標靶正面向量 · 指向攻擊者 ≤ -0.5(與 skills.js 背刺判定相同);p 為攻擊者位置
function behindOf(t, p) {
  const ax = p.x - t.x, az = p.z - t.z, l = Math.hypot(ax, az) || 1;
  return Math.sin(t.yaw) * ax / l + Math.cos(t.yaw) * az / l <= -.5;
}

/* ---------- 煙霧區域 ---------- */
const SMOKES = [];   // 目前的煙霧區(= addSlowZone 建立的 zone 物件,含 owner / x / z / r)
// 座標 (x, z) 是否在任一煙霧區內(remote.js 判定半隱形用)
function smokeAt(x, z) { for (const S of SMOKES) if (Math.hypot(x - S.x, z - S.z) <= S.r) return true; return false; }
// 本機座位(與 world.js addSlowZone 的 owner 規則相同)
const myOwner = () => (typeof NET_ME === 'number' ? NET_ME : 0);
// 自己的煙中:被打不顯形、背刺 / 割喉視同潛行加成
function inOwnSmoke() { const p = mage.root.position; return SMOKES.some(S => S.owner === myOwner() && Math.hypot(p.x - S.x, p.z - S.z) <= S.r); }

/* ---------- 暗影步(B-1) ---------- */
// 集氣 0.3 s:落點 P.r 內最近的標靶身後 1.2 m、面向它(沿用 G.dash 'blink' + G.tp++);沒有標靶就往落點方向瞬移最多 5 m。
// 成功 +1 連擊點;1.5 s 內的下一刀視為背後(G.shadowT,背刺 / 割喉消耗)。netFx 'blink':遠端只播殘影,位置由快照 tp 跳過去
function castShadowStep(P, orb) {
  const E = casterAura(P), cfg = CFG.skills.shadowStep;
  if (orb) dissolveOrb(orb, E);
  if (P.net) return;
  const p = mage.root.position;
  let best = null, bd = P.r;
  for (const d of DUMMIES) { if (d.dead) continue; const dd = Math.hypot(d.x - P.target.x, d.z - P.target.z); if (dd <= bd) { bd = dd; best = d; } }
  let tx, tz;
  if (best) { tx = best.x - Math.sin(best.yaw) * 1.2; tz = best.z - Math.cos(best.yaw) * 1.2; }
  else {
    const dx = P.target.x - p.x, dz = P.target.z - p.z, d = Math.hypot(dx, dz) || 1, L = Math.min(d, 5);
    tx = p.x + dx / d * L; tz = p.z + dz / d * L;
  }
  const dx = tx - p.x, dz = tz - p.z, L = Math.hypot(dx, dz);
  P.recover = .14 + .12 + cfg.recover;
  G.tp = (G.tp | 0) + 1;
  if (L > .05) G.dash = { kind: 'blink', dirx: dx / L, dirz: dz / L, yaw: Math.atan2(dx, dz), speed: L / .12, left: L, t: 0, step: 0, s0x: p.x, s0z: p.z, hex: E.hex, ghosts: 0, end: () => { } };
  if (best) { gainEnergy(1); G.shadowT = 1.5; }
  burstRing(new V3(p.x, p.y, p.z), E.hex, 1.2);
}

/* ---------- 煙霧彈(B-2) ---------- */
// 集氣 0.7 s:圈內敵人減速 25%(addSlowZone pct .25);圈內對圈外觀看者半隱形(smokeAt,觀看端自己判);
// 非施放者在圈內 → 本機致盲 1 s 延續(每幀取大,離開後 1 s 才消);持續 5 s × durK。各端各自建立(遠端重現同參數)
function castSmoke(P, orb) {
  const E = casterAura(P), cx = P.target.x, cz = P.target.z, R = P.r, T = 5 * P.durK, cy = P.target.y;
  if (orb) dissolveOrb(orb, E);
  const zone = addSlowZone({ kind: 'circle', x: cx, z: cz, r: R, pct: .25, hex: E.hex, fx: { blind: 1 }, noSelf: true });
  SMOKES.push(zone);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 28), new THREE.MeshBasicMaterial({ color: 0x3a2a4a, transparent: true, opacity: .5, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.set(cx, surfaceY(cx, cz, cy + 1) + .1, cz); scene.add(disc);
  burstRing(new V3(cx, cy, cz), E.hex, R);
  let age = 0, acc = 0;
  addFx(dt => {
    age += dt; acc += dt;
    if (zone.owner !== myOwner() && Math.hypot(mage.root.position.x - cx, mage.root.position.z - cz) <= R) G.blindT = Math.max(G.blindT, 1);
    while (acc >= .1) {
      acc -= .1;
      for (let i = 0; i < (IS_TOUCH ? 2 : 4); i++) {
        const a = rnd(0, 6.283), r = Math.sqrt(rnd(0, 1)) * R, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, y = surfaceY(x, z, cy + 1) + rnd(.3, 1.6);
        smoke.emit(x, y, z, rnd(-.3, .3), rnd(0, .4), rnd(-.3, .3), rnd(1.2, 2), rnd(1.2, 2.2), [.3, .25, .36], [.12, .1, .16], .45, 2, 0, 1.5);
      }
    }
    if (age >= T) {
      removeSlowZone(zone); const i = SMOKES.indexOf(zone); if (i >= 0) SMOKES.splice(i, 1);
      disposeObj(disc);
      for (let k = 0; k < 10; k++) smoke.emit(cx + rnd(-R, R) * .6, surfaceY(cx, cz, cy + 1) + 1, cz + rnd(-R, R) * .6, rnd(-1, 1), rnd(.3, 1), rnd(-1, 1), rnd(.8, 1.4), rnd(1.4, 2.2), [.3, .25, .36], [.12, .1, .16], .4, 2, 0, 1.2);
      return false;
    }
    return true;
  });
}

/* ---------- 割喉(B-3) ---------- */
// 連擊點消耗在 release 時執行(exFn):消耗全部點數,回傳點數放入 P.ex(遠端由事件帶入)
function eviscerateEx() { const n = Math.floor(G.cr); spendEnergy(n); return n; }
// 集氣 0.5 s:前方(與 powerSlash 相同的前方圓心)P.r 內最近的一個標靶。傷害 (20 + 18 × 點數) × dmgK;
// 背後 ×1.3、目標 HP ≤ 30% ×1.3(合計上限 ×1.5);潛行 / 自己的煙中 ×1.3;影舞翻滾後 0.8 s 內 ×1.2;暗影步背後旗標也算背後。
// 命中:中毒 ⌈點數/2⌉ 層 3 s + 沉默 0.3 × 點數 s
function castEviscerate(P, orb) {
  const E = casterAura(P), cfg = CFG.skills.eviscerate, n = P.ex | 0, p = casterPos(P);
  if (orb) dissolveOrb(orb, E);
  const cx = p.x + Math.sin(P.dir) * cfg.range, cz = p.z + Math.cos(P.dir) * cfg.range, cy = surfaceY(cx, cz, p.y + 2);
  arcSlash(new V3(cx, cy, cz), P.r, P.dir, E.hex, .2);
  let best = null, bd = P.r + .4;
  for (const d of DUMMIES) { if (d.dead) continue; const dd = Math.hypot(d.x - cx, d.z - cz); if (dd < bd && Math.abs(d.y - cy) < 2) { bd = dd; best = d; } }
  if (!best || meleeBlocked(p, best)) return;   // 前方單體被牆 / 岩 / 樹幹 / 高台擋住:不命中
  const sb = !P.net && G.shadowT > 0, dance = !P.net && G.danceT > 0;
  const behind = behindOf(best, p) || sb, low = best.hp <= .3 * best.max;
  let mult = Math.min((behind ? 1.3 : 1) * (low ? 1.3 : 1), 1.5);
  if (G.stealth || inOwnSmoke()) mult *= 1.3;
  if (dance) mult *= 1.2;
  if (!P.net) { if (sb) G.shadowT = 0; if (dance) G.danceT = 0; }
  best.hit((20 + 18 * n) * P.dmgK * mult, best.x - p.x, best.z - p.z, 0, null);
  if (n > 0) { best.poison(3, Math.ceil(n / 2)); best.silence(.3 * n); }
  hitFx(new V3(best.x, best.y + 1, best.z), 8 + 2 * n);
}

/* ---------- 影分身(第 4 格絕技,瞬發,C 型) ---------- */
const DECOY_RUN = 8, DECOY_T = 2.5, DECOY_POOL = {};   // 分身沿朝向跑 8 m / 2.5 s;每座位池化 1 個 Mage 模型
function decoyModel(key) {
  if (!DECOY_POOL[key]) {
    const m = new Mage(scene), C = CLASSES.assassin;
    m.setClassLook('assassin'); m.setWeapon(C.weapons[0], true); m.setRobeColor(C.robe); m.setElementColor(C.aura.hex); m.setOpacity(.5);
    m.root.visible = false; DECOY_POOL[key] = m;
  }
  return DECOY_POOL[key];
}
// 原地留下分身沿朝向跑 8 m 後化煙消失(純視覺,不判定命中);本體進入影遁 2 s(只本機):同潛行外觀、移速 ×1.3,結束不虛弱,出招即解除
function castDecoy(P, orb) {
  const E = casterAura(P), p = casterPos(P), dx = Math.sin(P.dir), dz = Math.cos(P.dir);
  if (orb) dissolveOrb(orb, E);
  const m = decoyModel(P.net ? 's' + P.net : 'me'), sx = p.x, sz = p.z, y0 = p.y;
  m.yaw = P.dir; m.root.visible = true;
  burstRing(new V3(sx, y0 + 1, sz), E.hex, 1.4);
  for (let i = 0; i < 12; i++) smoke.emit(sx + rnd(-.3, .3), y0 + .2, sz + rnd(-.3, .3), rnd(-1, 1), rnd(.2, 1), rnd(-1, 1), rnd(.6, 1), rnd(.6, 1.1), [.3, .25, .36], [.12, .1, .16], .5, 2, 0, 1.5);
  let t = 0;
  addFx(dt => {
    t += dt;
    const s = DECOY_RUN * Math.min(1, t / DECOY_T), x = sx + dx * s, z = sz + dz * s, y = surfaceY(x, z, y0 + 2);
    m.root.position.set(x, y, z);
    m.update(dt, { move: 1, cast: 0, kick: 0, charge: 0, t: G.time, hover: 0, roll: 0, rollPhi: 0, flip: 0, sit: 0, down: 0 });
    smoke.emit(x + rnd(-.2, .2), y + .3, z + rnd(-.2, .2), rnd(-.3, .3), rnd(0, .3), rnd(-.3, .3), .5, rnd(.4, .7), [.3, .25, .36], [.12, .1, .16], .4, 1.5, 0, .8);
    if (t >= DECOY_T) {
      m.root.visible = false;
      for (let i = 0; i < 14; i++) smoke.emit(x + rnd(-.5, .5), y + 1, z + rnd(-.5, .5), rnd(-1, 1), rnd(.5, 1.5), rnd(-1, 1), rnd(.8, 1.2), rnd(.8, 1.4), [.3, .25, .36], [.12, .1, .16], .5, 2, 0, 1.2);
      return false;
    }
    return true;
  });
  if (!P.net && !G.stealth) { G.stealth = { dur: 2, left: 2, x: sx, z: sz, shadow: true }; burstRing(new V3(sx, y0 + 1, sz), E.hex, 1.2); }
}
