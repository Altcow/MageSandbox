'use strict';
// 觸控雙搖桿 + 手把(Switch Pro / Xbox 等,走瀏覽器 Gamepad API)
// 左搖桿:移動;集氣時變成「光圈位置」(方向=方向、推多遠=離多遠)
// 右大鈕:按住集氣、放開施放;按住時手指上下滑=調範圍
(function () {
  const $ = id => document.getElementById(id);
  if (IS_TOUCH) document.body.classList.add('touch');
  const touchNow = () => { G.lastTouch = performance.now(); G.inputMode = 'stick'; document.body.classList.remove('pad'); };

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
  const atk = $('btnAtk'); let aid = null, ay0 = 0, rad0 = 0, ax0 = 0, wo0 = 0, drag = false;
  function endAtk() {
    if (G.state === 'charging') { if (G.chargeT < CFG.minHold) G.queued = true; else release(); }
    atk.classList.remove('on'); aid = null; drag = false; G.atkHeld = false; saveCfgSoon();
  }
  // 記下滑動起點(範圍用垂直、火牆用水平)
  function initDrag(e) { drag = true; ay0 = e.clientY; ax0 = e.clientX; rad0 = CFG.rad[G.skill]; wo0 = G.wallOff; }
  atk.addEventListener('pointerdown', e => {
    e.preventDefault(); touchNow();
    aid = e.pointerId; atk.setPointerCapture(aid); G.atkHeld = true;   // 僵直中按住,結束後接續集氣
    if (G.state !== 'ready') return;
    if (G.skill < 0) G.skill = G.lastSkill;
    atk.classList.add('on'); initDrag(e); startCharge();
  });
  atk.addEventListener('pointermove', e => {
    if (e.pointerId !== aid || G.state !== 'charging') return;
    if (!drag) initDrag(e);
    const c = sc(G.skill); CFG.rad[G.skill] = clamp(rad0 + (ay0 - e.clientY) / 160 * (c.rMax - c.rMin), c.rMin, c.rMax);
    if (SKILLS[G.skill].shape === 'wall') G.wallOff = wo0 - (e.clientX - ax0) / 120;
  });
  ['pointerup', 'pointercancel'].forEach(t => atk.addEventListener(t, e => { if (e.pointerId === aid) endAtk(); }));

  // ---- 其他按鈕 ----
  const press = (id, fn) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); touchNow(); fn(); });
  press('btnJump', doJump);
  press('btnRoll', tryRoll);
  press('btnWeap', () => { if (G.state === 'charging') cancelCharge(); else toggleWeapon(); });   // 集氣中此鈕變「取消」
  // 來襲鈕:短按 = 來襲測試;按住滿 0.6 s = 切換自動來襲
  const hitBtn = $('btnHit'); let hitT = 0, hitId = null;
  hitBtn.addEventListener('pointerdown', e => {
    e.preventDefault(); touchNow(); hitId = e.pointerId; hitBtn.setPointerCapture(hitId);
    hitT = setTimeout(() => { hitT = 0; toggleAuto(); }, 600);
  });
  hitBtn.addEventListener('pointerup', e => { if (e.pointerId !== hitId) return; hitId = null; if (hitT) { clearTimeout(hitT); hitT = 0; strike(); } });
  hitBtn.addEventListener('pointercancel', e => { if (e.pointerId !== hitId) return; hitId = null; clearTimeout(hitT); hitT = 0; });

  // ---- 觸控拖曳轉視角 ----
  const cv = renderer.domElement; let cid = null, cx = 0, cy = 0, tapT = -1e9, tapX = 0, tapY = 0;
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return; touchNow(); cid = e.pointerId; cx = e.clientX; cy = e.clientY;
    const now = performance.now();   // 雙擊畫面 = 鏡頭重置(間隔 < 300 ms、位移 < 12 px)
    if (now - tapT < 300 && Math.hypot(cx - tapX, cy - tapY) < 12) { resetCam(); tapT = -1e9; } else { tapT = now; tapX = cx; tapY = cy; }
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
    if (any) { G.inputMode = 'stick'; padOn = true; document.body.classList.add('pad'); }   // 手把操作時隱藏觸控鈕
    if (padOn) { G.stick.x = lx; G.stick.y = ly; G.stick.mag = Math.min(1, Math.hypot(lx, ly)); }
    if (G.state === 'charging' && G.skill >= 0) {           // 集氣中:右搖桿上下 = 調範圍;選牆時左右 = 旋轉火牆
      const c = sc(G.skill); CFG.rad[G.skill] = clamp(CFG.rad[G.skill] - ry * dt * (c.rMax - c.rMin) * .7, c.rMin, c.rMax);
      if (SKILLS[G.skill].shape === 'wall') G.wallOff -= rx * dt * 2.2;
    } else { G.camYaw -= rx * dt * 2.6; G.camPitch = clamp(G.camPitch + ry * dt * 1.6, .08, 1.35); }
    // ZR / RT 按住集氣、放開施放(按住狀態 G.atkHeld 供僵直結束後接續集氣)
    G.atkHeld = b(7);
    if (edge(7)) startCharge();
    if (!b(7) && prev[7] && G.state === 'charging') { if (G.chargeT < CFG.minHold) G.queued = true; else release(); }
    if (edge(0)) doJump();                                   // B:跳 / 二段跳
    if (edge(1)) tryRoll();                                  // A:翻滾 / 空中側翻
    if (edge(2)) strike();                                   // Y:來襲測試
    if (edge(3)) { if (G.state === 'charging') cancelCharge(); else toggleWeapon(); }   // X:換裝;集氣中為取消
    if (edge(4)) cycleSkill(-1);                             // L:上一個法術
    if (edge(5)) cycleSkill(1);                              // R:下一個法術
    if (edge(6)) { if (G.state === 'charging') cancelCharge(); else if (G.state === 'ready') G.skill = -1; }   // ZL:取消集氣 / 取消選法術
    if (edge(8)) nextScene();                                // −:換場景
    if (edge(9)) document.getElementById('panel').classList.toggle('on');   // +:參數面板
    if (edge(10)) toggleAuto();                              // 左搖桿按下:自動來襲
    if (edge(11)) resetCam();                                // 右搖桿按下:鏡頭重置
    if (edge(12)) G.zoom = clamp(G.zoom * .9, .5, 1.9);      // 十字上:拉近
    if (edge(13)) G.zoom = clamp(G.zoom * 1.1, .5, 1.9);     // 十字下:拉遠
    prev = gp.buttons.map(x => x.pressed);
  };
})();
