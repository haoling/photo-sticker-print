import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { computeCells, loadPapers, type Paper } from './papers/index.js';
import { startMockImmich, uuid, type MockAsset, type MockImmich } from './testing/mockImmich.js';
import { field, multipartBody, type Part } from './testing/multipart.js';

let papers: Paper[];
let immich: MockImmich;
const img = (w: number, h: number, color: string, format: 'jpeg' | 'webp' = 'jpeg') =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } })
    [format]({ quality: 100 })
    .toBuffer();
const ALBUM = uuid(900);

async function asset(n: number, over: Partial<MockAsset> = {}): Promise<MockAsset> {
  return {
    id: uuid(n),
    type: 'IMAGE',
    originalFileName: `IMG_${n}.jpg`,
    localDateTime: `2026-01-${String(n).padStart(2, '0')}T10:00:00.000Z`,
    width: 4000,
    height: 3000,
    albumIds: [],
    thumbnail: await img(250, 188, '#00ff00', 'webp'),
    preview: await img(1440, 1080, '#ff0000'),
    original: await img(4000, 3000, '#0000ff'),
    originalType: 'image/jpeg',
    ...over,
  };
}

beforeAll(async () => {
  papers = await loadPapers(fileURLToPath(new URL('../../../papers', import.meta.url)));
});
beforeEach(async () => {
  immich = await startMockImmich();
  immich.albums = [{ id: ALBUM, albumName: '旅行' }];
  immich.assets = [
    await asset(1),
    await asset(2, { albumIds: [ALBUM] }),
    await asset(3, { type: 'VIDEO', originalFileName: 'MOV_3.mp4' }),
    await asset(4, { albumIds: [ALBUM] }),
    await asset(5),
  ];
});
afterEach(async () => {
  await immich.close();
});

const build = (apiKey = immich.apiKey, url = immich.url) =>
  buildApp({ config: { immichUrl: url, immichApiKey: apiKey, port: 3000 }, papers, logger: false });
const get = async (url: string) => (await build()).inject(url);
const ids = (res: { json: <T>() => T }) =>
  res.json<{ photos: { id: string }[] }>().photos.map((p) => p.id);

describe('写真の一覧', () => {
  it('GET /api/photos: 新しい順で、動画は含めず、続きを cursor で取れる', async () => {
    const first = await get('/api/photos?limit=3');
    expect(first.statusCode).toBe(200);
    expect(ids(first)).toEqual([uuid(5), uuid(4), uuid(2)]);
    const body = first.json<{ photos: Record<string, unknown>[]; nextCursor: string }>();
    expect(body.photos[0]).toEqual({
      id: uuid(5),
      name: 'IMG_5.jpg',
      takenAt: '2026-01-05T10:00:00.000Z',
      width: 4000,
      height: 3000,
    });
    const second = await get(`/api/photos?limit=3&cursor=${body.nextCursor}`);
    expect(ids(second)).toEqual([uuid(1)]);
    expect(second.json<{ nextCursor: null }>().nextCursor).toBeNull();
    expect(immich.searches[0]).toMatchObject({ type: 'IMAGE', order: 'desc', page: 1, size: 3 });
  });

  it('GET /api/albums と、アルバム内の写真', async () => {
    const albums = await get('/api/albums');
    expect(albums.json()).toEqual({
      albums: [{ id: ALBUM, name: '旅行', photoCount: 2, coverPhotoId: uuid(2) }],
    });
    const photos = await get(`/api/albums/${ALBUM}/photos`);
    expect(ids(photos)).toEqual([uuid(4), uuid(2)]);
    expect(immich.searches[0]).toMatchObject({ albumIds: [ALBUM] });
  });

  it('サムネイルとプレビューを中継する', async () => {
    const thumb = await get(`/api/photos/${uuid(1)}/thumbnail`);
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect(thumb.headers['cache-control']).toContain('max-age');
    expect((await sharp(thumb.rawPayload).metadata()).width).toBe(250);
    const preview = await get(`/api/photos/${uuid(1)}/preview`);
    expect((await sharp(preview.rawPayload).metadata()).width).toBe(1440);
  });

  it('入力の誤りは 400、無い写真は 404。Immich へは決まった API しか呼ばない', async () => {
    expect((await get('/api/photos?limit=0')).statusCode).toBe(400);
    expect((await get('/api/photos?cursor=abc')).statusCode).toBe(400);
    expect((await get('/api/photos/not-a-uuid/thumbnail')).statusCode).toBe(400);
    expect((await get(`/api/photos/${encodeURIComponent('../albums')}/thumbnail`)).statusCode).toBe(
      400,
    );
    expect((await get(`/api/albums/${encodeURIComponent('a/../b')}/photos`)).statusCode).toBe(400);
    expect((await get(`/api/photos/${uuid(99)}/thumbnail`)).statusCode).toBe(404);
    // 元のファイルや、ここに無い Immich の API は、ブラウザからは呼べない
    expect((await get(`/api/photos/${uuid(1)}/original`)).statusCode).toBe(404);
    expect((await get('/api/users/me')).statusCode).toBe(404);
    expect(immich.requests).toEqual([`GET /api/assets/${uuid(99)}/thumbnail?size=thumbnail`]);
  });

  it('API キーが違う・権限が足りない・つながらないときは 502 で、理由を日本語で返す', async () => {
    const wrongKey = await (await build('wrong')).inject('/api/photos');
    expect(wrongKey.statusCode).toBe(502);
    expect(wrongKey.json<{ error: string }>().error).toContain('API キー');
    immich.failWith = 403;
    const forbidden = await get('/api/albums');
    expect(forbidden.statusCode).toBe(502);
    expect(forbidden.json<{ error: string }>().error).toContain('asset.view');
    const down = await (await build(immich.apiKey, 'http://127.0.0.1:9')).inject('/api/photos');
    expect(down.statusCode).toBe(502);
    expect(down.json<{ error: string }>().error).toContain('接続');
  });

  it('API キーと Immich の接続先は、どの応答にも出てこない', async () => {
    const app = await build();
    const responses = [
      await app.inject('/api/photos'),
      await app.inject('/api/albums'),
      await app.inject(`/api/albums/${ALBUM}/photos`),
      await app.inject(`/api/photos/${uuid(1)}/thumbnail`),
      await app.inject(`/api/photos/${uuid(99)}/preview`),
      await app.inject('/api/info'),
      await (await build('wrong')).inject('/api/photos'),
    ];
    for (const res of responses) {
      const text = JSON.stringify(res.headers) + res.rawPayload.toString('latin1');
      expect(text).not.toContain(immich.apiKey);
      expect(text).not.toContain('wrong');
      expect(text).not.toContain(immich.url);
      expect(text).not.toContain('x-api-key');
    }
  });
});

describe('フォトストレージの写真でシートを作る', () => {
  const post = async (parts: Part[], query = 'format=png') =>
    (await build()).inject({
      method: 'POST',
      url: `/api/sheet/render?${query}`,
      ...multipartBody(parts),
    });
  const warningsOf = (res: { headers: Record<string, unknown> }) =>
    JSON.parse(decodeURIComponent(String(res.headers['x-sheet-warnings']))) as string[];
  /** 26009 のコマ 1 の中央の色（R・G・B が明るいかどうか） */
  const cellColor = async (png: Buffer) => {
    const c = computeCells(papers.find((p) => p.id === 'aone-26009')!)[0]!;
    const pxPerMm = 600 / 25.4;
    const { data } = await sharp(png)
      .extract({
        left: Math.round((c.xMm + c.widthMm / 2) * pxPerMm),
        top: Math.round((c.yMm + c.heightMm / 2) * pxPerMm),
        width: 1,
        height: 1,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return [...data.subarray(0, 3)].map((v) => (v > 128 ? 1 : 0)).join('');
  };

  it('photo-<コマ番号> の id の写真を、プレビュー画像から刷る', async () => {
    const res = await post([field('paperId', 'aone-26009'), field('photo-0', uuid(1))]);
    expect(res.statusCode).toBe(200);
    expect(await cellColor(res.rawPayload)).toBe('100'); // プレビュー（赤）
    expect(warningsOf(res)).toEqual([]);
    expect(immich.requests).toEqual([`GET /api/assets/${uuid(1)}/thumbnail?size=preview`]);
  });

  it('プレビューの解像度が足りないときは、元のファイルを使う', async () => {
    const res = await post([
      field('paperId', 'aone-26009'),
      field('photo-0', uuid(1)),
      field('edit-0', JSON.stringify({ zoom: 4 })),
    ]);
    expect(res.statusCode).toBe(200);
    expect(await cellColor(res.rawPayload)).toBe('001'); // 元のファイル（青）
    expect(warningsOf(res)).toEqual([]);
  });

  it('元のファイルが読めない形式なら、プレビューのまま刷って、解像度の警告を出す', async () => {
    immich.assets[0]!.original = Buffer.from('not an image');
    immich.assets[0]!.originalType = 'image/heic';
    const res = await post([
      field('paperId', 'aone-26009'),
      field('photo-0', uuid(1)),
      field('edit-0', JSON.stringify({ zoom: 4 })),
    ]);
    expect(res.statusCode).toBe(200);
    expect(await cellColor(res.rawPayload)).toBe('100');
    expect(warningsOf(res)[0]).toMatch(/コマ 1（約 \d+dpi）.*解像度/);
  });

  it('同じ写真は取り直さない（最終確認 → 印刷用で、Immich へは 1 回）', async () => {
    const app = await build();
    for (const format of ['preview', 'png']) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/sheet/render?format=${format}`,
        ...multipartBody([
          field('paperId', 'aone-26009'),
          field('photo-0', uuid(1)),
          field('photo-1', uuid(1)),
        ]),
      });
      expect(res.statusCode).toBe(200);
    }
    expect(immich.requests.length).toBeLessThanOrEqual(2);
  });

  it('無い写真は 404、id の形式違いは 400、同じコマにファイルと id の両方は 400', async () => {
    const missing = await post([field('paperId', 'aone-26009'), field('photo-2', uuid(99))]);
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ error: string }>().error).toContain('コマ 3');
    expect(
      (await post([field('paperId', 'aone-26009'), field('photo-0', '../x')])).statusCode,
    ).toBe(400);
    const both = await post([
      field('paperId', 'aone-26009'),
      field('photo-0', uuid(1)),
      { name: 'cell-0', filename: 'a.jpg', data: await img(60, 40, '#fff') },
    ]);
    expect(both.statusCode).toBe(400);
  });
});
