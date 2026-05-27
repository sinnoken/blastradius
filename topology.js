// Exported from BlastRadius POC at 2026-05-27T06:59:05.210Z
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
    { id: "e_TPE_TYO", source: "TPE", target: "TYO", cost: 20, type: "p2p" },
    { id: "e_TPE_ICN", source: "TPE", target: "ICN", cost: 25, type: "p2p" },
    { id: "e_TPE_HKG", source: "TPE", target: "HKG", cost: 5, type: "p2p" },
    { id: "e_ICN_TYO", source: "ICN", target: "TYO", cost: 10, type: "p2p" },
    { id: "e_HKG_TYO", source: "HKG", target: "TYO", cost: 25, type: "p2p" },
    { id: "e_HKG_ICN", source: "HKG", target: "ICN", cost: 20, costRev: 35, type: "p2p" },
    { id: "e_HKG_SIN", source: "HKG", target: "SIN", cost: 20, type: "p2p" },
    { id: "e_SIN_TYO", source: "SIN", target: "TYO", cost: 25, type: "p2p" },
    { id: "e_SIN_SYD", source: "SIN", target: "SYD", cost: 30, costRev: 45, type: "p2p" },
    { id: "e_TYO_SYD", source: "TYO", target: "SYD", cost: 40, type: "p2p" },
    { id: "e_TYO_LAX", source: "TYO", target: "LAX", cost: 50, type: "p2p" },
    { id: "e_LAX_LHR", source: "LAX", target: "LHR", cost: 70, type: "p2p" },
    { id: "e_LAX_AMS", source: "LAX", target: "AMS", cost: 85, type: "p2p" },
    { id: "e_LHR_PN", source: "LHR", target: "PN_EU", cost: 5, type: "transit" },
    { id: "e_FRA_PN", source: "FRA", target: "PN_EU", cost: 5, type: "transit" },
    { id: "e_AMS_PN", source: "AMS", target: "PN_EU", cost: 5, type: "transit" },
    { id: "e_LHR_FRA", source: "LHR", target: "FRA", cost: 10, type: "p2p" },
    { id: "e_SIN_FRA_lease", source: "SIN", target: "FRA", cost: 80, type: "p2p" }
  ],
  externals: [
    { advertising_router: "TPE", subnet: "0.0.0.0/0", metric: 1, metric_type: "E2" }
  ],
  positions: {
    ICN: { x: 289, y: 15 },
    TYO: { x: 380, y: 130 },
    TPE: { x: 126, y: 111 },
    HKG: { x: 129, y: 285 },
    SIN: { x: 297, y: 412 },
    SYD: { x: 453, y: 279 },
    LAX: { x: 572, y: 134 },
    LHR: { x: 753, y: 201 },
    AMS: { x: 754, y: 42 },
    FRA: { x: 754, y: 412 },
    PN_EU: { x: 887, y: 194 }
  },
};
