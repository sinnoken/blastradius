// Node wrapper around the SHARED OSPF importer (output/ospf-import.js) — same parse
// core as edit.html's web import. This file only does I/O: read dump + rid_hostname.csv,
// call parseOspfLsdb(), serialize topology.imported.js, validate connectivity via engine.js.
// Model B + short ids (city3+index) + city/country all come from the shared module.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildAdjacency, connectedComponents } from '../output/engine.js';
import { parseOspfLsdb, OSPF_PLACEHOLDER_CAP } from '../output/ospf-import.js';

const dumpText = readFileSync(new URL('../input/Cisco OSPF.txt', import.meta.url), 'utf8');
const RIDMAP_CSV = new URL('./rid_hostname.csv', import.meta.url);
const ridMapText = existsSync(RIDMAP_CSV) ? readFileSync(RIDMAP_CSV, 'utf8') : '';

const { nodes, edges, pnNodes, stats } = parseOspfLsdb(dumpText, ridMapText);

// ── serialize in topology.js shape ──────────────────────────────────────────
const j = v => JSON.stringify(v);
const nodeLine = n => `    { id:${j(n.id)}, label:${j(n.label)}, rid:${j(n.rid)}, country:${j(n.country)}, city:${j(n.city)}, type:"router", area:"0", stubs:${j(n.stubs)}, isASBR:${n.isASBR}, isABR:${n.isABR} }`;
const pnLine   = p => `    { id:${j(p.id)}, label:${j(p.id + '\\n' + p.subnet)}, type:"pseudonode", subnet:${j(p.subnet)} }`;
const edgeLine = e => `    { id:${j(e.id)}, source:${j(e.source)}, target:${j(e.target)}, cost:${e.cost}, costRev:${e.costRev ?? e.cost}, capacity:${e.capacity}, type:${j(e.type)}${e.net ? `, net:${j(e.net)}` : ''} }`;
const nodeRecs = [...nodes.map(nodeLine), ...pnNodes.map(pnLine)];
const allNodes = [...nodes, ...pnNodes];
const POSCOLS = Math.max(1, Math.ceil(Math.sqrt(allNodes.length)));
const posLines = allNodes.map((n, i) => `    ${j(n.id)}: { x:${120 + (i % POSCOLS) * 150}, y:${100 + Math.floor(i / POSCOLS) * 120} }`).join(',\n');

const out = `// IMPORTED from Cisco OSPF LSDB (show ip ospf database router/network), Area 0, Model B (transit /30 collapsed to p2p).
// NOT the demo dataset. capacity=${OSPF_PLACEHOLDER_CAP} is a PLACEHOLDER — OSPF carries no bandwidth; fill via edit.html curation.
// id = 城市3碼+序號(由 working/rid_hostname.csv 對應 hostname→城市);label = hostname;city/country 自動帶出。
// positions = deterministic grid start (import runs NO layout) — refine via layout menu (Equal Earth) anytime.
const topology = {
  nodes: [
${nodeRecs.join(',\n')}
  ],
  edges: [
${edges.map(edgeLine).join(',\n')}
  ],
  externals: [],
  positions: {
${posLines}
  },
};
`;
writeFileSync(new URL('../output/topology.imported.js', import.meta.url), out);

// ── validate connectivity via engine.js ─────────────────────────────────────
const adj = buildAdjacency(edges);
const routerIds = nodes.map(n => n.id);
const comps = connectedComponents(adj, routerIds);
comps.sort((a, b) => b.length - a.length);
const degs = routerIds.map(id => (adj[id] || []).length);

console.log('WROTE output/topology.imported.js (via shared output/ospf-import.js)');
console.log('routers:', stats.routers, ' edges:', stats.edges, ' pseudonodes:', stats.pseudonodes,
  ' city-mapped:', stats.cityMapped + '/' + stats.routers);
console.log('collapsed /30→p2p:', stats.collapsed, ' true p2p:', stats.trueP2P, ' ASBR:', stats.asbr);
console.log('connected components:', comps.length, ' sizes:', comps.map(c => c.length).slice(0, 5));
console.log('degree min/median/max:', Math.min(...degs), degs.slice().sort((a, b) => a - b)[degs.length >> 1], Math.max(...degs));
// 對應落差回報(同 edit.html 橫幅內容)
if (stats.unmappedRids.length)
  console.log(`\n⚠ ${stats.unmappedRids.length} 個 RID 無對應 hostname(用 RID 當 id、無城市):`, stats.unmappedRids.join(', '));
if (stats.unusedMapEntries.length)
  console.log(`⚠ ${stats.unusedMapEntries.length} 筆對應表未用到(RID 不在此 LSDB):`,
    stats.unusedMapEntries.map(e => `${e.hostname}=${e.rid}`).join(', '));
