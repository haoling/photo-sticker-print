import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPapers, type Paper } from '../papers/index.js';
import { renderSheetPdf, renderSheetPng, SheetImageError, sheetWarnings } from './index.js';

const DPI = 300;
const PX_PER_MM = DPI / 25.4;
let p29622: Paper;
let p26009: Paper;

beforeAll(async () => {
  const papers = await loadPapers(fileURLToPath(new URL('../../../../papers', import.meta.url)));
  p29622 = papers.find((p) => p.id === 'aone-29622')!;
  p26009 = papers.find((p) => p.id === 'aone-26009')!;
});

const solid = (r: number, g: number, b: number, w = 400, h = 300) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();

/** 左半分が赤、右半分が青の画像 */
const redBlue = async (w: number, h: number, orientation?: number) => {
  const half = (r: number, b: number) =>
    sharp({ create: { width: w / 2, height: h, channels: 3, background: { r, g: 0, b } } })
      .png()
      .toBuffer();
  const img = sharp({ create: { width: w, height: h, channels: 3, background: '#000' } }).composite(
    [
      { input: await half(255, 0), left: 0, top: 0 },
      { input: await half(0, 255), left: w / 2, top: 0 },
    ],
  );
  return (orientation ? img.withMetadata({ orientation }) : img).jpeg({ quality: 100 }).toBuffer();
};

async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  expect(info.channels).toBe(3);
  return (xMm: number, yMm: number) => {
    const i = (Math.round(yMm * PX_PER_MM) * info.width + Math.round(xMm * PX_PER_MM)) * 3;
    return [data[i]!, data[i + 1]!, data[i + 2]!];
  };
}
const near = (a: number[], b: number[], tol = 6) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
const RED = [255, 0, 0];
const WHITE = [255, 255, 255];
const BLUE = [0, 0, 255];

// 29622 の 1 コマ目: x=13, y=7.5, 31×23mm、角丸 1.5mm
const CELL0 = { x: 13, y: 7.5, w: 31, h: 23 };

describe('renderSheetPng', () => {
  it('コマの中は写真、塗り足しの分だけ外にはみ出し、その外は白', async () => {
    const png = await renderSheetPng(p29622, [{ cellIndex: 0, image: await solid(255, 0, 0) }], {
      bleedMm: 1,
      dpi: DPI,
    });
    const at = await pixels(png);
    expect(near(at(CELL0.x + 15, CELL0.y + 11), RED)).toBe(true); // コマの中央
    expect(near(at(CELL0.x + 0.2, CELL0.y + 11), RED)).toBe(true); // コマの左端の内側
    expect(near(at(CELL0.x - 0.7, CELL0.y + 11), RED)).toBe(true); // 塗り足しの中（左）
    expect(near(at(CELL0.x + CELL0.w + 0.7, CELL0.y + 11), RED)).toBe(true); // （右）
    expect(near(at(CELL0.x + 15, CELL0.y - 0.7), RED)).toBe(true); // （上）
    expect(near(at(CELL0.x + 15, CELL0.y + CELL0.h + 0.7), RED)).toBe(true); // （下）
    expect(near(at(CELL0.x - 1.4, CELL0.y + 11), WHITE)).toBe(true); // 塗り足しの外
    expect(near(at(CELL0.x + CELL0.w + 1.4, CELL0.y + 11), WHITE)).toBe(true);
  });

  it('塗り足しの範囲の角は丸い（角丸＋塗り足し）', async () => {
    const png = await renderSheetPng(p29622, [{ cellIndex: 0, image: await solid(255, 0, 0) }], {
      bleedMm: 1,
      dpi: DPI,
    });
    const at = await pixels(png);
    // 範囲の角（外接四角形の角から 0.1mm 内側）は、半径 2.5mm の円の外なので白
    expect(near(at(CELL0.x - 1 + 0.1, CELL0.y - 1 + 0.1), WHITE)).toBe(true);
    // 角から斜めに 1.2mm 入った点は円の内側なので写真
    expect(near(at(CELL0.x - 1 + 1.2, CELL0.y - 1 + 1.2), RED)).toBe(true);
  });

  it('塗り足し 0 なら、コマの外は白', async () => {
    const png = await renderSheetPng(p29622, [{ cellIndex: 0, image: await solid(255, 0, 0) }], {
      bleedMm: 0,
      dpi: DPI,
    });
    const at = await pixels(png);
    expect(near(at(CELL0.x + 0.3, CELL0.y + 11), RED)).toBe(true);
    expect(near(at(CELL0.x - 0.3, CELL0.y + 11), WHITE)).toBe(true);
  });

  it('写真が無いコマは白のまま。別のコマには別の写真', async () => {
    const png = await renderSheetPng(
      p29622,
      [
        { cellIndex: 0, image: await solid(255, 0, 0) },
        { cellIndex: 9, image: await solid(0, 0, 255) },
      ],
      { dpi: DPI },
    );
    const at = await pixels(png);
    // 10 コマ目（最後の段の右）: x=13+43, y=7.5+4*27.5
    expect(near(at(56 + 15, 117.5 + 11), BLUE)).toBe(true);
    expect(near(at(56 + 15, 90 + 11), WHITE)).toBe(true); // 8 コマ目（空）
  });

  it('中央を基準に切り抜く（左が赤・右が青の写真は、コマの真ん中で色が変わる）', async () => {
    const png = await renderSheetPng(p29622, [{ cellIndex: 0, image: await redBlue(800, 400) }], {
      dpi: DPI,
    });
    const at = await pixels(png);
    const cx = CELL0.x + CELL0.w / 2;
    expect(near(at(cx - 3, CELL0.y + 11), RED)).toBe(true);
    expect(near(at(cx + 3, CELL0.y + 11), BLUE)).toBe(true);
  });

  it('EXIF の向きを反映する（向き 6 = 時計回りに 90°。左の赤が上になる）', async () => {
    const png = await renderSheetPng(
      p29622,
      [{ cellIndex: 0, image: await redBlue(600, 200, 6) }],
      { dpi: DPI },
    );
    const at = await pixels(png);
    const cx = CELL0.x + CELL0.w / 2;
    const cy = CELL0.y + CELL0.h / 2;
    expect(near(at(cx, cy - 4), RED)).toBe(true);
    expect(near(at(cx, cy + 4), BLUE)).toBe(true);
  });

  it('位置補正は描く位置に足される', async () => {
    const png = await renderSheetPng(p29622, [{ cellIndex: 0, image: await solid(255, 0, 0) }], {
      bleedMm: 0,
      offsetXMm: 2,
      dpi: DPI,
    });
    const at = await pixels(png);
    expect(near(at(CELL0.x + 1, CELL0.y + 11), WHITE)).toBe(true); // 元の左端の内側は空く
    expect(near(at(CELL0.x + 2.5, CELL0.y + 11), RED)).toBe(true);
  });

  it('確認用のガイド（コマの輪郭）は guides: true のときだけ重なる', async () => {
    const img = await solid(255, 255, 255);
    const edge = (png: Buffer) => pixels(png).then((at) => at(CELL0.x + 0.05, CELL0.y + 11));
    const withGuides = await renderSheetPng(p29622, [{ cellIndex: 0, image: img }], {
      bleedMm: 1,
      dpi: DPI,
      guides: true,
    });
    const without = await renderSheetPng(p29622, [{ cellIndex: 0, image: img }], {
      bleedMm: 1,
      dpi: DPI,
    });
    expect(near(await edge(without), WHITE)).toBe(true);
    expect(near(await edge(withGuides), WHITE)).toBe(false);
  });

  it('用紙ぴったりの大きさと解像度で出力する', async () => {
    const png = await renderSheetPng(p29622, [], { dpi: 600 });
    expect(await sharp(png).metadata()).toMatchObject({ width: 2362, height: 3496, density: 600 });
  });

  it('不正な塗り足し・存在しないコマ・読めない写真を、わかる形で拒否する', async () => {
    const ok = await solid(0, 0, 0);
    await expect(renderSheetPng(p29622, [], { bleedMm: -1 })).rejects.toThrow(RangeError);
    await expect(renderSheetPng(p29622, [], { bleedMm: 5 })).rejects.toThrow(RangeError);
    await expect(renderSheetPng(p29622, [{ cellIndex: 10, image: ok }])).rejects.toThrow(
      'コマ 11 はこの用紙にありません',
    );
    const err = await renderSheetPng(
      p29622,
      [{ cellIndex: 3, image: Buffer.from('not an image') }],
      {
        dpi: DPI,
      },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SheetImageError);
    expect((err as SheetImageError).cellIndex).toBe(3);
    expect((err as SheetImageError).message).toContain('コマ 4');
  });
});

describe('renderSheetPdf', () => {
  it('1 ページで、用紙と同じ大きさ', async () => {
    const pdf = await renderSheetPdf(p29622, [{ cellIndex: 0, image: await solid(255, 0, 0) }], {
      dpi: DPI,
    });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize().width).toBeCloseTo((100 / 25.4) * 72, 2);
    expect(doc.getPage(0).getSize().height).toBeCloseTo((148 / 25.4) * 72, 2);
  });
});

describe('sheetWarnings', () => {
  it('29622 の塗り足し 1mm は警告なし', () => {
    expect(sheetWarnings(p29622, 1, [0, 1, 8, 9])).toEqual([]);
  });

  it('塗り足しが印刷できない範囲（上下 5mm）にかかると警告', () => {
    const w = sheetWarnings(p29622, 3, [9]); // 最後の段: 下端 140.5 + 3 = 143.5 > 143
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('コマ 10');
    expect(w[0]).toContain('印刷できない範囲');
  });

  it('推定値の用紙で塗り足しが 0.5mm 未満だと警告。写真を置かないコマは調べない', () => {
    expect(sheetWarnings(p26009, 0.2, [0])[0]).toContain('推定値');
    expect(sheetWarnings(p29622, 3, [4, 5])).toEqual([]); // 真ん中の段は 3mm でも収まる
  });
});
