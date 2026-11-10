'use strict';
// 多人同場壓力測試(設計_縮範圍與第一人稱 §F、設計_多人連線 §6-4 / §9-1):在已進入場景的頁面內建立 N 個假遠端 RemotePlayer,
// 以假時鐘(Net.now)與假快照(Net.snapOf,用 packSnap 編碼)餵入,逐格呼叫 game.js 的 frame(),量 frame 時間、
// renderer.info 的 draw calls / triangles、JS 堆積記憶體(Chromium 才有)。
//
// 用法(頁面已載入、封面已關閉,例如 ?solo=1&scene=1):
//   1. 載入本檔:<script src="tools/load_test.js"></script>(或主控台貼上)
//   2. LoadTest.run({ n: 12, layout: 'near', hz: 10, frames: 120 }) → 單一情境結果
//      LoadTest.runAll() → 依序跑 n=0(基準)、near、mid、far、mixed 五組,回傳陣列
//   layout:near = 全部 < 20 m;mid = 20~36 m;far = 42~50 m(超出叢林 arenaR,僅供測量);mixed = 三段各 1/3
//   hz:假快照頻率(每個假遠端都以此頻率寫入)。frame 成本與 hz 幾乎無關,頻寬另由 payloadBytes × hz × 人數估算
//
// 副作用與還原:執行期間 window.NETON = true、Net.now / Net.snapOf 被替換、requestAnimationFrame 暫時改為空函式;
// 結束時 clearRemotes()(稻草人還原)並還原全部。不呼叫 Net 的寫入(沒有匯流排,Net.setSnap 直接略過)。
// 只讀 frame 內的全域 renderer / scene / G;不改遊戲狀態。
(function () {
  const CLS_LIST = ['mage', 'archer', 'swordsman', 'assassin'];
  const EL_LIST = ['water', 'fire', 'wind', 'earth', 'light', 'dark'];
  const FRAME_MS = 1000 / 60;

  // 第 i 個假遠端的半徑(依佈局)
  function radiusOf(layout, i) {
    if (layout === 'near') return 5 + (i % 3) * 5;          // 5 / 10 / 15 m
    if (layout === 'mid') return 22 + (i % 3) * 7;          // 22 / 29 / 36 m
    if (layout === 'far') return 42 + (i % 3) * 4;          // 42 / 46 / 50 m
    const seg = i % 3;                                       // mixed:近 / 中 / 遠 輪流
    return seg === 0 ? 8 + (i % 4) : seg === 1 ? 26 + (i % 4) : 44 + (i % 4);
  }
  function heapMB() {
    const m = performance.memory;
    return m ? Math.round(m.usedJSHeapSize / 1048576 * 10) / 10 : null;
  }
  function pct(arr, p) {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 100) / 100;
  }
  function stats(arr) {
    if (!arr.length) return null;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return { mean: Math.round(mean * 100) / 100, p50: pct(arr, .5), p95: pct(arr, .95), max: Math.round(Math.max.apply(null, arr) * 100) / 100 };
  }

  // 假快照:依序號與時間讓角色在出生點附近小圈移動,面向場中
  function fakeSnap(seq, t, base, i) {
    const ph = t / 1000 + i * 1.7;
    const x = base.x + Math.cos(ph) * 1.5, z = base.z + Math.sin(ph) * 1.5;
    return packSnap({
      n: seq, tm: t, x: x, y: terrainH(x, z), z: z, r: Math.atan2(-x, -z), m: 1.2, c: 0, k: 0, q: 0,
      o: -1, p: 0, f: -1, s: 0, d: 0, g: 1, hp: 100, sh: 0, w: 0, tp: 0, e: 0
    });
  }

  function run(opt) {
    opt = opt || {};
    const n = opt.n == null ? 12 : opt.n | 0;
    const layout = opt.layout || 'near';
    const hz = +opt.hz || 10;
    const frames = opt.frames || 120;
    const warm = opt.warm == null ? 20 : opt.warm | 0;

    const saved = {
      now: Net.now, snapOf: Net.snapOf, raf: window.requestAnimationFrame,
      neton: window.NETON, lock: window.NET_LOCK, t0: roundT0, sp: spawnPts, autoReset: renderer.info.autoReset
    };
    const out = { n: n, layout: n ? layout : '-', hz: hz, frames: frames };
    let T = 1e6, RAF = performance.now();
    const seats = [], snaps = {}, nextAt = {}, seq = {}, bases = [];
    const heapBefore = heapMB();

    try {
      clearRemotes();
      stashDummies();
      window.NET_LOCK = false;
      roundT0 = 0;
      Net.now = () => T;
      window.NETON = true;
      placeLocal({ x: 0, y: 0, z: 0 });
      const geoBefore = renderer.info.memory.geometries, texBefore = renderer.info.memory.textures;
      for (let i = 0; i < n; i++) {
        const a = TAU_T * (i + .5) / n, r = radiusOf(layout, i);
        const pos = { x: Math.sin(a) * r, y: 0, z: Math.cos(a) * r };
        const seat = i + 2, info = { id: seat, name: '測試' + seat, cls: CLS_LIST[i % 4], el: EL_LIST[i % 6] };
        addRemote(info, pos);
        seats.push(String(seat)); bases.push(pos); seq[seat] = 0; nextAt[seat] = T;
      }
      out.heapBeforeMB = heapBefore; out.heapAfterBuildMB = heapMB();
      out.geometries = renderer.info.memory.geometries - geoBefore;
      out.textures = renderer.info.memory.textures - texBefore;
      let meshes = 0; scene.traverse(o => { if (o.isMesh) meshes++; });
      out.sceneMeshes = meshes;

      Net.snapOf = seat => snaps[seat];
      const feed = () => {
        for (let i = 0; i < seats.length; i++) {
          const s = seats[i];
          if (T < nextAt[s]) continue;
          nextAt[s] += 1000 / hz; if (nextAt[s] < T) nextAt[s] = T + 1000 / hz;
          seq[s] = (seq[s] + 1) & 255;
          snaps[s] = fakeSnap(seq[s], T, bases[i], i);
        }
      };

      window.requestAnimationFrame = () => 0;   // frame() 會自行排下一格;測試時關掉,逐格手動呼叫
      renderer.info.autoReset = false;
      const gl = renderer.getContext(), px = new Uint8Array(4);
      const cpu = [], tot = [], calls = [], tris = [];
      for (let f = 0; f < warm + frames; f++) {
        T += FRAME_MS; feed();
        RAF += FRAME_MS;
        renderer.info.reset();
        const t0 = performance.now();
        frame(RAF);
        const t1 = performance.now();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // 強制 GPU 完成,量到真正的繪圖成本
        const t2 = performance.now();
        if (f >= warm) { cpu.push(t1 - t0); tot.push(t2 - t0); calls.push(renderer.info.render.calls); tris.push(renderer.info.render.triangles); }
      }
      out.cpuMs = stats(cpu);
      out.totalMs = stats(tot);
      out.drawCalls = stats(calls);
      out.triangles = stats(tris);
      out.heapEndMB = heapMB();
      out.payloadBytes = snaps[seats[0]] ? snaps[seats[0]].length : 0;
      out.sendBytesPerSec = Math.round(n * hz * (out.payloadBytes + 60));   // 每人每秒寫入的 JSON 本體估計(不含 HTTP 標頭)
      out.snapBytesPerSecRoom = Math.round((n + 1) * n * hz * (out.payloadBytes + 60));   // 串流:每人收到全房所有快照(含自己)
    } finally {
      window.requestAnimationFrame = saved.raf;
      renderer.info.autoReset = saved.autoReset;
      clearRemotes();
      Net.now = saved.now; Net.snapOf = saved.snapOf;
      window.NETON = saved.neton; window.NET_LOCK = saved.lock; roundT0 = saved.t0; spawnPts = saved.sp;
    }
    return out;
  }
  const TAU_T = Math.PI * 2;

  window.LoadTest = {
    run: run,
    runAll: function (frames) {
      const sets = [{ n: 0 }, { n: 12, layout: 'near' }, { n: 12, layout: 'mid' }, { n: 12, layout: 'far' }, { n: 12, layout: 'mixed' }];
      return sets.map(s => { s.frames = frames || 120; return run(s); });
    }
  };
})();
