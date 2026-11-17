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
