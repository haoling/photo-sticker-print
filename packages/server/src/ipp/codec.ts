/**
 * IPP（RFC 8010）のエンコードとデコード。使う操作（Print-Job / Get-Printer-Attributes /
 * Get-Job-Attributes）に必要な範囲を、依存なしで実装している。
 */

export const IPP_OPERATION = {
  PrintJob: 0x0002,
  CancelJob: 0x0008,
  GetJobAttributes: 0x0009,
  GetPrinterAttributes: 0x000b,
} as const;

export const IPP_GROUP = {
  operation: 0x01,
  job: 0x02,
  printer: 0x04,
  unsupported: 0x05,
} as const;

const TAG = {
  endOfAttributes: 0x03,
  integer: 0x21,
  boolean: 0x22,
  enum: 0x23,
  octetString: 0x30,
  dateTime: 0x31,
  resolution: 0x32,
  rangeOfInteger: 0x33,
  begCollection: 0x34,
  textWithLanguage: 0x35,
  nameWithLanguage: 0x36,
  endCollection: 0x37,
  text: 0x41,
  name: 0x42,
  keyword: 0x44,
  uri: 0x45,
  uriScheme: 0x46,
  charset: 0x47,
  naturalLanguage: 0x48,
  mimeMediaType: 0x49,
  memberAttrName: 0x4a,
} as const;

// ---------- 値の型 ----------

export interface IppResolution {
  cross: number;
  feed: number;
  /** 3 = dpi, 4 = dpcm */
  units: number;
}
export interface IppRange {
  lower: number;
  upper: number;
}
export interface IppCollection {
  [member: string]: IppValue[];
}
/** null は out-of-band の値（unsupported / unknown / no-value など） */
export type IppValue =
  string | number | boolean | Buffer | Date | IppResolution | IppRange | IppCollection | null;

// ---------- 送信する属性の指定 ----------

type StringType =
  | 'keyword'
  | 'uri'
  | 'uriScheme'
  | 'charset'
  | 'naturalLanguage'
  | 'mimeMediaType'
  | 'name'
  | 'text';

export type IppAttributeSpec =
  | { name: string; type: 'integer' | 'enum'; value: number | number[] }
  | { name: string; type: 'boolean'; value: boolean }
  | { name: string; type: StringType; value: string | string[] }
  | { name: string; type: 'resolution'; value: { cross: number; feed: number; units?: number } }
  | { name: string; type: 'collection'; value: IppAttributeSpec[] };

export interface IppGroupSpec {
  tag: number;
  attributes: IppAttributeSpec[];
}

export interface IppRequest {
  /** [major, minor]。既定 2.0 */
  version?: [number, number];
  operation: number;
  requestId: number;
  groups: IppGroupSpec[];
  /** Print-Job などで続けて送る文書データ */
  data?: Buffer;
}

// ---------- エンコード ----------

const STRING_TAGS: Record<StringType, number> = {
  keyword: TAG.keyword,
  uri: TAG.uri,
  uriScheme: TAG.uriScheme,
  charset: TAG.charset,
  naturalLanguage: TAG.naturalLanguage,
  mimeMediaType: TAG.mimeMediaType,
  name: TAG.name,
  text: TAG.text,
};

class Writer {
  private chunks: Buffer[] = [];
  byte(v: number) {
    this.chunks.push(Buffer.from([v & 0xff]));
  }
  u16(v: number) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(v);
    this.chunks.push(b);
  }
  i32(v: number) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(v);
    this.chunks.push(b);
  }
  raw(b: Buffer) {
    this.chunks.push(b);
  }
  /** 値の種類（タグ）・属性名（空なら追加の値）・値のバイト列 */
  entry(tag: number, name: string, value: Buffer) {
    const nameBytes = Buffer.from(name, 'utf8');
    this.byte(tag);
    this.u16(nameBytes.length);
    this.raw(nameBytes);
    this.u16(value.length);
    this.raw(value);
  }
  toBuffer() {
    return Buffer.concat(this.chunks);
  }
}

const int32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(v);
  return b;
};

function writeValues(w: Writer, name: string, spec: IppAttributeSpec) {
  switch (spec.type) {
    case 'integer':
    case 'enum': {
      const tag = spec.type === 'integer' ? TAG.integer : TAG.enum;
      const values = Array.isArray(spec.value) ? spec.value : [spec.value];
      values.forEach((v, i) => w.entry(tag, i === 0 ? name : '', int32(v)));
      return;
    }
    case 'boolean':
      w.entry(TAG.boolean, name, Buffer.from([spec.value ? 1 : 0]));
      return;
    case 'resolution': {
      const b = Buffer.alloc(9);
      b.writeInt32BE(spec.value.cross, 0);
      b.writeInt32BE(spec.value.feed, 4);
      b.writeInt8(spec.value.units ?? 3, 8);
      w.entry(TAG.resolution, name, b);
      return;
    }
    case 'collection': {
      w.entry(TAG.begCollection, name, Buffer.alloc(0));
      for (const member of spec.value) {
        w.entry(TAG.memberAttrName, '', Buffer.from(member.name, 'utf8'));
        writeMemberValues(w, member);
      }
      w.entry(TAG.endCollection, '', Buffer.alloc(0));
      return;
    }
    default: {
      const tag = STRING_TAGS[spec.type];
      const values = Array.isArray(spec.value) ? spec.value : [spec.value];
      values.forEach((v, i) => w.entry(tag, i === 0 ? name : '', Buffer.from(v, 'utf8')));
    }
  }
}

/** コレクションの中身（メンバー）の値は、名前の長さを 0 にして書く */
function writeMemberValues(w: Writer, spec: IppAttributeSpec) {
  const inner = new Writer();
  writeValues(inner, '', spec);
  w.raw(inner.toBuffer());
}

export function encodeRequest(req: IppRequest): Buffer {
  const w = new Writer();
  const [major, minor] = req.version ?? [2, 0];
  w.byte(major);
  w.byte(minor);
  w.u16(req.operation);
  w.i32(req.requestId);
  for (const group of req.groups) {
    w.byte(group.tag);
    for (const attr of group.attributes) writeValues(w, attr.name, attr);
  }
  w.byte(TAG.endOfAttributes);
  if (req.data) w.raw(req.data);
  return w.toBuffer();
}

// ---------- デコード ----------

export interface IppGroup {
  tag: number;
  attributes: Record<string, IppValue[]>;
}

export interface IppResponse {
  version: [number, number];
  /** ステータスコード。0x0000〜0x00ff は成功 */
  status: number;
  requestId: number;
  groups: IppGroup[];
  data: Buffer;
}

export class IppParseError extends Error {
  constructor(message: string) {
    super(`IPP の応答を読めません: ${message}`);
    this.name = 'IppParseError';
  }
}

class Reader {
  constructor(
    private buf: Buffer,
    public pos = 0,
  ) {}
  private need(n: number) {
    if (this.pos + n > this.buf.length) throw new IppParseError('データが途中で終わっています');
  }
  byte() {
    this.need(1);
    return this.buf[this.pos++]!;
  }
  u16() {
    this.need(2);
    const v = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  i32() {
    this.need(4);
    const v = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  bytes(n: number) {
    this.need(n);
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  rest() {
    return this.buf.subarray(this.pos);
  }
}

function decodeValue(tag: number, v: Buffer): IppValue {
  switch (tag) {
    case TAG.integer:
    case TAG.enum:
      return v.length === 4 ? v.readInt32BE(0) : null;
    case TAG.boolean:
      return v[0] !== 0;
    case TAG.octetString:
      return Buffer.from(v);
    case TAG.dateTime:
      return v.length === 11
        ? new Date(Date.UTC(v.readUInt16BE(0), v[2]! - 1, v[3]!, v[4]!, v[5]!, v[6]!, v[7]! * 100))
        : null;
    case TAG.resolution:
      return v.length === 9
        ? { cross: v.readInt32BE(0), feed: v.readInt32BE(4), units: v.readInt8(8) }
        : null;
    case TAG.rangeOfInteger:
      return v.length === 8 ? { lower: v.readInt32BE(0), upper: v.readInt32BE(4) } : null;
    case TAG.textWithLanguage:
    case TAG.nameWithLanguage: {
      // 言語（長さつき）のあとに、テキスト（長さつき）
      const langLen = v.readUInt16BE(0);
      const textLen = v.readUInt16BE(2 + langLen);
      return v.subarray(4 + langLen, 4 + langLen + textLen).toString('utf8');
    }
    case TAG.text:
    case TAG.name:
    case TAG.keyword:
    case TAG.uri:
    case TAG.uriScheme:
    case TAG.charset:
    case TAG.naturalLanguage:
    case TAG.mimeMediaType:
      return v.toString('utf8');
    default:
      // 0x10〜0x13 などの out-of-band と、知らない型
      return null;
  }
}

/** begCollection の「値の長さ」を読んだ直後から、endCollection まで読む */
function readCollection(r: Reader): IppCollection {
  const out: IppCollection = {};
  let member: string | null = null;
  for (;;) {
    const tag = r.byte();
    const nameLen = r.u16();
    r.bytes(nameLen);
    const valueLen = r.u16();
    const value = r.bytes(valueLen);
    if (tag === TAG.endCollection) return out;
    if (tag === TAG.memberAttrName) {
      member = value.toString('utf8');
      out[member] ??= [];
      continue;
    }
    if (member === null) throw new IppParseError('コレクションのメンバー名がありません');
    out[member]!.push(tag === TAG.begCollection ? readCollection(r) : decodeValue(tag, value));
  }
}

export function decodeResponse(buf: Buffer): IppResponse {
  const r = new Reader(buf);
  const version: [number, number] = [r.byte(), r.byte()];
  const status = r.u16();
  const requestId = r.i32();
  const groups: IppGroup[] = [];
  let group: IppGroup | null = null;
  let lastName: string | null = null;

  for (;;) {
    const tag = r.byte();
    if (tag === TAG.endOfAttributes) break;
    if (tag <= 0x0f && tag !== 0) {
      // 0x01〜0x0f: グループの始まり（0x10 以上が値のタグ）
      group = { tag, attributes: {} };
      groups.push(group);
      lastName = null;
      continue;
    }
    if (!group) throw new IppParseError('属性グループの前に属性があります');
    const nameLen = r.u16();
    const name = r.bytes(nameLen).toString('utf8');
    const valueLen = r.u16();
    const raw = r.bytes(valueLen);
    const value = tag === TAG.begCollection ? readCollection(r) : decodeValue(tag, raw);
    if (nameLen > 0) {
      lastName = name;
      group.attributes[name] = [value];
    } else if (lastName !== null) {
      group.attributes[lastName]!.push(value); // 同じ属性の追加の値
    } else {
      throw new IppParseError('属性名のない値があります');
    }
  }
  return { version, status, requestId, groups, data: Buffer.from(r.rest()) };
}

/** 指定したグループの属性を、最初に見つかったものから取り出す */
export function findAttributes(res: IppResponse, groupTag: number): Record<string, IppValue[]> {
  return res.groups.find((g) => g.tag === groupTag)?.attributes ?? {};
}

export const isOk = (status: number) => status < 0x0100;
