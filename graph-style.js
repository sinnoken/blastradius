// graph-style.js — BlastRadius 共用 cytoscape 基礎節點樣式(單一來源)。
// index.html(設計權威)與 edit.html 皆 import baseGraphStyle()。
// 僅含「節點基礎外觀」(router / pseudonode);邊樣式、role/op 狀態樣式、編輯器樣式各頁自留為 overlay。
// 用法:cytoscape({ style: [ ...baseGraphStyle(), ...頁面 edge / role / op 樣式 ] })
//   ⚠ base 必須排在最前,讓各頁後面的 role/op class 樣式覆蓋(cytoscape:陣列後者勝)。
//   ⚠ 節點需帶 class 'router' / 'pseudonode'(兩頁建節點時皆已加 classes)。
export function baseGraphStyle() {
  return [
    { selector: 'node.router', style: {
      'background-color':'#fff','border-color':'#1e40af','border-width':3,
      'label':'data(label)','color':'#1f2937','font-size':'12px','font-weight':'bold',
      'text-valign':'center','text-halign':'center','text-wrap':'wrap','line-height':1.1,
      'width':50,'height':50,
    }},
    { selector: 'node.pseudonode', style: {
      'background-color':'#fef3c7','border-color':'#d97706','border-width':2,
      'shape':'diamond','label':'data(label)','color':'#78350f','font-size':'10px',
      'text-valign':'bottom','text-margin-y':6,'text-wrap':'wrap','width':36,'height':36,
    }},
  ];
}
