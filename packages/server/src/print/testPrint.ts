import { crc32 } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { computeCells, isPrintable } from '../papers/geometry.js';
import type { Paper } from '../papers/schema.js';

export interface TestPrintOptions {
  /**
   * 位置補正（mm）。描く位置にそのまま足す（+X は右、+Y は下）。
   * 印刷が期待より左にずれて出るなら +X、上にずれるなら +Y を指定する。
   */
  offsetXMm?: number;
  offsetYMm?: number;
  /** 出力解像度。TS7630 は 600dpi のみ対応 */
  dpi?: number;
  /** 枠線の太さ（mm） */
  lineWidthMm?: number;
  /** 枠線の色。#rrggbb（既定は黒）。黒以外は RGB の PNG になる */
  lineColor?: string;
}

export const DEFAULT_LINE_COLOR = '#000000';
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export class UnmeasuredPaperError extends Error {
  constructor(id: string) {
    super(`${id}: コマ位置が未測定のため、テスト印刷は作れません`);
    this.name = 'UnmeasuredPaperError';
  }
}

const MM_PER_INCH = 25.4;

/** 用紙の実寸に対するピクセル数（600dpi のはがきなら 2362 × 3496） */
export function pageSizePx(paper: Paper, dpi = 600) {
  return {
    widthPx: Math.round((paper.sheet.widthMm / MM_PER_INCH) * dpi),
    heightPx: Math.round((paper.sheet.heightMm / MM_PER_INCH) * dpi),
  };
}

const num = (n: number) => Number(n.toFixed(4)).toString();

/**
 * コマの輪郭だけを描いた SVG。座標系は mm（viewBox）、原点は用紙の左上。
 * 文字は使わない（実行環境にフォントが無くても同じに出るように）。
 */
export function buildTestPrintSvg(paper: Paper, opts: TestPrintOptions = {}): string {
  if (!isPrintable(paper)) throw new UnmeasuredPaperError(paper.id);
  const {
    offsetXMm = 0,
    offsetYMm = 0,
    dpi = 600,
    lineWidthMm = 0.15,
    lineColor = DEFAULT_LINE_COLOR,
  } = opts;
  if (!HEX_COLOR.test(lineColor))
    throw new RangeError(`線の色は #rrggbb で指定してください: ${lineColor}`);
  const { widthPx, heightPx } = pageSizePx(paper, dpi);
  const { widthMm, heightMm } = paper.sheet;

  const rects = computeCells(paper).map((c) => {
    // 線の太さの半分だけ内側に寄せて、線の外側がコマの端に一致するようにする
    const half = lineWidthMm / 2;
    const r = Math.max(0, c.cornerRadiusMm - half);
    return (
      `<rect x="${num(c.xMm + offsetXMm + half)}" y="${num(c.yMm + offsetYMm + half)}" ` +
      `width="${num(c.widthMm - lineWidthMm)}" height="${num(c.heightMm - lineWidthMm)}" ` +
      `rx="${num(r)}" ry="${num(r)}"/>`
    );
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" ` +
    `viewBox="0 0 ${num(widthMm)} ${num(heightMm)}">` +
    `<rect width="${num(widthMm)}" height="${num(heightMm)}" fill="#fff"/>` +
    `<g fill="none" stroke="${lineColor.toLowerCase()}" stroke-width="${num(lineWidthMm)}">${rects.join('')}</g>` +
    `</svg>`
  );
}

/**
 * PNG に解像度（pHYs チャンク）を書き込む。sharp の withMetadata は
 * グレースケールを RGB に戻してしまうので使わず、IHDR の直後へ自前で挿入する。
 */
function withPngDensity(png: Buffer, dpi: number): Buffer {
  const ihdrEnd = 8 + 4 + 4 + 13 + 4; // シグネチャ + IHDR チャンク（長さ・種別・本体・CRC）
  const data = Buffer.alloc(9);
  const pxPerMeter = Math.round(dpi / 0.0254);
  data.writeUInt32BE(pxPerMeter, 0);
  data.writeUInt32BE(pxPerMeter, 4);
  data.writeUInt8(1, 8); // 単位: メートル
  const body = Buffer.concat([Buffer.from('pHYs'), data]);
  const chunk = Buffer.alloc(4 + body.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), 4 + body.length);
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)]);
}

/** 白地に枠線の PNG。黒なら 8bit グレースケール、それ以外の色は RGB。dpi をメタデータにも入れる。 */
export async function renderTestPrintPng(
  paper: Paper,
  opts: TestPrintOptions = {},
): Promise<Buffer> {
  const { dpi = 600 } = opts;
  const { widthPx, heightPx } = pageSizePx(paper, dpi);
  const flat = sharp(Buffer.from(buildTestPrintSvg(paper, opts)))
    .resize(widthPx, heightPx)
    .flatten({ background: '#fff' });
  const isBlack = (opts.lineColor ?? DEFAULT_LINE_COLOR).toLowerCase() === DEFAULT_LINE_COLOR;
  const png = await (isBlack ? flat.toColourspace('b-w') : flat).png().toBuffer();
  return withPngDensity(png, dpi);
}

/** 用紙と同じ大きさ（1 ページ）の PDF。「実際のサイズ（100%）」で印刷すること。 */
export async function renderTestPrintPdf(
  paper: Paper,
  opts: TestPrintOptions = {},
): Promise<Uint8Array> {
  const png = await renderTestPrintPng(paper, opts);
  const doc = await PDFDocument.create();
  const ptPerMm = 72 / MM_PER_INCH;
  const page = doc.addPage([paper.sheet.widthMm * ptPerMm, paper.sheet.heightMm * ptPerMm]);
  const image = await doc.embedPng(png);
  page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  doc.setTitle(`テスト印刷 ${paper.id}`);
  return doc.save();
}
