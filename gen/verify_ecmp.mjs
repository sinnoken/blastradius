import { readFileSync } from 'fs';
import vm from 'vm';

const engine = await import('file:///mnt/workspace/output/engine.js');

// topology.js is a global `const topology` (no exports) — load via vm, take completion value
const ctx = vm.createContext({});
const topoSrc = readFileSync('/mnt/workspace/output/topology.js', 'utf8');
const topology = vm.runInContext(topoSrc + '\ntopology;', ctx);

// 1) Run against the real built-in topology
const results = engine.ecmpBackupScanAll(topology);
const byStatus = {};
const reasonCodes = new Set();
for (const r of results) {
  byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  if (r.reason) reasonCodes.add(r.reason);
}
console.log('[real topo] status counts:', byStatus);
console.log('[real topo] distinct reason codes:', [...reasonCodes]);
const sampleFailed = results.find(r => r.status === 'failed');
const sampleNa = results.find(r => r.status === 'n/a');
console.log('[real topo] sample n/a   :', JSON.stringify(sampleNa));
console.log('[real topo] sample failed:', JSON.stringify(sampleFailed));

// 2) Synthetic topo to FORCE both failed branches, exercising eid/bid params
//    A-B two equal paths but removing one leaves the other (passed) — need a case
//    where removing an ECMP first-hop forces a non-ECMP backup or unreachable.
const synth = {
  nodes: [
    { id:'A', type:'router', area:'0', stubs:[] },
    { id:'B', type:'router', area:'0', stubs:[] },
    { id:'M', type:'router', area:'0', stubs:[] },
  ],
  edges: [
    // A->B two equal-cost first hops: direct, and via M — ECMP×2
    { id:'eAB1', source:'A', target:'B', cost:10, type:'p2p' },
    { id:'eAM',  source:'A', target:'M', cost:5,  type:'p2p' },
    { id:'eMB',  source:'M', target:'B', cost:5,  type:'p2p' },
  ],
  externals: [], positions:{},
};
const synthRes = engine.ecmpBackupCheck(synth, 'A', 'B');
console.log('[synth] A→B:', JSON.stringify(synthRes));

// unreachable case: remove-unreachable — single bridge after one ECMP hop gone
const synth2 = {
  nodes: [
    { id:'A', type:'router', area:'0', stubs:[] },
    { id:'B', type:'router', area:'0', stubs:[] },
  ],
  edges: [
    { id:'p1', source:'A', target:'B', cost:10, type:'p2p' },
    { id:'p2', source:'A', target:'B', cost:10, type:'p2p' },
  ],
  externals: [], positions:{},
};
console.log('[synth2] parallel A→B:', JSON.stringify(engine.ecmpBackupCheck(synth2, 'A', 'B')));
