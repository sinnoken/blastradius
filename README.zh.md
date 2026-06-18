# BlastRadius

**OSPF / IGP 韌性審計工具 — 看清一條鏈路、一台 Router 倒下時,網路會炸出多大半徑**

---

## 專案概述(Executive Summary)

BlastRadius 是一個**單檔 HTML** 的網路拓樸分析工具,把「最短路徑」、「ECMP 等成本路徑」、
「失效模擬」、「N-1 / SRLG worst-case 排行」這些原本散落在試算表、Visio、CLI 跟人腦裡的
工程動作,集中到同一張可互動的拓樸圖上。

定位是 **設計階段的韌性審計** + **事故演練前的爆炸半徑試算**,**不是**即時監控。

| 項目 | 內容 |
|------|------|
| **專案階段** | POC — 功能完成、可展示 |
| **交付型態** | 純前端靜態網頁(無後端、無 build step) |
| **核心價值** | 把「網路斷掉時長什麼樣子」變成可點、可審計、可排行的視圖 |
| **資料來源** | 拓樸 / 流量 / RTT 為合成資料,可替換為自有網路 |

---

## 範圍與目標對象(Scope & Stakeholders)

**目標使用者**

- **OSPF / 骨幹網路工程師** — 審查現有設計的單點 / 共同風險暴露面
- **網路規劃 / 容量團隊** — 失效情境下的流量重分配與容量溢出試算
- **維運 / 事故演練** — 演練前先算清楚「拔哪條會痛、痛多大」

**本工具做什麼 vs 不做什麼**

| 範圍內 | 範圍外 |
|--------|--------|
| 單一 Area(area 0)SPT / ECMP 計算 | 多 Area / inter-area summary LSA |
| 單點 + SRLG 群組失效模擬 | 即時遙測 / 線上監控 |
| 流量矩陣驅動的鏈路利用率 | **即時**從 router 自動拉 LSDB(文字 `show` 輸出可匯入) |
| 設計層級的 N-1 worst-case 排行 | 設備設定產生 / 下發 |

---

## 狀態與里程碑(Milestones)

| 里程碑 | 狀態 |
|--------|------|
| C1–C10 十大分析分頁 | ✅ 完成 |
| SRLG(海纜 / 共管 / 機房 / 上游)群組失效 | ✅ 完成 |
| 流量矩陣 + 多情境快照(月均 / 最壞 / 區域忙時) | ✅ 完成 |
| 確定性資料產生器(同輸入永遠 byte-identical) | ✅ 完成 |
| OSPF 權重壅塞最佳化(Fortz-Thorup 目標 + Tabu 搜尋) | ✅ 完成 |
| 明確路徑導流(steer)+ 頻寬准入(CAC) | ⬜ 規劃中(見 steer.md) |
| SLO 矩陣覆蓋(C2 每 pair 路徑 RTT vs SLO 目標,覆蓋率 %) | ✅ 完成 |
| LSDB → `topology.js` parser(貼上 / 檔案 `show ip ospf database`) | ✅ 完成 |
| 多 Area / OSPF inter-area cost | ⬜ 規劃中 |

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
| SRLG 群組失效 | ❌ | ✅ 海纜 / 共管 / 機房 / 上游 |
| **N-1 worst-case 排行** | ❌ | ✅ 「最脆弱 pair / 最致命失效」 |
| **OSPF 權重壅塞最佳化** | ❌ | ✅ Fortz-Thorup + Tabu(自動壓低 MLU) |

---

## 如何執行(How to Run)

因為 `engine.js` 是 ES module,瀏覽器不允許 `file://` 載入,需用 HTTP 啟動:

- **命令列**:`cd /mnt/workspace/output && python serve.py` → 瀏覽器開 `http://localhost:8000/`（`serve.py` 回傳 `Cache-Control: no-store`,改版後立即生效；`python -m http.server` 有約 1 分鐘快取延遲）
- **VS Code**:裝 Live Server 擴充套件 → 右鍵 `index.html` → "Open with Live Server"
- **GitHub Pages**:Repo Settings → Pages → 啟用後直接開 `https://<user>.github.io/<repo>/`

### 輔助頁面

| 頁面 | URL | 用途 |
|------|-----|------|
| **資料編輯器** | `/edit.html` | 4 分頁編輯（topology / demand / SRLG / RTT）；匯入 OSPF LSDB；匯出回 `.js`。依賴：Cytoscape core + cxtmenu + Tailwind CDN；建邊與 undo/redo 自寫（不用外掛）。載入順序：`dagre` 必須早於 `cytoscape-dagre`。 |
| **Metro Map 調參器** | `/metro-tune.html` | 八向化佈局的互動調參工具 — 即時調整格點大小、迭代輪數、壓縮模式、方向數（8 / 16 / 32 向），邊依八向化狀態著色（綠=達標、橙=近似、紅=未達標）；調好後複製 `LAYOUT_PARAMS.metro` 貼回 `edit.html` |

### 互動操作

| 操作 | 效果 |
|------|------|
| **左鍵拖曳節點** | 重新排版 |
| **右鍵點鏈路** | 切換故障狀態(持久,跨 Tab 保留) |
| **右鍵點 Router** | 切換節點故障(Pseudo-node 為 LSA2 抽象,不可故障) |
| **左側「清除所有故障」** | 一鍵還原 |
| **左側「隱藏 Pseudo-node」** | 只看實體 Router 拓樸,排除 LSA2 抽象 |

### 故障模式語意

- **右鍵故障**:模擬「現在線路掛了」 — 即時狀態組分頁即時反映。
- **設計審計組**:完全忽略右鍵故障,基於原始完整拓樸 — 因為審計問的是「設計本身夠不夠韌」,不是「現在通不通」。

---

## Tab 功能總覽

### 即時狀態組(吃圖上故障標記)

| Tab | 編號 | 用途 |
|-----|------|------|
| **路徑** | C1 | Source → Destination 最短路徑(SPT + ECMP),自動判定 PRIMARY / BACKUP MODE,附 Unbackup 段掃描 |
| **矩陣** | C2 | 全 Router pair 矩陣 — **成本** 或 **RTT / SLO** 模式(預設 RTT:每 pair 路徑 RTT vs SLO 目標,附覆蓋率 %);底色分階,標記 ECMP / 非對稱 |
| **樞紐度** | C3 | 鏈路 / 節點介數中心性盤點(節點可切**過路數 ⇄ 流量加權**)+ 純備援電路(平時零流量的鏈路) |
| **邊流量** | C4 | 依流量矩陣計算每條鏈路實際負載與利用率,標出過載 / 高水位 |

### 設計審計組(忽略右鍵故障,基於完整拓樸)

| Tab | 編號 | 用途 |
|-----|------|------|
| **失效模擬** | C5 | 選單一元件或整組 SRLG 同時失效,檢視連通性、分群、流量重分配與容量溢出 |
| **N-1** | C9 | 枚舉所有單點失效,排出**最脆弱 pair** + **最致命失效情境** |
| **ECMP** | C6 | 對每對 ECMP pair,模擬砍掉群組內任一邊,確認剩餘 ECMP 仍能接手 |
| **非對稱** | C7 | A→B 與 B→A 路徑或 cost 不同的 pair |
| **Prefix** | C8 | Subnet 備援熱圖 — 被 ≥2 節點宣告 = backed-up,僅 1 = non-backuped |

### 編輯組

| Tab | 編號 | 用途 |
|-----|------|------|
| **鏈路** | C10 | 即時修改 link cost(可分別設正反向,非對稱 p2p);內建**壅塞最佳化**(Fortz-Thorup 目標 + Tabu 自動搜權重壓低 MLU);RTT 換算的參考建議值;匯出 `topology.js` |

---

## 技術棧

- **Cytoscape.js** — 圖形渲染
- **Tailwind CDN** — UI 樣式
- 純 vanilla JavaScript ES module,無 build step

---

## 風險與限制(Risks & Limitations)

1. 目前只支援 **單一 Area / 純 area 0** — 沒有 ABR / inter-area summary LSA 處理
2. LSA5 external 只有「精確匹配 + default route fallback」,無完整 LPM
3. 沒有 cost-as-latency 的 telemetry feed — 想做 latency-aware SPF 還需要對接 RFC 7471 的資料源
4. 拓樸可用靜態 `topology.js`,或從貼上 / 檔案的 `show ip ospf database router/network` 輸出匯入(資料編輯器的 OSPF 匯入);**即時**從 router 自動拉(SNMP/API)仍是未來方向
5. 內建資料為**合成樣本**,正式評估前需替換為自有網路的真實拓樸 / 流量

---

## Roadmap

- [x] SRLG(Shared Risk Link Group)海纜群組失效 — N-1 進階成 N-K
- [x] SLO 矩陣覆蓋 — C2 RTT / SLO 模式(每 pair 路徑 RTT vs SLO 目標,覆蓋率 %)
- [x] LSDB → `topology.js` parser — 經資料編輯器貼上 / 檔案 `show ip ospf database`
- [ ] C10 壅塞最佳化 v2 — N-1 生存性閘、RTT 繞道上限、頻寬單位成本、異動上限;設計見 [C10-next.md](./C10-next.md)
- [ ] 明確路徑導流(steer / TE):把特定流量拉離最短路 + 頻寬准入(CAC,「填滿才溢出 / admission 失敗」)— 規劃見 [steer.md](./steer.md)
- [ ] 多 Area / OSPF inter-area cost 計算
- [ ] Flex-Algo (RFC 9350) 多 SPF 並行視覺化

---

要換成自己的網路:替換 `topology.js`(Schema 見 [SPEC.zh.md](./SPEC.zh.md))。詳細演算法與資料模型亦見 [SPEC.zh.md](./SPEC.zh.md)。
