export type TestPrintFormat = 'svg' | 'png' | 'pdf';

export interface TestPrintParams {
  /** 位置補正（mm）。+X は右、+Y は下 */
  offsetX: number;
  offsetY: number;
  /** 枠線の色 #rrggbb */
  color: string;
}

export const OFFSET_LIMIT_MM = 10;
export const DEFAULT_COLOR = '#000000';

export const isHexColor = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

/** 位置補正の入力文字列を数値にする。範囲外・数値でないときは null */
export function parseOffset(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n) || Math.abs(n) > OFFSET_LIMIT_MM) return null;
  return Math.round(n * 100) / 100;
}

/** テスト印刷データの URL（サーバーの /api/papers/:id/test-print.* に対応） */
export function buildTestPrintUrl(
  paperId: string,
  format: TestPrintFormat,
  { offsetX, offsetY, color }: TestPrintParams,
): string {
  const q = new URLSearchParams({
    offsetX: String(offsetX),
    offsetY: String(offsetY),
    color: (isHexColor(color) ? color : DEFAULT_COLOR).slice(1).toLowerCase(),
  });
  return `/api/papers/${encodeURIComponent(paperId)}/test-print.${format}?${q}`;
}
