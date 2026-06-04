#!/usr/bin/env python3
# Self-contained harness: replicate engine.js allPairsTraffic() to compute
# per-edge aggregate routed load / capacity for every demand profile.
import re, json, heapq, math, os

OUT = '/mnt/workspace/output'

def load_topology():
    txt = open(os.path.join(OUT, 'topology.js')).read()
    # crude but reliable: pull nodes / edges arrays via JS-ish parse
    nodes = []
    for m in re.finditer(r'\{ id: "([^"]+)",[^}]*?type: "(router|pseudonode)"', txt):
        nodes.append({'id': m.group(1), 'type': m.group(2)})
    edges = []
    for m in re.finditer(r'\{ id: "(e_[^"]+)", source: "([^"]+)", target: "([^"]+)", cost: (\d+)(?:, costRev: (\d+))?, capacity: (\d+), type: "(\w+)" \}', txt):
        e = {'id': m.group(1), 'source': m.group(2), 'target': m.group(3),
             'cost': int(m.group(4)), 'capacity': int(m.group(6)), 'type': m.group(7)}
        if m.group(5): e['costRev'] = int(m.group(5))
        edges.append(e)
    return nodes, edges

def load_demand():
    # exec the demand.js by stripping the JS wrapper into Python-ish dict.
    # Simpler: import via a tiny JS->json transform using node-free regex.
    txt = open(os.path.join(OUT, 'demand.js')).read()
    profiles = {}
    # find each profile block: key: { label:..., default: N, matrix: { ... } }
    # We'll parse matrix rows: ROW: { K: V, ... },
    # Identify profile sections by 'avg:', 'max:', 'asia_busy:', etc.
    prof_keys = ['avg', 'max', 'asia_busy', 'amer_busy', 'eu_busy']
    for pk in prof_keys:
        # locate 'pk: {'
        idx = txt.find(f'\n    {pk}: {{')
        if idx < 0: continue
        sub = txt[idx:]
        dflt = int(re.search(r'default:\s*(\d+)', sub).group(1))
        # matrix block
        mi = sub.find('matrix: {')
        # walk to matching close — rows look like 'ROW: { ... },'
        matrix = {}
        for rm in re.finditer(r'(\b[A-Z][A-Z0-9]*\b): \{ ([^}]*) \}', sub[mi:]):
            row_key = rm.group(1)
            if row_key in ('matrix',): continue
            body = rm.group(2)
            row = {}
            for cm in re.finditer(r'([A-Z][A-Z0-9]*): (\d+)', body):
                row[cm.group(1)] = int(cm.group(2))
            if row:
                matrix[row_key] = row
            # stop if we've left this profile (heuristic: next profile key)
            # break handled by scanning whole sub then filtering below
        # Trim matrix to stop at next profile — rebuild by bounding region
        # Find end of this profile's matrix using brace of '},\n    },'
        profiles[pk] = {'default': dflt, 'matrix': matrix}
    return profiles

# Better demand parser: bound each profile region explicitly.
def load_demand2():
    txt = open(os.path.join(OUT, 'demand.js')).read()
    prof_keys = ['avg', 'max', 'asia_busy', 'amer_busy', 'eu_busy']
    # find indices
    positions = []
    for pk in prof_keys:
        idx = txt.find(f'\n    {pk}: {{')
        positions.append((idx, pk))
    positions.sort()
    profiles = {}
    for i,(idx,pk) in enumerate(positions):
        end = positions[i+1][0] if i+1 < len(positions) else txt.find('\n  },\n\n  // Backward')
        if end < 0: end = len(txt)
        sub = txt[idx:end]
        dflt = int(re.search(r'default:\s*(\d+)', sub).group(1))
        matrix = {}
        for rm in re.finditer(r'^        ([A-Z][A-Z0-9]*): \{ (.*) \},$', sub, re.M):
            row_key = rm.group(1)
            body = rm.group(2)
            row = {}
            for cm in re.finditer(r'([A-Z][A-Z0-9]*): (\d+)', body):
                row[cm.group(1)] = int(cm.group(2))
            matrix[row_key] = row
        profiles[pk] = {'default': dflt, 'matrix': matrix}
    return profiles

def build_adjacency(edges):
    adj = {}
    def add(u, v, w, eid):
        adj.setdefault(u, []).append((v, w, eid))
    for e in edges:
        if e['type'] == 'p2p':
            add(e['source'], e['target'], e['cost'], e['id'])
            add(e['target'], e['source'], e.get('costRev', e['cost']), e['id'])
        elif e['type'] == 'transit':
            add(e['source'], e['target'], e['cost'], e['id'])
            add(e['target'], e['source'], 0, e['id'])
    return adj

def dijkstra_ecmp(adj, src, dst):
    INF = float('inf')
    dist = {src: 0}
    preds = {}  # node -> list of (u, eid)
    pq = [(0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist.get(u, INF): continue
        for (v, w, eid) in adj.get(u, []):
            nd = d + w
            if nd < dist.get(v, INF):
                dist[v] = nd
                preds[v] = [(u, eid)]
                heapq.heappush(pq, (nd, v))
            elif nd == dist.get(v, INF):
                preds[v].append((u, eid))
    if dist.get(dst, INF) == INF:
        return INF, []
    # enumerate edge-distinct paths (list of edge-id lists)
    edge_paths = []
    def walk(node, acc):
        if node == src:
            edge_paths.append(list(reversed(acc)))
            return
        for (u, eid) in preds.get(node, []):
            walk(u, acc + [eid])
    walk(dst, [])
    return dist[dst], edge_paths

def all_pairs_traffic(nodes, edges, profile):
    adj = build_adjacency(edges)
    routers = [n['id'] for n in nodes if n['type'] == 'router']
    dflt = profile['default']
    matrix = profile['matrix']
    traffic = {}
    lost = 0
    # cache shortest paths per source
    for a in routers:
        for b in routers:
            if a == b: continue
            gbps = matrix.get(a, {}).get(b, dflt)
            cost, eps = dijkstra_ecmp(adj, a, b)
            if cost == INF_FLAG or not eps:
                lost += 1
                continue
            w = gbps / len(eps)
            for ep in eps:
                for eid in ep:
                    traffic[eid] = traffic.get(eid, 0) + w
    return traffic

INF_FLAG = float('inf')

def main():
    nodes, edges = load_topology()
    caps = {e['id']: e['capacity'] for e in edges}
    etype = {e['id']: e['type'] for e in edges}
    # real-edge overload judgment excludes transit/pseudonode edges,
    # consistent with engine.js computeN1WorstCase (skips type=='transit').
    is_real = lambda eid: etype.get(eid) == 'p2p'
    profiles = load_demand2()
    print(f"topology: routers={sum(1 for n in nodes if n['type']=='router')} edges={len(edges)}")
    for pk in ['avg','max','asia_busy','amer_busy','eu_busy']:
        if pk not in profiles:
            print(f"  [{pk}] MISSING"); continue
        prof = profiles[pk]
        traffic = all_pairs_traffic(nodes, edges, prof)
        rows = []
        for eid, load in traffic.items():
            if not is_real(eid):
                continue
            cap = caps.get(eid, 1)
            rows.append((load/cap, eid, load, cap))
        rows.sort(reverse=True)
        over = [r for r in rows if r[0] > 1.0]
        worst = rows[0] if rows else (0, '-', 0, 1)
        nrows = len(prof['matrix'])
        print(f"\n=== {pk} (default={prof['default']}, rows={nrows}) ===")
        print(f"  REAL overloaded edges (>100% cap): {len(over)} / {len(rows)}  worst={worst[0]*100:.0f}% ({worst[1]})")
        for util, eid, load, cap in rows[:15]:
            flag = '  <<OVER' if util > 1.0 else ''
            print(f"    {eid:18s} {load:7.1f}/{cap:4d}  {util*100:5.1f}%{flag}")
    print("\n(real p2p edges only; transit/pseudonode excluded)")

if __name__ == '__main__':
    main()
