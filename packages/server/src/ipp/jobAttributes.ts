import type { IppAttributeSpec } from './codec.js';

export interface JobOptions {
  /** 用紙の大きさ（mm） */
  paperWidthMm: number;
  paperHeightMm: number;
  /** IPP の media-type（プリンタの media-type-supported にある値）。省略するとプリンタ任せ */
  mediaType?: string;
  /** 給紙位置（auto / main / rear など）。省略するとプリンタ任せ */
  mediaSource?: string;
  /** true のとき、media-col の上下左右の余白を 0 にしてフチなし印刷を求める */
  borderless: boolean;
  /** 3 = draft, 4 = normal, 5 = high */
  quality: number;
  copies: number;
  dpi: number;
}

/** 用紙の大きさを、PWG の命名（jpn_hagaki_100x148mm のような）に近い形で求める */
export const mediaSizeName = (w: number, h: number) =>
  w === 100 && h === 148 ? 'jpn_hagaki_100x148mm' : `custom_${w}x${h}mm`;

/**
 * Print-Job に付けるジョブ属性。用紙サイズ・用紙の種類・給紙位置・フチあり／なしを
 * media-col で指定するので、ユーザーがプリンタの設定画面で選ぶ必要がない。
 */
export function buildJobAttributes(o: JobOptions): IppAttributeSpec[] {
  const mediaCol: IppAttributeSpec[] = [
    {
      name: 'media-size',
      type: 'collection',
      value: [
        { name: 'x-dimension', type: 'integer', value: Math.round(o.paperWidthMm * 100) },
        { name: 'y-dimension', type: 'integer', value: Math.round(o.paperHeightMm * 100) },
      ],
    },
  ];
  if (o.mediaType) mediaCol.push({ name: 'media-type', type: 'keyword', value: o.mediaType });
  if (o.mediaSource) mediaCol.push({ name: 'media-source', type: 'keyword', value: o.mediaSource });
  if (o.borderless) {
    for (const side of ['bottom', 'left', 'right', 'top']) {
      mediaCol.push({ name: `media-${side}-margin`, type: 'integer', value: 0 });
    }
  }
  return [
    { name: 'copies', type: 'integer', value: o.copies },
    { name: 'orientation-requested', type: 'enum', value: 3 }, // portrait
    { name: 'media-col', type: 'collection', value: mediaCol },
    { name: 'print-quality', type: 'enum', value: o.quality },
    {
      name: 'printer-resolution',
      type: 'resolution',
      value: { cross: o.dpi, feed: o.dpi, units: 3 },
    },
    { name: 'print-color-mode', type: 'keyword', value: 'color' },
  ];
}
