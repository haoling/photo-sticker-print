import { describe, expect, it } from 'vitest';
import type { Cell } from './api';
import { assignInOrder, bleedBox, fillAll, parseBleed } from './sheetLayout';

const cell = (over: Partial<Cell> = {}): Cell => ({
  index: 0,
  row: 0,
  col: 0,
  xMm: 13,
  yMm: 7.5,
  widthMm: 31,
  heightMm: 23,
  cornerRadiusMm: 1.5,
  ...over,
});

describe('parseBleed', () => {
  it('0〜3mm の数値を 0.01 単位に丸めて返す', () => {
    expect(parseBleed('1')).toBe(1);
    expect(parseBleed('0')).toBe(0);
    expect(parseBleed('0.755')).toBe(0.76);
    expect(parseBleed('3')).toBe(3);
  });

  it('空・数値でない・範囲外は null', () => {
    for (const bad of ['', ' ', 'x', '-0.1', '3.1', 'Infinity']) {
      expect(parseBleed(bad), bad).toBeNull();
    }
  });
});

describe('bleedBox', () => {
  it('コマを塗り足しの分だけ四方へ広げ、角丸も同じだけ大きくする', () => {
    expect(bleedBox(cell(), 1)).toEqual({
      xMm: 12,
      yMm: 6.5,
      widthMm: 33,
      heightMm: 25,
      cornerRadiusMm: 2.5,
    });
  });

  it('角のないコマは、広げても角のないまま', () => {
    expect(bleedBox(cell({ cornerRadiusMm: 0 }), 1).cornerRadiusMm).toBe(0);
  });

  it('塗り足し 0 ならコマそのもの', () => {
    expect(bleedBox(cell(), 0)).toMatchObject({ xMm: 13, yMm: 7.5, widthMm: 31, heightMm: 23 });
  });
});

describe('assignInOrder', () => {
  it('空いているコマに、番号の小さい方から順に入れる', () => {
    expect(assignInOrder({ 1: 'b' }, ['x', 'y', 'z'], 5)).toEqual({
      0: 'x',
      1: 'b',
      2: 'y',
      3: 'z',
    });
  });

  it('コマが足りなければ、入りきらない分は捨てる。元の割り付けは変えない', () => {
    const current = { 0: 'a' };
    expect(assignInOrder(current, ['x', 'y', 'z'], 3)).toEqual({ 0: 'a', 1: 'x', 2: 'y' });
    expect(current).toEqual({ 0: 'a' });
  });
});

describe('fillAll', () => {
  it('全コマに同じ写真を入れる', () => {
    expect(fillAll('p', 3)).toEqual({ 0: 'p', 1: 'p', 2: 'p' });
  });
});
