import { useRef, useState } from 'react';
import {
  probePrinter,
  type PaperSummary,
  type PrinterInfo,
  type PrintOptionsInput,
  type PrinterTargetInput,
  type SendResult,
} from './api';
import { JobStatusView } from './JobStatusView';
import { loadPrinterState, savePrinterState, type PrintOverride } from './storage';

const QUALITIES = [
  { value: 5, label: 'きれい' },
  { value: 4, label: '標準' },
  { value: 3, label: 'はやい' },
];
const SOURCES = [
  { value: 'auto', label: '自動' },
  { value: 'main', label: 'カセット' },
  { value: 'rear', label: '後トレイ' },
];
const sourceLabel = (v?: string) =>
  SOURCES.find((s) => s.value === v)?.label ?? v ?? 'プリンタ任せ';

interface Props {
  paper: PaperSummary | null;
  /** 送れない理由。null なら送れる */
  blockedReason: string | null;
  send: (printer: PrinterTargetInput, options: PrintOptionsInput) => Promise<SendResult>;
}

/** プリンタに IPP で直接送る。接続先の入力・接続確認・印刷の設定・送信・ジョブの状態表示。 */
export function PrintPanel({ paper, blockedReason, send }: Props) {
  const [state, setState] = useState(loadPrinterState);
  // 保存済みの値を読んだ直後の最新を、更新のたびに保存する
  const stateRef = useRef(state);
  const update = (next: typeof state) => {
    stateRef.current = next;
    setState(next);
    savePrinterState(next);
  };
  const [info, setInfo] = useState<PrinterInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<{
    result: SendResult;
    printer: PrinterTargetInput;
  } | null>(null);

  const target: PrinterTargetInput = {
    host: state.host.trim(),
    port: state.port.trim() || undefined,
    path: state.path.trim() || undefined,
  };
  const override: PrintOverride = (paper && state.overrides[paper.id]) || {};
  const setOverride = (patch: Partial<PrintOverride>) => {
    if (!paper) return;
    const next = { ...override, ...patch };
    for (const k of Object.keys(next) as (keyof PrintOverride)[]) {
      if (next[k] === undefined || next[k] === '') delete next[k];
    }
    update({ ...stateRef.current, overrides: { ...stateRef.current.overrides, [paper.id]: next } });
  };

  const defaults = paper?.printDefaults;
  const effective = {
    mediaType: override.mediaType ?? defaults?.mediaType,
    mediaSource: override.mediaSource ?? defaults?.mediaSource,
    borderless: override.borderless ?? defaults?.borderless ?? false,
    quality: override.quality ?? 5,
  };

  const probe = async () => {
    setProbing(true);
    setProbeError(null);
    setInfo(null);
    try {
      setInfo(await probePrinter(target));
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  };

  const doSend = async () => {
    setSending(true);
    setSendError(null);
    setSent(null);
    try {
      const result = await send(target, {
        mediaType: override.mediaType,
        mediaSource: override.mediaSource,
        borderless: override.borderless,
        quality: effective.quality,
      });
      setSent({ result, printer: target });
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const blocked = !target.host ? 'プリンタのアドレスを入力してください' : blockedReason;
  const sourceOptions = info?.mediaSources.length ? info.mediaSources : SOURCES.map((s) => s.value);

  return (
    <fieldset className="offsets print-panel">
      <legend>プリンタに送る</legend>

      <label className="field">
        <span>プリンタのアドレス（IP アドレスかホスト名）</span>
        <input
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="例: 192.168.1.20"
          value={state.host}
          onChange={(e) => update({ ...state, host: e.target.value })}
        />
      </label>
      <details>
        <summary>ポートとパス（ふつうは変えない）</summary>
        <div className="presets">
          <input
            type="text"
            inputMode="numeric"
            aria-label="ポート"
            placeholder="631"
            value={state.port}
            onChange={(e) => update({ ...state, port: e.target.value })}
          />
          <input
            type="text"
            aria-label="パス"
            placeholder="/ipp/print"
            value={state.path}
            onChange={(e) => update({ ...state, path: e.target.value })}
          />
        </div>
      </details>
      <div className="presets">
        <button type="button" disabled={!target.host || probing} onClick={probe}>
          {probing ? '確認中…' : '接続を確認'}
        </button>
        {info && (
          <span className="note">
            {info.makeAndModel ?? info.name ?? 'プリンタ'}（
            {info.state === 3 ? '待機中' : info.state === 4 ? '印刷中' : '停止中'}）
          </span>
        )}
      </div>
      {info && !info.supportsHagaki && (
        <p role="alert" className="invalid">
          このプリンタは、はがき（100×148mm）に対応していないようです。
        </p>
      )}
      {info && !info.supportsPwgRaster && (
        <p role="alert" className="invalid">
          このプリンタは PWG Raster（image/pwg-raster）を受け付けないようです。
        </p>
      )}
      {probeError && (
        <p role="alert" className="invalid">
          {probeError}
        </p>
      )}

      <div className="print-options">
        <label className="field">
          <span>用紙の種類（IPP の media-type）</span>
          <input
            type="text"
            list="media-types"
            autoComplete="off"
            placeholder={defaults?.mediaType ?? 'プリンタ任せ'}
            value={override.mediaType ?? ''}
            onChange={(e) => setOverride({ mediaType: e.target.value.trim() })}
          />
          <datalist id="media-types">
            {(info?.mediaTypes ?? []).map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>給紙位置</span>
          <select
            value={override.mediaSource ?? ''}
            onChange={(e) => setOverride({ mediaSource: e.target.value })}
          >
            <option value="">用紙の推奨（{sourceLabel(defaults?.mediaSource)}）</option>
            {sourceOptions.map((s) => (
              <option key={s} value={s}>
                {sourceLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>フチ</span>
          <select
            value={override.borderless === undefined ? '' : String(override.borderless)}
            onChange={(e) =>
              setOverride({
                borderless: e.target.value === '' ? undefined : e.target.value === 'true',
              })
            }
          >
            <option value="">用紙の推奨（{defaults?.borderless ? 'フチなし' : 'フチあり'}）</option>
            <option value="false">フチあり</option>
            <option value="true">フチなし</option>
          </select>
        </label>
        <label className="field">
          <span>品質</span>
          <select
            value={effective.quality}
            onChange={(e) => setOverride({ quality: Number(e.target.value) })}
          >
            {QUALITIES.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="note">
        送る設定: {paper ? `${paper.sheet.widthMm}×${paper.sheet.heightMm}mm` : '—'}、用紙の種類{' '}
        {effective.mediaType ?? 'プリンタ任せ'}、{sourceLabel(effective.mediaSource)}、
        {effective.borderless ? 'フチなし' : 'フチあり'}、
        {QUALITIES.find((q) => q.value === effective.quality)?.label}、600dpi
      </p>

      <div className="actions">
        <button
          type="button"
          className="button primary"
          disabled={!!blocked || sending}
          onClick={doSend}
        >
          {sending ? '送信中…' : 'プリンタに送る'}
        </button>
      </div>
      {blocked && <p className="note">{blocked}</p>}
      {sendError && (
        <p role="alert" className="invalid">
          {sendError}
        </p>
      )}
      {sent && (
        <>
          {sent.result.warnings.length > 0 && (
            <ul role="status" className="warnings">
              {sent.result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <p className="note">
            送信しました（{sent.result.job.raster.widthPx}×{sent.result.job.raster.heightPx}px）。
          </p>
          <JobStatusView target={sent.printer} jobId={sent.result.job.jobId} />
        </>
      )}
    </fieldset>
  );
}
