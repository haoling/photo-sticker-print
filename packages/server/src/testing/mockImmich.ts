import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockAsset {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  originalFileName: string;
  localDateTime: string;
  width: number | null;
  height: number | null;
  albumIds: string[];
  thumbnail: Buffer;
  preview: Buffer;
  original: Buffer;
  originalType: string;
}

/** テスト用の Immich。このアプリが呼ぶ API だけを、本物に近い形で返す。 */
export interface MockImmich {
  url: string;
  apiKey: string;
  assets: MockAsset[];
  albums: { id: string; albumName: string }[];
  /** 受け取った要求（`GET /api/albums` の形）と、検索の本文 */
  requests: string[];
  searches: Record<string, unknown>[];
  /** 設定すると、すべての要求にこのステータスを返す */
  failWith: number | null;
  close(): Promise<void>;
}

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString();
}

export async function startMockImmich(apiKey = 'immich-secret-key'): Promise<MockImmich> {
  const mock: MockImmich = {
    url: '',
    apiKey,
    assets: [],
    albums: [],
    requests: [],
    searches: [],
    failWith: null,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const dto = (a: MockAsset) => ({
    id: a.id,
    type: a.type,
    originalFileName: a.originalFileName,
    localDateTime: a.localDateTime,
    fileCreatedAt: a.localDateTime,
    width: a.width,
    height: a.height,
  });

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x');
      mock.requests.push(`${req.method} ${url.pathname}${url.search}`);
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const body = await readBody(req);
      if (req.headers['x-api-key'] !== apiKey) return send(401, { message: 'Invalid API key' });
      if (mock.failWith) return send(mock.failWith, { message: 'error' });

      if (req.method === 'POST' && url.pathname === '/api/search/metadata') {
        const q = JSON.parse(body) as {
          page?: number;
          size?: number;
          type?: string;
          albumIds?: string[];
        };
        mock.searches.push(q);
        const page = q.page ?? 1;
        const size = q.size ?? 250;
        const all = mock.assets
          .filter((a) => !q.type || a.type === q.type)
          .filter((a) => !q.albumIds || q.albumIds.some((id) => a.albumIds.includes(id)))
          .sort((a, b) => b.localDateTime.localeCompare(a.localDateTime));
        const items = all.slice((page - 1) * size, page * size);
        return send(200, {
          albums: { total: 0, count: 0, items: [], facets: [] },
          assets: {
            total: items.length,
            count: items.length,
            items: items.map(dto),
            facets: [],
            nextPage: page * size < all.length ? String(page + 1) : null,
          },
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/albums') {
        return send(
          200,
          mock.albums.map((al) => {
            const inAlbum = mock.assets.filter((a) => a.albumIds.includes(al.id));
            return {
              ...al,
              assetCount: inAlbum.length,
              albumThumbnailAssetId: inAlbum[0]?.id ?? null,
            };
          }),
        );
      }
      const m = /^\/api\/assets\/([^/]+)(\/thumbnail|\/original)?$/.exec(url.pathname);
      if (req.method === 'GET' && m) {
        const asset = mock.assets.find((a) => a.id === m[1]);
        if (!asset) return send(400, { message: 'Not found or no asset.read access' });
        if (!m[2]) return send(200, dto(asset));
        const [data, type] =
          m[2] === '/original'
            ? [asset.original, asset.originalType]
            : url.searchParams.get('size') === 'preview'
              ? [asset.preview, 'image/jpeg']
              : [asset.thumbnail, 'image/webp'];
        res.writeHead(200, { 'content-type': type, 'content-length': data.length });
        return res.end(data);
      }
      return send(404, { message: 'Not found' });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mock.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return mock;
}
