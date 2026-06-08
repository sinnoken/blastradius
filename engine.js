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
  // 每筆鄰接帶上 edgeId,讓下游能區分「同一對節點之間的兩條平行等價鏈路」。
  // 沒有 edgeId 的話,parallel equal-cost edges 在 node 層級完全無法分辨。
  const add = (u, v, c, id) => {
    if (failedNodes.has(u) || failedNodes.has(v)) return;
    if (!adj[u]) adj[u] = [];
    adj[u].push([v, c, id]);
  };
  for (const e of edges) {
    if (failedEdges.has(e.id)) continue;
    if (e.type === 'p2p') {
      add(e.source, e.target, e.cost, e.id);
      add(e.target, e.source, e.costRev ?? e.cost, e.id);
    } else if (e.type === 'transit') {
      const sIsPseudo = e.source.startsWith('PN');
      const router = sIsPseudo ? e.target : e.source;
      const pseudo = sIsPseudo ? e.source : e.target;
      add(router, pseudo, e.cost, e.id);
      add(pseudo, router, 0, e.id);
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

// ============================================================================
// §4 — SPT (Dijkstra + ECMP)
// ============================================================================

// 回傳 { cost, paths, edgePaths }:
//   paths     — node 序列陣列(顯示 / BC / 對稱比對用)
//   edgePaths — 與 paths 索引對齊的 edgeId 序列陣列(高亮 / 負載 / ECMP 計數用)
// 關鍵:preds 改記 (前驅節點, edgeId) tuple 而非單純節點。兩條平行等價鏈路
// e1/e2 會各自成為一筆 pred,enumerate 因此展開成兩條 edge-distinct 路徑 —
// ECMP 多重度、邊高亮、負載平分才會把平行鏈路算成兩條,而不是塌成一條。
export function dijkstraECMP(adj, src, dst) {
  const dist  = { [src]: 0 };
  const preds = {};               // preds[v] = [{ u, id }, ...]
  const visited = new Set();
  const pq = [[0, src]];

  while (pq.length) {
    pq.sort((a,b) => a[0] - b[0]);
    const [d, u] = pq.shift();
    if (visited.has(u)) continue;
    visited.add(u);
    if (!adj[u]) continue;
    for (const [v, c, id] of adj[u]) {
      const nd = d + c;
      if (dist[v] === undefined || nd < dist[v]) {
        dist[v] = nd;
        preds[v] = [{ u, id }];
        pq.push([nd, v]);
      } else if (nd === dist[v]) {
        // 不去重:同一個 u 但不同 edgeId(平行鏈路)必須各記一筆
        preds[v].push({ u, id });
      }
    }
  }
  if (dist[dst] === undefined) return { cost: Infinity, paths: [], edgePaths: [] };

  const enumerate = (node) => {
    if (node === src) return [{ nodes: [src], edges: [] }];
    if (!preds[node]) return [];
    const out = [];
    for (const { u, id } of preds[node]) {
      for (const sub of enumerate(u)) {
        out.push({ nodes: [...sub.nodes, node], edges: [...sub.edges, id] });
      }
    }
    return out;
  };
  const full = enumerate(dst);
  return {
    cost: dist[dst],
    paths: full.map(f => f.nodes),
    edgePaths: full.map(f => f.edges),
  };
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
// ⚠ 平行等價鏈路無法靠 node list 還原:find() 只會回第一條。需要精準 edge
// 對應時請改用 dijkstraECMP 回傳的 edgePaths(已逐條帶 edgeId)。
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
// §5 — BACKUP PATH
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
  for (const ep of primary.edgePaths) {
    for (const eid of ep) primaryEdges.add(eid);
  }
  const unbacked = [];
  for (const eid of primaryEdges) {
    const r = backupPath(topo, src, dst, [eid]);
    if (r.cost === Infinity) unbacked.push(eid);
  }
  return { primaryEdges: [...primaryEdges], unbacked };
}

// ============================================================================
// §6 — FAILURE SIMULATION
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
      if (r.cost === Infinity || r.edgePaths.length === 0) {
        lostPairs.push({ a, b });
        continue;
      }
      // 以 edgePaths 數量為 ECMP 多重度,負載平分到每條 edge(含平行鏈路)
      const w = 1 / r.edgePaths.length;
      for (const ep of r.edgePaths) {
        for (const eid of ep) {
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
      if (r.cost === Infinity || r.edgePaths.length === 0) {
        if (gbps > 0) lostDemandPairs.push({ a, b, gbps, reason: 'no-path' });
        continue;
      }
      reachablePairs++;
      servedDemand += gbps;
      // demand 平分到每條 edge-distinct 路徑 — 平行等價鏈路各分到 gbps / N
      const w = gbps / r.edgePaths.length;
      for (const ep of r.edgePaths) {
        for (const eid of ep) {
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

// §6.3b 流量加權節點介數 (Demand-weighted Node Betweenness)
// 與 §6.3 computeNodeBC 同一套「strip pseudo + 排除 endpoints」累加,但每對 (a,b)
// 的權重從「1」改為 demand[a][b](吃重力模型產出的流量矩陣)。
// 語意:每台中繼 router 平均轉送多少 Gbps 過路流量 — 採購視角的「節點熱度」。
// 與 §6.2b allPairsTraffic 對齊:iterate 全部 router(不排除失效節點),demand 到 /
// 出失效節點計入 lostDemand;回傳附 Gbps 帳目供可達性 banner 重用。
// 注意:ECMP 等分用 r.paths.length(節點路徑數,與 §6.3 一致),非 edgePaths.length —
// 節點層級看 router 序列,平行等價鏈路不另計。
export function computeNodeTraffic(topo, demand, failedEdges = new Set(), failedNodes = new Set()) {
  const empty = {
    load: {}, totalPairs: 0, reachablePairs: 0, lostPairs: [],
    totalDemand: 0, servedDemand: 0, lostDemand: 0, lostDemandPairs: [],
  };
  if (!demand || !demand.matrix) return empty;
  const adj = buildAdjacency(topo.edges, failedEdges, failedNodes);
  const allRouters = topo.nodes.filter(n => n.type === 'router').map(n => n.id);
  const dflt = demand.default ?? 0;
  const load = {};
  for (const r of allRouters) if (!failedNodes.has(r)) load[r] = 0;
  const lostDemandPairs = [];
  let totalPairs = 0, reachablePairs = 0, totalDemand = 0, servedDemand = 0;
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
        const stripped = stripPseudo(p);
        // 排除頭尾(endpoints 不算過路)
        for (let i = 1; i < stripped.length - 1; i++) {
          load[stripped[i]] = (load[stripped[i]] || 0) + w;
        }
      }
    }
  }
  lostDemandPairs.sort((x, y) => y.gbps - x.gbps);
  return {
    load, totalPairs, reachablePairs,
    lostPairs: lostDemandPairs.map(({ a, b }) => ({ a, b })),
    totalDemand, servedDemand, lostDemand: totalDemand - servedDemand,
    lostDemandPairs,
  };
}

// ============================================================================
// §7 — ECMP BACKUP CHECK
// ============================================================================

export function ecmpBackupCheck(topo, src, dst) {
  const adj = buildAdjacency(topo.edges);
  const primary = dijkstraECMP(adj, src, dst);
  // ECMP 多重度以 edge-distinct 路徑數計 — 兩條平行等價鏈路即構成 ECMP×2
  if (primary.edgePaths.length < 2) return { status: 'n/a', reason: 'no ECMP' };

  const ecmpEdgeIds = new Set();
  for (const ep of primary.edgePaths) {
    if (ep.length) ecmpEdgeIds.add(ep[0]);   // 第一條實體邊 = first-hop interface
  }
  if (ecmpEdgeIds.size < 2) return { status: 'n/a', reason: 'single first-hop' };

  for (const eid of ecmpEdgeIds) {
    const backup = backupPath(topo, src, dst, [eid]);
    if (backup.cost === Infinity) {
      return { status: 'failed', reason: `removing ${eid} → unreachable` };
    }
    const backupEdgeIds = new Set();
    for (const ep of backup.edgePaths) {
      if (ep.length) backupEdgeIds.add(ep[0]);
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
// §8 — ASYMMETRIC PATH DETECTION
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
// §9 — PREFIX REDUNDANCY HEATMAP
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
// §10 — N-1 WORST-CASE RANKING
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

// ============================================================================
// §15 — OSPF WEIGHT OPTIMIZATION (Fortz-Thorup objective + Tabu Search)
// ============================================================================
// 單目標壓壅塞:字典序 (MLU, S);S 在可行區(MLU<1)用 Σu²(均衡),超載區用 Σcap·ψ(最不爛)。
// 硬約束以每條 p2p 邊的整數界 [lo,hi] 剪枝(RTT 下限 / VIP 不能升 / protected 不能降 / [5,250])。
// 只優化 p2p 邊的「對稱」權重(cost=costRev);transit(LSA2)cost 不動。
// 純函式,不碰 DOM / Cytoscape;評估壅塞重用 §6.2b allPairsTraffic(ECMP 等分,與本檔一致)。

// §15.1 Fortz-Thorup 分段凸懲罰 ψ(連續分段線性),回傳 cap·ψ(load/cap)。
// 斜率 1→3→10→70→500→5000,膝點 1/3·2/3·9/10·1·11/10;cap 加權讓大管的超載權重更高。
export function ftLinkPenalty(load, cap) {
  if (!(cap > 0) || !isFinite(cap)) return 0;
  const u = load / cap;
  const bp = [1 / 3, 2 / 3, 0.9, 1, 1.1];
  const sl = [1, 3, 10, 70, 500, 5000];
  let prev = 0, acc = 0;
  for (let i = 0; i < bp.length; i++) {
    if (u <= bp[i]) return cap * (acc + sl[i] * (u - prev));
    acc += sl[i] * (bp[i] - prev);
    prev = bp[i];
  }
  return cap * (acc + sl[5] * (u - prev));
}

// §15.2 給「已套權重的 topo」評估壅塞。MLU / 懲罰僅計 p2p 邊(可控變數),transit 不列入目標。
// 回 { mlu, sumU2, sumPhi, util(每邊利用率), lostDemand }。
export function evalCongestion(topoW, demand, failedEdges = new Set(), failedNodes = new Set()) {
  const res = allPairsTraffic(topoW, demand, failedEdges, failedNodes);
  const traffic = res.traffic;
  const util = {};
  let mlu = 0, sumU2 = 0, sumPhi = 0;
  for (const e of topoW.edges) {
    if (e.type !== 'p2p') continue;
    const cap = e.capacity ?? Infinity;
    if (!(cap > 0) || !isFinite(cap)) continue;
    const load = traffic[e.id] || 0;
    const u = load / cap;
    util[e.id] = u;
    if (u > mlu) mlu = u;
    sumU2 += u * u;
    sumPhi += ftLinkPenalty(load, cap);
  }
  return { mlu, sumU2, sumPhi, util, lostDemand: res.lostDemand };
}

// §15.3 套上對稱權重(p2p:cost=costRev=w),回 topo 淺拷貝,不 mutate 原 topo。
// weights = Map<edgeId, w>;未列入的邊保留原值。
export function applyWeights(topo, weights) {
  const edges = topo.edges.map(e => {
    if (e.type === 'p2p' && weights.has(e.id)) {
      const w = weights.get(e.id);
      return { ...e, cost: w, costRev: w };
    }
    return e;
  });
  return { ...topo, edges };
}

// §15.4 由紅線生成每條 p2p 邊的整數權重界 [lo,hi]。
//   rttFloor     : Map<edgeId, number>  RTT 推算的成本下限(caller 用其公式算好傳入,engine 不綁光纖常數)
//   vip          : Set<edgeId>           不能升 → hi=current
//   protectedSet : Set<edgeId>           不能降 → lo=current
//   clamp        : [min,max]             全域 [5,250]
// conflict = lo>hi(紅線矛盾,夾在 current);frozen = lo>=hi(不進鄰域)。
export function buildWeightBounds(topo, {
  rttFloor = new Map(), vip = new Set(), protectedSet = new Set(), clamp = [5, 250],
} = {}) {
  const [cmin, cmax] = clamp;
  const bounds = new Map();
  for (const e of topo.edges) {
    if (e.type !== 'p2p') continue;
    const cur = e.cost;
    let lo = Math.max(cmin, Math.ceil(rttFloor.get(e.id) ?? cmin),
                      protectedSet.has(e.id) ? cur : cmin);
    let hi = Math.min(cmax, vip.has(e.id) ? cur : cmax);
    const conflict = lo > hi;
    if (conflict) { lo = hi = cur; }
    const frozen = lo >= hi;
    bounds.set(e.id, { lo, hi, frozen, conflict, current: cur });
  }
  return bounds;
}

// 確定性 PRNG(mulberry32)— seed 固定 → 同輸入同輸出 → export 穩定。
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// §15.5 Tabu Search 驅動。回 { weights, mlu, sumU2, sumPhi, util, feasible, targetMet,
//   target, bottleneck, binding, frozen, history, iterations }。
export function optimizeWeights(topo, demand, bounds, opts = {}) {
  const {
    init = 'warm', target = 0.75, tieBreak = 'auto',
    steps = [1, 2, 4], tabuTenure = 0, stallK = 8, diversifyM = 0,
    maxIters = 300, seed = 1, failedEdges = new Set(), failedNodes = new Set(),
    // 封住最壞情況(尤其無解時不空轉到底),避免單執行緒整片凍結。詳見 SPEC §15.6 / §13。
    //   maxEvals    主限制器,計「鄰域評估次數」— 確定性(同 seed/同圖 → 同結果),runtime 隨機器變但有界
    //   timeBudgetMs 僅作脫韁保險,設大(正常 POC 規模不會觸發,故不破壞確定性);大圖請改用 Web Worker
    //   stopAfter   全域最佳長期停滯即收手
    maxEvals = 1800, timeBudgetMs = 15000, stopAfter = 0,
  } = opts;
  const rng = mulberry32(seed);
  const EPS = 1e-9;
  const t0 = Date.now();

  const p2p = topo.edges.filter(e => e.type === 'p2p' && bounds.has(e.id));
  const movable = p2p.filter(e => !bounds.get(e.id).frozen).map(e => e.id);
  const clampTo = (id, w) => {
    const b = bounds.get(id);
    return Math.max(b.lo, Math.min(b.hi, w));
  };
  const tenure = tabuTenure || Math.max(5, Math.round(Math.sqrt(movable.length || 1)));
  const divM = diversifyM || Math.max(1, Math.round(movable.length * 0.2));
  const maxCap = Math.max(1, ...p2p.map(x => (x.capacity ?? 1)));

  // 初始權重:warm = 現網 cost 投影進界;invcap = round(maxCap/cap) 投影進界
  const W = new Map();
  for (const e of p2p) {
    const b = bounds.get(e.id);
    if (b.frozen) { W.set(e.id, b.lo); continue; }
    const cap = e.capacity ?? 1;
    const raw = init === 'invcap' ? Math.round(maxCap / (cap > 0 ? cap : 1)) : e.cost;
    W.set(e.id, clampTo(e.id, raw));
  }

  // 目標:字典序 (MLU, S);S 由 tieBreak 決定(auto = 可行區 u² / 超載區 phi)
  const Sof = (ev) => tieBreak === 'u2' ? ev.sumU2
    : tieBreak === 'phi' ? ev.sumPhi
    : (ev.mlu < 1 ? ev.sumU2 : ev.sumPhi);
  const better = (a, b) => {
    if (a.mlu < b.mlu - EPS) return true;
    if (b.mlu < a.mlu - EPS) return false;
    return Sof(a) < Sof(b) - EPS;
  };
  const evalW = (w) => evalCongestion(applyWeights(topo, w), demand, failedEdges, failedNodes);

  const candWeights = (id) => {
    const b = bounds.get(id), cur = W.get(id), set = new Set();
    for (const s of steps) { set.add(clampTo(id, cur - s)); set.add(clampTo(id, cur + s)); }
    set.add(b.lo); set.add(b.hi);
    set.delete(cur);
    return [...set];
  };

  let curEval = evalW(W);
  let best = new Map(W), bestEval = curEval;
  const tabu = new Map();    // key `edge:weight` → 到期 iter(禁止短期回頭到該值)
  const history = [{ iter: 0, mlu: curEval.mlu, s: Sof(curEval) }];
  let stall = 0, iterations = 0, noImprove = 0, evals = 0;
  const stopStall = stopAfter || Math.max(15, stallK + 12);   // 全域最佳長期停滯 → 收手

  for (let iter = 1; iter <= maxIters; iter++) {
    iterations = iter;
    if (bestEval.mlu <= target + EPS) break;            // 達標
    if (evals >= maxEvals) break;                       // 評估預算用盡(確定性主限制器)
    if (noImprove >= stopStall) break;                  // 平台停損(無解時尤其關鍵)
    if (Date.now() - t0 > timeBudgetMs) break;          // 脫韁保險(正常規模不觸發)

    let pE = null, pW = null, pEv = null;        // 最佳非 tabu
    let aE = null, aW = null, aEv = null;        // aspiration(破全域最佳,即使 tabu)
    for (const id of movable) {
      const old = W.get(id);
      for (const w of candWeights(id)) {
        W.set(id, w);
        const ev = evalW(W);
        evals++;
        W.set(id, old);
        const isTabu = (tabu.get(id + ':' + w) ?? 0) > iter;
        if (!isTabu && (pEv === null || better(ev, pEv))) { pE = id; pW = w; pEv = ev; }
        if (better(ev, bestEval) && (aEv === null || better(ev, aEv))) { aE = id; aW = w; aEv = ev; }
      }
    }

    let chE, chW, chEv;
    if (aEv && (pEv === null || better(aEv, pEv))) { chE = aE; chW = aW; chEv = aEv; }
    else if (pEv) { chE = pE; chW = pW; chEv = pEv; }
    else break;     // 無可動鄰居

    const oldW = W.get(chE);
    W.set(chE, chW);
    curEval = chEv;
    tabu.set(chE + ':' + oldW, iter + tenure);

    if (better(curEval, bestEval)) { best = new Map(W); bestEval = curEval; stall = 0; noImprove = 0; }
    else { stall++; noImprove++; }

    if (stall >= stallK) {     // 多樣化:隨機重設 divM 條(seeded)
      for (let k = 0; k < divM; k++) {
        const id = movable[Math.floor(rng() * movable.length)];
        const b = bounds.get(id);
        W.set(id, b.lo + Math.floor(rng() * (b.hi - b.lo + 1)));
      }
      curEval = evalW(W);
      stall = 0;
    }
    history.push({ iter, mlu: curEval.mlu, s: Sof(curEval) });
  }

  const feasible = bestEval.mlu < 1 - EPS;
  const targetMet = bestEval.mlu <= target + EPS;
  const bottleneck = Object.entries(bestEval.util)
    .filter(([, u]) => Math.abs(u - bestEval.mlu) < 1e-6)
    .map(([id]) => id);

  // 無解(MLU≥1)時:逐條 p2p 邊試把界外放鬆一步,排「鬆哪條紅線 MLU 降最多」
  let binding = [];
  if (!feasible) {
    for (const e of p2p) {
      const b = bounds.get(e.id), w0 = best.get(e.id), trials = [];
      for (const w of [w0 - 1, w0 + 1]) {
        if (w < 5 || w > 250) continue;
        if (w >= b.lo && w <= b.hi) continue;    // 仍在界內 → 不算放鬆紅線
        const tw = new Map(best); tw.set(e.id, w);
        trials.push({ w, mlu: evalW(tw).mlu });
      }
      if (trials.length) {
        const bt = trials.reduce((m, t) => (t.mlu < m.mlu ? t : m));
        const gain = bestEval.mlu - bt.mlu;
        if (gain > 1e-6) binding.push({ edgeId: e.id, relaxTo: bt.w, mluAfter: bt.mlu, gain });
      }
    }
    binding.sort((a, b) => b.gain - a.gain);
    binding = binding.slice(0, 5);
  }

  const frozen = p2p.filter(e => bounds.get(e.id).frozen).map(e => e.id);
  return {
    weights: best, mlu: bestEval.mlu, sumU2: bestEval.sumU2, sumPhi: bestEval.sumPhi,
    util: bestEval.util, feasible, targetMet, target,
    bottleneck, binding, frozen, history, iterations, elapsedMs: Date.now() - t0,
  };
}
