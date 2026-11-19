import { describe, expect, it } from 'vitest';
import fixtures from '../../../fixtures/cell-edit-cases.json';
import {
  cropRect,
  DEFAULT_EDIT,
  isDefaultEdit,
  panEdit,
  previewLayout,
  rotateEdit,
  toggleFlip,
  withZoom,
  type CellEdit,
} from './cellEdit';

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

describe('編集の操作', () => {
  const img = { w: 1800, h: 1200 };
  const box = { w: 33, h: 25 };

  it('拡大率は 0.25〜8 に収める', () => {
    expect(withZoom(DEFAULT_EDIT, 0.1).zoom).toBe(0.25);
    expect(withZoom(DEFAULT_EDIT, 0.5).zoom).toBe(0.5);
    expect(withZoom(DEFAULT_EDIT, 3).zoom).toBe(3);
    expect(withZoom(DEFAULT_EDIT, 99).zoom).toBe(8);
  });

  it('左右反転で、切り抜きの中心の左右も入れ替わる', () => {
    const e = toggleFlip({ ...DEFAULT_EDIT, focusX: 0.3 });
    expect(e.flipH).toBe(true);
    expect(e.focusX).toBeCloseTo(0.7, 9);
    const back = toggleFlip(e);
    expect(back.flipH).toBe(false);
    expect(back.focusX).toBeCloseTo(0.3, 9);
  });

  it('4 回回すと元に戻る（反転していても）', () => {
    for (const flipH of [false, true]) {
      let e: CellEdit = { ...DEFAULT_EDIT, flipH, focusX: 0.3, focusY: 0.6, zoom: 2 };
      const start = e;
      for (let i = 0; i < 4; i++) e = rotateEdit(e, 1);
      expect(e.rotation).toBe(0);
      expect(e.focusX).toBeCloseTo(start.focusX, 9);
      expect(e.focusY).toBeCloseTo(start.focusY, 9);
      expect(rotateEdit(rotateEdit(start, 1), -1).focusX).toBeCloseTo(start.focusX, 9);
    }
  });

  it('時計回りに回すと、右上にあったものは右下へ行く', () => {
    const e = rotateEdit({ ...DEFAULT_EDIT, focusX: 0.9, focusY: 0.1 }, 1);
    expect(e.rotation).toBe(90);
    expect(e.focusX).toBeCloseTo(0.9, 9);
    expect(e.focusY).toBeCloseTo(0.9, 9);
  });

  it('反転しているとき、見た目で時計回りに回すと保存する回転は反時計回りになる', () => {
    expect(rotateEdit({ ...DEFAULT_EDIT, flipH: true }, 1).rotation).toBe(270);
  });

  it('右へドラッグすると、写真がついてきて切り抜きは左へ動く', () => {
    const e = panEdit(img, box, { ...DEFAULT_EDIT, zoom: 2 }, 0.1, 0);
    expect(e.focusX).toBeLessThan(0.5);
    expect(e.focusY).toBeCloseTo(0.5, 9);
  });

  it('端を越えてドラッグしても、写真の外は見えない（中心が端で止まる）', () => {
    const e = panEdit(img, box, { ...DEFAULT_EDIT, zoom: 2 }, 5, 5);
    const r = cropRect(img, box, e);
    expect(r.left).toBeCloseTo(0, 6);
    expect(r.top).toBeCloseTo(0, 6);
    // 止まった位置から戻すと、すぐ動く
    expect(panEdit(img, box, e, -0.1, 0).focusX).toBeGreaterThan(e.focusX);
  });

  it('拡大していなければ、はみ出す方向には動かない', () => {
    const e = panEdit(img, box, DEFAULT_EDIT, 0.3, 0.3);
    expect(e.focusY).toBeCloseTo(0.5, 9); // 縦は全体が収まっているので動かない
  });

  it('縮小すると、写真が窓の内側に収まる範囲で動かせる（外へは出ない）', () => {
    const small = { ...DEFAULT_EDIT, zoom: 0.5 };
    const e = panEdit(img, box, small, -5, -5);
    const r = cropRect(img, box, e);
    expect(r.left).toBeCloseTo(0, 6); // 写真の左上が窓の左上に付いて止まる
    expect(r.top).toBeCloseTo(0, 6);
    expect(e.focusX).toBeGreaterThanOrEqual(0);
    expect(e.focusX).toBeLessThanOrEqual(1);
  });
});
