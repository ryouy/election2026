(function () {
  'use strict';

  window.App = window.App || {};

  App.config = {
    MANIFEST_FILE: './data/question_manifest.json',
    EMBEDDING_MODE_STORAGE_KEY: 'embedding_mode',

    // Cluster auto-k
    PARTY_CLUSTER_MIN_K: 2,
    PARTY_CLUSTER_MAX_K: 6,
    PARTY_CLUSTER_IMPROVE_THRESHOLD: 0.22,

    GLOBAL_CLUSTER_MIN_K: 4,
    GLOBAL_CLUSTER_MAX_K: 10,
    GLOBAL_CLUSTER_IMPROVE_THRESHOLD: 0.16,

    // Visual
    INITIAL_CAMERA_POS: { x: 0, y: 0, z: 85 },
  };

  App.consts = {
    PARTY_CLUSTER_COLORS: [
      '#1f77b4',
      '#ff7f0e',
      '#2ca02c',
      '#d62728',
      '#9467bd',
      '#8c564b',
      '#e377c2',
      '#7f7f7f',
      '#bcbd22',
      '#17becf',
    ],
    CLUSTER_PALETTE: [
      '#4C78A8',
      '#F58518',
      '#54A24B',
      '#E45756',
      '#72B7B2',
      '#EECA3B',
      '#B279A2',
      '#FF9DA6',
      '#9D755D',
      '#BAB0AC',
    ],
    PARTY_STYLE_PALETTE: [
      '#4C78A8',
      '#F58518',
      '#54A24B',
      '#E45756',
      '#72B7B2',
      '#EECA3B',
      '#B279A2',
      '#FF9DA6',
      '#9D755D',
      '#BAB0AC',
    ],
    PARTY_SHAPES: [0, 1, 2, 3], // circle, square, triangle, diamond
  };

  App.state = {
    // Data
    pointsData: [],
    questionManifest: null,
    currentQuestion: null,
    loadedEmbeddingMeta: null,
    currentEmbeddingMeta: null,

    // UI / filters
    legendData: [],
    activeParty: null,
    showClusterOutline: true,
    showMismatch: true,
    showPartyClusters: false,
    optionFilter: { active: false, column: '*', value: null },
    embeddingMode: 'pca_js', // "pca_js" | "pre_umap" | "pre_pca"

    // Caches
    partyStyleMap: {}, // party => {shape,color}
    partyClusterCache: {}, // key: base|mode::party
    globalClusterCache: {}, // key: base|mode

    // Three objects (initialized by viewer)
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    clusterOutlineGroup: null,
    outlineMeshByCluster: new Map(),
    candidateObjects: [],
    targetSprites: [],

    // Materials/textures
    materialCache: {},
    mismatchHaloMaterialCache: {},
    selectionHaloMaterialCache: {},

    // Smooth transition
    transition: { active: false, start: 0, duration: 1200 },

    // Input state
    mouse: null,
    raycaster: null,
    tooltipEl: null,
    pointerListenersInitialized: false,
  };
})();


