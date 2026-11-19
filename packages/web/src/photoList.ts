import type { Photo } from './api';

/** 読み込み済みの写真の一覧（無限スクロールで後ろに足していく） */
export interface PhotoListState {
  photos: Photo[];
  /** 次のページを取るための値。undefined は最初のページ、null は最後まで読んだ */
  cursor: string | null | undefined;
}

export const EMPTY_LIST: PhotoListState = { photos: [], cursor: undefined };

/**
 * 次のページを後ろに足す。読んでいる間に写真が増えると、ページの境目で同じ写真がもう一度来るので、
 * すでにある id は足さない。
 */
export function appendPage(
  state: PhotoListState,
  page: { photos: Photo[]; nextCursor: string | null },
): PhotoListState {
  const seen = new Set(state.photos.map((p) => p.id));
  return {
    photos: [...state.photos, ...page.photos.filter((p) => !seen.has(p.id))],
    cursor: page.nextCursor,
  };
}

/** 選択の切り替え。選んだ順を保つ（流し込む順になる） */
export function toggleSelection(selected: Photo[], photo: Photo): Photo[] {
  return selected.some((p) => p.id === photo.id)
    ? selected.filter((p) => p.id !== photo.id)
    : [...selected, photo];
}

/** ドラッグで運ぶ写真。選択中の写真をつかんだら選択中の全部、そうでなければその 1 枚 */
export function draggedPhotos(selected: Photo[], photo: Photo): Photo[] {
  return selected.some((p) => p.id === photo.id)
    ? [photo, ...selected.filter((p) => p.id !== photo.id)]
    : [photo];
}

export const DRAG_TYPE = 'application/x-photo-sticker-print';

/** ドラッグで受け取ったデータを読む。形が違えば空 */
export function parseDragData(raw: string): Photo[] {
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (p): p is Photo =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as Photo).id === 'string' &&
        /^[A-Za-z0-9_-]{1,128}$/.test((p as Photo).id),
    );
  } catch {
    return [];
  }
}

/** 撮影日（一覧のツールチップ用）。読めない日付は空 */
export function formatTakenAt(takenAt: string | null): string {
  const m = takenAt ? /^(\d{4})-(\d{2})-(\d{2})/.exec(takenAt) : null;
  return m ? `${m[1]}/${m[2]}/${m[3]}` : '';
}

/** 撮影日ごとのまとまり（一覧の見出しの単位） */
export interface PhotoDayGroup {
  /** YYYY-MM-DD。日付のない写真は '' */
  key: string;
  /** 見出し（例: 2026年1月5日（月）） */
  label: string;
  photos: Photo[];
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 撮影日の見出し。takenAt は Immich の localDateTime（撮影地の時刻を Z 付きで表したもの）なので、
 * タイムゾーンで変換せず、先頭の日付をそのまま使う。
 */
export function dayLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return '日付なし';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const w = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return `${y}年${mo}月${d}日（${WEEKDAYS[w]}）`;
}

/**
 * 並んだ順のまま、同じ撮影日が続くところをひとまとめにする（一覧は撮影日の新しい順で来る）。
 * 並べ替えはしないので、無限スクロールで読み足しても、前のまとまりの位置は動かない。
 */
export function groupByDay(photos: Photo[]): PhotoDayGroup[] {
  const groups: PhotoDayGroup[] = [];
  for (const p of photos) {
    const m = p.takenAt ? /^(\d{4}-\d{2}-\d{2})/.exec(p.takenAt) : null;
    const key = m?.[1] ?? '';
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.photos.push(p);
    else groups.push({ key, label: dayLabel(key), photos: [p] });
  }
  return groups;
}
