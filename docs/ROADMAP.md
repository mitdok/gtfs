# GTFS Studio 全体ロードマップ

最終更新: 2026-08-10

本書は GTFS Studio の全体進捗、優先順位、未確定事項をまとめる上位ロードマップである。
詳細な達成管理は以下に分ける。

- GTFS-JP v4 静的フィード: [`GTFS_JP_V4_ROADMAP.md`](./GTFS_JP_V4_ROADMAP.md)
- GTFS Realtime: [`GTFS_RT_ROADMAP.md`](./GTFS_RT_ROADMAP.md)
- 仕様と実装の対応表: [`STATUS.md`](./STATUS.md)

## 1. 現在地

| 領域 | 現在地 | 主な実装済み | 残り |
|------|--------|--------------|------|
| GTFS-JP v4 core | 93% | import/export、v3→v4移行、v4/Google/標準validatorのGolden zip往復CI、検収判定、revision/publish/public URL smoke、token認証/監査ログ | v4/v3実データの最終選定・許諾レビューとA-07/A-08 |
| Web編集 | MVP完了 | ZIP取込、新規作成、API revision/latest再読込、停留所/路線/便追加、停留所削除/並べ替え、路線属性詳細、shape編集（表操作＋地図ドラッグ）、運賃詳細、検証、公開ゲート表示、warning承認記録API保存、revision/publish/smoke UI MVP | 公開ワークフローの実運用導線 |
| API | MVP完了 | spec lockファイル永続化、HTTP検収、revision/publish、public URL smoke、token認証、監査ログ、RT Alerts/Vehicles/TripUpdates配信 | DB永続化、本格RBAC |
| GTFS-RT | 約94% / Beta手前 | ServiceAlerts、RT中継＋source運用UI、VehiclePositions地図デバッグ、TripUpdates core/API MVP、trip候補・block_id/GPS絞り込み・進捗推定、車両位置連動MVP、候補評価JSON/CSV入力/結果表示/出力、鮮度SLO表示、stale policy、監査ログMVP、公開URL smoke、静的GTFS参照ID照合API/Web、source revision照合/activeFrom予約MVP | 実データ評価 |
| 運用品質 | MVP完了 | CLI検収、CI成功、自動デプロイ、公開URL smoke、監査ログ、運用手順 | 実データ検収と継続運用証跡 |

## 2. 次の優先順位

### P0: 公開前の判定を安定させる

| ID | 作業 | 完了条件 | 関連 |
|----|------|----------|------|
| P0-1 | v4 golden sampleを標準validatorで検証 | minimal / overnight / calendar_dates / translations / shape の validator error 0 を証跡化 | ✅ V4-4 |
| P0-2 | validator実行をCIまたは定型コマンド化 | `pnpm` から検収が再現でき、失敗時にログが残る | ✅ GitHub Actions成功＋検証artifact保存 |
| P0-3 | 実データまたは匿名化データの回帰セットを固定 | 取込→再出力→検証を継続実行できる | ⏳ V4-4 CLI/manifest/匿名化CLI追加 / データ未固定 |

### P1: 公開ワークフローを形にする

| ID | 作業 | 完了条件 | 関連 |
|----|------|----------|------|
| P1-1 | revision保存 | zip、validation結果、spec lock snapshotを版として保持 | V4-6 |
| P1-2 | publish / latest URL | version固定URLとlatest URLを配信できる | V4-6 |
| P1-3 | public URL smoke | 公開URLからzip取得、内部検証、標準validator結果取込ができる | ✅ V4-6 API MVP / RT-5 |

### P2: RTを運用可能に近づける

| ID | 作業 | 完了条件 | 関連 |
|----|------|----------|------|
| P2-1 | RT Alerts WebをAPI保存へ接続 | ローカル保存でなくAPI CRUDを使って `.pb` 配信まで反映 | ✅ RT-1 |
| P2-2 | VehiclePositions地図デバッグ表示 | 最新位置、age、route/trip候補をWebで確認できる | ✅ RT-3 |
| P2-3 | TripUpdatesの実ソース評価 | 実ログから候補なし/一意/曖昧/正解一致率を計測 | ⏳ RT-4 評価API/Web＋JSON/CSV入力/結果表示/出力MVP |
| P2-4 | RT鮮度SLO監視 | TripUpdates/VehiclePositions 90秒、Alerts 10分の逸脱を検出 | ✅ RT-5 |
| P2-5 | RT source運用UI | 外部GTFS-RT sourceの登録、poll、status、feed.pb確認をWebで実行できる | ✅ RT-2 |

### P3: 実務編集を強化する

| ID | 作業 | 完了条件 | 関連 |
|----|------|----------|------|
| P3-1 | shape編集 | trips.shape_id と shapes.txt をWebで作成・編集できる | V4-5 |
| P3-2 | 運賃詳細 | 均一運賃以外の fare_attributes / fare_rules を編集できる | V4-2 / V4-5 |
| P3-3 | 停留所・便の編集操作拡充 | 削除、並べ替え、複製、時刻一括補正ができる | V4-5 |

## 3. 依存関係

| 依存 | 影響する作業 | 必要な決定 |
|------|--------------|------------|
| MobilityData Validatorの実行環境 | P0-1 / P0-2 / P1-3 | validator jarの配置、Javaバージョン、CIでの実行可否 |
| 実データ利用許諾 | P0-3 / P2-3 | 公開可能な実フィードか、匿名化してrepoに入れるか |
| 公開URLの置き場所 | P1-2 / P1-3 / RT-5 | GitHub Pages、既存Webサーバ、別ホストのどれにするか |
| 永続化方式 | P1-1 / API認証 / 監査ログ | ファイル継続かDB化するか |
| RT入力ソース | P2-2 / P2-3 / P2-4 | GPS JSON、既存GTFS-RT中継、手動入力のどれを主にするか |

## 4. 確認が必要な事項

実装前に止まって確認するべきもの:

1. 実データをrepoに入れてよいか。入れる場合は実名のままか、匿名化するか。
2. validator jar のバージョンと配置場所を固定してよいか。
3. 公開URLはどのホストで配信するか。
4. APIの認証は軽量tokenで始めるか、ユーザー/権限モデルを先に作るか。
5. RTの主入力は GPS JSON、外部GTFS-RT、手動API のどれを優先するか。

## 5. 直近の推奨順

1. 実データ回帰セットの方針を決める。
2. revision保存と publish URL を実装する。
3. 実データ回帰セットを固定する。
4. RT VehiclePositions地図表示とTripUpdates実ログ評価へ進む。
5. Web編集の実務操作（shape編集、運賃詳細、warning承認）を埋める。

## 6. 100%到達までの刻み

「100%」は、core実装だけでなく、標準validator・実データ回帰・公開URL・最低限の運用保護まで揃い、
作成から公開判断まで再現できる状態とする。

| Step | 刻み | 完了条件 | 100%への寄与 |
|------|------|----------|--------------|
| S1 | validator jar固定 | validator jarの版・配置・Java条件を固定し、ローカルで再現可能 | ✅ MVP: `pnpm gtfs:validator:install` / `tools/gtfs-validator.jar` / `GTFS_VALIDATOR_JAR` を採用 |
| S2 | `pnpm` 検収コマンド化 | `pnpm gtfs:validate` 等で内部検証＋標準validator＋検収を実行できる | ✅ MVP: `pnpm gtfs:validate <gtfs.zip>` を追加 |
| S3 | v4 golden標準validator通過 | minimal / overnight / calendar_dates / translations / shape が標準validator error 0 | ✅ 完了: validator 8.0.1で5サンプル error 0（reportは `gtfs-tmp/golden-reports/`） |
| S4 | 実データ回帰セット固定 | 実フィードまたは匿名化フィードを固定し、取込→再出力→検証が通る | ⏳ CLI/manifest/匿名化CLI追加 / データ未固定 |
| S5 | revision保存 | zip、内部検証、標準validator結果、spec lock snapshotを版として保存 | ✅ API MVP完了 |
| S6 | publish URL実装 | version固定URLとlatest URLを配信できる | ✅ API MVP完了 |
| S7 | public URL smoke | 公開URLからzip取得、decode/検証/validator結果取込を確認 | ✅ API MVP完了 |
| S8 | API認証・監査ログMVP | 公開・RT書き込み・設定変更にtoken認証と最低限の操作ログを付ける | ✅ token/API監査MVP完了 |
| S9 | RT地図・鮮度監視 | VehiclePositions地図表示、TripUpdates/VehiclePositions/Alertsの鮮度SLOを見られる | ✅ MVP完了 |
| S10 | RT実ログ評価 | TripUpdates候補抽出の候補なし/一意/曖昧/正解一致率を実ログで評価 | RT精度評価 |
| S11 | Web実務編集の穴埋め | shape編集、運賃詳細、warning承認、停留所/便の削除・並べ替えを実装 | ⏳ MVP前進: 路線属性/shape表操作・地図ドラッグ/運賃/削除・並べ替え/warning承認API保存 |
| S12 | 30日運用チェック | 鮮度逸脱、decode error、source error、公開URL smokeの記録が残る | 実務OK判定 |

### 100%判定の目安

| レベル | 条件 |
|--------|------|
| 90% | S1〜S7完了。静的GTFS-JP v4を検証し、公開URLとして配信できる |
| 95% | S8〜S10完了。API/RTの最低限の運用保護とRT品質評価がある |
| 100% | S11〜S12完了。Web編集の主要穴が埋まり、一定期間の運用証跡がある |

確認なしで進めやすい次の順番は S4 の manifest に載せる実データ候補の選定。実データをrepoへ入れるか、匿名化するかは確認が必要になる。
