# Changelog

GTFS Studio（西沢ツールWEB版）の段階的実装の記録。仕様書（`docs/spec/`）に追従し、
`packages/core` の取込・検証・移行・出力を一歩ずつ確実にしていく。

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
