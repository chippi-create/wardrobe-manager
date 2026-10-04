// 入力の手間を減らすための推測。どれも「とりあえずの候補」で、利用者があとで直せる前提。

// ---------- カテゴリ → 暖かさ・季節 ----------

// 上から順に判定する（「半袖」のように強い手がかりを先に）
const CATEGORY_RULES = [
  { re: /半袖|袖なし|キャミソール|タンクトップ|ホルターネック|ベアトップ|ショートパンツ|ハーフパンツ|サンダル|ミュール|麦わら|かごバッグ|水着|浴衣|甚平/, warmth: 1, seasons: ['夏'] },
  { re: /ポロシャツ/, warmth: 1, seasons: ['春', '夏'] },
  { re: /ダウン|毛皮|ファー|ダッフル|ピーコート|チェスター|ロングコート|ニットキャップ|ビーニー|マフラー|手袋|レッグウォーマー/, warmth: 4, seasons: ['冬'] },
  { re: /ニット|セーター|トレーナー|スウェット|パーカー|ブーツ|タイツ|レザー|スタジャン|スカジャン|モッズ|ミリタリー|ブルゾン|ジャンパー|ライダース|フライト|ポンチョ|ストール|スヌード|ショール/, warmth: 3, seasons: ['秋', '冬'] },
  { re: /トレンチ|スプリングコート|ステンカラー|Gジャン|デニムジャケット|テーラード|ノーカラー|ナイロンジャケット|カバーオール|カーディガン|ボレロ|七分|長袖|ジャケット\/上着/, warmth: 2, seasons: ['春', '秋'] },
];

/** カテゴリから暖かさと季節を推測する。手がかりがなければ null。 */
export function guessFromCategory(mid, leaf) {
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(leaf || '')) return { warmth: rule.warmth, seasons: [...rule.seasons] };
  }
  // 小カテゴリで決まらないときは中カテゴリで判断する
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(mid || '')) return { warmth: rule.warmth, seasons: [...rule.seasons] };
  }
  return null;
}

// ---------- 写真 → 色 ----------

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/** 1ピクセルの色を、アプリの色の名前に分類する */
export function classifyColor(r, g, b) {
  const { h, s, l } = rgbToHsl(r, g, b);
  if (l >= 0.88) return '白';
  if (l <= 0.16) return '黒';
  if (s < 0.15) return l > 0.75 ? '白' : l < 0.25 ? '黒' : 'グレー';
  if (h >= 200 && h < 255 && l < 0.32) return 'ネイビー';
  if (h >= 15 && h < 50) {
    if (l < 0.4) return 'ブラウン';
    if (s < 0.55 && l > 0.55) return 'ベージュ';
    return h < 38 ? 'オレンジ' : '黄';
  }
  if (h >= 340 || h < 15) {
    if (l > 0.68) return 'ピンク';
    if (l < 0.3 && s < 0.5) return 'ブラウン';
    return '赤';
  }
  if (h < 70) return '黄';
  if (h < 170) return '緑';
  if (h < 255) return '青';
  if (h < 300) return '紫';
  return 'ピンク';
}

/**
 * 写真の中央部分でいちばん多い色を返す（背景が写り込みにくいよう中央だけ見る）。
 * 2番目の色も十分に多ければ一緒に返す。判断できなければ空配列。
 */
export async function detectColors(blob) {
  const bitmap = await loadBitmap(blob);
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = bitmap.width;
  const h = bitmap.height;
  // 中央 50% の範囲を縮小して読む
  ctx.drawImage(bitmap, w * 0.25, h * 0.25, w * 0.5, h * 0.5, 0, 0, size, size);
  bitmap.close?.();
  const { data } = ctx.getImageData(0, 0, size, size);

  const votes = new Map();
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const name = classifyColor(data[i], data[i + 1], data[i + 2]);
    votes.set(name, (votes.get(name) || 0) + 1);
    total++;
  }
  if (!total) return [];
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const result = [];
  if (ranked[0][1] / total >= 0.3) result.push(ranked[0][0]);
  if (result.length && ranked[1] && ranked[1][1] / total >= 0.3) result.push(ranked[1][0]);
  return result;
}

async function loadBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob); } catch { /* 下の方法で読む */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}
