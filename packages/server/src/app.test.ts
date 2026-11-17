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

  describe('テスト印刷', () => {
    const build = async () => {
      const papers = await loadPapers(fileURLToPath(new URL('../../../papers', import.meta.url)));
      return buildApp({ config, papers, logger: false });
    };

    it('PNG / PDF / SVG を返す', async () => {
      const app = await build();
      const png = await app.inject('/api/papers/aone-26009/test-print.png?offsetX=0.5');
      expect(png.statusCode).toBe(200);
      expect(png.headers['content-type']).toBe('image/png');
      expect(png.rawPayload.subarray(1, 4).toString()).toBe('PNG');
      const pdf = await app.inject('/api/papers/aone-26009/test-print.pdf');
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
      const svg = await app.inject('/api/papers/aone-29662/test-print.svg');
      expect(svg.headers['content-type']).toBe('image/svg+xml');
    });

    it('線の色を指定できる。不正な色は 400', async () => {
      const app = await build();
      const red = await app.inject('/api/papers/aone-26009/test-print.svg?color=ff0000');
      expect(red.body).toContain('stroke="#ff0000"');
      const hash = await app.inject('/api/papers/aone-26009/test-print.svg?color=%2300ff00');
      expect(hash.body).toContain('stroke="#00ff00"');
      for (const bad of ['red', 'fff', 'gggggg']) {
        const res = await app.inject(`/api/papers/aone-26009/test-print.svg?color=${bad}`);
        expect(res.statusCode, bad).toBe(400);
      }
    });

    it('存在しない用紙は 404、不正な位置補正は 400', async () => {
      const app = await build();
      expect((await app.inject('/api/papers/nothing/test-print.png')).statusCode).toBe(404);
      expect(
        (await app.inject('/api/papers/aone-26009/test-print.png?offsetX=abc')).statusCode,
      ).toBe(400);
      expect(
        (await app.inject('/api/papers/aone-26009/test-print.png?offsetY=99')).statusCode,
      ).toBe(400);
    });
  });
});
