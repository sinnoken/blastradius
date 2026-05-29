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
  },

  // Backward compatibility — engine reads demand.matrix / demand.default
  get matrix()  { return this.profiles[this.active].matrix; },
  get default() { return this.profiles[this.active].default; },
};

if (typeof module !== 'undefined') module.exports = { demand };
