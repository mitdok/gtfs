# Changelog

GTFS Studio（西沢ツールWEB版）の段階的実装の記録。仕様書（`docs/spec/`）に追従し、
`packages/core` の取込・検証・移行・出力を一歩ずつ確実にしていく。

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

- `google-transit-ready` プロファイル（仕様 10.6: `feed_expired` / `missing_shape_recommended`
  / 安定ID変化検知など）。
- Shift_JIS 取込（旧・西沢ツール/v3 CSV 由来フィードの文字コード対応、`importer.ts`）。
- 出力時のプロファイル準拠フィルタ（v4出力でのv3拡張ファイル除外、空任意ファイルの省略）。
