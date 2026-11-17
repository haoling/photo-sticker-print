import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PhotoStorageError, type ImageData, type PhotoStorage } from './photos/index.js';

/** 写真・アルバムの id として受け付ける文字（ストレージごとの形式は、各実装が確かめる） */
export const PHOTO_ID = /^[A-Za-z0-9_-]{1,128}$/;

const pageQuery = z.object({
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,256}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

/**
 * フォトストレージ（Immich）の中継。ブラウザに見せるのは、ここにある読み取りの入口だけ（許可リスト方式）で、
 * Immich の API をそのまま通すことはしない。API キーと接続先はサーバーの中だけで使う。
 */
export async function registerPhotoRoutes(app: FastifyInstance, storage: PhotoStorage) {
  const fail = (e: unknown, reply: FastifyReply) => {
    if (e instanceof PhotoStorageError) return reply.code(e.status).send({ error: e.message });
    throw e;
  };
  const badQuery = (reply: FastifyReply) =>
    reply.code(400).send({ error: 'cursor か limit（1〜200）が正しくありません' });
  const badId = (reply: FastifyReply) => reply.code(400).send({ error: 'id が正しくありません' });

  app.get<{ Querystring: Record<string, string> }>('/api/photos', async (req, reply) => {
    const q = pageQuery.safeParse(req.query);
    if (!q.success) return badQuery(reply);
    try {
      return await storage.listPhotos(q.data);
    } catch (e) {
      return fail(e, reply);
    }
  });

  app.get('/api/albums', async (_req, reply) => {
    try {
      return { albums: await storage.listAlbums() };
    } catch (e) {
      return fail(e, reply);
    }
  });

  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/api/albums/:id/photos',
    async (req, reply) => {
      if (!PHOTO_ID.test(req.params.id)) return badId(reply);
      const q = pageQuery.safeParse(req.query);
      if (!q.success) return badQuery(reply);
      try {
        return await storage.listAlbumPhotos(req.params.id, q.data);
      } catch (e) {
        return fail(e, reply);
      }
    },
  );

  const images: Record<string, (id: string) => Promise<ImageData>> = {
    thumbnail: (id) => storage.getThumbnail(id),
    preview: (id) => storage.getPreview(id),
  };
  for (const [size, get] of Object.entries(images)) {
    app.get<{ Params: { id: string } }>(`/api/photos/:id/${size}`, async (req, reply) => {
      if (!PHOTO_ID.test(req.params.id)) return badId(reply);
      try {
        const { data, contentType } = await get(req.params.id);
        // 画像以外（HTML など）をブラウザに渡さない
        if (!/^image\/(jpeg|webp|png|avif|gif)\b/.test(contentType)) {
          return reply.code(502).send({ error: '画像でない応答が返りました' });
        }
        return reply
          .type(contentType)
          .header('cache-control', 'private, max-age=86400')
          .header('x-content-type-options', 'nosniff')
          .send(data);
      } catch (e) {
        return fail(e, reply);
      }
    });
  }
}
