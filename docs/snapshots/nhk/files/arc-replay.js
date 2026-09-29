// 保存ページ用: 元のHomeスクリプトが描いていた「獲得議席」の扇形を、
// ページ内に残っている政党別議席数から再現して、扇状に広がるアニメーションで描く。
(function () {
  var cv = document.getElementById('mycanvas');
  if (!cv) return;
  var ctx = cv.getContext('2d');
  var W = cv.width, H = cv.height;

  var seats = [];
  document.querySelectorAll('.mainArc__party').forEach(function (el) {
    var n = parseInt(el.querySelector('.mainArc__party__count').textContent, 10);
    var color = el.style.borderTopColor;
    if (n > 0) seats.push({ n: n, color: color });
  });
  var rest = parseInt((document.querySelector('.mainArc__rest__rest') || {}).textContent, 10) || 0;
  var total = seats.reduce(function (a, s) { return a + s.n; }, 0) + rest;
  if (rest > 0) seats.push({ n: rest, color: '#ddd' });

  // 半円を同心円状の列に分け、角度の小さい順(左→右)に、政党の並びどおりに席を割り当てる
  var rows = 9, cx = W / 2, cy = H - 40, rOut = Math.min(W / 2 - 20, H - 60), rIn = rOut * 0.42;
  var radii = [], lens = [], sum = 0, i, r;
  for (i = 0; i < rows; i++) { r = rIn + (rOut - rIn) * i / (rows - 1); radii.push(r); sum += r; }
  var counts = radii.map(function (r) { return Math.round(total * r / sum); });
  counts[rows - 1] += total - counts.reduce(function (a, b) { return a + b; }, 0);

  var dots = [];
  radii.forEach(function (r, ri) {
    for (var k = 0; k < counts[ri]; k++) {
      var a = Math.PI * (1 - (k + 0.5) / counts[ri]); // π(左)→0(右)
      dots.push({ a: a, r: r });
    }
  });
  dots.sort(function (p, q) { return q.a - p.a; });
  var idx = 0;
  seats.forEach(function (s) { for (var k = 0; k < s.n && idx < dots.length; k++) dots[idx++].color = s.color; });
  var size = (rOut - rIn) / rows * 0.36;

  var start = null, dur = 1800;
  function draw(t) {
    if (start === null) start = t;
    var p = Math.min(1, (t - start) / dur);
    var e = 1 - Math.pow(1 - p, 3);
    ctx.clearRect(0, 0, W, H);
    dots.forEach(function (d) {
      var progress = (Math.PI - d.a) / Math.PI;           // 左から右へ順に出現
      var local = Math.max(0, Math.min(1, (e * 1.4 - progress * 0.4 - 0) / 0.6));
      if (local <= 0) return;
      var rr = d.r * (0.4 + 0.6 * local);                 // 中心から外へ広がる
      ctx.globalAlpha = local;
      ctx.fillStyle = d.color || '#ccc';
      ctx.beginPath();
      ctx.arc(cx + rr * Math.cos(d.a), cy - rr * Math.sin(d.a), size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (p < 1) requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();
