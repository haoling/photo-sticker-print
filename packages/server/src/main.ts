import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';

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
const app = await buildApp({ config, webRoot });
await app.listen({ host: '0.0.0.0', port: config.port });
