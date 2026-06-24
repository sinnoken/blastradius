#!/usr/bin/env node
// ============================================================================
// verify.mjs — 方向 (B):以 engine.js 為「唯一」SPT/ECMP/流量演算法來源的驗證
// ----------------------------------------------------------------------------
// 取代 verify.py(它在 Python 重寫了一份 dijkstra/ECMP/流量,且用正則去 parse
// gen.py 的 js_obj 輸出 — 兩種重工)。本檔直接 import 前端正式跑的 engine.js,
// 對每個 demand profile 重算「每條真實 p2p 邊的負載 / 容量」並列出超載表,
// 作為與 UI 完全同源的獨立檢查。
// 註:電路全雙工、容量單向計,故 allPairsTraffic 回傳的 traffic[e] 是「較忙方向的峰值」
//     (max(去,回),非雙向加總);util = 峰值 / 單向容量,與 UI 邊流量同口徑。
//
// 載入策略(配合各資料檔的實際形狀):
//   topology.js / srlg.js → 只有 global const,無 module.exports → 讀文字後 vm eval 取 global
//   demand.js   / rtt.js  → 檔尾有 module.exports → 直接 import 取值
//   engine.js             → 純 ES module → import { allPairsTraffic }
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { allPairsTraffic } from '../output/engine.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', 'output');

// ── 只有 global const 的檔:在沙箱跑文字、把宣告的變數撈出來 ──
function loadGlobal(file, name) {
  const src = readFileSync(join(OUT, file), 'utf8');
  const ctx = { module: {}, exports: {} };
  vm.createContext(ctx);
  // 末行把目標變數掛回 context,讓沙箱外能取到
  vm.runInContext(src + `\n;globalThis.__out = ${name};`, ctx);
  return ctx.__out;
}

// ── 有 module.exports 的檔:用 CJS require 取值 ──
const require = (await import('node:module')).createRequire(import.meta.url);
const { demand } = require(join(OUT, 'demand.js'));

const topology = loadGlobal('topology.js', 'topology');

const PROFILES = ['avg', 'max', 'asia_busy', 'amer_busy', 'eu_busy'];

function run() {
  const routers = topology.nodes.filter(n => n.type === 'router').length;
  console.log(`topology: routers=${routers} edges=${topology.edges.length}`);

  const caps  = new Map(topology.edges.map(e => [e.id, e.capacity ?? 1]));
  const etype = new Map(topology.edges.map(e => [e.id, e.type]));
  const isReal = eid => etype.get(eid) === 'p2p';

  for (const pk of PROFILES) {
    const prof = demand.profiles[pk];
    if (!prof) { console.log(`  [${pk}] MISSING`); continue; }

    // 用 engine.js 的正式演算法跑這個 profile(同 UI 路徑)
    const profDemand = { matrix: prof.matrix, default: prof.default };
    const { traffic } = allPairsTraffic(topology, profDemand);

    const rows = [];
    for (const [eid, load] of Object.entries(traffic)) {
      if (!isReal(eid)) continue;
      const cap = caps.get(eid) ?? 1;
      rows.push({ util: load / cap, eid, load, cap });
    }
    rows.sort((a, b) => b.util - a.util);

    const over  = rows.filter(r => r.util > 1.0);
    const worst = rows[0] ?? { util: 0, eid: '-', load: 0, cap: 1 };
    const nrows = Object.keys(prof.matrix).length;

    console.log(`\n=== ${pk} (default=${prof.default}, rows=${nrows}) ===`);
    console.log(`  REAL overloaded edges (>100% cap): ${over.length} / ${rows.length}` +
      `  worst=${(worst.util * 100).toFixed(0)}% (${worst.eid})`);
    for (const r of rows.slice(0, 15)) {
      const flag = r.util > 1.0 ? '  <<OVER' : '';
      console.log(`    ${r.eid.padEnd(18)} ${r.load.toFixed(1).padStart(7)}/${String(r.cap).padStart(4)}` +
        `  ${(r.util * 100).toFixed(1).padStart(5)}%${flag}`);
    }
  }
  console.log('\n(real p2p edges only; transit/pseudonode excluded — via engine.js allPairsTraffic)');
}

run();
