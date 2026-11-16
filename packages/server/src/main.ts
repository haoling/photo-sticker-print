import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { findPapersDir, loadPapers, PaperError } from './papers/index.js';

let config;
try {
  config = loadConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(e.message);
    console.error('\n.env.example や docker compose の例を参照してください。');
    process.exit(1);
  }
  throw e;
}

const webRoot = process.env.WEB_ROOT ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
const papersDir = process.env.PAPERS_DIR ?? findPapersDir(dirname(fileURLToPath(import.meta.url)));
if (!papersDir) {
  console.error(
    '用紙定義のディレクトリ（papers/）が見つかりません。PAPERS_DIR で指定してください。',
  );
  process.exit(1);
}
let papers;
try {
  papers = await loadPapers(papersDir);
} catch (e) {
  if (e instanceof PaperError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}

const app = await buildApp({ config, webRoot, papers });
await app.listen({ host: '0.0.0.0', port: config.port });
