import { describe, expect, it } from 'vitest';
import { mediaTypeLabel, mediaTypeOptions, mediaTypeOptionText } from './mediaTypes';

describe('mediaTypeLabel', () => {
  it('標準の値と Canon 独自の値を日本語にする。知らない値はそのまま', () => {
    expect(mediaTypeLabel('photographic')).toBe('写真用紙');
    expect(mediaTypeLabel('stationery')).toBe('普通紙');
    expect(mediaTypeLabel('com.canon-mtglossy')).toBe('写真用紙 光沢');
    expect(mediaTypeLabel('com.canon-mtmat')).toBe('マット紙');
    expect(mediaTypeLabel('com.vendor-unknown')).toBe('com.vendor-unknown');
  });

  it('TS7630 が対応する用紙の種類（docs/printer-ts7630.md）が、すべて日本語になる', () => {
    const ts7630 = [
      'com.canon-mtglossy',
      'com.canon-mtluster',
      'com.canon-mtplatinum',
      'com.canon-mtmat',
      'com.canon-mthagaki',
      'com.canon-mthagakiglossy',
      'com.canon-mthagakiglossya',
      'com.canon-mtsemisuper',
      'com.canon-mthires',
      'stationery',
      'photographic',
      'auto',
    ];
    for (const v of ts7630) expect(mediaTypeLabel(v), v).not.toBe(v);
  });
});

describe('mediaTypeOptionText', () => {
  it('日本語名のあとに、元の識別子を添える。日本語名がない値は識別子だけ', () => {
    expect(mediaTypeOptionText('com.canon-mtglossy')).toBe('写真用紙 光沢（com.canon-mtglossy）');
    expect(mediaTypeOptionText('x-unknown')).toBe('x-unknown');
  });
});

describe('mediaTypeOptions', () => {
  it('プリンタの一覧を使い、用紙の推奨値と保存済みの値は、一覧になくても入れる（重複しない）', () => {
    const o = mediaTypeOptions(
      ['stationery', 'com.canon-mtmat'],
      ['photographic', 'stationery', undefined],
    );
    expect(o.map((x) => x.value)).toEqual(['stationery', 'com.canon-mtmat', 'photographic']);
    expect(o[1]!.text).toBe('マット紙（com.canon-mtmat）');
  });

  it('プリンタに接続していないときは、標準の値を出す', () => {
    expect(mediaTypeOptions(undefined, []).map((x) => x.value)).toEqual([
      'auto',
      'stationery',
      'photographic',
    ]);
    expect(mediaTypeOptions([], ['x']).map((x) => x.value)).toEqual([
      'auto',
      'stationery',
      'photographic',
      'x',
    ]);
  });
});
