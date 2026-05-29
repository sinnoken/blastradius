# BlastRadius SPEC

This document describes the data model, algorithms, module layering, and visual state machine of BlastRadius. It's written from the inside — not just *what* each piece does, but *why* it was built this way, what trade-offs were made, and where the sharp edges are.

Section numbers (§) match the section comments in the source code for two-way traceability.

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

Why a global variable instead of an ES module export? Because `topology.js` is a *user-authored data file*, not engine code. Users will paste output from future LSDB parsers, hand-edit costs, or generate it from scripts. A bare `const` with no import/export ceremony is the lowest-friction interface for a data file that non-developers will touch.

### §1.2 Node

```ts
type Node =
  | {
      id: string;            // Unique ID — typically the PoP code (TPE / TYO / ...)
      label: string;         // Display string; supports \n for multi-line
      type: 'router';
      area: string;          // OSPF area — only '0' supported today
      stubs?: string[];      // Stub prefixes (CIDR) this router advertises
      isASBR?: boolean;      // Injects LSA5 externals
      isABR?: boolean;       // Inter-area — reserved, not yet used
    }
  | {
      id: string;            // Must start with 'PN' — this convention is load-bearing
      label: string;
      type: 'pseudonode';
      subnet: string;        // CIDR of the transit LAN this pseudo-node represents
    };
```

**Why the `PN` prefix matters.** The `stripPseudo()` function uses `n.startsWith('PN')` to filter pseudo-nodes out of paths. This is a deliberate convention, not an accident — it lets the algorithm layer strip pseudo-nodes without needing access to the topology object. If you name a router with a `PN` prefix, it will be silently removed from path displays. Don't do that.

**Why `stubs` is an array of CIDR strings.** Each entry represents a network prefix this router advertises — the OSPF equivalent of a connected or redistributed route. The name "stubs" is slightly misleading (they're not OSPF stub areas); it means "locally-originated prefixes." The prefix index (§3.2) aggregates these across all routers to build the redundancy picture.

### §1.3 Edge

```ts
type Edge =
  | {
      id: string;
      source: string;
      target: string;
      cost: number;          // Forward metric (source → target)
      costRev?: number;      // Reverse metric (p2p only; defaults to cost)
      capacity?: number;     // Link capacity in Gbps
      type: 'p2p';
    }
  | {
      id: string;
      source: string;        // One endpoint is a router, the other a pseudo-node
      target: string;
      cost: number;          // Router → pseudo metric
      capacity?: number;     // Link capacity in Gbps
      type: 'transit';       // Pseudo → router metric is always 0 (LSA2 semantics)
    };
```

**Why `costRev` exists.** Real-world OSPF links frequently have asymmetric metrics — each end of a p2p link can set a different cost. `costRev` captures the reverse direction. When absent, the link is symmetric (`costRev` defaults to `cost` in `buildAdjacency`). Transit links don't need `costRev` because LSA2 semantics dictate a fixed 0-cost from pseudo to router.

**Why `capacity` is optional.** Not every deployment has capacity data. When `capacity` is absent, the traffic analysis tab still works — it just can't compute utilization percentages. The engine treats missing capacity as `Infinity`, meaning "we don't know the ceiling."

**Why edge IDs are explicit strings.** The engine needs to reference edges by ID in Sets, Maps, and the state machine. Auto-generated numeric IDs would break the moment you re-export the topology. String IDs like `e_TPE_TYO` are stable, human-readable, and greppable.

### §1.4 External (LSA5)

```ts
type External = {
  advertising_router: string;   // ASBR that originates this external
  subnet: string;               // e.g. '0.0.0.0/0'
  metric: number;
  metric_type: 'E1' | 'E2';
};
```

The `metric` and `metric_type` fields are stored but not yet consumed by the routing engine — the current LPM implementation (§4.4) only does exact match + default-route fallback. They're here because the data model should be ready for the algorithm to catch up, not the other way around.

### §1.5 Demand matrix

`demand.js` exposes a single global variable `demand`:

```js
const demand = {
  unit: 'Gbps',
  source: 'synthetic-v2',       // Data provenance tag
  active: 'avg',                // Currently selected profile key

  profiles: {
    avg: {
      label: '月均',
      symmetric: true,          // matrix[A][B] == matrix[B][A]
      default: 5,               // Fallback Gbps for unlisted pairs
      matrix: {
        TPE: { TYO: 130, HKG: 257, ... },
        ...
      },
    },
    max: {
      label: '95th',
      symmetric: false,         // Upload ≠ download
      default: 8,
      matrix: { ... },
    },
  },

  // Backward-compatible getters
  get matrix()  { return this.profiles[this.active].matrix; },
  get default() { return this.profiles[this.active].default; },
};
```

**Why getters on `matrix` and `default`.** The engine functions accept `demand` and read `demand.matrix` — they don't know about profiles. The getters let the UI switch profiles by setting `demand.active = 'max'` without changing any engine call sites. This was a deliberate adapter pattern: the UI owns profile selection, the engine sees a flat matrix, and the getters bridge the two without either side knowing about the other.

**Why `symmetric` is a data flag, not an engine behavior.** The `symmetric` flag is metadata for humans — "this matrix was generated with the assumption that A→B equals B→A." The engine always reads `matrix[A][B]` directly, regardless of the flag. If you set `symmetric: true` but provide asymmetric values, the engine will use whatever values you wrote. The flag is documentation, not enforcement.

**Why `default` exists.** In a real demand matrix derived from NetFlow, not every router pair will have a measured value. `default` is the fallback for unlisted pairs — a small but nonzero value that ensures "no data" doesn't silently become "no traffic." In the synthetic sample it's set to 5 Gbps, which is conservative but visible in the analysis.

---

## §2 Module layering

```
┌────────────────────────────────────────────────────────┐
│ Module A: Topology Data    (topology.js + demand.js)    │
├────────────────────────────────────────────────────────┤
│ Module B: Graph Builder    (§3)                         │
│   - buildAdjacency(edges, failedEdges, failedNodes)     │
│   - buildPrefixIndex(topo)                              │
├────────────────────────────────────────────────────────┤
│ Module C: Algorithm Engine (§4–§10)                     │
│   C1 SPT + ECMP            (§4)                         │
│   C2 Backup Path           (§5)                         │
│   C3 Failure Sim + BC      (§6)                         │
│   C4 ECMP Check            (§7)                         │
│   C5 Asymmetric            (§8)                         │
│   C6 Heatmap               (§9)                         │
│   C7 N-1 Worst-case        (§10)                        │
│   C8 Traffic Load          (§6.2b)                      │
├────────────────────────────────────────────────────────┤
│ Module D: State Machine    (§11)                        │
│   edgeStates / nodeStates  (op + role)                  │
│   failedEdges / failedNodes facade                      │
├────────────────────────────────────────────────────────┤
│ Module E: UI Layer         (Cytoscape + tab handlers)   │
└────────────────────────────────────────────────────────┘
```

Dependencies flow strictly downward. UI invokes Engine, Engine invokes Builder, Builder reads Topology. No upward calls, no circular dependencies.

**The state machine sits between UI and Engine.** This is intentional. The UI mutates persistent state (link failures) through `setEdgeOp / setNodeOp`. The engine consumes that state through the `failedEdges / failedNodes` facade — a Set-like wrapper that reads `op === 'failed'` from the state machine. This way the engine never knows about the state machine, and the state machine never knows about Dijkstra. The facade (§11.3) is the seam between the two worlds.

**Why `engine.js` is a separate ES module.** The engine exports pure functions with no DOM dependency, no Cytoscape reference, no global variable access. This was a hard rule from day one: if you can't unit-test a function with just `node engine.js`, it doesn't belong in the engine. This separation also means the engine can eventually move to a Web Worker for large topologies without changing a line.

---

## §3 Graph Builder

### §3.1 Adjacency (`buildAdjacency`)

Converts `topology.edges` into a Dijkstra-ready adjacency list: `adj[u] = [[v, cost], ...]`.

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

**Why the 0-cost direction?** In OSPF, a pseudo-node (Designated Router abstraction) doesn't add metric on its own — only the router-to-DR direction carries cost. This is how LSA2 works: the pseudo-node is a routing abstraction, not a physical hop. The 0-cost reverse edge is what makes transit LANs behave correctly in SPT computation — traffic entering the shared segment from any router pays that router's cost, but exiting to any other router on the segment is free.

**Rule 3 — failure filtering**

- `failedEdges.has(e.id)` → skip the entire link
- `failedNodes.has(u || v)` → skip any edge touching the failed node

**Why failure filtering lives in `buildAdjacency`, not in Dijkstra.** Dijkstra shouldn't know about failures. It receives an adjacency list and finds shortest paths — that's its job. Failures are a topology concern: "build me a graph where these components don't exist." Putting the filter here means every algorithm that calls `buildAdjacency` gets failure support for free, without each one implementing its own filtering logic.

### §3.2 Prefix index (`buildPrefixIndex`)

Maps `prefix → Set<advertising_router_id>`. A set of size ≥ 2 means the prefix has redundant advertisers.

| Rule | Origin | What happens |
|------|--------|-------------|
| Rule 3 | `node.stubs` | Each stub prefix is owned by the router that declares it |
| Rule 5 | LSA2 transit | All routers attached to a pseudo-node "own" that pseudo-node's subnet |
| Rule 4 | `externals` | LSA5: the `advertising_router` owns the external prefix |

**Why Rule 5 exists.** A transit LAN's subnet (e.g., 192.168.100.0/24) is reachable via any router on that LAN. In OSPF, this comes from LSA2 — the DR advertises the subnet and lists all attached routers. In our model, this means every router connected to a pseudo-node is a valid advertiser of that pseudo-node's subnet. Without Rule 5, the heatmap would incorrectly show transit subnets as "non-redundant" even when three routers share the same LAN.

---

## §4 C1 — SPT + ECMP

### §4.1 Algorithm

Standard Dijkstra with one critical extension: when a neighbor's distance ties the current best (`nd === dist[v]`), we *add* to `preds[v]` instead of replacing. This gives us ECMP for free:

```
for each neighbor (v, c) of u:
  nd = dist[u] + c
  if nd < dist[v]:
    dist[v] = nd
    preds[v] = { u }           // strictly better → replace
  elif nd == dist[v]:
    preds[v].add(u)            // equal cost → add (ECMP)
```

**Why an array-based priority queue and not a binary heap.** At POC scale (V ≈ 10), the `pq.sort()` on every iteration is negligible. A proper heap would be needed at V ≈ 100+, but at that scale the entire N-1 sweep should move to a Web Worker anyway. Premature optimization of the queue would obscure the algorithm without helping the use case this POC actually serves.

### §4.2 ECMP path enumeration

Backtrack `preds` from `dst` via recursive DFS. Each call returns all paths from `src` to `node`. This can produce exponentially many paths in theory, but in practice OSPF topologies rarely have more than 4–8 ECMP paths for any pair.

**A subtlety worth knowing:** the enumerated paths include pseudo-nodes as intermediate hops. This is correct for edge ID resolution (a path TPE → PN_EU → AMS must match `e_AMS_PN`, not skip over it), but wrong for display. That's why `stripPseudo` (§4.3) exists — it's the "display adapter" between algorithm output and human-readable paths.

### §4.3 Pseudo-node post-processing

`stripPseudo(path)` filters out any node whose ID starts with `PN`. The result is a router-level path that makes sense to a human operator.

### §4.4 Prefix resolution

`resolveLPM(prefixIndex, target)` implements exact match + default-route fallback. Full longest-prefix matching (comparing /24 vs /16) is on the roadmap but not implemented — the current approach handles the two cases that actually occur in the sample topology: direct prefix hits and the 0.0.0.0/0 catch-all.

---

## §5 C2 — Backup path

### §5.1 Link-removal simulation

`backupPath(topo, src, dst, removedEdges)` merges `removedEdges` into `failedEdges`, rebuilds the adjacency list, and reruns Dijkstra. The result is the shortest path *after* those specific links are withdrawn.

**Why rebuild the adjacency list every time?** Because it's cheap (< 1ms at POC scale) and correct. Mutating and un-mutating a shared adjacency list would be faster but fragile — one missed rollback and you've corrupted the graph for every subsequent computation. Rebuild-from-scratch is the safe choice.

### §5.4 Unprotected-segment scan

For each link on the primary path, simulate its withdrawal; if the resulting cost is ∞, flag it as unprotected:

```
primary = dijkstraECMP(adj, src, dst)
for each edge e in primary.edges:
  if backupPath(topo, src, dst, [e]).cost == ∞:
    unprotected.push(e)
```

**What "unprotected" really means:** withdrawing this single link makes src → dst unreachable. There is no alternate path at any cost. This is a true single point of failure for this specific pair — the strongest statement of vulnerability the tool can make.

**Relationship to N-1 (§10).** The unprotected scan is a focused version of N-1: it checks one pair against only the edges on that pair's primary path. N-1 checks every pair against every possible failure. The unprotected scan answers "is *this path* SPOF-free?" while N-1 answers "where is the *topology* weakest?"

---

## §6 C3 — Node failure simulation + betweenness centrality

### §6.1 Connectivity

`connectedComponents(adj, routerIds)` — BFS over routers only (pseudo-nodes are skipped in the component labeling). If the result has more than one component, the network is partitioned.

### §6.2 Edge betweenness (path-count based)

`allPairsLoad(topo, failedEdges, failedNodes)`:

```
load[edge] = Σ over all (a → b) pairs:  1 / r.paths.length
```

ECMP splits load equally across paths. Each path contributes to every link it traverses. The weight `1 / paths.length` means a pair with 4 ECMP paths contributes 0.25 to each path's links.

**What the return value tells you.** Beyond `load`, the function returns `totalPairs`, `reachablePairs`, and `lostPairs`. This reachability accounting is critical: without it, failing a hub node would make the betweenness numbers *look better* (fewer paths = lower load on surviving links), which is exactly backwards. The UI uses `lostPairs` to show a warning banner: "these numbers are computed over N reachable pairs; M pairs have no path."

### §6.2b Edge traffic load (Gbps-weighted)

`allPairsTraffic(topo, demand, failedEdges, failedNodes)`:

```
traffic[edge] = Σ over all (a → b) pairs:  demand[a][b] / r.paths.length
```

**Key differences from §6.2:**

1. **Weight is Gbps, not 1.** A pair carrying 257 Gbps matters more than a pair carrying 5 Gbps. The path-count based BC treats all pairs equally — fine for structural analysis, wrong for capacity planning.

2. **Failed nodes stay in the iteration.** This is the most important design decision in this function. When router X fails, the engine still iterates demand pairs involving X — but since those pairs can't reach each other, their demand goes into `lostDemand`. Without this, failing a busy node would make the network *appear* to have less total traffic, which masks the real problem (hundreds of Gbps of customer traffic is being dropped).

3. **Rich accounting.** Returns `totalDemand / servedDemand / lostDemand / lostDemandPairs` — the full double-entry ledger of where traffic went. The UI uses this to display "out of 4,200 Gbps total demand, 3,800 is being served and 400 Gbps is lost."

**Utilization tiers:**

| Utilization | Tier | What it means |
|-------------|------|--------------|
| > 100% | Overload | Link capacity exceeded — congestion / packet loss in production |
| 80–100% | High | Near capacity — upgrade candidate, one failure away from overload |
| 50–80% | Mid | Normal headroom — healthy operating range |
| < 50% | Low | Ample capacity — possibly over-provisioned |

These thresholds are hardcoded and opinionated. 80% as the "high" boundary comes from standard backbone planning practice (leave 20% headroom for failure absorption). The tiers exist to turn a continuous variable (utilization %) into an actionable classification (upgrade / monitor / OK / over-provisioned).

### §6.3 Node failure simulation

`simulateNodeFailure` takes before/after snapshots of network-wide load and produces, for each edge, a `direction ∈ {inc, dec, none}` and `changePct`.

**How the UI uses this.** When `demand.js` is loaded, the failure simulation tab shows Gbps-based comparison with capacity/utilization columns. Without demand data, it falls back to the path-count based §6.2 — less precise but still useful for structural analysis.

### §6.4 Node Betweenness Centrality

`computeNodeBC(topo, failedEdges, failedNodes)` — classic Freeman Betweenness Centrality:

```
BC(v) = Σ over all (s, t) pairs where s ≠ v ≠ t:
          σ(s, t | v) / σ(s, t)
```

**What this measures.** How much "transit" traffic each router carries across the network's shortest-path tree. A router with high BC sits on many shortest paths between other routers — it's a structural chokepoint regardless of traffic volume.

**Implementation details that matter:**

- ECMP equal split: weight `w = 1 / r.paths.length`
- `stripPseudo(path)` runs first — pseudo-nodes are routing abstractions, not transit routers
- Endpoints are excluded: the loop starts at index 1 and ends before `length - 1`. A router that originates or terminates traffic is not "in transit" for that pair.

**How the UI classifies routers:**

| Tier | Threshold | Action |
|------|-----------|--------|
| Hub | BC > 40% of max | Dual-chassis, dual-uplink — this router is critical |
| Normal | BC > 10% of max | Maintain current investment |
| Rare | BC > 0, ≤ 10% | Downgrade candidate — rarely used for transit |
| Idle | BC = 0 | Merge-into-neighbor-PoP candidate — never used for transit |

These thresholds (40% and 10% of max) are the same for both edge and node BC. They're empirically chosen to produce useful procurement tier separations on typical backbone topologies.

---

## §7 C4 — ECMP backup validation

For each (src, dst) pair:

1. Compute the primary path. If `paths.length < 2`, or if all paths share a single first-hop edge → `status: n/a`.
2. Collect `ecmpEdgeIds` = the set of first-hop links across all ECMP paths.
3. For each `eid ∈ ecmpEdgeIds`, withdraw it and recompute:
   - If unreachable → `status: failed`, reason = "removing eid → unreachable"
   - If the post-withdrawal first-hop is not in `ecmpEdgeIds \ {eid}` → `status: failed`, reason = "backup uses non-ECMP link"
4. All members survive → `status: passed`.

**What "passed" means in practice.** A well-formed ECMP group should absorb the loss of any one member by redistributing traffic *within* the group. If a member's failure causes traffic to spill onto a non-ECMP path, the group isn't truly resilient — you'll see unexpected load on links that weren't part of the original load-sharing plan.

**Why this is a design-time audit.** The ECMP check always runs on the clean baseline topology (no right-click failures). It answers "did I design the ECMP correctly?" — not "is the ECMP working right now?" A currently-failed link wouldn't be in the ECMP set to begin with, so testing it would be meaningless.

---

## §8 C5 — Asymmetric path detection

For each unordered pair (a, b):

```
fwd = SPT(a → b)
rev = SPT(b → a)
fwdSig = sorted set of stripPseudo(path).join('>')
revSig = sorted set of stripPseudo(path).reverse().join('>')
```

If `fwd.cost ≠ rev.cost` or `fwdSig ≠ revSig` → the pair is asymmetric.

**Why we compare path signatures, not just costs.** Two directions can have the same total cost but different paths (e.g., A→C→B costs 30, B→D→A costs 30, but they take different routes). This matters for operations: asymmetric paths mean traceroute shows different hops in each direction, making troubleshooting harder and latency behavior unpredictable.

**Why `reverse()` on the rev paths.** The forward signature for A→B reads "A>C>B". The reverse path from B→A reads "B>D>A". To compare them, we reverse the reverse path to get "A>D>B". Now both signatures start from A and end at B, and we can compare whether they traverse the same nodes.

---

## §9 C6 — Prefix redundancy heatmap

Per router: count `nonRedundant / total` prefixes. Map the ratio to a color:

| Ratio | Color | Meaning |
|-------|-------|---------|
| 0 | Green | Every prefix has ≥2 advertisers — full redundancy |
| 0–0.33 | Yellow | A few prefixes have only one advertiser |
| 0.33–0.66 | Orange | About half of prefixes are non-redundant |
| > 0.66 | Red | Majority of prefixes are singly-advertised — high risk |

**What "non-redundant" means operationally.** If a prefix is advertised by only one router, that router's failure makes the prefix unreachable. This is a different kind of SPOF than link failure — it's a *prefix-level* SPOF. A router might have five backup paths, but if it's the only one announcing a particular /24, that /24 dies with the router.

---

## §10 C7 — N-1 worst-case ranking

### §10.1 Scenario enumeration

```
scenarios =
  { kind:'edge', id, edge } for each p2p link ∪
  { kind:'node', id }       for each router
```

**Why transit links are excluded.** Transit links connect routers to pseudo-nodes. A pseudo-node is a routing abstraction — you can't "fail" an IX switch fabric at the OSPF level. If the physical LAN fails, the right way to model it is to fail the individual router-to-pseudo links that are affected. Including transit links as failure scenarios would produce misleading results: "failing LHR→PN_EU" would show impact from losing LHR's connection to the fabric, not from the fabric itself failing.

### §10.2 Dual accumulation

For each scenario, recompute SPT for every (a, b) pair. Results accumulate into two complementary views:

**Per-pair view:**

```
pairWorst[a>b] = {
  base:      baseline cost (no failure),
  worstCost: worst cost across all scenarios,
  culprits:  scenarios that produce the worst cost,
}
```

**Per-failure view:**

```
failStats[scenario] = {
  unreachable: count of pairs rendered unreachable,
  degraded:    count of pairs still reachable but on a longer path,
  totalDelta:  Σ (worstCost - baseCost) across all affected pairs,
  maxRatio:    max (worst / base) ratio observed,
}
```

**Why both views exist.** They answer different questions. The per-pair view answers "which connections are most fragile?" The per-failure view answers "which component, if it fails, causes the most damage?" An operator planning a maintenance window needs the per-failure view. An operator designing redundancy needs the per-pair view. Same data, different lenses.

### §10.3 Capacity overflow detection

When `demand.js` is available, the N-1 UI computes traffic redistribution for the top 10 failure scenarios using `allPairsTraffic` and counts how many links exceed capacity under each failure.

**Why this matters beyond connectivity.** A failure scenario might not disconnect any pairs (0 unreachable) but could overload three links, causing packet loss across dozens of flows. Without capacity overflow detection, such a scenario would rank low in N-1 — "only degraded, no pairs lost" — even though the real-world impact is severe. This feature closes the gap between "mathematically reachable" and "practically usable."

### §10.4 Sort order

- **Pair ranking**: `ratio = worstCost / baseCost` descending; unreachable (∞) first.
- **Failure ranking**: unreachable count descending → `totalDelta` descending.

### §10.5 Relationship to §5.4 (Unprotected scan)

| Dimension | §5.4 Unprotected scan | §10 N-1 ranking |
|-----------|-----------------------|-----------------|
| Focus | Single (src, dst) pair | Every pair in the topology |
| Failure scope | Only links on the primary path | Every link + every router |
| Verdict | Binary (reachable or not) | Continuous (ratio + unreachable count) |
| Use case | "Is *this* path SPOF-free?" | "Where is the *topology* weakest?" |

§5.4 is a strict subset of §10 — anything §5.4 finds, §10 also finds. But §5.4 runs in milliseconds for a single pair, while §10 runs in O((V + E) · V²) time. They serve different interaction patterns: §5.4 is the "quick check" after selecting src/dst, §10 is the comprehensive audit you run once.

---

## §11 Visual state machine

This is the most subtle part of the codebase. Get it wrong and you get ghost highlights, stale failure markers, and visual states that survive tab switches when they shouldn't.

### §11.1 Two orthogonal dimensions

Every entity (edge or node) carries two completely independent states:

| Dimension | What it is | Lifetime |
|-----------|-----------|----------|
| **op** | Persistent user action (right-click a link to fail it) | Survives tab switches — never auto-cleared |
| **role** | Transient analytical markup (this edge is on the SPT) | Cleared on every tab switch via `clearAllRoles()` |

**Why two dimensions instead of one.** The original implementation had a single `state` field. This caused a recurring bug: tab switches would clear failure markers (because the tab needed a clean canvas), and then right-click failures would vanish. The fix was to separate "what the user did" (op) from "what the analysis shows" (role). They live in different lifecycles and must never interfere with each other.

**Edge op values**: `healthy` / `failed`

**Node op values**: `up` / `down`

**Edge role values:**

| Role | CSS class | Used by |
|------|-----------|---------|
| `none` | *(no class)* | — |
| `spt` | `spt` | C1 Path, C2 Matrix |
| `backup` | `backup` | C1 Path, C8 N-1 |
| `unbacked` | `unbacked` | C1 Path (unprotected scan) |
| `load-inc` | `load-inc` | C4 Failure Sim |
| `load-dec` | `load-dec` | C4 Failure Sim |
| `simulated-fail` | `failed` | C4 Failure Sim, C8 N-1 |
| `bc-hub` | `bc-hub` | C3 Link Centrality |
| `bc-normal` | `bc-normal` | C3 Link Centrality |
| `bc-rare` | `bc-rare` | C3 Link Centrality |
| `bc-idle` | `bc-idle` | C3 Link Centrality |
| `traffic-overflow` | `traffic-overflow` | C9 Edge Traffic |
| `traffic-high` | `traffic-high` | C9 Edge Traffic |
| `traffic-mid` | `traffic-mid` | C9 Edge Traffic |
| `traffic-low` | `traffic-low` | C9 Edge Traffic |

**Node role values:**

| Role | CSS class | Used by |
|------|-----------|---------|
| `none` | *(no class)* | — |
| `endpoint` | `endpoint` | C1 Path, C2 Matrix, C8 N-1 |
| `highlight` | `highlight` | C1 Path, C2 Matrix |
| `asym-mark` | `asym-mark` | C6 Asymmetric |
| `failed-node` | `failed-node` | C4 Failure Sim, C8 N-1 |
| `heat-green` | `heat-green` | C7 Heatmap |
| `heat-yellow` | `heat-yellow` | C7 Heatmap |
| `heat-orange` | `heat-orange` | C7 Heatmap |
| `heat-red` | `heat-red` | C7 Heatmap |
| `bc-hub` | `bc-hub` | C3 Link Centrality |
| `bc-normal` | `bc-normal` | C3 Link Centrality |
| `bc-rare` | `bc-rare` | C3 Link Centrality |
| `bc-idle` | `bc-idle` | C3 Link Centrality |

**Why `simulated-fail` maps to the `failed` CSS class.** When the failure simulation tab highlights a router as "this is the one we're pretending failed," it should look exactly like a real right-click failure — same red dotted line, same visual weight. But it must not *be* a real failure (it's transient, tab-scoped). So `simulated-fail` is a role (cleared on tab switch) that renders as the `failed` CSS class (same visual). The role name and the CSS class name are deliberately different to make this distinction greppable in the source.

### §11.2 Render precedence

```
op wins:
  edge.op = failed                → CSS class 'failed'
  node.op = down                  → CSS class 'failed-node'
  edge endpoint node.op = down    → derived 'failed' (NOT written to edge.op)
role 'simulated-fail'             → CSS class 'failed' (same visual, but transient)
otherwise: role maps directly to its CSS class
```

**The derived edge failure is important.** When a router is marked as `down`, all its attached edges should visually appear failed — but their `edge.op` must remain `healthy`. This is the single-source-of-truth rule: the edge's failure is *derived* from the node's state, not independently stored. If we wrote `failed` to `edge.op`, then clearing the node failure wouldn't clear the edge failures (because `op` is persistent). The rendering function checks both the edge's own op and its endpoints' ops every time.

### §11.3 Facade

`failedEdges` and `failedNodes` are Set-like wrappers (`has / add / delete / clear / size / iterator`) over the state machine. They exist because the engine functions (written first, before the state machine existed) accept plain Sets as parameters. The facade makes the state machine look like a Set to the engine, without rewriting every `buildAdjacency(topo.edges, failedEdges, failedNodes)` call site.

**A subtle correctness property:** `failedEdges.add(eid)` doesn't just set a Map value — it calls `setEdgeOp(eid, 'failed')`, which triggers `renderEdge(eid)`, which updates the Cytoscape visual. This means any code that calls `failedEdges.add()` gets immediate visual feedback for free. The alternative — requiring callers to remember to re-render after modifying failure state — was a bug factory in early versions.

### §11.4 Invariants

1. **All Cytoscape class changes go through the setters.** `setEdgeOp / setEdgeRole / setNodeOp / setNodeRole` are the only functions that touch `addClass / removeClass`. Direct Cytoscape class manipulation is forbidden — it would bypass the state machine and create ghost states.

2. **Tab switches call `clearAllRoles()`.** This clears all role annotations but never touches op. The heatmap colors from the previous tab vanish; the right-click failures stay.

3. **"Reset view" ≠ "Clear all failures".** Reset view = `clearAllRoles()` (remove analysis markup). Clear all failures = `failedEdges.clear() + failedNodes.clear()` (remove user-set failures). These are deliberately separate operations. Conflating them was a usability bug in an early version — users would reset the view to clean up heatmap colors and accidentally lose all their failure markings.

### §11.5 Cross-tab visual overlap

BC node roles (`bc-hub`, `bc-normal`, etc.) and Heatmap node roles (`heat-green`, `heat-yellow`, etc.) use similar color palettes by design:

- `bc-hub` = green background ↔ `heat-green` = green background (identical)
- `bc-rare` = yellow background ↔ `heat-yellow` = yellow background (nearly identical)

This is acceptable because:

1. **`clearAllRoles()` prevents both from being active simultaneously.** You can never see BC and Heatmap colors at the same time.
2. **Role names and logic paths are completely independent.** No tab references another tab's roles. The BC tab sets `bc-hub`; the Heatmap tab sets `heat-green`. They never interfere because they're never co-present.

The visual overlap is deliberate — the green-to-red gradient intuitively maps to "good to bad" in both contexts. Inventing a different color scheme for BC (say, blue-to-purple) would be visually distinctive but semantically confusing: "why does green mean 'hub' in one tab and 'fully redundant' in another?"

---

## §12 Tab behavior matrix

| Tab | ID | Honors right-click failures? | Auto-runs on tab activation | Auto-runs on profile switch |
|-----|----|------------------------------|-----------------------------|-----------------------------|
| Path | C1 | Yes | Yes | — |
| Matrix | C2 | Yes | Yes | — |
| Link Centrality | C3 | Yes | Yes | — |
| Edge Traffic | C9 | Yes | Yes | Yes |
| Failure Sim | C4 | No (own scenario) | Yes | Yes |
| ECMP Check | C5 | No (design-time audit) | — | — |
| Asymmetric | C6 | No (design-time audit) | — | — |
| Prefix | C7 | No (design-time audit) | — | — |
| N-1 | C8 | No (design-time audit) | Yes | — |
| Links | — | — | Yes | — |

**Reading this matrix.** "Honors right-click failures" means the tab uses the current `failedEdges / failedNodes` state when computing results. Live-state tabs do; design-time audits explicitly build a clean adjacency list with no failures.

"Auto-runs on tab activation" means switching to this tab immediately triggers computation. Tabs without this (ECMP, Asymmetric, Prefix) require the user to click a button — because they're audit tools the user invokes deliberately, not dashboards that should always be current.

"Auto-runs on profile switch" means changing the demand profile (avg → 95th) re-triggers the tab. Only traffic-aware tabs need this.

---

## §13 Algorithmic complexity

Let `V = number of routers`, `E = number of links`. The implementation uses an array-based priority queue, so a single SPT computation is approximately `O((V + E) · V)` (due to the linear scan in `pq.sort()`; with a proper heap it would be `O((V + E) log V)`).

| Module | Per-invocation cost | When it runs |
|--------|---------------------|-------------|
| C1 SPT (single pair) | O((V+E) · V) | User click |
| C2 Matrix (all pairs) | O(V² · (V+E) · V) | Tab activation |
| C3 Link Centrality | 2 × all-pairs | Tab activation |
| C4 Failure Sim | 2 × all-pairs | User click / profile switch |
| C5 ECMP Check | O(V² · k · SPT) | User click; k = ECMP edge count |
| C6 Asymmetric | O(V² · SPT) | User click |
| C8 N-1 | O((V + E) · V² · SPT) | Tab activation |
| C9 Edge Traffic | O(V² · SPT) | Tab activation / profile switch |

**At POC scale (V ≈ 10, E ≈ 20):** the full N-1 sweep is ~6,000 SPT computations. Completes in < 200 ms in-browser. No performance concerns.

**At production scale (V ≈ 100, E ≈ 300):** the N-1 sweep is on the order of 4 × 10⁶ SPT computations. This is too much for the main thread — it would freeze the browser for several seconds. The path forward is Web Workers: ship the engine (which has no DOM dependency by design) to a worker, run the sweep in background, and stream results back to the UI.

---

## §14 Changes since v1.0

Notable additions since the original SPEC:

- §1.3 Edge: added `capacity` field for traffic analysis.
- §1.5 Demand matrix: new data file with avg / 95th profiles, getter-based profile switching.
- §6.2b `allPairsTraffic`: Gbps-weighted edge load with full reachability accounting (totalDemand / servedDemand / lostDemand).
- §6.4 Node Betweenness Centrality: Freeman BC for router procurement tier classification.
- §10.3 Capacity overflow detection in N-1 ranking.
- §11 State machine: `primary` role eliminated (→ `spt` direct mapping), `failed-by-node` renamed to `simulated-fail`, dead constants (`EDGE_ROLES`, `NODE_ROLES`) removed, full role → CSS class → tab-usage tables added.
- §11.5 Documents cross-tab visual overlap policy (BC vs Heatmap color palette sharing).
- §12 Tab behavior matrix: added C9 Edge Traffic row, "Auto-runs on profile switch" column, C4 auto-activation.
