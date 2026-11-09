'use strict';
// 自製 QR Code 產生器(不使用外部程式庫)
// 範圍:byte 模式、錯誤更正等級 M、版本 1~6、遮罩 0~7 依罰分選最佳
// 用法:QR.matrix(text) → boolean[][](true = 深色模組,不含靜區,列 × 欄)
const QR = (function () {
  const TOTAL_CW = [0, 26, 44, 70, 100, 134, 172];   // 各版本總碼字數
  const ECC_CW = [0, 10, 16, 26, 18, 24, 16];         // M 等級:每區塊錯誤更正碼字數
  const BLOCKS = [0, 1, 1, 1, 2, 2, 4];               // M 等級:區塊數
  const ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];   // 對齊圖樣中心座標
  const MAX_VER = 6;
  const ECL_M_BITS = 0;                               // M 等級的格式資訊兩位元 = 00

  const DATA_CW = v => TOTAL_CW[v] - ECC_CW[v] * BLOCKS[v];
  const CAP = v => Math.floor((DATA_CW(v) * 8 - 12) / 8);   // byte 模式容量(版本 1~9 計數欄為 8 位元)
  const REM_BITS = v => (v === 1 ? 0 : 7);            // 剩餘位元(版本 1 無,其餘 7)

  // GF(256),本原多項式 0x11D
  const EXP = new Array(512), LOG = new Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  // 生成多項式 g(x) = Π (x - α^i),i = 0..deg-1;係數由高次到低次
  function rsGenerator(deg) {
    let g = [1];
    for (let i = 0; i < deg; i++) {
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); }
      g = ng;
    }
    return g;
  }
  // Reed-Solomon 錯誤更正碼:data 除以 g(x) 的餘式
  function rsEcc(data, deg) {
    const gen = rsGenerator(deg), res = new Array(deg).fill(0);
    for (const b of data) {
      const f = b ^ res.shift();
      res.push(0);
      for (let i = 0; i < deg; i++) res[i] ^= gmul(gen[i + 1], f);
    }
    return res;
  }

  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(s));
    return Array.from(unescape(encodeURIComponent(s)), c => c.charCodeAt(0));
  }

  // 資料碼字:模式指示 0100 + 計數 + 位元組 + 終止符 + 補齊 + 0xEC/0x11 交替填滿
  function dataCodewords(bytes, v) {
    const cap = DATA_CW(v) * 8, bits = [];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(0b0100, 4);
    push(bytes.length, 8);
    bytes.forEach(b => push(b, 8));
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) {
      let val = 0;
      for (let k = 0; k < 8; k++) val = val * 2 + bits[i + k];
      out.push(val);
    }
    let pad = 0xec;
    while (out.length < DATA_CW(v)) { out.push(pad); pad = pad === 0xec ? 0x11 : 0xec; }
    return out;
  }

  // 分區塊、各區塊算 ECC,再交錯排列(資料在前、ECC 在後)
  function codewords(data, v) {
    const nb = BLOCKS[v], dlen = DATA_CW(v) / nb, elen = ECC_CW[v];
    const blocks = [], ecc = [];
    for (let b = 0; b < nb; b++) {
      const d = data.slice(b * dlen, (b + 1) * dlen);
      blocks.push(d); ecc.push(rsEcc(d, elen));
    }
    const out = [];
    for (let i = 0; i < dlen; i++) blocks.forEach(d => out.push(d[i]));
    for (let i = 0; i < elen; i++) ecc.forEach(e => out.push(e[i]));
    return out;
  }

  // 格式資訊:5 位元資料 + BCH(15,5) 餘式,再 XOR 0x5412
  function formatBits(mask) {
    const data = (ECL_M_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }
  // 格式資訊的擺放位置(x = 欄, y = 列);put(x, y, bit)
  function formatPlace(put, bits, n) {
    const b = i => (bits >> i) & 1;
    for (let i = 0; i <= 5; i++) put(8, i, b(i));
    put(8, 7, b(6)); put(8, 8, b(7)); put(7, 8, b(8));
    for (let i = 9; i < 15; i++) put(14 - i, 8, b(i));
    for (let i = 0; i < 8; i++) put(n - 1 - i, 8, b(i));
    for (let i = 8; i < 15; i++) put(8, n - 15 + i, b(i));
    put(8, n - 8, 1);   // 固定深色模組
  }

  // 功能圖樣(定位、對齊、時序)與保留區
  function buildBase(v) {
    const n = 17 + 4 * v;
    const mod = [], fn = [];
    for (let i = 0; i < n; i++) { mod.push(new Array(n).fill(false)); fn.push(new Array(n).fill(false)); }
    const set = (x, y, d) => { mod[y][x] = !!d; fn[y][x] = true; };
    const finder = (x0, y0) => {
      for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        set(x, y, inside && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)));
      }
    };
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
    const c = ALIGN[v], last = c.length - 1;
    for (let i = 0; i < c.length; i++) for (let j = 0; j < c.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        set(c[j] + dx, c[i] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    for (let i = 8; i < n - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
    formatPlace((x, y, d) => set(x, y, d), 0, n);   // 先保留格式資訊區
    return { n, mod, fn };
  }

  // 資料位元從右下角依 Z 字形蛇行填入(跳過時序欄 6)
  function placeData(mod, fn, n, bits) {
    let k = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j, up = ((right + 1) & 2) === 0, y = up ? n - 1 - vert : vert;
          if (!fn[y][x] && k < bits.length) mod[y][x] = bits[k++] === 1;
        }
      }
    }
  }

  const MASK = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
  ];

  // 罰分(ISO 18004 的 N1 連續同色、N2 2×2 同色、N3 類定位圖樣、N4 深色比例)
  function penalty(m, n) {
    let score = 0, dark = 0;
    const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (let a = 0; a < n; a++) {
      for (const horiz of [true, false]) {
        const L = [];
        for (let b = 0; b < n; b++) L.push(horiz ? m[a][b] : m[b][a]);
        let run = 1;
        for (let k = 1; k <= n; k++) {
          if (k < n && L[k] === L[k - 1]) run++;
          else { if (run >= 5) score += 3 + (run - 5); run = 1; }
        }
        for (let k = 0; k + 11 <= n; k++) {
          let ok1 = true, ok2 = true;
          for (let t = 0; t < 11; t++) {
            const v = L[k + t] ? 1 : 0;
            if (v !== pat1[t]) ok1 = false;
            if (v !== pat2[t]) ok2 = false;
          }
          if (ok1 || ok2) score += 40;
        }
      }
      for (let b = 0; b < n; b++) if (m[a][b]) dark++;
    }
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
    score += 10 * Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5);
    return score;
  }

  function pickVersion(bytes) {
    let v = 1;
    while (v <= MAX_VER && bytes.length > CAP(v)) v++;
    if (v > MAX_VER) throw new Error('QR: 內容過長(上限 ' + CAP(MAX_VER) + ' 位元組)');
    return v;
  }

  function encodeBits(text) {
    const bytes = utf8(text), v = pickVersion(bytes);
    const cw = codewords(dataCodewords(bytes, v), v);
    const bits = [];
    cw.forEach(b => { for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1); });
    for (let i = 0; i < REM_BITS(v); i++) bits.push(0);
    return { v, bits };
  }

  // 主函式:回傳 n×n 布林矩陣(true = 深色)
  function matrix(text) {
    const { v, bits } = encodeBits(String(text));
    const base = buildBase(v), n = base.n;
    let best = null;
    for (let m = 0; m < 8; m++) {
      const mod = base.mod.map(r => r.slice());
      placeData(mod, base.fn, n, bits);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (!base.fn[y][x] && MASK[m](x, y)) mod[y][x] = !mod[y][x];
      }
      formatPlace((x, y, d) => { mod[y][x] = !!d; }, formatBits(m), n);
      const p = penalty(mod, n);
      if (!best || p < best.p) best = { p, mod };
    }
    return best.mod;
  }

  const QR = {
    matrix, version: text => encodeBits(String(text)).v,
    // 以下供無頭測試使用
    _internal: { rsEcc, rsGenerator, dataCodewords, codewords, formatBits, formatPlace, buildBase, placeData, MASK, penalty, utf8, DATA_CW, CAP, ECC_CW, BLOCKS, TOTAL_CW, REM_BITS }
  };
  return QR;
})();
if (typeof window !== 'undefined') window.QR = QR;
if (typeof module !== 'undefined' && module.exports) module.exports = QR;
