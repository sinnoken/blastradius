# Topocide

**OSPF 骨幹網路韌性審計工具 — 量化失效衝擊、壅塞風險與成本最佳化。**

---

## 解決的問題

骨幹網路工程師在設計與維運中面對三個反覆出現的痛點：

| 痛點 | 難在哪裡 |
|------|---------|
| **失效情境難估算** | 一條電路或一台路由器斷掉，流量往哪跑、哪段會滿、哪些 prefix 失去備援——靠人腦或 Excel 無法快速算清楚 |
| **壅塞情境難估算** | 現有 OSPF 權重是否讓流量分配均勻？worst-case 在哪條鏈路？SRLG 同時斷掉之後容量夠不夠？ |
| **鏈路維運成本難估算** | 哪組權重讓 MLU 最低？現有成本和 RTT 延遲之間偏離多少？如何在不違反物理約束下自動找到更好的設定？ |

**Topocide 的做法**：匯入 OSPF LSDB、RTT、SRLG、訊務需求矩陣、鏈路容量，用演算法計算後視覺化呈現，並提供節點、鏈路、成本、RTT 各維度的最佳化。

---

## 工具定位

| 項目 | 說明 |
|------|------|
| **用途** | 設計審計 + 演練前的衝擊預計算 |
| **不是** | 即時監控 / 設備推送 |
| **資料輸入** | `topology.js` 靜態匯入，或貼上 `show ip ospf database` 輸出自動解析 |
| **架構** | 純前端靜態頁面，無後端、無 build step |

---

## 功能總覽

### 分析視角（C1–C9）

| Tab | 功能 |
|-----|------|
| **C1 路徑** | 任意點對最短路徑（SPT + ECMP），自動分類主/備路徑，掃描無備援段 |
| **C2 矩陣** | 全點對成本矩陣或 RTT/SLO 模式（實際路徑延遲 vs SLO 目標，覆蓋率統計）|
| **C3 中心性** | 鏈路/節點介中心性清單，標出純備援電路（正常零流量）|
| **C4 邊流量** | 以訊務矩陣算出各鏈路實際負載與利用率，標出超載 |
| **C5 失效模擬** | 單元素或整個 SRLG 群組同時故障；顯示連通性、流量重分配、容量溢出 |
| **C6 ECMP** | 對每個 ECMP 組逐一切斷成員，確認殘餘 ECMP 能否接手 |
| **C7 非對稱** | 去回路徑或成本不同的點對清單 |
| **C8 前綴** | Subnet 備援熱力圖：≥2 節點宣告 = 有備援，僅 1 = 單點依賴 |
| **C9 N-1** | 列舉所有單點故障，排列「最脆弱點對」與「最致命故障情境」|

### 最佳化（C10）

| 功能 | 說明 |
|------|------|
| **鏈路成本編輯** | 即時編輯去/回程成本，路徑即時重算 |
| **壅塞最佳化** | Fortz-Thorup 目標函數 + Tabu Search，自動搜尋降低 MLU 的權重組合，RTT 物理下限約束 |
| **RTT 參考欄** | 每條鏈路依 RTT 推算建議成本，偏離時琥珀條標示 |

---

## 使用方式

因為 `engine.js` 是 ES module，需要透過 HTTP 伺服器開啟：

```bash
cd /mnt/workspace/output && python serve.py
# 開啟 http://localhost:8000/
# serve.py 回傳 no-cache header，改版後立即生效
# python -m http.server 有約 1 分鐘快取延遲
```

也可使用 VS Code Live Server，或部署到 GitHub Pages / CF Pages。

### 輔助工具

| 頁面 | 用途 |
|------|------|
| `/edit.html` | 4 分頁資料編輯器（topology / demand / SRLG / RTT）；匯入 OSPF LSDB；雲端同步（CF Workers + R2）|
| `/metro-tune.html` | 地鐵圖佈局互動調參，調好後複製 `LAYOUT_PARAMS.metro` 貼回 `edit.html` |

### 基本互動

| 操作 | 效果 |
|------|------|
| 右鍵鏈路 | 切換故障狀態（跨 tab 持久）|
| 右鍵路由器 | 切換節點故障 |
| 左鍵拖曳 | 重排版面 |
| 清除所有故障 | 一鍵重置 |

---

## 資料輸入

更換成自己的網路：替換 `topology.js`（格式見 [SPEC.md](./SPEC.md)）。也可在 edit.html 貼上 OSPF LSDB 輸出自動建圖，再補上 demand / SRLG / RTT 資料。

---

## 技術架構

- **Cytoscape.js** — 圖形渲染
- **Tailwind CDN** — UI 樣式
- **Vanilla ES module** — 無 build step，純靜態頁面
- **CF Workers + R2** — 雲端資料同步（可選）

---

## 限制與風險

1. 目前僅支援 **單 area / pure area 0**，不含 ABR 跨區彙整 LSA
2. LSA5 外部路由僅做 exact match + 預設路由 fallback，非完整 LPM
3. 無即時從路由器自動拉取拓樸（CLI `show` 輸出可手動匯入）
4. 內建資料為合成樣本，正式評估前需替換為真實網路資料

---

## Roadmap

- [x] SRLG 群組失效（海纜/共管/機房/上游）
- [x] RTT / SLO 矩陣覆蓋率
- [x] OSPF LSDB 解析匯入
- [x] 壅塞最佳化（Fortz-Thorup + Tabu）
- [x] edit.html + 雲端同步（CF Workers + R2）
- [ ] C10 最佳化 v2（N-1 存活閘、RTT 繞行上限、頻寬成本）
- [ ] 顯式路徑引導（steer）+ 頻寬准入（CAC）
- [ ] 多 area / OSPF 跨區成本計算

---

詳細演算法與資料模型見 [SPEC.md](./SPEC.md)。
