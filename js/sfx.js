'use strict';
/* ================= 音效與音樂(sfx.js):WebAudio 程式合成,不載入外部音檔 =================
   設定在 CFG.sfx(game.js):on 音效、music 音樂、vol / mvol 音量(0~1),存 localStorage(隨 CFG)。
   首次互動(pointerdown / keydown / touchstart)後才建立 AudioContext。
   掛點:sfx.play(名稱, {cls, el, d, txt, go})、sfx.loop('charge', 開/關)、sfx.setScene(場地索引)、sfx.sync()(設定變更後套用)。
   d = 距離(m):遠端施法 / 受擊依距離衰減,≥ 30 m 不播。同類音效有最小間隔,同時發聲上限 12。
   window.SFX_MUTE_TEST = true:測試用,照常計數與建立節點,但主音量 0、不輸出聲音(stats 可讀)。 */
const sfx = (() => {
  const testMute = () => !!window.SFX_MUTE_TEST;
  const MAX_VOICES = 12, MAX_DIST = 30;
  const GAP = { hit: .06, hurt: .15, cast: .08, roll: .2, jump: .15, block: .3, deny: .6, banner: .3, click: .04, count: .3, result: 1, kill: .3, charge: 0 };
  const CLS_SND = { archer: 'bow', swordsman: 'blade', assassin: 'dagger' };
  const cfg = () => (window.CFG && CFG.sfx) || { on: true, music: false, vol: .6, mvol: .4 };
  const stats = { ctx: 0, plays: {}, skipped: 0, voices: 0, peak: 0, muteTest: false };
  let ctx = null, out = null, sBus = null, mBus = null, noise = null, mus = null, scene = 0;
  const last = {}, loops = {};

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { console.warn('[sfx] AudioContext 無法建立', e); ctx = null; return null; }
    stats.ctx++;
    out = ctx.createGain(); out.gain.value = testMute() ? 0 : .9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    out.connect(comp); comp.connect(ctx.destination);
    sBus = ctx.createGain(); sBus.connect(out);
    mBus = ctx.createGain(); mBus.connect(out);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  const running = () => !!ctx && ctx.state === 'running';
  function levels() {
    const c = cfg();
    if (out) { out.gain.value = testMute() ? 0 : .9; stats.muteTest = testMute(); }
    if (sBus) sBus.gain.value = c.on ? c.vol * .6 : 0;
    if (mBus) mBus.gain.value = c.music ? c.mvol * .35 : 0;
  }
  function unlock() {
    const c = init();
    if (c && c.state !== 'running') c.resume().then(() => sync()).catch(() => { });
    levels(); sync();
  }
  const onGesture = () => {
    unlock();
    if (running()) ['pointerdown', 'keydown', 'touchstart'].forEach(t => removeEventListener(t, onGesture, true));
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach(t => addEventListener(t, onGesture, true));
  addEventListener('click', e => { const t = e.target; if (t && t.closest && t.closest('button,.slot,#modeTag')) play('click'); }, true);

  /* ---------- 合成基本件 ---------- */
  // 單音:頻率 f0 → f1 滑音,包絡 dur 秒,可選低通 / 帶通等濾波
  function osc(type, f0, f1, t0, dur, vol, bus, filt) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, .0002), t0 + Math.min(.02, dur * .2));
    g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    let end = o;
    if (filt) { const fl = ctx.createBiquadFilter(); fl.type = filt.type; fl.frequency.value = filt.f; fl.Q.value = filt.q || 1; o.connect(fl); end = fl; }
    end.connect(g); g.connect(bus); o.start(t0); o.stop(t0 + dur + .05);
  }
  // 噪音:帶通 / 高通 / 低通,頻率 f 可滑到 f1
  function nz(t0, dur, vol, bus, type, f, q, f1) {
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; fl.type = type; fl.frequency.setValueAtTime(f, t0);
    if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    fl.Q.value = q || 1;
    g.gain.setValueAtTime(Math.max(vol, .0002), t0); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    s.connect(fl); fl.connect(g); g.connect(bus); s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + .05);
  }

  /* ---------- 音效定義:kind → [長度(秒), 合成函式(t, vol)] ---------- */
  const CAST = {
    fire: (t, v) => { osc('sawtooth', 260, 780, t, .28, .06 * v, sBus, { type: 'lowpass', f: 1800 }); nz(t, .22, .1 * v, sBus, 'bandpass', 1200, 1.2, 2400); },
    water: (t, v) => { osc('sine', 520, 260, t, .3, .13 * v, sBus); osc('sine', 880, 1180, t + .09, .18, .045 * v, sBus); },
    wind: (t, v) => nz(t, .4, .11 * v, sBus, 'bandpass', 600, 2, 2600),
    earth: (t, v) => { osc('triangle', 130, 60, t, .3, .18 * v, sBus); nz(t, .12, .1 * v, sBus, 'lowpass', 500, 1); },
    light: (t, v) => { osc('sine', 880, 880, t, .45, .07 * v, sBus); osc('sine', 1320, 1320, t + .05, .4, .04 * v, sBus); },
    dark: (t, v) => { osc('square', 220, 90, t, .4, .045 * v, sBus, { type: 'lowpass', f: 700, q: 3 }); osc('sine', 110, 55, t, .4, .09 * v, sBus); },
    bow: (t, v) => { osc('triangle', 330, 200, t, .14, .11 * v, sBus); nz(t, .05, .07 * v, sBus, 'highpass', 3000, 1); },
    blade: (t, v) => { nz(t, .18, .12 * v, sBus, 'bandpass', 2400, 1.5, 800); osc('sawtooth', 600, 300, t, .12, .045 * v, sBus, { type: 'lowpass', f: 1500 }); },
    dagger: (t, v) => { nz(t, .07, .09 * v, sBus, 'highpass', 4000, 1); osc('sine', 1200, 600, t, .08, .05 * v, sBus); }
  };
  const SYN = {
    cast: [.4, (o, v) => { const k = o.cls && o.cls !== 'mage' ? CLS_SND[o.cls] : null; (CAST[k] || CAST[o.el] || CAST.fire)(ctx.currentTime + .01, v); }],
    hit: [.1, (o, v) => { const t = ctx.currentTime + .01; osc('sine', 200, 90, t, .09, .16 * v, sBus); nz(t, .05, .09 * v, sBus, 'highpass', 2000, 1); }],
    hurt: [.25, (o, v) => osc('triangle', 300, 120, ctx.currentTime + .01, .22, .18 * v, sBus, { type: 'lowpass', f: 1400 })],
    kill: [.5, (o, v) => { const t = ctx.currentTime + .01; osc('triangle', 660, 660, t, .12, .1 * v, sBus); osc('triangle', 880, 880, t + .1, .12, .1 * v, sBus); osc('triangle', 1320, 1320, t + .2, .25, .1 * v, sBus); }],
    roll: [.3, (o, v) => nz(ctx.currentTime + .01, .28, .12 * v, sBus, 'bandpass', 400, 1, 1300)],
    jump: [.15, (o, v) => osc('sine', 300, 620, ctx.currentTime + .01, .14, .12 * v, sBus)],
    block: [.12, (o, v) => { const t = ctx.currentTime + .01; nz(t, .1, .1 * v, sBus, 'highpass', 1500, 1); osc('sine', 900, 900, t, .1, .05 * v, sBus); }],
    deny: [.15, (o, v) => osc('square', 180, 160, ctx.currentTime + .01, .14, .05 * v, sBus, { type: 'lowpass', f: 900 })],
    banner: [.1, (o, v) => osc('sine', 740, 740, ctx.currentTime + .01, .09, .05 * v, sBus)],
    click: [.04, (o, v) => osc('sine', 1000, 1000, ctx.currentTime + .01, .03, .05 * v, sBus)],
    count: [.3, (o, v) => { const t = ctx.currentTime + .01; if (o.go) osc('sine', 990, 990, t, .25, .1 * v, sBus); else osc('sine', 660, 660, t, .1, .1 * v, sBus); }],
    result: [.9, (o, v) => { const t = ctx.currentTime + .01; [523.25, 659.25, 783.99].forEach((f, i) => osc('triangle', f, f, t + i * .08, .7, .07 * v, sBus)); }]
  };
  const bannerKind = txt => /擋|閃|躲/.test(txt || '') ? 'block' : /不足|不能|無法|遺失/.test(txt || '') ? 'deny' : 'banner';

  /* ---------- 單次音效 ---------- */
  // o.d:距離(m),≥ MAX_DIST 不播,音量隨距離衰減;同類音效節流;同時發聲上限 MAX_VOICES
  function play(name, o) {
    o = o || {};
    const c = cfg();
    if (!c.on) return;
    const kind = name === 'banner' ? bannerKind(o.txt) : name;
    const d = o.d || 0;
    const t = performance.now() / 1000;
    if (d >= MAX_DIST || t - (last[kind] || -9) < (GAP[kind] || .05) || stats.voices >= MAX_VOICES) { stats.skipped++; return; }
    last[kind] = t;
    stats.plays[kind] = (stats.plays[kind] || 0) + 1;
    const spec = SYN[kind];
    if (!spec) return;
    voice(spec[0]);
    if (running()) spec[1](o, d > 0 ? Math.pow(1 - d / MAX_DIST, 1.5) : 1);
  }
  function voice(dur) {
    stats.voices++; if (stats.voices > stats.peak) stats.peak = stats.voices;
    setTimeout(() => { stats.voices--; }, dur * 1000 + 60);
  }

  /* ---------- 集氣循環(開始 / 結束由 game.js 呼叫) ---------- */
  function loop(name, on) {
    const L = loops[name];
    if (on && cfg().on && !L) {
      stats.plays[name + '_loop'] = (stats.plays[name + '_loop'] || 0) + 1;
      stats.voices++; if (stats.voices > stats.peak) stats.peak = stats.voices;
      const nodes = [];
      if (running()) {
        const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), l1 = ctx.createOscillator(), l1g = ctx.createGain(), l2 = ctx.createOscillator(), l2g = ctx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(180, t); o.frequency.linearRampToValueAtTime(360, t + 2.4);
        l1.frequency.value = 5; l1g.gain.value = 3; l1.connect(l1g); l1g.connect(o.frequency);
        l2.frequency.value = 4; l2g.gain.value = .02; l2.connect(l2g); l2g.connect(g.gain);
        g.gain.value = .04; o.connect(g); g.connect(sBus);
        o.start(t); l1.start(t); l2.start(t); nodes.push(o, l1, l2);
        loops[name] = { g, nodes };
      } else loops[name] = { g: null, nodes };
    } else if (!on && L) {
      if (L.g) {
        const t = ctx.currentTime; L.g.gain.cancelScheduledValues(t); L.g.gain.setValueAtTime(L.g.gain.value, t); L.g.gain.linearRampToValueAtTime(0, t + .15);
        L.nodes.forEach(n => n.stop(t + .2));
      }
      stats.voices = Math.max(0, stats.voices - 1);
      delete loops[name];
    }
  }

  /* ---------- 環境音樂(場地:0 月夜 = 低沉氛圍、1 叢林 = 木琴與蟲鳴感) ---------- */
  function melody(mode, g) {
    if (!running() || Math.random() < .35) return;
    const t = ctx.currentTime + .05;
    if (mode === 'jungle') {
      const f = [146.83, 174.61, 220, 293.66][Math.floor(Math.random() * 4)];
      osc('triangle', f, f, t, .9, .045, g);
      if (Math.random() < .5) osc('sine', 2200, 3100, t + .4, .08, .01, g);
    } else {
      const f = [440, 493.88, 587.33, 659.25, 880][Math.floor(Math.random() * 5)];
      osc('sine', f, f, t, 2.2, .022, g);
    }
  }
  function startMusic() {
    stopMusic();
    if (!running() || !cfg().music) return;
    const mode = scene >= 1 ? 'jungle' : 'moon', t = ctx.currentTime, nodes = [];
    const g = ctx.createGain(); g.gain.value = 0; g.gain.linearRampToValueAtTime(1, t + 3); g.connect(mBus);
    const pad = mode === 'jungle' ? [73.42, 110, 146.83] : [55, 82.41, 110];
    pad.forEach((f, i) => {
      const o = ctx.createOscillator(), og = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain();
      o.type = mode === 'jungle' ? 'triangle' : 'sine'; o.frequency.value = f; o.detune.value = (i - 1) * 6;
      og.gain.value = .25 / (i + 1.5);
      l.frequency.value = .05 + i * .03; lg.gain.value = .12 / (i + 1.5);
      l.connect(lg); lg.connect(og.gain);
      o.connect(og); og.connect(g); o.start(t); l.start(t); nodes.push(o, l);
    });
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), ng = ctx.createGain();
    s.buffer = noise; s.loop = true;
    fl.type = 'bandpass'; fl.frequency.value = mode === 'jungle' ? 1400 : 380; fl.Q.value = mode === 'jungle' ? 2 : .7;
    ng.gain.value = mode === 'jungle' ? .02 : .025;
    s.connect(fl); fl.connect(ng); ng.connect(g); s.start(t); nodes.push(s);
    mus = { mode, g, nodes, timer: setInterval(() => melody(mode, g), mode === 'jungle' ? 2200 : 3600) };
  }
  function stopMusic() {
    if (!mus) return;
    const m = mus; mus = null; clearInterval(m.timer);
    const t = ctx.currentTime;
    m.g.gain.cancelScheduledValues(t); m.g.gain.setValueAtTime(m.g.gain.value, t); m.g.gain.linearRampToValueAtTime(0, t + .5);
    m.nodes.forEach(n => n.stop(t + .6));
  }
  // 依 CFG.sfx 套用音量與音樂開關(設定面板 / 封面開關改變時呼叫)
  function sync() {
    levels();
    if (!cfg().music || !running()) { stopMusic(); return; }
    const mode = scene >= 1 ? 'jungle' : 'moon';
    if (!mus || mus.mode !== mode) startMusic();
  }
  function setScene(i) { scene = i | 0; sync(); }

  return { play, loop, setScene, sync, unlock, stats, state: () => (ctx ? ctx.state : 'none'), init };
})();
window.sfx = sfx;
