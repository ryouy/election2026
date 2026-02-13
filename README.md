# Election 2026 Candidate Survey Viewer (UMAP / PCA)

[Try here!](https://yomiuri-election-2026.web.app)

This repository contains a **static 3D scatter viewer** for exploring 2026 Japanese election candidate survey answers.

* Each candidate is plotted as a point in 3D.
* Points that are **close** represent candidates with **similar answer patterns** (for the selected question).
* You can switch questions (Q1–Q25), filter by party, search by name, and inspect answers via tooltips.

---

## What’s inside

* `public/index.html`
  * The entire frontend (HTML/CSS/JS) in one file
  * Renders a 3D scatter plot with **Three.js**
  * Loads data from `public/data/` using `fetch()`
* `public/data/`
  * `question_manifest.json`: question list + metadata (text, options, columns, data files)
  * `embed_*.json`: per-question datasets (candidates + answers + 3D coordinates)
* `build_embeddings.py`
  * Offline script to generate `question_manifest.json` and `embed_*.json` from CSV sources

---

## How the analysis works (high level)

For each question (Q1–Q25), we build a numeric feature vector per candidate and project it into 3D.

* **Preprocessing**
  * Missing answers are filled with a “neutral” value depending on the question type
    * Q25 → 5, Q1/Q24 → 0, otherwise → 3
  * Each answer column is min-max scaled to **[-1, 1]**
  * Small Gaussian noise is added (default σ=0.05) to reduce exact overlaps for discrete answers
* **Dimensionality reduction to 3D (offline)**
  * **UMAP** (if available) or **PCA** (fallback in `auto` mode)
  * Output coordinates are saved into `embed_<method>_<Q>.json`
* **Dimensionality reduction to 3D (in-browser option)**
  * The viewer can recompute a deterministic PCA/curve embedding per question in JavaScript
  * This helps prevent different questions from “looking identical” when they have only 1–2 columns
* **Clustering (in the browser)**
  * Lightweight **KMeans** in 3D
  * `k` is chosen automatically by a simple “stop when improvement is small” rule
  * Two views are supported:
    * global clusters (whole population)
    * within-party clusters (only for the selected party)
* **Cluster outlines**
  * For each cluster, a covariance-based ellipsoid outline (wireframe) is drawn to show cluster shape

---

## Run locally (recommended)

Because the viewer loads JSON via `fetch()`, you should run a local HTTP server (don’t open `file://` directly).

* Option A: serve `public/` as the web root

```bash
cd /Users/ryo/Documents/umap_multi_elegant/public
python3 -m http.server 8000 --bind 127.0.0.1
```

* Then open:
  * `http://127.0.0.1:8000/`

---

## Embedding modes in the UI

In the top-right panel, you can switch the coordinate mode:

* `PCA (in-browser)`
  * Recomputes the embedding from answer columns in JavaScript
* `UMAP (precomputed)`
  * Uses `embed_umap_Q*.json`
  * **Strict behavior**: if UMAP data is missing, the viewer will not silently fall back to PCA
* `PCA (precomputed)`
  * Uses `embed_pca_Q*.json` (or legacy `embed_Q*.json`)

---

## Generate data (offline)

The generator expects two CSV files (not included here):

* `_all_candidates.csv`
  * candidate rows + survey answer columns
* `question_mapping.csv`
  * question metadata (full text, option labels, column mapping)

### Generate both UMAP and PCA files (recommended)

```bash
python3 build_embeddings.py \
  --candidates _all_candidates.csv \
  --mapping question_mapping.csv \
  --outdir out \
  --methods umap,pca
```

* Output:
  * `out/question_manifest.json`
  * `out/embed_umap_Q1.json`, `out/embed_pca_Q1.json`, ... (per question)

### Generate only UMAP (and fail if UMAP is unavailable)

```bash
python3 build_embeddings.py \
  --candidates _all_candidates.csv \
  --mapping question_mapping.csv \
  --outdir out \
  --methods umap
```

### Publish the generated files to the viewer

Copy the outputs into `public/data/`:

* `out/question_manifest.json` → `public/data/question_manifest.json`
* `out/embed_*.json` → `public/data/`

---

## Deploy (static hosting)

This is a pure static site.

* You can deploy by hosting the `public/` directory
* Firebase Hosting is supported via `firebase.json` (public directory = `public`)

---

## Notes

* The data source link in the UI points to Yomiuri Online. Please confirm your usage complies with the source’s terms.
* If you push this viewer into another repository (e.g. a data-collection repo), put the contents of `public/` into a subfolder and serve that folder as the site root.


