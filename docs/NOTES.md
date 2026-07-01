# 実装メモ・気づき

最終更新: 2026-07-01

## 2026-07-01 API revision と編集文脈

### 違和感

API revision 読込をインポート画面に追加し、公開ゲートにも revision 保存/publish/smoke を追加した時点で、
両画面がそれぞれ `projectId` / `revisionId` を持つ状態になっていた。

このままだと、次の流れで操作文脈が切れる。

1. API latest から GTFS zip を読み込む。
2. 停留所・ダイヤ・shape を編集する。
3. 公開ゲートへ移動する。
4. 公開ゲート側で同じ revision を手入力し直す。

### 対応

- latest zip のレスポンスヘッダー `x-gtfs-revision` を読んで、実際に読み込んだ revision ID を UI 状態へ反映する。
- App が `projectId` / `revisionId` を持ち、ReleaseGateView に初期値として渡す。
- ReleaseGateView で revision 保存に成功したら、保存された revision ID を App 側へ返す。
- ReleaseGateView で project/revision を手入力変更した場合も App 側へ同期する。

### 得られた知見

GTFS Studio の公開ワークフローでは、`gtfs.zip` そのものだけでなく
「どの project/revision を編集しているか」が一次的な作業文脈になる。

ブラウザ内の一時編集であっても、API revision から始めた作業は revision context を保持しないと、
warning 承認、publish、public URL smoke、再編集が別々の作業に見えてしまう。

今後 DB やユーザー権限を入れる場合も、画面単位ではなく editor session 単位で
`projectId` / `baseRevisionId` / `workingRevisionId` を持つ設計に寄せるのが自然。

## 2026-07-01 warning承認とrevision保存の順序

### 違和感

warning 承認記録を API 保存できるようにした後も、revision 保存と warning 承認保存が別ボタンのままだった。

この状態では、公開候補の zip は revision として保存されているのに、承認記録だけ旧 revision に残る、
または JSON 控えだけ手元に残って API 側に無い、というずれが起きやすい。

### 対応

- 公開ゲートで revision 保存に成功したとき、承認済み warning があれば同じ revision ID へ自動保存する。
- 自動保存に失敗した場合でも、revision 自体が保存済みであることと、承認記録だけ失敗したことを分けて表示する。
- publish 成功後、public URL smoke の入力欄が空なら API の latest zip URL を自動補完する。

### 得られた知見

公開判定の証跡は「操作ログ」ではなく「公開対象 artifact に紐づく metadata」として扱う方が事故が少ない。

特に warning 承認は現在の UI 状態ではなく、保存済み revision の一部として扱うべきで、
将来のDB化では `feed_revisions` と `warning_approvals` を revision ID で強く結びつける設計が自然。

## 2026-07-01 ブラウザ公開ゲートとAPI仕様ロックのズレ

### 違和感

API は `/spec-locks` に仕様ロックを持ち、revision 作成時も repository snapshot を使って検収している。
一方で、ブラウザの公開ゲートはローカルの `runAcceptancePipeline` だけを実行していたため、
API 側に保存済みの仕様ロックが画面判定へ反映されていなかった。

その結果、APIで作成した revision の判定と、ブラウザで見ている公開ゲートの判定が微妙に違って見える可能性があった。

### 対応

- ReleaseGateView から `/spec-locks` を読み込めるようにした。
- 読み込んだ `SpecLock` をブラウザ側の `runAcceptancePipeline` に渡し、画面の仕様ロック表示と判定へ反映する。

### 得られた知見

公開ゲートは「ローカル計算できる判定」と「運用環境が持つ証跡」を合成して初めて意味を持つ。

標準validator report、実データ回帰、仕様ロック、public URL smoke はすべて外部証跡なので、
ブラウザ単体の即時検証とは別に、APIから証跡を取り込む導線を明示する必要がある。

## 2026-07-01 実データ回帰summaryのWeb取り込み

### 違和感

`gtfs-regression` は A-07/A-08 のための summary.json を出力できるが、
Web 公開ゲートではその証跡を取り込めなかった。

そのため、CLIでは検収readyに近づけられる一方、Web上では A-07/A-08 が常に fail に見え、
「実データ回帰を終えたのに画面では未完」という違和感が残っていた。

### 対応

- ReleaseGateView で `gtfs-tmp/regression/results/summary.json` を読み込めるようにした。
- `evidenceFromRegressionSummary(..., { requireReviewed: true })` を使い、レビュー済み case だけを A-07/A-08 の証跡に採用する。
- 取り込んだ証跡をブラウザ側の公開ゲート判定と revision 保存APIの payload の両方へ渡す。

### 得られた知見

実データ回帰は、テスト結果そのものより「その case を公開判定に使ってよいか」のレビュー状態が重要。

Web UI でも `requireReviewed` を既定にしたことで、単に error 0 のzipを拾うのではなく、
許諾・匿名化・レビュー済みという運用判断を公開ゲートに載せる形へ寄せられる。

## 2026-07-01 README/REGRESSION整理で見えたこと

CLIとWebの公開ゲートは別の入口だが、使う証跡は同じであるべき。

- MobilityData validator の `report.json`
- `gtfs-regression` の `summary.json`
- API `/spec-locks` の仕様ロック
- warning承認記録
- public URL smoke 結果

README は操作順、REGRESSION は回帰証跡の作り方、NOTES は設計上の違和感と判断理由、という役割に分けると重複が少ない。

今後 docs が膨らむ場合は、公開前チェックリストを別ファイル化し、CLI実行とWeb操作の両方を同じチェック項目へ紐づけると運用しやすい。

## 2026-07-01 publish/smokeテスト補強

publish は「対象revisionを公開する」だけではなく、「既存の published revision を superseded にする」状態遷移も含む。

public URL smoke は公開URLを検証する入口なので、URL未指定や `file://` のようなローカルパスを拒否する必要がある。
ここをテストで固定しておくと、将来の公開先拡張でも「外部から取得できるURLだけをsmoke対象にする」という境界を保てる。

## 2026-07-01 revision一覧のlimit

### 違和感

revision保存とpublishが動くようになると、一覧APIは最初に重くなりやすい場所になる。
ファイル永続化MVPでは件数が少ないうちは問題にならないが、Webの「API revision 読込」が毎回全metadataを読む設計だと、
運用が続くほど初期表示とネットワーク転送が無駄に増える。

### 対応

- `GET /projects/:project/revisions?limit=20` を追加した。
- レスポンスに `total` と `limit` を含め、UI側が「まだ続きがある」ことを判断できる余地を残した。
- 既定は互換性を優先して全件返却のままにし、明示limit時だけ 1〜500 件に丸める。

### 得られた知見

revision一覧は監査・再公開・比較の入口になるため、早い段階でページング前提にしておく方がよい。

今回の `limit` はMVPの過読込対策に留めたが、DB化時は `cursor`、`status=published|validated|superseded`、
`createdBefore` などを追加すると、長期運用の一覧画面と監査画面を同じAPIで支えやすい。

## 2026-07-02 revision一覧の状態フィルタとWeb履歴表示

### 違和感

revision一覧が単なるID選択だけだと、公開済み、未公開、差し替え済みのどれを触っているのかが見えにくい。
特に publish と latest 配信が入ると、「最新公開を読む」のか「検収中の版を読む」のかをUIで判断できない。

### 対応

- `GET /projects/:project/revisions?status=published&limit=20` を追加した。
- WebのAPI revision読込に `limit` と `status` を追加した。
- 一覧に status、gate、acceptance、profile、日時、zip hash短縮表示を出し、公開候補の選択に必要な情報を増やした。

### 得られた知見

revision一覧はインポート補助ではなく、公開運用の入口になっていく。

最低限、status、gate、acceptance、publishedAt/createdAt、hashが同じ行で見えると、
「公開中の版を再読込する」「未公開のready候補を確認する」「supersededを過去参照する」という操作を分けやすい。
次に進めるなら、状態別件数、cursorページング、revision比較の順で足すのが自然。

## 2026-07-02 revision一覧のページングと状態別件数

### 違和感

`limit` だけでは先頭ページを軽くできるが、次ページへ進めない。
また `status=published` で絞った時に、未公開 validated が何件残っているかが同じ画面で分からない。

### 対応

- revision一覧APIに `offset`、`hasMore`、`statusCounts` を追加した。
- WebのAPI revision読込に前後ページ移動と状態別件数チップを追加した。
- 状態別件数は現在の `status` フィルタに関係なく project 全体で返し、公開済み・未公開・差し替え済みの分布を常に見られるようにした。

### 得られた知見

revision一覧は「検索結果」だけではなく「運用キュー」でもある。

状態別件数があると、公開中の版を探す操作と、未公開 validated を処理する操作を同じ画面で切り替えられる。
MVPでは `offset` で十分だが、DB化後に件数が大きくなる場合は `createdAt + id` ベースの cursor に置き換える方が安定する。

## 2026-07-02 revision詳細の事前確認

### 違和感

revision一覧からIDを選んでGTFS zipを読み込むだけだと、その版が本当に作業対象なのかを読み込み後にしか判断できない。
公開済みrevisionを確認したいだけなのか、未公開ready候補を開きたいのか、ブロッカーの残る版を調査したいのかが一覧上で判別しづらい。

### 対応

- WebのAPI revision一覧で行を選ぶと、revision詳細APIを読み込むようにした。
- 詳細パネルに gate、acceptance、blocker数、warning承認数、GTFS-JP/Google検証件数、zip bytes、updated、sha256を表示した。
- 状態別件数チップは、クリック時にその状態で一覧を再読込するようにした。

### 得られた知見

revision一覧から直接zipを開く前に、metadataだけで公開判断を進められる方が運用は軽い。

特に hash、blocker数、承認数、validation summary が同じ場所に見えると、
「この版を開く」「publishする前に公開ゲートで再確認する」「過去版として参照する」の判断が分かれる。
次は詳細パネルから publish/smoke へ進む導線か、2 revision の metadata 差分比較を足すと自然。
