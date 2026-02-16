(function () {
  'use strict';

  window.App = window.App || {};
  App.clustering = App.clustering || {};

  const { hash32, mulberry32 } = App.utils;

  // points = [{id,x,y,z}, ...]
  function kmeans3D(points, k, seedStr) {
    const n = points.length;
    if (n === 0) return { assign: {}, k: 0 };
    k = Math.max(1, Math.min(k, n));

    const rand = mulberry32(hash32(seedStr));
    const centers = [];

    // kmeans++ init
    const first = Math.floor(rand() * n);
    centers.push([points[first].x, points[first].y, points[first].z]);

    const dist2 = (p, c) => {
      const dx = p.x - c[0],
        dy = p.y - c[1],
        dz = p.z - c[2];
      return dx * dx + dy * dy + dz * dz;
    };

    while (centers.length < k) {
      let sum = 0;
      const dists = new Array(n);
      for (let i = 0; i < n; i++) {
        let best = Infinity;
        for (let j = 0; j < centers.length; j++) {
          const d = dist2(points[i], centers[j]);
          if (d < best) best = d;
        }
        dists[i] = best;
        sum += best;
      }
      if (sum === 0) {
        while (centers.length < k) centers.push([...centers[0]]);
        break;
      }
      let r = rand() * sum;
      let idx = 0;
      for (; idx < n; idx++) {
        r -= dists[idx];
        if (r <= 0) break;
      }
      idx = Math.min(idx, n - 1);
      centers.push([points[idx].x, points[idx].y, points[idx].z]);
    }

    const assign = {};
    let changed = true;
    let iter = 0;

    while (changed && iter < 25) {
      changed = false;
      const groups = Array.from({ length: k }, () => ({ sx: 0, sy: 0, sz: 0, c: 0 }));
      for (let i = 0; i < n; i++) {
        let bestJ = 0,
          bestD = Infinity;
        for (let j = 0; j < k; j++) {
          const d = dist2(points[i], centers[j]);
          if (d < bestD) {
            bestD = d;
            bestJ = j;
          }
        }
        const prev = assign[points[i].id];
        if (prev === undefined || prev !== bestJ) changed = true;
        assign[points[i].id] = bestJ;
        const g = groups[bestJ];
        g.sx += points[i].x;
        g.sy += points[i].y;
        g.sz += points[i].z;
        g.c += 1;
      }
      for (let j = 0; j < k; j++) {
        const g = groups[j];
        if (g.c > 0) centers[j] = [g.sx / g.c, g.sy / g.c, g.sz / g.c];
      }
      iter++;
    }

    return { assign, k, centers };
  }

  function wcss(points, assign, centers) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const j = assign[p.id] ?? 0;
      const c = centers[j] ?? centers[0];
      const dx = p.x - c[0],
        dy = p.y - c[1],
        dz = p.z - c[2];
      sum += dx * dx + dy * dy + dz * dz;
    }
    return sum;
  }

  function chooseKByElbow(points, { kMin, kMax, seedStr, improveThreshold }) {
    const n = points.length;
    if (n <= 0) return { assign: {}, k: 0 };
    if (n < 3) {
      const res = kmeans3D(points, 1, seedStr);
      return { assign: res.assign, k: res.k };
    }

    kMax = Math.max(1, Math.min(kMax, n));
    kMin = Math.max(1, Math.min(kMin, kMax));

    const candidates = [];
    for (let k = kMin; k <= kMax; k++) candidates.push(k);
    if (!candidates.length) {
      const res = kmeans3D(points, 1, seedStr);
      return { assign: res.assign, k: res.k };
    }

    let best = null;
    let prev = null;
    for (const k of candidates) {
      const res = kmeans3D(points, k, seedStr);
      const s = wcss(points, res.assign, res.centers);
      if (prev != null) {
        const improve = (prev - s) / Math.max(prev, 1e-9);
        if (improve < improveThreshold) break;
      }
      best = { assign: res.assign, k: res.k, score: s };
      prev = s;
    }

    if (!best) {
      const res = kmeans3D(points, candidates[0], seedStr);
      best = { assign: res.assign, k: res.k };
    }
    return { assign: best.assign, k: best.k };
  }

  App.clustering.kmeans3D = kmeans3D;
  App.clustering.wcss = wcss;
  App.clustering.chooseKByElbow = chooseKByElbow;
})();


