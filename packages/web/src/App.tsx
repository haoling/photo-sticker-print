import { useEffect, useState } from 'react';

export function App() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    fetch('/api/health')
      .then((r) => setStatus(r.ok ? 'ok' : 'error'))
      .catch(() => setStatus('error'));
  }, []);

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Photo Sticker Print</h1>
      <p>サーバー接続: {status === 'loading' ? '確認中…' : status === 'ok' ? 'OK' : 'エラー'}</p>
    </main>
  );
}
