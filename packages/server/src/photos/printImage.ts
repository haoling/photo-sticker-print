import sharp from 'sharp';
import { cropRect, type CellEdit } from '../print/cellEdit.js';
import type { ImageData, PhotoStorage } from './storage.js';

/** 印刷に使う写真は、これ以上の解像度を目安にする（要件: 300dpi 以上相当） */
export const MIN_PRINT_DPI = 300;

export interface PrintImage {
  image: Buffer;
  /** どちらの画像を使ったか */
  source: 'preview' | 'original';
  /** 敷く範囲での解像度（切り抜いたあとの画素数 ÷ 敷く幅） */
  dpi: number;
}

/** 写真を box（mm）に敷いたときの解像度。sharp が読めない画像は例外になる */
async function effectiveDpi(
  image: Buffer,
  boxMm: { w: number; h: number },
  edit: CellEdit,
): Promise<number> {
  const meta = await sharp(image, { failOn: 'error' }).metadata();
  if (!meta.width || !meta.height) throw new Error('写真の大きさがわかりません');
  const swap = (meta.orientation ?? 1) >= 5; // EXIF の向きが 5〜8 のとき、縦横が入れ替わる
  const size = swap ? { w: meta.height, h: meta.width } : { w: meta.width, h: meta.height };
  return cropRect(size, boxMm, edit).width / (boxMm.w / 25.4);
}

/**
 * フォトストレージから、印刷に使う画像を取る。
 * 基本はプレビュー画像（向きを反映済みで、HEIC なども変換済み）。解像度が足りないときだけ元のファイルを取り、
 * 読めて、プレビューより細かければそちらを使う（読めない形式ならプレビューのまま）。
 *
 * 最終確認と印刷で同じ写真を続けて取るので、取った画像をしばらくメモリに持つ（maxCacheBytes まで）。
 */
export class PrintImageLoader {
  private readonly cache = new Map<string, ImageData>();
  private cacheBytes = 0;

  constructor(
    private readonly storage: PhotoStorage,
    private readonly maxCacheBytes = 200 * 1024 * 1024,
  ) {}

  private async fetch(kind: 'preview' | 'original', id: string): Promise<Buffer> {
    const key = `${kind}:${id}`;
    const hit = this.cache.get(key);
    if (hit) {
      // 使ったものを末尾へ（古いものから捨てる）
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit.data;
    }
    const got =
      kind === 'preview' ? await this.storage.getPreview(id) : await this.storage.getOriginal(id);
    if (got.data.length <= this.maxCacheBytes / 4 && !this.cache.has(key)) {
      this.cache.set(key, got);
      this.cacheBytes += got.data.length;
      for (const [k, v] of this.cache) {
        if (this.cacheBytes <= this.maxCacheBytes) break;
        this.cache.delete(k);
        this.cacheBytes -= v.data.length;
      }
    }
    return got.data;
  }

  async load(id: string, boxMm: { w: number; h: number }, edit: CellEdit): Promise<PrintImage> {
    const preview = await this.fetch('preview', id);
    const previewDpi = await effectiveDpi(preview, boxMm, edit);
    if (previewDpi >= MIN_PRINT_DPI) return { image: preview, source: 'preview', dpi: previewDpi };
    try {
      const original = await this.fetch('original', id);
      const dpi = await effectiveDpi(original, boxMm, edit);
      if (dpi > previewDpi) {
        // 大きさは読めても中身を読めない形式がある（HEIC など）ので、実際に読んで確かめる
        await sharp(original, { failOn: 'error' })
          .resize(16, 16, { fit: 'inside' })
          .raw()
          .toBuffer();
        return { image: original, source: 'original', dpi };
      }
    } catch {
      /* 元のファイルが取れない・読めないときは、プレビューを使う */
    }
    return { image: preview, source: 'preview', dpi: previewDpi };
  }
}
