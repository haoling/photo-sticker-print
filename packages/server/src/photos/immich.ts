import {
  PhotoStorageError,
  type Album,
  type ImageData,
  type PageOptions,
  type Photo,
  type PhotoPage,
  type PhotoStorage,
} from './storage.js';

/** この API キーに必要な Immich の権限 */
export const IMMICH_PERMISSIONS = ['asset.read', 'asset.view', 'asset.download', 'album.read'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** これより大きい画像は受け取らない（メモリを守る） */
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;

interface ImmichAsset {
  id: string;
  type?: string;
  originalFileName?: string;
  localDateTime?: string;
  fileCreatedAt?: string;
  width?: number | null;
  height?: number | null;
  exifInfo?: {
    exifImageWidth?: number | null;
    exifImageHeight?: number | null;
    orientation?: string | null;
  };
}

interface ImmichAlbum {
  id: string;
  albumName?: string;
  assetCount?: number;
  albumThumbnailAssetId?: string | null;
}

const positive = (n: unknown): n is number => typeof n === 'number' && n > 0;

function toPhoto(a: ImmichAsset): Photo {
  let width: number | null = null;
  let height: number | null = null;
  if (positive(a.width) && positive(a.height)) {
    width = a.width;
    height = a.height;
  } else if (positive(a.exifInfo?.exifImageWidth) && positive(a.exifInfo?.exifImageHeight)) {
    // EXIF の向きが 5〜8 のとき、縦横が入れ替わる
    const swap = Number(a.exifInfo.orientation) >= 5;
    width = swap ? a.exifInfo.exifImageHeight : a.exifInfo.exifImageWidth;
    height = swap ? a.exifInfo.exifImageWidth : a.exifInfo.exifImageHeight;
  }
  return {
    id: a.id,
    name: a.originalFileName ?? '',
    takenAt: a.localDateTime ?? a.fileCreatedAt ?? null,
    width,
    height,
  };
}

export interface ImmichOptions {
  url: string;
  apiKey: string;
  timeoutMs?: number;
}

/**
 * Immich をフォトストレージとして使う。読み取りだけで、呼ぶ API はこのファイルにあるものに限る
 * （検索 / アルバム一覧 / 写真の情報 / サムネイル / 元のファイル）。
 * API キーは x-api-key ヘッダで Immich にだけ送り、戻り値やエラーには入れない。
 */
export function createImmichStorage({
  url,
  apiKey,
  timeoutMs = 30_000,
}: ImmichOptions): PhotoStorage {
  const base = `${url.replace(/\/+$/, '')}/api`;

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(base + path, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), 'x-api-key': apiKey },
        // 別のホストへ転送されて API キーが渡ることのないよう、リダイレクトには従わない
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new PhotoStorageError(
        502,
        'Immich に接続できませんでした。サーバーの設定（IMMICH_URL）と、Immich が動いているかを確かめてください。',
      );
    }
    if (res.ok) return res;
    await res.body?.cancel().catch(() => {});
    if (res.status === 401) {
      throw new PhotoStorageError(
        502,
        'Immich が API キーを受け付けませんでした。サーバーの設定（IMMICH_API_KEY）を確かめてください。',
      );
    }
    if (res.status === 403) {
      throw new PhotoStorageError(
        502,
        `Immich の API キーの権限が足りません（必要な権限: ${IMMICH_PERMISSIONS.join('、')}）。`,
      );
    }
    // Immich は、他人の写真や存在しない id に 400 を返す
    if (res.status === 404 || res.status === 400) {
      throw new PhotoStorageError(404, '写真が見つかりませんでした。');
    }
    throw new PhotoStorageError(502, `Immich がエラーを返しました（HTTP ${res.status}）。`);
  }

  async function json<T>(path: string, body?: unknown): Promise<T> {
    const res = await call(
      path,
      body === undefined
        ? { headers: { accept: 'application/json' } }
        : {
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    try {
      return (await res.json()) as T;
    } catch {
      throw new PhotoStorageError(502, 'Immich の応答を読めませんでした。');
    }
  }

  async function image(path: string): Promise<ImageData> {
    const res = await call(path);
    if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) {
      await res.body?.cancel().catch(() => {});
      throw new PhotoStorageError(502, '写真のファイルが大きすぎます（100MB まで）。');
    }
    let data: Buffer;
    try {
      data = Buffer.from(await res.arrayBuffer());
    } catch {
      throw new PhotoStorageError(502, 'Immich から写真を受け取れませんでした。');
    }
    if (data.length > MAX_IMAGE_BYTES) {
      throw new PhotoStorageError(502, '写真のファイルが大きすぎます（100MB まで）。');
    }
    return { data, contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
  }

  const checkId = (id: string, what: string) => {
    if (!UUID.test(id)) throw new PhotoStorageError(400, `${what}の id が正しくありません。`);
    return id;
  };

  async function search(filter: Record<string, unknown>, opts: PageOptions): Promise<PhotoPage> {
    // cursor は Immich のページ番号（1 始まり）
    const page = opts.cursor === undefined ? 1 : Number(opts.cursor);
    if (!Number.isInteger(page) || page < 1 || page > 1_000_000) {
      throw new PhotoStorageError(400, 'cursor が正しくありません。');
    }
    const res = await json<{ assets?: { items?: ImmichAsset[]; nextPage?: string | null } }>(
      '/search/metadata',
      { ...filter, type: 'IMAGE', order: 'desc', page, size: opts.limit, withExif: true },
    );
    const items = res.assets?.items ?? [];
    const next = res.assets?.nextPage;
    return {
      photos: items.filter((a) => a.type === undefined || a.type === 'IMAGE').map(toPhoto),
      nextCursor: next && /^\d+$/.test(String(next)) ? String(next) : null,
    };
  }

  return {
    kind: 'immich',
    listPhotos: (opts) => search({}, opts),
    async listAlbums(): Promise<Album[]> {
      const albums = await json<ImmichAlbum[]>('/albums');
      return albums.map((a) => ({
        id: a.id,
        name: a.albumName ?? '',
        photoCount: a.assetCount ?? 0,
        coverPhotoId: a.albumThumbnailAssetId ?? null,
      }));
    },
    listAlbumPhotos: (albumId, opts) => search({ albumIds: [checkId(albumId, 'アルバム')] }, opts),
    async getPhoto(id) {
      const asset = await json<ImmichAsset>(`/assets/${checkId(id, '写真')}`);
      if (asset.type !== undefined && asset.type !== 'IMAGE') {
        throw new PhotoStorageError(404, '写真が見つかりませんでした（動画は使えません）。');
      }
      return toPhoto(asset);
    },
    getThumbnail: (id) => image(`/assets/${checkId(id, '写真')}/thumbnail?size=thumbnail`),
    getPreview: (id) => image(`/assets/${checkId(id, '写真')}/thumbnail?size=preview`),
    getOriginal: (id) => image(`/assets/${checkId(id, '写真')}/original`),
  };
}
