import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchPapers, type PaperSummary } from './api';
import { loadState, saveState, type TestPrintState } from './storage';
import { buildTestPrintUrl, DEFAULT_COLOR, OFFSET_LIMIT_MM, parseOffset } from './testPrintUrl';

const COLOR_PRESETS: { label: string; value: string }[] = [
  { label: '黒', value: '#000000' },
  { label: '赤', value: '#ff0000' },
  { label: '青', value: '#0000ff' },
  { label: '緑', value: '#00a000' },
  { label: 'マゼンタ', value: '#ff00ff' },
];

const STATUS_LABEL = {
  unmeasured: 'コマ位置が未測定',
  measured: 'コマ位置は測定値（実機では未検証）',
  verified: '実機で検証済み',
} as const;

export function TestPrintPage() {
  const [papers, setPapers] = useState<PaperSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved] = useState<TestPrintState>(loadState);
  // 用紙の一覧が届くまでは選ばない（保存済みの位置補正を 0 で上書きしないため）
  const [paperId, setPaperId] = useState<string | null>(null);
  const [color, setColor] = useState(saved.color);
  // 用紙ごとの位置補正。画面の再描画には使わないので ref で持つ
  const offsetsRef = useRef(saved.offsets);
  // 入力途中（"-" や "0." など）を許すため、位置補正は文字列で持つ
  const [xText, setXText] = useState('0');
  const [yText, setYText] = useState('0');

  // 用紙を切り替えるとき、その用紙で最後に使った位置補正を同時に入れる。
  // （別々に更新すると、一瞬だけ前の用紙の補正値で描かれてしまう）
  const selectPaper = (id: string | null) => {
    const o = id ? offsetsRef.current[id] : undefined;
    setPaperId(id);
    setXText(String(o?.x ?? 0));
    setYText(String(o?.y ?? 0));
  };

  useEffect(() => {
    const ctrl = new AbortController();
    fetchPapers(ctrl.signal)
      .then((list) => {
        setPapers(list);
        const keep = list.find((p) => p.id === saved.paperId && p.printable);
        selectPaper(keep?.id ?? list.find((p) => p.printable)?.id ?? null);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, []);

  const paper = papers?.find((p) => p.id === paperId) ?? null;

  const x = parseOffset(xText);
  const y = parseOffset(yText);

  // 有効な値だけを覚えて、ブラウザに保存する
  useEffect(() => {
    if (!paperId || x === null || y === null) return;
    offsetsRef.current = { ...offsetsRef.current, [paperId]: { x, y } };
    saveState({ paperId, color, offsets: offsetsRef.current });
  }, [paperId, color, x, y]);

  const params = useMemo(() => ({ offsetX: x ?? 0, offsetY: y ?? 0, color }), [x, y, color]);
  const urls = paper
    ? {
        svg: buildTestPrintUrl(paper.id, 'svg', params),
        png: buildTestPrintUrl(paper.id, 'png', params),
        pdf: buildTestPrintUrl(paper.id, 'pdf', params),
      }
    : null;

  if (error) return <p role="alert">エラー: {error}</p>;
  if (!papers) return <p>読み込み中…</p>;

  return (
    <div className="tp">
      <section className="tp-controls" aria-label="設定">
        <label className="field">
          <span>用紙</span>
          <select value={paperId ?? ''} onChange={(e) => selectPaper(e.target.value || null)}>
            {papers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.printable}>
                {p.name}
                {p.printable ? '' : '（未測定）'}
              </option>
            ))}
          </select>
        </label>
        {paper && (
          <p className="note">
            {paper.sheet.widthMm}×{paper.sheet.heightMm}mm、コマ {paper.layout.cellWidthMm}×
            {paper.layout.cellHeightMm}mm の {paper.layout.columns}列×{paper.layout.rows}段。
            {STATUS_LABEL[paper.verification.status]}。
          </p>
        )}

        <fieldset className="offsets">
          <legend>位置補正（mm）</legend>
          {(
            [
              ['x', '横（+で右）', xText, x],
              ['y', '縦（+で下）', yText, y],
            ] as const
          ).map(([axis, label, text, value]) => (
            <label className="field" key={axis}>
              <span>{label}</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.05"
                min={-OFFSET_LIMIT_MM}
                max={OFFSET_LIMIT_MM}
                value={text}
                aria-invalid={value === null}
                onChange={(e) => (axis === 'x' ? setXText : setYText)(e.target.value)}
              />
            </label>
          ))}
          {(x === null || y === null) && (
            <p role="alert" className="invalid">
              位置補正は ±{OFFSET_LIMIT_MM}mm の範囲の数値で入力してください。
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              setXText('0');
              setYText('0');
            }}
          >
            0 に戻す
          </button>
        </fieldset>

        <fieldset className="colors">
          <legend>線の色</legend>
          <label className="field inline">
            <input
              type="color"
              value={color}
              aria-label="線の色"
              onChange={(e) => setColor(e.target.value)}
            />
            <code>{color}</code>
          </label>
          <div className="presets">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c.value}
                type="button"
                className="swatch"
                aria-pressed={color === c.value}
                title={c.label}
                style={{ background: c.value }}
                onClick={() => setColor(c.value)}
              >
                <span className="sr-only">{c.label}</span>
              </button>
            ))}
            <button type="button" onClick={() => setColor(DEFAULT_COLOR)}>
              黒に戻す
            </button>
          </div>
        </fieldset>

        {urls && (
          <div className="actions">
            <a className="button primary" href={urls.pdf} target="_blank" rel="noreferrer">
              PDF を開く
            </a>
            <a className="button" href={urls.png} download={`test-print-${paper?.id}.png`}>
              PNG をダウンロード
            </a>
          </div>
        )}

        <details className="howto">
          <summary>刷り方</summary>
          <ol>
            <li>
              PDF を開いて、用紙サイズ <b>はがき</b>、拡大縮小 <b>100%（実際のサイズ）</b>{' '}
              で印刷する。「ページに合わせる」は切る。
            </li>
            <li>刷った枠線を、台紙のハーフカット（コマの輪郭）と見比べる。</li>
            <li>
              本来の位置より左にずれて出たら 横 を +、上にずれて出たら 縦 を +
              にして、もう一度刷る。
            </li>
          </ol>
          <p className="note">
            画面の大きさは、ブラウザの表示倍率で実寸と違って見えます。位置は刷ったもので確かめてください。
          </p>
        </details>
      </section>

      <section className="tp-preview" aria-label="プレビュー">
        {paper && urls ? (
          <div
            className="sheet"
            style={{ aspectRatio: `${paper.sheet.widthMm} / ${paper.sheet.heightMm}` }}
          >
            <img
              src={urls.svg}
              alt={`${paper.name} のテスト印刷プレビュー`}
              width={paper.sheet.widthMm}
              height={paper.sheet.heightMm}
            />
          </div>
        ) : (
          <p>印刷できる用紙がありません（コマ位置が未測定）。</p>
        )}
      </section>
    </div>
  );
}
