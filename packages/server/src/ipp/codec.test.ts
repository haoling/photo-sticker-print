import { describe, expect, it } from 'vitest';
import {
  decodeResponse,
  encodeRequest,
  findAttributes,
  IPP_GROUP,
  IPP_OPERATION,
  IppParseError,
  isOk,
} from './codec.js';

const hex = (b: Buffer) => b.toString('hex');
const ascii = (s: string) => Buffer.from(s, 'utf8').toString('hex');

describe('encodeRequest', () => {
  it('RFC 8010 のとおりのバイト列になる（Get-Printer-Attributes の最小形）', () => {
    const bytes = encodeRequest({
      operation: IPP_OPERATION.GetPrinterAttributes,
      requestId: 1,
      groups: [
        {
          tag: IPP_GROUP.operation,
          attributes: [
            { name: 'attributes-charset', type: 'charset', value: 'utf-8' },
            { name: 'attributes-natural-language', type: 'naturalLanguage', value: 'en' },
          ],
        },
      ],
    });
    const expected =
      '0200' + // バージョン 2.0
      '000b' + // Get-Printer-Attributes
      '00000001' + // request-id
      '01' + // operation-attributes-tag
      '47' +
      '0012' +
      ascii('attributes-charset') +
      '0005' +
      ascii('utf-8') +
      '48' +
      '001b' +
      ascii('attributes-natural-language') +
      '0002' +
      ascii('en') +
      '03'; // end-of-attributes-tag
    expect(hex(bytes)).toBe(expected);
  });

  it('複数の値は、2 つ目以降の名前の長さを 0 にする', () => {
    const bytes = encodeRequest({
      operation: 2,
      requestId: 7,
      groups: [
        {
          tag: IPP_GROUP.operation,
          attributes: [{ name: 'x', type: 'keyword', value: ['a', 'b'] }],
        },
      ],
    });
    expect(hex(bytes.subarray(8))).toBe(
      '01' + '44' + '0001' + '78' + '0001' + '61' + '44' + '0000' + '0001' + '62' + '03',
    );
  });

  it('文書データは end-of-attributes の直後に続く', () => {
    const bytes = encodeRequest({
      operation: 2,
      requestId: 1,
      groups: [],
      data: Buffer.from('DOC'),
    });
    expect(hex(bytes.subarray(-4))).toBe('03' + ascii('DOC'));
  });
});

describe('エンコードとデコードの往復', () => {
  it('コレクション（入れ子）・複数の値・解像度・真偽・整数・列挙を戻せる', () => {
    const bytes = encodeRequest({
      operation: 0,
      requestId: 5,
      groups: [
        {
          tag: IPP_GROUP.job,
          attributes: [
            { name: 'copies', type: 'integer', value: 2 },
            { name: 'print-quality', type: 'enum', value: [4, 5] },
            { name: 'flag', type: 'boolean', value: true },
            {
              name: 'printer-resolution',
              type: 'resolution',
              value: { cross: 600, feed: 600, units: 3 },
            },
            {
              name: 'media-col',
              type: 'collection',
              value: [
                {
                  name: 'media-size',
                  type: 'collection',
                  value: [
                    { name: 'x-dimension', type: 'integer', value: 10000 },
                    { name: 'y-dimension', type: 'integer', value: 14800 },
                  ],
                },
                { name: 'media-type', type: 'keyword', value: 'stationery' },
                { name: 'media-top-margin', type: 'integer', value: 0 },
              ],
            },
            { name: 'job-name', type: 'name', value: '写真シール' },
          ],
        },
      ],
    });
    const res = decodeResponse(bytes);
    expect(res.status).toBe(0);
    expect(res.requestId).toBe(5);
    const a = findAttributes(res, IPP_GROUP.job);
    expect(a['copies']).toEqual([2]);
    expect(a['print-quality']).toEqual([4, 5]);
    expect(a['flag']).toEqual([true]);
    expect(a['printer-resolution']).toEqual([{ cross: 600, feed: 600, units: 3 }]);
    expect(a['job-name']).toEqual(['写真シール']);
    expect(a['media-col']).toEqual([
      {
        'media-size': [{ 'x-dimension': [10000], 'y-dimension': [14800] }],
        'media-type': ['stationery'],
        'media-top-margin': [0],
      },
    ]);
  });

  it('文書データを data に分けて返す', () => {
    const bytes = encodeRequest({
      operation: 2,
      requestId: 1,
      groups: [],
      data: Buffer.from([1, 2, 3, 4]),
    });
    expect(decodeResponse(bytes).data).toEqual(Buffer.from([1, 2, 3, 4]));
  });
});

describe('decodeResponse', () => {
  it('言語つきのテキスト・out-of-band の値・日時・範囲を読める', () => {
    const u16 = (n: number) => n.toString(16).padStart(4, '0');
    const bytes = Buffer.from(
      '0200' +
        '0000' +
        '00000009' +
        '04' +
        // textWithLanguage "msg" (言語 "en")
        '35' +
        u16(3) +
        ascii('msg') +
        u16(2 + 2 + 2 + 2) +
        u16(2) +
        ascii('en') +
        u16(2) +
        ascii('hi') +
        // no-value (0x13)
        '13' +
        u16(2) +
        ascii('nv') +
        u16(0) +
        // rangeOfInteger
        '33' +
        u16(1) +
        ascii('r') +
        u16(8) +
        '00000001' +
        '00000009' +
        // dateTime 2026-11-16T12:34:56.7
        '31' +
        u16(1) +
        ascii('d') +
        u16(11) +
        '07ea' +
        '0b' +
        '10' +
        '0c' +
        '22' +
        '38' +
        '07' +
        '2b' +
        '00' +
        '00' +
        '03',
      'hex',
    );
    const a = findAttributes(decodeResponse(bytes), IPP_GROUP.printer);
    expect(a['msg']).toEqual(['hi']);
    expect(a['nv']).toEqual([null]);
    expect(a['r']).toEqual([{ lower: 1, upper: 9 }]);
    expect((a['d']![0] as Date).toISOString()).toBe('2026-11-16T12:34:56.700Z');
  });

  it('途中で終わっているデータは IppParseError', () => {
    const bytes = encodeRequest({
      operation: 0,
      requestId: 1,
      groups: [{ tag: 1, attributes: [{ name: 'a', type: 'keyword', value: 'bbbbbb' }] }],
    });
    expect(() => decodeResponse(bytes.subarray(0, bytes.length - 6))).toThrow(IppParseError);
  });

  it('ステータスコードは 0x00ff 以下が成功', () => {
    expect(isOk(0)).toBe(true);
    expect(isOk(1)).toBe(true);
    expect(isOk(0x0400)).toBe(false);
  });
});
