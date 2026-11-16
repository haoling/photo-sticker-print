# 技術スタック（M0 時点の決定）

| 領域           | 採用                                                | 理由                                                                                 |
| -------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 言語           | TypeScript（Node.js 22）                            | フロント・バックで編集パラメータの型とロジックを共有できる                           |
| パッケージ管理 | pnpm workspace（`packages/server`, `packages/web`） | 1 リポジトリで 2 パッケージ。共有コードは必要になった時点で `packages/shared` を切る |
| バックエンド   | Fastify 5 + zod                                     | 軽量。zod で環境変数・API 入出力を検証                                               |
| フロントエンド | Vite + React 18                                     | 資料が多く、ドラッグ＆ドロップ・ジェスチャ系ライブラリも選びやすい                   |
| テスト         | Vitest                                              | サーバー・フロント共通                                                               |
| Lint / Format  | ESLint (flat config) + Prettier                     |                                                                                      |
| CI             | GitHub Actions                                      | format / lint / typecheck / test / build と Docker ビルド                            |
| 配布           | Docker（マルチステージ、`node:22-slim`）            | サーバーが `packages/web/dist` を静的配信する 1 コンテナ構成                         |

## 印刷まわり（[実機調査](printer-ts7630.md)で決定）

- **印刷データ**: TS7630 は PDF を受け付けず、`image/pwg-raster` / `image/urf` / `image/jpeg` のみ。**自前でラスタ（PWG Raster、600dpi、sRGB 8bit）を生成し、IPP の Print-Job で直接送る。** コンテナ内 CUPS は使わない。
- **画像生成**: `sharp`（libvips）で 600dpi のページ画像を作り、生の RGB を自前の PWG Raster エンコーダ（ヘッダ 1796 バイト + 行ごとの圧縮）に渡す。
- **IPP クライアント**: 使う操作は Print-Job、Get-Printer-Attributes、Get-Job-Attributes（と Get-Jobs）の少数。属性の組み立てを細かく制御したいので、エンコーダ / デコーダを自前で書く方向（M1 で最終判断）。
- **PDF 生成**: `pdf-lib`。予備のダウンロード専用で、プリンタには送らない。
- **プレビューと印刷の一致**: 編集パラメータ（トリミング位置・倍率・角度・反転・フレーム ID）を共通の型にし、サーバー側で同じ式から画像を生成する。

> 暫定: 試し刷りで画像サイズの解釈と位置を確認するまで確定しない（[printer-ts7630.md](printer-ts7630.md) の「試し刷りで確認すること」）。
