'use strict';
// 封面 / 創建房間 / 進入房間 / 等待大廳 UI,以及假網路 Net(stub)
// 依賴:game.js 的 G、resetCam、setScene(scenes.js)、setClass、setElement(classes.js / game.js)、QR(qr.js)
// window.Net 介面(真實網路實作可整個覆寫,方法回傳 Promise,事件用 Net.on 註冊):
//   createRoom({name, scene, maxPlayers, password|null, cls, el}) → {code, link, host, me:{id,name}, scene, maxPlayers, hasPassword}
//   joinRoom(code, {name, password, cls, el}) → {code, me:{id,name}, scene, maxPlayers, hasPassword}
//     失敗 reject {reason:'notfound'|'password'|'full'|'closed', needPassword?, wrong?}
//   leave(), setProfile({cls, el, ready}), startGame()(僅房主;人數不足 reject)
//   事件:'players'([{id,name,cls,el,ready,host}])、'start'({scene, players, seed})、
//         'closed'({reason:'idle'|'hostleft'|'kicked'})、'idleCountdown'({secondsLeft}|null 表示不顯示)
(function () {
  const $ = id => document.getElementById(id);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

  const CLS = [['mage', '法師'], ['archer', '弓箭手'], ['swordsman', '劍士'], ['assassin', '刺客']];
  const CLS_NAME = Object.fromEntries(CLS);
  const EL = [['water', '水'], ['fire', '火'], ['wind', '風'], ['earth', '土'], ['light', '光'], ['dark', '暗']];
  const EL_NAME = Object.fromEntries(EL);
  const SCENE_INFO = [
    { name: '月夜訓練場', cls: 'sc-night' }, { name: '羅馬競技場', cls: 'sc-rome' },
    { name: '宮廷訓練場', cls: 'sc-hall' }, { name: '非洲叢林', cls: 'sc-jungle' }
  ];
  const ROOM_ERR = { notfound: '找不到這個房號', full: '房間已滿', closed: '房間已關閉或已開始遊戲' };
  const CLOSE_MSG = { idle: '超過 5 分鐘都沒有人加入,房間已自動關閉', hostleft: '房主已離開,房間已關閉', kicked: '你已被移出房間' };
  const RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
  const clean = s => String(s == null ? '' : s).trim().slice(0, 8) || '玩家';
  const chars = s => [...String(s || '')].length;

  /* ================= 假網路 Net(localStorage 共享,同一台電腦開兩個分頁即可互見) ================= */
  const NET_KEY = 'mageSandbox.net.rooms';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 避開 0 O 1 I
  const listeners = {};
  const myId = Math.random().toString(36).slice(2, 10);
  let myRoom = null;          // 本分頁所在房號
  let lastPlayersKey = '', lastStartedAt = 0, lastCountdown = undefined;
  const now = () => Date.now();

  function readRooms() { try { return JSON.parse(localStorage.getItem(NET_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function writeRooms(r) { try { localStorage.setItem(NET_KEY, JSON.stringify(r)); } catch (e) { } }
  function emit(ev, data) { (listeners[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }
  const linkOf = code => location.origin + location.pathname + '?room=' + code;
  const playersOf = r => r.players.map(p => Object.assign({}, p, { host: p.id === r.hostId }));
  const mkPlayer = (name, cls, el) => ({
    id: myId, name, cls: CLS_NAME[cls] ? cls : 'mage', el: EL_NAME[el] ? el : 'fire', ready: false
  });
  // 只有房主一人時開始計時;有人加入即清除;reset 為 true 時(有人離開)重新計時
  function syncIdle(r, t, reset) {
    if (r.status !== 'open' || r.closed) return;
    if (r.players.length > 1) r.idleSince = 0;
    else if (reset || !r.idleSince) r.idleSince = t;
  }
  function commit(rooms) { writeRooms(rooms); refresh(); }
  // 離開或房間關閉時清除本分頁的去重狀態,下次進房才會正確發出事件
  function resetLocal() { myRoom = null; lastPlayersKey = ''; lastStartedAt = 0; lastCountdown = undefined; }

  // 讀取本分頁所在房間,依變化發出 players / start / closed / idleCountdown
  function refresh() {
    if (!myRoom) return;
    const rooms = readRooms(), r = rooms[myRoom];
    if (!r || r.closed) {
      const reason = r ? r.closed : 'hostleft';
      resetLocal();
      emit('closed', { reason });
      return;
    }
    if (r.status === 'playing' && r.startedAt && r.startedAt !== lastStartedAt) {
      lastStartedAt = r.startedAt;
      emit('start', { scene: r.scene, players: playersOf(r), seed: r.seed });
    }
    const pl = playersOf(r), key = JSON.stringify(pl);
    if (key !== lastPlayersKey) { lastPlayersKey = key; emit('players', pl); }
    const left = (r.status === 'open' && r.idleSince && pl.length === 1)
      ? Math.max(0, Math.ceil((r.idleSince + Net.idleMs - now()) / 1000)) : null;
    if (left !== lastCountdown) { lastCountdown = left; emit('idleCountdown', { secondsLeft: left }); }
  }
  // 掃描所有房間:房主獨自超過 idleMs 即關閉;已關閉的房間保留 10 秒後刪除
  function sweep() {
    const rooms = readRooms(), t = now();
    let changed = false;
    Object.keys(rooms).forEach(code => {
      const r = rooms[code];
      if (r.closed) { if (t - r.closedAt > 10000) { delete rooms[code]; changed = true; } return; }
      if (r.status === 'open' && r.idleSince && r.players.length <= 1 && t - r.idleSince >= Net.idleMs) {
        r.closed = 'idle'; r.closedAt = t; changed = true;
      }
    });
    if (changed) writeRooms(rooms);
  }
  function leaveNow() {
    const code = myRoom;
    resetLocal();
    if (!code) return;
    const rooms = readRooms(), r = rooms[code];
    if (!r) return;
    if (r.hostId === myId) { if (!r.closed) { r.closed = 'hostleft'; r.closedAt = now(); } }
    else { r.players = r.players.filter(p => p.id !== myId); syncIdle(r, now(), true); }
    writeRooms(rooms);
  }

  const Net = {
    stub: true,
    idleMs: 5 * 60 * 1000,
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    createRoom(opt) {
      return new Promise(resolve => {
        leaveNow();
        const rooms = readRooms();
        let code;
        do { code = ''; for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; } while (rooms[code]);
        const max = (+opt.maxPlayers >= 2 && +opt.maxPlayers <= 12) ? Math.round(+opt.maxPlayers) : 6;
        const name = clean(opt.name), t = now();
        rooms[code] = {
          code, scene: (opt.scene | 0), max, password: opt.password || null, hostId: myId,
          status: 'open', closed: null, closedAt: 0, startedAt: 0, seed: 0, idleSince: t,
          players: [mkPlayer(name, opt.cls || (window.G && G.cls), opt.el || (window.G && G.el))]
        };
        myRoom = code;
        commit(rooms);
        resolve({ code, link: linkOf(code), host: true, me: { id: myId, name }, scene: rooms[code].scene, maxPlayers: max, hasPassword: !!opt.password });
      });
    },
    joinRoom(code, opt) {
      return new Promise((resolve, reject) => {
        code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const r0 = readRooms()[code];
        if (!r0) return reject({ reason: 'notfound' });
        if (r0.closed || r0.status !== 'open') return reject({ reason: 'closed' });
        if (r0.password) {
          if (!opt || !opt.password) return reject({ reason: 'password', needPassword: true });
          if (opt.password !== r0.password) return reject({ reason: 'password', needPassword: true, wrong: true });
        }
        if (r0.players.length >= r0.max) return reject({ reason: 'full' });
        if (myRoom && myRoom !== code) leaveNow();   // 先離開舊房間,再重新讀取以免覆寫
        const rooms = readRooms(), r = rooms[code];
        if (!r || r.closed || r.status !== 'open') return reject({ reason: r ? 'closed' : 'notfound' });
        const name = clean(opt && opt.name), t = now();
        r.players.push(mkPlayer(name, opt && opt.cls, opt && opt.el));
        syncIdle(r, t, false);
        myRoom = code;
        commit(rooms);
        resolve({ code, me: { id: myId, name }, scene: r.scene, maxPlayers: r.max, hasPassword: !!r.password });
      });
    },
    leave() { return new Promise(resolve => { leaveNow(); refresh(); resolve(); }); },
    setProfile(p) {
      return new Promise(resolve => {
        const rooms = readRooms(), r = myRoom && rooms[myRoom];
        const me = r && r.players.find(x => x.id === myId);
        if (me) {
          if (p && CLS_NAME[p.cls]) me.cls = p.cls;
          if (p && EL_NAME[p.el]) me.el = p.el;
          if (p && typeof p.ready === 'boolean') me.ready = p.ready;
          commit(rooms);
        }
        resolve();
      });
    },
    startGame() {
      return new Promise((resolve, reject) => {
        const rooms = readRooms(), r = myRoom && rooms[myRoom];
        if (!r || r.hostId !== myId) return reject({ reason: 'notHost' });
        if (r.players.length < 2) return reject({ reason: 'notEnough' });
        r.status = 'playing'; r.startedAt = now(); r.seed = Math.floor(Math.random() * 2147483647); r.idleSince = 0;
        commit(rooms);
        resolve();
      });
    }
  };
  window.Net = Net;
  window.addEventListener('storage', e => { if (e.key === NET_KEY) refresh(); });
  window.addEventListener('pagehide', () => leaveNow());
  setInterval(() => { sweep(); refresh(); }, 1000);

  /* ================= 封面 UI ================= */
  const SOLO = /[?&]solo=1/.test(location.search);
  const roomQ = (() => { const m = /[?&]room=([^&#]*)/.exec(location.search); return m ? decodeURIComponent(m[1]).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) : ''; })();
  const prevScene = (() => { const q = /[?&]scene=(\d)/.exec(location.search); return q ? +q[1] : (+lsGet('mageSandbox.scene') || 0); })();

  if (SOLO) {   // 單人練習直接進遊戲,不顯示封面
    window.COVER_ON = false;
    if (typeof DUMMIES !== 'undefined') DUMMIES.forEach(d => { d.g.visible = !d.dead; });
    document.body.classList.remove('cover');
    const r0 = $('cvRoot'); if (r0) r0.remove();
    return;
  }

  const root = $('cvRoot');
  const st = {
    view: 'title', cls: 'mage', el: (window.G && G.el) || 'fire', ready: false, room: null, isHost: false, myId: null,
    max: 6, hasPassword: false, sceneIdx: 1, players: [], link: '', createScene: 1, createMax: 6, createPw: false
  };
  if (CLS_NAME[lsGet('mageSandbox.cls')]) st.cls = lsGet('mageSandbox.cls');

  /* 粒子(2D canvas,顯示時才跑) */
  const fxc = $('cvFx'), fc = fxc.getContext('2d');
  const PCOL = ['#ffd27a', '#ffb24a', '#7fd0ff', '#e8ecf6', '#ffe3b0'];
  let W = 0, H = 0, parts = [];
  const spawn = init => ({
    x: Math.random() * W, y: init ? Math.random() * H : H + 12, r: 0.6 + Math.random() * 1.9,
    vy: (8 + Math.random() * 20) * (RM ? 0.4 : 1), sw: Math.random() * 6.28, sp: 0.4 + Math.random() * 0.8,
    ph: Math.random() * 6.28, c: PCOL[(Math.random() * PCOL.length) | 0]
  });
  function sizeFx() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    fxc.width = Math.round(W * dpr); fxc.height = Math.round(H * dpr);
    fc.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cnt = RM ? 12 : (IS_TOUCH || W < 760 ? 24 : 50);
    parts = Array.from({ length: cnt }, () => spawn(true));
  }
  function drawFx(t, dt) {
    fc.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.y -= p.vy * dt; p.sw += dt * p.sp; p.x += Math.sin(p.sw) * 10 * dt;
      if (p.y < -10) Object.assign(p, spawn(false));
      fc.globalAlpha = 0.3 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.0021 * p.sp + p.ph));
      fc.fillStyle = p.c;
      fc.beginPath(); fc.arc(p.x, p.y, p.r, 0, 6.2832); fc.fill();
    }
    fc.globalAlpha = 1;
  }

  /* 封面 3D 背景迴圈:鏡頭緩慢環繞角色 */
  let coverOn = false, raf = 0, lastT = 0;
  function loop(t) {
    if (!coverOn) return;
    const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000)); lastT = t;
    G.camYaw += dt * (RM ? 0.04 : 0.12);
    G.camPitch = 0.24; G.zoom = 1.35; G.skill = -1;
    drawFx(t, dt);
    raf = requestAnimationFrame(loop);
  }
  function startCover() {
    if (coverOn) return;
    coverOn = true; window.COVER_ON = true;
    if (typeof DUMMIES !== 'undefined') DUMMIES.forEach(d => { d.g.visible = false; if (d.bar) d.bar.visible = false; });   // 封面背景不要稻草人
    root.classList.remove('gone');
    sizeFx(); lastT = performance.now(); raf = requestAnimationFrame(loop);
  }
  function stopCover() {
    coverOn = false; cancelAnimationFrame(raf);
    window.COVER_ON = false;
    document.body.classList.remove('cover');
    root.classList.add('gone');
    if (G.skill < 0) G.skill = G.lastSkill || 0;
    resetCam();
  }

  /* 視圖切換 */
  const VIEWS = ['title', 'menu', 'create', 'join', 'lobby', 'closed'];
  function setView(v) {
    st.view = v;
    VIEWS.forEach(n => {
      const s = $('cvV_' + n), on = n === v;
      s.classList.toggle('on', on);
      s.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    root.classList.toggle('is-title', v === 'title');
    root.classList.toggle('is-small', v !== 'title');
  }
  const focusSoon = id => setTimeout(() => { const e = $(id); if (e) e.focus({ preventScroll: true }); }, 480);
  function showErr(el, msg) {
    el.textContent = msg || '';
    el.classList.remove('shake'); if (msg) { void el.offsetWidth; el.classList.add('shake'); }
  }

  /* 場地卡片 */
  const sceneBox = $('cvScenes');
  SCENE_INFO.forEach((s, i) => {
    const b = mk('button', 'cv-scene ' + s.cls);
    b.type = 'button'; b.setAttribute('aria-pressed', 'false');
    b.appendChild(mk('span', null, s.name));
    b.onclick = () => { st.createScene = i; renderCreate(); };
    sceneBox.appendChild(b);
  });
  /* 人數 */
  document.querySelectorAll('#cvMax button').forEach(b => {
    b.onclick = () => { st.createMax = +b.dataset.n; renderCreate(); };
  });
  function renderCreate() {
    [...sceneBox.children].forEach((b, i) => { b.classList.toggle('on', i === st.createScene); b.setAttribute('aria-pressed', i === st.createScene ? 'true' : 'false'); });
    document.querySelectorAll('#cvMax button').forEach(b => { const on = +b.dataset.n === st.createMax; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const sw = $('cvPwSwitch');
    sw.setAttribute('aria-checked', st.createPw ? 'true' : 'false');
    $('cvPwBox').classList.toggle('on', st.createPw);
  }
  function openCreate() {
    $('cvCName').value = '玩家' + (1000 + Math.floor(Math.random() * 9000));
    $('cvPw').value = ''; $('cvPw').type = 'password'; $('cvPwEye').textContent = '顯示';
    st.createPw = false; showErr($('cvCErr'), '');
    renderCreate(); setView('create'); focusSoon('cvCName');
  }
  $('cvPwSwitch').onclick = () => { st.createPw = !st.createPw; renderCreate(); if (st.createPw) focusSoon('cvPw'); };
  $('cvPwEye').onclick = () => {
    const p = $('cvPw'), show = p.type === 'password';
    p.type = show ? 'text' : 'password'; $('cvPwEye').textContent = show ? '隱藏' : '顯示';
  };
  function doCreate() {
    const pw = $('cvPw').value;
    if (st.createPw && (chars(pw) < 4 || chars(pw) > 8)) return showErr($('cvCErr'), '密碼請輸入 4~8 個字');
    showErr($('cvCErr'), '');
    Net.createRoom({
      name: $('cvCName').value, scene: st.createScene, maxPlayers: st.createMax,
      password: st.createPw ? pw : null, cls: st.cls, el: st.el
    }).then(res => enterLobby(res)).catch(() => showErr($('cvCErr'), '建立房間失敗,請再試一次'));
  }
  $('cvCreateGo').onclick = doCreate;
  $('cvCName').addEventListener('keydown', e => { if (e.key === 'Enter') doCreate(); });
  $('cvPw').addEventListener('keydown', e => { if (e.key === 'Enter') doCreate(); });

  /* 進入房間 */
  const joinCode = $('cvJCode');
  joinCode.addEventListener('input', () => {
    const v = joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (joinCode.value !== v) joinCode.value = v;
  });
  function setJoinStep2(on) { $('cvJStep2').classList.toggle('on', on); }
  function openJoin(code) {
    joinCode.value = code || ''; $('cvJName').value = $('cvJName').value || ('玩家' + (1000 + Math.floor(Math.random() * 9000)));
    $('cvJPw').value = ''; setJoinStep2(false); showErr($('cvJErr'), '');
    setView('join'); focusSoon(code ? 'cvJName' : 'cvJCode');
  }
  function doJoin() {
    const code = joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 4) return showErr($('cvJErr'), '房號為 4 碼');
    const step2 = $('cvJStep2').classList.contains('on'), pw = $('cvJPw').value;
    if (step2 && !pw) return showErr($('cvJErr'), '請輸入房間密碼');
    showErr($('cvJErr'), '');
    Net.joinRoom(code, { name: $('cvJName').value, password: step2 ? pw : null, cls: st.cls, el: st.el })
      .then(res => enterLobby(res))
      .catch(e => {
        const reason = e && e.reason;
        if (reason === 'password') {
          setJoinStep2(true);
          showErr($('cvJErr'), e.wrong ? '密碼錯誤' : '此房間需要密碼');
          focusSoon('cvJPw');
          return;
        }
        showErr($('cvJErr'), ROOM_ERR[reason] || '加入失敗,請再試一次');
      });
  }
  $('cvJoinGo').onclick = doJoin;
  joinCode.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
  $('cvJName').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
  $('cvJPw').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });

  /* 等待大廳 */
  function drawQR(text) {
    const box = $('cvQR'); box.textContent = '';
    let m;
    try { m = QR.matrix(text); } catch (e) { box.appendChild(mk('div', 'cv-qrfail', '連結過長,請直接複製連結')); return; }
    const n = m.length, q = 4, S = n + q * 2;
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += 'M' + (x + q) + ' ' + (y + q) + 'h1v1h-1z';
    const s = svgEl('svg', { viewBox: '0 0 ' + S + ' ' + S, role: 'img', 'aria-label': 'QR Code 房間連結', 'shape-rendering': 'crispEdges', class: 'cv-qrsvg' });
    s.appendChild(svgEl('rect', { x: 0, y: 0, width: S, height: S, fill: '#ffffff' }));
    s.appendChild(svgEl('path', { d, fill: '#0b0f22' }));
    box.appendChild(s);
  }
  function crownSVG() {
    const s = svgEl('svg', { viewBox: '0 0 20 14', class: 'cv-crown', 'aria-label': '房主' });
    s.appendChild(svgEl('path', { d: 'M1 13 L3 3 L7 8 L10 1 L13 8 L17 3 L19 13 Z', fill: '#ffd27a' }));
    return s;
  }
  function enterLobby(res) {
    st.room = res.code; st.isHost = !!res.host; st.myId = res.me.id;
    st.max = res.maxPlayers || 4; st.hasPassword = !!res.hasPassword; st.sceneIdx = res.scene | 0;
    st.ready = false; st.link = linkOf(res.code);
    $('cvRoomCode').textContent = res.code;
    $('cvLock').hidden = !st.hasPassword;
    $('cvSceneName').textContent = SCENE_INFO[st.sceneIdx] ? '場地:' + SCENE_INFO[st.sceneIdx].name : '';
    $('cvStart').hidden = !st.isHost;
    $('cvIdle').hidden = true;
    $('cvCopy').textContent = '複製連結';
    drawQR(st.link);
    Net.setProfile({ cls: st.cls, el: st.el, ready: false });
    renderReady(); renderSelect(); renderPlayers(st.players);
    setView('lobby');
  }
  function renderPlayers(list) {
    st.players = list;
    const box = $('cvPlayers'); box.textContent = '';
    box.className = 'cv-players' + (st.max > 6 ? ' many' : '');
    for (let i = 0; i < Math.max(st.max, list.length, 1); i++) {
      const p = list[i];
      const slot = mk('div', 'cv-slot' + (p ? (p.ready ? ' rdy' : '') : ' empty'));
      if (!p && i >= st.max) slot.hidden = true;
      if (!p) { slot.appendChild(mk('div', 'cv-av cv-av-empty', '+')); slot.appendChild(mk('div', 'cv-pname', '空位')); }
      else {
        const av = mk('div', 'cv-av');
        const img = new Image(); img.src = 'assets/icons/cls_' + p.cls + '.png'; img.alt = ''; av.appendChild(img);
        const info = mk('div', 'cv-pinfo');
        const nm = mk('div', 'cv-pname');
        if (p.host) nm.appendChild(crownSVG());
        nm.appendChild(document.createTextNode(p.name + (p.id === st.myId ? '(我)' : '')));
        const sub = mk('div', 'cv-psub', CLS_NAME[p.cls] + (p.cls === 'mage' ? '・' + EL_NAME[p.el] : '') + '・' + (p.ready ? '已準備' : '未準備'));
        info.appendChild(nm); info.appendChild(sub);
        slot.appendChild(av); slot.appendChild(info);
      }
      box.appendChild(slot);
    }
    const n = list.length;
    $('cvStart').disabled = n < 2;
    $('cvStartHint').textContent = st.isHost && n < 2 ? '至少 2 人才能開始遊戲' : '';
  }
  function renderSelect() {
    [...$('cvCls').children].forEach(b => { const on = b.dataset.id === st.cls; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    [...$('cvEl').children].forEach(b => { const on = b.dataset.id === st.el; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    $('cvElWrap').hidden = st.cls !== 'mage';
  }
  function renderReady() {
    $('cvReady').textContent = st.ready ? '取消準備' : '準備';
    $('cvReady').classList.toggle('cv-primary', st.ready);
  }
  CLS.forEach(([id, name]) => {
    const b = mk('button', 'cv-pick-btn');
    b.type = 'button'; b.dataset.id = id; b.title = name; b.setAttribute('aria-label', name);
    const img = new Image(); img.src = 'assets/icons/cls_' + id + '.png'; img.alt = '';
    b.appendChild(img); b.appendChild(mk('span', null, name));
    b.onclick = () => { st.cls = id; lsSet('mageSandbox.cls', id); Net.setProfile({ cls: id }); renderSelect(); };
    $('cvCls').appendChild(b);
  });
  EL.forEach(([id, name]) => {
    const b = mk('button', 'cv-el-btn');
    b.type = 'button'; b.dataset.id = id; b.title = name + '屬性'; b.setAttribute('aria-label', name + '屬性');
    const img = new Image(); img.src = 'assets/icons/el_' + id + '.png'; img.alt = '';
    b.appendChild(img);
    b.onclick = () => { st.el = id; Net.setProfile({ el: id }); renderSelect(); };
    $('cvEl').appendChild(b);
  });
  $('cvReady').onclick = () => { st.ready = !st.ready; renderReady(); Net.setProfile({ ready: st.ready }); };
  $('cvStart').onclick = () => { Net.startGame().catch(() => { $('cvStartHint').textContent = '需要至少 2 人才能開始'; }); };
  $('cvLeave').onclick = () => { Net.leave().then(() => { st.room = null; setView('menu'); }); };
  $('cvCopy').onclick = () => {
    const btn = $('cvCopy'), done = () => { btn.textContent = '已複製'; setTimeout(() => { btn.textContent = '複製連結'; }, 1600); };
    const fallback = () => {
      const ta = mk('textarea'); ta.value = st.link; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = st.link; }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(st.link).then(done, fallback);
    else fallback();
  };

  Net.on('players', renderPlayers);
  Net.on('idleCountdown', ev => {
    const el = $('cvIdle');
    if (!ev || ev.secondsLeft == null || !st.isHost) { el.hidden = true; return; }
    const s = ev.secondsLeft, mm = String(Math.floor(s / 60)).padStart(2, '0'), ss = String(s % 60).padStart(2, '0');
    $('cvIdleTime').textContent = mm + ':' + ss;
    el.hidden = false;
  });
  Net.on('closed', ev => {
    st.room = null; st.players = [];
    $('cvNoticeP').textContent = CLOSE_MSG[ev && ev.reason] || '房間已關閉';
    setView('closed');
  });
  Net.on('start', ev => enterGame(ev.scene));
  $('cvNoticeOk').onclick = () => setView('menu');

  /* 進入遊戲:套用場地、職業、屬性,收起封面 */
  function enterGame(sceneIdx) {
    stopCover();
    setScene(sceneIdx, true);
    setClass(st.cls);
    if (st.cls === 'mage') setElement(st.el);
  }
  function enterSolo() {
    stopCover();
    setScene(prevScene, true);
  }

  /* 按鈕與事件 */
  root.addEventListener('click', () => { if (st.view === 'title') setView('menu'); });
  $('cvBtnCreate').onclick = openCreate;
  $('cvBtnJoin').onclick = () => openJoin('');
  $('cvBtnSolo').onclick = e => { e.stopPropagation(); enterSolo(); };
  root.querySelectorAll('[data-back]').forEach(b => { b.onclick = e => { e.stopPropagation(); setView('menu'); }; });
  window.addEventListener('keydown', e => {
    if (!window.COVER_ON) return;
    if (st.view === 'title' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); setView('menu'); }
    else if (e.code === 'Escape' && (st.view === 'create' || st.view === 'join')) setView('menu');
  });
  window.addEventListener('resize', () => { if (coverOn) sizeFx(); });

  /* 開場 */
  renderCreate();
  renderSelect();
  setScene(1, true);
  startCover();
  if (roomQ) { setView('join'); openJoin(roomQ); } else setView('title');
  window.COVER_API = { enterGame, enterSolo };
})();
