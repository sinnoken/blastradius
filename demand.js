// Demand matrix — Gbps offered between every router pair.
// v2: profiles (avg / max) + per-edge capacity.
// Replace with NetFlow/sFlow-derived TM when available.
const demand = {
  unit: 'Gbps',
  source: 'synthetic-v2',
  timestamp: '2026-05-29',

  // Active profile key — UI will switch this; engine reads demand.matrix
  active: 'avg',

  profiles: {
    avg: {
      label: '月均',
      symmetric: true,
      default: 5,
      matrix: {
        TPE: { TYO: 130, HKG: 257, SIN: 90, LAX: 59, ICN: 106, FRA: 44, AMS: 38, LHR: 34, SYD: 27 },
        TYO: { TPE: 130, HKG: 71, SIN: 40, LAX: 40, ICN: 73, FRA: 26, AMS: 23, LHR: 21, SYD: 16 },
        HKG: { TPE: 257, TYO: 71, SIN: 68, LAX: 38, ICN: 58, FRA: 30, AMS: 26, LHR: 23, SYD: 18 },
        SIN: { TPE: 90, TYO: 40, HKG: 68, LAX: 27, ICN: 28, FRA: 22, AMS: 19, LHR: 17, SYD: 16 },
        LAX: { TPE: 59, TYO: 40, HKG: 38, SIN: 27, ICN: 25, FRA: 32, AMS: 29, LHR: 27, SYD: 15 },
        ICN: { TPE: 106, TYO: 73, HKG: 58, SIN: 28, LAX: 25, FRA: 19, AMS: 16, LHR: 15, SYD: 10 },
        FRA: { TPE: 44, TYO: 26, HKG: 30, SIN: 22, LAX: 32, ICN: 19, AMS: 135, LHR: 87, SYD: 8 },
        AMS: { TPE: 38, TYO: 23, HKG: 26, SIN: 19, LAX: 29, ICN: 16, FRA: 135, LHR: 108, SYD: 7 },
        LHR: { TPE: 34, TYO: 21, HKG: 23, SIN: 17, LAX: 27, ICN: 15, FRA: 87, AMS: 108, SYD: 7 },
        SYD: { TPE: 27, TYO: 16, HKG: 18, SIN: 16, LAX: 15, ICN: 10, FRA: 8, AMS: 7, LHR: 7 },
      },
    },
    max: {
      label: '95th',
      symmetric: false,
      default: 8,
      matrix: {
        TPE: { TYO: 198, HKG: 410, SIN: 135, LAX: 92, ICN: 163, FRA: 68, AMS: 57, LHR: 52, SYD: 41 },
        TYO: { TPE: 175, HKG: 108, SIN: 62, LAX: 68, ICN: 110, FRA: 40, AMS: 35, LHR: 32, SYD: 25 },
        HKG: { TPE: 385, TYO: 95,  SIN: 105, LAX: 58, ICN: 88,  FRA: 46, AMS: 40, LHR: 35, SYD: 28 },
        SIN: { TPE: 122, TYO: 55,  HKG: 92,  LAX: 40, ICN: 42,  FRA: 34, AMS: 29, LHR: 26, SYD: 25 },
        LAX: { TPE: 78,  TYO: 58,  HKG: 52,  SIN: 38, ICN: 36,  FRA: 48, AMS: 44, LHR: 42, SYD: 22 },
        ICN: { TPE: 148, TYO: 98,  HKG: 82,  SIN: 40, LAX: 35,  FRA: 28, AMS: 24, LHR: 22, SYD: 15 },
        FRA: { TPE: 58,  TYO: 38,  HKG: 42,  SIN: 32, LAX: 45,  ICN: 26, AMS: 205, LHR: 132, SYD: 12 },
        AMS: { TPE: 52,  TYO: 32,  HKG: 38,  SIN: 28, LAX: 42,  ICN: 22, FRA: 195, LHR: 165, SYD: 10 },
        LHR: { TPE: 48,  TYO: 30,  HKG: 34,  SIN: 25, LAX: 40,  ICN: 20, FRA: 128, AMS: 155, SYD: 10 },
        SYD: { TPE: 38,  TYO: 22,  HKG: 26,  SIN: 24, LAX: 20,  ICN: 14, FRA: 11,  AMS: 10,  LHR: 10 },
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    // 區域忙時快照 (regional busy-hour snapshots)
    //
    // 動機:max profile 假設「全球同時 95th」,過度悲觀 — 各時區的尖峰並不重疊。
    // 以下三個快照各讓「單一區域」進入忙時(≈1.5×月均,貼近該區 95th),
    // 其餘區域維持離峰(≈0.6×月均)。手動切換可觀察「此刻誰在尖峰」對各鏈路的影響。
    //
    // 區域定義:Asia = TPE/TYO/HKG/SIN/ICN/SYD · Americas = LAX · Europe = FRA/AMS/LHR
    // 規則:某 pair 只要有一端落在忙時區域 → busy(1.5×);兩端皆在其他區域 → 離峰(0.6×)。
    // 數值為合成估計,可依實際 NetFlow/sFlow 量測微調。
    // ─────────────────────────────────────────────────────────────────────
    asia_busy: {
      label: '亞洲忙時',
      symmetric: true,
      default: 5,
      matrix: {
        TPE: { TYO: 195, HKG: 386, SIN: 135, LAX: 89, ICN: 159, FRA: 66, AMS: 57, LHR: 51, SYD: 41 },
        TYO: { TPE: 195, HKG: 107, SIN: 60,  LAX: 60, ICN: 110, FRA: 39, AMS: 35, LHR: 32, SYD: 24 },
        HKG: { TPE: 386, TYO: 107, SIN: 102, LAX: 57, ICN: 87,  FRA: 45, AMS: 39, LHR: 35, SYD: 27 },
        SIN: { TPE: 135, TYO: 60,  HKG: 102, LAX: 41, ICN: 42,  FRA: 33, AMS: 29, LHR: 26, SYD: 24 },
        LAX: { TPE: 89,  TYO: 60,  HKG: 57,  SIN: 41, ICN: 38,  FRA: 19, AMS: 17, LHR: 16, SYD: 23 },
        ICN: { TPE: 159, TYO: 110, HKG: 87,  SIN: 42, LAX: 38,  FRA: 29, AMS: 24, LHR: 23, SYD: 15 },
        FRA: { TPE: 66,  TYO: 39,  HKG: 45,  SIN: 33, LAX: 19,  ICN: 29, AMS: 81, LHR: 52, SYD: 12 },
        AMS: { TPE: 57,  TYO: 35,  HKG: 39,  SIN: 29, LAX: 17,  ICN: 24, FRA: 81, LHR: 65, SYD: 11 },
        LHR: { TPE: 51,  TYO: 32,  HKG: 35,  SIN: 26, LAX: 16,  ICN: 23, FRA: 52, AMS: 65, SYD: 11 },
        SYD: { TPE: 41,  TYO: 24,  HKG: 27,  SIN: 24, LAX: 23,  ICN: 15, FRA: 12, AMS: 11, LHR: 11 },
      },
    },
    amer_busy: {
      label: '美洲忙時',
      symmetric: true,
      default: 5,
      matrix: {
        TPE: { TYO: 78,  HKG: 154, SIN: 54, LAX: 89, ICN: 64, FRA: 26, AMS: 23, LHR: 20, SYD: 16 },
        TYO: { TPE: 78,  HKG: 43,  SIN: 24, LAX: 60, ICN: 44, FRA: 16, AMS: 14, LHR: 13, SYD: 10 },
        HKG: { TPE: 154, TYO: 43,  SIN: 41, LAX: 57, ICN: 35, FRA: 18, AMS: 16, LHR: 14, SYD: 11 },
        SIN: { TPE: 54,  TYO: 24,  HKG: 41, LAX: 41, ICN: 17, FRA: 13, AMS: 11, LHR: 10, SYD: 10 },
        LAX: { TPE: 89,  TYO: 60,  HKG: 57, SIN: 41, ICN: 38, FRA: 48, AMS: 44, LHR: 41, SYD: 23 },
        ICN: { TPE: 64,  TYO: 44,  HKG: 35, SIN: 17, LAX: 38, FRA: 11, AMS: 10, LHR: 9,  SYD: 6 },
        FRA: { TPE: 26,  TYO: 16,  HKG: 18, SIN: 13, LAX: 48, ICN: 11, AMS: 81, LHR: 52, SYD: 5 },
        AMS: { TPE: 23,  TYO: 14,  HKG: 16, SIN: 11, LAX: 44, ICN: 10, FRA: 81, LHR: 65, SYD: 4 },
        LHR: { TPE: 20,  TYO: 13,  HKG: 14, SIN: 10, LAX: 41, ICN: 9,  FRA: 52, AMS: 65, SYD: 4 },
        SYD: { TPE: 16,  TYO: 10,  HKG: 11, SIN: 10, LAX: 23, ICN: 6,  FRA: 5,  AMS: 4,  LHR: 4 },
      },
    },
    eu_busy: {
      label: '歐洲忙時',
      symmetric: true,
      default: 5,
      matrix: {
        TPE: { TYO: 78,  HKG: 154, SIN: 54, LAX: 35, ICN: 64, FRA: 66,  AMS: 57,  LHR: 51,  SYD: 16 },
        TYO: { TPE: 78,  HKG: 43,  SIN: 24, LAX: 24, ICN: 44, FRA: 39,  AMS: 35,  LHR: 32,  SYD: 10 },
        HKG: { TPE: 154, TYO: 43,  SIN: 41, LAX: 23, ICN: 35, FRA: 45,  AMS: 39,  LHR: 35,  SYD: 11 },
        SIN: { TPE: 54,  TYO: 24,  HKG: 41, LAX: 16, ICN: 17, FRA: 33,  AMS: 29,  LHR: 26,  SYD: 10 },
        LAX: { TPE: 35,  TYO: 24,  HKG: 23, SIN: 16, ICN: 15, FRA: 48,  AMS: 44,  LHR: 41,  SYD: 9 },
        ICN: { TPE: 64,  TYO: 44,  HKG: 35, SIN: 17, LAX: 15, FRA: 29,  AMS: 24,  LHR: 23,  SYD: 6 },
        FRA: { TPE: 66,  TYO: 39,  HKG: 45, SIN: 33, LAX: 48, ICN: 29,  AMS: 203, LHR: 131, SYD: 12 },
        AMS: { TPE: 57,  TYO: 35,  HKG: 39, SIN: 29, LAX: 44, ICN: 24,  FRA: 203, LHR: 162, SYD: 11 },
        LHR: { TPE: 51,  TYO: 32,  HKG: 35, SIN: 26, LAX: 41, ICN: 23,  FRA: 131, AMS: 162, SYD: 11 },
        SYD: { TPE: 16,  TYO: 10,  HKG: 11, SIN: 10, LAX: 9,  ICN: 6,   FRA: 12,  AMS: 11,  LHR: 11 },
      },
    },
  },

  // Backward compatibility — engine reads demand.matrix / demand.default
  get matrix()  { return this.profiles[this.active].matrix; },
  get default() { return this.profiles[this.active].default; },
};

if (typeof module !== 'undefined') module.exports = { demand };
