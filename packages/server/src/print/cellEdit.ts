import { z } from 'zod';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;

/**
 * コマごとの編集パラメータ。元の写真は変えず、このパラメータだけを持つ。
 * 画面のプレビュー（packages/web/src/cellEdit.ts）と、サーバーの印刷画像（sheet.ts）が
 * 同じ計算（cropRect）を使い、仕上がりがずれないようにする。
 * 両方のテストが fixtures/cell-edit-cases.json を読んで、同じ値になることを確かめている。
 */
export interface CellEdit {
  /** 拡大率。1 = 枠いっぱいに敷く（中央を基準に切り抜く）、2 = 2 倍に拡大、1 より小さいと縮小して余白が白になる（0.25〜8） */
  zoom: number;
  /** 切り抜きの中心。回転・反転後の写真の左上を 0、右下を 1 とする（0.5 = 中央） */
  focusX: number;
  focusY: number;
  /** 回転（時計回りの度）。EXIF の向きを反映したあとの写真に対して行う */
  rotation: 0 | 90 | 180 | 270;
  /** 左右反転。回転のあとに行う */
  flipH: boolean;
}

export const DEFAULT_EDIT: CellEdit = {
  zoom: 1,
  focusX: 0.5,
  focusY: 0.5,
  rotation: 0,
  flipH: false,
};

/** HTTP で受け取る編集パラメータの検証（範囲外は拒否する。省略した項目は既定値） */
export const cellEditSchema = z
  .object({
    zoom: z.number().min(MIN_ZOOM).max(MAX_ZOOM).default(DEFAULT_EDIT.zoom),
    focusX: z.number().min(0).max(1).default(DEFAULT_EDIT.focusX),
    focusY: z.number().min(0).max(1).default(DEFAULT_EDIT.focusY),
    rotation: z
      .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
      .default(DEFAULT_EDIT.rotation),
    flipH: z.boolean().default(DEFAULT_EDIT.flipH),
  })
  .strict();

export const isDefaultEdit = (e: CellEdit) =>
  e.zoom === DEFAULT_EDIT.zoom &&
  e.focusX === DEFAULT_EDIT.focusX &&
  e.focusY === DEFAULT_EDIT.focusY &&
  e.rotation === DEFAULT_EDIT.rotation &&
  !e.flipH;

export interface CropRect {
  /** 回転・反転後の写真の大きさ（画素） */
  orientedW: number;
  orientedH: number;
  /** 切り抜く範囲（回転・反転後の写真の座標、画素） */
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * 窓の端（start）を収める。窓が写真より小さければ写真の内側、大きければ（縮小したとき）写真が窓の内側に
 * 収まる範囲。後者では left / top が負になり、窓のうち写真のない部分は白になる。
 */
export const clampWindow = (start: number, total: number, window: number) =>
  clamp(start, Math.min(0, total - window), Math.max(0, total - window));

/**
 * 写真（EXIF の向きを反映済みの大きさ）のうち、塗り足しを含む範囲 box にどこを敷くかを求める。
 * 窓の縦横比は box と同じ。zoom 1 なら、box いっぱいに敷いて（cover）はみ出す分を捨てる窓になる。
 */
export function cropRect(
  img: { w: number; h: number },
  box: { w: number; h: number },
  edit: CellEdit,
): CropRect {
  const swap = edit.rotation === 90 || edit.rotation === 270;
  const ow = swap ? img.h : img.w;
  const oh = swap ? img.w : img.h;
  const zoom = clamp(edit.zoom, MIN_ZOOM, MAX_ZOOM);
  const scale = Math.max(box.w / ow, box.h / oh) * zoom;
  const width = box.w / scale;
  const height = box.h / scale;
  return {
    orientedW: ow,
    orientedH: oh,
    left: clampWindow(clamp(edit.focusX, 0, 1) * ow - width / 2, ow, width),
    top: clampWindow(clamp(edit.focusY, 0, 1) * oh - height / 2, oh, height),
    width,
    height,
  };
}
