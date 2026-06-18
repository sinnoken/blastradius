# Topocide — 維護指引

OSPF/IGP 網路韌性審計工具。兩頁 SPA（index.html 分析、edit.html 編輯），共用 engine.js 演算法、theme.css 設計 token、draft.js 持久化。無 build step，Cytoscape.js + Tailwind CDN + vanilla ES module。雲端同步走 CF Workers + R2，本機 fallback 靠 localStorage。

## 檔案結構(完整可跑需這 8 檔,全在本目錄)

| 檔 | 性質 | exports |
|----|------|---------|
| `index.html` | 前端 UI,**手維護**,可直接編輯 | — |
| `engine.js` | 純演算法 ES module(每函式 export,無 DOM/Cytoscape/全域依賴) | 每函式 export |
| `theme.css` | 設計 token,**手維護**,index 與 edit 兩頁 `<link>` | — |
| `graph-style.js` | cy 節點基礎樣式,兩頁 `import` | `baseGraphStyle()` |
| `topology.js` | 拓樸資料,generated | global const,**無** module.exports |
| `demand.js` | 流量需求,generated | **有** module.exports |
| `srlg.js` | 共同風險群組,generated | global const,**無** module.exports |
| `rtt.js` | 城市對 RTT,generated | **有** module.exports |

輔助文件(非執行所需):`README.md`(PM 視角專案說明)、`SPEC.md`(工程規格,以 § 編號錨定)。
工具(非執行所需):`edit.html` — 資料編輯器(編 topology/demand/srlg/rtt 四檔,見下方「編輯器」段)。
共用模組(非「可跑 8 檔」之一):
- `ospf-import.js` — OSPF LSDB 解析純函式(SSOT),`edit.html` 與 `working/ospf_to_topology.mjs` 共 import;`index.html` 不依賴。
- `draft.js` — localStorage 草稿共用模組,`window.Draft` API(read/write/clear),兩頁共用,per-topo key(`?topo=`),2小時有效期。
- `worker.js` — CF Workers + R2 原始碼正本,自動部署另行設定。
OSPF 匯入資料集:`*.imported.js`(topology/demand/srlg/rtt)— 由匯入流程產生的真實骨幹資料,與 demo 的 `*.js` 平行並存、不互蓋。
共用前端資產的設計細節(資產本身見上表):`theme.css` 的 `--tab-*` 為真單一來源,base 調色盤因 index 走 Tailwind 需手動對齊。

**本檔三層,分工不重複(同一件事只在所屬層講一次)**:**鐵則**(紅線 / 程序,違反即壞資料或失準)→ **設計原則**(理念,改 code 自我檢查)→ **慣例**(UI / 樣式的具體 do / don't)。

## 鐵則

1. **generated `.js` 永不「手 key」** — `topology / demand / srlg / rtt.js` 由工具產生,不手動逐字編輯。**兩條合法生產路徑,別混驗**:
   - **`working/gen.mjs`(確定性樣本)** — 改資料 → 只改 `gen.mjs` → 重跑 → 用 `verify.mjs` 獨立重算驗 byte-identical(確定性要求)→ **驗證時輸出到暫存目錄,絕不覆寫 output/**。
   - **`edit.html`(人工策展)** — 用編輯器 UI 改 → 匯出回 `.js`。屬人工資料,**不受 byte-identical / 確定性約束**,`gen.mjs` 不保證能重現(見「編輯器」段)。
   - **不可混驗**:edit 匯出的資料別拿 gen 的 byte-identical 標準去驗;gen 的確定性樣本也別用 edit 手改(會脫離確定性鏈)。
2. **index.html / engine.js 手維護** — 可直接編輯(engine 的純函式紅線見設計原則 → Pure Functions)。
3. **改完 `index.html` / `engine.js` / `*.css` / `*.js`(含 generated 檔),用絕對路徑確認 `/mnt/workspace/output/` 的成品**;純文件(CLAUDE.md / README / SPEC)或 working/ 工具不需要。
4. **engine.js 改動的驗證**:
   - **大規模純重構**(PQ 換堆、all-pairs 平行化等)→ 改前 `node working/verify.mjs > before.txt`、改後再跑一次,目視比對各 profile 利用率數值無異常即可;不強制 byte-identical。
   - **刻意改變結果**(如把 MLU 口徑改為含 transit)→ **行為驗證**:人工核對新行為合理、跨視圖一致。
   - `verify.mjs` 載入策略:`topology / srlg.js` 是 global const、**無** module.exports → 用 `vm` eval;`demand / rtt.js` 有 exports → 可直接 require。
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
- **Zero-build / Self-contained** — 單一自包含 HTML,無 build(故 CSS 不外部化、Tailwind 走 CDN inline;CDN 非同步衍生的 `@apply` 雷見樣式慣例 #2)。
- **Pure Functions(無副作用)** — `engine.js` 全函式 export、不依賴 DOM/Cytoscape/全域,state 全經參數(內部工作狀態如 Dijkstra `visited` 不算)。
- **Determinism / Reproducibility** — `mulberry32(seed)` + `maxEvals`(非 wall-clock)→ 同輸入同輸出;export 穩定。驗證靠 **byte-identical 快照(Golden-master / Characterization testing,鐵則 #1/#4)**。**適用範圍:gen.mjs 確定性生成路徑**;edit.html 人工策展路徑不受此約束(見鐵則 #1)。
- **Immutability(copy-on-write)** — engine 不 mutate 輸入(如 `applyWeights` 回淺拷貝)。
- **Graceful Degradation** — 缺 demand/rtt/srlg.js 時降級(顯示「未載入」/退回基本選項),不崩。
- **Desktop-first;桌機區間自適應,非行動版 RWD** — 多面板分析工具,互動倚賴右鍵切故障 / hover / 拖曳 / 密集矩陣,標的為桌機·筆電;版面用 flex/grid + 可拖曳右面板,在 laptop→寬螢幕流式自適應(呼應 Graceful Degradation),**不做手機/觸控版**(成本高且與互動模型衝突)。窄視窗不破版的做法:側欄 `shrink-0`、中央 `flex-1 min-w-0`、矩陣靠自身 `overflow` 捲動,勿硬編會吃掉畫布的寬度;兩頁皆掛 `<meta viewport>`。**目前無 `@media` 斷點**——要加也只在桌機區間(如極窄時收側欄),勿引入行動版佈局。
- **i18n / Single Source of Strings** — UI 字串單一來源:`I18N` 字典 + `t()` 查表;engine 純代碼(呼應 SoC / Pure Functions)。漏 key 回傳 key 本身,讓漏譯在畫面上顯眼。
- **Atomic Interaction(一個手勢 = 一個 Undo)** — 連帶發生的操作合進同一個歷史記錄,使用者對一個動作只按一次 Ctrl+Z。
- **Modal Dispatch(修飾鍵改變模式,不疊加動作)** — modifier key(Shift/Ctrl/Alt)改變操作語意時,只執行該模式的動作,不同時觸發無修飾鍵的行為。
- **Single Handler per Trigger(一個觸發只掛一個 handler)** — 同一個使用者動作不用兩種事件同時監聽,避免重複執行。

下面兩節是這些原則的具體 do / don't。

## 實作慣例(改 index.html / edit.html 前必讀)

**index.html 狀態機**（權威細節見 SPEC.md §11–§12）:
- cy class 一律走 setter（`setEdgeOp` / `setNodeRole` …），禁止直接 `addClass/removeClass`
- `op`=持久跨 Tab、`role`=瞬時切 Tab 清；`failedEdges/failedNodes` 是 facade，勿換普通 Set
- i18n：靜態 `data-i18n-*` / 動態 `t(key, params)`；詳見 SPEC §16

**edit.html 資料層**:
- 寫資料一律先寫 Maps（SSOT），再同步 cy（`_skipCySync=true`）；禁止直接 `sel.data()` 繞過 Maps
- cy 事件（add/remove/data/position）同步回 Maps 時先過 `isGhost()` 過濾臨時元素
- `hydrateAll` 載入期間 `_hydrating=true`，`markDirty()` 開頭檢查此 flag 直接 return
- 各 tab render 函式末端加 `markDirty()`，確保編輯即時存入 localStorage
- Inspector 同元素只 patch 欄位值（`setField()`），換元素才整個 mount；避免重建 DOM 丟失 focus

**兩頁共用**:
- `innerHTML` 重繪會清 listener → 重綁或用委派
- 動態 `innerHTML` 禁用 `@apply`（CDN 非同步失效）；顏色走 `var(--token)`
- Cytoscape 樣式必須 JS，顏色讀 token

## 命名原則

- **大小寫傳達可變性**：真正不可變的設定用 ALL_CAPS；運行期計算後不再改的用 camelCase；會變動的狀態用 camelCase。
- **`_` 前綴傳達作用域**：模組內部不應被外部直接存取的狀態/旗標加 `_`；業務語意的狀態不加（讓名稱本身說明意圖）。
- **名稱說明意圖，不說明型別**：`isDirty` 比 `dirtyBoolean` 好；`userList` 比 `usersArray` 好。
- **函式名以動詞開頭**，說明它做什麼而非回傳什麼：`renderInspector`、`markDirty`、`hydrateAll`。
- **縮寫只在整個 codebase 達成共識後才用**：局部縮寫比完整名稱更難讀；已有共識的縮寫（如 `D`/`S`/`R` 對應 demand/srlg/rtt）應在 CLAUDE.md 說明一次。

## 樣式慣例

- 語意色 class：`.s-ok/warn/danger`、`.txt-*`、`.sev-*` — 新狀態色加進這套，勿 inline
- 可接受的 inline：一次性版面（獨有 margin、單次漸層）；「重複 / 語意色」不 inline

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
`gravity.js`(重力模型共用常數、CITY_GEO 城市地理資料與 mass 函式 SSOT,browser + Node 皆可 import;對齊 engine.js 模式)、
`node_rtt.csv`(節點直測)、`city_rtt.csv`(城市對參考)。
RTT 優先序:**ASYM 人為 > measured 直測 > city-ref 城市參考 > geo 模型**。
重力模型 mass = **stubs 數量 + capacity 加總**;D0=3000 km / K=1 / EMIT=0.001 Gbps 皆定義於 gravity.js。
`rtt.js` 只含 `matrix`（城市對 RTT）與 `edges`（PoP 節點對 RTT）;`cityRef` 已移除(只是 CSV 鏡像,前端不消費)。

**OSPF 匯入**(讀 `input/` 的 `show ip ospf database router/network`):`ospf_to_topology.mjs`(+ `rid_hostname.csv` RID↔hostname → `topology.imported.js`)、`companions.mjs`(由 imported topology 產 demand/srlg/rtt,demand 自動校準 MLU)。解析核心共用 `output/ospf-import.js`;**產生順序固定:`ospf_to_topology` → `companions`**(後者讀前者輸出)。companions 的 RTT 來源**與 gen.mjs 對齊**:同兩份 CSV(`node_rtt.csv` / `city_rtt.csv`,皆城市碼為鍵)、同優先序(見上,唯無 ASYM 人為層)。
匯入 **node id 一律為安全 token(開頭字母:城市碼+序號 / `PN_*` / 無 hostname 退 `R_*`)**,意義放 `rid`/`hostname`(label)/`city`/`country` 欄位 — 避免 cytoscape 選擇器(`.`/`#`)與 JS 數字分隔符(開頭數字+底線被當數字)兩個雷。

原則:
- **`SCALE` 需在 mass 定義或拓樸配置改變後重校** — mass 公式(`gravityMass`: stubs + capacity)或邊的容量/節點數改變,都會讓 demand 量級漂移,SCALE 必須重調讓 avg MLU 落回目標。校準方式:跑一次 gen.mjs,量出當前 MLU,新 SCALE = 舊 SCALE × (目標 MLU / 當前 MLU)。目前 SCALE=7.63e-8,對應 145-node avg MLU ≈ 45.7%。
- **忙時 profile 預設為 demo 誇大值**(放大方向性以展示不對稱權重優化),非真實忙時;真實值靠 CLI 參數還原。
- **`measured=0`(gen 結尾統計)= CSV 查找表耦合斷裂**,非正常狀態。

## 編輯器(`edit.html`)原則

- **繼承 index 而非複製** — 共用走檔案（`theme.css` / `graph-style.js` / `engine.js`），不拷貝；各頁自留專屬 overlay。
- **匯出對齊 gen.mjs 格式** — topology 可 byte-identical；demand/srlg/rtt 語意 round-trip 即可；手改資料不再由 gen.mjs 重現（鐵則 1 只約束 generated 流程）。
- **輸入即驗證** — 欄位在輸入當下驗證並即時標示；「驗證」鈕彙總全圖問題，不靠匯出才發現錯誤。
