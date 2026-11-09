'use strict';
// 劍士進階招式空殼(S 批,寫手 B 實作):盾勢的 格擋反擊 / 震地 / 躍擊,第 4 格絕技 不屈戰意,以及破空斬的強化判定。
// 載入順序:skills.js → skills_archer.js → skills_sword.js → skills_assassin.js → resources.js → classes.js(index.html)。
// 註冊:classes.js 的 CLASSES.swordsman.skills 以函式名直接引用(cast: castParry 等),本檔只定義函式,不需另外登錄。
// 填寫步驟:
//   1) 把下列空殼換成實作。參數與 skills.js 相同:P 為施放資料,orb 為能量球;P.net 代表遠端重現,改動 G / mage 要用 if (!P.net) 守門。
//   2) 在 classes.js 該招的 mkSkill 列移除 stub: true(stub 招式會先擋下並顯示「尚未實作」)。
//   3) 格擋 / 不屈是瞬發招(instant: true),其 netSilent 不送 cast 事件,只靠快照位元 GUARD / UNYIELD。
//   4) 網路格擋否決:netcombat.js 的 netApplyHit 會呼叫 parryOn(from, rt) 與 onParry(from);目前回傳 false / 空操作。
//   5) 鬥氣獲得 / 流失:造成傷害 crOnDealt、受傷 crOnHurt 已接線(resources.js / netcombat.js);流失計時由寫手實作。

// 格擋反擊(B-1,瞬發):0.5 s 格擋窗內正面來的命中整則擋下;成功 → 鬥氣 +20、冷卻改 1 s、下一招集氣瞬間滿
function castParry(P, orb) { if (orb) dissolveOrb(orb, auraEl()); banner('尚未實作', '#ffc46b'); }
// 網路格擋否決(netApplyHit 呼叫):from 為攻擊者座位、rt 為攻擊者看到的時間點(ms);回傳 true 表示擋下。尚未實作 = 永遠不擋
function parryOn(from, rt) { return false; }
// 擋下後的反擊盾擊(netApplyHit 擋下後呼叫,由本機對 REMOTES[from] 盾擊)。尚未實作 = 空操作
function onParry(from) {}
// 震地(B-2,自身圓):擊飛 + 暈 0.4 s,必定打斷集氣
function castSlam(P, orb) { if (orb) dissolveOrb(orb, auraEl()); banner('尚未實作', '#ffc46b'); }
// 躍擊(B-3,集氣):跳到落點,落地暈 + 擊退(跳躍只在本機,遠端於落地時畫環)
function castLeap(P, orb) { if (orb) dissolveOrb(orb, auraEl()); banner('尚未實作', '#ffc46b'); }
// 不屈戰意(第 4 格絕技,瞬發,需鬥氣 ≥ 50 全部消耗):設定 G.unyT(playerHurt / netApplyFx 已讀取)
function castUnyield(P, orb) { if (orb) dissolveOrb(orb, auraEl()); banner('尚未實作', '#ffc46b'); }
// 破空斬的強化判定(蓄力斬集氣 MAX 且鬥氣 ≥ 30 時扣除鬥氣並回傳強化值;不足回傳 0)
function swordExFn(q) { return 0; }
