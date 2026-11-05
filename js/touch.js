'use strict';
// 觸控雙搖桿 + 手把(Switch Pro / Xbox 等,走瀏覽器 Gamepad API)
// 左搖桿:移動;集氣時變成「光圈位置」(方向=方向、推多遠=離多遠)
// 右大鈕:按住集氣、放開施放;按住時手指上下滑=調範圍
(function () {
  const $ = id => document.getElementById(id);
  if (IS_TOUCH) document.body.classList.add('touch');
  const touchNow = () => { G.lastTouch = performance.now(); G.inputMode = 'stick'; };

  // ---- 左搖桿 ----
  const base = $('stickBase'), knob = $('stickKnob'); let sid = null;
  function upd(e) {
    const r = base.getBoundingClientRect(), R = r.width / 2;
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy), k = m > R ? R / m : 1; dx *= k; dy *= k;
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    G.stick.x = dx / R; G.stick.y = dy / R; G.stick.mag = Math.min(1, Math.hypot(dx, dy) / R);
  }
  base.addEventListener('pointerdown', e => { e.preventDefault(); touchNow(); sid = e.pointerId; base.setPointerCapture(sid); upd(e); });
  base.addEventListener('pointermove', e => { if (e.pointerId === sid) upd(e); });
  ['pointerup', 'pointercancel'].forEach(t => base.addEventListener(t, e => {
    if (e.pointerId !== sid) return; sid = null; G.stick.x = G.stick.y = G.stick.mag = 0; knob.style.transform = '';
  }));

  // ---- 右大鈕:集氣 / 施放 / 滑動調範圍 ----
  const atk = $('btnAtk'); let aid = null, ay0 = 0, rad0 = 0;
  function endAtk() {
    if (G.state === 'charging') { if (G.chargeT < CFG.minHold) G.queued = true; else release(); }
    atk.classList.remove('on'); aid = null; saveCfgSoon();
  }
  atk.addEventListener('pointerdown', e => {
    e.preventDefault(); touchNow();
    if (G.state !== 'ready') return;
    if (G.skill < 0) G.skill = 0;
    aid = e.pointerId; atk.setPointerCapture(aid); ay0 = e.clientY; rad0 = CFG.rad[G.skill]; atk.classList.add('on'); startCharge();
  });
  atk.addEventListener('pointermove', e => {
    if (e.pointerId !== aid || G.state !== 'charging') return;
    const c = sc(G.skill); CFG.rad[G.skill] = clamp(rad0 + (ay0 - e.clientY) / 160 * (c.rMax - c.rMin), c.rMin, c.rMax);
  });
  ['pointerup', 'pointercancel'].forEach(t => atk.addEventListener(t, e => { if (e.pointerId === aid) endAtk(); }));

  // ---- 其他按鈕 ----
  const press = (id, fn) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); touchNow(); fn(); });
  press('btnJump', doJump);
  press('btnRoll', tryRoll);
  press('btnWeap', () => { if (G.state === 'ready') { G.weapon = G.weapon === 'staff' ? 'book' : 'staff'; mage.setWeapon(G.weapon); } });
  press('btnHit', strike);

  // ---- 觸控拖曳轉視角 ----
  const cv = renderer.domElement; let cid = null, cx = 0, cy = 0;
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return; touchNow(); cid = e.pointerId; cx = e.clientX; cy = e.clientY;
    try { document.documentElement.requestFullscreen && !document.fullscreenElement && document.documentElement.requestFullscreen().catch(() => { }); } catch (err) { }
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerId !== cid) return;
    G.camYaw -= (e.clientX - cx) * CFG.camSens * 1.3; G.camPitch = clamp(G.camPitch + (e.clientY - cy) * CFG.camSens * 1.3, .08, 1.35); cx = e.clientX; cy = e.clientY;
  });
  ['pointerup', 'pointercancel'].forEach(t => cv.addEventListener(t, e => { if (e.pointerId === cid) cid = null; }));

  // ---- 手把 ----
  let prev = [], padOn = false;
  window.inputTick = function (dt) {
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null; for (const g of gps) if (g && g.connected) { gp = g; break; }
    if (!gp) return;
    const dz = v => Math.abs(v) > .18 ? v : 0, ax = i => dz(gp.axes[i] || 0), b = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const edge = i => b(i) && !prev[i];
    const lx = ax(0), ly = ax(1), rx = ax(2), ry = ax(3);
    const any = lx || ly || rx || ry || gp.buttons.some(x => x.pressed);
    if (any) { G.inputMode = 'stick'; padOn = true; }
    if (padOn) { G.stick.x = lx; G.stick.y = ly; G.stick.mag = Math.min(1, Math.hypot(lx, ly)); }
    if (G.state === 'charging' && G.skill >= 0) {           // 集氣中:右搖桿上下 = 調範圍
      const c = sc(G.skill); CFG.rad[G.skill] = clamp(CFG.rad[G.skill] - ry * dt * (c.rMax - c.rMin) * .7, c.rMin, c.rMax);
    } else { G.camYaw -= rx * dt * 2.6; G.camPitch = clamp(G.camPitch + ry * dt * 1.6, .08, 1.35); }
    // ZR / RT 按住集氣、放開施放
    if (edge(7) && G.state === 'ready') { if (G.skill < 0) G.skill = 0; startCharge(); }
    if (!b(7) && prev[7] && G.state === 'charging') { if (G.chargeT < CFG.minHold) G.queued = true; else release(); }
    if (edge(0)) doJump();                                   // B
    if (edge(1)) tryRoll();                                  // A
    if (edge(3) && G.state === 'ready') { G.weapon = G.weapon === 'staff' ? 'book' : 'staff'; mage.setWeapon(G.weapon); }  // X
    if (edge(4)) selectSkill((Math.max(G.skill, 0) + 2) % 3);   // L:上一個法術
    if (edge(5)) selectSkill((Math.max(G.skill, 0) + 1) % 3);   // R:下一個法術
    if (edge(9) || edge(8)) document.getElementById('panel').classList.toggle('on');
    if (edge(2)) strike();                                   // Y:來襲測試
    prev = gp.buttons.map(x => x.pressed);
  };
})();
