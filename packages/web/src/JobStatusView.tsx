import { useEffect, useState } from 'react';
import { fetchJobStatus, type JobStatus, type PrinterTargetInput } from './api';
import { describeReasons, jobStateLabel } from './jobLabels';

const POLL_MS = 2000;
const MAX_POLLS = 300; // 10 分
const MAX_CONSECUTIVE_ERRORS = 5;

/** 送ったジョブの状態を、終わるまで数秒おきに取りに行って表示する */
export function JobStatusView({ target, jobId }: { target: PrinterTargetInput; jobId: number }) {
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    let polls = 0;
    let errors = 0;
    let seen = false;

    const poll = async () => {
      try {
        const s = await fetchJobStatus(target, jobId, ctrl.signal);
        if (cancelled) return;
        seen = true;
        errors = 0;
        setError(null);
        setStatus(s);
        if (s.final) return;
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        // 印刷が終わったジョブは、プリンタが覚えていないことが多い（not-found）
        if (seen && /not-found/.test(message)) {
          setGone(true);
          return;
        }
        errors++;
        setError(message);
        if (errors >= MAX_CONSECUTIVE_ERRORS) return;
      }
      if (++polls < MAX_POLLS) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [target.host, target.port, target.path, jobId]);

  const reasons = status
    ? describeReasons([...status.printerStateReasons, ...status.stateReasons])
    : [];
  const bad = status?.state === 'aborted' || status?.state === 'canceled';
  const done = status?.state === 'completed';

  return (
    <div className="job" role="status" aria-live="polite">
      <p className={bad ? 'invalid' : done ? 'ok-strong' : 'note'}>
        ジョブ {jobId}: <b>{gone ? '終わったようです' : jobStateLabel(status?.state ?? null)}</b>
        {status?.sheetsCompleted ? `（${status.sheetsCompleted} 枚）` : ''}
        {!status && !error && ' 取得中…'}
      </p>
      {gone && (
        <p className="note">
          プリンタがこのジョブを覚えていません。印刷が終わって、プリンタから消えた可能性があります。
        </p>
      )}
      {reasons.length > 0 && (
        <ul className="reasons">
          {reasons.map((r) => (
            <li key={r.text} data-severity={r.severity}>
              {r.text}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="invalid">状態を取得できません: {error}</p>}
    </div>
  );
}
