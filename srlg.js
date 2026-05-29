// SRLG (Shared Risk Link Group) definitions.
// Each group lists the edges and/or nodes that share a common failure risk.
// The "affects" array may contain edge IDs (e_xxx) and node IDs (TPE, LAX, …).
// expandSRLG() in the UI resolves which are edges vs nodes at runtime.
const srlg = [
  // submarine — 海纜系統共用風險
  { id: 'apcn2',        label: 'APCN-2 海纜',          type: 'submarine', affects: ['e_TPE_TYO', 'e_ICN_TYO'] },
  { id: 'apg',          label: 'APG 海纜',             type: 'submarine', affects: ['e_TPE_HKG', 'e_HKG_SIN'] },
  { id: 'transpacific', label: 'Trans-Pacific 海纜',   type: 'submarine', affects: ['e_TYO_LAX'] },
  { id: 'smw5',         label: 'SMW-5 歐亞海纜',       type: 'submarine', affects: ['e_SIN_FRA_lease'] },
  { id: 'transatlantic',label: 'Trans-Atlantic 海纜',  type: 'submarine', affects: ['e_LAX_LHR', 'e_LAX_AMS'] },

  // conduit — 共管線路 / IX fabric
  { id: 'eu_fabric',    label: 'EU IX Fabric',         type: 'conduit',   affects: ['e_LHR_PN', 'e_FRA_PN', 'e_AMS_PN'] },

  // site — 機房 / 落地站 / 電力
  { id: 'tpe_site',     label: 'TPE 機房',             type: 'site',      affects: ['TPE'] },
  { id: 'lax_site',     label: 'LAX 機房',             type: 'site',      affects: ['LAX'] },
  { id: 'sin_site',     label: 'SIN 機房',             type: 'site',      affects: ['SIN'] },

  // upstream — 上游 ISP 依賴
  { id: 'telia_transit', label: 'Telia Transit',       type: 'upstream',  affects: ['e_LAX_LHR'] },
];
