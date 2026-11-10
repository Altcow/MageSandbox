/* 1v1 職業對打模擬(獨立腳本,正式頁面不載入)。【估算工具】
   用法(頁面內,先跑完 tools/bal_aim.js 的 AIM.matrix,結果放在 rows):
     (0,eval)(await (await fetch('tools/duel_sim.js')).text());
     DUEL.run(rows, { games: 20, startDists: [6, 10, 14], pDodge: 0.3, behindRate: 0.5 })
   輸入 rows = AIM.matrix / AIM.cell 的結果列(欄位 name、dist、mode、hitRate、pvpHit、ctl、cyc、chg)。

   誠實標註:這不是逐幀跑兩個玩家的遊戲模擬(引擎只有單一玩家角色,無法直接讓兩個角色互打)。
   · 命中、每發 PvP 傷害、控制秒數、出招循環 / 充能時間:取自 AIM 在遊戲真實 release() / frame() 的量測(矩陣)。
   · 出招時機、移動、閃避、控制套用:用下面的簡單腳本 AI 與假設參數(見 DUEL.AI),是估算。
   · 近戰背刺 / 割喉的傷害用公式(與 skills.js、skills_assassin.js 相同係數),行為假設見 MELEE 註解。
   · 固定種子(DUEL.seed),同參數可重現。 */
(function () {
  'use strict';
  const DUEL = {};
  const DT = 0.05, HP = 100, MAXT = 60, SPEED = 5, CC_CAP = 1.5;   // HP = PvP 血量;CC_CAP = 單次控制上限(NET_RULES.ccCap)
  const DMGK = 0.4;                                                   // PvP 傷害倍率(NET_RULES.dmgK)
  let RS = 20261110;
  function rnd() { RS = RS + 0x6D2B79F5 | 0; let t = Math.imul(RS ^ RS >>> 15, 1 | RS); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  DUEL.seed = s => { RS = s | 0; };

  // 近戰固定數值(PvP,q = 1,來自 skills.js / skills_assassin.js 公式;AIM.pvp 校準過背刺 20.8 / 72.8、割喉 cr0 10.4 / 13.5)
  // 背刺:正面 40×1.3×0.4 = 20.8;背後 ×3.5 = 72.8。割喉:(20+18n)×1.3×0.4×背後?1.3:1,n = 3 連擊點(假設)
  // 蓄力斬:90×1.3×0.4 = 46.8(近身圓)。旋風斬:22×1.3×0.4 = 11.4/跳 × 6 跳(1.8 s 旋轉)
  const MELEE_NOTE = '背刺 / 割喉 / 蓄力斬 / 旋風斬為公式值(見上方註解),非遊戲逐幀量測';

  // 職業清單:attacks 為矩陣裡的招式名稱(精確比對 AIM.combos 的 name);melee 為近戰特殊表
  function entrants(rows) {
    const names = new Set(rows.map(r => r.name));
    const els = ['fire', 'water', 'earth', 'wind', 'light', 'dark'];
    const out = [];
    for (const el of els) {
      const s2 = [...names].find(n => n.indexOf('mage.' + el + '.s2') === 0);
      out.push({ id: 'mage.' + el, ranged: true, pref: 10, attacks: ['mage.' + el + '.s0(投射)', 'mage.' + el + '.s1(牆)', s2].filter(n => n && names.has(n)) });
    }
    out.push({ id: 'archer', ranged: true, pref: 10, attacks: ['archer.瞄準射擊', 'archer.衝擊巨箭', 'archer.箭雨', 'archer.散射'].filter(n => names.has(n)) });
    out.push({ id: 'swordsman', ranged: false, pref: 1.5, attacks: ['sword.蓄力斬', 'sword.旋風斬', 'sword.衝鋒盾'].filter(n => names.has(n)) });
    out.push({ id: 'assassin', ranged: false, pref: 1.2, attacks: ['assassin.背刺', 'assassin.飛刀', 'assassin.割喉'].filter(n => names.has(n)) });
    return out;
  }

  // 招式表:由矩陣列建立 idx[name][dist][mode] = row
  function index(rows) { const I = {}; for (const r of rows) { (I[r.name] = I[r.name] || {}); (I[r.name][r.dist] = I[r.name][r.dist] || {})[r.mode] = r; } return I; }

  // 近戰 / 特殊招的固定表(PvP、秒、有效距離上限)
  function meleeSpec(name, I, o) {
    const cyc = (I[name] && I[name][4] && I[name][4].static) ? I[name][4].static.cyc : 0.5;   // 循環取量測值
    const chg = (I[name] && I[name][4] && I[name][4].static) ? I[name][4].static.chg : 0.6;
    const BR = o.behindRate;
    const T = { 'assassin.背刺': { maxD: 4, dmg: 20.8 * (1 - BR) + 72.8 * BR, ctl: 0 },
                'assassin.割喉': { maxD: 1.5, dmg: (20 + 18 * 3) * 1.3 * (1 - BR + BR * 1.3) * DMGK, ctl: 0.9 },   // 割喉 n=3(假設):(20+18n)×dmgK 1.3×背後 1.3 混合×0.4;沉默 0.3×n = 0.9 s
                'sword.蓄力斬': { maxD: 2.5, dmg: 46.8, ctl: 0.45 },   // 擊退 1.5 m 不計控制;蓄力斬只計擊退,ctl 取 0.45 s 表示硬直(假設)
                'sword.旋風斬': { maxD: 3, dmg: 68.6, ctl: 0 } };
    const s = T[name]; if (!s) return null;
    const time = (name === 'sword.旋風斬') ? 1.8 + 0.14 + 0.3 : (chg + cyc);
    return { name, minD: 0, maxD: s.maxD, time, dmgAt: () => s.dmg, hitP: () => 1 - o.pDodge * 0.5, ctlAt: () => s.ctl };
  }

  // 量測值插值(距離 4~20,模式 pred 為玩家預判、strafe 為目標橫走的命中)
  function at(I, name, d, mode) {
    const T = I[name]; if (!T) return null;
    const ds = Object.keys(T).map(Number).sort((a, b) => a - b);
    const x = Math.min(ds[ds.length - 1], Math.max(ds[0], d));
    let lo = ds[0], hi = ds[ds.length - 1];
    for (const k of ds) { if (k <= x) lo = k; if (k >= x) { hi = k; break; } }
    const a = T[lo][mode], b = T[hi][mode]; if (!a || !b) return null;
    const f = hi === lo ? 0 : (x - lo) / (hi - lo);
    return { hitRate: a.hitRate + (b.hitRate - a.hitRate) * f, pvpHit: a.pvpHit + (b.pvpHit - a.pvpHit) * f, ctl: a.ctl + (b.ctl - a.ctl) * f, cyc: a.cyc, chg: a.chg, pvpHitRaw: a.hitRate > 0 ? a.pvpHit : null };
  }

  // 遠程招式規格:hitP = (1 - pDodge)·預判命中 + pDodge·橫走命中;dmg = 預判時的每發 PvP;ctl 每命中秒數
  function rangedSpec(name, I, o) {
    const first = I[name]; if (!first) return null;
    const ds = Object.keys(first).map(Number);
    return {
      name, minD: Math.min(...ds), maxD: Math.max(...ds), time: null,
      hitP: d => { const p = at(I, name, d, 'pred'), s = at(I, name, d, 'strafe'); if (!p) return 0; return (1 - o.pDodge) * p.hitRate + o.pDodge * (s ? s.hitRate : 0); },
      dmgAt: d => { const p = at(I, name, d, 'pred'); return p ? p.pvpHit : 0; },
      ctlAt: d => { const p = at(I, name, d, 'pred'); return p && p.hitRate > 0 ? p.ctl / p.hitRate : 0; },
      timeAt: d => { const p = at(I, name, d, 'pred'); return p ? (p.chg + p.cyc) : 1; }
    };
  }

  // 單場對打:A、B 面對面,起始距離 D0;每側一次只做一件事(施放中 / 控制中不能動)
  function game(A, B, I, o, D0) {
    const side = (e, x, dir) => ({ e, x, hp: HP, busyT: 0, castEnd: null, ccUntil: 0, pend: null, dir, specs: null });
    let a = side(A, -D0 / 2, 1), b = side(B, D0 / 2, -1);
    const specsOf = (s) => s.e.attacks.map(n => s.e.ranged ? rangedSpec(n, I, o) : meleeSpec(n, I, o)).filter(Boolean);
    a.specs = specsOf(a); b.specs = specsOf(b);
    let t = 0;
    while (t < MAXT) {
      t += DT;
      for (const s of [a, b]) {
        const other = s === a ? b : a;
        const D = Math.abs(a.x - b.x);
        if (s.pend && t >= s.castEnd) {           // 施放結束 → 判定
          const sp = s.pend; s.pend = null;
          const Dn = Math.abs(a.x - b.x);
          if (rnd() < sp.hitP(Dn)) {
            const dmg = sp.dmgAt(Dn);
            other.hp -= dmg;
            other.ccUntil = Math.max(other.ccUntil, t + Math.min(sp.ctlAt(Dn), CC_CAP));
          }
        }
        if (other.hp <= 0 || s.hp <= 0) continue;
        if (s.pend || t < s.ccUntil) continue;    // 施放中 / 控制中:不能動
        // 出招:挑 有效距離內、單位時間期望傷害最高者
        let best = null, bv = -1;
        for (const sp of s.specs) {
          if (D < sp.minD || D > sp.maxD) continue;
          const tm = sp.time != null ? sp.time : sp.timeAt(D);
          const v = sp.dmgAt(D) * sp.hitP(D) / Math.max(0.2, tm);
          if (v > bv) { bv = v; best = sp; }
        }
        if (best && bv > 0) {
          const tm = best.time != null ? best.time : best.timeAt(D);
          s.pend = best; s.castEnd = t + tm;
          continue;
        }
        // 移動:近戰逼近至 pref;遠程保持 pref 附近(太近後退、太遠前進)
        const pref = s.e.pref, dir = s.x < other.x ? 1 : -1;
        const gap = D - pref;
        if (Math.abs(gap) > 0.2) s.x += (gap > 0 ? 1 : -1) * dir * SPEED * DT;
      }
      if (a.hp <= 0 || b.hp <= 0) break;
    }
    if (a.hp <= 0 && b.hp <= 0) return { winner: null, t };
    if (a.hp <= 0) return { winner: 'B', t };
    if (b.hp <= 0) return { winner: 'A', t };
    return { winner: null, t: MAXT };
  }

  // 整批:每對 games 場,起始距離輪流取 startDists,先後手互換
  DUEL.run = function (rows, opt) {
    opt = opt || {};
    const o = { games: opt.games || 20, startDists: opt.startDists || [6, 10, 14], pDodge: opt.pDodge == null ? 0.3 : opt.pDodge, behindRate: opt.behindRate == null ? 0.5 : opt.behindRate };
    const I = index(rows), E = entrants(rows);
    const ids = E.map(e => e.id), W = {}, TT = {};
    for (const x of ids) { W[x] = {}; TT[x] = {}; }
    RS = 20261110;
    for (let i = 0; i < E.length; i++) for (let j = 0; j < E.length; j++) {
      if (i === j) continue;
      let wins = 0, draws = 0, ttk = 0, ttkN = 0;
      for (let g = 0; g < o.games; g++) {
        const D0 = o.startDists[g % o.startDists.length];
        const A = g % 2 ? E[j] : E[i], B = g % 2 ? E[i] : E[j];   // 先後手互換
        const r = game(A, B, I, o, D0);
        const iWin = r.winner === (g % 2 ? 'B' : 'A');
        if (r.winner === null) draws++;
        else if (iWin) { wins++; ttk += r.t; ttkN++; }
        if (r.winner !== null && !iWin) { /* 敗 */ }
      }
      W[E[i].id][E[j].id] = { wins, draws, games: o.games, rate: +(wins / o.games).toFixed(2), avgTTK: ttkN ? +(ttk / ttkN).toFixed(1) : null };
    }
    DUEL.last = { ids, W, opt: o, note: MELEE_NOTE };
    return DUEL.last;
  };

  // 文字版矩陣(列 = 攻方,欄 = 守方;格內 = 攻方勝率)
  DUEL.table = function (res) {
    res = res || DUEL.last; const ids = res.ids; const lines = [ids.join('\t')];
    for (const a of ids) lines.push(a + '\t' + ids.map(b => a === b ? '-' : String(res.W[a][b].rate)).join('\t'));
    return lines.join('\n');
  };

  window.DUEL = DUEL;
  return DUEL;
})();
