# Changelog

GTFS Studio（西沢ツールWEB版）の段階的実装の記録。仕様書（`docs/spec/`）に追従し、
`packages/core` の取込・検証・移行・出力を一歩ずつ確実にしていく。

## Unreleased — GTFS-RT VehiclePositions認証・TripUpdates MVP / V4 golden samples

GTFS-RTの書き込み系を運用に寄せ、TripUpdatesの最小生成・配信と
GTFS-JP v4 golden sample回帰を追加した。

### 追加（root）

- **標準validator検収のルートコマンドを追加**。
  `pnpm gtfs:validate <gtfs.zip>` で `packages/core/bin/gtfs-acceptance.mjs` を呼び出す。
  MobilityData validator jar は `tools/gtfs-validator.jar` または `GTFS_VALIDATOR_JAR` で指定する。
- **v4 golden sample zip生成コマンドを追加**。
  `pnpm gtfs:golden` で内部v4検証 error 0 を確認し、`gtfs-tmp/golden/*.zip` を生成する。
- **v4 golden sample標準validator一括実行コマンドを追加**。
  `pnpm gtfs:validate-golden` で golden zip を生成し、MobilityData validator の
  `report.json` を `gtfs-tmp/golden-reports/<sample>/` に保存する。

### 追加（core）

- **TripUpdates builder/storeを追加**（`packages/core/src/realtime.ts`）。
  `TripUpdateInput` からGTFS-RT `FeedMessage` を生成し、StopTimeUpdateの
  arrival/departure delay/time、trip/stopの schedule_relationship をprotobuf化できる。
- **TripUpdatesの保存ストアを追加**。
  `createRealtimeTripUpdateStore` で最新TripUpdateを保持し、`encodeTripUpdatesFeed`
  で `.pb` 配信に使えるバイト列を生成する。
- **TripUpdates用の静的GTFS indexを追加**（`packages/core/src/realtime-trip-index.ts`）。
  `trips.txt` / `stop_times.txt` から trip_id / route_id / stop_sequence を引ける
  `buildRealtimeTripIndex` を作り、trip_id基準の遅延を `tripDelayToTripUpdate` で
  StopTimeUpdateへ展開できる。
- **TripUpdates用の候補trip抽出を追加**。
  `findRealtimeTripCandidates` で route_id、時刻、任意の service_id / direction_id /
  stop_id から近い静的trip候補を返し、`matchedTripDelayToTripUpdate` で最も近い候補を
  遅延TripUpdateへ展開できる。
- **TripUpdates候補抽出の品質評価を追加**。
  `evaluateRealtimeTripMatching` で候補なし・一意・曖昧・正解trip一致率・時刻差を集計し、
  実データログによるtrip特定率評価の土台にできる。
- **TripUpdates用の静的stop進捗推定を追加**。
  `estimateStopProgress` で静的stop_timesと遅延秒から始発前・運行中・終端後、
  現在/次停留所、区間進捗率を推定し、`tripProgressToTripUpdate` で次停留所以降の
  StopTimeUpdateへ展開できる。
- **GTFS-JP v4 golden sampleテストを追加**。
  minimal-fixed-bus、overnight-bus、calendar-dates-only、translations-kana、
  shape-basic、v4出力後の再検証を内部validator error 0で確認する。
  サンプル定義は `v4-golden-samples.ts` に集約し、テストとzip生成で共用する。

### 追加（api）

- **VehiclePositions書き込み認証・レート制限**。
  `rtVehicleTokens` 設定時のみ、`POST/PUT/DELETE /rt/vehicles` に
  `Authorization: Bearer ...` または `x-rt-source-token` を要求する。
  既定レート制限は token 単位で 60 requests / 60s。
- **TripUpdates CRUD/pb配信API**。
  `GET/POST /rt/trip-updates`、`GET/PUT/DELETE /rt/trip-updates/:id`、
  `GET /rt/trip-updates.pb` を追加した。

### テスト

- core `test/realtime.test.ts` にTripUpdates 3件、
  `test/realtime-trip-index.test.ts` にTripUpdates静的index・候補抽出・評価・進捗推定 10件、
  `test/v4-golden-samples.test.ts` にV4 golden 6件を追加。
- api `test/rt-relay.test.ts` にVehiclePositions認証/レート制限 2件、
  TripUpdates API 2件を追加。
- 2026-06-30時点で core 117件、api 24件 pass。

## Unreleased — Web トップをモード選択ランディング化

トップ画面を「作業モードの選択だけ」に変更し、選んだ先で画面全体を切り替えるようにした。

### 変更（web）

- **トップ＝ランディング**（`App.tsx`）。`ZIPインポート` / `新規作成` / `GTFS-RT` を
  カードで選択する。フィード読込/作成後のみ編集タブ（停留所・ダイヤ・検証・公開ゲート）を表示。
- 画面状態を `home / import / new / rt / edit` の単一 `view` に集約。ヘッダの
  「← トップ」で常時トップへ戻れる。既に読込済みなら「編集に戻る」カードを表示。
- 検証プロファイル切替・`gtfs.zip` 出力は編集画面でのみ表示するよう整理。

## Unreleased — GTFS-RT 外部中継・正規化（RT-2）

外部の GTFS-RT `.pb` を取得・検証・正規化してキャッシュし、最新成功Feedを再配信する
中継機能を追加した（GTFS_RT_ROADMAP の RT-2）。trip_updates / vehicle_positions /
service_alerts を対象に、鮮度SLOと中継メトリクスを持つ。

### 追加（core）

- **`realtime-relay.ts`**（`@gtfs-studio/core/realtime` サブパスで公開）。
  - `validateRealtimeFeed`: `.pb` を decode し、FeedHeader版/timestamp・vehicle座標を検証、
    種別件数と参照ID（trip/route/stop）を抽出して正規化する。
  - `createRtRelayStore`: source 設定（`RtSource`）、最新成功Feedのキャッシュ、
    `serve`（鮮度SLO=TripUpdates/VehiclePositions 90秒・Alerts 600秒で stale 判定）、
    中継メトリクス（取得時刻・連続失敗・decode/HTTP error）を保持。ネットワーク非依存。

### 追加（api）

- **`rt-relay.ts`**（`createRtRelayService`）。`fetch` 注入可能な poller。条件付きGET
  （ETag / Last-Modified）、`AbortController` による timeout、304/HTTPエラー/decodeエラーの
  分類を行う。
- **中継エンドポイント**（`server.ts`）。
  - `GET /rt/sources` ／ `GET|PUT|DELETE /rt/sources/:id`
  - `POST /rt/sources/:id/poll`（取得・取り込み）
  - `GET /rt/sources/:id/status`（メトリクス・鮮度・正規化サマリ）
  - `GET /rt/sources/:id/feed.pb`（`application/x-protobuf` 再配信、`X-Feed-Stale` / `X-Feed-Age-Sec`）
- `bin/gtfs-api.mjs` が既定で global fetch の中継サービスを起動。

### テスト

- core `test/realtime-relay.test.ts`（6件）、api `test/rt-relay.test.ts`（6件）を追加。
  正規化・鮮度・メトリクス・poller（注入fetchで200/304/エラー）・各エンドポイントを確認。
  実バイナリ経由（bin＋global fetch）で poll→ingested→`feed.pb` 配信も実機確認。
  コア 87→93、API 10→16 件。

## Unreleased — バックエンドAPI: 仕様ロック永続化・検収HTTP（10.2 / 11.4）

仕様ロックの永続化と検収実行を HTTP で提供する `@gtfs-studio/api` を新設した。
仕様 10.2「ロック状態はAPIで取得できるように」と 11.4 検収コマンドのサーバ実体。
外部依存ゼロ（`node:http` / `node:fs`）で、自治体オンプレ運用でも追加ランタイムを要しない。

### 追加

- **`packages/api` を新設**（`@gtfs-studio/api`）。`@gtfs-studio/core` のみに依存。
- **仕様ロックのファイル永続化**（`api/src/spec-lock-repository.ts`、
  `openSpecLockRepository`）。core の `createSpecLockStore` をエンジンに、JSON ファイルへ
  保存・復元する。core 本体は fs 非依存のまま、永続化責務を api 層へ分離。
- **HTTP API**（`api/src/server.ts`、`createApiServer`）。
  - `GET /health`
  - `GET /spec-locks` ／ `GET /spec-locks/:id` ／ `PUT /spec-locks/:id`（永続化）
  - `POST /acceptance`（zip(base64) ＋ 任意の validator report ＋ 回帰証跡 →
    `runAcceptancePipeline` → 11.5 形式の検収結果＋公開ゲート＋検証サマリを返す）
- **起動エントリ**（`api/bin/gtfs-api.mjs`、bin `gtfs-api`）。`--port` / `--locks` と
  環境変数 `PORT` / `GTFS_SPEC_LOCKS_PATH` に対応。

### テスト

- `api/test/spec-lock-repository.test.ts`（3件）、`api/test/server.test.ts`（7件）を追加。
  ロックの永続化往復、各エンドポイント、`POST /acceptance` の ready/not_ready/400 を確認。
  ライブサーバの health / ロック保存・永続化も実機確認。API 全 10 件 pass。

## Unreleased — 検収パイプライン・CLI・検収チェックのWeb表示（10.7 / 11.4）

取込→検証→標準validator結果取込→公開ゲート・検収（A-01〜A-10）までを 1 関数に
まとめ、CLI と Web から同じ判定を再利用できるようにした（仕様 11.4 検収コマンド）。

### 追加

- **検収パイプライン**（`packages/core/src/pipeline.ts`、`runAcceptancePipeline`）。
  zip バイト列または Feed を起点に、v4 / google 内部検証・`report.json` 取込・
  `VALIDATOR_LOCK` 確定・`evaluateReleaseGate`・`evaluateAcceptance` を一括実行する。
  fs / プロセス起動に非依存で、CLI/API/Web から共用できる。
- **検収CLI**（`packages/core/bin/gtfs-acceptance.mjs`、bin `gtfs-acceptance`）。
  `gtfs.zip` と `--report report.json`（または `--validator-jar` で MobilityData
  validator を起動）から 11.5 形式の検収JSONを出力する。`--roundtrip-errors` /
  `--v3-errors` / `--public-url-errors` で回帰証跡を渡せる。ready=0 / not_ready=2 で終了。
- **検収チェックのWeb表示**。公開ゲートタブ（`ReleaseGateView.tsx`）に A-01〜A-10 の
  チェックリストを併載。`report.json` 取込で `pipeline` 経由の判定に統一した。

### テスト

- `test/pipeline.test.ts`（3件）を追加。golden zip で ready/not_ready と例外を確認。
  CLI は golden zip ＋ clean report で `ready`（10/10, exit 0）を実機確認。

## Unreleased — 新規GTFS-JP v4作成画面

既存GTFS zipの取込だけでなく、ゼロから最小GTFS-JP v4フィードを作れるようにした。

### 追加

- **`createGtfsJpV4StarterFeed` を追加**（`packages/core/src/starter-feed.ts`）。
  agency/route/stops/service から、`agency`, `stops`, `routes`, `trips`, `stop_times`,
  `calendar`, `feed_info`, `fare_attributes`, `translations` を生成する。
- **Web UIに「新規作成」画面を追加**。
  事業者、路線、期間、停留所を入力して最小v4フィードを作り、既存の停留所編集・
  ダイヤ編集・検証・出力へそのまま遷移できる。
- **新規作成後の編集操作を追加**。
  ダイヤ画面から路線を追加できる。停留所一覧から停留所を追加し、停留所名・かな・
  座標を編集できる。ダイヤ画面では既存パターンまたは停留所順を使って新しい便と
  `stop_times` を追加できる。
- v4ロードマップの総合進捗を **70%** に更新。

### テスト

- `test/starter-feed.test.ts`（2件）を追加。生成直後のフィードが
  `gtfs-jp-v4` profile error 0 であることを確認。

## Unreleased — GTFS-JP v4ロードマップ・進捗率管理

GTFS-JP v4対応を段階的に進めるため、専用ロードマップと進捗率の算定表を追加した。

### 追加

- **`docs/GTFS_JP_V4_ROADMAP.md` を追加**。
  仕様ロック、取込、移行、出力、検証、Google公開ゲート、標準validator、golden sample、
  Web/API/公開URL運用を100点満点で管理する。
- 現在の総合進捗を **70%** として記録。
  coreライブラリ単体では約80%、公開運用プロダクトとしては約60〜70%という扱いに分けた。
- STATUSからv4ロードマップへリンク。

## Unreleased — 公開ゲートのWeb表示（11.7 / 公開可否ブロッカー）

`evaluateReleaseGate` の判定を Web UI から確認できるようにし、公開前に何が
ブロッカーかを画面で把握できるようにした。

### 追加

- **公開ゲートタブ**（`packages/web/src/components/ReleaseGateView.tsx`）。
  選択中プロファイルで `evaluateReleaseGate` を実行し、`ready` / `not_ready`、
  公開ブロッカー一覧（コード＋説明）、必須仕様ロックのロック済/未設定を表示する。
- **標準validatorレポートのブラウザ取込**。MobilityData の `report.json` を読み込むと
  `parseStandardValidatorReport` で集計し、`validatorLockFromResult` で `VALIDATOR_LOCK`
  を確定、`validator_not_executed` ブロッカーを解消する（validator実体の起動は別レイヤ）。
- `App.tsx` に「公開ゲート」タブを追加。

## Unreleased — GTFS-RT ServiceAlerts core builder

GTFS-RT実装のRT-1として、ServiceAlertsのprotobuf生成をcoreに追加した。

### 追加

- **`gtfs-realtime-bindings` を追加**。
  公式GTFS Realtime proto由来のFeedMessageクラスでencode/decodeする。
- **`packages/core/src/realtime.ts` を追加**。
  `ServiceAlertInput` からGTFS-RT `FeedMessage` を作り、`Uint8Array` の `.pb` と
  デバッグ用objectへ変換できる。
- **RT APIを `@gtfs-studio/core/realtime` サブパスとして公開**。
  通常のWeb画面で `@gtfs-studio/core` をimportしてもprotobuf依存を巻き込まない。
- **ServiceAlertsの入力モデルを追加**。
  active_period、informed_entity（agency/route/stop/trip）、cause/effect/severity、
  多言語header/description/urlに対応。
- **インメモリAlertストアを追加**。
  複数Alertの保存、削除、有効期間フィルタ、保存済みAlertからの `alerts.pb` 生成に対応。
- **Web UIにRT Alertタブを追加**。
  手動Alertを入力し、protobuf生成結果をdecode previewで確認して `alerts.pb` として
  ダウンロードできる。保存済みAlert一覧から複数Alertをまとめて出力できる。
  protobuf依存はdynamic importで別チャンク化する。

### テスト

- `test/realtime.test.ts`（6件）を追加。
  protobuf encode後にdecodeし、header/entity/alertが期待通りであることを確認。

## Unreleased — プロファイル定義のJSON外部化・仕様ロックストア（10.11 / 10.2）

検証/出力プロファイルを TypeScript 定数から **JSON 定義（`src/profiles/*.json`）を
正本**とするデータ駆動へ移行した。仕様 10.11「ルール定義データの必須項目」に沿って
版・採用ロック・根拠仕様参照・追加ルールを保持し、仕様改定時は JSON 差し替えで追従できる。

### 追加

- **プロファイル定義のJSON外部化**（`packages/core/src/profiles/*.json`、
  `src/profile-schema.ts`）。`profile_id` / `profile_version` / `source_locks` /
  `files`（`presence` / `source` / `source_ref`）/ `extra_rules` を持つ。
  `extends` で親プロファイルのファイル定義を継承する（v3-legacy←base、
  google-transit-ready←gtfs-jp-v4）。
- **`profile.ts` をJSONローダ化**。`getProfileDefinition` / `listProfileDefinitions` /
  `sourceLocksForProfile` / `toProfile` を追加。実行時 `Profile`（validator が参照する
  最小表現）は JSON 定義から導出し、`getProfile` の振る舞いは不変。
- **仕様ロックストア**（`src/spec-lock.ts`、`createSpecLockStore`）。既定ロックを
  起点に取得・上書き保存・未ロック判定・`snapshot()`（release-gate/acceptance 受け渡し）
  を提供する（10.2「ロック状態はAPIで取得」）。永続化は api 層に委ねる。

### 変更

- `packages/core/tsconfig.json` に `resolveJsonModule` を追加。`build` で
  `dist/profiles` へ JSON を複製（`scripts/copy-profiles.mjs`）。

### テスト

- `test/profile-data.test.ts`（5件）、`test/spec-lock-store.test.ts`（3件）を追加。
  既存の検証/出力テストが JSON 由来プロファイルでも不変であることを確認。
  コア全体で 68 → 76 件。

## Unreleased — 標準バリデータ連携・実データ検収（10.7 / 10.9 / 11章）

公開前検証の最終段（標準GTFSバリデータ）と、最終OK判定（検収）の機械判定器を
コアに追加した。validator の実行（Java実体起動）は別レイヤとし、コアは結果取込と
判定に責務を絞る。

### 追加

- **標準validatorレポート取込**（`packages/core/src/standard-validator.ts`）。
  MobilityData Canonical GTFS Schedule Validator の `report.json`（`notices[]` /
  `summary.validatorVersion`）を `parseStandardValidatorReport` で取り込み、
  severity 別に error/warning/info を集計する。`toStandardValidatorSummary` で
  release-gate へ、`validatorLockFromResult` で `VALIDATOR_LOCK`（11.2）を生成する。
- **実データ検収の判定器**（`packages/core/src/acceptance.ts`、`evaluateAcceptance`）。
  仕様 11.1 の A-01〜A-10 を機械判定し、11.5 のJSON形（`status` / `checks` /
  `specLocks`）で返す。標準検証・実フィード回帰・v3移行回帰・公開URL検証の証跡を
  入力とし、すべて pass のときのみ `ready`。

### テスト

- `test/standard-validator.test.ts`（5件）、`test/acceptance.test.ts`（4件）を追加。
  SAMPLE を v4 移行した golden feed が、清浄な validator 結果と証跡の下で
  検収 `ready` になることを確認。コア全体で 59 → 68 件。

## Unreleased — GTFS-RT対応ロードマップ・達成管理

GTFS-RT対応をフェーズ2として進められるよう、ロードマップ、課題、達成管理表を整備した。

### 追加

- **`docs/GTFS_RT_ROADMAP.md` を追加**。
  GTFS Realtime Reference v2.0、TripUpdates / VehiclePositions / ServiceAlerts、
  protobuf配信、鮮度SLOを前提に、RT-0〜RT-5のフェーズ、タスク、受入基準、課題、達成基準を定義した。
- **07章 GTFS-RT仕様に達成管理リンクと鮮度目標を追加**。
  TripUpdates / VehiclePositions は90秒以内、Alertsは10分以内を運用品質目標とする。
- **API仕様のRT節を具体化**。
  RT source CRUD、source status、手動Alert CRUD、RT smoke検証、source/status/AlertのJSON例を追加した。
- **STATUSにGTFS-RTフェーズ表を追加**。

## Unreleased — 公開ゲートとWeb検証プロファイル切替

v4実務検証を画面から使えるようにし、公開前ブロック条件を機械判定する土台を追加した。

### 追加

- **Web UIに検証プロファイル切替を追加**。
  `gtfs-jp-v4` / `google-transit-ready` / `gtfs-base` / `gtfs-jp-v3-legacy` を選べるようにし、
  切替時に即再検証する。zip出力も選択中プロファイルを使う。
- **仕様ロック定義を追加**（`packages/core/src/spec-lock.ts`）。
  `GTFS_SCHEDULE_LOCK` / `GTFS_JP_V4_LOCK` / `GOOGLE_TRANSIT_LOCK` / `VALIDATOR_LOCK`
  を公開判定用の監査情報として扱う。validator lock は連携未実装のため現時点では missing。
- **公開可否ゲートを追加**（`packages/core/src/release-gate.ts`）。
  profile error、仕様ロック欠落、標準validator未実行/error、実データ検収・公開URL検証の
  ブロッカーを `ready` / `not_ready` に集約する。

### テスト

- `test/release-gate.test.ts`（3件）を追加。コア全体で 56 → 59 件。

## Unreleased — v4実務検証とGoogle公開ゲート強化

GTFS-JP v4固定路線バスMVPで実運用時に見落としやすい条件付きルールと、
Google Maps申請前の実務品質ゲートを追加した。

### 追加

- **GTFS-JP v4条件付き検証を追加**（`packages/core/src/validator.ts`）。
  固定路線MVPでのFlex/Network系禁止フィールド、`shapes.txt`出力時の
  `trips.shape_id`、shape座標・sequence、translations対象キー、運賃値、
  attributions役割、transfers端点・種別を検証する。
- **`google-transit-ready` プロファイルを追加**（`packages/core/src/profile.ts`）。
  v4準拠に、shape推奨、trip_headsign、feed期限切れ/期限間近、問い合わせ先、
  前版比較による公開ID大量変更の警告を重ねる。
- **Web UIのzip出力を `gtfs-jp-v4` プロファイル経由に変更**。
  取込保持したlegacyファイルや空の任意ファイルを公開用zipに混ぜない。

### テスト

- `test/validator-v4.test.ts` と `test/google-transit-ready.test.ts` を追加。
  コア全体で 49 → 56 件。

## Unreleased — 出力プロファイル準拠フィルタ

GTFS-JP v4 ネイティブ出力と v3 互換保持を分離した。内部モデルはロスレスに保持しつつ、
公開用出力ではプロファイルに沿って不要なファイルを落とせる。

### 追加

- **`applyExportProfile` を追加**（`packages/core/src/export-profile.ts`）。
  `gtfs-jp-v4` / `gtfs-base` 出力では legacy `*_jp.txt` を除外し、
  `gtfs-jp-v3-legacy` では保持する。
- **空の任意ファイル省略**を追加。プロファイル上必須の空ファイルは残し、
  検証側で `empty_required_file` として扱えるようにした。
- **`exportToFiles` / `exportToZip` に `profileId` オプションを追加**。
  既存呼び出しはそのまま全テーブル出力、プロファイル指定時だけフィルタを適用する。

### テスト

- `test/export-profile.test.ts`（5件）を追加。コア全体で 44 → 49 件。

## Unreleased — Shift_JIS 取込（文字コード自動判定）

旧・西沢ツールや v3 系の実フィードに残る Shift_JIS を取り込めるようにした
（仕様 02 章 F-2-5 / 非機能「文字コード UTF-8・Shift_JIS 受入」）。v3 変換の前段として実務上必須。

### 追加

- **文字コード自動判定**（`packages/core/src/encoding.ts`、新規 `decodeText`）。
  UTF-8 BOM → UTF-8、UTF-8 厳格デコード成功 → UTF-8、失敗 → Shift_JIS の順で判定し、
  内部・出力は常に UTF-8 へ正規化する。依存追加なし（`TextDecoder` のみ。ブラウザ/Node 両対応）。
- **`importGtfsZip` / `importEntries` に `encoding` オプション**を追加（明示指定可。既定は自動判定）。
  Shift_JIS と判定したファイルは取込警告に記録する。

### テスト

- `test/encoding.test.ts`（6件）を追加。SJIS の `stops.txt` 取込で日本語が復元されることを確認。
  コア全体で 38 → 44 件。

## Unreleased — 検証ルールの拡充とv3→v4移行のロスレス化

仕様書 06.5（層2 代表ルール）・10.4（主要フィールド要件）に列挙済みだが
未実装だった検証を追加し、移行のデータ欠落バグを修正した。

### 修正（バグ）

- **v3→v4移行で translations の列が欠落する問題を修正**
  （`packages/core/src/migration.ts`）。
  読み仮名（`ja-Hrkt`）を追記する際に固定5列で上書きしていたため、既存の
  `field_value` / `record_sub_id` / 英語翻訳などの列が出力時に失われていた。
  既存列との和集合を保持するように修正。
- **stop_times の単調性チェックを停車時間考慮に厳密化**
  （`packages/core/src/validator.ts`）。次停留所の到着時刻の下限を「直前停留所の
  到着」ではなく「直前停留所の発車」とした。停車中に時間が戻る入力を検出できる。

### 追加（検証ルール・層2）

- **カレンダー検証**（`checkCalendar`）
  - `service_empty`: 全曜日0かつ `calendar_dates` の追加日（`exception_type=1`）も
    ない service_id をerror（仕様 6.5）。
  - `invalid_date_format`: `calendar` / `calendar_dates` / `feed_info` の日付が
    `YYYYMMDD` でない場合をerror。
  - `calendar_end_before_start`: `end_date < start_date` をerror。
  - `invalid_calendar_day_flag`: 曜日フラグが 0/1 以外の場合をerror。
  - `invalid_exception_type`: `exception_type` が 1/2 以外の場合をerror。
- **`duplicate_stop_sequence`**: trip 内で `stop_sequence` が重複した場合をerror
  （仕様 10.4「trip内で単調増加・一意」）。
- **`missing_recommended_file`**: プロファイルの `presence:"recommended"`（v4の
  `attributions` / `transfers` 等）が欠落している場合をwarning。これまで
  プロファイルの推奨メタデータは検証で未使用だった。

### 追加（決定性）

- **`migrateToGtfsJpV4` に `referenceDate` オプション**を追加
  （`packages/core/src/migration.ts`）。`calendar` から `feed_info` の日付を
  導けない場合のフォールバックを実行時刻ではなく明示指定でき、出力を決定的にできる
  （仕様 6.4「生成は決定的」）。CLI も `--reference-date YYYYMMDD` に対応。

### テスト

- `test/calendar.test.ts`（7件）、`test/validator-extra.test.ts`（4件）、
  `test/migration.test.ts`（4件）を追加。コア全体で 23 → 38 件。

### 次の候補（未着手）

- 標準バリデータ連携（仕様 10.7）と実データ検収（仕様 10.9 / 11章）。
- プロファイル定義の JSON 外部化（仕様 10.11）と仕様ロック保存API（仕様 10.2）。
- 公開ゲートのWeb表示（blocker一覧・標準validator実行結果の取り込み）。
