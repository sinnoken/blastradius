// Phase 3: generate demand/srlg/rtt companions for an EXTERNALLY-PROVIDED topology
// (e.g. the OSPF-imported one) so the full BlastRadius audit can run for validation.
// Standalone tool — imports only the PURE engine.js (gen.mjs is NOT importable: it
// executes + writes on load and is coupled to its own CITY/GEO node model).
//
// PROVENANCE (honest): OSPF LSDB carries none of these. All synthetic/heuristic:
//   demand = geo gravity (degree mass × great-circle distance)  — NOT real traffic
//   srlg   = parallel-link grouping heuristic                   — NOT real shared-risk inventory
//   rtt    = geo model (city great-circle × fiber constant)     — model estimate, NOT measured
// Usage: node companions.mjs [path-to-topology.js]   (default output/topology.imported.js)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildAdjacency, dijkstraDist, allPairsTraffic, computeN1WorstCase, evalCongestion } from '../output/engine.js';
import { GRAVITY_D0, GRAVITY_K, GRAVITY_EMIT, gravityMass,
         EARTH_RADIUS_KM, FIBER_RTT_PER_KM,
         DEMAND_BUSY_MULT, DEMAND_DOWN_SKEW, DEMAND_UP_SKEW, DEMAND_OFF_MULT,
         DEMAND_TARGET_MLU, CITY_GEO as GRAVITY_CITY_GEO, haversineKmCity } from '../output/gravity.js';

const topoPath = process.argv[2] || '../output/topology.imported.js';
const src = readFileSync(new URL(topoPath, import.meta.url), 'utf8');
const topology = Function('"use strict";' + src + ';return topology;')();
const routers = topology.nodes.filter(n => n.type === 'router').map(n => n.id);
const adj = buildAdjacency(topology.edges);

// CITY_GEO 和 haversine 已移至 output/gravity.js(SSOT)
const CITY_GEO = GRAVITY_CITY_GEO;
const cityOf={}; topology.nodes.forEach(n=>{ if(n.city) cityOf[n.id]=n.city; });
const kmBetween=(a,b)=>{ const ca=cityOf[a],cb=cityOf[b];
  return (ca&&cb&&CITY_GEO[ca]&&CITY_GEO[cb]) ? haversineKmCity(CITY_GEO[ca],CITY_GEO[cb]) : null; };

// ── demand: geo 重力 + 自動校準 ───────────────────────────────────────────
// mass = stubs 數量 + capacity 加總(對齊 gen.mjs / gravity.mjs SSOT)。
// 衰減 = 城市大圈距離(cityless 用中性 GRAVITY_D0)。
// MLU 與 demand 成線性 → 量一次原始 MLU,再線性縮放到 TARGET_MLU(一發到位、確定性)。
// 5 profiles:avg / max / asia_busy / amer_busy / eu_busy。浮點 Gbps(round3)。
const EMIT = GRAVITY_EMIT, DFLT = 0, TARGET_MLU = DEMAND_TARGET_MLU;
// 預先建 node→stubs 對照(topology.nodes 有 stubs 欄位)
const nodeStubsMap = {};
for (const n of topology.nodes) nodeStubsMap[n.id] = n.stubs || [];
const mass = n => gravityMass(n, topology.edges, nodeStubsMap[n] || []);
const distFrom = {}; for (const a of routers) distFrom[a] = dijkstraDist(adj, a);
const rawFn = (a, b) => {
  if (distFrom[a][b] == null || !isFinite(distFrom[a][b])) return 0;   // 不可達 → 無需求
  const km = kmBetween(a, b); const dist = km != null ? km : GRAVITY_D0;
  return GRAVITY_K * mass(a) * mass(b) / (1 + dist / GRAVITY_D0);
};
function buildRaw() {
  const m = {};
  for (const a of routers) { const row = {};
    for (const b of routers) { if (a === b) continue; const w = rawFn(a, b); if (w > 0) row[b] = w; }
    if (Object.keys(row).length) m[a] = row; }
  return m;
}
const raw_m = buildRaw();
const rawMLU = evalCongestion(topology, { matrix: raw_m, default: 0 }).mlu;
const SCALE = rawMLU > 0 ? TARGET_MLU / rawMLU : 1;     // 線性初估
const round3 = x => Math.round(x * 1000) / 1000;       // 3 位小數(~Mbps 粒度),減少 rounding 丟失
const scaleMatrix = (m, f) => { const o = {};
  for (const a in m) { const row = {};
    for (const b in m[a]) { const v = round3(m[a][b] * f); if (v >= EMIT) row[b] = v; }
    if (Object.keys(row).length) o[a] = row; }
  return o;
};
// 一次校正:rounding/EMIT 會讓實際 MLU 略偏離線性預測,量一次再修正係數 → 落在目標附近。
const SCALE2 = (() => { const m1 = evalCongestion(topology, { matrix: scaleMatrix(raw_m, SCALE), default: 0 }).mlu;
  return m1 > 0 ? SCALE * TARGET_MLU / m1 : SCALE; })();
const avg_m = scaleMatrix(raw_m, SCALE2);

// ── 區域忙時(對齊 gen.mjs 的 busyFn):city code → macro region ──────────────
// APAC / Americas / Europe(預設)。與 gen.mjs 的 ASIA/AMER set 對應。
const CITY_MACRO = {
  // APAC
  TPE:'asia',TXG:'asia',KHH:'asia',HSZ:'asia',HKG:'asia',SIN:'asia',
  TYO:'asia',OSA:'asia',SEL:'asia',BKK:'asia',MNL:'asia',SYD:'asia',MEL:'asia',
  HAN:'asia',PNH:'asia',SHA:'asia',SZX:'asia',PEK:'asia',BJS:'asia',
  BOM:'asia',DEL:'asia',MAA:'asia',BLR:'asia',JKT:'asia',KUL:'asia',SGN:'asia',
  // Americas
  LAX:'amer',NYC:'amer',CHI:'amer',YVR:'amer',YYZ:'amer',PAO:'amer',
  SEA:'amer',JFK:'amer',IAD:'amer',ORD:'amer',DAL:'amer',ATL:'amer',SJC:'amer',
  // Europe = default(else)
};
const BUSY_MULT = DEMAND_BUSY_MULT, DOWN_SKEW = DEMAND_DOWN_SKEW, UP_SKEW = DEMAND_UP_SKEW, OFF_MULT = DEMAND_OFF_MULT;
const macroOf = n => CITY_MACRO[cityOf[n]] || 'euro';

function buildBusy(busyMacro) {
  const m = {};
  for (const a of routers) { const row = {};
    for (const b of routers) { if (a === b) continue;
      const aIn = macroOf(a) === busyMacro, bIn = macroOf(b) === busyMacro;
      const mult = (aIn && bIn) ? BUSY_MULT
                 : (aIn || bIn) ? BUSY_MULT * (bIn ? DOWN_SKEW : UP_SKEW)
                 : OFF_MULT;
      const v = round3(rawFn(a, b) * SCALE2 * mult);
      if (v >= EMIT) row[b] = v;
    }
    if (Object.keys(row).length) m[a] = row; }
  return m;
}
const asia_m = buildBusy('asia');
const amer_m = buildBusy('amer');
const eu_m   = buildBusy('euro');
const busy_m = scaleMatrix(raw_m, SCALE2 * 3);   // 全球同時(demo worst-case,3×avg)

// ── srlg: parallel-link heuristic (same router pair, ≥2 edges = shared conduit candidate) ──
const pairEdges = {};
for (const e of topology.edges) {
  if (e.type !== 'p2p') continue;
  const k = [e.source, e.target].sort().join('|');
  (pairEdges[k] ??= []).push(e.id);
}
const srlg = [];
let pn = 1;
for (const [k, ids] of Object.entries(pairEdges)) {
  if (ids.length >= 2) srlg.push({ id: 'par_' + (pn++), label: `平行鏈路 ${k.replace('|', '↔')}`, type: 'conduit', affects: ids });
}

// ── rtt:RTT 來源對齊 gen.mjs ── 優先序 measured > city-ref > geo 模型。
// 兩個 CSV 皆以「城市碼」為鍵(measured: a,b / city-ref: city_a,city_b),與匯入節點的 city 直接對上。
const FIBER = FIBER_RTT_PER_KM;
function parseCsv(p){ if(!existsSync(p)) return [];
  const t=readFileSync(p,'utf8').split(/\r?\n/).filter(l=>l.length);
  const h=t[0].split(',').map(s=>s.trim());
  return t.slice(1).map(l=>{ const c=l.split(','),o={}; h.forEach((k,i)=>o[k]=(c[i]??'').trim()); return o; }); }
function cityPairMap(rows, ka, kb){ const m=new Map();
  for(const r of rows){ const a=r[ka],b=r[kb],v=parseFloat(r.rtt_ms);
    if(a&&b&&!isNaN(v)){ m.set(a+'|'+b,v); m.set(b+'|'+a,v); } } return m; }
const MEAS = cityPairMap(parseCsv(new URL('./node_rtt.csv', import.meta.url)), 'a', 'b');
const CREF = cityPairMap(parseCsv(new URL('./city_rtt.csv', import.meta.url)), 'city_a', 'city_b');
const geoMs = (ca,cb) => (CITY_GEO[ca]&&CITY_GEO[cb]) ? Math.round(haversineKmCity(CITY_GEO[ca],CITY_GEO[cb])*FIBER*100)/100 : null;
function cityRtt(ca,cb){   // 回 {ms,src};measured > city-ref > geo
  if(ca===cb) return { ms:0, src:'measured' };
  if(MEAS.has(ca+'|'+cb)) return { ms:MEAS.get(ca+'|'+cb), src:'measured' };
  if(CREF.has(ca+'|'+cb)) return { ms:CREF.get(ca+'|'+cb), src:'city-ref' };
  return { ms:geoMs(ca,cb), src:'model' };
}
const citiesPresent = [...new Set(topology.nodes.map(n=>n.city).filter(Boolean))].sort();
const rttMatrix = {};
for (const ca of citiesPresent){ const row={};
  for (const cb of citiesPresent){ if(ca===cb) continue; const {ms}=cityRtt(ca,cb); if(ms!=null) row[cb]=ms; }
  if(Object.keys(row).length) rttMatrix[ca]=row;
}
// rtt.edges:每條 p2p 邊(node 對)帶 rtt + src,供 C2/C10 讀(對齊 gen.mjs 的 rtt.edges 結構)
const rttEdges=[], rttSrc={ measured:0, 'city-ref':0, model:0 };
for(const e of topology.edges){ if(e.type!=='p2p') continue;
  const { ms, src }=cityRtt(cityOf[e.source], cityOf[e.target]);
  if(ms!=null){ rttEdges.push({ a:e.source, b:e.target, rtt:ms, src }); rttSrc[src]++; } }
const rtt = { unit:'ms', source:'measured>city-ref>geo (對齊 gen.mjs)',
  note:'城市對 RTT 優先序:node_rtt.csv > city_rtt.csv > geo 模型(大圈×光纖常數);model 為估計、非實測。',
  fiberRttPerKm:FIBER, matrix:rttMatrix, edges:rttEdges };

// ── serialize (aligned with gen.mjs format) ─────────────────────────────────
// key 一律加引號:節點 id 可能是「數字+底線」(未對應 RID 的 fallback,如 203_160_227_116),
// 未引號會被 JS 當數字分隔符吃掉底線 → key 對不上拓樸。JSON.stringify 確保安全。
const matrixJs = m => routers.filter(a => a in m)
  .map(a => `        ${JSON.stringify(a)}: { ` + routers.filter(b => b in m[a]).map(b => `${JSON.stringify(b)}: ${m[a][b]}`).join(', ') + ' },').join('\n');
const demandText = `// Companion demand for IMPORTED topology — SYNTHETIC geo gravity (degree mass × great-circle distance).
// NOT real traffic. Replace with NetFlow/sFlow when available.
const demand = {
  unit: 'Gbps',
  source: 'synthetic-geo-gravity-from-ospf',
  timestamp: '${new Date().toISOString().slice(0,10)}',
  active: 'avg',
  profiles: {
    avg:  { label: 'Degree-gravity avg',      symmetric: true,  default: ${DFLT}, matrix: {
${matrixJs(avg_m)}
    } },
    max:  { label: 'Busy (3×avg, worst)',     symmetric: false, default: ${DFLT}, matrix: {
${matrixJs(busy_m)}
    } },
    asia_busy: { label: 'APAC busy hour',     symmetric: false, default: ${DFLT}, matrix: {
${matrixJs(asia_m)}
    } },
    amer_busy: { label: 'Americas busy hour', symmetric: false, default: ${DFLT}, matrix: {
${matrixJs(amer_m)}
    } },
    eu_busy:   { label: 'Europe busy hour',   symmetric: false, default: ${DFLT}, matrix: {
${matrixJs(eu_m)}
    } },
  },
  get matrix()  { return this.profiles[this.active].matrix; },
  get default() { return this.profiles[this.active].default; },
};
if (typeof module !== 'undefined') module.exports = { demand };
`;
const srlgText = `// Companion SRLG for IMPORTED topology — HEURISTIC (parallel links = shared-conduit candidates).
// NOT real shared-risk inventory. Confirm against optical/conduit records.
const srlg = [
${srlg.map(g => `  { id: '${g.id}', label: '${g.label}', type: '${g.type}', affects: [${g.affects.map(x => `'${x}'`).join(', ')}] },`).join('\n')}
];
`;
const rttText = `// Companion RTT for IMPORTED topology — GEO MODEL estimate (great-circle × fiber constant).
// 模型估計(非實測):city centroid 大圈距離 × ${FIBER} ms/km(round-trip)。實測值請覆蓋。
const rtt = ${JSON.stringify(rtt, null, 2)};
if (typeof module !== 'undefined') module.exports = { rtt };
`;
writeFileSync(new URL('../output/demand.imported.js', import.meta.url), demandText);
writeFileSync(new URL('../output/srlg.imported.js', import.meta.url), srlgText);
writeFileSync(new URL('../output/rtt.imported.js', import.meta.url), rttText);

// ── VALIDATION: run the full audit on (imported topology + synthetic demand) ─
const demand = { matrix: avg_m, default: DFLT };
const cong = evalCongestion(topology, demand);
const tr = allPairsTraffic(topology, demand);
const n1 = computeN1WorstCase(topology);

console.log('WROTE output/{demand,srlg,rtt}.imported.js');
const busyMLU = evalCongestion(topology, { matrix: busy_m, default: 0 }).mlu;
console.log('\n=== demand (synthetic, 自動校準) ===');
console.log(`原始 MLU ${rawMLU.toFixed(1)} → 校準係數 ×${SCALE2.toExponential(2)} → 目標 avg MLU ${TARGET_MLU}`);
console.log('pairs with demand:', Object.values(avg_m).reduce((s, r) => s + Object.keys(r).length, 0),
  ' total offered Gbps:', tr.totalDemand.toFixed(1));
console.log('=== rtt (measured>city-ref>geo,對齊 gen.mjs) ===');
console.log('cities:', citiesPresent.length, ' edge RTT 來源:', JSON.stringify(rttSrc),
  ' 樣本 TPE→TYO:', rttMatrix.TPE?.TYO, 'ms(measured) · TPE→LON:', rttMatrix.TPE?.LON, 'ms');
console.log('=== srlg (heuristic) ===');
console.log('parallel-link groups:', srlg.length);
console.log('\n=== AUDIT RUNS END-TO-END (engine.js) ===');
console.log(`MLU @ cap=${topology.edges[0]?.capacity}G — avg: ${cong.mlu.toFixed(3)} (feasible:${cong.mlu<1}) · max(3×): ${busyMLU.toFixed(3)} (feasible:${busyMLU<1})`);
console.log('served / lost demand (Gbps):', tr.servedDemand, '/', tr.lostDemand,
  ' reachable pairs:', tr.reachablePairs + '/' + tr.totalPairs);
console.log('N-1 worst-case: pair rows', n1.pairRows.length, ' failure scenarios w/ impact', n1.failureRows.length);
const worst = n1.failureRows[0];
if (worst) console.log('  worst single failure:', worst.kind, worst.id || '', '→ unreachable', worst.unreachable, 'degraded', worst.degraded);
