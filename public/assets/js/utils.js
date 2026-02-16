(function () {
  'use strict';

  window.App = window.App || {};
  App.utils = App.utils || {};

  function hash32(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randn(rand) {
    // Box-Muller (deterministic with provided rand())
    let u = 0,
      v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function matVecMul(A, v) {
    const n = A.length;
    const out = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      const row = A[i];
      for (let j = 0; j < n; j++) s += row[j] * v[j];
      out[i] = s;
    }
    return out;
  }

  function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  function norm(v) {
    return Math.sqrt(Math.max(1e-12, dot(v, v)));
  }

  function normalize(v) {
    const n = norm(v);
    return v.map((x) => x / n);
  }

  function outer(v) {
    const n = v.length;
    const M = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        M[i][j] = v[i] * v[j];
      }
    }
    return M;
  }

  function subMat(A, B, scale = 1.0) {
    const n = A.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        A[i][j] -= scale * B[i][j];
      }
    }
  }

  App.utils.hash32 = hash32;
  App.utils.mulberry32 = mulberry32;
  App.utils.randn = randn;
  App.utils.matVecMul = matVecMul;
  App.utils.dot = dot;
  App.utils.norm = norm;
  App.utils.normalize = normalize;
  App.utils.outer = outer;
  App.utils.subMat = subMat;
})();


