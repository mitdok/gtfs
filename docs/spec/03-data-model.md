# 03. データモデル

## 3.1 設計方針

本サービスの内部モデルは、GTFSのファイル構造をそのまま持つのではなく、**編集しやすく整合性を保ちやすい正規化モデル**を一次データとし、出力時にGTFS-JPへ機械的に射影する。中核は次の3層。

```
事業者(Agency) ─< 経路(Route) ─< 系統パターン(Pattern) ─< 便(Trip) ─< 通過時刻(StopTime)
                                          │                    │
              停留所(Stop) >── パターン停留所(PatternStop)      運行区分(Service)
```

### なぜ「系統パターン（Pattern）」を一次データにするか

GTFSの `stop_times.txt` は「便×停留所」で爆発的に行が増える。しかし実務上、ダイヤの大半は **同じ停留所の並び（パターン）を共有する複数便** で構成される（西沢ツールのダイヤ表 1枚＝1パターン に相当）。

そこで、

- 停留所の並び・停留所間距離・shape はパターンが保持し、
- 便は「どのパターンか」＋「先頭通過時刻」＋「停留所ごとのオフセット（基本はパターン既定値）」

として保持する。これにより、

- 入力が西沢ツールのダイヤ表に一致する（縦=パターンの停留所、横=便の先頭時刻）。
- 停留所の追加/順序変更がパターン単位で一括反映できる。
- 出力時に `便 × PatternStop` を展開して `stop_times.txt` を生成する。

便ごとに時刻を個別調整したい場合は StopTime レベルで上書きを許容する（ハイブリッド）。

## 3.2 概念ER図

```
Organization 1───* Project
Project      1───* FeedRevision        （版/公開スナップショット）
Project      1───* Agency
Project      1───* Stop                （親子: parent_station による自己参照）
Project      1───* Route
Project      1───* Service             （運行区分）
Project      1───* FareAttribute 1──* FareRule
Project      1───* Office              （営業所 office_jp）
Project      1───1 FeedInfo
Agency       1───* Route
Route        1───* Pattern
Pattern      1───* PatternStop *───1 Stop
Pattern      1───1 Shape (任意)        Shape 1──* ShapePoint
Pattern      1───* Trip
Trip         *───1 Service
Trip         1───* StopTime  *───1 Stop     （StopTimeは出力派生 or 上書き保持）
Any entity   1───* Translation         （翻訳: テーブル名+キー+項目名+言語）
```

## 3.3 共通設計

- 主キーは内部用の `id`（UUID/BIGINT）とし、GTFS出力で使う `*_id`（agency_id, stop_id 等）は別カラム `gtfs_id` として保持。`gtfs_id` はプロジェクト内一意。ユーザー指定がなければ自動採番。
- すべての主要テーブルに `project_id`、`created_at`/`updated_at`/`updated_by` を持つ（マルチテナント分離）。
- 論理削除（`deleted_at`）を基本とする。
- 緯度経度は十進度（DECIMAL(9,6)）。
- 時刻は「サービス日からの経過秒」を内部表現に持ち、入力/表示は `HH:MM:SS`（24時超対応）。

## 3.4 論理テーブル定義

凡例: `PK`=主キー, `FK`=外部キー, `U`=ユニーク, `N`=NULL許可, `*`=GTFS出力に直接対応

### organizations（組織/テナント）
| カラム | 型 | 制約 | 説明 |
|--------|----|------|------|
| id | UUID | PK | |
| name | text | | 組織名 |
| slug | text | U | URL用識別子 |
| plan | text | | 料金プラン等 |

### users / memberships
標準的な認証・所属モデル（OIDC対応）。`memberships(user_id, organization_id, role)` でロールを保持。プロジェクト単位の上書きは `project_members(project_id, user_id, role)`。

### projects（プロジェクト=フィード編集単位）
| カラム | 型 | 制約 | 説明 |
|--------|----|------|------|
| id | UUID | PK | |
| organization_id | UUID | FK | |
| name | text | | 表示名 |
| feed_slug | text | U(org内) | 公開URLに使う識別子 |
| default_lang | text | | 既定言語（例: ja） |
| gtfs_profile | text | | 出力プロファイル（gtfs-jp-v4 / gtfs-jp-v3 / gtfs-base 等） |
| license | text | N | 推奨ライセンス（CC-BY等） |
| status | text | | active/archived |

### feed_revisions（版/公開スナップショット）
| カラム | 型 | 制約 | 説明 |
|--------|----|------|------|
| id | UUID | PK | |
| project_id | UUID | FK | |
| version | int | U(project内) | 版番号（連番） |
| status | text | | draft/validated/published/superseded |
| effective_date | date | N | 施行日（予約公開） |
| comment | text | N | 版コメント |
| snapshot | jsonb / blob ref | | 確定時の全データスナップショット参照 |
| artifact_url | text | N | 生成済 gtfs.zip の保存先 |
| validation_summary | jsonb | N | 検証結果サマリ |
| published_at | timestamptz | N | |
| created_by | UUID | FK | |

> 編集中の「作業データ」は後述の各マスタ/ダイヤテーブル（ライブ状態）。`feed_revisions` は確定済スナップショットを表す。実装上はライブ編集テーブル＋確定時スナップショットの二層構成とする（[08-tech-roadmap](./08-tech-roadmap.md) 参照）。

### agencies *（agency.txt / agency_jp.txt）
| カラム | 型 | 制約 | 説明 |
|--------|----|------|------|
| id | UUID | PK | |
| project_id | UUID | FK | |
| gtfs_id | text | U(project内) | agency_id |
| name | text | | agency_name |
| url | text | | agency_url |
| timezone | text | | agency_timezone（既定 Asia/Tokyo） |
| lang | text | N | agency_lang |
| phone | text | N | agency_phone |
| fare_url | text | N | |
| email | text | N | |
| // 以下 agency_jp 拡張 | | | |
| official_name | text | N | 正式名称 |
| zip_number | text | N | 郵便番号 |
| address | text | N | 住所 |
| president_pos | text | N | 代表者肩書 |
| president_name | text | N | 代表者名 |

### stops *（stops.txt / 親子で標柱・停留所）
| カラム | 型 | 制約 | 説明 |
|--------|----|------|------|
| id | UUID | PK | |
| project_id | UUID | FK | |
| gtfs_id | text | U(project内) | stop_id |
| code | text | N | stop_code（停留所番号） |
| name | text | | stop_name |
| name_kana | text | N | 読み（translationsへ展開） |
| desc | text | N | stop_desc |
| lat | decimal(9,6) | | stop_lat |
| lon | decimal(9,6) | | stop_lon |
| zone_id | text | N | 運賃ゾーン |
| location_type | int | | 0=標柱/停留所, 1=駅, 等 |
| parent_station | UUID | FK,N | 親停留所（自己参照） |
| platform_code | text | N | のりば番号 |
| wheelchair_boarding | int | N | |

### routes *（routes.txt / routes_jp.txt）
| カラム | 型 | 制約 | 説明 |
|--------|----|------|------|
| id | UUID | PK | |
| project_id | UUID | FK | |
| gtfs_id | text | U(project内) | route_id |
| agency_id | UUID | FK | |
| short_name | text | N | route_short_name |
| long_name | text | N | route_long_name |
| desc | text | N | |
| type | int | | route_type（バス=3 等） |
| color | text | N | route_color |
| text_color | text | N | |
| sort_order | int | N | |
| // routes_jp 拡張 | | | |
| update_date | date | N | ダイヤ改正日 |
| origin_stop | text | N | 起点 |
| via | text | N | 経過地 |
| destination_stop | text | N | 終点 |

### patterns（系統パターン：本サービス固有）
| カラム | 型 | 制約 | 説明 |
|--------|----|------|------|
| id | UUID | PK | |
| project_id | UUID | FK | |
| route_id | UUID | FK | |
| name | text | | パターン名（例: A系統 上り） |
| direction_id | int | N | 0/1（上り/下り） |
| headsign | text | N | 既定の行先（trip_headsign 既定値） |
| shape_id | UUID | FK,N | 紐づくshape |

### pattern_stops（パターン内の停留所列：stop_timesの骨格）
| カラム | 型 | 制約 | 説明 |
|--------|----|------|------|
| id | UUID | PK | |
| pattern_id | UUID | FK | |
| stop_id | UUID | FK | |
| sequence | int | | 並び順（stop_sequence） |
| default_offset_sec | int | | 先頭からの既定所要秒（便展開の基準） |
| shape_dist_traveled | decimal | N | 起点からの距離 |
| pickup_type | int | N | 乗車区分 |
| drop_off_type | int | N | 降車区分 |
| timepoint | int | N | 1=正確な時刻 |
| U(pattern_id, sequence) | | | |

### services（運行区分：calendar.txt / calendar_dates.txt）
| カラム | 型 | 制約 | 説明 |
|--------|----|------|------|
| id | UUID | PK | |
| project_id | UUID | FK | |
| gtfs_id | text | U(project内) | service_id |
| name | text | N | 表示名（平日/土日祝 等） |
| mon..sun | bool | | 曜日フラグ |
| start_date | date | | |
| end_date | date | | |

### service_exceptions（calendar_dates.txt）
| カラム | 型 | 制約 | 説明 |
|--------|----|------|------|
| id | UUID | PK | |
| service_id | UUID | FK | |
| date | date | | |
| exception_type | int | | 1=運行追加, 2=運休 |

### trips *（trips.txt）
| カラム | 型 | 制約 | 説明 |
|--------|----|------|------|
| id | UUID | PK | |
| project_id | UUID | FK | |
| gtfs_id | text | U(project内) | trip_id |
| pattern_id | UUID | FK | 所属パターン（route/shape/direction はここから導出） |
| service_id | UUID | FK | |
| headsign | text | N | trip_headsign（未指定ならpattern既定） |
| short_name | text | N | |
| block_id | text | N | 続行運用 |
| start_time_sec | int | | 先頭停留所の発車時刻（秒） |
| wheelchair_accessible | int | N | |
| bikes_allowed | int | N | |
| office_id | UUID | FK,N | 担当営業所（office_jp） |

> `start_time_sec` と pattern_stops の offset から各停留所時刻を導出する。便単位の微調整は次の stop_time_overrides で吸収。

### stop_time_overrides（便ごとの時刻上書き：任意）
| カラム | 型 | 制約 | 説明 |
|--------|----|------|------|
| trip_id | UUID | FK | |
| pattern_stop_id | UUID | FK | |
| arrival_sec | int | N | 上書き到着 |
| departure_sec | int | N | 上書き発車 |
| pickup_type | int | N | 上書き |
| drop_off_type | int | N | 上書き |
| PK(trip_id, pattern_stop_id) | | | |

### fare_attributes *, fare_rules *
GTFSの `fare_attributes.txt` / `fare_rules.txt` に準拠（price, currency, payment_method, transfers, route_id, origin_id, destination_id, contains_id 等）。

### shapes *（shapes.txt）
`shapes(id, project_id, gtfs_id)` ＋ `shape_points(shape_id, sequence, lat, lon, dist_traveled)`。

### offices（office_jp.txt）
`offices(id, project_id, gtfs_id, name, url, phone)`。

### feed_info *（feed_info.txt）
`feed_info(project_id, publisher_name, publisher_url, lang, start_date, end_date, version, contact_email, contact_url)`。

### translations *（translations.txt）
| カラム | 型 | 説明 |
|--------|----|------|
| project_id | UUID | |
| table_name | text | 対象テーブル（stops/routes/agency 等） |
| field_name | text | 対象項目（stop_name 等） |
| language | text | 言語コード（ja-Hrkt=読み, en 等） |
| record_id | text | 対象レコードの gtfs_id（または field_value 方式） |
| translation | text | 翻訳/読み |

> 停留所名の読み仮名は `language=ja-Hrkt` の translation として出力する（GTFS-JP慣行）。

### frequencies（任意 / frequencies.txt）
`frequencies(trip_id, start_time_sec, end_time_sec, headway_secs, exact_times)`。

### transfers（任意 / transfers.txt）
`transfers(from_stop_id, to_stop_id, transfer_type, min_transfer_time)`。

## 3.5 GTFS-RT 関連（フェーズ2、概要）

詳細は [07-realtime](./07-realtime.md)。主なテーブル:

- `rt_sources`: リアルタイム入力ソース定義（種別、接続情報、認証）。
- `rt_vehicle_positions`: 直近の車両位置（時系列、保持期間付き）。
- `rt_trip_updates`: 遅延・時刻変更（突合済 trip_id 参照）。
- `rt_alerts`: 運行アラート（手動投入/外部取込、影響範囲＝route/stop/trip）。

## 3.6 整合性制約（DB/アプリ両面）

- `pattern_stops.sequence` はパターン内で連続・一意。
- `trips.pattern_id` の route と `routes.agency_id` の整合。
- `services.end_date >= start_date`。
- `stops.parent_station` は循環不可、親は `location_type=1`。
- `gtfs_id` はテーブル種別ごとにプロジェクト内一意。
- 時刻は単調非減少（便内で stop_sequence 昇順に時刻が戻らない）。
