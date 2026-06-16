# 実装ステータス（仕様 ⇄ 実装の対応表）

仕様書（[`docs/spec/`](./spec/README.md)）に対して、`packages/core` の実装が
どこまで到達しているかを一覧化する。変更履歴の詳細は [`../CHANGELOG.md`](../CHANGELOG.md) を参照。

- 最終更新: 2026-06-16
- 対象コミット: 本ファイルと同一リビジョン
- コア・テスト: 44 件 pass（`pnpm --filter @gtfs-studio/core test`）

## 1. パイプライン全体

| 段階 | 実装 | 状態 | 主担当ファイル |
|------|------|------|----------------|
| 取込（zip → 内部モデル） | `importGtfsZip` / `importEntries` | ✅ | `src/importer.ts`, `src/csv.ts` |
| 文字コード判定（UTF-8 / Shift_JIS） | `decodeText` | ✅ | `src/encoding.ts` |
| v3 → v4 移行 | `migrateToGtfsJpV4` | ✅ MVP範囲 | `src/migration.ts` |
| 検証 | `validateFeed` | ✅ 層1＋層2一部 | `src/validator.ts`, `src/profile.ts` |
| 出力（内部モデル → zip） | `exportGtfsZip` | ✅ 基本 | `src/exporter.ts` |
| 出力プロファイル準拠フィルタ | — | ⏳ 未実装 | （次タスク） |

## 2. プロファイル（仕様 10.1）

| プロファイル | 定義 | 状態 |
|--------------|------|------|
| `gtfs-base` | `GTFS_BASE` | ✅ |
| `gtfs-jp-v4` | `GTFS_JP_V4`（既定） | ✅ 中核要件 |
| `gtfs-jp-v3-legacy` | `GTFS_JP_V3_LEGACY` | ✅（base派生） |
| `google-transit-ready` | — | ⏳ 未実装（10.6） |

> プロファイルは現状 `src/profile.ts` の TypeScript 定数。仕様 10.11 の
> `profiles/*.json`（版・ロックID・source_ref 付き）への外部データ化は未着手。

## 3. v3 → v4 移行の正規化（仕様 10.5 / `migration.ts`）

| 正規化 | 内容 | 警告コード |
|--------|------|------------|
| legacy `*_jp.txt` 除外 | `agency_jp`/`office_jp`/`pattern_jp`/`routes_jp` を v4候補から除外 | `dropped_legacy_jp_file` |
| agency 補完 | `agency_id` 空欄補完、`agency_lang=ja` | `filled_agency_id` |
| stops 正規化 | `location_type=0` 補完、`stop_name` 欠落検出 | `missing_stop_name` |
| routes 補完 | 単一agency時に `agency_id` 補完 | `filled_route_agency_id` |
| feed_info 生成 | calendar/agency から最小行を生成（`referenceDate` で決定的化） | `created_feed_info` |
| fare_attributes 生成 | 無償交通の最小運賃を生成 | `created_free_fare` |
| translations 補完 | `ja-Hrkt` 読み仮名を補完（既存列を保持・ロスレス） | `fallback_stop_kana` ほか |

## 4. 検証ルール（仕様 10.3 / 10.4 / 10.6）

### 層1：構造・必須・参照整合

`missing_required_file` / `empty_required_file` / `missing_service_file` /
`missing_recommended_file` / `missing_required_field` / `empty_required_value` /
`duplicate_id` / `dangling_reference` / `missing_route_name` /
`invalid_stop_lat` / `invalid_stop_lon`

### 層2：意味的ルール

| 領域 | ルールコード |
|------|--------------|
| stop_times | `invalid_time_format`, `duplicate_stop_sequence`, `departure_before_arrival`, `stop_time_decreasing`（停車時間考慮） |
| calendar | `invalid_date_format`, `calendar_end_before_start`, `invalid_calendar_day_flag`, `service_empty`, `invalid_exception_type` |
| GTFS-JP | `legacy_jp_file`, `missing_stop_name_kana`, `invalid_fare_price`, `non_jpy_fare_currency` |
| feed_info | `feed_info_date_range` |

### ⏳ 未実装（`google-transit-ready` 公開ゲート 10.6）

`missing_shape_recommended` / `missing_trip_headsign` / `feed_expired` /
`feed_expired_soon` / `unstable_public_ids` / `missing_contact`

## 5. 仕様ロック・標準バリデータ連携（仕様 10.2 / 10.7 / 10.10）

| 項目 | 状態 |
|------|------|
| 仕様ロック（`GTFS_JP_V4_LOCK` 等）の保存・API公開 | ⏳ 未実装 |
| MobilityData Canonical Validator 連携（10.7 step3） | ⏳ 未実装 |
| プロファイル定義の外部データ化（10.11） | ⏳ 未実装 |

## 6. 次の優先タスク（CHANGELOG「次の候補」と同期）

1. **出力プロファイル準拠フィルタ**：v4出力で v3拡張ファイルを除外、空の任意ファイルを省略。
2. **`google-transit-ready` プロファイル**：4節の未実装公開ゲートを追加。
3. **プロファイル定義の JSON 外部化**（10.11）と**仕様ロック保存**（10.2）。
4. **標準バリデータ連携**（10.7）と**実データ検収**（10.9 / 11章）。

> 凡例: ✅ 実装済 / ⏳ 未実装・予定。
