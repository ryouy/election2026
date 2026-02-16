// データは ../question_manifest.json と ../embed_Qxx.json を読み込む（public/ から見て親フォルダ想定）
        let pointsData = [];
        let questionManifest = null;
        let currentQuestion = null;
        let loadedEmbeddingMeta = null;   // as loaded from embed_*.json
        let currentEmbeddingMeta = null;  // for UI display (may be overwritten)
        let legendData = [];
        let activeParty = null;
        let showClusterOutline = true;
        let showMismatch = true;
        let partyStyleMap = {}; // party => {shape, color}
        let optionFilter = { active:false, column:"*", value:null }; // column="*" means any

        // embedding mode
        const EMBEDDING_MODE_STORAGE_KEY = "embedding_mode";
        let embeddingMode = "pca_js"; // "pca_js" | "pre_umap" | "pre_pca"

        function embeddingModeLabel(mode){
            if (mode === "pre_umap") return "UMAP(precomputed)";
            if (mode === "pre_pca") return "PCA(precomputed)";
            return "PCA(JS)";
        }

        // 党内クラスタ表示（選択政党だけ色替え）
        let showPartyClusters = false;
        let partyClusterCache = {}; // key: base+"::"+party => {id: cluster}
        const PARTY_CLUSTER_COLORS = ["#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd","#8c564b","#e377c2","#7f7f7f","#bcbd22","#17becf"];

        // クラスタ数の自動制御
        const PARTY_CLUSTER_MIN_K = 2;   // 党内クラスタ（設問×政党ごとに自動）
        const PARTY_CLUSTER_MAX_K = 6;
        const PARTY_CLUSTER_IMPROVE_THRESHOLD = 0.22; // 改善が小さければそれ以上割らない（割れすぎ防止）

        const GLOBAL_CLUSTER_MIN_K = 4;  // 全体クラスタ（設問ごとに自動）
        const GLOBAL_CLUSTER_MAX_K = 10;
        const GLOBAL_CLUSTER_IMPROVE_THRESHOLD = 0.16; // これ未満の改善なら増やしすぎ


        // クラスタ輪郭用（リング）テクスチャ
        function createRingTexture(color) {
            const size = 128;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');

            // outer ring
            ctx.clearRect(0,0,size,size);
            ctx.beginPath();
            const center = size/2;
            const r = size/2 - 10;
            ctx.arc(center, center, r, 0, Math.PI*2);
            ctx.strokeStyle = color;
            ctx.lineWidth = 10;
            ctx.stroke();

            // subtle glow
            ctx.beginPath();
            ctx.arc(center, center, r, 0, Math.PI*2);
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.35;
            ctx.lineWidth = 18;
            ctx.stroke();
            ctx.globalAlpha = 1.0;

            return new THREE.CanvasTexture(canvas);
        }

        function createHaloTexture(color){
            const size = 128;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');

            const g = ctx.createRadialGradient(size/2, size/2, size*0.18, size/2, size/2, size*0.5);
            g.addColorStop(0.0, 'rgba(255,255,255,0.0)');
            // color halo
            // inner ring
            g.addColorStop(0.35, hexToRgba(color, 0.28));
            g.addColorStop(0.55, hexToRgba(color, 0.12));
            g.addColorStop(1.0, 'rgba(255,255,255,0.0)');

            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(size/2, size/2, size/2 - 2, 0, Math.PI*2);
            ctx.fill();

            const tex = new THREE.CanvasTexture(canvas);
            tex.minFilter = THREE.LinearFilter;
            return tex;
        }

        // 選択強調用ハロー（政党/選択肢フィルタ）
        let selectionHaloMaterialCache = {};
        function getSelectionHaloMaterial(color){
            const c = color || "#1f77b4";
            const hkey = "sel_" + c;
            if (!selectionHaloMaterialCache[hkey]) {
                selectionHaloMaterialCache[hkey] = new THREE.SpriteMaterial({
                    map: createHaloTexture(c),
                    transparent: true,
                    opacity: 0.0,
                    depthTest: false
                });
            }
            return selectionHaloMaterialCache[hkey];
        }

        function hexToRgba(hex, a){
            const h = (hex||'#ffffff').replace('#','');
            const r = parseInt(h.substring(0,2),16);
            const g = parseInt(h.substring(2,4),16);
            const b = parseInt(h.substring(4,6),16);
            return `rgba(${r},${g},${b},${a})`;
        }



        const clusterPalette = [
            "#4C78A8","#F58518","#54A24B","#E45756","#72B7B2",
            "#EECA3B","#B279A2","#FF9DA6","#9D755D","#BAB0AC"
        ];
        function clusterColor(clusterId){
            const i = ((clusterId ?? 0) % clusterPalette.length + clusterPalette.length) % clusterPalette.length;
            return clusterPalette[i];
        }

        // --- 党内クラスタ用: シード付き乱数（安定） ---
        function hash32(str){
            let h = 2166136261 >>> 0;
            for (let i=0;i<str.length;i++){
                h ^= str.charCodeAt(i);
                h = Math.imul(h, 16777619);
            }
            return h >>> 0;
        }
        function mulberry32(a){
            return function() {
                let t = a += 0x6D2B79F5;
                t = Math.imul(t ^ (t >>> 15), t | 1);
                t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            }
        }

        function withinClusterColor(k){
            return PARTY_CLUSTER_COLORS[k % PARTY_CLUSTER_COLORS.length];
        }

        // -----------------------------
        // 設問切替時に「同じに見える」問題対策：
        // embed_*.json の座標をそのまま使わず、設問の回答列から毎回PCA(>=3列)を再計算し、
        // 低次元(1〜2列)は設問ごとに位相が変わる曲線/面に埋め込む。
        // -----------------------------
        function numericOrNaN(v){
            if (v == null) return NaN;
            if (v === '-' || v === '') return NaN;
            const n = Number(v);
            return Number.isFinite(n) ? n : NaN;
        }

        function getFillValueForBase(base){
            if (base === "Q25") return 5.0;
            if (base === "Q1" || base === "Q24") return 0.0;
            return 3.0;
        }

        function buildFeatureMatrix(pointsArray, cols, base){
            const fill = getFillValueForBase(base);
            const n = pointsArray.length;
            const d = cols.length;
            const X = Array.from({length:n}, ()=>new Array(d).fill(0));
            // fill numeric
            for (let i=0;i<n;i++){
                const p = pointsArray[i];
                for (let j=0;j<d;j++){
                    const col = cols[j];
                    const raw = p[col];
                    const v = numericOrNaN(raw);
                    X[i][j] = Number.isFinite(v) ? v : fill;
                }
            }
            // min-max -> [-1,1] per col
            for (let j=0;j<d;j++){
                let mn = Infinity, mx = -Infinity;
                for (let i=0;i<n;i++){
                    const v = X[i][j];
                    if (v < mn) mn = v;
                    if (v > mx) mx = v;
                }
                if (!Number.isFinite(mn) || !Number.isFinite(mx) || Math.abs(mx-mn) < 1e-9){
                    for (let i=0;i<n;i++) X[i][j] = 0;
                    continue;
                }
                const mid = (mx + mn) / 2;
                const half = (mx - mn) / 2;
                for (let i=0;i<n;i++){
                    let v = (X[i][j] - mid) / half;
                    if (v > 1) v = 1;
                    if (v < -1) v = -1;
                    X[i][j] = v;
                }
            }
            // center columns
            for (let j=0;j<d;j++){
                let s=0;
                for (let i=0;i<n;i++) s += X[i][j];
                const mean = s / Math.max(1,n);
                for (let i=0;i<n;i++) X[i][j] -= mean;
            }
            return X;
        }

        function matVecMul(A, v){
            const n = A.length;
            const out = new Array(n).fill(0);
            for (let i=0;i<n;i++){
                let s=0;
                const row = A[i];
                for (let j=0;j<n;j++) s += row[j] * v[j];
                out[i] = s;
            }
            return out;
        }

        function dot(a,b){
            let s=0;
            for (let i=0;i<a.length;i++) s += a[i]*b[i];
            return s;
        }

        function norm(v){
            return Math.sqrt(Math.max(1e-12, dot(v,v)));
        }

        function normalize(v){
            const n = norm(v);
            return v.map(x=>x/n);
        }

        function outer(v){
            const n = v.length;
            const M = Array.from({length:n}, ()=>new Array(n).fill(0));
            for (let i=0;i<n;i++){
                for (let j=0;j<n;j++){
                    M[i][j] = v[i]*v[j];
                }
            }
            return M;
        }

        function subMat(A, B, scale=1.0){
            const n = A.length;
            for (let i=0;i<n;i++){
                for (let j=0;j<n;j++){
                    A[i][j] -= scale * B[i][j];
                }
            }
        }

        function covarianceMatrix(X){
            const n = X.length;
            const d = X[0]?.length ?? 0;
            const C = Array.from({length:d}, ()=>new Array(d).fill(0));
            const inv = 1 / Math.max(1, n-1);
            for (let i=0;i<n;i++){
                const row = X[i];
                for (let a=0;a<d;a++){
                    const va = row[a];
                    for (let b=a;b<d;b++){
                        C[a][b] += va * row[b];
                    }
                }
            }
            for (let a=0;a<d;a++){
                for (let b=a;b<d;b++){
                    C[a][b] *= inv;
                    if (a !== b) C[b][a] = C[a][b];
                }
            }
            return C;
        }

        function powerIteration(C, seedVec, iters=28){
            let v = normalize(seedVec);
            for (let k=0;k<iters;k++){
                v = normalize(matVecMul(C, v));
            }
            const Cv = matVecMul(C, v);
            const lam = dot(v, Cv);
            return {vector: v, value: lam};
        }

        function pcaTop3(X, seedStr){
            const d = X[0]?.length ?? 0;
            const C0 = covarianceMatrix(X);
            // copy
            const C = C0.map(r=>r.slice());
            const rand = mulberry32(hash32(seedStr));
            const basis = [];

            for (let comp=0; comp<Math.min(3,d); comp++){
                const seed = new Array(d).fill(0).map(()=>rand()*2-1);
                const {vector, value} = powerIteration(C, seed);
                basis.push(vector);
                // deflation
                const vvT = outer(vector);
                subMat(C, vvT, value);
            }
            return basis; // array of vectors length d
        }

        function randn(rand){
            // Box-Muller (deterministic with provided rand())
            let u = 0, v = 0;
            while (u === 0) u = rand();
            while (v === 0) v = rand();
            return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        }

        function projectTo3D(pointsArray, cols, base){
            const X = buildFeatureMatrix(pointsArray, cols, base);
            const n = X.length;
            const d = cols.length;
            const coords = Array.from({length:n}, ()=>({x:0,y:0,z:0}));

            if (d >= 3){
                const W = pcaTop3(X, base + "|pca");
                for (let i=0;i<n;i++){
                    const row = X[i];
                    const x = dot(row, W[0]);
                    const y = dot(row, W[1] || W[0]);
                    const z = dot(row, W[2] || W[0]);
                    coords[i] = {x,y,z};
                }
            } else if (d === 2){
                // 2DはPC1/PC2を取って、設問ごとに回転した面へ埋め込む
                const W2 = pcaTop3(X, base + "|pca2");
                for (let i=0;i<n;i++){
                    const row = X[i];
                    const a = dot(row, W2[0]);
                    const b = dot(row, W2[1] || W2[0]);
                    // slight nonlinearity so questions differ more
                    coords[i] = {x:a, y:b, z:0.35*a + 0.20*b};
                }
            } else if (d === 1){
                // 1Dは「同じに見える」問題が起きやすいので、設問ごとに位相が変わる3D曲線へ
                const phase = (hash32(base) % 360) * Math.PI / 180;
                const r = 18;
                for (let i=0;i<n;i++){
                    const t = X[i][0]; // centered in [-1,1] scale
                    const ang = phase + t * 2.2 * Math.PI;
                    coords[i] = {x: 26*t, y: r*Math.sin(ang), z: r*Math.cos(ang)};
                }
            } else {
                // no columns
                return coords;
            }

            // scale to similar magnitude (std -> 30)
            let sx=0,sy=0,sz=0;
            for (let i=0;i<n;i++){
                sx += coords[i].x*coords[i].x;
                sy += coords[i].y*coords[i].y;
                sz += coords[i].z*coords[i].z;
            }
            const fx = 30 / (Math.sqrt(sx/Math.max(1,n)) + 1e-9);
            const fy = 30 / (Math.sqrt(sy/Math.max(1,n)) + 1e-9);
            const fz = 30 / (Math.sqrt(sz/Math.max(1,n)) + 1e-9);
            for (let i=0;i<n;i++){
                coords[i].x *= fx; coords[i].y *= fy; coords[i].z *= fz;
            }

            // 離散選択肢が少ない設問は「同一座標に重なる」ので、設問×候補者IDで決定的なジッターを付与
            // uniqueパターンが少ないほど、ジッターを少し強める
            try{
                const uniq = new Set();
                for (let i=0;i<n;i++){
                    const row = X[i];
                    // coarse quantize (離散/少数選択肢を想定)
                    const key = row.map(v => Math.round(v * 10) / 10).join(',');
                    uniq.add(key);
                }
                const u = uniq.size;
                const ratio = u / Math.max(1, n);
                // uが小さい（選択肢が少ない/偏ってる）ほど強く散らす
                let sd = 0.0;
                if (u <= 3) sd = 3.5;
                else if (u <= 6) sd = 2.6;
                else if (u <= 10) sd = 1.8;
                else if (ratio < 0.08) sd = 1.5;
                else if (ratio < 0.14) sd = 1.0;
                else sd = 0.6;

                for (let i=0;i<n;i++){
                    const id = pointsArray[i]?.id ?? i;
                    const r = mulberry32(hash32(base + "|jitter|" + id));
                    coords[i].x += randn(r) * sd;
                    coords[i].y += randn(r) * sd;
                    coords[i].z += randn(r) * sd;
                }
            } catch(e){
                // ignore
            }
            return coords;
        }

        // --- 政党スタイル（色/形）: embed_*.json には shape/color が無いのでここで付与 ---
        const PARTY_STYLE_PALETTE = [
            "#4C78A8","#F58518","#54A24B","#E45756","#72B7B2",
            "#EECA3B","#B279A2","#FF9DA6","#9D755D","#BAB0AC"
        ];
        const PARTY_SHAPES = [0,1,2,3]; // circle, square, triangle, diamond

        function partyStyleFor(party){
            const p = (party && String(party).trim()) ? String(party).trim() : "（不明）";
            const h = hash32(p);
            const color = PARTY_STYLE_PALETTE[h % PARTY_STYLE_PALETTE.length];
            const shape = PARTY_SHAPES[(h >>> 8) % PARTY_SHAPES.length];
            return { color, shape };
        }

        function applyPartyStyles(pointsArray){
            partyStyleMap = {};
            pointsArray.forEach(pt => {
                const party = (pt.party && String(pt.party).trim()) ? String(pt.party).trim() : "（不明）";
                if (!partyStyleMap[party]) partyStyleMap[party] = partyStyleFor(party);
                const st = partyStyleMap[party];
                pt.party = party;
                pt.color = st.color;
                pt.shape = st.shape;
            });
        }

        function resetOptionFilter(){
            optionFilter = { active:false, column:"*", value:null };
            updateOptionChipsSelectionUI();
        }

        function updateOptionChipsSelectionUI(){
            const chips = document.querySelectorAll('#option-chips .chip');
            chips.forEach(ch=>{
                const v = ch.getAttribute('data-value');
                if (optionFilter.active && String(optionFilter.value) === String(v)) ch.classList.add('selected');
                else ch.classList.remove('selected');
            });
        }

        function candidateMatchesOption(data){
            if (!optionFilter.active) return true;
            if (!data) return false;
            const v = String(optionFilter.value);
            const cols = currentQuestion?.columns ?? [];
            const col = optionFilter.column;
            const matchIn = (c)=>{
                const raw = data[c];
                if (raw == null) return false;
                if (raw === '-' || raw === '') return false;
                return String(raw) === v;
            };
            if (col && col !== "*") return matchIn(col);
            return cols.some(matchIn);
        }

        function buildOptionFilterUI(){
            const box = document.getElementById('option-filter');
            const colSel = document.getElementById('column-select');
            const chipsWrap = document.getElementById('option-chips');
            const clearBtn = document.getElementById('clear-option');
            if (!box || !colSel || !chipsWrap || !clearBtn) return;

            const cols = currentQuestion?.columns ?? [];
            const optionsMap = currentQuestion?.optionsMap ?? {};

            // columns
            colSel.innerHTML = '';
            if (cols.length <= 1){
                const opt = document.createElement('option');
                opt.value = cols[0] ?? "*";
                opt.textContent = cols[0] ? labelForColumn(cols[0]) : '（対象なし）';
                colSel.appendChild(opt);
                optionFilter.column = cols[0] ?? "*";
            } else {
                const any = document.createElement('option');
                any.value = "*";
                any.textContent = "（どれでも）";
                colSel.appendChild(any);
                cols.forEach(c=>{
                    const opt = document.createElement('option');
                    opt.value = c;
                    opt.textContent = labelForColumn(c);
                    colSel.appendChild(opt);
                });
                // keep previous if still available
                const prev = optionFilter.column;
                if (prev && (prev === "*" || cols.includes(prev))) colSel.value = prev;
                else colSel.value = "*";
                optionFilter.column = colSel.value;
            }

            colSel.onchange = ()=>{
                optionFilter.column = colSel.value;
            };

            clearBtn.onclick = ()=>{
                resetOptionFilter();
            };

            // chips
            const keys = Object.keys(optionsMap || {});
            if (!keys.length){
                box.style.display = 'none';
                return;
            }
            box.style.display = 'block';

            const sortable = keys.map(k=>{
                const n = Number(k);
                return {k, n: Number.isFinite(n) ? n : null, label: optionsMap[k]};
            });
            sortable.sort((a,b)=>{
                if (a.n != null && b.n != null) return a.n - b.n;
                if (a.n != null) return -1;
                if (b.n != null) return 1;
                return String(a.k).localeCompare(String(b.k), 'ja');
            });

            chipsWrap.innerHTML = '';
            sortable.forEach(({k, label})=>{
                const chip = document.createElement('div');
                chip.className = 'chip';
                chip.setAttribute('data-value', String(k));
                chip.textContent = `${k}: ${label}`;
                chip.onclick = ()=>{
                    if (optionFilter.active && String(optionFilter.value) === String(k)){
                        resetOptionFilter();
                    } else {
                        optionFilter.active = true;
                        optionFilter.value = String(k);
                        updateOptionChipsSelectionUI();
                    }
                };
                chipsWrap.appendChild(chip);
            });
            updateOptionChipsSelectionUI();
        }

        // --- 簡易KMeans（3D）: points = [{id,x,y,z}, ...] ---
        function kmeans3D(points, k, seedStr){
            const n = points.length;
            if (n === 0) return {assign:{}, k:0};
            k = Math.max(1, Math.min(k, n));

            const rand = mulberry32(hash32(seedStr));

            // kmeans++ init
            const centers = [];
            const first = Math.floor(rand() * n);
            centers.push([points[first].x, points[first].y, points[first].z]);

            const dist2 = (p,c)=>{ const dx=p.x-c[0], dy=p.y-c[1], dz=p.z-c[2]; return dx*dx+dy*dy+dz*dz; };

            while (centers.length < k){
                let sum = 0;
                const dists = new Array(n);
                for (let i=0;i<n;i++){
                    let best = Infinity;
                    for (let j=0;j<centers.length;j++){
                        const d = dist2(points[i], centers[j]);
                        if (d < best) best = d;
                    }
                    dists[i] = best;
                    sum += best;
                }
                if (sum === 0){
                    // 全点同一点等
                    while (centers.length < k) centers.push([...centers[0]]);
                    break;
                }
                let r = rand() * sum;
                let idx = 0;
                for (; idx<n; idx++){
                    r -= dists[idx];
                    if (r <= 0) break;
                }
                idx = Math.min(idx, n-1);
                centers.push([points[idx].x, points[idx].y, points[idx].z]);
            }

            const assign = {};
            let changed = true;
            let iter = 0;

            while (changed && iter < 25){
                changed = false;
                // assign
                const groups = Array.from({length:k}, ()=>({sx:0,sy:0,sz:0,c:0}));
                for (let i=0;i<n;i++){
                    let bestJ = 0, bestD = Infinity;
                    for (let j=0;j<k;j++){
                        const d = dist2(points[i], centers[j]);
                        if (d < bestD){ bestD = d; bestJ = j; }
                    }
                    const prev = assign[points[i].id];
                    if (prev === undefined || prev !== bestJ) changed = true;
                    assign[points[i].id] = bestJ;
                    const g = groups[bestJ];
                    g.sx += points[i].x; g.sy += points[i].y; g.sz += points[i].z; g.c += 1;
                }
                // update centers
                for (let j=0;j<k;j++){
                    const g = groups[j];
                    if (g.c > 0){
                        centers[j] = [g.sx/g.c, g.sy/g.c, g.sz/g.c];
                    }
                }
                iter++;
            }
            return {assign, k, centers};
        }

        function wcss(points, assign, centers){
            let sum = 0;
            for (let i=0;i<points.length;i++){
                const p = points[i];
                const j = assign[p.id] ?? 0;
                const c = centers[j] ?? centers[0];
                const dx = p.x - c[0], dy = p.y - c[1], dz = p.z - c[2];
                sum += dx*dx + dy*dy + dz*dz;
            }
            return sum;
        }

        function chooseKByElbow(points, {kMin, kMax, seedStr, improveThreshold}){
            const n = points.length;
            if (n <= 0) return {assign:{}, k:0};
            if (n < 3) {
                const res = kmeans3D(points, 1, seedStr);
                return {assign: res.assign, k: res.k};
            }

            kMax = Math.max(1, Math.min(kMax, n));
            kMin = Math.max(1, Math.min(kMin, kMax));

            const candidates = [];
            for (let k=kMin; k<=kMax; k++) candidates.push(k);
            if (!candidates.length){
                const res = kmeans3D(points, 1, seedStr);
                return {assign: res.assign, k: res.k};
            }

            let best = null;
            let prev = null;
            for (const k of candidates){
                const res = kmeans3D(points, k, seedStr);
                const s = wcss(points, res.assign, res.centers);
                if (prev != null){
                    const improve = (prev - s) / Math.max(prev, 1e-9);
                    if (improve < improveThreshold){
                        break;
                    }
                }
                best = {assign: res.assign, k: res.k, score: s};
                prev = s;
            }
            if (!best){
                const res = kmeans3D(points, candidates[0], seedStr);
                best = {assign: res.assign, k: res.k};
            }
            return {assign: best.assign, k: best.k};
        }

        // 全体クラスタ数（設問ごと）を自動決定してクラスタIDを付与
        let globalClusterCache = {}; // base -> {assign,k}
        function computeGlobalClustersForCurrentQuestion(){
            if (!currentQuestion) return {assign:{}, k:0};
            const base = currentQuestion.base;
            const cacheKey = base + "|" + embeddingMode;
            if (globalClusterCache[cacheKey]) return globalClusterCache[cacheKey];

            const pts = pointsData.map(p => ({id: p.id, x: p.x, y: p.y, z: p.z}));
            const n = pts.length;
            const kMax = Math.min(GLOBAL_CLUSTER_MAX_K, Math.max(1, Math.floor(Math.sqrt(n))));
            const kMin = Math.min(GLOBAL_CLUSTER_MIN_K, kMax);
            const best = chooseKByElbow(pts, {
                kMin,
                kMax,
                seedStr: base + "|global",
                improveThreshold: GLOBAL_CLUSTER_IMPROVE_THRESHOLD
            });
            globalClusterCache[cacheKey] = {assign: best.assign, k: best.k};
            return globalClusterCache[cacheKey];
        }

        function computePartyClustersForCurrentQuestion(party){
            if (!currentQuestion || !party) return {assign:{}, k:0};
            const base = currentQuestion.base;
            const key = base + "|" + embeddingMode + "::" + party;
            if (partyClusterCache[key]) return partyClusterCache[key];

            const pts = pointsData.filter(p => p.party === party).map(p => ({id: p.id, x: p.x, y: p.y, z: p.z}));
            const n = pts.length;
            const kMax = Math.min(PARTY_CLUSTER_MAX_K, Math.max(PARTY_CLUSTER_MIN_K, Math.floor(Math.sqrt(n))));
            const kMin = Math.min(PARTY_CLUSTER_MIN_K, kMax);
            const best = chooseKByElbow(pts, {
                kMin,
                kMax,
                seedStr: base + "|" + party,
                improveThreshold: PARTY_CLUSTER_IMPROVE_THRESHOLD
            });
            partyClusterCache[key] = best;
            return best;
        }

        function updateTargetSpritesFromVisibility(){
            targetSprites = candidateObjects.filter(o => o.visible);
        }

        function applyPartyVisibilityFilter(){
            // 党内クラスタ表示中は「選択政党以外は非表示」にして見やすくする
            const hideOthers = !!(showPartyClusters && activeParty);
            candidateObjects.forEach(obj => {
                const d = obj.userData?.data;
                if (!d) return;
                obj.visible = hideOthers ? (d.party === activeParty) : true;
            });

            // グローバル輪郭は党内クラスタ表示中は邪魔になりやすいので隠す
            clusterOutlineGroup.visible = hideOthers ? false : showClusterOutline;
            updateTargetSpritesFromVisibility();
        }

        // 選択政党だけ色替えを適用
        function applyPartyClusterStyling(){
            const legend = document.getElementById("party-cluster-legend");
            if (!showPartyClusters || !activeParty){
                // revert
                legend.style.display = "none";
                applyPartyVisibilityFilter();
                candidateObjects.forEach(obj => {
                    const d = obj.userData.data;
                    if (!d) return;
                    const key = d.shape + "_" + d.color;
                    if (materialCache && materialCache[key]){
                        // mismatchでclone済みの場合はmapだけ戻す
                        obj.material.opacity = 0.0;
                        obj.userData.opacityTarget = 0.85;
                        obj.material.map = materialCache[key].map;
                        obj.material.needsUpdate = true;
                    }
                });
                return;
            }

            // 党内クラスタ表示時は他党を非表示
            applyPartyVisibilityFilter();

            const res = computePartyClustersForCurrentQuestion(activeParty);
            const counts = new Array(res.k).fill(0);
            candidateObjects.forEach(obj => {
                const d = obj.userData.data;
                if (!d) return;
                if (d.party !== activeParty) return; // 非表示
                const cid = res.assign[d.id] ?? 0;
                counts[cid] += 1;

                const color = withinClusterColor(cid);
                const mkey = "pc_" + d.shape + "_" + color;
                if (!materialCache[mkey]){
                    materialCache[mkey] = new THREE.SpriteMaterial({ map: createShapeTexture(d.shape, color), transparent: true, opacity: obj.material.opacity ?? 0.85 });
                }
                obj.material.opacity = 0.0;
                obj.userData.opacityTarget = 0.85;
                obj.material.map = materialCache[mkey].map;
                obj.material.needsUpdate = true;

                obj.userData.within_party_cluster = cid;
            });

            // legend update
            legend.innerHTML = `<div style="font-weight:700; margin-bottom:4px;">${activeParty} 党内グループ</div>
                               <div style="opacity:0.75; font-size:11px;">※党内クラスタ表示中は他党を非表示にします</div>`;
            for (let i=0;i<res.k;i++){
                const row = document.createElement("div");
                row.className = "pcl-item";
                const sw = document.createElement("span");
                sw.className = "pcl-swatch";
                sw.style.background = withinClusterColor(i);
                const label = document.createElement("span");
                label.textContent = `グループ ${String.fromCharCode(65+i)} (${counts[i]}人)`;
                row.appendChild(sw);
                row.appendChild(label);
                legend.appendChild(row);
            }
            legend.style.display = "block";
        }


        // --- 1. テクスチャ生成関数 ---
        function createShapeTexture(type, color) {
            const size = 128;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = color;
            const center = size / 2;
            const radius = size / 2 - 10;
            ctx.beginPath();
            if (type === 0) { ctx.arc(center, center, radius, 0, Math.PI * 2); }
            else if (type === 1) { ctx.rect(10, 10, size - 20, size - 20); }
            else if (type === 2) { ctx.moveTo(center, 10); ctx.lineTo(size - 10, size - 10); ctx.lineTo(10, size - 10); ctx.closePath(); }
            else if (type === 3) { ctx.moveTo(center, 10); ctx.lineTo(size - 10, center); ctx.lineTo(center, size - 10); ctx.lineTo(10, center); ctx.closePath(); }
            ctx.fill();
            return new THREE.CanvasTexture(canvas);
        }

        function createTextTexture(text) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const fontSize = 64; 
            ctx.font = "bold " + fontSize + "px 'Noto Sans JP', sans-serif";
            const textMetrics = ctx.measureText(text);
            canvas.width = textMetrics.width + 10;
            canvas.height = fontSize + 10;
            ctx.font = "bold " + fontSize + "px 'Noto Sans JP', sans-serif";
            ctx.fillStyle = "rgba(0, 0, 0, 0.8)"; 
            ctx.textBaseline = "middle";
            ctx.fillText(text, 5, canvas.height / 2);
            const texture = new THREE.CanvasTexture(canvas);
            texture.minFilter = THREE.LinearFilter;
            return { texture: texture, width: canvas.width, height: canvas.height };
        }

        // --- 2. Three.js セットアップ ---
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xffffff); 
        const gridHelper = new THREE.GridHelper(100, 20, 0x888888, 0xdddddd);
        gridHelper.rotation.x = Math.PI / 2; 
        scene.add(gridHelper);

        const origin = new THREE.Vector3(0, 0, 0);
        const axesDefs = [
            { dir: new THREE.Vector3(1, 0, 0), color: 0xff0000, label: "X" }, 
            { dir: new THREE.Vector3(0, 1, 0), color: 0x00aa00, label: "Y" }, 
            { dir: new THREE.Vector3(0, 0, 1), color: 0x0000ff, label: "Z" }
        ];
        axesDefs.forEach(def => {
            scene.add(new THREE.ArrowHelper(def.dir, origin, 55, def.color, 2, 1));
            const labelData = createTextTexture(def.label);
            const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelData.texture, transparent: true, opacity: 0.8 }));
            labelSprite.position.copy(def.dir.clone().multiplyScalar(57));
            labelSprite.scale.set(labelData.width * 0.03, labelData.height * 0.03, 1);
            scene.add(labelSprite);
        });

        // 初期表示は少し引き気味に
        const initialCameraPos = { x: 0, y: 0, z: 85 };
        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(initialCameraPos.x, initialCameraPos.y, initialCameraPos.z);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(renderer.domElement);

        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        // --- 3. データ描画 ---
        let materialCache = {};
        let ringMaterialCache = {};
        let mismatchHaloMaterialCache = {};
        let candidateObjects = []; 
        const clusterOutlineGroup = new THREE.Group();
        scene.add(clusterOutlineGroup);

        // クラスタ輪郭（楕円体）用
        const OUTLINE_UNIT_SPHERE = new THREE.SphereGeometry(1, 22, 16);
        const outlineMeshByCluster = new Map(); // cid -> mesh

        // --- 対称3x3の固有分解（Jacobi法） ---
        function eigenSym3_jacobi(m00,m01,m02,m11,m12,m22, iters=18){
            // matrix A
            let a00=m00, a01=m01, a02=m02, a11=m11, a12=m12, a22=m22;
            // eigenvectors V (identity)
            let v00=1, v01=0, v02=0;
            let v10=0, v11=1, v12=0;
            let v20=0, v21=0, v22=1;

            function rot(p,q, c,s){
                // rotate rows/cols p,q of A (symmetric)
                // update A entries
                if (p===0 && q===1){
                    const a00n = c*c*a00 - 2*s*c*a01 + s*s*a11;
                    const a11n = s*s*a00 + 2*s*c*a01 + c*c*a11;
                    const a01n = (c*c - s*s)*a01 + s*c*(a00 - a11);
                    const a02n = c*a02 - s*a12;
                    const a12n = s*a02 + c*a12;
                    a00=a00n; a11=a11n; a01=a01n; a02=a02n; a12=a12n;
                } else if (p===0 && q===2){
                    const a00n = c*c*a00 - 2*s*c*a02 + s*s*a22;
                    const a22n = s*s*a00 + 2*s*c*a02 + c*c*a22;
                    const a02n = (c*c - s*s)*a02 + s*c*(a00 - a22);
                    const a01n = c*a01 - s*a12;
                    const a12n = s*a01 + c*a12;
                    a00=a00n; a22=a22n; a02=a02n; a01=a01n; a12=a12n;
                } else if (p===1 && q===2){
                    const a11n = c*c*a11 - 2*s*c*a12 + s*s*a22;
                    const a22n = s*s*a11 + 2*s*c*a12 + c*c*a22;
                    const a12n = (c*c - s*s)*a12 + s*c*(a11 - a22);
                    const a01n = c*a01 - s*a02;
                    const a02n = s*a01 + c*a02;
                    a11=a11n; a22=a22n; a12=a12n; a01=a01n; a02=a02n;
                }
            }
            function rotV(p,q,c,s){
                // V = V * R
                if (p===0 && q===1){
                    const t00 = c*v00 - s*v01, t01 = s*v00 + c*v01;
                    const t10 = c*v10 - s*v11, t11 = s*v10 + c*v11;
                    const t20 = c*v20 - s*v21, t21 = s*v20 + c*v21;
                    v00=t00; v01=t01; v10=t10; v11=t11; v20=t20; v21=t21;
                } else if (p===0 && q===2){
                    const t00 = c*v00 - s*v02, t02 = s*v00 + c*v02;
                    const t10 = c*v10 - s*v12, t12 = s*v10 + c*v12;
                    const t20 = c*v20 - s*v22, t22 = s*v20 + c*v22;
                    v00=t00; v02=t02; v10=t10; v12=t12; v20=t20; v22=t22;
                } else if (p===1 && q===2){
                    const t01 = c*v01 - s*v02, t02 = s*v01 + c*v02;
                    const t11 = c*v11 - s*v12, t12 = s*v11 + c*v12;
                    const t21 = c*v21 - s*v22, t22 = s*v21 + c*v22;
                    v01=t01; v02=t02; v11=t11; v12=t12; v21=t21; v22=t22;
                }
            }

            for (let k=0;k<iters;k++){
                // pick largest offdiag
                const ab01 = Math.abs(a01), ab02 = Math.abs(a02), ab12 = Math.abs(a12);
                let p=0,q=1, apq=a01, app=a00, aqq=a11;
                if (ab02 > ab01 && ab02 >= ab12){ p=0;q=2; apq=a02; app=a00; aqq=a22; }
                else if (ab12 > ab01 && ab12 > ab02){ p=1;q=2; apq=a12; app=a11; aqq=a22; }
                if (Math.abs(apq) < 1e-10) break;

                const tau = (aqq - app) / (2*apq);
                const t = Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau*tau));
                const c = 1 / Math.sqrt(1 + t*t);
                const s = t * c;

                rot(p,q,c,s);
                rotV(p,q,c,s);
            }

            const evals = [a00, a11, a22];
            const evecs = [
                [v00, v10, v20],
                [v01, v11, v21],
                [v02, v12, v22],
            ];

            // sort by eigenvalue desc
            const idx = [0,1,2].sort((i,j)=>evals[j]-evals[i]);
            const vals = idx.map(i=>evals[i]);
            const vecs = idx.map(i=>evecs[i]);
            return { values: vals, vectors: vecs };
        }

        function computeClusterEllipsoidTargets(pointsArray){
            // cid -> {pos:Vector3, scale:Vector3, quat:Quaternion}
            const by = new Map();
            pointsArray.forEach(p=>{
                const cid = (p.cluster_global ?? 0);
                if (!by.has(cid)) by.set(cid, {sx:0,sy:0,sz:0,c:0, pts:[]});
                const g = by.get(cid);
                g.sx += p.x; g.sy += p.y; g.sz += p.z; g.c += 1;
                g.pts.push([p.x,p.y,p.z]);
            });
            const out = new Map();
            by.forEach((g, cid)=>{
                if (!g.c) return;
                const cx=g.sx/g.c, cy=g.sy/g.c, cz=g.sz/g.c;

                // covariance
                let sxx=0, sxy=0, sxz=0, syy=0, syz=0, szz=0;
                for (const [x,y,z] of g.pts){
                    const dx=x-cx, dy=y-cy, dz=z-cz;
                    sxx += dx*dx; sxy += dx*dy; sxz += dx*dz;
                    syy += dy*dy; syz += dy*dz;
                    szz += dz*dz;
                }
                const inv = 1 / Math.max(1, (g.c - 1));
                sxx*=inv; sxy*=inv; sxz*=inv; syy*=inv; syz*=inv; szz*=inv;

                const { values, vectors } = eigenSym3_jacobi(sxx,sxy,sxz,syy,syz,szz);
                // stddev along principal axes
                const sig = values.map(v=>Math.sqrt(Math.max(v, 1e-9)));
                // cover factor: ~2.2σ + margin
                const k = 2.2;
                const sx = Math.max(6.0, sig[0]*k + 2.0);
                const sy = Math.max(6.0, sig[1]*k + 2.0);
                const sz = Math.max(6.0, sig[2]*k + 2.0);

                // rotation from eigenvectors (columns)
                const ex = new THREE.Vector3(vectors[0][0], vectors[0][1], vectors[0][2]).normalize();
                const ey = new THREE.Vector3(vectors[1][0], vectors[1][1], vectors[1][2]).normalize();
                const ez = new THREE.Vector3(vectors[2][0], vectors[2][1], vectors[2][2]).normalize();
                // ensure right-handed basis
                const cross = new THREE.Vector3().crossVectors(ex, ey);
                if (cross.dot(ez) < 0) ez.multiplyScalar(-1);
                const m = new THREE.Matrix4().makeBasis(ex, ey, ez);
                const q = new THREE.Quaternion().setFromRotationMatrix(m);

                out.set(cid, {
                    pos: new THREE.Vector3(cx,cy,cz),
                    scale: new THREE.Vector3(sx,sy,sz),
                    quat: q
                });
            });
            return out;
        }

        // --- レイキャスター（マウス/タッチピック） ---
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        const tooltip = document.getElementById('tooltip');
        let targetSprites = []; // 判定対象のスプライトリスト
        let pointerListenersInitialized = false;

        function ensureOutlineMesh(cid){
            if (outlineMeshByCluster.has(cid)) return outlineMeshByCluster.get(cid);
            const mat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(clusterColor(cid)),
                transparent: true,
                opacity: 0.20,
                wireframe: true,
                depthWrite: false,
            });
            const mesh = new THREE.Mesh(OUTLINE_UNIT_SPHERE, mat);
            mesh.visible = showClusterOutline;
            mesh.userData = { kind: "clusterOutline", cluster: cid };
            clusterOutlineGroup.add(mesh);
            outlineMeshByCluster.set(cid, mesh);
            return mesh;
        }

        function rebuildClusterOutlines(pointsArray, {animate=false} = {}){
            const targets = computeClusterEllipsoidTargets(pointsArray);
            // remove meshes not present
            outlineMeshByCluster.forEach((mesh, cid)=>{
                if (!targets.has(cid)){
                    clusterOutlineGroup.remove(mesh);
                    outlineMeshByCluster.delete(cid);
                }
            });
            targets.forEach((t, cid)=>{
                const mesh = ensureOutlineMesh(cid);
                mesh.material.color = new THREE.Color(clusterColor(cid));
                if (!animate){
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

        function initPointerListenersOnce(){
            if (pointerListenersInitialized) return;
            pointerListenersInitialized = true;

            // マウス移動イベント
            window.addEventListener('mousemove', (event) => {
                // マウス位置を正規化 (-1 to +1)
                mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
                mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

                // ツールチップの位置追従
                if (tooltip) {
                    tooltip.style.left = event.clientX + 15 + 'px';
                    tooltip.style.top = event.clientY + 15 + 'px';
                }
            });

            // スマホでタッチした位置も判定（Raycaster用）
            window.addEventListener('touchstart', (event) => {
                if (event.touches.length > 0) {
                    const touch = event.touches[0];
                    // タッチ座標を WebGL用に正規化 (-1 〜 +1)
                    mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
                    mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
                    // ツールチップの位置更新
                    updateTooltipPos(touch.clientX, touch.clientY);
                }
            }, { passive: true });
        }

        function updateTooltipPos(x, y) {
            if (!tooltip) return;
            tooltip.style.left = x + 15 + 'px';
            tooltip.style.top = y - 40 + 'px'; // PC版より少し高さを上げて指被りを防ぐ
        }

        function createCandidatesFromPoints(pointsArray) {

            // reset
            // 既存スプライトをsceneから除去（再生成時の重複防止）
            if (candidateObjects && candidateObjects.length){
                candidateObjects.forEach(obj => scene.remove(obj));
            }
            candidateObjects = [];
            targetSprites = [];
            materialCache = {};
            ringMaterialCache = {};
            legendData = [];

            // shape/color を付与（政党ごとに安定）
            applyPartyStyles(pointsArray);

            // イベントリスナは初回のみ
            initPointerListenersOnce();
            // クラスタ輪郭（クラスタ形状に沿う楕円体）
            rebuildClusterOutlines(pointsArray, { animate:false });

            pointsArray.forEach(pt => {
            const key = pt.shape + "_" + pt.color;
            if (!materialCache[key]) {
                materialCache[key] = new THREE.SpriteMaterial({ map: createShapeTexture(pt.shape, pt.color), transparent: true, opacity: 0.85 });
            }
            const sprite = new THREE.Sprite(materialCache[key]);
            sprite.position.set(pt.x, pt.y, pt.z);
            sprite.userData = { id: pt.id, name: pt.name, party: pt.party, data: pt }; 
            const cid = (pt.cluster_global ?? 0);

            // --- ズレ強調フラグ ---
            sprite.userData.cluster_global = cid;
            sprite.userData.party_mode_cluster = (pt.party_mode_cluster ?? null);
            sprite.userData.is_mismatch = !!pt.is_mismatch;
            sprite.userData.mismatch_score = (pt.mismatch_score ?? 0);
            sprite.userData.baseScale = 1.0;

            // --- 選択強調ハロー（政党/選択肢） ---
            const selHalo = new THREE.Sprite(getSelectionHaloMaterial("#1f77b4").clone());
            selHalo.scale.set(3.0, 3.0, 1);
            selHalo.renderOrder = 0;
            selHalo.visible = true;
            selHalo.userData = { kind: "selectionHalo" };
            sprite.add(selHalo);

            if (sprite.userData.is_mismatch) {
                // mismatch halo（上品に強調）
                const hkey = "mh_" + "#ff5a3c";
                if (!mismatchHaloMaterialCache[hkey]) {
                    mismatchHaloMaterialCache[hkey] = new THREE.SpriteMaterial({ map: createHaloTexture("#ff5a3c"), transparent: true, opacity: 0.0, depthTest: false });
                }
                const halo = new THREE.Sprite(mismatchHaloMaterialCache[hkey].clone());
                halo.scale.set(2.35, 2.35, 1);
                halo.renderOrder = 0;
                halo.visible = showMismatch;
                halo.userData = { kind: "mismatchHalo" };
                sprite.add(halo);

                // materialはcloneして少しだけ前面に
                sprite.material = sprite.material.clone();
                sprite.material.opacity = 0.88;
            }

            scene.add(sprite);
            targetSprites.push(sprite);

            const textData = createTextTexture(pt.name);
            const textSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textData.texture, transparent: true, opacity: 0.9, depthTest: false }));
            textSprite.position.set(0, 0.8, 0);
            sprite.add(textSprite);

            textSprite.scale.set(textData.width * 0.012, textData.height * 0.012, 1);
            textSprite.renderOrder = 999;
            // textSprite is attached to sprite
            // 親スプライトが脈動/強調でスケールしても、氏名は脈動しないように逆スケールで打ち消す
            textSprite.userData = {
                kind: "nameLabel",
                baseScale: textSprite.scale.clone(),
                basePos: textSprite.position.clone(),
            };

            candidateObjects.push(sprite);
        });

        // --- 4. 凡例とインタラクション ---
        activeParty = null; 

        const legendDiv = document.getElementById('legend');
        legendDiv.innerHTML = '<div class="legend-title">政党一覧</div>';
        legendData = Object.keys(partyStyleMap).map(p => ({ party: p, style: partyStyleMap[p] }));
        legendData.forEach(item => {
            const div = document.createElement('div');
            div.className = 'legend-item';
            div.innerHTML = `<img src="${createShapeTexture(item.style.shape, item.style.color).image.toDataURL()}" class="legend-icon"><span>${item.party}</span>`;
            legendDiv.appendChild(div);

            div.addEventListener('click', () => {
                const items = document.querySelectorAll('.legend-item');
                if (activeParty === item.party) {
                    activeParty = null;
                    div.classList.remove('selected');
                } else {
                    activeParty = item.party;
                    const ps = document.getElementById('party-select');
                    if (ps) ps.value = item.party;
                    items.forEach(el => el.classList.remove('selected'));
                    div.classList.add('selected');
                    applyPartyClusterStyling();
                }
            });
        });

        } // end createCandidatesFromPoints

        // --- 5. アニメーションループ ---
        function animate() {
            requestAnimationFrame(animate);
            updateTransition();

            // A. ポワンポワンアニメーション
            const time = Date.now() * 0.005; 
            // 政党選択時の“脈打ち”用（選択政党全体で同期）
            const partyPulse = 1.0 + Math.sin(time * 0.85) * 0.10;

            // まず全オブジェクトの見た目を更新（上品な強調）
            candidateObjects.forEach(obj => {
                const ud = obj.userData || {};
                // 基本スケール
                let sx = 1.0;
                let dimTo = null;   // opacity target when dimmed
                let boost = false;  // emphasize flag
                let boostLevel = 0; // 0 none / 1 party / 2 option

                // アクティブ政党は脈打つように強調
                if (activeParty) {
                    if (ud.party === activeParty) {
                        sx = 2.05 * partyPulse;
                        boost = true;
                        boostLevel = Math.max(boostLevel, 1);
                    } else {
                        dimTo = 0.02;
                        sx = 0.65;
                    }
                }

                // 選択肢フィルタ（該当だけ強調、他を薄く）
                if (optionFilter && optionFilter.active) {
                    const ok = candidateMatchesOption(ud.data);
                    if (ok) {
                        sx = Math.max(sx, 2.25);
                        boost = true;
                        boostLevel = Math.max(boostLevel, 2);
                    } else {
                        dimTo = Math.min(dimTo ?? 1.0, 0.015);
                        sx = Math.min(sx, 0.60);
                    }
                }

                // ズレ強調：軽いサイズ差 + ハロー
                const hasHalo = obj.children && obj.children.some(ch => ch.userData && ch.userData.kind === "mismatchHalo");
                if (ud.is_mismatch) {
                    obj.children.forEach(ch => {
                        if (ch.userData && ch.userData.kind === "mismatchHalo") {
                            ch.visible = showMismatch;
                            if (showMismatch) {
                                const base = 0.22 + (ud.mismatch_score || 0) * 0.22;
                                ch.material.opacity = base + Math.sin(time * 0.9 + (ud.id || 0)) * 0.06;
                            } else {
                                ch.material.opacity = 0.0;
                            }
                        }
                    });

                    if (showMismatch && (!activeParty || ud.party !== activeParty)) {
                        sx = Math.max(sx, 1.06 + (ud.mismatch_score || 0) * 0.08);
                        obj.material.opacity = 0.92;
                    } else {
                        obj.material.opacity = 0.85;
                    }
                }

                // 選択強調ハロー（政党=青 / 選択肢=緑）
                const sel = obj.children && obj.children.find(ch => ch.userData && ch.userData.kind === "selectionHalo");
                if (sel) {
                    if (boostLevel > 0) {
                        sel.visible = true;
                        const color = boostLevel >= 2 ? "#00c853" : "#1f77b4";
                        sel.material.map = getSelectionHaloMaterial(color).map;
                        const base = boostLevel >= 2 ? 0.70 : 0.55;
                        sel.material.opacity = base + Math.sin(time * 0.9 + (ud.id || 0)) * 0.10;
                    } else {
                        sel.material.opacity = 0.0;
                    }
                }

                // 透明度の補間（フェードで上品に）
                // 毎フレーム「目標」を更新して、選択の切替が即反映されるようにする
                const baseOpacity = (ud.is_mismatch && showMismatch && (!activeParty || ud.party !== activeParty)) ? 0.92 : (ud.is_mismatch ? 0.85 : 0.85);
                const targetOpacity = (dimTo != null) ? dimTo : (boost ? 1.0 : baseOpacity);
                ud.opacityTarget = targetOpacity;
                if (ud.opacityTarget != null) {
                    obj.material.opacity += (ud.opacityTarget - obj.material.opacity) * 0.25;
                    if (Math.abs(ud.opacityTarget - obj.material.opacity) < 0.005) {
                        obj.material.opacity = ud.opacityTarget;
                    }
                }

                obj.scale.set(sx, sx, 1);

                // 氏名ラベルは一定サイズに保つ（親スケールを打ち消す）
                const label = obj.children && obj.children.find(ch => ch.userData && ch.userData.kind === "nameLabel");
                if (label && label.userData.baseScale) {
                    const inv = 1 / Math.max(0.2, sx);
                    label.scale.set(
                        label.userData.baseScale.x * inv,
                        label.userData.baseScale.y * inv,
                        1
                    );
                    // 位置オフセットも親スケールの影響を打ち消す（上下に揺れないように）
                    if (label.userData.basePos) {
                        label.position.set(
                            label.userData.basePos.x * inv,
                            label.userData.basePos.y * inv,
                            label.userData.basePos.z * inv
                        );
                    }
                }
            });

            // B. レイキャスティング（マウスホバー判定）
            raycaster.setFromCamera(mouse, camera);
            const intersects = raycaster.intersectObjects(targetSprites);

            if (intersects.length > 0) {
                const target = intersects[0].object;
                const data = target.userData.data;

                // ツールチップの内容更新（設問に応じて自動生成）
                tooltip.innerHTML = buildTooltipHTML(data);
                tooltip.style.display = 'block';
                document.body.style.cursor = 'pointer'; // カーソル変更

                // ホバー時の一時的な強調（アニメーションと競合しないよう加算するイメージで）
                if (!activeParty || data.party !== activeParty) {
                    target.scale.set(1.3, 1.3, 1);
                }

            } else {
                tooltip.style.display = 'none';
                document.body.style.cursor = 'default';
            }

            controls.update();
            renderer.render(scene, camera);
        }

        // -----------------------------
        // 設問切替のためのマニフェスト読み込み
        // -----------------------------
        // Firebase Hosting (public=public) 配信前提：データは public/data/ 配下
        const MANIFEST_FILE = './data/question_manifest.json';

        function parseOptionsText(optionsText) {
            const map = {};
            if (!optionsText) return map;
            optionsText.split('|').forEach(part => {
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

        function getBaseFromColumn(col) {
            const i = col.indexOf('-');
            return i >= 0 ? col.slice(0, i) : col;
        }

        function getSuffixNumber(col) {
            const i = col.indexOf('-');
            if (i < 0) return null;
            const n = parseInt(col.slice(i + 1), 10);
            return Number.isFinite(n) ? n : null;
        }

        function labelForColumn(col) {
            if (!questionManifest) return col;
            const base = getBaseFromColumn(col);
            if (base === 'Q25' && questionManifest.q25_labels && questionManifest.q25_labels[col]) {
                return questionManifest.q25_labels[col];
            }
            const n = getSuffixNumber(col);
            if (n == null) return col;
            // Q1, Q24 など「複数回答（順位）」は n つ目として表示
            if (base === 'Q1' || base === 'Q24') return `${base}（${n}つ目）`;
            return `${base}-${n}`;
        }

        function decodeValue(base, rawValue, optionsMap) {
            if (rawValue == null) return '-';
            if (rawValue === '-' || rawValue === '') return '-';
            // rank系 (Q1/Q24) は optionsText のコード→ラベルを優先
            if ((base === 'Q1' || base === 'Q24') && optionsMap) {
                const label = optionsMap[String(rawValue)];
                return label ? `${rawValue}:${label}` : String(rawValue);
            }
            return String(rawValue);
        }

        function buildTooltipHTML(data) {
            const name = data.name ?? '';
            const party = data.party ?? '';
            const base = currentQuestion?.base ?? '';
            const cols = currentQuestion?.columns ?? [];
            const optionsMap = currentQuestion?.optionsMap ?? {};

            const lines = cols.map(col => {
                const v = decodeValue(base, data[col], optionsMap);
                const label = labelForColumn(col);
                return `<span class="tooltip-label">${label}:</span> <span class="tooltip-value">${v}</span>`;
            }).join('<br>');

            return `
                    <strong>${name}</strong><br>
                    <span class="tooltip-label">政党:</span> <span class="tooltip-value">${party}</span><br>
                    <span class="tooltip-label">クラスタ:</span> <span class="tooltip-value">${data.cluster_global ?? "-"}</span><br>
                    <span class="tooltip-label">党内主流クラスタ:</span> <span class="tooltip-value">${data.party_mode_cluster ?? "-"}</span><br>
                    <span class="tooltip-label">ズレ度:</span> <span class="tooltip-value">${(data.mismatch_score!=null)?data.mismatch_score.toFixed(2):"-"}</span>
                    ${data.is_mismatch ? `<span class="tooltip-value" style="margin-left:8px; color:#d62728;">(ズレ)</span>` : ""}
                    <br><br>
                    ${lines}
                `;
        }

        async function loadQuestionManifest() {
            const res = await fetch(MANIFEST_FILE, { cache: 'no-store' });
            if (!res.ok) throw new Error(`Failed to load ${MANIFEST_FILE}: ${res.status}`);
            const m = await res.json();
            // optionsText を optionsMap に変換
            m.questions.forEach(q => q.optionsMap = parseOptionsText(q.options_text));
            return m;
        }

        function embedFileFromQuestionAndMode(q, mode){
            // Prefer manifest explicit fields if present
            if (mode === "pre_umap") {
                if (q.embed_file_umap) return q.embed_file_umap;
                // best-effort guess for legacy manifests
                if (q.embed_file) return q.embed_file.replace(/^embed_/, "embed_umap_");
                return `embed_umap_${q.base}.json`;
            }
            if (mode === "pre_pca") {
                if (q.embed_file_pca) return q.embed_file_pca;
                // fallback to legacy embed_file as "PCA precomputed" by convention
                if (q.embed_file) return q.embed_file;
                return `embed_pca_${q.base}.json`;
            }
            // pca_js still needs a source file to load answers/metadata; default to PCA precomputed file
            if (q.embed_file_pca) return q.embed_file_pca;
            if (q.embed_file) return q.embed_file;
            return `embed_pca_${q.base}.json`;
        }

        async function loadEmbeddingFor(base, mode) {
            const q = questionManifest.questions.find(x => x.base === base);
            if (!q) throw new Error(`Unknown base: ${base}`);
            const embedFile = embedFileFromQuestionAndMode(q, mode);
            const res = await fetch('./data/' + embedFile, { cache: 'no-store' });
            if (!res.ok) throw new Error(`Failed to load ${embedFile}: ${res.status}`);
            const emb = await res.json();
            // emb: {meta, data}
            return { q, emb };
        }

        // スムーズ遷移用
        let transition = { active:false, start:0, duration:1200 };

        function startTransitionTo(newPointsById) {
            const now = performance.now();
            transition.active = true;
            transition.start = now;

            candidateObjects.forEach(obj => {
                const id = obj.userData.id;
                const p = newPointsById.get(id);
                if (!p) return;
                obj.userData.startPos = obj.position.clone();
                obj.userData.targetPos = new THREE.Vector3(p.x, p.y, p.z);

                // 設問ごとの回答も差し替え
                obj.userData.data = p;

                // クラスタ/ズレ情報も差し替え
                obj.userData.cluster_global = (p.cluster_global ?? 0);
                obj.userData.party_mode_cluster = (p.party_mode_cluster ?? null);
                obj.userData.is_mismatch = !!p.is_mismatch;
                obj.userData.mismatch_score = (p.mismatch_score ?? 0);
            });
        }

        function updateTransition() {
            if (!transition.active) return;
            const t = (performance.now() - transition.start) / transition.duration;
            const k = Math.min(Math.max(t, 0), 1);
            const ease = k < 0.5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2)/2;

            candidateObjects.forEach(obj => {
                const a = obj.userData.startPos;
                const b = obj.userData.targetPos;
                if (!a || !b) return;
                obj.position.lerpVectors(a, b, ease);
            });

            // クラスタ輪郭（楕円体）もぬるっと補間
            outlineMeshByCluster.forEach(mesh => {
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

            if (k >= 1) transition.active = false;
        }

        function buildPointsMap(pointsArray) {
            const map = new Map();
            pointsArray.forEach(p => map.set(p.id, p));
            return map;
        }

        function updateQuestionUI(base) {
            const sel = document.getElementById('question-select');
            const title = document.getElementById('question-title');
            const metaEl = document.getElementById('question-meta');
            const q = questionManifest.questions.find(x => x.base === base);
            if (!q) return;
            sel.value = base;
            title.textContent = q.question_full;
            if (metaEl && currentEmbeddingMeta) {
                const m = currentEmbeddingMeta || {};
                const method = m.method || '';
                const ncl = (m.n_clusters != null) ? ` / clusters=${m.n_clusters}` : '';
                metaEl.textContent = method ? `embedding: ${method}${ncl}` : '';
            } else if (metaEl) {
                metaEl.textContent = '';
            }
        }

        function updatePartySelectOptions(){
            const sel = document.getElementById("party-select");
            if (!sel) return;
            // 現在pointsDataから政党一覧
            const parties = Array.from(new Set(pointsData.map(p => p.party))).sort((a,b)=>a.localeCompare(b,'ja'));
            const prev = sel.value;
            sel.innerHTML = '<option value="">（政党を選択）</option>';
            parties.forEach(p=>{
                const opt=document.createElement("option");
                opt.value=p; opt.textContent=p;
                sel.appendChild(opt);
            });
            // 可能なら復元
            if (prev && parties.includes(prev)) sel.value = prev;
        }

        async function applyQuestion(base, { firstInit=false } = {}) {
            const { q, emb } = await loadEmbeddingFor(base, embeddingMode);
            currentQuestion = q;
            pointsData = emb.data;
            loadedEmbeddingMeta = emb.meta || null;
            // clone for display so we don't destroy the loaded meta when switching modes
            currentEmbeddingMeta = loadedEmbeddingMeta ? Object.assign({}, loadedEmbeddingMeta) : {};
            resetOptionFilter();

            // 座標（埋め込み）モード：
            // - pre_umap: embed_*.json の x,y,z をそのまま使う（UMAP）
            // - pre_pca:  embed_*.json の x,y,z をそのまま使う（PCA）
            // - pca_js:   設問の回答列からブラウザ側でPCA/曲線埋め込みを再計算
            const cols = currentQuestion?.columns ?? [];
            if (embeddingMode === "pre_umap") {
                // strict: do NOT silently fallback to PCA
                const m = (loadedEmbeddingMeta && loadedEmbeddingMeta.method) ? String(loadedEmbeddingMeta.method) : "";
                if (!m.toUpperCase().includes("UMAP")) {
                    throw new Error("UMAP mode selected but loaded embedding is not UMAP. Generate UMAP embeddings (embed_umap_*.json) and update manifest.");
                }
                currentEmbeddingMeta.method = `UMAP(precomputed)`;
            } else if (embeddingMode === "pre_pca") {
                currentEmbeddingMeta.method = `PCA(precomputed)`;
            } else if (embeddingMode === "pca_js") {
                try{
                    const coords = projectTo3D(pointsData, cols, base);
                    for (let i=0;i<pointsData.length;i++){
                        pointsData[i].x = coords[i].x;
                        pointsData[i].y = coords[i].y;
                        pointsData[i].z = coords[i].z;
                    }
                    currentEmbeddingMeta.method = (cols.length >= 3) ? "PCA(JS)" : (cols.length === 2 ? "PCA2(JS)" : "Curve1D(JS)");
                } catch(e){
                    console.warn("PCA recompute failed, fallback to precomputed embed coords", e);
                    embeddingMode = "pre_pca";
                    currentEmbeddingMeta.method = `PCA(precomputed)`;
                }
            }

            // 設問ごとに全体クラスタを再計算（自動k）
            const g = computeGlobalClustersForCurrentQuestion();
            pointsData.forEach(p => {
                p.cluster_global = g.assign[p.id] ?? 0;
            });
            if (currentEmbeddingMeta) currentEmbeddingMeta.n_clusters = g.k;

            updateQuestionUI(base);
            updatePartySelectOptions();
            buildOptionFilterUI();
            // 党内クラスタ表示を維持する場合は再適用
            applyPartyClusterStyling();

            // 初回は生成、2回目以降はスムーズに位置だけ差し替え
            const pointsById = buildPointsMap(pointsData);

            if (firstInit) {
                // pointsData から候補オブジェクトを作成
                createCandidatesFromPoints(pointsData);
                updatePartySelectOptions();
                applyPartyClusterStyling();
            } else {
                // クラスタ輪郭も含めてぬるっと遷移
                rebuildClusterOutlines(pointsData, { animate:true });
                startTransitionTo(pointsById);
            }
        }

        // -----------------------------
        // 起動時：マニフェスト読み込み → UI生成 → 初期設問を描画
        // （const/let のTDZ回避のため、全定義の後で初期化を走らせる）
        // -----------------------------
        (async () => {
            try {
                questionManifest = await loadQuestionManifest();

                const sel = document.getElementById('question-select');
                const embModeSel = document.getElementById('embedding-mode');

                // embedding mode restore + listener
                if (embModeSel) {
                    const saved = localStorage.getItem(EMBEDDING_MODE_STORAGE_KEY);
                    if (saved === "pca_js" || saved === "pre_umap" || saved === "pre_pca") embeddingMode = saved;
                    embModeSel.value = embeddingMode;
                    embModeSel.addEventListener('change', async () => {
                        const v = embModeSel.value;
                        const prev = embeddingMode;
                        embeddingMode = (v === "pre_umap") ? "pre_umap" : (v === "pre_pca" ? "pre_pca" : "pca_js");
                        localStorage.setItem(EMBEDDING_MODE_STORAGE_KEY, embeddingMode);
                        // if already initialized, re-apply current question using the new mode
                        if (currentQuestion && currentQuestion.base) {
                            try{
                                await applyQuestion(currentQuestion.base, { firstInit: false });
                            } catch(e){
                                console.error(e);
                                // strict: do not fallback to PCA when UMAP is not available
                                if (embeddingMode === "pre_umap") {
                                    alert("UMAPデータが見つからないか読み込みに失敗しました。UMAP版（embed_umap_*.json）を生成して public/data に配置してください。");
                                } else {
                                    alert("埋め込みデータの読み込みに失敗しました。Consoleを確認してください。");
                                }
                                embeddingMode = prev;
                                embModeSel.value = prev;
                                localStorage.setItem(EMBEDDING_MODE_STORAGE_KEY, embeddingMode);
                            }
                        }
                    });
                }

                // 選択肢（Q番号だけ表示：長いので）
                questionManifest.questions.forEach(q => {
                    const opt = document.createElement('option');
                    opt.value = q.base;
                    opt.textContent = q.base;
                    sel.appendChild(opt);
                });

                sel.addEventListener('change', async () => {
                    await applyQuestion(sel.value, { firstInit: false });
                });

                // クラスタ輪郭 / ズレ強調 トグル
                const tOutline = document.getElementById('toggle-cluster-outline');
                const tMismatch = document.getElementById('toggle-mismatch');

                const partySel = document.getElementById('party-select');
                const tPartyClusters = document.getElementById('toggle-party-clusters');

                // 党内クラスタ UI
                partySel.addEventListener('change', () => {
                    activeParty = partySel.value || null;

                    // 凡例の選択状態も同期
                    document.querySelectorAll('.legend-item').forEach(el => {
                        const label = (el.textContent || '').trim();
                        if (activeParty && label === activeParty) el.classList.add('selected');
                        else el.classList.remove('selected');
                    });

                    applyPartyClusterStyling();
                });

                tPartyClusters.addEventListener('change', () => {
                    showPartyClusters = tPartyClusters.checked;
                    applyPartyClusterStyling();
                });

                tOutline.addEventListener('change', () => {
                    showClusterOutline = tOutline.checked;
                    clusterOutlineGroup.visible = showClusterOutline;
                });

                tMismatch.addEventListener('change', () => {
                    showMismatch = tMismatch.checked;
                    // 即時反映：ハローの表示切替（詳細はanimateで補間）
                    candidateObjects.forEach(obj => {
                        if (!obj.userData) return;
                        if (obj.userData.is_mismatch) {
                            obj.children.forEach(ch => {
                                if (ch.userData && ch.userData.kind === "mismatchHalo") {
                                    ch.visible = showMismatch;
                                    if (!showMismatch) ch.material.opacity = 0.0;
                                }
                            });
                        }
                    });
                });

                // デフォルト設問はQ1
                const defaultBase = questionManifest.questions.some(q => q.base === 'Q1') ? 'Q1' : questionManifest.questions[0].base;
                await applyQuestion(defaultBase, { firstInit: true });

            } catch (e) {
                console.error(e);
                const title = document.getElementById('question-title');
                title.textContent = 'データ読み込みに失敗しました。question_manifest.json と embed_*.json が同じフォルダにあるか確認してください。';
            }
        })();

        // --- Mobile UI: bottom toolbar to toggle panels ---
        (function initMobileToolbar(){
            const mq = window.matchMedia && window.matchMedia('(max-width: 600px)');
            const left = document.getElementById('left-stack');
            const right = document.getElementById('control-panel');
            const bParty = document.getElementById('mt-party');
            const bQ = document.getElementById('mt-question');
            const bClose = document.getElementById('mt-close');
            const search = document.getElementById('search-input');

            if (!mq || !left || !right || !bParty || !bQ || !bClose) return;

            function setActive(which){
                // which: 'left' | 'right' | 'none'
                const isMobile = mq.matches;
                if (!isMobile) {
                    left.classList.remove('mobile-hidden');
                    right.classList.remove('mobile-hidden');
                    bParty.classList.remove('active');
                    bQ.classList.remove('active');
                    return;
                }
                if (which === 'left'){
                    left.classList.remove('mobile-hidden');
                    right.classList.add('mobile-hidden');
                    bParty.classList.add('active');
                    bQ.classList.remove('active');
                    if (search) setTimeout(()=>search.focus(), 0);
                } else if (which === 'right'){
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

            // initial: map first
            setActive('none');
            mq.addEventListener?.('change', ()=>setActive('none'));

            bParty.addEventListener('click', ()=>{
                const open = !left.classList.contains('mobile-hidden');
                setActive(open ? 'none' : 'left');
            });
            bQ.addEventListener('click', ()=>{
                const open = !right.classList.contains('mobile-hidden');
                setActive(open ? 'none' : 'right');
            });
            bClose.addEventListener('click', ()=>setActive('none'));
        })();

        animate();

        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // --- 6. 検索機能 ---
        const searchInput = document.getElementById('search-input');
        const searchResults = document.getElementById('search-results');

        searchInput.addEventListener('input', function(e) {
            const val = (e.target && e.target.value) ? String(e.target.value).trim() : '';
            searchResults.innerHTML = '';
            if (!val) { searchResults.style.display = 'none'; return; }

            const matches = candidateObjects.filter(obj => {
                const n = (obj.userData && obj.userData.name) ? String(obj.userData.name) : '';
                const p = (obj.userData && obj.userData.party) ? String(obj.userData.party) : '';
                return n.includes(val) || p.includes(val);
            });
            if (matches.length > 0) {
                searchResults.style.display = 'block';
                matches.forEach(match => {
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
            } else { searchResults.style.display = 'none'; }
        });

        function focusCandidate(candidateObj) {
            const targetPos = candidateObj.position;
            controls.target.copy(targetPos);
            camera.position.set(targetPos.x, targetPos.y, targetPos.z + 15);
            controls.update();
        }

        function resetView() {
            camera.position.set(initialCameraPos.x, initialCameraPos.y, initialCameraPos.z);
            controls.target.set(0, 0, 0);
            controls.update();
        }

        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const val = String(searchInput.value || '').trim();
                if (val === '') {
                    resetView();
                    searchInput.blur();
                } else {
                    const first = searchResults.querySelector('.search-item');
                    if (first) { first.click(); searchInput.blur(); }
                }
            }
        });
