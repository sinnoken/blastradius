# BlastRadius — 維護指引

OSPF/IGP 韌性審計單頁式 SPA(Cytoscape.js + Tailwind CDN + vanilla ES module,無 build step)。
**專案持續維護**(index.html / engine.js / 文件都會改);**dataset 穩定** — 沒事不用重產,
需要時才跑 `working/gen.mjs`。「凍結」的是資料,不是專案。

## 檔案結構(完整可跑只需這 6 檔,全在本目錄)

| 檔 | 性質 | exports |
|----|------|---------|
| `index.html` | 前端 UI,**手維護**,可直接編輯 | — |
| `engine.js` | 純演算法 ES module(每函式 export,無 DOM/Cytoscape/全域依賴) | 每函式 export |
| `topology.js` | 拓樸資料,generated | global const,**無** module.exports |
| `demand.js` | 流量需求,generated | **有** module.exports |
| `srlg.js` | 共同風險群組,generated | global const,**無** module.exports |
| `rtt.js` | 城市對 RTT,generated | **有** module.exports |

輔助文件(非執行所需):`README.md`(PM 視角專案說明)、`SPEC.md`(工程規格,以 § 編號錨定)。

**本檔三層,分工不重複(同一件事只在所屬層講一次)**:**鐵則**(紅線 / 程序,違反即壞資料或失準)→ **設計原則**(理念,改 code 自我檢查)→ **慣例**(UI / 樣式的具體 do / don't)。

## 鐵則

1. **generated `.js` 永不手改** — `topology / demand / srlg / rtt.js` 全由
   `working/gen.mjs` 產生。要改資料 → 只改 `gen.mjs` → 重跑 → 用 `verify.mjs` 獨立重算驗證
   byte-identical(確定性要求)→ **驗證時輸出到暫存目錄,絕不覆寫 output/**。
2. **index.html / engine.js 手維護** — 可直接編輯(engine 的純函式紅線見設計原則 → Pure Functions)。
3. **改完任何檔,用絕對路徑確認 `/mnt/workspace/output/` 的成品。**
4. **engine.js 改動的驗證**:
   - **純重構**(要求結果不變,如 PQ 換堆、單源重用等效能優化)→ 比照鐵則 1:**改前先抓數值快照、改後比對 byte-identical**(載入 topology/demand 跑全套 all-pairs / N-1 / 優化器,雜湊比對)。
   - **刻意改變結果**(如把 MLU 口徑改為含 transit)→ 改用**行為驗證**(人工核對新行為合理、跨視圖一致),**不可**用 byte-identical 當通過標準。
   - 兩者都用 `vm` 把 generated `.js` 灌進 context 測(它們是 global const、**無** module.exports,不能直接 import)。
5. **engine 不吐白話、UI 不硬編字串** — `engine.js` 只回傳穩定代碼(kebab)+ 結構化參數,**不吐顯示字串**;所有 UI 文案集中在 `index.html` 的 `§0.5 I18N`(zh/en),經 `t(key, params)` 取用。新增 UI 字串一律進字典,**禁止散落硬編**(違反不會報錯,只會默默漏譯)。詳見 SPEC §16。

## 設計原則(對照業界慣例)

本專案的 UI / 資料規則都是這幾個業界原則的落實。**改 code 前用它們自我檢查**(「有沒有違反 X?」):

- **SSOT(Single Source of Truth)** — 同一事實只定義一處:`COST_CLAMP`、設計 token、`THRESHOLDS` / `LIMITS`。
- **Design Tokens** — 顏色走 `:root --role-* / --node-*`,CSS 與 JS(`cssVar()`)共讀同一份。
- **SoC(Separation of Concerns)+ 單向依賴** — `engine.js` 純邏輯 / `index.html` 純 UI / CSS 純樣式;依賴**單向** UI→Engine→Builder→Data,engine 不反向依賴 DOM/全域(SPEC §2)。
- **MVU + 受控變更(encapsulation)** — 視覺狀態走 op/role,**一律 setter**、view 由 state 衍生(SPEC §11)。
- **No Magic Numbers** — 散落數字收成具名常數(`THRESHOLDS` / `LIMITS`)。
- **Event Delegation** — 按鈕走 `data-action` → `ACTIONS` 單一委派。
- **Convention over Configuration** — Tab = IIFE `{ init, activate }` + `TABS` 註冊表。
- **Zero-build / Self-contained** — 單一自包含 HTML,無 build(故 CSS 不外部化、Tailwind 走 CDN inline)。
- **Pure Functions(無副作用)** — `engine.js` 全函式 export、不依賴 DOM/Cytoscape/全域,state 全經參數(內部工作狀態如 Dijkstra `visited` 不算)。
- **Determinism / Reproducibility** — `mulberry32(seed)` + `maxEvals`(非 wall-clock)→ 同輸入同輸出;export 穩定。驗證靠 **byte-identical 快照(Golden-master / Characterization testing,鐵則 #1/#4)**。
- **Immutability(copy-on-write)** — engine 不 mutate 輸入(如 `applyWeights` 回淺拷貝)。
- **Graceful Degradation** — 缺 demand/rtt/srlg.js 時降級(顯示「未載入」/退回基本選項),不崩。
- **i18n / Single Source of Strings** — UI 字串單一來源:`I18N` 字典 + `t()` 查表;engine 純代碼(呼應 SoC / Pure Functions)。漏 key 回傳 key 本身,讓漏譯在畫面上顯眼。

下面兩節是這些原則的具體 do / don't。

## UI 架構慣例(改 index.html 前必讀)

權威細節在 `SPEC.md` §11(狀態機)、§12(Tab 矩陣)。具體規則(原則見上):

1. **狀態 setter**:cy class 一律走 `setEdgeOp/setEdgeRole/setNodeOp/setNodeRole` 或 `applyRoles({edgeRoles, nodeRoles})`;**禁止直接 `addClass/removeClass`**。
2. **op vs role**:`op`=持久(右鍵故障,跨 Tab 不清)、`role`=瞬時(切 Tab `clearAllRoles()` 清);**切 Tab 只清 role、不動 op**。
3. **Tab 分組(`data-group`)**:`live`=吃右鍵故障、`audit`=完整拓樸(忽略故障)、`edit`=編輯;影響 `rerenderIfPathActive`。
4. **innerHTML 重綁**:重繪會清掉子元素 listener → 在該 tab 內重綁或用委派。
5. **`failedEdges/failedNodes` 是狀態機 facade**(非真 Set,給 engine 當故障集),勿換成普通 Set。
6. **i18n 注入**:靜態走 `data-i18n`(文字)/ `data-i18n-html`(含 `<b>`)/ `data-i18n-title`(title)/ `data-i18n-optlabel`(optgroup);動態 render 走 `t(key, params)`;`setLang()` 重掃靜態 + 重繪當前分頁。跨頁重複字串抽 `common.*`;帶參數的值用 `(p)=>\`…\``,tier/狀態類用 getter(render 時才解析、切語言即時生效)。詳見 SPEC §16。

## 樣式慣例(UI)

具體規則 / 雷(原則見上):

1. **語意 class 目錄**:狀態卡 `.s-card`(`.s-ok/lost/warn/srlg/overflow` + `.s-sub`)、文字 `.txt-* / .val-danger / .tier-* / .sev-*`。新狀態色加進這套,勿 inline。
2. **兩個 `<style>` 區分工(易踩)**:`type="text/tailwindcss"` 區 CDN **非同步**、`@apply` 對**動態 innerHTML 卡片會間歇失效**;純 `<style>` 區**同步** → 放 (a) 動態注入規則、(b) **JS 要讀的 `:root` token**(`cssVar()` 只讀得到此區)。
3. **Cytoscape 樣式必須 JS**(不吃 CSS class),但顏色讀 token。
4. **可接受的 inline**:一次性結構 / 版面(獨有 margin、用一次的漸層);規則是「重複 / 語意色不 inline」,非全禁。

## 編號慣例(動 UI 或演算法前先讀 SPEC.md §0)

- **`Cx` 一律指 UI 分頁**(index.html 的 10 個 Tab,C1–C10)。
- **演算法用 §**(engine.js 區塊註解以 `§N —` 領頭,對應 §4–§15,含 §6.2b/§6.3b 等子節)。
- 兩者**不是一對一**(例:UI「失效模擬」C5 ↔ 演算法 §6)。勿混改。

## 文件慣例

- `README.md` = PM 視角(狀態/範圍/里程碑/風險);`SPEC.md` = 工程視角,
  以 § 編號錨定、與 engine.js 雙向追溯。
- **不寫死可變 dataset 的數字**(router 數、edge 數…)— 用結構/量級表述。
  內建拓樸/流量/RTT 是合成樣本,隨 gen.mjs 參數變。
- `README.md` / `SPEC.md` 為**英文(canonical)**,中文平行版為 `*.zh.md`;**改任一版須同步另一版**,否則漂移。i18n 詳細架構見 `SPEC.md §16`。

## 資料工具鏈(`working/`)

`gen.mjs`(產生器,Node ES module)、`verify.mjs`(獨立驗證,import output/engine.js 重算超載)、
`measured_rtt.csv`(節點直測)、`city_rtt_reference.csv`(城市對參考)。
RTT 優先序:**ASYM 人為 > measured 直測 > city-ref 城市參考 > geo 模型**。

## 本機預覽

```
cd /mnt/workspace/output && python -m http.server 8000
```
