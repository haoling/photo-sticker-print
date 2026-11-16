import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Paper } from './papers/index.js';
import { isPrintable } from './papers/index.js';
import {
  DEFAULT_BLEED_MM,
  MAX_BLEED_MM,
  renderSheetPdf,
  renderSheetPng,
  SheetImageError,
  sheetWarnings,
  type SheetCellImage,
} from './print/index.js';

const MAX_PHOTO_BYTES = 40 * 1024 * 1024;

const fieldsSchema = z.object({
  paperId: z.string().min(1),
  bleedMm: z.coerce.number().min(0).max(MAX_BLEED_MM).default(DEFAULT_BLEED_MM),
  offsetX: z.coerce.number().min(-10).max(10).default(0),
  offsetY: z.coerce.number().min(-10).max(10).default(0),
});
const formatSchema = z.enum(['preview', 'png', 'pdf']).default('preview');

/**
 * 写真を割り付けたシートの画像・PDF を作る。
 * 写真は multipart の `cell-<コマ番号>`（0 始まり）で受け取り、サーバーには保存しない。
 * format: preview（150dpi・確認用の輪郭つき）/ png（600dpi）/ pdf（用紙と同じ大きさ）
 */
export async function registerSheetRoutes(app: FastifyInstance, papers: Paper[]) {
  await app.register(multipart, { limits: { fileSize: MAX_PHOTO_BYTES, files: 64, fields: 16 } });

  app.post<{ Querystring: { format?: string } }>('/api/sheet/render', async (req, reply) => {
    const format = formatSchema.safeParse(req.query.format);
    if (!format.success) {
      return reply.code(400).send({ error: 'format は preview / png / pdf のいずれかです' });
    }
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: 'multipart/form-data で送ってください' });
    }

    const fields: Record<string, string> = {};
    const images: SheetCellImage[] = [];
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const m = /^cell-(\d+)$/.exec(part.fieldname);
        if (!m) {
          part.file.resume();
          return reply
            .code(400)
            .send({ error: `写真のフィールド名は cell-<番号> です: ${part.fieldname}` });
        }
        const image = await part.toBuffer(); // 上限を超えると例外（413）になる
        if (image.length > 0) images.push({ cellIndex: Number(m[1]), image });
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }

    const parsed = fieldsSchema.safeParse(fields);
    if (!parsed.success) {
      return reply.code(400).send({
        error: `入力が正しくありません: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('、')}`,
      });
    }
    const { paperId, bleedMm, offsetX, offsetY } = parsed.data;
    const paper = papers.find((p) => p.id === paperId);
    if (!paper) return reply.code(404).send({ error: '用紙が見つかりません' });
    if (!isPrintable(paper)) {
      return reply
        .code(409)
        .send({ error: `${paper.id}: コマ位置が未測定のため、印刷データは作れません` });
    }
    const cellCount = paper.layout.columns * paper.layout.rows;
    const bad = images.find((i) => i.cellIndex >= cellCount);
    if (bad) {
      return reply.code(400).send({
        error: `コマ ${bad.cellIndex + 1} はこの用紙にありません（全 ${cellCount} コマ）`,
      });
    }
    if (new Set(images.map((i) => i.cellIndex)).size !== images.length) {
      return reply.code(400).send({ error: '同じコマに複数の写真が指定されています' });
    }

    const warnings = sheetWarnings(
      paper,
      bleedMm,
      images.map((i) => i.cellIndex),
    );
    reply.header('x-sheet-warnings', encodeURIComponent(JSON.stringify(warnings)));

    const opts = { bleedMm, offsetXMm: offsetX, offsetYMm: offsetY };
    try {
      if (format.data === 'pdf') {
        const pdf = await renderSheetPdf(paper, images, { ...opts, dpi: 600 });
        return reply.type('application/pdf').send(Buffer.from(pdf));
      }
      const png = await renderSheetPng(
        paper,
        images,
        format.data === 'preview'
          ? { ...opts, dpi: 150, guides: true }
          : { ...opts, dpi: 600, guides: false },
      );
      return reply.type('image/png').send(png);
    } catch (e) {
      if (e instanceof SheetImageError) return reply.code(422).send({ error: e.message });
      throw e;
    }
  });
}
