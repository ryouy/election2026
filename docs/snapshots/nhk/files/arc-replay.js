// 保存ページ用: 元のHome.js(PixiJS)が描いていた「獲得議席」の扇形を Canvas2D で再現する。
// 形・半径・アニメーション(各帯が左右から順に、議席数に比例した時間で伸びる)は Home.js の実装に合わせてある。
// 元データ(jyo*.xml)は保存されていないため、政党別の議席数などはページ内のDOMから読む。
(function () {
  var cv = document.getElementById('mycanvas');
  if (!cv) return;
  var ctx = cv.getContext('2d');
  var CX = 230, CY = 280;                     // 論理座標 460x280(実キャンバスは2倍)
  var MAIN = [95, 195], YOYA = [202, 224], BEFORE = [60, 82];

  function num(sel) { var e = document.querySelector(sel); return e ? parseInt(e.textContent.replace(/[^\d]/g, ''), 10) || 0 : 0; }
  function parties(group) {
    return [].map.call(document.querySelectorAll('.mainArc__partySeats--' + group + ' .mainArc__party'), function (el) {
      return { n: parseInt(el.querySelector('.mainArc__party__count').textContent, 10), color: el.style.borderTopColor };
    }).filter(function (p) { return p.n > 0; });
  }
  var yoto = parties('yoto'), yato = parties('yato').reverse();   // 野党は右端から並べる
  var yotoN = num('.mainArc__allSeat--yoto .mainArc__allSeat__count');
  var yatoN = num('.mainArc__allSeat--yato .mainArc__allSeat__count');
  var yotoBef = num('.mainArc__beforeSeat--yoto .mainArc__beforeSeat__count');
  var yatoBef = num('.mainArc__beforeSeat--yato .mainArc__beforeSeat__count');
  var rest = num('.mainArc__rest__rest');
  var all = yotoN + yatoN + rest || 465;
  var majority = Math.floor(all / 2) + 1;
  var deg = function (n) { return 180 / all * n; };

  // 1本の帯: side='right'(与党・左から時計回り) / 'left'(野党・右から反時計回り)
  var arcs = [];
  function addArcs(list, side, radii, key, delayBase, totalN) {
    var acc = 0, delay = delayBase || 0;
    list.forEach(function (p) {
      var n = key ? p[key] : p.n;
      if (!n) return;
      arcs.push({ side: side, r: radii, color: p.color, s: deg(acc), e: deg(acc + n),
                  dur: totalN ? n / totalN * 1.5 : 1.5, delay: totalN ? acc / totalN * 1.5 : 0 });
      acc += n;
    });
  }
  addArcs([{ n: yotoN, color: '#d3213e' }], 'right', YOYA);
  addArcs([{ n: yatoN, color: '#1173e5' }], 'left', YOYA);
  addArcs(yoto, 'right', MAIN, null, 0, yotoN);
  addArcs(yato, 'left', MAIN, null, 0, yatoN);
  addArcs([{ n: yotoBef, color: '#fcbfbf' }], 'right', BEFORE, null, 0, yotoBef);
  addArcs([{ n: yatoBef, color: '#aad4f1' }], 'left', BEFORE, null, 0, yatoBef);

  function ang(side, d) { return (side === 'left' ? 360 - d : d + 180) * Math.PI / 180; }
  function drawArc(a, t) {
    var p = Math.max(0, Math.min(1, (t - a.delay) / a.dur));
    if (p <= 0) return;
    var e = a.s + (a.e - a.s) * p, acw = a.side === 'left';
    ctx.beginPath();
    ctx.fillStyle = a.color;
    ctx.arc(CX, CY, a.r[1], ang(a.side, a.s), ang(a.side, e), acw);
    ctx.arc(CX, CY, a.r[0], ang(a.side, e), ang(a.side, a.s), !acw);
    ctx.closePath();
    ctx.fill();
  }

  function text(str, x, y, size, numeric) {
    ctx.fillStyle = '#000';
    ctx.font = '600 ' + size + 'px ' + (numeric ? '"Helvetica Neue",Arial,sans-serif' : '"Hiragino Kaku Gothic ProN","ヒラギノ角ゴ ProN W3",Meiryo,sans-serif');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }
  function drawMajority() {
    var a = (deg(majority) + 180) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    ctx.beginPath(); ctx.strokeStyle = '#1c2a4a'; ctx.lineWidth = 1;
    ctx.moveTo(CX + BEFORE[0] * c, CY + BEFORE[0] * s);
    ctx.lineTo(CX + (YOYA[1] + 16) * c, CY + (YOYA[1] + 16) * s);
    ctx.stroke();
    var r = YOYA[1] + 32;
    text(String(majority), CX + r * c, CY + r * s, 24, true);
    text('過半数', CX + r * c, CY + r * s - 16, 14, true);
  }

  var start = null;
  function frame(ts) {
    if (start === null) start = ts;
    var t = location.hash === '#final' ? 99 : (ts - start) / 1000;  // #final: アニメなしで最終形を表示
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, 460, 280);
    arcs.forEach(function (a) { drawArc(a, t); });
    drawMajority();
    text('選挙前勢力', CX, CY - 8, 14);
    if (t < 1.5 + 0.05) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
