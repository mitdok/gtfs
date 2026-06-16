# GTFS Studio (仮称)

GTFS-JP（v4）/ GTFS-RT 形式の公開用オープンデータを、取込・編集・検証・配信するWEBサービス。
通称「西沢ツール」のWEB版として、作成 → 検証 → 公開（配信）→ 更新 を一気通貫で支援する。

- **OSS＋コミュニティサポート**を中核とし、SaaS提供と自治体オンプレ運用の双方を可能にする。
- 仕様書は [`docs/spec/`](./docs/spec/README.md) を参照。
- 実装の進捗は [`docs/STATUS.md`](./docs/STATUS.md)、変更履歴は [`CHANGELOG.md`](./CHANGELOG.md) を参照。

> 本プロジェクトは、西沢明氏が無償公開した「西沢ツール」が日本のバスオープンデータ普及に果たした功績を出発点とし、その志をOSSとコミュニティで引き継ぐことを目的とする。

## リポジトリ構成

```
docs/
  spec/           仕様書一式（01〜11章）
  STATUS.md       仕様 ⇄ 実装の対応表（実装進捗）
CHANGELOG.md      変更履歴
packages/
  core/           GTFS エンジン（取込・検証・移行・出力・検収。フレームワーク非依存・純TS）
  web/            Web UI（React + MapLibre。取込・停留所地図編集・ダイヤ表・検証・公開ゲート）
  api/            バックエンドAPI（node:http・依存ゼロ。仕様ロック永続化・検収HTTP）
gtfs-tmp/         作業用スクラッチ・過去スナップショット（Git管理外）
```

## 開発

```bash
pnpm install
pnpm -r build      # 全パッケージビルド
pnpm -r test       # 全パッケージテスト
```

### packages/core

GTFSの **取込（zip→内部モデル）→ 検証 → 再出力（→zip）** を担う中核ロジック。
フレームワークやDBに依存せず、単体テストで品質を担保する（仕様書 08章の方針）。

```bash
pnpm --filter @gtfs-studio/core test
```

### packages/web（デモUI）

```bash
pnpm --filter @gtfs-studio/core build   # core を先にビルド
pnpm --filter @gtfs-studio/web dev      # http://localhost:5173
```

- GTFS zip を開く → 停留所（一覧＋地図。ピンのドラッグで座標編集）/ ダイヤ表（セル編集）/ 検証 → gtfs.zip 再出力。
- 地図は自前 MapLibre 基盤を**地図アダプタ**経由で利用（仕様書 04章4.4 / 09章）。
  自前基盤の style URL は環境変数 `VITE_MAP_STYLE_URL` で注入。未設定時は暫定で地理院タイル（淡色）を表示。

## ライセンス

- アプリ本体: Apache-2.0
- 生成データの推奨ライセンス: CC BY
