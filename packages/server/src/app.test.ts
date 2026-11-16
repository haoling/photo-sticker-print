import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

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
});
