# 11. 最終OK条件・検収仕様

本章は、本サービスを「GTFS/GTFS-JP作成ツールとしてリリースしてよい」と判定するための検収条件を定義する。仕様書に要件が書かれているだけではOKとせず、公式仕様ロック、プロファイル定義、生成zip、標準バリデータ、実データ回帰、公開URL検証のすべてで判定する。

## 11.1 最終OKの定義

MVPを最終OKとする条件は次のすべてを満たすこと。

| ID | 条件 | 合格基準 |
|----|------|----------|
| A-01 | 公式仕様ロック | `GTFS_SCHEDULE_LOCK`, `GTFS_JP_V4_LOCK`, `GOOGLE_TRANSIT_LOCK`, `VALIDATOR_LOCK` がすべて設定済み |
| A-02 | プロファイル定義 | `gtfs-base`, `gtfs-jp-v4`, `google-transit-ready` のファイル・フィールド・追加ルールが設定ファイル化されている |
| A-03 | MVP生成 | 固定路線バスの最小データから `gtfs.zip` を生成できる |
| A-04 | 標準検証 | 生成zipをMobilityData Canonical GTFS Schedule Validatorに通し、error 0 |
| A-05 | GTFS-JP検証 | `gtfs-jp-v4`プロファイルのerror 0 |
| A-06 | Google向け検証 | `google-transit-ready`プロファイルのerror 0。warningは公開時確認付きで許容 |
| A-07 | 実フィード回帰 | 既存GTFS zipを取込→再出力し、標準バリデータerror 0 |
| A-08 | v3移行回帰 | v3由来フィードを取込→v4出力し、移行警告が妥当で、出力zipは標準バリデータerror 0 |
| A-09 | 公開URL検証 | 公開URLから取得したzipが、保存済みartifactと同一または同一内容で、標準バリデータerror 0 |
| A-10 | 監査可能性 | 検証結果に仕様ロック、validatorバージョン、プロファイル版、実行日時、対象revisionが保存されている |

いずれか1つでも未達の場合、リリース判定は `not_ready` とする。

## 11.2 公式仕様ロックの検収

仕様ロックは、実装時点で採用する仕様と検証器を固定するための監査情報である。仕様ロックがない状態での「準拠」は禁止する。

| ロック | 合格条件 |
|--------|----------|
| `GTFS_SCHEDULE_LOCK` | GTFS Schedule ReferenceのURL、改訂日、確認日、取り込み版が保存されている |
| `GTFS_JP_V4_LOCK` | `commmmons_doc_007-01_ver01.pdf`、`commmmons_doc_007-02_ver01.pdf`、`commmmons_doc_007-03_ver01.pdf`のファイル名、仕様書名、第4.0版、2026年3月19日、確認日、要件表取り込み版が保存されている |
| `GOOGLE_TRANSIT_LOCK` | Google Transit差分資料のURL、確認日、適用ルール版が保存されている |
| `VALIDATOR_LOCK` | MobilityData validatorの名前、バージョン、実行方法、ルールセット版が保存されている |

GTFS-JP v4公式PDF一式が未反映の場合、`gtfs-jp-v4`を既定プロファイルとして表示してよいが、公開版作成は不可とする。

## 11.3 検収用サンプル

MVPでは最低限、次のサンプルをリポジトリに持つ。

| サンプル | 目的 | 必須内容 |
|----------|------|----------|
| `minimal-fixed-bus` | ゼロから生成できることの証明 | agency, stops 2件以上, route, service, trips 2件以上, stop_times, feed_info, fare_attributes, translations |
| `overnight-bus` | 24時超時刻の検証 | `25:10:00`等を含むtrip |
| `calendar-dates-only` | `calendar_dates.txt`単独運用の検証 | calendarなしでservice_idを成立させる |
| `translations-kana` | 読み仮名出力の検証 | `translations.txt`と`feed_info.txt` |
| `shape-basic` | shape出力の検証 | `shapes.txt`と`trips.shape_id` |
| `legacy-v3-import` | v3移行検証 | `*_jp.txt`相当の情報を含む取込サンプル |
| `real-feed-roundtrip-1` | 実フィード回帰 | 実在フィードを匿名化または利用許諾の範囲で保存 |

各サンプルには、入力、期待される生成ファイル一覧、期待されるvalidator結果、期待されるprofile issue一覧を持たせる。

## 11.4 検収コマンド

CIまたはリリース前検収では、少なくとも次の処理を自動実行する。

```sh
pnpm -r test
pnpm gtfs:generate-fixtures
pnpm gtfs:validate-fixtures
pnpm gtfs:roundtrip-fixtures
pnpm gtfs:publish-smoke
```

コマンド名は実装時に変更してよいが、同等の検収内容をCIに組み込むこと。

## 11.5 合否判定

検収結果は機械判定できるJSONとして保存する。

```jsonc
{
  "release_candidate": "0.1.0-rc.1",
  "status": "ready", // ready | not_ready
  "executed_at": "2026-06-12T10:00:00Z",
  "spec_locks": {
    "GTFS_SCHEDULE_LOCK": "locked",
    "GTFS_JP_V4_LOCK": "locked",
    "GOOGLE_TRANSIT_LOCK": "locked",
    "VALIDATOR_LOCK": "locked"
  },
  "checks": [
    { "id": "A-01", "status": "pass" },
    { "id": "A-04", "status": "pass", "errors": 0, "warnings": 0 }
  ],
  "artifacts": {
    "validation_report": "s3://.../validation.json",
    "published_zip": "s3://.../gtfs.zip"
  }
}
```

`status=ready` の条件は、A-01〜A-10がすべてpassであること。warningが残る場合は、対象ルール、影響、承認者、承認日時を保存する。

## 11.6 手動レビュー項目

標準バリデータだけでは判定できない実務品質は、リリース前に手動レビューする。

| 項目 | 合格基準 |
|------|----------|
| 停留所名 | 利用者に表示して自然な名称である |
| 行先 | `trip_headsign`またはpattern既定値が利用者向けに意味を持つ |
| shape | 実際の道路経路から大きく外れていない |
| service期間 | 公開日から十分な将来期間を含む |
| ID安定性 | 改版で既存`stop_id`/`route_id`/`trip_id`を不必要に変更していない |
| 問い合わせ先 | agencyまたはfeed_infoに実運用上の連絡先がある |
| ライセンス | 公開フィードの利用条件が明示されている |

## 11.7 公開不可条件

次の場合は、管理者権限でも公開できない。

- 標準バリデータerrorが1件以上ある。
- `gtfs-jp-v4`プロファイルerrorが1件以上ある。
- `google-transit-ready`のerrorが1件以上ある。
- 仕様ロックが未設定である。
- 生成zipではなく公開URLから取得したzipの検証が未実行である。
- feedの有効期間が公開日時点で終了している。

## 11.8 最終判断

本仕様書が目指す「最終的OK」は、次の状態を指す。

1. 10章のプロファイル要件が公式仕様ロック済み。
2. 11章の検収シナリオがCIで全件pass。
3. 実データ回帰で標準バリデータerror 0。
4. 公開URL経由のzipも同じ検証をpass。
5. warningは承認付きで記録済み。

この状態になった版のみ、MVPリリース候補として `ready` と判定する。
