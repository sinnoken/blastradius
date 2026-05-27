# BlastRadius SPEC

This document specifies the data model, algorithms, module layering, and visual state machine for the BlastRadius POC. Section numbers (§) match the section comments in the source for two-way traceability.

---

## §1 Data model

### §1.1 Topology schema

`topology.js` exposes a single global variable `topology`:

```js
const topology = {
  nodes: [...],       // Routers + pseudo-nodes
  edges: [...],       // p2p / transit links
  externals: [...],   // LSA5 externals (optional)
  positions: { ... }, // Cytoscape coordinates (optional)
};
```

### §1.2 Node

```ts
type Node =
  | {
      id: string;            // Unique ID, typically the PoP code (TPE / TYO / ...)
      label: string;         // Display string; supports \n
      type: 'router';
      area: string;          // OSPF area (only '0' supported today)
      stubs?: string[];      // LSA3-equivalent: prefixes (CIDR) advertised by this router
      isASBR?: boolean;      // ASBR — injects LSA5 externals
      isABR?: boolean;       // ABR — inter-area not yet implemented
    }
  | {
      id: string;            // Prefix 'PN' denotes a pseudo-node (LSA2 abstraction)
      label: string;
      type: 'pseudonode';
      subnet: string;        // CIDR of the transit LAN
    };
```

### §1.3 Edge

```ts
type Edge =
  | {
      id: string;
      source: string;
      target: string;
      cost: number;          // Forward metric (source → target)
      costRev?: number;      // Reverse metric (p2p only; defaults to cost — symmetric)
      type: 'p2p';
    }
  | {
      id: string;
      source: string;        // One endpoint router, the other pseudo-node
      target: string;
      cost: number;          // Router → pseudo metric
      type: 'transit';       // Pseudo → router metric is fixed at 0 (LSA2 semantics)
    };
```

### §1.4 External (LSA5)

```ts
type External = {
  advertising_router: string;   // ASBR that originates this external
  subnet: string;               // e.g. '0.0.0.0/0'
  metric: number;
  metric_type: 'E1' | 'E2';
};
```

---

## §2 Module layering

```
┌────────────────────────────────────────────────────────┐
│ Module A: Topology Data    (topology.js)                │
├────────────────────────────────────────────────────────┤
│ Module B: Graph Builder    (§3)                         │
│   - buildAdjacency(edges, failedEdges, failedNodes)     │
│   - buildSubnetIndex(topo)                              │
├────────────────────────────────────────────────────────┤
│ Module C: Algorithm Engine (§4–§10)                     │
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
│ Module E: UI Layer         (Cytoscape + tab handlers)   │
└────────────────────────────────────────────────────────┘
```

Dependencies flow strictly downward — UI invokes Engine, Engine invokes Builder, Builder reads Topology. The state machine bridges UI and Engine: UI mutates persistent state via `setEdgeOp / setNodeOp`; Engine consumes it through the `failedEdges / failedNodes` facade.

---

## §3 Graph Builder

### §3.1 Adjacency (`buildAdjacency`)

Converts `topology.edges` into a Dijkstra adjacency list `adj[u] = [[v, cost], ...]`. Three rules:

**Rule 1 — p2p link**

```
add(source, target, cost)
add(target, source, costRev ?? cost)
```

**Rule 2 — transit link (LSA2 semantics)**

```
add(router, pseudo, cost)   // Router → pseudo: metric applies
add(pseudo, router, 0)      // Pseudo → router: metric always 0
```

**Rule 3 — failure filtering**

- `failedEdges.has(e.id)` → skip the entire link
- `failedNodes.has(u || v)` → skip the affected direction

### §3.2 Subnet index (`buildSubnetIndex`)

`subnet → Set<advertising_router_id>` — sets of size ≥2 are treated as redundant. Sources:

| Rule | Origin | Behavior |
|------|--------|----------|
| Rule 3 | `node.stubs` | Router is the advertiser |
| Rule 5 | LSA2 transit | All attached routers "own" the pseudo-node's subnet |
| Rule 4 | `externals` | LSA5 `advertising_router` is the advertiser |

---

## §4 C1 — SPT + ECMP

### §4.1 Algorithm

Dijkstra with equal-cost relaxation. `preds[v]` is a `Set<predecessor>`, allowing multiple parents:

```
for each neighbor (v, c) of u:
  nd = dist[u] + c
  if nd < dist[v]:
    dist[v] = nd
    preds[v] = { u }
  elif nd == dist[v]:
    preds[v].add(u)
```

### §4.2 ECMP path enumeration

Backtrack `preds` from `dst` via DFS to enumerate every source → dst shortest path.

### §4.3 Pseudo-node post-processing

`stripPseudo(path)` filters nodes whose ID begins with `PN`, yielding a router-level view.

### §4.4 Prefix resolution

`resolveLPM(subnetIndex, target)` — currently implements "exact match + default-route (`0.0.0.0/0`) fallback". Full LPM is on the roadmap.

---

## §5 C2 — Backup path

### §5.1 Link-removal simulation

`backupPath(topo, src, dst, removedEdges)` = unions `removedEdges` into `failedEdges`, then reruns §4.

### §5.4 Unprotected-segment scan

For each link on the primary path, simulate withdrawal; if the post-withdrawal metric is ∞, flag the segment as unprotected:

```
primary = dijkstraECMP(adj, src, dst)
for each edge e in primary.edges:
  if backupPath(topo, src, dst, [e]).cost == ∞:
    unprotected.push(e)
```

Semantics: **withdrawing this single link severs src → dst with no available alternate path** — a SPOF for that pair.

---

## §6 C3 — Node failure simulation

### §6.1 Connectivity

`connectedComponents(adj, routerIds)` — BFS over routers only (pseudo-nodes skipped), yielding connected components.

### §6.2 Traffic redistribution

`allPairsLoad(topo, failedEdges, failedNodes)`:

```
load[edge] = Σ over all (a→b) pairs: 1 / r.paths.length
```

ECMP splits load equally; every path contributes to each link it traverses.

`simulateNodeFailure` takes `before / after` network-wide load snapshots and produces, for each link, `direction ∈ {inc, dec, none}` and `changePct`.

---

## §7 C4 — ECMP backup validation

For each (src, dst) pair:

1. Compute the primary; if `paths.length < 2`, or if all paths share a single first-hop → `status: n/a`.
2. Collect `ecmpEdgeIds` = the first-hop link set of the primary.
3. For each `eid ∈ ecmpEdgeIds`, withdraw and recompute:
   - If unreachable → `status: failed`, reason = `removing eid → unreachable`.
   - If the post-withdrawal first-hop is not in `ecmpEdgeIds \ {eid}` → `status: failed`, reason = `backup uses non-ECMP link`.
4. All survive → `status: passed`.

**Semantics**: a well-formed ECMP set should absorb the loss of any one member by reassigning traffic *within* the set — load should not spill onto a non-ECMP path.

---

## §8 C5 — Asymmetric path detection

For each unordered (a, b):

```
fwd = SPT(a → b)
rev = SPT(b → a)
fwdSig = sorted set of stripPseudo(p).join('>')
revSig = sorted set of stripPseudo(p).reverse().join('>')
```

If `fwd.cost ≠ rev.cost` or `fwdSig ≠ revSig` → pair is asymmetric.

---

## §9 C6 — Prefix redundancy heatmap

Per router: count `nonRedundant / total`. Map the ratio to a color:

| Ratio | Color | Meaning |
|-------|-------|---------|
| 0 | Green | Every prefix is redundantly advertised |
| 0–0.33 | Yellow | A few prefixes are singly-advertised |
| 0.33–0.66 | Orange | ~half of prefixes are non-redundant |
| > 0.66 | Red | Majority of prefixes are singly-advertised |

---

## §10 C8 — N-1 worst-case ranking

### §10.1 Scenario enumeration

```
scenarios =
  { kind:'edge', id, edge } for each p2p link ∪
  { kind:'node', id }       for each router
```

Transit links are excluded — they're LSA2 abstractions, not physical failure modes.

### §10.2 Dual accumulation

For each scenario, recompute SPT for every (a, b) pair and accumulate both views:

**Per-pair**

```
pairWorst[a>b] = {
  base:      baseline cost (no failure),
  worstCost: worst cost across all scenarios,
  culprits:  list of scenarios that produce the worst cost,
}
```

**Per-failure**

```
failStats[scenario] = {
  unreachable: pairs rendered unreachable by this failure,
  degraded:    pairs still reachable but on a longer path,
  totalDelta:  Σ (worstCost - baseCost),
  maxRatio:    max worst / base ratio observed,
}
```

### §10.3 Sort order

- **Pair**: `ratio = worstCost / baseCost` descending; unreachable (∞) first.
- **Failure**: unreachable count descending → `totalDelta` descending.

### §10.4 Relationship to §5.4 (Unprotected scan)

| Dimension | §5.4 Unprotected scan | §10 N-1 ranking |
|-----------|-----------------------|-----------------|
| Focus | Single (src, dst) pair | Every pair in the topology |
| Failure scope | Only links on the primary path | Every link + every router |
| Verdict | Binary (reachable / unreachable) | Continuous (ratio + unreachable count) |
| Use case | "Is *this* path SPOF-free?" | "Where is the topology weakest overall?" |

§5.4 is a binary subset of §10.

---

## §11 Visual state machine

### §11.1 Two orthogonal dimensions

Each entity carries two independent states:

| Dimension | Source | Cross-tab behavior | Edge values | Node values |
|-----------|--------|--------------------|-------------|-------------|
| **op** | Persistent user action (right-click failure) | Never cleared | `healthy` / `failed` | `up` / `down` |
| **role** | Transient analytical markup | Cleared on tab switch | `none` / `primary` / `backup` / `unbacked` / `load-inc` / `load-dec` / `failed-by-node` | `none` / `endpoint` / `highlight` / `asym-mark` / `heat-{green/yellow/orange/red}` / `failed-node` |

### §11.2 Render precedence

```
op wins:
  edge.op = failed                → render as failed (red dashed)
  node.op = down                  → render as failed-node
  edge endpoint node.op = down    → derived as failed (do NOT write back to edge.op — single source of truth)
otherwise: role maps directly to its CSS class.
```

### §11.3 Facade

`failedEdges` and `failedNodes` are Set-like wrappers (`has / add / delete / clear / size / iterator`) over the state machine — they exist so existing algorithms can accept them as parameters without coupling to the state machine.

### §11.4 Invariants

1. Every Cytoscape `addClass / removeClass` must go through `setEdgeOp / setEdgeRole / setNodeOp / setNodeRole` — direct class manipulation is forbidden.
2. Tab switches call `clearAllRoles()` — clears role only, never op.
3. "Reset view" button = `clearAllRoles()`; "Clear all failures" = `failedEdges.clear() + failedNodes.clear()` — the two semantics are deliberately separate.

---

## §12 Tab behavior matrix

| Tab | ID | Honors right-click failures? | Auto-runs on tab activation |
|-----|----|------------------------------|-----------------------------|
| Path | C1 | ✅ | `renderPath(src, dst)` |
| Matrix | C2 | ✅ | `renderMatrix()` |
| All Pairs | C3 | ✅ | `listAllPairs.click()` |
| Failure Sim | C4 | ❌ (own scenario) | — |
| ECMP Check | C5 | ❌ (design-time audit) | — |
| Asymmetric | C6 | ❌ (design-time audit) | — |
| Heatmap | C7 | ❌ (design-time audit) | — |
| N-1 | C8 | ❌ (design-time audit) | `runN1Scan.click()` |
| Links | — | — | `renderEdgeEditor()` |

---

## §13 Algorithmic complexity

Let `V = number of routers`, `E = number of links`. This implementation uses an array-based priority queue (not a Fibonacci heap), so a single SPT computation is approximately `O((V + E) log V)`.

| Module | Per-invocation cost | Trigger |
|--------|---------------------|---------|
| C1 SPT (single pair) | O((V+E) log V) | User click |
| C2 Matrix (all pairs) | O(V² · (V+E) log V) | Matrix tab activation |
| C3 Failure Sim | 2 × all-pairs | User click |
| C4 ECMP Check | O(V² · k · SPT) | User click; k = ECMP edge count |
| C5 Asymmetric | O(V² · SPT) | User click |
| C7 N-1 | O((V + E) · V² · SPT) | User click |

At POC scale (V ≈ 10, E ≈ 20) the full N-1 sweep is ~6,000 SPT computations and completes in < 200 ms in-browser.
At production scale (V ≈ 100, E ≈ 300) the same sweep is on the order of 4 × 10⁶ SPT computations — feasible only via Web Workers or a server-side compute path.

---

## §14 Changes since v1.0

This SPEC corresponds to BlastRadius POC `v1.x` (the line that branched from Topolograph).
Notable deltas from the original OSPF algorithms SPEC:

- Added §10 N-1 worst-case ranking.
- §11 visual state machine is now its own chapter (previously scattered across UI handlers).
- §12 tab behavior matrix makes the "honors right-click failures vs design-time audit" split explicit.

Historical commit anchors live in the "algorithm trigger checklist" comments inside `topology.js`.
