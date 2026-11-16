# Canon PIXUS TS7630 の IPP 対応状況

> **状態: 未調査。** 実機に届く環境で `tools/probe-printer.sh` を実行し、結果をこのファイルに転記する。

## 0. プリンタの IP を探す

host ネットワークの Docker コンテナで mDNS を引き、LAN 内のプリンタを一覧する（Linux の Docker 向け）。

```bash
tools/find-printer.sh
```

機種名・IP・IPP URI・UUID が表示される。見つからないときは、Docker Desktop（Mac / Windows）では mDNS が届かないので、ルーターの DHCP 一覧かプリンタの操作パネルで IP を確認する。

## 1. IPP の対応状況を調べる

プリンタと同じ LAN にあるマシンで実行する（Docker が使えれば `ipptool` のインストールは不要）。

```bash
tools/probe-printer.sh <プリンタのIPアドレス>
```

- 全属性が `tools/probe-out/attributes.txt` に保存される（Git 管理外。必要な部分だけ下の表に写す）
- 重要な属性は実行後に標準出力へ抜粋される
- ipptool を直接使う場合: `IPPTOOL=ipptool tools/probe-printer.sh <IP>`

## 結果（実機調査後に記入）

| 項目                                      | 属性名                                                      | 結果 |
| ----------------------------------------- | ----------------------------------------------------------- | ---- |
| 機種名                                    | `printer-make-and-model`                                    |      |
| 一意な ID（再探索に使う）                 | `printer-uuid`                                              |      |
| 受け付けるデータ形式                      | `document-format-supported`                                 |      |
| URF / PWG Raster の対応                   | `urf-supported`, `pwg-raster-document-resolution-supported` |      |
| 用紙サイズ（はがき 100×148mm）            | `media-supported`                                           |      |
| 用紙種類（写真用紙・光沢など）            | `media-type-supported` / `media-col-database`               |      |
| フチなし（マージン 0 の用紙定義があるか） | `media-*-margin-supported`, `media-col-database`            |      |
| 給紙位置（後トレイ / カセット）           | `media-source-supported`                                    |      |
| 品質                                      | `print-quality-supported`                                   |      |
| 解像度                                    | `printer-resolution-supported`                              |      |
| IPP のパス（`ipp://<IP>:631/...`）        |                                                             |      |

## 試し刷りで確認すること

- [ ] はがき + 写真用紙 + フチなしを IPP 属性で指定して印刷できるか
- [ ] フチあり印刷時の印刷可能領域（上下左右のマージン mm）
- [ ] 後トレイからの給紙指定が効くか

## 結論（実機調査後に記入）

- 印刷データの変換方式: （未定）
