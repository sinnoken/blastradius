// ════════════════════════════════════════════════════════════════════════
// Shared OSPF LSDB importer — SINGLE SOURCE used by both edit.html (browser)
// and working/ospf_to_topology.mjs (Node). PURE: no DOM, no fs.
// parseOspfLsdb(lsdbText, ridMapText?) → { nodes, edges, pnNodes, stats }
//   • Cisco `show ip ospf database router / network` 輸出。
//   • Model B:2 成員 transit /30 收斂成 p2p(cost/costRev=兩端 metric);≥3 成員保留 pseudonode + transit 邊。
//   • RID↔hostname 表(選填)→ 短 id「城市3碼+序號」、label=hostname、city/country;無對應退回 RID-based id。
//   • 解析靠「LSA 欄位角色」區分 RID 與介面 IP(兩者都長得像 IP)。capacity 無從得知 → placeholder。
// ════════════════════════════════════════════════════════════════════════

export const OSPF_PLACEHOLDER_CAP = 1;   // 預設 1G(Gbps,與 demand 同單位)— OSPF 不帶頻寬,占位,匯入後策展填真值

// hostname 前綴 → [城市3碼, 國家]。前綴 = 第一段去尾數字(TP3→TP, NY3→NY, CNSH3→CNSH)。
export const OSPF_CITY = {
  TP:['TPE','TW'], TC:['TXG','TW'], KS:['KHH','TW'], PCPD:['TPE','TW'], ZS:['HSZ','TW'],
  HK:['HKG','HK'], SG:['SIN','SG'], JP:['TYO','JP'], JPOS:['OSA','JP'], KR:['SEL','KR'],
  THAI:['BKK','TH'], PHIL:['MNL','PH'], AUST:['SYD','AU'], VN:['HAN','VN'], CB:['PNH','KH'],
  CNSH:['SHA','CN'], CNSZ:['SZX','CN'], LA:['LAX','US'], CHI:['CHI','US'], NY:['NYC','US'],
  PA:['PAO','US'], VCV:['YVR','CA'], TRT:['YYZ','CA'], LD:['LON','GB'], FKT:['FRA','DE'], AMS:['AMS','NL'],
};

export function ospfMaskToPrefix(m){
  if(!m) return null; if(m[0]==='/') return parseInt(m.slice(1),10);
  const o=m.split('.').map(Number); if(o.length!==4||o.some(Number.isNaN)) return null;
  let b=0; for(const x of o) b+=(x>>>0).toString(2).split('1').length-1; return b;
}
export const ospfSid = rid => rid.replace(/\./g,'_');

export function ospfGuessCity(hostname){
  if(!hostname) return null;
  const base=hostname.split('_')[0].replace(/\d+$/,'');        // 第一段去尾數字
  const hit=OSPF_CITY[base];
  if(hit) return { city:hit[0], country:hit[1] };
  return { city:base.slice(0,4).toUpperCase()||'UNK', country:'' };  // fallback:前綴當城市碼
}

// 容錯解析 RID↔hostname 表:每行兩欄(逗號/空白/tab),自動判斷哪欄是 IP。
export function ospfParseRidMap(text){
  const map={}; if(!text) return map;
  for(const ln of String(text).split(/\r?\n/)){
    const parts=ln.trim().split(/[,\s\t]+/).filter(Boolean); if(parts.length<2) continue;
    const ipIdx=parts.findIndex(p=>/^\d{1,3}(\.\d{1,3}){3}$/.test(p)); if(ipIdx<0) continue;
    map[parts[ipIdx]] = parts[ipIdx===0?1:0];
  }
  return map;
}

export function parseOspfLsdb(lsdbText, ridMapText){
  const IP='([\\d.]+)', lines=String(lsdbText).split(/\r?\n/);
  const blocks=[]; let cur=null;
  for(const ln of lines){ if(/^\s*LS age:/.test(ln)){ cur=[ln]; blocks.push(cur);} else if(cur) cur.push(ln); }
  const routers=new Map(), nets=new Map();
  const getR=rid=>routers.get(rid)||(routers.set(rid,{rid,isASBR:false,isABR:false,stubs:[],transit:[],p2p:[]}),routers.get(rid));
  for(const b of blocks){
    const tx=b.join('\n');
    const type=(tx.match(/LS Type:\s*(Router Links|Network Links)/)||[])[1];
    if(type==='Router Links'){
      const adv=(tx.match(new RegExp('Advertising Router:\\s*'+IP))||[])[1]; if(!adv) continue;
      const r=getR(adv);
      if(/AS Boundary Router/.test(tx)) r.isASBR=true;
      if(/Area Border Router/.test(tx)) r.isABR=true;
      for(let i=0;i<b.length;i++){
        const m=b[i].match(/Link connected to:\s*(.+)$/); if(!m) continue;
        const kind=m[1].trim(), win=b.slice(i,i+6).join('\n');
        const metric=parseInt((win.match(/TOS 0 Metrics:\s*(\d+)/)||[])[1],10);
        if(/point-to-point/.test(kind)){ const nbr=(win.match(new RegExp('Neighboring Router ID:\\s*'+IP))||[])[1]; if(nbr) r.p2p.push({nbr,metric}); }
        else if(/Transit Network/.test(kind)){ const dr=(win.match(new RegExp('Designated Router address:\\s*'+IP))||[])[1]; if(dr) r.transit.push({dr,metric}); }
        else if(/Stub Network/.test(kind)){ const net=(win.match(new RegExp('Network/subnet number:\\s*'+IP))||[])[1];
          const mask=(win.match(new RegExp('Network Mask:\\s*'+IP))||[])[1], pfx=ospfMaskToPrefix(mask);
          if(net&&pfx!=null) r.stubs.push(net+'/'+pfx); }
      }
    } else if(type==='Network Links'){
      const dr=(tx.match(/Link State ID:\s*([\d.]+)/)||[])[1];
      const mask=(tx.match(/Network Mask:\s*(\/\d+|[\d.]+)/)||[])[1];
      const members=[...tx.matchAll(new RegExp('Attached Router:\\s*'+IP,'g'))].map(x=>x[1]);
      if(dr) nets.set(dr,{dr,mask,prefix:ospfMaskToPrefix(mask),members});
    }
  }
  if(!routers.size) throw new Error('沒有解析到 Router LSA — 確認貼的是 show ip ospf database router 的輸出');
  let transitLinkCount=0; for(const r of routers.values()) transitLinkCount+=r.transit.length;
  if(transitLinkCount && !nets.size) throw new Error('有 transit 介面卻沒有 Network LSA — 請把 show ip ospf database network 的輸出也一起貼上');

  // RID↔hostname 表(選填)→ 短 id:有 hostname → 城市3碼+序號(同城以 RID 排序、確定性);無 → 退回 RID-based id。
  const ridMap=ospfParseRidMap(ridMapText);
  const ridSorted=[...routers.keys()].sort();
  const cityCount={}, ridToId={}, ridCity={};
  for(const rid of ridSorted){
    const g=ospfGuessCity(ridMap[rid]); ridCity[rid]=g;
    if(g){ const c=g.city; cityCount[c]=(cityCount[c]||0)+1; ridToId[rid]=c+cityCount[c]; }
    else ridToId[rid]='R_'+ospfSid(rid);          // 無 hostname → 開頭字母的安全 id(避免選擇器/數字分隔符雷)
  }
  const idOf=rid=>ridToId[rid]||('R_'+ospfSid(rid));
  let cityMapped=0;
  const nodes=ridSorted.map(rid=>{ const r=routers.get(rid), hn=ridMap[rid], g=ridCity[rid]; if(g) cityMapped++;
    const cc=g?g.country:'', nm=hn||ridToId[rid];          // 名稱:hostname 優先,無則用 id(短碼)
    return { id:ridToId[rid], label:cc?nm+'\n'+cc:nm, rid, country:cc, city:g?g.city:'', area:'0',   // label = (hostname||id)\n國家
      stubs:[...new Set(r.stubs)].sort(), isASBR:r.isASBR, isABR:r.isABR }; });

  const usedIds=new Set();
  const mkId=(a,b)=>{ let base='e_'+a+'_'+b,id=base,n=2; while(usedIds.has(id)) id=base+'_'+(n++); usedIds.add(id); return id; };
  const edges=[];
  // (1) 真 p2p:兩端 metric 配對
  const pairs=new Map();
  for(const r of routers.values()) for(const l of r.p2p){
    const [a,b]=[r.rid,l.nbr].sort(), k=a+'|'+b, e=pairs.get(k)||{a,b};
    if(r.rid===a) e.ab=l.metric; else e.ba=l.metric; pairs.set(k,e);
  }
  for(const e of pairs.values()){ const a=idOf(e.a),b=idOf(e.b);
    edges.push({ id:mkId(a,b), source:a, target:b, cost:e.ab??e.ba, costRev:e.ba??e.ab, capacity:OSPF_PLACEHOLDER_CAP, type:'p2p' }); }
  const trueP2P=pairs.size;
  // (2) transit nets:2 成員收斂為 p2p(帶 net 追溯);≥3 成員建 pseudonode + transit 邊
  const pnNodes=[]; let collapsed=0, multiAccess=0;
  for(const net of [...nets.values()].sort((x,y)=>x.dr.localeCompare(y.dr,undefined,{numeric:true}))){
    const costOf=rid=>routers.get(rid)?.transit.find(t=>t.dr===net.dr)?.metric;
    if(net.members.length===2){
      const [r0,r1]=net.members, a=idOf(r0), b=idOf(r1);
      edges.push({ id:mkId(a,b), source:a, target:b, cost:costOf(r0), costRev:costOf(r1), capacity:OSPF_PLACEHOLDER_CAP, type:'p2p', net:net.dr+'/'+net.prefix });
      collapsed++;
    } else if(net.members.length>=3){
      const pnId='PN_'+ospfSid(net.dr);
      pnNodes.push({ id:pnId, subnet:net.dr+'/'+net.prefix });
      for(const rid of net.members){ const a=idOf(rid);
        edges.push({ id:mkId(a,pnId), source:a, target:pnId, cost:costOf(rid), capacity:OSPF_PLACEHOLDER_CAP, type:'transit' }); }
      multiAccess++;
    }
  }
  // 對應落差(供 UI 回報):有給對應表時才算。
  const hasMap = Object.keys(ridMap).length > 0;
  const unmappedRids = hasMap ? ridSorted.filter(rid => !ridMap[rid]) : [];          // LSDB 有、表裡沒 hostname
  const lsdbRids = new Set(routers.keys());
  const unusedMapEntries = Object.entries(ridMap)                                     // 表裡有、LSDB 沒這個 RID
    .filter(([rid]) => !lsdbRids.has(rid)).map(([rid, hostname]) => ({ rid, hostname }));
  const stats={ routers:nodes.length, edges:edges.length, collapsed, trueP2P, multiAccess,
    asbr:nodes.filter(n=>n.isASBR).length, pseudonodes:pnNodes.length, cityMapped,
    unmappedRids, unusedMapEntries };
  return { nodes, edges, pnNodes, stats };
}
