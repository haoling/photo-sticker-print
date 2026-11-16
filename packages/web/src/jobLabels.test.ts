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
