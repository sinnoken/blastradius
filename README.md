# BlastRadius

**OSPF / IGP 韌性審計工具 — 看清一條鏈路、一台 Router 倒下時,網路會炸出多大半徑**

BlastRadius 是一個單檔 HTML 的網路拓樸分析 POC,專為 IGP(OSPF / IS-IS)骨幹工程師設計。
它把「最短路徑」、「ECMP 等成本路徑」、「失效模擬」、「N-1 worst-case 排行」這些原本散落在
試算表、Visio、CLI 跟人腦裡的工程動作,集中到同一張可互動的拓樸圖上。

---

## 為什麼不是另一個拓樸瀏覽器

市面上多數工具側重「畫出網路長什麼樣子」。BlastRadius 側重的是 **「網路斷掉時長什麼樣子」**:

| 功能 | 一般拓樸瀏覽器 | BlastRadius |
|------|----------------|-------------|
| 顯示鏈路 / 節點 | ✅ | ✅ |
| 計算最短路徑 | ✅ | ✅ (含 ECMP) |
| 失效後重算 SPT | ⚠ 部分支援 | ✅ Tab 內建情境 |
| 找出純備援電路 | ❌ | ✅ 全 Pair 掃描 |
| Unbackup 段偵測 | ❌ | ✅ 單點故障敏感度 |
| ECMP 完整性審計 | ❌ | ✅ 砍邊測試 |
| 非對稱路徑偵測 | ❌ | ✅ |
| Subnet 備援熱圖 | ❌ | ✅ 基於 LSA |
| **N-1 worst-case 排行** | ❌ | ✅ 「最脆弱 pair / 最致命失效」 |

定位是 **設計階段的韌性審計** + **事故演練前的爆炸半徑試算**,不是即時監控。

---

## 快速上手

1. 把 `blastradius-poc.html`、`topology.js`、`engine.js` 三個檔放在同一資料夾
2. 用 HTTP 啟動(因為 `engine.js` 是 ES module,瀏覽器不允許 `file://` 載入):
   - **VS Code**:裝 Live Server 擴充套件 → 右鍵 HTML → "Open with Live Server"
   - **命令列**:`python -m http.server 8000` → 瀏覽器開 `http://localhost:8000/blastradius-poc.html`
3. 預設載入跨國 ISP 骨幹樣本(10 個 PoP,跨亞太/北美/歐洲)

### 互動操作

| 操作 | 效果 |
|------|------|
| **左鍵拖曳節點** | 重新排版 |
| **右鍵點鏈路** | 切換故障狀態(持久,跨 Tab 保留) |
| **右鍵點 Router** | 切換節點故障(Pseudo-node 為 LSA2 抽象,不可故障) |
| **左側「清除所有故障」** | 一鍵還原 |
| **左側「隱藏 Pseudo-node」** | 只看實體 Router 拓樸,排除 LSA2 抽象 |

### 故障模式語意

- **右鍵故障**:模擬「現在線路掛了」 — Tab `C1 / C2 / C3` 即時反映。
- **Tab 內建情境**:`C4 失效模擬` 自帶 what-if,獨立於右鍵狀態。
- **設計審計(C5 / C6 / C7 / C8)**:完全忽略右鍵故障,基於原始拓樸 — 因為審計問的是「設計本身夠不夠韌」,不是「現在通不通」。

---

## Tab 功能總覽

### 即時狀態組(吃右鍵故障)

| Tab | 編號 | 用途 |
|-----|------|------|
| **路徑** | C1 | Source → Destination 最短路徑(SPT + ECMP),自動判定 PRIMARY / BACKUP MODE,附 Unbackup 段掃描 |
| **矩陣** | C2 | 全 Router pair 最短路徑 cost 矩陣,底色深淺呈現 cost 大小,標記 ECMP / 非對稱 |
| **全 Pair** | C3 | 全 Pair 路徑列表 + 純備援電路盤點(平時零流量的鏈路) |

### What-if 模擬

| Tab | 編號 | 用途 |
|-----|------|------|
| **失效模擬** | C4 | 選一台 Router 失效,顯示連通性、分群、流量重分配(斷線 / ↑ 增加 / ↓ 減少) |

### 設計審計組(忽略右鍵故障)

| Tab | 編號 | 用途 |
|-----|------|------|
| **ECMP 檢查** | C5 | 對每對 ECMP pair,模擬砍掉群組內任一邊,確認剩餘 ECMP 仍能接手 |
| **非對稱** | C6 | A→B 與 B→A 路徑或 cost 不同的 pair |
| **Heatmap** | C7 | Subnet 備援熱圖 — 被 ≥2 節點宣告 = backed-up,僅 1 = non-backuped |
| **N-1** | C8 | 枚舉所有單點失效,排出**最脆弱 pair** + **最致命失效情境** |

### 拓樸編輯

| Tab | 用途 |
|-----|------|
| **鏈路** | 即時修改 link cost,可分別設正反向(非對稱 p2p),支援匯出 `topology.js` |

---

## 樣本拓樸

預設載入的是「**10 國 ISP 骨幹**」場景,設計時把各種 OSPF 行為都埋了至少一個觸發點:

- **亞洲六國** (TPE / TYO / ICN / HKG / SIN / SYD) + **美洲** (LAX) + **歐洲三國** (LHR / FRA / AMS) 共享 IX 平台 (`PN_EU` = LSA2 pseudo-node)
- **ECMP 觸發點**:HKG → TYO 有兩條等成本路徑(直達 vs 經 TPE)
- **非對稱觸發點**:HKG ↔ ICN(cost 20 / 35)、SIN ↔ SYD(cost 30 / 45)
- **Trans-Pacific 單點**:LAX 是亞洲 ↔ 歐洲的唯一接點,失效會把網路分裂
- **Unbackup 段**:AMS ↔ PN_EU 是唯一通往 AMS 的 transit,移除即斷
- **LSA5 external**:TPE 對外宣告 `0.0.0.0/0`(預設路由)

要換成自己的網路:改 `topology.js` 即可,Schema 見 [SPEC.md](./SPEC.md)。

---

## 技術棧

- **Cytoscape.js** — 圖形渲染
- **Tailwind CDN** — UI 樣式
- 純 vanilla JavaScript,無 build step

---

## 已知限制

1. 目前只支援 **單一 Area / 純 area 0** — 沒有 ABR / inter-area summary LSA 處理
2. LSA5 external 只有「精確匹配 + default route fallback」,無完整 LPM
3. 沒有 cost-as-latency 的 telemetry feed — 想做 latency-aware SPF 還需要對接 RFC 7471 的資料源
4. 拓樸資料是手寫 `topology.js`,沒有 LSDB parser(從 router show 指令直接 import 是未來方向)

---

## Roadmap

- [ ] SRLG (Shared Risk Link Group) 海纜群組失效 — N-1 進階成 N-K
- [ ] SLO 矩陣覆蓋(每 pair 設定 max cost,標出未達標)
- [ ] LSDB → `topology.js` parser
- [ ] 多 Area / OSPF inter-area cost 計算
- [ ] Flex-Algo (RFC 9350) 多 SPF 並行視覺化

---

詳細演算法與資料模型請見 [SPEC.md](./SPEC.md)。
