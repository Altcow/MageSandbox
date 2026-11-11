# MageSandbox 玩家資源系統(HP / MP / SP + 打坐)設計(2026-11-09)

> 交給寫手照做的規格;寫手只看得到文件與程式碼。
> 前置:`設計_魔法調整.md` 的**階段 0**(含 S-6 最小玩家狀態)必須**完成並合併**後才能開始本文件的實作,因為本文件會改 game.js、touch.js、classes.js、mage.js、index.html 等共用檔。
> 基礎:S-6 已定義 `G.hp / G.hpMax(100)`、`G.shield(0~60)/G.shieldT`、`G.downs`、`G.slowImmT`、`#pHP`、來襲扣 30、熾天使治癒 / 護盾 / 淨化。本文件**在其上擴充**,衝突處以本文件為準並明列。

---

## 0. 總覽

| 節 | 一句話 |
|---|---|
| 1 | 三種資源:HP 100(不自然恢復)、MP 100(施法)、SP 100(跑步 / 二段跳 / 翻滾 / 職業招式);MP、SP 停用一段時間後自然恢復 |
| 2 | 消耗表:法師依形狀 8 / 18 / 35 / 30 MP;非法師職業招式全部耗 SP;集氣越多花越多(×0.6 → ×1.0),A/B 模式同價;資源不夠時集氣會被「卡在買得起的程度」 |
| 3 | 打坐:M 鍵 / 手機「打坐」鈕 / 手把左搖桿按下;0.5 s 坐下後 MP 恢復 ×4、SP ×3,HP 不恢復;移動、跳、翻滾、施法、被打都會中斷 |
| 4 | HP 歸零:倒地 3 s(不能動)後原地以滿血復活並 2 s 無敵,計入「倒下次數」;也可按 R 立即重置 |
| 5 | HP 恢復來源只有:熾天使治癒、聖域結界內、復活 / R 重置 |
| 6 | UI:電腦左下、手機左上三條資源條(HP 紅 + 護盾白藍疊加、MP 藍、SP 金),只在整數值變動時寫 DOM;不足時閃紅 |
| 7 | 技術:新檔 `js/resources.js`(放 skills.js 之後、classes.js 之前),各系統用 `resUse / resCan / playerHurt / playerHeal` 掛點 |
| 8~11 | 邊界、驗收、實作順序、決定事項 |
| 12 | 土系新招點子 5 個(供挑選,不實作) |

---

## 1. 數值

### 1-1 最大值與恢復

| 項目 | 值 | 說明 |
|---|---|---|
| HP 最大 | 100 | 沿用 S-6 |
| MP 最大 | 100 | |
| SP 最大 | 100 | |
| HP 自然恢復 | **0** | 只有第 5 節的來源 |
| MP 自然恢復 | 6 / s | 最後一次花 MP 後 **1.5 s** 才開始恢復 |
| SP 自然恢復 | 15 / s | 最後一次花 SP(含跑步中每一幀)後 **1.0 s** 才開始恢復 |
| 打坐恢復 | MP ×4(24 / s)、SP ×3(45 / s) | 坐好(0.5 s 動畫完成)後立即生效,不受延遲限制;HP 仍為 0 |
| 熾天使在身邊 | MP、SP 恢復 ×1.25 | 小加成,讓輔助召喚對資源也有感(可選,見決定事項) |

從 0 回滿:MP 一般約 18 s、打坐約 4.2 s;SP 一般約 7.7 s、打坐約 2.2 s。

### 1-2 消耗表

**移動(所有職業)**

| 動作 | 消耗 | 不足時 |
|---|---|---|
| 跑步(Shift / 搖桿推到底) | SP 12 / s(只在實際移動時扣) | SP < 1 → 自動變走路;**SP 回到 ≥ 15** 才能再跑(遲滯,避免跑走跑走閃爍) |
| 地面跳 | 0 | — |
| 二段跳(空氣步) | SP 20 | 不跳,SP 條閃紅 |
| 地面翻滾 | SP 20 | 不翻,SP 條閃紅 |
| 空中側翻 | SP 15 | 不翻,SP 條閃紅 |

**法師(MP,六屬性同價;法杖 / 書不影響)**

| 形狀 | 基準 C | 實際花費 | 開始集氣門檻 |
|---|---|---|---|
| bolt(子彈) | 8 | `C × lerp(0.6, 1.0, q)` = 4.8 → 8 | ≥ 0.6C = 4.8 |
| wall(牆) | 18 | 10.8 → 18 | ≥ 10.8 |
| sky(大招) | 35 | 21 → 35 | ≥ 21 |
| summon(召喚) | 30 | 18 → 30 | ≥ 18(另有 8 s 冷卻) |

- **A / B 模式同價**(兩模式本來就是同一份集氣的不同分配,規則簡單)。
- 大招一律 35(含土系新大招「土龍術」,見 `設計_魔法調整.md` 第 15 節;覆蓋面積大但只有中等傷害,維持同價)。
- **集氣上限被 MP 卡住**:集氣中 `qCap = clamp((MP / C − 0.6) / 0.4, 0, 1)`,`G.charge = min(G.charge, qCap)`;集氣條在 qCap 位置畫一條紅色刻度,`#chargeTxt` 前面加「MP 不足・上限 64%」。這樣玩家不會集滿了才發現放不出來。
- 花費在 `release()` 當下扣除;`cancelCharge()` 不扣。

**非法師職業(SP;理由:弓、劍、匕首是體力型招式,和跑步 / 翻滾搶同一條 SP,形成「跑 vs. 出招」的取捨;MP 條對非法師顯示為灰色停用)**

| 職業 | 招式 | 基準 C(SP) |
|---|---|---|
| 弓箭手 | 瞄準射擊 / 衝擊巨箭 / 箭雨 | 6 / 18 / 30 |
| 劍士 | 蓄力斬 / 旋風斬 / 衝鋒盾 | 12 / 20 / 25 |
| 刺客 | 背刺 / 飛刀 / 潛行 | 12 / 10 / 20 |

- 花費同樣 `C × lerp(0.6, 1.0, q)`、同樣有 qCap。
- 潛行期間不持續扣(已有冷卻與時間限制)。

**HP 損失來源(目前)**

| 來源 | 傷害 | 說明 |
|---|---|---|
| 來襲測試(T / 自動來襲) | 30 | 沿用 S-6:先扣護盾 |
| 自己的法術 | 0 | 測試平台不做自傷(決定事項可改) |
| 隕石坑 / 風場 / 土牆 | 0 | 只減速,不扣血 |
| 將來的敵人 / 敵方召喚物 | 由該系統呼叫 `playerHurt(n, src)` | 掛點已預留 |

### 1-3 資源不足的 UI 回饋

- 對應資源條外框閃紅 2 次(0.4 s)。
- `banner` 小字(20 px,0.8 s):「MP 不足」/「SP 不足」;同一種 1 s 內只顯示一次。
- 快捷列:目前 MP(或 SP)< 該招門檻的格子加 class `.poor`(圖示變灰 `filter: grayscale(.8) brightness(.7)`)。

---

## 2. HP 歸零(倒下)

**預設方案**:倒地 → 3 s → 原地滿血復活。

| 步驟 | 規則 |
|---|---|
| HP ≤ 0 | `G.down = 3`(秒);取消集氣與打坐;banner「倒下」(紅,1.5 s);`G.downs++` |
| 倒地中 | 不能移動、跳、翻滾、施法、打坐(所有輸入檢查 `G.down > 0` 時 return);角色躺倒動畫(第 3-5 節);鏡頭照常 |
| 復活 | 3 s 後 HP = `CFG.res.reviveHP`(預設 100);MP / SP **不變**;`G.invulnT = 2`(期間來襲判為閃避,角色半透明閃爍:`mage.setOpacity(.5 + .5·sin(t·20))`);banner「復活」 |
| R(重置世界) | 立即 HP / MP / SP 全滿、清護盾、`downs = 0`、結束倒地 |

理由:HP 不會自然恢復,如果沒有自動復活,測試者被打光後只能找熾天使或按 R;自動復活 + 倒下計數保留了「被打死」的回饋,又不打斷測試流程。

**取代 S-6**:S-6 的「歸零只顯示倒下、2 s 後補滿、期間照常可動」改為上表(倒地不能動、3 s、2 s 無敵)。

---

## 3. 打坐

### 3-1 操作(已核對現有鍵位,不衝突)

| 平台 | 操作 | 現況確認 |
|---|---|---|
| 電腦 | **M**(Meditate) | game.js 已用:WASD、Shift、Space、F、T、Y、K、C、Home、P、H、R、Tab、Esc、X、Z、V、Q、E、1~9;scenes.js:N;魔法調整新增:G、`~`。M 未使用 |
| 手機 | 新按鈕 `#btnSit`(`.tb.sm`,文字「打坐」;`right: calc(250px + env(safe-area-inset-right)); bottom: calc(34px + env(safe-area-inset-bottom))`,翻滾鈕左側);打坐中文字變「起身」、邊框發光 | 不與 `#btnRoll(170,36)`、`#btnHit(200,110)`、`#btnMode`(左側)重疊 |
| 手把 | **左搖桿按下(10)** = 打坐 / 起身;原本 10 的「自動來襲」改為 **Y 長按 0.6 s**(短按 Y 仍是來襲測試,與手機來襲鈕的長按規則一致) | 0~15 全部已用,只能重新分配;左搖桿按下最不常誤觸 |

### 3-2 進入條件

全部成立才能坐下:`G.state === 'ready'`、`G.ground`、`!G.roll`、`G.stun <= 0`、`G.down <= 0`、`!G.dash`、`!G.spin`、沒有移動輸入(`moveInput().s === 0`)。不符合 → 小字「現在不能打坐」。潛行中可以打坐(不解除潛行)。

### 3-3 中斷條件(任一發生 → 起身)

| 事件 | 行為 |
|---|---|
| 再按一次打坐鍵 | 起身(0.3 s 動畫) |
| 移動輸入(WASD / 搖桿 > 0.3) | 立即起身並開始移動(起身動畫與走路混合,不鎖操作) |
| 跳 / 翻滾 | 立即起身並執行該動作 |
| 開始集氣(左鍵 / 施法鈕 / ZR) | 立即起身並開始集氣 |
| 被來襲打中(含被護盾擋下) | 起身;被護盾完全擋下也算(「受擊驚醒」) |
| 倒下 / 換職業 / 換場景 | 起身(瞬間) |
| 不中斷 | 切屬性、選技能、切集氣模式、轉鏡頭、召喚物行動、站在減速區 |

### 3-4 恢復

- `G.sitK`:0 → 1(坐下 0.5 s)、1 → 0(起身 0.3 s)。`G.sitK >= 1` 時 MP / SP 用打坐倍率,且無延遲。
- HP 不恢復(使用者指定)。

### 3-5 姿勢(mage.js)

`update(dt, s)` 參數新增 `s.sit`(0~1,= `G.sitK`)與 `s.down`(0~1 倒地)。全部用 `lerp(站姿, 坐姿, sit)`,在走路與施法姿勢之後、翻滾之前套用:

| 部位 | 坐姿(sit = 1) |
|---|---|
| `body.position.y` | −0.55(整個上半身下沉) |
| `body.rotation.x` | 0(上身挺直),呼吸:`sin(t·1.2)·.015` 上下 |
| 腳 `feet[0/1]` | 盤腿:位置 `(∓.16, .06, .22)`,`rotation.y = ±1.1`(腳尖朝內交叉) |
| 長袍下襬(`robeLow`、`hemRing`,法師與劍士才顯示) | `scale.y × .55`、`scale.x/z × 1.25`(坐下時袍子攤開),位置 y 跟著下沉不穿地 |
| 雙臂 | `sh.rotation = (−.55, 0, ±.28)`、`el.rotation.x = −1.25`(手放在腿上 / 膝上) |
| 頭 | `rotation.x = .12`(微低頭閉目) |
| 武器 | 法杖:立在身體右側地面 `(.42, −.05, .2)`、`rotation (0,0,−.08)`(以 body 為座標,會隨下沉,所以 y 要補 +.55);魔法書:浮在胸前 `(0, .95, .35)`、打開(`halves` 角度 .4)、緩慢上下;弓:橫放膝上 `(0, .55, .3)`、`rotation (0, 0, π/2)`;劍與盾:劍插在身前地面 `(0, −.1, .55)` 直立、盾靠在左側 `(−.45, .1, .1)` 傾斜 .3;雙匕首:交叉放膝上 |
| 倒地(`s.down`) | `body.rotation.x = −1.45`(往後躺)、`body.position.y = −.65`;手臂攤開 `(−.3, 0, ±1.2)` |

各職業外型零件(`looks` 的 Group)都掛在 body / head / arm 下,會跟著下沉,不需另外處理;弓箭手、刺客沒有長袍下襬,只靠盤腿的腳。

### 3-6 特效

- 進入:腳下 `burstRing(auraEl().hex, 1.4)`。
- 坐著時:**氣場聚集粒子**——每秒 `IS_TOUCH ? 10 : 20` 顆加亮粒子,從半徑 1.6~2.2 m、高度 0.2~1.8 m 的環上生成,速度 = 指向胸口(角色 y + .9)的向量 / 0.8 s,life .8,顏色 `auraEl().c0 → c1`(法師 = 目前屬性色,其他職業 = 職業氣場色;刺客暗色走煙池,比照 `auraTick` 的 `AE.dark` 分支)。
- 胸口一顆 `glowSprite(auraEl().hex, .9, .5)`(延遲建立),透明度 `.35 + .15·sin(t·2)`,只在 sitK > 0 時顯示。
- 法師額外:腳下符文 `runeMesh` 以 opacity .3 慢轉(沿用現有 runeGrp,`updateOrb` 裡 visible 條件加上 `G.sitK > .02`)。
- `#chargeBox` 借用顯示:`on` 狀態但隱藏 `#chargeBar`,文字「打坐中 ・ MP +24/s ・ SP +45/s」(非法師不顯示 MP 項)。

---

## 4. 與 S-6 和熾天使的整合

| 項目 | S-6 原規格 | 本文件 |
|---|---|---|
| 血量 | 100,來襲 −30 | 不變,改由 `playerHurt(30, 'strike')` 處理(含護盾、無敵、打坐中斷、倒下) |
| 歸零 | 「倒下」2 s 後補滿、照常可動 | **改為**第 2 節(倒地 3 s 不能動、復活 2 s 無敵) |
| 護盾 | 熾天使給,上限 60,8 s | 不變;**護盾不消耗 MP**(它是召喚物的能力,召喚時已付 30 MP) |
| 治癒 | 熾天使每 2 s 回 12 × fxK × scale | 改呼叫 `playerHeal(n, 'seraph')`;倒地中不能被治癒(復活規則優先) |
| 淨化 | 清暈眩 / 虛弱、4 s 免區域減速 | 不變;**另外**清除「SP 枯竭遲滯」(跑步需 SP ≥ 15 的限制,立即解除) |
| 熾天使在身邊 | — | MP / SP 恢復 ×1.25(10 m 內) |
| `#pHP` | 單一血條 | 併入新的 `#pRes` 三條容器(第 6 節);`#pHP` 的 id 保留給 HP 條 |

---

## 5. HP 恢復來源(全部)

| 來源 | 恢復量 | 條件 |
|---|---|---|
| 六翼熾天使「治癒」 | 每 2 s `12 × fxK × scale`(6 → 19) | 玩家在天使 10 m 內、未倒地 |
| 聖域結界(光系牆) | 每跳(0.4 s)**2 HP**(= 5 HP/s) | 玩家站在結界範圍內(用現有 `inZone` 判定,把玩家當成 `{x, z, y, dead:false}`);B 模式多道不疊加(每 0.4 s 最多 2) |
| 復活 | `CFG.res.reviveHP`(100) | 倒下 3 s 後 |
| R 重置世界 | 回滿 | — |

不恢復:打坐、自然恢復、其他屬性招式。治癒數字用綠色 `+n`(`addDmgText`,顏色 `#7dff8a`),HP 已滿不顯示數字。

---

## 6. UI

### 6-1 版面

| | 電腦 | 手機(橫向) |
|---|---|---|
| 容器 `#pRes` | `position:fixed; left:16px; bottom:16px; width:230px`(左下角目前空著;`#hint` 在左上、`#info` 在右側、`#gear` 右下、快捷列置中) | `left:calc(12px + env(safe-area-inset-left)); top:6px; width:150px`;`body.touch #info` 的 `top` 下移到 52px 避免重疊 |
| HP 條 `#pHP` | 高 12 px,紅 `#e04040`,底色 `rgba(0,0,0,.55)`,圓角 4;護盾段 `#pShield` 疊在 HP 右端之後(寬 = shield / hpMax,顏色 `#cfe8ff`,opacity .85) | 高 8 px |
| MP 條 `#pMP` | 高 8 px,藍 `#3a7bff`;非法師灰 `#556` 並 opacity .4 | 高 5 px |
| SP 條 `#pSP` | 高 8 px,金 `#f0c030` | 高 5 px |
| 數字 | 每條右側 11 px `72/100`(HP 加 `+30` 護盾) | 不顯示數字(只條),HP 數字放 `#info` |
| 間距 | 4 px | 3 px |

- 低於 20%:條本身以 1 Hz 脈動亮度(CSS class `.low`,`animation`)。
- 不足閃紅:class `.deny`,0.4 s × 2 的紅外框(`box-shadow: 0 0 0 2px #ff3030`),JS 加上後 800 ms 移除。
- 打坐中:`#pRes` 外框以屬性色微光(`.sit`)。
- 倒下中:`#pRes` 整體 opacity .5,HP 條上方文字「倒下 2.4」。

### 6-2 DOM 節流

- 填充用 `transform: scaleX(v)` + `transform-origin: left`(只改 transform,不觸發排版)。
- `updateResHUD()` 每幀呼叫,但只在 **四捨五入後的整數值**(或 class 狀態)與上次不同時才寫 DOM;另外最多每 100 ms 寫一次數字文字。快取在元素上(`el._v`),同現有 `infoEl._t` 的做法。

---

## 7. 技術規格

### 7-1 檔案與載入順序

新增 **`js/resources.js`**,index.html 放在 `skills.js` 之後、`classes.js` 之前(classes.js 最後呼叫 `startLoop()`,資源系統要在主迴圈開始前定義好);加入 `sw.js` PRECACHE。

理由:資源系統橫跨移動、施法、職業、召喚、HUD,放進 game.js 會讓已經 900 行的檔再變大,也會和其他寫手搶同一檔;獨立檔只透過少數函式被呼叫,掛點清楚。

### 7-2 資料結構

```js
// CFG(game.js DEFAULT_CFG 新增;P 面板可調;隨 CFG 存 localStorage)
res: {
  infinite: false,        // 測試用:不消耗任何資源
  mpRegen: 6, spRegen: 15, mpDelay: 1.5, spDelay: 1.0,
  sitMp: 4, sitSp: 3,
  runCost: 12, airJump: 20, roll: 20, airRoll: 15,
  reviveHP: 100, downTime: 3
}

// resources.js
const RES_MAX = { hp: 100, mp: 100, sp: 100 };
const MAGE_COST = { bolt: 8, wall: 18, sky: 35, summon: 30 };         // MP
const CLASS_COST = { quickShot: 6, shockArrow: 18, arrowRain: 30, powerSlash: 12, whirlwind: 20, shieldCharge: 25, backstab: 12, knives: 10, stealth: 20 };   // SP
// G 新增:mp, sp, mpMax, spMax, mpIdle, spIdle(距上次花費秒數), runLock(SP 枯竭遲滯), sitK, sitting, down, invulnT
```

`G.hp / G.hpMax / G.shield / G.shieldT / G.downs / G.slowImmT` 沿用 S-6。**不存 localStorage**(重新整理 = 全滿),只有 `CFG.res` 隨 CFG 存。

### 7-3 函式簽名(resources.js)

| 函式 | 說明 |
|---|---|
| `resInit()` | 設定 G 的資源欄位為全滿;resources.js 載入時呼叫一次 |
| `skillCost(i)` | 回傳 `{ kind: 'mp' \| 'sp', base }`:法師 `{'mp', MAGE_COST[curSkill(i).kind]}`;其他 `{'sp', CLASS_COST[curSkill(i).id] \|\| 10}` |
| `costAt(base, q)` | `base × lerp(0.6, 1.0, q)`;`CFG.res.infinite` 時 0 |
| `resCan(kind, n)` | `infinite` 或 `G[kind] >= n - 1e-6` |
| `resUse(kind, n)` | 夠就扣、`G[kind + 'Idle'] = 0`、回傳 true;不夠就 `resDeny(kind)` 回傳 false |
| `resDeny(kind)` | 條閃紅 + 小字 banner(1 s 節流) |
| `chargeCap()` | 集氣中可負擔的最大 q(見 1-2) |
| `runAllowed(dt, moving)` | 跑步判斷 + 扣 SP;回傳 true / false;處理 runLock 遲滯 |
| `playerHurt(n, src)` | 無敵 / 倒地中忽略;先扣護盾;打坐中斷;HP ≤ 0 → `playerDown()`;回傳 `{ blocked, dmg }` |
| `playerHeal(n, src)` | 倒地中忽略;夾在 hpMax;顯示綠字 |
| `playerDown()` / `playerRevive()` | 第 2 節 |
| `toggleSit()` / `sitBreak(reason)` | 第 3 節;`sitBreak` 讓 `G.sitting = false`(sitK 由 resTick 收回) |
| `resTick(dt)` | 每幀:倒地 / 無敵計時、sitK、自然與打坐恢復(含熾天使加成)、打坐粒子 |
| `updateResHUD()` | 第 6-2 節 |

### 7-4 各檔掛點

| 檔案 / 函式 | 修改 |
|---|---|
| game.js `frame` | `classTick(dt)` 之後呼叫 `resTick(dt)`;`updateHUD()` 之後呼叫 `updateResHUD()`;`mage.update` 參數加 `sit: G.sitK, down: G.downK`(倒地動畫值,resTick 維護) |
| game.js keydown | `KeyM` → `toggleSit()` |
| game.js `moveInput` 使用處(`updatePlayer`) | `mi.run = mi.run && runAllowed(dt, ix \|\| iz)`;有移動輸入且 `G.sitting` → `sitBreak('move')` |
| game.js `updatePlayer` 的 `free` | 加 `&& G.down <= 0` |
| game.js `doJump` | 開頭 `if (G.down > 0) return; if (G.sitting) sitBreak('jump');`;空中跳分支改為 `if (G.airJumps > 0) { if (!resUse('sp', CFG.res.airJump)) return; ... }` |
| game.js `tryRoll` | 原有檢查之後、`G.state = 'ready'` 之前:`if (G.down > 0) return; if (!resUse('sp', air ? CFG.res.airRoll : CFG.res.roll)) return; if (G.sitting) sitBreak('roll');` |
| game.js `startCharge` | 冷卻檢查之後:`const c = skillCost(G.skill); if (!resCan(c.kind, costAt(c.base, 0))) { resDeny(c.kind); return; }`;`if (G.down > 0) return; if (G.sitting) sitBreak('cast');` |
| game.js `updateCasting`(charging 分支) | `G.charge = Math.min(clamp(...), chargeCap())` |
| game.js `release` | 開頭 `const c = skillCost(G.skill); resUse(c.kind, costAt(c.base, q));`(chargeCap 已保證夠;infinite 時 0) |
| game.js `updateHUD` | `#chargeTxt` 加「MP 不足・上限 xx%」;集氣條加 qCap 紅刻度(`#chargeBar` 內新 `<i id="capTick">`);快捷列 `.poor` |
| game.js `strike` | 命中分支改為 `const r = playerHurt(30, 'strike'); if (r.blocked) { G.dodged++; banner('護盾擋下!') } else { 原本 stun / vy / 紅閃 }`;判定前加 `G.invulnT > 0` → 視為閃避 |
| game.js `resetWorld` | 呼叫 `resInit()`、`G.down = 0` |
| classes.js `setClass` | `sitBreak('class')`(瞬間);MP 條依職業切換啟用 / 灰 |
| touch.js | `press('btnSit', toggleSit)`;手把 `edge(10)` 改 `toggleSit()`;Y 改為短按 strike / 長按 0.6 s `toggleAuto()`(仿 `minusHold` 寫法) |
| mage.js `update` | 第 3-5 節的 sit / down 姿勢 |
| spells.js `castSanctuary` 的 `onTick` | 加:`const pl = { x: p.x, z: p.z, y: p.y, dead: false }; if (inZone(pl, c)) playerHeal(2, 'sanctuary');`(p = `mage.root.position`;同一幀多道結界用 `G.healTick` 時間戳防疊加) |
| summons.js(熾天使) | 治癒改 `playerHeal`;淨化加 `G.runLock = false`;恢復加成:resTick 內檢查 10 m 內有活的熾天使 |
| index.html | `#pRes`(含 `#pHP`、`#pShield`、`#pMP`、`#pSP` 與數字 span)、`#btnSit`、`#capTick` 與 CSS;`#hint` 加「M 打坐(加速恢復 MP / SP)」;script 標籤 |
| game.js `PANEL` | 新標題「資源」:`res.infinite`(無限資源)、`res.mpRegen`(0~30)、`res.spRegen`(0~60)、`res.sitMp`(1~10)、`res.sitSp`(1~10)、`res.runCost`(0~40) |

---

## 8. 邊界情況

| 情況 | 預期 |
|---|---|
| 集氣中 MP 正好用完 | 集氣條停在 qCap,紅刻度顯示;放開照常施放(以 qCap 的強度) |
| MP < 門檻時按施法 | 不進入集氣,MP 條閃紅、小字「MP 不足」 |
| 跑步時 SP 歸零 | 自動變走路;SP ≥ 15 才能再跑 |
| 二段跳 SP 不足 | 不跳(地面跳不受影響) |
| 打坐時被來襲擊中但護盾全擋 | 不扣血、但起身 |
| 打坐中切屬性 / 選技能 | 不中斷 |
| 打坐中在隕石坑恢復而地面升起 | 角色被頂起,繼續打坐(仍在地面上) |
| 打坐中潛行時間到 | 潛行顯形照常;打坐不中斷 |
| 倒地時有召喚物 | 召喚物照常行動;熾天使不能治癒倒地者 |
| 倒地時切職業 / 換場景 | 不允許切職業(state 檢查);換場景照常、倒地計時繼續 |
| `infinite` 開啟 | 所有消耗為 0、qCap = 1;HP 仍會被扣(只免消耗) |
| 衝鋒盾冷卻、旋風斬持續 | 只在 release 扣一次 SP |
| 書 / 法杖切換 | 消耗不變 |

---

## 9. 驗收

1. 進遊戲:左下(手機左上)看到 HP 100、MP 100、SP 100 三條;非法師 MP 條為灰。
2. 按住 Shift 跑:SP 每秒約 −12;放開 1 s 後開始回升;SP 歸零自動變走路,回到 15 才能再跑。
3. 二段跳扣 20、地面翻滾扣 20、空中側翻扣 15;SP < 20 時二段跳無效且 SP 條閃紅。
4. 法師各形狀(0% 立即放 / 100%)的 MP 花費符合 1-2 表;MP 只剩 25 時用大招集氣:集氣條停在約 29%(qCap = (25/35 − 0.6) / 0.4 ≈ 0.29),紅刻度出現、文字顯示「MP 不足・上限 xx%」;MP 低於 21 時按大招不能集氣。
5. 切弓箭手:招式花 SP,不花 MP。
6. 按 M:0.5 s 坐下成盤腿姿勢(四職業各看一次,武器擺放合理、不穿地);氣場粒子往胸口聚集;MP / SP 恢復速度明顯加快(約 24 / 45 每秒);HP 不變。
7. 打坐中按 WASD / Space / F / 左鍵 / 被 T 來襲打中 → 都會起身;切屬性不會。
8. 手機 `?touch=1` 點「打坐」鈕;手把左搖桿按下打坐;手把 Y 短按來襲、長按切自動來襲。
9. 連續被來襲打 4 次(不閃避):HP 歸零 → 倒地躺下 3 s → 原地滿血復活並閃爍 2 s(期間來襲不扣血);`#info` 倒下次數 +1。R 立即全滿。
10. 召喚熾天使:HP 每 2 s 回復、跳綠字;站進聖域結界每秒約 +5;滿血時不跳數字。
11. P 面板「無限資源」打開:所有動作不扣 MP / SP。
12. DOM 節流:在 Chrome Performance 錄 5 s 站著不動,`#pRes` 沒有每幀的樣式重算;F12 無錯誤。

---

## 10. 實作順序與拆分

**前提:`設計_魔法調整.md` 階段 0(含 S-6)已完成、實測、合併。** 本文件的工作全部會碰共用檔,不能與階段 0 並行;可與其階段 1(sp_water / sp_wind / sp_fire)並行,但 summons.js 的熾天使掛點要等 S-1 / S-2 熾天使完成。

| 步 | 內容 | 檔案 |
|---|---|---|
| R-1 | resources.js 骨架(資料、resInit、resCan / resUse、resTick 自然恢復)+ HUD 三條 + 節流 + P 面板 | resources.js、index.html、game.js(frame / PANEL / DEFAULT_CFG) |
| R-2 | 移動消耗(跑 / 二段跳 / 翻滾)與不足回饋 | game.js、resources.js |
| R-3 | 施法消耗、qCap、快捷列 `.poor`、非法師 SP | game.js、resources.js |
| R-4 | playerHurt / 倒下 / 復活(取代 S-6 歸零規則)、strike 改寫、R 重置 | game.js、resources.js、mage.js(倒地姿勢) |
| R-5 | 打坐(操作、條件、中斷、姿勢、特效)、手機鈕、手把重配 | resources.js、mage.js、touch.js、index.html |
| R-6 | HP 恢復來源:聖域結界、熾天使改呼叫 playerHeal、恢復加成、淨化解除 runLock | spells.js、summons.js |

R-1~R-5 由同一位寫手依序做(都動 game.js);R-6 在熾天使完成後做。

---

## 11. 需要使用者決定的事項(括號為預設)

1. **非法師職業的資源**:(招式全部耗 SP,MP 條灰掉不用)/ 也耗 MP。
2. **集氣越多是否花越多**:(是,×0.6 → ×1.0;MP 不夠時集氣被卡在買得起的程度)/ 固定價。
3. **A / B 模式同價**:(是)。
4. **HP 歸零**:(倒地 3 s、原地滿血復活、2 s 無敵、計入倒下次數)/ 只能按 R 復活 / HP 下限 1 不會倒。
5. **自己的法術是否傷到自己**:(否)。
6. **打坐鍵**:(電腦 M、手機「打坐」鈕、手把左搖桿按下,自動來襲改為 Y 長按)。
7. **打坐倍率**:(MP ×4、SP ×3;HP 不恢復)。
8. **熾天使在身邊時 MP / SP 恢復 ×1.25**:(有)/ 無。
9. **聖域結界可治癒玩家 5 HP/s**:(有)/ 只有熾天使能治癒。
10. **資源數值不存檔**:(重新整理就全滿)。
11. **跑步遲滯門檻**:(SP 歸零後要回到 15 才能再跑)。

---

## 12. 語音內容的解讀

| 原文 | 解讀 |
|---|---|
| 火隕石留給火系 | 火系大招維持「隕石墜擊 + 隕石坑」(`設計_魔法調整.md` 第 7 項),不移給其他屬性 |
| 土系我們在想一個 | 使用者想為土系再構思一招 → 本文件第 13 節只列點子,不決定、不實作 |
| 特殊動作 | 翻滾、空中側翻,以及職業的位移招式(衝鋒盾、背刺閃身、旋風斬) |

註:原始語音全文未提供給本設計者;以上依主對話整理推測,其他錯字若影響理解請更正。

---

## 13. 土系可能的新招式點子(供使用者挑選,不實作)

現有土系:岩彈術(bolt)、石牆術(wall)、地裂石柱(sky)、石頭人(summon,砸地升土牆 + 減速)。

| # | 點子 | 玩法一句話 | 與現有重複? |
|---|---|---|---|
| 1 | **岩甲護體** | 花 MP 讓岩石包覆自身,獲得 40 點護盾(與熾天使護盾共用上限 60)並在 8 s 內免疫擊退 / 暈眩,代價是移動 −20%、不能跑 | 不重複;第一個「玩家自用」的防禦招,能直接測試新的 HP / 護盾系統 |
| 2 | **流沙陷阱** | 地面一圈流沙,範圍內目標減速 70% 並被慢慢拉向中心、身體下陷 0.5 m,持續 6 s | 與石頭人土牆、隕石坑**部分重複**(都是區域減速);差別在「拉向中心 + 下陷」 |
| 3 | **震盪波** | 雙手拍地,向前方扇形(60°、8 m)推出一道地面波,波上的標靶全部倒地 1.5 s | 不重複;土系目前沒有「倒地控場」(只有弓箭手衝擊巨箭有) |
| 4 | **大地之息** | 腳踏地面 5 s:SP 恢復 ×3、免疫區域減速,站立不動時 MP 也加速恢復 | 與打坐**部分重複**(都是恢復);差別在可移動、偏 SP,適合跑酷 / 二段跳路線測試 |
| 5 | **岩槍突進** | 沿直線衝刺 8 m(花 SP),身後一路冒出小石刺,碰到的標靶被小擊飛 | 與地裂石柱**視覺部分重複**(石刺);定位是法師少有的位移招 |
