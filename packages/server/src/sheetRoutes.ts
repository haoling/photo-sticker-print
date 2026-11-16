import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Paper } from './papers/index.js';
import { isPrintable } from './papers/index.js';
import {
  cellEditSchema,
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

/** フォームの内容に問題があるとき。code はそのまま HTTP ステータスにする。 */
export class FormError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'FormError';
  }
}

export interface SheetForm {
  paper: Paper;
  bleedMm: number;
  offsetX: number;
  offsetY: number;
  images: SheetCellImage[];
  /** multipart の、写真以外のフィールド（印刷の設定など。呼び出し側が検証する） */
  fields: Record<string, string>;
  warnings: string[];
}

/**
 * 写真を割り付けるフォーム（multipart）を読んで検証する。
 * 写真は `cell-<コマ番号>`（0 始まり）で受け取り、サーバーには保存しない。
 */
export async function readSheetForm(req: FastifyRequest, papers: Paper[]): Promise<SheetForm> {
  if (!req.isMultipart()) throw new FormError(400, 'multipart/form-data で送ってください');

  const fields: Record<string, string> = {};
  const images: SheetCellImage[] = [];
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const m = /^cell-(\d+)$/.exec(part.fieldname);
      if (!m) {
        part.file.resume();
        throw new FormError(400, `写真のフィールド名は cell-<番号> です: ${part.fieldname}`);
      }
      const image = await part.toBuffer(); // 上限を超えると例外（413）になる
      if (image.length > 0) images.push({ cellIndex: Number(m[1]), image });
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value;
    }
  }

  const parsed = fieldsSchema.safeParse(fields);
  if (!parsed.success) {
    throw new FormError(
      400,
      `入力が正しくありません: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('、')}`,
    );
  }
  const { paperId, bleedMm, offsetX, offsetY } = parsed.data;
  const paper = papers.find((p) => p.id === paperId);
  if (!paper) throw new FormError(404, '用紙が見つかりません');
  if (!isPrintable(paper)) {
    throw new FormError(409, `${paper.id}: コマ位置が未測定のため、印刷データは作れません`);
  }
  const cellCount = paper.layout.columns * paper.layout.rows;
  const bad = images.find((i) => i.cellIndex >= cellCount);
  if (bad) {
    throw new FormError(
      400,
      `コマ ${bad.cellIndex + 1} はこの用紙にありません（全 ${cellCount} コマ）`,
    );
  }
  if (new Set(images.map((i) => i.cellIndex)).size !== images.length) {
    throw new FormError(400, '同じコマに複数の写真が指定されています');
  }
  // コマごとの編集パラメータ（edit-<コマ番号> に JSON）。写真のあるコマにだけ付けられる
  for (const [name, text] of Object.entries(fields)) {
    const m = /^edit-(\d+)$/.exec(name);
    if (!m) continue;
    const image = images.find((i) => i.cellIndex === Number(m[1]));
    if (!image)
      throw new FormError(400, `コマ ${Number(m[1]) + 1} には写真がないので、編集は指定できません`);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new FormError(400, `${name} が JSON として読めません`);
    }
    const edit = cellEditSchema.safeParse(json);
    if (!edit.success) {
      throw new FormError(
        400,
        `${name} が正しくありません: ${edit.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('、')}`,
      );
    }
    image.edit = edit.data;
  }
  const warnings = sheetWarnings(
    paper,
    bleedMm,
    images.map((i) => i.cellIndex),
  );
  return { paper, bleedMm, offsetX, offsetY, images, fields, warnings };
}

/**
 * 写真を割り付けたシートの画像・PDF を作る。
 * format: preview（150dpi・確認用の輪郭つき）/ png（600dpi）/ pdf（用紙と同じ大きさ）
 */
export async function registerSheetRoutes(app: FastifyInstance, papers: Paper[]) {
  await app.register(multipart, { limits: { fileSize: MAX_PHOTO_BYTES, files: 64, fields: 96 } });

  app.post<{ Querystring: { format?: string } }>('/api/sheet/render', async (req, reply) => {
    const format = formatSchema.safeParse(req.query.format);
    if (!format.success) {
      return reply.code(400).send({ error: 'format は preview / png / pdf のいずれかです' });
    }
    try {
      const form = await readSheetForm(req, papers);
      reply.header('x-sheet-warnings', encodeURIComponent(JSON.stringify(form.warnings)));

      const opts = { bleedMm: form.bleedMm, offsetXMm: form.offsetX, offsetYMm: form.offsetY };
      if (format.data === 'pdf') {
        const pdf = await renderSheetPdf(form.paper, form.images, { ...opts, dpi: 600 });
        return reply.type('application/pdf').send(Buffer.from(pdf));
      }
      const png = await renderSheetPng(
        form.paper,
        form.images,
        format.data === 'preview'
          ? { ...opts, dpi: 150, guides: true }
          : { ...opts, dpi: 600, guides: false },
      );
      return reply.type('image/png').send(png);
    } catch (e) {
      if (e instanceof FormError) return reply.code(e.code).send({ error: e.message });
      if (e instanceof SheetImageError) return reply.code(422).send({ error: e.message });
      throw e;
    }
  });
}
