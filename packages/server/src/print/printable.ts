import { computeCells } from '../papers/geometry.js';
import type { Paper } from '../papers/schema.js';

/**
 * Canon TS7630 のはがき・フチあり印刷で、用紙の端から印刷されない幅（mm）。
 * docs/printer-ts7630.md の値（左右 3.4、上下 3 / 5）。上下のどちらが 3 でどちらが 5 かは
 * 未確認なので、安全側に大きい方を上下の両方に使う。プリンタプロファイル（M4）ができたら置き換える。
 */
export const HAGAKI_BORDERED_MARGIN_MM = { left: 3.4, right: 3.4, top: 5, bottom: 5 } as const;

export const MAX_BLEED_MM = 3;
export const DEFAULT_BLEED_MM = 1;
/** コマ位置が推定値（measured）の用紙で、これ未満の塗り足しは勧めない */
const MIN_RECOMMENDED_BLEED_MM = 0.5;

/** 塗り足しを含めた範囲が、印刷できない範囲や用紙の外にかかっていないかを調べて、警告を返す。 */
export function sheetWarnings(paper: Paper, bleedMm: number, cellIndexes: number[]): string[] {
  const warnings: string[] = [];
  const m = HAGAKI_BORDERED_MARGIN_MM;
  const { widthMm, heightMm } = paper.sheet;
  const used = new Set(cellIndexes);
  const outside: number[] = [];
  const unprintable: number[] = [];

  for (const c of computeCells(paper)) {
    if (!used.has(c.index)) continue;
    const l = c.xMm - bleedMm;
    const t = c.yMm - bleedMm;
    const r = c.xMm + c.widthMm + bleedMm;
    const b = c.yMm + c.heightMm + bleedMm;
    if (l < 0 || t < 0 || r > widthMm || b > heightMm) outside.push(c.index + 1);
    else if (l < m.left || t < m.top || r > widthMm - m.right || b > heightMm - m.bottom) {
      unprintable.push(c.index + 1);
    }
  }
  if (outside.length > 0) {
    warnings.push(
      `コマ ${outside.join('・')} は、塗り足しが用紙の外にはみ出します（はみ出した分は切り落とされます）。`,
    );
  }
  if (unprintable.length > 0) {
    warnings.push(
      `コマ ${unprintable.join('・')} は、塗り足しがフチあり印刷で印刷できない範囲（用紙の端から約 ${m.top}mm）にかかります。端が白く抜ける可能性があります。`,
    );
  }
  if (paper.verification.status === 'measured' && bleedMm < MIN_RECOMMENDED_BLEED_MM) {
    warnings.push(
      `この用紙のコマ位置は写真から測った推定値です（実機検証前）。塗り足しが ${MIN_RECOMMENDED_BLEED_MM}mm 未満だと、ずれたときに白い隙間が出やすくなります。`,
    );
  }
  return warnings;
}
