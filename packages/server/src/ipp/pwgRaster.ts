/**
 * PWG Raster（PWG 5102.4）のエンコード。IPP Everywhere / AirPrint / Mopria のプリンタが
 * 受け付ける、ページ寸法・解像度を自分で決められるラスタ形式（`image/pwg-raster`）。
 *
 * 構造: 同期ワード "RaS2" + ページごとに [ヘッダ 1796 バイト + 圧縮した画素]。数値はすべてビッグエンディアン。
 * 圧縮: 1 行ごとに、行の繰り返し回数 - 1（1 バイト）+ PackBits 風の画素の列。
 *   n = 0〜127: 次の 1 画素を n+1 回繰り返す / n = 129〜255: 続く (257-n) 画素をそのまま / n = 128: 行の残りを白で埋める
 */

export const PWG_HEADER_SIZE = 1796;
export const PWG_SYNC_WORD = 'RaS2';

/** cupsColorSpace の値（sRGB = 19、sGray = 18） */
const CSPACE_SRGB = 19;

export interface PwgPage {
  /** 8bit RGB、行の順に詰めたもの（width × height × 3 バイト） */
  rgb: Buffer;
  width: number;
  height: number;
  dpi: number;
  /** 用紙の大きさ（ポイント。1/72 インチ） */
  pageWidthPt: number;
  pageHeightPt: number;
  /** ヘッダの MediaType（IPP の media-type と同じ文字列） */
  mediaType?: string;
  /** 3 = draft, 4 = normal, 5 = high（0 = 指定なし） */
  quality?: number;
  copies?: number;
}

// ヘッダのフィールドの位置（バイト）
const OFFSET = {
  mediaClass: 0,
  mediaColor: 64,
  mediaType: 128,
  printContentType: 192,
  cutMedia: 268,
  duplex: 272,
  hwResolution: 276,
  numCopies: 340,
  orientation: 344,
  pageSize: 352,
  tumble: 368,
  width: 372,
  height: 376,
  bitsPerColor: 384,
  bitsPerPixel: 388,
  bytesPerLine: 392,
  colorOrder: 396,
  colorSpace: 400,
  numColors: 420,
  totalPageCount: 452,
  crossFeedTransform: 456,
  feedTransform: 460,
  imageBoxRight: 472,
  imageBoxBottom: 476,
  alternatePrimary: 480,
  printQuality: 484,
  renderingIntent: 1668,
  pageSizeName: 1732,
} as const;

function writeHeader(p: PwgPage): Buffer {
  const h = Buffer.alloc(PWG_HEADER_SIZE);
  const str = (offset: number, s: string) => h.write(s, offset, 63, 'latin1');
  const u32 = (offset: number, v: number) => h.writeUInt32BE(v, offset);

  str(OFFSET.mediaClass, 'PwgRaster');
  str(OFFSET.mediaType, p.mediaType ?? '');
  str(OFFSET.printContentType, 'Photo');
  u32(OFFSET.cutMedia, 0);
  u32(OFFSET.duplex, 0);
  u32(OFFSET.hwResolution, p.dpi);
  u32(OFFSET.hwResolution + 4, p.dpi);
  u32(OFFSET.numCopies, p.copies ?? 1);
  u32(OFFSET.orientation, 0); // portrait
  u32(OFFSET.pageSize, Math.round(p.pageWidthPt));
  u32(OFFSET.pageSize + 4, Math.round(p.pageHeightPt));
  u32(OFFSET.tumble, 0);
  u32(OFFSET.width, p.width);
  u32(OFFSET.height, p.height);
  u32(OFFSET.bitsPerColor, 8);
  u32(OFFSET.bitsPerPixel, 24);
  u32(OFFSET.bytesPerLine, p.width * 3);
  u32(OFFSET.colorOrder, 0); // chunky（RGBRGB…）
  u32(OFFSET.colorSpace, CSPACE_SRGB);
  u32(OFFSET.numColors, 3);
  u32(OFFSET.totalPageCount, 0); // 不明
  u32(OFFSET.crossFeedTransform, 1);
  u32(OFFSET.feedTransform, 1);
  u32(OFFSET.imageBoxRight, p.width);
  u32(OFFSET.imageBoxBottom, p.height);
  u32(OFFSET.alternatePrimary, 0xffffff);
  u32(OFFSET.printQuality, p.quality ?? 0);
  str(OFFSET.renderingIntent, 'perceptual');
  return h;
}

/** 1 行を PackBits 風に圧縮する */
function compressLine(line: Buffer, bpp: number, out: number[]) {
  const pixels = line.length / bpp;
  const same = (a: number, b: number) => {
    for (let k = 0; k < bpp; k++) if (line[a * bpp + k] !== line[b * bpp + k]) return false;
    return true;
  };
  const pushPixel = (i: number) => {
    for (let k = 0; k < bpp; k++) out.push(line[i * bpp + k]!);
  };

  let i = 0;
  while (i < pixels) {
    // 同じ画素が続く長さ（最大 128）
    let run = 1;
    while (i + run < pixels && run < 128 && same(i, i + run)) run++;
    if (run > 1) {
      out.push(run - 1);
      pushPixel(i);
      i += run;
      continue;
    }
    // 異なる画素が続く区間（最大 128。次が 2 画素以上の繰り返しになる手前まで）
    let lit = 1;
    while (i + lit < pixels && lit < 128 && !(i + lit + 1 < pixels && same(i + lit, i + lit + 1)))
      lit++;
    if (lit === 1) {
      out.push(0); // 1 画素 = 「1 回の繰り返し」
      pushPixel(i);
    } else {
      out.push(257 - lit);
      for (let k = 0; k < lit; k++) pushPixel(i + k);
    }
    i += lit;
  }
}

/** ページを圧縮した画素のデータにする（行の繰り返しは最大 256 行まとめる） */
function compressPage(p: PwgPage): Buffer {
  const bpp = 3;
  const stride = p.width * bpp;
  if (p.rgb.length !== stride * p.height) {
    throw new RangeError(
      `画素データの大きさが合いません（${p.rgb.length} バイト、期待 ${stride * p.height} バイト）`,
    );
  }
  const out: number[] = [];
  let y = 0;
  while (y < p.height) {
    const line = p.rgb.subarray(y * stride, (y + 1) * stride);
    let repeat = 1;
    while (
      y + repeat < p.height &&
      repeat < 256 &&
      line.equals(p.rgb.subarray((y + repeat) * stride, (y + repeat + 1) * stride))
    ) {
      repeat++;
    }
    out.push(repeat - 1);
    compressLine(line, bpp, out);
    y += repeat;
  }
  return Buffer.from(out);
}

export function encodePwgRaster(pages: PwgPage[]): Buffer {
  return Buffer.concat([
    Buffer.from(PWG_SYNC_WORD, 'latin1'),
    ...pages.flatMap((p) => [writeHeader(p), compressPage(p)]),
  ]);
}

// ---------- デコード（テストと診断用） ----------

export interface DecodedPwgPage {
  header: {
    mediaClass: string;
    mediaType: string;
    hwResolution: [number, number];
    numCopies: number;
    pageSize: [number, number];
    width: number;
    height: number;
    bitsPerPixel: number;
    bytesPerLine: number;
    colorSpace: number;
    numColors: number;
    printQuality: number;
  };
  rgb: Buffer;
}

export function decodePwgRaster(buf: Buffer): DecodedPwgPage[] {
  if (buf.subarray(0, 4).toString('latin1') !== PWG_SYNC_WORD) {
    throw new Error('PWG Raster の同期ワード（RaS2）がありません');
  }
  const pages: DecodedPwgPage[] = [];
  let pos = 4;
  while (pos < buf.length) {
    const h = buf.subarray(pos, pos + PWG_HEADER_SIZE);
    if (h.length < PWG_HEADER_SIZE) throw new Error('ヘッダが途中で終わっています');
    pos += PWG_HEADER_SIZE;
    const str = (o: number) => h.toString('latin1', o, o + 64).replace(/\0.*$/s, '');
    const u32 = (o: number) => h.readUInt32BE(o);
    const header = {
      mediaClass: str(OFFSET.mediaClass),
      mediaType: str(OFFSET.mediaType),
      hwResolution: [u32(OFFSET.hwResolution), u32(OFFSET.hwResolution + 4)] as [number, number],
      numCopies: u32(OFFSET.numCopies),
      pageSize: [u32(OFFSET.pageSize), u32(OFFSET.pageSize + 4)] as [number, number],
      width: u32(OFFSET.width),
      height: u32(OFFSET.height),
      bitsPerPixel: u32(OFFSET.bitsPerPixel),
      bytesPerLine: u32(OFFSET.bytesPerLine),
      colorSpace: u32(OFFSET.colorSpace),
      numColors: u32(OFFSET.numColors),
      printQuality: u32(OFFSET.printQuality),
    };
    const bpp = header.bitsPerPixel / 8;
    const rgb = Buffer.alloc(header.bytesPerLine * header.height, 0xff);
    let y = 0;
    while (y < header.height) {
      const repeat = buf[pos++]! + 1;
      const line = Buffer.alloc(header.bytesPerLine, 0xff);
      let x = 0; // バイト位置
      while (x < header.bytesPerLine) {
        const n = buf[pos++]!;
        if (n <= 127) {
          const px = buf.subarray(pos, pos + bpp);
          pos += bpp;
          for (let k = 0; k <= n && x < header.bytesPerLine; k++, x += bpp) px.copy(line, x);
        } else if (n === 128) {
          x = header.bytesPerLine; // 残りは白（0xff）
        } else {
          const count = 257 - n;
          buf.copy(line, x, pos, pos + count * bpp);
          pos += count * bpp;
          x += count * bpp;
        }
      }
      for (let r = 0; r < repeat && y < header.height; r++, y++)
        line.copy(rgb, y * header.bytesPerLine);
    }
    pages.push({ header, rgb });
  }
  return pages;
}
