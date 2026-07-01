# API運用手順

最終更新: 2026-07-01

`@gtfs-studio/api` は node:http ベースのMVP API。仕様ロック、revision、publish、public URL smoke、
warning承認、GTFS-RT手動/中継を扱う。永続化は現時点ではファイル。

## 起動

```bash
pnpm --filter @gtfs-studio/core build
pnpm --filter @gtfs-studio/api build
pnpm --filter @gtfs-studio/api start -- \
  --port 8787 \
  --locks ./data/spec-locks.json \
  --revisions ./data/revisions \
  --tokens admin-token
```

環境変数でも指定できる。

```bash
PORT=8787 \
GTFS_SPEC_LOCKS_PATH=./data/spec-locks.json \
GTFS_REVISIONS_PATH=./data/revisions \
GTFS_API_TOKENS=admin-token \
pnpm --filter @gtfs-studio/api start
```

`--tokens` / `GTFS_API_TOKENS` が空の場合、静的GTFSの書込認証は無効になる。検証環境では便利だが、
公開運用では token を設定する。

## 保存先

| 種類 | 既定 | 内容 |
|------|------|------|
| 仕様ロック | `./data/spec-locks.json` | `GTFS_*_LOCK` / `VALIDATOR_LOCK` |
| revision | `./data/revisions/{project}/revisions/{rev}/` | `revision.json` と `gtfs.zip` |

revision metadata には、zip hash、検証summary、仕様ロックsnapshot、acceptance、gate、warning承認を保存する。

## Web接続

Web UI から API を使う場合:

```bash
VITE_GTFS_API_BASE_URL=http://localhost:8787 pnpm --filter @gtfs-studio/web dev
```

公開ゲート画面では、同じ token 欄を revision保存、warning承認保存、publish、smoke に使う。

## 代表API

Health:

```bash
curl http://localhost:8787/health
```

仕様ロック:

```bash
curl http://localhost:8787/spec-locks
curl -X PUT http://localhost:8787/spec-locks/VALIDATOR_LOCK \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer admin-token' \
  -d '{"status":"locked","label":"MobilityData","source":"https://github.com/MobilityData/gtfs-validator","version":"8.0.1"}'
```

revision一覧:

```bash
curl http://localhost:8787/projects/demo/revisions
curl 'http://localhost:8787/projects/demo/revisions?limit=20'
curl 'http://localhost:8787/projects/demo/revisions?status=published&limit=20'
```

`status` は `validated` / `published` / `superseded` を指定できる。

revision zip:

```bash
curl -o gtfs.zip http://localhost:8787/projects/demo/revisions/rev_20260701090000/gtfs.zip
curl -o latest.zip http://localhost:8787/projects/demo/latest/gtfs.zip
```

publish:

```bash
curl -X POST http://localhost:8787/projects/demo/revisions/rev_20260701090000:publish \
  -H 'authorization: Bearer admin-token'
```

public URL smoke:

```bash
curl -X POST http://localhost:8787/projects/demo/revisions/rev_20260701090000/public-url-smoke \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer admin-token' \
  -d '{"url":"http://localhost:8787/projects/demo/latest/gtfs.zip"}'
```

warning承認:

```bash
curl -X PUT http://localhost:8787/projects/demo/revisions/rev_20260701090000/warning-approvals \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer admin-token' \
  -d '{
    "approvals": [
      {
        "key": "missing_contact:{}:0",
        "code": "missing_contact",
        "message": "agency/feed_infoに問い合わせ先がありません",
        "impact": "別ページで問い合わせ先を案内済み",
        "approver": "ops",
        "approvedAt": "2026-07-01T09:00:00Z"
      }
    ]
  }'
```

監査ログ:

```bash
curl http://localhost:8787/projects/demo/audit \
  -H 'authorization: Bearer admin-token'
```

## 運用上の注意

- `latest/gtfs.zip` は最新公開revisionを返す。未publishのrevisionは latest にならない。
- revision一覧は `limit` と `status` で絞り込める。長期運用では published 一覧や未公開 validated 一覧から作業対象を選ぶ。
- publish対象は `acceptance.status=ready` かつ `gate.status=ready` のrevisionのみ。
- warning承認は公開対象 revision に保存する。ローカルJSON控えだけでは公開証跡として不十分。
- public URL smoke は保存済みrevisionのhashと取得zipのhashを比較する。
- token設定時、revision作成、publish、public URL smoke、warning承認、audit取得は token が必要。
- ファイル永続化MVPでは、`data/` のバックアップと権限管理は運用側で行う。
