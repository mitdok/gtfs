# プロジェクトダッシュボード連携

このリポジトリの状態は、Gitea全体を管理する **[project-dashboard](http://dc-storage:3000/mit/project-dashboard)** に集約されています。

- 個別ダッシュボード（Gitea）: [dashboards/gtfs.html](http://dc-storage:3000/mit/project-dashboard/src/branch/main/dashboards/gtfs.html)
- 個別ダッシュボード（静的配信・レンダリング表示）: http://dc-storage/project/hdd20tb/project-dashboard/dashboards/gtfs.html
- 全体一覧: http://dc-storage/project/hdd20tb/project-dashboard/dashboards/index.html

> このファイルは project-dashboard 側の暫定評価（`data/repo-status.json`）から自動生成した第一版です。**内容が実態と異なる場合は、このリポジトリの ROADMAP / PROGRESS を正として更新し、project-dashboard 側にも反映してください。**

## 現在の評価（暫定・2026-07-19）

- 本質: GTFS-JP/RTの公開オープンデータを取込・編集・検証・配信するWebサービス。OSS＋コミュニティ。SaaSと自治体オンプレ両対応。
- 局面: **MVP実装中** / 達成度（目安）: **45%** / 評価確度: medium
- 技術: TypeScript / React / MapLibre / node:http(依存ゼロAPI)

## マイルストーン（暫定）

- [x] 仕様(01-11章)・ロードマップ・STATUS対応表
- [~] core(取込/検証/移行/出力)
- [~] web(地図編集/ダイヤ/検証/公開ゲート)
- [~] api(仕様ロック/検収)
- [ ] 公開・配信の一気通貫

## 次アクション（このリポジトリで実装を進めるための起点）

- [ ] STATUS未実装項目の消化
- [ ] 検証→公開ゲートの完成
- [ ] コミュニティ配布形態の整備

---
生成元: [project-dashboard/scripts/gen-dashboards.mjs](http://dc-storage:3000/mit/project-dashboard) / 評価日 2026-07-19
