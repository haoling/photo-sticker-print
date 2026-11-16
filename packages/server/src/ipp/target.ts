import { isIP } from 'node:net';

/** プリンタの接続先。ユーザーが手入力するので、サーバーから届く先を LAN 内に限る。 */
export interface PrinterTarget {
  host: string;
  port: number;
  /** 例: /ipp/print */
  path: string;
}

export class PrinterTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrinterTargetError';
  }
}

function isPrivateIPv4(host: string): boolean {
  const [a, b] = host.split('.').map(Number) as [number, number];
  return (
    a === 10 ||
    a === 127 || // 開発時の localhost
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) // リンクローカル
  );
}

/**
 * 接続先の入力を検証する。
 * このアプリは「サーバーから任意のホストへ HTTP を送る」ことになるので、
 * 外のサイトへ向けられないよう、LAN 内のアドレス（プライベート IPv4・ループバック・
 * ドットなしのホスト名・.local / .lan / .home.arpa）だけを許す。
 */
export function parsePrinterTarget(input: {
  host: string;
  port?: number | string;
  path?: string;
}): PrinterTarget {
  const host = input.host.trim();
  if (host === '') throw new PrinterTargetError('プリンタのアドレスを入力してください');

  if (isIP(host) === 4) {
    if (!isPrivateIPv4(host)) {
      throw new PrinterTargetError(`${host} は LAN 内のアドレスではありません`);
    }
  } else if (isIP(host) === 6) {
    throw new PrinterTargetError('IPv6 のアドレスには対応していません');
  } else if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.(local|lan)|\.home\.arpa)?$/i.test(host)) {
    throw new PrinterTargetError(
      `${host} は使えません（LAN 内の IP アドレスか、.local などのホスト名を指定してください）`,
    );
  }

  const port = input.port === undefined || input.port === '' ? 631 : Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PrinterTargetError('ポートは 1〜65535 の整数で指定してください');
  }

  const path = input.path === undefined || input.path === '' ? '/ipp/print' : input.path;
  if (!/^\/[A-Za-z0-9._~\-/]*$/.test(path) || path.includes('..')) {
    throw new PrinterTargetError('パスは / で始まる英数字・記号（. _ ~ - /）で指定してください');
  }
  return { host, port, path };
}

export const httpUrl = (t: PrinterTarget) => `http://${t.host}:${t.port}${t.path}`;
/** IPP の printer-uri 属性に入れる URI */
export const ippUri = (t: PrinterTarget) => `ipp://${t.host}:${t.port}${t.path}`;
