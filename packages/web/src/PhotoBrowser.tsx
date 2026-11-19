import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchAlbums,
  fetchPhotos,
  photoPreviewUrl,
  photoThumbnailUrl,
  type Album,
  type Photo,
} from './api';
import {
  appendPage,
  DRAG_TYPE,
  EMPTY_LIST,
  formatTakenAt,
  groupByDay,
  type PhotoListState,
} from './photoList';

interface Props {
  /** 写真を押したとき。空いているコマに入れる */
  onPick: (photo: Photo) => void;
  /** 写真の id ごとの、コマに入っている数 */
  placed: Map<string, number>;
  /** 空いているコマがない（押しても入らない） */
  full: boolean;
}

/** 写真を大きく見るための表示。背景・×・Esc で閉じる */
function PhotoPreview({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const label = [photo.name, formatTakenAt(photo.takenAt)].filter(Boolean).join(' ');
  return (
    <div
      className="preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="写真のプレビュー"
      onClick={onClose}
    >
      <img src={photoPreviewUrl(photo.id)} alt={label} />
      <button type="button" className="preview-close" aria-label="閉じる" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * 写真のサムネイル一覧。下まで来たら次のページを読む（無限スクロール）。
 * アルバムを切り替えるときは、key を変えて作り直すこと（前の一覧の応答が混ざらないように）。
 */
function PhotoGrid({
  albumId,
  onPick,
  placed,
}: Pick<Props, 'onPick' | 'placed'> & { albumId?: string }) {
  const [list, setList] = useState<PhotoListState>(EMPTY_LIST);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Photo | null>(null);
  const closePreview = useCallback(() => setPreview(null), []);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  // 読み込み中かどうかと、今の一覧。IntersectionObserver から最新の値を見るために ref に持つ
  const busy = useRef(false);
  const current = useRef(list);
  current.current = list;
  const loadMore = useCallback(async () => {
    if (busy.current || current.current.cursor === null) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPhotos({ albumId, cursor: current.current.cursor });
      setList((s) => appendPage(s, page));
    } catch (e) {
      setError(message(e));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [albumId]);

  // 一覧の末尾が見えている間は、次を読む（最初のページも、これで読まれる）
  useEffect(() => {
    const el = sentinel.current;
    if (!el || error || list.cursor === null) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root: scroller.current, rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
    // list.photos.length: 読み足しても末尾がまだ見えているとき、見張り直して続きを読む
  }, [loadMore, error, list.cursor, list.photos.length]);

  return (
    <div className="photo-scroll" ref={scroller}>
      {groupByDay(list.photos).map((g, i) => (
        // 日付なしのまとまりは途中にもできうるので、key に位置も入れる
        <section key={`${g.key}#${i}`} className="photo-day" aria-label={g.label}>
          <h3 className="photo-day-head">
            {g.label}
            <span className="note"> {g.photos.length} 枚</span>
          </h3>
          <ul className="photo-grid">
            {g.photos.map((p) => {
              const count = placed.get(p.id) ?? 0;
              const label = [p.name, formatTakenAt(p.takenAt)].filter(Boolean).join(' ');
              return (
                <li key={p.id} className="thumb-item">
                  <button
                    type="button"
                    className={count > 0 ? 'thumb placed' : 'thumb'}
                    aria-label={
                      (label || '写真') + (count > 0 ? `（${count} コマに入っています）` : '')
                    }
                    title={label}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify([p]));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => onPick(p)}
                  >
                    <img src={photoThumbnailUrl(p.id)} alt="" loading="lazy" draggable={false} />
                    {count > 0 && <span className="badge">{count > 1 ? `✓${count}` : '✓'}</span>}
                  </button>
                  <button
                    type="button"
                    className="thumb-preview"
                    aria-label={`${label || '写真'}をプレビュー`}
                    title="プレビュー"
                    onClick={() => setPreview(p)}
                  >
                    🔍
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {error ? (
        <p role="alert" className="invalid">
          {error}{' '}
          <button type="button" onClick={() => void loadMore()}>
            もう一度読む
          </button>
        </p>
      ) : list.cursor === null ? (
        <p className="note legend">
          {list.photos.length === 0 ? '写真がありません。' : `全 ${list.photos.length} 枚`}
        </p>
      ) : (
        <p className="note legend">{loading ? '読み込み中…' : ''}</p>
      )}
      <div ref={sentinel} className="sentinel" />
      {preview && <PhotoPreview photo={preview} onClose={closePreview} />}
    </div>
  );
}

function AlbumList({ onOpen }: { onOpen: (album: Album) => void }) {
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    fetchAlbums(ctrl.signal)
      .then(setAlbums)
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(message(e));
      });
    return () => ctrl.abort();
  }, [attempt]);

  if (error) {
    return (
      <p role="alert" className="invalid">
        {error}{' '}
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>
          もう一度読む
        </button>
      </p>
    );
  }
  if (!albums) return <p className="note">読み込み中…</p>;
  if (albums.length === 0) return <p className="note">アルバムがありません。</p>;
  return (
    <div className="photo-scroll">
      <ul className="album-list">
        {albums.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => onOpen(a)}>
              {a.coverPhotoId ? (
                <img src={photoThumbnailUrl(a.coverPhotoId)} alt="" loading="lazy" />
              ) : (
                <span className="no-cover" />
              )}
              <span className="album-name">{a.name || '（名前なし）'}</span>
              <span className="note">{a.photoCount} 枚</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** フォトストレージ（Immich）の写真リスト。タイムラインとアルバムを切り替えて、写真を選ぶ。 */
export function PhotoBrowser({ onPick, placed, full }: Props) {
  const [view, setView] = useState<'timeline' | 'albums'>('timeline');
  const [album, setAlbum] = useState<Album | null>(null);

  return (
    <section className="photos" aria-label="写真リスト">
      <div className="tabs small" role="tablist" aria-label="写真の探し方">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'timeline'}
          onClick={() => setView('timeline')}
        >
          タイムライン
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'albums'}
          onClick={() => setView('albums')}
        >
          アルバム
        </button>
      </div>

      {view === 'timeline' ? (
        <PhotoGrid onPick={onPick} placed={placed} />
      ) : album ? (
        <>
          <div className="album-head">
            <button type="button" onClick={() => setAlbum(null)}>
              ← アルバム一覧
            </button>
            <b>{album.name || '（名前なし）'}</b>
          </div>
          <PhotoGrid key={album.id} albumId={album.id} onPick={onPick} placed={placed} />
        </>
      ) : (
        <AlbumList onOpen={setAlbum} />
      )}

      {full ? (
        <p role="status" className="invalid">
          空いているコマがありません。入れ替えるときは、コマの ×
          で外すか、写真をコマへドラッグしてください。
        </p>
      ) : (
        <p className="note">
          写真を押すと、空いているコマに入ります（✓:
          入っている写真）。決まったコマに入れるときは、そのコマへドラッグしてください。
        </p>
      )}
    </section>
  );
}
