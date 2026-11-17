/**
 * IPP の media-type（用紙の種類）の日本語名。
 * 標準の値（PWG 5100.1）は確かな対応。`com.canon-` で始まる Canon 独自の値は、識別子の名前からの
 * 推定で、Canon の製品名との対応は確認していない（だから画面では、元の識別子も並べて出す）。
 */
const LABELS: Record<string, string> = {
  // 標準
  auto: '自動',
  stationery: '普通紙',
  'stationery-inkjet': 'インクジェット用紙',
  'stationery-coated': 'コート紙',
  'stationery-heavyweight': '厚手の普通紙',
  photographic: '写真用紙',
  'photographic-glossy': '写真用紙（光沢）',
  'photographic-high-gloss': '写真用紙（高光沢）',
  'photographic-semi-gloss': '写真用紙（セミ光沢）',
  'photographic-satin': '写真用紙（絹目調）',
  'photographic-matte': '写真用紙（マット）',
  'photographic-film': '写真用フィルム',
  cardstock: '厚紙',
  envelope: '封筒',
  labels: 'ラベル',
  transparency: 'OHP フィルム',
  // Canon 独自（推定）
  'com.canon-mtglossy': '写真用紙 光沢',
  'com.canon-mtluster': '写真用紙 ラスター（絹目調）',
  'com.canon-mtplatinum': '写真用紙 プラチナグレード',
  'com.canon-mtmat': 'マット紙',
  'com.canon-mtsemisuper': '写真用紙 セミ光沢',
  'com.canon-mthires': '高画質専用紙',
  'com.canon-mthagaki': 'はがき',
  'com.canon-mthagakiglossy': '写真はがき 光沢',
  'com.canon-mthagakiglossya': '写真はがき 光沢（別種）',
};

/** 日本語名。知らない値は、そのまま返す。 */
export function mediaTypeLabel(value: string): string {
  return LABELS[value] ?? value;
}

/** 選択肢に出す文字。日本語名がある値は、元の識別子も添える（Canon 独自の値は推定なので確かめられるように） */
export function mediaTypeOptionText(value: string): string {
  const label = LABELS[value];
  return label ? `${label}（${value}）` : value;
}

/** 標準の、どのプリンタにもありそうな値（まだプリンタに接続していないときの選択肢） */
const COMMON = ['auto', 'stationery', 'photographic'];

/**
 * 選択肢の一覧。プリンタが対応する値（接続確認で取れたもの）を使い、取れていなければ標準の値。
 * 用紙の推奨値と、保存済みの上書きの値は、プリンタの一覧になくても必ず入れる（選べなくなるのを防ぐ）。
 */
export function mediaTypeOptions(
  supported: string[] | undefined,
  also: (string | undefined)[],
): { value: string; text: string }[] {
  const values: string[] = [];
  for (const v of [...(supported?.length ? supported : COMMON), ...also]) {
    if (v && !values.includes(v)) values.push(v);
  }
  return values.map((value) => ({ value, text: mediaTypeOptionText(value) }));
}
