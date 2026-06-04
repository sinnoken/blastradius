// SRLG (Shared Risk Link Group) definitions.
// Each group lists the edges and/or nodes that share a common failure risk.
// The "affects" array may contain edge IDs (e_xxx) and node IDs (TPE, LAX, …).
// expandSRLG() in the UI resolves which are edges vs nodes at runtime.
const srlg = [

  // submarine — 海纜系統共用風險
  { id: 'apcn2', label: 'APCN-2 海纜', type: 'submarine', affects: ['e_TPE_TYO', 'e_ICN_TYO'] },
  { id: 'apg', label: 'APG 海纜', type: 'submarine', affects: ['e_TPE_HKG', 'e_HKG_SIN'] },
  { id: 'transpac_north', label: 'Trans-Pacific North 海纜', type: 'submarine', affects: ['e_TYO_LAX', 'e_TYO_SEA'] },
  { id: 'transpac_hawaii', label: 'Trans-Pacific Hawaii 海纜', type: 'submarine', affects: ['e_TYO_HNL', 'e_HNL_SJC', 'e_HNL_LAX'] },
  { id: 'smw_eurasia', label: 'SMW 歐亞海纜', type: 'submarine', affects: ['e_SIN_BOM', 'e_BKK_BOM'] },
  { id: 'transatlantic_n', label: 'Trans-Atlantic North 海纜', type: 'submarine', affects: ['e_JFK_LHR', 'e_JFK_FRA'] },
  { id: 'transatlantic_s', label: 'Trans-Atlantic South 海纜', type: 'submarine', affects: ['e_IAD_AMS', 'e_LAX_LHR'] },
  { id: 'south_atlantic', label: 'South-Atlantic 海纜', type: 'submarine', affects: ['e_JFK_GRU', 'e_MAD_GRU'] },
  { id: 'gulf_eu', label: 'Gulf-EU 海纜', type: 'submarine', affects: ['e_DXB_MAD', 'e_DXB_IST'] },

  // conduit — 共管線路 / IX fabric
  { id: 'eu_fabric', label: 'EU IX Fabric', type: 'conduit', affects: ['e_LHR_PN_EU', 'e_FRA_PN_EU', 'e_AMS_PN_EU'] },
  { id: 'as_fabric', label: 'Asia IX Fabric', type: 'conduit', affects: ['e_HKG_PN_AS', 'e_SIN_PN_AS', 'e_TPE_PN_AS'] },
  { id: 'us_fabric', label: 'US IX Fabric', type: 'conduit', affects: ['e_LAX_PN_US', 'e_SJC_PN_US', 'e_SEA_PN_US'] },

  // site — 機房 / 落地站 / 電力
  { id: 'tpe_site', label: 'TPE 機房', type: 'site', affects: ['TPE'] },
  { id: 'lax_site', label: 'LAX 機房', type: 'site', affects: ['LAX'] },
  { id: 'fra_site', label: 'FRA 機房', type: 'site', affects: ['FRA'] },
  { id: 'sin_site', label: 'SIN 機房', type: 'site', affects: ['SIN'] },
  { id: 'jfk_site', label: 'JFK 機房', type: 'site', affects: ['JFK'] },

  // upstream — 上游 ISP 依賴
  { id: 'telia_transit', label: 'Telia Transit', type: 'upstream', affects: ['e_LAX_LHR'] },
  { id: 'ntt_transit', label: 'NTT Transit', type: 'upstream', affects: ['e_TYO_LAX'] },
  { id: 'tata_transit', label: 'Tata Transit', type: 'upstream', affects: ['e_SIN_BOM'] },
  { id: 'gtt_transit', label: 'GTT Transit', type: 'upstream', affects: ['e_IAD_AMS'] },
];
