# Canon PIXUS TS7630 の IPP 対応状況

> **状態: IPP 属性の調査は完了。試し刷りは未実施**（下の「試し刷りで確認すること」）。
> 調査日: 2026-11-16 / ファームウェア表記 `VER:1.070`。IP アドレスと `printer-uuid` は個人環境の情報なので、このファイルには書かない。

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

## 結果

`tools/probe-printer.sh` の出力（`get-printer-attributes`、`media-col-database` 付きで要求）から転記。

| 項目 | 属性名 | 結果 |
| --- | --- | --- |
| 機種名 | `printer-make-and-model` | `Canon TS7630 series` |
| IPP の URI | `printer-uri-supported` | `ipp://<IP>:631/ipp/print`（TLS: `ipps://` も可）。`ipp://<IP>:631/` でも応答した |
| IPP バージョン | `ipp-versions-supported` | 1.1, 2.0 |
| 対応機能 | `ipp-features-supported`, `mopria-certified` | `airprint-2.1`, `ipp-everywhere`, Mopria 2.2 |
| 認証 | `uri-authentication-supported` | なし |
| 受け付けるデータ形式 | `document-format-supported` | `application/octet-stream`, `image/jpeg`, `image/urf`, `image/pwg-raster`（**PDF は不可**） |
| プリンタが推奨する形式 | `document-format-preferred` | `image/urf` |
| URF | `urf-supported` | `V1.5,CP1,PQ3-5,RS600,SRGB24,W8,OB9,OFU0,DM3,IS1-18`（600dpi、sRGB 24bit のみ） |
| PWG Raster | `pwg-raster-document-*` | 600dpi、`srgb_8` / `sgray_8` |
| 解像度 | `printer-resolution-supported` | 600dpi のみ |
| 品質 | `print-quality-supported` | 3（draft）, 4（normal）, 5（high） |
| 色 | `print-color-mode-supported` | color, monochrome, auto, auto-monochrome |
| 用紙サイズ | `media-supported` | **`jpn_hagaki_100x148mm` あり**（A4、L 判、4x6、5x7、封筒類、`custom_min_55x89mm`〜`custom_max_215.9x676mm` など） |
| 用紙種類 | `media-type-supported` | `com.canon-mtglossy`, `com.canon-mtluster`, `com.canon-mtplatinum`, `com.canon-mtmat`, `com.canon-mthagaki`, `com.canon-mthagakiglossy`, `com.canon-mthagakiglossya`, `com.canon-mtsemisuper`, `com.canon-mthires`, `stationery`, `photographic`, `auto` ほか |
| 給紙位置 | `media-source-supported` | `auto`, `main`（カセット）, `rear`（後トレイ） |
| `media-col` で指定できる項目 | `media-col-supported` | `media-size`, `media-type`, `media-source`, 上下左右の `media-*-margin` |
| ジョブで指定できる属性 | `job-creation-attributes-supported` | copies, sides, orientation-requested, media, media-col, print-quality, printer-resolution, print-color-mode, print-content-optimize(auto のみ), print-rendering-intent(auto, perceptual), job-name ほか |
| 向き | `orientation-requested-supported` | portrait のみ |
| インク残量 | `marker-levels` ほか | 取得できる（5 色） |
| 状態 | `printer-state`, `printer-state-reasons` | 取得できる（用紙切れ等の表示に使える） |
| `media-col-database` | | 出力が空だった（取得できていない）。用紙種類×サイズの組み合わせの許可範囲は未確認 |

### フチなしの指定方法

IPP の標準どおり、`media-col` の上下左右マージンを **0** にするとフチなしになる（`media-col-ready` に A4 と 5x7 のマージン 0 の組が載っている）。

はがき（`jpn_hagaki_100x148mm`）の印刷可能領域（Canon 独自の `ivec:` 拡張情報から。600dpi の画素数）:

| モード | 画素数 | 大きさ | 余白（mm） |
| --- | --- | --- | --- |
| フチあり | 2201 × 3307 | 約 93.2 × 140.0 mm | 3.4 / 3.4（左右）、3 / 5（上下） |
| フチなし | 2494 × 3661 | 約 105.6 × 155.1 mm | 用紙より左右 2.8mm ずつ、上 2mm、下 5mm はみ出す |

- フチなしは用紙より大きい領域に刷って、はみ出した分を捨てる方式。つまり**用紙の端から画像までの位置関係は、フチなし拡張量（既定 `borderlessextension=3`）の分だけずれる**。シールの位置合わせに直接効くので、試し刷りで実測する。
- 上下のどちらが 3mm / 5mm かは、数値の並び順（上, 左, 下, 右と推測）から読んだだけで未確認。
- フチなし拡張量は `borderlessextension` 0〜3 の 4 段階があるが、IPP から変えられるかは不明。

## 試し刷りで確認すること

- [ ] 3 とおりの画像サイズのどれがはがきに正しく載るか（PWG Raster のページ寸法の解釈）
  - 用紙ぴったり 2362 × 3496
  - フチなし領域 2494 × 3661
  - フチあり領域 2201 × 3307
- [ ] 目盛り入りのテスト画像で、用紙の端から画像までの位置（mm）を実測する
- [ ] はがき + 後トレイ + 光沢系の用紙種類をどれにするとシール用紙に合うか（`com.canon-mtglossy` / `mthagakiglossy` / `mtluster` などを比較）
- [ ] フチあり印刷でコマが印刷可能領域に収まるか（29662 のコマ位置は M1 で確定）
- [ ] 同じ内容を PWG Raster と URF で送って、結果に差が出ないか

## 結論

- **PDF は使えない。ラスタ形式（PWG Raster または URF）を自前で生成して IPP で直接送る。コンテナ内 CUPS は使わない。**
  - 理由: ページ寸法・解像度・余白を自分で完全に決められる。CUPS を挟むと、フィルタやドライバによる拡大縮小・余白の再計算が入り、位置ズレの原因が増える。
  - 第一候補は `image/pwg-raster`（600dpi、`srgb_8`）。IPP Everywhere / Mopria の必須形式で仕様が公開されている。
  - `image/urf`（プリンタの推奨形式）は同じ構造の代替手段。PWG Raster で問題が出たら切り替える。
  - `image/jpeg` は動作確認用。ページ寸法を自分で指定できないので本番には使わない。
- PDF は「プリンタに届かない環境向けの予備のダウンロード」としてだけ残す（OS のドライバ経由で印刷する用）。
- **この結論は暫定。** 試し刷りで画像サイズの解釈と位置を確かめるまで確定しない（M1 の最初の作業）。
