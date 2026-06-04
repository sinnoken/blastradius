#!/usr/bin/env python3
# Deterministic generator for BlastRadius POC — 45-node / 10-country backbone.
# Emits topology.js, demand.js, srlg.js to output/.
import math, os

OUT = '/mnt/workspace/output'

# ── Node table: id -> (country, x, y, weight, tier) ──
# tier: 'L' 大 / 'M' 中 / 'S' 小
# 10 個國家:TW JP CN HK SG US UK DE AU IN(亞太運營商實際足跡:本土最重,
# 經香港 / 新加坡兩大互連樞紐出海,落地美 / 歐 / 澳 / 印)。同城多 PoP 為真實常態。
NODES = {
    # ── 大 (L) 東亞核心 7 ──
    'TPE': ('TW', 235, 250, 10, 'L'),
    'KHH': ('TW', 205, 320,  6, 'L'),
    'TYO': ('JP', 385, 175, 10, 'L'),
    'OSA': ('JP', 430, 250,  7, 'L'),
    'SHA': ('CN', 330, 120,  8, 'L'),
    'HKG': ('HK', 160, 360, 10, 'L'),
    'SIN': ('SG', 260, 445, 10, 'L'),
    # ── TW 其餘 4 ──
    'TPE2': ('TW', 258, 232, 6, 'M'),
    'TYN':  ('TW', 218, 268, 4, 'S'),
    'TCH':  ('TW', 210, 296, 4, 'S'),
    'HSZ':  ('TW', 228, 282, 3, 'S'),
    # ── JP 其餘 3 ──
    'TYO2': ('JP', 402, 158, 6, 'M'),
    'NGO':  ('JP', 415, 214, 4, 'M'),
    'FUK':  ('JP', 356, 244, 4, 'S'),
    # ── CN 其餘 5 ──
    'PEK': ('CN', 305,  60, 7, 'M'),
    'CAN': ('CN', 298, 162, 6, 'M'),
    'SZX': ('CN', 320, 150, 5, 'M'),
    'CTU': ('CN', 268, 108, 4, 'S'),
    'WUH': ('CN', 340,  95, 4, 'S'),
    # ── HK 其餘 2 ──
    'HKG2': ('HK', 144, 376, 6, 'M'),
    'HKG3': ('HK', 176, 348, 4, 'S'),
    # ── SG 其餘 2 ──
    'SIN2': ('SG', 244, 466, 6, 'M'),
    'SIN3': ('SG', 286, 456, 4, 'S'),
    # ── US 8 ──
    'LAX': ('US', 660, 250, 8, 'M'),
    'SJC': ('US', 635, 190, 6, 'M'),
    'SEA': ('US', 660, 125, 6, 'M'),
    'JFK': ('US', 860, 175, 8, 'M'),
    'IAD': ('US', 840, 225, 6, 'M'),
    'ORD': ('US', 795, 155, 6, 'M'),
    'DAL': ('US', 768, 246, 5, 'S'),
    'ATL': ('US', 830, 282, 5, 'S'),
    # ── UK 3 ──
    'LHR':  ('UK', 1060, 150, 8, 'M'),
    'LHR2': ('UK', 1044, 134, 5, 'M'),
    'MAN':  ('UK', 1050, 110, 4, 'S'),
    # ── DE 3 ──
    'FRA':  ('DE', 1110, 185, 8, 'M'),
    'FRA2': ('DE', 1126, 170, 5, 'M'),
    'MUC':  ('DE', 1135, 230, 4, 'S'),
    # ── AU 4 ──
    'SYD': ('AU', 470, 620, 6, 'M'),
    'MEL': ('AU', 440, 675, 4, 'M'),
    'PER': ('AU', 340, 630, 4, 'S'),
    'BNE': ('AU', 482, 600, 3, 'S'),
    # ── IN 4 ──
    'BOM': ('IN', 1185, 490, 6, 'M'),
    'DEL': ('IN', 1235, 445, 5, 'M'),
    'MAA': ('IN', 1200, 510, 4, 'S'),
    'BLR': ('IN', 1175, 505, 4, 'S'),
}

ORDER = list(NODES.keys())
IDX = {nid: i + 1 for i, nid in enumerate(ORDER)}  # 1-based for stubs

# ── 真實經緯度 (lat, lon) — 成本與重力需求改吃大圈距離,擺脫像素失真。 ──
# 畫布 x/y 只負責排版。同城多 PoP 經緯度幾乎相同 → 城內鏈路成本自然趨近下限(realistic)。
GEO = {
    'TPE': (25.0, 121.5), 'KHH': (22.6, 120.3), 'TYO': (35.7, 139.7), 'OSA': (34.7, 135.5),
    'SHA': (31.2, 121.5), 'HKG': (22.3, 114.2), 'SIN': (1.35, 103.8),
    'TPE2': (25.1, 121.6), 'TYN': (25.0, 121.2), 'TCH': (24.1, 120.7), 'HSZ': (24.8, 121.0),
    'TYO2': (35.6, 139.8), 'NGO': (35.2, 136.9), 'FUK': (33.6, 130.4),
    'PEK': (39.9, 116.4), 'CAN': (23.1, 113.3), 'SZX': (22.5, 114.1), 'CTU': (30.6, 104.1),
    'WUH': (30.6, 114.3), 'HKG2': (22.3, 114.1), 'HKG3': (22.4, 114.2),
    'SIN2': (1.30, 103.9), 'SIN3': (1.40, 103.7),
    'LAX': (34.0, -118.2), 'SJC': (37.3, -121.9), 'SEA': (47.6, -122.3), 'JFK': (40.6, -73.8),
    'IAD': (38.95, -77.45), 'ORD': (41.98, -87.9), 'DAL': (32.8, -96.8), 'ATL': (33.7, -84.4),
    'LHR': (51.47, -0.45), 'LHR2': (51.5, -0.1), 'MAN': (53.4, -2.2),
    'FRA': (50.0, 8.6), 'FRA2': (50.1, 8.7), 'MUC': (48.1, 11.6),
    'SYD': (-33.9, 151.2), 'MEL': (-37.8, 144.9), 'PER': (-31.95, 115.9), 'BNE': (-27.5, 153.0),
    'BOM': (19.1, 72.9), 'DEL': (28.6, 77.1), 'MAA': (13.1, 80.3), 'BLR': (13.0, 77.6),
}

# Pseudonodes: id -> (subnet, x, y)
PSEUDO = {
    'PN_EU': ('192.168.100.0/24', 1140, 120),
    'PN_AS': ('192.168.101.0/24', 110, 330),
    'PN_US': ('192.168.102.0/24', 600, 210),
}

# Anycast groups (shared /24 advertised by multiple routers → "backed")
ANYCAST = {
    '100.64.0.0/24': ['TPE', 'HKG', 'SIN', 'TYO'],
    '100.64.1.0/24': ['LAX', 'SJC', 'JFK', 'IAD'],
    '100.64.2.0/24': ['LHR', 'FRA', 'LHR2', 'FRA2'],
    '100.64.3.0/24': ['SHA', 'PEK', 'CAN', 'SZX'],
    '100.64.4.0/24': ['BOM', 'DEL', 'MAA', 'BLR'],
    '100.64.5.0/24': ['SYD', 'MEL', 'BNE'],
}
anycast_of = {}
for sub, members in ANYCAST.items():
    for m in members:
        anycast_of.setdefault(m, []).append(sub)

def geo_km(a, b):
    lat1, lon1 = GEO[a]; lat2, lon2 = GEO[b]
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1); dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

def cost_for(a, b):
    # OSPF-ish metric ∝ 光纖傳播延遲 ≈ 大圈 km / 90。城內鏈路下限 5,超長海纜上限 250。
    return max(5, min(250, round(geo_km(a, b) / 90)))

def cap_for(a, b):
    ta, tb = NODES[a][4], NODES[b][4]
    if ta == 'S' or tb == 'S':
        return 300
    if ta == 'L' and tb == 'L':
        return 900
    if ta == 'L' or tb == 'L':
        return 700
    return 500

# ── Edge list (undirected pairs). Asymmetric overrides applied after. ──
INTRA = [
    # TW
    ('TPE', 'KHH'), ('TPE', 'TYN'), ('TPE', 'HSZ'), ('TPE', 'TPE2'),
    ('KHH', 'TCH'), ('TCH', 'HSZ'), ('TYN', 'HSZ'), ('TPE2', 'TYN'),
    # JP
    ('TYO', 'OSA'), ('TYO', 'TYO2'), ('TYO', 'NGO'), ('OSA', 'NGO'),
    ('NGO', 'FUK'), ('OSA', 'FUK'), ('TYO2', 'NGO'),
    # CN
    ('SHA', 'PEK'), ('SHA', 'WUH'), ('SHA', 'CAN'), ('SHA', 'SZX'),
    ('CAN', 'SZX'), ('PEK', 'CTU'), ('WUH', 'CTU'), ('CAN', 'WUH'),
    # HK
    ('HKG', 'HKG2'), ('HKG', 'HKG3'), ('HKG2', 'HKG3'),
    # SG
    ('SIN', 'SIN2'), ('SIN', 'SIN3'), ('SIN2', 'SIN3'),
    # US
    ('LAX', 'SJC'), ('SJC', 'SEA'), ('SEA', 'ORD'), ('ORD', 'JFK'),
    ('JFK', 'IAD'), ('IAD', 'ATL'), ('ATL', 'DAL'), ('DAL', 'LAX'), ('ORD', 'IAD'),
    # UK
    ('LHR', 'LHR2'), ('LHR', 'MAN'), ('LHR2', 'MAN'),
    # DE
    ('FRA', 'FRA2'), ('FRA', 'MUC'), ('FRA2', 'MUC'),
    # AU
    ('SYD', 'MEL'), ('SYD', 'BNE'), ('MEL', 'PER'), ('PER', 'SYD'), ('BNE', 'MEL'),
    # IN
    ('BOM', 'DEL'), ('BOM', 'MAA'), ('MAA', 'BLR'), ('BLR', 'BOM'),
]
BACKBONE = [
    # 東亞核心
    ('TPE', 'TYO'), ('TPE', 'HKG'), ('TPE', 'SHA'), ('TPE', 'OSA'), ('TPE', 'SIN'),
    ('TYO', 'SHA'), ('HKG', 'SHA'), ('HKG', 'CAN'), ('HKG', 'SIN'),
    # 亞洲 ↔ 南亞
    ('SIN', 'BOM'), ('SIN', 'DEL'),
    # 跨太平洋
    ('TYO', 'LAX'), ('TYO', 'SEA'), ('TPE', 'LAX'), ('HKG', 'LAX'), ('OSA', 'SJC'),
    # 亞洲 ↔ 大洋洲
    ('SIN', 'SYD'), ('HKG', 'SYD'), ('SYD', 'LAX'),
    # 跨大西洋 / 美歐
    ('JFK', 'LHR'), ('JFK', 'FRA'), ('IAD', 'FRA2'), ('LAX', 'LHR'),
    # 歐洲核心
    ('LHR', 'FRA'), ('LHR2', 'FRA2'), ('LHR', 'MUC'),
    # 歐洲 ↔ 南亞
    ('DEL', 'FRA'), ('BOM', 'LHR'), ('BOM', 'FRA2'),
]

# Asymmetric overrides: (a,b) -> (cost a→b, costRev b→a),數值貼齊新的 geo 成本尺度。
ASYM = {
    ('SIN', 'SYD'): (70, 95),
    ('LAX', 'LHR'): (110, 90),
    ('SIN', 'BOM'): (43, 38),
    ('LHR', 'FRA'): (7, 14),
}

TRANSIT = {
    'PN_EU': ['LHR', 'FRA', 'FRA2'],
    'PN_AS': ['HKG', 'SIN', 'TPE'],
    'PN_US': ['LAX', 'SJC', 'SEA'],
}

# ── Build edge records ──
edges = []
seen = set()

def add_edge(a, b, eid=None, cap=None):
    key = frozenset((a, b))
    if key in seen and eid is None:
        return
    seen.add(key)
    if (a, b) in ASYM:
        c, cr = ASYM[(a, b)]
    elif (b, a) in ASYM:
        cr, c = ASYM[(b, a)]
    else:
        c = cr = cost_for(a, b)
    rec = {'id': eid or f'e_{a}_{b}', 'source': a, 'target': b, 'cost': c}
    if cr != c:
        rec['costRev'] = cr
    rec['capacity'] = cap if cap is not None else cap_for(a, b)
    rec['type'] = 'p2p'
    edges.append(rec)

for a, b in INTRA + BACKBONE:
    add_edge(a, b)

# ── Parallel equal-cost links (同來源/同終點 ECMP) ──
# 每筆與主鏈路同一對節點、同 cost(cost_for 純距離 → 自動相等),
# 透過顯式 eid 繞過 dedup,故必成 ECMP×2。挑選對稱(無 ASYM)的高需求走廊。
PARALLEL = [
    ('TPE', 'TYO', 400),   # 台日主幹
    ('TYO', 'LAX', 700),   # 跨太平洋主幹
    ('HKG', 'SIN', 900),   # 港星主幹
    ('JFK', 'LHR', 500),   # 跨大西洋北
    ('LAX', 'SJC', 500),   # 美西區內
    ('TPE', 'HKG', 700),   # 台港主幹
    ('TYO', 'SHA', 700),   # 日中主幹
]
for a, b, cap in PARALLEL:
    add_edge(a, b, eid=f'e_{a}_{b}_b', cap=cap)

for pn, routers in TRANSIT.items():
    for r in routers:
        edges.append({'id': f'e_{r}_{pn}', 'source': r, 'target': pn,
                      'cost': 10, 'capacity': 1100, 'type': 'transit'})

# ── Build node records ──
def stubs_for(nid):
    i = IDX[nid]
    s = [f'{i}.{i}.{i}.{i}/32', f'10.{i}.0.0/24']
    s += anycast_of.get(nid, [])
    return s

ASBR = {'TPE', 'FRA'}

node_recs = []
for nid in ORDER:
    cc = NODES[nid][0]
    node_recs.append({
        'id': nid, 'label': f'{nid}\\n{cc}', 'type': 'router', 'area': '0',
        'stubs': stubs_for(nid), 'isASBR': nid in ASBR, 'isABR': False,
    })
for pn, (sub, x, y) in PSEUDO.items():
    node_recs.append({'id': pn, 'label': f'{pn}\\n{sub}', 'type': 'pseudonode', 'subnet': sub})

positions = {}
for nid in ORDER:
    positions[nid] = {'x': NODES[nid][1], 'y': NODES[nid][2]}
for pn, (sub, x, y) in PSEUDO.items():
    positions[pn] = {'x': x, 'y': y}

externals = [
    {'advertising_router': 'TPE', 'subnet': '0.0.0.0/0', 'metric': 1, 'metric_type': 'E2'},
    {'advertising_router': 'FRA', 'subnet': '0.0.0.0/0', 'metric': 1, 'metric_type': 'E2'},
]

# ── Connectivity check (BFS over routers via p2p edges) ──
adj = {n: set() for n in ORDER}
for e in edges:
    if e['type'] == 'p2p':
        adj[e['source']].add(e['target'])
        adj[e['target']].add(e['source'])
visited = set()
stack = ['TPE']
while stack:
    u = stack.pop()
    if u in visited:
        continue
    visited.add(u)
    for v in adj[u]:
        if v not in visited:
            stack.append(v)
missing = set(ORDER) - visited
assert not missing, f'DISCONNECTED routers: {missing}'
degree1 = [n for n in ORDER if len(adj[n]) < 2]
assert not degree1, f'degree<2 routers: {degree1}'

# ── Serialize topology.js ──
def js_val(v):
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        return '"' + v + '"'
    if isinstance(v, list):
        return '[' + ','.join(js_val(x) for x in v) + ']'
    raise TypeError(v)

def js_obj(d):
    return '{ ' + ', '.join(f'{k}: {js_val(v)}' for k, v in d.items()) + ' }'

lines = []
lines.append('// Generated by working/gen.py — BlastRadius POC 45-node / 10-country dataset.')
lines.append('const topology = {')
lines.append('  nodes: [')
lines.append(',\n'.join('    ' + js_obj(n) for n in node_recs))
lines.append('  ],')
lines.append('  edges: [')
lines.append(',\n'.join('    ' + js_obj(e) for e in edges))
lines.append('  ],')
lines.append('  externals: [')
lines.append(',\n'.join('    ' + js_obj(e) for e in externals))
lines.append('  ],')
lines.append('  positions: {')
lines.append(',\n'.join(f'    {k}: {js_obj(v)}' for k, v in positions.items()))
lines.append('  },')
lines.append('};')
lines.append('')
with open(os.path.join(OUT, 'topology.js'), 'w') as f:
    f.write('\n'.join(lines))

# ── demand.js — gravity model + 5 profiles ──
ASIA = {'TPE','TPE2','KHH','TYN','TCH','HSZ','TYO','TYO2','OSA','NGO','FUK',
        'SHA','PEK','CAN','SZX','CTU','WUH','HKG','HKG2','HKG3','SIN','SIN2','SIN3',
        'SYD','MEL','PER','BNE','BOM','DEL','MAA','BLR'}
AMER = {'LAX','SJC','SEA','JFK','IAD','ORD','DAL','ATL'}
EURO = {'LHR','LHR2','MAN','FRA','FRA2','MUC'}

def macro(n):
    if n in ASIA: return 'asia'
    if n in AMER: return 'amer'
    return 'euro'

K = 2.5
def base_demand(a, b):
    wa, wb = NODES[a][3], NODES[b][3]
    d = geo_km(a, b)
    # 距離衰減放寬到 /3000:國際長途(跨洋/跨洲)流量不致被過度壓低,
    # 對「國際骨幹」更貼近實況。K=2.5 讓最大 city-pair 月均落在 ~200 Gbps,
    # 單一 pair 不會逼近鏈路容量(S=300 / L+L=900),需多條需求疊加才會 overflow。
    return K * wa * wb / (1 + d / 3000)

routers = ORDER

def build_matrix(weight_fn, emit_threshold, symmetric):
    m = {a: {} for a in routers}
    for a in routers:
        for b in routers:
            if a == b:
                continue
            val = weight_fn(a, b)
            if val >= emit_threshold:
                m[a][b] = val
    return {a: row for a, row in m.items() if row}

# avg profile
def avg_fn(a, b):
    return round(base_demand(a, b))
avg_m = build_matrix(avg_fn, 6, True)

# max profile (asymmetric)
max_m = {a: {} for a in routers}
for a in routers:
    for b in routers:
        if a == b: continue
        v = round(1.5 * base_demand(a, b))
        if v >= 8:
            max_m[a][b] = v
max_m = {a: row for a, row in max_m.items() if row}

# busy profiles
def busy_matrix(busy_macro):
    m = {a: {} for a in routers}
    for a in routers:
        for b in routers:
            if a == b: continue
            mult = 1.5 if (macro(a) == busy_macro or macro(b) == busy_macro) else 0.6
            v = round(mult * base_demand(a, b))
            if v >= 5:
                m[a][b] = v
    return {a: row for a, row in m.items() if row}

asia_m = busy_matrix('asia')
amer_m = busy_matrix('amer')
eu_m = busy_matrix('euro')

def matrix_js(m, indent='        '):
    out = []
    for a in routers:
        if a not in m: continue
        row = m[a]
        inner = ', '.join(f'{b}: {row[b]}' for b in routers if b in row)
        out.append(f'{indent}{a}: {{ {inner} }},')
    return '\n'.join(out)

dem = []
dem.append('// Demand matrix — Gbps offered between every router pair.')
dem.append('// v4: 45-node / 10-country 重力模型(吃真實大圈距離) + 月均/最壞 + 區域忙時快照。')
dem.append('// Replace with NetFlow/sFlow-derived TM when available.')
dem.append('const demand = {')
dem.append("  unit: 'Gbps',")
dem.append("  source: 'synthetic-v4',")
dem.append("  timestamp: '2026-06-04',")
dem.append('')
dem.append("  // Active profile key — UI will switch this; engine reads demand.matrix")
dem.append("  active: 'avg',")
dem.append('')
dem.append('  profiles: {')
dem.append('    avg: {')
dem.append("      label: '月均',")
dem.append('      symmetric: true,')
dem.append('      default: 5,')
dem.append('      matrix: {')
dem.append(matrix_js(avg_m))
dem.append('      },')
dem.append('    },')
dem.append('    max: {')
dem.append("      label: '最壞情境(交集95th)',")
dem.append('      symmetric: false,')
dem.append('      default: 8,')
dem.append('      matrix: {')
dem.append(matrix_js(max_m))
dem.append('      },')
dem.append('    },')
dem.append('')
dem.append('    // ─────────────────────────────────────────────────────────────────────')
dem.append('    // 區域忙時快照 (regional busy-hour snapshots)')
dem.append('    //')
dem.append('    // 動機:max profile 假設「全球同時 95th」,過度悲觀 — 各時區的尖峰並不重疊。')
dem.append('    // 以下三個快照各讓「單一區域」進入忙時(≈1.5×月均),')
dem.append('    // 其餘區域維持離峰(≈0.6×月均)。手動切換可觀察「此刻誰在尖峰」對各鏈路的影響。')
dem.append('    //')
dem.append('    // 區域定義:Asia = 東亞/東南亞/大洋洲/南亞 · Americas = 美洲 · Europe = 歐洲')
dem.append('    // 規則:某 pair 只要有一端落在忙時區域 → busy(1.5×);兩端皆在其他區域 → 離峰(0.6×)。')
dem.append('    // 數值為合成估計,可依實際 NetFlow/sFlow 量測微調。')
dem.append('    // ─────────────────────────────────────────────────────────────────────')
dem.append('    asia_busy: {')
dem.append("      label: 'TPE 忙時 (UTC+8)',")
dem.append('      symmetric: true,')
dem.append('      default: 5,')
dem.append('      matrix: {')
dem.append(matrix_js(asia_m))
dem.append('      },')
dem.append('    },')
dem.append('    amer_busy: {')
dem.append("      label: 'LAX 忙時 (UTC-8)',")
dem.append('      symmetric: true,')
dem.append('      default: 5,')
dem.append('      matrix: {')
dem.append(matrix_js(amer_m))
dem.append('      },')
dem.append('    },')
dem.append('    eu_busy: {')
dem.append("      label: 'FRA 忙時 (UTC+1)',")
dem.append('      symmetric: true,')
dem.append('      default: 5,')
dem.append('      matrix: {')
dem.append(matrix_js(eu_m))
dem.append('      },')
dem.append('    },')
dem.append('  },')
dem.append('')
dem.append('  // Backward compatibility — engine reads demand.matrix / demand.default')
dem.append('  get matrix()  { return this.profiles[this.active].matrix; },')
dem.append('  get default() { return this.profiles[this.active].default; },')
dem.append('};')
dem.append('')
dem.append("if (typeof module !== 'undefined') module.exports = { demand };")
dem.append('')
with open(os.path.join(OUT, 'demand.js'), 'w') as f:
    f.write('\n'.join(dem))

# ── srlg.js ──
edge_ids = {e['id'] for e in edges}
node_ids = set(ORDER)

def valid(affects):
    return [m for m in affects if m in edge_ids or m in node_ids]

SRLG = [
    ('apcn2', 'APCN-2 海纜', 'submarine', ['e_TPE_TYO', 'e_TYO_SHA']),
    ('apg', 'APG 海纜', 'submarine', ['e_TPE_HKG', 'e_HKG_SIN']),
    ('transpac_north', 'Trans-Pacific North 海纜', 'submarine', ['e_TYO_LAX', 'e_TYO_SEA']),
    ('transpac_tpe', 'Trans-Pacific TPE 海纜', 'submarine', ['e_TPE_LAX', 'e_OSA_SJC']),
    ('smw_eurasia', 'SMW 歐亞海纜', 'submarine', ['e_SIN_BOM', 'e_BOM_LHR']),
    ('transatlantic_n', 'Trans-Atlantic North 海纜', 'submarine', ['e_JFK_LHR', 'e_JFK_FRA']),
    ('transatlantic_s', 'Trans-Atlantic South 海纜', 'submarine', ['e_LAX_LHR']),
    ('eu_fabric', 'EU IX Fabric', 'conduit', ['e_LHR_PN_EU', 'e_FRA_PN_EU', 'e_FRA2_PN_EU']),
    ('as_fabric', 'Asia IX Fabric', 'conduit', ['e_HKG_PN_AS', 'e_SIN_PN_AS', 'e_TPE_PN_AS']),
    ('us_fabric', 'US IX Fabric', 'conduit', ['e_LAX_PN_US', 'e_SJC_PN_US', 'e_SEA_PN_US']),
    ('tpe_site', 'TPE 機房', 'site', ['TPE']),
    ('lax_site', 'LAX 機房', 'site', ['LAX']),
    ('fra_site', 'FRA 機房', 'site', ['FRA']),
    ('sin_site', 'SIN 機房', 'site', ['SIN']),
    ('jfk_site', 'JFK 機房', 'site', ['JFK']),
    ('telia_transit', 'Telia Transit', 'upstream', ['e_LAX_LHR']),
    ('ntt_transit', 'NTT Transit', 'upstream', ['e_TYO_LAX']),
    ('tata_transit', 'Tata Transit', 'upstream', ['e_SIN_BOM']),
]

sl = []
sl.append('// SRLG (Shared Risk Link Group) definitions.')
sl.append('// Each group lists the edges and/or nodes that share a common failure risk.')
sl.append('// The "affects" array may contain edge IDs (e_xxx) and node IDs (TPE, LAX, …).')
sl.append('// expandSRLG() in the UI resolves which are edges vs nodes at runtime.')
sl.append('const srlg = [')
cur_type = None
type_comment = {'submarine': '  // submarine — 海纜系統共用風險',
                'conduit': '  // conduit — 共管線路 / IX fabric',
                'site': '  // site — 機房 / 落地站 / 電力',
                'upstream': '  // upstream — 上游 ISP 依賴'}
for sid, label, typ, affects in SRLG:
    va = valid(affects)
    if not va:
        continue
    if typ != cur_type:
        sl.append('')
        sl.append(type_comment[typ])
        cur_type = typ
    aff = ', '.join(f"'{x}'" for x in va)
    sl.append(f"  {{ id: '{sid}', label: '{label}', type: '{typ}', affects: [{aff}] }},")
sl.append('];')
sl.append('')
with open(os.path.join(OUT, 'srlg.js'), 'w') as f:
    f.write('\n'.join(sl))

# ── 國家統計 ──
countries = {}
for nid in ORDER:
    countries.setdefault(NODES[nid][0], []).append(nid)

print(f'OK routers={len(ORDER)} countries={len(countries)} edges={len(edges)} '
      f'(p2p={sum(1 for e in edges if e["type"]=="p2p")} '
      f'transit={sum(1 for e in edges if e["type"]=="transit")}) '
      f'pseudo={len(PSEUDO)}')
print('  ' + ' '.join(f'{c}:{len(ns)}' for c, ns in countries.items()))
print(f'avg rows={len(avg_m)} max rows={len(max_m)} '
      f'asia={len(asia_m)} amer={len(amer_m)} eu={len(eu_m)}')
print(f'srlg groups={sum(1 for s in SRLG if valid(s[3]))}')
