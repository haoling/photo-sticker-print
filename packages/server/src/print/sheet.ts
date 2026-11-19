import { PDFDocument } from 'pdf-lib';
import sharp, { type OverlayOptions } from 'sharp';
import { computeCells } from '../papers/geometry.js';
import type { Paper } from '../papers/schema.js';
import { cropRect, DEFAULT_EDIT, isDefaultEdit, type CellEdit } from './cellEdit.js';
import { DEFAULT_BLEED_MM, MAX_BLEED_MM } from './printable.js';
import { pageSizePx, withPngDensity } from './testPrint.js';

export interface SheetCellImage {
  /** コマの番号（0 始まり。上の段から、左の列から） */
  cellIndex: number;
  /** 元の写真（JPEG / PNG / WebP など sharp が読める形式） */
  image: Buffer;
  /** 拡大・位置・回転・左右反転。省略すると、中央を基準に枠いっぱいに敷く */
  edit?: CellEdit;
}

export interface SheetOptions {
  /** 塗り足し（mm）。コマの外側へ写真をはみ出させる量 */
  bleedMm?: number;
  /** 位置補正（mm）。描く位置にそのまま足す（+X は右、+Y は下） */
  offsetXMm?: number;
  offsetYMm?: number;
  dpi?: number;
  /** true のとき、コマの輪郭（実線）と塗り足しの範囲（破線）を重ねる。確認用で、印刷には使わない */
  guides?: boolean;
}

/** 写真を読めなかったとき。どのコマの写真かを持つ。 */
export class SheetImageError extends Error {
  constructor(
    public readonly cellIndex: number,
    cause: unknown,
  ) {
    super(`コマ ${cellIndex + 1} の写真を読めませんでした: ${(cause as Error).message}`);
    this.name = 'SheetImageError';
  }
}

const num = (n: number) => Number(n.toFixed(4)).toString();

/** 塗り足しの範囲（コマを bleed だけ外へ広げた角丸四角形）の位置と大きさ（mm） */
export function bleedRect(
  cell: { xMm: number; yMm: number; widthMm: number; heightMm: number; cornerRadiusMm: number },
  bleedMm: number,
  offsetXMm = 0,
  offsetYMm = 0,
) {
  return {
    xMm: cell.xMm + offsetXMm - bleedMm,
    yMm: cell.yMm + offsetYMm - bleedMm,
    widthMm: cell.widthMm + 2 * bleedMm,
    heightMm: cell.heightMm + 2 * bleedMm,
    // 角のないコマは、広げても角のないまま
    cornerRadiusMm: cell.cornerRadiusMm > 0 ? cell.cornerRadiusMm + bleedMm : 0,
  };
}

/**
 * 写真に編集（回転・反転・拡大・位置）を適用して、塗り足しを含む範囲に敷く元の画像（PNG）にする。
 * 既定の編集なら、EXIF の向きを反映するだけにして、あとの resize（cover）に任せる。
 * （縮小読み込みが効くので速く、仕上がりは同じ）
 */
async function oriented(
  image: Buffer,
  box: { width: number; height: number },
  edit: CellEdit,
): Promise<Buffer> {
  if (isDefaultEdit(edit)) return sharp(image, { failOn: 'error' }).autoOrient().toBuffer();

  const meta = await sharp(image, { failOn: 'error' }).metadata();
  if (!meta.width || !meta.height) throw new Error('写真の大きさがわかりません');
  const flipped = (meta.orientation ?? 1) >= 5; // EXIF の向きが 5〜8 のとき、縦横が入れ替わる
  const imgSize = flipped ? { w: meta.height, h: meta.width } : { w: meta.width, h: meta.height };
  const r = cropRect(imgSize, { w: box.width, h: box.height }, edit);

  let pipeline = sharp(image, { failOn: 'error' }).autoOrient();
  if (edit.flipH) {
    // sharp は、呼ぶ順番に関係なく、左右反転を回転より先に行う。「回転してから反転」と同じ結果にするため、
    // 反転してから逆向きに回す（反転と回転は、回す向きを逆にすると順番を入れ替えられる）。
    pipeline = pipeline.flop();
    const angle = (360 - edit.rotation) % 360;
    if (angle) pipeline = pipeline.rotate(angle);
  } else if (edit.rotation) {
    pipeline = pipeline.rotate(edit.rotation);
  }
  const x = axis(r.left, r.width, r.orientedW);
  const y = axis(r.top, r.height, r.orientedH);
  pipeline = pipeline.extract({ left: x.src, top: y.src, width: x.len, height: y.len });
  if (x.before || x.after || y.before || y.after) {
    // 縮小したとき、写真のない部分は白にする
    pipeline = pipeline.extend({
      left: x.before,
      right: x.after,
      top: y.before,
      bottom: y.after,
      background: '#ffffff',
    });
  }
  return pipeline.toBuffer();
}

/**
 * 窓（start から size、画素）を、写真（total 画素）から切り出す範囲と、足りない分の余白に分ける。
 * 窓が写真に収まるときは余白なし（丸めで端をはみ出さないよう、切り出しの幅で調整する）。
 */
function axis(start: number, size: number, total: number) {
  if (size <= total) {
    const src = Math.min(Math.round(start), total - 1);
    return {
      src,
      len: Math.max(1, Math.min(Math.round(size), total - src)),
      before: 0,
      after: 0,
    };
  }
  const winStart = Math.round(start);
  const winLen = Math.round(size);
  const src = Math.max(0, winStart);
  const end = Math.min(total, winStart + winLen);
  return {
    src,
    len: Math.max(1, end - src),
    before: src - winStart,
    after: winStart + winLen - Math.max(end, src + 1),
  };
}

function normalizeOptions(opts: SheetOptions) {
  const {
    bleedMm = DEFAULT_BLEED_MM,
    offsetXMm = 0,
    offsetYMm = 0,
    dpi = 600,
    guides = false,
  } = opts;
  if (!(bleedMm >= 0 && bleedMm <= MAX_BLEED_MM)) {
    throw new RangeError(`塗り足しは 0〜${MAX_BLEED_MM}mm で指定してください: ${bleedMm}`);
  }
  return { bleedMm, offsetXMm, offsetYMm, dpi, guides };
}

/**
 * 写真を割り付けたシートの画像（白地、RGB の PNG）を作る。
 * 写真は塗り足しを含めた範囲いっぱいに、中央を基準に切り抜いて（cover）敷く。
 * コマに見える部分はその中央なので、塗り足しの分だけ周りが少し多めに切り落とされる。
 */
export async function renderSheetPng(
  paper: Paper,
  images: SheetCellImage[],
  opts: SheetOptions = {},
): Promise<Buffer> {
  const { bleedMm, offsetXMm, offsetYMm, dpi, guides } = normalizeOptions(opts);
  const { widthPx, heightPx } = pageSizePx(paper, dpi);
  const pxPerMm = dpi / 25.4;
  const cells = computeCells(paper);

  const composites: OverlayOptions[] = [];
  for (const { cellIndex, image, edit } of images) {
    const cell = cells[cellIndex];
    if (!cell) throw new RangeError(`コマ ${cellIndex + 1} はこの用紙にありません`);
    const r = bleedRect(cell, bleedMm, offsetXMm, offsetYMm);
    const left = Math.round(r.xMm * pxPerMm);
    const top = Math.round(r.yMm * pxPerMm);
    const width = Math.round((r.xMm + r.widthMm) * pxPerMm) - left;
    const height = Math.round((r.yMm + r.heightMm) * pxPerMm) - top;
    const radius = r.cornerRadiusMm * pxPerMm;
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<rect width="${width}" height="${height}" rx="${num(radius)}" ry="${num(radius)}" fill="#fff"/></svg>`,
    );

    let tile: Buffer;
    try {
      tile = await sharp(await oriented(image, { width, height }, edit ?? DEFAULT_EDIT), {
        failOn: 'error',
      })
        .flatten({ background: '#ffffff' })
        .resize(width, height, { fit: 'cover', position: 'centre' })
        .toColourspace('srgb')
        .ensureAlpha()
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
    } catch (e) {
      throw new SheetImageError(cellIndex, e);
    }

    // 用紙の外にはみ出す部分は切り落とす
    const cropL = Math.max(0, -left);
    const cropT = Math.max(0, -top);
    const cropR = Math.max(0, left + width - widthPx);
    const cropB = Math.max(0, top + height - heightPx);
    if (cropL + cropR >= width || cropT + cropB >= height) continue;
    if (cropL || cropT || cropR || cropB) {
      tile = await sharp(tile)
        .extract({
          left: cropL,
          top: cropT,
          width: width - cropL - cropR,
          height: height - cropT - cropB,
        })
        .png()
        .toBuffer();
    }
    composites.push({ input: tile, left: left + cropL, top: top + cropT });
  }

  if (guides) {
    const shapes = cells
      .map((c) => {
        const b = bleedRect(c, bleedMm, offsetXMm, offsetYMm);
        const rect = (x: number, y: number, w: number, h: number, rr: number, extra: string) =>
          `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(rr)}" ry="${num(rr)}" ${extra}/>`;
        return (
          rect(
            b.xMm,
            b.yMm,
            b.widthMm,
            b.heightMm,
            b.cornerRadiusMm,
            'stroke="#2563eb" stroke-dasharray="0.8 0.6" stroke-width="0.2"',
          ) +
          rect(
            c.xMm + offsetXMm,
            c.yMm + offsetYMm,
            c.widthMm,
            c.heightMm,
            c.cornerRadiusMm,
            'stroke="#e11d48" stroke-width="0.2"',
          )
        );
      })
      .join('');
    composites.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${num(paper.sheet.widthMm)} ${num(paper.sheet.heightMm)}"><g fill="none">${shapes}</g></svg>`,
      ),
      left: 0,
      top: 0,
    });
  }

  const png = await sharp({
    create: { width: widthPx, height: heightPx, channels: 3, background: '#ffffff' },
  })
    .composite(composites)
    .png({ compressionLevel: 6 })
    .toBuffer();
  // 角丸の写真を重ねるとアルファが残るので、白地に平らにして RGB（3 チャンネル）に戻す
  const flat = await sharp(png)
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 6 })
    .toBuffer();
  return withPngDensity(flat, dpi);
}

/** 用紙と同じ大きさ（1 ページ）の PDF。「実際のサイズ（100%）」で印刷すること。 */
export async function renderSheetPdf(
  paper: Paper,
  images: SheetCellImage[],
  opts: SheetOptions = {},
): Promise<Uint8Array> {
  // PDF に埋め込むのは JPEG（高品質）。PNG は pdf-lib での読み込みが遅く、メモリも食うため。
  const png = await renderSheetPng(paper, images, { ...opts, guides: false });
  const jpeg = await sharp(png).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
  const doc = await PDFDocument.create();
  const ptPerMm = 72 / 25.4;
  const page = doc.addPage([paper.sheet.widthMm * ptPerMm, paper.sheet.heightMm * ptPerMm]);
  const embedded = await doc.embedJpg(jpeg);
  page.drawImage(embedded, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  doc.setTitle(`${paper.id} 写真シート`);
  return doc.save();
}
