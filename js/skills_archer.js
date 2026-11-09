'use strict';
// 弓箭手進階招式空殼(S 批,寫手 A 實作):游擊架勢的 散射 / 後躍射擊 / 捕獸夾,第 4 格絕技 照明信號箭,以及專注(弓能量)與穿雲 / 暴雨的強化判定。
// 載入順序:skills.js → skills_archer.js → skills_sword.js → skills_assassin.js → resources.js → classes.js(index.html)。
// 註冊:classes.js 的 CLASSES.archer.skills 以函式名直接引用(cast: castScatter 等),本檔只定義函式,不需另外登錄。
// 填寫步驟:
//   1) 把下列空殼換成實作。參數與 skills.js 相同:P 為施放資料(P.dmgK / P.fxK / P.r / P.target 等),orb 為能量球;
//      P.net 代表遠端重現,改動 G / mage 的段落要用 if (!P.net) 守門。
//   2) 在 classes.js 該招的 mkSkill 列移除 stub: true(stub 招式在 startCharge / castInstant 會先擋下並顯示「尚未實作」)。
//   3) 能量強化:在資料列加 exFn(q) 回傳強化值(整數,release 寫入 P.ex),並加 exCost(快捷列金框門檻);扣除能量用 spendEnergy(resources.js)。
//   4) 數值放在 game.js DEFAULT_CFG.skills,SP 花費放在 resources.js CLASS_COST。
//   5) 專注的獲得 / 流失:每幀呼叫 archerTick(dt)(尚未接線),獲得用 gainEnergy(resources.js)。

// 散射(B-1,集氣):扇形射出 CHG.count(5, q) 支,同一目標最多吃 3 支
function castScatter(P, orb) { if (orb) dissolveOrb(orb, auraEl()); banner('尚未實作', '#ffc46b'); }
// 後躍射擊(B-2,瞬發):往瞄準點反方向後躍,纏絆箭減速
function castDisengage(P, orb) { if (orb) dissolveOrb(orb, auraEl()); banner('尚未實作', '#ffc46b'); }
// 捕獸夾(B-3,集氣):地面陷阱,觸發定身 + 照亮
function castSnare(P, orb) { if (orb) dissolveOrb(orb, auraEl()); banner('尚未實作', '#ffc46b'); }
// 照明信號箭(第 4 格絕技,集氣):落點爆開,圈內敵人照亮
function castFlare(P, orb) { if (orb) dissolveOrb(orb, auraEl()); banner('尚未實作', '#ffc46b'); }
// 穿雲 / 暴雨的強化判定(集氣 MAX 且專注足夠時扣除專注並回傳強化值;不足回傳 0)
function archerExFn(q) { return 0; }
// 專注每幀累積(站定獲得、移動流失;尚未接到 classTick)
function archerTick(dt) {}
