# Contributing to GTFS Studio

GTFS Studioへの貢献を歓迎します。小さな修正を除き、実装前にIssueで背景と完了条件を共有してください。

## 開発環境

- Node.js 22
- pnpm 10.33.0
- golden validatorを実行する場合はJava 17

```bash
pnpm install --frozen-lockfile
pnpm -r build
pnpm -r test
```

`@gtfs-studio/api` と `@gtfs-studio/web` はビルド済みの `@gtfs-studio/core` を参照するため、クリーン環境ではテスト前にビルドしてください。

## 開発フロー

1. Issueで目的、スコープ、完了条件を確認する。
2. `main` の最新状態から短命なブランチを作る。
3. 実装、テスト、関連ドキュメントを同じ変更に含める。
4. Conventional Commits形式を目安にコミットする（例: `feat: ...`, `fix: ...`, `docs: ...`）。
5. Pull Requestを作り、GitHub Actionsの成功とレビューを確認する。
6. squash mergeし、作業ブランチを削除する。

`main` へ直接pushせず、Pull Requestを正本とします。大きな変更は、調査・設計・最小実装・検証を分けてレビュー可能な単位にしてください。

## 品質とデータの扱い

- GTFS仕様や検証ルールを変更した場合は、根拠となる仕様とテストを追加する。
- 実データ、API token、事業者の非公開情報をコミットしない。
- 実フィードを回帰試験に使う場合は、公開・再配布の許諾を確認するか匿名化する。
- 公開判定、revision、GTFS-RT運用に影響する変更は、互換性と移行手順をPRに記載する。

## セキュリティ

脆弱性や機密情報の混入は公開Issueに記載せず、GitHubのSecurity Advisoriesから非公開で報告してください。
