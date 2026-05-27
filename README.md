# BlastRadius

**OSPF / IGP failure-impact analyzer — quantify the blast radius when a link or router fails**

BlastRadius is a single-file HTML POC for IGP (OSPF / IS-IS) backbone engineers. It consolidates the operational workflows that normally live in spreadsheets, Visio diagrams, the router CLI, and engineers' heads — *shortest path computation*, *equal-cost multipath (ECMP) verification*, *failure scenario analysis*, *N-1 worst-case ranking* — into a single interactive topology view.

---

## Why not just another topology viewer

Most tools focus on **what your network looks like**. BlastRadius focuses on **what your network looks like after a failure**:

| Capability | Typical topology viewer | BlastRadius |
|------------|-------------------------|-------------|
| Render links / nodes | ✅ | ✅ |
| Compute shortest path | ✅ | ✅ (with ECMP) |
| Post-failure SPT recomputation | ⚠ partial | ✅ dedicated tab |
| Idle backup link inventory | ❌ | ✅ all-pairs scan |
| SPOF segment detection | ❌ | ✅ unprotected-link scan |
| ECMP backup validation | ❌ | ✅ per-edge withdrawal |
| Asymmetric path detection | ❌ | ✅ |
| Prefix redundancy heatmap | ❌ | ✅ LSA-derived |
| **N-1 worst-case ranking** | ❌ | ✅ "most-vulnerable pair / highest-impact failure" |

Positioning: **design-time resiliency audit** + **failure scenario analysis** — not real-time monitoring.

---

## Getting started

1. Clone or download the repo.
2. Serve over HTTP (because `engine.js` is an ES module — browsers reject `file://` for modules):
   - **VS Code**: install the Live Server extension → right-click `index.html` → "Open with Live Server"
   - **Command line**: `python -m http.server 8000`, then open `http://localhost:8000/`
   - **GitHub Pages**: Repo Settings → Pages → enable, then open `https://<user>.github.io/<repo>/`
3. The default sample loads an intercontinental ISP backbone (10 PoPs across APAC / North America / Europe).

### Interaction

| Action | Effect |
|--------|--------|
| **Left-click + drag a node** | Re-layout |
| **Right-click a link** | Toggle link failure (persistent across tabs) |
| **Right-click a router** | Toggle node failure (pseudo-nodes are LSA2 abstractions and cannot be failed) |
| **"Clear all failures"** | Restore baseline state |
| **"Hide pseudo-nodes"** | Router-only view (suppress LSA2 transit abstractions) |

### Failure semantics

- **Right-click failures**: model a current outage — tabs `C1 / C2 / C3` reflect this state in real time.
- **Tab-scoped scenarios**: `C4 Failure Simulation` runs its own scenario independently of right-click state.
- **Design-time audits (C5 / C6 / C7 / C8)**: ignore right-click failures and operate on the baseline topology — because these answer "is this design resilient by construction?", not "is it reachable right now?".

---

## Tab overview

### Operational state (honors right-click failures)

| Tab | ID | Purpose |
|-----|----|---------|
| **Path** | C1 | Source → destination shortest path (SPT + ECMP); auto-classifies PRIMARY / BACKUP MODE; includes unprotected-segment scan |
| **Matrix** | C2 | All-pairs SPF cost matrix; cell background encodes cost magnitude; flags ECMP / asymmetry |
| **All Pairs** | C3 | Full pair listing + idle backup link inventory (links with zero utilization under baseline traffic) |

### Failure scenario analysis

| Tab | ID | Purpose |
|-----|----|---------|
| **Failure Sim** | C4 | Select a router to fail; show post-failure connectivity, component partitioning, traffic redistribution (down / ↑ inc / ↓ dec) |

### Design-time audits (ignore right-click failures)

| Tab | ID | Purpose |
|-----|----|---------|
| **ECMP Check** | C5 | For each ECMP set, withdraw one member and verify the remainder absorbs traffic without leaking to a non-ECMP path |
| **Asymmetric** | C6 | Pairs where A→B and B→A diverge in path or aggregate metric |
| **Heatmap** | C7 | Prefix redundancy heatmap — prefix advertised by ≥2 nodes = redundant; singly-advertised = non-redundant |
| **N-1** | C8 | Enumerate all single failures; rank **most-vulnerable pairs** + **highest-impact failure scenarios** |

### Topology editing

| Tab | Purpose |
|-----|---------|
| **Links** | Live link-metric editing; supports asymmetric metrics (forward / reverse) for p2p; exports `topology.js` |

---

## Sample topology

The default scenario is an **"intercontinental ISP backbone (10 PoPs)"** — designed so that every OSPF behavior the tool exercises has at least one trigger point:

- **Six APAC PoPs** (TPE / TYO / ICN / HKG / SIN / SYD) + **Americas** (LAX) + **three European PoPs** (LHR / FRA / AMS), sharing an IX fabric (`PN_EU` = LSA2 pseudo-node).
- **ECMP trigger**: HKG → TYO has two equal-cost paths (direct vs via TPE).
- **Asymmetric metric triggers**: HKG ↔ ICN (metric 20 / 35), SIN ↔ SYD (metric 30 / 45).
- **Trans-Pacific SPOF**: LAX is the sole APAC ↔ Europe transit — its failure partitions the topology.
- **Unprotected segment**: AMS ↔ PN_EU is the only transit reaching AMS — its withdrawal isolates AMS.
- **LSA5 external**: TPE advertises `0.0.0.0/0` (default route).

To model your own network: edit `topology.js`. Schema in [SPEC.md](./SPEC.md).

---

## Tech stack

- **Cytoscape.js** — graph rendering
- **Tailwind CDN** — UI styling
- Plain vanilla JavaScript, no build step

---

## Known limitations

1. Single area only (area 0) — no ABR processing, no inter-area summary LSAs.
2. LSA5 external uses "exact match + default-route fallback" only — no full LPM resolution.
3. No latency telemetry feed — latency-aware SPF would require integrating an RFC 7471 source.
4. Topology is hand-authored `topology.js` — no LSDB parser yet (ingestion from `show ip ospf database` output is on the roadmap).

---

## Roadmap

- [ ] SRLG (Shared Risk Link Group) modeling — submarine-cable group failures, generalizing N-1 to N-K.
- [ ] SLO matrix overlay — per-pair max-metric targets with violation flagging.
- [ ] LSDB → `topology.js` parser.
- [ ] Multi-area support — OSPF inter-area metric computation.
- [ ] Flex-Algo (RFC 9350) — parallel SPF visualization.

---

For the data model and algorithms in detail, see [SPEC.md](./SPEC.md).
