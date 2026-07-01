# 公開前チェックリスト

最終更新: 2026-07-01

GTFS-JP v4 の公開候補を「作成できた」ではなく「公開してよい」と判断するためのチェックリスト。
CLI と Web のどちらで実行しても、同じ証跡を revision に紐づける。

## 1. 入力・編集

- [ ] GTFS zip、API revision/latest、または新規作成から編集対象を開いた。
- [ ] 停留所、路線属性、ダイヤ、運賃、shape を確認した。
- [ ] `gtfs-jp-v4` profile の error が 0。
- [ ] `google-transit-ready` profile の error が 0。
- [ ] warning が残る場合、影響と承認者を記録した。

## 2. 標準validator

CLI:

```bash
pnpm gtfs:validate path/to/release.zip --report path/to/report.json
```

Web:

- 公開ゲートで MobilityData validator の `report.json` を読み込む。

完了条件:

- [ ] MobilityData validator の error が 0。
- [ ] validator version が `VALIDATOR_LOCK` として記録されている。

## 3. 実データ回帰 A-07/A-08

CLI:

```bash
pnpm gtfs:regression -- --require-reviewed
pnpm gtfs:validate path/to/release.zip \
  --report path/to/report.json \
  --regression-summary gtfs-tmp/regression/results/summary.json \
  --require-reviewed
```

Web:

- 公開ゲートで `gtfs-tmp/regression/results/summary.json` を読み込む。

完了条件:

- [ ] A-07 roundtrip case がレビュー済み。
- [ ] A-08 v3 migration case がレビュー済み。
- [ ] A-07/A-08 の標準validator error が 0。

## 4. 仕様ロック

CLI/API:

```bash
curl http://localhost:8787/spec-locks
```

Web:

- 公開ゲートで `/spec-locks` を読み込む。

完了条件:

- [ ] `GTFS_SCHEDULE_LOCK` が locked。
- [ ] `GTFS_JP_V4_LOCK` が locked。
- [ ] `VALIDATOR_LOCK` が locked。
- [ ] Google公開向けでは `GOOGLE_TRANSIT_LOCK` も locked。

## 5. revision 保存

Web:

- 公開ゲートで `revision保存` を実行する。
- 承認済み warning がある場合、同じ revision へ自動保存されることを確認する。

API:

```bash
curl -X POST http://localhost:8787/projects/demo/revisions \
  -H 'content-type: application/json' \
  -d @revision-request.json
```

API起動やtoken設定は [`API_OPERATIONS.md`](./API_OPERATIONS.md) を参照。

完了条件:

- [ ] revision の `acceptance.status` が `ready`。
- [ ] revision の `gate.status` が `ready`。
- [ ] warning 承認記録が対象 revision に保存されている。

## 6. publish / public URL smoke

Web:

- ready revision で `publish` を実行する。
- 補完された latest URL で `smoke` を実行する。

API:

```bash
curl -X POST http://localhost:8787/projects/demo/revisions/rev_x:publish
curl -X POST http://localhost:8787/projects/demo/revisions/rev_x/public-url-smoke \
  -H 'content-type: application/json' \
  -d '{"url":"http://localhost:8787/projects/demo/latest/gtfs.zip"}'
```

完了条件:

- [ ] latest URL が対象 revision を指している。
- [ ] public URL smoke の `verified` が true。
- [ ] smoke の `sha256Matched` が true。
- [ ] smoke 側の内部検証 error が 0。

## 7. 監査

API:

```bash
curl http://localhost:8787/projects/demo/audit
```

完了条件:

- [ ] revision create が記録されている。
- [ ] warning approvals が記録されている。
- [ ] publish が記録されている。
- [ ] public URL smoke が記録されている。

## 未完の場合の扱い

- 実データ回帰セット未固定の場合、A-07/A-08 は未完として扱う。
- validator jar が無い環境では、内部検証とzip生成までは確認できるが公開OKにはしない。
- warning承認がJSON控えだけでAPI revisionに保存されていない場合、公開証跡としては未完にする。
