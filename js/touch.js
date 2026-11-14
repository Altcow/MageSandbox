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
  base.addEventListener('pointerdown', e => { e.preventDefault(); touchNow(); sid = e.pointerId; base.setPointerCapture(sid); G.fingerHold = false; upd(e); });
  base.addEventListener('pointermove', e => { if (e.pointerId === sid) upd(e); });
  ['pointerup', 'pointercancel'].forEach(t => base.addEventListener(t, e => {
    if (e.pointerId !== sid) return; sid = null; G.stick.x = G.stick.y = G.stick.mag = 0; knob.style.transform = '';
  }));

  // ---- 右大鈕:集氣 / 施放 / 滑動調範圍 ----
  const atk = $('btnAtk'); let aid = null, ay0 = 0, rad0 = 0, ax0 = 0, wo0 = 0, hx0 = 0, hz0 = 0, drag = false;
  function endAtk() {
    if (G.state === 'charging') { if (inCancel) cancelCharge(); else if (G.chargeT < CFG.minHold) G.queued = true; else release(); }
    inCancel = false;
    atk.classList.remove('on'); aid = null; drag = false; G.atkHeld = false; G.fingerHold = false; saveCfgSoon();
    if (cxEl) cxEl.style.display = 'none';
  }
  // 記下滑動起點(範圍用垂直、火牆用水平)
  function initDrag(e) { drag = true; ay0 = e.clientY; ax0 = e.clientX; rad0 = getRad(G.skill); wo0 = G.wallOff; hx0 = G.stickHold.x; hz0 = G.stickHold.z; }
  // 法師的範圍魔法(地面光圈 / 火牆,非 dir):滑動 = 直接移動魔法陣位置
  function fingerAimOn() {
    if (G.cls !== 'mage' || G.skill < 0) return false;
    const sk = curSkill(G.skill);
    return sk.aim !== 'dir' && (!sk.aim || sk.aim === 'circle' || sk.aim === 'wall') && (sk.shape === 'circle' || sk.shape === 'wall');
  }
  const CANCEL_DY = 240;   // 上滑取消距離(大於範圍調整最大行程 160px,避免瞄遠時誤取消)
  let cxEl = null, inCancel = false;
  function cxHint(dy) {   // 取消提示:上滑超過 110px 開始浮現,達門檻時放大變亮
    if (dy < 110 || G.state !== 'charging') { if (cxEl) cxEl.style.display = 'none'; return; }
    if (!cxEl) { cxEl = document.createElement('div'); cxEl.style.cssText = 'position:fixed;z-index:6;width:64px;height:64px;margin:-32px 0 0 -32px;pointer-events:none;background:url(assets/ui/b_cancel.png) center/100% 100% no-repeat;transition:transform .08s'; document.body.appendChild(cxEl); }
    const r = atk.getBoundingClientRect(), t = Math.min(1, (dy - 110) / (CANCEL_DY - 110));
    cxEl.style.display = 'block'; cxEl.style.left = (r.left + r.width / 2) + 'px'; cxEl.style.top = Math.max(40, r.top + r.height / 2 - CANCEL_DY) + 'px';
    cxEl.style.opacity = inCancel ? 1 : .35 + .65 * t; cxEl.style.transform = 'scale(' + (inCancel ? 1.7 : .8 + .4 * t) + ')';
    cxEl.style.filter = inCancel ? 'drop-shadow(0 0 10px #ff4a4a) brightness(1.2)' : 'none';   // 進入取消區:放大 + 紅光 = 此時放手即取消
  }
  atk.addEventListener('pointerdown', e => {
    e.preventDefault(); touchNow();
    if (netInputLocked()) return;   // 多人開戰倒數中不能集氣 / 施放
    aid = e.pointerId; atk.setPointerCapture(aid); G.atkHeld = true;   // 僵直中按住,結束後接續集氣
    if (G.state !== 'ready') return;
    if (G.skill < 0) G.skill = G.lastSkill;
    atk.classList.add('on'); startCharge(); initDrag(e);
  });
  atk.addEventListener('pointermove', e => {
    if (e.pointerId !== aid || G.state !== 'charging') return;
    if (!drag) initDrag(e);
    // 往上滑到取消鈕(超過 CANCEL_DY 像素)= 取消區:✕ 放大發亮,此時放手就是取消;滑回來再放手則正常施放
    { const dy = ay0 - e.clientY; inCancel = dy > CANCEL_DY; cxHint(dy); }
    if (fingerAimOn()) {
      const p = mage.root.position, k = skillRange() / 160, up = (ay0 - e.clientY) * k, rt = (e.clientX - ax0) * k;
      const fx = -Math.sin(G.camYaw), fz = -Math.cos(G.camYaw), rx = Math.cos(G.camYaw), rz = -Math.sin(G.camYaw);
      let dx = hx0 + fx * up + rx * rt - p.x, dz = hz0 + fz * up + rz * rt - p.z, d = Math.hypot(dx, dz);
      const minD = curSkill(G.skill).shape === 'wall' ? 2 : 1.2, dd = clamp(d, minD, skillRange());
      if (d < 1e-4) { dx = Math.sin(mage.yaw); dz = Math.cos(mage.yaw); d = 1; }
      const x = p.x + dx / d * dd, z = p.z + dz / d * dd; G.stickHold.set(x, surfaceY(x, z, p.y + 2), z); G.fingerHold = true;
      return;
    }
    const c = sc(G.skill); setRad(G.skill, clamp(rad0 + (ay0 - e.clientY) / 160 * (c.rMax - c.rMin), c.rMin, c.rMax));
    if (curSkill(G.skill).shape === 'wall') G.wallOff = wo0 - (e.clientX - ax0) / 120;
  });
  ['pointerup', 'pointercancel'].forEach(t => atk.addEventListener(t, e => { if (e.pointerId === aid) endAtk(); }));

  // ---- 其他按鈕 ----
  const press = (id, fn) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); touchNow(); if (netInputLocked()) return; fn(); });   // 多人開戰倒數中鎖定(netcombat.js)
  press('btnJump', doJump);
  press('btnRoll', tryRoll);
  press('btnSit', toggleSit);   // 手機:打坐 / 起身
  press('btnNear', () => { G.zoom = G.zoom > .4 ? .3 : 1; $('btnNear').classList.toggle('on', G.zoom < .4); });   // 手機:近距離視角 / 恢復(同桌機 B 鍵)
  press('btnMode', toggleChgMode);   // 手機:集氣模式 A / B
  press('btnWeap', () => { if (G.state !== 'charging') toggleWeapon(); });   // 集氣中此鈕不作用(取消改為施法鈕上滑)
  document.querySelectorAll('.tb,#btnAtk').forEach(el => { el.addEventListener('pointerdown', () => el.classList.add('dn')); ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => el.addEventListener(t, () => el.classList.remove('dn'))); });   // 新版介面:按下版貼圖用
  // ---- 觸控拖曳轉視角 ----
  const cv = renderer.domElement; let cid = null, cx = 0, cy = 0, tapT = -1e9, tapX = 0, tapY = 0;
  const tps = new Map(); let pinchD = 0;   // 畫面上的觸控點;兩指同時按在畫面 = 雙指縮放(拉近 / 拉遠),縮放時不轉視角
  const tpDist = () => { const a = [...tps.values()]; return a.length >= 2 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0; };
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return; touchNow();
    tps.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tps.size >= 2) { pinchD = tpDist(); cid = null; return; }
    try { document.documentElement.requestFullscreen && !document.fullscreenElement && document.documentElement.requestFullscreen().catch(() => { }); } catch (err) { }
    if (e.clientX < innerWidth * .4) return;   // 左側 40% 留給搖桿,只接受右側 60% 的手指轉視角
    cid = e.pointerId; cx = e.clientX; cy = e.clientY;
    const now = performance.now();   // 雙擊畫面 = 鏡頭轉到背後(間隔 < 250 ms、位移 < 10 px,只在右側)
    if (now - tapT < 250 && Math.hypot(cx - tapX, cy - tapY) < 10) { resetCam(); tapT = -1e9; } else { tapT = now; tapX = cx; tapY = cy; }
  });
  cv.addEventListener('pointermove', e => {
    if (tps.has(e.pointerId)) {
      tps.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (tps.size >= 2 && pinchD > 0) { const d = tpDist(); if (d > 0) { G.zoom = clamp(G.zoom * pinchD / d, .28, 1.9); pinchD = d; } return; }
    }
    if (e.pointerId !== cid) return;
    addLook(-(e.clientX - cx) * CFG.camSens * CFG.touchSens, (e.clientY - cy) * CFG.camSens * CFG.touchSens); cx = e.clientX; cy = e.clientY;
  });
  ['pointerup', 'pointercancel'].forEach(t => cv.addEventListener(t, e => { tps.delete(e.pointerId); pinchD = 0; if (e.pointerId === cid) cid = null; }));

  // ---- 手把 ----
  // 動作 → 標準映射按鈕編號。預設 = 實體位置(0 下 / 1 右 / 2 左 / 3 上,與舊版相同);畫面上的名稱依型號顯示
  const PAD_KEY = 'mageSandbox.pad.v1';
  const PAD_ACTS = [
    { id: 'jump', name: '跳 / 二段跳', def: 0 },
    { id: 'roll', name: '翻滾 / 空中側翻', def: 1 },
    { id: 'weapon', name: '換裝 / 切架勢(集氣中:取消)', def: 3 },
    { id: 'cast', name: '施法(按住集氣、放開施放)', def: 7 },
    { id: 'prev', name: '上一個法術', def: 4 },
    { id: 'next', name: '下一個法術', def: 5 },
    { id: 'cancel', name: '取消集氣 / 取消選法術', def: 6 },
    { id: 'scene', name: '換場景(長按)/ 切職業(短按)', def: 8 },
    { id: 'panel', name: '參數面板', def: 9 },
    { id: 'sit', name: '打坐 / 起身', def: 10 },
    { id: 'cam', name: '鏡頭重置', def: 11 },
    { id: 'mode', name: '集氣模式 A / B', def: 12 },
    { id: 'zoom', name: '縮放循環', def: 13 },
    { id: 'skillL', name: '十字左:法師上一屬性 / 其他職業第 4 格', def: 14 },
    { id: 'skillR', name: '十字右:法師下一屬性 / 其他職業瞬發招', def: 15 }
  ];
  // 各型號在標準映射下的按鈕名稱(索引 0~16 = standard mapping 的實體位置)
  const PAD_LBL = {
    xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', '↑', '↓', '←', '→', 'Xbox'],
    ps: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', '↑', '↓', '←', '→', 'PS'],
    switch: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'LS', 'RS', '↑', '↓', '←', '→', 'Home'],
    gen: null
  };
  const PAD_NAME = { xbox: 'Xbox 控制器', ps: 'PlayStation 控制器', switch: 'Switch Pro 控制器', gen: '通用手把' };
  let padCfg = { bind: {}, rumble: true };
  try { const s = JSON.parse(localStorage.getItem(PAD_KEY)); if (s && typeof s === 'object') { padCfg.rumble = s.rumble !== false; if (s.bind && typeof s.bind === 'object') padCfg.bind = s.bind; } } catch (e) { }
  const padSave = () => { try { localStorage.setItem(PAD_KEY, JSON.stringify(padCfg)); } catch (e) { } };
  const bindOf = id => { const v = padCfg.bind[id]; return Number.isInteger(v) && v >= 0 && v <= 16 ? v : PAD_ACTS.find(a => a.id === id).def; };
  const padFamily = gp => { const s = gp.id || ''; return /054c|dualshock|dualsense|playstation|sony/i.test(s) ? 'ps' : /057e|switch|pro controller|joy-?con|nintendo/i.test(s) ? 'switch' : /045e|xbox|xinput/i.test(s) ? 'xbox' : 'gen'; };
  let padFam = 'xbox', padStd = true, pad = null, padOn = false, minusHold = -1, yHold = -1, padFullT = 0, gPrev = [];   // pad:目前連線的手把;gPrev:遊戲輸入的上一格按鍵狀態
  const labelOf = i => (padStd && PAD_LBL[padFam] && PAD_LBL[padFam][i]) || '#' + i;   // 非標準映射或通用手把:顯示編號
  const confirmIdx = () => padStd && padFam === 'switch' ? 1 : 0;   // 選單確認 = 「A」/「✕」的實體位置(Switch 的 A 在右側)
  const backIdx = () => 1 - confirmIdx();                            // 選單返回 = 「B」/「○」
  const activePad = () => { const gps = navigator.getGamepads ? navigator.getGamepads() : []; for (const g of gps) if (g && g.connected) return g; return null; };

  // 提示小字(手把連線 / 斷線、按鍵提示)
  const msgEl = document.createElement('div'); msgEl.id = 'padMsg'; document.body.appendChild(msgEl);
  let msgT = 0, lost = false;
  function padMsg(txt, warn, ms) {
    msgEl.textContent = txt; msgEl.classList.toggle('warn', !!warn); msgEl.classList.add('on');
    clearTimeout(msgT); if (ms) msgT = setTimeout(() => msgEl.classList.remove('on'), ms);
  }
  const padHintEl = document.createElement('div'); padHintEl.id = 'padHint'; $('hint').appendChild(padHintEl);
  const cvHintEl = document.createElement('div'); cvHintEl.id = 'padCvHint'; $('cvRoot').appendChild(cvHintEl);
  function padHintRefresh() {
    const L = a => labelOf(bindOf(a));
    padHintEl.textContent = pad ? '手把:' + L('cast') + ' 按住集氣 ・ ' + L('weapon') + ' 換裝 / 切架勢 ・ ' + L('jump') + ' 跳 ・ ' + L('roll') + ' 翻滾 ・ ' + L('panel') + ' 面板' : '';
    cvHintEl.textContent = pad ? labelOf(confirmIdx()) + ' 確認 ・ ' + labelOf(backIdx()) + ' 返回 ・ 左搖桿 / 十字移動' : '';
    padHelpRefresh();
  }
  // 連線 / 斷線:斷線時遊戲暫停集氣進度(window.PAD_LOST,game.js updateCasting)並顯示「手把已中斷」
  function syncPad(gp) {
    if (gp) { const fam = padFamily(gp), std = gp.mapping === 'standard'; if (fam !== padFam || std !== padStd) { padFam = fam; padStd = std; padHintRefresh(); } }
    if (!!gp === !!pad) return;
    pad = gp;
    if (gp) { lost = false; window.PAD_LOST = false; padMsg('手把已連線:' + PAD_NAME[padFam] + (padStd ? '' : '(非標準映射,按鍵以編號顯示)'), false, 2800); }
    else if (lost === false) { lost = true; window.PAD_LOST = true; padMsg('手把已中斷(集氣已暫停,請重新連接)', true, 0); document.body.classList.remove('pad'); }
    padHintRefresh();
  }

  // 震動:dual-rumble,低強度短震;不支援或關閉時忽略
  const RUMBLE = { hit: [.3, .4, 150], cast: [.08, .12, 50] };   // [weak, strong, ms]
  function padRumble(kind) {
    const R = RUMBLE[kind], gp = activePad();
    if (!R || !padCfg.rumble || !gp || !gp.vibrationActuator || !gp.vibrationActuator.playEffect) return;
    try { gp.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: R[2], weakMagnitude: R[0], strongMagnitude: R[1] }).catch(() => { }); } catch (e) { }
  }
  window.padRumble = padRumble;

  // ---- 選單模式(封面 / 手把說明 / 結算畫面):D-pad 或左搖桿移動焦點外框,A 確認、B 返回 ----
  let cur = null, menuOn = false, helpFrom = null, listenId = null, mPrev = [], rep = 0, repDir = '', helpRows = [];
  const isTextEl = el => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  function menuRoot() {
    if (document.getElementById('padHelp')) return { el: document.getElementById('padHelp'), kind: 'help' };
    const r = document.getElementById('netResult'); if (r && r.style.display === 'flex') return { el: r, kind: 'result' };
    if (window.COVER_ON) { const v = document.querySelector('#cvRoot .cv-view.on'); if (v) return { el: v, kind: 'cover' }; }
    return null;
  }
  function padItems(root) {
    if (root.id === 'cvV_title') return [document.getElementById('cvEnter')].filter(Boolean);
    return Array.from(root.querySelectorAll('button,input,textarea,select')).filter(el => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility === 'visible');
  }
  function setCur(el) { if (cur === el) return; if (cur) cur.classList.remove('pf'); cur = el || null; if (cur) cur.classList.add('pf'); }
  function menuMove(dir, items) {
    if (!cur) return;
    const c = cur.getBoundingClientRect(), cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    let best = null, bs = 1e9;
    for (const el of items) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect(), dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
      const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      const perp = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (along < 4) continue;
      const s = along + perp * 2;
      if (s < bs) { bs = s; best = el; }
    }
    if (best) setCur(best);
  }
  function padActivate() {
    if (!cur) return;
    if (isTextEl(cur)) { cur.focus({ preventScroll: true }); padMsg('文字輸入請用鍵盤或螢幕鍵盤,按 ' + labelOf(backIdx()) + ' 結束輸入', false, 2600); return; }
    cur.click();
  }
  function padBack(m) {
    if (isTextEl(document.activeElement)) { document.activeElement.blur(); return; }
    if (m.kind === 'help') { padCloseHelp(); return; }
    if (m.kind !== 'cover') return;
    const id = m.el.id;
    if (id === 'cvV_create' || id === 'cvV_join') { const b = m.el.querySelector('[data-back]'); if (b) b.click(); }
    else if (id === 'cvV_closed') { const b = document.getElementById('cvNoticeOk'); if (b) b.click(); }
    else if (id === 'cvV_lobby') padMsg('離開房間請選「離開房間」按鈕', false, 2200);
  }
  function padBindTo(act, idx) {
    const old = bindOf(act);
    for (const a of PAD_ACTS) if (a.id !== act && bindOf(a.id) === idx) padCfg.bind[a.id] = old;   // 同鍵已綁其他動作:互換
    padCfg.bind[act] = idx; padSave(); padHintRefresh();
  }
  function startListen(act) {
    if (!pad) { padMsg('請先連接手把', true, 2200); return; }
    listenId = act; padHelpRefresh();
  }

  // P 面板 / 封面的「手把按鍵說明」小視窗:目前對應、重新綁定、震動、還原預設
  function padOpenHelp() {
    if (document.getElementById('padHelp')) return;
    if (document.pointerLockElement) document.exitPointerLock();
    helpFrom = cur;
    const o = document.createElement('div'); o.id = 'padHelp'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-label', '手把按鍵說明');
    o.innerHTML = '<div class="ph-box"><div class="ph-title">手把按鍵說明</div><div class="ph-sub" id="phSub"></div><div id="phList"></div>' +
      '<div class="ph-row"><span>震動(受擊 / 施法)</span><button class="ph-btn" type="button" data-ph="rumble"></button></div>' +
      '<div class="ph-row" style="justify-content:flex-end;border:0"><button class="ph-btn" type="button" data-ph="reset">還原預設</button><button class="ph-btn" type="button" data-ph="close">關閉</button></div>' +
      '<div class="ph-note" id="phNote"></div></div>';
    const list = o.querySelector('#phList'); helpRows = [];
    PAD_ACTS.forEach(a => {
      const row = document.createElement('div'); row.className = 'ph-row';
      const nm = document.createElement('span'); nm.textContent = a.name;
      const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'ph-btn'; bt.dataset.act = a.id;
      row.appendChild(nm); row.appendChild(bt); list.appendChild(row); helpRows.push(bt);
    });
    o.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.act) startListen(t.dataset.act);
      else if (t.dataset.ph === 'rumble') { padCfg.rumble = !padCfg.rumble; padSave(); padHelpRefresh(); }
      else if (t.dataset.ph === 'reset') { padCfg = { bind: {}, rumble: true }; padSave(); padHintRefresh(); }
      else if (t.dataset.ph === 'close') padCloseHelp();
    });
    document.body.appendChild(o);
    padHelpRefresh();
    setCur(o.querySelector('.ph-btn'));
  }
  function padHelpRefresh() {
    const o = document.getElementById('padHelp'); if (!o) return;
    o.querySelector('#phSub').textContent = pad ? PAD_NAME[padFam] + (padStd ? '' : ' ・ 非標準映射,按鍵以編號顯示') : '未偵測到手把,以下為預設名稱';
    helpRows.forEach(bt => { const id = bt.dataset.act, on = listenId === id; bt.textContent = on ? '按下按鈕…' : labelOf(bindOf(id)); bt.classList.toggle('on', on); });
    o.querySelector('[data-ph=rumble]').textContent = '震動:' + (padCfg.rumble ? '開' : '關');
    o.querySelector('#phNote').textContent = (listenId ? '按下要綁定的按鈕,' + labelOf(backIdx()) + ' 取消。' : '點「改」後按下要綁定的按鈕。') + ' 選單:' + labelOf(confirmIdx()) + ' 確認、' + labelOf(backIdx()) + ' 返回;文字輸入請用鍵盤或螢幕鍵盤。';
  }
  function padCloseHelp() {
    const o = document.getElementById('padHelp'); if (!o) return;
    o.remove(); helpRows = []; listenId = null;
    setCur(helpFrom && helpFrom.isConnected ? helpFrom : null); helpFrom = null;
    padHintRefresh();
  }

  // 選單輪詢(每個畫面影格都跑,不依賴遊戲迴圈;結算畫面因 NET_LOCK 不呼叫 inputTick 時也能操作)
  function menuLoop() {
    requestAnimationFrame(menuLoop);
    const gp = activePad(), now = performance.now();
    syncPad(gp);
    const m = menuRoot(), on = !!m;
    if (on !== menuOn) {
      menuOn = on; document.body.classList.toggle('padmenu', on);
      if (!on) { setCur(null); listenId = null; if (isTextEl(document.activeElement)) document.activeElement.blur(); }
    }
    if (!gp) { mPrev = []; gPrev = []; repDir = ''; return; }
    const bs = gp.buttons.map(x => !!(x && x.pressed));
    const gameRuns = !on && !(window.NETON && window.NET_LOCK);
    if (!gameRuns) gPrev = bs;   // 遊戲輸入這一格不會執行:同步按鍵狀態,避免恢復時誤判成按下
    if (bs.some(Boolean) && on) document.body.classList.add('pad');
    if (on) {
      const e = i => bs[i] && !mPrev[i];
      if (listenId) {
        for (let i = 0; i < 17; i++) if (e(i)) { if (i !== backIdx()) padBindTo(listenId, i); listenId = null; padHelpRefresh(); break; }
      } else {
        const items = padItems(m.el), ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
        if (!cur || items.indexOf(cur) < 0) setCur(items[0] || null);
        const d = bs[12] || ay < -.5 ? 'up' : bs[13] || ay > .5 ? 'down' : bs[14] || ax < -.5 ? 'left' : bs[15] || ax > .5 ? 'right' : '';
        if (!d) repDir = '';
        else if (d !== repDir) { repDir = d; rep = now + 380; menuMove(d, items); }
        else if (now >= rep) { rep = now + 160; menuMove(d, items); }
        if (e(confirmIdx())) padActivate();
        else if (e(backIdx())) padBack(m);
      }
    }
    mPrev = bs;
  }
  menuLoop();

  // 手把面板列(game.js buildPanel 呼叫;載入時也會直接加到 P 面板)
  window.padPanelExtra = function (root) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = '手把按鍵說明 / 自訂';
    b.onclick = padOpenHelp; root.appendChild(b);
  };
  window.padPanelExtra(document.getElementById('panel'));
  { const cvMenu = document.querySelector('#cvV_menu .cv-menu');
    if (cvMenu) { const b = document.createElement('button'); b.type = 'button'; b.className = 'cv-link'; b.id = 'cvPadHelp'; b.textContent = '手把按鍵'; b.onclick = padOpenHelp; cvMenu.appendChild(b); } }
  window.addEventListener('keydown', e => { if (e.code === 'Escape' && document.getElementById('padHelp')) padCloseHelp(); });
  padHintRefresh();

  // 遊戲內輸入(frame 呼叫 inputTick;封面 / 選單 / 多人開戰倒數時不執行)
  window.inputTick = function (dt) {
    if (window.COVER_ON || menuRoot()) return;
    const gp = activePad(); if (!gp) return;
    const bs = gp.buttons.map(x => !!(x && x.pressed));
    const dz = v => Math.abs(v) > .18 ? v : 0, ax = i => dz(gp.axes[i] || 0), b = i => bs[i] === true;
    const edge = i => b(i) && !gPrev[i], K = id => bindOf(id);
    const lx = ax(0), ly = ax(1), rx = ax(2), ry = ax(3);
    const any = lx || ly || rx || ry || bs.some(Boolean);
    if (any) { G.inputMode = 'stick'; padOn = true; document.body.classList.add('pad'); }   // 手把操作時隱藏觸控鈕
    if (padOn) { G.stick.x = lx; G.stick.y = ly; G.stick.mag = Math.min(1, Math.hypot(lx, ly)); }
    // 右搖桿視角:圓形死區 .15 + 曲線 ((m-.15)/.85)^1.8;推到 > .92 持續 .3 s 後偏航 ×1.5(設計 §2-7)
    const rxr = gp.axes[2] || 0, ryr = gp.axes[3] || 0, rm = Math.hypot(rxr, ryr);
    const rf = rm > .15 ? Math.pow(Math.min(1, (rm - .15) / .85), 1.8) : 0, rux = rm ? rxr / rm : 0, ruy = rm ? ryr / rm : 0;
    padFullT = rm > .92 ? padFullT + dt : 0;
    const padYaw = -rux * rf * 3.2 * CFG.padSens * (padFullT > .3 ? 1.5 : 1) * dt, padPitch = ruy * rf * 1.8 * CFG.padSens * dt;
    if (G.state === 'charging' && G.skill >= 0) {           // 集氣中:右搖桿上下 = 調範圍;選牆時左右 = 旋轉火牆,其他招式左右 = 轉鏡頭
      const c = sc(G.skill); setRad(G.skill, clamp(getRad(G.skill) - ry * dt * (c.rMax - c.rMin) * .7, c.rMin, c.rMax));
      if (curSkill(G.skill).shape === 'wall') G.wallOff -= rx * dt * 2.2; else addLook(padYaw, 0);
    } else addLook(padYaw, padPitch);
    // 施法鍵(預設 ZR / RT)按住集氣、放開施放(按住狀態 G.atkHeld 供僵直結束後接續集氣)
    const cast = K('cast');
    G.atkHeld = b(cast);
    if (edge(cast)) startCharge();
    if (!b(cast) && gPrev[cast] && G.state === 'charging') { if (G.chargeT < CFG.minHold) G.queued = true; else release(); }
    if (edge(K('jump'))) doJump();                           // 跳 / 二段跳
    if (edge(K('roll'))) tryRoll();                          // 翻滾 / 空中側翻
    if (edge(K('weapon'))) { if (G.state === 'charging') cancelCharge(); else toggleWeapon(); }   // 換裝 / 架勢;集氣中為取消
    if (edge(K('prev'))) cycleSkill(-1);
    if (edge(K('next'))) cycleSkill(1);
    if (edge(K('cancel'))) { if (G.state === 'charging') cancelCharge(); else if (G.state === 'ready') G.skill = -1; }
    const scn = K('scene');                                  // 換場景:長按 0.6 s;短按 = 切職業
    if (edge(scn)) minusHold = 0;
    if (minusHold >= 0 && b(scn)) { minusHold += dt; if (minusHold >= .6) { minusHold = -2; nextScene(); } }
    if (gPrev[scn] && !b(scn)) { if (minusHold >= 0) cycleClass(1); minusHold = -1; }
    if (edge(K('panel'))) document.getElementById('panel').classList.toggle('on');
    if (edge(K('sit'))) toggleSit();
    if (edge(K('cam'))) resetCam();
    if (edge(K('mode'))) toggleChgMode();
    if (edge(K('zoom'))) { const ZS = [1, .8, .3, 1.3]; G.zoom = ZS[(ZS.findIndex(z => Math.abs(z - G.zoom) < .01) + 1) % 4]; }   // 縮放循環 1.0 → 0.8 → 0.3(近距離)→ 1.3
    if (edge(K('skillL'))) { if (G.cls === 'mage') cycleElement(-1); else selectSkill(3); }
    if (edge(K('skillR'))) { if (G.cls === 'mage') cycleElement(1); else { const k = instantSlot(); if (k >= 0) selectSkill(k); } }
    gPrev = bs;
  };
})();
