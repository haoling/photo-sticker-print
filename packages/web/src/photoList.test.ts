import { describe, expect, it } from 'vitest';
import type { Photo } from './api';
import {
  appendPage,
  EMPTY_LIST,
  dayLabel,
  formatTakenAt,
  groupByDay,
  parseDragData,
} from './photoList';

const photo = (id: string): Photo => ({
  id,
  name: `${id}.jpg`,
  takenAt: null,
  width: 1,
  height: 1,
});
const [a, b, c] = [photo('a'), photo('b'), photo('c')];

describe('appendPage', () => {
  it('ページを後ろに足し、同じ id は足さない', () => {
    const first = appendPage(EMPTY_LIST, { photos: [a, b], nextCursor: '2' });
    expect(first).toEqual({ photos: [a, b], cursor: '2' });
    const second = appendPage(first, { photos: [b, c], nextCursor: null });
    expect(second).toEqual({ photos: [a, b, c], cursor: null });
  });
});

describe('ドラッグ', () => {
  it('parseDragData: 形の違うデータは捨てる', () => {
    expect(parseDragData(JSON.stringify([a, { id: '../x' }, 1, null]))).toEqual([a]);
    expect(parseDragData('{')).toEqual([]);
    expect(parseDragData('{"id":"a"}')).toEqual([]);
  });
});

describe('formatTakenAt', () => {
  it('日付だけを出す', () => {
    expect(formatTakenAt('2026-01-05T10:00:00.000Z')).toBe('2026/01/05');
    expect(formatTakenAt(null)).toBe('');
    expect(formatTakenAt('x')).toBe('');
  });
});

describe('groupByDay', () => {
  const at = (id: string, takenAt: string | null): Photo => ({ ...photo(id), takenAt });

  it('同じ撮影日が続くところをまとめ、並び順は変えない', () => {
    const p1 = at('1', '2026-01-05T23:00:00.000Z');
    const p2 = at('2', '2026-01-05T01:00:00.000Z');
    const p3 = at('3', '2026-01-04T12:00:00.000Z');
    const p4 = at('4', null);
    expect(groupByDay([p1, p2, p3, p4])).toEqual([
      { key: '2026-01-05', label: '2026年1月5日（月）', photos: [p1, p2] },
      { key: '2026-01-04', label: '2026年1月4日（日）', photos: [p3] },
      { key: '', label: '日付なし', photos: [p4] },
    ]);
  });

  it('空なら空', () => {
    expect(groupByDay([])).toEqual([]);
  });

  it('dayLabel: 読めない日付は「日付なし」', () => {
    expect(dayLabel('2024-02-29')).toBe('2024年2月29日（木）');
    expect(dayLabel('')).toBe('日付なし');
  });
});
