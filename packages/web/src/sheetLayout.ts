import type { Cell } from './api';

export const MAX_BLEED_MM = 3;
export const DEFAULT_BLEED_MM = 1;

/** 塗り足しの入力文字列を数値にする。空・数値でない・範囲外（0〜3mm）は null */
export function parseBleed(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > MAX_BLEED_MM) return null;
  return Math.round(n * 100) / 100;
}

/** 塗り足しの範囲（コマを bleed だけ外へ広げた角丸四角形）。サーバーの bleedRect と同じ計算。 */
export function bleedBox(cell: Cell, bleedMm: number) {
  return {
    xMm: cell.xMm - bleedMm,
    yMm: cell.yMm - bleedMm,
    widthMm: cell.widthMm + 2 * bleedMm,
    heightMm: cell.heightMm + 2 * bleedMm,
    cornerRadiusMm: cell.cornerRadiusMm > 0 ? cell.cornerRadiusMm + bleedMm : 0,
  };
}

/** コマ番号 → 写真。空いているコマの番号の小さい方から、files を順に入れる。入りきらない分は捨てる。 */
export function assignInOrder<T>(
  current: Record<number, T>,
  files: T[],
  cellCount: number,
): Record<number, T> {
  const next = { ...current };
  let i = 0;
  for (const f of files) {
    while (i < cellCount && next[i] !== undefined) i++;
    if (i >= cellCount) break;
    next[i] = f;
  }
  return next;
}

/** 同じ写真で全コマを埋める */
export function fillAll<T>(photo: T, cellCount: number): Record<number, T> {
  return Object.fromEntries(Array.from({ length: cellCount }, (_, i) => [i, photo]));
}
