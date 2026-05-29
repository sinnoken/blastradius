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

// Rule 3 (stub) + Rule 5 (prefix index) + Rule 4 (LSA5)
export function buildPrefixIndex(topo) {
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

// Dijkstra 距離表 — 從 src 出發,回傳 { nodeId: cost } 到所有可達節點
export function dijkstraDist(adj, src) {
  const dist = { [src]: 0 };
  const visited = new Set();
  const pq = [[0, src]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, u] = pq.shift();
    if (visited.has(u)) continue;
    visited.add(u);
    if (!adj[u]) continue;
    for (const [v, c] of adj[u]) {
      const nd = d + c;
      if (dist[v] === undefined || nd < dist[v]) {
        dist[v] = nd;
        pq.push([nd, v]);
      }
    }
  }
  return dist;
}

// BFS 拓樸序 — 從 root 開始,按跳數展開,穿越 pseudo-node 但只收錄 router
export function bfsOrder(adj, root) {
  const visited = new Set([root]);
  const queue = [root];
  const order = [];
  while (queue.length) {
    const u = queue.shift();
    if (!u.startsWith('PN')) order.push(u);
    for (const [v] of (adj[u] || [])) {
      if (!visited.has(v)) {
        visited.add(v);
        queue.push(v);
      }
    }
  }
  return order;
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
export function resolveLPM(prefixIndex, target) {
  if (prefixIndex[target]) return { match: target, routers: prefixIndex[target] };
  if (prefixIndex['0.0.0.0/0']) return { match: '0.0.0.0/0', routers: prefixIndex['0.0.0.0/0'] };
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
// 回傳 { load, totalPairs, reachablePairs, lostPairs }
// totalPairs:可參與計算的有序 pair 總數(已排除失效節點 — 失效節點不當 endpoint)
// lostPairs:兩端都存活但無路徑可達的 pair 列表,讓 caller 決定怎麼呈現
export function allPairsLoad(topo, failedEdges = new Set(), failedNodes = new Set()) {
  const adj = buildAdjacency(topo.edges, failedEdges, failedNodes);
  const routers = topo.nodes
    .filter(n => n.type === 'router' && !failedNodes.has(n.id))
    .map(n => n.id);
  const load = {};
  const lostPairs = [];
  let totalPairs = 0;
  for (const a of routers) {
    for (const b of routers) {
      if (a === b) continue;
      totalPairs++;
      const r = dijkstraECMP(adj, a, b);
      if (r.cost === Infinity || r.paths.length === 0) {
        lostPairs.push({ a, b });
        continue;
      }
      const w = 1 / r.paths.length;
      for (const p of r.paths) {
        for (const eid of pathToEdgeIds(p, topo.edges)) {
          load[eid] = (load[eid] || 0) + w;
        }
      }
    }
  }
  return { load, totalPairs, reachablePairs: totalPairs - lostPairs.length, lostPairs };
}

// §6.2b 流量加權版邊負載 — 權重改為 demand[a][b]
// 與 allPairsLoad 的差異:
//   1. 多回傳 Gbps 帳目 (totalDemand / servedDemand / lostDemand)
//   2. iterate 全部 router(不排除失效節點),因為 demand 到 / 出失效節點
//      在現實裡是「客戶被拋棄」,屬於 lostDemand 的一部分,必須被計入
//      ─ 否則右鍵砍掉節點時整片 demand 會憑空消失,使流量視圖反向變得安全
export function allPairsTraffic(topo, demand, failedEdges = new Set(), failedNodes = new Set()) {
  const empty = {
    traffic: {}, totalPairs: 0, reachablePairs: 0, lostPairs: [],
    totalDemand: 0, servedDemand: 0, lostDemand: 0, lostDemandPairs: [],
  };
  if (!demand || !demand.matrix) return empty;
  const adj = buildAdjacency(topo.edges, failedEdges, failedNodes);
  const allRouters = topo.nodes.filter(n => n.type === 'router').map(n => n.id);
  const dflt = demand.default ?? 0;
  const traffic = {};
  const lostDemandPairs = [];
  let totalPairs = 0, reachablePairs = 0;
  let totalDemand = 0, servedDemand = 0;
  for (const a of allRouters) {
    for (const b of allRouters) {
      if (a === b) continue;
      totalPairs++;
      const gbps = demand.matrix[a]?.[b] ?? dflt;
      totalDemand += gbps;
      if (failedNodes.has(a) || failedNodes.has(b)) {
        if (gbps > 0) lostDemandPairs.push({ a, b, gbps, reason: 'endpoint-down' });
        continue;
      }
      const r = dijkstraECMP(adj, a, b);
      if (r.cost === Infinity || r.paths.length === 0) {
        if (gbps > 0) lostDemandPairs.push({ a, b, gbps, reason: 'no-path' });
        continue;
      }
      reachablePairs++;
      servedDemand += gbps;
      const w = gbps / r.paths.length;
      for (const p of r.paths) {
        for (const eid of pathToEdgeIds(p, topo.edges)) {
          traffic[eid] = (traffic[eid] || 0) + w;
        }
      }
    }
  }
  lostDemandPairs.sort((x, y) => y.gbps - x.gbps);
  return {
    traffic, totalPairs, reachablePairs,
    lostPairs: lostDemandPairs.map(({ a, b }) => ({ a, b })),
    totalDemand, servedDemand, lostDemand: totalDemand - servedDemand,
    lostDemandPairs,
  };
}

// Freeman Node Betweenness Centrality (§6.3)
// σ(s,t|v) / σ(s,t),ECMP 等分;strip pseudo-node;排除 endpoints。
// 語意:純拓樸結構上,每台 router 平均扛多少 "過路" SPT 流量。
// 回傳結構與 allPairsLoad 一致,方便 caller 統一處理可達性訊息。
export function computeNodeBC(topo, failedEdges = new Set(), failedNodes = new Set()) {
  const adj = buildAdjacency(topo.edges, failedEdges, failedNodes);
  const routers = topo.nodes
    .filter(n => n.type === 'router' && !failedNodes.has(n.id))
    .map(n => n.id);
  const load = {};
  for (const r of routers) load[r] = 0;
  const lostPairs = [];
  let totalPairs = 0;
  for (const a of routers) {
    for (const b of routers) {
      if (a === b) continue;
      totalPairs++;
      const r = dijkstraECMP(adj, a, b);
      if (r.cost === Infinity || r.paths.length === 0) {
        lostPairs.push({ a, b });
        continue;
      }
      const w = 1 / r.paths.length;
      for (const p of r.paths) {
        const stripped = stripPseudo(p);
        // 排除頭尾(endpoints 不算過路)
        for (let i = 1; i < stripped.length - 1; i++) {
          load[stripped[i]] = (load[stripped[i]] || 0) + w;
        }
      }
    }
  }
  return { load, totalPairs, reachablePairs: totalPairs - lostPairs.length, lostPairs };
}

export function simulateNodeFailure(topo, failedNodeId) {
  const before = allPairsLoad(topo).load;
  const after  = allPairsLoad(topo, new Set(), new Set([failedNodeId])).load;
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
// C6 — PREFIX REDUNDANCY HEATMAP (§9)
// ============================================================================

export function computeHeatmap(topo, prefixIndex) {
  const result = {};
  for (const node of topo.nodes.filter(n => n.type === 'router')) {
    const owned = [];
    for (const [prefix, advs] of Object.entries(prefixIndex)) {
      if (advs.has(node.id)) owned.push({ prefix, advertisers: [...advs], backed: advs.size >= 2 });
    }
    const notbk = owned.filter(o => !o.backed).length;
    result[node.id] = {
      notbackuped: notbk,
      total: owned.length,
      ratio: owned.length ? notbk / owned.length : 0,
      prefixes: owned,
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
