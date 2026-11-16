import { isDefaultEdit, type CellEdit } from './cellEdit';

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
  /** 印刷の既定値（IPP の用紙の種類・給紙位置・フチあり／なし）。用紙の推奨設定から決まる */
  printDefaults: { mediaType?: string; mediaSource?: string; borderless: boolean };
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
  /** コマごとの編集（拡大・位置・回転・左右反転）。既定のコマは省略できる */
  edits?: Record<number, CellEdit>;
}

async function readError(res: Response): Promise<Error> {
  let message = `HTTP ${res.status}`;
  try {
    message = ((await res.json()) as { error?: string }).error ?? message;
  } catch {
    /* JSON でない応答は、ステータスだけを伝える */
  }
  return new Error(message);
}

function sheetForm(req: SheetRequest): FormData {
  const form = new FormData();
  form.set('paperId', req.paperId);
  form.set('bleedMm', String(req.bleedMm));
  form.set('offsetX', String(req.offsetX));
  form.set('offsetY', String(req.offsetY));
  for (const [cellIndex, file] of req.photos) {
    form.set(`cell-${cellIndex}`, file, file.name);
    const edit = req.edits?.[cellIndex];
    if (edit && !isDefaultEdit(edit)) form.set(`edit-${cellIndex}`, JSON.stringify(edit));
  }
  return form;
}

/** 写真を割り付けたシートをサーバーで作る。写真は保存されない。 */
export async function renderSheet(
  format: SheetFormat,
  req: SheetRequest,
  signal?: AbortSignal,
): Promise<{ blob: Blob; warnings: string[] }> {
  const res = await fetch(`/api/sheet/render?format=${format}`, {
    method: 'POST',
    body: sheetForm(req),
    signal,
  });
  if (!res.ok) throw await readError(res);
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

// ---------- プリンタへの直接送信（IPP） ----------

/** プリンタの接続先（画面で手入力する） */
export interface PrinterTargetInput {
  host: string;
  port?: string;
  path?: string;
}

export interface PrinterInfo {
  name: string | null;
  makeAndModel: string | null;
  uuid: string | null;
  state: number | null;
  stateReasons: string[];
  documentFormats: string[];
  mediaSizes: string[];
  mediaTypes: string[];
  mediaSources: string[];
  qualities: number[];
  supportsHagaki: boolean;
  supportsPwgRaster: boolean;
}

/** 印刷の設定。省略した項目は、用紙の推奨設定（printDefaults）になる */
export interface PrintOptionsInput {
  mediaType?: string;
  mediaSource?: string;
  borderless?: boolean;
  /** 3 = はやい, 4 = 標準, 5 = きれい */
  quality: number;
}

export interface SentJob {
  jobId: number;
  raster: { widthPx: number; heightPx: number; bytes: number };
}

export interface SendResult {
  job: SentJob;
  warnings: string[];
}

const printerFormFields = (t: PrinterTargetInput, o: PrintOptionsInput): [string, string][] => [
  ['printerHost', t.host],
  ['printerPort', t.port ?? ''],
  ['printerPath', t.path ?? ''],
  ['mediaType', o.mediaType ?? ''],
  ['mediaSource', o.mediaSource ?? ''],
  ['borderless', o.borderless === undefined ? '' : String(o.borderless)],
  ['quality', String(o.quality)],
];

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

/** プリンタに接続して、機種・状態・対応する用紙の種類などを調べる */
export async function probePrinter(
  target: PrinterTargetInput,
  signal?: AbortSignal,
): Promise<PrinterInfo> {
  const res = await postJson<{ printer: PrinterInfo }>('/api/printers/probe', target, signal);
  return res.printer;
}

/** 写真を割り付けたシートを、プリンタへ送る */
export async function printSheet(
  req: SheetRequest,
  printer: PrinterTargetInput,
  options: PrintOptionsInput,
): Promise<SendResult> {
  const form = sheetForm(req);
  for (const [k, v] of printerFormFields(printer, options)) form.set(k, v);
  const res = await fetch('/api/print/sheet', { method: 'POST', body: form });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as SendResult;
}

/** テスト印刷（コマの枠線だけ）を、プリンタへ送る */
export async function printTestPage(
  req: { paperId: string; offsetX: number; offsetY: number; color: string },
  printer: PrinterTargetInput,
  options: PrintOptionsInput,
): Promise<SendResult> {
  return postJson<SendResult>('/api/print/test', {
    ...req,
    ...Object.fromEntries(printerFormFields(printer, options)),
  });
}

export interface JobStatus {
  jobId: number;
  state: string | null;
  stateReasons: string[];
  sheetsCompleted: number | null;
  printerState: string | null;
  printerStateReasons: string[];
  /** これ以降は状態が変わらない */
  final: boolean;
}

export async function fetchJobStatus(
  target: PrinterTargetInput,
  jobId: number,
  signal?: AbortSignal,
): Promise<JobStatus> {
  const q = new URLSearchParams({ host: target.host });
  if (target.port) q.set('port', target.port);
  if (target.path) q.set('path', target.path);
  const res = await fetch(`/api/print/jobs/${jobId}?${q}`, { signal });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as JobStatus;
}
