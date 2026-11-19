import { useEffect, useMemo, useRef, useState } from 'react';
import { CellEditor } from './CellEditor';
import { DEFAULT_EDIT, panEdit, previewLayout, type CellEdit } from './cellEdit';
import {
  fetchPapers,
  photoPreviewUrl,
  printSheet,
  renderSheet,
  type PaperSummary,
  type Photo,
  type SheetFormat,
} from './api';
import { PhotoBrowser } from './PhotoBrowser';
import { DRAG_TYPE, parseDragData } from './photoList';
import { PrintPanel } from './PrintPanel';
import {
  assignInOrder,
  bleedBox,
  DEFAULT_BLEED_MM,
  fillAll,
  MAX_BLEED_MM,
  parseBleed,
} from './sheetLayout';
import { loadBleed, loadState, saveBleed } from './storage';
import { loadWork, saveWork } from './workState';

interface Slot {
  /** 手元のファイル。フォトストレージの写真なら無い */
  file?: File;
  /** フォトストレージの写真の id。手元のファイルなら無い */
  photoId?: string;
  name: string;
  url: string;
  /** 拡大・位置・回転・左右反転 */
  edit: CellEdit;
  /** 写真の大きさ（画素。EXIF の向きを反映したもの）。読み込めるまでは未定 */
  size?: { w: number; h: number };
}

/** 写真の大きさを読む。ブラウザは EXIF の向きを反映して表示するので、その大きさになる */
function loadSize(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const fileSlot = (file: File): Slot => ({
  file,
  name: file.name,
  url: URL.createObjectURL(file),
  edit: DEFAULT_EDIT,
});
const photoSlot = (photo: Pick<Photo, 'id' | 'name'>): Slot => ({
  photoId: photo.id,
  name: photo.name,
  url: photoPreviewUrl(photo.id),
  edit: DEFAULT_EDIT,
});
/** 手元のファイルのために作った一時 URL を解放する（フォトストレージの写真は何もしない） */
const release = (slot: Slot) => {
  if (slot.file) URL.revokeObjectURL(slot.url);
};

const pct = (v: number, total: number) => `${(v / total) * 100}%`;

/**
 * 写真を、塗り足しを含む範囲に敷く。サーバーが印刷画像を作る計算（cropRect）と同じ計算で置くので、
 * 画面のプレビューと印刷結果がずれない。
 */
function SlotPhoto({
  slot,
  size,
  box,
}: {
  slot: Slot;
  size: { w: number; h: number };
  box: { w: number; h: number };
}) {
  const l = previewLayout(size, box, slot.edit);
  return (
    <div
      className="photo-frame"
      style={{
        left: `${l.container.leftPct}%`,
        top: `${l.container.topPct}%`,
        width: `${l.container.widthPct}%`,
        height: `${l.container.heightPct}%`,
      }}
    >
      <img
        src={slot.url}
        alt=""
        style={{
          width: l.swap ? '100cqh' : '100cqw',
          height: l.swap ? '100cqw' : '100cqh',
          transform: l.transform,
        }}
      />
    </div>
  );
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function SheetPage() {
  const [papers, setPapers] = useState<PaperSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paperId, setPaperId] = useState<string | null>(null);
  const [bleedText, setBleedText] = useState(String(loadBleed() ?? DEFAULT_BLEED_MM));
  // リロードしても、フォトストレージの写真と編集は残す（手元のファイルは残せない）
  const [saved] = useState(loadWork);
  const [slots, setSlots] = useState<Record<number, Slot>>(() =>
    Object.fromEntries(
      Object.entries(saved.slots).map(([i, s]) => [
        i,
        { ...photoSlot({ id: s.photoId, name: s.name }), edit: s.edit },
      ]),
    ),
  );
  const [preview, setPreview] = useState<{ url: string; warnings: string[]; key: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<SheetFormat | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const bulkInput = useRef<HTMLInputElement>(null);
  const slotInput = useRef<HTMLInputElement>(null);
  const slotTarget = useRef<number | null>(null);
  /** 編集中のコマ（0 始まり）と、右の列で開いているタブ */
  const [selected, setSelected] = useState<number | null>(null);
  const [side, setSide] = useState<'photos' | 'edit'>('photos');
  const drag = useRef<{ x: number; y: number } | null>(null);

  // 画面を閉じるとき、作った一時 URL を解放する
  const latest = useRef({ slots, preview });
  latest.current = { slots, preview };
  useEffect(
    () => () => {
      Object.values(latest.current.slots).forEach(release);
      if (latest.current.preview) URL.revokeObjectURL(latest.current.preview.url);
    },
    [],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    fetchPapers(ctrl.signal)
      .then((list) => {
        setPapers(list);
        setPaperId(
          (list.find((p) => p.id === saved.paperId && p.printable) ?? list.find((p) => p.printable))
            ?.id ?? null,
        );
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, []);

  // 写真の大きさを読む（プレビューの切り抜きに使う）。読めたら、同じ写真のコマすべてに入れる
  useEffect(() => {
    const pending = new Set(
      Object.values(slots)
        .filter((s) => !s.size)
        .map((s) => s.url),
    );
    for (const url of pending) {
      void loadSize(url).then((size) => {
        if (!size) return;
        setSlots((cur) =>
          Object.fromEntries(
            Object.entries(cur).map(([i, s]) => [i, s.url === url ? { ...s, size } : s]),
          ),
        );
      });
    }
  }, [slots]);

  // 作業中のシートを保存する
  useEffect(() => {
    if (!papers) return; // 用紙を読むまでは、保存済みの用紙を消さない
    saveWork({
      paperId,
      slots: Object.fromEntries(
        Object.entries(slots)
          .filter(([, s]) => s.photoId)
          .map(([i, s]) => [i, { photoId: s.photoId!, name: s.name, edit: s.edit }]),
      ),
    });
  }, [papers, paperId, slots]);

  const paper = papers?.find((p) => p.id === paperId) ?? null;
  const cells = paper?.cells ?? [];
  const bleed = parseBleed(bleedText);
  // 位置補正は、テスト印刷の画面で決めた用紙ごとの値を使う
  const offset = useMemo(
    () => (paperId ? loadState().offsets[paperId] : undefined) ?? { x: 0, y: 0 },
    [paperId],
  );
  const photos = Object.entries(slots)
    .map(([i, s]) => [Number(i), s.file ?? s.photoId!] as [number, File | string])
    .filter(([i]) => i < cells.length)
    .sort((a, b) => a[0] - b[0]);

  // 最終確認の画像が、今の設定と写真で作ったものかを見分けるための印
  const edits = Object.fromEntries(photos.map(([i]) => [i, slots[i]!.edit]));
  const key = JSON.stringify({
    paperId,
    bleed,
    offset,
    photos: photos.map(([i, f]) =>
      typeof f === 'string' ? [i, f, edits[i]] : [i, f.name, f.size, f.lastModified, edits[i]],
    ),
  });
  const fresh = preview?.key === key;
  const ready = !!paper && bleed !== null && photos.length > 0;

  const addSlots = (entries: Slot[]) => {
    if (entries.length === 0) return;
    setSlots((cur) => {
      const next = assignInOrder(cur, entries, cells.length);
      // 入りきらなかった分の一時 URL は解放する
      entries.filter((e) => !Object.values(next).includes(e)).forEach(release);
      return next;
    });
  };
  const setSlot = (index: number, slot: Slot) =>
    setSlots((cur) => {
      if (cur[index]) release(cur[index]);
      return { ...cur, [index]: slot };
    });
  /** フォトストレージの写真を入れる。1 枚目は target のコマ（なければ空いたコマ）、残りは空いたコマに順に */
  const placePhotos = (list: Photo[], target?: number) => {
    const entries = list.map(photoSlot);
    if (target !== undefined && entries.length > 0) setSlot(target, entries.shift()!);
    addSlots(entries);
  };
  // 写真リストに、どの写真がいくつのコマに入っているかを出す
  const placed = new Map<string, number>();
  for (const [i, s] of Object.entries(slots)) {
    if (s.photoId && Number(i) < cells.length)
      placed.set(s.photoId, (placed.get(s.photoId) ?? 0) + 1);
  }
  const full = photos.length >= cells.length;
  const clearSlot = (index: number) =>
    setSlots((cur) => {
      if (cur[index]) release(cur[index]);
      const rest = { ...cur };
      delete rest[index];
      return rest;
    });
  const clearAll = () => {
    Object.values(slots).forEach(release);
    setSlots({});
  };
  const fillWithFirst = () => {
    const first = slots[photos[0]?.[0] ?? -1];
    if (!first) return;
    Object.values(slots).forEach((s) => s !== first && s.url !== first.url && release(s));
    setSlots(fillAll(first, cells.length));
  };

  const select = (index: number | null) => {
    setSelected(index);
    setSide(index === null ? 'photos' : 'edit');
  };
  const updateEdit = (index: number, edit: CellEdit) =>
    setSlots((cur) => (cur[index] ? { ...cur, [index]: { ...cur[index]!, edit } } : cur));
  /** 2 つのコマの写真を入れ替える（片方が空なら移す）。編集も写真について行く */
  const swapCells = (a: number, b: number) => {
    setSlots((cur) => {
      const next = { ...cur };
      const sa = cur[a];
      const sb = cur[b];
      if (sb) next[a] = sb;
      else delete next[a];
      if (sa) next[b] = sa;
      else delete next[b];
      return next;
    });
    setSelected(b);
  };
  /** 選んだコマの写真（と編集）で、全コマを埋める */
  const fillWith = (index: number) => {
    const src = slots[index];
    if (!src) return;
    Object.values(slots).forEach((s) => s !== src && s.url !== src.url && release(s));
    setSlots(fillAll(src, cells.length));
  };

  const run = async (format: SheetFormat) => {
    if (!paper || bleed === null) return;
    setBusy(format);
    setActionError(null);
    try {
      const { blob, warnings } = await renderSheet(format, {
        paperId: paper.id,
        bleedMm: bleed,
        offsetX: offset.x,
        offsetY: offset.y,
        photos,
        edits,
      });
      if (format === 'preview') {
        if (preview) URL.revokeObjectURL(preview.url);
        setPreview({ url: URL.createObjectURL(blob), warnings, key });
      } else {
        download(blob, `${paper.id}-sheet.${format}`);
        setPreview((p) => (p ? { ...p, warnings } : p));
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p role="alert">エラー: {error}</p>;
  if (!papers) return <p>読み込み中…</p>;

  const rp = paper?.recommendedPrint;
  return (
    <div className="tp with-photos">
      <section className="tp-controls" aria-label="設定">
        <label className="field">
          <span>用紙</span>
          <select value={paperId ?? ''} onChange={(e) => setPaperId(e.target.value || null)}>
            {papers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.printable}>
                {p.name}
                {p.printable ? '' : '（未測定）'}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="offsets">
          <legend>塗り足し（mm）</legend>
          <label className="field">
            <span>コマの外へはみ出させる量</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              max={MAX_BLEED_MM}
              value={bleedText}
              aria-invalid={bleed === null}
              onChange={(e) => {
                setBleedText(e.target.value);
                const n = parseBleed(e.target.value);
                if (n !== null) saveBleed(n);
              }}
            />
          </label>
          <input
            type="range"
            min={0}
            max={MAX_BLEED_MM}
            step={0.1}
            value={bleed ?? DEFAULT_BLEED_MM}
            aria-label="塗り足し"
            onChange={(e) => {
              setBleedText(e.target.value);
              saveBleed(Number(e.target.value));
            }}
          />
          {bleed === null && (
            <p role="alert" className="invalid">
              塗り足しは 0〜{MAX_BLEED_MM}mm の数値で入力してください。
            </p>
          )}
          <p className="note">
            ハーフカットのずれで白い隙間が出ないよう、写真をコマより少し大きく刷ります（既定
            {DEFAULT_BLEED_MM}mm）。
          </p>
        </fieldset>

        <fieldset className="offsets">
          <legend>写真</legend>
          <input
            ref={bulkInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addSlots([...(e.target.files ?? [])].map(fileSlot));
              e.target.value = '';
            }}
          />
          <button type="button" disabled={!paper} onClick={() => bulkInput.current?.click()}>
            手元のファイルを選ぶ（空いたコマに順に入る）
          </button>
          <div className="presets">
            <button type="button" disabled={photos.length === 0} onClick={fillWithFirst}>
              1 枚目の写真で全部埋める
            </button>
            <button type="button" disabled={photos.length === 0} onClick={clearAll}>
              すべてクリア
            </button>
          </div>
          <p className="note">
            {photos.length} / {cells.length}{' '}
            コマ。写真リストの写真を押すと空いたコマに入ります。手元のファイルも使えます。コマを押すと、そのコマに手元のファイルを選べます。
          </p>
        </fieldset>

        <p className="note">
          位置補正: 横 {offset.x}mm・縦 {offset.y}mm（テスト印刷の画面で決めた値）
        </p>
        {rp && (
          <p className="note">
            推奨設定:{' '}
            {[
              rp.mediaSource === 'rear'
                ? '後トレイ'
                : rp.mediaSource === 'main'
                  ? 'カセット'
                  : null,
              rp.borderless === false ? 'フチあり' : rp.borderless ? 'フチなし' : null,
              rp.mediaType ? `用紙の種類 ${rp.mediaType}` : null,
            ]
              .filter(Boolean)
              .join('、') || '（未設定）'}
          </p>
        )}

        <div className="actions">
          <button
            type="button"
            className="button primary"
            disabled={!ready || busy !== null}
            onClick={() => run('preview')}
          >
            {busy === 'preview' ? '作成中…' : '最終確認の画像を作る'}
          </button>
          <button
            type="button"
            className="button"
            disabled={!ready || !fresh || busy !== null}
            onClick={() => run('pdf')}
          >
            {busy === 'pdf' ? '作成中…' : 'PDF をダウンロード'}
          </button>
          <button
            type="button"
            className="button"
            disabled={!ready || !fresh || busy !== null}
            onClick={() => run('png')}
          >
            {busy === 'png' ? '作成中…' : 'PNG をダウンロード'}
          </button>
        </div>
        <p className="note">
          PDF と PNG
          は、今の設定で「最終確認の画像」を作ってから押せます（用紙を無駄にしないため）。
        </p>
        {actionError && (
          <p role="alert" className="invalid">
            {actionError}
          </p>
        )}

        <PrintPanel
          paper={paper}
          blockedReason={
            !ready
              ? '写真を割り付けてください'
              : !fresh
                ? '先に「最終確認の画像を作る」で、今の設定と写真を確認してください'
                : null
          }
          send={(printer, options) =>
            printSheet(
              {
                paperId: paper!.id,
                bleedMm: bleed!,
                offsetX: offset.x,
                offsetY: offset.y,
                photos,
                edits,
              },
              printer,
              options,
            )
          }
        />

        <details className="howto">
          <summary>刷り方</summary>
          <ol>
            <li>「最終確認の画像」で、写真の切り抜きと警告を確かめる。</li>
            <li>
              PDF を開いて、用紙サイズ <b>はがき</b>、拡大縮小 <b>100%（実際のサイズ）</b>{' '}
              で印刷する。「ページに合わせる」は切る。
            </li>
            <li>給紙位置・用紙の種類・フチありは、上の推奨設定に合わせる。</li>
          </ol>
        </details>
      </section>

      <section className="tp-preview" aria-label="割り付け">
        {paper && paper.cells && bleed !== null ? (
          <>
            <div
              className="sheet layout"
              style={{ aspectRatio: `${paper.sheet.widthMm} / ${paper.sheet.heightMm}` }}
            >
              {paper.cells.map((c) => {
                const slot = slots[c.index];
                const b = bleedBox(c, bleed);
                const W = paper.sheet.widthMm;
                const H = paper.sheet.heightMm;
                return (
                  <div key={c.index}>
                    {slot && (
                      <div
                        className="bleed"
                        style={{
                          left: pct(b.xMm, W),
                          top: pct(b.yMm, H),
                          width: pct(b.widthMm, W),
                          height: pct(b.heightMm, H),
                          borderRadius: `${(b.cornerRadiusMm * 100) / W}cqw`,
                        }}
                      >
                        {slot.size ? (
                          <SlotPhoto
                            slot={slot}
                            size={slot.size}
                            box={{ w: b.widthMm, h: b.heightMm }}
                          />
                        ) : (
                          <img src={slot.url} alt="" className="cover" />
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      className={
                        (slot ? 'cell filled' : 'cell') +
                        (dropTarget === c.index ? ' drop' : '') +
                        (selected === c.index ? ' selected' : '')
                      }
                      aria-label={`コマ ${c.index + 1}${slot ? `（${slot.name}）` : '（空）'}`}
                      style={{
                        left: pct(c.xMm, W),
                        top: pct(c.yMm, H),
                        width: pct(c.widthMm, W),
                        height: pct(c.heightMm, H),
                        borderRadius: `${(c.cornerRadiusMm * 100) / W}cqw`,
                      }}
                      onClick={() => {
                        if (slot) {
                          select(c.index);
                          return;
                        }
                        slotTarget.current = c.index;
                        slotInput.current?.click();
                      }}
                      onPointerDown={(e) => {
                        if (!slot?.size || selected !== c.index) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        drag.current = { x: e.clientX, y: e.clientY };
                      }}
                      onPointerMove={(e) => {
                        const from = drag.current;
                        if (!from || !slot?.size) return;
                        const r = e.currentTarget.getBoundingClientRect();
                        // 動かした量を、塗り足しを含む範囲に対する割合にする
                        const dx = ((e.clientX - from.x) / r.width) * (c.widthMm / b.widthMm);
                        const dy = ((e.clientY - from.y) / r.height) * (c.heightMm / b.heightMm);
                        drag.current = { x: e.clientX, y: e.clientY };
                        updateEdit(
                          c.index,
                          panEdit(slot.size, { w: b.widthMm, h: b.heightMm }, slot.edit, dx, dy),
                        );
                      }}
                      onPointerUp={() => (drag.current = null)}
                      onPointerCancel={() => (drag.current = null)}
                      onDragOver={(e) => {
                        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                        setDropTarget(c.index);
                      }}
                      onDragLeave={() => setDropTarget((t) => (t === c.index ? null : t))}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDropTarget(null);
                        placePhotos(parseDragData(e.dataTransfer.getData(DRAG_TYPE)), c.index);
                      }}
                    >
                      {slot ? '' : '＋'}
                    </button>
                    {slot && (
                      <button
                        type="button"
                        className="cell-clear"
                        aria-label={`コマ ${c.index + 1} の写真を外す`}
                        style={{
                          left: pct(c.xMm + c.widthMm, W),
                          top: pct(c.yMm, H),
                        }}
                        onClick={() => {
                          clearSlot(c.index);
                          if (selected === c.index) select(null);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <input
              ref={slotInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && slotTarget.current !== null)
                  setSlot(slotTarget.current, fileSlot(file));
                e.target.value = '';
              }}
            />
            <p className="note legend">
              点線: コマの輪郭（ハーフカット）。写真はその外側の塗り足しまで敷かれます。
            </p>
          </>
        ) : (
          <p>印刷できる用紙がありません（コマ位置が未測定）。</p>
        )}

        {preview && (
          <div className="final" aria-label="最終確認">
            <h3>
              最終確認（サーバーが作った画像）
              {!fresh && (
                <span className="stale">設定か写真が変わりました。作り直してください</span>
              )}
            </h3>
            <img src={preview.url} alt="印刷する内容の確認画像" className={fresh ? '' : 'dim'} />
            <p className="note legend">
              赤: コマの輪郭、青の点線: 塗り足しの範囲（印刷には含まれません）
            </p>
            {preview.warnings.length > 0 ? (
              <ul role="status" className="warnings">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : (
              <p role="status" className="ok">
                警告はありません。
              </p>
            )}
          </div>
        )}
      </section>

      <aside className="side" aria-label="写真と編集">
        <div className="tabs small" role="tablist" aria-label="右の画面">
          <button
            type="button"
            role="tab"
            aria-selected={side === 'photos'}
            onClick={() => setSide('photos')}
          >
            写真
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={side === 'edit'}
            onClick={() => setSide('edit')}
          >
            編集
          </button>
        </div>
        <div className="side-pane" hidden={side !== 'photos'}>
          <PhotoBrowser
            onPick={(photo) => placePhotos([photo])}
            placed={placed}
            full={!!paper && full}
          />
        </div>
        <div className="side-pane" hidden={side !== 'edit'}>
          {selected !== null && slots[selected] ? (
            <CellEditor
              index={selected}
              cellCount={cells.length}
              name={slots[selected]!.name}
              edit={slots[selected]!.edit}
              filled={Object.keys(slots).map(Number)}
              onChange={(edit) => updateEdit(selected, edit)}
              onSwap={(other) => swapCells(selected, other)}
              onFillAll={() => fillWith(selected)}
              onReplaceFile={() => {
                slotTarget.current = selected;
                slotInput.current?.click();
              }}
              onClear={() => {
                clearSlot(selected);
                select(null);
              }}
              onClose={() => select(null)}
            />
          ) : (
            <p className="note">編集するコマを、シートの上で押してください。</p>
          )}
        </div>
      </aside>
    </div>
  );
}
