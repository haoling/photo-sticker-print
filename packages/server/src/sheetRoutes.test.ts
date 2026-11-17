import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadPapers, paperSchema, type Paper } from './papers/index.js';
import { multipartBody, type Part } from './testing/multipart.js';

const config = { immichUrl: 'http://x', immichApiKey: 'secret', port: 3000 };
let papers: Paper[];
let photo: Buffer;

beforeAll(async () => {
  papers = await loadPapers(fileURLToPath(new URL('../../../papers', import.meta.url)));
  photo = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#3a7' } })
    .jpeg()
    .toBuffer();
});

const file = (cell: number, data: Buffer = photo): Part => ({
  name: `cell-${cell}`,
  filename: `p${cell}.jpg`,
  data,
});
const field = (name: string, value: string): Part => ({ name, value });

async function post(parts: Part[], query = 'format=preview', list: Paper[] = papers) {
  const app = await buildApp({ config, papers: list, logger: false });
  return app.inject({ method: 'POST', url: `/api/sheet/render?${query}`, ...multipartBody(parts) });
}
const warningsOf = (res: { headers: Record<string, unknown> }) =>
  JSON.parse(decodeURIComponent(String(res.headers['x-sheet-warnings']))) as string[];

describe('POST /api/sheet/render', () => {
  it('preview: 150dpi の PNG と、警告（なし）を返す', async () => {
    const res = await post([field('paperId', 'aone-29622'), file(0), file(1)]);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(await sharp(res.rawPayload).metadata()).toMatchObject({ width: 591, height: 874 });
    expect(warningsOf(res)).toEqual([]);
  });

  it('png: 600dpi（2362×3496）。pdf: PDF', async () => {
    const png = await post([field('paperId', 'aone-29622'), file(0)], 'format=png');
    expect(await sharp(png.rawPayload).metadata()).toMatchObject({
      width: 2362,
      height: 3496,
      density: 600,
    });
    const pdf = await post([field('paperId', 'aone-29622'), file(0)], 'format=pdf');
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('塗り足し・位置補正の指定を受け付け、印刷できない範囲にかかると警告する', async () => {
    const res = await post([
      field('paperId', 'aone-29622'),
      field('bleedMm', '3'),
      field('offsetX', '0.5'),
      field('offsetY', '-0.2'),
      file(9),
    ]);
    expect(res.statusCode).toBe(200);
    expect(warningsOf(res)[0]).toContain('コマ 10');
  });

  it('edit-<コマ番号> の編集パラメータを受け付ける。範囲外・JSON でない・写真のないコマは 400', async () => {
    const ok = await post([
      field('paperId', 'aone-29622'),
      file(0),
      field('edit-0', JSON.stringify({ zoom: 2, focusX: 0, focusY: 0, rotation: 90, flipH: true })),
    ]);
    expect(ok.statusCode).toBe(200);
    const cases: [string, Part[]][] = [
      ['範囲外の拡大', [field('paperId', 'aone-29622'), file(0), field('edit-0', '{"zoom":9}')]],
      ['不正な回転', [field('paperId', 'aone-29622'), file(0), field('edit-0', '{"rotation":45}')]],
      ['JSON でない', [field('paperId', 'aone-29622'), file(0), field('edit-0', 'zoom=2')]],
      ['写真のないコマ', [field('paperId', 'aone-29622'), file(0), field('edit-3', '{"zoom":2}')]],
    ];
    for (const [label, parts] of cases) {
      expect((await post(parts)).statusCode, label).toBe(400);
    }
  });

  it('入力の誤りは 400', async () => {
    const cases: [string, Part[]][] = [
      ['用紙の指定なし', [file(0)]],
      ['塗り足しが範囲外', [field('paperId', 'aone-29622'), field('bleedMm', '6'), file(0)]],
      ['位置補正が範囲外', [field('paperId', 'aone-29622'), field('offsetX', '99'), file(0)]],
      [
        'フィールド名が違う',
        [field('paperId', 'aone-29622'), { name: 'photo', filename: 'a.jpg', data: photo }],
      ],
      ['コマが無い', [field('paperId', 'aone-29622'), file(10)]],
      ['同じコマが重複', [field('paperId', 'aone-29622'), file(1), file(1)]],
    ];
    for (const [label, parts] of cases) {
      expect((await post(parts)).statusCode, label).toBe(400);
    }
    expect((await post([file(0)], 'format=jpeg')).statusCode).toBe(400);
  });

  it('multipart でない送信は 400、存在しない用紙は 404', async () => {
    const app = await buildApp({ config, papers, logger: false });
    const res = await app.inject({ method: 'POST', url: '/api/sheet/render', payload: { a: 1 } });
    expect(res.statusCode).toBe(400);
    expect((await post([field('paperId', 'nothing'), file(0)])).statusCode).toBe(404);
  });

  it('コマ位置が未測定の用紙は 409', async () => {
    const base = papers.find((p) => p.id === 'aone-29662')!;
    const unmeasured = paperSchema.parse({
      ...base,
      id: 'unmeasured',
      layout: {
        ...base.layout,
        firstCellLeftMm: null,
        firstCellTopMm: null,
        pitchXMm: null,
        pitchYMm: null,
      },
      verification: { status: 'unmeasured' },
    });
    expect(
      (await post([field('paperId', 'unmeasured'), file(0)], 'format=preview', [unmeasured]))
        .statusCode,
    ).toBe(409);
  });

  it('写真が読めないときは 422 で、どのコマかを伝える', async () => {
    const res = await post([field('paperId', 'aone-29622'), file(2, Buffer.from('not an image'))]);
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: string }>().error).toContain('コマ 3');
  });
});

describe('GET /api/papers', () => {
  it('印刷できる用紙に cells（コマの位置とサイズ）を含める', async () => {
    const app = await buildApp({ config, papers, logger: false });
    const body = (await app.inject('/api/papers')).json<{
      papers: { id: string; cells: { xMm: number; yMm: number }[] | null }[];
    }>();
    const p = body.papers.find((x) => x.id === 'aone-26009')!;
    expect(p.cells).toHaveLength(10);
    expect(p.cells![0]).toMatchObject({ xMm: 8.5, yMm: 8 });
  });
});
