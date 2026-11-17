import { describe, expect, it } from 'vitest';
import { describeReasons, jobStateLabel } from './jobLabels';

describe('jobStateLabel', () => {
  it('状態を日本語にする。分からない状態はそのまま、null は「不明」', () => {
    expect(jobStateLabel('pending')).toBe('待機中');
    expect(jobStateLabel('processing')).toBe('印刷中');
    expect(jobStateLabel('completed')).toBe('完了');
    expect(jobStateLabel('aborted')).toBe('エラーで中止されました');
    expect(jobStateLabel('unknown-12')).toBe('unknown-12');
    expect(jobStateLabel(null)).toBe('不明');
  });
});

describe('describeReasons（実機の TS7630 が用紙切れのときに返した理由）', () => {
  it('用紙がないとき: 用紙が必要・用紙がない（赤＝エラー）、受信領域がいっぱい（情報）、ジョブ停止', () => {
    expect(
      describeReasons([
        'media-needed-error',
        'media-empty-error',
        'spool-area-full-report',
        'job-stopped',
      ]),
    ).toEqual([
      { text: '用紙が必要です', severity: 'error' },
      { text: '用紙がありません', severity: 'error' },
      { text: 'プリンタの受信領域がいっぱいです（大きなデータを処理中）', severity: 'report' },
      { text: 'ジョブが停止しています', severity: 'report' },
    ]);
  });

  it('印刷中の受信領域の理由も、日本語になる', () => {
    expect(describeReasons(['spool-area-full-report', 'job-printing'])).toEqual([
      { text: 'プリンタの受信領域がいっぱいです（大きなデータを処理中）', severity: 'report' },
      { text: '印刷中です', severity: 'report' },
    ]);
  });
});

describe('describeReasons', () => {
  it('用紙切れ・インク切れ・紙詰まりを日本語にする（重大度の接尾辞は外して引く）', () => {
    expect(
      describeReasons(['media-empty-error', 'marker-supply-low-warning', 'media-jam-error']),
    ).toEqual([
      { text: '用紙がありません', severity: 'error' },
      { text: '紙詰まりです', severity: 'error' },
      { text: 'インクが残りわずかです', severity: 'warning' },
    ]);
  });

  it('none と、状態に関係のない理由は出さない。分からない理由はそのまま出す', () => {
    expect(describeReasons(['none'])).toEqual([]);
    expect(describeReasons(['job-queued'])).toEqual([]);
    expect(describeReasons(['com.canon-something-error'])).toEqual([
      { text: 'com.canon-something-error', severity: 'error' }, // 分からない理由は元の文字列のまま
    ]);
  });

  it('接尾辞のない理由（job-printing など）も引ける', () => {
    expect(describeReasons(['job-printing'])).toEqual([{ text: '印刷中です', severity: 'report' }]);
  });
});
