/**
 * フォトストレージの共通インターフェース。Immich 以外（他のセルフホスト系、クラウド）を足すときは、
 * これを実装する。写真の id とページの続き（cursor）は、ストレージごとの不透明な文字列。
 */
export interface Photo {
  id: string;
  /** 元のファイル名（表示用） */
  name: string;
  /** 撮影日時（ISO 8601）。わからなければ null */
  takenAt: string | null;
  /** 向き（EXIF）を反映した大きさ（画素）。width > height なら横長。わからなければ null */
  width: number | null;
  height: number | null;
}

export interface Album {
  id: string;
  name: string;
  photoCount: number;
  /** 表紙にする写真。なければ null */
  coverPhotoId: string | null;
}

export interface PhotoPage {
  photos: Photo[];
  /** 続きがあれば、次の呼び出しに渡す値。なければ null */
  nextCursor: string | null;
}

export interface PageOptions {
  cursor?: string;
  limit: number;
}

export interface ImageData {
  data: Buffer;
  contentType: string;
}

export interface PhotoStorage {
  /** ストレージの種類（'immich' など） */
  readonly kind: string;
  /** 写真の一覧（新しい順。動画は含めない） */
  listPhotos(opts: PageOptions): Promise<PhotoPage>;
  listAlbums(): Promise<Album[]>;
  /** アルバム内の写真（新しい順。動画は含めない） */
  listAlbumPhotos(albumId: string, opts: PageOptions): Promise<PhotoPage>;
  getPhoto(id: string): Promise<Photo>;
  /** 一覧用の小さい画像 */
  getThumbnail(id: string): Promise<ImageData>;
  /** 中くらいの画像。向きを反映済みで、ブラウザと sharp の両方が読める形式（JPEG / WebP） */
  getPreview(id: string): Promise<ImageData>;
  /** 元のファイル。形式はそのまま（HEIC / RAW などのこともある） */
  getOriginal(id: string): Promise<ImageData>;
}

/**
 * フォトストレージの呼び出しが失敗したとき。status はそのまま HTTP ステータスにする
 * （400: id などの形式が違う、404: 見つからない、502: ストレージ側の問題）。
 * message は画面にそのまま出すので、接続先の URL や API キーを入れないこと。
 */
export class PhotoStorageError extends Error {
  constructor(
    public readonly status: 400 | 404 | 502,
    message: string,
  ) {
    super(message);
    this.name = 'PhotoStorageError';
  }
}
