import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadPapers } from './papers/index.js';

const config = { immichUrl: 'http://x', immichApiKey: 'secret', port: 3000 };

describe('app', () => {
  it('/api/health が ok を返す', async () => {
    const app = await buildApp({ config, logger: false });
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('API キーをレスポンスに含めない', async () => {
    const app = await buildApp({ config, logger: false });
    const res = await app.inject('/api/info');
    expect(res.body).not.toContain('secret');
  });

  it('/api/papers が用紙定義と printable を返す', async () => {
    const papers = await loadPapers(fileURLToPath(new URL('../../../papers', import.meta.url)));
    const app = await buildApp({ config, papers, logger: false });
    const res = await app.inject('/api/papers');
    expect(res.statusCode).toBe(200);
    const body = res.json<{ papers: { id: string; printable: boolean }[] }>();
    expect(body.papers.map((p) => p.id)).toContain('aone-29662');
    expect(body.papers.every((p) => p.printable)).toBe(true);
  });
});
