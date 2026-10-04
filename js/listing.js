// メルカリ出品用のタイトルと説明文を作る。

import { categoryPath } from './categories.js';

const TITLE_MAX = 40; // メルカリの商品名の上限

export function listingTitle(item) {
  const parts = [
    item.brand,
    item.name || item.mercariLeaf || item.mercariMid,
    item.colors?.filter((c) => c !== '柄・その他').join('/'),
    item.size,
  ].filter(Boolean);
  return parts.join(' ').slice(0, TITLE_MAX);
}

export function listingDescription(item) {
  const lines = ['ご覧いただきありがとうございます。', ''];
  const row = (label, value) => value && lines.push(`【${label}】${value}`);
  row('ブランド', item.brand);
  row('アイテム', item.mercariLeaf || item.mercariMid);
  row('サイズ', item.size);
  row('カラー', item.colors?.join('・'));
  row('状態', item.condition);
  const worn = item.wornDates?.length || 0;
  if (worn) row('着用回数', `${worn}回程度`);
  if (item.listingNote) lines.push('', item.listingNote);
  lines.push('', 'ご不明な点がありましたら、お気軽にコメントください。');
  if (item.brand) lines.push('', `#${item.brand.replace(/\s+/g, '')}`);
  return lines.join('\n');
}

export function listingCategory(item) {
  return categoryPath(item);
}
