# GetDataPy — 候補者データ収集

2026年衆議院選挙の候補者情報・アンケート回答を、公開ページから収集・整形するノートブックとデータ置き場です。

- 読売新聞: [衆議院選挙2026](https://www.yomiuri.co.jp/election/shugiin/)
- NHK: [衆議院選挙2026 特設サイト](https://news.web.nhk/senkyo/database/shugiin/)
- 取得済みデータ: [読売 Drive](https://drive.google.com/drive/folders/19jJE69K2ZnlMbkTTFNgB0z4TjvQRHdFb) / [NHK Drive](https://drive.google.com/drive/folders/1QPTDWgc7gTmAlE4nVuKk6dQkJ5rjgCbF?usp=sharing)

## 当時のサイトの状況（保存ページ）

- [読売新聞 開票速報・結果](https://ryouy.github.io/election2026/snapshots/yomiuri/)
- [NHK 選挙結果](https://ryouy.github.io/election2026/snapshots/nhk/)

ファイルは [docs/snapshots/](../docs/snapshots/) にあります。

## ノートブック

| ファイル | 内容 |
| --- | --- |
| `2026_Election_Yomiuri.ipynb` | 読売新聞の候補者ページを収集 |
| `NHKelection.ipynb` | NHKの候補者データを収集 |

Google Colab（推奨）またはローカルのJupyterで実行します（Python 3.8+）。

```bash
pip install requests beautifulsoup4 pandas tqdm lxml
```

Colabでは Google Drive をマウントし、入出力を Drive に保存します。ノートブック内のパスが自分の Drive 構成と合っているか確認してください。

### 処理の流れ

1. 候補者一覧ページから、各候補者の詳細ページURLを集める
2. 詳細ページを取得してHTMLを解析する
3. 氏名・政党・選挙区・年齢・経歴・アンケート回答などを抽出する
4. DataFrameにまとめてCSVに書き出す

## 出力ファイル

### `prefecture/` — 都道府県（小選挙区）

- `_prefecture_all.csv` … 全都道府県の候補者データ
- `_prefecture_all_party.csv` … 政党別に並び替えたもの

### `proportional/` — 比例ブロック

- `_proportional_all.csv` … 全比例ブロックの候補者データ
- `_proportional_all_party.csv` … 政党別に並び替えたもの

### `all/` — 小選挙区と比例代表を統合

- `_all_candidates.csv` … 全候補者データ
- `_all_candidates_party.csv` … 政党別に並び替えたもの

### `question_mapping.csv` — 設問と回答の対応表

設問番号、質問文、選択肢の意味を記載しています。

### `cache_candidates/` — 候補者詳細のキャッシュ

候補者詳細ページから取得したデータをJSONで保存しています。収集が途中で失敗したときの再取得用です。

- `[ハッシュ値].json` … 候補者ページURLをハッシュ化した名前で、1人分のデータを保存

## 注意事項

- 公開されているウェブページのみを対象にしています。
- サーバーに負荷をかけないよう、間隔を空けてアクセスしてください。
- 実行前に対象サイトの robots.txt と利用規約を確認してください。
- データは学術・非営利の研究目的での利用を想定しています。再利用する場合は出典を明記してください。

## トラブルシューティング

- **文字化け**: `response.encoding = response.apparent_encoding` を試す
- **欠損値**: 未公開の項目があるため、`None` や空文字を必ず扱う
- **接続エラー**: リトライを入れ、リクエスト間に `sleep` を挟む

## 作者

ryouy
