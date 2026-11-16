import { DEFAULT_COLOR, isHexColor } from './testPrintUrl';

/** ブラウザに保存する、テスト印刷画面の入力内容 */
export interface TestPrintState {
  paperId: string | null;
  color: string;
  /** 用紙ごとの位置補正（mm） */
  offsets: Record<string, { x: number; y: number }>;
}

export const EMPTY_STATE: TestPrintState = { paperId: null, color: DEFAULT_COLOR, offsets: {} };
const KEY = 'photo-sticker-print:test-print';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 保存された文字列を検証して読む。壊れていたら空の状態に戻す。 */
export function parseState(raw: string | null): TestPrintState {
  if (!raw) return EMPTY_STATE;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isObject(v)) return EMPTY_STATE;
    const offsets: TestPrintState['offsets'] = {};
    if (isObject(v.offsets)) {
      for (const [id, o] of Object.entries(v.offsets)) {
        if (isObject(o) && Number.isFinite(o.x) && Number.isFinite(o.y)) {
          offsets[id] = { x: o.x as number, y: o.y as number };
        }
      }
    }
    return {
      paperId: typeof v.paperId === 'string' ? v.paperId : null,
      color: typeof v.color === 'string' && isHexColor(v.color) ? v.color : DEFAULT_COLOR,
      offsets,
    };
  } catch {
    return EMPTY_STATE;
  }
}

// localStorage は使えないことがある（プライベートモード等）。失敗しても動くようにする。
export function loadState(): TestPrintState {
  try {
    return parseState(localStorage.getItem(KEY));
  } catch {
    return EMPTY_STATE;
  }
}

export function saveState(state: TestPrintState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 保存できなくても画面は使える */
  }
}

const BLEED_KEY = 'photo-sticker-print:bleed';

/** 塗り足し（mm）の前回の値。無い・不正なときは null */
export function loadBleed(): number | null {
  try {
    const v = Number(localStorage.getItem(BLEED_KEY));
    return Number.isFinite(v) && v >= 0 && v <= 3 && localStorage.getItem(BLEED_KEY) !== null
      ? v
      : null;
  } catch {
    return null;
  }
}

export function saveBleed(mm: number): void {
  try {
    localStorage.setItem(BLEED_KEY, String(mm));
  } catch {
    /* 保存できなくても画面は使える */
  }
}
