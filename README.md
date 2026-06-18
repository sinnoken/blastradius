# Topocide

**OSPF backbone network resilience audit tool — quantify failure impact, congestion risk, and cost optimisation.**

---

## Problems Solved

Backbone network engineers repeatedly face three hard problems:

| Pain point | Why it's hard |
|------------|---------------|
| **Failure scenarios are hard to estimate** | When a circuit or router goes down, where does traffic reroute, which links saturate, which prefixes lose redundancy — impossible to work out quickly with spreadsheets or mental models |
| **Congestion scenarios are hard to estimate** | Does the current OSPF weight distribution balance traffic evenly? Where is the worst-case link? Is there enough capacity if a whole SRLG fails simultaneously? |
| **Link operational cost is hard to optimise** | Which weight set minimises MLU? How far do current costs deviate from RTT-implied values? How do you find a better configuration automatically without violating physical constraints? |

**Topocide's approach**: import OSPF LSDB, RTT, SRLG, traffic demand matrix, and link capacity — run algorithms, visualise results, and provide optimisation across nodes, links, cost, and RTT dimensions.

---

## Positioning

| Item | Detail |
|------|--------|
| **Use case** | Design-phase resilience auditing + pre-drill impact pre-computation |
| **Not** | Real-time monitoring / device push |
| **Data input** | Static `topology.js`, or paste `show ip ospf database` output for automatic parsing |
| **Architecture** | Pure front-end static page, no backend, no build step |

---

## Feature Overview

### Analysis tabs (C1–C9)

| Tab | Purpose |
|-----|---------|
| **C1 Path** | Source→destination shortest path (SPT + ECMP), auto-classifies PRIMARY / BACKUP, unbackup-segment scan |
| **C2 Matrix** | All-pairs cost matrix or RTT/SLO mode (actual path RTT vs SLO target, coverage %) |
| **C3 Centrality** | Link/node betweenness-centrality inventory, marks pure-redundancy circuits (normally zero traffic) |
| **C4 Edge traffic** | Per-link actual load and utilisation from the traffic matrix; flags overload |
| **C5 Failure sim** | Fail a single element or an entire SRLG group; shows connectivity, traffic redistribution, capacity overflow |
| **C6 ECMP** | For each ECMP group, cut any one member and confirm residual ECMP can absorb |
| **C7 Asymmetric** | Pairs where A→B and B→A path or cost differ |
| **C8 Prefix** | Subnet-redundancy heatmap: ≥2 nodes advertising = backed-up, only 1 = single-point dependency |
| **C9 N-1** | Enumerate all single-point failures; rank most-fragile pair and most-lethal failure scenario |

### Optimisation (C10)

| Feature | Detail |
|---------|--------|
| **Link cost editing** | Live-edit forward/reverse cost; paths recompute immediately |
| **Congestion optimisation** | Fortz-Thorup objective + Tabu Search — automatically finds a weight set that lowers MLU, constrained by RTT physical lower bounds |
| **RTT reference column** | Per-link RTT-derived suggested cost; amber bar flags divergence |

---

## Running

`engine.js` is an ES module — serve over HTTP, not `file://`:

```bash
cd /mnt/workspace/output && python serve.py
# Open http://localhost:8000/
# serve.py returns Cache-Control: no-store; changes take effect immediately
# python -m http.server has ~1 min browser-cache delay
```

Also works with VS Code Live Server, GitHub Pages, or CF Pages.

### Auxiliary pages

| Page | Purpose |
|------|---------|
| `/edit.html` | 4-tab data editor (topology / demand / SRLG / RTT); import OSPF LSDB; cloud sync (CF Workers + R2). Dependencies: Cytoscape core + cxtmenu + Tailwind CDN; edge-drawing and undo/redo are hand-rolled. Load order: `dagre` must precede `cytoscape-dagre`. |
| `/metro-tune.html` | Interactive parameter tuner for the Metro Map octilinear layout — adjust grid size, nudge iterations, compression mode, direction count (8 / 16 / 32-way), live edge-colour feedback (green = octilinear, orange = near, red = non-octilinear); copy `LAYOUT_PARAMS.metro` block back to `edit.html`. |

### Basic interactions

| Action | Effect |
|--------|--------|
| Right-click a link | Toggle failure state (persistent across tabs) |
| Right-click a router | Toggle node failure |
| Left-drag | Re-layout |
| Clear all failures | One-click reset |

---

## Data Input

To use your own network: replace `topology.js` (schema in [SPEC.md](./SPEC.md)). Alternatively, paste OSPF LSDB output in edit.html to auto-build the graph, then add demand / SRLG / RTT data.

---

## Tech Stack

- **Cytoscape.js** — graph rendering
- **Tailwind CDN** — UI styling
- **Vanilla ES module** — no build step, pure static pages
- **CF Workers + R2** — cloud data sync (optional)

---

## Limitations

1. Only **single-area / pure area 0** — no ABR inter-area summary LSA
2. LSA5 external: exact match + default-route fallback only, no full LPM
3. No live LSDB auto-pull from routers (CLI `show` output can be imported manually)
4. Built-in data is a synthetic sample; replace with real network data before formal evaluation

---

## Roadmap

- [x] SRLG group failure (submarine cable / shared conduit / facility / upstream)
- [x] RTT / SLO matrix coverage
- [x] OSPF LSDB import
- [x] Congestion optimisation (Fortz-Thorup + Tabu)
- [x] edit.html + cloud sync (CF Workers + R2)
- [ ] C10 optimisation v2 (N-1 survivability gate, RTT detour cap, bandwidth unit cost)
- [ ] Explicit-path steering (steer) + bandwidth admission (CAC)
- [ ] Multi-area / OSPF inter-area cost computation

---

Detailed algorithms and data model: [SPEC.md](./SPEC.md).
