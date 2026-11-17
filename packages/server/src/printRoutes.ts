import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getJobStatus,
  getPrinterInfo,
  IppError,
  isFinalJobState,
  JOB_STATE,
  parsePrinterTarget,
  PrinterTargetError,
  type PrinterTarget,
} from './ipp/index.js';
import { isPrintable, type Paper } from './papers/index.js';
import type { PrintImageLoader } from './photos/index.js';
import {
  DEFAULT_LINE_COLOR,
  printDefaults,
  renderSheetPng,
  renderTestPrintPng,
  SheetImageError,
  sendPageToPrinter,
  type SendOptions,
} from './print/index.js';
import { FormError, readSheetForm } from './sheetRoutes.js';

const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
const token = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/, '英数字と . _ - だけ、64 文字までです');

/** 印刷先のプリンタと、印刷の設定（フォームでも JSON でも同じ名前で受ける） */
const printerFields = {
  printerHost: z.string().min(1, 'プリンタのアドレスを入力してください'),
  printerPort: z.preprocess(emptyToUndefined, z.coerce.number().optional()),
  printerPath: z.preprocess(emptyToUndefined, z.string().optional()),
  mediaType: z.preprocess(emptyToUndefined, token.optional()),
  mediaSource: z.preprocess(emptyToUndefined, token.optional()),
  borderless: z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : emptyToUndefined(v)),
    z.boolean().optional(),
  ),
  quality: z.preprocess(emptyToUndefined, z.coerce.number().int().min(3).max(5).default(5)),
  copies: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(99).default(1)),
};
const printerOptionsSchema = z.object(printerFields);

const testPrintSchema = z.object({
  paperId: z.string().min(1),
  offsetX: z.coerce.number().min(-10).max(10).default(0),
  offsetY: z.coerce.number().min(-10).max(10).default(0),
  color: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/)
    .transform((c) => (c.startsWith('#') ? c : `#${c}`))
    .default(DEFAULT_LINE_COLOR),
  ...printerFields,
});

const probeSchema = z.object({
  host: z.string().min(1, 'プリンタのアドレスを入力してください'),
  port: z.preprocess(emptyToUndefined, z.coerce.number().optional()),
  path: z.preprocess(emptyToUndefined, z.string().optional()),
});

const JOB_STATE_NAMES: Record<number, string> = {
  [JOB_STATE.pending]: 'pending',
  [JOB_STATE.pendingHeld]: 'held',
  [JOB_STATE.processing]: 'processing',
  [JOB_STATE.processingStopped]: 'stopped',
  [JOB_STATE.canceled]: 'canceled',
  [JOB_STATE.aborted]: 'aborted',
  [JOB_STATE.completed]: 'completed',
};
const PRINTER_STATE_NAMES: Record<number, string> = { 3: 'idle', 4: 'processing', 5: 'stopped' };

function targetOf(o: {
  printerHost: string;
  printerPort?: number;
  printerPath?: string;
}): PrinterTarget {
  return parsePrinterTarget({ host: o.printerHost, port: o.printerPort, path: o.printerPath });
}

/** 用紙の推奨設定に、画面で指定された設定を重ねる */
function sendOptionsOf(paper: Paper, o: z.infer<typeof printerOptionsSchema>): SendOptions {
  const d = printDefaults(paper);
  return {
    mediaType: o.mediaType ?? d.mediaType,
    mediaSource: o.mediaSource ?? d.mediaSource,
    borderless: o.borderless ?? d.borderless,
    quality: o.quality,
    copies: o.copies,
  };
}

function handleError(e: unknown, reply: FastifyReply) {
  if (e instanceof FormError) return reply.code(e.code).send({ error: e.message });
  if (e instanceof PrinterTargetError) return reply.code(400).send({ error: e.message });
  if (e instanceof SheetImageError) return reply.code(422).send({ error: e.message });
  if (e instanceof IppError) return reply.code(502).send({ error: e.message });
  throw e;
}

const zodMessage = (e: z.ZodError) =>
  e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('、');

/**
 * プリンタへの直接送信（IPP）。multipart の登録（registerSheetRoutes）のあとに呼ぶこと。
 * このアプリには認証がないので、送り先は LAN 内のアドレスに限る（ipp/target.ts）。
 */
export async function registerPrintRoutes(
  app: FastifyInstance,
  papers: Paper[],
  loader?: PrintImageLoader,
) {
  // プリンタへの接続確認。機種・状態・対応する用紙の種類などを返す。
  app.post('/api/printers/probe', async (req, reply) => {
    const body = probeSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: zodMessage(body.error) });
    try {
      const target = parsePrinterTarget(body.data);
      return { target, printer: await getPrinterInfo(target, { timeoutMs: 8000 }) };
    } catch (e) {
      return handleError(e, reply);
    }
  });

  // 写真を割り付けたシートを、プリンタへ送る（フォームは /api/sheet/render と同じ + プリンタの設定）
  app.post('/api/print/sheet', async (req, reply) => {
    try {
      const form = await readSheetForm(req, papers, loader);
      const options = printerOptionsSchema.safeParse(form.fields);
      if (!options.success) throw new FormError(400, zodMessage(options.error));
      if (form.images.length === 0) throw new FormError(400, '写真が 1 枚もありません');
      const target = targetOf(options.data);

      const png = await renderSheetPng(form.paper, form.images, {
        bleedMm: form.bleedMm,
        offsetXMm: form.offsetX,
        offsetYMm: form.offsetY,
        dpi: 600,
        guides: false,
      });
      const job = await sendPageToPrinter(
        target,
        form.paper,
        png,
        sendOptionsOf(form.paper, options.data),
        `${form.paper.id} 写真シール`,
      );
      return { target, warnings: form.warnings, job };
    } catch (e) {
      return handleError(e, reply);
    }
  });

  // テスト印刷（コマの枠線だけ）を、プリンタへ送る
  app.post('/api/print/test', async (req, reply) => {
    const body = testPrintSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: zodMessage(body.error) });
    try {
      const paper = papers.find((p) => p.id === body.data.paperId);
      if (!paper) return reply.code(404).send({ error: '用紙が見つかりません' });
      if (!isPrintable(paper)) {
        return reply
          .code(409)
          .send({ error: `${paper.id}: コマ位置が未測定のため、テスト印刷は作れません` });
      }
      const target = targetOf(body.data);
      const png = await renderTestPrintPng(paper, {
        offsetXMm: body.data.offsetX,
        offsetYMm: body.data.offsetY,
        lineColor: body.data.color,
      });
      const job = await sendPageToPrinter(
        target,
        paper,
        png,
        sendOptionsOf(paper, body.data),
        `${paper.id} テスト印刷`,
      );
      return { target, warnings: [], job };
    } catch (e) {
      return handleError(e, reply);
    }
  });

  // 印刷ジョブの状態
  app.get<{ Params: { jobId: string }; Querystring: Record<string, string> }>(
    '/api/print/jobs/:jobId',
    async (req, reply) => {
      const jobId = Number(req.params.jobId);
      if (!Number.isInteger(jobId) || jobId < 1) {
        return reply.code(400).send({ error: 'ジョブ番号が正しくありません' });
      }
      const q = probeSchema.safeParse({
        host: req.query.host,
        port: req.query.port,
        path: req.query.path,
      });
      if (!q.success) return reply.code(400).send({ error: zodMessage(q.error) });
      try {
        const target = parsePrinterTarget(q.data);
        const s = await getJobStatus(target, jobId, { timeoutMs: 8000 });
        return {
          jobId: s.jobId,
          state: s.state === null ? null : (JOB_STATE_NAMES[s.state] ?? `unknown-${s.state}`),
          stateReasons: s.stateReasons,
          sheetsCompleted: s.sheetsCompleted,
          printerState:
            s.printerState === null ? null : (PRINTER_STATE_NAMES[s.printerState] ?? null),
          printerStateReasons: s.printerStateReasons,
          final: isFinalJobState(s.state),
        };
      } catch (e) {
        return handleError(e, reply);
      }
    },
  );
}
