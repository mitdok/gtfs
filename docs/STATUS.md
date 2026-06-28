# 実装ステータス（仕様 ⇄ 実装の対応表）

仕様書（[`docs/spec/`](./spec/README.md)）に対して、`packages/core` の実装が
どこまで到達しているかを一覧化する。変更履歴の詳細は [`../CHANGELOG.md`](../CHANGELOG.md) を参照。

- 最終更新: 2026-06-16
- 対象コミット: 本ファイルと同一リビジョン
- コア・テスト: 94 件 pass（`pnpm --filter @gtfs-studio/core test`）
- API・テスト: 16 件 pass（`pnpm --filter @gtfs-studio/api test`）

## 1. パイプライン全体

| 段階 | 実装 | 状態 | 主担当ファイル |
|------|------|------|----------------|
| 取込（zip → 内部モデル） | `importGtfsZip` / `importEntries` | ✅ | `src/importer.ts`, `src/csv.ts` |
| 文字コード判定（UTF-8 / Shift_JIS） | `decodeText` | ✅ | `src/encoding.ts` |
| v3 → v4 移行 | `migrateToGtfsJpV4` | ✅ MVP範囲 | `src/migration.ts` |
| 検証 | `validateFeed` | ✅ 層1＋層2一部 | `src/validator.ts`, `src/profile.ts` |
| 出力（内部モデル → zip） | `exportGtfsZip` | ✅ 基本 | `src/exporter.ts` |
| 出力プロファイル準拠フィルタ | `applyExportProfile` / `ExportOptions.profileId` | ✅ | `src/export-profile.ts`, `src/exporter.ts` |
| 公開可否ゲート | `evaluateReleaseGate` ＋ Web表示 | ✅ 判定＋公開ゲートタブ | `src/release-gate.ts`, `web/components/ReleaseGateView.tsx` |
| 検収（A-01〜A-10） | `evaluateAcceptance` ＋ Web表示 | ✅ 11.5判定器＋公開ゲートに併載 | `src/acceptance.ts`, `web/components/ReleaseGateView.tsx` |
| 検収パイプライン・CLI | `runAcceptancePipeline` / `gtfs-acceptance` | ✅ 11.4 検収コマンド | `src/pipeline.ts`, `bin/gtfs-acceptance.mjs` |
| 新規GTFS-JP v4作成 | `createGtfsJpV4StarterFeed` ＋ Web画面 | ✅ 最小v4生成＋路線/停留所/便追加MVP | `src/starter-feed.ts`, `web/components/NewFeedView.tsx`, `web/components/StopsView.tsx`, `web/components/TimetableView.tsx` |
| バックエンドAPI（仕様ロック永続化・検収HTTP） | `createApiServer` / `gtfs-api` | ✅ node:http・依存ゼロ | `packages/api/src/server.ts`, `api/bin/gtfs-api.mjs` |
| GTFS-RT ServiceAlerts | `encodeServiceAlertsFeed` | ✅ core builder | `src/realtime.ts` |
| GTFS-RT 外部中継（RT-2） | `createRtRelayService` / `validateRealtimeFeed` | ✅ poll・正規化・鮮度・再配信 | `core/src/realtime-relay.ts`, `api/src/rt-relay.ts` |

## 2. プロファイル（仕様 10.1）

| プロファイル | 正本データ | 状態 |
|--------------|-----------|------|
| `gtfs-base` | `src/profiles/gtfs-base.json` | ✅ |
| `gtfs-jp-v4` | `src/profiles/gtfs-jp-v4.json`（既定） | ✅ 中核要件 |
| `gtfs-jp-v3-legacy` | `gtfs-jp-v3-legacy.json`（`extends: gtfs-base`） | ✅ |
| `google-transit-ready` | `google-transit-ready.json`（`extends: gtfs-jp-v4`） | ✅ MVP公開ゲート |

> プロファイルは **仕様 10.11 の JSON 定義（`src/profiles/*.json`）を正本**とし、
> `profile.ts` が版（`profile_version`）・採用ロック（`source_locks`）・根拠仕様
> （`source/source_ref`）・追加ルール（`extra_rules`）を保持したまま読み込み、
> 実行時の最小 `Profile` を導出する（`getProfileDefinition` / `toProfile`）。
> 仕様改定は JSON 差し替えで追従できる。

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
| GTFS-JP v4 条件付き | `forbidden_v4_fixed_route_field`, `forbidden_v4_network_file`, `missing_trip_shape_id`, `invalid_shape_pt_lat`, `invalid_shape_pt_lon`, `duplicate_shape_pt_sequence`, `missing_translation_record_key`, `invalid_fare_payment_method`, `invalid_fare_transfers`, `missing_attribution_role`, `missing_transfer_endpoint`, `invalid_transfer_type` |
| 型・値形式 | `invalid_url`, `invalid_timezone`, `invalid_language`, `invalid_integer`, `invalid_latitude`, `invalid_longitude`, `invalid_enum`, `invalid_color` |
| feed_info | `feed_info_date_range` |
| Google公開ゲート | `missing_shape_recommended`, `missing_trip_headsign`, `feed_expired`, `feed_expired_soon`, `unstable_public_ids`, `missing_contact` |

### ⏳ 未実装（残タスク）

仕様ロックのDB永続化・認証、validator実体のCI連携、GTFS-RT RT-2以降。

## 5. 仕様ロック・標準バリデータ連携・検収（仕様 10.2 / 10.7 / 10.9 / 10.10 / 11章）

| 項目 | 状態 | 主担当 |
|------|------|--------|
| core内の仕様ロック定義・公開可否判定 | ✅ MVP | `src/spec-lock.ts`, `src/release-gate.ts` |
| MobilityData Validator レポート取込（10.7 step3） | ✅ `report.json` 取込・集計 | `src/standard-validator.ts` |
| validator結果からの `VALIDATOR_LOCK` 生成（11.2） | ✅ | `src/standard-validator.ts` |
| 実データ検収 A-01〜A-10（11.1/11.5） | ✅ 判定器 | `src/acceptance.ts` |
| プロファイル定義の外部データ化（10.11） | ✅ `src/profiles/*.json` 正本化 | `src/profile.ts`, `src/profile-schema.ts` |
| 仕様ロックの保存・取得ストア（10.2） | ✅ インメモリ | `src/spec-lock.ts`（`createSpecLockStore`） |
| 検収パイプライン（10.7順 / 11.4） | ✅ `runAcceptancePipeline` | `src/pipeline.ts` |
| 検収CLI（11.4 検収コマンド） | ✅ `gtfs-acceptance`（report取込・Java起動・回帰証跡） | `bin/gtfs-acceptance.mjs` |
| 仕様ロックの永続化（ファイル）・HTTP公開（10.2） | ✅ `packages/api` | `api/src/spec-lock-repository.ts`, `api/src/server.ts` |
| 検収のHTTP実行（11.4） | ✅ `POST /acceptance` | `api/src/server.ts` |
| 仕様ロックのDB永続化・認証 | ⏳ 未実装（将来） | — |

> validator の実行（Java実体）はコア本体では行わず、CLI（`gtfs-acceptance --validator-jar`）が
> 起動するか、別途実行した `report.json` を `--report` で取り込む。判定は `runAcceptancePipeline` に集約。

## 6. 次の優先タスク（CHANGELOG「次の候補」と同期）

GTFS-JP v4対応の詳細ロードマップと進捗率は
[`GTFS_JP_V4_ROADMAP.md`](./GTFS_JP_V4_ROADMAP.md) に集約する。

1. ~~標準バリデータ連携（10.7）と実データ検収（10.9 / 11章）~~ … ✅ 完了（`standard-validator.ts` / `acceptance.ts`）。
2. ~~プロファイル定義の JSON 外部化（10.11）と仕様ロック保存（10.2）~~ … ✅ 完了（`src/profiles/*.json` / `createSpecLockStore`）。
3. ~~公開ゲートのWeb表示~~ … ✅ 完了（`web/components/ReleaseGateView.tsx`、公開ゲートタブ）。
4. ~~検収パイプライン・CLI（11.4）／検収レポートのWeb表示~~ … ✅ 完了（`pipeline.ts` / `bin/gtfs-acceptance.mjs` / 公開ゲートにA-01〜A-10併載）。
5. ~~仕様ロックの永続化・API層~~ … ✅ 完了（`packages/api`：node:http・依存ゼロ、ファイル永続化＋`POST /acceptance`）。
6. （以降）仕様ロックの**DB永続化・認証**、validator実体のCI連携、GTFS-RT RT-2以降。

## 7. GTFS-RT対応

GTFS-RTはフェーズ2以降の対象。ロードマップ、課題、達成管理は
[`GTFS_RT_ROADMAP.md`](./GTFS_RT_ROADMAP.md) に集約する。

| フェーズ | 状態 | 内容 |
|----------|------|------|
| RT-0 | ✅ 着手 | 公式参照確認、ロードマップ・課題・達成管理表の整備 |
| RT-1 | ⏳ core store＋Web pb出力完了 | ServiceAlerts手動投入＋protobuf配信（`src/realtime.ts`, `RealtimeAlertsView.tsx`） |
| RT-2 | ✅ core relay＋api poller/配信 | 外部GTFS-RT中継・正規化（`realtime-relay.ts`, `api/rt-relay.ts`） |
| RT-3 | ⏳ 未着手 | VehiclePositions取込・配信 |
| RT-4 | ⏳ 未着手 | TripUpdates生成・静的GTFS突合 |
| RT-5 | ⏳ 未着手 | 鮮度SLO、監視、公開URL検証 |

> 凡例: ✅ 実装済 / ⏳ 未実装・予定。
