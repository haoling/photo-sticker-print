/** 印刷ジョブの状態を、画面に出す日本語にする */

const JOB_STATE_LABEL: Record<string, string> = {
  pending: '待機中',
  held: '保留中',
  processing: '印刷中',
  stopped: '停止中',
  canceled: 'キャンセルされました',
  aborted: 'エラーで中止されました',
  completed: '完了',
};

export const jobStateLabel = (state: string | null) =>
  state === null ? '不明' : (JOB_STATE_LABEL[state] ?? state);

/** プリンタの状態の理由（IPP の printer-state-reasons / job-state-reasons） */
const REASON_LABEL: Record<string, string> = {
  'media-empty': '用紙がありません',
  'media-needed': '用紙が必要です',
  'media-jam': '紙詰まりです',
  'media-low': '用紙が残りわずかです',
  'marker-supply-empty': 'インクがなくなりました',
  'marker-supply-low': 'インクが残りわずかです',
  'marker-waste-full': '廃インク吸収体が満杯です',
  'marker-waste-almost-full': '廃インク吸収体がもうすぐ満杯です',
  'cover-open': 'カバーが開いています',
  'door-open': 'カバーが開いています',
  'input-tray-missing': '給紙トレイがありません',
  'output-tray-missing': '排紙トレイがありません',
  offline: 'オフラインです',
  paused: '一時停止中です',
  'toner-empty': 'トナーがありません',
  'connecting-to-device': 'プリンタに接続中です',
  'job-printing': '印刷中です',
  'job-incoming': '受信中です',
  'job-queued': '順番待ちです',
  'job-completed-successfully': '正常に終わりました',
  'job-canceled-by-user': 'キャンセルされました',
  'document-format-error': 'データの形式がプリンタに合いません',
  'document-unprintable-error': 'データを印刷できません',
  'job-data-insufficient': 'データが足りません',
  'job-hold-until-specified': '保留中です',
  'printer-stopped': 'プリンタが停止しています',
  'printer-stopped-partly': 'プリンタが一部停止しています',
};

/** 'none' や、状態に関係のない理由は出さない */
const HIDDEN_REASONS = new Set(['none', 'job-queued', 'job-incoming', 'processing-to-stop-point']);

/**
 * 理由の一覧を、画面に出す文にする。末尾の -error / -warning / -report は重大度の印なので、
 * 外して引く。重大度が error のものを先に並べる。分からない理由は、そのまま出す。
 */
export function describeReasons(reasons: string[]): { text: string; severity: string }[] {
  const out: { text: string; severity: string }[] = [];
  for (const reason of reasons) {
    if (HIDDEN_REASONS.has(reason)) continue;
    const m = /^(.*)-(error|warning|report)$/.exec(reason);
    const base = m ? m[1]! : reason;
    const severity = m ? m[2]! : 'report';
    out.push({ text: REASON_LABEL[base] ?? REASON_LABEL[reason] ?? reason, severity });
  }
  const rank: Record<string, number> = { error: 0, warning: 1, report: 2 };
  return out.sort((a, b) => (rank[a.severity] ?? 2) - (rank[b.severity] ?? 2));
}
