/* 傷害平衡量測(獨立腳本,正式頁面不載入)。
   用法:頁面載入後於 console / javascript_exec 執行
     (0,eval)(await (await fetch('tools/bal_test.js')).text()); BAL.setup();
   之後 BAL.cell(...) / BAL.shotsDmg(...)。
   原理:用遊戲真實的 release() 與 frame() 手動推進(關閉 rAF、不渲染),命中以 Dummy.prototype.hit 記錄。
   傷害單位 = 稻草人收到的原始傷害(raw);PvP 傷害 = raw × NET_RULES.dmgK(0.4)。 */
(function () {
  'use strict';
  const BAL = {};
  const CAP = { on: false, d: null, hits: [], t: 0 };
  const DT = 1 / 60;
  let NOW = 1e6, origRaf = null;

  // 攔截稻草人受擊(包在既有 hit 之外,不改遊戲邏輯)
  if (!Dummy.prototype._balWrapped) {
    const prev = Dummy.prototype.hit;
    Dummy.prototype.hit = function (dmg, dx, dz, burn, el, src) {
      if (CAP.on && CAP.d === this && src !== 'dot' && !this.dead) CAP.hits.push({ t: CAP.t, raw: dmg, lit: this.litT > 0 });
      return prev.call(this, dmg, dx, dz, burn, el, src);
    };
    Dummy.prototype._balWrapped = true;
  }

  // 只初始化一次:停掉 rAF、關渲染、關封面、稻草人 HP 改 250 raw(= PvP 100 ÷ 0.4)、移走其他稻草人
  BAL.setup = function () {
    if (!origRaf) origRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0;
    window.COVER_ON = false;
    if (typeof renderer !== 'undefined' && renderer) renderer.render = () => { };
    if (typeof composer !== 'undefined' && composer) composer.render = () => { };
    CFG.res.infinite = true; CFG.dummyMove = false;
    G.cls = 'mage'; G.weapon = 'staff'; G.chgMode = G.chgMode || 'A';
    DUMMIES.forEach((d, i) => { if (i) { d.home.x = 400 + i * 3; d.home.z = 400; d.clearStatus(); } });
    const d = DUMMIES[0]; d.max = 250; d.hp = 250;
    return { cls: G.cls, weapon: G.weapon, mode: G.chgMode, el: G.el, dmgK: NET_RULES.dmgK };
  };

  function step(n, d, lat) {
    for (let i = 0; i < n; i++) {
      if (d && lat) {   // 5 m/s 橫走,左右各 3 m 來回
        lat.off += lat.dir * 5 * DT; if (Math.abs(lat.off) >= 3) { lat.dir = -lat.dir; lat.off = Math.sign(lat.off) * 3; }
        d.home.x = lat.cx + lat.off;
      }
      NOW += DT * 1000; CAP.t += DT; frame(NOW);
    }
  }
  function toReady() { let n = 0; while (G.state !== 'ready' && n < 600) { step(1, null, null); n++; } }

  // 單次施放(真實 release 路徑):回傳命中列表
  function shotOnce(o) {
    toReady();
    const d = DUMMIES[0];
    mage.root.position.set(0, terrainH(0, 0), 0);
    d.clearStatus(); d.dead = false; d.g.visible = true; d.g.scale.setScalar(1); d.popping = false; d.downK = 0; d.downT = 0;
    d.home.x = o.cx || 0; d.home.z = o.dist; d.hp = d.max;
    G.el = o.el; G.skill = o.slot; G.lastSkill = o.slot; G.wallOff = 0;
    G.target = new V3(d.home.x, terrainH(d.home.x, o.dist), o.dist);
    G.charge = o.q; G.chargeT = 0; G.queued = false;
    CAP.on = true; CAP.d = d; CAP.hits = [];
    const lat = o.lat ? { cx: o.cx || 0, off: 0, dir: 1 } : null;
    release();
    const t0 = CAP.t; step(Math.round(o.win * 60), d, lat);
    CAP.on = false;
    const hits = CAP.hits.map(h => ({ dt: +(h.t - t0).toFixed(2), raw: +h.raw.toFixed(2), lit: h.lit }));
    return hits;
  }

  // 一格:n 發,回傳命中率、每發 PvP 傷害均值(命中才計)
  BAL.cell = function (o) {
    const r = { el: o.el, slot: o.slot, dist: o.dist, q: o.q, lat: !!o.lat, n: o.n || 12, hit: 0, rawSum: 0, raws: [] };
    for (let i = 0; i < r.n; i++) {
      const hs = shotOnce({ el: o.el, slot: o.slot, q: o.q, dist: o.dist, lat: o.lat, cx: 0, win: o.win || 3 });
      if (hs.length) { r.hit++; const s = hs.reduce((a, h) => a + h.raw, 0); r.rawSum += s; r.raws.push(+s.toFixed(1)); }
    }
    r.hitRate = +(r.hit / r.n).toFixed(2);
    r.pvpPerHit = r.hit ? +(r.rawSum / r.hit * NET_RULES.dmgK).toFixed(2) : 0;
    r.pvpRaws = r.raws.map(x => +(x * NET_RULES.dmgK).toFixed(1));
    return r;
  };

  // 單發原始傷害(定點、不橫走),用於單發數值表
  BAL.single = function (o) {
    const hs = shotOnce({ el: o.el, slot: o.slot, q: o.q, dist: o.dist || 2, lat: false, win: o.win || 3 });
    const raw = hs.reduce((a, h) => a + h.raw, 0);
    return { el: o.el, slot: o.slot, q: o.q, hits: hs.length, rawSum: +raw.toFixed(2), pvp: +(raw * NET_RULES.dmgK).toFixed(2), detail: hs };
  };

  // 循環時間估算(用遊戲真實函式):集氣到 q 所需 + 出手 0.14 s + 僵直;快放 q 最短 minHold
  BAL.cycle = function (slot, q) {
    const sk = sc(slot), wm = W(), em = elm();
    const full = sk.chargeTime * wm.chargeMul * em.chargeMul;
    const charge = Math.max(CFG.minHold, q * full);
    return { charge: +charge.toFixed(2), cycle: +(charge + 0.14 + sk.recover * wm.recoverMul).toFixed(2) };
  };

  // TTK:稻草人 raw 250(= PvP 100)。以連續施放的單發命中序列計時
  BAL.ttk = function (o) {
    const sum = [];
    let rawTotal = 0, t = 0, shots = 0;
    while (rawTotal < 250 && shots < 40) {
      const hs = shotOnce({ el: o.el, slot: o.slot, q: o.q, dist: o.dist, lat: false, win: o.win || 2.5 });
      shots++;
      rawTotal += hs.reduce((a, h) => a + h.raw, 0);
      sum.push(+rawTotal.toFixed(1));
    }
    return { el: o.el, slot: o.slot, q: o.q, shots, raw: sum };
  };

  BAL.cover = function () { return { G_time: +G.time.toFixed(2), state: G.state, skill: G.skill, el: G.el }; };
  window.BAL = BAL;
  return BAL;
})();
