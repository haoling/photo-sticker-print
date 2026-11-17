import { z } from 'zod';

const nullableMm = z.number().finite().nullable().optional();

/**
 * 用紙定義（papers/*.json）の検証スキーマ。
 * 編集支援用の papers/schema.json と同じ項目を持つ（schema.test.ts で項目名の一致を確認している）。
 * 座標はすべて mm、原点は用紙の左上、X は右向き・Y は下向き。
 */
export const paperSchema = z
  .object({
    $schema: z.string().optional(),
    id: z.string().regex(/^[a-z0-9-]+$/, '英小文字・数字・ハイフンのみ使えます'),
    name: z.string().min(1),
    manufacturer: z.string().min(1),
    productCode: z.string().min(1),
    jan: z
      .string()
      .regex(/^\d{13}$/, '13 桁の数字で指定してください')
      .nullable()
      .optional(),
    productUrl: z.string().url().nullable().optional(),
    material: z
      .object({
        kind: z.enum(['plain', 'photo-gloss-paper', 'photo-gloss-film']).optional(),
        thicknessMm: z.number().positive().nullable().optional(),
      })
      .strict()
      .optional(),
    sheetsPerPack: z.number().int().positive().nullable().optional(),
    sheet: z
      .object({
        sizeName: z.string().min(1),
        widthMm: z.number().positive(),
        heightMm: z.number().positive(),
      })
      .strict(),
    layout: z
      .object({
        type: z.literal('grid'),
        columns: z.number().int().min(1),
        rows: z.number().int().min(1),
        cellWidthMm: z.number().positive(),
        cellHeightMm: z.number().positive(),
        cornerRadiusMm: z.number().min(0).nullable().optional(),
        firstCellLeftMm: nullableMm,
        firstCellTopMm: nullableMm,
        pitchXMm: nullableMm,
        pitchYMm: nullableMm,
      })
      .strict(),
    recommendedPrint: z
      .object({
        mediaType: z.string().min(1).optional(),
        /** 給紙位置（IPP の media-source）。rear は後トレイ */
        mediaSource: z.enum(['auto', 'main', 'rear']).optional(),
        borderless: z.boolean().optional(),
        note: z.string().optional(),
      })
      .strict()
      .optional(),
    requires: z.object({ borderless: z.boolean().optional() }).strict().optional(),
    verification: z
      .object({
        status: z.enum(['unmeasured', 'measured', 'verified']),
        source: z.string().optional(),
        verifiedWith: z.string().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const l = p.layout;

    if (p.verification.status === 'verified' && !p.verification.verifiedWith) {
      issue(['verification', 'verifiedWith'], 'verified のときは検証したプリンタを書いてください');
    }

    const positions = {
      firstCellLeftMm: l.firstCellLeftMm,
      firstCellTopMm: l.firstCellTopMm,
      pitchXMm: l.pitchXMm,
      pitchYMm: l.pitchYMm,
    };
    const missing = Object.entries(positions)
      .filter(([, v]) => v == null)
      .map(([k]) => k);

    if (p.verification.status !== 'unmeasured') {
      for (const k of missing) {
        issue(
          ['layout', k],
          `${p.verification.status} のときは必須です（未測定なら unmeasured にしてください）`,
        );
      }
    }
    if (missing.length > 0) return; // 以降の幾何チェックには全部の値が要る

    const left = l.firstCellLeftMm as number;
    const top = l.firstCellTopMm as number;
    const px = l.pitchXMm as number;
    const py = l.pitchYMm as number;
    if (left < 0) issue(['layout', 'firstCellLeftMm'], '0 以上にしてください');
    if (top < 0) issue(['layout', 'firstCellTopMm'], '0 以上にしてください');
    if (px < l.cellWidthMm) issue(['layout', 'pitchXMm'], 'コマ幅より小さいとコマが重なります');
    if (py < l.cellHeightMm) issue(['layout', 'pitchYMm'], 'コマ高さより小さいとコマが重なります');
    const right = left + (l.columns - 1) * px + l.cellWidthMm;
    const bottom = top + (l.rows - 1) * py + l.cellHeightMm;
    if (right > p.sheet.widthMm) {
      issue(['layout'], `最後の列の右端（${right}mm）が用紙幅 ${p.sheet.widthMm}mm を超えています`);
    }
    if (bottom > p.sheet.heightMm) {
      issue(
        ['layout'],
        `最後の段の下端（${bottom}mm）が用紙高さ ${p.sheet.heightMm}mm を超えています`,
      );
    }
    const r = l.cornerRadiusMm;
    if (r != null && r > Math.min(l.cellWidthMm, l.cellHeightMm) / 2) {
      issue(['layout', 'cornerRadiusMm'], 'コマの短辺の半分を超えています');
    }
  });

export type Paper = z.infer<typeof paperSchema>;
