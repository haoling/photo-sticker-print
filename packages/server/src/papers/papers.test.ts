import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  computeCells,
  findPapersDir,
  isPrintable,
  loadPapers,
  paperSchema,
  PaperError,
} from './index.js';

const repoPapers = fileURLToPath(new URL('../../../../papers', import.meta.url));

const base = {
  id: 'test-paper',
  name: 'テスト用紙',
  manufacturer: 'テスト',
  productCode: 'T-1',
  sheet: { sizeName: 'hagaki', widthMm: 100, heightMm: 148 },
  layout: {
    type: 'grid',
    columns: 2,
    rows: 5,
    cellWidthMm: 31,
    cellHeightMm: 23,
    cornerRadiusMm: 1.5,
    firstCellLeftMm: 13,
    firstCellTopMm: 7.5,
    pitchXMm: 43,
    pitchYMm: 27.5,
  },
  verification: { status: 'measured' },
};

const withLayout = (layout: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  ...base,
  ...extra,
  layout: { ...base.layout, ...layout },
});

const problemsOf = (v: unknown) => {
  const r = paperSchema.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('リポジトリの用紙定義', () => {
  it('papers/ の定義がすべて検証を通り、3 品番が揃っている', async () => {
    const papers = await loadPapers(repoPapers);
    expect(papers.map((p) => p.id).sort()).toEqual(['aone-26009', 'aone-29622', 'aone-29662']);
  });

  it('どの定義も 10 コマで、用紙の内側に収まり、重ならない', async () => {
    for (const paper of await loadPapers(repoPapers)) {
      const cells = computeCells(paper);
      expect(cells, paper.id).toHaveLength(10);
      for (const c of cells) {
        expect(c.xMm).toBeGreaterThanOrEqual(0);
        expect(c.yMm).toBeGreaterThanOrEqual(0);
        expect(c.xMm + c.widthMm).toBeLessThanOrEqual(paper.sheet.widthMm);
        expect(c.yMm + c.heightMm).toBeLessThanOrEqual(paper.sheet.heightMm);
      }
    }
  });

  it('26009 の 1 コマ目と最後のコマの位置', async () => {
    const paper = (await loadPapers(repoPapers)).find((p) => p.id === 'aone-26009')!;
    const cells = computeCells(paper);
    expect(cells[0]).toMatchObject({ xMm: 8.5, yMm: 8, widthMm: 40, heightMm: 24 });
    expect(cells[9]).toMatchObject({ xMm: 51.5, yMm: 116, row: 4, col: 1 });
  });
});

describe('paperSchema', () => {
  it('正しい定義を受け付ける', () => {
    expect(problemsOf(base)).toEqual([]);
  });

  it('未測定（unmeasured）ならコマ位置が null でもよいが、印刷には使えない', () => {
    const paper = paperSchema.parse(
      withLayout(
        { firstCellLeftMm: null, firstCellTopMm: null, pitchXMm: null, pitchYMm: null },
        { verification: { status: 'unmeasured' } },
      ),
    );
    expect(isPrintable(paper)).toBe(false);
    expect(() => computeCells(paper)).toThrow('未測定');
  });

  it('measured でコマ位置が null だと不合格', () => {
    const p = problemsOf(withLayout({ pitchYMm: null }));
    expect(p).toEqual([expect.stringContaining('layout.pitchYMm')]);
  });

  it('verified には検証したプリンタが要る', () => {
    expect(problemsOf({ ...base, verification: { status: 'verified' } })).toEqual([
      expect.stringContaining('verification.verifiedWith'),
    ]);
    expect(
      problemsOf({ ...base, verification: { status: 'verified', verifiedWith: 'Canon TS7630' } }),
    ).toEqual([]);
  });

  it('コマが重なる、用紙からはみ出す、角丸が大きすぎる定義を弾く', () => {
    expect(problemsOf(withLayout({ pitchXMm: 30 }))).toEqual([
      expect.stringContaining('layout.pitchXMm'),
    ]);
    expect(problemsOf(withLayout({ firstCellLeftMm: 30 }))).toEqual([
      expect.stringContaining('右端'),
    ]);
    expect(problemsOf(withLayout({ firstCellTopMm: 20 }))).toEqual([
      expect.stringContaining('下端'),
    ]);
    expect(problemsOf(withLayout({ cornerRadiusMm: 12 }))).toEqual([
      expect.stringContaining('layout.cornerRadiusMm'),
    ]);
  });

  it('未知の項目と不正な id を弾く', () => {
    expect(problemsOf({ ...base, colour: 'red' })).not.toEqual([]);
    expect(problemsOf({ ...base, id: 'Bad ID' })).toEqual([expect.stringContaining('id')]);
  });
});

describe('papers/schema.json との一致', () => {
  type JsonNode = { properties?: Record<string, JsonNode> };
  type ZodObj = { shape: Record<string, unknown> };
  const unwrap = (z: unknown): ZodObj | null => {
    let cur = z as { shape?: unknown; _def?: { innerType?: unknown; schema?: unknown } };
    for (let i = 0; i < 4 && cur; i++) {
      if (cur.shape) return cur as ZodObj;
      cur = (cur._def?.innerType ?? cur._def?.schema) as typeof cur;
    }
    return null;
  };

  it('項目名（入れ子を含む）が JSON Schema と zod で同じ', async () => {
    const json = JSON.parse(await readFile(join(repoPapers, 'schema.json'), 'utf8')) as JsonNode;
    const walk = (node: JsonNode, zodObj: ZodObj | null, path: string) => {
      if (!node.properties) return;
      expect(zodObj, `${path} が zod にない`).not.toBeNull();
      const jsonKeys = Object.keys(node.properties).sort();
      const zodKeys = Object.keys(zodObj!.shape)
        .filter((k) => k !== '$schema')
        .sort();
      expect(zodKeys, path).toEqual(jsonKeys);
      for (const [k, child] of Object.entries(node.properties)) {
        walk(child, unwrap(zodObj!.shape[k]), `${path}.${k}`);
      }
    };
    walk(json, unwrap(paperSchema), '(root)');
  });
});

describe('loadPapers', () => {
  const write = async (files: Record<string, string>) => {
    const dir = await mkdtemp(join(tmpdir(), 'papers-'));
    for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
    return dir;
  };

  it('問題をファイルごとにすべて並べて報告する', async () => {
    const dir = await write({
      'a.json': '{ not json',
      'b.json': JSON.stringify({ ...base, id: 'Bad' }),
      'c.json': JSON.stringify(base),
      'd.json': JSON.stringify(base), // c.json と id が重複
      'schema.json': '{}', // 読み飛ばされる
    });
    const err = await loadPapers(dir).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PaperError);
    const msg = (err as PaperError).message;
    expect(msg).toContain('a.json');
    expect(msg).toContain('b.json: id');
    expect(msg).toContain('d.json: id「test-paper」が c.json と重複');
    expect(msg).not.toContain('schema.json');
  });
});

describe('findPapersDir', () => {
  it('親ディレクトリをたどって papers/ を見つける', () => {
    const here = fileURLToPath(new URL('.', import.meta.url));
    expect(findPapersDir(here)).toBe(repoPapers);
  });

  it('無ければ null', async () => {
    expect(findPapersDir(await mkdtemp(join(tmpdir(), 'nopapers-')))).toBeNull();
  });
});
