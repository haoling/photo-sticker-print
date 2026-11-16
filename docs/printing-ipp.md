# プリンタへの直接送信（IPP）

写真を割り付けたシートやテスト印刷を、ブラウザの印刷ダイアログを通さずに、サーバーからプリンタへ直接送る。
用紙サイズ・用紙の種類・給紙位置・フチあり／なしも IPP の属性で指定するので、プリンタ側の設定を選ぶ必要がない。

> **状態: 実機では未検証。** 実装は、IPP を話すモックのプリンタ（TS7630 の応答に近いもの）に送って、受け取った PWG Raster の中身（ヘッダと画素）まで確かめている。実際の TS7630 が受け付けて、位置どおりに刷るかは、[試し刷りで確認すること](#実機で確認すること)にある。

## 使い方

1. サーバーを起動して、「写真を割り付け」または「テスト印刷」の画面を開く。
2. 「プリンタに送る」に、プリンタの IP アドレス（またはホスト名）を入れて、**接続を確認**する。機種・状態・はがき（100×148mm）と PWG Raster への対応が出る。IP アドレスは、プリンタの操作パネル・ルーターの DHCP 一覧、または [`tools/find-printer.sh`](../tools/find-printer.sh) で調べる。
3. 印刷の設定を確かめる。既定は用紙定義の推奨設定（用紙の種類・給紙位置・フチあり／なし）で、画面で用紙ごとに上書きできる。品質は「きれい」が既定。
4. 写真の割り付けでは、**最終確認の画像を作ってから**送れる（設定や写真が変わると、確認し直しになる）。
5. **プリンタに送る**。ジョブの状態（待機中・印刷中・完了など）が、終わるまで 2 秒おきに更新される。用紙切れ・インク切れ・紙詰まりなどは、理由が日本語で出る。

プリンタのアドレスと、用紙ごとの設定は、ブラウザに保存される。

## しくみ

1. 用紙ぴったり（600dpi、はがきなら 2362×3496 画素）のページ画像を作る（[写真の割り付け](sheet-print.md) / [テスト印刷](test-print.md)と同じ）。
2. RGB 8bit の **PWG Raster**（`image/pwg-raster`、PWG 5102.4）に変換する。ヘッダの用紙の大きさはポイント（はがき 283×420pt）、解像度は 600dpi、色空間は sRGB。
3. IPP の **Print-Job** で、次のジョブ属性と一緒に送る。

   | 属性 | 値 |
   | --- | --- |
   | `media-col` | `media-size`（x/y を 1/100mm で。はがきは 10000×14800）、`media-type`、`media-source`。フチなしのときは、上下左右の `media-*-margin` を 0 にする |
   | `print-quality` | 3 = はやい、4 = 標準、5 = きれい |
   | `printer-resolution` | 600×600 dpi |
   | `print-color-mode` | `color` |
   | `orientation-requested` | portrait（3） |
   | `copies` | 部数 |

4. ジョブ番号（`job-id`）を受け取り、**Get-Job-Attributes** でジョブの状態を、**Get-Printer-Attributes** でプリンタの状態（`printer-state-reasons`）を取る。

IPP のエンコード・デコードと PWG Raster は、依存なしで自前で実装している（`packages/server/src/ipp/`）。使う操作が少なく、属性の組み立てを細かく制御したいため。

通信は、`fetch` ではなく **`node:http`** を使う（寛容な HTTP パーサー）。プリンタの組み込み HTTP サーバーは、要求していないのに `100 Continue` を先に返すことがあり、`fetch`（undici）はそれを不正な応答として「bad response」で切断してしまう（Canon TS7630 で実際に起きた）。

## 送り先の制限

このアプリには認証がなく、「サーバーから指定したホストへ HTTP を送る」ことになる。外のサイトへ向けられないよう、送り先は **LAN 内のアドレスだけ**を受け付ける。

- プライベート IPv4（10.x、172.16〜31.x、192.168.x）、リンクローカル（169.254.x）、ループバック（127.x）
- ドットなしのホスト名、`.local` / `.lan` / `.home.arpa`
- IPv6 と、それ以外のホスト名は拒否する。パスは `/` で始まる英数字と `. _ ~ - /` だけ。

## 用紙の種類（media-type）

用紙定義の `recommendedPrint.mediaType`（`plain`、`photo-gloss`）を、IPP の `media-type` に対応づけている（`plain` → `stationery`、`photo-gloss` → `photographic`）。**これは暫定の対応**で、プリンタが受け付ける値は機種ごとに違う（TS7630 は `com.canon-mtglossy`、`com.canon-mtmat`、`com.canon-mthagakiglossy` など。[docs/printer-ts7630.md](printer-ts7630.md)）。「接続を確認」で出る一覧から、画面で選び直せる。

画面では、用紙の種類を日本語の名前で出す（`packages/web/src/mediaTypes.ts`）。標準の値（`stationery` = 普通紙、`photographic` = 写真用紙、`photographic-glossy` = 写真用紙（光沢）など）は確かな対応。**`com.canon-` で始まる Canon 独自の値は、識別子の名前からの推定**（`mtglossy` = 光沢、`mtmat` = マット、`mtluster` = ラスター、`mthagakiglossy` = 写真はがき 光沢 など）で、Canon の製品名（「写真用紙 光沢 スタンダード」など）との対応は確認していない。そのため、選択肢には元の識別子も添えている（例: 「写真用紙 光沢（com.canon-mtglossy）」）。実際に刷って、用紙に合う値がわかったら、教えてほしい（対応を直す）。

## つながらないとき

画面に出るエラーの原因の目安。

| 表示 | 原因の目安 |
| --- | --- |
| `ECONNREFUSED`（接続を拒否） | ポートが違う、またはプリンタの IPP が無効。ポートは 631、パスは `/ipp/print` が既定 |
| `EHOSTUNREACH` / `ENETUNREACH`（届かない） | 別のネットワークにいる、プリンタの電源が切れている。Docker の通常ネットワークから届かないときは host ネットワーク版で試す |
| 「応答がありません」 | プリンタが省電力で、起きるのに時間がかかっている。もう一度試す |
| 「IPP として読めません」 | ポートやパスが違う（Web 管理画面のポートなど）。`tools/find-printer.sh` で出る IPP URI のポート・パスを使う |
| 「LAN 内のアドレスではありません」 | このアプリが拒否している（[送り先の制限](#送り先の制限)） |

## 実機で確認すること

次のうち、動かなかったものがあれば、教えてほしい（原因の切り分けに使う）。

- [ ] **TS7630 が PWG Raster を受け付けるか。** 受け付けないとき、プリンタは `document-format-error` などのエラーを返すか、ジョブが `aborted` になる。そのときは URF（`image/urf`）への切り替えを検討する。
- [ ] **画像の大きさの解釈。** 用紙ぴったり（2362×3496）で送っている。プリンタが、これをはがき全体と解釈するか、印刷できる範囲（フチあり 2201×3307、フチなし 2494×3661）と解釈するかは、実機でしかわからない。**テスト印刷（枠線）を 26009 に刷って**、枠線の位置・大きさがコマに合うかで確かめる。拡大縮小されていれば、枠が大きく／小さくずれる。
- [ ] **用紙の種類と給紙位置の指定が効くか。** `media-type` の値がプリンタの一覧にないと、無視されるか、エラーになる。
- [ ] **フチなし（上下左右の余白 0）の位置。** フチなしは、用紙より大きい領域に刷って、はみ出した分を捨てる方式なので、用紙の端から画像までの位置がずれうる。
- [ ] **ジョブの状態の取得。** 印刷が終わったジョブは、プリンタが忘れる（`not-found`）ことが多い。画面は、その場合を「終わったようです」と出す。

## API

| | |
| --- | --- |
| `POST /api/printers/probe` | JSON `{ host, port?, path? }`。機種・状態・対応する用紙や形式を返す |
| `POST /api/print/sheet` | [`/api/sheet/render`](sheet-print.md#api) と同じ multipart に、プリンタの設定を足したもの |
| `POST /api/print/test` | JSON `{ paperId, offsetX?, offsetY?, color?, ...プリンタの設定 }`。テスト印刷を送る |
| `GET /api/print/jobs/:jobId?host=&port=&path=` | ジョブとプリンタの状態 |

プリンタの設定（フィールド名はどちらも同じ）: `printerHost`（必須）、`printerPort`、`printerPath`、`mediaType`、`mediaSource`（`auto` / `main` / `rear`）、`borderless`（`true` / `false`）、`quality`（3〜5、既定 5）、`copies`（1〜99）。省略した用紙の種類・給紙位置・フチは、用紙の推奨設定になる。

- 送信に成功すると `{ target, warnings, job: { jobId, state, raster } }`。プリンタが断ったとき・つながらないときは 502、LAN 外の送り先や不正な入力は 400。
- ジョブの状態は `state`（`pending` / `held` / `processing` / `stopped` / `canceled` / `aborted` / `completed`）、`stateReasons`、`printerStateReasons`、`final`（これ以降は変わらない）。
