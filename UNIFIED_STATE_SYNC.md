# Unified State Sync — 現況評估（更新版）

## 資料層架構

```
使用者操作（Inspector / cy 互動）
            ↓
    cy（canvas，Cytoscape.js）
            ↕  _skipCySync 防循環
nodes / edges / positions Maps（拓樸 SSOT）
            ↕
D / S / R（各 tab JS 物件）
externals 已併入 node.externals
            ↓
Draft.js → localStorage（per-topo key）
    ↓ markDirty 1.5s
CF Workers R2（手動同步按鈕）
    + BroadcastChannel（edit → index）
```

---

## 已完成

### 資料物件

| 變數 | 類型 | 狀態 |
|------|------|------|
| `nodes` Map | `Map<id, data>` | ✅ SSOT，含 node.externals |
| `edges` Map | `Map<id, data>` | ✅ SSOT |
| `positions` Map | `Map<id, {x,y}>` | ✅ SSOT |
| `externals` | ~~Array~~ | ✅ 已併入 node.externals，獨立陣列移除 |
| `D` / `S` / `R` | Object / Array | ✅ 各 tab 直接讀寫，render 末端呼叫 markDirty() |

### 寫入路徑

| 寫入方 | 路徑 | 狀態 |
|--------|------|------|
| Inspector 欄位 | applyField → Maps → _skipCySync → cy | ✅ Maps 優先 |
| stubs chip | save() → Maps → cy | ✅ Maps 優先 |
| cy 互動（拖曳）| cy event → Maps（_skipCySync 擋回寫）| ✅ |
| Tab 編輯器（D/S/R）| 直接寫 JS 物件 + markDirty() | ✅ |
| 改名（renameEle）| cy + D/S/R/externals 同步 | ✅ |
| Ghost 元素過濾 | isGhost() 攔截 add/remove 事件 | ✅ |

### 持久化

| 層 | 狀態 |
|----|------|
| localStorage | ✅ Draft.js 共用模組，per-topo key，2小時有效期 |
| BroadcastChannel | ✅ edit → index 即時廣播，per-topo key |
| Remote（R2）| ✅ CF Workers + R2，手動按鈕，per-topo key |
| 載入優先序（edit）| ✅ 本地 > remote > JS |
| 載入優先序（index）| ✅ 廣播 > 本地 > remote > JS |
| topo URL 參數 | ✅ `?topo=xxx`，兩頁互傳，連結自動帶參數 |

### 初始化

| 項目 | 狀態 |
|------|------|
| 狀態變數集中頂部 | ✅ 單一狀態宣告區，TDZ 解除 |
| D/S/R 在 hydrateAll 之前 | ✅ |
| hydrateAll 期間屏蔽 markDirty | ✅ `_hydrating` flag |

---

## 未實作（已評估不做）

### Pub/Sub / Proxy 架構（Phase 2-3）

原計畫用 EventBus + Proxy 讓所有 Maps 寫入自動 fan-out。

**評估後決定不做的原因：**
- `_skipCySync` 已解決 Inspector → Maps → cy 的循環問題
- D/S/R 深層 mutation 用 `markDirty()` 手動補救足夠
- Pub/Sub 引入的複雜度（topics 漏訂、source flag、debounce 層數）超過收益
- 這個規模的工具 `markDirty()` 的散落不是痛點

---

## 現有設計原則

| 原則 | 實作方式 |
|------|---------|
| Maps 是 SSOT | applyField / stubs 寫 Maps 而非 cy |
| cy 是 renderer | _skipCySync 讓 cy 只被動跟上，不主動觸發 Maps 更新 |
| D/S/R 獨立 | 各 tab 直接讀寫，render 末端呼叫 markDirty() 觸發持久化 |
| 持久化統一 | Draft.js 共用模組，兩頁共用 per-topo key 格式 |
| Remote 手動 | 按鈕觸發，避免 R2 quota 浪費 |

---

## 剩餘已知問題

| 問題 | 嚴重度 | 說明 |
|------|--------|------|
| D/S/R 深層 mutation 無法自動偵測 | 低 | markDirty() 手動補救，render 末端已加 |
| index.html 無法直接載入雲端 rtt/demand/srlg | 中 | 目前只同步 topology，其餘三份仍靠本機 .js 檔 |
| RTT_OK=false 時優化器無下限約束 | 中 | 無 RTT 時 p2p 欄位顯示琥珀條警示，使用者知情 |
