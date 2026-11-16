import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import { paperSchema, type Paper } from './schema.js';

export class PaperError extends Error {
  constructor(public readonly problems: string[]) {
    super(`用紙定義に問題があります:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'PaperError';
  }
}

/** dir 内の *.json（schema.json を除く）を読み込んで検証する。問題はすべて並べて報告する。 */
export async function loadPapers(dir: string): Promise<Paper[]> {
  const files = (await readdir(dir))
    .filter((f) => f.endsWith('.json') && f !== 'schema.json')
    .sort();
  const problems: string[] = [];
  const papers: Paper[] = [];
  const idToFile = new Map<string, string>();

  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(dir, file), 'utf8'));
    } catch (e) {
      problems.push(`${file}: JSON として読めません（${(e as Error).message}）`);
      continue;
    }
    const result = paperSchema.safeParse(raw);
    if (!result.success) {
      for (const i of result.error.issues) {
        problems.push(`${file}: ${i.path.join('.') || '(全体)'}: ${i.message}`);
      }
      continue;
    }
    const paper = result.data;
    const dup = idToFile.get(paper.id);
    if (dup) {
      problems.push(`${file}: id「${paper.id}」が ${dup} と重複しています`);
      continue;
    }
    idToFile.set(paper.id, file);
    papers.push(paper);
  }

  if (problems.length > 0) throw new PaperError(problems);
  return papers;
}

/** startDir から親へたどって、papers/schema.json を含む papers ディレクトリを探す。 */
export function findPapersDir(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, 'papers');
    if (existsSync(join(candidate, 'schema.json'))) return candidate;
    if (dir === parse(dir).root) return null;
    dir = dirname(dir);
  }
}
