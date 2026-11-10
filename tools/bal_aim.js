/* 瞄準誤差 + 命中矩陣 + 近戰 PvP 校準(獨立腳本,正式頁面不載入)。
   用法(需先載入 tools/bal_test.js 的 BAL 與其 setup 所需全域):
     (0,eval)(await (await fetch('tools/bal_test.js')).text());
     (0,eval)(await (await fetch('tools/bal_aim.js')).text()); AIM.setup();
     AIM.matrix(AIM.combos(), [4,8,12,16,20], ['static','strafe','pred'], 20)
   原理:與 bal_test.js 相同,用遊戲真實 release() 與 frame() 手動推進(關閉 rAF、不渲染),命中以 Dummy.prototype.hit 記錄。
   新增:
     · 瞄準誤差:每發 release 前把瞄準點加上高斯誤差 N(0, σ²),σ = 0.25 + 0.02 × 距離(m),x / z 各一份。
     · 預判:pred 模式把瞄準點提前到「目標以目前橫走速度走 T 秒後」的位置,T = 距離 / 彈速(投射 / 線型),
       天降 / 落地型用固定落地時間 fall(假設值,見 AIM.combos 註解)。
     · 控制效果:每發窗口內對標靶取 stunT / rootT / paraT / silT / blindT / frzT 的最大值(秒),加總為 ctl。
   傷害單位 = 稻草人收到的原始傷害(raw);PvP 傷害 = raw × NET_RULES.dmgK(0.4)。
   亂數用固定種子(AIM.seed),同種子可重現。 */
(function () {
  'use strict';
  if (typeof BAL === 'undefined') throw new Error('先載入 tools/bal_test.js');
  const AIM = {};
  const DT = 1 / 60;
  const ACAP = { on: false, d: null, hits: [] };
  const CC_KEYS = ['stunT', 'rootT', 'paraT', 'silT', 'blindT', 'frzT'];
  const MODE = {
    static: { lat: false, lead: false, err: true },
    strafe: { lat: true, lead: false, err: true },
    pred: { lat: true, lead: true, err: true },
    static0: { lat: false, lead: false, err: false }   // 校對用:無誤差的靜止(應接近 100%)
  };
  let NOW = 3e6, RS = 20261110;

  // 攔截稻草人受擊(包在既有 hit 之外,不改遊戲邏輯)
  if (!Dummy.prototype._aimWrapped) {
    const prev = Dummy.prototype.hit;
    Dummy.prototype.hit = function (dmg, dx, dz, burn, el, src) {
      if (ACAP.on && ACAP.d === this && src !== 'dot' && !this.dead) ACAP.hits.push({ raw: dmg });
      return prev.call(this, dmg, dx, dz, burn, el, src);
    };
    Dummy.prototype._aimWrapped = true;
  }

  function rnd01() {
    RS = RS + 0x6D2B79F5 | 0; let t = Math.imul(RS ^ RS >>> 15, 1 | RS);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  function gauss() { let u = 0; while (u === 0) u = rnd01(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd01()); }

  AIM.seed = s => { RS = s | 0; };

  // 推進 n 格:lat 為橫走狀態(5 m/s、±3 m 來回);ctl 記錄窗口內控制狀態的最大值
  function frames(n, d, lat, ctl) {
    for (let i = 0; i < n; i++) {
      if (d && lat) {
        lat.off += lat.dir * 5 * DT; if (Math.abs(lat.off) >= 3) { lat.dir = -lat.dir; lat.off = Math.sign(lat.off) * 3; }
        d.home.x = lat.off;
      }
      NOW += DT * 1000; frame(NOW);
      if (ctl && d) for (const k of CC_KEYS) { const v = d[k] || 0; if (v > ctl.max) ctl.max = v; }
    }
  }
  function toReady() { let n = 0; while (G.state !== 'ready' && n < 900) { frames(1); n++; } return n; }

  function setCls(c) {
    if (G.cls !== c.cls) setClass(c.cls);
    if (c.cls === 'mage') G.el = c.el;
  }

  // 單發:c = 招式描述(AIM.combos 產生),dist = 標靶距離(m),mode = MODE 鍵,o = 選項
  // o.keep:不重置玩家位置與稻草人血量(連續施放用);o.yaw:稻草人朝向(0 = 背對攻擊者、PI = 面對);
  // o.cr:連擊點;o.hp:血量比例;o.noErr:強制無誤差
  // 每發前清殘留(測試用,不影響遊戲邏輯本身):FX 佇列(牆 / 光柱 / 投射物)、減速區、暫時平台、召喚物、
  // 玩家的位移 / 狀態、稻草人的燃燒與狀態。否則前一發的火牆會在下一發的窗口內持續傷害標靶。
  AIM.flush = function () {
    FX.length = 0;
    SLOW_ZONES.splice(0);
    for (let i = PLATFORMS.length - 1; i >= 0; i--) if (PLATFORMS[i].tmp) removePlatform(PLATFORMS[i]);
    clearSummons();
    G.dash = null; G.spin = null; G.roll = null; G.stealth = null; G.stun = 0; G.rootT = 0; G.paraT = 0; G.silT = 0;
    G.weak = 0; G.shadowT = 0; G.danceT = 0; G.slowT = 0; G.slowPct = 0; G.litT = 0; G.down = 0; G.cd = {};
    for (const d of DUMMIES) { d.burn = 0; d.burnT = 0; d.clearStatus(); }
    // 場景子物件:只保留 setup 當下的數量,之後測試新增的特效網格全部移除(否則每發都讓 frame 變慢)
    if (AIM.base != null) { for (let i = scene.children.length - 1; i >= AIM.base; i--) scene.remove(scene.children[i]); }
    if (typeof rings !== 'undefined') rings.length = 0;
    if (typeof DMGS !== 'undefined') DMGS.length = 0;
  };

  AIM.shot = function (c, dist, mode, o) {
    o = o || {}; const M = MODE[mode] || mode;
    toReady(); setCls(c);
    if (!o.keep) AIM.flush();
    G.stance = c.stance || 0; G.stanceCd = 0; G.stanceBoostT = 0;
    const d = DUMMIES[0];
    if (!o.keep) { mage.root.position.set(0, terrainH(0, 0), 0); G.wallOff = 0; G.vy = 0; G.ground = true; G.groundY = terrainH(0, 0); G.coyote = 0; G.airJumps = 1; G.airRolls = 1; }
    d.clearStatus(); d.dead = false; d.g.visible = true; d.g.scale.setScalar(1); d.popping = false; d.downK = 0; d.downT = 0;
    d.home.x = 0; d.home.z = dist; d.yaw = o.yaw == null ? Math.PI : o.yaw;
    if (!o.keep) d.hp = d.max;
    if (o.hp != null) d.hp = d.max * o.hp;
    if (o.cr != null) G.cr = o.cr;
    const lat = M.lat ? { off: 0, dir: rnd01() < .5 ? -1 : 1 } : null;
    const T = 0.14 + ((c.kind === 'bolt' || c.kind === 'line') ? dist / (c.v || 36) : (c.fall || 0));   // 0.14 s = 出手延遲(castT ≥ 0.14 才發射)
    let ax = 0, az = dist;
    if (M.lead && lat) ax += lat.dir * 5 * T;
    if (M.err && !o.noErr) { const s = 0.25 + 0.02 * dist; ax += gauss() * s; az += gauss() * s; }
    G.target = new V3(ax, terrainH(ax, az), az);
    G.skill = c.slot; G.lastSkill = c.slot; G.charge = 1; G.chargeT = 0; G.queued = false;
    const chg = chargeTimeEff();
    ACAP.on = true; ACAP.d = d; ACAP.hits = [];
    const ctl = { max: 0 };
    release();
    const total = Math.round((c.win || 1.5) * 60); let cyc = null;
    for (let k = 0; k < total; k++) { frames(1, d, lat, ctl); if (cyc == null && G.state === 'ready') cyc = +(k / 60).toFixed(2); }
    ACAP.on = false;
    const raw = ACAP.hits.reduce((a, h) => a + h.raw, 0);
    return { hit: ACAP.hits.length ? 1 : 0, n: ACAP.hits.length, raw: raw, ctl: +ctl.max.toFixed(2), cyc: cyc, chg: +chg.toFixed(2) };
  };

  // 一格:n 發;回傳命中率、命中時每發 PvP、期望 PvP(= 命中率 × 命中 PvP)、平均控制秒數、循環 / 充能秒數
  AIM.cell = function (c, dist, mode, n, o) {
    let hit = 0, rawSum = 0, ctlSum = 0, cycSum = 0, cycN = 0, chg = 0;
    for (let i = 0; i < n; i++) {
      const r = AIM.shot(c, dist, mode, o);
      if (r.hit) { hit++; rawSum += r.raw; }
      ctlSum += r.ctl; if (r.cyc != null) { cycSum += r.cyc; cycN++; } chg = r.chg;
    }
    const hr = hit / n, pvpHit = hit ? rawSum / hit * NET_RULES.dmgK : 0;
    return { name: c.name, dist: dist, mode: mode, n: n, hitRate: +hr.toFixed(2), pvpHit: +pvpHit.toFixed(1),
      pvpExp: +(hr * pvpHit).toFixed(1), ctl: +(ctlSum / n).toFixed(2), cyc: cycN ? +(cycSum / cycN).toFixed(2) : null, chg: chg };
  };

  // 矩陣:combos × dists × modes,每格 n 發。回傳列陣列並存 AIM.last
  AIM.matrix = function (combos, dists, modes, n) {
    const rows = [];
    for (const c of combos) for (const m of modes) for (const dd of dists) rows.push(AIM.cell(c, dd, m, n));
    AIM.last = rows; return rows;
  };

  // 招式清單(與 classes.js 的快捷列格位對應:stance = 架勢、slot = 快捷列格 0~2)
  // kind:bolt 投射 / line 線型 / wall 牆 / sky 天降 / self 自身 / melee 近戰 / circle 落點圓
  // v:投射速度(m/s, q = 1);fall:天降 / 落點招的假設落地時間(s);win:每發量測窗口(s)
  // 法師元素 SPELLS[el] 的 aim 為 line 者 slot2 視為線型,其餘視為天降(火系 slot2 = 隕石)
  AIM.combos = function (opt) {
    opt = opt || {};
    const out = [];
    const ELS = ['fire', 'water', 'earth', 'wind', 'light', 'dark'];
    if (!opt.skipMage) for (const el of ELS) {
      const sp = SPELLS[el];
      out.push({ name: 'mage.' + el + '.s0(投射)', cls: 'mage', el, stance: 0, slot: 0, kind: 'bolt', v: 32 * ELMOD[el].speedMul, win: 1.0 });
      out.push({ name: 'mage.' + el + '.s1(牆)', cls: 'mage', el, stance: 0, slot: 1, kind: 'wall', fall: 0.5, win: 1.6 });
      const l2 = sp && sp[2] && sp[2].aim === 'line';
      out.push({ name: 'mage.' + el + '.s2(' + (l2 ? '線' : '天降') + ')', cls: 'mage', el, stance: 0, slot: 2, kind: l2 ? 'line' : 'sky', v: 32 * ELMOD[el].speedMul, fall: 1.0, win: 3.2 });
    }
    if (!opt.skipArcher) {
      out.push({ name: 'archer.瞄準射擊', cls: 'archer', stance: 0, slot: 0, kind: 'bolt', v: 70, win: 1.0 });
      out.push({ name: 'archer.衝擊巨箭', cls: 'archer', stance: 0, slot: 1, kind: 'line', v: 40, win: 1.2 });
      out.push({ name: 'archer.箭雨', cls: 'archer', stance: 0, slot: 2, kind: 'sky', fall: 1.0, win: 3.0 });
      out.push({ name: 'archer.散射', cls: 'archer', stance: 1, slot: 0, kind: 'line', v: 40, win: 1.2 });
    }
    if (!opt.skipSword) {
      out.push({ name: 'sword.蓄力斬', cls: 'swordsman', stance: 0, slot: 0, kind: 'melee', win: 0.8 });
      out.push({ name: 'sword.旋風斬', cls: 'swordsman', stance: 0, slot: 1, kind: 'self', win: 1.6 });
      out.push({ name: 'sword.衝鋒盾', cls: 'swordsman', stance: 0, slot: 2, kind: 'line', v: 18, win: 1.2 });
      out.push({ name: 'sword.震地', cls: 'swordsman', stance: 1, slot: 1, kind: 'self', win: 1.2 });
      out.push({ name: 'sword.躍擊', cls: 'swordsman', stance: 1, slot: 2, kind: 'circle', fall: 0.5, win: 1.2 });
    }
    if (!opt.skipAssassin) {
      out.push({ name: 'assassin.背刺', cls: 'assassin', stance: 0, slot: 0, kind: 'melee', win: 0.8 });
      out.push({ name: 'assassin.飛刀', cls: 'assassin', stance: 0, slot: 1, kind: 'line', v: 40, win: 1.2 });
      out.push({ name: 'assassin.割喉', cls: 'assassin', stance: 1, slot: 2, kind: 'melee', win: 0.8 });
    }
    return out;
  };

  // 近戰 PvP 校準(無誤差、單發或連續):回傳各情境的 raw 與 PvP(= raw × 0.4)
  AIM.pvp = function () {
    const R = [];
    const run = (label, fn) => { const r = fn(); R.push({ label, hit: r.hit, n: r.n, raw: +r.raw.toFixed(1), pvp: +(r.raw * NET_RULES.dmgK).toFixed(1) }); };
    const BS = { cls: 'assassin', stance: 0, slot: 0, kind: 'melee', win: 0.8 };
    const EV = { cls: 'assassin', stance: 1, slot: 2, kind: 'melee', win: 0.8 };
    const SS = { cls: 'assassin', stance: 1, slot: 0, kind: 'self', win: 0.8 };
    const one = (c, dist, yaw, o) => { const r = AIM.shot(c, dist, 'static0', Object.assign({ yaw, noErr: true }, o || {})); return { hit: r.hit, n: r.n, raw: r.raw }; };
    run('背刺 正面(yaw=PI) 距1.5m', () => one(BS, 1.5, Math.PI));
    run('背刺 背後(yaw=0) 距1.5m', () => one(BS, 1.5, 0));
    run('背刺 背後(yaw=0) 距3.5m', () => one(BS, 3.5, 0));
    run('背刺 背後(yaw=0) 距4.5m', () => one(BS, 4.5, 0));
    run('背刺 背後(yaw=0) 距5.5m', () => one(BS, 5.5, 0));
    run('割喉 正面 距1.2m 連擊點0', () => one(EV, 1.2, Math.PI, { cr: 0 }));
    run('割喉 背後 距1.2m 連擊點0', () => one(EV, 1.2, 0, { cr: 0 }));
    run('割喉 背後 距1.2m 連擊點5', () => one(EV, 1.2, 0, { cr: 5 }));
    run('割喉 背後 距1.2m 連擊點5 目標血30%', () => one(EV, 1.2, 0, { cr: 5, hp: .3 }));
    run('割喉 正面 距1.2m 連擊點5 目標血30%', () => one(EV, 1.2, Math.PI, { cr: 5, hp: .3 }));
    // 暗影步後接背刺(同一稻草人,玩家不重置):先暗影步再背刺
    {
      const d = DUMMIES[0];
      const r1 = AIM.shot(SS, 4, 'static0', { yaw: Math.PI, noErr: true });
      const r2 = AIM.shot(BS, 4, 'static0', { yaw: Math.PI, noErr: true, keep: true });
      R.push({ label: '暗影步 → 背刺(下一刀視為背後)', hit: r2.hit, n: r2.n, raw: +r2.raw.toFixed(1), pvp: +(r2.raw * NET_RULES.dmgK).toFixed(1), stepHit: r1.hit });
    }
    return R;
  };

  // 控制效果(CC)估算:對 HP100 標靶(raw 250)以指定連段循環出招,直到死亡;
  // 回傳總時間、控制秒數(各發窗口最大值加總)、佔比。seq = [{c, dist, mode}] 依序循環
  AIM.ttk = function (seq, mode, cap) {
    const d = DUMMIES[0]; let raw = 0, tot = 0, ctl = 0, shots = 0; const lim = cap || 40;
    while (raw < d.max && shots < lim) {
      const s = seq[shots % seq.length];
      const r = AIM.shot(s.c, s.dist, mode || 'pred', { keep: false });
      raw += r.raw; ctl += r.ctl; tot += (r.cyc != null ? r.cyc : 0.5) + (r.chg || 0); shots++;
    }
    return { shots: shots, raw: +raw.toFixed(1), totalS: +tot.toFixed(2), ctlS: +ctl.toFixed(2), ctlRatio: +(ctl / tot).toFixed(2) };
  };

  AIM.setup = function () {
    BAL.setup();
    AIM.seed(20261110);
    AIM.base = scene.children.length;   // 場景基準子物件數(之後測試新增的物件會在 flush 時移除)
    return { ok: true, dummyMax: DUMMIES[0].max, dmgK: NET_RULES.dmgK, modes: Object.keys(MODE) };
  };

  window.AIM = AIM;
  return AIM;
})();
