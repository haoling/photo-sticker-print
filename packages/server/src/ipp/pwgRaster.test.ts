import { describe, expect, it } from 'vitest';
import { decodePwgRaster, encodePwgRaster, PWG_HEADER_SIZE, type PwgPage } from './pwgRaster.js';

const page = (
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number],
): PwgPage => {
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rgb.set(fill(x, y), (y * width + x) * 3);
  }
  return {
    rgb,
    width,
    height,
    dpi: 600,
    pageWidthPt: 283,
    pageHeightPt: 420,
    mediaType: 'stationery',
    quality: 5,
  };
};

const roundTrip = (p: PwgPage) => decodePwgRaster(encodePwgRaster([p]))[0]!;

describe('encodePwgRaster', () => {
  it('同期ワード RaS2 のあとに、1796 バイトのヘッダが続く', () => {
    const buf = encodePwgRaster([page(4, 2, () => [255, 255, 255])]);
    expect(buf.subarray(0, 4).toString()).toBe('RaS2');
    expect(buf.length).toBeGreaterThan(4 + PWG_HEADER_SIZE);
  });

  it('ヘッダの各フィールドが仕様の位置にある（ビッグエンディアン）', () => {
    const buf = encodePwgRaster([page(7, 3, () => [1, 2, 3])]);
    const h = buf.subarray(4, 4 + PWG_HEADER_SIZE);
    expect(h.toString('latin1', 0, 9)).toBe('PwgRaster');
    expect(h.toString('latin1', 128, 138)).toBe('stationery');
    expect([h.readUInt32BE(276), h.readUInt32BE(280)]).toEqual([600, 600]); // HWResolution
    expect([h.readUInt32BE(352), h.readUInt32BE(356)]).toEqual([283, 420]); // PageSize（pt）
    expect(h.readUInt32BE(372)).toBe(7); // cupsWidth
    expect(h.readUInt32BE(376)).toBe(3); // cupsHeight
    expect(h.readUInt32BE(384)).toBe(8); // cupsBitsPerColor
    expect(h.readUInt32BE(388)).toBe(24); // cupsBitsPerPixel
    expect(h.readUInt32BE(392)).toBe(21); // cupsBytesPerLine
    expect(h.readUInt32BE(396)).toBe(0); // chunky
    expect(h.readUInt32BE(400)).toBe(19); // sRGB
    expect(h.readUInt32BE(420)).toBe(3); // cupsNumColors
    expect(h.readUInt32BE(484)).toBe(5); // PrintQuality
  });

  it('画素を損なわずに往復できる（単色・縞・ノイズ・1 画素幅・繰り返しの境目）', () => {
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256;
    const cases: [string, PwgPage][] = [
      ['白一色', page(300, 5, () => [255, 255, 255])],
      ['単色', page(300, 5, () => [10, 200, 30])],
      ['縦縞', page(257, 4, (x) => (x % 2 ? [0, 0, 0] : [255, 255, 255]))],
      ['横縞（行の繰り返し）', page(50, 600, (_, y) => [(y >> 2) % 256, 0, 0])],
      ['ノイズ（リテラル 128 画素を超える）', page(500, 6, () => [rand(), rand(), rand()])],
      ['1 画素幅', page(1, 700, (_, y) => [y % 256, 7, 9])],
      ['同じ行が 256 行を超えて続く', page(10, 700, () => [5, 6, 7])],
      [
        '繰り返しとリテラルの混在',
        page(333, 3, (x) =>
          x < 100 ? [1, 1, 1] : x < 220 ? [(x * 7) % 256, (x * 3) % 256, x % 256] : [9, 9, 9],
        ),
      ],
    ];
    for (const [label, p] of cases) {
      const d = roundTrip(p);
      expect(d.rgb.equals(p.rgb), label).toBe(true);
      expect(d.header.width).toBe(p.width);
      expect(d.header.height).toBe(p.height);
    }
  });

  it('白い大きなページは小さく圧縮される（はがき 600dpi の白一色が 100KB 未満）', () => {
    const w = 2362;
    const h = 3496;
    const rgb = Buffer.alloc(w * h * 3, 0xff);
    const buf = encodePwgRaster([
      { rgb, width: w, height: h, dpi: 600, pageWidthPt: 283, pageHeightPt: 420 },
    ]);
    expect(buf.length).toBeLessThan(100_000);
    expect(decodePwgRaster(buf)[0]!.rgb.equals(rgb)).toBe(true);
  });

  it('複数ページを続けて書ける。大きさの合わない画素データは拒否する', () => {
    const a = page(3, 2, () => [1, 2, 3]);
    const b = page(5, 1, () => [4, 5, 6]);
    const pages = decodePwgRaster(encodePwgRaster([a, b]));
    expect(pages).toHaveLength(2);
    expect(pages[1]!.header.width).toBe(5);
    expect(() => encodePwgRaster([{ ...a, rgb: Buffer.alloc(5) }])).toThrow(RangeError);
  });
});
