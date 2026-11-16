import { useEffect, useState } from 'react';
import { TestPrintPage } from './TestPrintPage';

export function App() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    fetch('/api/health')
      .then((r) => setStatus(r.ok ? 'ok' : 'error'))
      .catch(() => setStatus('error'));
  }, []);

  return (
    <main className="app">
      <header>
        <h1>Photo Sticker Print</h1>
        <p className="status" data-status={status}>
          サーバー接続: {status === 'loading' ? '確認中…' : status === 'ok' ? 'OK' : 'エラー'}
        </p>
      </header>
      <h2>テスト印刷</h2>
      <p className="note">コマの枠線だけを刷って、シール用紙に重ねて位置のズレを測ります。</p>
      <TestPrintPage />
    </main>
  );
}
