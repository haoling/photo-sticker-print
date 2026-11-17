import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Config } from './config.js';
import { z } from 'zod';
import { registerPhotoRoutes } from './photoRoutes.js';
import { createImmichStorage, PrintImageLoader, type PhotoStorage } from './photos/index.js';
import { registerPrintRoutes } from './printRoutes.js';
import { registerSheetRoutes } from './sheetRoutes.js';
import { computeCells, isPrintable, type Paper } from './papers/index.js';
import {
  buildTestPrintSvg,
  DEFAULT_LINE_COLOR,
  printDefaults,
  renderTestPrintPdf,
  renderTestPrintPng,
  UnmeasuredPaperError,
} from './print/index.js';

type TestPrintOpts = { offsetXMm: number; offsetYMm: number; lineColor: string };

export interface AppOptions {
  config: Config;
  logger?: boolean;
  /** ビルド済みフロントエンドの配置先。存在しなければ静的配信しない */
  webRoot?: string;
  /** 読み込み済みの用紙定義 */
  papers?: Paper[];
  /** フォトストレージ。省略すると、config の Immich を使う */
  storage?: PhotoStorage;
}

export async function buildApp({
  config,
  webRoot,
  papers = [],
  logger = true,
  storage = createImmichStorage({ url: config.immichUrl, apiKey: config.immichApiKey }),
}: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: logger ? { level: process.env.LOG_LEVEL ?? 'info' } : false });

  // ブラウザへ Immich の接続情報は一切渡さない。公開するのは設定済みかどうかのみ。
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/info', async () => ({ name: 'photo-sticker-print', version: '0.0.0' }));

  app.get('/api/papers', async () => ({
    papers: papers.map((paper) => ({
      ...paper,
      printable: isPrintable(paper),
      // コマの位置とサイズ（mm）。画面はこれをそのまま使う（計算を二重に持たない）
      cells: isPrintable(paper) ? computeCells(paper) : null,
      // 印刷の既定値（用紙の推奨設定から。画面で選び直せる）
      printDefaults: printDefaults(paper),
    })),
  }));

  const loader = new PrintImageLoader(storage);
  await registerPhotoRoutes(app, storage);
  await registerSheetRoutes(app, papers, loader);
  await registerPrintRoutes(app, papers, loader);

  // テスト印刷（コマの枠線だけ）。シール用紙に重ねて透かし、位置のズレを測る。
  const testPrintQuery = z.object({
    offsetX: z.coerce.number().min(-10).max(10).default(0),
    offsetY: z.coerce.number().min(-10).max(10).default(0),
    // 6 桁の 16 進数（# は付けても付けなくてもよい）
    color: z
      .string()
      .regex(/^#?[0-9a-fA-F]{6}$/)
      .transform((c) => (c.startsWith('#') ? c : `#${c}`))
      .default(DEFAULT_LINE_COLOR),
  });
  const testPrintFormats = {
    png: { type: 'image/png', render: (p: Paper, o: TestPrintOpts) => renderTestPrintPng(p, o) },
    pdf: {
      type: 'application/pdf',
      render: (p: Paper, o: TestPrintOpts) => renderTestPrintPdf(p, o),
    },
    svg: {
      type: 'image/svg+xml',
      render: async (p: Paper, o: TestPrintOpts) => buildTestPrintSvg(p, o),
    },
  } as const;
  for (const [ext, format] of Object.entries(testPrintFormats)) {
    app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
      `/api/papers/:id/test-print.${ext}`,
      async (req, reply) => {
        const paper = papers.find((p) => p.id === req.params.id);
        if (!paper) return reply.code(404).send({ error: '用紙が見つかりません' });
        const query = testPrintQuery.safeParse(req.query);
        if (!query.success) {
          return reply.code(400).send({
            error:
              '位置補正は offsetX / offsetY（mm、-10〜10）、線の色は color（例: ff0000）で指定してください',
          });
        }
        try {
          const body = await format.render(paper, {
            offsetXMm: query.data.offsetX,
            offsetYMm: query.data.offsetY,
            lineColor: query.data.color,
          });
          return reply.type(format.type).send(Buffer.from(body));
        } catch (e) {
          if (e instanceof UnmeasuredPaperError) return reply.code(409).send({ error: e.message });
          throw e;
        }
      },
    );
  }

  if (webRoot && existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
