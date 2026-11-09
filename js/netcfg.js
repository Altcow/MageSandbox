'use strict';
// 線上連線設定。dbUrl 由使用者提供 Firebase 資料庫網址後填入(設計_多人連線.md N0);apiKey 只在啟用匿名驗證時才需要。
// dbUrl 為空字串 = 線上功能停用:只能用 ?net=stub 在同一台電腦測試,其他情況大廳回報 noconfig。
const NET_CFG = { dbUrl: '', apiKey: '' };
