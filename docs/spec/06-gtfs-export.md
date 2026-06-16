# 06. GTFS-JP 出力仕様・マッピング・バリデーション

## 6.1 出力プロファイル

出力は「プロファイル」で切替える。ファイル/項目定義はバージョン定義テーブルで設定駆動とし、仕様改定に追従する。

| プロファイル | 説明 |
|--------------|------|
| `gtfs-jp-v4` | 公共交通運行情報標準データ仕様（GTFS-JP）v4（2025年度改訂・GTFS-JPアップデートプロジェクト）。国際標準との整合が強化され、**Google Mapsのデータ受入基準に基づく必須区分**を持つ。**既定** |
| `gtfs-jp-v3` | 旧・標準的なバス情報フォーマット 第3版系。既存フィード・既存ツールとの互換用（レガシー）。 |
| `gtfs-base` | 国際標準GTFSのみ（日本拡張なし）。海外ツール検証用。 |

> **v4対応の方針**: v4では利用の少ないGTFS-JP独自ファイル・項目が標準仕様から削除され、国際標準仕様の全ファイルが取り込まれた。本サービスは項目定義をプロファイル（バージョン定義テーブル）で持つため、v3→v4の差分は**プロファイル定義の差し替え**で吸収する。v3取込→v4出力のマイグレーション（独自項目の落とし込み・警告）もインポータで支援する。

## 6.2 出力ファイル一覧（gtfs-jp系・代表）

> 下表はv3系を基準とした代表構成。**v4では独自ファイル（`*_jp.txt`等）の整理・国際標準ファイルの全面採用が行われており、ファイル・項目の要否はプロファイル定義（バージョン定義テーブル）に従う**。実装時はv4仕様書（国交省公開）の要否表を取り込むこと。

凡例: ◎=必須, ○=条件付必須/推奨, △=任意

| ファイル | 区分 | 生成元 |
|----------|------|--------|
| agency.txt | ◎ | agencies |
| agency_jp.txt | ○ | agencies（拡張項目） |
| stops.txt | ◎ | stops |
| routes.txt | ◎ | routes |
| routes_jp.txt | ○ | routes（拡張項目） |
| trips.txt | ◎ | trips（pattern経由でroute/shape/direction導出） |
| office_jp.txt | △ | offices |
| pattern_jp.txt | △ | patterns（※プロファイルで採用時） |
| stop_times.txt | ◎ | trips × pattern_stops（override適用後） |
| calendar.txt | ◎ | services |
| calendar_dates.txt | ○ | service_exceptions |
| fare_attributes.txt | ○ | fare_attributes |
| fare_rules.txt | ○ | fare_rules |
| shapes.txt | ○ | shapes / shape_points |
| frequencies.txt | △ | frequencies |
| transfers.txt | △ | transfers |
| feed_info.txt | ◎ | feed_info |
| translations.txt | ○ | translations（停留所名の読み等） |

> 必須/条件付の細目はGTFS-JP仕様の版に従い、バージョン定義テーブルで管理する。実装時に最新仕様の項目要否表を取り込む。

## 6.3 主要マッピング

### stop_times の展開（中核ロジック）
各 `trip` について、所属 `pattern` の `pattern_stops` を `sequence` 昇順に走査し、次で各行を生成する。

```
base = trip.start_time_sec
各 pattern_stop ps について:
  if override(trip, ps) が存在:
      arrival   = override.arrival_sec   ?? (base + ps.default_offset_sec)
      departure = override.departure_sec ?? arrival
  else:
      arrival   = base + ps.default_offset_sec
      departure = arrival
  stop_times 行 = {
      trip_id: trip.gtfs_id,
      arrival_time:   sec_to_hhmmss(arrival),    // 24時超は 25:10:00 形式
      departure_time: sec_to_hhmmss(departure),
      stop_id: ps.stop.gtfs_id,
      stop_sequence: ps.sequence,
      stop_headsign / pickup_type / drop_off_type / timepoint / shape_dist_traveled
  }
```

- 時刻は秒→`HH:MM:SS`。深夜便は時を24以上で表現（GTFS仕様）。
- `timepoint` 未指定時は1（正確）を既定とするか仕様に従う。

### 翻訳・読み仮名
- `stops.name_kana` 等は `translations.txt` の `language=ja-Hrkt`（半角/全角カタカナ読み）として出力。
- 多言語（en等）も translations で出力。GTFS-JPの translations 方式（table_name/field_name/record_id 方式）に準拠。

### route の起終点（routes_jp）
- `routes_jp` の origin/via/destination は、パターンの先頭/経由/末尾停留所から補完候補を提示（手動確定可）。

## 6.4 zip生成仕様
- 文字コード: UTF-8（BOMなし）。改行: LF。区切り: カンマ。引用符: RFC 4180準拠（カンマ・改行・引用符を含む値はダブルクオート）。
- ファイル名・ヘッダ順は仕様準拠。空ファイルは原則出力しない（任意ファイルでデータ無しの場合は省略）。
- zip直下にtxtを配置（サブフォルダなし）。
- 生成は決定的（同一データなら同一バイト列）。差分・キャッシュに有利。

## 6.5 バリデーション設計

検証は3層で行う。

### 層1: 入力時バリデーション（同期・即時）
- 必須未入力、型不正、緯度経度範囲、時刻形式、参照先存在。
- UI上でその場フィードバック。

### 層2: 構造・整合性バリデーション（出力前一括）
代表ルール（コード例）:

| code | severity | 内容 |
|------|----------|------|
| missing_required_file | error | 必須ファイルに対応するデータが無い |
| dangling_reference | error | route→agency, trip→service 等の参照切れ |
| stop_time_decreasing | error | 便内で時刻が逆転 |
| duplicate_gtfs_id | error | 同一種別で gtfs_id 重複 |
| stop_without_coordinates | error | 緯度経度欠落 |
| service_empty | error | どの便にも使われない/全曜日false かつ例外なし |
| pattern_too_few_stops | error | パターン停留所が2未満 |
| route_no_trips | warning | 便ゼロの経路 |
| stop_far_from_others | warning | 近接停留所群から極端に離れた座標（入力ミス疑い） |
| missing_kana | warning | 停留所名の読みが無い（日本運用上の推奨） |
| fast_travel | warning | 停留所間の速度が非現実的（時刻入力ミス疑い） |
| feed_expired_soon | info | calendar の end_date が近い |

### 層3: 標準準拠バリデーション（出力後）
- 生成zipに対し、MobilityData Canonical GTFS Validator を**内部実行**（Java別プロセス連携）し、国際標準準拠の権威ある最終チェックを行う。
- 結果を取り込んで S-13 に統合表示。
- 役割分担: **層1・層2＝自前実装**（編集統合・ディープリンク・GTFS-JP固有ルール）、**層3＝標準バリデータ**（標準準拠のお墨付き）。標準バリデータはGTFS-JP拡張を検証しないため、層1・2は必須。技術的背景は [08-tech-roadmap](./08-tech-roadmap.md) 8.2.1。

### 公開ゲート
- `error` が1件でもあれば版作成/公開を不可。
- `warning` は公開可だが、公開時に確認（チェックボックス）を要求。
- 検証結果は `feed_revisions.validation_summary` に保存し、版に紐付ける。

## 6.6 互換性・将来対応
- GTFS-JP仕様改定（項目追加・必須化）に対し、プロファイル定義の追加で対応（コード改修を最小化）。v3→v4はこの仕組みの最初の適用例。
- 標準GTFSのみ出力（`gtfs-base`）で海外ツールとの相互運用を担保。
- **GTFS-Flex**（オンデマンド交通。国際標準に正式採択済み・GTFS-JP v4文書体系に拡張解説あり）、**GTFS-Fares v2**（複雑運賃。rider_categories等が採択済み）はフェーズ3でプロファイル拡張として対応する（[08](./08-tech-roadmap.md) 8.5）。
- Google Mapsのデータ受入基準（v4の必須区分の根拠）への適合を検証ルールに含め、申請時の手戻りを減らす。
