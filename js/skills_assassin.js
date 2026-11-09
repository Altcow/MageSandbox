'use strict';
// 刺客進階招式空殼(S 批,寫手 C 實作):影舞的 暗影步 / 煙霧彈 / 割喉,第 4 格絕技 影分身,以及煙霧區域判定。
// 載入順序:skills.js → skills_archer.js → skills_sword.js → skills_assassin.js → resources.js → classes.js(index.html)。
// 註冊:classes.js 的 CLASSES.assassin.skills 以函式名直接引用(cast: castShadowStep 等),本檔只定義函式,不需另外登錄。
// 填寫步驟:
//   1) 把下列空殼換成實作。參數與 skills.js 相同:P 為施放資料,orb 為能量球;P.net 代表遠端重現,改動 G / mage 要用 if (!P.net) 守門。
//   2) 在 classes.js 該招的 mkSkill 列移除 stub: true(stub 招式會先擋下並顯示「尚未實作」)。
//   3) 連擊點:能量 CLASSES.assassin.energy(kind: 'combo',max 5),用 gainEnergy / spendEnergy(resources.js)。
//   4) 煙霧區域:smokeAt(x, z) 之後要回傳 true/false(remote.js 半隱形、潛行加成判定用);目前尚未實作。

// 暗影步(B-1,集氣 0.3 s):瞬移到目標身後,連擊點 +1
function castShadowStep(P, orb) { if (orb) dissolveOrb(orb, auraEl()); banner('尚未實作', '#ffc46b'); }
// 煙霧彈(B-2,集氣):圈內敵人減速,煙中的刺客半隱形
function castSmoke(P, orb) { if (orb) dissolveOrb(orb, auraEl()); banner('尚未實作', '#ffc46b'); }
// 座標 (x, z) 是否在任一煙霧區內(尚未實作 = 永遠 false)
function smokeAt(x, z) { return false; }
// 割喉(B-3,集氣 0.5 s):消耗全部連擊點,傷害隨點數增加
function castEviscerate(P, orb) { if (orb) dissolveOrb(orb, auraEl()); banner('尚未實作', '#ffc46b'); }
// 影分身(第 4 格絕技,瞬發,C 型:分身兩端都畫;本體影遁只在本機;分身純視覺)
function castDecoy(P, orb) { if (orb) dissolveOrb(orb, auraEl()); banner('尚未實作', '#ffc46b'); }
