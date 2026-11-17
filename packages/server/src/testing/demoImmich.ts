import sharp from 'sharp';
import { startMockImmich, uuid, type MockAsset } from './mockImmich.js';

/**
 * 画面の確認用に、色つきの写真を入れたモックの Immich を立てる（開発用）。
 *   pnpm --filter @photo-sticker-print/server exec tsx src/testing/demoImmich.ts
 * 表示された IMMICH_URL / IMMICH_API_KEY でサーバーを起動する。
 */
const COUNT = Number(process.env.DEMO_PHOTOS ?? 150);
const ALBUM = uuid(900_000);

async function picture(n: number, w: number, h: number, format: 'jpeg' | 'webp') {
  const hue = (n * 47) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 80) % 360},70%,35%)"/>` +
    `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>` +
    `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="rgba(255,255,255,.85)"/>` +
    `<text x="50%" y="50%" font-size="${Math.min(w, h) / 5}" font-family="sans-serif" text-anchor="middle" dominant-baseline="central">${n}</text></svg>`;
  return sharp(Buffer.from(svg))[format]({ quality: 85 }).toBuffer();
}

const mock = await startMockImmich(process.env.DEMO_API_KEY ?? 'demo-immich-key');
mock.albums = [{ id: ALBUM, albumName: 'デモのアルバム' }];
for (let n = 1; n <= COUNT; n++) {
  const portrait = n % 3 === 0;
  const [w, h] = portrait ? [3000, 4000] : [4000, 3000];
  const asset: MockAsset = {
    id: uuid(n),
    type: n % 10 === 0 ? 'VIDEO' : 'IMAGE',
    originalFileName: `IMG_${String(n).padStart(4, '0')}.jpg`,
    localDateTime: new Date(Date.UTC(2026, 0, 1) + n * 3_600_000 * 7).toISOString(),
    width: w,
    height: h,
    albumIds: n % 4 === 0 ? [ALBUM] : [],
    thumbnail: await picture(n, w / 16, h / 16, 'webp'),
    preview: await picture(n, (w * 1440) / 4000, (h * 1440) / 4000, 'jpeg'),
    original: await picture(n, w, h, 'jpeg'),
    originalType: 'image/jpeg',
  };
  mock.assets.push(asset);
}
console.log(`IMMICH_URL=${mock.url} IMMICH_API_KEY=${mock.apiKey}`);
