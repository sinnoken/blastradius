// Demand matrix — Gbps offered between every router pair.
// v1 placeholder; replace with NetFlow/sFlow-derived TM when available.
const demand = {
  unit: 'Gbps',
  source: 'synthetic-v1',
  timestamp: '2026-05-28',
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
};

if (typeof module !== 'undefined') module.exports = { demand };
