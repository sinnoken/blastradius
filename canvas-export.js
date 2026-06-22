// canvas-export.js — Cytoscape 畫布 PNG 匯出共用邏輯（index.html + edit.html 共用）
// 兩頁皆 <script src="canvas-export.js">，各自傳入自己的 cy 實例與檔名。
window.exportCanvasPng = function (cy, name) {
  const a = document.createElement('a');
  a.href = cy.png({ scale: 2, full: true, bg: '#fafbfc' });
  a.download = `${name || 'topology'}.png`;
  a.click();
};
