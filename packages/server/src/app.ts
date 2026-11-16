import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Config } from './config.js';

export interface AppOptions {
  config: Config;
  logger?: boolean;
  /** ビルド済みフロントエンドの配置先。存在しなければ静的配信しない */
  webRoot?: string;
}

export async function buildApp({
  config,
  webRoot,
  logger = true,
}: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: logger ? { level: process.env.LOG_LEVEL ?? 'info' } : false });

  // ブラウザへ Immich の接続情報は一切渡さない。公開するのは設定済みかどうかのみ。
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/info', async () => ({ name: 'photo-sticker-print', version: '0.0.0' }));

  if (webRoot && existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }
  void config;
  return app;
}
