(function () {
  'use strict';

  window.App = window.App || {};

  const state = App.state;
  const cfg = App.config;

  function parseOptionsText(optionsText) {
    const map = {};
    if (!optionsText) return map;
    optionsText.split('|').forEach((part) => {
      const p = part.trim();
      const i = p.indexOf(':');
      if (i > 0) {
        const key = p.slice(0, i).trim();
        const val = p.slice(i + 1).trim();
        map[key] = val;
      }
    });
    return map;
  }

  async function loadQuestionManifest() {
    const res = await fetch(cfg.MANIFEST_FILE, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${cfg.MANIFEST_FILE}: ${res.status}`);
    const m = await res.json();
    m.questions.forEach((q) => (q.optionsMap = parseOptionsText(q.options_text)));
    return m;
  }

  function embedFileFromQuestionAndMode(q, mode) {
    if (mode === 'pre_umap') {
      if (q.embed_file_umap) return q.embed_file_umap;
      if (q.embed_file) return q.embed_file.replace(/^embed_/, 'embed_umap_');
      return `embed_umap_${q.base}.json`;
    }
    if (mode === 'pre_pca') {
      if (q.embed_file_pca) return q.embed_file_pca;
      if (q.embed_file) return q.embed_file;
      return `embed_pca_${q.base}.json`;
    }
    // pca_js still needs a source file to load answers/metadata
    if (q.embed_file_pca) return q.embed_file_pca;
    if (q.embed_file) return q.embed_file;
    return `embed_pca_${q.base}.json`;
  }

  async function loadEmbeddingFor(base, mode) {
    const q = state.questionManifest.questions.find((x) => x.base === base);
    if (!q) throw new Error(`Unknown base: ${base}`);
    const embedFile = embedFileFromQuestionAndMode(q, mode);
    const res = await fetch('./data/' + embedFile, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${embedFile}: ${res.status}`);
    const emb = await res.json(); // {meta, data}
    return { q, emb };
  }

  async function applyQuestion(base, { firstInit = false } = {}) {
    const { q, emb } = await loadEmbeddingFor(base, state.embeddingMode);
    state.currentQuestion = q;
    state.pointsData = emb.data;
    state.loadedEmbeddingMeta = emb.meta || null;
    state.currentEmbeddingMeta = state.loadedEmbeddingMeta ? Object.assign({}, state.loadedEmbeddingMeta) : {};

    App.ui.resetOptionFilter();

    // embedding mode behavior
    const cols = state.currentQuestion?.columns ?? [];
    if (state.embeddingMode === 'pre_umap') {
      const m = state.loadedEmbeddingMeta && state.loadedEmbeddingMeta.method ? String(state.loadedEmbeddingMeta.method) : '';
      if (!m.toUpperCase().includes('UMAP')) {
        throw new Error('UMAP mode selected but loaded embedding is not UMAP. Generate UMAP embeddings and update manifest.');
      }
      state.currentEmbeddingMeta.method = 'UMAP(precomputed)';
    } else if (state.embeddingMode === 'pre_pca') {
      state.currentEmbeddingMeta.method = 'PCA(precomputed)';
    } else if (state.embeddingMode === 'pca_js') {
      try {
        const coords = App.embedding.projectTo3D(state.pointsData, cols, base);
        for (let i = 0; i < state.pointsData.length; i++) {
          state.pointsData[i].x = coords[i].x;
          state.pointsData[i].y = coords[i].y;
          state.pointsData[i].z = coords[i].z;
        }
        state.currentEmbeddingMeta.method = cols.length >= 3 ? 'PCA(JS)' : cols.length === 2 ? 'PCA2(JS)' : 'Curve1D(JS)';
      } catch (e) {
        console.warn('PCA recompute failed, fallback to precomputed coords', e);
        state.embeddingMode = 'pre_pca';
        state.currentEmbeddingMeta.method = 'PCA(precomputed)';
        const embModeSel = document.getElementById('embedding-mode');
        if (embModeSel) embModeSel.value = 'pre_pca';
        localStorage.setItem(cfg.EMBEDDING_MODE_STORAGE_KEY, state.embeddingMode);
      }
    }

    // global clusters (auto-k)
    const g = App.viewer.computeGlobalClustersForCurrentQuestion();
    state.pointsData.forEach((p) => {
      p.cluster_global = g.assign[p.id] ?? 0;
    });
    state.currentEmbeddingMeta.n_clusters = g.k;

    App.ui.updateQuestionUI(base);
    App.ui.updatePartySelectOptions();
    App.ui.buildOptionFilterUI();

    // keep party-cluster mode if enabled
    App.viewer.applyPartyClusterStyling();

    const pointsById = App.viewer.buildPointsMap(state.pointsData);
    if (firstInit) {
      App.viewer.createCandidatesFromPoints(state.pointsData);
      App.ui.updatePartySelectOptions();
      App.viewer.applyPartyClusterStyling();
    } else {
      App.viewer.rebuildClusterOutlines(state.pointsData, { animate: true });
      App.viewer.startTransitionTo(pointsById);
    }
  }

  function syncLegendSelection() {
    document.querySelectorAll('.legend-item').forEach((el) => {
      const label = (el.textContent || '').trim();
      if (state.activeParty && label === state.activeParty) el.classList.add('selected');
      else el.classList.remove('selected');
    });
  }

  async function bootstrap() {
    App.viewer.init();

    state.questionManifest = await loadQuestionManifest();

    const sel = document.getElementById('question-select');
    const embModeSel = document.getElementById('embedding-mode');

    if (embModeSel) {
      const saved = localStorage.getItem(cfg.EMBEDDING_MODE_STORAGE_KEY);
      if (saved === 'pca_js' || saved === 'pre_umap' || saved === 'pre_pca') state.embeddingMode = saved;
      embModeSel.value = state.embeddingMode;
      embModeSel.addEventListener('change', async () => {
        const v = embModeSel.value;
        const prev = state.embeddingMode;
        state.embeddingMode = v === 'pre_umap' ? 'pre_umap' : v === 'pre_pca' ? 'pre_pca' : 'pca_js';
        localStorage.setItem(cfg.EMBEDDING_MODE_STORAGE_KEY, state.embeddingMode);
        if (state.currentQuestion && state.currentQuestion.base) {
          try {
            await applyQuestion(state.currentQuestion.base, { firstInit: false });
          } catch (e) {
            console.error(e);
            if (state.embeddingMode === 'pre_umap') alert('UMAPデータが見つからないか読み込みに失敗しました。UMAP版（embed_umap_*.json）を public/data に配置してください。');
            else alert('埋め込みデータの読み込みに失敗しました。Consoleを確認してください。');
            state.embeddingMode = prev;
            embModeSel.value = prev;
            localStorage.setItem(cfg.EMBEDDING_MODE_STORAGE_KEY, state.embeddingMode);
          }
        }
      });
    }

    if (sel) {
      state.questionManifest.questions.forEach((q) => {
        const opt = document.createElement('option');
        opt.value = q.base;
        opt.textContent = q.base;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', async () => {
        await applyQuestion(sel.value, { firstInit: false });
      });
    }

    const tOutline = document.getElementById('toggle-cluster-outline');
    const tMismatch = document.getElementById('toggle-mismatch');
    const partySel = document.getElementById('party-select');
    const tPartyClusters = document.getElementById('toggle-party-clusters');

    if (partySel) {
      partySel.addEventListener('change', () => {
        state.activeParty = partySel.value || null;
        syncLegendSelection();
        App.viewer.applyPartyClusterStyling();
      });
    }
    if (tPartyClusters) {
      tPartyClusters.addEventListener('change', () => {
        state.showPartyClusters = tPartyClusters.checked;
        App.viewer.applyPartyClusterStyling();
      });
    }
    if (tOutline) {
      tOutline.addEventListener('change', () => {
        state.showClusterOutline = tOutline.checked;
        if (state.clusterOutlineGroup) state.clusterOutlineGroup.visible = state.showClusterOutline;
      });
    }
    if (tMismatch) {
      tMismatch.addEventListener('change', () => {
        state.showMismatch = tMismatch.checked;
        // immediate reflect
        state.candidateObjects.forEach((obj) => {
          if (!obj.userData) return;
          if (obj.userData.is_mismatch) {
            obj.children.forEach((ch) => {
              if (ch.userData && ch.userData.kind === 'mismatchHalo') {
                ch.visible = state.showMismatch;
                if (!state.showMismatch) ch.material.opacity = 0.0;
              }
            });
          }
        });
      });
    }

    // default Q1
    const defaultBase = state.questionManifest.questions.some((q) => q.base === 'Q1') ? 'Q1' : state.questionManifest.questions[0].base;
    await applyQuestion(defaultBase, { firstInit: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bootstrap().catch((e) => {
      console.error(e);
      const title = document.getElementById('question-title');
      if (title) title.textContent = 'データ読み込みに失敗しました。question_manifest.json と embed_*.json が同じフォルダにあるか確認してください。';
    });
  });
})();


