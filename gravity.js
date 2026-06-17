// gravity.js — 重力模型共用常數、城市地理資料與 mass 函式(SSOT)
// output/ 位置讓 browser(edit.html) 與 Node 工具(gen.mjs/companions.mjs/ospf-import.js) 皆可 import。
// 對齊 engine.js 模式:純常數 + 純函式,無 DOM / fs 依賴。

// ── 重力模型核心常數 ──────────────────────────────────────────────────────
export const GRAVITY_D0   = 3000;    // 距離衰減特徵長度(km);同城 → 不衰減,跨洋 → 剩 25%
export const GRAVITY_K    = 1;       // 重力常數;與 SCALE 合併決定量級,顯式保留以對齊公式
export const GRAVITY_EMIT = 0.001;   // 最小 demand 門檻(Gbps,浮點精度);低於此值的 pair 捨棄

// ── 地理 / RTT 常數 ────────────────────────────────────────────────────────
export const EARTH_RADIUS_KM   = 6371;                           // 地球平均半徑(km)
export const FIBER_RTT_PER_KM  = 1.52 / 299792.458 * 1000 * 2; // 光纖來回延遲(ms/km);折射率 1.52

// ── 忙時 profile 倍數 ──────────────────────────────────────────────────────
// 對齊 gen.mjs / companions.mjs 的 busyFn;CLI 可覆蓋(gen.mjs),companions 固定用此值。
export const DEMAND_BUSY_MULT = 4;   // 區域忙時倍數
export const DEMAND_DOWN_SKEW = 5;   // 流入忙時區(下載)放大倍數
export const DEMAND_UP_SKEW   = 0.1; // 流出忙時區(上傳)縮小倍數
export const DEMAND_OFF_MULT  = 0.6; // 非忙時區離峰倍數
export const DEMAND_TARGET_MLU= 0.6; // companions auto-calibration MLU 目標

/**
 * 節點 mass = stubs 數量 + 連接 edge 的 capacity 加總
 *
 * 語意：
 *   stubs  = 宣告了幾條 IP prefix(prefix 越多,通常 eyeball 流量越大)
 *   cap    = 連接的鏈路頻寬加總(頻寬大的節點通常流量大)
 *
 * 兩條生成路徑都能用:
 *   gen.mjs     → edges = 已建好的 edge array, stubs = stubsFor() 回傳的陣列
 *   companions  → edges = topology.edges,      stubs = node.stubs || []
 *
 * @param {string}   nodeId
 * @param {Array}    edges    - edge 物件陣列(含 source, target, capacity)
 * @param {Array}    stubs    - 該節點的 CIDR stub 陣列(可空)
 * @returns {number}          - mass ≥ 0
 */
export function gravityMass(nodeId, edges, stubs = []) {
  const cap = edges
    .filter(e => e.source === nodeId || e.target === nodeId)
    .reduce((s, e) => s + (e.capacity ?? 0), 0);
  return stubs.length + cap;
}

// ── 城市地理資料(SSOT)────────────────────────────────────────────────────────
// city code → { lat, lon, country }
// 涵蓋 OSPF_CITY 所有城市 + gen.mjs POPS 用到的城市。
// 用途:重力模型距離計算、RTT 估算、ospf-import.js 的 country 查表、edit.html Inspector。
export const CITY_GEO = {
  // ── 台灣 ──────────────────────────────────────────────────────────────────
  TPE: { lat:25.0,   lon:121.5,  country:'TW' },  // 台北
  TXG: { lat:24.15,  lon:120.67, country:'TW' },  // 台中
  KHH: { lat:22.6,   lon:120.3,  country:'TW' },  // 高雄
  HSZ: { lat:24.8,   lon:121.0,  country:'TW' },  // 新竹
  // ── 日本 ──────────────────────────────────────────────────────────────────
  TYO: { lat:35.7,   lon:139.7,  country:'JP' },  // 東京
  OSA: { lat:34.7,   lon:135.5,  country:'JP' },  // 大阪
  NGO: { lat:35.2,   lon:136.9,  country:'JP' },  // 名古屋
  FUK: { lat:33.6,   lon:130.4,  country:'JP' },  // 福岡
  OKA: { lat:26.33,  lon:127.80, country:'JP' },  // 沖繩
  SDJ: { lat:38.26,  lon:140.90, country:'JP' },  // 仙台
  HIJ: { lat:34.40,  lon:132.47, country:'JP' },  // 廣島
  // ── 韓國 ──────────────────────────────────────────────────────────────────
  SEL: { lat:37.57,  lon:126.98, country:'KR' },  // 首爾
  PUS: { lat:35.18,  lon:129.07, country:'KR' },  // 釜山
  // ── 中國 ──────────────────────────────────────────────────────────────────
  SHA: { lat:31.2,   lon:121.5,  country:'CN' },  // 上海
  BJS: { lat:39.9,   lon:116.4,  country:'CN' },  // 北京(都會碼)
  CAN: { lat:23.1,   lon:113.3,  country:'CN' },  // 廣州
  SZX: { lat:22.5,   lon:114.1,  country:'CN' },  // 深圳
  CTU: { lat:30.6,   lon:104.1,  country:'CN' },  // 成都
  WUH: { lat:30.6,   lon:114.3,  country:'CN' },  // 武漢
  NKG: { lat:32.05,  lon:118.80, country:'CN' },  // 南京
  HGH: { lat:30.25,  lon:120.17, country:'CN' },  // 杭州
  XMN: { lat:24.48,  lon:118.08, country:'CN' },  // 廈門
  TSN: { lat:39.13,  lon:117.20, country:'CN' },  // 天津
  DLC: { lat:38.92,  lon:121.63, country:'CN' },  // 大連
  SHE: { lat:41.80,  lon:123.43, country:'CN' },  // 瀋陽
  TAO: { lat:36.06,  lon:120.38, country:'CN' },  // 青島
  // ── 香港 ──────────────────────────────────────────────────────────────────
  HKG: { lat:22.3,   lon:114.2,  country:'HK' },  // 香港
  // ── 新加坡 ────────────────────────────────────────────────────────────────
  SIN: { lat:1.35,   lon:103.8,  country:'SG' },  // 新加坡
  // ── 東南亞 ────────────────────────────────────────────────────────────────
  BKK: { lat:13.75,  lon:100.50, country:'TH' },  // 曼谷
  MNL: { lat:14.60,  lon:120.98, country:'PH' },  // 馬尼拉
  HAN: { lat:21.03,  lon:105.85, country:'VN' },  // 河內
  SGN: { lat:10.82,  lon:106.63, country:'VN' },  // 胡志明市
  KUL: { lat:3.14,   lon:101.69, country:'MY' },  // 吉隆坡
  JKT: { lat:-6.20,  lon:106.85, country:'ID' },  // 雅加達
  SUB: { lat:-7.25,  lon:112.75, country:'ID' },  // 泗水
  RGN: { lat:16.87,  lon:96.18,  country:'MM' },  // 仰光
  PNH: { lat:11.56,  lon:104.92, country:'KH' },  // 金邊
  // ── 南亞 ──────────────────────────────────────────────────────────────────
  BOM: { lat:19.1,   lon:72.9,   country:'IN' },  // 孟買
  DEL: { lat:28.6,   lon:77.1,   country:'IN' },  // 德里
  MAA: { lat:13.1,   lon:80.3,   country:'IN' },  // 清奈
  BLR: { lat:13.0,   lon:77.6,   country:'IN' },  // 班加羅爾
  CCU: { lat:22.57,  lon:88.37,  country:'IN' },  // 加爾各答
  HYD: { lat:17.44,  lon:78.46,  country:'IN' },  // 海德拉巴
  CMB: { lat:6.90,   lon:79.86,  country:'LK' },  // 可倫坡
  DAC: { lat:23.72,  lon:90.40,  country:'BD' },  // 達卡
  // ── 中東 ──────────────────────────────────────────────────────────────────
  DXB: { lat:25.20,  lon:55.27,  country:'AE' },  // 杜拜
  DOH: { lat:25.28,  lon:51.53,  country:'QA' },  // 杜哈
  IST: { lat:41.00,  lon:28.98,  country:'TR' },  // 伊斯坦堡
  TLV: { lat:32.08,  lon:34.78,  country:'IL' },  // 特拉維夫
  RUH: { lat:24.69,  lon:46.72,  country:'SA' },  // 利雅德
  // ── 俄羅斯 ────────────────────────────────────────────────────────────────
  SVO: { lat:55.97,  lon:37.41,  country:'RU' },  // 莫斯科
  LED: { lat:59.98,  lon:30.30,  country:'RU' },  // 聖彼得堡
  // ── 歐洲 ──────────────────────────────────────────────────────────────────
  LON: { lat:51.5,   lon:-0.13,  country:'GB' },  // 倫敦
  MAN: { lat:53.4,   lon:-2.2,   country:'GB' },  // 曼徹斯特
  FRA: { lat:50.0,   lon:8.6,    country:'DE' },  // 法蘭克福
  MUC: { lat:48.1,   lon:11.6,   country:'DE' },  // 慕尼黑
  HAM: { lat:53.55,  lon:9.99,   country:'DE' },  // 漢堡
  AMS: { lat:52.37,  lon:4.90,   country:'NL' },  // 阿姆斯特丹
  PAR: { lat:48.85,  lon:2.35,   country:'FR' },  // 巴黎
  BRU: { lat:50.85,  lon:4.35,   country:'BE' },  // 布魯塞爾
  MAD: { lat:40.42,  lon:-3.70,  country:'ES' },  // 馬德里
  BCN: { lat:41.39,  lon:2.17,   country:'ES' },  // 巴塞隆納
  LIS: { lat:38.72,  lon:-9.14,  country:'PT' },  // 里斯本
  MIL: { lat:45.46,  lon:9.19,   country:'IT' },  // 米蘭
  ROM: { lat:41.90,  lon:12.50,  country:'IT' },  // 羅馬
  ATH: { lat:37.98,  lon:23.73,  country:'GR' },  // 雅典
  VIE: { lat:48.21,  lon:16.37,  country:'AT' },  // 維也納
  ZRH: { lat:47.38,  lon:8.54,   country:'CH' },  // 蘇黎世
  WAW: { lat:52.23,  lon:21.01,  country:'PL' },  // 華沙
  STO: { lat:59.33,  lon:18.07,  country:'SE' },  // 斯德哥爾摩
  CPH: { lat:55.68,  lon:12.57,  country:'DK' },  // 哥本哈根
  OSL: { lat:59.91,  lon:10.75,  country:'NO' },  // 奧斯陸
  HEL: { lat:60.17,  lon:24.94,  country:'FI' },  // 赫爾辛基
  DUB: { lat:53.35,  lon:-6.26,  country:'IE' },  // 都柏林
  // ── 美國 ──────────────────────────────────────────────────────────────────
  LAX: { lat:34.0,   lon:-118.2, country:'US' },  // 洛杉磯
  SJC: { lat:37.3,   lon:-121.9, country:'US' },  // 聖荷西
  PAO: { lat:37.44,  lon:-122.14,country:'US' },  // Palo Alto
  SEA: { lat:47.6,   lon:-122.3, country:'US' },  // 西雅圖
  PDX: { lat:45.59,  lon:-122.60,country:'US' },  // 波特蘭
  SAN: { lat:32.73,  lon:-117.20,country:'US' },  // 聖地牙哥
  LAS: { lat:36.08,  lon:-115.15,country:'US' },  // 拉斯維加斯
  PHX: { lat:33.43,  lon:-112.01,country:'US' },  // 鳳凰城
  DEN: { lat:39.86,  lon:-104.67,country:'US' },  // 丹佛
  SLC: { lat:40.79,  lon:-111.98,country:'US' },  // 鹽湖城
  NYC: { lat:40.71,  lon:-74.0,  country:'US' },  // 紐約
  BOS: { lat:42.36,  lon:-71.06, country:'US' },  // 波士頓
  WAS: { lat:38.9,   lon:-77.04, country:'US' },  // 華盛頓
  CHI: { lat:41.88,  lon:-87.63, country:'US' },  // 芝加哥
  MSP: { lat:44.88,  lon:-93.22, country:'US' },  // 明尼阿波利斯
  DTW: { lat:42.21,  lon:-83.35, country:'US' },  // 底特律
  DFW: { lat:32.78,  lon:-96.80, country:'US' },  // 達拉斯
  ATL: { lat:33.7,   lon:-84.4,  country:'US' },  // 亞特蘭大
  MIA: { lat:25.79,  lon:-80.29, country:'US' },  // 邁阿密
  MCO: { lat:28.43,  lon:-81.31, country:'US' },  // 奧蘭多
  TPA: { lat:27.98,  lon:-82.53, country:'US' },  // 坦帕
  CLT: { lat:35.22,  lon:-80.94, country:'US' },  // 夏洛特
  BNA: { lat:36.12,  lon:-86.68, country:'US' },  // 納許維爾
  MSY: { lat:29.99,  lon:-90.26, country:'US' },  // 紐奧良
  HNL: { lat:21.32,  lon:-157.92,country:'US' },  // 檀香山
  // ── 加拿大 ────────────────────────────────────────────────────────────────
  YVR: { lat:49.28,  lon:-123.12,country:'CA' },  // 溫哥華
  YYZ: { lat:43.65,  lon:-79.38, country:'CA' },  // 多倫多
  YUL: { lat:45.47,  lon:-73.74, country:'CA' },  // 蒙特婁
  YEG: { lat:53.56,  lon:-113.53,country:'CA' },  // 艾德蒙頓
  // ── 拉丁美洲 ──────────────────────────────────────────────────────────────
  MEX: { lat:19.43,  lon:-99.13, country:'MX' },  // 墨西哥市
  GRU: { lat:-23.43, lon:-46.47, country:'BR' },  // 聖保羅
  GIG: { lat:-22.81, lon:-43.25, country:'BR' },  // 里約熱內盧
  FOR: { lat:-3.78,  lon:-40.55, country:'BR' },  // 福塔雷薩(lon 微調至 seam 40°W 右側，避免 LON0=140°E 投影跑到歐洲左邊)
  POA: { lat:-29.98, lon:-51.18, country:'BR' },  // 阿雷格里港
  BOG: { lat:4.70,   lon:-74.14, country:'CO' },  // 波哥大
  LIM: { lat:-12.02, lon:-77.10, country:'PE' },  // 利馬
  SCL: { lat:-33.39, lon:-70.79, country:'CL' },  // 聖地牙哥
  EZE: { lat:-34.82, lon:-58.54, country:'AR' },  // 布宜諾斯艾利斯
  PTY: { lat:8.99,   lon:-79.54, country:'PA' },  // 巴拿馬市
  CCS: { lat:10.60,  lon:-66.99, country:'VE' },  // 卡拉卡斯
  // ── 非洲 ──────────────────────────────────────────────────────────────────
  JNB: { lat:-26.13, lon:28.24,  country:'ZA' },  // 約翰尼斯堡
  CPT: { lat:-33.96, lon:18.60,  country:'ZA' },  // 開普敦
  CAI: { lat:30.06,  lon:31.22,  country:'EG' },  // 開羅
  LOS: { lat:6.57,   lon:3.32,   country:'NG' },  // 拉哥斯
  NBO: { lat:-1.32,  lon:36.93,  country:'KE' },  // 奈洛比
  CMN: { lat:33.57,  lon:-7.59,  country:'MA' },  // 卡薩布蘭卡
  LAD: { lat:-8.84,  lon:13.23,  country:'AO' },  // 魯安達
  DAR: { lat:-6.77,  lon:39.27,  country:'TZ' },  // 三蘭港
  // ── 澳洲 / 紐西蘭 ────────────────────────────────────────────────────────
  SYD: { lat:-33.9,  lon:151.2,  country:'AU' },  // 雪梨
  MEL: { lat:-37.8,  lon:144.9,  country:'AU' },  // 墨爾本
  PER: { lat:-31.95, lon:115.9,  country:'AU' },  // 伯斯
  BNE: { lat:-27.5,  lon:153.0,  country:'AU' },  // 布里斯本
  ADL: { lat:-34.93, lon:138.60, country:'AU' },  // 阿德萊德
  AKL: { lat:-36.85, lon:174.76, country:'NZ' },  // 奧克蘭
  CHC: { lat:-43.49, lon:172.54, country:'NZ' },  // 基督城
  // ── 太平洋 ────────────────────────────────────────────────────────────────
  GUM: { lat:13.48,  lon:144.80, country:'GU' },  // 關島
};

// ── haversine 大圈距離(km)── city geo 兩點間 ───────────────────────────────
// 接受 {lat,lon} 物件,供 gen.mjs / companions.mjs / ospf-import.js 共用。
export function haversineKmCity(a, b) {
  const R = EARTH_RADIUS_KM, d = Math.PI / 180;
  const dLa = (b.lat - a.lat) * d, dLo = (b.lon - a.lon) * d;
  const h = Math.sin(dLa/2)**2 + Math.cos(a.lat*d)*Math.cos(b.lat*d)*Math.sin(dLo/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
