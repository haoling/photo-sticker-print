import {
  isDefaultEdit,
  MAX_ZOOM,
  MIN_ZOOM,
  rotateEdit,
  toggleFlip,
  withZoom,
  DEFAULT_EDIT,
  type CellEdit,
} from './cellEdit';

interface Props {
  /** 編集しているコマの番号（0 始まり） */
  index: number;
  cellCount: number;
  /** コマに入っている写真の名前 */
  name: string;
  edit: CellEdit;
  /** 埋まっているコマの番号（入れ替え先の候補に使う） */
  filled: number[];
  onChange: (edit: CellEdit) => void;
  onSwap: (other: number) => void;
  onFillAll: () => void;
  onReplaceFile: () => void;
  onClear: () => void;
  onClose: () => void;
}

/** 選んだコマの編集（拡大・回転・左右反転・入れ替え）。位置は、シートの上でドラッグして動かす */
export function CellEditor({
  index,
  cellCount,
  name,
  edit,
  filled,
  onChange,
  onSwap,
  onFillAll,
  onReplaceFile,
  onClear,
  onClose,
}: Props) {
  const swapTargets = Array.from({ length: cellCount }, (_, i) => i).filter((i) => i !== index);
  return (
    <section className="cell-editor" aria-label={`コマ ${index + 1} の編集`}>
      <div className="editor-head">
        <b>コマ {index + 1} を編集</b>
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </div>
      <p className="note editor-name">{name}</p>

      <label className="field">
        <span>拡大: {edit.zoom.toFixed(1)} 倍</span>
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.1}
          value={edit.zoom}
          aria-label="拡大"
          onChange={(e) => onChange(withZoom(edit, Number(e.target.value)))}
        />
      </label>
      <div className="presets">
        <button type="button" onClick={() => onChange(withZoom(edit, edit.zoom - 0.5))}>
          − 縮小
        </button>
        <button type="button" onClick={() => onChange(withZoom(edit, edit.zoom + 0.5))}>
          ＋ 拡大
        </button>
      </div>
      <p className="note">
        位置は、シートの上でこのコマをドラッグして合わせます（拡大すると動かせます）。
      </p>

      <div className="presets">
        <button type="button" onClick={() => onChange(rotateEdit(edit, -1))}>
          ↺ 左に回す
        </button>
        <button type="button" onClick={() => onChange(rotateEdit(edit, 1))}>
          ↻ 右に回す
        </button>
        <button type="button" aria-pressed={edit.flipH} onClick={() => onChange(toggleFlip(edit))}>
          ⇋ 左右反転
        </button>
        <button type="button" disabled={isDefaultEdit(edit)} onClick={() => onChange(DEFAULT_EDIT)}>
          元に戻す
        </button>
      </div>

      <fieldset className="offsets">
        <legend>コマの操作</legend>
        <label className="field inline">
          <span>入れ替え先</span>
          <select
            value=""
            aria-label="このコマと入れ替えるコマ"
            onChange={(e) => {
              if (e.target.value !== '') onSwap(Number(e.target.value));
            }}
          >
            <option value="">コマを選ぶ…</option>
            {swapTargets.map((i) => (
              <option key={i} value={i}>
                コマ {i + 1}
                {filled.includes(i) ? '' : '（空）'}
              </option>
            ))}
          </select>
        </label>
        <div className="presets">
          <button type="button" onClick={onFillAll}>
            この写真で全部埋める
          </button>
          <button type="button" onClick={onReplaceFile}>
            手元のファイルに差し替え
          </button>
          <button type="button" onClick={onClear}>
            写真を外す
          </button>
        </div>
      </fieldset>
    </section>
  );
}
