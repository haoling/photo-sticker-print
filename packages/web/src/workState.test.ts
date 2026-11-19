import { describe, expect, it } from 'vitest';
import { DEFAULT_EDIT } from './cellEdit';
import { EMPTY_WORK, parseWork } from './workState';

describe('parseWork', () => {
  it('空・壊れた文字列は空の状態', () => {
    expect(parseWork(null)).toEqual(EMPTY_WORK);
    expect(parseWork('{')).toEqual(EMPTY_WORK);
    expect(parseWork('[]')).toEqual(EMPTY_WORK);
  });

  it('保存した内容をそのまま読める', () => {
    const w = {
      paperId: 'aone-26009',
      slots: {
        0: {
          photoId: 'a',
          name: 'a.jpg',
          edit: { ...DEFAULT_EDIT, zoom: 2, rotation: 90 as const },
        },
      },
    };
    expect(parseWork(JSON.stringify(w))).toEqual(w);
  });

  it('壊れたコマだけ捨て、範囲外の編集は既定値に戻す', () => {
    const raw = JSON.stringify({
      paperId: 3,
      slots: {
        0: { photoId: '' },
        x: { photoId: 'b' },
        '-1': { photoId: 'b' },
        2: { photoId: 'c', edit: { zoom: 99, focusX: 5, rotation: 45, flipH: 'yes' } },
      },
    });
    expect(parseWork(raw)).toEqual({
      paperId: null,
      slots: { 2: { photoId: 'c', name: '', edit: DEFAULT_EDIT } },
    });
  });
});
