import sharp from 'sharp';
import {
  buildJobAttributes,
  encodePwgRaster,
  printJob,
  type PrinterTarget,
  type SubmittedJob,
} from '../ipp/index.js';
import type { Paper } from '../papers/schema.js';
import { pageSizePx } from './testPrint.js';

export interface SendOptions {
  mediaType?: string;
  mediaSource?: string;
  borderless: boolean;
  /** 3 = draft, 4 = normal, 5 = high */
  quality: number;
  copies: number;
}

export interface SentJob extends SubmittedJob {
  raster: { widthPx: number; heightPx: number; bytes: number };
}

const DPI = 600; // TS7630 は 600dpi のみ対応

/**
 * 用紙ぴったり（600dpi）のページ画像（PNG）を PWG Raster にして、IPP の Print-Job で送る。
 * 画像の大きさは用紙そのもの（はがきなら 2362 × 3496）。プリンタが用紙全体をどう解釈するかは
 * 実機で確認が要る（docs/printer-ts7630.md の「試し刷りで確認すること」）。
 */
export async function sendPageToPrinter(
  target: PrinterTarget,
  paper: Paper,
  png: Buffer,
  options: SendOptions,
  jobName: string,
): Promise<SentJob> {
  const { widthPx, heightPx } = pageSizePx(paper, DPI);
  const { data, info } = await sharp(png)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== widthPx || info.height !== heightPx || info.channels !== 3) {
    throw new RangeError(
      `ページ画像の大きさが用紙と合いません（${info.width}×${info.height}、期待 ${widthPx}×${heightPx}）`,
    );
  }
  const ptPerMm = 72 / 25.4;
  const raster = encodePwgRaster([
    {
      rgb: data,
      width: widthPx,
      height: heightPx,
      dpi: DPI,
      pageWidthPt: paper.sheet.widthMm * ptPerMm,
      pageHeightPt: paper.sheet.heightMm * ptPerMm,
      mediaType: options.mediaType,
      quality: options.quality,
      copies: options.copies,
    },
  ]);
  const job = await printJob(target, {
    jobName,
    documentFormat: 'image/pwg-raster',
    data: raster,
    jobAttributes: buildJobAttributes({
      paperWidthMm: paper.sheet.widthMm,
      paperHeightMm: paper.sheet.heightMm,
      ...options,
      dpi: DPI,
    }),
  });
  return { ...job, raster: { widthPx, heightPx, bytes: raster.length } };
}
