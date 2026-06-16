# 07. GTFS-RT（リアルタイム）配信設計

> 本機能は **フェーズ2以降**。静的GTFS-JPの安定運用を前提に段階導入する。本サービス単体ではリアルタイム情報を「生成」せず、外部ソース（車載器・運行管理システム・自治体ロケーションシステム）からの入力を取り込み、GTFS-RTとして整形・配信する。

## 7.1 GTFS-RTの3フィード

| フィード | エンティティ | 用途 |
|----------|--------------|------|
| TripUpdate | 遅延・通過時刻の予測/実績、運休、経路変更 | 「あと何分で来る」 |
| VehiclePosition | 車両の現在位置・進行状況 | 地図上の現在地表示 |
| Alert | 運休・遅延・経路変更・停留所閉鎖の告知 | 運行情報の文章告知 |

形式は Protocol Buffers（`gtfs-realtime.proto`）。HTTPで `.pb` を定期配信し、利用者がポーリング取得する。

## 7.2 入力ソース（rt_sources）

| 種別 | 例 | 取込方式 |
|------|----|----------|
| 位置情報プッシュ | 車載GPS端末/スマホアプリがJSONをPOST | `POST /projects/{p}/rt/ingest`（認証付） |
| 外部GTFS-RT中継 | 既存ロケーションシステムが出すRTフィード | 本サービスがポーリング取得し再配信/正規化 |
| 運行管理API | 事業者の運行管理システムのWeb API | アダプタでポーリング |
| 手動Alert | 運行情報の手入力 | `POST /projects/{p}/rt/alerts` / 画面S-15 |

ソース定義 `rt_sources`: `id, project_id, type, endpoint, auth, poll_interval, mapping_config`。

## 7.3 静的データとの突合（マッチング）

GTFS-RTは静的GTFSの `trip_id` / `stop_id` / `route_id` を参照する。入力が車両位置のみの場合でも、次で静的データに紐付ける。

- **trip特定**: 入力の系統・行先・運用番号（block_id）・時刻から、当該サービス日の候補 `trip` を推定。
- **stop特定**: 位置から最近傍 `stop` / 次停留所を推定。
- **遅延算出**: 予定時刻（stop_times）と実績/予測の差分 → TripUpdate の delay。
- マッチング規則は `mapping_config` で事業者ごとに調整可能とする。

## 7.4 配信

| パス | 内容 | 更新頻度（目安） |
|------|------|------------------|
| `GET /rt/{org}/{feed}/trip-updates.pb` | TripUpdate | 10〜30秒 |
| `GET /rt/{org}/{feed}/vehicle-positions.pb` | VehiclePosition | 5〜15秒 |
| `GET /rt/{org}/{feed}/alerts.pb` | Alert | 変更時/数十秒 |

- 各エンティティに `timestamp` を付与。古いデータは保持期間で破棄。
- ヘッダの `FeedHeader.gtfs_realtime_version` は **2.0**、`incrementality=FULL_DATASET` を基本とする。
- **schedule_relationship は最新仕様に追従**: 臨時便の表現に旧 `ADDED` は使わない（仕様上廃止の方向で、`NEW` / `REPLACEMENT` / `DUPLICATED` への移行が進行中）。本サービスは新しい値で出力し、外部RT中継（2-b）で旧値を受けた場合は正規化する。
- 混雑度（`OccupancyStatus`）は入力ソースが提供する場合に任意で配信する。
- 配信前段にキャッシュ（短TTL）。アプリは生成、配信はエッジ、を分離。
- デバッグ用にJSON版（`?format=json`）を提供。

## 7.5 データ保持・性能
- `rt_vehicle_positions` 等はホットストア（インメモリ/Redis等）で直近のみ保持、長期は集計のみ。
- 1フィードあたり車両数十〜数百規模を想定。水平スケール可能な配信層。

## 7.6 運用上の留意
- 静的GTFSと整合しないRT（存在しないtrip_id等）は配信しない/警告。
- 静的データのダイヤ改正公開と、RTのtrip_id体系の整合を版切替時に検証。
- Alertは多言語（translated_string）に対応。
- セキュリティ: ingestエンドポイントはソース単位のトークン認証・レート制限。

## 7.7 フェーズ方針
- **2-a**: Alertの手動投入＋配信（最小構成。事業者が運休告知をすぐ出せる価値）。
- **2-b**: 外部GTFS-RT中継・正規化配信。
- **2-c**: 位置情報プッシュからのTripUpdate/VehiclePosition自動生成（突合エンジン）。
