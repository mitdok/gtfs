# 公開デプロイ手順・注記（gtfs2 / vps-sakura）

最終更新: 2026-08-05

main の最新ビルドを、公開VPS `vps-sakura`（`dokasen.com`）へ **`/gtfs2/`（フロント）＋
`/gtfs2-api/`（API）** として公開している。旧 `/gtfs/` は別の（古い）ビルドが並存する
デモで、本デプロイとは独立。

> **位置づけ: 仮実装（プロトタイプ公開）。** 「作成→検証→公開」の一連をブラウザで
> 触れるようにするための暫定公開であり、後述の「セキュリティ上の既知の注記」を
> 承知の上で運用する。恒久運用に上げる際は先に当該項目を塞ぐこと。

## 構成

```
Internet ──443(TLS)──> nginx (dokasen.com)
   ├─ /gtfs2/       → 静的配信 /var/www/html/gtfs2/            （フロント: React+MapLibre）
   └─ /gtfs2-api/   → proxy 127.0.0.1:8787                     （API: systemd --user gtfs-api）
                          │  node:http（依存ゼロ＋core）
                          ▼
                       /var/www/gtfs-api/  （core/api dist ＋ node_modules ＋ data/）
```

- フロント: `https://dokasen.com/gtfs2/`（vite `base=/gtfs2/`、静的SPA、client-sideで取込/編集/検証/再出力が完結）
- API: `https://dokasen.com/gtfs2-api/`（フロントと同一オリジンなので mixed-content/CORS問題なし）
- API は `127.0.0.1:8787` のみに bind（外部から直接叩けない）。公開はnginx経由TLSのみ。

## サービス（常駐）

`systemctl --user` のユーザーサービスとして常駐（linger有効で再起動後も自動起動）。
`sudo` を要しない運用。ユニット: `~/.config/systemd/user/gtfs-api.service`。

```sh
# 状態・ログ・再起動（vps-sakura 上、ubuntuユーザー）
export XDG_RUNTIME_DIR=/run/user/1000
systemctl --user status gtfs-api
systemctl --user restart gtfs-api
journalctl --user -u gtfs-api -n 100 -f
```

設定は環境変数（ユニットの `Environment=`）:

| 変数 | 値 | 用途 |
|------|----|------|
| `GTFS_API_HOST` | `127.0.0.1` | bindアドレス（localhost固定） |
| `PORT` | `8787` | 待受ポート |
| `GTFS_SPEC_LOCKS_PATH` | `/var/www/gtfs-api/data/spec-locks.json` | 仕様ロック永続化 |
| `GTFS_REVISIONS_PATH` | `/var/www/gtfs-api/data/revisions` | revision永続化 |
| `GTFS_API_TOKENS` | （秘匿） | 静的書込token（カンマ区切り可）。Web「公開ゲート」画面のtoken欄に入力して使う |

### Node ランタイム

VPS標準の Node 18 は本コードの JSON import attributes（`import ... with { type: "json" }`）と
依存 `gtfs-realtime-bindings` の engine 要件（node≥22）に非対応。公式nodejs.orgの
**Node 22 を SHA256 検証のうえユーザー領域 `~/opt/node22` に導入**し、当サービスの
`ExecStart` のみがそれを使う（他サービスには不干渉）。

## ビルド＆再デプロイ

ローカル（`~/gtfs`, main）でビルドして rsync する。

```sh
# --- フロント（/gtfs2/, API接続先を本番に固定してビルド） ---
pnpm install
pnpm --filter @gtfs-studio/core build
VITE_GTFS_API_BASE_URL=https://dokasen.com/gtfs2-api \
  pnpm --filter @gtfs-studio/web exec vite build --base=/gtfs2/
# 配布zip(dl/)を消さないよう --exclude する。
rsync -av --delete --exclude 'dl/' packages/web/dist/ ubuntu@vps-sakura:/var/www/html/gtfs2/
# ※ vite build は index.html を再生成するため、下記「ダウンロード配布物」の
#   ダウンロードリンク(<a>要素)は再デプロイのたびに index.html へ再注入する。

# --- API（/var/www/gtfs-api/） ---
pnpm --filter @gtfs-studio/api build
rsync -a --delete packages/core/dist packages/core/package.json ubuntu@vps-sakura:/var/www/gtfs-api/core/
rsync -a --delete packages/api/dist packages/api/bin packages/api/package.json ubuntu@vps-sakura:/var/www/gtfs-api/api/
# node_modules は VPS 側で `npm install`（fflate 0.8.2 / gtfs-realtime-bindings 2.0.0 をピン）し、
# node_modules/@gtfs-studio/core を ../../core へのsymlinkにする（初回のみ）。
ssh ubuntu@vps-sakura 'export XDG_RUNTIME_DIR=/run/user/1000; systemctl --user restart gtfs-api'
```

> 注: リポジトリの vite `base` は `/gtfs/`（旧デモ用）。`/gtfs2/` はビルド時に
> `--base=/gtfs2/` で上書きする。API接続先も `VITE_GTFS_API_BASE_URL` で上書きする。
> どちらもデプロイ固有の値で、ソースには焼き込まない。

## ダウンロード配布物（ソースzip）

各サイトは、その版のソース一式zipを `dl/` 配下で配布する（サイト上に固定リンクを掲示）。

| サイト | 版 | 配布URL |
|--------|----|---------|
| `/gtfs2/`（新） | main（例 `cd53591`） | `https://dokasen.com/gtfs2/dl/gtfs-studio-src-gtfs2-<sha>.zip` |
| `/gtfs/`（旧） | `57f64ab` | `https://dokasen.com/gtfs/dl/gtfs-studio-src-gtfs-57f64ab.zip` |

- 生成は `git archive`（**追跡ファイルのみ**、`.git`/`.env`/`data`/`node_modules`/ビルド成果物・トークンを含まない）:
  ```sh
  git archive --format=zip --prefix=gtfs-studio/ <ref> -o gtfs-studio-src-<label>.zip
  ```
- 秘密情報が無いことを、ファイル名（`.env`/`data`/`token`）と実トークン値の両面で検査してから配置する。
- `dl/` は静的配信のみ。`/gtfs2/dl/` は web 再デプロイの `rsync --delete` 対象内なので、上記の
  `--exclude 'dl/'` で保護する。`/gtfs/` は再デプロイ対象外なので保護不要。
- サイト上のダウンロードリンクは、`index.html` の `</body>` 直前に固定表示の `<a href="dl/....zip" download>`
  を1つ置く（`#root` の外なのでSPAに消されない）。新サイトは再ビルドで index.html が再生成されるため再注入する。

## nginx（公開経路）

`dokasen.com` の443 serverブロックに次の location を追加している（`sudo` 必須の一度きりの作業）。

```nginx
location /gtfs2-api/ {
    proxy_pass http://127.0.0.1:8787/;   # 末尾スラッシュでprefixを剥がす
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 64m;            # revision保存はzipをbase64でJSON body投入
    proxy_read_timeout 120s;
    proxy_connect_timeout 5s;
}
```

## API書込保護

`GTFS_API_TOKENS` が設定された環境では、APIは `GET` / `OPTIONS` 以外の全リクエストに
`Authorization: Bearer <token>` または `x-api-token` を要求する。個別ルートで認証を
追加し忘れてもグローバル書込ゲートで拒否される。

- 保護対象: 仕様ロック更新、検収、revision、publish、smoke、warning承認、GTFS-RTの
  Alerts/Vehicles/TripUpdates更新、source登録・poll、静的互換性・trip matching評価。
- source登録・pollを匿名実行できないため、任意URL取得によるSSRF経路も閉じる。
- WebのGTFS-RT画面にはtoken入力欄があり、入力値をタブのセッション内だけに保存してAPI要求へ付与する。
- `GTFS_API_TOKENS` が空の開発環境では従来どおり認証を無効化できる。本番では必ず設定する。

> 現状の主要デモ（取込→編集→検証→再出力）は **すべてブラウザ内（client-side）で完結**し、
> API書込を伴わないため、上記の塞ぎ込みを入れても匿名ユーザーの基本操作は損なわれない。
