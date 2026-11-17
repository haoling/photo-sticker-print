import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  decodeResponse,
  encodeRequest,
  IPP_GROUP,
  IPP_OPERATION,
  type IppAttributeSpec,
  type IppResponse,
} from '../ipp/codec.js';

/** テスト用の IPP プリンタ。Canon TS7630 の応答（docs/printer-ts7630.md）に近い内容を返す。 */
export interface MockPrinter {
  url: string;
  host: string;
  port: number;
  /** 受け取った要求（デコード済み） */
  requests: IppResponse[];
  /** 受け取った Print-Job の文書データ */
  documents: Buffer[];
  /** 次に返すジョブの状態（job-state）。先頭から順に使い、最後の値を使い続ける */
  jobStates: number[];
  jobStateReasons: string[];
  printerStateReasons: string[];
  /** 設定すると、その IPP ステータスコードで失敗させる */
  failWith: number | null;
  /** 設定すると、HTTP のステータスで失敗させる */
  httpStatus: number | null;
  /** 本物のプリンタの癖: 要求されていなくても、先に HTTP の 100 Continue を返す（fetch は不正な応答として切断する） */
  send100Continue: boolean;
  /** 本物のプリンタの癖: Content-Length なしの分割（chunked）の応答を返す */
  chunked: boolean;
  /** 設定すると、IPP でない本文を返す */
  garbageBody: boolean;
  close(): Promise<void>;
}

const attr = (spec: IppAttributeSpec) => spec;

function respond(
  status: number,
  requestId: number,
  groups: { tag: number; attributes: IppAttributeSpec[] }[],
) {
  const head: IppAttributeSpec[] = [
    attr({ name: 'attributes-charset', type: 'charset', value: 'utf-8' }),
    attr({ name: 'attributes-natural-language', type: 'naturalLanguage', value: 'en' }),
  ];
  return encodeRequest({
    operation: status,
    requestId,
    groups: [{ tag: IPP_GROUP.operation, attributes: head }, ...groups],
  });
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

export async function startMockPrinter(): Promise<MockPrinter> {
  let nextJobId = 100;
  const printer: MockPrinter = {
    url: '',
    host: '127.0.0.1',
    port: 0,
    requests: [],
    documents: [],
    jobStates: [9],
    jobStateReasons: ['job-completed-successfully'],
    printerStateReasons: ['none'],
    failWith: null,
    httpStatus: null,
    send100Continue: false,
    chunked: false,
    garbageBody: false,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  let polls = 0;

  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    if (printer.httpStatus) {
      res.writeHead(printer.httpStatus).end();
      return;
    }
    if (req.method !== 'POST' || req.headers['content-type'] !== 'application/ipp') {
      res.writeHead(400).end();
      return;
    }
    const decoded = decodeResponse(body);
    printer.requests.push(decoded);
    const op = decoded.status; // 要求では、この位置が operation-id
    let out: Buffer;

    if (printer.failWith !== null) {
      out = respond(printer.failWith, decoded.requestId, []);
    } else if (op === IPP_OPERATION.GetPrinterAttributes) {
      out = respond(0, decoded.requestId, [
        {
          tag: IPP_GROUP.printer,
          attributes: [
            { name: 'printer-name', type: 'name', value: 'Canon TS7630 series' },
            { name: 'printer-make-and-model', type: 'text', value: 'Canon TS7630 series' },
            {
              name: 'printer-uuid',
              type: 'uri',
              value: 'urn:uuid:11111111-2222-3333-4444-555555555555',
            },
            { name: 'printer-state', type: 'enum', value: 3 },
            { name: 'printer-state-reasons', type: 'keyword', value: printer.printerStateReasons },
            {
              name: 'document-format-supported',
              type: 'mimeMediaType',
              value: ['application/octet-stream', 'image/jpeg', 'image/urf', 'image/pwg-raster'],
            },
            {
              name: 'media-supported',
              type: 'keyword',
              value: ['iso_a4_210x297mm', 'jpn_hagaki_100x148mm'],
            },
            {
              name: 'media-type-supported',
              type: 'keyword',
              value: ['stationery', 'photographic', 'com.canon-mtglossy', 'auto'],
            },
            { name: 'media-source-supported', type: 'keyword', value: ['auto', 'main', 'rear'] },
            { name: 'print-quality-supported', type: 'enum', value: [3, 4, 5] },
          ],
        },
      ]);
    } else if (op === IPP_OPERATION.PrintJob) {
      printer.documents.push(decoded.data);
      out = respond(0, decoded.requestId, [
        {
          tag: IPP_GROUP.job,
          attributes: [
            { name: 'job-id', type: 'integer', value: nextJobId++ },
            {
              name: 'job-uri',
              type: 'uri',
              value: `ipp://${printer.host}:${printer.port}/ipp/print/${nextJobId - 1}`,
            },
            { name: 'job-state', type: 'enum', value: 3 },
          ],
        },
      ]);
    } else if (op === IPP_OPERATION.GetJobAttributes) {
      const state = printer.jobStates[Math.min(polls++, printer.jobStates.length - 1)]!;
      out = respond(0, decoded.requestId, [
        {
          tag: IPP_GROUP.job,
          attributes: [
            { name: 'job-state', type: 'enum', value: state },
            { name: 'job-state-reasons', type: 'keyword', value: printer.jobStateReasons },
            { name: 'job-media-sheets-completed', type: 'integer', value: state === 9 ? 1 : 0 },
            { name: 'job-impressions-completed', type: 'integer', value: state === 9 ? 1 : 0 },
          ],
        },
      ]);
    } else {
      out = respond(0x0501, decoded.requestId, []); // operation-not-supported
    }
    if (printer.send100Continue) res.writeContinue();
    if (printer.garbageBody) out = Buffer.from('<html>not ipp</html>');
    if (printer.chunked) {
      res.writeHead(200, { 'content-type': 'application/ipp' });
      res.write(out.subarray(0, 10));
      res.end(out.subarray(10));
    } else {
      res.writeHead(200, { 'content-type': 'application/ipp' }).end(out);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  printer.port = (server.address() as AddressInfo).port;
  printer.url = `http://${printer.host}:${printer.port}/ipp/print`;
  return printer;
}
