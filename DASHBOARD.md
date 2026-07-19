# プロジェクトダッシュボード連携（自動生成）

このリポジトリの状態は [project-dashboard](http://dc-storage:3000/mit/project-dashboard) に集約されています。

- 個別ダッシュボード: http://dc-storage/project/hdd20tb/project-dashboard/dashboards/gtfs.html （[Giteaソース](http://dc-storage:3000/mit/project-dashboard/src/branch/main/dashboards/gtfs.html)）
- 全体一覧: http://dc-storage/project/hdd20tb/project-dashboard/dashboards/index.html

## 状態の更新方法（重要）

このリポジトリ直下の **[.repo-status.json](.repo-status.json)** が状態の正本（自己申告）です。
マイルストーンの進捗があったら `.repo-status.json` の `status`（todo→partial→done）を更新して通常のコミットに含めてください。ダッシュボードが自動収集して反映します（本ファイルも自動再生成されるため直接編集しない）。

- **完成の定義（doneMeans）**: 自治体・事業者がGTFS作成〜検証〜公開を本サービスで完結できる状態
- 達成度はマイルストーンから導出: **50%**（done 1 / partial 3 / todo 1（重み計5））
- 局面: MVP実装中 / 技術: TypeScript / React / MapLibre / node:http(依存ゼロAPI) / 実質最終コミット: 2026-07-02

## マイルストーン

- [x] 仕様(01-11章)・ロードマップ・STATUS対応表
- [~] core(取込/検証/移行/出力)
- [~] web(地図編集/ダイヤ/検証/公開ゲート)
- [~] api(仕様ロック/検収)
- [ ] 公開・配信の一気通貫

## 次アクション

- [ ] STATUS未実装項目の消化
- [ ] 検証→公開ゲートの完成
- [ ] コミュニティ配布形態の整備

---
生成: [project-dashboard/scripts/gen-dashboards.mjs](http://dc-storage:3000/mit/project-dashboard) / 設計: [design-repo-status.md](http://dc-storage:3000/mit/project-dashboard/src/branch/main/docs/design-repo-status.md)
