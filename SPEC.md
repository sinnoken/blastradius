# BlastRadius SPEC

本文件規範 BlastRadius POC 的資料模型、演算法定義、模組分層與視覺狀態機。
所有編號(§) 與程式碼中的章節註解對應,可雙向追溯。

---

## §1 資料模型

### §1.1 Topology Schema

`topology.js` 暴露單一全域變數 `topology`,結構如下:

```js
const topology = {
  nodes: [...],       // Router + Pseudo-node
  edges: [...],       // p2p / transit 邊
  externals: [...],   // LSA5 (optional)
  positions: { ... }, // Cytoscape 預設座標 (optional)
};
```

### §1.2 Node

```ts
type Node =
  | {
      id: string;            // 唯一識別,通常為 PoP 簡稱(TPE / TYO / ...)
      label: string;         // 圖上顯示文字,支援 \n 換行
      type: 'router';
      area: string;          // OSPF area(目前僅支援 '0')
      stubs?: string[];      // LSA3 等價:該 router 宣告的 prefix(CIDR)
      isASBR?: boolean;      // 是否為 ASBR(對外注入 LSA5)
      isABR?: boolean;       // 是否為 ABR(目前未啟用 inter-area 計算)
    }
  | {
      id: string;            // 以 'PN' 開頭表示 pseudo-node(LSA2 抽象)
      label: string;
      type: 'pseudonode';
      subnet: string;        // 該 transit LAN 的 CIDR
    };
```

### §1.3 Edge

```ts
type Edge =
  | {
      id: string;
      source: string;
      target: string;
      cost: number;          // 正向 cost(source → target)
      costRev?: number;      // 反向 cost(僅 p2p,省略時等於 cost,即對稱)
      type: 'p2p';
    }
  | {
      id: string;
      source: string;        // 一端為 Router、另一端為 Pseudo-node
      target: string;
      cost: number;          // Router → Pseudo 的 cost
      type: 'transit';       // Pseudo → Router 固定為 0(LSA2 語意)
    };
```

### §1.4 External (LSA5)

```ts
type External = {
  advertising_router: string;   // 哪台 ASBR 注入
  subnet: string;               // 例如 '0.0.0.0/0'
  metric: number;
  metric_type: 'E1' | 'E2';
};
```

---

## §2 模組分層

```
┌────────────────────────────────────────────────────────┐
│ Module A: Topology Data    (topology.js)                │
├────────────────────────────────────────────────────────┤
│ Module B: Graph Builder    (§3)                         │
│   - buildAdjacency(edges, failedEdges, failedNodes)     │
│   - buildSubnetIndex(topo)                              │
├────────────────────────────────────────────────────────┤
│ Module C: Algorithm Engine (§4–§9)                      │
│   C1 SPT + ECMP        (§4)                             │
│   C2 Backup Path       (§5)                             │
│   C3 Failure Sim       (§6)                             │
│   C4 ECMP Check        (§7)                             │
│   C5 Asymmetric        (§8)                             │
│   C6 Heatmap           (§9)                             │
│   C7 N-1 Worst-case    (§10)                            │
├────────────────────────────────────────────────────────┤
│ Module D: State Machine    (§11)                        │
│   edgeStates / nodeStates  (op + role)                  │
│   failedEdges / failedNodes facade                      │
├────────────────────────────────────────────────────────┤
│ Module E: UI Layer         (Cytoscape + Tab handlers)   │
└────────────────────────────────────────────────────────┘
```

底層回呼方向只有「向下依賴」 — UI 呼叫 Engine,Engine 呼叫 Builder,Builder 讀 Topology。State Machine 是 UI 跟 Engine 之間的橋:UI 透過 `setEdgeOp / setNodeOp` 操作持久狀態,Engine 透過 `failedEdges / failedNodes` facade 讀取。

---

## §3 Graph Builder

### §3.1 Adjacency (`buildAdjacency`)

把 `topology.edges` 轉成 Dijkstra 用的鄰接表 `adj[u] = [[v, cost], ...]`。三條規則:

**Rule 1 — p2p edge**

```
add(source, target, cost)
add(target, source, costRev ?? cost)
```

**Rule 2 — transit edge (LSA2 語意)**

```
add(router, pseudo, cost)   // Router → Pseudo:有 cost
add(pseudo, router, 0)      // Pseudo → Router:固定 0
```

**Rule 3 — 故障過濾**

- `failedEdges.has(e.id)` → 整條跳過
- `failedNodes.has(u || v)` → 該方向跳過

### §3.2 Subnet Index (`buildSubnetIndex`)

`subnet → Set<advertising_router_id>`,集合大小 ≥2 視為 backed-up。來源:

| Rule | 來源 | 行為 |
|------|------|------|
| Rule 3 | `node.stubs` | 該 router 為 advertiser |
| Rule 5 | LSA2 transit | 所有 attached routers 都「擁有」該 pseudo-node 的 subnet |
| Rule 4 | `externals` | LSA5 中的 `advertising_router` 為 advertiser |

---

## §4 C1 — SPT + ECMP

### §4.1 演算法

Dijkstra + 等成本鬆弛擴展。`preds[v]` 是 `Set<predecessor>`,允許多個前驅:

```
for each neighbor (v, c) of u:
  nd = dist[u] + c
  if nd < dist[v]:
    dist[v] = nd
    preds[v] = { u }
  elif nd == dist[v]:
    preds[v].add(u)
```

### §4.2 ECMP 路徑枚舉

從 `dst` 倒推 `preds`,DFS 還原所有 source → dst 的最短路徑列表。

### §4.3 Pseudo-node 後處理

`stripPseudo(path)` 把路徑中以 `PN` 開頭的節點過濾掉,呈現「router-level」視角。

### §4.4 IP / Network 解析

`resolveLPM(subnetIndex, target)`:目前實作為「精確匹配 + default route(`0.0.0.0/0`)fallback」。完整 LPM 為 Roadmap。

---

## §5 C2 — Backup Path

### §5.1 砍邊重算

`backupPath(topo, src, dst, removedEdges)` = 把 `removedEdges` 套上 `failedEdges` 後重跑 §4。

### §5.4 Unbackup Segment Scan

對 primary 路徑上每條邊試移除,若移除後 cost = ∞,標記為 unbacked:

```
primary  = dijkstraECMP(adj, src, dst)
for each edge e in primary.edges:
  if backupPath(topo, src, dst, [e]).cost == ∞:
    unbacked.push(e)
```

語意:**該邊一壞,src → dst 就斷,沒有任何備援可走**。

---

## §6 C3 — Node Failure Simulation

### §6.1 連通性

`connectedComponents(adj, routerIds)`:BFS 走 router-only(跳過 pseudo-node),分割成連通元件。

### §6.2 流量重分配

`allPairsLoad(topo, failedEdges, failedNodes)`:

```
load[edge] = Σ over all (a→b) pairs: 1 / r.paths.length
```

ECMP 等分權重,每條 path 對其經過的每條 edge 累加。

`simulateNodeFailure` 取 `before / after` 兩次全網 load 差值,輸出每條 edge 的 `direction ∈ {inc, dec, none}` 與 `changePct`。

---

## §7 C4 — ECMP Backup Check

對每對 (src, dst):

1. 計算 primary,若 `paths.length < 2` 或共用同一 first-hop → `status: n/a`
2. 收集 `ecmpEdgeIds` = primary 的 first-hop 邊集合
3. 對每條 `eid ∈ ecmpEdgeIds`,移除後重算:
   - 若不可達 → `status: failed`,reason = `removing eid → unreachable`
   - 若新路徑 first-hop 不在 `ecmpEdgeIds \ {eid}` → `status: failed`,reason = `backup uses non-ECMP edge`
4. 全部通過 → `status: passed`

**語意**:理想的 ECMP 群組,任一成員失效後,流量應由群組內其他成員接手,不應該逃出群組。

---

## §8 C5 — Asymmetric Path Detection

對每對 unordered (a, b):

```
fwd = SPT(a → b)
rev = SPT(b → a)
fwdSig = sorted set of stripPseudo(p).join('>')
revSig = sorted set of stripPseudo(p).reverse().join('>')
```

若 `fwd.cost ≠ rev.cost` 或 `fwdSig ≠ revSig` → 列入非對稱清單。

---

## §9 C6 — Subnet Heatmap

每台 router 統計 `notbackuped / total`,Ratio 映射顏色:

| Ratio | 顏色 | 語意 |
|-------|------|------|
| 0 | 綠 | 所有 subnet 都有備援 |
| 0–0.33 | 黃 | 少數 subnet 為單一宣告 |
| 0.33–0.66 | 橘 | 約一半 subnet 無備援 |
| > 0.66 | 紅 | 多數 subnet 為單一宣告 |

---

## §10 C8 — N-1 Worst-case Ranking

### §10.1 枚舉

```
scenarios =
  { kind:'edge', id, edge } for each p2p edge ∪
  { kind:'node', id }       for each router
```

Transit 邊不算實體失效情境(它是 LSA2 內部抽象)。

### §10.2 雙視角累計

對每個 scenario,對全網 (a, b) 重算 SPT,同時累計兩種 stats:

**Per-pair**

```
pairWorst[a>b] = {
  base:      baseline cost (無故障),
  worstCost: 所有 scenario 中最差的 cost,
  culprits:  造成最差結果的 scenario list,
}
```

**Per-failure**

```
failStats[scenario] = {
  unreachable: 此失效造成多少 pair 不可達,
  degraded:    多少 pair 還通但變慢,
  totalDelta:  Σ (worstCost - baseCost),
  maxRatio:    最大 worst / base 倍率,
}
```

### §10.3 排序

- **Pair**:`ratio = worstCost / baseCost` 降序,不可達(∞)優先
- **Failure**:不可達數降序 → `totalDelta` 降序

### §10.4 與 §5.4 (Unbackup) 的關係

| 維度 | §5.4 Unbackup | §10 N-1 |
|------|---------------|---------|
| 焦點 | 單一 (src, dst) pair | 全網所有 pair |
| 失效範圍 | 只試 primary 路徑上的邊 | 所有 edge + 所有 router |
| 判定 | 二元(通 / 不通) | 連續(倍率 + 不可達計數) |
| 用途 | 「這條路徑安全嗎?」 | 「全網最脆弱在哪?」 |

§5.4 是 §10 的一個 binary subset。

---

## §11 視覺狀態機

### §11.1 兩個正交維度

每個 entity 持有兩個獨立狀態:

| 維度 | 來源 | 跨 Tab 行為 | Edge 取值 | Node 取值 |
|------|------|-------------|-----------|-----------|
| **op** | 使用者持久操作(右鍵故障) | 不清除 | `healthy` / `failed` | `up` / `down` |
| **role** | 分析結果的瞬時註記 | 切 Tab 自動清掉 | `none` / `primary` / `backup` / `unbacked` / `load-inc` / `load-dec` / `failed-by-node` | `none` / `endpoint` / `highlight` / `asym-mark` / `heat-{green/yellow/orange/red}` / `failed-node` |

### §11.2 渲染規則

```
op 優先:
  edge.op = failed         → 顯示為 failed (紅色虛線)
  node.op = down           → 顯示為 failed-node
  edge 端點 node.op = down → 派生為 failed (不寫回 edge.op,保持單一資料源)
否則 role 直接映射到對應 CSS class。
```

### §11.3 Facade

`failedEdges` 與 `failedNodes` 是對狀態機的 Set-like 包裝(`has / add / delete / clear / size / iterator`),提供給既有演算法當參數 — 避免演算法層需要知道狀態機細節。

### §11.4 不變式

1. 所有 Cytoscape `addClass / removeClass` 必須走 `setEdgeOp / setEdgeRole / setNodeOp / setNodeRole`,不准直接操作元素 class
2. 切 Tab 時呼叫 `clearAllRoles()` — 只清 role,不動 op
3. 「重置畫面」按鈕 = `clearAllRoles()`,「清除所有故障」= `failedEdges.clear() + failedNodes.clear()`,語意分離

---

## §12 Tab 行為矩陣

| Tab | 編號 | 吃右鍵故障? | 切換時自動執行 |
|-----|------|-------------|----------------|
| 路徑 | C1 | ✅ | `renderPath(src, dst)` |
| 矩陣 | C2 | ✅ | `renderMatrix()` |
| 全 Pair | C3 | ✅ | `listAllPairs.click()` |
| 失效模擬 | C4 | ❌(自帶情境) | — |
| ECMP 檢查 | C5 | ❌(設計審計) | — |
| 非對稱 | C6 | ❌(設計審計) | — |
| Heatmap | C7 | ❌(設計審計) | — |
| N-1 | C8 | ❌(設計審計) | `runN1Scan.click()` |
| 鏈路 | — | — | `renderEdgeEditor()` |

---

## §13 演算法複雜度

設 `V = router 數`, `E = edge 數`。本實作未使用 fibonacci heap,Dijkstra 內排序 array PQ,單次 SPT 為 `O((V + E) log V)`(近似)。

| 模組 | 單次成本 | 觸發頻率 |
|------|----------|----------|
| C1 SPT (single pair) | O((V+E) log V) | 使用者點按 |
| C2 Matrix (all pairs) | O(V² · (V+E) log V) | 切到矩陣 Tab |
| C3 Failure Sim | 2 × all-pairs | 使用者點按 |
| C4 ECMP Check | O(V² · k · SPT) | 使用者點按,k=ECMP 邊數 |
| C5 Asymmetric | O(V² · SPT) | 使用者點按 |
| C7 N-1 | O((V + E) · V² · SPT) | 使用者點按 |

POC 規模(V ≈ 10, E ≈ 20)下 N-1 全掃約 ~6000 次 SPT,瀏覽器內 < 200 ms。
真實規模(V ≈ 100, E ≈ 300)估算 N-1 全掃約 4 × 10⁶ SPT,需要 Web Worker 或後端化。

---

## §14 變更紀錄相對於 §1.0

本 SPEC 對應 BlastRadius POC `v1.x`(從 Topolograph 命名分支出來後)。
主要差異於原始 OSPF 演算法 spec:

- 新增 §10 N-1 Worst-case Ranking
- §11 視覺狀態機獨立成章(原先散落在 UI handler 各處)
- §12 Tab 行為矩陣明確化「吃右鍵故障 vs 設計審計」二分

歷史 commit 對應點請見 `topology.js` 註解中的「演算法觸發點檢核表」。
