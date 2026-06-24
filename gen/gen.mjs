#!/usr/bin/env node
// Deterministic generator for BlastRadius POC — multi-region synthetic backbone (size varies with --nodes).
// BlastRadius POC 確定性資料產生器(Node ES module)。Emits topology.js, demand.js, srlg.js, rtt.js to output/.
// 設計目標:確定性輸出 — 同輸入永遠 byte-identical(同一容器內 libm 一致 → 浮點 bit 對齊)。
//
// 數字格式對齊重點:
//   - 整數值(demand/cost/capacity/座標)→ String(n),無 .0 後綴。
//   - rtt.js 的浮點 → 模擬 Python str(round(x,n)):toFixed(n) 去尾零;整數值補回 ".0"。
//   - round 對 IEEE double 取捨;本資料集無 .xx5 精確平手 → toFixed(half-up)==Python(half-even)。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { GRAVITY_D0, GRAVITY_K, GRAVITY_EMIT, gravityMass,
         EARTH_RADIUS_KM, FIBER_RTT_PER_KM as GRAVITY_FIBER_RTT_PER_KM,
         DEMAND_BUSY_MULT, DEMAND_DOWN_SKEW, DEMAND_UP_SKEW, DEMAND_OFF_MULT,
         CITY_GEO as GRAVITY_CITY_GEO } from '../output/gravity.js';
import { impliedCostFromRtt, RTT_COST_CLAMP } from '../output/engine.js';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── CLI 參數(對應 argparse;不帶參數 → 重現原始 dataset)──
const { values: _a } = parseArgs({
  options: {
    out:        { type: 'string', default: '/mnt/workspace/output' },
    scale:      { type: 'string' },
    'max-mult': { type: 'string' },
    'busy-mult':{ type: 'string' },
    'off-mult': { type: 'string' },
    'down-skew':{ type: 'string' },
    'up-skew':  { type: 'string' },
    emit:       { type: 'string' },
    dflt:       { type: 'string' },
    k:          { type: 'string' },
    nodes:      { type: 'string' },
  },
});
const OUT      = _a.out;
// 流量校準(對齊 profile 名稱語意):avg=月均(最忙鏈路 MLU ~45%)、busy=4×月均(demo 誇大,真實約 1.5×)、off-peak=0.6×、
// max=交集95th≈3×(全區同時尖峰的罕見最壞;刻意讓最忙 ~3 條 >100%,給優化器「無解→鬆綁」+ 紅色熱圖 demo,
// 此時 max MLU ~138%)。SCALE 為估計值(MLU 對 SCALE 近似線性);重跑 gen 後量 MLU 表把 SCALE 微調到 avg 落在目標。
// SCALE 依拓樸規模重校:執行 gen.mjs 量 MLU 後計算 SCALE × (目標MLU / 當前MLU)
// 145-node: 7.63e-8 → avg ~45%
const SCALE    = _a.scale     !== undefined ? parseFloat(_a.scale)       : 7.63e-8;
const MAX_MULT = _a['max-mult']!== undefined ? parseFloat(_a['max-mult']) : 3;
const BUSY_MULT= _a['busy-mult']!==undefined ? parseFloat(_a['busy-mult']): DEMAND_BUSY_MULT;
const OFF_MULT = _a['off-mult']!== undefined ? parseFloat(_a['off-mult']) : DEMAND_OFF_MULT;
// 忙時方向性(download skew):流入忙時區(eyeball 下載)放大、流出縮小;下:上 ≈ 50:1(demo 誇大方向性,讓擁塞的主幹鏈路有方向差 → 驅動不對稱權重優化;真實約 2:1)。
const DOWN_SKEW= _a['down-skew']!==undefined ? parseFloat(_a['down-skew']): DEMAND_DOWN_SKEW;
const UP_SKEW  = _a['up-skew']  !==undefined ? parseFloat(_a['up-skew'])  : DEMAND_UP_SKEW;
const EMIT     = _a.emit      !== undefined ? parseFloat(_a.emit)        : GRAVITY_EMIT;
const DFLT     = _a.dflt      !== undefined ? parseFloat(_a.dflt)        : 1;
const K        = _a.k         !== undefined ? parseFloat(_a.k)           : GRAVITY_K;
const NODES_N  = _a.nodes     !== undefined ? parseInt(_a.nodes, 10)     : null;

// ── Python 風格 round / float 字串化 ──
// pyRoundInt: 取整,half-to-even(平手取偶);本資料集無平手 → 等同四捨五入。
function pyRoundInt(x) {
  const fl = Math.floor(x);
  const diff = x - fl;
  if (diff < 0.5) return fl;
  if (diff > 0.5) return fl + 1;
  return (fl % 2 === 0) ? fl : fl + 1;
}
// pyFloatStr: 模擬 Python str(round(x, nd))。toFixed 對 double 取捨(half-up),
// 去尾零;若結果為整數值,補回 ".0"(Python float 一律保留一位小數)。
function pyFloatStr(x, nd) {
  let s = x.toFixed(nd);
  if (s.indexOf('.') >= 0) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  if (s.indexOf('.') < 0) s += '.0';
  return s;
}

// ── PoP table: id -> { city, country, x, y, weight, lat, lon }
// 合併原 NODES / CITY / GEO 三張表為單一來源;city = IATA 都會碼;country = ISO-3166-1 alpha-2。
// 修正:TYN city 改 TPE(桃園屬台北都會);UK 改 GB(ISO 正式碼)。
const POPS = {
  // tier = 暫時保留 PoP 層級(未來改城市層級);capFor() 依此決定容量
  // ── 台灣 ─────────────────────────────────────────────
  TPE:  { city:'TPE', country:'TW', x:235,  y:250, weight:10, tier:'L', lat:25.0,   lon:121.5  },
  TPE2: { city:'TPE', country:'TW', x:258,  y:232, weight:6,  tier:'M', lat:25.1,   lon:121.6  },
  TYN:  { city:'TPE', country:'TW', x:218,  y:268, weight:4,  tier:'S', lat:25.0,   lon:121.2  },
  TCH:  { city:'TXG', country:'TW', x:210,  y:296, weight:4,  tier:'S', lat:24.1,   lon:120.7  },
  HSZ:  { city:'HSZ', country:'TW', x:228,  y:282, weight:3,  tier:'S', lat:24.8,   lon:121.0  },
  KHH:  { city:'KHH', country:'TW', x:205,  y:320, weight:6,  tier:'L', lat:22.6,   lon:120.3  },
  // ── 日本 ─────────────────────────────────────────────
  TYO:  { city:'TYO', country:'JP', x:385,  y:175, weight:10, tier:'L', lat:35.7,   lon:139.7  },
  TYO2: { city:'TYO', country:'JP', x:402,  y:158, weight:6,  tier:'M', lat:35.6,   lon:139.8  },
  OSA:  { city:'OSA', country:'JP', x:430,  y:250, weight:7,  tier:'L', lat:34.7,   lon:135.5  },
  NGO:  { city:'NGO', country:'JP', x:415,  y:214, weight:4,  tier:'M', lat:35.2,   lon:136.9  },
  FUK:  { city:'FUK', country:'JP', x:356,  y:244, weight:4,  tier:'S', lat:33.6,   lon:130.4  },
  OKA:  { city:'OKA', country:'JP', x:360,  y:310, weight:2,  tier:'S', lat:26.33,  lon:127.80 },
  SDJ:  { city:'SDJ', country:'JP', x:435,  y:142, weight:2,  tier:'S', lat:38.26,  lon:140.90 },
  HIJ:  { city:'HIJ', country:'JP', x:395,  y:262, weight:2,  tier:'S', lat:34.40,  lon:132.47 },
  // ── 韓國 ─────────────────────────────────────────────
  SEL:  { city:'SEL', country:'KR', x:390,  y:185, weight:8,  tier:'L', lat:37.57,  lon:126.98 },
  SEL2: { city:'SEL', country:'KR', x:408,  y:198, weight:5,  tier:'M', lat:37.50,  lon:127.10 },
  PUS:  { city:'PUS', country:'KR', x:420,  y:230, weight:3,  tier:'S', lat:35.18,  lon:129.07 },
  // ── 中國 ─────────────────────────────────────────────
  SHA:  { city:'SHA', country:'CN', x:330,  y:120, weight:8,  tier:'L', lat:31.2,   lon:121.5  },
  PEK:  { city:'BJS', country:'CN', x:305,  y: 60, weight:7,  tier:'M', lat:39.9,   lon:116.4  },
  CAN:  { city:'CAN', country:'CN', x:298,  y:162, weight:6,  tier:'M', lat:23.1,   lon:113.3  },
  SZX:  { city:'SZX', country:'CN', x:320,  y:150, weight:5,  tier:'M', lat:22.5,   lon:114.1  },
  CTU:  { city:'CTU', country:'CN', x:268,  y:108, weight:4,  tier:'S', lat:30.6,   lon:104.1  },
  WUH:  { city:'WUH', country:'CN', x:340,  y: 95, weight:4,  tier:'S', lat:30.6,   lon:114.3  },
  NKG:  { city:'NKG', country:'CN', x:350,  y:125, weight:4,  tier:'M', lat:32.05,  lon:118.80 },
  HGH:  { city:'HGH', country:'CN', x:358,  y:132, weight:4,  tier:'M', lat:30.25,  lon:120.17 },
  XMN:  { city:'XMN', country:'CN', x:345,  y:155, weight:4,  tier:'M', lat:24.48,  lon:118.08 },
  TSN:  { city:'TSN', country:'CN', x:315,  y: 70, weight:4,  tier:'M', lat:39.13,  lon:117.20 },
  DLC:  { city:'DLC', country:'CN', x:322,  y: 75, weight:3,  tier:'S', lat:38.92,  lon:121.63 },
  SHE:  { city:'SHE', country:'CN', x:340,  y: 50, weight:4,  tier:'M', lat:41.80,  lon:123.43 },
  TAO:  { city:'TAO', country:'CN', x:330,  y: 88, weight:3,  tier:'S', lat:36.06,  lon:120.38 },
  // ── 香港 ─────────────────────────────────────────────
  HKG:  { city:'HKG', country:'HK', x:310,  y:162, weight:10, tier:'L', lat:22.3,   lon:114.2  },
  HKG2: { city:'HKG', country:'HK', x:295,  y:175, weight:6,  tier:'M', lat:22.3,   lon:114.1  },
  HKG3: { city:'HKG', country:'HK', x:325,  y:150, weight:4,  tier:'S', lat:22.4,   lon:114.2  },
  // ── 新加坡 ───────────────────────────────────────────
  SIN:  { city:'SIN', country:'SG', x:300,  y:430, weight:10, tier:'L', lat:1.35,   lon:103.8  },
  SIN2: { city:'SIN', country:'SG', x:285,  y:445, weight:6,  tier:'M', lat:1.30,   lon:103.9  },
  SIN3: { city:'SIN', country:'SG', x:315,  y:418, weight:4,  tier:'S', lat:1.40,   lon:103.7  },
  // ── 東南亞 ────────────────────────────────────────────
  BKK:  { city:'BKK', country:'TH', x:268,  y:375, weight:7,  tier:'L', lat:13.75,  lon:100.50 },
  BKK2: { city:'BKK', country:'TH', x:280,  y:362, weight:4,  tier:'M', lat:13.80,  lon:100.62 },
  MNL:  { city:'MNL', country:'PH', x:368,  y:358, weight:6,  tier:'L', lat:14.60,  lon:120.98 },
  MNL2: { city:'MNL', country:'PH', x:382,  y:370, weight:3,  tier:'M', lat:14.50,  lon:121.02 },
  HAN:  { city:'HAN', country:'VN', x:285,  y:335, weight:5,  tier:'M', lat:21.03,  lon:105.85 },
  SGN:  { city:'SGN', country:'VN', x:295,  y:395, weight:5,  tier:'M', lat:10.82,  lon:106.63 },
  KUL:  { city:'KUL', country:'MY', x:278,  y:418, weight:7,  tier:'L', lat:3.14,   lon:101.69 },
  KUL2: { city:'KUL', country:'MY', x:292,  y:428, weight:4,  tier:'M', lat:3.10,   lon:101.75 },
  JKT:  { city:'JKT', country:'ID', x:295,  y:468, weight:7,  tier:'L', lat:-6.20,  lon:106.85 },
  JKT2: { city:'JKT', country:'ID', x:310,  y:478, weight:4,  tier:'M', lat:-6.25,  lon:106.90 },
  SUB:  { city:'SUB', country:'ID', x:328,  y:482, weight:3,  tier:'S', lat:-7.25,  lon:112.75 },
  RGN:  { city:'RGN', country:'MM', x:258,  y:355, weight:3,  tier:'M', lat:16.87,  lon:96.18  },
  PNH:  { city:'PNH', country:'KH', x:290,  y:372, weight:2,  tier:'S', lat:11.56,  lon:104.92 },
  // ── 南亞 ──────────────────────────────────────────────
  BOM:  { city:'BOM', country:'IN', x:205,  y:390, weight:6,  tier:'M', lat:19.1,   lon:72.9   },
  DEL:  { city:'DEL', country:'IN', x:218,  y:340, weight:5,  tier:'M', lat:28.6,   lon:77.1   },
  MAA:  { city:'MAA', country:'IN', x:215,  y:415, weight:4,  tier:'S', lat:13.1,   lon:80.3   },
  BLR:  { city:'BLR', country:'IN', x:210,  y:408, weight:4,  tier:'S', lat:13.0,   lon:77.6   },
  CCU:  { city:'CCU', country:'IN', x:228,  y:368, weight:3,  tier:'S', lat:22.57,  lon:88.37  },
  HYD:  { city:'HYD', country:'IN', x:212,  y:398, weight:3,  tier:'S', lat:17.44,  lon:78.46  },
  CMB:  { city:'CMB', country:'LK', x:215,  y:430, weight:3,  tier:'M', lat:6.90,   lon:79.86  },
  DAC:  { city:'DAC', country:'BD', x:238,  y:358, weight:4,  tier:'M', lat:23.72,  lon:90.40  },
  // ── 中東 ──────────────────────────────────────────────
  DXB:  { city:'DXB', country:'AE', x:172,  y:325, weight:8,  tier:'L', lat:25.20,  lon:55.27  },
  DXB2: { city:'DXB', country:'AE', x:185,  y:335, weight:5,  tier:'M', lat:25.15,  lon:55.32  },
  DOH:  { city:'DOH', country:'QA', x:162,  y:338, weight:5,  tier:'M', lat:25.28,  lon:51.53  },
  IST:  { city:'IST', country:'TR', x:122,  y:255, weight:6,  tier:'M', lat:41.00,  lon:28.98  },
  TLV:  { city:'TLV', country:'IL', x:138,  y:285, weight:4,  tier:'M', lat:32.08,  lon:34.78  },
  RUH:  { city:'RUH', country:'SA', x:160,  y:345, weight:4,  tier:'M', lat:24.69,  lon:46.72  },
  // ── 俄羅斯 ────────────────────────────────────────────
  SVO:  { city:'SVO', country:'RU', x:142,  y:122, weight:5,  tier:'M', lat:55.97,  lon:37.41  },
  LED:  { city:'LED', country:'RU', x:132,  y:106, weight:3,  tier:'S', lat:59.98,  lon:30.30  },
  // ── 英國 ─────────────────────────────────────────────
  LHR:  { city:'LON', country:'GB', x:1060, y:150, weight:8,  tier:'M', lat:51.47,  lon:-0.45  },
  LHR2: { city:'LON', country:'GB', x:1044, y:134, weight:5,  tier:'M', lat:51.5,   lon:-0.1   },
  MAN:  { city:'MAN', country:'GB', x:1050, y:110, weight:4,  tier:'S', lat:53.4,   lon:-2.2   },
  // ── 歐洲 ─────────────────────────────────────────────
  FRA:  { city:'FRA', country:'DE', x:1110, y:185, weight:8,  tier:'M', lat:50.0,   lon:8.6    },
  FRA2: { city:'FRA', country:'DE', x:1126, y:170, weight:5,  tier:'M', lat:50.1,   lon:8.7    },
  MUC:  { city:'MUC', country:'DE', x:1135, y:230, weight:4,  tier:'S', lat:48.1,   lon:11.6   },
  HAM:  { city:'HAM', country:'DE', x:1098, y:138, weight:3,  tier:'S', lat:53.55,  lon:9.99   },
  AMS:  { city:'AMS', country:'NL', x:1078, y:140, weight:7,  tier:'L', lat:52.37,  lon:4.90   },
  PAR:  { city:'PAR', country:'FR', x:1068, y:168, weight:7,  tier:'L', lat:48.85,  lon:2.35   },
  BRU:  { city:'BRU', country:'BE', x:1075, y:152, weight:4,  tier:'M', lat:50.85,  lon:4.35   },
  MAD:  { city:'MAD', country:'ES', x:1040, y:205, weight:5,  tier:'M', lat:40.42,  lon:-3.70  },
  BCN:  { city:'BCN', country:'ES', x:1058, y:210, weight:3,  tier:'S', lat:41.39,  lon:2.17   },
  LIS:  { city:'LIS', country:'PT', x:1028, y:210, weight:3,  tier:'S', lat:38.72,  lon:-9.14  },
  MIL:  { city:'MIL', country:'IT', x:1108, y:200, weight:5,  tier:'M', lat:45.46,  lon:9.19   },
  ROM:  { city:'ROM', country:'IT', x:1112, y:222, weight:4,  tier:'M', lat:41.90,  lon:12.50  },
  ATH:  { city:'ATH', country:'GR', x:1128, y:248, weight:4,  tier:'M', lat:37.98,  lon:23.73  },
  VIE:  { city:'VIE', country:'AT', x:1125, y:175, weight:4,  tier:'M', lat:48.21,  lon:16.37  },
  ZRH:  { city:'ZRH', country:'CH', x:1098, y:178, weight:4,  tier:'M', lat:47.38,  lon:8.54   },
  WAW:  { city:'WAW', country:'PL', x:1132, y:150, weight:3,  tier:'M', lat:52.23,  lon:21.01  },
  STO:  { city:'STO', country:'SE', x:1088, y:108, weight:4,  tier:'M', lat:59.33,  lon:18.07  },
  CPH:  { city:'CPH', country:'DK', x:1082, y:118, weight:3,  tier:'M', lat:55.68,  lon:12.57  },
  OSL:  { city:'OSL', country:'NO', x:1072, y:102, weight:3,  tier:'M', lat:59.91,  lon:10.75  },
  HEL:  { city:'HEL', country:'FI', x:1100, y: 98, weight:3,  tier:'M', lat:60.17,  lon:24.94  },
  DUB:  { city:'DUB', country:'IE', x:1038, y:138, weight:4,  tier:'M', lat:53.35,  lon:-6.26  },
  // ── 美國 ─────────────────────────────────────────────
  LAX:  { city:'LAX', country:'US', x:660,  y:250, weight:8,  tier:'M', lat:34.0,   lon:-118.2 },
  SJC:  { city:'SJC', country:'US', x:635,  y:190, weight:6,  tier:'M', lat:37.3,   lon:-121.9 },
  SEA:  { city:'SEA', country:'US', x:660,  y:125, weight:6,  tier:'M', lat:47.6,   lon:-122.3 },
  JFK:  { city:'NYC', country:'US', x:860,  y:175, weight:8,  tier:'M', lat:40.6,   lon:-73.8  },
  IAD:  { city:'WAS', country:'US', x:840,  y:225, weight:6,  tier:'M', lat:38.95,  lon:-77.45 },
  ORD:  { city:'CHI', country:'US', x:795,  y:155, weight:6,  tier:'M', lat:41.98,  lon:-87.9  },
  DAL:  { city:'DFW', country:'US', x:768,  y:246, weight:5,  tier:'S', lat:32.8,   lon:-96.8  },
  ATL:  { city:'ATL', country:'US', x:830,  y:282, weight:5,  tier:'S', lat:33.7,   lon:-84.4  },
  MIA:  { city:'MIA', country:'US', x:840,  y:330, weight:6,  tier:'M', lat:25.79,  lon:-80.29 },
  BOS:  { city:'BOS', country:'US', x:882,  y:158, weight:5,  tier:'M', lat:42.36,  lon:-71.06 },
  DEN:  { city:'DEN', country:'US', x:755,  y:202, weight:5,  tier:'M', lat:39.86,  lon:-104.67},
  PHX:  { city:'PHX', country:'US', x:730,  y:248, weight:4,  tier:'M', lat:33.43,  lon:-112.01},
  PDX:  { city:'PDX', country:'US', x:650,  y:148, weight:4,  tier:'M', lat:45.59,  lon:-122.60},
  SAN:  { city:'SAN', country:'US', x:660,  y:275, weight:4,  tier:'M', lat:32.73,  lon:-117.20},
  LAS:  { city:'LAS', country:'US', x:688,  y:258, weight:4,  tier:'M', lat:36.08,  lon:-115.15},
  MSP:  { city:'MSP', country:'US', x:788,  y:148, weight:4,  tier:'M', lat:44.88,  lon:-93.22 },
  DTW:  { city:'DTW', country:'US', x:818,  y:165, weight:3,  tier:'M', lat:42.21,  lon:-83.35 },
  MCO:  { city:'MCO', country:'US', x:842,  y:305, weight:4,  tier:'M', lat:28.43,  lon:-81.31 },
  CLT:  { city:'CLT', country:'US', x:838,  y:258, weight:3,  tier:'S', lat:35.22,  lon:-80.94 },
  SLC:  { city:'SLC', country:'US', x:712,  y:188, weight:3,  tier:'S', lat:40.79,  lon:-111.98},
  MSY:  { city:'MSY', country:'US', x:802,  y:295, weight:3,  tier:'S', lat:29.99,  lon:-90.26 },
  TPA:  { city:'TPA', country:'US', x:842,  y:318, weight:3,  tier:'S', lat:27.98,  lon:-82.53 },
  BNA:  { city:'BNA', country:'US', x:808,  y:258, weight:2,  tier:'S', lat:36.12,  lon:-86.68 },
  // ── 加拿大 ────────────────────────────────────────────
  YVR:  { city:'YVR', country:'CA', x:648,  y:118, weight:5,  tier:'M', lat:49.28,  lon:-123.12},
  YYZ:  { city:'YYZ', country:'CA', x:832,  y:142, weight:5,  tier:'M', lat:43.65,  lon:-79.38 },
  YUL:  { city:'YUL', country:'CA', x:862,  y:138, weight:4,  tier:'M', lat:45.47,  lon:-73.74 },
  YEG:  { city:'YEG', country:'CA', x:700,  y:100, weight:2,  tier:'S', lat:53.56,  lon:-113.53},
  // ── 拉丁美洲 ──────────────────────────────────────────
  GRU:  { city:'GRU', country:'BR', x:835,  y:558, weight:7,  tier:'L', lat:-23.43, lon:-46.47 },
  GIG:  { city:'GIG', country:'BR', x:848,  y:562, weight:5,  tier:'M', lat:-22.81, lon:-43.25 },
  FOR:  { city:'FOR', country:'BR', x:870,  y:498, weight:2,  tier:'S', lat:-3.78,  lon:-38.53 },
  POA:  { city:'POA', country:'BR', x:840,  y:572, weight:2,  tier:'S', lat:-29.98, lon:-51.18 },
  BOG:  { city:'BOG', country:'CO', x:778,  y:475, weight:5,  tier:'M', lat:4.70,   lon:-74.14 },
  LIM:  { city:'LIM', country:'PE', x:762,  y:535, weight:4,  tier:'M', lat:-12.02, lon:-77.10 },
  SCL:  { city:'SCL', country:'CL', x:778,  y:605, weight:4,  tier:'M', lat:-33.39, lon:-70.79 },
  EZE:  { city:'EZE', country:'AR', x:802,  y:618, weight:5,  tier:'M', lat:-34.82, lon:-58.54 },
  MEX:  { city:'MEX', country:'MX', x:748,  y:348, weight:6,  tier:'L', lat:19.43,  lon:-99.13 },
  MEX2: { city:'MEX', country:'MX', x:762,  y:358, weight:4,  tier:'M', lat:19.40,  lon:-99.00 },
  PTY:  { city:'PTY', country:'PA', x:778,  y:428, weight:3,  tier:'S', lat:8.99,   lon:-79.54 },
  CCS:  { city:'CCS', country:'VE', x:822,  y:455, weight:3,  tier:'S', lat:10.60,  lon:-66.99 },
  // ── 非洲 ──────────────────────────────────────────────
  JNB:  { city:'JNB', country:'ZA', x:172,  y:545, weight:6,  tier:'L', lat:-26.13, lon:28.24  },
  CPT:  { city:'CPT', country:'ZA', x:155,  y:568, weight:4,  tier:'M', lat:-33.96, lon:18.60  },
  CAI:  { city:'CAI', country:'EG', x:152,  y:298, weight:5,  tier:'M', lat:30.06,  lon:31.22  },
  LOS:  { city:'LOS', country:'NG', x:128,  y:415, weight:5,  tier:'M', lat:6.57,   lon:3.32   },
  NBO:  { city:'NBO', country:'KE', x:182,  y:455, weight:4,  tier:'M', lat:-1.32,  lon:36.93  },
  CMN:  { city:'CMN', country:'MA', x:105,  y:270, weight:3,  tier:'S', lat:33.57,  lon:-7.59  },
  LAD:  { city:'LAD', country:'AO', x:148,  y:508, weight:3,  tier:'S', lat:-8.84,  lon:13.23  },
  DAR:  { city:'DAR', country:'TZ', x:190,  y:480, weight:2,  tier:'S', lat:-6.77,  lon:39.27  },
  // ── 澳洲 / 紐西蘭 ────────────────────────────────────
  SYD:  { city:'SYD', country:'AU', x:470,  y:620, weight:6,  tier:'M', lat:-33.9,  lon:151.2  },
  MEL:  { city:'MEL', country:'AU', x:440,  y:675, weight:4,  tier:'M', lat:-37.8,  lon:144.9  },
  PER:  { city:'PER', country:'AU', x:340,  y:630, weight:4,  tier:'S', lat:-31.95, lon:115.9  },
  BNE:  { city:'BNE', country:'AU', x:482,  y:600, weight:3,  tier:'S', lat:-27.5,  lon:153.0  },
  ADL:  { city:'ADL', country:'AU', x:432,  y:645, weight:3,  tier:'S', lat:-34.93, lon:138.60 },
  AKL:  { city:'AKL', country:'NZ', x:525,  y:648, weight:4,  tier:'M', lat:-36.85, lon:174.76 },
  CHC:  { city:'CHC', country:'NZ', x:535,  y:662, weight:2,  tier:'S', lat:-43.49, lon:172.54 },
  // ── 太平洋 ────────────────────────────────────────────
  HNL:  { city:'HNL', country:'US', x:572,  y:298, weight:4,  tier:'M', lat:21.32,  lon:-157.92},
  GUM:  { city:'GUM', country:'GU', x:490,  y:342, weight:2,  tier:'S', lat:13.48,  lon:144.80 },
};
// NODES 仍供選取邏輯和 anycast 過濾用（key set 的操作），由 POPS 衍生
let NODES = Object.fromEntries(Object.entries(POPS).map(([k,v])=>[k,v]));

// ── 節點子集選取(--nodes N)── tier(L>M>S)再 weight 由大到小,stable。
if (NODES_N !== null && NODES_N < Object.keys(NODES).length) {
  const tierRank = { L: 0, M: 1, S: 2 };
  const keys = Object.keys(NODES);
  const ranked = keys
    .map((n, i) => ({ n, i }))
    .sort((p, q) => {
      const tp = tierRank[POPS[p.n].tier], tq = tierRank[POPS[q.n].tier];
      if (tp !== tq) return tp - tq;
      const wp = -POPS[p.n].weight, wq = -POPS[q.n].weight;
      if (wp !== wq) return wp - wq;
      return p.i - q.i;            // stable
    })
    .map(o => o.n);
  const keep = new Set(ranked.slice(0, Math.max(2, NODES_N)));
  const filtered = {};
  for (const k of keys) if (keep.has(k)) filtered[k] = NODES[k];
  NODES = filtered;
}

const ORDER = Object.keys(NODES);
const IDX = {};
ORDER.forEach((nid, i) => { IDX[nid] = i + 1; });

// ── pseudo / anycast ──
const PSEUDO = {
  PN_EU:  ['192.168.100.0/24', 1140, 120],
  PN_AS:  ['192.168.101.0/24', 110,  330],
  PN_US:  ['192.168.102.0/24', 600,  210],
  PN_ME:  ['192.168.103.0/24', 175,  332],
  PN_SEA: ['192.168.104.0/24', 282,  415],
  PN_SA:  ['192.168.105.0/24', 218,  370],
};

const ANYCAST = {
  '100.64.0.0/24': ['TPE', 'HKG', 'SIN', 'TYO'],
  '100.64.1.0/24': ['LAX', 'SJC', 'JFK', 'IAD'],
  '100.64.2.0/24': ['LHR', 'FRA', 'LHR2', 'FRA2'],
  '100.64.3.0/24': ['SHA', 'PEK', 'CAN', 'SZX'],
  '100.64.4.0/24': ['BOM', 'DEL', 'MAA', 'BLR'],
  '100.64.5.0/24': ['SYD', 'MEL', 'BNE'],
  '100.64.6.0/24': ['AMS', 'PAR', 'AMS', 'DUB'],
  '100.64.7.0/24': ['SEL', 'BKK', 'KUL', 'JKT'],
  '100.64.8.0/24': ['GRU', 'BOG', 'MEX', 'MIA'],
  '100.64.9.0/24': ['DXB', 'CAI', 'JNB', 'NBO'],
};
const anycast_of = {};
for (const [sub, members] of Object.entries(ANYCAST)) {
  for (const m of members) {
    if (m in NODES) (anycast_of[m] ??= []).push(sub);
  }
}

const R_EARTH = EARTH_RADIUS_KM;
const rad = d => d * Math.PI / 180;
function haversineKm(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2);
  const dp = rad(lat2 - lat1), dl = rad(lon2 - lon1);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}
function geoKm(a, b) { return haversineKm(POPS[a].lat, POPS[a].lon, POPS[b].lat, POPS[b].lon); }

function costFor(a, b) {
  return impliedCostFromRtt(rttFor(a, b), FIBER_RTT_PER_KM);   // engine.js SSOT
}
function capFor(a, b) {
  const ta = POPS[a].tier, tb = POPS[b].tier;
  if (ta === 'S' || tb === 'S') return 300;
  if (ta === 'L' && tb === 'L') return 900;
  if (ta === 'L' || tb === 'L') return 700;
  return 500;
}

// ── Edge lists ──
const INTRA = [
  // 台灣
  ['TPE','KHH'],['TPE','TYN'],['TPE','HSZ'],['TPE','TPE2'],
  ['KHH','TCH'],['TCH','HSZ'],['TYN','HSZ'],['TPE2','TYN'],
  // 日本
  ['TYO','OSA'],['TYO','TYO2'],['TYO','NGO'],['OSA','NGO'],
  ['NGO','FUK'],['OSA','FUK'],['TYO2','NGO'],
  ['TYO','SDJ'],['OSA','HIJ'],['TYO','OKA'],
  // 韓國
  ['SEL','SEL2'],['SEL','PUS'],['SEL2','PUS'],
  // 中國
  ['SHA','PEK'],['SHA','WUH'],['SHA','CAN'],['SHA','SZX'],
  ['CAN','SZX'],['PEK','CTU'],['WUH','CTU'],['CAN','WUH'],
  ['SHA','NKG'],['SHA','HGH'],['NKG','HGH'],['SHA','XMN'],
  ['PEK','TSN'],['PEK','DLC'],['PEK','SHE'],['TSN','DLC'],
  ['SHA','TAO'],['PEK','TAO'],
  // 香港
  ['HKG','HKG2'],['HKG','HKG3'],['HKG2','HKG3'],
  // 新加坡
  ['SIN','SIN2'],['SIN','SIN3'],['SIN2','SIN3'],
  // 東南亞
  ['BKK','BKK2'],['KUL','KUL2'],['JKT','JKT2'],['JKT2','SUB'],
  ['MNL','MNL2'],
  // 南亞
  ['BOM','DEL'],['BOM','MAA'],['MAA','BLR'],['BLR','BOM'],
  ['BOM','HYD'],['DEL','CCU'],['CMB','MAA'],['DAC','CCU'],
  // 中東
  ['DXB','DXB2'],['DXB','DOH'],['DXB2','DOH'],
  // 美國東岸群
  ['JFK','IAD'],['JFK','BOS'],['IAD','ATL'],['ATL','MCO'],
  ['MCO','MIA'],['ATL','CLT'],['ATL','BNA'],['IAD','CLT'],
  ['MCO','TPA'],['MIA','MCO'],
  // 美國中部群
  ['ORD','MSP'],['ORD','DTW'],['ORD','MSY'],['DAL','MSY'],
  ['DAL','SLC'],
  // 美國西岸群
  ['LAX','SJC'],['SJC','SEA'],['SEA','PDX'],['LAX','SAN'],
  ['LAX','LAS'],['SJC','LAS'],['SEA','YVR'],
  // 美國跨群
  ['SEA','ORD'],['ORD','JFK'],['DAL','LAX'],['ORD','IAD'],
  ['ATL','DAL'],['DEN','SLC'],['DEN','LAX'],['DEN','ORD'],
  ['PHX','LAX'],['PHX','DEN'],
  // 加拿大
  ['YVR','YEG'],['YYZ','YUL'],['YEG','ORD'],
  // 英國/歐洲
  ['LHR','LHR2'],['LHR','MAN'],['LHR2','MAN'],
  ['FRA','FRA2'],['FRA','MUC'],['FRA2','MUC'],['FRA','HAM'],
  ['AMS','BRU'],['AMS','FRA'],['PAR','BRU'],['PAR','FRA'],
  ['MAD','BCN'],['MAD','LIS'],
  ['MIL','ROM'],['MIL','VIE'],['MIL','ZRH'],['FRA','VIE'],
  ['FRA','ZRH'],['FRA','WAW'],['VIE','ATH'],
  ['STO','CPH'],['STO','OSL'],['STO','HEL'],['CPH','OSL'],
  ['STO','HAM'],
  // 俄羅斯
  ['SVO','LED'],
  // 澳洲/紐西蘭
  ['SYD','MEL'],['SYD','BNE'],['MEL','PER'],['PER','SYD'],
  ['BNE','MEL'],['ADL','MEL'],['ADL','PER'],
  ['AKL','CHC'],
  // 非洲
  ['JNB','CPT'],
  // 拉丁美洲
  ['GRU','GIG'],['GRU','POA'],['GRU','FOR'],
  ['MEX','MEX2'],['SCL','EZE'],
];
const BACKBONE = [
  // 亞洲內
  ['TPE','TYO'],['TPE','HKG'],['TPE','SHA'],['TPE','OSA'],['TPE','SIN'],
  ['TYO','SHA'],['HKG','SHA'],['HKG','CAN'],['HKG','SIN'],
  ['TYO','SEL'],['SEL','SHA'],['SEL','PEK'],
  ['HKG','BKK'],['SIN','BKK'],['SIN','KUL'],['BKK','KUL'],
  ['SIN','JKT'],['KUL','JKT'],['HAN','HKG'],['SGN','SIN'],
  ['MNL','HKG'],['MNL','TYO'],
  ['RGN','BKK'],['PNH','BKK'],['PNH','SIN'],
  // 南亞
  ['SIN','BOM'],['SIN','DEL'],['DXB','BOM'],['DXB','DEL'],
  ['CMB','SIN'],['DAC','BKK'],
  // 中東 hub
  ['DXB','CAI'],['DXB','IST'],['TLV','IST'],['DXB','LHR'],
  ['DXB','FRA'],['DOH','LHR'],['RUH','DXB'],
  // 跨洋(太平洋)
  ['TYO','LAX'],['TYO','SEA'],['TPE','LAX'],['HKG','LAX'],
  ['OSA','SJC'],['SIN','SYD'],['HKG','SYD'],['SYD','LAX'],
  ['HNL','LAX'],['HNL','TYO'],['GUM','TYO'],['GUM','SIN'],
  // 跨洋(大西洋)
  ['JFK','LHR'],['JFK','FRA'],['IAD','FRA2'],['LAX','LHR'],
  ['BOS','LHR'],['BOS','AMS'],['MIA','LIS'],['MIA','MAD'],
  ['YUL','LHR'],
  // 歐洲對外
  ['LHR','FRA'],['LHR2','FRA2'],['LHR','MUC'],
  ['AMS','LHR'],['PAR','LHR'],['DUB','LHR'],
  ['FRA','SVO'],['WAW','SVO'],
  // 印度對歐
  ['DEL','FRA'],['BOM','LHR'],['BOM','FRA2'],
  // 非洲
  ['JNB','LHR'],['JNB','FRA'],['JNB','SIN'],
  ['CAI','FRA'],['CAI','DXB'],['LOS','LHR'],['NBO','DXB'],
  ['CMN','MAD'],['LAD','LIS'],['DAR','DXB'],
  // 澳洲/紐西蘭對外
  ['SYD','LAX'],['AKL','LAX'],['SYD','SIN'],
  // 加拿大對外
  ['YVR','LAX'],['YVR','SEA'],['YYZ','JFK'],['YYZ','ORD'],
  ['YUL','JFK'],
  // 拉丁美洲
  ['GRU','MIA'],['GRU','IAD'],['GRU','LIS'],
  ['BOG','MIA'],['LIM','MIA'],['EZE','MIA'],['SCL','MIA'],
  ['MEX','LAX'],['MEX','IAD'],['PTY','MIA'],['CCS','MIA'],
  // 太平洋延伸
  ['HNL','SYD'],
  // 補足 degree<2 的節點
  ['OKA','TYO'],['OKA','TPE'],
  ['SDJ','TYO'],['SDJ','TYO2'],
  ['HIJ','OSA'],['HIJ','FUK'],
  ['XMN','SHA'],['XMN','HKG'],
  ['SHE','PEK'],['SHE','DLC'],
  ['BKK2','BKK'],['BKK2','SIN'],
  ['MNL2','MNL'],['MNL2','HKG'],
  ['HAN','BKK'],['HAN','SHA'],
  ['SGN','BKK'],['SGN','SIN'],
  ['KUL2','KUL'],['KUL2','SIN'],
  ['SUB','JKT'],['SUB','SIN'],
  ['RGN','SIN'],['RGN','BKK'],
  ['HYD','BLR'],['HYD','MAA'],
  ['TLV','CAI'],['TLV','DXB'],
  ['RUH','DXB'],['RUH','CAI'],
  ['LED','SVO'],['LED','STO'],
  ['BCN','MAD'],['BCN','PAR'],
  ['ROM','MIL'],['ROM','ATH'],
  ['ATH','IST'],['ATH','CAI'],
  ['HEL','STO'],['HEL','SVO'],
  ['DUB','LHR'],['DUB','AMS'],
  ['PDX','SEA'],['PDX','SJC'],
  ['SAN','LAX'],['SAN','PHX'],
  ['MSP','ORD'],['MSP','DEN'],
  ['DTW','ORD'],['DTW','JFK'],
  ['TPA','MIA'],['TPA','ATL'],
  ['BNA','ATL'],['BNA','ORD'],
  ['GIG','GRU'],['GIG','EZE'],
  ['FOR','GRU'],['FOR','MIA'],
  ['POA','GRU'],['POA','EZE'],
  ['BOG','GRU'],['BOG','MEX'],
  ['LIM','GRU'],['LIM','BOG'],
  ['MEX2','MEX'],['MEX2','LAX'],
  ['PTY','BOG'],['PTY','MIA'],
  ['CCS','BOG'],['CCS','MIA'],
  ['CPT','JNB'],['CPT','LOS'],
  ['LOS','CAI'],['LOS','JNB'],
  ['NBO','JNB'],['NBO','DXB'],
  ['CMN','MAD'],['CMN','LIS'],
  ['LAD','JNB'],['LAD','LOS'],
  ['DAR','NBO'],['DAR','DXB'],
  ['CHC','AKL'],['CHC','SYD'],
];
const ALL_PAIRS = [...INTRA, ...BACKBONE];

const ASYM = new Map([
  ['SIN SYD', [70, 95]],
  ['LAX LHR', [110, 90]],
  ['SIN BOM', [43, 38]],
  ['LHR FRA', [7, 14]],
]);

const TRANSIT = {
  PN_EU:  ['LHR', 'FRA', 'FRA2'],
  PN_AS:  ['HKG', 'SIN', 'TPE'],
  PN_US:  ['LAX', 'SJC', 'SEA'],
  PN_ME:  ['DXB', 'DXB2', 'DOH'],
  PN_SEA: ['BKK', 'KUL', 'SIN2'],
  PN_SA:  ['BOM', 'DEL', 'DAC'],
};

const FIBER_RTT_PER_KM = GRAVITY_FIBER_RTT_PER_KM;
function geoRtt(a, b) { return geoKm(a, b) * FIBER_RTT_PER_KM; }

// ── CSV loaders ──
function parseCsv(path) {
  const txt = readFileSync(path, 'utf8');
  const lines = txt.split('\n').filter(l => l.length > 0);
  const header = lines[0].split(',').map(s => s.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const obj = {};
    header.forEach((h, j) => { obj[h] = (cells[j] ?? '').trim(); });
    rows.push(obj);
  }
  return rows;
}
function loadMeasuredRtt(path) {
  const m = new Map();
  if (!existsSync(path)) return m;
  for (const row of parseCsv(path)) {
    const a = (row.a || '').trim(), b = (row.b || '').trim(), raw = (row.rtt_ms || '').trim();
    if (!a || !b || !raw) continue;
    m.set(`${a} ${b}`, parseFloat(raw));
  }
  return m;
}
function loadCityRtt(path) {
  const m = new Map();
  if (!existsSync(path)) return m;
  for (const row of parseCsv(path)) {
    const ca = (row.city_a || '').trim(), cb = (row.city_b || '').trim(), raw = (row.rtt_ms || '').trim();
    if (!ca || !cb || !raw) continue;
    m.set(`${ca} ${cb}`, parseFloat(raw));
  }
  return m;
}
const MEASURED_RTT_CSV = join(__dir, 'node_rtt.csv');
const CITY_RTT_CSV = join(__dir, 'city_rtt.csv');
const MEASURED_RTT_MS = loadMeasuredRtt(MEASURED_RTT_CSV);
const CITY_RTT_MS = loadCityRtt(CITY_RTT_CSV);
// CSV 是查找表:斷掉會靜默退回 geo 模型 → 把載入狀態講出來,避免默默失準。
if (!existsSync(MEASURED_RTT_CSV)) console.warn(`[gen.mjs] 缺 ${MEASURED_RTT_CSV} → 節點直測 RTT 全退回模型`);
else if (MEASURED_RTT_MS.size === 0) console.warn('[gen.mjs] node_rtt.csv 載入 0 行(欄位需為 a,b,rtt_ms)');
if (!existsSync(CITY_RTT_CSV)) console.warn(`[gen.mjs] 缺 ${CITY_RTT_CSV} → 城市參考 RTT 全退回模型`);
else if (CITY_RTT_MS.size === 0) console.warn('[gen.mjs] city_rtt.csv 載入 0 行(欄位需為 city_a,city_b,rtt_ms)');

function cityRttLookup(a, b) {
  const ca = POPS[a]?.city, cb = POPS[b]?.city;
  if (ca === cb) return null;
  if (CITY_RTT_MS.has(`${ca} ${cb}`)) return CITY_RTT_MS.get(`${ca} ${cb}`);
  if (CITY_RTT_MS.has(`${cb} ${ca}`)) return CITY_RTT_MS.get(`${cb} ${ca}`);
  return null;
}

// ── RTT_MS:模型種子 → 城市參考覆寫 → 節點直測覆寫 ──
const RTT_MS = new Map();
for (const [a, b] of ALL_PAIRS) {
  if (!(a in NODES) || !(b in NODES)) continue;
  const seed = round2num(geoRtt(a, b));
  const cref = cityRttLookup(a, b);
  RTT_MS.set(`${a} ${b}`, cref !== null ? round2num(cref) : seed);
}
for (const [k, v] of MEASURED_RTT_MS) RTT_MS.set(k, v);

// round2num: 回傳「round(x,2) 後的數值」(供後續比較/再四捨;字串化另用 pyFloatStr)。
function round2num(x) { return parseFloat(x.toFixed(2)); }

function rttFor(a, b) {
  if (RTT_MS.has(`${a} ${b}`)) return RTT_MS.get(`${a} ${b}`);
  if (RTT_MS.has(`${b} ${a}`)) return RTT_MS.get(`${b} ${a}`);
  return round2num(geoRtt(a, b));
}

// 一條邊的 RTT 來源(rtt.js 標記 + 結尾統計共用,單一事實)。優先序:measured > city-ref > model。
function rttSrcOf(a, b) {
  if (MEASURED_RTT_MS.has(`${a} ${b}`) || MEASURED_RTT_MS.has(`${b} ${a}`)) return 'measured';
  if (cityRttLookup(a, b) !== null) return 'city-ref';
  return 'model';
}

// RTT_COST_DIV 已移至 engine.js(impliedCostFromRtt 共用);costFor 直接呼叫該函式

// ── Build edge records ──
const edges = [];
const seen = new Set();
function addEdge(a, b, eid = null, cap = null) {
  const key = [a, b].slice().sort().join(' ');
  if (seen.has(key) && eid === null) return;
  seen.add(key);
  let c, cr;
  if (ASYM.has(`${a} ${b}`)) { [c, cr] = ASYM.get(`${a} ${b}`); }
  else if (ASYM.has(`${b} ${a}`)) { const v = ASYM.get(`${b} ${a}`); cr = v[0]; c = v[1]; }
  else { c = cr = costFor(a, b); }
  const rec = { id: eid || `e_${a}_${b}`, source: a, target: b, cost: c };
  if (cr !== c) rec.costRev = cr;
  rec.capacity = cap !== null ? cap : capFor(a, b);
  rec.type = 'p2p';
  edges.push(rec);
}
for (const [a, b] of ALL_PAIRS) {
  if (a in NODES && b in NODES) addEdge(a, b);
}

const PARALLEL = [
  ['TPE', 'TYO', 400],
  ['TYO', 'LAX', 700],
  ['HKG', 'SIN', 900],
  ['JFK', 'LHR', 500],
  ['LAX', 'SJC', 500],
  ['TPE', 'HKG', 700],
  ['TYO', 'SHA', 700],
];
for (const [a, b, cap] of PARALLEL) {
  if (a in NODES && b in NODES) addEdge(a, b, `e_${a}_${b}_b`, cap);
}

const used_pn = new Set();
for (const [pn, members] of Object.entries(TRANSIT)) {
  for (const r of members) {
    if (!(r in NODES)) continue;
    used_pn.add(pn);
    edges.push({ id: `e_${r}_${pn}`, source: r, target: pn, cost: 10, capacity: 1100, type: 'transit' });
  }
}

// ── Build node records ──
function stubsFor(nid) {
  const i = IDX[nid];
  const s = [`${i}.${i}.${i}.${i}/32`, `10.${i}.0.0/24`];
  return s.concat(anycast_of[nid] || []);
}
const ASBR = new Set(['TPE', 'FRA']);

const node_recs = [];
for (const nid of ORDER) {
  const _co = GRAVITY_CITY_GEO[POPS[nid].city]?.country ?? POPS[nid].country;
  node_recs.push({
    id: nid, label: `${nid}\\n${_co}`,
    country: _co,
    city: POPS[nid].city,
    type: 'router', area: '0',
    stubs: stubsFor(nid), isASBR: ASBR.has(nid), isABR: false,
  });
}
for (const [pn, [sub]] of Object.entries(PSEUDO)) {
  if (used_pn.has(pn)) node_recs.push({ id: pn, label: `${pn}\\n${sub}`, type: 'pseudonode', subnet: sub });
}

const positions = {};
for (const nid of ORDER) positions[nid] = { x: POPS[nid].x, y: POPS[nid].y };
for (const [pn, [sub, x, y]] of Object.entries(PSEUDO)) {
  if (used_pn.has(pn)) positions[pn] = { x, y };
}

let externals = ['TPE', 'FRA'].filter(r => r in NODES).map(r => ({
  advertising_router: r, subnet: '0.0.0.0/0', metric: 1, metric_type: 'E2',
}));
if (externals.length === 0) {
  externals = [{ advertising_router: ORDER[0], subnet: '0.0.0.0/0', metric: 1, metric_type: 'E2' }];
}

// ── Connectivity check (BFS over routers via p2p edges) ──
const adj = {};
for (const n of ORDER) adj[n] = new Set();
for (const e of edges) {
  if (e.type === 'p2p') { adj[e.source].add(e.target); adj[e.target].add(e.source); }
}
const visited = new Set();
const stack = [ORDER[0]];
while (stack.length) {
  const u = stack.pop();
  if (visited.has(u)) continue;
  visited.add(u);
  for (const v of adj[u]) if (!visited.has(v)) stack.push(v);
}
const missing = ORDER.filter(n => !visited.has(n));
if (missing.length) {
  console.error(`[gen.mjs] --nodes ${NODES_N} 產生不連通的拓樸,孤立節點:${missing.sort().join(',')}。請改用較大的 N。`);
  process.exit(1);
}
const degree1 = ORDER.filter(n => adj[n].size < 2);
if (degree1.length) {
  if (NODES_N === null) throw new Error(`degree<2 routers: ${degree1}`);
  else console.log(`  [warn] degree<2 節點(N-1 會使其孤立):${degree1}`);
}

// ── Serializers ──
function jsVal(v) {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return '"' + v + '"';
  if (Array.isArray(v)) return '[' + v.map(jsVal).join(',') + ']';
  throw new TypeError(String(v));
}
function jsObj(d) {
  return '{ ' + Object.entries(d).map(([k, v]) => `${k}: ${jsVal(v)}`).join(', ') + ' }';
}

// ── Serialize topology.js ──
{
  const lines = [];
  lines.push('// Generated by working/gen.mjs — BlastRadius POC synthetic backbone dataset (size set by --nodes).');
  lines.push('const topology = {');
  lines.push('  nodes: [');
  lines.push(node_recs.map(n => '    ' + jsObj(n)).join(',\n'));
  lines.push('  ],');
  lines.push('  edges: [');
  lines.push(edges.map(e => '    ' + jsObj(e)).join(',\n'));
  lines.push('  ],');
  lines.push('  externals: [');
  lines.push(externals.map(e => '    ' + jsObj(e)).join(',\n'));
  lines.push('  ],');
  lines.push('  positions: {');
  lines.push(Object.entries(positions).map(([k, v]) => `    ${k}: ${jsObj(v)}`).join(',\n'));
  lines.push('  },');
  lines.push('};');
  lines.push('');
  writeFileSync(join(OUT, 'topology.js'), lines.join('\n'));
}

// ── demand.js — gravity model + 5 profiles ──
const ASIA = new Set(['TPE','TPE2','KHH','TYN','TCH','HSZ','TYO','TYO2','OSA','NGO','FUK',
  'SHA','PEK','CAN','SZX','CTU','WUH','HKG','HKG2','HKG3','SIN','SIN2','SIN3',
  'SYD','MEL','PER','BNE','BOM','DEL','MAA','BLR']);
const AMER = new Set(['LAX','SJC','SEA','JFK','IAD','ORD','DAL','ATL']);
// euro = 其餘(else)— 不需顯式集合;macro() 只判 asia / amer。
function macro(n) {
  if (ASIA.has(n)) return 'asia';
  if (AMER.has(n)) return 'amer';
  return 'euro';
}
// node_recs は demand 生成より先に build 済;stubs は stubsFor() の結果(常に ≥2 条)。
const nodeStubs = {};
const nodeEdgeMap = {};
for (const rec of node_recs) { nodeStubs[rec.id] = rec.stubs || []; }
for (const e of edges) {
  (nodeEdgeMap[e.source] ??= []).push(e);
  (nodeEdgeMap[e.target] ??= []).push(e);
}
// mass = stubs 數量 + connected capacity 加總(對齊 companions.mjs / gravity.mjs SSOT)
const massOf = n => gravityMass(n, nodeEdgeMap[n] || [], nodeStubs[n] || []);

function baseDemand(a, b) {
  const d = geoKm(a, b);
  return SCALE * K * massOf(a) * massOf(b) / (1 + d / GRAVITY_D0);
}
const routers = ORDER;
function buildMatrix(weightFn) {
  const m = {};
  for (const a of routers) {
    const row = {};
    for (const b of routers) {
      if (b === a) continue;
      const w = weightFn(a, b);
      if (w >= EMIT) row[b] = w;
    }
    if (Object.keys(row).length) m[a] = row;
  }
  return m;
}
// demand 改用 1 位小數浮點:整數精度在小 pair(如 3.7 Gbps)誤差達 8%,保留小數才合理。
const round1 = x => Math.round(x * 10) / 10;
const avgFn = (a, b) => round1(baseDemand(a, b));
const maxFn = (a, b) => round1(MAX_MULT * baseDemand(a, b));
function busyFn(busyMacro) {
  return (a, b) => {
    const aIn = macro(a) === busyMacro, bIn = macro(b) === busyMacro;
    let mult;
    if (aIn && bIn)      mult = BUSY_MULT;
    else if (aIn || bIn) mult = BUSY_MULT * (bIn ? DOWN_SKEW : UP_SKEW);
    else                 mult = OFF_MULT;
    return round1(mult * baseDemand(a, b));
  };
}
const avg_m  = buildMatrix(avgFn);
const max_m  = buildMatrix(maxFn);
const asia_m = buildMatrix(busyFn('asia'));
const amer_m = buildMatrix(busyFn('amer'));
const eu_m   = buildMatrix(busyFn('euro'));

function matrixJs(m, indent = '        ') {
  const out = [];
  // pyFloatStr(v,1):保留 1 位小數,去尾零但不去小數點(12.0→'12.0',12.5→'12.5')
  const fmt = v => pyFloatStr(v, 1);
  for (const a of routers) {
    if (!(a in m)) continue;
    const row = m[a];
    const inner = routers.filter(b => b in row).map(b => `${b}: ${fmt(row[b])}`).join(', ');
    out.push(`${indent}${a}: { ${inner} },`);
  }
  return out.join('\n');
}

{
  const dem = [];
  dem.push('// Demand matrix — Gbps offered between every router pair.');
  dem.push('// v4: 多區域重力模型(吃真實大圈距離) + 月均/最壞 + 區域忙時快照。');
  dem.push('// Replace with NetFlow/sFlow-derived TM when available.');
  dem.push('const demand = {');
  dem.push("  unit: 'Gbps',");
  dem.push("  source: 'synthetic-v4',");
  dem.push("  timestamp: '2026-06-04',");
  dem.push('');
  dem.push("  // Active profile key — UI will switch this; engine reads demand.matrix");
  dem.push("  active: 'avg',");
  dem.push('');
  dem.push('  profiles: {');
  dem.push('    avg: {');
  dem.push("      label: 'Monthly avg',");
  dem.push('      symmetric: true,');
  dem.push(`      default: ${DFLT},`);
  dem.push('      matrix: {');
  dem.push(matrixJs(avg_m));
  dem.push('      },');
  dem.push('    },');
  dem.push('    max: {');
  dem.push("      label: 'Worst case (95th pct)',");
  dem.push('      symmetric: false,');
  dem.push(`      default: ${DFLT},`);
  dem.push('      matrix: {');
  dem.push(matrixJs(max_m));
  dem.push('      },');
  dem.push('    },');
  dem.push('');
  dem.push('    // ─────────────────────────────────────────────────────────────────────');
  dem.push('    // 區域忙時快照 (regional busy-hour snapshots)');
  dem.push('    //');
  dem.push('    // 動機:max profile 假設「全球同時 95th」,過度悲觀 — 各時區的尖峰並不重疊。');
  dem.push('    // 以下三個快照各讓「單一區域」進入忙時(≈4×月均,demo 誇大方向性以展示不對稱權重優化),');
  dem.push('    // 其餘區域維持離峰(≈0.6×月均)。手動切換可觀察「此刻誰在尖峰」對各鏈路的影響。');
  dem.push('    //');
  dem.push('    // 區域定義:Asia = 東亞/東南亞/大洋洲/南亞 · Americas = 美洲 · Europe = 歐洲');
  dem.push('    // 規則:某 pair 只要有一端落在忙時區域 → busy(4×,含 download skew 50:1);兩端皆在其他區域 → 離峰(0.6×)。');
  dem.push('    // 數值為合成估計,可依實際 NetFlow/sFlow 量測微調。');
  dem.push('    // ─────────────────────────────────────────────────────────────────────');
  dem.push('    asia_busy: {');
  dem.push("      label: 'APAC busy hour',");
  dem.push('      symmetric: false,');
  dem.push(`      default: ${DFLT},`);
  dem.push('      matrix: {');
  dem.push(matrixJs(asia_m));
  dem.push('      },');
  dem.push('    },');
  dem.push('    amer_busy: {');
  dem.push("      label: 'Americas busy hour',");
  dem.push('      symmetric: false,');
  dem.push(`      default: ${DFLT},`);
  dem.push('      matrix: {');
  dem.push(matrixJs(amer_m));
  dem.push('      },');
  dem.push('    },');
  dem.push('    eu_busy: {');
  dem.push("      label: 'Europe busy hour',");
  dem.push('      symmetric: false,');
  dem.push(`      default: ${DFLT},`);
  dem.push('      matrix: {');
  dem.push(matrixJs(eu_m));
  dem.push('      },');
  dem.push('    },');
  dem.push('  },');
  dem.push('');
  dem.push('  // Backward compatibility — engine reads demand.matrix / demand.default');
  dem.push('  get matrix()  { return this.profiles[this.active].matrix; },');
  dem.push('  get default() { return this.profiles[this.active].default; },');
  dem.push('};');
  dem.push('');
  dem.push("if (typeof module !== 'undefined') module.exports = { demand };");
  dem.push('');
  writeFileSync(join(OUT, 'demand.js'), dem.join('\n'));
}

// ── srlg.js ──
{
  const edge_ids = new Set(edges.map(e => e.id));
  const node_ids = new Set(ORDER);
  const valid = affects => affects.filter(m => edge_ids.has(m) || node_ids.has(m));

  const SRLG = [
    ['apcn2', 'APCN-2 海纜', 'submarine', ['e_TPE_TYO', 'e_TYO_SHA']],
    ['apg', 'APG 海纜', 'submarine', ['e_TPE_HKG', 'e_HKG_SIN']],
    ['transpac_north', 'Trans-Pacific North 海纜', 'submarine', ['e_TYO_LAX', 'e_TYO_SEA']],
    ['transpac_tpe', 'Trans-Pacific TPE 海纜', 'submarine', ['e_TPE_LAX', 'e_OSA_SJC']],
    ['smw_eurasia', 'SMW 歐亞海纜', 'submarine', ['e_SIN_BOM', 'e_BOM_LHR']],
    ['transatlantic_n', 'Trans-Atlantic North 海纜', 'submarine', ['e_JFK_LHR', 'e_JFK_FRA']],
    ['transatlantic_s', 'Trans-Atlantic South 海纜', 'submarine', ['e_LAX_LHR']],
    ['eu_fabric', 'EU IX Fabric', 'conduit', ['e_LHR_PN_EU', 'e_FRA_PN_EU', 'e_FRA2_PN_EU']],
    ['as_fabric', 'Asia IX Fabric', 'conduit', ['e_HKG_PN_AS', 'e_SIN_PN_AS', 'e_TPE_PN_AS']],
    ['us_fabric', 'US IX Fabric', 'conduit', ['e_LAX_PN_US', 'e_SJC_PN_US', 'e_SEA_PN_US']],
    ['tpe_site', 'TPE 機房', 'site', ['TPE']],
    ['lax_site', 'LAX 機房', 'site', ['LAX']],
    ['fra_site', 'FRA 機房', 'site', ['FRA']],
    ['sin_site', 'SIN 機房', 'site', ['SIN']],
    ['jfk_site', 'JFK 機房', 'site', ['JFK']],
    ['telia_transit', 'Telia Transit', 'upstream', ['e_LAX_LHR']],
    ['ntt_transit', 'NTT Transit', 'upstream', ['e_TYO_LAX']],
    ['tata_transit', 'Tata Transit', 'upstream', ['e_SIN_BOM']],
  ];
  const typeComment = {
    submarine: '  // submarine — 海纜系統共用風險',
    conduit: '  // conduit — 共管線路 / IX fabric',
    site: '  // site — 機房 / 落地站 / 電力',
    upstream: '  // upstream — 上游 ISP 依賴',
  };
  const sl = [];
  sl.push('// SRLG (Shared Risk Link Group) definitions.');
  sl.push('// Each group lists the edges and/or nodes that share a common failure risk.');
  sl.push('// The "affects" array may contain edge IDs (e_xxx) and node IDs (TPE, LAX, …).');
  sl.push('// expandSRLG() in the UI resolves which are edges vs nodes at runtime.');
  sl.push('const srlg = [');
  let curType = null;
  for (const [sid, label, typ, affects] of SRLG) {
    const va = valid(affects);
    if (!va.length) continue;
    if (typ !== curType) { sl.push(''); sl.push(typeComment[typ]); curType = typ; }
    const aff = va.map(x => `'${x}'`).join(', ');
    sl.push(`  { id: '${sid}', label: '${label}', type: '${typ}', affects: [${aff}] },`);
  }
  sl.push('];');
  sl.push('');
  writeFileSync(join(OUT, 'srlg.js'), sl.join('\n'));
}

// ── 城市層級座標與城市對 RTT ──
const cityMembers = {};
for (const nid of ORDER) (cityMembers[POPS[nid].city] ??= []).push(nid);
const CITY_ORDER = [];
const CITY_GEO = {};
for (const nid of ORDER) {
  const c = POPS[nid].city;
  if (!(c in CITY_GEO)) {
    CITY_ORDER.push(c);
    const ms = cityMembers[c];
    CITY_GEO[c] = [
      ms.reduce((s, m) => s + POPS[m].lat, 0) / ms.length,
      ms.reduce((s, m) => s + POPS[m].lon, 0) / ms.length,
    ];
  }
}
function cityKm(ca, cb) { return haversineKm(CITY_GEO[ca][0], CITY_GEO[ca][1], CITY_GEO[cb][0], CITY_GEO[cb][1]); }
function cityRtt(ca, cb) { return cityKm(ca, cb) * FIBER_RTT_PER_KM; }

// ── rtt.js ──
{
  const rt = [];
  rt.push('// 城市對 RTT 查表(city-pair round-trip latency, ms)。');
  rt.push('// Generated by working/gen.mjs — city×city 對稱矩陣(每城以 PoP 群形心為錨點)。');
  rt.push('// 來源:光纖傳播模型(折射率 1.52,大圈距離 × 常數);實測直連值見 rtt.edges。');
  rt.push('const rtt = {');
  rt.push("  unit: 'ms',");
  rt.push("  note: 'round-trip; matrix keyed by city (PoP centroid), model = great-circle × fiber constant',");
  rt.push(`  fiberRttPerKm: ${pyFloatStr(FIBER_RTT_PER_KM, 6)},`);
  rt.push("  timestamp: '2026-06-04',");
  rt.push('');
  rt.push('  // 城市對矩陣(對稱):rtt.matrix[CityA][CityB] = 估計 RTT(ms)');
  rt.push('  matrix: {');
  for (const ca of CITY_ORDER) {
    const cells = [];
    for (const cb of CITY_ORDER) {
      if (ca === cb) continue;
      let ref = CITY_RTT_MS.get(`${ca} ${cb}`);
      if (ref === undefined) ref = CITY_RTT_MS.get(`${cb} ${ca}`);
      const val = ref !== undefined ? ref : cityRtt(ca, cb);
      cells.push(`${cb}: ${pyFloatStr(val, 2)}`);
    }
    rt.push(`    ${ca}: { ` + cells.join(', ') + ' },');
  }
  rt.push('  },');
  rt.push('  // cityRef 已移除:只是 city_rtt.csv 的鏡像,前端不消費。');
  rt.push('  // 實際成邊的節點對(INTRA + BACKBONE),供前端標示「直連鏈路 RTT」');
  rt.push('  // src: measured = 節點直測(node_rtt.csv);city-ref = 城市參考庫;model = 光纖傳播模型估值');
  const edgePairs = [];
  for (const [a, b] of ALL_PAIRS) {
    const src = rttSrcOf(a, b);
    edgePairs.push(`{ a: '${a}', b: '${b}', rtt: ${pyFloatStr(rttFor(a, b), 2)}, src: '${src}' }`);
  }
  rt.push('  edges: [\n    ' + edgePairs.join(',\n    ') + '\n  ],');
  rt.push('};');
  rt.push('');
  rt.push("if (typeof module !== 'undefined') module.exports = { rtt };");
  rt.push('');
  writeFileSync(join(OUT, 'rtt.js'), rt.join('\n'));
}

// ── 統計輸出 ──
const countries = {};
for (const nid of ORDER) (countries[POPS[nid].country] ??= []).push(nid);
const p2p = edges.filter(e => e.type === 'p2p').length;
const transit = edges.filter(e => e.type === 'transit').length;
console.log(`OK routers=${ORDER.length} countries=${Object.keys(countries).length} edges=${edges.length} `
  + `(p2p=${p2p} transit=${transit}) pseudo=${Object.keys(PSEUDO).length}`);
console.log('  ' + Object.entries(countries).map(([c, ns]) => `${c}:${ns.length}`).join(' '));
console.log(`avg rows=${Object.keys(avg_m).length} max rows=${Object.keys(max_m).length} `
  + `asia=${Object.keys(asia_m).length} amer=${Object.keys(amer_m).length} eu=${Object.keys(eu_m).length}`);
// RTT 來源分佈(讓 CSV 查找表耦合可見:斷掉 / 覆蓋不足 → model 會暴增)
{
  const c = { measured: 0, 'city-ref': 0, model: 0 };
  for (const [a, b] of ALL_PAIRS) if (a in NODES && b in NODES) c[rttSrcOf(a, b)]++;
  const tot = c.measured + c['city-ref'] + c.model;
  console.log(`RTT sources: measured=${c.measured} city-ref=${c['city-ref']} model=${c.model} (共 ${tot} 條成邊 pair)`);
}
