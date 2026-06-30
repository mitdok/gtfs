# GTFS-RT対応ロードマップ・課題・達成管理

最終更新: 2026-06-30

本書はGTFS StudioにGTFS Realtime（GTFS-RT）を追加するための実装ロードマップ、課題、達成管理表である。静的GTFS-JP v4生成とは別フェーズとして扱い、まず手動Alertと外部GTFS-RT中継から始め、車両位置・遅延予測の自動生成へ段階的に進める。

総合進捗: **93%**

全体優先順位と横断的な確認事項は [`ROADMAP.md`](./ROADMAP.md) に集約する。

## 1. 公式参照・採用方針

| 項目 | 採用方針 |
|------|----------|
| 仕様 | GTFS Realtime Reference v2.0 |
| 形式 | Protocol Buffers（`gtfs-realtime.proto`） |
| フィード | TripUpdates / VehiclePositions / ServiceAlerts |
| 配信 | HTTP GETで `.pb` を返す。デバッグ用JSONは任意 |
| FeedHeader | `gtfs_realtime_version="2.0"`、原則 `FULL_DATASET` |
| 鮮度目標 | TripUpdates / VehiclePositions は90秒以内、ServiceAlertsは10分以内 |
| 更新目標 | 変更時または30秒程度でFeedHeader.timestamp更新 |

参照:

- https://gtfs.org/documentation/realtime/reference/
- https://gtfs.org/documentation/realtime/realtime-best-practices/
- https://gtfs.org/documentation/realtime/proto/

## 2. 実装フェーズ

| フェーズ | 目的 | 成果物 | 状態 |
|----------|------|--------|------|
| RT-0 | 調査・設計固定 | 本ロードマップ、仕様07章更新、受入基準 | ✅ 着手 |
| RT-1 | ServiceAlerts最小実装 | 手動Alert入力モデル、protobuf生成、HTTP配信 | ✅ core store＋API pb配信＋Web API接続完了 |
| RT-2 | 外部GTFS-RT中継 | 既存 `.pb` の取得、検証、キャッシュ、再配信 | ✅ core relay＋api poller＋Web source運用UI完了 |
| RT-3 | VehiclePositions取込 | GPS/外部JSON入力、車両位置Feed生成 | ✅ core store＋API配信・認証MVP＋Web地図デバッグ完了 |
| RT-4 | TripUpdates生成 | 静的GTFSとの突合、遅延算出、StopTimeUpdate生成 | ⏳ core store＋API配信＋静的index・trip候補・block_id/GPS絞り込み・進捗推定・車両位置連動・候補評価API/Web MVP完了 / 実データ評価未 |
| RT-5 | 運用品質 | 監視、鮮度SLO、公開URL検証、Google申請前チェック | ⏳ 鮮度SLO表示＋stale policy＋監査ログMVP＋公開URL smoke＋静的GTFS参照ID照合API/Web＋source revision照合MVP完了 / revision切替予約未 |

## 3. 実装タスク管理

### RT-1 ServiceAlerts最小実装

| ID | タスク | 受入基準 | 状態 |
|----|--------|----------|------|
| RT-1-1 | protobuf依存選定 | JS/TSでFeedMessageをencode/decodeできる | ✅ |
| RT-1-2 | `@gtfs-studio/core` にGTFS-RT型・builder追加 | Alert 1件から `FeedMessage` を生成できる | ✅ |
| RT-1-3 | Alert入力モデル定義 | route/stop/trip向け informed_entity、期間、cause/effect、多言語文言を保持 | ✅ |
| RT-1-4 | `alerts.pb` 生成テスト | protobuf decode後にheader/entity/alertが期待通り | ✅ |
| RT-1-5 | API設計更新 | `POST /projects/{p}/rt/alerts` と `GET /rt/.../alerts.pb` を仕様化 | ✅ |
| RT-1-6 | Web入力画面の最小版 | 運休・遅延・停留所閉鎖Alertを手動登録できる | ✅ API読込・保存・削除＋pb生成UI |
| RT-1-7 | 手動Alert API保存・配信 | `POST/PUT/DELETE /rt/alerts` と `GET /rt/alerts.pb` で登録Alertを配信できる | ✅ |

### RT-2 外部GTFS-RT中継

| ID | タスク | 受入基準 | 状態 |
|----|--------|----------|------|
| RT-2-1 | `rt_sources` 設定モデル | endpoint/auth/poll_interval/feed_typeを保存できる | ✅ `RtSource`（`realtime-relay.ts`）／`PUT /rt/sources/:id` |
| RT-2-2 | poller設計 | `.pb` を取得し、Last-Modified/ETag/timeoutを扱う | ✅ `createRtRelayService`（条件付きGET・AbortControllerでtimeout） |
| RT-2-3 | decode/validate | FeedHeader、entity、参照IDの最低限検証ができる | ✅ `validateRealtimeFeed`（version/timestamp/座標/参照ID抽出） |
| RT-2-4 | cache/再配信 | 最新成功Feedを配信し、取得失敗時は stale 判定を返す | ✅ `RtRelayStore.serve`／`GET /rt/sources/:id/feed.pb`（鮮度SLO） |
| RT-2-5 | 中継メトリクス | 最終取得時刻、age、decode error、HTTP errorを記録 | ✅ `RtRelayMetrics`／`GET /rt/sources/:id/status` |
| RT-2-6 | Web source運用UI | source登録、poll、status、feed.pb decode確認をWebで実行できる | ✅ `RealtimeSourcesView.tsx` |

### RT-3 VehiclePositions

| ID | タスク | 受入基準 | 状態 |
|----|--------|----------|------|
| RT-3-1 | ingest API | 車両ID、緯度経度、timestamp、route/trip候補を受け取る | ✅ MVP |
| RT-3-2 | 認証・レート制限 | source token単位で認証し、不正入力を拒否 | ✅ API MVP |
| RT-3-3 | 座標検証 | lat/lon範囲、timestamp鮮度、vehicle_id必須を検証 | ✅ core MVP |
| RT-3-4 | VehiclePosition生成 | vehicle/trip/position/timestampをprotobuf化 | ✅ core MVP |
| RT-3-5 | 地図デバッグ表示 | Webで最新車両位置とageを確認できる | ✅ API読込・地図表示・age/route/trip表示 |
| RT-3-6 | VehiclePositions HTTP配信 | `GET /rt/vehicles.pb` で最新車両位置を配信できる | ✅ MVP |

### RT-4 TripUpdates

| ID | タスク | 受入基準 | 状態 |
|----|--------|----------|------|
| RT-4-1 | 静的GTFS index | service_id/trip_id/route_id/stop_timesを高速参照できる | ✅ core MVP |
| RT-4-2 | tripマッチング | route/運用番号/時刻/位置から候補tripを推定できる | ✅ route/time/stop/block_id/GPS最寄り停留所＋車両trip_id連動MVP |
| RT-4-3 | stop進捗推定 | 現在/次停留所と遅延秒を算出できる | ✅ 静的時刻MVP |
| RT-4-4 | StopTimeUpdate生成 | arrival/departure delay/timeを出力できる | ✅ core/API MVP |
| RT-4-5 | 運休・途中打切 | schedule_relationshipを仕様版に従って表現 | ✅ core/API MVP |
| RT-4-6 | 品質評価 | 実データでtrip特定率、age、欠損率を計測 | ⏳ 候補抽出評価API/Web＋JSON/CSV probe入力/結果表示/出力MVP完了 / 実データ未 |
| RT-4-7 | VehiclePosition連動 | 最新車両位置からTripUpdateを生成・保存できる | ✅ `/rt/vehicles/:id/trip-update`＋Web生成UI |

### RT-5 運用品質・公開管理

| ID | タスク | 受入基準 | 状態 |
|----|--------|----------|------|
| RT-5-1 | 鮮度SLO | TripUpdates/VehiclePositions 90秒、Alerts 10分の逸脱を検出 | ✅ `/rt/status`＋Web Freshness表示 |
| RT-5-2 | 公開URL smoke | `.pb` URLを取得しprotobuf decode成功を確認 | ✅ `/rt/smoke`＋Web Smoke表示 |
| RT-5-3 | stale時の扱い | 古いFeedを配信停止/警告/継続のポリシーを選べる | ✅ `stalePolicy=serve/warn/block` |
| RT-5-4 | 監査ログ | Alert登録、source設定変更、配信停止を記録 | ✅ `/rt/audit`＋Web Audit表示 |
| RT-5-5 | ダイヤ改正版切替 | 静的GTFS revisionとRT参照IDの整合を切替時に確認 | ⏳ `/rt/static-compat/check`＋`/rt/sources/:id/static-compat/check`＋Web Static Compat/Source compatで照合MVP完了 / revision切替予約未 |

## 4. 主要課題

| 課題 | 影響 | 対策 |
|------|------|------|
| 入力ソースの品質差 | trip特定率・遅延精度が大きく変わる | source別adapterとmapping_configを持つ |
| 静的GTFSとのID不整合 | RTが消費アプリで無視される | 公開前にtrip_id/stop_id/route_id参照検証を必須化 |
| ダイヤ改正時の切替 | 旧trip_id参照のRTが混入する | RT sourceをGTFS revisionに紐付け、施行日で切替 |
| protobuf互換性 | enum/experimental fieldの扱いで破綻する | 採用proto版をlockし、未知fieldは保持または無視方針を固定 |
| 鮮度劣化 | Google/利用アプリで低品質扱いになる | age監視、stale breaker、最終成功Feedの扱いを明確化 |
| セキュリティ | ingest APIの不正投入 | source token、IP制限、rate limit、監査ログ |
| 予測生成の難易度 | TripUpdatesの精度不足 | 最初は外部中継とAlert優先、予測は実データで評価し段階導入 |

## 5. 達成基準

| レベル | 条件 |
|--------|------|
| PoC | Alert 1件を `alerts.pb` として生成し、decodeテストが通る |
| Alpha | 手動Alertと外部GTFS-RT中継を開発環境で配信できる |
| Beta | VehiclePositionsを実ソースから配信し、鮮度SLOを監視できる |
| MVP | TripUpdates/VehiclePositions/Alertsの公開URLがあり、静的GTFSとの参照整合・protobuf decode・鮮度SLOをCIまたは運用監視で確認できる |
| 実務OK | 30日以上の運用で鮮度逸脱、decode error、source errorを可視化し、障害時手順と監査ログが整っている |

## 6. 次に実装する順番

1. ~~protobuf依存を選定し、`FeedMessage` のencode/decodeテストを作る。~~ ✅
2. ~~ServiceAlertsのbuilderをcoreへ追加する。~~ ✅
3. ~~API側で手動Alert CRUDと `alerts.pb` HTTP配信を実装する。~~ ✅
4. ~~WebのローカルAlert保存をAPI保存へ接続する。~~ ✅
5. ~~VehiclePositions ingest APIと最新位置ストアを追加する。~~ ✅
6. ~~VehiclePositionsのsource token認証・レート制限を追加する。~~ ✅
7. 外部GTFS-RT中継のsourceモデルとpoller設計へ進む。 ✅ RT-2完了
8. TripUpdatesの手動/外部入力MVPを追加し、`GET /rt/trip-updates.pb` で配信する。 ✅
9. 静的GTFSの `trips.txt` / `stop_times.txt` からTripUpdates用indexを作り、trip_id基準の遅延をStopTimeUpdateへ展開する。 ✅
10. route_id・時刻・任意stop_idからTripUpdates用の候補tripを近い順に抽出する。 ✅
11. TripUpdates候補抽出の候補なし・一意・曖昧・正解一致率を集計する。 ✅
12. 静的stop_timesと遅延秒から現在/次停留所を推定し、次停留所以降のTripUpdateを作る。 ✅
