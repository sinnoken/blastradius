// Exported from BlastRadius POC at 2026-05-27T07:59:13.748Z
const topology = {
  nodes: [
    { id: "TPE", label: "TPE\nTW", type: "router", area: "0", stubs: ["1.1.1.1/32","10.1.0.0/24","100.64.0.0/24"], isASBR: true, isABR: false },
    { id: "TYO", label: "TYO\nJP", type: "router", area: "0", stubs: ["2.2.2.2/32","10.2.0.0/24","100.64.1.0/24"], isASBR: false, isABR: false },
    { id: "ICN", label: "ICN\nKR", type: "router", area: "0", stubs: ["3.3.3.3/32","10.3.0.0/24"], isASBR: false, isABR: false },
    { id: "HKG", label: "HKG\nHK", type: "router", area: "0", stubs: ["4.4.4.4/32","10.4.0.0/24","100.64.0.0/24"], isASBR: false, isABR: false },
    { id: "SIN", label: "SIN\nSG", type: "router", area: "0", stubs: ["5.5.5.5/32","10.5.0.0/24"], isASBR: false, isABR: false },
    { id: "SYD", label: "SYD\nAU", type: "router", area: "0", stubs: ["6.6.6.6/32","10.6.0.0/24","10.6.99.0/24"], isASBR: false, isABR: false },
    { id: "LAX", label: "LAX\nUS", type: "router", area: "0", stubs: ["7.7.7.7/32","10.7.0.0/24","100.64.1.0/24"], isASBR: false, isABR: false },
    { id: "LHR", label: "LHR\nUK", type: "router", area: "0", stubs: ["8.8.8.8/32","10.8.0.0/24"], isASBR: false, isABR: false },
    { id: "FRA", label: "FRA\nDE", type: "router", area: "0", stubs: ["9.9.9.9/32","10.9.0.0/24","10.9.99.0/24"], isASBR: false, isABR: false },
    { id: "AMS", label: "AMS\nNL", type: "router", area: "0", stubs: ["10.10.10.10/32","10.10.0.0/24","10.10.99.0/24"], isASBR: false, isABR: false },
    { id: "PN_EU", label: "PN_EU\n192.168.100.0/24", type: "pseudonode", subnet: "192.168.100.0/24" }
  ],
  edges: [
    { id: "e_TPE_TYO", source: "TPE", target: "TYO", cost: 20, capacity: 800, type: "p2p" },
    { id: "e_TPE_ICN", source: "TPE", target: "ICN", cost: 25, capacity: 600, type: "p2p" },
    { id: "e_TPE_HKG", source: "TPE", target: "HKG", cost: 5, capacity: 1300, type: "p2p" },
    { id: "e_ICN_TYO", source: "ICN", target: "TYO", cost: 10, capacity: 600, type: "p2p" },
    { id: "e_HKG_TYO", source: "HKG", target: "TYO", cost: 25, capacity: 400, type: "p2p" },
    { id: "e_HKG_ICN", source: "HKG", target: "ICN", cost: 20, costRev: 35, capacity: 400, type: "p2p" },
    { id: "e_HKG_SIN", source: "HKG", target: "SIN", cost: 20, capacity: 700, type: "p2p" },
    { id: "e_SIN_TYO", source: "SIN", target: "TYO", cost: 25, capacity: 800, type: "p2p" },
    { id: "e_SIN_SYD", source: "SIN", target: "SYD", cost: 30, costRev: 45, capacity: 400, type: "p2p" },
    { id: "e_TYO_SYD", source: "TYO", target: "SYD", cost: 40, capacity: 400, type: "p2p" },
    { id: "e_TYO_LAX", source: "TYO", target: "LAX", cost: 50, capacity: 600, type: "p2p" },
    { id: "e_LAX_LHR", source: "LAX", target: "LHR", cost: 70, capacity: 400, type: "p2p" },
    { id: "e_LAX_AMS", source: "LAX", target: "AMS", cost: 85, costRev: 70, capacity: 200, type: "p2p" },
    { id: "e_LHR_PN", source: "LHR", target: "PN_EU", cost: 5, capacity: 1200, type: "transit" },
    { id: "e_FRA_PN", source: "FRA", target: "PN_EU", cost: 5, capacity: 1200, type: "transit" },
    { id: "e_AMS_PN", source: "AMS", target: "PN_EU", cost: 5, capacity: 900, type: "transit" },
    { id: "e_LHR_FRA", source: "LHR", target: "FRA", cost: 5, costRev: 10, capacity: 400, type: "p2p" },
    { id: "e_SIN_FRA_lease", source: "SIN", target: "FRA", cost: 80, costRev: 70, capacity: 600, type: "p2p" }
  ],
  externals: [
    { advertising_router: "TPE", subnet: "0.0.0.0/0", metric: 1, metric_type: "E2" }
  ],
  positions: {
    ICN: { x: 290, y: 32 },
    TYO: { x: 366, y: 176 },
    TPE: { x: 126, y: 111 },
    HKG: { x: 196, y: 263 },
    SIN: { x: 266, y: 404 },
    SYD: { x: 436, y: 312 },
    LAX: { x: 577, y: 177 },
    LHR: { x: 734, y: 176 },
    AMS: { x: 735, y: 42 },
    FRA: { x: 739, y: 399 },
    PN_EU: { x: 886, y: 171 }
  },
};
