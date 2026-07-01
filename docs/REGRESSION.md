# 実データ回帰セット

最終更新: 2026-07-01

GTFS-JP v4 の A-07/A-08 検収では、golden sample だけでなく実フィードまたは匿名化フィードの
取込、再出力、標準validator結果を証跡化する。

## 方針

- 実フィード zip は利用許諾と匿名化方針が確定するまで Git 管理しない。
- 回帰セットの正本は `gtfs-tmp/regression/manifest.json` とする。
- manifest の雛形は [`regression-manifest.example.json`](./regression-manifest.example.json)。
- 実行結果は `gtfs-tmp/regression/results/summary.json` に保存する。
- `gtfs-tmp/`、`tools/gtfs-validator.jar` は Git 管理外。
- 匿名化CLIは参照整合を壊さないため、既定では `*_id` と緯度経度を保持する。座標を隠す必要がある場合は `--jitter-meters` を指定する。
- 匿名化CLIは回帰用の補助であり、法的な匿名化完了を保証しない。公開・コミット前には利用許諾と匿名化結果をレビューする。

## 実行

```bash
cp docs/regression-manifest.example.json gtfs-tmp/regression/manifest.json
# manifest の input をローカルの実フィード/匿名化フィード zip に差し替える
pnpm gtfs:validator:install
pnpm gtfs:regression
```

実フィードを匿名化してから使う場合:

```bash
pnpm gtfs:anonymize path/to/input.zip gtfs-tmp/regression/anonymized/input.zip \
  --report gtfs-tmp/regression/anonymized/input.report.json
```

座標もずらす場合:

```bash
pnpm gtfs:anonymize path/to/input.zip gtfs-tmp/regression/anonymized/input.zip \
  --jitter-meters 300 --report gtfs-tmp/regression/anonymized/input.report.json
```

manifest のパスを変える場合:

```bash
pnpm gtfs:regression -- --manifest /path/to/manifest.json --out-dir gtfs-tmp/regression/results
```

入力ファイルの存在だけ確認する場合:

```bash
pnpm gtfs:regression -- --dry-run
```

許諾・匿名化レビュー済みの case だけ実行したい場合:

```bash
pnpm gtfs:regression -- --require-reviewed
```

回帰結果を検収CLIへ渡す場合:

```bash
pnpm gtfs:validate path/to/release-candidate.zip \
  --report path/to/release-candidate.report.json \
  --regression-summary gtfs-tmp/regression/results/summary.json \
  --require-reviewed
```

Web公開ゲートで使う場合:

1. `pnpm gtfs:regression` で `gtfs-tmp/regression/results/summary.json` を生成する。
2. Webの公開ゲートで「実データ回帰証跡」の `summary.json を読み込む` を実行する。
3. Web側も `requireReviewed` 相当で取り込み、未レビューcaseは証跡として採用しない。
4. `revision保存` 時には、取り込んだ A-07/A-08 証跡がAPIへ渡る。

`--require-reviewed` では、各 case の `review` に少なくとも次を要求する。

- `sourceLicense` が `unknown` ではない
- `allowedForRegression: true`
- `reviewedBy` / `reviewedAt`
- `anonymized: true` の場合は `anonymizationReviewed: true`
- `anonymized: false` の場合は `rawFeedReviewed: true`

## 出力

`summary.json` には各 case について次を保存する。

- 入力zipパス、生成zipパス
- 取込ファイル一覧、取込警告
- v3移行警告
- 内部validator summary
- 内部validator issue（先頭20件）
- MobilityData validator summary
- MobilityData validator issue（先頭20件）
- A-07/A-08 に渡せる `acceptanceEvidence`

## 今回確認した知見

- `gtfs-tmp/` は既に `.gitignore` 対象で、実データや回帰結果を置く場所として使える。
- `gtfs-tmp/golden/` と `gtfs-tmp/golden-reports/` には golden sample と validator report が生成済み。
- `gtfs-tmp/_archive/*.zip` は過去ソース/作業スナップショットであり、実GTFSフィード回帰の正本としては扱わない。
- `packages/core/examples/roundtrip-cli.mjs` は単発確認用で、複数実フィードの証跡固定には manifest 型のラッパが必要。
- MobilityData validator jar は `tools/gtfs-validator.jar` に存在するが Git 管理外なので、CI/新環境では `pnpm gtfs:validator:install` が必要。
- golden `minimal-fixed-bus.zip` で回帰CLIをスモークしたところ、内部validator/標準validatorとも error 0。warning は内部側が `attributions.txt` / `transfers.txt` の推奨ファイル欠落、標準validator側が `missing_feed_contact_email_and_url` と `fare_attributes.agency_id` 推奨項目欠落だった。いずれも公開可否では warning 扱いだが、実データ回帰の比較では warning code も保存する。
- `pnpm gtfs:regression -- --manifest ...` では区切りの `--` が Node 側に渡るため、CLI 側で無視する必要があった。
- GTFSは `*_id` 参照が多く、IDを匿名化すると参照整合を壊しやすい。まずは名称・連絡先・URL等の表示/連絡先項目を置換し、ID匿名化は別機能として扱うのが安全。
- stop/shape座標は地域や事業者推定につながる可能性がある。回帰精度を優先する場合は保持、秘匿を優先する場合は `--jitter-meters` でずらす運用に分ける。
- URL匿名化で `example.invalid` を使うと MobilityData validator 8.0.1 が `invalid_url` error にするため、匿名化URLは `https://example.com/...` を使う。
- 回帰manifestには入力パスだけでなく、許諾・匿名化レビュー状態を機械判定できる項目が必要。`--require-reviewed` をCIやリリース前検収で使うと、未レビュー実データの混入を防げる。
- `gtfs-acceptance` が `gtfs-regression` の `summary.json` を直接読めないと、A-07/A-08 の error 件数を手入力する必要があり、証跡の取り違えが起きやすい。`--regression-summary` で連携する。
- `--regression-summary` は `mode=roundtrip` を A-07、`mode=v3-migration` を A-08 に対応させる。roundtrip だけの summary では A-08 は fail のままなので、リリース検収用 manifest には両方が必要。

## 残課題

- 実データを repo に入れてよいか、または匿名化して入れるかの判断が未確定。
- `gtfs-tmp/regression/manifest.json` に登録する実フィード候補が未確定。
- 匿名化後zipを repo に入れてよいかのレビュー基準が未確定。
- `reviewedBy` / `reviewedAt` の正式な主体（個人名、チーム名、チケットIDなど）の運用ルールが未確定。
- 標準validatorが無い環境では、内部検証と再出力までは実行できるが A-07/A-08 の最終合格証跡にはならない。
- v3移行回帰では、移行警告が「妥当」と言えるレビュー基準を case ごとに記録する必要がある。
