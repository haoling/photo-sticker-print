import { describe, expect, it } from 'vitest';
import fixtures from '../../../fixtures/cell-edit-cases.json';
import { cropRect, DEFAULT_EDIT, isDefaultEdit, previewLayout, type CellEdit } from './cellEdit';

describe('cropRect（サーバーと共通のゴールデンケース fixtures/cell-edit-cases.json）', () => {
  for (const c of fixtures.cases) {
    it(c.name, () => {
      const r = cropRect(c.image, c.box, c.edit as CellEdit);
      expect(r.orientedW).toBe(c.expected.orientedW);
      expect(r.orientedH).toBe(c.expected.orientedH);
      for (const k of ['left', 'top', 'width', 'height'] as const) {
        expect(r[k], k).toBeCloseTo(c.expected[k], 5);
      }
    });
  }
});

describe('previewLayout', () => {
  const box = { w: 33, h: 25 };

  it('既定の編集で、横長の写真は、窓が box に重なる（左右が切り落とされる）', () => {
    // 1800×1200 の窓は left=108, width=1584, height=1200
    const l = previewLayout({ w: 1800, h: 1200 }, box, DEFAULT_EDIT);
    expect(l.container.leftPct).toBeCloseTo(-(108 / 1584) * 100, 6);
    expect(l.container.topPct).toBeCloseTo(0, 6);
    expect(l.container.widthPct).toBeCloseTo((1800 / 1584) * 100, 6); // 写真は box より横に広い
    expect(l.container.heightPct).toBeCloseTo(100, 6);
    expect(l.swap).toBe(false);
  });

  it('ぴったり同じ縦横比なら、入れ物は box と同じ（0%・100%）', () => {
    const l = previewLayout({ w: 1650, h: 1250 }, box, DEFAULT_EDIT);
    expect(l.container).toEqual({ leftPct: 0, topPct: 0, widthPct: 100, heightPct: 100 });
  });

  it('拡大すると入れ物が大きくなる（2 倍なら 2 倍）', () => {
    const base = previewLayout({ w: 1650, h: 1250 }, box, DEFAULT_EDIT).container.widthPct;
    const zoomed = previewLayout({ w: 1650, h: 1250 }, box, { ...DEFAULT_EDIT, zoom: 2 }).container
      .widthPct;
    expect(zoomed).toBeCloseTo(base * 2, 6);
  });

  it('回転のあとに反転する。90° / 270° は縦横を入れ替える', () => {
    const l = previewLayout({ w: 1800, h: 1200 }, box, {
      ...DEFAULT_EDIT,
      rotation: 90,
      flipH: true,
    });
    expect(l.swap).toBe(true);
    expect(l.transform).toBe('translate(-50%, -50%) scaleX(-1) rotate(90deg)');
    expect(previewLayout({ w: 1, h: 1 }, box, DEFAULT_EDIT).transform).toBe(
      'translate(-50%, -50%) scaleX(1) rotate(0deg)',
    );
  });
});

describe('isDefaultEdit', () => {
  it('既定値かどうかを判定できる', () => {
    expect(isDefaultEdit(DEFAULT_EDIT)).toBe(true);
    expect(isDefaultEdit({ ...DEFAULT_EDIT, rotation: 90 })).toBe(false);
  });
});
