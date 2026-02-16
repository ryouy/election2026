(function () {
  'use strict';

  window.App = window.App || {};
  App.embedding = App.embedding || {};

  const { hash32, mulberry32, randn, matVecMul, dot, normalize, outer, subMat } = App.utils;

  function numericOrNaN(v) {
    if (v == null) return NaN;
    if (v === '-' || v === '') return NaN;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  function getFillValueForBase(base) {
    if (base === 'Q25') return 5.0;
    if (base === 'Q1' || base === 'Q24') return 0.0;
    return 3.0;
  }

  function buildFeatureMatrix(pointsArray, cols, base) {
    const fill = getFillValueForBase(base);
    const n = pointsArray.length;
    const d = cols.length;
    const X = Array.from({ length: n }, () => new Array(d).fill(0));

    // fill numeric
    for (let i = 0; i < n; i++) {
      const p = pointsArray[i];
      for (let j = 0; j < d; j++) {
        const col = cols[j];
        const raw = p[col];
        const v = numericOrNaN(raw);
        X[i][j] = Number.isFinite(v) ? v : fill;
      }
    }

    // min-max -> [-1,1] per col
    for (let j = 0; j < d; j++) {
      let mn = Infinity,
        mx = -Infinity;
      for (let i = 0; i < n; i++) {
        const v = X[i][j];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (!Number.isFinite(mn) || !Number.isFinite(mx) || Math.abs(mx - mn) < 1e-9) {
        for (let i = 0; i < n; i++) X[i][j] = 0;
        continue;
      }
      const mid = (mx + mn) / 2;
      const half = (mx - mn) / 2;
      for (let i = 0; i < n; i++) {
        let v = (X[i][j] - mid) / half;
        if (v > 1) v = 1;
        if (v < -1) v = -1;
        X[i][j] = v;
      }
    }

    // center columns
    for (let j = 0; j < d; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += X[i][j];
      const mean = s / Math.max(1, n);
      for (let i = 0; i < n; i++) X[i][j] -= mean;
    }
    return X;
  }

  function covarianceMatrix(X) {
    const n = X.length;
    const d = X[0]?.length ?? 0;
    const C = Array.from({ length: d }, () => new Array(d).fill(0));
    const inv = 1 / Math.max(1, n - 1);
    for (let i = 0; i < n; i++) {
      const row = X[i];
      for (let a = 0; a < d; a++) {
        const va = row[a];
        for (let b = a; b < d; b++) {
          C[a][b] += va * row[b];
        }
      }
    }
    for (let a = 0; a < d; a++) {
      for (let b = a; b < d; b++) {
        C[a][b] *= inv;
        if (a !== b) C[b][a] = C[a][b];
      }
    }
    return C;
  }

  function powerIteration(C, seedVec, iters = 28) {
    let v = normalize(seedVec);
    for (let k = 0; k < iters; k++) {
      v = normalize(matVecMul(C, v));
    }
    const Cv = matVecMul(C, v);
    const lam = dot(v, Cv);
    return { vector: v, value: lam };
  }

  function pcaTop3(X, seedStr) {
    const d = X[0]?.length ?? 0;
    const C0 = covarianceMatrix(X);
    const C = C0.map((r) => r.slice()); // copy
    const rand = mulberry32(hash32(seedStr));
    const basis = [];

    for (let comp = 0; comp < Math.min(3, d); comp++) {
      const seed = new Array(d).fill(0).map(() => rand() * 2 - 1);
      const { vector, value } = powerIteration(C, seed);
      basis.push(vector);
      // deflation
      const vvT = outer(vector);
      subMat(C, vvT, value);
    }
    return basis; // array of vectors length d
  }

  function projectTo3D(pointsArray, cols, base) {
    const X = buildFeatureMatrix(pointsArray, cols, base);
    const n = X.length;
    const d = cols.length;
    const coords = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));

    if (d >= 3) {
      const W = pcaTop3(X, base + '|pca');
      for (let i = 0; i < n; i++) {
        const row = X[i];
        const x = dot(row, W[0]);
        const y = dot(row, W[1] || W[0]);
        const z = dot(row, W[2] || W[0]);
        coords[i] = { x, y, z };
      }
    } else if (d === 2) {
      // 2DはPC1/PC2を取って、設問ごとに回転した面へ埋め込む
      const W2 = pcaTop3(X, base + '|pca2');
      for (let i = 0; i < n; i++) {
        const row = X[i];
        const a = dot(row, W2[0]);
        const b = dot(row, W2[1] || W2[0]);
        coords[i] = { x: a, y: b, z: 0.35 * a + 0.2 * b };
      }
    } else if (d === 1) {
      // 1Dは設問ごとに位相が変わる3D曲線へ
      const phase = ((hash32(base) % 360) * Math.PI) / 180;
      const r = 18;
      for (let i = 0; i < n; i++) {
        const t = X[i][0]; // centered in [-1,1] scale
        const ang = phase + t * 2.2 * Math.PI;
        coords[i] = { x: 26 * t, y: r * Math.sin(ang), z: r * Math.cos(ang) };
      }
    } else {
      // no columns
      return coords;
    }

    // scale to similar magnitude (std -> 30)
    let sx = 0,
      sy = 0,
      sz = 0;
    for (let i = 0; i < n; i++) {
      sx += coords[i].x * coords[i].x;
      sy += coords[i].y * coords[i].y;
      sz += coords[i].z * coords[i].z;
    }
    const fx = 30 / (Math.sqrt(sx / Math.max(1, n)) + 1e-9);
    const fy = 30 / (Math.sqrt(sy / Math.max(1, n)) + 1e-9);
    const fz = 30 / (Math.sqrt(sz / Math.max(1, n)) + 1e-9);
    for (let i = 0; i < n; i++) {
      coords[i].x *= fx;
      coords[i].y *= fy;
      coords[i].z *= fz;
    }

    // deterministic jitter by (base, candidate id)
    try {
      const uniq = new Set();
      for (let i = 0; i < n; i++) {
        const row = X[i];
        const key = row.map((v) => Math.round(v * 10) / 10).join(',');
        uniq.add(key);
      }
      const u = uniq.size;
      const ratio = u / Math.max(1, n);
      let sd = 0.0;
      if (u <= 3) sd = 3.5;
      else if (u <= 6) sd = 2.6;
      else if (u <= 10) sd = 1.8;
      else if (ratio < 0.08) sd = 1.5;
      else if (ratio < 0.14) sd = 1.0;
      else sd = 0.6;

      for (let i = 0; i < n; i++) {
        const id = pointsArray[i]?.id ?? i;
        const r = mulberry32(hash32(base + '|jitter|' + id));
        coords[i].x += randn(r) * sd;
        coords[i].y += randn(r) * sd;
        coords[i].z += randn(r) * sd;
      }
    } catch (e) {
      // ignore
    }

    return coords;
  }

  App.embedding.numericOrNaN = numericOrNaN;
  App.embedding.getFillValueForBase = getFillValueForBase;
  App.embedding.buildFeatureMatrix = buildFeatureMatrix;
  App.embedding.projectTo3D = projectTo3D;
})();


