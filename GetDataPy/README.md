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

| ファイル | 内容 | 入力 | 主な出力 |
| --- | --- | --- | --- |
| `2026_Election_Yomiuri.ipynb` | 読売新聞の候補者ページから、プロフィールとアンケート回答を取得 | 読売の候補者ページ（ウェブ） | `prefecture/` `proportional/` `all/` `cache_candidates/` |
| `NHKelection.ipynb` | NHKのアンケートページ（保存したHTML）から回答を抽出し、読売のデータと突き合わせ | 保存済みHTML、読売の `_all_candidates.csv` | NHK版の `all_candidates_plus.csv` など |

どちらも Google Colab での実行を前提にしています（ローカルのJupyterでも動きますが、Driveのマウントとパスの書き換えが必要です）。**先に読売、次にNHK** の順で実行します。NHK側が読売の出力CSVを読み込むためです。

### 共通の準備

```bash
pip install requests beautifulsoup4 pandas tqdm lxml
```

- Driveをマウントし、途中結果と出力をDriveに保存します。
- パス（`/content/drive/MyDrive/yomiuri_enquete_2026` や `/content/drive/MyDrive/NHK_enquete_2026`）は、自分のDriveの構成に合わせて書き換えてください。

---

### 1. `2026_Election_Yomiuri.ipynb`（読売新聞）

全体は **①候補者URLの収集 → ②設問と回答の収集** の2段階です。

#### ① 候補者詳細URLを収集する

| ステップ | 内容 |
| --- | --- |
| 都道府県ページの取得 | `https://www.yomiuri.co.jp/election/shugiin/` から、正規表現 `YA01〜YA47XXXXXX000` に合うリンクを集めて都道府県ページの一覧を作る |
| 候補者URLの取得 | 各都道府県ページから `.../shugiin/2026/YAxxXXXXXX000/<候補者ID>/` 形式のリンクを抽出。リンク文字列から「〇〇歳」より前を氏名として取り出し、URLで重複を除く |
| JSON保存 | `prefecture_data/<都道府県名>/<都道府県名>_candidates.json` に、`candidate_name` と `candidate_url` を保存 |
| 不要フォルダの掃除 | 見出しリンク（`#選挙・…`）を誤って都道府県扱いした場合のフォルダを削除 |
| 比例ブロックの取得 | `YC81〜YC91XXXXXX000` の11ブロック（北海道〜九州）について、同様に候補者URLを集めて `proportional_data/<ブロック名>/` に保存 |

#### ② 設問と回答を収集する

候補者ページの回答欄はJavaScriptで描画されるため、`requests` ではなく **Playwright（ヘッドレスChromium）** で開いています。

1. **環境構築** — Colabに必要なライブラリを `apt-get` で入れ、`playwright install chromium` を実行する
2. **設定** — 出力先・タイムアウト・待ち時間・リトライ回数などを冒頭の定数で指定する
   - `LIMIT_PER_UNIT`: 各県・各ブロックの先頭N件だけ処理する（動作確認用。`None` なら全件）
   - `JITTER_SEC` / `RETRIES` / `BASE_BACKOFF_SEC`: アクセス間隔のばらつき、リトライ、待機時間
   - `DROP_DUPLICATE_BY_URL`: 小選挙区と比例の両方に出る候補者をURLで重複除去する
   - `FORCE_Q24_SUBKEYS`: Q24を `Q24-1〜Q24-11` の固定列として必ず出力する
3. **キャッシュ** — URLをSHA-1でハッシュ化した `cache_candidates/<ハッシュ>.json` に1人ずつ保存する。取得済み（`_status: ok`）はスキップするので、Colabが切れても続きから再開できる。失敗は `_status: fail` と `_error` を記録する
4. **プロフィール抽出** — `h1` から氏名、本文から年齢、`dt/dd` または `th/td` の「党派・政党」から政党を取る
5. **回答抽出** — 設問の形式ごとに取り方を分けている

   | 設問 | 形式 | 列名の例 |
   | --- | --- | --- |
   | 通常の設問 | 単一選択 | `Q2` |
   | Q1 | 順位付け | `Q1-1`, `Q1-2`, … |
   | Q9 | 複数テーマ（a〜f）を連番化 | `Q9-1`〜 |
   | Q24など | 複数選択 | `Q24-1`〜`Q24-11` |
   | Q25 | 0〜10の目盛り（`active` の位置を読む） | `Q25-1`〜 |

   回答は選択肢の番号（数字）で保存します。番号と選択肢の対応は `question_mapping.csv` を見てください。
6. **描画待ち** — 回答が入るまで最大約1.5秒、0.5秒間隔で確認する。設問ブロックが出ない場合は「未回答/構造違い」として空欄のまま進める
7. **DataFrame化** — `グループ`（都道府県名またはブロック名）、`氏名`、`年齢`、`政党`、`Q…` 列（設問番号順）、`URL` の順に並べる
8. **実行** — 最後のセルの `await run_all()` が、都道府県・比例・統合の3つのDataFrameを作り、Driveの `prefecture/` `proportional/` `all/` にCSVで保存する

途中に「Driveのキャッシュをリセットする」任意のセルがあります（`ok` なのに `Q` 列が1つもないキャッシュを削除）。通常は不要です。

---

### 2. `NHKelection.ipynb`（NHK）

NHKの回答は、**保存したHTML/テキストを解析** します（ノートブック自体はNHKのサイトにアクセスしません）。事前に、NHKの各アンケートページを `NHK_enquete_2026/htmls` に保存しておく必要があります。

| セル | 内容 |
| --- | --- |
| 1 | Driveの `NHK_enquete_2026/htmls` を、Colab上の `/content/all` にコピーする |
| 2 | HTML/TXTから回答を抽出し、`/content/all_candidate.csv` に出力する |
| 3 | 読売のマスタCSVと氏名で突き合わせて、グループ・年齢・政党を付ける |
| 4 | 完成したCSVをDriveに保存し、都道府県別・政党別にも分ける |

#### セル2：回答の抽出

- HTMLを `BeautifulSoup` でテキスト化（`<br>` は改行に置換）し、1行ずつ処理する
- `Q:` で始まる行を設問の見出しとして数え、設問番号を決める
- 「回答の理由」「さらにどんなことに力を入れるべき」「具体的に…お答えください」を含む設問は **記述式として除外** する。数えるのは選択式のQ1〜Q22だけ
- 「氏名（全角スペースか2つ以上の空白）回答」の形の行から、氏名と回答文を取り出す
- 回答文は `CHOICE_MAP`（Q1〜Q22の選択肢一覧）と照合して、選択肢の番号（1始まり）に変換する。その際、読点と句点の違い、末尾の「。」、空白の揺れをそろえる
- 選択肢に一致しない回答は `/content/final_unmatched.csv` に「ファイル名・氏名・設問・原文回答」として出力する。表記ゆれの確認に使う

#### セル3：読売データとの突き合わせ

- 氏名の空白（全角/半角）を統一して、`氏名_key` で左結合する
- 読売側の列名の揺れ（`氏名/名前/候補者`、`政党/党/所属` など）は、候補の別名リストで吸収する
- 同姓同名は先頭の1件を採用する（必要なら調整）
- `グループ, 氏名, 年齢, 政党, Q1〜Q22` の順に並べて `/content/all_candidates.csv` に保存する
- 突合できなかった氏名（表記ゆれなど）は、画面に一覧表示する

#### セル4：Driveへの保存

- `all_candidates_plus.csv` … 全員分
- `prefecture/<グループ名>.csv` … 都道府県（グループ）別
- `_all_candidates_party.csv` … 政党別（所属人数の多い順）

---

### 読売とNHKの違い

| | 読売 | NHK |
| --- | --- | --- |
| 取得方法 | Playwrightでページを開いて取得 | 保存したHTMLを解析 |
| 設問数 | Q1〜Q25（Q1は順位、Q24は複数選択、Q25は目盛り） | 選択式のQ1〜Q22のみ |
| 回答の形式 | 選択肢の番号 | 選択肢の文言を番号に変換 |
| 再開 | URL単位のキャッシュ（`cache_candidates/`） | なし |

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
