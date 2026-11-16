import { describe, expect, it } from 'vitest';
import { parseState } from './storage';
import { buildTestPrintUrl, parseOffset } from './testPrintUrl';

describe('buildTestPrintUrl', () => {
  it('用紙・形式・位置補正・色（# なし）を URL にする', () => {
    expect(
      buildTestPrintUrl('aone-26009', 'pdf', { offsetX: 0.5, offsetY: -0.3, color: '#FF0000' }),
    ).toBe('/api/papers/aone-26009/test-print.pdf?offsetX=0.5&offsetY=-0.3&color=ff0000');
  });

  it('不正な色は黒にする', () => {
    expect(buildTestPrintUrl('x', 'svg', { offsetX: 0, offsetY: 0, color: 'red' })).toContain(
      'color=000000',
    );
  });
});

describe('parseOffset', () => {
  it('数値を 0.01mm 単位に丸めて返す', () => {
    expect(parseOffset('0.5')).toBe(0.5);
    expect(parseOffset('-1.234')).toBe(-1.23);
    expect(parseOffset('0')).toBe(0);
  });

  it('空・数値でない・範囲外（±10mm）は null', () => {
    for (const bad of ['', ' ', '-', 'abc', '10.5', '-11', 'Infinity']) {
      expect(parseOffset(bad), bad).toBeNull();
    }
  });
});

describe('parseState', () => {
  it('保存した内容を読める', () => {
    const raw = JSON.stringify({
      paperId: 'aone-26009',
      color: '#ff0000',
      offsets: { 'aone-26009': { x: 0.5, y: -0.2 } },
    });
    expect(parseState(raw)).toEqual({
      paperId: 'aone-26009',
      color: '#ff0000',
      offsets: { 'aone-26009': { x: 0.5, y: -0.2 } },
    });
  });

  it('壊れた内容・不正な値は既定値に戻す', () => {
    expect(parseState(null).paperId).toBeNull();
    expect(parseState('{ not json').color).toBe('#000000');
    expect(parseState('[]').offsets).toEqual({});
    const s = parseState(
      JSON.stringify({
        paperId: 5,
        color: 'red',
        offsets: { a: { x: 'z', y: 1 }, b: { x: 1, y: 2 } },
      }),
    );
    expect(s).toEqual({ paperId: null, color: '#000000', offsets: { b: { x: 1, y: 2 } } });
  });
});
