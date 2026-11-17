import type { Paper } from './schema.js';

export interface Cell {
  /** 0 始まり。上の段から、左の列から順 */
  index: number;
  row: number;
  col: number;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  cornerRadiusMm: number;
}

/** コマ位置が決まっていて、印刷に使える用紙か（unmeasured は使えない） */
export function isPrintable(paper: Paper): boolean {
  return paper.verification.status !== 'unmeasured';
}

/** 全コマの位置とサイズ（mm）。コマ位置が未測定の用紙では例外を投げる。 */
export function computeCells(paper: Paper): Cell[] {
  const l = paper.layout;
  if (!isPrintable(paper) || l.firstCellLeftMm == null || l.firstCellTopMm == null) {
    throw new Error(`${paper.id}: コマ位置が未測定です`);
  }
  const { firstCellLeftMm: left, firstCellTopMm: top, pitchXMm: px, pitchYMm: py } = l;
  if (px == null || py == null) throw new Error(`${paper.id}: コマ位置が未測定です`);
  const cells: Cell[] = [];
  for (let row = 0; row < l.rows; row++) {
    for (let col = 0; col < l.columns; col++) {
      cells.push({
        index: row * l.columns + col,
        row,
        col,
        xMm: left + col * px,
        yMm: top + row * py,
        widthMm: l.cellWidthMm,
        heightMm: l.cellHeightMm,
        cornerRadiusMm: l.cornerRadiusMm ?? 0,
      });
    }
  }
  return cells;
}
