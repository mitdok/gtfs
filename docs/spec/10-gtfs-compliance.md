# 10. GTFS準拠プロファイル・要件表

本章は、GTFS/GTFS-JPとして「何を満たせば公開可能か」を実装可能な判定ルールとして定義する。01〜09章がプロダクト全体の仕様であるのに対し、本章は出力・検証・公開ゲートの根拠表とする。

## 10.1 プロファイルの考え方

GTFS公式仕様、GTFS-JP仕様、Google Maps等の受入基準は重なるが同一ではない。本サービスでは次のプロファイルを分けて扱う。

| プロファイル | 目的 | 公開ゲート | 備考 |
|--------------|------|------------|------|
| `gtfs-base` | 国際標準GTFS Scheduleの最小準拠 | 公式GTFSのRequired/Conditionally Requiredをerror | 海外ツール検証・基本互換用 |
| `gtfs-jp-v4` | GTFS-JP v4ネイティブ出力 | `gtfs-base` + GTFS-JP v4の追加要件をerror/warning | 既定プロファイル。v4仕様表の取り込みを必須とする |
| `gtfs-jp-v3-legacy` | 旧標準的なバス情報フォーマット互換 | v3拡張ファイル・項目を保持/出力 | 既存データ移行・再出力用。新規作成の既定にはしない |
| `google-transit-ready` | Google Maps申請向け品質ゲート | Google受入上の実務必須をerror、推奨をwarning | GTFS公式要件とは分離して管理する |

## 10.2 根拠仕様

| 種別 | 根拠 | 本仕様での扱い |
|------|------|----------------|
| GTFS Schedule | General Transit Feed Specification Schedule Reference（2026-04-27改訂版を2026-06-12確認） | `gtfs-base`の正本 |
| GTFS-JP | 国土交通省 公共交通運行情報標準データ仕様（GTFS-JP）第4.0版（令和8年3月19日） | `gtfs-jp-v4`の正本 |
| Google向け品質 | Google Transit GTFS Schedule Reference and Differences（公式GTFSとの差分・実装差異を扱う資料） | `google-transit-ready`の補助根拠。公式GTFS要件とは混同しない |
| 標準検証 | MobilityData Canonical GTFS Schedule Validator | 公開前の標準準拠検証に必須 |

各ルールには、可能な限り根拠仕様・版・参照箇所をメタデータとして持たせる。実装上は `profiles/*.json` のような設定ファイルに落とし込み、仕様改定時はデータ差し替えで追従できるようにする。

参照URL:

| 対象 | URL |
|------|-----|
| GTFS Schedule Reference | https://gtfs.org/documentation/schedule/reference/ |
| Google Transit GTFS Schedule Reference and Differences | https://developers.google.com/transit/gtfs/reference |
| MobilityData Canonical GTFS Schedule Validator | https://github.com/MobilityData/gtfs-validator |

GTFS-JP v4ロック対象PDF:

| ファイル | 位置づけ | 版・日付 |
|----------|----------|----------|
| `commmmons_doc_007-01_ver01.pdf` | 第1編 仕様編。GTFS Schedule/Realtime日本標準仕様書、ファイル・フィールド定義、必須区分 | 第4.0版、令和8年3月、2026年3月19日作成 |
| `commmmons_doc_007-02_ver01.pdf` | 第2編 技術解説編。配信方法、ライセンス、作成手引き、検証ツール、Flex/Fares V2解説 | 第4.0版、令和8年3月、2026年3月19日作成 |
| `commmmons_doc_007-03_ver01.pdf` | GTFS-JP v3等との差分。v3との差分、ファイル・フィールド必須区分差分、旧拡張ファイルの扱い | 令和8年3月 |

### 仕様ロック

公開可能な実装は、採用する仕様の版をロックし、検証結果に保存しなければならない。ロックされていない仕様を根拠にしたプロファイルでは、公開版を作成できない。

| ロックID | 対象 | 必須メタデータ | 未ロック時の扱い |
|----------|------|----------------|------------------|
| `GTFS_SCHEDULE_LOCK` | GTFS Schedule Reference | URL、改訂日、確認日、取り込みコミット/設定版 | `gtfs-base`公開不可 |
| `GTFS_JP_V4_LOCK` | GTFS-JP 第4.0版公式PDF一式 | 仕様書名、版、PDFファイル名、作成日、確認日、要件表取り込み版 | `gtfs-jp-v4`公開不可 |
| `GOOGLE_TRANSIT_LOCK` | Google Transit差分・受入品質 | URL、確認日、適用する差分ルール版 | `google-transit-ready`公開不可 |
| `VALIDATOR_LOCK` | MobilityData Validator | validator名、バージョン、実行方法、ルールセット版 | 版作成不可 |

仕様ロックの状態はAPIで取得できるようにし、ダッシュボードと検証結果に表示する。

## 10.3 ファイル要件

凡例:
- `R`: 必須。欠落はerror。
- `CR`: 条件付き必須。条件成立時の欠落はerror。
- `CF`: 条件付き禁止。条件成立時に含まれている場合はerror。
- `Rec`: 推奨。欠落はwarning。ただし公開プロファイルによってerrorへ昇格可能。
- `O`: 任意。
- `Legacy`: v3互換・移行用。v4ネイティブでは原則必須にしない。

| ファイル | gtfs-base | gtfs-jp-v4 | gtfs-jp-v3-legacy | google-transit-ready | 条件・扱い |
|----------|-----------|------------|-------------------|----------------------|------------|
| `agency.txt` | R | R | R | R | 事業者情報 |
| `stops.txt` | CR | CR | R | R | Flexのみで全サービスを表現する場合を除き必須。本サービスMVPではR扱い |
| `routes.txt` | R | R | R | R | 経路情報 |
| `trips.txt` | R | R | R | R | 便情報 |
| `stop_times.txt` | R | R | R | R | 通過時刻 |
| `calendar.txt` | CR | CR | CR | CR | `calendar_dates.txt`が全サービス日を定義しない場合に必須 |
| `calendar_dates.txt` | CR | CR | CR | Rec | `calendar.txt`を省略する場合は必須。例外日管理としては推奨 |
| `feed_info.txt` | CR/Rec | R | R | R | GTFS-JP v4ではデータ提供者、版、有効期間等を設定する必須ファイル |
| `translations.txt` | O | R | R | Rec | GTFS-JP v4では読み仮名の設定が必須、英語は推奨 |
| `fare_attributes.txt` | O | R | R | O | GTFS-JP v4では無償交通のみでも作成。本仕様で表現できない複雑運賃のみの場合は不要 |
| `fare_rules.txt` | O | CR | CR | O | 均一運賃以外では必須。本仕様で表現できない複雑運賃のみの場合は不要 |
| `shapes.txt` | O | CR | CR | Rec | フリー乗降等では必須。走行経路が決まっているサービスでは推奨 |
| `attributions.txt` | O | Rec | O | Rec | データ作成者、運行事業者、公的組織等の表示として推奨 |
| `frequencies.txt` | O | O | O | O | 等間隔運行使用時 |
| `transfers.txt` | O | Rec | O | Rec | 乗換可否、乗換所要時間等の明示として推奨 |
| `pathways.txt` | O | O | O | O | Pathways拡張。駅・バスターミナル構内経路を表現する場合 |
| `levels.txt` | CR | CR | O | CR | `pathways.txt`でエレベーター等の階層情報が必要な場合 |
| `location_groups.txt` | O | O | O | O | Flex拡張。Phase 3対象 |
| `location_group_stops.txt` | O | O | O | O | Flex拡張。Phase 3対象 |
| `locations.geojson` | O | O | O | O | Flex拡張。Phase 3対象 |
| `booking_rules.txt` | O | O | O | O | Flex拡張。Phase 3対象 |
| `timeframes.txt` | O | O | O | O | Fares V2拡張。Phase 3対象 |
| `rider_categories.txt` | O | O | O | O | Fares V2拡張。Phase 3対象 |
| `fare_media.txt` | O | O | O | O | Fares V2拡張。Phase 3対象 |
| `fare_products.txt` | O | O | O | O | Fares V2拡張。Phase 3対象 |
| `fare_leg_rules.txt` | O | O | O | O | Fares V2拡張。Phase 3対象 |
| `fare_leg_join_rules.txt` | O | O | O | O | Fares V2拡張。Phase 3対象 |
| `fare_transfer_rules.txt` | O | O | O | O | Fares V2拡張。Phase 3対象 |
| `areas.txt` | O | O | O | O | Fares V2拡張。Phase 3対象 |
| `stop_areas.txt` | O | O | O | O | Fares V2拡張。Phase 3対象 |
| `networks.txt` | O | CF | O | O | `routes.txt`の`network_id`が設定されている場合は禁止、それ以外は任意 |
| `route_networks.txt` | O | CF | O | O | `routes.txt`の`network_id`が設定されている場合は禁止、それ以外は任意 |
| `agency_jp.txt` | - | Legacy/O | Legacy | - | v4ネイティブ必須ではなく、v3互換・取込保持・移行警告用 |
| `routes_jp.txt` | - | Legacy/O | Legacy | - | 同上 |
| `office_jp.txt` | - | Legacy/O | Legacy | - | 同上 |
| `pattern_jp.txt` | - | Legacy/O | Legacy | - | 同上 |

> 注: `CF`は条件付禁止。GTFS-JP v4ではPathways/Flex/Fares V2関連ファイルも本体仕様に含まれるが、MVPの編集・出力対象は固定路線バスの静的Scheduleに限定する。対象外ファイルは取込保持または将来拡張として扱う。

## 10.4 主要フィールド要件

### agency.txt

| フィールド | gtfs-base | gtfs-jp-v4 | google-transit-ready | 条件・検証 |
|------------|-----------|------------|----------------------|------------|
| `agency_id` | CR | R | Rec | GTFS-JP v4では必須 |
| `agency_name` | R | R | R | 空欄不可 |
| `agency_url` | R | R | R | http/https URL |
| `agency_timezone` | R | R | R | IANA TZ。日本では通常`Asia/Tokyo` |
| `agency_lang` | O | R | Rec | GTFS-JP v4では必須。日本語フィードでは`ja` |
| `agency_phone` | O | Rec | Rec | 利用者問い合わせ先として推奨 |
| `agency_fare_url` | O | Rec | Rec | 運賃案内ページとして推奨 |
| `agency_email` | O | Rec | Rec | 利用者問い合わせ先として推奨 |

### stops.txt

| フィールド | gtfs-base | gtfs-jp-v4 | google-transit-ready | 条件・検証 |
|------------|-----------|------------|----------------------|------------|
| `stop_id` | R | R | R | `stops.stop_id`、`locations.geojson.id`、`location_groups.location_group_id`間で一意 |
| `stop_name` | CR | CR | R | `location_type`が0/1/2のとき必須。MVPでは全停留所で必須 |
| `stop_lat` | CR | CR | R | `location_type`が0/1/2のとき必須。-90〜90 |
| `stop_lon` | CR | CR | R | `location_type`が0/1/2のとき必須。-180〜180 |
| `zone_id` | CR | CR | CR | 運賃ゾーンを使う場合は必須 |
| `location_type` | O | R | O | GTFS-JP v4では必須。空欄は許容しない |
| `parent_station` | O | CR | O | 親子関係が必要な駅・バスターミナル・出入口等で条件付き必須。循環不可 |
| `wheelchair_boarding` | O | Rec | Rec | 入力可能にする |
| `platform_code` | O | Rec | Rec | のりば案内として推奨 |

### routes.txt

| フィールド | gtfs-base | gtfs-jp-v4 | google-transit-ready | 条件・検証 |
|------------|-----------|------------|----------------------|------------|
| `route_id` | R | R | R | 一意 |
| `agency_id` | CR | R | Rec | GTFS-JP v4では必須 |
| `route_short_name` | CR | CR | CR | `route_long_name`が空の場合は必須 |
| `route_long_name` | CR | CR | CR | `route_short_name`が空の場合は必須 |
| `route_type` | R | R | R | バスは3。プロファイルで許容値を管理 |
| `route_color` | O | Rec | Rec | 6桁hex。`#`なし |
| `route_text_color` | O | Rec | Rec | 6桁hex。`#`なし |
| `continuous_pickup` | O | CF | O | v4固定路線MVPでは条件付き禁止 |
| `continuous_drop_off` | O | CF | O | v4固定路線MVPでは条件付き禁止 |
| `network_id` | O | CF | O | Fares V2の`networks.txt`/`route_networks.txt`と排他条件あり |

### trips.txt

| フィールド | gtfs-base | gtfs-jp-v4 | google-transit-ready | 条件・検証 |
|------------|-----------|------------|----------------------|------------|
| `route_id` | R | R | R | `routes.route_id`参照 |
| `service_id` | R | R | R | `calendar`または`calendar_dates`参照 |
| `trip_id` | R | R | R | 一意 |
| `trip_headsign` | O | Rec | Rec | 行先表示として推奨。pattern既定値から補完可能 |
| `direction_id` | O | Rec | Rec | 上下方向がある場合は推奨 |
| `shape_id` | O | CR | Rec | `shapes.txt`を出す場合、およびshapeが条件付き必須となるサービスでは必須 |
| `wheelchair_accessible` | O | Rec | Rec | 入力可能にする |

### stop_times.txt

| フィールド | gtfs-base | gtfs-jp-v4 | google-transit-ready | 条件・検証 |
|------------|-----------|------------|----------------------|------------|
| `trip_id` | R | R | R | `trips.trip_id`参照 |
| `arrival_time` | CR | CR | CR | 始点・終点、`timepoint=1`では必須。MVPの固定路線では全行出力 |
| `departure_time` | CR | CR | CR | `timepoint=1`では必須。MVPの固定路線では全行出力 |
| `stop_id` | CR | CR | R | Flexの`location_id`/`location_group_id`を使わないMVPでは必須 |
| `location_group_id` | O | CF | O | Flex対象外のMVPでは禁止 |
| `location_id` | O | CF | O | Flex対象外のMVPでは禁止 |
| `stop_sequence` | R | R | R | trip内で単調増加。一意 |
| `stop_headsign` | O | Rec | Rec | 停留所ごとの行先表示として推奨 |
| `pickup_type` | O | O | O | 0〜3。Flex窓指定時の禁止条件はPhase 3 |
| `drop_off_type` | O | O | O | 0〜3 |
| `continuous_pickup` | O | CF | O | v4固定路線MVPでは条件付き禁止 |
| `continuous_drop_off` | O | CF | O | v4固定路線MVPでは条件付き禁止 |
| `shape_dist_traveled` | O | Rec | Rec | shape使用時は単調非減少 |
| `timepoint` | O | Rec | Rec | 時刻が定時か推定かを明示 |
| `start_pickup_drop_off_window` | O | CR | O | Flex対象時のみ条件付き必須。MVPでは対象外 |
| `end_pickup_drop_off_window` | O | CR | O | Flex対象時のみ条件付き必須。MVPでは対象外 |

### calendar.txt / calendar_dates.txt

| フィールド | ファイル | 要件 | 条件・検証 |
|------------|----------|------|------------|
| `service_id` | both | R | service IDとして一意/参照可能 |
| `monday`〜`sunday` | calendar | R | 0/1。全曜日0かつ例外追加なしはerror |
| `start_date` | calendar | R | `YYYYMMDD` |
| `end_date` | calendar | R | `YYYYMMDD`、`start_date <= end_date` |
| `date` | calendar_dates | R | `YYYYMMDD` |
| `exception_type` | calendar_dates | R | 1=追加、2=削除 |

### feed_info.txt

| フィールド | gtfs-base | gtfs-jp-v4 | google-transit-ready | 条件・検証 |
|------------|-----------|------------|----------------------|------------|
| `feed_publisher_name` | CR | R | R | `feed_info.txt`出力時は必須 |
| `feed_publisher_url` | CR | R | R | `feed_info.txt`出力時は必須 |
| `feed_lang` | CR | R | R | `ja`等 |
| `feed_start_date` | O | R | Rec | GTFS-JP v4では必須 |
| `feed_end_date` | O | R | Rec | GTFS-JP v4では必須。期限切れ/直近期限はwarning/error |
| `feed_version` | O | R | Rec | GTFS-JP v4では必須。版番号と連動 |
| `feed_contact_email`/`feed_contact_url` | O | Rec | Rec | 問い合わせ先 |

### fare_attributes.txt / fare_rules.txt

| フィールド | ファイル | gtfs-jp-v4 | 条件・検証 |
|------------|----------|------------|------------|
| `fare_id` | both | R | 一意または参照整合 |
| `price` | fare_attributes | R | 0以上。無償交通は0 |
| `currency_type` | fare_attributes | R | 日本円は`JPY` |
| `payment_method` | fare_attributes | R | 0/1 |
| `transfers` | fare_attributes | R | 乗継可否 |
| `agency_id` | fare_attributes | CR | 複数agency等で運賃主体を区別する場合 |
| `ic_price` | fare_attributes | Rec | ICカード運賃を扱う場合 |
| `route_id` / `origin_id` / `destination_id` / `contains_id` | fare_rules | O | 均一運賃以外の適用条件 |

### translations.txt

| フィールド | gtfs-jp-v4 | 条件・検証 |
|------------|------------|------------|
| `table_name` | R | 対象テーブル |
| `field_name` | R | 翻訳対象フィールド |
| `language` | R | 読み仮名は`ja-Hrkt`、英語は`en`等 |
| `translation` | R | 翻訳・読み仮名 |
| `record_id` | CR | `field_value`を使わない場合 |
| `record_sub_id` | CR | `stop_times`等の複合キー対象時 |
| `field_value` | CR | `record_id`を使わない場合 |

GTFS-JP v4では読み仮名の設定を必須とし、英語翻訳は推奨とする。

### shapes.txt / attributions.txt / transfers.txt / frequencies.txt

| ファイル | 主要フィールド | gtfs-jp-v4 | 条件・検証 |
|----------|----------------|------------|------------|
| shapes | `shape_id`, `shape_pt_lat`, `shape_pt_lon`, `shape_pt_sequence` | R | `shapes.txt`出力時は必須。sequence順・座標範囲を検証 |
| attributions | `organization_name` | R | `attributions.txt`出力時は必須 |
| attributions | `is_producer`, `is_operator`, `is_authority` | CR | 組織の役割に応じて条件付き必須 |
| transfers | `from_stop_id`, `to_stop_id` | CR | stop間乗換の場合 |
| transfers | `from_trip_id`, `to_trip_id` | CR | 便同士の接続を表す場合 |
| transfers | `transfer_type` | R | `transfers.txt`出力時は必須 |
| frequencies | `trip_id`, `start_time`, `end_time`, `headway_secs` | R | `frequencies.txt`出力時は必須 |

## 10.5 v4とv3互換の分離

GTFS-JP v4ネイティブ出力では、国際標準GTFSに取り込まれたファイル・項目を優先し、旧GTFS-JP独自ファイルは次の扱いにする。

| 区分 | 扱い |
|------|------|
| v4本体要件 | `gtfs-jp-v4`プロファイルのRequired/Conditionally Required/Recommendedに定義する |
| v3由来拡張 | `gtfs-jp-v3-legacy`で保持・再出力する。v4出力時は原則出さないか、互換オプションで出す |
| v3取込データ | 取込時に内部モデルへマッピングし、v4で表現可能な項目へ移行する |
| 移行不能項目 | warningとして表示し、出力対象外またはメタデータ保持にする |

## 10.6 Google向け公開ゲート

`google-transit-ready`はGTFS公式仕様そのものではなく、Google Maps申請で手戻りを減らすための本サービス独自プロファイルである。次をerrorまたはwarningに昇格する。

| ルール | severity | 内容 |
|--------|----------|------|
| `missing_feed_info` | error | `feed_info.txt`がない |
| `missing_shape_recommended` | warning | バス路線で`shapes.txt`がない |
| `missing_trip_headsign` | warning | `trip_headsign`がなく、patternからも補完できない |
| `feed_expired` | error | 公開時点でサービス期間が終了している |
| `feed_expired_soon` | warning | `feed_end_date`またはcalendar最終日が近い |
| `unstable_public_ids` | warning | 前版から`stop_id`/`route_id`/`agency_id`が大量変更されている |
| `missing_contact` | warning | agency/feed_infoに問い合わせ先がない |

## 10.7 自前検証と標準バリデータ

公開前検証は次の順で行う。

1. 内部モデル検証: 必須未入力、参照整合、時刻単調性、座標範囲、pattern整合を確認する。
2. GTFS生成: 選択プロファイルで`gtfs.zip`を生成する。
3. 標準検証: 生成zipをMobilityData Canonical GTFS Schedule Validatorに通す。
4. プロファイル追加検証: GTFS-JP固有ルール、Google向け公開ゲート、読み仮名等を確認する。

検証結果には、少なくとも次を保存する。

| 項目 | 内容 |
|------|------|
| `profile_id` | 実行したプロファイル |
| `validator_name` | 例: `mobilitydata-gtfs-validator` |
| `validator_version` | 実行したバージョン |
| `executed_at` | 実行日時 |
| `source_revision` | 対象版または作業データID |
| `summary` | error/warning/info件数 |
| `issues` | 指摘一覧。可能なら画面へのdeeplinkを持つ |

## 10.8 MVPの準拠範囲

MVPでは、固定路線バスの静的GTFS-JP作成・検証・公開に範囲を絞る。

| 対象 | MVP | 備考 |
|------|-----|------|
| 固定路線バス | 対応 | `route_type=3`を主対象 |
| `agency/stops/routes/trips/stop_times/calendar/calendar_dates/feed_info/fare_attributes/translations` | 対応 | GTFS-JP v4必須系として最優先 |
| `fare_rules` | 最小対応 | 均一運賃以外で必須 |
| `attributions` | 最小対応 | GTFS-JP v4推奨 |
| `shapes` | 最小対応 | フリー乗降等では必須。定路線では推奨。直線生成または手動編集 |
| 運賃Fares v1 | 対応 | `fare_attributes`必須、`fare_rules`条件付き必須 |
| GTFS-RT | 対象外 | Phase 2 |
| GTFS-Flex | 対象外 | Phase 3 |
| Fares v2 | 対象外 | Phase 3 |

## 10.9 実データ検収条件

仕様上の準拠を「OK」とするには、実装後に次を満たす必要がある。

1. 最小サンプルフィードを生成し、標準バリデータでerror 0。
2. 既存の実GTFSを取込、再出力し、標準バリデータでerror 0。
3. v3由来フィードを取込、v4出力し、移行警告が妥当である。
4. `google-transit-ready`で公開阻害errorが0。
5. 版公開後のURLからzipを取得し、zip直下にtxtが配置されている。

## 10.10 リリースブロッカー

次のいずれかに該当する場合、仕様上は「未OK」とし、MVPリリース・公開版作成・Google申請ガイド表示を禁止する。

| ブロッカー | 判定 | 解消条件 |
|------------|------|----------|
| `spec_lock_missing` | 10.2の必須ロックが未設定 | 採用仕様とvalidatorの版を確定し、ロック情報を保存する |
| `gtfs_jp_matrix_unverified` | GTFS-JP v4公式要件表が未反映 | 公式要件表をプロファイル定義へ取り込み、レビュー済みにする |
| `validator_not_executed` | 生成zipに標準バリデータを実行していない | 対象zipでvalidatorを実行し、結果を保存する |
| `validator_error_exists` | 標準バリデータerrorが1件以上 | errorを0件にする |
| `profile_error_exists` | `gtfs-jp-v4`または`google-transit-ready`のerrorが1件以上 | profile errorを0件にする |
| `golden_feed_failed` | 最小サンプルまたは実フィード回帰が失敗 | 11章の検収シナリオを全件passにする |
| `public_url_unverified` | 公開URLから取得したzipを検証していない | 公開URL経由で取得したzipを再検証する |

## 10.11 ルール定義データの必須項目

実装上のプロファイル定義は、少なくとも次の項目を持つ。

```jsonc
{
  "profile_id": "gtfs-jp-v4",
  "profile_version": "2026-06-12.1",
  "source_locks": ["GTFS_SCHEDULE_LOCK", "GTFS_JP_V4_LOCK"],
  "files": [
    {
      "name": "agency",
      "presence": "required",
      "source": "GTFS Schedule Reference",
      "source_ref": "agency.txt",
      "fields": [
        {
          "name": "agency_name",
          "presence": "required",
          "type": "text",
          "severity_if_missing": "error"
        }
      ]
    }
  ],
  "extra_rules": [
    {
      "code": "service_empty",
      "severity": "error",
      "description": "曜日運行も例外追加もないservice_idを禁止する"
    }
  ]
}
```

`source`と`source_ref`が空のルールは、本サービス独自ルールとして扱い、説明文に「公式仕様由来ではない」ことを明記する。
