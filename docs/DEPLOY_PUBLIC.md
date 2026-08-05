# 公開デプロイ手順・注記（gtfs2 / vps-sakura）

最終更新: 2026-08-05

master の最新ビルドを、公開VPS `vps-sakura`（`dokasen.com`）へ **`/gtfs2/`（フロント）＋
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

ローカル（`~/gtfs`, master）でビルドして rsync する。

```sh
# --- フロント（/gtfs2/, API接続先を本番に固定してビルド） ---
pnpm install
pnpm --filter @gtfs-studio/core build
VITE_GTFS_API_BASE_URL=https://dokasen.com/gtfs2-api \
  pnpm --filter @gtfs-studio/web exec vite build --base=/gtfs2/
rsync -av --delete packages/web/dist/ ubuntu@vps-sakura:/var/www/html/gtfs2/

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

## セキュリティ上の既知の注記（⚠ 仮実装ゆえ未対応）

現状、API はインターネットから到達可能で、**一部の書込/計算エンドポイントが
トークン非要求**のまま公開されている。恒久運用へ上げる前に塞ぐこと。

- **token必須（保護済み）**: revision作成 / publish / public-url-smoke / warning承認 / audit取得
  （`authorizeStaticWrite`）。
- **token非要求（=誰でも実行可能・要対応）**:
  - `PUT /spec-locks/:id` — 仕様ロックの上書き（メタデータ改変）
  - `POST /acceptance`、`POST /rt/static-compat/check`、`POST /rt/trip-matching/evaluate`,
    `POST /rt/smoke` — アップロード zip に対するサーバ側計算（計算DoSの余地。nginx 64mで上限）
  - `POST/PUT/DELETE /rt/alerts`・`/rt/vehicles`・`/rt/trip-updates`（および `/:id`） — RTストアの書換
    （※ `/rt/vehicles` 系は `rtVehicleTokens` 設定時のみ保護されるが、本デプロイでは未設定＝開放）
  - **`PUT /rt/sources/:id` ＋ `POST /rt/sources/:id/poll` — ⚠ SSRF**:
    任意URLのソースを登録し、サーバにそのURLを取得させられる。公開状態では
    内部サービス（`127.0.0.1:8010` 等）への探査に悪用され得る。**最優先で塞ぐべき項目。**

### 想定する塞ぎ方（未実装）

- 最短・堅牢: リクエストハンドラ先頭で **GET/OPTIONS以外は一律 `authorizeStaticWrite` を要求**
  （グローバル書込ゲート）。併せて Web の RT系コンポーネント
  （`RealtimeAlertsView` / `RealtimeSourcesView` / `RealtimeVehiclesView` / `RealtimeSmokeView` /
  `RealtimeStaticCompatView`）が現在 `Authorization` を付けていないので、token を配線する。
  匿名利用は client-side studio（取込/編集/検証/再出力）＋ read-only 閲覧に限定される。
- 代替: SSRFのある `rtRelay`（外部poll）だけを無効化し、他は段階的に token 化。

> 現状の主要デモ（取込→編集→検証→再出力）は **すべてブラウザ内（client-side）で完結**し、
> API書込を伴わないため、上記の塞ぎ込みを入れても匿名ユーザーの基本操作は損なわれない。
