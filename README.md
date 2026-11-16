# photo-sticker-print

Immich などのクラウドフォトストレージから写真を選び、エーワンなどのシール用紙に割り付けて印刷するブラウザアプリ。

- シングルユーザー前提のセルフホスト用
- 最初の対応: **Immich** / **エーワン 29662（写真シール高画質 Medium）** / **Canon PIXUS TS7630（とその仲間たち）**

## ドキュメント

- [要件](docs/requirements.md)
- [マイルストーン](docs/milestones.md)
- [技術スタック](docs/tech-stack.md)
- [TS7630 の IPP 対応状況](docs/printer-ts7630.md)

## ステータス

M0（土台づくり）の途中。空のアプリが起動する段階で、写真・印刷の機能はまだありません。

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

| 変数                  | 必須 | 内容                                        |
| --------------------- | ---- | ------------------------------------------- |
| `IMMICH_URL`          | ○    | Immich サーバーの URL                       |
| `IMMICH_API_KEY`      | ○    | Immich の API キー                          |
| `PORT`                |      | 待ち受けポート（既定 3000）                 |
| `PRINTER_SCAN_SUBNET` |      | IP スキャンの初期値（例: `192.168.1.0/24`） |

未設定・不正な場合は、問題のある変数を全部並べて起動を中止する。
