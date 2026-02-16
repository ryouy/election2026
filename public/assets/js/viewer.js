(function () {
  'use strict';

  window.App = window.App || {};
  App.viewer = App.viewer || {};

  const state = App.state;
  const cfg = App.config;
  const C = App.consts;

  const { createShapeTexture, createTextTexture, createHaloTexture } = App.textures;
  const { hash32 } = App.utils;

  function clusterColor(clusterId) {
    const pal = C.CLUSTER_PALETTE;
    const i = (((clusterId ?? 0) % pal.length) + pal.length) % pal.length;
    return pal[i];
  }

  function withinClusterColor(k) {
    return C.PARTY_CLUSTER_COLORS[k % C.PARTY_CLUSTER_COLORS.length];
  }

  function getSelectionHaloMaterial(color) {
    const c = color || '#1f77b4';
    const hkey = 'sel_' + c;
    if (!state.selectionHaloMaterialCache[hkey]) {
      state.selectionHaloMaterialCache[hkey] = new THREE.SpriteMaterial({
        map: createHaloTexture(c),
        transparent: true,
        opacity: 0.0,
        depthTest: false,
      });
    }
    return state.selectionHaloMaterialCache[hkey];
  }

  // --- Party style (stable) ---
  function partyStyleFor(party) {
    const p = party && String(party).trim() ? String(party).trim() : '（不明）';
    const h = hash32(p);
    const color = C.PARTY_STYLE_PALETTE[h % C.PARTY_STYLE_PALETTE.length];
    const shape = C.PARTY_SHAPES[(h >>> 8) % C.PARTY_SHAPES.length];
    return { color, shape };
  }

  function applyPartyStyles(pointsArray) {
    state.partyStyleMap = {};
    pointsArray.forEach((pt) => {
      const party = pt.party && String(pt.party).trim() ? String(pt.party).trim() : '（不明）';
      if (!state.partyStyleMap[party]) state.partyStyleMap[party] = partyStyleFor(party);
      const st = state.partyStyleMap[party];
      pt.party = party;
      pt.color = st.color;
      pt.shape = st.shape;
    });
  }

  // --- Cluster outlines (ellipsoids) ---
  function eigenSym3_jacobi(m00, m01, m02, m11, m12, m22, iters = 18) {
    let a00 = m00,
      a01 = m01,
      a02 = m02,
      a11 = m11,
      a12 = m12,
      a22 = m22;

    let v00 = 1,
      v01 = 0,
      v02 = 0;
    let v10 = 0,
      v11 = 1,
      v12 = 0;
    let v20 = 0,
      v21 = 0,
      v22 = 1;

    function rot(p, q, c, s) {
      if (p === 0 && q === 1) {
        const a00n = c * c * a00 - 2 * s * c * a01 + s * s * a11;
        const a11n = s * s * a00 + 2 * s * c * a01 + c * c * a11;
        const a01n = (c * c - s * s) * a01 + s * c * (a00 - a11);
        const a02n = c * a02 - s * a12;
        const a12n = s * a02 + c * a12;
        a00 = a00n;
        a11 = a11n;
        a01 = a01n;
        a02 = a02n;
        a12 = a12n;
      } else if (p === 0 && q === 2) {
        const a00n = c * c * a00 - 2 * s * c * a02 + s * s * a22;
        const a22n = s * s * a00 + 2 * s * c * a02 + c * c * a22;
        const a02n = (c * c - s * s) * a02 + s * c * (a00 - a22);
        const a01n = c * a01 - s * a12;
        const a12n = s * a01 + c * a12;
        a00 = a00n;
        a22 = a22n;
        a02 = a02n;
        a01 = a01n;
        a12 = a12n;
      } else if (p === 1 && q === 2) {
        const a11n = c * c * a11 - 2 * s * c * a12 + s * s * a22;
        const a22n = s * s * a11 + 2 * s * c * a12 + c * c * a22;
        const a12n = (c * c - s * s) * a12 + s * c * (a11 - a22);
        const a01n = c * a01 - s * a02;
        const a02n = s * a01 + c * a02;
        a11 = a11n;
        a22 = a22n;
        a12 = a12n;
        a01 = a01n;
        a02 = a02n;
      }
    }

    function rotV(p, q, c, s) {
      if (p === 0 && q === 1) {
        const t00 = c * v00 - s * v01,
          t01 = s * v00 + c * v01;
        const t10 = c * v10 - s * v11,
          t11 = s * v10 + c * v11;
        const t20 = c * v20 - s * v21,
          t21 = s * v20 + c * v21;
        v00 = t00;
        v01 = t01;
        v10 = t10;
        v11 = t11;
        v20 = t20;
        v21 = t21;
      } else if (p === 0 && q === 2) {
        const t00 = c * v00 - s * v02,
          t02 = s * v00 + c * v02;
        const t10 = c * v10 - s * v12,
          t12 = s * v10 + c * v12;
        const t20 = c * v20 - s * v22,
          t22 = s * v20 + c * v22;
        v00 = t00;
        v02 = t02;
        v10 = t10;
        v12 = t12;
        v20 = t20;
        v22 = t22;
      } else if (p === 1 && q === 2) {
        const t01 = c * v01 - s * v02,
          t02 = s * v01 + c * v02;
        const t11 = c * v11 - s * v12,
          t12 = s * v11 + c * v12;
        const t21 = c * v21 - s * v22,
          t22 = s * v21 + c * v22;
        v01 = t01;
        v02 = t02;
        v11 = t11;
        v12 = t12;
        v21 = t21;
        v22 = t22;
      }
    }

    for (let k = 0; k < iters; k++) {
      const ab01 = Math.abs(a01),
        ab02 = Math.abs(a02),
        ab12 = Math.abs(a12);
      let p = 0,
        q = 1,
        apq = a01,
        app = a00,
        aqq = a11;
      if (ab02 > ab01 && ab02 >= ab12) {
        p = 0;
        q = 2;
        apq = a02;
        app = a00;
        aqq = a22;
      } else if (ab12 > ab01 && ab12 > ab02) {
        p = 1;
        q = 2;
        apq = a12;
        app = a11;
        aqq = a22;
      }
      if (Math.abs(apq) < 1e-10) break;

      const tau = (aqq - app) / (2 * apq);
      const t = Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
      const c = 1 / Math.sqrt(1 + t * t);
      const s = t * c;

      rot(p, q, c, s);
      rotV(p, q, c, s);
    }

    const evals = [a00, a11, a22];
    const evecs = [
      [v00, v10, v20],
      [v01, v11, v21],
      [v02, v12, v22],
    ];
    const idx = [0, 1, 2].sort((i, j) => evals[j] - evals[i]);
    const vals = idx.map((i) => evals[i]);
    const vecs = idx.map((i) => evecs[i]);
    return { values: vals, vectors: vecs };
  }

  function computeClusterEllipsoidTargets(pointsArray) {
    const by = new Map();
    pointsArray.forEach((p) => {
      const cid = p.cluster_global ?? 0;
      if (!by.has(cid)) by.set(cid, { sx: 0, sy: 0, sz: 0, c: 0, pts: [] });
      const g = by.get(cid);
      g.sx += p.x;
      g.sy += p.y;
      g.sz += p.z;
      g.c += 1;
      g.pts.push([p.x, p.y, p.z]);
    });

    const out = new Map();
    by.forEach((g, cid) => {
      if (!g.c) return;
      const cx = g.sx / g.c,
        cy = g.sy / g.c,
        cz = g.sz / g.c;

      let sxx = 0,
        sxy = 0,
        sxz = 0,
        syy = 0,
        syz = 0,
        szz = 0;
      for (const [x, y, z] of g.pts) {
        const dx = x - cx,
          dy = y - cy,
          dz = z - cz;
        sxx += dx * dx;
        sxy += dx * dy;
        sxz += dx * dz;
        syy += dy * dy;
        syz += dy * dz;
        szz += dz * dz;
      }
      const inv = 1 / Math.max(1, g.c - 1);
      sxx *= inv;
      sxy *= inv;
      sxz *= inv;
      syy *= inv;
      syz *= inv;
      szz *= inv;

      const { values, vectors } = eigenSym3_jacobi(sxx, sxy, sxz, syy, syz, szz);
      const sig = values.map((v) => Math.sqrt(Math.max(v, 1e-9)));
      const k = 2.2;
      const sx = Math.max(6.0, sig[0] * k + 2.0);
      const sy = Math.max(6.0, sig[1] * k + 2.0);
      const sz = Math.max(6.0, sig[2] * k + 2.0);

      const ex = new THREE.Vector3(vectors[0][0], vectors[0][1], vectors[0][2]).normalize();
      const ey = new THREE.Vector3(vectors[1][0], vectors[1][1], vectors[1][2]).normalize();
      const ez = new THREE.Vector3(vectors[2][0], vectors[2][1], vectors[2][2]).normalize();
      const cross = new THREE.Vector3().crossVectors(ex, ey);
      if (cross.dot(ez) < 0) ez.multiplyScalar(-1);
      const m = new THREE.Matrix4().makeBasis(ex, ey, ez);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);

      out.set(cid, {
        pos: new THREE.Vector3(cx, cy, cz),
        scale: new THREE.Vector3(sx, sy, sz),
        quat: q,
      });
    });
    return out;
  }

  function ensureOutlineMesh(cid) {
    if (state.outlineMeshByCluster.has(cid)) return state.outlineMeshByCluster.get(cid);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(clusterColor(cid)),
      transparent: true,
      opacity: 0.2,
      wireframe: true,
      depthWrite: false,
    });
    const unitSphere = new THREE.SphereGeometry(1, 22, 16);
    const mesh = new THREE.Mesh(unitSphere, mat);
    mesh.visible = state.showClusterOutline;
    mesh.userData = { kind: 'clusterOutline', cluster: cid };
    state.clusterOutlineGroup.add(mesh);
    state.outlineMeshByCluster.set(cid, mesh);
    return mesh;
  }

  function rebuildClusterOutlines(pointsArray, { animate = false } = {}) {
    const targets = computeClusterEllipsoidTargets(pointsArray);

    state.outlineMeshByCluster.forEach((mesh, cid) => {
      if (!targets.has(cid)) {
        state.clusterOutlineGroup.remove(mesh);
        state.outlineMeshByCluster.delete(cid);
      }
    });

    targets.forEach((t, cid) => {
      const mesh = ensureOutlineMesh(cid);
      mesh.material.color = new THREE.Color(clusterColor(cid));
      if (!animate) {
        mesh.position.copy(t.pos);
        mesh.scale.copy(t.scale);
        mesh.quaternion.copy(t.quat);
      } else {
        mesh.userData.startPos = mesh.position.clone();
        mesh.userData.targetPos = t.pos.clone();
        mesh.userData.startScale = mesh.scale.clone();
        mesh.userData.targetScale = t.scale.clone();
        mesh.userData.startQuat = mesh.quaternion.clone();
        mesh.userData.targetQuat = t.quat.clone();
      }
    });
  }

  // --- Clustering computations (cached) ---
  function computeGlobalClustersForCurrentQuestion() {
    if (!state.currentQuestion) return { assign: {}, k: 0 };
    const base = state.currentQuestion.base;
    const cacheKey = base + '|' + state.embeddingMode;
    if (state.globalClusterCache[cacheKey]) return state.globalClusterCache[cacheKey];

    const pts = (state.pointsData || []).map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z }));
    const n = pts.length;
    const kMax = Math.min(cfg.GLOBAL_CLUSTER_MAX_K, Math.max(1, Math.floor(Math.sqrt(n))));
    const kMin = Math.min(cfg.GLOBAL_CLUSTER_MIN_K, kMax);
    const best = App.clustering.chooseKByElbow(pts, {
      kMin,
      kMax,
      seedStr: base + '|global',
      improveThreshold: cfg.GLOBAL_CLUSTER_IMPROVE_THRESHOLD,
    });
    state.globalClusterCache[cacheKey] = { assign: best.assign, k: best.k };
    return state.globalClusterCache[cacheKey];
  }

  function computePartyClustersForCurrentQuestion(party) {
    if (!state.currentQuestion || !party) return { assign: {}, k: 0 };
    const base = state.currentQuestion.base;
    const key = base + '|' + state.embeddingMode + '::' + party;
    if (state.partyClusterCache[key]) return state.partyClusterCache[key];

    const pts = (state.pointsData || [])
      .filter((p) => p.party === party)
      .map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z }));
    const n = pts.length;
    const kMax = Math.min(cfg.PARTY_CLUSTER_MAX_K, Math.max(cfg.PARTY_CLUSTER_MIN_K, Math.floor(Math.sqrt(n))));
    const kMin = Math.min(cfg.PARTY_CLUSTER_MIN_K, kMax);
    const best = App.clustering.chooseKByElbow(pts, {
      kMin,
      kMax,
      seedStr: base + '|' + party,
      improveThreshold: cfg.PARTY_CLUSTER_IMPROVE_THRESHOLD,
    });
    state.partyClusterCache[key] = best;
    return best;
  }

  function updateTargetSpritesFromVisibility() {
    state.targetSprites = state.candidateObjects.filter((o) => o.visible);
  }

  function applyPartyVisibilityFilter() {
    const hideOthers = !!(state.showPartyClusters && state.activeParty);
    state.candidateObjects.forEach((obj) => {
      const d = obj.userData?.data;
      if (!d) return;
      obj.visible = hideOthers ? d.party === state.activeParty : true;
    });

    state.clusterOutlineGroup.visible = hideOthers ? false : state.showClusterOutline;
    updateTargetSpritesFromVisibility();
  }

  function applyPartyClusterStyling() {
    const legend = document.getElementById('party-cluster-legend');
    if (!legend) return;

    if (!state.showPartyClusters || !state.activeParty) {
      legend.style.display = 'none';
      applyPartyVisibilityFilter();
      state.candidateObjects.forEach((obj) => {
        const d = obj.userData?.data;
        if (!d) return;
        const key = d.shape + '_' + d.color;
        if (state.materialCache && state.materialCache[key]) {
          obj.material.opacity = 0.0;
          obj.userData.opacityTarget = 0.85;
          obj.material.map = state.materialCache[key].map;
          obj.material.needsUpdate = true;
        }
      });
      return;
    }

    applyPartyVisibilityFilter();

    const res = computePartyClustersForCurrentQuestion(state.activeParty);
    const counts = new Array(res.k).fill(0);

    state.candidateObjects.forEach((obj) => {
      const d = obj.userData?.data;
      if (!d) return;
      if (d.party !== state.activeParty) return;
      const cid = res.assign[d.id] ?? 0;
      counts[cid] += 1;

      const color = withinClusterColor(cid);
      const mkey = 'pc_' + d.shape + '_' + color;
      if (!state.materialCache[mkey]) {
        state.materialCache[mkey] = new THREE.SpriteMaterial({
          map: createShapeTexture(d.shape, color),
          transparent: true,
          opacity: obj.material.opacity ?? 0.85,
        });
      }
      obj.material.opacity = 0.0;
      obj.userData.opacityTarget = 0.85;
      obj.material.map = state.materialCache[mkey].map;
      obj.material.needsUpdate = true;
      obj.userData.within_party_cluster = cid;
    });

    legend.innerHTML = `<div style="font-weight:700; margin-bottom:4px;">${state.activeParty} 党内グループ</div>
                        <div style="opacity:0.75; font-size:11px;">※党内クラスタ表示中は他党を非表示にします</div>`;
    for (let i = 0; i < res.k; i++) {
      const row = document.createElement('div');
      row.className = 'pcl-item';
      const sw = document.createElement('span');
      sw.className = 'pcl-swatch';
      sw.style.background = withinClusterColor(i);
      const label = document.createElement('span');
      label.textContent = `グループ ${String.fromCharCode(65 + i)} (${counts[i]}人)`;
      row.appendChild(sw);
      row.appendChild(label);
      legend.appendChild(row);
    }
    legend.style.display = 'block';
  }

  // --- Three setup / rendering ---
  function initPointerListenersOnce() {
    if (state.pointerListenersInitialized) return;
    state.pointerListenersInitialized = true;

    window.addEventListener('mousemove', (event) => {
      state.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      state.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
      if (state.tooltipEl) {
        state.tooltipEl.style.left = event.clientX + 15 + 'px';
        state.tooltipEl.style.top = event.clientY + 15 + 'px';
      }
    });

    window.addEventListener(
      'touchstart',
      (event) => {
        if (event.touches.length > 0) {
          const touch = event.touches[0];
          state.mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
          state.mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
          updateTooltipPos(touch.clientX, touch.clientY);
        }
      },
      { passive: true }
    );
  }

  function updateTooltipPos(x, y) {
    if (!state.tooltipEl) return;
    state.tooltipEl.style.left = x + 15 + 'px';
    state.tooltipEl.style.top = y - 40 + 'px';
  }

  function createCandidatesFromPoints(pointsArray) {
    // reset existing sprites
    if (state.candidateObjects && state.candidateObjects.length) {
      state.candidateObjects.forEach((obj) => state.scene.remove(obj));
    }
    state.candidateObjects = [];
    state.targetSprites = [];
    state.materialCache = {};
    state.mismatchHaloMaterialCache = {};
    state.legendData = [];

    applyPartyStyles(pointsArray);
    initPointerListenersOnce();
    rebuildClusterOutlines(pointsArray, { animate: false });

    pointsArray.forEach((pt) => {
      const key = pt.shape + '_' + pt.color;
      if (!state.materialCache[key]) {
        state.materialCache[key] = new THREE.SpriteMaterial({
          map: createShapeTexture(pt.shape, pt.color),
          transparent: true,
          opacity: 0.85,
        });
      }
      const sprite = new THREE.Sprite(state.materialCache[key]);
      sprite.position.set(pt.x, pt.y, pt.z);
      sprite.userData = { id: pt.id, name: pt.name, party: pt.party, data: pt };

      sprite.userData.cluster_global = pt.cluster_global ?? 0;
      sprite.userData.party_mode_cluster = pt.party_mode_cluster ?? null;
      sprite.userData.is_mismatch = !!pt.is_mismatch;
      sprite.userData.mismatch_score = pt.mismatch_score ?? 0;
      sprite.userData.baseScale = 1.0;

      const selHalo = new THREE.Sprite(getSelectionHaloMaterial('#1f77b4').clone());
      selHalo.scale.set(3.0, 3.0, 1);
      selHalo.renderOrder = 0;
      selHalo.visible = true;
      selHalo.userData = { kind: 'selectionHalo' };
      sprite.add(selHalo);

      if (sprite.userData.is_mismatch) {
        const hkey = 'mh_' + '#ff5a3c';
        if (!state.mismatchHaloMaterialCache[hkey]) {
          state.mismatchHaloMaterialCache[hkey] = new THREE.SpriteMaterial({
            map: createHaloTexture('#ff5a3c'),
            transparent: true,
            opacity: 0.0,
            depthTest: false,
          });
        }
        const halo = new THREE.Sprite(state.mismatchHaloMaterialCache[hkey].clone());
        halo.scale.set(2.35, 2.35, 1);
        halo.renderOrder = 0;
        halo.visible = state.showMismatch;
        halo.userData = { kind: 'mismatchHalo' };
        sprite.add(halo);

        sprite.material = sprite.material.clone();
        sprite.material.opacity = 0.88;
      }

      state.scene.add(sprite);
      state.targetSprites.push(sprite);

      const textData = createTextTexture(pt.name);
      const textSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: textData.texture, transparent: true, opacity: 0.9, depthTest: false })
      );
      textSprite.position.set(0, 0.8, 0);
      sprite.add(textSprite);
      textSprite.scale.set(textData.width * 0.012, textData.height * 0.012, 1);
      textSprite.renderOrder = 999;
      textSprite.userData = { kind: 'nameLabel', baseScale: textSprite.scale.clone(), basePos: textSprite.position.clone() };

      state.candidateObjects.push(sprite);
    });

    updateTargetSpritesFromVisibility();

    // legend (right-bottom, currently hidden by CSS but kept)
    state.activeParty = null;
    const legendDiv = document.getElementById('legend');
    if (legendDiv) {
      legendDiv.innerHTML = '<div class="legend-title">政党一覧</div>';
      state.legendData = Object.keys(state.partyStyleMap).map((p) => ({ party: p, style: state.partyStyleMap[p] }));
      state.legendData.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'legend-item';
        div.innerHTML = `<img src="${createShapeTexture(item.style.shape, item.style.color).image.toDataURL()}" class="legend-icon"><span>${item.party}</span>`;
        legendDiv.appendChild(div);
        div.addEventListener('click', () => {
          const items = document.querySelectorAll('.legend-item');
          if (state.activeParty === item.party) {
            state.activeParty = null;
            div.classList.remove('selected');
          } else {
            state.activeParty = item.party;
            const ps = document.getElementById('party-select');
            if (ps) ps.value = item.party;
            items.forEach((el) => el.classList.remove('selected'));
            div.classList.add('selected');
            applyPartyClusterStyling();
          }
        });
      });
    }
  }

  function buildPointsMap(pointsArray) {
    const map = new Map();
    pointsArray.forEach((p) => map.set(p.id, p));
    return map;
  }

  function startTransitionTo(newPointsById) {
    const now = performance.now();
    state.transition.active = true;
    state.transition.start = now;

    state.candidateObjects.forEach((obj) => {
      const id = obj.userData.id;
      const p = newPointsById.get(id);
      if (!p) return;
      obj.userData.startPos = obj.position.clone();
      obj.userData.targetPos = new THREE.Vector3(p.x, p.y, p.z);

      obj.userData.data = p;
      obj.userData.cluster_global = p.cluster_global ?? 0;
      obj.userData.party_mode_cluster = p.party_mode_cluster ?? null;
      obj.userData.is_mismatch = !!p.is_mismatch;
      obj.userData.mismatch_score = p.mismatch_score ?? 0;
    });
  }

  function updateTransition() {
    if (!state.transition.active) return;
    const t = (performance.now() - state.transition.start) / state.transition.duration;
    const k = Math.min(Math.max(t, 0), 1);
    const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

    state.candidateObjects.forEach((obj) => {
      const a = obj.userData.startPos;
      const b = obj.userData.targetPos;
      if (!a || !b) return;
      obj.position.lerpVectors(a, b, ease);
    });

    state.outlineMeshByCluster.forEach((mesh) => {
      const a = mesh.userData.startPos;
      const b = mesh.userData.targetPos;
      const as = mesh.userData.startScale;
      const bs = mesh.userData.targetScale;
      const aq = mesh.userData.startQuat;
      const bq = mesh.userData.targetQuat;
      if (a && b) mesh.position.lerpVectors(a, b, ease);
      if (as && bs) mesh.scale.lerpVectors(as, bs, ease);
      if (aq && bq) mesh.quaternion.slerpQuaternions(aq, bq, ease);
    });

    if (k >= 1) state.transition.active = false;
  }

  function animate() {
    requestAnimationFrame(animate);
    updateTransition();

    const time = Date.now() * 0.005;
    const partyPulse = 1.0 + Math.sin(time * 0.85) * 0.1;

    state.candidateObjects.forEach((obj) => {
      const ud = obj.userData || {};
      let sx = 1.0;
      let dimTo = null;
      let boost = false;
      let boostLevel = 0;

      if (state.activeParty) {
        if (ud.party === state.activeParty) {
          sx = 2.05 * partyPulse;
          boost = true;
          boostLevel = Math.max(boostLevel, 1);
        } else {
          dimTo = 0.02;
          sx = 0.65;
        }
      }

      if (state.optionFilter && state.optionFilter.active) {
        const ok = App.ui.candidateMatchesOption(ud.data);
        if (ok) {
          sx = Math.max(sx, 2.25);
          boost = true;
          boostLevel = Math.max(boostLevel, 2);
        } else {
          dimTo = Math.min(dimTo ?? 1.0, 0.015);
          sx = Math.min(sx, 0.6);
        }
      }

      if (ud.is_mismatch) {
        obj.children.forEach((ch) => {
          if (ch.userData && ch.userData.kind === 'mismatchHalo') {
            ch.visible = state.showMismatch;
            if (state.showMismatch) {
              const base = 0.22 + (ud.mismatch_score || 0) * 0.22;
              ch.material.opacity = base + Math.sin(time * 0.9 + (ud.id || 0)) * 0.06;
            } else {
              ch.material.opacity = 0.0;
            }
          }
        });

        if (state.showMismatch && (!state.activeParty || ud.party !== state.activeParty)) {
          sx = Math.max(sx, 1.06 + (ud.mismatch_score || 0) * 0.08);
          obj.material.opacity = 0.92;
        } else {
          obj.material.opacity = 0.85;
        }
      }

      const sel = obj.children && obj.children.find((ch) => ch.userData && ch.userData.kind === 'selectionHalo');
      if (sel) {
        if (boostLevel > 0) {
          sel.visible = true;
          const color = boostLevel >= 2 ? '#00c853' : '#1f77b4';
          sel.material.map = getSelectionHaloMaterial(color).map;
          const base = boostLevel >= 2 ? 0.7 : 0.55;
          sel.material.opacity = base + Math.sin(time * 0.9 + (ud.id || 0)) * 0.1;
        } else {
          sel.material.opacity = 0.0;
        }
      }

      const baseOpacity = ud.is_mismatch && state.showMismatch && (!state.activeParty || ud.party !== state.activeParty) ? 0.92 : 0.85;
      const targetOpacity = dimTo != null ? dimTo : boost ? 1.0 : baseOpacity;
      ud.opacityTarget = targetOpacity;
      if (ud.opacityTarget != null) {
        obj.material.opacity += (ud.opacityTarget - obj.material.opacity) * 0.25;
        if (Math.abs(ud.opacityTarget - obj.material.opacity) < 0.005) obj.material.opacity = ud.opacityTarget;
      }

      obj.scale.set(sx, sx, 1);

      const label = obj.children && obj.children.find((ch) => ch.userData && ch.userData.kind === 'nameLabel');
      if (label && label.userData.baseScale) {
        const inv = 1 / Math.max(0.2, sx);
        label.scale.set(label.userData.baseScale.x * inv, label.userData.baseScale.y * inv, 1);
        if (label.userData.basePos) {
          label.position.set(label.userData.basePos.x * inv, label.userData.basePos.y * inv, label.userData.basePos.z * inv);
        }
      }
    });

    // hover tooltip
    state.raycaster.setFromCamera(state.mouse, state.camera);
    const intersects = state.raycaster.intersectObjects(state.targetSprites);
    if (intersects.length > 0) {
      const target = intersects[0].object;
      const data = target.userData.data;
      if (state.tooltipEl) {
        state.tooltipEl.innerHTML = App.ui.buildTooltipHTML(data);
        state.tooltipEl.style.display = 'block';
      }
      document.body.style.cursor = 'pointer';
      if (!state.activeParty || data.party !== state.activeParty) target.scale.set(1.3, 1.3, 1);
    } else {
      if (state.tooltipEl) state.tooltipEl.style.display = 'none';
      document.body.style.cursor = 'default';
    }

    state.controls.update();
    state.renderer.render(state.scene, state.camera);
  }

  function focusCandidate(candidateObj) {
    const targetPos = candidateObj.position;
    state.controls.target.copy(targetPos);
    state.camera.position.set(targetPos.x, targetPos.y, targetPos.z + 15);
    state.controls.update();
  }

  function resetView() {
    state.camera.position.set(cfg.INITIAL_CAMERA_POS.x, cfg.INITIAL_CAMERA_POS.y, cfg.INITIAL_CAMERA_POS.z);
    state.controls.target.set(0, 0, 0);
    state.controls.update();
  }

  function initSearchUI() {
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    if (!searchInput || !searchResults) return;

    searchInput.addEventListener('input', function (e) {
      const val = e.target && e.target.value ? String(e.target.value).trim() : '';
      searchResults.innerHTML = '';
      if (!val) {
        searchResults.style.display = 'none';
        return;
      }

      const matches = state.candidateObjects.filter((obj) => {
        const n = obj.userData && obj.userData.name ? String(obj.userData.name) : '';
        const p = obj.userData && obj.userData.party ? String(obj.userData.party) : '';
        return n.includes(val) || p.includes(val);
      });
      if (matches.length > 0) {
        searchResults.style.display = 'block';
        matches.forEach((match) => {
          const li = document.createElement('li');
          li.className = 'search-item';
          const n = match.userData?.name ?? '';
          const p = match.userData?.party ?? '';
          li.innerHTML = `<span>${n}</span><span class="search-party">${p}</span>`;
          li.addEventListener('click', () => {
            focusCandidate(match);
            searchResults.style.display = 'none';
            searchInput.value = n;
          });
          searchResults.appendChild(li);
        });
      } else {
        searchResults.style.display = 'none';
      }
    });

    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const val = String(searchInput.value || '').trim();
        if (val === '') {
          resetView();
          searchInput.blur();
        } else {
          const first = searchResults.querySelector('.search-item');
          if (first) {
            first.click();
            searchInput.blur();
          }
        }
      }
    });
  }

  function initMobileToolbar() {
    const mq = window.matchMedia && window.matchMedia('(max-width: 600px)');
    const left = document.getElementById('left-stack');
    const right = document.getElementById('control-panel');
    const bParty = document.getElementById('mt-party');
    const bQ = document.getElementById('mt-question');
    const bClose = document.getElementById('mt-close');
    const search = document.getElementById('search-input');
    if (!mq || !left || !right || !bParty || !bQ || !bClose) return;

    function setActive(which) {
      const isMobile = mq.matches;
      if (!isMobile) {
        left.classList.remove('mobile-hidden');
        right.classList.remove('mobile-hidden');
        bParty.classList.remove('active');
        bQ.classList.remove('active');
        return;
      }
      if (which === 'left') {
        left.classList.remove('mobile-hidden');
        right.classList.add('mobile-hidden');
        bParty.classList.add('active');
        bQ.classList.remove('active');
        if (search) setTimeout(() => search.focus(), 0);
      } else if (which === 'right') {
        right.classList.remove('mobile-hidden');
        left.classList.add('mobile-hidden');
        bQ.classList.add('active');
        bParty.classList.remove('active');
      } else {
        left.classList.add('mobile-hidden');
        right.classList.add('mobile-hidden');
        bParty.classList.remove('active');
        bQ.classList.remove('active');
      }
    }

    setActive('none');
    mq.addEventListener?.('change', () => setActive('none'));
    bParty.addEventListener('click', () => {
      const open = !left.classList.contains('mobile-hidden');
      setActive(open ? 'none' : 'left');
    });
    bQ.addEventListener('click', () => {
      const open = !right.classList.contains('mobile-hidden');
      setActive(open ? 'none' : 'right');
    });
    bClose.addEventListener('click', () => setActive('none'));
  }

  function init() {
    // scene
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0xffffff);

    const gridHelper = new THREE.GridHelper(100, 20, 0x888888, 0xdddddd);
    gridHelper.rotation.x = Math.PI / 2;
    state.scene.add(gridHelper);

    const origin = new THREE.Vector3(0, 0, 0);
    const axesDefs = [
      { dir: new THREE.Vector3(1, 0, 0), color: 0xff0000, label: 'X' },
      { dir: new THREE.Vector3(0, 1, 0), color: 0x00aa00, label: 'Y' },
      { dir: new THREE.Vector3(0, 0, 1), color: 0x0000ff, label: 'Z' },
    ];
    axesDefs.forEach((def) => {
      state.scene.add(new THREE.ArrowHelper(def.dir, origin, 55, def.color, 2, 1));
      const labelData = createTextTexture(def.label);
      const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelData.texture, transparent: true, opacity: 0.8 }));
      labelSprite.position.copy(def.dir.clone().multiplyScalar(57));
      labelSprite.scale.set(labelData.width * 0.03, labelData.height * 0.03, 1);
      state.scene.add(labelSprite);
    });

    state.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    state.camera.position.set(cfg.INITIAL_CAMERA_POS.x, cfg.INITIAL_CAMERA_POS.y, cfg.INITIAL_CAMERA_POS.z);

    state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(state.renderer.domElement);

    state.controls = new THREE.OrbitControls(state.camera, state.renderer.domElement);
    state.controls.enableDamping = true;

    state.clusterOutlineGroup = new THREE.Group();
    state.scene.add(state.clusterOutlineGroup);

    state.raycaster = new THREE.Raycaster();
    state.mouse = new THREE.Vector2();
    state.tooltipEl = document.getElementById('tooltip');

    initPointerListenersOnce();
    initSearchUI();
    initMobileToolbar();

    window.addEventListener('resize', () => {
      state.camera.aspect = window.innerWidth / window.innerHeight;
      state.camera.updateProjectionMatrix();
      state.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    animate();
  }

  App.viewer.init = init;
  App.viewer.rebuildClusterOutlines = rebuildClusterOutlines;
  App.viewer.createCandidatesFromPoints = createCandidatesFromPoints;
  App.viewer.buildPointsMap = buildPointsMap;
  App.viewer.startTransitionTo = startTransitionTo;
  App.viewer.applyPartyClusterStyling = applyPartyClusterStyling;
  App.viewer.computeGlobalClustersForCurrentQuestion = computeGlobalClustersForCurrentQuestion;
  App.viewer.applyPartyVisibilityFilter = applyPartyVisibilityFilter;
})();


