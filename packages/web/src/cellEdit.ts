/**
 * コマごとの編集パラメータと、切り抜きの計算。サーバー（packages/server/src/print/cellEdit.ts）と
 * 同じ計算で、両方のテストが fixtures/cell-edit-cases.json を読んで同じ値になることを確かめている。
 * 画面のプレビューと、サーバーが作る印刷画像がずれないようにするための共通の形式。
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

export interface CellEdit {
  /** 拡大率。1 = 枠いっぱいに敷く（中央を基準に切り抜く）、2 = 2 倍に拡大（1〜8） */
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

/** 写真のうち、塗り足しを含む範囲 box にどこを敷くか。窓の縦横比は box と同じ。 */
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
    left: clamp(clamp(edit.focusX, 0, 1) * ow - width / 2, 0, ow - width),
    top: clamp(clamp(edit.focusY, 0, 1) * oh - height / 2, 0, oh - height),
    width,
    height,
  };
}

/**
 * プレビューの配置。塗り足しを含む範囲（box）の中に、写真全体を並べた入れ物を、
 * 切り抜きの窓が box にちょうど重なる位置と大きさで置く（単位は box に対する %）。
 * 入れ物の中の <img> は、回転・反転の分だけ transform する（回転のあとに反転）。
 */
export function previewLayout(
  img: { w: number; h: number },
  box: { w: number; h: number },
  edit: CellEdit,
) {
  const r = cropRect(img, box, edit);
  return {
    container: {
      leftPct: 0 - (r.left / r.width) * 100, // -0 にならない書き方
      topPct: 0 - (r.top / r.height) * 100,
      widthPct: (r.orientedW / r.width) * 100,
      heightPct: (r.orientedH / r.height) * 100,
    },
    /** 90° / 270° のとき、<img> の縦横を入れ物と入れ替えて置く */
    swap: edit.rotation === 90 || edit.rotation === 270,
    transform: `translate(-50%, -50%) scaleX(${edit.flipH ? -1 : 1}) rotate(${edit.rotation}deg)`,
  };
}

/** 拡大率を範囲内（1〜8）にして返す */
export const withZoom = (edit: CellEdit, zoom: number): CellEdit => ({
  ...edit,
  zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM),
});

/** 左右反転を切り替える。切り抜きの中心も、見た目の位置が変わらないよう左右を入れ替える */
export const toggleFlip = (edit: CellEdit): CellEdit => ({
  ...edit,
  flipH: !edit.flipH,
  focusX: 1 - edit.focusX,
});

const ROTATIONS = [0, 90, 180, 270] as const;

/**
 * 90° 単位で回す（時計回りが正）。反転は回転のあとに行う決まりなので、反転しているときは
 * 見た目の回す向きと保存する回転の向きが逆になる。切り抜きの中心は、見た目の位置が変わらないよう追従させる。
 */
export function rotateEdit(edit: CellEdit, quarterTurnsClockwise: 1 | -1): CellEdit {
  // 見た目で時計回りに回す = 反転前の座標では、反転していれば反時計回り
  const turn = edit.flipH ? -quarterTurnsClockwise : quarterTurnsClockwise;
  const rotation = ROTATIONS[(ROTATIONS.indexOf(edit.rotation) + turn + 4) % 4]!;
  // 見た目（反転後）の中心を、見た目で回す。(x, y) → 時計回り (1 - y, x)、反時計回り (y, 1 - x)
  const { focusX: x, focusY: y } = edit;
  const [focusX, focusY] = quarterTurnsClockwise === 1 ? [1 - y, x] : [y, 1 - x];
  return { ...edit, rotation, focusX, focusY };
}

/**
 * 枠の上でのドラッグ量から、切り抜きの中心を動かす。写真がポインタについてくるように動くので、
 * 中心は逆向きに動く。dx / dy は枠（塗り足しを含む範囲 box）の幅・高さに対する割合。
 */
export function panEdit(
  img: { w: number; h: number },
  box: { w: number; h: number },
  edit: CellEdit,
  dx: number,
  dy: number,
): CellEdit {
  const r = cropRect(img, box, edit);
  const left = clamp(r.left - dx * r.width, 0, r.orientedW - r.width);
  const top = clamp(r.top - dy * r.height, 0, r.orientedH - r.height);
  return {
    ...edit,
    focusX: (left + r.width / 2) / r.orientedW,
    focusY: (top + r.height / 2) / r.orientedH,
  };
}
