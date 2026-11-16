/** GET /api/papers が返す用紙定義のうち、画面で使う項目 */
export interface PaperSummary {
  id: string;
  name: string;
  productCode: string;
  sheet: { sizeName: string; widthMm: number; heightMm: number };
  layout: { columns: number; rows: number; cellWidthMm: number; cellHeightMm: number };
  verification: { status: 'unmeasured' | 'measured' | 'verified'; source?: string };
  /** コマ位置が決まっていて、印刷に使えるか */
  printable: boolean;
}

export async function fetchPapers(signal?: AbortSignal): Promise<PaperSummary[]> {
  const res = await fetch('/api/papers', { signal });
  if (!res.ok) throw new Error(`用紙の一覧を取得できませんでした（HTTP ${res.status}）`);
  const body = (await res.json()) as { papers: PaperSummary[] };
  return body.papers;
}
