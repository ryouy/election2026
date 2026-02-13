#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
_all_candidates.csv / question_mapping.csv の列構造に合わせて、
設問(Q1..Q25)ごとの 3次元埋め込み座標（embed_Qxx.json）と question_manifest.json を生成します。

- 可能なら UMAP（umap-learn）を使用
- 無ければ PCA フォールバック（autoモードのみ）
- 欠損は「中立」に補完（Q25=5、Q1/Q24=0、それ以外=3）
- 各列は min-max で [-1,1] に正規化してからノイズ(σ=0.05)を付与

2026-02:
- UMAP/PCA を「別ファイル」として出力できるようにし、フロントで切替できるようにする
- UMAPを明示指定した場合、UMAPが無い環境ではPCAにフォールバックせずエラーにする
"""

from __future__ import annotations
import argparse, json, re
from pathlib import Path
import numpy as np
import pandas as pd

def parse_options(options_text: str) -> dict[str,str]:
    m={}
    if not isinstance(options_text,str):
        return m
    for p in options_text.split('|'):
        p=p.strip()
        if ':' in p:
            k,v=p.split(':',1)
            m[k.strip()]=v.strip()
    return m

def scale_matrix(df_num: pd.DataFrame, fill_values: dict[str,float]) -> np.ndarray:
    X=df_num.copy()
    for col in X.columns:
        X[col]=pd.to_numeric(X[col], errors='coerce')
        fill=fill_values.get(col, np.nan)
        if np.isnan(fill):
            med=X[col].median()
            fill=float(med) if not np.isnan(med) else 0.0
        X[col]=X[col].fillna(fill)
        mn=float(X[col].min()); mx=float(X[col].max())
        if mx-mn<1e-9:
            X[col]=0.0
        else:
            mid=(mx+mn)/2.0; half=(mx-mn)/2.0
            X[col]=((X[col]-mid)/half).clip(-1,1)
    return X.values.astype(np.float32)

def embed_to_3d(X: np.ndarray, rng: np.random.Generator, method: str):
    n_samples, n_features = X.shape

    if method == "umap":
        import umap
        reducer = umap.UMAP(
            n_components=3,
            n_neighbors=30,
            min_dist=0.8,
            metric="euclidean",
            random_state=42,
        )
        coords = reducer.fit_transform(X)
        meta = {"method":"UMAP","n_components":3,"n_neighbors":30,"min_dist":0.8,"metric":"euclidean","random_state":42}
    else:
        from sklearn.decomposition import PCA
        if n_features >= 3:
            coords = PCA(n_components=3, random_state=42).fit_transform(X)
        elif n_features == 2:
            coords2 = PCA(n_components=2, random_state=42).fit_transform(X)
            coords = np.concatenate([coords2, rng.normal(0,0.5,size=(n_samples,1))], axis=1)
        else:
            coords = np.concatenate([X[:,[0]], rng.normal(0,0.8,size=(n_samples,2))], axis=1)
        meta = {"method":"PCA_fallback","n_components":3,"random_state":42}

    coords = coords / (coords.std(axis=0, keepdims=True)+1e-9) * 30.0
    return coords.astype(float), meta

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", default="_all_candidates.csv")
    ap.add_argument("--mapping", default="question_mapping.csv")
    ap.add_argument("--outdir", default="out")
    ap.add_argument("--methods", default="auto",
                    help="Embedding methods to generate. 'auto' or comma-separated like 'umap,pca'. "
                         "If 'umap' is requested explicitly and umap-learn is unavailable, exits with error.")
    args = ap.parse_args()

    df = pd.read_csv(args.candidates)
    qm = pd.read_csv(args.mapping)

    name_col = "氏名"
    party_col = "政党"
    group_col = "グループ"

    qm["base"] = qm["column"].astype(str).str.split("-").str[0]
    question_meta = {}
    for base, sub in qm.groupby("base"):
        cols = sub["column"].tolist()
        def sort_key(c):
            m = re.match(rf"^{re.escape(base)}-(\d+)$", c)
            return int(m.group(1)) if m else 0
        cols = sorted(cols, key=sort_key)
        question_meta[base] = {
            "base": base,
            "columns": cols,
            "question_full": sub["question_full"].iloc[0],
            "options_text": sub["options_text"].iloc[0],
            "options_map": parse_options(sub["options_text"].iloc[0]),
        }

    q25_labels = {
        "Q25-1":"高市早苗（自民）","Q25-2":"吉村洋文（維新）","Q25-3":"野田佳彦（中道改革）","Q25-4":"玉木雄一郎（国民）","Q25-5":"田村智子（共産）",
        "Q25-6":"山本太郎（れいわ）","Q25-7":"神谷宗幣（参政）","Q25-8":"百田尚樹（保守）","Q25-9":"福島瑞穂（社民）","Q25-10":"安野貴博（みらい）",
    }

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    def parse_methods(s: str):
        s = (s or "auto").strip().lower()
        if s == "auto":
            return ["auto"]
        parts = [p.strip() for p in s.split(",") if p.strip()]
        # normalize
        out = []
        for p in parts:
            if p in ("umap", "pca"):
                out.append(p)
            else:
                raise ValueError(f"Unknown method: {p}")
        if not out:
            raise ValueError("No methods specified")
        return out

    requested = parse_methods(args.methods)

    def umap_available() -> bool:
        try:
            import umap  # noqa
            return True
        except Exception:
            return False

    if "umap" in requested and not umap_available():
        raise SystemExit("UMAP requested but umap-learn is not available. Install umap-learn or remove 'umap' from --methods.")

    # expand 'auto' to one concrete method at runtime
    methods = []
    if requested == ["auto"]:
        methods = ["umap"] if umap_available() else ["pca"]
    else:
        methods = requested

    rng = np.random.default_rng(42)

    manifest = {"questions":[], "q25_labels": q25_labels}

    bases = sorted(question_meta.keys(), key=lambda x:int(x[1:]) if x[1:].isdigit() else 999)
    for base in bases:
        cols=[c for c in question_meta[base]["columns"] if c in df.columns]
        if not cols:
            continue

        sub = df[[name_col, party_col, group_col] + cols].copy()

        if base=="Q25":
            fill={c:5.0 for c in cols}
        elif base in ("Q1","Q24"):
            fill={c:0.0 for c in cols}
        else:
            fill={c:3.0 for c in cols}

        X=scale_matrix(sub[cols], fill)
        X = X + rng.normal(0,0.05,size=X.shape).astype(np.float32)

        # base record (without xyz) shared across methods
        base_records=[]
        for i,row in sub.iterrows():
            rec={
                "id": int(i),
                "name": row[name_col],
                "party": row[party_col],
                "group": row[group_col],
            }
            for c in cols:
                v=row[c]
                if pd.isna(v):
                    rec[c]="-"
                else:
                    rec[c]=str(int(v)) if abs(v-round(v))<1e-6 else str(v)
            base_records.append(rec)

        embed_files = {}
        for method in methods:
            coords, meta = embed_to_3d(X, rng, method)
            data=[]
            for idx, rec0 in enumerate(base_records):
                rec = dict(rec0)
                rec["x"] = float(coords[idx,0])
                rec["y"] = float(coords[idx,1])
                rec["z"] = float(coords[idx,2])
                data.append(rec)

            embed_file = f"embed_{method}_{base}.json"
            embed_files[method] = embed_file
            with (outdir/embed_file).open("w",encoding="utf-8") as f:
                json.dump({"meta":{**meta,"base":base,"noise_sd":0.05,"scaled_to":"[-1,1] per column"}, "data":data}, f, ensure_ascii=False)

        # manifest entry: keep legacy embed_file (PCA if available else first)
        legacy = embed_files.get("pca") or next(iter(embed_files.values()))
        entry = {
            "base": base,
            "question_full": question_meta[base]["question_full"],
            "options_text": question_meta[base]["options_text"],
            "columns": question_meta[base]["columns"],
            "embed_file": legacy,  # backward compatible
        }
        if "pca" in embed_files:
            entry["embed_file_pca"] = embed_files["pca"]
        if "umap" in embed_files:
            entry["embed_file_umap"] = embed_files["umap"]
        manifest["questions"].append(entry)

    with (outdir/"question_manifest.json").open("w",encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"written: {outdir} (methods={methods})")

if __name__ == "__main__":
    main()
