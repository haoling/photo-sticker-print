import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { findAttributes, IPP_GROUP, IPP_OPERATION } from './ipp/codec.js';
import { decodePwgRaster } from './ipp/pwgRaster.js';
import { loadPapers, type Paper } from './papers/index.js';
import { startMockPrinter, type MockPrinter } from './testing/mockPrinter.js';
import { field, file, multipartBody, type Part } from './testing/multipart.js';

const config = { immichUrl: 'http://x', immichApiKey: 'secret', port: 3000 };
let papers: Paper[];
let photo: Buffer;
let mock: MockPrinter;

beforeAll(async () => {
  papers = await loadPapers(fileURLToPath(new URL('../../../papers', import.meta.url)));
  photo = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#ff0000' } })
    .jpeg({ quality: 100 })
    .toBuffer();
});
beforeEach(async () => {
  mock = await startMockPrinter();
});
afterEach(async () => {
  await mock.close();
});

const build = () => buildApp({ config, papers, logger: false });
const printer = () => ({ printerHost: mock.host, printerPort: String(mock.port) });

async function postJson(url: string, body: unknown) {
  const app = await build();
  return app.inject({ method: 'POST', url, payload: body as object });
}
async function postSheet(parts: Part[]) {
  const app = await build();
  return app.inject({ method: 'POST', url: '/api/print/sheet', ...multipartBody(parts) });
}

/** モックのプリンタが受け取った文書（PWG Raster）の、(x, y)mm の画素 */
function rasterPixel(raster: Buffer) {
  const page = decodePwgRaster(raster)[0]!;
  const pxPerMm = 600 / 25.4;
  return {
    page,
    at: (xMm: number, yMm: number) => {
      const i =
        Math.round(yMm * pxPerMm) * page.header.bytesPerLine + Math.round(xMm * pxPerMm) * 3;
      return [page.rgb[i]!, page.rgb[i + 1]!, page.rgb[i + 2]!];
    },
  };
}

describe('POST /api/printers/probe', () => {
  it('プリンタの機種・状態・対応する用紙の種類を返す', async () => {
    const res = await postJson('/api/printers/probe', { host: mock.host, port: mock.port });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      printer: { makeAndModel: string; supportsHagaki: boolean; mediaSources: string[] };
    }>();
    expect(body.printer.makeAndModel).toBe('Canon TS7630 series');
    expect(body.printer.supportsHagaki).toBe(true);
    expect(body.printer.mediaSources).toContain('rear');
  });

  it('LAN の外・不正な入力は 400、つながらないとき・プリンタのエラーは 502', async () => {
    expect((await postJson('/api/printers/probe', { host: '8.8.8.8' })).statusCode).toBe(400);
    expect((await postJson('/api/printers/probe', {})).statusCode).toBe(400);
    expect(
      (await postJson('/api/printers/probe', { host: mock.host, path: '/a/../b' })).statusCode,
    ).toBe(400);
    mock.failWith = 0x0500;
    const res = await postJson('/api/printers/probe', { host: mock.host, port: mock.port });
    expect(res.statusCode).toBe(502);
    expect(res.json<{ error: string }>().error).toContain('internal-error');
  });
});

describe('POST /api/print/test', () => {
  it('枠線のテスト印刷を、用紙ぴったりの PWG Raster で送る', async () => {
    const res = await postJson('/api/print/test', { paperId: 'aone-26009', ...printer() });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      job: { jobId: number; raster: { widthPx: number; heightPx: number } };
    }>();
    expect(body.job.jobId).toBe(100);
    expect(body.job.raster).toMatchObject({ widthPx: 2362, heightPx: 3496 });

    const { page, at } = rasterPixel(mock.documents[0]!);
    expect(page.header).toMatchObject({
      mediaClass: 'PwgRaster',
      width: 2362,
      height: 3496,
      hwResolution: [600, 600],
      pageSize: [283, 420], // はがき 100×148mm（pt）
      bitsPerPixel: 24,
      colorSpace: 19,
    });
    // 26009 の 1 コマ目の左端（x=8.5mm）に枠線、内側は白
    expect(at(8.5 + 0.075, 8 + 12)[0]).toBeLessThan(80);
    expect(at(20, 8 + 12)).toEqual([255, 255, 255]);
  });

  it('用紙の推奨設定（26009: 普通紙・後トレイ・フチあり）が media-col と品質に入る', async () => {
    await postJson('/api/print/test', { paperId: 'aone-26009', ...printer() });
    const req = mock.requests.find((r) => r.status === IPP_OPERATION.PrintJob)!;
    const j = findAttributes(req, IPP_GROUP.job);
    expect(j['media-col']).toEqual([
      {
        'media-size': [{ 'x-dimension': [10000], 'y-dimension': [14800] }],
        'media-type': ['stationery'],
        'media-source': ['rear'],
      },
    ]);
    expect(j['print-quality']).toEqual([5]);
    expect(findAttributes(req, IPP_GROUP.operation)['document-format']).toEqual([
      'image/pwg-raster',
    ]);
  });

  it('画面で指定した設定が、推奨設定より優先される（フチなし・用紙の種類・品質・部数）', async () => {
    await postJson('/api/print/test', {
      paperId: 'aone-26009',
      ...printer(),
      mediaType: 'com.canon-mtglossy',
      mediaSource: 'main',
      borderless: true,
      quality: 4,
      copies: 2,
    });
    const j = findAttributes(
      mock.requests.find((r) => r.status === IPP_OPERATION.PrintJob)!,
      IPP_GROUP.job,
    );
    expect(j['print-quality']).toEqual([4]);
    expect(j['copies']).toEqual([2]);
    const col = j['media-col']![0] as Record<string, unknown>;
    expect(col['media-type']).toEqual(['com.canon-mtglossy']);
    expect(col['media-source']).toEqual(['main']);
    expect(col['media-top-margin']).toEqual([0]);
    expect(rasterPixel(mock.documents[0]!).page.header.mediaType).toBe('com.canon-mtglossy');
  });

  it('位置補正と線の色が画像に反映される', async () => {
    await postJson('/api/print/test', {
      paperId: 'aone-26009',
      ...printer(),
      offsetX: 1,
      color: 'ff0000',
    });
    const { at } = rasterPixel(mock.documents[0]!);
    expect(at(9.5 + 0.075, 20)).toEqual([255, 0, 0]); // 1mm 右へ動いた枠線（赤）
  });

  it('入力の誤り・未測定・存在しない用紙・つながらないプリンタを区別して返す', async () => {
    expect(
      (await postJson('/api/print/test', { paperId: 'nothing', ...printer() })).statusCode,
    ).toBe(404);
    expect((await postJson('/api/print/test', { paperId: 'aone-26009' })).statusCode).toBe(400);
    expect(
      (await postJson('/api/print/test', { paperId: 'aone-26009', printerHost: '8.8.8.8' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await postJson('/api/print/test', { paperId: 'aone-26009', ...printer(), quality: 9 }))
        .statusCode,
    ).toBe(400);
    expect(
      (await postJson('/api/print/test', { paperId: 'aone-26009', ...printer(), mediaType: 'a b' }))
        .statusCode,
    ).toBe(400);
    mock.failWith = 0x040a;
    const res = await postJson('/api/print/test', { paperId: 'aone-26009', ...printer() });
    expect(res.statusCode).toBe(502);
    expect(res.json<{ error: string }>().error).toContain('document-format-not-supported');
  });
});

describe('POST /api/print/sheet', () => {
  const sheet = (extra: Part[] = []) => [
    field('paperId', 'aone-29622'),
    field('bleedMm', '1'),
    field('printerHost', mock.host),
    field('printerPort', String(mock.port)),
    file(0, photo),
    ...extra,
  ];

  it('写真を割り付けたシートを PWG Raster にして送る（コマの中は写真、塗り足しの外は白）', async () => {
    const res = await postSheet(sheet());
    expect(res.statusCode).toBe(200);
    expect(res.json<{ job: { jobId: number }; warnings: string[] }>()).toMatchObject({
      job: { jobId: 100 },
      warnings: [],
    });
    const { at } = rasterPixel(mock.documents[0]!);
    const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) <= 8);
    expect(near(at(13 + 15, 7.5 + 11), [255, 0, 0])).toBe(true); // 29622 の 1 コマ目の中央
    expect(near(at(13 - 0.7, 7.5 + 11), [255, 0, 0])).toBe(true); // 塗り足しの中
    expect(near(at(13 - 1.4, 7.5 + 11), [255, 255, 255])).toBe(true); // 塗り足しの外
    // 29622 の推奨設定: 後トレイ・光沢紙
    const j = findAttributes(
      mock.requests.find((r) => r.status === IPP_OPERATION.PrintJob)!,
      IPP_GROUP.job,
    );
    expect((j['media-col']![0] as Record<string, unknown>)['media-source']).toEqual(['rear']);
  });

  it('塗り足しの警告を返す', async () => {
    const res = await postSheet([
      field('paperId', 'aone-29622'),
      field('bleedMm', '0.3'),
      field('printerHost', mock.host),
      field('printerPort', String(mock.port)),
      file(0, photo),
    ]);
    expect(res.json<{ warnings: string[] }>().warnings[0]).toContain('0.8mm 未満');
  });

  it('写真が 1 枚もない・プリンタの指定がない・写真が読めない・プリンタが失敗するときは、それぞれ分かる形で拒否する', async () => {
    expect((await postSheet([field('paperId', 'aone-29622'), ...printerParts()])).statusCode).toBe(
      400,
    );
    expect((await postSheet([field('paperId', 'aone-29622'), file(0, photo)])).statusCode).toBe(
      400,
    );
    const bad = await postSheet([
      field('paperId', 'aone-29622'),
      ...printerParts(),
      file(2, Buffer.from('x')),
    ]);
    expect(bad.statusCode).toBe(422);
    expect(bad.json<{ error: string }>().error).toContain('コマ 3');
    mock.failWith = 0x0507;
    expect((await postSheet(sheet())).statusCode).toBe(502);
    expect(mock.documents).toHaveLength(0);
  });

  function printerParts(): Part[] {
    return [field('printerHost', mock.host), field('printerPort', String(mock.port))];
  }
});

describe('GET /api/print/jobs/:jobId', () => {
  const get = async (query: string, jobId = '100') => {
    const app = await build();
    return app.inject(`/api/print/jobs/${jobId}?${query}`);
  };

  it('ジョブの状態を、名前（pending / processing / completed）で返し、終わったかも伝える', async () => {
    mock.jobStates = [3, 5, 9];
    mock.jobStateReasons = ['job-printing'];
    const q = `host=${mock.host}&port=${mock.port}`;
    expect((await get(q)).json()).toMatchObject({
      state: 'pending',
      final: false,
      printerState: 'idle',
    });
    expect((await get(q)).json()).toMatchObject({ state: 'processing', final: false });
    expect((await get(q)).json()).toMatchObject({
      state: 'completed',
      final: true,
      sheetsCompleted: 1,
    });
  });

  it('用紙切れなどのプリンタの状態の理由を返す', async () => {
    mock.printerStateReasons = ['media-empty-error'];
    const res = await get(`host=${mock.host}&port=${mock.port}`);
    expect(res.json<{ printerStateReasons: string[] }>().printerStateReasons).toEqual([
      'media-empty-error',
    ]);
  });

  it('不正なジョブ番号・接続先は 400', async () => {
    expect((await get(`host=${mock.host}&port=${mock.port}`, 'abc')).statusCode).toBe(400);
    expect((await get('host=8.8.8.8')).statusCode).toBe(400);
    expect((await get('')).statusCode).toBe(400);
  });
});

describe('GET /api/papers', () => {
  it('用紙ごとの印刷の既定値（IPP の用紙の種類・給紙位置・フチあり／なし）を含める', async () => {
    const app = await build();
    const body = (await app.inject('/api/papers')).json<{
      papers: {
        id: string;
        printDefaults: { mediaType?: string; mediaSource?: string; borderless: boolean };
      }[];
    }>();
    expect(body.papers.find((p) => p.id === 'aone-26009')!.printDefaults).toEqual({
      mediaType: 'stationery',
      mediaSource: 'rear',
      borderless: false,
    });
    expect(body.papers.find((p) => p.id === 'aone-29622')!.printDefaults).toMatchObject({
      mediaType: 'photographic',
      mediaSource: 'rear',
    });
  });
});
