import { DEFAULT_EDIT, MAX_ZOOM, MIN_ZOOM, type CellEdit } from './cellEdit';

/** 作業中のシートのうち、リロードで復元するもの。手元のファイルは保存できないので入れない */
export interface WorkState {
  paperId: string | null;
  /** コマの番号 → フォトストレージの写真 */
  slots: Record<number, { photoId: string; name: string; edit: CellEdit }>;
}

export const EMPTY_WORK: WorkState = { paperId: null, slots: {} };
const KEY = 'photo-sticker-print:work';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback;

function parseEdit(v: unknown): CellEdit {
  if (!isObject(v)) return DEFAULT_EDIT;
  const r = v.rotation;
  return {
    zoom: num(v.zoom, MIN_ZOOM, MAX_ZOOM, 1),
    focusX: num(v.focusX, 0, 1, 0.5),
    focusY: num(v.focusY, 0, 1, 0.5),
    rotation: r === 90 || r === 180 || r === 270 ? r : 0,
    flipH: v.flipH === true,
  };
}

/** 保存された文字列を検証して読む。壊れていたら空の状態に戻す（壊れた項目だけ捨てる） */
export function parseWork(raw: string | null): WorkState {
  if (!raw) return EMPTY_WORK;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isObject(v)) return EMPTY_WORK;
    const slots: WorkState['slots'] = {};
    if (isObject(v.slots)) {
      for (const [k, s] of Object.entries(v.slots)) {
        const i = Number(k);
        if (!Number.isInteger(i) || i < 0 || !isObject(s)) continue;
        if (typeof s.photoId !== 'string' || !s.photoId) continue;
        slots[i] = {
          photoId: s.photoId,
          name: typeof s.name === 'string' ? s.name : '',
          edit: parseEdit(s.edit),
        };
      }
    }
    return { paperId: typeof v.paperId === 'string' ? v.paperId : null, slots };
  } catch {
    return EMPTY_WORK;
  }
}

export function loadWork(): WorkState {
  try {
    return parseWork(localStorage.getItem(KEY));
  } catch {
    return EMPTY_WORK;
  }
}

export function saveWork(state: WorkState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 保存できなくても画面は使える */
  }
}
