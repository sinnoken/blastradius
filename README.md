# BlastRadius

**OSPF / IGP resilience-audit tool — see exactly how large a "blast radius" the network explodes into when a single link or a single router goes down.**

---

## Executive Summary

BlastRadius is a **single-file HTML** network-topology analysis tool. It pulls
together engineering actions that normally live scattered across spreadsheets,
Visio, the CLI, and people's heads — "shortest path", "ECMP equal-cost paths",
"failure simulation", "N-1 / SRLG worst-case ranking" — onto one interactive
topology graph.

It is positioned as **design-phase resilience auditing** plus **blast-radius
pre-computation before an incident drill** — it is **not** real-time monitoring.

| Item | Detail |
|------|--------|
| **Project phase** | POC — feature-complete, demoable |
| **Delivery form** | Pure front-end static web page (no backend, no build step) |
| **Core value** | Turns "what the network looks like when it breaks" into a clickable, auditable, rankable view |
| **Data source** | Topology / traffic / RTT are synthetic data, replaceable with your own network |

---

## Scope & Stakeholders

**Target users**

- **OSPF / backbone network engineers** — audit the single-point / shared-risk exposure surface of an existing design
- **Network planning / capacity teams** — traffic redistribution and capacity-overflow estimation under failure scenarios
- **Operations / incident drills** — work out in advance "which link hurts to pull, and how much" before a drill

**What this tool does vs. does not do**

| In scope | Out of scope |
|----------|--------------|
| Single-area (area 0) SPT / ECMP computation | Multi-area / inter-area summary LSA |
| Single-point + SRLG group failure simulation | Real-time telemetry / online monitoring |
| Traffic-matrix-driven link utilization | **Live** LSDB auto-pull from routers (text `show` output can be imported) |
| Design-level N-1 worst-case ranking | Device-config generation / push |

---

## Status & Milestones

| Milestone | Status |
|-----------|--------|
| C1–C10 ten analysis tabs | ✅ Done |
| SRLG (submarine cable / shared-conduit / facility / upstream) group failure | ✅ Done |
| Traffic matrix + multi-scenario snapshots (monthly avg / worst / regional busy hour) | ✅ Done |
| Deterministic data generator (same input always byte-identical) | ✅ Done |
| OSPF weight congestion optimization (Fortz-Thorup objective + Tabu search) | ✅ Done |
| Explicit-path steering (steer) + bandwidth admission (CAC) | ⬜ Planned (see steer.md) |
| SLO matrix coverage (C2 per-pair path-RTT vs SLO target, coverage %) | ✅ Done |
| LSDB → `topology.js` parser (paste / file `show ip ospf database`) | ✅ Done |
| Multi-area / OSPF inter-area cost | ⬜ Planned |

---

## Why this is not just another topology viewer

Most tools on the market emphasize "drawing what the network looks like".
BlastRadius emphasizes **"what the network looks like when it breaks"**:

| Capability | Typical topology viewer | BlastRadius |
|------------|-------------------------|-------------|
| Show links / nodes | ✅ | ✅ |
| Compute shortest path | ✅ | ✅ (incl. ECMP) |
| Recompute SPT after failure | ⚠ partial | ✅ built into the tabs as scenarios |
| Find pure-redundancy circuits | ❌ | ✅ full all-pairs scan |
| Unbackup-segment detection | ❌ | ✅ single-point-of-failure sensitivity |
| ECMP integrity audit | ❌ | ✅ edge-cut testing |
| Asymmetric-path detection | ❌ | ✅ |
| Subnet-redundancy heatmap | ❌ | ✅ LSA-based |
| SRLG group failure | ❌ | ✅ submarine cable / shared-conduit / facility / upstream |
| **N-1 worst-case ranking** | ❌ | ✅ "most fragile pair / most lethal failure" |
| **OSPF weight congestion optimization** | ❌ | ✅ Fortz-Thorup + Tabu (auto-lowers MLU) |

---

## How to Run

Because `engine.js` is an ES module, browsers won't allow loading it over
`file://`; you need to serve it over HTTP:

- **Command line**: `python -m http.server 8000` → open `http://localhost:8000/` in a browser
- **VS Code**: install the Live Server extension → right-click `index.html` → "Open with Live Server"
- **GitHub Pages**: Repo Settings → Pages → once enabled, open `https://<user>.github.io/<repo>/` directly

### Interactions

| Action | Effect |
|--------|--------|
| **Left-drag a node** | Re-layout |
| **Right-click a link** | Toggle failure state (persistent, preserved across tabs) |
| **Right-click a router** | Toggle node failure (a pseudo-node is an LSA2 abstraction and cannot fail) |
| **"Clear all failures" (left panel)** | One-click reset |
| **"Hide pseudo-nodes" (left panel)** | Show only the physical-router topology, excluding the LSA2 abstraction |

### Failure-mode semantics

- **Right-click failure**: simulates "this circuit is down right now" — the live-status tab group reflects it immediately.
- **Design-audit group**: completely ignores right-click failures and works off the original complete topology — because an audit asks "is the design itself resilient enough", not "is it reachable right now".

---

## Tab Overview

### Live-status group (consumes the failure markers on the graph)

| Tab | No. | Purpose |
|-----|-----|---------|
| **Path** | C1 | Source → Destination shortest path (SPT + ECMP), auto-classifies PRIMARY / BACKUP MODE, with an unbackup-segment scan |
| **Matrix** | C2 | All router-pair matrix — **Cost** or **RTT / SLO** mode (default RTT: per-pair path RTT vs an SLO target, with coverage %); tier shading, marks ECMP / asymmetric |
| **Centrality** | C3 | Link / node betweenness-centrality inventory (nodes can toggle **transit count ⇄ traffic-weighted**) + pure-redundancy circuits (links that normally carry zero traffic) |
| **Edge traffic** | C4 | Computes each link's actual load and utilization from the traffic matrix; flags overload / high-water |

### Design-audit group (ignores right-click failures, based on the complete topology)

| Tab | No. | Purpose |
|-----|-----|---------|
| **Failure simulation** | C5 | Fail a single element or a whole SRLG group simultaneously; inspect connectivity, partitioning, traffic redistribution, and capacity overflow |
| **N-1** | C9 | Enumerate every single-point failure, rank the **most fragile pair** + **most lethal failure scenario** |
| **ECMP** | C6 | For each ECMP pair, simulate cutting any one edge in the group and confirm the remaining ECMP can take over |
| **Asymmetric** | C7 | Pairs where the A→B and B→A path or cost differ |
| **Prefix** | C8 | Subnet-redundancy heatmap — advertised by ≥2 nodes = backed-up, only 1 = non-backed-up |

### Edit group

| Tab | No. | Purpose |
|-----|-----|---------|
| **Link** | C10 | Live-edit link cost (forward / reverse separately, asymmetric p2p); built-in **congestion optimization** (Fortz-Thorup objective + Tabu auto-searching weights to lower MLU); RTT-derived suggested reference values; export `topology.js` |

---

## Tech Stack

- **Cytoscape.js** — graph rendering
- **Tailwind CDN** — UI styling
- Pure vanilla JavaScript ES module, no build step

---

## Risks & Limitations

1. Currently only **single-area / pure area 0** is supported — no ABR / inter-area summary LSA handling
2. LSA5 external only does "exact match + default-route fallback", no full LPM
3. No cost-as-latency telemetry feed — doing latency-aware SPF still requires wiring up an RFC 7471 data source
4. Topology can be a static `topology.js` or imported from pasted / file `show ip ospf database router/network` output (the data editor's OSPF import); **live** auto-pull from routers (SNMP/API) is still a future direction
5. The built-in data is a **synthetic sample**; before any formal evaluation it must be replaced with your own network's real topology / traffic

---

## Roadmap

- [x] SRLG (Shared Risk Link Group) submarine-cable group failure — N-1 generalized to N-K
- [x] SLO matrix coverage — C2 RTT / SLO mode (per-pair path RTT vs SLO target, coverage %)
- [x] LSDB → `topology.js` parser — paste / file `show ip ospf database` via the data editor
- [ ] Explicit-path steering (steer / TE): pull specific traffic off the shortest path + bandwidth admission (CAC, "overflow / admission-fail once full") — planning in [steer.md](./steer.md)
- [ ] Multi-area / OSPF inter-area cost computation
- [ ] Flex-Algo (RFC 9350) multi-SPF parallel visualization

---

To switch to your own network: replace `topology.js` (schema in [SPEC.md](./SPEC.md)). Detailed algorithms and data model are also in [SPEC.md](./SPEC.md).
