/** コマの位置とサイズ（mm）。サーバーが用紙定義から計算して返す */
export interface Cell {
  index: number;
  row: number;
  col: number;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  cornerRadiusMm: number;
}

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
  /** 印刷できない用紙（未測定）は null */
  cells: Cell[] | null;
  /** 推奨する印刷設定（決まっている項目だけ） */
  recommendedPrint?: {
    mediaType?: string;
    mediaSource?: 'auto' | 'main' | 'rear';
    borderless?: boolean;
    note?: string;
  };
}

export async function fetchPapers(signal?: AbortSignal): Promise<PaperSummary[]> {
  const res = await fetch('/api/papers', { signal });
  if (!res.ok) throw new Error(`用紙の一覧を取得できませんでした（HTTP ${res.status}）`);
  const body = (await res.json()) as { papers: PaperSummary[] };
  return body.papers;
}

export type SheetFormat = 'preview' | 'png' | 'pdf';

export interface SheetRequest {
  paperId: string;
  bleedMm: number;
  offsetX: number;
  offsetY: number;
  /** コマの番号（0 始まり）と、そのコマに入れる写真 */
  photos: [cellIndex: number, file: File][];
}

/** 写真を割り付けたシートをサーバーで作る。写真は保存されない。 */
export async function renderSheet(
  format: SheetFormat,
  req: SheetRequest,
  signal?: AbortSignal,
): Promise<{ blob: Blob; warnings: string[] }> {
  const form = new FormData();
  form.set('paperId', req.paperId);
  form.set('bleedMm', String(req.bleedMm));
  form.set('offsetX', String(req.offsetX));
  form.set('offsetY', String(req.offsetY));
  for (const [cellIndex, file] of req.photos) form.set(`cell-${cellIndex}`, file, file.name);

  const res = await fetch(`/api/sheet/render?format=${format}`, {
    method: 'POST',
    body: form,
    signal,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* JSON でない応答は、ステータスだけを伝える */
    }
    throw new Error(message);
  }
  let warnings: string[] = [];
  try {
    warnings = JSON.parse(
      decodeURIComponent(res.headers.get('x-sheet-warnings') ?? '[]'),
    ) as string[];
  } catch {
    /* 警告が読めなくても出力は使える */
  }
  return { blob: await res.blob(), warnings };
}
