'use strict';
// 多人連線:房間管理與大廳介面 window.Net,以及房間匯流排 RoomBus / BcBus(同一台電腦多分頁)/ FirebaseBus(N8:REST + SSE)
// 載入順序:netcfg.js → net.js → qr.js → cover.js(cover.js 只使用 window.Net)
// window.Net(方法回傳 Promise):
//   createRoom({name, scene, maxPlayers, password|null, cls, el}) → {code, link, host:true, me:{id,name}, scene, maxPlayers, hasPassword}
//   joinRoom(code, {name, password, cls, el}) → {code, me:{id,name}, scene, maxPlayers, hasPassword}
//     失敗 reject {reason, needPassword?, wrong?, max?},reason 見 設計_多人連線.md §6-1
//   leave(), setProfile({cls, el, ready}), startGame()(僅房主;人數不足 reject notEnough)
//   on(ev, fn) / off(ev, fn);事件:
//     'players'([{id,name,cls,el,ready,host}])、'start'({scene, players, seed})、
//     'closed'({reason}) reason:'idle' | 'hostleft' | 'network'、'idleCountdown'({secondsLeft}|{secondsLeft:null} 表示不顯示)
//   emitEv(obj)(送出遊戲事件 ev/<座位>/<key>,回傳 key);on('ev', fn) 收到他人事件 {seat, key, data}(已去重,略過開啟前 2 s 以前的舊事件)
//   其他:now()、me、isHost、code、stub、online、idleMs(測試時可改短)
(function () {
  const NET_PROTO = 1;          // 協定版本(meta.v)
  const NET_BUILD = 12;          // 遊戲版本,必須與 version.json 的 v 同步(發版時一起改)
  const sceneMax = () => (typeof window.getSceneCount === 'function' ? window.getSceneCount() : 2) - 1;   // 場地索引上限(scenes.js)
  const HB_MS = 10000;          // 心跳間隔
  const STALE_MS = 25000;       // 心跳逾時:超過即視為離開
  const CREATE_WAIT_MS = 1000;  // 建房前等待是否有人已佔用該房號
  const JOIN_WAIT_MS = 800;     // 加入時等待房主回應
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // 去掉 0 O 1 I L,31^4 種
  const CLS_OK = ['mage', 'archer', 'swordsman', 'assassin'];
  const EL_OK = ['water', 'fire', 'wind', 'earth', 'light', 'dark'];
  const CFG = typeof NET_CFG !== 'undefined' ? NET_CFG : { dbUrl: '', apiKey: '' };
  const STUB = /[?&]net=stub(?:&|$)/.test(location.search);

  const listeners = {};
  let bus = null;        // 目前房間的匯流排
  let myRoom = null;     // 目前房號
  let mySeat = 0;        // 我的座位(同時作為玩家 id)
  let lastPlayersKey = '', lastRound = 0, lastCountdown = undefined, idleSince = 0, lastHb = 0;
  let evOpenT = 0;                                  // 本次房間串流開啟的時間(舊事件判斷,§1-7)
  const EV_SEEN = new Set(), EV_SEEN_Q = [];         // 事件去重(保留最近 512 筆,§1-7)

  const cryptoOk = () => !!(window.crypto && window.crypto.subtle);
  const clean = s => String(s == null ? '' : s).trim().slice(0, 8) || '玩家';
  const normCode = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  const linkOf = code => location.origin + location.pathname + '?room=' + code + (STUB ? '&net=stub' : '');
  const nowT = () => (bus ? bus.now() : Date.now());
  const root = () => (bus && bus.root) || null;
  const isHost = () => !!(root() && root().meta && root().meta.host === mySeat);

  function randCode() {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return c;
  }
  function randSalt() {
    const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 16; i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }
  function emit(ev, data) { (listeners[ev] || []).slice().forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }

  // 依路徑設值(null 表示刪除);路徑為相對房間的 'a/b/c'
  function setAt(obj, path, val) {
    const parts = String(path).split('/').filter(Boolean);
    if (!obj || !parts.length) return;
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (o[k] == null || typeof o[k] !== 'object') {
        if (val === null) return;
        o[k] = {};
      }
      o = o[k];
    }
    const last = parts[parts.length - 1];
    if (val === null) delete o[last]; else o[last] = val;
  }

  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  async function sha256hex(str) {
    if (!cryptoOk()) throw { reason: 'nopwcrypto' };
    const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ================= RoomBus 介面(BcBus、FirebaseBus 共用) =================
     attach(code, waitMs) → Promise<root|null>   讀取房間並開始監聽;null 表示房間不存在
     create(code, meta, pwHash)                  建立房間(meta 為 meta 物件,pwHash 為 null 或雜湊)
     join(seat, playerObj, memHash)              寫入自己的座位
     patchRoot({'相對路徑': 值|null})            多路徑寫入;setState(path, v) 為單一路徑寫法
     emit(evObj) → key                           寫 ev/<座位>/<key>(10 秒後自行清除)
     leave(byeReason?)                           離開;房主傳入 reason 會通知其他人
     now()、on('put'|'patch'|'down', fn)、root(本機鏡像)
  */
  class RoomBus {
    constructor() { this.root = null; this.code = ''; this.seat = 0; this._h = {}; this._seq = 0; this._own = []; }
    on(type, fn) { (this._h[type] = this._h[type] || []).push(fn); }
    _fire(type, a) { (this._h[type] || []).slice().forEach(fn => { try { fn(a); } catch (e) { console.error(e); } }); }
    _applyMap(map) { Object.keys(map).forEach(k => setAt(this.root, k, map[k])); }
    setState(path, val) { return this.patchRoot({ [path]: val }); }
    emit(evObj) {
      const t = this.now();
      const key = t.toString(36).padStart(9, '0') + '_' + (++this._seq).toString(36);
      const path = 'ev/' + this.seat + '/' + key;
      const map = { [path]: JSON.stringify(evObj) };
      this._own.filter(o => t - o.t > 10000).forEach(o => { map[o.path] = null; });
      this._own = this._own.filter(o => t - o.t <= 10000);
      this._own.push({ path, t });
      this.patchRoot(map);
      return key;
    }
  }

  /* BcBus:BroadcastChannel 頻道 'mageb-<房號>'。每個分頁各自保存一份房間鏡像;
     房間成員回應 req 時送出完整鏡像(full);寫入會廣播 map 給其他分頁。
     沒有伺服器:房主(或任一成員)的分頁關閉後,房間即消失;密碼以雜湊在本機比對。 */
  class BcBus extends RoomBus {
    constructor() { super(); this.id = Math.random().toString(36).slice(2, 10); this.ch = null; this.waiter = null; }
    now() { return Date.now(); }
    _open(code) {
      this._close();
      if (typeof BroadcastChannel === 'undefined') throw { reason: 'network' };
      this.code = code;
      this.ch = new BroadcastChannel('mageb-' + code);
      this.ch.onmessage = e => this._recv((e && e.data) || {});
    }
    _close() {
      if (this.ch) { try { this.ch.close(); } catch (e) { } }
      this.ch = null; this.waiter = null;
    }
    _send(m) { if (this.ch) { try { this.ch.postMessage(m); } catch (e) { } } }
    _recv(m) {
      if (m.k === 'req') { if (this.root && m.from !== this.id) this._send({ k: 'full', to: m.from, data: this.root }); }
      else if (m.k === 'full') { if (this.waiter && m.to === this.id) this.waiter(m.data); }
      else if (m.k === 'map') { if (this.root) { this._applyMap(m.map); this._fire('patch', m.map); } }
      else if (m.k === 'bye') this._fire('down', m.reason);
    }
    attach(code, waitMs) {
      this._open(code);
      this.root = null;
      return new Promise(resolve => {
        const timer = setTimeout(() => { this.waiter = null; resolve(null); }, waitMs);
        this.waiter = data => { clearTimeout(timer); this.waiter = null; this.root = data || null; resolve(this.root); };
        this._send({ k: 'req', from: this.id });
      });
    }
    create(code, meta, pwHash) {
      if (this.code !== code || !this.ch) this._open(code);
      this.root = { meta: meta, pw: pwHash || null, players: {}, mem: {} };
      return Promise.resolve();
    }
    join(seat, player, memHash) {
      this.seat = seat;
      const map = { ['players/' + seat]: player };
      if (memHash) map['mem/' + seat] = memHash;
      return this.patchRoot(map);
    }
    patchRoot(map) {
      if (!this.root) return Promise.resolve();
      this._applyMap(map);
      this._send({ k: 'map', map: map });
      this._fire('patch', map);
      return Promise.resolve();
    }
    leave(byeReason) {
      if (byeReason && this.root) this._send({ k: 'bye', reason: byeReason });
      this._close();
      this.root = null; this.seat = 0;
    }
  }

  /* FirebaseBus(N8):REST(fetch)+ SSE(EventSource),不用 SDK、不下載外部程式庫。
     規則見 設計_多人連線.md §1-8;寫入格式與順序見 §1-4、§1-6;串流 / 重連 / 看門狗見 §1-7;時間校正見 §1-5。
     本機鏡像 this.root 由串流維護;寫入時同步套到本機鏡像(與 BcBus 相同),串流回來的自己寫入會覆寫成同值或伺服器時間。
     寫入分四條通道:structural(建房、加入、關房、心跳、名單等,依序執行)、state(snap/sm,同時最多 1 個在途、只保留最新)、
     ev(事件,最多 4 併發、8 秒逾時、逾時重送一次,鍵唯一故冪等)。錯誤一律轉成 {reason},見 net.js 的 reason 清單。 */
  const FB_SV_LAST = ['hb', 'lastActive', 'created', 'joined'];   // 這些欄位寫入時改為伺服器時間戳 {".sv":"timestamp"}
  const FB_STATE_RE = /^(snap|sm)\/\d+$/;                          // 快照通道
  const FB_EV_RE = /^ev\/\d+\/[0-9a-z_]+$/;                        // 事件通道
  const FB_TIMEOUT_MS = 8000;      // 單次請求逾時
  const FB_INIT_MS = 8000;         // 等待第一個 put(房間完整狀態)的上限
  const FB_STALL_MS = 45000;       // 超過此時間沒有任何串流訊息 → 重開串流
  const FB_DOWN_MS = 90000;        // 連續失敗超過此時間 → 視為網路中斷(closed network)
  // 寫入前把伺服器時間欄位換成 .sv;回傳換好的值,並把換過的相對路徑收進 out(用來量測時間偏差)
  function fbWire(path, v, out) {
    if (typeof v === 'number' && FB_SV_LAST.indexOf(path.slice(path.lastIndexOf('/') + 1)) >= 0) { out.push(path); return { '.sv': 'timestamp' }; }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = {};
      Object.keys(v).forEach(k => { o[k] = fbWire(path + '/' + k, v[k], out); });
      return o;
    }
    return v;
  }
  // 把一個節點展開成葉節點 { '相對路徑': 值 }(供 dispatchEv 使用)
  function fbLeaves(prefix, v, out) {
    if (v && typeof v === 'object') Object.keys(v).forEach(k => fbLeaves(prefix + '/' + k, v[k], out));
    else out[prefix] = v;
    return out;
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  class FirebaseBus extends RoomBus {
    constructor(cfg) {
      super();
      this.dbUrl = String(cfg.dbUrl || '').replace(/\/+$/, '');
      this.apiKey = cfg.apiKey || '';
      this.es = null; this._closed = true; this._init = null;
      this._retryTimer = null; this._retryN = 0; this._wd = null;
      this.lastMsg = 0; this.failSince = 0;
      this.offset = 0; this._samples = []; this._svSent = new Map();   // 伺服器時間偏差(ms)與待回收的 .sv 寫入時刻
      this._chain = Promise.resolve(); this._broken = false;
      this._stBusy = false; this._stNext = null;
      this._evQ = []; this._evActive = 0;
    }
    now() { return Math.round(Date.now() + this.offset); }   // 整數:事件鍵由它組成(§1-3)

    /* ---------- 底層 HTTP ---------- */
    _url(path) { return this.dbUrl + '/' + path + '.json?print=silent'; }
    // 寫入請求:逾時 8 秒、429 / 503 或網路錯誤時重試一次;回傳 Response(呼叫端用 _ok 檢查)
    async _req(method, url, body) {
      for (let i = 0; i < 2; i++) {
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = setTimeout(() => { if (ctl) ctl.abort(); }, FB_TIMEOUT_MS);
        try {
          const res = await fetch(url, {
            method: method,
            headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            keepalive: true,
            signal: ctl ? ctl.signal : undefined
          });
          clearTimeout(timer);
          if ((res.status === 429 || res.status === 503) && i === 0) { await sleep(1000); continue; }
          return res;
        } catch (e) {
          clearTimeout(timer);
          console.warn('[net] 寫入請求失敗', method, e && e.name);
          if (i === 0) await sleep(500);
        }
      }
      throw { reason: 'network' };
    }
    _ok(res) { if (!res.ok) throw { reason: 'network', status: res.status }; return res; }
    _track(svs) {
      const t = Date.now();
      (svs || []).forEach(p => { if (p === 'meta/created' || p === 'players/' + this.seat + '/hb') this._svSent.set(p, t); });
    }
    // 多路徑 PATCH 到根目錄(body 的鍵為完整路徑;規則以寫入前資料判斷,所以 pw / mem / players 不可混在同一請求)
    _patchRoot(body, svs) {
      this._track(svs);
      return this._req('PATCH', this.dbUrl + '/.json?print=silent', body).then(r => this._ok(r));
    }
    // 房間內的寫入:相對路徑 map → 完整路徑的多路徑 PATCH
    _writeMap(map) {
      const body = {}, svs = [], code = this.code;
      Object.keys(map).forEach(k => { body['rooms/' + code + '/' + k] = fbWire(k, map[k], svs); });
      return this._patchRoot(body, svs);
    }
    _serial(fn) {
      const p = this._chain.then(fn);
      this._chain = p.catch(() => { });
      return p;
    }

    /* ---------- 串流 ---------- */
    _open(code) {
      this._stopStream();
      this._closed = false; this.code = code; this.root = null;
      this._retryN = 0; this.failSince = 0;
      this._connect();
      this._wd = setInterval(() => this._watch(), 5000);
    }
    _stopStream() {
      this._closed = true;
      if (this._wd) { clearInterval(this._wd); this._wd = null; }
      if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
      this._closeEs();
    }
    _closeEs() {
      const es = this.es;
      this.es = null;
      if (es) { es.onopen = null; es.onerror = null; es.close(); }
    }
    _connect() {
      this._closeEs();
      let es = null;
      try { es = new EventSource(this.dbUrl + '/rooms/' + this.code + '.json'); }
      catch (e) { console.warn('[net] 無法開啟串流'); return this._remoteDown('network'); }
      this.es = es;
      this.lastMsg = Date.now();
      es.onopen = () => { if (this.es !== es) return; this._retryN = 0; this.failSince = 0; };
      es.onerror = () => this._onErr(es);
      es.addEventListener('put', e => this._onMsg(es, e, 'put'));
      es.addEventListener('patch', e => this._onMsg(es, e, 'patch'));
      es.addEventListener('keep-alive', () => { if (this.es === es) this._touch(); });
      es.addEventListener('cancel', () => { if (this.es === es) this._remoteDown('hostleft'); });
      es.addEventListener('auth_revoked', () => { if (this.es === es) this._remoteDown('hostleft'); });
    }
    _touch() { this.lastMsg = Date.now(); this.failSince = 0; }
    _onErr(es) {
      if (this.es !== es || this._closed) return;
      if (!this.failSince) this.failSince = Date.now();
      // 瀏覽器會自動重連(CONNECTING);只有 CLOSED 時才自己退避重開
      if (es.readyState === EventSource.CLOSED) this._scheduleReconnect();
    }
    _scheduleReconnect() {
      if (this._retryTimer || this._closed) return;
      const d = Math.min(15000, 1000 * Math.pow(2, this._retryN));
      this._retryN++;
      this._retryTimer = setTimeout(() => { this._retryTimer = null; if (!this._closed) this._connect(); }, d);
    }
    // 看門狗:長時間無任何訊息(含 keep-alive)就重開;失敗太久就回報網路中斷
    _watch() {
      if (this._closed) return;
      const t = Date.now();
      if (this.failSince && t - this.failSince > FB_DOWN_MS) return this._remoteDown('network');
      if (this.es && !this._retryTimer && t - this.lastMsg > FB_STALL_MS) { this._connect(); }
    }
    _remoteDown(reason) {
      if (this._closed) return;
      if (this._init) return this._settle({ reason: 'network' });
      this._stopStream();
      this._fire('down', reason);
    }
    _settle(err, root) {
      const i = this._init;
      if (!i) return;
      this._init = null;
      clearTimeout(i.timer);
      if (err) { this._stopStream(); i.reject(err); } else i.resolve(root);
    }
    _onMsg(es, e, type) {
      if (this.es !== es || this._closed) return;
      this._touch();
      let msg = null;
      try { msg = JSON.parse(e.data); } catch (err) { console.warn('[net] 串流資料無法解析'); return; }
      if (!msg || typeof msg !== 'object') return;
      const rel = String(msg.path || '/').replace(/^\/+|\/+$/g, ''), data = msg.data;
      if (!rel && type === 'put') return this._full(data);
      if (!this.root) return;
      const leaves = {};
      if (type === 'put') {
        setAt(this.root, rel, data);
        fbLeaves(rel, data, leaves);
      } else if (data && typeof data === 'object') {
        Object.keys(data).forEach(k => {
          const p = rel ? rel + '/' + k : k;
          setAt(this.root, p, data[k]);
          fbLeaves(p, data[k], leaves);
        });
      }
      // 自己寫入的伺服器時間回來 → 量測時間偏差
      Object.keys(leaves).forEach(p => {
        const st = this._svSent.get(p);
        if (st != null && typeof leaves[p] === 'number') { this._svSent.delete(p); this._sample(leaves[p], st, Date.now()); }
      });
      if (Object.keys(leaves).length) this._fire('patch', leaves);
    }
    // 房間完整狀態(連線後第一個 put,或重連後的 put):null 表示房間不存在
    _full(data) {
      const init = !!this._init;
      this.root = data && typeof data === 'object' ? data : null;
      if (init) return this._settle(null, this.root);
      this._fire('open');   // 讓 net.js 把舊事件判斷的起點移到本次串流開啟時
      this._fire('put');
    }
    _sample(sv, sendT, recvT) {
      const rtt = recvT - sendT;
      if (!(rtt >= 0 && rtt < 5000)) return;
      this._samples.push({ rtt: rtt, off: sv - (sendT + recvT) / 2 });
      if (this._samples.length > 8) this._samples.shift();
      const best = this._samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      this.offset = this._samples.length === 1 ? best.off : this.offset + (best.off - this.offset) * 0.2;
    }

    /* ---------- RoomBus 介面 ---------- */
    attach(code, waitMs) {
      return new Promise((resolve, reject) => {
        this._init = { resolve, reject, timer: setTimeout(() => this._settle({ reason: 'network' }), Math.max(waitMs || 0, FB_INIT_MS)) };
        this._open(code);
      });
    }
    create(code, meta, pwHash) {
      if (this.code !== code || this._closed) this._open(code);
      this._broken = false;
      this.root = { meta: meta, pw: pwHash || null, players: {}, mem: {} };
      const p = this._serial(async () => {
        try {
          const svs = [], body = {};
          body['roomIdx/' + code] = { '.sv': 'timestamp' };
          body['rooms/' + code + '/meta'] = fbWire('meta', meta, svs);
          await this._patchRoot(body, svs);
          if (pwHash) this._ok(await this._req('PUT', this._url('pw/' + code), pwHash));
        } catch (e) { this._broken = true; throw e; }
      });
      p.catch(() => { });   // createRoom 不 await 這個 promise;失敗會由接著的 join 回報
      return p;
    }
    join(seat, player, memHash) {
      this.seat = seat;
      this._applyMap({ ['players/' + seat]: player });
      const code = this.code;
      return this._serial(async () => {
        if (this._broken) throw { reason: 'network' };
        if (memHash) {
          const r = await this._req('PUT', this._url('mem/' + code + '/' + seat), memHash);
          if (r.status === 401 || r.status === 403) throw { reason: 'password', needPassword: true, wrong: true };
          this._ok(r);
        }
        const svs = [];
        const body = fbWire('players/' + seat, player, svs);
        this._track(svs);
        this._ok(await this._req('PUT', this._url('rooms/' + code + '/players/' + seat), body));
      });
    }
    patchRoot(map) {
      if (!this.root) return Promise.resolve();
      const keys = Object.keys(map);
      this._applyMap(map);
      if (keys.length && keys.every(k => FB_STATE_RE.test(k))) return this._stateSend(map);
      if (keys.length && keys.every(k => FB_EV_RE.test(k))) { const p = this._evSend(map); p.catch(e => console.warn("[net] 事件寫入失敗", e && e.reason)); return p; }
      this._fire('patch', map);
      return this._serial(() => this._writeMap(map));
    }
    // 快照通道:同時最多 1 個在途;在途期間來的寫入合併成一包(同鍵保留最新),完成後送出
    _stateSend(map) {
      return new Promise(resolve => {
        if (!this._stBusy) { this._stBusy = true; this._stFlush(map, [resolve]); return; }
        if (!this._stNext) this._stNext = { map: {}, waiters: [] };
        Object.assign(this._stNext.map, map);
        this._stNext.waiters.push(resolve);
      });
    }
    _stFlush(map, waiters) {
      this._writeMap(map).catch(e => console.warn('[net] 快照寫入失敗', e && e.reason)).then(() => {
        waiters.forEach(w => w());
        const n = this._stNext;
        this._stNext = null;
        if (n) this._stFlush(n.map, n.waiters); else this._stBusy = false;
      });
    }
    // 事件通道:最多 4 併發,超過排隊
    _evSend(map) {
      return new Promise((resolve, reject) => { this._evQ.push({ map: map, resolve: resolve, reject: reject }); this._evPump(); });
    }
    _evPump() {
      while (this._evActive < 4 && this._evQ.length) {
        const j = this._evQ.shift();
        this._evActive++;
        this._writeMap(j.map).then(j.resolve, j.reject).then(() => { this._evActive--; this._evPump(); });
      }
    }
    // 關房(只有房主以 byeReason 呼叫):依序刪除 roomIdx、rooms、pw、mem(規則要求房間先為 closed,且刪 pw / mem 時房間仍在或已刪)
    leave(byeReason) {
      const code = this.code;
      this._stopStream();
      this.root = null; this.seat = 0;
      if (byeReason && code) {
        this._serial(async () => {
          for (const path of ['roomIdx/' + code, 'rooms/' + code, 'pw/' + code, 'mem/' + code]) {
            this._ok(await this._req('DELETE', this._url(path)));
          }
        }).catch(e => console.warn('[net] 關房清理失敗', e && e.reason));
      }
    }
  }

  /* ================= 房間管理(與匯流排無關,只透過 RoomBus 讀寫) ================= */
  function newBus() {
    if (STUB) return new BcBus();
    if (!CFG.dbUrl) return null;
    return new FirebaseBus(CFG);
  }
  function mkPlayer(name, cls, el, t) {
    return { name, cls: CLS_OK.indexOf(cls) >= 0 ? cls : 'mage', el: EL_OK.indexOf(el) >= 0 ? el : 'fire', ready: false, joined: t, hb: t };
  }
  function removeMap(s) {
    return { ['players/' + s]: null, ['snap/' + s]: null, ['sm/' + s]: null, ['ev/' + s]: null };
  }
  // 大廳名單:過濾心跳逾時者(自己不過濾)
  function listPlayers() {
    const r = root();
    if (!r || !r.meta) return [];
    const t = nowT(), out = [];
    for (let s = 1; s <= 12; s++) {
      const p = r.players && r.players[s];
      if (!p || (s !== mySeat && t - (p.hb || 0) > STALE_MS)) continue;
      out.push({ id: s, name: p.name, cls: p.cls, el: p.el, ready: !!p.ready, host: s === r.meta.host });
    }
    return out;
  }
  // 房主以外仍在線的人數
  function othersAlive() {
    const r = root(), t = nowT();
    let n = 0;
    for (let s = 1; s <= 12; s++) {
      const p = r.players && r.players[s];
      if (p && s !== r.meta.host && t - (p.hb || 0) <= STALE_MS) n++;
    }
    return n;
  }
  // 最小的不存在或心跳逾時座位;沒有則 0
  function findSeat(r, t) {
    for (let s = 1; s <= r.meta.max; s++) {
      const p = r.players && r.players[s];
      if (!p || t - (p.hb || 0) > STALE_MS) return s;
    }
    return 0;
  }
  function wire(b) {
    evOpenT = b.now();
    b.on('open', () => { if (bus === b) evOpenT = b.now(); });
    b.on('put', () => { if (bus === b) onChange(); });
    b.on('patch', m => { if (bus === b) { dispatchEv(m); onChange(); } });
    b.on('down', reason => { if (bus === b) closeLocal(reason || 'hostleft'); });
  }
  // 事件分派(§1-7):同一則 patch 內依路徑排序(鍵前 9 碼為時間,排序即時間序);只處理他人座位;去重;舊事件只標記不處理
  function dispatchEv(map) {
    if (!map || typeof map !== 'object') return;
    Object.keys(map).sort().forEach(path => {
      const hit = /^ev\/(\d+)\/([0-9a-z_]+)$/.exec(path), val = map[path];
      if (!hit || typeof val !== 'string') return;
      const seat = +hit[1], key = hit[2];
      if (seat === mySeat) return;
      const id = seat + '/' + key;
      if (EV_SEEN.has(id)) return;
      EV_SEEN.add(id); EV_SEEN_Q.push(id);
      if (EV_SEEN_Q.length > 512) EV_SEEN.delete(EV_SEEN_Q.shift());
      if (!(parseInt(key.slice(0, 9), 36) >= evOpenT - 2000)) return;
      let data = null;
      try { data = JSON.parse(val); } catch (e) { return; }
      if (data && typeof data.t === 'string') emit('ev', { seat: seat, key: key, data: data });
    });
  }
  function resetLocal() {
    bus = null; myRoom = null; mySeat = 0;
    EV_SEEN.clear(); EV_SEEN_Q.length = 0;
    lastPlayersKey = ''; lastRound = 0; lastCountdown = undefined; idleSince = 0; lastHb = 0;
  }
  // 離開本機房間(不發事件);byeReason 只在房主離開時傳入
  function dropRoom(byeReason) {
    const b = bus;
    resetLocal();
    if (b) b.leave(byeReason);
  }
  // 房間被他人關閉或失效:本機收拾並通知大廳
  function closeLocal(reason) {
    if (!bus) return;
    dropRoom();
    emit('closed', { reason: reason });
  }
  // 房主因無人而關房(先脫離房間,避免自己寫入 closed 時的回音再發一次事件)
  function closeIdle() {
    const b = bus;
    if (!b) return;
    resetLocal();
    b.patchRoot({ 'meta/state': 'closed' });
    b.leave('idle');
    emit('closed', { reason: 'idle' });
  }
  // 主動離開:房主關房;成員移除自己的資料。不發 closed 事件(大廳自行切換畫面)
  function leaveNow() {
    if (!bus) return;
    const b = bus, s = mySeat, host = isHost();
    resetLocal();
    if (host) { b.patchRoot({ 'meta/state': 'closed' }); b.leave('hostleft'); }
    else { if (s) b.patchRoot(removeMap(s)); b.leave(); }
  }
  function onChange() {
    if (!bus || !myRoom) return;
    const r = root();
    if (!r || !r.meta || r.meta.state === 'closed') return closeLocal('hostleft');
    const m = r.meta;
    if (m.state === 'match' && m.round && m.round.n !== lastRound) {
      lastRound = m.round.n;
      emit('start', { scene: m.round.scene, players: listPlayers(), seed: m.round.seed });
    }
    const pl = listPlayers(), key = JSON.stringify(pl);
    if (key !== lastPlayersKey) { lastPlayersKey = key; emit('players', pl); }
  }
  // 每秒:心跳、房主的逾時清理與無人倒數、成員的房主逾時偵測
  function tick() {
    if (!bus || !myRoom) return;
    const r = root();
    if (!r || !r.meta || r.meta.state === 'closed') return closeLocal('hostleft');
    const t = nowT();
    if (t - lastHb >= HB_MS) {
      lastHb = t;
      const map = { ['players/' + mySeat + '/hb']: t, 'meta/lastActive': t };
      if (isHost()) map['meta/hb'] = t;
      bus.patchRoot(map);
    }
    if (isHost()) {
      for (let s = 1; s <= 12; s++) {
        const p = r.players && r.players[s];
        if (s !== r.meta.host && p && t - (p.hb || 0) > STALE_MS) bus.patchRoot(removeMap(s));
      }
      let left = null;
      if (othersAlive() === 0) {
        if (!idleSince) idleSince = t;
        const remain = idleSince + Net.idleMs - t;
        if (remain <= 0) return closeIdle();
        left = Math.ceil(remain / 1000);
      } else idleSince = 0;
      if (left !== lastCountdown) { lastCountdown = left; emit('idleCountdown', { secondsLeft: left }); }
    } else if (t - (r.meta.hb || 0) > STALE_MS) {
      return closeLocal('hostleft');
    }
    onChange();
  }

  async function createRoom(opt) {
    opt = opt || {};
    leaveNow();
    const pw = opt.password || null;
    if (pw && !cryptoOk()) throw { reason: 'nopwcrypto' };
    const b = newBus();
    if (!b) throw { reason: 'noconfig' };
    let code = '';
    for (let i = 0; i < 8 && !code; i++) {
      const c = randCode();
      const found = await b.attach(c, CREATE_WAIT_MS);
      if (found) b.leave(); else code = c;
    }
    if (!code) { b.leave(); throw { reason: 'network' }; }
    const name = clean(opt.name);
    const max = (+opt.maxPlayers >= 2 && +opt.maxPlayers <= 12) ? Math.round(+opt.maxPlayers) : 6;
    const scene = Math.max(0, Math.min(sceneMax(), opt.scene | 0));
    const salt = randSalt();
    const pwHash = pw ? await sha256hex(salt + ':' + pw) : null;
    const t = b.now();
    b.create(code, {
      v: NET_PROTO, build: NET_BUILD, host: 1, name: (name + '的房間').slice(0, 24), max: max, scene: scene,
      locked: !!pw, salt: salt, state: 'lobby', created: t, lastActive: t, hb: t
    }, pwHash);
    bus = b; myRoom = code; mySeat = 1; lastHb = t; idleSince = t;
    wire(b);
    await b.join(1, mkPlayer(name, opt.cls, opt.el, t), pwHash);
    onChange();
    return { code: code, link: linkOf(code), host: true, me: { id: 1, name: name }, scene: scene, maxPlayers: max, hasPassword: !!pw };
  }

  async function joinRoom(code, opt) {
    opt = opt || {};
    code = normCode(code);
    if (code.length !== 4) throw { reason: 'notfound' };
    leaveNow();
    const b = newBus();
    if (!b) throw { reason: 'noconfig' };
    const fail = e => { b.leave(); throw e; };
    const r = await b.attach(code, JOIN_WAIT_MS);
    if (!r || !r.meta) return fail({ reason: 'notfound' });
    const m = r.meta;
    if (m.state === 'closed') return fail({ reason: 'closed' });
    if (m.v !== NET_PROTO || m.build !== NET_BUILD) return fail({ reason: 'version' });
    let rules = {};
    try { rules = JSON.parse(m.rules || '{}') || {}; } catch (e) { rules = {}; }
    if (m.state === 'match' && rules.lateJoin === false) return fail({ reason: 'inMatch' });
    let h = null;
    if (m.locked) {
      if (!opt.password) return fail({ reason: 'password', needPassword: true });
      if (!cryptoOk()) return fail({ reason: 'nopwcrypto' });
      h = await sha256hex(m.salt + ':' + opt.password);
      if (r.pw != null && h !== r.pw) return fail({ reason: 'password', needPassword: true, wrong: true });   // Firebase 的 pw 不可讀,由伺服器比對 mem(join 內)
    }
    const t = b.now();
    const seat = findSeat(r, t);
    if (!seat) return fail({ reason: 'full', max: m.max });
    const name = clean(opt.name);
    bus = b; myRoom = code; mySeat = seat; lastHb = t;
    wire(b);
    try { await b.join(seat, mkPlayer(name, opt.cls, opt.el, t), h); }
    catch (e) { dropRoom(); throw (e && e.reason === 'password') ? e : { reason: (e && e.reason) || 'network' }; }
    onChange();
    return { code: code, link: linkOf(code), me: { id: seat, name: name }, scene: m.scene, maxPlayers: m.max, hasPassword: !!m.locked };
  }

  function setProfile(p) {
    if (!bus || !mySeat || !p) return Promise.resolve();
    const map = {}, pre = 'players/' + mySeat + '/';
    if (CLS_OK.indexOf(p.cls) >= 0) map[pre + 'cls'] = p.cls;
    if (EL_OK.indexOf(p.el) >= 0) map[pre + 'el'] = p.el;
    if (typeof p.ready === 'boolean') map[pre + 'ready'] = p.ready;
    if (!Object.keys(map).length) return Promise.resolve();
    return bus.patchRoot(map);
  }

  // opt.scene:再來一局時指定場地(省略則沿用房間場地)
  async function startGame(opt) {
    const r = root();
    if (!bus || !r || !isHost()) throw { reason: 'notHost' };
    if (listPlayers().length < 2) throw { reason: 'notEnough' };
    const t = bus.now();
    const n = ((r.meta.round && r.meta.round.n) || 0) + 1;
    const sc = Math.max(0, Math.min(sceneMax(), opt && opt.scene != null ? (opt.scene | 0) : (r.meta.scene | 0)));
    const round = {
      n: n, scene: sc, seed: Math.floor(Math.random() * 2147483647),
      t0: t + 5000, tEnd: t + 5000 + Net.roundLenMs
    };
    await bus.patchRoot({ 'meta/state': 'match', 'meta/round': round, 'meta/result': null, 'score': null });   // 新局清空計分與結算(score / result 只由房主寫)
  }
  // 房主寫入結算(§5-1):state = result、result = JSON 字串
  function setResult(json) {
    if (!bus || !myRoom || !mySeat || !isHost()) return Promise.resolve();
    return bus.patchRoot({ 'meta/state': 'result', 'meta/result': json });
  }

  async function leave() { leaveNow(); }

  const Net = {
    stub: STUB,
    online: !!CFG.dbUrl,
    idleMs: 5 * 60 * 1000,
    roundLenMs: 300000,   // 回合長度(§8 #11 預設 5 分鐘);測試時可在 console 改短
    get me() { return mySeat || null; },
    get isHost() { return isHost(); },
    get code() { return myRoom; },
    now: () => nowT(),
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    off(ev, fn) { listeners[ev] = (listeners[ev] || []).filter(f => f !== fn); },
    createRoom: createRoom,
    joinRoom: joinRoom,
    leave: leave,
    setProfile: setProfile,
    startGame: startGame,
    // 多人對戰(remote.js)用:快照寫入自己的 snap/<座位>、讀取任一座位的快照、讀取本局 round
    emitEv(obj) { return bus && myRoom && mySeat ? bus.emit(obj) : null; },   // 施放等遊戲事件(netcombat.js)
    setSnap(s) { return bus && mySeat ? bus.setState('snap/' + mySeat, s) : Promise.resolve(); },
    snapOf(seat) { const r = root(); return r && r.snap ? r.snap[seat] : undefined; },
    // 召喚物快照 sm/<座位>(netsummon.js,N7):寫入自己的節點(null = 刪除);讀取任一座位
    setSm(s) { return bus && mySeat ? bus.setState('sm/' + mySeat, s) : Promise.resolve(); },
    smOf(seat) { const r = root(); return r && r.sm ? r.sm[seat] : undefined; },
    roundOf() { const r = root(); return r && r.meta && r.meta.round ? r.meta.round : null; },
    metaState() { const r = root(); return r && r.meta && r.meta.state ? r.meta.state : ''; },
    metaResult() { const r = root(); return r && r.meta && typeof r.meta.result === 'string' ? r.meta.result : ''; },
    setResult: setResult,
    // 計分(netcombat.js,§2-8 / §4-2):score/<座位> = "擊倒,死亡",只有房主寫;nameOf 供擊殺訊息用
    scores() { const r = root(); return (r && r.score) || {}; },
    setScore(seat, val) { return bus && myRoom && mySeat ? bus.setState('score/' + seat, val) : Promise.resolve(); },
    nameOf(seat) { const r = root(), p = r && r.players && r.players[seat]; return p && p.name ? p.name : '玩家' + seat; }
  };

  window.Net = Net;
  window.RoomBus = RoomBus;
  window.BcBus = BcBus;
  window.FirebaseBus = FirebaseBus;
  window.mulberry32 = mulberry32;
  window.sha256hex = sha256hex;
  setInterval(tick, 1000);
  window.addEventListener('pagehide', () => { if (myRoom) leaveNow(); });
})();
