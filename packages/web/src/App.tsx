import { useEffect, useState } from 'react';
import { SheetPage } from './SheetPage';
import { TestPrintPage } from './TestPrintPage';

export function App() {
  const [tab, setTab] = useState<'sheet' | 'test'>('sheet');
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
      <nav className="tabs" role="tablist" aria-label="画面">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sheet'}
          onClick={() => setTab('sheet')}
        >
          写真を割り付け
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'test'}
          onClick={() => setTab('test')}
        >
          テスト印刷
        </button>
      </nav>
      {tab === 'sheet' ? (
        <SheetPage />
      ) : (
        <>
          <p className="note">コマの枠線だけを刷って、シール用紙に重ねて位置のズレを測ります。</p>
          <TestPrintPage />
        </>
      )}
    </main>
  );
}
