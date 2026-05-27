// ============================================================================
// BlastRadius Engine — Pure OSPF / SPT algorithms (§3–§10)
// ============================================================================
// 純函式層,不依賴 DOM / Cytoscape / 全域變數。所有狀態透過參數傳入。
// 對應 SPEC.md §2 模組分層中的 Module B + Module C。
// ============================================================================

// ============================================================================
// MODULE B — GRAPH BUILDER (§3)
// ============================================================================

// Rule 1 (p2p) + Rule 2 (transit pseudo-node) — 建有向圖鄰接表
export function buildAdjacency(edges, failedEdges = new Set(), failedNodes = new Set()) {
  const adj = {};
  const add = (u, v, c) => {
    if (failedNodes.has(u) || failedNodes.has(v)) return;
    if (!adj[u]) adj[u] = [];
    adj[u].push([v, c]);
  };
  for (const e of edges) {
    if (failedEdges.has(e.id)) continue;
    if (e.type === 'p2p') {
      add(e.source, e.target, e.cost);
      add(e.target, e.source, e.costRev ?? e.cost);
    } else if (e.type === 'transit') {
      const sIsPseudo = e.source.startsWith('PN');
      const router = sIsPseudo ? e.target : e.source;
      const pseudo = sIsPseudo ? e.source : e.target;
      add(router, pseudo, e.cost);
      add(pseudo, router, 0);
    }
  }
  return adj;
}

// Rule 3 (stub) + Rule 5 (subnet index) + Rule 4 (LSA5)
export function buildSubnetIndex(topo) {
  const idx = {};
  const add = (s, n) => { (idx[s] ??= new Set()).add(n); };

  for (const n of topo.nodes) {
    if (n.stubs) for (const s of n.stubs) add(s, n.id);
  }
  for (const pn of topo.nodes.filter(n => n.type === 'pseudonode')) {
    const attached = topo.edges
      .filter(e => e.type === 'transit' &&
                   (e.source === pn.id || e.target === pn.id))
      .map(e => e.source === pn.id ? e.target : e.source);
    for (const r of attached) add(pn.subnet, r);
  }
  for (const ext of topo.externals || []) {
    add(ext.subnet, ext.advertising_router);
  }
  return idx;
}

// ============================================================================
// C1 — SPT (Dijkstra + ECMP, §4)
// ============================================================================

export function dijkstraECMP(adj, src, dst) {
  const dist  = { [src]: 0 };
  const preds = {};
  const visited = new Set();
  const pq = [[0, src]];

  while (pq.length) {
    pq.sort((a,b) => a[0] - b[0]);
    const [d, u] = pq.shift();
    if (visited.has(u)) continue;
    visited.add(u);
    if (!adj[u]) continue;
    for (const [v, c] of adj[u]) {
      const nd = d + c;
      if (dist[v] === undefined || nd < dist[v]) {
        dist[v] = nd;
        preds[v] = new Set([u]);
        pq.push([nd, v]);
      } else if (nd === dist[v]) {
        preds[v].add(u);
      }
    }
  }
  if (dist[dst] === undefined) return { cost: Infinity, paths: [] };

  const enumerate = (node) => {
    if (node === src) return [[src]];
    if (!preds[node]) return [];
    const out = [];
    for (const p of preds[node]) {
      for (const path of enumerate(p)) out.push([...path, node]);
    }
    return out;
  };
  return { cost: dist[dst], paths: enumerate(dst) };
}

// §4.3 移除 pseudo-node 後處理
export const stripPseudo = (path) => path.filter(n => !n.startsWith('PN'));

// §4.4 IP/Network 版本 — LPM (精確匹配 + default route fallback)
export function resolveLPM(subnetIndex, target) {
  if (subnetIndex[target]) return { match: target, routers: subnetIndex[target] };
  if (subnetIndex['0.0.0.0/0']) return { match: '0.0.0.0/0', routers: subnetIndex['0.0.0.0/0'] };
  return null;
}

// 工具:把路徑(node list)轉成 edge id list — 用於高亮
export function pathToEdgeIds(path, edges) {
  const ids = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i+1];
    const e = edges.find(ed =>
      (ed.source === a && ed.target === b) ||
      (ed.source === b && ed.target === a)
    );
    if (e) ids.push(e.id);
  }
  return ids;
}

// ============================================================================
// C2 — BACKUP PATH (§5)
// ============================================================================

export function backupPath(topo, src, dst, removedEdges) {
  const adj = buildAdjacency(topo.edges, new Set(removedEdges));
  return dijkstraECMP(adj, src, dst);
}

// §5.4 Unbackup segment scan
export function unbackupSegmentScan(topo, src, dst) {
  const adj = buildAdjacency(topo.edges, new Set());
  const primary = dijkstraECMP(adj, src, dst);
  if (primary.cost === Infinity) return { primaryEdges: [], unbacked: [] };
  const primaryEdges = new Set();
  for (const p of primary.paths) {
    for (const eid of pathToEdgeIds(p, topo.edges)) primaryEdges.add(eid);
  }
  const unbacked = [];
  for (const eid of primaryEdges) {
    const r = backupPath(topo, src, dst, [eid]);
    if (r.cost === Infinity) unbacked.push(eid);
  }
  return { primaryEdges: [...primaryEdges], unbacked };
}

// ============================================================================
// C3 — FAILURE SIMULATION (§6)
// ============================================================================

// BFS over routers only — 忽略 pseudo-node
export function connectedComponents(adj, routerIds) {
  const visited = new Set();
  const comps = [];
  for (const start of routerIds) {
    if (visited.has(start)) continue;
    const comp = [];
    const stack = [start];
    while (stack.length) {
      const u = stack.pop();
      if (visited.has(u)) continue;
      visited.add(u);
      if (routerIds.includes(u)) comp.push(u);
      if (adj[u]) for (const [v] of adj[u]) if (!visited.has(v)) stack.push(v);
    }
    if (comp.length) comps.push(comp);
  }
  return comps;
}

// 每條 edge 被多少 path 使用,ECMP 等權平分
export function allPairsLoad(topo, failedEdges = new Set(), failedNodes = new Set()) {
  const adj = buildAdjacency(topo.edges, failedEdges, failedNodes);
  const routers = topo.nodes
    .filter(n => n.type === 'router' && !failedNodes.has(n.id))
    .map(n => n.id);
  const load = {};
  for (const a of routers) {
    for (const b of routers) {
      if (a === b) continue;
      const r = dijkstraECMP(adj, a, b);
      if (r.cost === Infinity || r.paths.length === 0) continue;
      const w = 1 / r.paths.length;
      for (const p of r.paths) {
        for (const eid of pathToEdgeIds(p, topo.edges)) {
          load[eid] = (load[eid] || 0) + w;
        }
      }
    }
  }
  return load;
}

export function simulateNodeFailure(topo, failedNodeId) {
  const before = allPairsLoad(topo);
  const after  = allPairsLoad(topo, new Set(), new Set([failedNodeId]));
  const routers = topo.nodes
    .filter(n => n.type === 'router' && n.id !== failedNodeId)
    .map(n => n.id);
  const adjAfter = buildAdjacency(topo.edges, new Set(), new Set([failedNodeId]));
  const comps = connectedComponents(adjAfter, routers);

  const allEids = new Set([...Object.keys(before), ...Object.keys(after)]);
  const delta = {};
  for (const eid of allEids) {
    const b = before[eid] || 0;
    const a = after[eid]  || 0;
    delta[eid] = {
      before: b, after: a,
      changePct: b > 0 ? ((a - b) / b * 100) : (a > 0 ? Infinity : 0),
      direction: a > b ? 'inc' : (a < b ? 'dec' : 'none'),
    };
  }
  return {
    isConnected: comps.length === 1,
    components: comps,
    delta,
  };
}

// ============================================================================
// C4 — ECMP BACKUP CHECK (§7)
// ============================================================================

export function firstHopEdge(src, nextHop, edges) {
  return edges.find(e =>
    (e.source === src && e.target === nextHop) ||
    (e.target === src && e.source === nextHop)
  );
}

export function ecmpBackupCheck(topo, src, dst) {
  const adj = buildAdjacency(topo.edges);
  const primary = dijkstraECMP(adj, src, dst);
  if (primary.paths.length < 2) return { status: 'n/a', reason: 'no ECMP' };

  const ecmpEdgeIds = new Set();
  for (const p of primary.paths) {
    if (p.length < 2) continue;
    const e = firstHopEdge(src, p[1], topo.edges);
    if (e) ecmpEdgeIds.add(e.id);
  }
  if (ecmpEdgeIds.size < 2) return { status: 'n/a', reason: 'single first-hop' };

  for (const eid of ecmpEdgeIds) {
    const backup = backupPath(topo, src, dst, [eid]);
    if (backup.cost === Infinity) {
      return { status: 'failed', reason: `removing ${eid} → unreachable` };
    }
    const backupEdgeIds = new Set();
    for (const p of backup.paths) {
      if (p.length < 2) continue;
      const e = firstHopEdge(src, p[1], topo.edges);
      if (e) backupEdgeIds.add(e.id);
    }
    const remaining = new Set([...ecmpEdgeIds].filter(x => x !== eid));
    for (const bid of backupEdgeIds) {
      if (!remaining.has(bid)) {
        return { status: 'failed', reason: `backup uses non-ECMP edge ${bid}` };
      }
    }
  }
  return { status: 'passed' };
}

export function ecmpBackupScanAll(topo) {
  const routers = topo.nodes.filter(n => n.type === 'router').map(n => n.id);
  const results = [];
  for (const a of routers) for (const b of routers) {
    if (a === b) continue;
    results.push({ src: a, dst: b, ...ecmpBackupCheck(topo, a, b) });
  }
  return results;
}

// ============================================================================
// C5 — ASYMMETRIC PATH DETECTION (§8)
// ============================================================================

export function detectAsymmetric(topo) {
  const adj = buildAdjacency(topo.edges);
  const routers = topo.nodes.filter(n => n.type === 'router').map(n => n.id);
  const asym = [];
  for (let i = 0; i < routers.length; i++) {
    for (let j = i+1; j < routers.length; j++) {
      const a = routers[i], b = routers[j];
      const fwd = dijkstraECMP(adj, a, b);
      const rev = dijkstraECMP(adj, b, a);
      if (fwd.cost === Infinity || rev.cost === Infinity) continue;
      const fwdSet = new Set(fwd.paths.map(p => stripPseudo(p).join('>')));
      const revSet = new Set(rev.paths.map(p => stripPseudo(p).slice().reverse().join('>')));
      const equalPaths = fwdSet.size === revSet.size &&
                         [...fwdSet].every(x => revSet.has(x));
      if (!equalPaths || fwd.cost !== rev.cost) {
        asym.push({
          a, b,
          fwdCost: fwd.cost, revCost: rev.cost,
          fwdPaths: [...fwdSet],
          revPaths: [...revSet],
        });
      }
    }
  }
  return asym;
}

// ============================================================================
// C6 — SUBNET HEATMAP (§9)
// ============================================================================

export function computeHeatmap(topo, subnetIndex) {
  const result = {};
  for (const node of topo.nodes.filter(n => n.type === 'router')) {
    const owned = [];
    for (const [subnet, advs] of Object.entries(subnetIndex)) {
      if (advs.has(node.id)) owned.push({ subnet, advertisers: [...advs], backed: advs.size >= 2 });
    }
    const notbk = owned.filter(o => !o.backed).length;
    result[node.id] = {
      notbackuped: notbk,
      total: owned.length,
      ratio: owned.length ? notbk / owned.length : 0,
      subnets: owned,
    };
  }
  return result;
}

// ============================================================================
// C8 — N-1 WORST-CASE RANKING (§10)
// ============================================================================

export function computeN1WorstCase(topo) {
  const routers = topo.nodes.filter(n => n.type === 'router').map(n => n.id);

  // 基線:無故障的全網最短路徑 cost
  const baseAdj = buildAdjacency(topo.edges);
  const baseCost = {};
  for (const a of routers) {
    baseCost[a] = {};
    for (const b of routers) {
      if (a === b) continue;
      baseCost[a][b] = dijkstraECMP(baseAdj, a, b).cost;
    }
  }

  // 枚舉所有單點失效情境
  const scenarios = [];
  for (const e of topo.edges) {
    if (e.type === 'transit') continue;  // pseudo-node 內部抽象邊不算實體故障
    scenarios.push({ kind: 'edge', id: e.id, edge: e });
  }
  for (const r of routers) {
    scenarios.push({ kind: 'node', id: r });
  }

  const pairWorst = {};
  const failStats = scenarios.map(s => ({
    ...s,
    unreachable: 0,
    degraded: 0,
    totalDelta: 0,
    maxRatio: 1,
    affected: [],
  }));

  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    const fStat = failStats[i];
    const fE = s.kind === 'edge' ? new Set([s.id]) : new Set();
    const fN = s.kind === 'node' ? new Set([s.id]) : new Set();
    const adj = buildAdjacency(topo.edges, fE, fN);

    for (const a of routers) {
      if (fN.has(a)) continue;
      for (const b of routers) {
        if (a === b || fN.has(b)) continue;
        const base = baseCost[a][b];
        if (base === Infinity) continue;
        const r = dijkstraECMP(adj, a, b);
        const cost = r.cost;
        const key = a + '>' + b;
        if (!pairWorst[key]) {
          pairWorst[key] = { a, b, base, worstCost: base, culprits: [] };
        }
        const pw = pairWorst[key];
        if (cost === Infinity) {
          fStat.unreachable++;
          fStat.affected.push({ a, b, base, worst: Infinity, ratio: Infinity });
          if (pw.worstCost !== Infinity || cost > pw.worstCost) {
            if (pw.worstCost !== Infinity) { pw.worstCost = Infinity; pw.culprits = []; }
            pw.culprits.push(s);
          }
        } else if (cost > base) {
          fStat.degraded++;
          fStat.totalDelta += (cost - base);
          const ratio = cost / base;
          if (ratio > fStat.maxRatio) fStat.maxRatio = ratio;
          fStat.affected.push({ a, b, base, worst: cost, ratio });
          if (pw.worstCost !== Infinity && cost > pw.worstCost) {
            pw.worstCost = cost;
            pw.culprits = [s];
          } else if (pw.worstCost !== Infinity && cost === pw.worstCost && pw.worstCost > base) {
            pw.culprits.push(s);
          }
        }
      }
    }
  }

  const pairRows = Object.values(pairWorst)
    .map(p => ({
      ...p,
      ratio: p.worstCost === Infinity ? Infinity : p.worstCost / p.base,
    }))
    .filter(p => p.worstCost !== p.base)
    .sort((x, y) => {
      if (x.ratio === Infinity && y.ratio !== Infinity) return -1;
      if (y.ratio === Infinity && x.ratio !== Infinity) return 1;
      return y.ratio - x.ratio;
    });

  const failureRows = failStats
    .filter(f => f.unreachable > 0 || f.degraded > 0)
    .sort((x, y) => {
      if (y.unreachable !== x.unreachable) return y.unreachable - x.unreachable;
      return y.totalDelta - x.totalDelta;
    });

  return { pairRows, failureRows, baseCost };
}
