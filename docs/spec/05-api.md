# 05. API設計

## 5.1 方針

- REST/JSON。リソース指向。プロジェクトをパスのスコープに含める。
- 認証: Bearer（OIDCアクセストークン）。公開フィード配信のみ匿名。
- バージョニング: `/api/v1`。
- すべての書込はべき等性・楽観的ロック（`If-Match`/`updated_at`）を考慮。
- エラーは RFC 7807（problem+json）形式。
- import / validate / export / publish の重い処理は非同期ジョブとし、状態遷移・エラー詳細を共通形式で返す。

```
ベースURL: https://api.<host>/api/v1
公開配信: https://feeds.<host>/...   （CDN/オブジェクトストレージ前段、別系統）
```

### 共通ジョブ状態

| 状態 | 説明 |
|------|------|
| `queued` | 受付済み。まだ処理開始していない |
| `running` | 処理中 |
| `succeeded` | 正常終了 |
| `failed` | 失敗。`error`に詳細を持つ |
| `canceled` | ユーザーまたはシステムにより中止 |

ジョブレスポンス共通形:

```jsonc
{
  "job_id": "...",
  "type": "validate", // import | validate | export | publish | submit_repository
  "status": "running",
  "progress": { "current": 40, "total": 100, "message": "標準バリデータを実行中" },
  "created_at": "2026-06-12T10:00:00Z",
  "started_at": "2026-06-12T10:00:05Z",
  "finished_at": null,
  "result": null,
  "error": null
}
```

失敗時の`error`はRFC 7807に準じる:

```jsonc
{
  "type": "https://docs.example/errors/gtfs-validator-failed",
  "title": "GTFS validation failed",
  "status": 422,
  "detail": "標準バリデータでerrorが検出されました",
  "instance": "/projects/.../validations/..."
}
```

## 5.2 認証・組織

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/me` | ログインユーザーと所属組織 |
| GET | `/orgs/{org}/members` | メンバー一覧 |
| POST | `/orgs/{org}/members` | メンバー招待 |
| PATCH | `/orgs/{org}/members/{user}` | ロール変更 |

## 5.3 プロジェクト

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/orgs/{org}/projects` | プロジェクト一覧 |
| POST | `/orgs/{org}/projects` | 作成 |
| GET | `/projects/{project}` | 取得 |
| PATCH | `/projects/{project}` | 更新（名称・プロファイル・ライセンス） |
| POST | `/projects/{project}/duplicate` | 複製（ダイヤ改正下書き等） |
| DELETE | `/projects/{project}` | アーカイブ/削除（論理） |

## 5.3.1 仕様ロック・リリース検収

仕様ロックとリリース検収は、サービス全体またはデプロイ単位のメタデータとして扱う。

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/system/spec-locks` | 採用中のGTFS/GTFS-JP/Google/validatorロック状態を取得 |
| GET | `/system/profiles` | 利用可能な出力プロファイルと版を取得 |
| GET | `/system/release-acceptance/latest` | 最新のリリース検収結果を取得 |

`/system/spec-locks` レスポンス例:

```jsonc
{
  "locks": [
    {
      "id": "GTFS_SCHEDULE_LOCK",
      "status": "locked",
      "source": "https://gtfs.org/documentation/schedule/reference/",
      "source_revision": "Revised 2026-04-27",
      "checked_at": "2026-06-12T00:00:00Z",
      "profile_version": "2026-06-12.1"
    },
    {
      "id": "GTFS_JP_V4_LOCK",
      "status": "locked",
      "source": "国土交通省 公共交通運行情報標準データ仕様（GTFS-JP）第4.0版",
      "files": [
        "commmmons_doc_007-01_ver01.pdf",
        "commmmons_doc_007-02_ver01.pdf",
        "commmmons_doc_007-03_ver01.pdf"
      ],
      "checked_at": "2026-06-12T00:00:00Z",
      "profile_version": "2026-06-12.1"
    }
  ]
}
```

## 5.4 マスタリソース（CRUD共通形）

各マスタは以下の共通CRUDを持つ。`{res}` ∈ `agencies, stops, routes, patterns, services, fares, shapes, offices, attributions, translations, frequencies, transfers`。

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/projects/{project}/{res}` | 一覧（ページング・検索・並替: `?page&limit&q&sort`） |
| POST | `/projects/{project}/{res}` | 作成 |
| GET | `/projects/{project}/{res}/{id}` | 取得 |
| PATCH | `/projects/{project}/{res}/{id}` | 更新（楽観ロック `If-Match`） |
| DELETE | `/projects/{project}/{res}/{id}` | 削除 |
| POST | `/projects/{project}/{res}:bulk` | 一括作成/更新/削除（差分適用） |

### パターン配下（ネスト）
| メソッド | パス | 説明 |
|----------|------|------|
| GET/POST | `/projects/{project}/patterns/{pattern}/stops` | パターン停留所列の取得/置換 |
| PUT | `/projects/{project}/patterns/{pattern}/stops:reorder` | 並べ替え |

## 5.5 ダイヤ（trips / stop_times）

ダイヤ編集はパフォーマンス上、パターン単位の専用エンドポイントを設ける。

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/projects/{project}/patterns/{pattern}/timetable` | ダイヤ表取得（便×停留所の行列、運行区分フィルタ `?service=`） |
| POST | `/projects/{project}/patterns/{pattern}/trips` | 便追加（先頭時刻指定→自動展開） |
| PATCH | `/projects/{project}/trips/{trip}` | 便メタ更新（運行区分/行先/営業所等） |
| PUT | `/projects/{project}/trips/{trip}/stop-times` | 通過時刻の上書き（override） |
| POST | `/projects/{project}/patterns/{pattern}/trips:generate` | 間隔生成（開始/終了/間隔から連続生成） |
| POST | `/projects/{project}/trips:bulk` | 便の一括操作（複製・運行区分一括割当・削除） |
| DELETE | `/projects/{project}/trips/{trip}` | 便削除 |

ダイヤ表取得レスポンス例:
```jsonc
{
  "pattern_id": "...",
  "stops": [ {"pattern_stop_id":"...","stop_id":"...","name":"駅前","sequence":1}, ... ],
  "trips": [
    {
      "trip_id":"...","service_id":"weekday","headsign":"団地",
      "times":[ {"pattern_stop_id":"...","departure":"07:00:00","overridden":false}, ... ]
    }
  ]
}
```

## 5.6 取込（インポート）

| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/projects/{project}/imports` | ファイルアップロード（gtfs.zip / xlsx / csv）。種別自動判定 |
| GET | `/projects/{project}/imports/{job}` | 取込ジョブ状態（解析/差分） |
| POST | `/projects/{project}/imports/{job}:apply` | 差分を確定反映 |
| GET | `/import-templates/{type}` | CSVテンプレート/西沢様式テンプレートのダウンロード |

取込はジョブ（非同期）。解析後に差分（created/updated/deleted）を返し、ユーザー確認後 `:apply`。

## 5.7 検証

| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/projects/{project}/validate` | 検証実行（非同期ジョブ） |
| GET | `/projects/{project}/validations/{job}` | 結果取得（issues: severity/code/entity/message/location） |

検証結果 issue 例:
```jsonc
{
  "severity": "error",            // error | warning | info
  "code": "stop_time_decreasing", // ルールコード
  "message": "stop_sequence 3 の時刻が前停留所より早くなっています",
  "entity": { "type": "trip", "id": "...", "stop_sequence": 3 },
  "deeplink": "/projects/.../patterns/.../timetable?trip=..."
}
```

## 5.8 版・公開・出力

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/projects/{project}/revisions` | 版一覧 |
| POST | `/projects/{project}/revisions` | 版作成（検証→スナップショット） |
| GET | `/projects/{project}/revisions/{rev}` | 版詳細 |
| GET | `/projects/{project}/revisions/{rev}/diff?base={rev2}` | 版差分 |
| POST | `/projects/{project}/revisions/{rev}:publish` | 公開（即時 or `effective_date` 予約） |
| POST | `/projects/{project}/revisions/{rev}:rollback` | 最新版エイリアスを当該版へ |
| POST | `/projects/{project}/revisions/{rev}:submit-repository` | GTFSデータリポジトリ（gtfs-data.jp）へ登録/更新（F-7-7、連携設定要） |
| GET | `/projects/{project}/revisions/{rev}/gtfs.zip` | 当該版の zip ダウンロード（要認証） |
| GET | `/projects/{project}/export.zip?profile=` | 作業データから即時生成（プレビュー用） |

### 版状態遷移

`feed_revisions.status` は次の状態を取る。

| 状態 | 説明 | 遷移元 | 遷移先 |
|------|------|--------|--------|
| `draft` | 版作成ジョブ中または検証前 | 作業データ | `validating`, `failed` |
| `validating` | 自前検証・zip生成・標準バリデータ実行中 | `draft` | `validated`, `failed` |
| `validated` | 公開可能な検証済み版 | `validating` | `published`, `superseded` |
| `published` | 最新版エイリアスが指している公開版 | `validated`, `superseded` | `superseded` |
| `superseded` | 過去公開版または差し替え済み版 | `published`, `validated` | `published` |
| `failed` | 版作成または検証失敗 | `draft`, `validating` | なし |

公開操作は、対象版が`validated`または`superseded`で、対象プロファイルの公開阻害errorが0件の場合のみ許可する。ロールバックは、過去に公開可能検証を通過した`superseded`版のみ対象にできる。

### 検証結果メタデータ

版作成時の検証結果には、[10.7](./10-gtfs-compliance.md#107-自前検証と標準バリデータ) の項目を保存する。APIでは少なくとも `profile_id`, `validator_name`, `validator_version`, `executed_at`, `summary`, `issues` を返す。

## 5.9 公開フィード配信（匿名・別系統）

CDN/オブジェクトストレージ配信を前提とし、安定URLを提供する。

| パス | 説明 |
|------|------|
| `GET /feeds/{org}/{feed}/gtfs.zip` | 最新公開版（エイリアス）。常時配信。 |
| `GET /feeds/{org}/{feed}/v{n}/gtfs.zip` | 版固定URL（不変） |
| `GET /feeds/{org}/{feed}/feed-info.json` | 版・施行日・更新日時等のメタ |
| `GET /rt/{org}/{feed}/trip-updates.pb` | GTFS-RT TripUpdate（フェーズ2） |
| `GET /rt/{org}/{feed}/vehicle-positions.pb` | GTFS-RT VehiclePosition（フェーズ2） |
| `GET /rt/{org}/{feed}/alerts.pb` | GTFS-RT Alert（フェーズ2） |

- 配信は ETag / Last-Modified / 適切な Cache-Control を付与。
- 公開フィードはアプリ障害時もストレージから配信継続できる構成（[08](./08-tech-roadmap.md)）。

## 5.10 GTFS-RT入力（フェーズ2）

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/projects/{project}/rt/sources` | RTソース定義一覧 |
| POST | `/projects/{project}/rt/sources` | RTソース定義作成（外部GTFS-RT中継/API/GPSプッシュ） |
| GET | `/projects/{project}/rt/sources/{source}` | RTソース定義取得 |
| PATCH | `/projects/{project}/rt/sources/{source}` | RTソース定義更新 |
| DELETE | `/projects/{project}/rt/sources/{source}` | RTソース停止・削除 |
| GET | `/projects/{project}/rt/sources/{source}/status` | 最終取得時刻、age、decode error、HTTP error等の状態 |
| POST | `/projects/{project}/rt/ingest` | 車両位置等のプッシュ受信（source token認証付） |
| GET | `/projects/{project}/rt/alerts` | 手動Alert一覧 |
| POST | `/projects/{project}/rt/alerts` | Alert手動投入 |
| PATCH | `/projects/{project}/rt/alerts/{alert}` | Alert更新 |
| DELETE | `/projects/{project}/rt/alerts/{alert}` | Alert終了・削除 |
| POST | `/projects/{project}/rt/smoke` | 公開RT URLを取得し、protobuf decode・鮮度を検証 |

RTソース定義例:

```jsonc
{
  "id": "vehicle-api-1",
  "type": "external_gtfs_rt", // external_gtfs_rt | vehicle_position_push | operations_api
  "feed_type": "vehicle_positions", // trip_updates | vehicle_positions | alerts
  "endpoint": "https://example.com/vehicle-positions.pb",
  "auth": { "type": "bearer", "secret_ref": "..." },
  "poll_interval_seconds": 30,
  "mapping_config": {
    "static_revision_id": "rev_20260401",
    "route_id_field": "route_id",
    "trip_id_field": "trip_id"
  },
  "enabled": true
}
```

RTソース状態例:

```jsonc
{
  "source_id": "vehicle-api-1",
  "feed_type": "vehicle_positions",
  "last_success_at": "2026-06-16T02:00:00Z",
  "last_attempt_at": "2026-06-16T02:00:30Z",
  "feed_header_timestamp": 1781575200,
  "age_seconds": 28,
  "entity_count": 42,
  "stale": false,
  "last_error": null
}
```

Alert登録例:

```jsonc
{
  "active_period": { "start": "2026-06-16T09:00:00+09:00", "end": "2026-06-16T18:00:00+09:00" },
  "informed_entities": [
    { "route_id": "R1" },
    { "stop_id": "S10" }
  ],
  "cause": "CONSTRUCTION",
  "effect": "DETOUR",
  "header_text": { "ja": "工事による迂回運行" },
  "description_text": { "ja": "市役所前停留所は終日休止します。" },
  "url": { "ja": "https://example.com/alerts/20260616" }
}
```

RT smoke結果例:

```jsonc
{
  "status": "pass",
  "checked_at": "2026-06-16T02:01:00Z",
  "feeds": [
    {
      "feed_type": "vehicle_positions",
      "url": "https://feeds.example/rt/org/feed/vehicle-positions.pb",
      "protobuf_decode": "pass",
      "entity_count": 42,
      "age_seconds": 35,
      "stale": false
    }
  ]
}
```

## 5.11 Webhook / 通知
- 公開完了・検証失敗・施行日到来をWebhook（署名付）/メールで通知。
- 設定: `/orgs/{org}/webhooks`。
