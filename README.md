# photo-sticker-print

Immich などのクラウドフォトストレージから写真を選び、エーワンなどのシール用紙に割り付けて印刷するブラウザアプリ。

- シングルユーザー前提のセルフホスト用
- 最初の対応: **Immich** / **エーワン 29662（写真シール高画質 Medium）** / **Canon PIXUS TS7630（とその仲間たち）**

## ドキュメント

- [要件](docs/requirements.md)
- [マイルストーン](docs/milestones.md)
- [Immich 連携](docs/immich.md)
- [写真の割り付けと印刷](docs/sheet-print.md)
- [プリンタへの直接送信（IPP）](docs/printing-ipp.md)
- [テスト印刷の使い方](docs/test-print.md)
- [用紙定義](papers/)（JSON。コマ位置は未測定のものがあり、`verification.status` で区別）
- [技術スタック](docs/tech-stack.md)
- [TS7630 の IPP 対応状況](docs/printer-ts7630.md)

## ステータス

M2（Immich 連携）まで完了。次は M3（PC 向け画面と編集）です。詳しくは[マイルストーン](docs/milestones.md)。

## 動かし方

### Docker

```bash
cp .env.example .env   # IMMICH_URL と IMMICH_API_KEY を編集
docker compose --env-file .env up --build
```

http://localhost:3000 を開く。host ネットワーク版（Linux 向け・mDNS 用）は次のとおり。

```bash
docker compose --env-file .env -f docker/compose.host.yaml up --build
```

### 開発

Node.js 22 と pnpm が必要。

```bash
pnpm install
IMMICH_URL=http://localhost:2283 IMMICH_API_KEY=xxx pnpm dev   # server :3000 / web :5173
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

### 環境変数

| 変数                  | 必須 | 内容                                                                |
| --------------------- | ---- | ------------------------------------------------------------------- |
| `IMMICH_URL`          | ○    | Immich サーバーの URL                                               |
| `IMMICH_API_KEY`      | ○    | Immich の API キー（必要な権限は [docs/immich.md](docs/immich.md)） |
| `PORT`                |      | 待ち受けポート（既定 3000）                                         |
| `PRINTER_SCAN_SUBNET` |      | IP スキャンの初期値（例: `192.168.1.0/24`）                         |

未設定・不正な場合は、問題のある変数を全部並べて起動を中止する。

## Kubernetes へのデプロイ（Helm）

`v*` タグを push すると、イメージ `ghcr.io/haoling/photo-sticker-print:<version>` と
チャート `oci://ghcr.io/haoling/charts/photo-sticker-print` が ghcr.io に公開されます
（ブランチの push でもイメージが push されます。チャートは `v*` タグのときだけ公開されます）。

### ブランチごとのイメージタグ

すべてのブランチの push で、次の 2 つのタグのイメージが ghcr.io に push されます。

- `:<ブランチ名>` — ブランチ名の `/` を `-` に置換したもの（例: `claude/cool-keller-lfhmdt` → `:claude-cool-keller-lfhmdt`）
- `:sha-<短縮SHA>` — コミットの短縮 SHA 7 桁（例: `:sha-1a2b3c4`）

未リリースのブランチを ArgoCD などでデプロイするときは、チャートをその Git ブランチから読み、
`image.tag` に上記のタグを指定します。ブランチ版のチャートは OCI には公開されません。
fork からの PR は `GITHUB_TOKEN` に書き込み権限がないため、イメージは push されません。

```bash
helm install psp oci://ghcr.io/haoling/charts/photo-sticker-print --version 0.1.0 \
  --set config.immichUrl=http://immich-server:2283 \
  --set secret.immichApiKey=xxxx
```

- API キーを既存 Secret（キー `IMMICH_API_KEY`）で渡す場合は `secret.existingSecret` を指定
- mDNS でプリンタを探したい場合は `hostNetwork=true`
- Ingress は `ingress.enabled=true`。他の値は `charts/photo-sticker-print/values.yaml` を参照
