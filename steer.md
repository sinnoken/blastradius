# steer.md — 明確路徑導流(Explicit Path Steering)設計規劃

> **狀態:規劃中,尚未實作。** 本文件供後續設計參考,非現行行為描述。
> 實作後應整併進 `SPEC.md`(預計成為一個新 § 子節,並與 `engine.js` 雙向追溯)。

---

## §S1 目的與定位

### S1.1 要解決的缺口

目前工具只有兩種 TE 槓桿,都動不了「**特定流量**」:

- **IGP 權重(§15 Fortz-Thorup)**:全域、粗粒度——改一條權重,經過它的**所有**流一起 reroute,無法只動一條。
- **ECMP**:等成本就均分,無法「填滿 A 才溢出 B」。

`steer` 補上**明確路徑導流**:把指定的 demand 拉離最短路、走指定路徑。

### S1.2 定位(protocol-agnostic)

- `steer` = **RSVP-TE 與 SR 的功能交集**:「明確 steer」。兩者差集(RSVP 的頻寬把關、SR 的服務串接)**不在本範圍**。
- 因為協定機制(label 封裝 vs 訊號狀態)**不改變流量穩態走的路**,對「流量落在哪、利用率多少」的視角只有**路徑**重要 → 不綁協定,抽象成通用的 `steer`。
- **不做 FRR**(快速保護):FRR 的價值在 sub-50ms **瞬態**,本工具是**穩態**分析;其收斂結果與覆蓋率已由 §6 失效模擬 / §5.4 unbackup / §10 N-1 涵蓋。
- **不做頻寬准入 / CAC**(RSVP 招牌):另列為 Tier 1(見 §S5),與 steer 解耦。

### S1.3 概念基礎(為什麼是「一個資料檔 + 純函式」)

- **模擬器有上帝視角**:一手握全圖,**不需要 header / 逐跳狀態**。真實網路的 label 封裝(SR)或逐跳預約狀態(RSVP)存在,是為了把「源頭算好的路」送給**只有局部知識的短視 router**;集中且全知的模擬器沒有這個 gap。
- 所以 `steer` = 把「**源頭的端到端行程表**」直接寫成資料,引擎照走、算聚合流量。
- 對應真實:steer policy 的 `path` ≈ **SR headend 的 segment list**(套娃裡裝的行程表),不是中途 router 的逐跳轉送表。
- `engine.js` 是純函式、無持久狀態;`steer` 完全 data-driven → **順著引擎紋理**,不需引入狀態機。

---

## §S2 資料模型 `steer.js`

伴生資料檔,模式同 `demand.js` / `srlg.js`(見 SPEC §1.5)。缺檔 → 全部流量走 IGP 最短路(= 現況)。

### S2.1 版本 A — fraction 比例切(最單純)

```js
const steer = { policies: [
  { id: 'tpe-lax-A', from: 'TPE', to: 'LAX',
    path: ['TPE', 'TYO', 'LAX'],   // waypoint 串(router-level)
    fraction: 0.6 },               // 該 OD demand 的 60% 走此路
  { id: 'tpe-lax-B', from: 'TPE', to: 'LAX',
    path: ['TPE', 'GUM', 'LAX'],
    fraction: 0.4 },
]};
```

- 同一 (from,to) 的 `fraction` 加總應 = 1.0(驗證時檢查)。
- **這就是 SR 的「加權多路徑」招牌**:把一筆 demand 按權重分到多條 segment list——fraction 版本即在模這個機制(SR weighted multi-path / 加權 ECMP),不只是「逼近填滿才溢出」。
- **限制**:fraction 是**固定比例**,只逼近「某一需求量下」的分佈;需求變動會失真(例:demand 下降時 A 仍只吃 60%)。

### S2.2 版本 B — cap + overflow(貼「填滿 A 才溢出 B」)

```js
const steer = { policies: [
  { id: 'tpe-lax-A', from: 'TPE', to: 'LAX',
    path: ['TPE', 'TYO', 'LAX'],
    capGbps: 120,            // A 最多吃 120 Gbps
    overflow: 'tpe-lax-B' }, // 超過的轉給 B
  { id: 'tpe-lax-B', from: 'TPE', to: 'LAX',
    path: ['TPE', 'GUM', 'LAX'] },   // 接收溢出,無 cap
]};
```

- 對 OD 需求 `D`:走 A = `min(D, capGbps)`、走 B = `max(0, D − capGbps)`。
- **需求變動時行為正確**(D=100 全上 A、D=200 → A 120 / B 80),真的是「填滿才溢出」。
- 仍屬輕量:只是**手動指定**一條邊的門檻,**不跑 CSPF**(那是 Tier 1)。

### S2.3 欄位語意

| 欄位 | 說明 |
|------|------|
| `from` / `to` | OD pair(router id)。命中此對的 demand 才套用本 policy。 |
| `path` | waypoint 串(router-level)。**相鄰兩點 = 釘死一條 link(對應 Adj-SID 嚴格跳);隔點 = 段內走最短路(對應 Node-SID 鬆散跳)。** |
| `fraction` | 版本 A:該 OD demand 的比例。 |
| `capGbps` / `overflow` | 版本 B:上限 + 溢出去向 policy id。 |

> **建議先做版本 B**:最貼「跑滿 A 再跑 B」的需求,且不踩進 Tier 1。

---

## §S3 引擎整合(tunnel-aware 流量)

### S3.1 核心改動

新增 `allPairsTraffic`(SPEC §6.2b)的 **tunnel-aware 變體**。唯一差別:**換掉「一筆 demand 怎麼選路」這一步**,其餘(方向 fwd/rev 累加、取 `max(去,回)`、可達性帳目、回傳結構)**全部沿用**。

```
對每筆 (a,b):
  若 (a,b) 有 steer policy → 照 policy 的 path 走(逐段展開)
  否則                     → dijkstraECMP(adj, a, b)   // 現有行為,一字不改
```

### S3.2 唯一的新積木:逐段展開 waypoint

複用 §4 `dijkstraECMP`,**無新演算法**:

```js
// 把 path=[W0,…,Wk] 的 w Gbps,逐段算最短路、累加到實體邊(方向判斷同 §6.2b)
function routeAlong(adj, path, w, fwd, rev, edgeById) {
  for (let s = 0; s < path.length - 1; s++) {
    const r = dijkstraECMP(adj, path[s], path[s+1]);   // 該段最短路(可能 ECMP)
    const share = w / r.edgePaths.length;              // 段內 ECMP 平分
    for (let k = 0; k < r.edgePaths.length; k++) {
      const ep = r.edgePaths[k], np = r.paths[k];
      for (let i = 0; i < ep.length; i++) {
        const e = edgeById.get(ep[i]);
        if (e && np[i] === e.source) fwd[ep[i]] = (fwd[ep[i]]||0) + share;
        else                          rev[ep[i]] = (rev[ep[i]]||0) + share;
      }
    }
  }
}
```

### S3.3 性質(設計約束)

1. **無新演算法**:只是把 `dijkstraECMP` 從「一次 a→b」改成「逐段 Wi→Wi+1」再串。
2. **純加法**:無 `steer.js`(或空 policies)→ 每對都走 else 分支 → 結果與現況 **byte-identical**。
3. **純函式照舊**:`fwd`/`rev` 是 call 內局部累加器,無持久狀態。
4. **下游零改動**:回傳仍是 `traffic[e]`(峰值)+ 帳目,C4 邊流量 / C5 失效 / §15 MLU 直接吃。

---

## §S4 與「虛擬 edge(Forwarding Adjacency)」的取捨

另一個建模選項:把 steer 當成一條 `type:'steer'` 的**虛擬邊**塞進拓樸(現實對應 = **Forwarding Adjacency / IGP shortcut**,SR 對應 = **Binding-SID**),帶 `expandsTo:[...]`,展開回底層實體邊。

| | 虛擬 edge(FA) | steer.js(per-flow) |
|---|---|---|
| 誰會用這條路 | 任何 SPF 覺得它最短的流(**共享捷徑**) | 你指定的那幾條 demand(**逐流**) |
| 怎麼 steer | 靠 metric(設便宜吸流量)→ **繞回調權重** | 直接指派,**不管最短不最短** |
| 真實對應 | FA / autoroute(目的地導向) | SR-TE policy(逐流) |
| 缺點 | **無法強迫非最短的特定流**;會順便吸走沒打算 steer 的流量 | 需展開回實體邊算利用率 |

> **結論**:本工具要的是「把**特定流量**拉離最短路」(逐流語意)→ **採 `steer.js`**。
> 虛擬 edge 留作備選(若日後想演「加了 TE 捷徑、IGP 自己繞」的 FA 行為)。
> 註:兩者都需「攤回底層實體邊算利用率」這步,工作量相同。引擎已有同構先例(pseudo-node / transit edge 的虛擬元素 + 投影)。

---

## §S5 範圍分層(Tier)

| Tier | 內容 | 狀態 |
|------|------|------|
| **Tier 0** | **明確 steer**(本規劃):指定路徑 + fraction / cap-overflow,看流量重分配與利用率 | 規劃中 |
| **Tier 1** | **CAC / 頻寬准入**:逐條 LSP 依容量自動擺放(「填滿才溢出」的**自動版**)、admission 失敗偵測、優先級搶占 | **設計已定(見 §S5.1 / §S5.2),待實作** |
| ~~Tier 2~~ | ~~FRR / 快速保護~~ | **不做**(瞬態;N-1 已涵蓋,見 §S1.2) |

Tier 0 與 Tier 1 的界線:**你手動指定門檻** = Tier 0;**系統自己從容量算該填哪條、擺不下就拒** = Tier 1。

**範圍封頂(已拍板)**:本工具的 TE 範圍**止於 steer(Tier 0)+ CAC(Tier 1)兩層**。FRR、服務串接(SRv6)、跨域 TE 等**一律不在規劃內**——它們要嘛是瞬態(N-1 已涵蓋),要嘛超出「穩態流量分析」這個目的。這兩層已涵蓋工具所需的全部 TE 視角:steer 看「導流後的利用率重分配」,CAC 看「頻寬把關 / 填滿才溢出 / admission 失敗」。

> **Tier 0(steer)的設計** = §S2(資料模型 `steer.js`)+ §S3(tunnel-aware 引擎)。
> **Tier 1(CAC)的設計** = 下方 §S5.1 / §S5.2。

### §S5.1 CAC 資料模型(`cac.js`)

LSP 沿用現有伴生檔的記錄慣例(`{ id, from, to, … }`),只多兩個排序欄位:

```js
const cac = { lsps: [
  { id: 'tpe-lax-1', from: 'TPE', to: 'LAX', bandwidth: 60, priority: 0, seq: 1 },
  { id: 'tpe-lax-2', from: 'TPE', to: 'LAX', bandwidth: 60, priority: 7, seq: 2 },
]};
```

| 欄位 | 說明 |
|------|------|
| `from` / `to` / `bandwidth` | LSP 的端點與頻寬需求(Gbps) |
| `priority` | 0–7,0 最高。**主排序鍵**。對應 RSVP setup/hold priority(初版簡化為單一值;要模 setup≠hold 再拆兩欄) |
| `seq` | 整數,**同優先級內的決定性次序**(= 真實 FCFS 時序的決定性替身),越小越早 |

- **可由 demand.js 衍生**:一條 LSP ≈「一個有大小的 demand」(`bandwidth` ← demand 值)。cac.js 可不另列,直接由 demand 矩陣生 LSP,`priority` / `seq` 當附加屬性疊上去。
- **`bandwidth` 取 demand 值 = 隱含 auto-bandwidth 的穩態**:RSVP 的 auto-bandwidth 招牌會把 LSP 大小自動貼合實際流量;穩態模擬裡直接令 `bandwidth = demand`,就等於它收斂後的結果,不必另外實作。
- **`priority` 是 LSP 層級**,與 §15 的 `vip` / `protectedSet`(**邊**層級)不同維度,**勿共用欄位**;只是「在既有結構上加一個 importance 屬性」的慣例比照。

### §S5.2 CAC 擺放演算法(順序 + CSPF + 帳本)

擺放 = **字典序排序 + 貪婪擺放**:

```
排序:sort by (priority asc[0最高], seq asc)
帳本:每邊「可預約頻寬」初值 = capacity
for 每條 LSP(照排序由前往後):
    CSPF(從 LSP.from 的單源 Dijkstra 變體):
        剪掉「可預約頻寬 < LSP.bandwidth」「要避的 SRLG」的邊（affinity 先忽略,見下）
        在剩圖找最短可行路;多條等價 → 用 tie-break 政策挑一條
    找到路 → 沿路每邊帳本扣 LSP.bandwidth、記下此 LSP 路徑
    找不到 → admission 失敗,記入 unplaced
末:把每條已擺 LSP 的 bandwidth 攤到其路徑的實體邊 → 算利用率(複用 §S3 累加)
```

**關鍵設計理由**:

1. **priority 高的先擺 = 搶占後的穩態**:高優先先搶頻寬、之後沒人能踢它,低優先拿剩下——這正是真實搶占 churn 收斂的結果。**所以不必模動態搶占,一次排序貪婪擺放就含其穩態。**
2. **`seq` = FCFS 的決定性替身**:真實同優先級靠時序(非決定性);cac.js 用 `seq` 釘死成可重現,且變成**可編輯的 what-if 旋鈕**(改 `seq` 測「B 先上會怎樣」,真實網路難安全測)。
3. **CSPF tie-break**(等價可行路挑哪條)是**政策旋鈕**(least-fill / most-fill / 最低 id…),需明定。
4. **帳本是 call 內工作狀態**(像 Dijkstra 的 `visited`),算完即丟 → **引擎仍純函式、無持久狀態**。
5. **「填滿 A 才溢出 B」自然長出來**:A 的帳本見底後,後續 LSP 的 CSPF 找不到 A、被迫繞 B,不必特別寫 overflow 邏輯。

**與真實 RSVP-TE 等價的條件**:忽略時間差需理想化三件事——(a) TED 即時一致(無 admission 驚訝)、(b) 固定順序(priority + seq)、(c) 複製 CSPF tie-break。三者對齊,**一次 CSPF + 帳本 ≡ 真實逐跳擺放**。hop-by-hop 訊號只是「執行 + 沿路驗證」CSPF 的結果,不改路徑(除非 TED 不一致 → 那是時間差)。

**資料相依與前向相容**:

- **avoid-SRLG 約束零成本**:CSPF 要避開的 SRLG 直接複用現有 `srlg.js`,不必新增資料。
- **affinity / link color(先忽略)**:CSPF **不做** affinity 約束——需新增 topology color 欄位,且關鍵的共命避讓已由 SRLG 涵蓋,affinity 為通用分類、優先度低。日後要做再補欄位。
- **DS-TE 推廣口**:帳本目前是「每邊單一可預約頻寬池」;若要模 DiffServ-aware TE(分類預約),可推廣成 **per-class 多池**。本版不做,但帳本介面**預留此推廣方向,勿畫死**。

**輸出**:每邊利用率(同 C4 口徑)+ **admission 失敗清單**(哪些 LSP 擺不下)+ 各 LSP 最終路徑。

**搶占可見性**(讓 RSVP 優先級 / 搶占招牌看得見):對每條 admission 失敗 / 被擠到劣路的 LSP,標出「**被哪幾條較高優先 / 較早(seq)的 LSP 吃掉沿路頻寬**」。此資訊在擺放當下即有(知道誰先佔了爭用鏈路),**零額外計算**——等於不模動態搶占、卻把搶占的結果說清楚。

---

## §S6 明確劃界(不模擬什麼)

- **label / header 封裝機制**:只模**結果**(流量落在哪),不重播 push/swap/pop。
- **per-router 轉送表(FIB/LFIB)**:只算**聚合利用率**,不重建設備內部狀態。
- **頻寬預約 / 准入 / 搶占**:Tier 1,不在 Tier 0。
- **FRR / 快速保護**:瞬態,不做。

---

## §S7 UI 對應(初步)

- 可能新增分頁,或併入 **C4 邊流量**:套 `steer.js` 後重算利用率。
- 呈現:steered vs 預設流量的差異、被導流的鏈路利用率變化、是否因導流造成新的超載(現有 C4 五階分類直接顯示)。
- 編輯:初期由 `steer.js` 檔提供即可;互動式編輯(在圖上拉 waypoint)列為後續。
- **CAC(Tier 1)呈現**:admission 失敗清單、各 LSP 最終路徑、**搶占故事**(某 LSP 被哪些高優先 / 較早 LSP 擠掉)、以及「填滿才溢出」的鏈路利用率階梯。

---

## §S8 設計決定與待決問題

### 已定案(本次更新)

- **Tier 0 引擎**:tunnel-aware = `allPairsTraffic` 只換選路那步 + `routeAlong` 逐段展開(§S3)。純加法,無 steer 時 byte-identical。
- **CAC 順序**:`sort by (priority asc, seq asc)` + 貪婪擺放(§S5.2)。`priority` 主鍵 = 搶占穩態;`seq` 次鍵 = FCFS 決定性替身。**陣列 / seq 順序對 CAC 是 load-bearing,對 steer 無所謂。**
- **CAC 資料**:`cac.js` 比照現有伴生檔記錄結構(`{id,from,to,bandwidth,priority,seq}`),可由 demand.js 衍生(§S5.1)。
- **CAC CSPF 約束範圍**:只剪 **bandwidth + SRLG**(srlg.js 現成);**affinity / link color 先忽略**(需新 topology 欄位、共命避讓已由 SRLG 涵蓋,優先度低)。日後要做再補欄位。

### 待決(實作前需拍板)

1. **steer 支援哪個版本**:fraction、cap+overflow、或兩者?(建議先 cap+overflow。)
2. **命中粒度**:只支援 OD pair?是否要 per-prefix / per-class?
3. **ECMP 段內分流與 cap 的交互**:cap 對整條 policy,段內仍 ECMP 平分,需確認語意一致。
4. **Adj-SID(釘死 link)表達**:以「相鄰 waypoint」隱含表示,或加顯式欄位?
5. **CSPF tie-break 政策**(CAC):預設用 least-fill 還 most-fill?(影響擺放結果,需與「想模的設備」對齊。)
6. **與失效模擬的交互(重要,steer 與 CAC 皆適用)**:被導流 / 已擺 LSP 的路徑上鏈路 / 節點失效時——
   - 是**重繞**(對斷掉的段重算最短路 / 重跑 CSPF)、還是**視為不可達**(計入 lostDemand / unplaced)?
   - 對應真實:RSVP 會 re-CSPF / FRR;SR 視 segment 是否仍可達。需決定模擬語意。
7. **與 §15 優化器的關係**:steer / CAC 後是否再跑權重優化?其流量是否計入 MLU 目標?(預設應計入,因為它真實佔用鏈路。)
8. **CAC priority 是否拆 setup/hold**:初版單一值;要模真實搶占規則(setup≠hold)再拆。
9. **DS-TE 帳本**:要不要支援 per-class 頻寬池?(本版單池;前向相容已預留,見 §S5.2。)

---

## §S9 驗證策略(對齊 CLAUDE.md 鐵則 #4)

- **純加法保證**:無 `steer.js` → 載 topology/demand 跑全套 all-pairs,與改前**數值快照 byte-identical 比對**。
- **有 steer 的行為**:**行為驗證**——手算小例子(如「台美 cap=120、D=200」)對照引擎輸出,人工核對跨視圖(C4 利用率 / 失效模擬)一致。
- generated `.js`(含未來 `steer.js`)的載入沿用 `verify.mjs` 的 `vm` 手法。

---

## §S10 一句話總結

> `steer.js`(waypoint 串)= **把分散在全網的「行程表」集中寫成資料**;tunnel-aware 函式 = **逐張展開(套娃)、累加算出全網利用率**。
> 它抓的是 RSVP-TE ∩ SR 的交集「明確 steer」的**結果**,靠上帝視角省掉 header / 逐跳狀態;**不做頻寬把關(Tier 1)、不做 FRR**。
