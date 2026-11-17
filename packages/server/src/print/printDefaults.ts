import type { Paper } from '../papers/schema.js';

/** 用紙定義の mediaType（抽象的な名前）を、IPP の media-type に対応づける。プリンタごとに違いうるので、画面で選び直せる。 */
const MEDIA_TYPE_TO_IPP: Record<string, string> = {
  plain: 'stationery',
  'photo-gloss': 'photographic',
};

export interface PrintDefaults {
  /** IPP の media-type。決まっていなければ省略（プリンタ任せ） */
  mediaType?: string;
  /** 給紙位置（auto / main / rear）。決まっていなければ省略 */
  mediaSource?: string;
  borderless: boolean;
}

/** 用紙定義の推奨設定から、印刷の既定値を作る */
export function printDefaults(paper: Paper): PrintDefaults {
  const rp = paper.recommendedPrint;
  const mediaType = rp?.mediaType ? MEDIA_TYPE_TO_IPP[rp.mediaType] : undefined;
  return {
    ...(mediaType ? { mediaType } : {}),
    ...(rp?.mediaSource ? { mediaSource: rp.mediaSource } : {}),
    borderless: rp?.borderless ?? false,
  };
}
