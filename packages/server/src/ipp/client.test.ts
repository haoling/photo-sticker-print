import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startMockPrinter, type MockPrinter } from '../testing/mockPrinter.js';
import { findAttributes, IPP_GROUP, IPP_OPERATION } from './codec.js';
import { getJobStatus, getPrinterInfo, IppError, isFinalJobState, printJob } from './client.js';
import { buildJobAttributes } from './jobAttributes.js';
import { parsePrinterTarget, PrinterTargetError } from './target.js';

let mock: MockPrinter;
const target = () => ({ host: mock.host, port: mock.port, path: '/ipp/print' });

beforeEach(async () => {
  mock = await startMockPrinter();
});
afterEach(async () => {
  await mock.close();
});

describe('getPrinterInfo', () => {
  it('機種・状態・対応する用紙や形式をまとめて返す', async () => {
    const info = await getPrinterInfo(target());
    expect(info).toMatchObject({
      name: 'Canon TS7630 series',
      makeAndModel: 'Canon TS7630 series',
      uuid: '11111111-2222-3333-4444-555555555555',
      state: 3,
      supportsHagaki: true,
      supportsPwgRaster: true,
      mediaSources: ['auto', 'main', 'rear'],
      qualities: [3, 4, 5],
    });
    expect(info.mediaTypes).toContain('com.canon-mtglossy');
    expect(info.documentFormats).toContain('image/pwg-raster');
  });

  it('要求の printer-uri・requested-attributes が正しく送られる', async () => {
    await getPrinterInfo(target());
    const req = mock.requests[0]!;
    expect(req.status).toBe(IPP_OPERATION.GetPrinterAttributes);
    const op = findAttributes(req, IPP_GROUP.operation);
    expect(op['printer-uri']).toEqual([`ipp://127.0.0.1:${mock.port}/ipp/print`]);
    expect(op['requested-attributes']).toContain('media-type-supported');
  });
});

describe('printJob', () => {
  const options = {
    paperWidthMm: 100,
    paperHeightMm: 148,
    mediaType: 'photographic',
    mediaSource: 'rear',
    borderless: false,
    quality: 5,
    copies: 1,
    dpi: 600,
  };

  it('文書データとジョブ属性（用紙・給紙・品質・解像度）を送り、ジョブ番号を受け取る', async () => {
    const data = Buffer.from('RaS2-dummy-raster');
    const job = await printJob(target(), {
      jobName: '写真シール',
      documentFormat: 'image/pwg-raster',
      data,
      jobAttributes: buildJobAttributes(options),
    });
    expect(job).toMatchObject({ jobId: 100, state: 3 });
    expect(mock.documents[0]).toEqual(data);

    const req = mock.requests[0]!;
    expect(req.status).toBe(IPP_OPERATION.PrintJob);
    const op = findAttributes(req, IPP_GROUP.operation);
    expect(op['document-format']).toEqual(['image/pwg-raster']);
    expect(op['job-name']).toEqual(['写真シール']);
    expect(op['requesting-user-name']).toEqual(['photo-sticker-print']);
    const j = findAttributes(req, IPP_GROUP.job);
    expect(j['copies']).toEqual([1]);
    expect(j['print-quality']).toEqual([5]);
    expect(j['orientation-requested']).toEqual([3]);
    expect(j['print-color-mode']).toEqual(['color']);
    expect(j['printer-resolution']).toEqual([{ cross: 600, feed: 600, units: 3 }]);
    expect(j['media-col']).toEqual([
      {
        'media-size': [{ 'x-dimension': [10000], 'y-dimension': [14800] }],
        'media-type': ['photographic'],
        'media-source': ['rear'],
      },
    ]);
  });

  it('フチなしは media-col の上下左右の余白を 0 にして求める', async () => {
    await printJob(target(), {
      jobName: 'x',
      documentFormat: 'image/pwg-raster',
      data: Buffer.from('x'),
      jobAttributes: buildJobAttributes({ ...options, borderless: true }),
    });
    const col = findAttributes(mock.requests[0]!, IPP_GROUP.job)['media-col']![0] as Record<
      string,
      unknown
    >;
    for (const side of ['top', 'bottom', 'left', 'right'])
      expect(col[`media-${side}-margin`]).toEqual([0]);
  });
});

describe('getJobStatus', () => {
  it('ジョブとプリンタの状態を返す。終わったかどうかも判定できる', async () => {
    mock.jobStates = [3, 5, 9];
    mock.jobStateReasons = ['job-printing'];
    const first = await getJobStatus(target(), 100);
    expect(first).toMatchObject({ jobId: 100, state: 3, printerState: 3 });
    expect((await getJobStatus(target(), 100)).state).toBe(5);
    const last = await getJobStatus(target(), 100);
    expect(last).toMatchObject({ state: 9, sheetsCompleted: 1 });
    expect(isFinalJobState(last.state)).toBe(true);
    expect(isFinalJobState(first.state)).toBe(false);
  });

  it('用紙切れなどのプリンタの状態の理由を返す', async () => {
    mock.printerStateReasons = ['media-empty-error'];
    expect((await getJobStatus(target(), 100)).printerStateReasons).toEqual(['media-empty-error']);
  });
});

describe('エラー', () => {
  it('IPP のエラーステータスを、名前つきで IppError にする', async () => {
    mock.failWith = 0x040a;
    const err = await getPrinterInfo(target()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IppError);
    expect((err as IppError).status).toBe(0x040a);
    expect((err as IppError).message).toContain('document-format-not-supported');
  });

  it('HTTP エラーと、接続できない場合も IppError', async () => {
    mock.httpStatus = 500;
    await expect(getPrinterInfo(target())).rejects.toThrow('HTTP 500');
    await mock.close();
    await expect(getPrinterInfo(target(), { timeoutMs: 2000 })).rejects.toThrow('接続できません');
    mock = await startMockPrinter(); // afterEach の close のため
  });
});

describe('本物のプリンタの HTTP の癖', () => {
  it('要求していない 100 Continue が先に来ても、応答を読める（fetch は「bad response」で失敗する）', async () => {
    mock.send100Continue = true;
    expect((await getPrinterInfo(target())).makeAndModel).toBe('Canon TS7630 series');
    // 大きな文書を送る Print-Job でも同じ
    const job = await printJob(target(), {
      jobName: 'x',
      documentFormat: 'image/pwg-raster',
      data: Buffer.alloc(300_000, 7),
      jobAttributes: [],
    });
    expect(job.jobId).toBe(100);
    expect(mock.documents[0]).toHaveLength(300_000);
  });

  it('Content-Length のない分割（chunked）の応答も読める', async () => {
    mock.chunked = true;
    expect((await getPrinterInfo(target())).supportsHagaki).toBe(true);
  });

  it('IPP でない本文が返ったとき（ポートやパスの間違い）は、そう伝える', async () => {
    mock.garbageBody = true;
    const err = await getPrinterInfo(target()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IppError);
    expect((err as IppError).message).toContain('IPP として読めません');
    expect((err as IppError).message).toContain('ポートやパス');
  });

  it('接続を拒否されたときは、原因（ポートの違いなど）を伝える', async () => {
    const closed = { host: '127.0.0.1', port: 1, path: '/ipp/print' };
    const err = await getPrinterInfo(closed, { timeoutMs: 3000 }).catch((e: unknown) => e);
    expect((err as IppError).message).toContain('ECONNREFUSED');
    expect((err as IppError).message).toContain('ポートが違う');
  });
});

describe('parsePrinterTarget', () => {
  it('LAN 内の IP・ホスト名を受け付け、既定のポートとパスを補う', () => {
    expect(parsePrinterTarget({ host: '192.168.1.20' })).toEqual({
      host: '192.168.1.20',
      port: 631,
      path: '/ipp/print',
    });
    expect(parsePrinterTarget({ host: ' printer.local ', port: '8631', path: '/ipp' })).toEqual({
      host: 'printer.local',
      port: 8631,
      path: '/ipp',
    });
    for (const ok of [
      '10.0.0.5',
      '172.20.1.1',
      '127.0.0.1',
      '169.254.1.1',
      'canon-ts7630',
      'a.home.arpa',
    ]) {
      expect(() => parsePrinterTarget({ host: ok }), ok).not.toThrow();
    }
  });

  it('LAN の外・不正なホスト・ポート・パスを拒否する（SSRF 対策）', () => {
    for (const bad of [
      '8.8.8.8',
      '172.32.0.1',
      '192.169.0.1',
      'example.com',
      '::1',
      'a b',
      'x/y',
      '',
      'http://192.168.1.1',
    ]) {
      expect(() => parsePrinterTarget({ host: bad }), bad).toThrow(PrinterTargetError);
    }
    expect(() => parsePrinterTarget({ host: '192.168.1.1', port: 0 })).toThrow(PrinterTargetError);
    expect(() => parsePrinterTarget({ host: '192.168.1.1', port: 70000 })).toThrow(
      PrinterTargetError,
    );
    expect(() => parsePrinterTarget({ host: '192.168.1.1', port: 'abc' })).toThrow(
      PrinterTargetError,
    );
    for (const path of ['ipp', '/a/../b', '/a?x=1', '/a b', '//evil.com@x']) {
      expect(() => parsePrinterTarget({ host: '192.168.1.1', path }), path).toThrow(
        PrinterTargetError,
      );
    }
  });
});
