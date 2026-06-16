# 06. GTFS-JP 出力仕様・マッピング・バリデーション

## 6.1 出力プロファイル

出力は「プロファイル」で切替える。GTFS公式仕様、GTFS-JP v4、旧GTFS-JP v3互換、Google Maps申請向け品質ゲートは同一ではないため、ファイル/項目定義は [10-gtfs-compliance](./10-gtfs-compliance.md) のプロファイル要件表を根拠に設定駆動で管理する。

| プロファイル | 説明 |
|--------------|------|
| `gtfs-base` | 国際標準GTFS Scheduleの最小準拠。海外ツール検証・基本互換用。 |
| `gtfs-jp-v4` | 公共交通運行情報標準データ仕様（GTFS-JP）v4ネイティブ出力。**既定**。 |
| `gtfs-jp-v3-legacy` | 旧・標準的なバス情報フォーマット第3版系。既存フィード・既存ツールとの互換用。 |
| `google-transit-ready` | Google Maps申請向けの品質ゲート。GTFS公式要件に実務上の必須・推奨を重ねる。 |

> **v4対応の方針**: v4ネイティブ出力では、国際標準GTFSに取り込まれたファイル・項目を優先する。`agency_jp.txt`、`routes_jp.txt`、`office_jp.txt` 等の旧GTFS-JP由来ファイルは、v4本体要件とは分離し、`gtfs-jp-v3-legacy`または互換オプションとして扱う。v3取込→v4出力のマイグレーションでは、v4で表現可能な項目へ移行し、移行不能項目はwarningとして表示する。

> **Google向け品質ゲート**: Google Maps申請上の実務的必須項目は、GTFS公式のRequiredとは混同しない。`google-transit-ready`で `feed_info.txt`、サービス有効期間、shape、headsign、安定ID等の品質ルールを追加検証する。

## 6.2 出力ファイル一覧（MVP）

MVPでは固定路線バスの静的GTFS-JP作成・公開を対象にし、次のファイルを優先実装する。プロファイル別の正確な要否は [10.3 ファイル要件](./10-gtfs-compliance.md#103-ファイル要件) に従う。

凡例: ◎=必須, ○=条件付必須/推奨, △=任意

| ファイル | 区分 | 生成元 |
|----------|------|--------|
| agency.txt | ◎ | agencies |
| stops.txt | ◎ | stops |
| routes.txt | ◎ | routes |
| trips.txt | ◎ | trips（pattern経由でroute/shape/direction導出） |
| stop_times.txt | ◎ | trips × pattern_stops（override適用後） |
| calendar.txt | ○ | services |
| calendar_dates.txt | ○ | service_exceptions |
| feed_info.txt | ◎ | feed_info |
| translations.txt | ◎ | translations（停留所名の読み等） |
| fare_attributes.txt | ◎ | fare_attributes（Fares v1。無償交通でも出力） |
| fare_rules.txt | ○ | fare_rules（均一運賃以外で必須） |
| shapes.txt | ○ | shapes / shape_points（フリー乗降等では必須、定路線では推奨） |
| attributions.txt | ○ | attributions（データ作成者・運行事業者・公的組織） |
| frequencies.txt | △ | frequencies |
| transfers.txt | ○ | transfers |
| agency_jp.txt / routes_jp.txt / office_jp.txt / pattern_jp.txt | △ | v3互換・移行保持用。v4ネイティブ必須ではない |

> `calendar.txt` と `calendar_dates.txt` はGTFS上「いずれか/条件付き必須」の関係である。MVPでは週次運行を`calendar.txt`、例外日を`calendar_dates.txt`に出す運用を標準とする。

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
- 検証結果には、実行プロファイル、標準バリデータ名・バージョン、実行日時、対象版、サマリ、issuesを保存する。詳細は [10.7](./10-gtfs-compliance.md#107-自前検証と標準バリデータ)。

### 公開ゲート
- `error` が1件でもあれば版作成/公開を不可。
- `warning` は公開可だが、公開時に確認（チェックボックス）を要求。
- 検証結果は `feed_revisions.validation_summary` に保存し、版に紐付ける。

## 6.6 互換性・将来対応
- GTFS-JP仕様改定（項目追加・必須化）に対し、プロファイル定義の追加で対応（コード改修を最小化）。v3→v4はこの仕組みの最初の適用例。
- 標準GTFSのみ出力（`gtfs-base`）で海外ツールとの相互運用を担保。
- **GTFS-Flex**（オンデマンド交通）と**GTFS-Fares v2**（複雑運賃）はフェーズ3でプロファイル拡張として対応する。採用時点のGTFS Schedule Reference、GTFS-JP文書体系、標準バリデータ対応状況を確認して仕様ロックを追加する（[08](./08-tech-roadmap.md) 8.5）。
- Google Maps申請向けの実務品質は`google-transit-ready`で扱い、GTFS公式仕様やGTFS-JP v4本体要件とは分離して検証する。
