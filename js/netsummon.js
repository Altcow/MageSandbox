'use strict';
// 多人對戰:召喚物同步(設計 §3-2 傀儡、§4-2 sm/<座位>,N7)。
// 擁有者端(NETON 時):每 200 ms 把自己的召喚物寫成 sm/<座位> = "seq;el;x;y;z;yaw;hp%;st;scale|…"(最多 2 隻,≤ 600 字);
//   回合不在進行中或沒有召喚物時刪除該節點。st:0 出場 / 1 移動 / 2 攻擊。
// 其他端:依各座位的 sm 節點建立 / 更新 / 移除傀儡(PUPPETS),外觀用 SUMMON_KINDS[el].build,不跑 AI、不攻擊、不投影;
//   位置與朝向每幀平滑趨近快照;消失時播放 onDeath 與煙霧 / 光環特效後淡出。
//   傀儡不在 DUMMIES 內、不呼叫 hit;傷害只由擁有者端判定,經 hit 事件(netcombat.js)送到受害者端套用一次。
//   傀儡的 animate / onDeath 在 NET_CTX = 座位 下執行,RemotePlayer._pend 會忽略其中的 hit / 位移記錄(例如暗影長矛),避免重複傷害。
// 依賴(全域):summons_core.js(SUMMONS、SUMMON_DEF、SUMMON_KINDS、clearSummons)、remote.js(REMOTES、NETON)、net.js(Net.setSm / smOf / metaState / now)、
//   game.js(NET_CTX、burstRing、COLLIDERS)、world.js(scene、surfaceY、ARENA_R、fire、smoke)、fx.js(V3、EL、rnd、clamp、angDiff、easeOut)、spells.js(fq)。
// 載入順序:netcombat.js 之後(index.html)。單人模式 netSmTick 在 NETON 為 false 時直接 return,行為不變。

const SMN_SEND_DT = .2;     // 送出間隔(s),5 Hz
const SMN_SPAWN_T = .6;     // 傀儡出場時間(與 summons_core.js 的 SM_SPAWN_T 相同)
const SMN_FADE_T = .8;      // 消散時間(與 SM_FADE_T 相同)
const SMN_LERP = 12;        // 位置 / 朝向平滑速率(1/s)
const SMN_SNAP = 8;         // 與快照相差超過這麼多公尺就直接跳過去(瞬移 / 重生)
const SMN_MAX = 2;          // 每座位最多 2 隻
const SMN_STALE = 3000;     // 該座位的角色超過這麼久(ms)沒有新快照 → 傀儡暫時隱藏

let smnAcc = 0, smnWrote = false;
const PUPPETS = {};         // 座位(字串)→ Map(seq → 傀儡)
const PUP_STR = {};         // 座位 → 上次套用的 sm 字串(相同就不重新解析)
const PUP_FADING = [];      // 消散中的傀儡

const smnNum = (v, d) => String(+v.toFixed(d));

/* ================= 擁有者端:編碼與送出 ================= */
function smnEncode() {
  const out = [];
  for (const u of SUMMONS) {
    if (u.dead || out.length >= SMN_MAX) continue;
    const st = u.spawnT > 0 ? 0 : (u.state === 'attack' ? 2 : 1);
    const yaw = Math.atan2(Math.sin(u.yaw), Math.cos(u.yaw));
    out.push([u.seq, u.el, smnNum(u.x, 1), smnNum(u.y, 1), smnNum(u.z, 1), smnNum(yaw, 2),
      Math.round(clamp(u.hp / u.hpMax, 0, 1) * 100), st, smnNum(u.scale, 2)].join(';'));
  }
  return out.join('|');
}
// 刪除自己的 sm 節點(只在曾經寫過時才送出)
function smnDrop() {
  if (smnWrote) { smnWrote = false; Net.setSm(null); }
}
function smnSendTick(dt) {
  // 回合不在進行中(結算、離開):自己的召喚物清掉,節點刪除
  if (Net.metaState() !== 'match') {
    if (SUMMONS.length) clearSummons();
    smnDrop();
    return;
  }
  smnAcc += dt;
  if (smnAcc < SMN_SEND_DT) return;
  smnAcc = 0;
  const s = smnEncode();
  if (s) { Net.setSm(s); smnWrote = true; }
  else smnDrop();
}

/* ================= 其他端:快照解析 ================= */
function smnParse(str) {
  const out = [];
  if (typeof str !== 'string' || !str.length || str.length > 600) return out;
  for (const part of str.split('|')) {
    const f = part.split(';');
    if (f.length !== 9 || !Object.prototype.hasOwnProperty.call(SUMMON_DEF, f[1])) continue;
    const seq = +f[0], x = +f[2], y = +f[3], z = +f[4], yaw = +f[5], hp = +f[6], st = +f[7], sc = +f[8];
    if (!(seq >= 0) || [x, y, z, yaw, hp, st, sc].some(v => !isFinite(v))) continue;
    out.push({ seq: seq, el: f[1], x: clamp(x, -ARENA_R, ARENA_R), y: clamp(y, -10, 40), z: clamp(z, -ARENA_R, ARENA_R),
      yaw: yaw, hp: clamp(hp, 0, 100), st: st, sc: clamp(sc, .3, 3) });
    if (out.length >= SMN_MAX) break;
  }
  return out;
}
// 建立傀儡:外觀用既有 build;出場時播放與本機相同的光環與粒子
function smnSpawn(seat, d) {
  const def = SUMMON_DEF[d.el], E = EL[d.el], kind = SUMMON_KINDS[d.el];
  if (!kind || typeof kind.build !== 'function') return null;
  const body = kind.build({ el: d.el, net: +seat, dir: d.yaw, fxK: 1, dmgK: 1 }, d.sc);
  body.traverse(o => { if (o.isMesh) o.castShadow = false; });   // 傀儡不投影(效能)
  const root = new THREE.Group(); root.scale.setScalar(.05); root.add(body); scene.add(root);
  const u = {
    seat: +seat, seq: d.seq, el: d.el, def: def, E: E, scale: d.sc, body: body, root: root,
    x: d.x, y: d.y, z: d.z, yaw: d.yaw, tx: d.x, ty: d.y, tz: d.z, tyaw: d.yaw, st: d.st,
    state: 'spawn', spawnT: SMN_SPAWN_T, dead: false, fadeT: 0, age: 0,
    atkT: 0, skT: 0, slamT: 0, shT: 0, healT: 0, clT: 0, fxK: 1, dmgK: 1, atkBase: 0, col: null
  };
  if (d.el === 'earth') { u.col = { x: d.x, z: d.z, r: .7 * d.sc, ref: u }; COLLIDERS.push(u.col); }   // 石頭人保留碰撞圈
  const gy = surfaceY(d.x, d.z, d.y + 1);
  burstRing(new V3(d.x, gy + .05, d.z), E.hex, def.size * d.sc * 1.2);
  for (let j = 0; j < fq(16); j++) fire.emit(d.x + rnd(-.6, .6), gy + rnd(0, .3), d.z + rnd(-.6, .6), rnd(-.5, .5), rnd(1.5, 3), rnd(-.5, .5), .7, rnd(.2, .35), E.c0, E.c1, 1, .3, -.5, .6);
  return u;
}

/* ================= 傀儡每幀更新、消失、清除 ================= */
function smnUpdate(u, dt) {
  if (u.dead) return;
  u.age += dt;
  const k = 1 - Math.exp(-SMN_LERP * dt);
  if (Math.hypot(u.tx - u.x, u.tz - u.z) > SMN_SNAP) { u.x = u.tx; u.z = u.tz; }
  else { u.x += (u.tx - u.x) * k; u.z += (u.tz - u.z) * k; }
  u.y += (u.ty - u.y) * k;
  u.yaw += angDiff(u.yaw, u.tyaw) * k;
  if (u.col) { u.col.x = u.x; u.col.z = u.z; }
  u.root.rotation.y = u.yaw;
  if (u.spawnT > 0) {   // 出場 0.6 s:與 SmUnit 相同的縮放,不呼叫 animate
    u.spawnT = Math.max(0, u.spawnT - dt);
    const q = 1 - u.spawnT / SMN_SPAWN_T;
    u.root.scale.setScalar(Math.max(.05, easeOut(q)));
    u.root.position.set(u.x, u.y - (1 - q) * .5, u.z);
    return;
  }
  u.root.scale.setScalar(1);
  u.root.position.set(u.x, u.y, u.z);
  u.state = u.st === 2 ? 'attack' : 'seek';
  const kind = SUMMON_KINDS[u.el];
  if (kind && typeof kind.animate === 'function') {
    const prev = NET_CTX; NET_CTX = u.seat;   // 視覺動畫期間的 hit / 位移不記入待送命中(RemotePlayer._pend)
    try { kind.animate(u, dt); } finally { NET_CTX = prev; }
  }
}
function smnRemoveCollider(u) {
  if (!u.col) return;
  const i = COLLIDERS.indexOf(u.col); if (i >= 0) COLLIDERS.splice(i, 1);
  u.col = null;
}
// 消失(擁有者的召喚物死亡 / 過期 / 節點刪除):既有 onDeath 特效 + 煙霧光環,然後淡出
function smnDie(u) {
  if (u.dead) return;
  u.dead = true;
  smnRemoveCollider(u);
  const kind = SUMMON_KINDS[u.el];
  const prev = NET_CTX; NET_CTX = u.seat;
  try { if (kind && typeof kind.onDeath === 'function') kind.onDeath(u); } finally { NET_CTX = prev; }
  burstRing(new V3(u.x, u.y + .05, u.z), u.E.hex, 1.1);
  for (let i = 0; i < fq(8); i++) smoke.emit(u.x + rnd(-.4, .4), u.y + rnd(.1, .8), u.z + rnd(-.4, .4), rnd(-.6, .6), rnd(.4, 1), rnd(-.6, .6), rnd(.7, 1.1), rnd(.8, 1.3), [.6, .6, .6], [.3, .3, .3], .5, 2, -.2, .8);
  u.fadeT = SMN_FADE_T; PUP_FADING.push(u);
}
function smnDispose(u) {
  scene.remove(u.root);
  u.root.traverse(m => {
    if (m.geometry && !m.isSprite && !m.geometry.userData.shared) m.geometry.dispose();
    if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mt => { if (!mt.userData.shared) mt.dispose(); });
  });
}
function smnFading(dt) {
  for (let i = PUP_FADING.length - 1; i >= 0; i--) {
    const u = PUP_FADING[i];
    u.fadeT -= dt;
    const k = Math.max(0, u.fadeT / SMN_FADE_T);
    u.root.scale.setScalar(Math.max(.01, k));
    if (u.def.move === 'walk') u.root.position.y = u.y - (1 - k) * .6;
    if (u.fadeT <= 0) { smnDispose(u); PUP_FADING.splice(i, 1); }
  }
}
// 清除某座位的全部傀儡;instant = 立即釋放(離開對戰、角色離開),否則播放消失特效
function smnClearSeat(seat, instant) {
  const m = PUPPETS[seat];
  if (m) {
    m.forEach(u => {
      if (instant) { u.dead = true; smnRemoveCollider(u); smnDispose(u); }
      else smnDie(u);
    });
  }
  delete PUPPETS[seat]; delete PUP_STR[seat];
}

/* ================= 每幀入口(remote.js netTick 呼叫,只在 NETON) ================= */
function smnRecvTick(now) {
  for (const seat of Object.keys(PUPPETS)) if (!REMOTES[seat]) smnClearSeat(seat, true);   // 已離開的座位
  for (const seat of Object.keys(REMOTES)) {
    const rp = REMOTES[seat], str = Net.smOf(seat);
    if (str !== PUP_STR[seat]) {   // 快照變動(含節點被刪除 = undefined)
      PUP_STR[seat] = str;
      const list = smnParse(str);
      let m = PUPPETS[seat];
      if (!m && list.length) m = PUPPETS[seat] = new Map();
      if (m) {
        const keep = new Set();
        for (const d of list) {
          let u = m.get(d.seq);
          if (!u) { u = smnSpawn(seat, d); if (!u) continue; m.set(d.seq, u); }
          u.tx = d.x; u.ty = d.y; u.tz = d.z; u.tyaw = d.yaw; u.st = d.st;
          keep.add(d.seq);
        }
        Array.from(m.entries()).forEach(([seq, u]) => { if (!keep.has(seq)) { m.delete(seq); smnDie(u); } });
        if (!m.size) delete PUPPETS[seat];
      }
    }
    const cur = PUPPETS[seat];   // 角色長時間沒有新快照(斷線 / 暫離)時暫時隱藏傀儡
    if (cur) { const vis = now - rp.lastRecv <= SMN_STALE; cur.forEach(u => { u.root.visible = vis; }); }
  }
}

// 每幀(remote.js netTick,NETON 時):擁有者端送出召喚物快照;其他端套用與更新傀儡
function netSmTick(dt) {
  if (!window.NETON || !Net.me) return;
  smnSendTick(dt);
  smnRecvTick(Net.now());
  for (const seat in PUPPETS) PUPPETS[seat].forEach(u => smnUpdate(u, dt));
  smnFading(dt);
}

// 對戰結束 / 重來 / 離開(remote.js clearRemotes,只在離開對戰時):傀儡與自己的召喚物全部立即清除,sm 節點刪除
function netSmReset() {
  for (const seat of Object.keys(PUPPETS)) smnClearSeat(seat, true);
  PUP_FADING.splice(0).forEach(u => smnDispose(u));
  if (SUMMONS.length) clearSummons();
  smnDrop();
  smnAcc = 0;
}
