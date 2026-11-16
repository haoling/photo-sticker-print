import { z } from 'zod';

export const ENV_DOCS: Record<string, string> = {
  IMMICH_URL: 'Immich サーバーの URL（例: http://immich-server:2283）',
  IMMICH_API_KEY: 'Immich の API キー（読み取り権限のみで可）',
  PORT: '待ち受けポート（省略時 3000）',
  PRINTER_SCAN_SUBNET: 'IP スキャンの初期値（例: 192.168.1.0/24）',
};

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const schema = z.object({
  IMMICH_URL: z.preprocess(
    emptyToUndefined,
    z
      .string({ required_error: '必須です' })
      .url('URL の形式ではありません')
      .refine((u) => /^https?:\/\//.test(u), 'http:// か https:// で始めてください'),
  ),
  IMMICH_API_KEY: z.preprocess(emptyToUndefined, z.string({ required_error: '必須です' })),
  PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int('整数で指定してください').min(1).max(65535).default(3000),
  ),
  PRINTER_SCAN_SUBNET: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, '192.168.1.0/24 の形式で指定してください')
      .optional(),
  ),
});

export interface Config {
  immichUrl: string;
  immichApiKey: string;
  port: number;
  printerScanSubnet?: string;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`環境変数の設定に問題があります:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => {
      const key = String(i.path[0]);
      const doc = ENV_DOCS[key];
      return `${key}: ${i.message}${doc ? `（${doc}）` : ''}`;
    });
    throw new ConfigError(problems);
  }
  const v = result.data;
  return {
    immichUrl: v.IMMICH_URL.replace(/\/+$/, ''),
    immichApiKey: v.IMMICH_API_KEY,
    port: v.PORT,
    printerScanSubnet: v.PRINTER_SCAN_SUBNET,
  };
}
