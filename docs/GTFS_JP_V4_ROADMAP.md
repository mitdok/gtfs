# GTFS-JP v4対応ロードマップ・達成管理

最終更新: 2026-06-30

本書はGTFS StudioのGTFS-JP v4対応を、実装・検証・公開運用の観点で段階管理する。対象は固定路線バスの静的GTFS-JP v4 MVPであり、GTFS-RT、GTFS-Flex、Fares v2は別フェーズとして扱う。

全体優先順位と横断的な確認事項は [`ROADMAP.md`](./ROADMAP.md) に集約する。

## 1. 現在地

総合進捗: **83%**

内訳:

| 領域 | 重み | 現在点 | 状態 | 根拠 |
|------|------|--------|------|------|
| 仕様ロック・プロファイル定義 | 10 | 8 | ✅ core完了 / API永続化未完 | `src/profiles/*.json`, `spec-lock.ts` |
| 取込・文字コード・ラウンドトリップ | 10 | 10 | ✅ | `importer.ts`, `encoding.ts`, roundtrip tests |
| v3→v4移行 | 10 | 8 | ✅ MVP / 実フィード回帰不足 | `migration.ts` |
| v4出力・プロファイルフィルタ | 10 | 8 | ✅ MVP / 公開URL検証不足 | `exporter.ts`, `export-profile.ts` |
| v4検証ルール | 18 | 16 | ✅ 中核 / 均一運賃以外の詳細・実データ精査不足 | `validator.ts` |
| Google公開ゲート・公開可否判定 | 10 | 8 | ✅ 判定器＋Web表示 / 運用証跡不足 | `release-gate.ts`, `ReleaseGateView.tsx` |
| 標準validator連携 | 10 | 8 | ✅ report取込＋CLI Java起動＋CI定義 / runner実績待ち | `standard-validator.ts`, `gtfs-acceptance.mjs`, `.gitea/workflows/ci.yml` |
| golden sample・実データ検収 | 10 | 7 | ⏳ golden標準validator error 0完了 / 実データ不足 | `acceptance.ts`, `v4-golden-samples.ts`, `gtfs-validate-golden.mjs` |
| Web編集・出力ワークフロー | 7 | 7 | ✅ 新規作成＋路線/停留所/便追加MVP / 公開ワークフロー未完 | `packages/web` |
| API・永続化・公開URL運用 | 5 | 3 | ✅ API＋ファイル永続化MVP / revision・publish未完 | `packages/api` |
| **合計** | **100** | **83** |  |  |

読み替え:

- **coreライブラリとしてのv4対応**: 約83%。取込、移行、検証、出力、公開判定、golden標準validator回帰とCI定義の主要部は動く。
- **実務公開できるプロダクトとしてのv4対応**: 約70〜75%。CI連携、実データ検収、revision/publish、公開URL検証が残る。

## 2. フェーズ

| フェーズ | 目的 | 成果物 | 状態 |
|----------|------|--------|------|
| V4-0 | 仕様・正本データ固定 | v4要件表、JSONプロファイル、仕様ロック | ✅ 完了 |
| V4-1 | core入出力MVP | import/migrate/validate/export/filter | ✅ 完了 |
| V4-2 | 実務検証強化 | v4条件付きルール、Google公開ゲート | ✅ MVP完了 |
| V4-3 | 標準validator実行 | MobilityData validatorの実行・結果保存 | ✅ CLI MVP完了 |
| V4-4 | golden sample・実データ回帰 | 最小/夜行/calendar_dates/shape/v3/実データ回帰 | ⏳ golden標準validator完了 / v3・実データ未完 |
| V4-5 | Web公開ワークフロー | 公開ゲート、validator結果取込、検収結果表示 | ⏳ 一部完了 |
| V4-6 | API・永続化・公開URL | spec lock保存、revision、publish、public URL smoke | ⏳ API MVP完了 |
| V4-7 | 実務OK | 11章A-01〜A-10をCI/運用でpass | ⏳ 未達 |

## 3. 詳細タスク

### V4-0 仕様・正本データ固定

| ID | タスク | 受入基準 | 状態 |
|----|--------|----------|------|
| V4-0-1 | GTFS-JP v4仕様ロック | v4 PDF一式・確認日・版を保持 | ✅ |
| V4-0-2 | プロファイルJSON外部化 | `gtfs-base`, `gtfs-jp-v4`, `google-transit-ready` がJSON正本 | ✅ |
| V4-0-3 | 仕様ロックストア | lock取得・上書き・snapshotが可能 | ✅ core |
| V4-0-4 | 仕様ロックAPI | `/system/spec-locks` で取得可能 | ✅ |

### V4-1 core入出力MVP

| ID | タスク | 受入基準 | 状態 |
|----|--------|----------|------|
| V4-1-1 | GTFS zip取込 | UTF-8/Shift_JISを取り込み内部Feed化 | ✅ |
| V4-1-2 | 決定的CSV/zip出力 | 同一Feedから同一zipを生成 | ✅ |
| V4-1-3 | v3 legacy分離 | v4出力で `*_jp.txt` を除外可能 | ✅ |
| V4-1-4 | v3→v4補完 | agency/feed_info/fare/translationsを最小補完 | ✅ MVP |
| V4-1-5 | 実v3データ回帰 | 実在または匿名化v3フィードで移行確認 | ⏳ |

### V4-2 実務検証強化

| ID | タスク | 受入基準 | 状態 |
|----|--------|----------|------|
| V4-2-1 | 必須ファイル・必須列 | v4 required欠落をerror | ✅ |
| V4-2-2 | 参照整合 | route/trip/stop/service/fare/shape参照切れを検出 | ✅ |
| V4-2-3 | stop_times/calendar意味検証 | 時刻逆転、日付、空service等を検出 | ✅ |
| V4-2-4 | v4条件付き禁止 | Flex/Network系のMVP禁止項目をerror | ✅ |
| V4-2-5 | shapes検証 | 座標・sequence・trip.shape_idを検証 | ✅ MVP |
| V4-2-6 | translations検証 | `ja-Hrkt` と対象キー不足を検出 | ✅ MVP |
| V4-2-7 | fare/attributions/transfers検証 | 実務入力ミスを検出 | ✅ MVP |
| V4-2-8 | URL/TZ/色/enum詳細検証 | agency_url/timezone/language/route_color/enumを検出 | ✅ |
| V4-2-9 | parent_station/zone/fare_rules条件 | 親子停留所、運賃ゾーン、均一運賃以外の条件検証 | ✅ MVP |

### V4-3 標準validator実行

| ID | タスク | 受入基準 | 状態 |
|----|--------|----------|------|
| V4-3-1 | report.json取込 | MobilityData validator結果を集計できる | ✅ |
| V4-3-2 | validator lock生成 | validator名・版をlock化できる | ✅ |
| V4-3-3 | Java validator実行ラッパ | zipを渡してreport.jsonを生成できる | ✅ CLI |
| V4-3-4 | CI/ローカルコマンド | `pnpm gtfs:validate` 相当で実行できる | ✅ Gitea Actions定義追加 / runner実績待ち |
| V4-3-5 | Web validator結果取込 | report.jsonをUIから取り込み公開ゲートへ反映 | ✅ MVP |

### V4-4 golden sample・実データ回帰

| ID | タスク | 受入基準 | 状態 |
|----|--------|----------|------|
| V4-4-1 | minimal-fixed-bus | v4 error 0、標準validator error 0 | ✅ validator 8.0.1 error 0 |
| V4-4-2 | overnight-bus | 24時超時刻を標準validatorで確認 | ✅ validator 8.0.1 error 0 |
| V4-4-3 | calendar-dates-only | calendarなしでもservice参照が成立 | ✅ validator 8.0.1 error 0 |
| V4-4-4 | translations-kana | 読み仮名出力を確認 | ✅ validator 8.0.1 error 0 |
| V4-4-5 | shape-basic | shapes/trips.shape_idを確認 | ✅ validator 8.0.1 error 0 |
| V4-4-6 | legacy-v3-import | v3由来フィードをv4出力へ移行 | ⏳ |
| V4-4-7 | real-feed-roundtrip-1 | 実フィード取込→再出力→標準validator error 0 | ⏳ |

### V4-5 Web公開ワークフロー

| ID | タスク | 受入基準 | 状態 |
|----|--------|----------|------|
| V4-5-1 | 検証プロファイル切替 | v4/google/base/v3をUIで切替 | ✅ |
| V4-5-2 | v4プロファイル出力 | Web出力zipが選択プロファイルを通る | ✅ |
| V4-5-3 | 公開ゲート表示 | blockerと仕様ロック状態を表示 | ✅ |
| V4-5-4 | 新規GTFS-JP v4作成画面 | agency/route/stops/serviceから最小v4フィードを作成 | ✅ |
| V4-5-5 | 新規作成後の編集操作 | 路線追加、停留所追加、停留所名/座標編集、便追加ができる | ✅ MVP |
| V4-5-6 | 検収レポート表示 | A-01〜A-10のpass/failを表示 | ✅ MVP |
| V4-5-7 | warning承認記録 | warning公開時の承認者・理由・時刻を保存 | ⏳ |

### V4-6 API・永続化・公開URL

| ID | タスク | 受入基準 | 状態 |
|----|--------|----------|------|
| V4-6-1 | API層作成 | project/revision/validation/exportのAPIがある | ✅ 検収HTTP MVP |
| V4-6-2 | spec lock永続化 | DB/ファイルにlockを保存しAPIで取得 | ✅ ファイル永続化 |
| V4-6-3 | revision保存 | 生成zip、validation結果、lock snapshotを版に保存 | ⏳ |
| V4-6-4 | publish | latest URLとversion固定URLを配信 | ⏳ |
| V4-6-5 | public URL smoke | 公開URLからzip取得・再検証 | ⏳ |

## 4. 次の優先順

1. **V4-4 実データ回帰**
   - 利用許諾のある実フィード、または匿名化フィードを固定する。
2. **Web編集の実務操作強化**
   - shape編集、運賃詳細、停留所削除/並べ替え、路線属性詳細を追加する。
3. **V4-6 revision/publish/public URL**
   - 生成zip、validation結果、lock snapshotを版として保存し、公開URL smokeまでつなぐ。

## 5. 進捗率の更新ルール

進捗率は1章の重み付き表で更新する。

- 実装だけでなく、テストまたは受入基準があるものだけ加点する。
- coreで完了してもAPI/永続化が必要な項目は満点にしない。
- 「実務OK」は11章A-01〜A-10が実データ込みでpassした時点で100%とする。
