# UMAP/PCA 可視化（設問切替版）

このフォルダには次が入っています。

- `umap_multi.html` … 3D散布図ビューア（設問切替）
- `question_manifest.json` … 設問一覧（`question_mapping.csv` 由来）
- `embed_*.json` … 設問ごとの座標＋回答（`_all_candidates.csv` 由来）
- `build_embeddings.py` … 上記 json を再生成するスクリプト

## 使い方

1. `umap_multi.html` と `question_manifest.json` と `embed_*.json` を **同じフォルダ** に置く
2. ブラウザで `umap_multi.html` を開く  
   ※ローカルで `fetch()` するので、ブラウザ設定によっては `python -m http.server` のように簡易サーバで開くのが確実です。

## データ生成

```
python build_embeddings.py --candidates _all_candidates.csv --mapping question_mapping.csv --outdir out
```

### UMAP / PCA を分けて生成する（推奨）

フロントで「UMAP（事前計算）」「PCA（事前計算）」を切り替えたい場合は、次のように **別ファイル名**で生成します。

```
python build_embeddings.py --candidates _all_candidates.csv --mapping question_mapping.csv --outdir out --methods umap,pca
```

- 出力例：`embed_umap_Q1.json`, `embed_pca_Q1.json`, ...  
- `question_manifest.json` には `embed_file_umap` / `embed_file_pca` が入ります（フロントがそれを使って切替）

### UMAPだけ生成したい（UMAPが無いなら失敗させたい）

```
python build_embeddings.py --candidates _all_candidates.csv --mapping question_mapping.csv --outdir out --methods umap
```

この場合、`umap-learn` が入っていない環境では **PCAにフォールバックせずエラーで終了**します。
