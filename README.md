# GTFS Studio (仮称)

GTFS-JP（v4）/ GTFS-RT 形式の公開用オープンデータを、取込・編集・検証・配信するWEBサービス。
通称「西沢ツール」のWEB版として、作成 → 検証 → 公開（配信）→ 更新 を一気通貫で支援する。

- **OSS＋コミュニティサポート**を中核とし、SaaS提供と自治体オンプレ運用の双方を可能にする。
- 仕様書は [`docs/spec/`](./docs/spec/README.md) を参照。
- 全体ロードマップは [`docs/ROADMAP.md`](./docs/ROADMAP.md)、実装の進捗は [`docs/STATUS.md`](./docs/STATUS.md)、直近の整理は [`docs/PROGRESS_20260701.md`](./docs/PROGRESS_20260701.md)、変更履歴は [`CHANGELOG.md`](./CHANGELOG.md) を参照。

> 本プロジェクトは、西沢明氏が無償公開した「西沢ツール」が日本のバスオープンデータ普及に果たした功績を出発点とし、その志をOSSとコミュニティで引き継ぐことを目的とする。

## リポジトリ構成

```
docs/
  spec/           仕様書一式（01〜11章）
  ROADMAP.md      全体ロードマップ・優先順位・確認事項
  STATUS.md       仕様 ⇄ 実装の対応表（実装進捗）
  PROGRESS_20260701.md  直近の進捗整理・知見
CHANGELOG.md      変更履歴
packages/
  core/           GTFS エンジン（取込・検証・移行・出力・検収。フレームワーク非依存・純TS）
  web/            Web UI（React + MapLibre。取込・停留所地図編集・ダイヤ表・検証・公開ゲート）
  api/            バックエンドAPI（node:http・依存ゼロ。仕様ロック永続化・検収HTTP）
gtfs-tmp/         作業用スクラッチ・過去スナップショット（Git管理外）
```

## 開発

```bash
pnpm install
pnpm -r build      # 全パッケージビルド
pnpm -r test       # 全パッケージテスト
```

## プロジェクトの進め方

- 作業中に得た知見、違和感、設計判断、運用上の注意は、適時このREADMEや `docs/` 配下のMDファイルへ追記する。
- プログラムや生成処理を更新した場合は、検証内容を記録し、Giteaの該当リポジトリへcommit/pushする。
- ロードマップ、TODO、進捗メモを意識し、実装内容に合わせて更新する。
- 大きな変更は一度にまとめず、調査、設計メモ、最小実装、検証、記録、pushの順に段階を踏んで進める。

## Web公開とdashboard連携

- 作業ハブ: `http://dc-storage/project/hdd20tb/project-gtfs/`
- GTFS current: `http://dc-storage/project/hdd20tb/project-gtfs/public/current/`
- dashboard登録: `/mnt/hdd20tb/project-dashboard/assets/app.js` の `project-gtfs` inventory

Web公開物は作業ハブ側の `project-gtfs/public/current/` に集約し、実体の開発とGitea管理はこのリポジトリ `/mnt/hdd20tb/project/gtfs` を正本とする。
新しい公開ビルド、validator report viewer、運用画面を追加した場合は、このREADME、`/mnt/hdd20tb/project-gtfs/README.md`、`project-dashboard/assets/app.js` を合わせて更新し、dashboardから辿れる状態にする。

## 作業ログ必須運用

- 作業開始時は `/mnt/hdd20tb/tools/project-log -p project-gtfs -c start --status started --prompt "<受けた指示>" "<作業開始内容>"` で、受けた指示プロンプトと対象を必ず記録する。
- 作業中は判断、知見、違和感、検証結果を `progress`、`verification`、`push` などのcategoryで適時記録する。
- 作業終了時は `-c end --status complete|partial|blocked` で、実施内容、検証、commit/push、残件、次に見る場所を必ず記録する。
- ログは `/mnt/hdd20tb/project.log` と `/mnt/hdd20tb/project-events.jsonl` に保存され、次の作業者は最後の `end` ログから再開する。

### 検収・標準validator

```bash
pnpm gtfs:validator:install
pnpm gtfs:validate path/to/gtfs.zip
pnpm gtfs:anonymize path/to/input.zip gtfs-tmp/regression/anonymized/input.zip
pnpm gtfs:regression
```

- `pnpm gtfs:validator:install` で MobilityData validator `8.0.1` を `tools/gtfs-validator.jar` に配置する。
- 別パスを使う場合は `GTFS_VALIDATOR_JAR=/path/to/gtfs-validator.jar pnpm gtfs:validate path/to/gtfs.zip`。
- 既存の `report.json` を使う場合は `pnpm gtfs:validate path/to/gtfs.zip --report report.json`。
- `tools/gtfs-validator.jar` はGit管理外。
- `pnpm gtfs:golden` で v4 golden sample zip を `gtfs-tmp/golden/` に生成できる。
- `pnpm gtfs:validate-golden` で golden zip を生成し、標準validator reportを `gtfs-tmp/golden-reports/` に保存できる。
- `pnpm gtfs:regression` で `gtfs-tmp/regression/manifest.json` に列挙した実フィード/匿名化フィードを取込→再出力→検証し、A-07/A-08 用の証跡を `gtfs-tmp/regression/results/summary.json` に保存できる。
- `pnpm gtfs:anonymize <input.zip> <output.zip>` で回帰用の匿名化候補zipを生成できる。既定では参照整合を壊さないためIDと座標は保持し、名称・URL・電話・メール等を置換する。
- `pnpm gtfs:validate <release.zip> --regression-summary gtfs-tmp/regression/results/summary.json --require-reviewed` で回帰結果を A-07/A-08 の検収証跡として取り込める。
- 実データ回帰の運用方針は [`docs/REGRESSION.md`](./docs/REGRESSION.md)、manifest雛形は [`docs/regression-manifest.example.json`](./docs/regression-manifest.example.json) を参照。
- 公開前のCLI/Web共通チェックは [`docs/RELEASE_CHECKLIST.md`](./docs/RELEASE_CHECKLIST.md) を参照。
- API起動・token・revision/publish/smoke運用は [`docs/API_OPERATIONS.md`](./docs/API_OPERATIONS.md) を参照。
- validatorの詳細ログを見たい場合は `node scripts/gtfs-validate-golden.mjs --verbose` を使う。
- CIや新規環境では `pnpm gtfs:validator:install && pnpm gtfs:validate-golden` を実行する。

### packages/core

GTFSの **取込（zip→内部モデル）→ 検証 → 再出力（→zip）** を担う中核ロジック。
フレームワークやDBに依存せず、単体テストで品質を担保する（仕様書 08章の方針）。

```bash
pnpm --filter @gtfs-studio/core test
```

### packages/web（デモUI）

```bash
pnpm --filter @gtfs-studio/core build   # core を先にビルド
pnpm --filter @gtfs-studio/web dev      # http://localhost:5173
```

- GTFS zip を開く → 停留所（一覧＋地図。ピンのドラッグで座標編集）/ ダイヤ表（セル編集）/ 検証 → gtfs.zip 再出力。
- 地図は自前 MapLibre 基盤を**地図アダプタ**経由で利用（仕様書 04章4.4 / 09章）。
  自前基盤の style URL は環境変数 `VITE_MAP_STYLE_URL` で注入。未設定時は暫定で地理院タイル（淡色）を表示。

#### Web公開ワークフローMVP

公開ゲート画面では、ブラウザ内検証に加えて API/CLI 由来の証跡を取り込める。

1. ZIPインポート、または「API revision 読込」で既存 revision/latest を開く。
2. 停留所、ダイヤ、運賃、shape を編集する。
3. 公開ゲートで `report.json`（MobilityData validator）を読み込む。
4. 必要に応じて `/spec-locks`、回帰 `summary.json`、warning承認を取り込む。
5. `revision保存` で zip・検証結果・仕様ロック・承認記録を版として保存する。
6. ready な revision は `publish` し、補完された latest URL に対して `smoke` を実行する。

API接続先は `VITE_GTFS_API_BASE_URL`（既定 `http://localhost:8787`）。書込tokenを使う環境では公開ゲートの token 欄に設定する。

## ライセンス

- アプリ本体: Apache-2.0
- 生成データの推奨ライセンス: CC BY

<!-- docs-common:begin -->
## 共通開発ドキュメント

開発方針・サーバ環境など全プロジェクト共通の事項は [mit/docs-common](http://dc-storage:3000/mit/docs-common) で集中管理。
- 開発方針: [DEV_POLICY.md](http://dc-storage:3000/mit/docs-common/src/branch/main/DEV_POLICY.md)
- 開発環境・体制: [ENVIRONMENT.md](http://dc-storage:3000/mit/docs-common/src/branch/main/ENVIRONMENT.md)
- ドキュメント構成規約: [DOC_CONVENTION.md](http://dc-storage:3000/mit/docs-common/src/branch/main/DOC_CONVENTION.md)
<!-- docs-common:end -->
