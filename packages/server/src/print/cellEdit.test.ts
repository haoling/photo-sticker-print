import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  cellEditSchema,
  cropRect,
  DEFAULT_EDIT,
  isDefaultEdit,
  type CellEdit,
} from './cellEdit.js';

interface GoldenCase {
  name: string;
  image: { w: number; h: number };
  box: { w: number; h: number };
  edit: CellEdit;
  expected: {
    orientedW: number;
    orientedH: number;
    left: number;
    top: number;
    width: number;
    height: number;
  };
}
const fixtures = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../fixtures/cell-edit-cases.json', import.meta.url)),
    'utf8',
  ),
) as { cases: GoldenCase[] };

describe('cropRect（ゴールデンケース fixtures/cell-edit-cases.json）', () => {
  for (const c of fixtures.cases) {
    it(c.name, () => {
      const r = cropRect(c.image, c.box, c.edit);
      expect(r.orientedW).toBe(c.expected.orientedW);
      expect(r.orientedH).toBe(c.expected.orientedH);
      for (const k of ['left', 'top', 'width', 'height'] as const) {
        expect(r[k], k).toBeCloseTo(c.expected[k], 5);
      }
    });
  }
});

describe('cropRect の性質', () => {
  const img = { w: 3000, h: 2000 };
  const box = { w: 33, h: 25 };

  it('窓の縦横比は常に box と同じで、写真の内側に収まる', () => {
    for (const zoom of [1, 1.7, 3, 8]) {
      for (const [fx, fy] of [
        [0, 0],
        [1, 1],
        [0.3, 0.8],
        [0.5, 0.5],
      ] as const) {
        for (const rotation of [0, 90, 180, 270] as const) {
          const r = cropRect(img, box, { zoom, focusX: fx, focusY: fy, rotation, flipH: false });
          expect(r.width / r.height).toBeCloseTo(box.w / box.h, 9);
          expect(r.left).toBeGreaterThanOrEqual(0);
          expect(r.top).toBeGreaterThanOrEqual(0);
          expect(r.left + r.width).toBeLessThanOrEqual(r.orientedW + 1e-9);
          expect(r.top + r.height).toBeLessThanOrEqual(r.orientedH + 1e-9);
        }
      }
    }
  });

  it('拡大するほど窓は小さくなる', () => {
    const w = (zoom: number) => cropRect(img, box, { ...DEFAULT_EDIT, zoom }).width;
    expect(w(2)).toBeCloseTo(w(1) / 2, 9);
    expect(w(4)).toBeCloseTo(w(1) / 4, 9);
  });
});

describe('cellEditSchema / isDefaultEdit', () => {
  it('省略した項目は既定値。範囲外・知らない項目・不正な回転は拒否する', () => {
    expect(cellEditSchema.parse({})).toEqual(DEFAULT_EDIT);
    expect(cellEditSchema.parse({ zoom: 2, rotation: 90 })).toMatchObject({
      zoom: 2,
      rotation: 90,
    });
    for (const bad of [
      { zoom: 0.5 },
      { zoom: 9 },
      { focusX: 1.1 },
      { rotation: 45 },
      { flipH: 1 },
      { foo: 1 },
    ]) {
      expect(cellEditSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('既定値かどうかを判定できる', () => {
    expect(isDefaultEdit(DEFAULT_EDIT)).toBe(true);
    expect(isDefaultEdit({ ...DEFAULT_EDIT, zoom: 1.01 })).toBe(false);
    expect(isDefaultEdit({ ...DEFAULT_EDIT, flipH: true })).toBe(false);
  });
});
