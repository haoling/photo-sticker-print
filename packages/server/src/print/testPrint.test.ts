import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPapers, paperSchema, type Paper } from '../papers/index.js';
import {
  buildTestPrintSvg,
  pageSizePx,
  renderTestPrintPdf,
  renderTestPrintPng,
  UnmeasuredPaperError,
} from './index.js';

const PX_PER_MM = 600 / 25.4;
let p26009: Paper;
let p29662: Paper;

beforeAll(async () => {
  const papers = await loadPapers(fileURLToPath(new URL('../../../../papers', import.meta.url)));
  p26009 = papers.find((p) => p.id === 'aone-26009')!;
  p29662 = papers.find((p) => p.id === 'aone-29662')!;
});

async function gray(png: Buffer) {
  const { data, info } = await sharp(png)
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(info.channels).toBe(1);
  return { at: (x: number, y: number) => data[Math.round(y) * info.width + Math.round(x)]! };
}

describe('pageSizePx', () => {
  it('はがきの 600dpi は 2362 × 3496', () => {
    expect(pageSizePx(p26009)).toEqual({ widthPx: 2362, heightPx: 3496 });
  });
});

describe('buildTestPrintSvg', () => {
  it('コマの数だけ枠線があり、文字は含まない', () => {
    const svg = buildTestPrintSvg(p26009);
    expect(svg.match(/<rect /g)).toHaveLength(1 + 10); // 背景 + 10 コマ
    expect(svg).not.toContain('<text');
    expect(svg).toContain('viewBox="0 0 100 148"');
  });

  it('位置補正は描く位置に足される', () => {
    const base = buildTestPrintSvg(p26009);
    const moved = buildTestPrintSvg(p26009, { offsetXMm: 1, offsetYMm: -0.5 });
    // 26009 の 1 コマ目は x=8.5, y=8、線の太さの半分(0.075)だけ内側
    expect(base).toContain('x="8.575" y="8.075"');
    expect(moved).toContain('x="9.575" y="7.575"');
  });

  it('線の色を指定できる（既定は黒）。#rrggbb 以外は拒否する', () => {
    expect(buildTestPrintSvg(p26009)).toContain('stroke="#000000"');
    expect(buildTestPrintSvg(p26009, { lineColor: '#FF0000' })).toContain('stroke="#ff0000"');
    for (const bad of ['red', '#f00', '#ff0000"/><script>', 'ff0000']) {
      expect(() => buildTestPrintSvg(p26009, { lineColor: bad }), bad).toThrow(RangeError);
    }
  });

  it('コマ位置が未測定の用紙は作れない', () => {
    const unmeasured = paperSchema.parse({
      ...p29662,
      layout: {
        ...p29662.layout,
        firstCellLeftMm: null,
        firstCellTopMm: null,
        pitchXMm: null,
        pitchYMm: null,
      },
      verification: { status: 'unmeasured' },
    });
    expect(() => buildTestPrintSvg(unmeasured)).toThrow(UnmeasuredPaperError);
  });
});

describe('renderTestPrintPng', () => {
  it('用紙ぴったりの画像で、解像度が 600dpi', async () => {
    const meta = await sharp(await renderTestPrintPng(p26009)).metadata();
    expect(meta).toMatchObject({ width: 2362, height: 3496, density: 600, channels: 1 });
    expect(meta.space).toBe('b-w');
  });

  it('黒以外の色は RGB の PNG になり、枠線がその色で出る', async () => {
    const png = await renderTestPrintPng(p26009, { lineColor: '#ff0000' });
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    const at = (x: number, y: number) => {
      const i = (Math.round(y) * info.width + Math.round(x)) * 3;
      return [data[i], data[i + 1], data[i + 2]];
    };
    expect(at((8.5 + 0.075) * PX_PER_MM, 20 * PX_PER_MM)).toEqual([255, 0, 0]);
    expect(at(20 * PX_PER_MM, 20 * PX_PER_MM)).toEqual([255, 255, 255]);
  });

  it('枠線は 26009 の 1 コマ目の左端（x=8.5mm）にあり、内側と外側は白', async () => {
    const img = await gray(await renderTestPrintPng(p26009));
    const y = (8 + 12) * PX_PER_MM; // 1 コマ目の縦の真ん中
    expect(img.at((8.5 + 0.075) * PX_PER_MM, y)).toBeLessThan(80); // 枠線
    expect(img.at(20 * PX_PER_MM, y)).toBe(255); // コマの内側
    expect(img.at(50 * PX_PER_MM, y)).toBe(255); // 列の間
    expect(img.at(5 * PX_PER_MM, y)).toBe(255); // 用紙の左の余白
  });

  it('位置補正 +1mm で枠線が 1mm 右へ動く', async () => {
    const img = await gray(await renderTestPrintPng(p26009, { offsetXMm: 1 }));
    const y = (8 + 12) * PX_PER_MM;
    expect(img.at((8.5 + 0.075) * PX_PER_MM, y)).toBe(255);
    expect(img.at((9.5 + 0.075) * PX_PER_MM, y)).toBeLessThan(80);
  });

  it('下端のコマの枠線が用紙の内側に描かれる（最後の段の下端 = 140mm）', async () => {
    const img = await gray(await renderTestPrintPng(p26009));
    const x = (8.5 + 20) * PX_PER_MM;
    expect(img.at(x, (140 - 0.075) * PX_PER_MM)).toBeLessThan(80);
    expect(img.at(x, 141 * PX_PER_MM)).toBe(255);
  });
});

describe('renderTestPrintPdf', () => {
  it('1 ページで、用紙と同じ大きさ（100×148mm）', async () => {
    const doc = await PDFDocument.load(await renderTestPrintPdf(p26009));
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo((100 / 25.4) * 72, 2);
    expect(height).toBeCloseTo((148 / 25.4) * 72, 2);
  });
});
