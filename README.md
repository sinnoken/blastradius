# BlastRadius

**Know exactly what breaks — before it breaks.**

BlastRadius is a failure-impact analyzer for IGP (OSPF) backbone networks. It answers the question every backbone engineer loses sleep over: *"If this component fails right now, what happens to my traffic?"*

---

## The Problem

Backbone engineers today are working blind on failure impact:

- **Shortest-path computation** lives inside the router — you can't see the full picture across the network until something actually breaks.
- **ECMP verification** means staring at `show ip route` on multiple routers and hoping you didn't miss one.
- **Failure scenario analysis** means pulling cables during a maintenance window and praying.
- **Capacity planning** is a spreadsheet that was accurate three months ago.
- **N-1 compliance** is a PowerPoint slide that says "we're covered" — with no evidence behind it.

These workflows are scattered across CLI sessions, Visio diagrams, spreadsheets, and tribal knowledge. Nobody has the full picture. BlastRadius consolidates them into a single interactive view.

---

## What BlastRadius Does For You

| Capability | What You Get |
|------------|-------------|
| **Shortest Path + ECMP** | See every equal-cost path between any two routers. Know immediately whether you're on primary or backup mode. |
| **Failure Simulation** | Right-click any link or router to fail it. Watch the network reconverge in real time — no maintenance window required. |
| **Traffic Load Analysis** | See actual Gbps on every link based on your demand matrix. Know which links are at 90% before your NOC does. |
| **Betweenness Centrality** | Find the links and routers where a failure cascades hardest. Classify every component into procurement tiers (invest / maintain / downgrade / decommission). |
| **SPOF Detection** | Automatically find the links where "backup path" = "nothing". No more guessing which segments are unprotected. |
| **ECMP Backup Validation** | Verify that when one ECMP member fails, traffic stays within the group — not spilling onto some unexpected path. |
| **Asymmetric Path Detection** | Find every pair where A→B and B→A take different routes. Debug latency inconsistencies before they become trouble tickets. |
| **Prefix Redundancy Heatmap** | See which prefixes have only one advertiser. Those are silent SPOFs — invisible until the advertising router goes down. |
| **N-1 Worst-Case Ranking** | Enumerate every possible single-component failure. Rank the most vulnerable pairs and the most lethal failure scenarios. Includes capacity overflow detection. |
| **Demand Profile Switching** | Toggle between monthly-average and 95th-percentile traffic. See how your network behaves under normal load versus peak. |

### Positioning

BlastRadius is a **design-time resiliency audit tool** and a **failure scenario simulator**. It is not a real-time monitoring system — it does not poll routers or ingest telemetry feeds.

Think of it as the engineering workbench you use *before* the maintenance window, not *during* the outage.

---

## Getting Started

1. Serve over HTTP (ES modules require it — `file://` won't work):
   - **VS Code**: install Live Server → right-click `index.html` → "Open with Live Server"
   - **CLI**: `python -m http.server 8000` → open `http://localhost:8000/`
   - **GitHub Pages**: enable in repo Settings → Pages
2. The default sample loads a 10-PoP intercontinental ISP backbone with pre-tuned demand data. Everything works out of the box.

### Interaction

| Action | What Happens |
|--------|-------------|
| **Right-click a link** | Toggle link failure — the entire network reconverges instantly |
| **Right-click a router** | Toggle router failure — all attached links go down with it |
| **Left-click + drag** | Rearrange the topology layout |
| **Demand profile toggle** | Switch between monthly-average and 95th-percentile traffic |
| **"Clear all failures"** | Remove all manual failures; return to baseline topology |
| **"Hide pseudo-nodes"** | Simplify the view — show only physical routers |

### Two Kinds of Failure

- **Right-click failures** model a *current outage*. The live-analysis tabs reflect this state in real time.
- **Design-time audits** always work from the *baseline topology*. They answer "is this design resilient?" — not "is it reachable right now?"

This separation is deliberate: you can mark three links as failed to see the current damage, then switch to N-1 tab to check whether the *original design* had adequate redundancy. The two concerns never contaminate each other.

---

## Tabs

### Live Analysis — reflects your current failure state

| Tab | The Question It Answers |
|-----|------------------------|
| **Path** | "What is the shortest path from A to B right now? Am I on backup? Are there unprotected segments along the way?" |
| **Matrix** | "Show me the full cost matrix. Which pairs are expensive? Which are asymmetric? Where is ECMP available?" |
| **Link Centrality** | "Which links and routers carry the most transit traffic? Where should I invest in redundancy — and where can I save money?" |
| **Edge Traffic** | "How many Gbps is each link actually carrying? Which ones are approaching capacity?" |

### Design Audits — always use the clean baseline

| Tab | The Question It Answers |
|-----|------------------------|
| **Failure Sim** | "If router X dies, does the network partition? Where does the traffic redistribute? Do any links overflow?" |
| **ECMP Check** | "Are my ECMP groups truly resilient, or do they leak traffic to unexpected paths when a member fails?" |
| **Asymmetric** | "Which pairs have different forward and reverse paths — and why?" |
| **Prefix** | "Which prefixes have no backup advertiser? Where are my silent single points of failure?" |
| **N-1** | "Across every possible single-component failure, which pairs are most vulnerable and which failures are most destructive?" |

### Editing

| Tab | What It Does |
|-----|-------------|
| **Links** | Edit link metrics in real time. Changes propagate instantly. Export the modified topology when done. |

---

## Your Data

| File | Role | Required? |
|------|------|-----------|
| `topology.js` | Network topology — routers, links, coordinates, external routes | Yes |
| `demand.js` | Traffic demand matrix — per-pair Gbps with avg / 95th profiles, per-link capacity | Recommended |
| `engine.js` | Algorithm engine — pure functions, no UI dependency | Ship as-is |
| `index.html` | UI — visualization, state machine, tab handlers | Ship as-is |

To model your own network, edit `topology.js` and `demand.js`. Schema details in [SPEC.md](./SPEC.md).

---

## The Sample Topology

The default scenario is a **10-PoP intercontinental ISP backbone** — designed so that every analysis capability has at least one trigger:

| What It Demonstrates | Where |
|---------------------|-------|
| ECMP | HKG → TYO: two equal-cost paths (direct vs. via TPE) |
| Asymmetric metrics | HKG ↔ ICN (20 / 35), SIN ↔ SYD (30 / 45) |
| Trans-Pacific SPOF | LAX is the sole APAC ↔ Europe transit — its failure partitions the network |
| Unprotected segment | AMS depends on a single transit link to the EU fabric |
| External route | TPE advertises the default route (0.0.0.0/0) |
| Capacity contrast | Deliberate mix: 2 overloaded / 2 high / 5 mid / 9 low under avg; escalates to 5 overloaded under 95th |

This is a *teaching topology* — every design flaw is intentional. Replace it with your own when ready.

---

## Tech Stack

- **Cytoscape.js** — graph rendering
- **Tailwind CDN** — UI styling
- **Vanilla JavaScript** — no framework, no build step, no `node_modules`

One HTML file. Zero dependencies to install. Clone and serve.

---

## Known Limitations

1. **Single area only** — Area 0. No inter-area routing or ABR processing.
2. **Simplified external routing** — exact match + default-route fallback. No full longest-prefix matching.
3. **Static metrics** — link costs are hand-configured. No live latency telemetry integration.
4. **Manual topology authoring** — no LSDB parser yet; you write `topology.js` by hand.

---

## Roadmap

| Priority | Feature | Why It Matters |
|----------|---------|---------------|
| 1 | **LSDB Parser** — ingest `show ip ospf database` output | Eliminates manual topology authoring; real data in minutes |
| 2 | **What-If Topology Editing** — add/remove links, simulate capacity upgrades | Enables pre-deployment planning in the tool itself |
| 3 | **SRLG Modeling** — shared-risk link groups, generalize N-1 to N-K | Covers submarine cable cuts and conduit-sharing failures |
| 4 | **Report Export** — PDF / Excel for CAB submissions | Makes results shareable with management and change boards |
| 5 | **Maintenance Window Planning** — ordered multi-step failure simulation | Risk-scored maintenance procedures, step by step |
| 6 | **Multi-Area Support** — OSPF inter-area metric computation | Extends coverage to production multi-area networks |

---

For data model and algorithm internals, see [SPEC.md](./SPEC.md).
