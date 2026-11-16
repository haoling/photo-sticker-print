import {
  decodeResponse,
  encodeRequest,
  findAttributes,
  IPP_GROUP,
  IPP_OPERATION,
  isOk,
  type IppAttributeSpec,
  type IppRequest,
  type IppResponse,
  type IppValue,
} from './codec.js';
import { httpUrl, ippUri, type PrinterTarget } from './target.js';

export class IppError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'IppError';
  }
}

export interface IppClientOptions {
  timeoutMs?: number;
  /** 差し替え用（テスト） */
  fetchImpl?: typeof fetch;
}

const STATUS_NAMES: Record<number, string> = {
  0x0400: 'bad-request',
  0x0401: 'forbidden',
  0x0402: 'not-authenticated',
  0x0403: 'not-authorized',
  0x0404: 'not-possible',
  0x0405: 'timeout',
  0x0406: 'not-found',
  0x0407: 'gone',
  0x0408: 'request-entity-too-large',
  0x040a: 'document-format-not-supported',
  0x040b: 'attributes-or-values-not-supported',
  0x040c: 'uri-scheme-not-supported',
  0x040d: 'charset-not-supported',
  0x040e: 'conflicting-attributes',
  0x0412: 'document-format-error',
  0x0500: 'internal-error',
  0x0501: 'operation-not-supported',
  0x0502: 'service-unavailable',
  0x0503: 'version-not-supported',
  0x0504: 'device-error',
  0x0505: 'temporary-error',
  0x0506: 'not-accepting-jobs',
  0x0507: 'busy',
  0x0508: 'job-canceled',
};

let requestCounter = 1;

/** 1 回の IPP 要求を送って、応答を読む。失敗（HTTP エラー・IPP のエラーステータス）は IppError。 */
export async function ippCall(
  target: PrinterTarget,
  req: Omit<IppRequest, 'requestId'>,
  { timeoutMs = 30_000, fetchImpl = fetch }: IppClientOptions = {},
): Promise<IppResponse> {
  const body = encodeRequest({ ...req, requestId: requestCounter++ });
  let res: Response;
  try {
    res = await fetchImpl(httpUrl(target), {
      method: 'POST',
      headers: { 'content-type': 'application/ipp' },
      body: body as unknown as BodyInit, // Buffer をそのまま送る（コピーしない）
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const err = e as Error;
    const detail =
      err.name === 'TimeoutError'
        ? `${timeoutMs / 1000} 秒以内に応答がありません`
        : ((err.cause as Error | undefined)?.message ?? err.message);
    throw new IppError(`プリンタ ${target.host} に接続できません（${detail}）`);
  }
  if (!res.ok) throw new IppError(`プリンタが HTTP ${res.status} を返しました`);
  const decoded = decodeResponse(Buffer.from(await res.arrayBuffer()));
  if (!isOk(decoded.status)) {
    const message = findAttributes(decoded, IPP_GROUP.operation)['status-message']?.[0];
    const name = STATUS_NAMES[decoded.status] ?? `0x${decoded.status.toString(16)}`;
    throw new IppError(
      `プリンタがエラーを返しました: ${name}${typeof message === 'string' && message ? `（${message}）` : ''}`,
      decoded.status,
    );
  }
  return decoded;
}

const operationAttributes = (
  target: PrinterTarget,
  extra: IppAttributeSpec[] = [],
): IppAttributeSpec[] => [
  { name: 'attributes-charset', type: 'charset', value: 'utf-8' },
  { name: 'attributes-natural-language', type: 'naturalLanguage', value: 'en' },
  { name: 'printer-uri', type: 'uri', value: ippUri(target) },
  ...extra,
];

const first = (attrs: Record<string, IppValue[]>, name: string) => attrs[name]?.[0];
const strings = (attrs: Record<string, IppValue[]>, name: string) =>
  (attrs[name] ?? []).filter((v): v is string => typeof v === 'string');
const numbers = (attrs: Record<string, IppValue[]>, name: string) =>
  (attrs[name] ?? []).filter((v): v is number => typeof v === 'number');

// ---------- Get-Printer-Attributes ----------

export interface PrinterInfo {
  name: string | null;
  makeAndModel: string | null;
  uuid: string | null;
  /** 3 = idle, 4 = processing, 5 = stopped */
  state: number | null;
  stateReasons: string[];
  documentFormats: string[];
  mediaSizes: string[];
  mediaTypes: string[];
  mediaSources: string[];
  qualities: number[];
  /** はがき（jpn_hagaki_100x148mm）に対応しているか */
  supportsHagaki: boolean;
  supportsPwgRaster: boolean;
}

const REQUESTED_PRINTER_ATTRIBUTES = [
  'printer-name',
  'printer-make-and-model',
  'printer-uuid',
  'printer-state',
  'printer-state-reasons',
  'document-format-supported',
  'media-supported',
  'media-type-supported',
  'media-source-supported',
  'print-quality-supported',
];

export async function getPrinterInfo(
  target: PrinterTarget,
  opts?: IppClientOptions,
): Promise<PrinterInfo> {
  const res = await ippCall(
    target,
    {
      operation: IPP_OPERATION.GetPrinterAttributes,
      groups: [
        {
          tag: IPP_GROUP.operation,
          attributes: operationAttributes(target, [
            { name: 'requested-attributes', type: 'keyword', value: REQUESTED_PRINTER_ATTRIBUTES },
          ]),
        },
      ],
    },
    opts,
  );
  const a = findAttributes(res, IPP_GROUP.printer);
  const formats = strings(a, 'document-format-supported');
  const sizes = strings(a, 'media-supported');
  const uuid = first(a, 'printer-uuid');
  return {
    name: (first(a, 'printer-name') as string | undefined) ?? null,
    makeAndModel: (first(a, 'printer-make-and-model') as string | undefined) ?? null,
    uuid: typeof uuid === 'string' ? uuid.replace(/^urn:uuid:/, '') : null,
    state: (first(a, 'printer-state') as number | undefined) ?? null,
    stateReasons: strings(a, 'printer-state-reasons'),
    documentFormats: formats,
    mediaSizes: sizes,
    mediaTypes: strings(a, 'media-type-supported'),
    mediaSources: strings(a, 'media-source-supported'),
    qualities: numbers(a, 'print-quality-supported'),
    supportsHagaki: sizes.includes('jpn_hagaki_100x148mm'),
    supportsPwgRaster: formats.includes('image/pwg-raster'),
  };
}

// ---------- Print-Job ----------

export interface PrintJobRequest {
  jobName: string;
  documentFormat: string;
  data: Buffer;
  /** 用紙・品質などのジョブ属性 */
  jobAttributes: IppAttributeSpec[];
}

export interface SubmittedJob {
  jobId: number;
  jobUri: string | null;
  state: number | null;
}

export async function printJob(
  target: PrinterTarget,
  job: PrintJobRequest,
  opts?: IppClientOptions,
): Promise<SubmittedJob> {
  const res = await ippCall(
    target,
    {
      operation: IPP_OPERATION.PrintJob,
      groups: [
        {
          tag: IPP_GROUP.operation,
          attributes: operationAttributes(target, [
            { name: 'requesting-user-name', type: 'name', value: 'photo-sticker-print' },
            { name: 'job-name', type: 'name', value: job.jobName },
            { name: 'document-format', type: 'mimeMediaType', value: job.documentFormat },
          ]),
        },
        { tag: IPP_GROUP.job, attributes: job.jobAttributes },
      ],
      data: job.data,
    },
    { timeoutMs: 120_000, ...opts },
  );
  const a = findAttributes(res, IPP_GROUP.job);
  const jobId = first(a, 'job-id');
  if (typeof jobId !== 'number')
    throw new IppError('プリンタの応答にジョブ番号（job-id）がありません');
  return {
    jobId,
    jobUri: (first(a, 'job-uri') as string | undefined) ?? null,
    state: (first(a, 'job-state') as number | undefined) ?? null,
  };
}

// ---------- Get-Job-Attributes ----------

export interface JobStatus {
  jobId: number;
  /** 3 pending, 4 pending-held, 5 processing, 6 processing-stopped, 7 canceled, 8 aborted, 9 completed */
  state: number | null;
  stateReasons: string[];
  sheetsCompleted: number | null;
  impressionsCompleted: number | null;
  /** プリンタ全体の状態（用紙切れ・インク切れなどの理由を持つ） */
  printerState: number | null;
  printerStateReasons: string[];
}

export async function getJobStatus(
  target: PrinterTarget,
  jobId: number,
  opts?: IppClientOptions,
): Promise<JobStatus> {
  const res = await ippCall(
    target,
    {
      operation: IPP_OPERATION.GetJobAttributes,
      groups: [
        {
          tag: IPP_GROUP.operation,
          attributes: operationAttributes(target, [
            { name: 'job-id', type: 'integer', value: jobId },
            {
              name: 'requested-attributes',
              type: 'keyword',
              value: [
                'job-state',
                'job-state-reasons',
                'job-media-sheets-completed',
                'job-impressions-completed',
              ],
            },
          ]),
        },
      ],
    },
    opts,
  );
  const a = findAttributes(res, IPP_GROUP.job);

  // プリンタの状態（用紙切れなどの理由）も、ジョブの状態と一緒に返す。取れなくても続ける。
  let printerState: number | null = null;
  let printerStateReasons: string[] = [];
  try {
    const info = await getPrinterInfo(target, opts);
    printerState = info.state;
    printerStateReasons = info.stateReasons;
  } catch {
    /* ジョブの状態だけ返す */
  }
  return {
    jobId,
    state: (first(a, 'job-state') as number | undefined) ?? null,
    stateReasons: strings(a, 'job-state-reasons'),
    sheetsCompleted: (first(a, 'job-media-sheets-completed') as number | undefined) ?? null,
    impressionsCompleted: (first(a, 'job-impressions-completed') as number | undefined) ?? null,
    printerState,
    printerStateReasons,
  };
}

export const JOB_STATE = {
  pending: 3,
  pendingHeld: 4,
  processing: 5,
  processingStopped: 6,
  canceled: 7,
  aborted: 8,
  completed: 9,
} as const;

/** これ以降は状態が変わらない */
export const isFinalJobState = (state: number | null) =>
  state === JOB_STATE.canceled || state === JOB_STATE.aborted || state === JOB_STATE.completed;
