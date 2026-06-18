# BlastRadius SPEC

This document specifies the data model, algorithm definitions, module layering,
and visual state machine of the BlastRadius POC.
**The code is authoritative** — this document describes the actual behavior of
`engine.js` / `index.html`.

## Numbering convention (read this first)

- **Algorithms**: always anchored by **§ number** (§4–§10); the block comments in `engine.js` likewise lead with `§N —`, for two-way traceability.
- **UI tabs**: `C1–C10`, purely the naming of the 10 tabs in `index.html`, **used for the screen only**.

In other words `Cx` always means a UI tab; algorithms no longer use C (an older
version once prefixed `engine.js` with `Cx`, but because it shared letters with
the UI tabs and was confusing, it has been removed). The two are **not** one-to-one:
e.g. "Failure simulation" is UI tab C5 but its core algorithm is in §6.
The mapping of UI tabs to their backing § / functions is consolidated in §12.

---

## §1 Data Model

> **Note**: this section defines the **data schema (model)**, not any specific
> dataset. The built-in topology / traffic / RTT are replaceable synthetic
> samples produced by the generator; only the field structure is the stable contract.

### §1.1 Topology Schema

`topology.js` exposes a single global variable `topology`, structured as:

```js
const topology = {
  nodes: [...],       // Router + Pseudo-node
  edges: [...],       // p2p / transit edges
  externals: [...],   // LSA5 (optional)
  positions: { ... }, // Cytoscape default coordinates (optional)
};
```

> **Note (edit.html internal state)**: In edit.html's internal state, externals are stored per-node (`node.externals`). Export flattens them back to the top-level `externals` array for `topology.js` compatibility.

### §1.2 Node

```ts
type Node =
  | {
      id: string;            // unique id; PoP short code (TPE / TYO …) or, for OSPF imports, a safe token (city code + index / R_<rid> / PN_*)
      label: string;         // graph display text, supports \n line breaks
      type: 'router';
      rid?: string;          // OSPF Router-ID (set by the OSPF importer; hostname, if present, feeds `label`)
      country?: string;      // ISO country code (for UI grouping / coloring)
      city?: string;         // city code (anchor for RTT city-pair lookup)
      area: string;          // OSPF area (currently only '0' supported)
      stubs?: string[];      // LSA3 equivalent: prefixes (CIDR) advertised by this router
      isASBR?: boolean;      // whether it is an ASBR (injects LSA5 externally)
      externals?: External[]; // LSA5 advertisements, per-node (moved from top-level topology.externals array). Only present on router nodes with isASBR=true.
      isABR?: boolean;       // whether it is an ABR (inter-area computation not yet enabled)
    }
  | {
      id: string;            // starting with 'PN' denotes a pseudo-node (LSA2 abstraction)
      label: string;
      type: 'pseudonode';
      subnet: string;        // the CIDR of this transit LAN
    };
```

### §1.3 Edge

```ts
type Edge =
  | {
      id: string;
      source: string;
      target: string;
      cost: number;          // forward cost (source → target)
      costRev?: number;      // reverse cost (p2p only; if omitted equals cost, i.e. symmetric)
      capacity?: number;     // link capacity (Gbps), for C4 edge-traffic utilization
      type: 'p2p';
    }
  | {
      id: string;
      source: string;        // one end is a Router, the other a Pseudo-node
      target: string;
      cost: number;          // Router → Pseudo cost
      capacity?: number;
      type: 'transit';       // Pseudo → Router fixed at 0 (LSA2 semantics)
    };
```

### §1.4 External (LSA5)

```ts
type External = {
  advertising_router: string;   // which ASBR injects it
  subnet: string;               // e.g. '0.0.0.0/0'
  metric: number;
  metric_type: 'E1' | 'E2';
};
```

### §1.5 Companion data files (optional)

| File | Global / export | Which UI tab | Behavior when missing |
|------|-----------------|--------------|-----------------------|
| `demand.js` | `module.exports = { demand }` | C4 edge traffic, C5 failure-sim traffic view | Traffic views show "demand.js not loaded" |
| `rtt.js` | `module.exports = { rtt }` | C2 RTT/SLO matrix mode (§4.5), C10 cost reference | C2 falls back to cost-only; C10 reference column hidden |
| `srlg.js` | global `srlg` (no exports) | C5 failure-sim SRLG dropdown | Only single-element failure remains |
| `draft.js` | `window.Draft` | index.html + edit.html localStorage persistence | — |

`draft.js` is a shared localStorage persistence module. Exports `window.Draft` with `read(topoKey)`, `write(data, topoKey)`, `clear(topoKey)`. Per-topology keys via `?topo=` URL param. 2-hour expiry. Used by both index.html and edit.html.

`demand.js` provides **5 scenario profiles** — `avg` / `max` / `asia_busy` / `amer_busy` / `eu_busy` — switched via `demand.active`; `engine.js` only reads `demand.matrix` / `demand.default` (profile switching is transparent to the algorithms). Values are **float Gbps** (1 decimal place in gen.mjs; 3 decimal places in companions.mjs). `rtt.js` contains only `matrix` (city×city RTT) and `edges` (PoP node-pair RTT); the `cityRef` field has been removed (it was a mirror of `city_rtt.csv`, never consumed by the frontend).

**OSPF-imported datasets**: `topology.imported.js` (+ companions
`demand/srlg/rtt.imported.js`) are produced by the import pipeline from real
`show ip ospf database router/network` output and live **alongside** the demo
`*.js` (they do not overwrite). The LSDB parser is the shared pure module
`ospf-import.js` (imported by both the data editor and
`working/ospf_to_topology.mjs`); imported router nodes carry `rid` (§1.2) and a
safe-token `id`. `OSPF_CITY` values in `ospf-import.js` are plain city code strings;
country is derived from `CITY_GEO` in `gravity.js` (the SSOT for city geography).
See CLAUDE.md for the toolchain and fixed generation order.

---

## §2 Module Layering

```
┌────────────────────────────────────────────────────────┐
│ Module A: Topology Data    (topology.js / demand.js …)  │
├────────────────────────────────────────────────────────┤
│ Module B: Graph Builder    (§3)                         │
│   - buildAdjacency(edges, failedEdges, failedNodes)     │
│   - buildPrefixIndex(topo)                              │
├────────────────────────────────────────────────────────┤
│ Module C: Algorithm Engine (§4–§10)                     │
│   §4   SPT + ECMP                                       │
│   §5   Backup Path                                      │
│   §6   Failure Sim + Load                               │
│   §7   ECMP Check                                       │
│   §8   Asymmetric                                       │
│   §9   Prefix Heatmap                                   │
│   §10  N-1 Worst-case                                   │
├────────────────────────────────────────────────────────┤
│ Module D: State Machine    (§11)                        │
│   edgeStates / nodeStates  (op + role)                  │
│   failedEdges / failedNodes facade                      │
├────────────────────────────────────────────────────────┤
│ Module E: UI Layer         (Cytoscape + 10 Tab handlers)│
└────────────────────────────────────────────────────────┘
```

The bottom-up call direction is strictly "downward dependency" — UI calls Engine,
Engine calls Builder, Builder reads Topology. The State Machine is the bridge
between UI and Engine: UI manipulates persistent state via `setEdgeOp / setNodeOp`,
and the Engine reads it through the `failedEdges / failedNodes` facade.

---

## §3 Graph Builder

### §3.1 Adjacency (`buildAdjacency`)

Converts `topology.edges` into the adjacency list `adj[u] = [[v, cost], ...]`
used by Dijkstra. Three rules:

**Rule 1 — p2p edge**

```
add(source, target, cost)
add(target, source, costRev ?? cost)
```

**Rule 2 — transit edge (LSA2 semantics)**

```
add(router, pseudo, cost)   // Router → Pseudo: has cost
add(pseudo, router, 0)      // Pseudo → Router: fixed 0
```

**Rule 3 — failure filtering**

- `failedEdges.has(e.id)` → skip the whole edge
- `failedNodes.has(u || v)` → skip that direction

### §3.2 Prefix Index (`buildPrefixIndex`)

`prefix → Set<advertising_router_id>`; a set of size ≥2 is considered
backed-up. Sources:

| Rule | Source | Behavior |
|------|--------|----------|
| Rule 3 | `node.stubs` | that router is an advertiser |
| Rule 5 | LSA2 transit | all attached routers "own" that pseudo-node's subnet |
| Rule 4 | `externals` | the `advertising_router` in an LSA5 is an advertiser |

---

## §4 SPT + ECMP

### §4.1 Algorithm

Dijkstra + equal-cost relaxation expansion. `preds[v]` is a `Set<predecessor>`,
allowing multiple predecessors:

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

Walk `preds` backward from `dst`, DFS-reconstructing the full list of
shortest paths source → dst.

### §4.3 Pseudo-node post-processing

`stripPseudo(path)` filters out nodes whose id starts with `PN`, presenting a
"router-level" view.

### §4.4 IP / Network resolution

`resolveLPM(prefixIndex, target)`: currently implemented as "exact match +
default-route (`0.0.0.0/0`) fallback". Full LPM is on the Roadmap.

### §4.5 Matrix RTT / SLO mode (C2 presentation)

C2 offers two view modes (**default RTT**). **Cost** shows the §4 shortest-path
cost. **RTT / SLO** sums each edge's RTT along the shortest path (per-edge RTT
from `rtt.edges`, else the `rtt.matrix[cityA][cityB]` city-pair lookup; ECMP →
min over paths) and shades each cell against an SLO target (default ≤150 ms),
reporting coverage (% of reachable pairs within target). This is a presentation
layer in `index.html` — the path itself is still §4's cost-based SPT. Needs
`rtt.js`; without it the mode falls back to cost.

---

## §5 Backup Path

### §5.1 Cut-edge recompute

`backupPath(topo, src, dst, removedEdges)` = apply `removedEdges` onto
`failedEdges`, then rerun §4.

### §5.4 Unprotected Segment Scan

`unbackupSegmentScan` — for each edge on the primary path, try removing it; if
the post-removal cost = ∞, mark the edge as unbacked:

```
primary  = dijkstraECMP(adj, src, dst)
for each edge e in primary.edges:
  if backupPath(topo, src, dst, [e]).cost == ∞:
    unbacked.push(e)
```

Semantics: **the moment this edge breaks, src → dst is severed with no backup path available.**

---

## §6 Failure Simulation + Load

### §6.1 Connectivity

`connectedComponents(adj, routerIds)`: BFS over routers-only (skipping
pseudo-nodes), partitioning into connected components.

### §6.2 Traffic redistribution (equal-weight edge load)

`allPairsLoad(topo, failedEdges, failedNodes)`:

```
load[edge] = Σ over all (a→b) pairs: 1 / r.paths.length
```

ECMP equal-weight; each path adds to every edge it traverses. This is exactly
**edge betweenness centrality (Edge BC)**.

`simulateNodeFailure` takes the difference of two whole-network loads
(`before / after`) and outputs each edge's `direction ∈ {inc, dec, none}` and `changePct`.

### §6.2b Traffic-weighted edge load (`allPairsTraffic`)

`allPairsTraffic(topo, demand, failedEdges, failedNodes)` — the same SPT
enumeration round as §6.2, but each path's accumulation weight changes from "1"
to "`demand[a][b]`" (consuming the `demand.js` traffic matrix).

**Full-duplex / unidirectional capacity**: circuits are full-duplex by default
and `capacity` is a **unidirectional** value. So accumulation is split by actual
direction of travel into **forward (`trafficFwd`) / reverse (`trafficRev`)**
(direction judged from the path's node sequence: `np[i]===e.source` means
"forward"), and the returned `traffic[edge] = max(fwd, rev)` takes the **busier
direction**. Combined with `edge.capacity` this yields
**utilization = max(fwd, rev) / capacity** (i.e. "is the busier direction
overloaded"), avoiding the ~2× overestimate from summing both directions and
dividing by a unidirectional capacity.

- transit likewise: `fwd` = ingress (`router→PN`, controllable via interface cost), `rev` = egress (`PN→router`, fixed 0 for Type-2).
- when `demand.js` is missing, the caller must guard against this (the C4 tab shows a "not loaded" notice).
- C4 edge traffic, C5 failure sim, §15 `evalCongestion` (MLU), and C9 N-1 overflow **all read the same `traffic[edge]`** (peak), so the direction fix takes effect in one place and downstream needs zero changes. `allPairsLoad` (§6.2, edge betweenness) is a capacity-free centrality, direction-agnostic, and unaffected.

### §6.3 Node Betweenness Centrality

`computeNodeBC(topo, failedEdges, failedNodes)`: classic Freeman BC, meaning
"how much transit SPT traffic each router carries on average".

```
BC(v) = Σ over all (s, t) pairs where s ≠ v ≠ t:
          σ(s, t | v) / σ(s, t)
```

Implementation details:

- ECMP equal-weight over **node-distinct** paths: `w = 1 / (node-distinct path count)`. Parallel equal-cost links (two cables, identical node sequence) collapse to one path and do **not** inflate the node's centrality — link-level parallelism is a capacity matter (handled per-edge by §6.2b), not node betweenness.
- `stripPseudo(path)` filters pseudo-nodes first, keeping only the router-level view
- exclude endpoints: loop `for i in [1, stripped.length - 1)`, head and tail don't count as "transit"
- shares the same SPT-enumeration round as §6.2 `allPairsLoad` (Edge BC), but accumulates onto the intermediate node instead of the edge
- **shared core**: §6.3 and §6.3b both run through one `computeNodeLoad(topo, demand, …)` (`demand=null` → unit/structural; `demand` given → Gbps), via the `nodeDistinctPaths` / `accNodeBetweenness` helpers with single-source reuse. The two exported names are thin wrappers.

> **UI mapping**: tab **C3 Centrality** presents both §6.2's **Edge BC** (per link)
> and this section's **Node BC** (per router); each does a 4-tier classification
> (`idle = 0 / rare > 0 / normal > 0.1·max / hub > 0.4·max`), mapping to the
> procurement recommendations "dual-box dual-path / maintain / can downgrade /
> candidate for merging an adjacent PoP".

### §6.3b Demand-weighted Node Betweenness

`computeNodeTraffic(topo, demand, failedEdges, failedNodes)`: the same node
accumulation as §6.3 (strip pseudo + exclude endpoints), but each `(a, b)`
pair's weight changes from "1" to `demand[a][b]` (consuming the same gravity-model
traffic matrix as §6.2b). Its meaning is "how many **Gbps** of transit traffic
each router forwards on average" — i.e. demand-weighted node betweenness.

```
WBC(v) = Σ over all (s, t) pairs where s ≠ v ≠ t:
           demand[s][t] · σ(s, t | v) / σ(s, t)
```

Implementation details:

- ECMP equal-weight over **node-distinct** paths: `w = demand[a][b] / (node-distinct path count)` (consistent with §6.3; parallel links collapse, **not** edgePaths)
- single-source reuse (`dijkstraSource` once per source, then `enumeratePaths` per dst) — same as the rest of the all-pairs family
- aligned with §6.2b `allPairsTraffic`: iterate all routers (do not exclude failed nodes); demand into / out of failed nodes counts as `lostDemand`
- returns Gbps accounting (`totalDemand / servedDemand / lostDemand / lostDemandPairs`), reused by the C3 reachability banner
- when `demand.js` is missing, returns an empty result; the UI toggle auto-disables and falls back to §6.3 unit mode

> **UI mapping**: the C3 node-centrality ranking adds a "transit count ⇄ traffic-weighted"
> toggle; `demand` mode uses this section, with classification thresholds and
> 4-tier copy inherited from §6.3. **§6.3 = structural fragility (who is the
> topological hub)**; **§6.3b = traffic heat (who actually carries the most
> Gbps)** — where the two disagree is exactly the procurement signal for
> "structurally unimportant but crushed by traffic", or the reverse.

---

## §7 ECMP Backup Check

`ecmpBackupCheck` / `ecmpBackupScanAll` — for each (src, dst):

1. compute primary; if `paths.length < 2` → `reason: 'no-ecmp'`; or if they share the same first-hop → `reason: 'single-first-hop'` (both `status: n/a`)
2. collect `ecmpEdgeIds` = the primary's set of first-hop edges
3. for each `eid ∈ ecmpEdgeIds`, remove it and recompute:
   - if unreachable → `status: 'failed', reason: 'remove-unreachable', eid`
   - if the new path's first-hop is not in `ecmpEdgeIds \ {eid}` → `status: 'failed', reason: 'backup-non-ecmp', eid, bid`
4. all pass → `status: 'passed'`

> **reason contract**: `reason` is always a **stable code** (kebab) plus structured
> params (`eid` / `bid`); the engine emits **no prose strings**. Display text is the
> UI's job, via the `REASON_TEXT` lookup table (which is also the i18n reason dictionary).

**Semantics**: in an ideal ECMP group, after any member fails, traffic should be
taken over by the other members of the group and should not escape the group.

---

## §8 Asymmetric Path Detection

`detectAsymmetric` — for each unordered pair (a, b):

```
fwd = SPT(a → b)
rev = SPT(b → a)
fwdSig = sorted set of stripPseudo(p).join('>')
revSig = sorted set of stripPseudo(p).reverse().join('>')
```

If `fwd.cost ≠ rev.cost` or `fwdSig ≠ revSig` → add to the asymmetric list.

---

## §9 Prefix Advertisement-Redundancy Heatmap

`computeHeatmap(topo, prefixIndex)` — per router, count `single-advertised /
total`; Ratio maps to color:

| Ratio | Color | Meaning |
|-------|-------|---------|
| 0 | Green | all prefixes have redundant advertisement |
| 0–0.33 | Yellow | a few prefixes are singly advertised |
| 0.33–0.66 | Orange | about half the prefixes have no redundant advertisement |
| > 0.66 | Red | most prefixes are singly advertised |

---

## §10 N-1 Worst-case Ranking

### §10.1 Enumeration

`computeN1WorstCase(topo)`:

```
scenarios =
  { kind:'edge', id, edge } for each p2p edge ∪
  { kind:'node', id }       for each router
```

Transit edges are not counted as physical failure scenarios (they are an LSA2
internal abstraction). SRLG group failure (multiple edges / nodes failing
simultaneously) is expanded by the UI layer's `expandSRLG` and then fed into the
same recompute logic.

### §10.2 Dual-perspective accumulation

For each scenario, recompute SPT over the whole network for all (a, b) pairs,
accumulating two kinds of stats simultaneously:

**Per-pair**

```
pairWorst[a>b] = {
  base:      baseline cost (no failure),
  worstCost: the worst cost across all scenarios,
  culprits:  the scenario list that produced the worst result,
}
```

`culprits` collects **all** scenarios that reach the worst cost — including every
single-point failure that makes the pair unreachable (∞), not just the first one.

**Per-failure**

```
failStats[scenario] = {
  unreachable: how many pairs this failure makes unreachable,
  degraded:    how many pairs still connect but get slower,
  totalDelta:  Σ (worstCost - baseCost),
  maxRatio:    the maximum worst / base ratio,
}
```

### §10.3 Sorting

- **Pair**: `ratio = worstCost / baseCost` descending, unreachable (∞) first
- **Failure**: unreachable count descending → `totalDelta` descending

### §10.4 Relationship to §5.4 (Unbackup)

| Dimension | §5.4 Unbackup | §10 N-1 |
|-----------|---------------|---------|
| Focus | a single (src, dst) pair | all pairs network-wide |
| Failure scope | only edges on the primary path | all edges + all routers (+ SRLG groups) |
| Decision | binary (reachable / not) | continuous (ratio + unreachable count) |
| Use | "is this path safe?" | "where is the network most fragile?" |

§5.4 is a binary subset of §10.

---

## §11 Visual State Machine

### §11.1 Two orthogonal dimensions

Each entity holds two independent states:

| Dimension | Source | Cross-tab behavior | Edge values | Node values |
|-----------|--------|--------------------|-------------|-------------|
| **op** | persistent user action (right-click failure) | not cleared | `healthy` / `failed` | `up` / `down` |
| **role** | transient annotation from analysis results | auto-cleared on tab switch | `none` / `primary` / `backup` / `unbacked` / `load-inc` / `load-dec` / `failed-by-node` / `bc-{hub/normal/rare/idle}` | `none` / `endpoint` / `highlight` / `asym-mark` / `heat-{green/yellow/orange/red}` / `failed-node` |

### §11.2 Render rules

```
op takes priority:
  edge.op = failed         → render as failed (red dashed)
  node.op = down           → render as failed-node
  edge endpoint node.op = down → derived as failed (not written back to edge.op, keeping a single data source)
otherwise role maps directly to the corresponding CSS class.
```

### §11.3 Facade

`failedEdges` and `failedNodes` are Set-like wrappers over the state machine
(`has / add / delete / clear / size / iterator`), provided to the existing
algorithms as parameters — so the algorithm layer need not know the state-machine details.

### §11.4 Invariants

1. all Cytoscape `addClass / removeClass` must go through `setEdgeOp / setEdgeRole / setNodeOp / setNodeRole`; direct manipulation of element classes is forbidden
2. on tab switch, call `clearAllRoles()` — clears role only, leaves op untouched
3. the "Reset view" button = `clearAllRoles()`; "Clear all failures" = `failedEdges.clear() + failedNodes.clear()`; the two are semantically separate

---

## §12 UI Tab Matrix (authoritative reference)

`index.html` has **10 tabs** in three groups. The table below is the
authoritative mapping of UI tab → backing § / function:

### Live-status group (consumes right-click failure markers)

| UI tab | UI No. | Backing § / function | Auto-run on switch |
|--------|--------|----------------------|--------------------|
| Path | C1 | §4 `dijkstraECMP` + §5.4 `unbackupSegmentScan` | `renderPath(src, dst)` |
| Matrix | C2 | §4 all-pair `dijkstraDist` (+ §4.5 RTT/SLO mode) | `renderMatrix()` |
| Centrality | C3 | §6.2 `allPairsLoad` (Edge BC) + §6.3 `computeNodeBC` (Node BC); node ranking can switch to §6.3b `computeNodeTraffic` (traffic-weighted, needs demand.js) | `listAllPairs.click()` |
| Edge traffic | C4 | §6.2b `allPairsTraffic` (needs demand.js) | auto-computes actual load / utilization |

### Design-audit group (ignores right-click failures, based on the complete topology)

| UI tab | UI No. | Backing § / function | Auto-run on switch |
|--------|--------|----------------------|--------------------|
| Failure simulation | C5 | §6 `connectedComponents` + §6.2/§6.2b before-after delta; SRLG via `expandSRLG` | carries scenarios, user selects element / SRLG |
| ECMP | C6 | §7 `ecmpBackupScanAll` | auto-scan |
| Asymmetric | C7 | §8 `detectAsymmetric` | auto-scan |
| Prefix | C8 | §9 `computeHeatmap` | auto-scan |
| N-1 | C9 | §10 `computeN1WorstCase` | `runN1Scan.click()` |

### Edit group

| UI tab | UI No. | Backing § / function | Auto-run on switch |
|--------|--------|----------------------|--------------------|
| Link | C10 | §1.3 editing + §4 live recompute; includes §15 congestion optimization (`optimizeWeights`, needs demand.js) | `renderEdgeEditor()` |

> **Group semantics**: the live-status group reflects the failures manually
> marked on the graph; the design-audit group is always based on the complete
> topology, asking "is the design itself resilient enough" rather than "is it
> reachable right now".

---

## §13 Algorithm Complexity

Let `V = number of routers`, `E = number of edges`. Dijkstra uses a **binary
min-heap** (`heapPush/heapPop`, `[dist,seq,node]`; the `seq` tiebreak makes the
equal-distance pop order match the old stable-sort → byte-identical results), so
a single SPT is `O((V + E) log V)`. **All-pairs computation uses single-source
reuse**: `dijkstraSource` computes from each source to all destinations in one
pass, and `enumeratePaths` then expands per dst, so "all-pairs" is **V
single-source runs**, not V² single-pair runs (the old version reran the source
for every (a,b), wasting V−1 redundant runs).

| Module | Single-run cost | Trigger frequency |
|--------|-----------------|-------------------|
| §4 SPT (single pair) | O((V+E) log V) | user click |
| §4 Matrix / Load / Traffic (all pairs) | **V × single-source** = O(V · (V+E) log V) | tab switch |
| §6 Failure Sim / Load | 2 × all-pairs | user click |
| §7 ECMP Check | O(V² · k · SPT) | user click, k = ECMP edge count (single-source reuse not yet applied) |
| §8 Asymmetric | **V × single-source** + V² expansion | user click |
| §10 N-1 | O((V + E) · V × single-source) | user click (cost only, no path expansion) |
| §15 Weight optimization | O(maxEvals × all-pairs) (budget cap) | user click |

The built-in synthetic sample is a POC small scale (a handful of routers, dozens
of edges). With the binary heap + single-source reuse, the §15 weight-optimization
worst case measured down from ~5.2s to ~1s (about 5×), and the all-pairs Dijkstra
call count dropped ~V×. The scale is set by the generator and can be scaled up;
once into real backbone scale (V in the tens to hundreds, E in the hundreds), a
Web Worker or backend is still needed, plus **incremental SPF** (changing one
weight only recomputes affected paths, listed as a next step in §15.6). The
actual numbers vary with the dataset — this table gives **order-of-magnitude
relationships**, not fixed values for any specific dataset.

---

## §14 Differences from the original OSPF spec

This SPEC corresponds to BlastRadius POC `v1.x` (after branching off from the
Topolograph naming). Main differences:

- Added §6.2b traffic-weighted edge load (`allPairsTraffic`) + the C4 edge-traffic tab
- Added §10 N-1 Worst-case Ranking, wired up to SRLG group failure
- §11 visual state machine pulled out into its own chapter (previously scattered across UI handlers)
- §12 changed to an authoritative "UI tab (C1–C10) → backing §/function" mapping; algorithms are anchored solely by §, no longer by C numbers (the old `Cx` prefix in engine.js has been removed)
- Added §6.3b traffic-weighted node centrality (`computeNodeTraffic`) + the C3 transit-count⇄traffic-weighted toggle
- Added §15 OSPF weight optimization (Fortz-Thorup objective + Tabu Search), integrated into C10; the optimizer's bounds are capped by `COST_CLAMP` (`[5,500]`, a single constant exported by the engine), preventing long-link RTT floors from hitting the ceiling and being frozen
- Added §4.5 matrix RTT/SLO mode (C2 defaults to an RTT view scored against an SLO target, with coverage %)
- Added an OSPF LSDB import path: the shared pure module `ospf-import.js` parses `show ip ospf database router/network` into the §1 schema (populating `rid`) and produces `*.imported.js` datasets that live alongside the demo data — the original spec assumed a hand-authored static topology
- Demand values changed from integer to **float Gbps** (1 d.p. in gen.mjs; 3 d.p. in companions); profile set expanded to 5: `avg` / `max` / `asia_busy` / `amer_busy` / `eu_busy` (companions now matches gen.mjs); RTT CSV files renamed `node_rtt.csv` / `city_rtt.csv`
- `gravity.js` (in `output/`) is now the SSOT for gravity model constants (D0/K/EMIT/FIBER), `CITY_GEO` (100+ cities, lat/lon/country), and `haversineKmCity()`; browser + Node compatible; imported by `gen.mjs`, `companions.mjs`, `ospf-import.js`, and `edit.html` (replaces `working/gravity.mjs`)
- `rtt.js` now contains only `matrix` and `edges`; the `cityRef` field has been removed (it was a mirror of `city_rtt.csv`, never consumed by the frontend)
- `ospf-import.js` `OSPF_CITY` values simplified from `{ city, country }` objects to plain city code strings; country is derived from `CITY_GEO` in `gravity.js`
- `edit.html` data editor: Equal Earth projection LON0 changed from 140°E to 150°E in both `layoutGeoMap()` and `layoutMetroMap()` (ITU/Telegeography Asia-Pacific convention; seam at −30°W avoids Fortaleza wrapping to the wrong side); new **Metro Map** layout option ("八向化") added — Equal Earth projection → grid quantization → Octilinear Nudge → overlap resolution; parameters in `LAYOUT_PARAMS.metro` (`grid`, `nudgeIter`, `angleTol`, `geoAnchor`, `distPow`, `directions` 8/16/32); ~70–80% of edges achieve octilinear angles
- **edit.html data architecture**: JS SSOT Maps (nodes/edges/positions) as single source of truth; cy is renderer only. Inspector uses mount/patch pattern — only rebuilds DOM when switching elements, patches field values in-place otherwise. `applyField` writes Maps first, then syncs to Cytoscape (`_skipCySync` flag prevents cy data events from bouncing back to Maps). `externals` relocated from top-level array to per-node `node.externals`. localStorage sync via shared `draft.js` module with BroadcastChannel for cross-tab updates.
- `metro-tune.html`: new standalone interactive parameter tuner for Metro Map layout; features 6 compression modes, live preview with edge coloring (green=octilinear / orange=near / red=non-octilinear), direction selector (8/16/32), and display controls
- `serve.py`: new dev HTTP server returning `Cache-Control: no-store`; replaces `python -m http.server` which had ~1 min browser-cache delay
- **Planned (not implemented)**: explicit-path steering **steer** (Tier 0, pull specific traffic off the shortest path) + bandwidth admission **CAC** (Tier 1, "overflow / admission-fail once full"). Design in `steer.md`; once implemented, merged into a new §.

The block comments in `engine.js` (`§4 — SPT` …) correspond two-way with the §
numbers in this document; UI tab numbers are separately in §12.

---

## §15 OSPF Weight Optimization (Fortz-Thorup objective + Tabu Search)

Given demand and capacity, automatically search for a set of OSPF weights that
**lowers congestion**. Congestion evaluation reuses §6.2b `allPairsTraffic`
(ECMP equal-split), so this section is "a search layer wrapped around the
existing load engine" — it does not touch SPT/ECMP.

### §15.1 Objective function (lexicographic two-level)

```
minimize ( MLU , S )
  MLU = max_e u_e            primary: max link utilization u_e = traffic_e / cap_e
  S   = Σ_e (scale see below) secondary: tie-break (among equal-MLU solutions, pick the lower total congestion)
```

`S` auto-switches by regime (`tieBreak='auto'`):

| Regime | S | Motivation |
|--------|---|------------|
| Feasible (MLU<1) | `Σ u_e²` (balance) | the primary objective already kills the peak; the secondary smooths the remaining load |
| Overloaded (MLU≥1) | `Σ cap_e · ψ(u_e)` (FT convex) | when you can't get under 100%, pick the least-bad solution with **fewest links deep in the red** |

`ψ` = Fortz-Thorup piecewise-convex (slopes 1→3→10→70→500→5000, knees
1/3·2/3·9/10·1·11/10), cap-weighted so overload on a big pipe carries higher
weight. Comparison uses an ε-band: the primary objective only decides when the
MLU difference exceeds ε, otherwise compare S.

**MLU = max edge utilization**, where utilization uses §6.2b's **busier-direction
value** (`max(fwd, rev)/capacity`, unidirectional capacity), counting "all edges
that have capacity" (p2p + transit) (Option A, the same edge set as C4 edge
traffic → consistent definition across the two views). Rationale: congestion on
a transit segment (the Router→Pseudo of a shared LAN) is real; excluding it would
let the optimizer lower p2p while being blind to a worse LAN segment, **overstating
its score**. The optimizer **only adjusts p2p weights by default** (using p2p
reroutes to redistribute the LAN ingress across the multiple attached routers);
it can also optionally **adjust transit ingress cost as well** (Option B,
`includeTransit`, see §15.6).

> **Impact of the direction fix**: after switching to unidirectional peak, the
> earlier "sum both directions / divide by unidirectional capacity" ~2×
> overestimate disappears. The measured `max` scenario MLU was corrected from
> 202% (inflated) to **101%** (70% after optimization, **feasible**) — the
> original "infeasible" verdict was a counting artifact; capacity is in fact
> sufficient. transit's `fwd`/`rev` are already separated (§6.2b), so Option B's
> directional information is **ready** and is no longer a blocker for B.

### §15.2 Hard constraints (rigid pruning, not scoring)

Each p2p edge gets an integer weight bound `D_e = [lo_e, hi_e]`; when Tabu
generates neighbors it only proposes within bounds:

```
lo_e = max( 5, ⌈rttFloor_e⌉, protected_e ? current : 5 )
hi_e = min( 500, vip_e ? current : 500 )
```

| Red line | Effect | Meaning |
|----------|--------|---------|
| RTT floor (`rttFloor`) | `lo ≥ impliedCost(rtt)` | cost must not fall below the physical latency limit |
| VIP / main artery (`vip`) | `hi = current` | seal off raising → keep attractiveness, traffic is not driven away |
| Failure-prone / standby (`protected`) | `lo = current` | seal off lowering → normally isolate ordinary traffic |
| Global clamp | `COST_CLAMP` default `[5, 500]` | output is a positive OSPF integer, directly configurable; the 500 ceiling avoids long-link RTT floors hitting the ceiling and being frozen |

`lo>hi` (red-line contradiction) → clamp to `current` and mark `conflict`;
`lo≥hi` → `frozen` (not entered into the neighborhood). `vip` / `protected` are
**reserved interfaces**: the engine takes `Set` parameters, and until the source
(policy file / UI checkbox) is settled they default to empty sets, so the only
constraints actually in effect are the RTT floor + `COST_CLAMP` (`[5,500]`).

### §15.3 Tabu Search

| Aspect | Design |
|--------|--------|
| Start | `warm` (project current-network cost into bounds, minimal perturbation) or `invcap` (`round(maxCap/cap)`) |
| Neighborhood | single-edge move, candidates `cur±{1,2,4,8} ∪ {lo,hi}` clamped to `D_e`; frozen edges skipped (pruning) |
| Evaluation | each candidate `applyWeights → evalCongestion` (= one all-pairs traffic round) |
| Selection | best non-tabu neighbor; **aspiration**: a tabu move that breaks the global best is unbanned |
| Tabu list | records the reverse move `(edge,oldW)`, tenure ≈ √(movable) |
| Diversification | `stallK` consecutive non-improving rounds → randomly reset `divM` edges (seeded PRNG) |
| Termination | `MLU ≤ target` (default 0.75) / cap `maxIters` / no movable neighbors → return the global best |
| Budget | `maxEvals` (deterministic primary limiter, counts neighborhood evaluations) caps runtime; `timeBudgetMs` is only a runaway safety (large enough not to trigger at normal scale) |
| Reproducibility | `mulberry32(seed)` + `maxEvals` (not wall-clock) → same input same output → stable export |

### §15.4 Infeasibility handling (first-class output)

- `MLU ≤ target` → `targetMet`
- `target < MLU < 1` → `feasible` but below target
- `MLU ≥ 1` → **no solution within constraints**: return `bottleneck` (the edges at MLU) and `binding` — relax each out-of-bound by one step and recompute, ranking "which red line, when loosened, lowers MLU most", for a human to decide on loosening.

### §15.5 Functions (engine.js, pure)

```
ftLinkPenalty(load, cap)                         → cap·ψ(load/cap)
evalCongestion(topoW, demand, fE, fN)            → { mlu, sumU2, sumPhi, util, lostDemand }
applyWeights(topo, weights)                      → shallow copy of topo; weight keys are "weight variables" (eid=forward/symmetric, eid|rev=reverse), no mutation
buildWeightBounds(topo, { rttFloor, vip, protectedSet, clamp }) → Map<eid,{lo,hi,frozen,conflict}>
optimizeWeights(topo, demand, bounds, opts)      → { weights, mlu, feasible, targetMet,
                                                     bottleneck, binding, frozen, history, … }
```

### §15.6 Known limitations

- **Only optimizes the no-failure state**: no guarantee of being better for N-1 (§10); robust TE (optimizing for the worst failure) is on the Roadmap.
- **Weight variables**: each p2p edge has one variable per direction — forward `eid`, reverse `eid|rev`. Conditions for opening the reverse variable:
  - **Default (`asymmetric:false`)**: only edges that are "inherently asymmetric in the data" (`costRev != null && != cost`) open a reverse variable; symmetric edges have a single variable (cost=costRev=w), **behavior identical to the old version**.
  - **Opt-in (`asymmetric:true`, the UI "allow asymmetric weights" checkbox)**: **all p2p edges** open a reverse variable (forward/reverse independent, current value `costRev ?? cost`), allowing symmetric edges to also be optimized into asymmetric ones.
  - FT is inherently a directed problem; symmetry is just a compute-saving convention (see §14); **under symmetric demand, asymmetry gives no gain** (so even when checked on the current network it takes the baseline). Red lines (RTT/VIP/protected) share one set of bounds for both directions.
- **transit ingress cost is also optionally adjustable** (Option B, `buildWeightBounds({ includeTransit:true })`, the UI "also adjust transit" checkbox): only moves `e.cost` (ingress), does not apply the RTT floor, bounds `COST_CLAMP` (`[5,500]`); egress (`PN→router`) is hard-wired 0 by `buildAdjacency`, so B inherently does not violate Type-2 semantics.
- **"Never worse" guarantee (UI layer, generalized)**: C10 always runs the **baseline** (default configuration) first; if any advanced option (asymmetric / transit) is checked, it additionally runs the **chosen configuration** and **takes the better of the two**. Rationale: advanced options enlarge the search space and, under a fixed evaluation budget, may fall into a **worse local optimum** (single-seed measured: transit 73.8% vs baseline 67.2%); this guarantee ensures the result does not regress. Note: the gap is seed-sensitive (multi-start can catch up), not inherent to the option being worse.
- **Consumes the active demand profile**: optimizing `avg` vs `max` yields different weights; operationally one usually optimizes `max`.
- **Weights protect a link's attractiveness, not a specific flow's path**: OSPF is destination-oriented + ECMP-split, so it cannot hard-guarantee that a specific flow takes a specific path; hard guarantees need SR / policy routing, out of scope here.
- Scale per §13: each evaluation is one all-pairs round. To preserve **determinism**, the runtime primary limiter is `maxEvals` (evaluation count) rather than wall-clock; same seed/same graph → same result, runtime varies with the machine but is bounded. `timeBudgetMs` is only a runaway safety, not triggered at normal POC scale (so it doesn't break determinism); for real backbone scale switch to Web Worker + incremental SPF (this version recomputes in full). The UI-side search is synchronous, painting "computing" first then yielding one macrotask so the spinner paints.

> **UI mapping**: the "congestion optimization" block within tab **C10 Link**;
> results are written back to `edge.cost` via the existing `applyEdgeChange`,
> then carried away by the existing "export topology.js". The optimizer is the
> **third weight source**, after manual and RTT.

---

## §16 Internationalization (i18n)

The UI is fully bilingual (zh / en) via a single dictionary + `t()` lookup;
`engine.js` plays no part in display (it emits codes only — see the §7 reason contract).

### §16.1 Dictionary and lookup

- `index.html` `§0.5 I18N` defines `const I18N = { zh: {...}, en: {...} }`; the two languages' keys **must be symmetric**.
- `t(key, params)`: looks up `I18N[LANG][key]`; returns the value if a string, or `value(params)` if a function; **a missing key returns the key itself** (so gaps are visible on screen).
- Strings with variables use function values: `'c2.failStatus': (p) => \`Current failures: ${p.e} edge(s) / ${p.n} node(s)\``.
- Labels that vary by language but live in object constants (tier `label` / `action`) use a **getter** → `t()`, so they resolve at render time and switch instantly.

### §16.2 Static HTML injection (`applyStaticI18n`)

Four attributes, chosen by injection target:

| Attribute | Injects | For |
|-----------|---------|-----|
| `data-i18n` | `textContent` | plain-text elements |
| `data-i18n-html` | `innerHTML` | copy containing `<b>` / `<span>` markup |
| `data-i18n-title` | `el.title` | the `title` tooltip attribute |
| `data-i18n-optlabel` | `el.label` | `<optgroup>` labels |

The Chinese stays in the HTML as a no-JS fallback; `applyStaticI18n()` overwrites it at startup and on language switch. Spans filled by JS at runtime (e.g. the C10 formula constants) must be re-filled in `render()`, because `data-i18n-html` rebuilds child nodes.

### §16.3 Dynamic render

Each tab's `render()` uses `t(key, params)` throughout; switching tabs / language re-renders, so dynamic strings update with it.
**Note**: if a `render()` declares `const t = …` (e.g. `TIERS[tier]`) it shadows the translation `t()`; within that block only read `t.label` (resolved by the getter) — do not call the translation `t()` there.

### §16.4 Key naming and dedup

- Naming `<scope>.<sub>`: `common.*` (cross-tab shared), `c1.*`–`c10.*` (per tab), `ui.*` (chrome).
- Strings identical across tabs are pulled into `common.*` (e.g. `common.auditBanner` / `scanAllPairs` / `recalc` / `status.*` / `tier.*`).
- Engine code → text uses dynamic key building: `t('c6.reason.' + code, row)`, `t('c5.optType.' + type)` (the alignment check will show "defined > literal references", which is expected).

### §16.5 Language state and switching

- Default language: `localStorage['br-lang']` > browser language (`zh*` → zh, otherwise → en).
- `setLang(lang)`: persists to localStorage + `applyStaticI18n()` + updates the toggle-button label + re-renders the active tab.
- `#langToggle` in the left "Controls" panel (`data-action="toggleLang"`) shows "the language to switch to".

### §16.6 Not translated

- Identifiers in generated data: node codes (`TPE\nTW`), prefixes, subnets, `§` / `Cx` anchors, CSS classes, role/op names.
- Intentionally-retained technical English (some headers Node/Total, Connected/DISCONNECTED, etc.).

> **Contract with the engine**: anything the engine returns to the UI as a "reason / status / category" is always a stable code + structured params (§7); display text is the job of `t()` in this section. The engine must contain no user-facing prose strings (only comments may be in Chinese).
