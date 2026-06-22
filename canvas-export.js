// canvas-export.js — Cytoscape 畫布 PNG 匯出共用邏輯（index.html + edit.html 共用）
// 兩頁皆 <script src="canvas-export.js">，各自傳入自己的 cy 實例與檔名。
// maxWidth/maxHeight 把全圖等比縮進固定框，避免超過瀏覽器 canvas 上限。
// 真正的天花板是「總面積」(Chrome ~268MP) 與「單邊」(Chrome 16384/邊)，非單一維度。
// 拓樸通常寬 > 高、寬邊先卡，故只拉寬：MAX_W=16384(Chrome 單邊上限)、MAX_H=8192。
// 此時面積 16384×8192 = 134MP，僅用掉面積預算一半，比兩邊都 16384(=268MP 貼邊) 安全。
// 注意：16384/邊只保證 Chrome/Edge；Safari/Firefox 更嚴，必要時兩值各退回 8192。
const MAX_W = 16384;
const MAX_H = 8192;
window.exportCanvasPng = function (cy, name) {
  let uri = null;
  try {
    uri = cy.png({ full: true, maxWidth: MAX_W, maxHeight: MAX_H, bg: '#fafbfc' });
  } catch (e) {
    console.error('cy.png 失敗:', e); uri = null;
  }
  if (!uri || uri.length < 100) {
    alert('圖片匯出失敗，請稍後再試或減少節點數。');
    return;
  }
  // data URI → Blob 下載（繞過 a.href=data: 的下載大小限制）
  try {
    const bin = atob(uri.split(',')[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: 'image/png' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${name || 'topology'}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error('Blob 轉換失敗，改用 data URI:', e);
    const a = document.createElement('a');
    a.href = uri; a.download = `${name || 'topology'}.png`;
    a.click();
  }
};
