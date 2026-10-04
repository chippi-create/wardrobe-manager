// 気温・シーンから、手持ちの服で組み合わせを提案する（ルールベース）。

export const WARMTH = [
  { value: 1, label: '薄手', hint: '暑い日' },
  { value: 2, label: 'ふつう', hint: '過ごしやすい日' },
  { value: 3, label: 'やや厚手', hint: '肌寒い日' },
  { value: 4, label: '防寒', hint: '寒い日' },
];

export const SLEEVES = [
  { value: '', label: '未設定' },
  { value: 'long', label: '長袖' },
  { value: 'short', label: '半袖' },
  { value: 'none', label: '袖なし' },
];

/**
 * 重ね着として不自然な組み合わせか。長袖の服の上に半袖のアウターは合わせない。
 * （ベストのような袖なしのアウターは、長袖の上に重ねてもよい）
 */
export function sleeveConflict(inner, outer) {
  return outer.sleeve === 'short'
    && inner.some((i) => (i.kind === 'tops' || i.kind === 'onepiece') && i.sleeve === 'long');
}

export const OCCASIONS = ['普段着', 'おでかけ', '仕事', '学校', 'フォーマル', 'スポーツ', '部屋着'];

const NEUTRALS = new Set(['白', '黒', 'グレー', 'ベージュ', 'ブラウン', 'ネイビー']);

export function currentSeason(date = new Date()) {
  const m = date.getMonth() + 1;
  if (m >= 3 && m <= 5) return '春';
  if (m >= 6 && m <= 8) return '夏';
  if (m >= 9 && m <= 11) return '秋';
  return '冬';
}

// 気温ごとに、ちょうどよい暖かさとアウターの要否を決める
export function planFor(temp) {
  if (temp >= 26) return { tops: [1], bottoms: [1, 2], outer: 'none', outerWarmth: [] };
  if (temp >= 22) return { tops: [1, 2], bottoms: [1, 2], outer: 'none', outerWarmth: [] };
  if (temp >= 18) return { tops: [2], bottoms: [2], outer: 'optional', outerWarmth: [1, 2] };
  if (temp >= 13) return { tops: [2, 3], bottoms: [2, 3], outer: 'required', outerWarmth: [2, 3] };
  if (temp >= 8) return { tops: [2, 3], bottoms: [2, 3, 4], outer: 'required', outerWarmth: [3, 4] };
  return { tops: [3, 4], bottoms: [3, 4], outer: 'required', outerWarmth: [4] };
}

function daysSince(dateStr, today) {
  return Math.round((new Date(today) - new Date(dateStr)) / 86400000);
}

function lastWorn(item) {
  const dates = item.wornDates || [];
  return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
}

function baseScore(item, ctx, warmths) {
  let score = 0;
  if (warmths) {
    const diff = Math.min(...warmths.map((w) => Math.abs((item.warmth || 2) - w)));
    if (diff === 0) score += 3;
    else if (diff === 1) score -= 1;
    else return null; // 暖かさが合わなすぎる
  }
  if (ctx.occasion) {
    if (item.occasions?.includes(ctx.occasion)) score += 2;
    else if (item.occasions?.length) return null; // 別のシーン専用の服
  }
  if (item.seasons?.length) score += item.seasons.includes(ctx.season) ? 1 : -2;

  const last = lastWorn(item);
  // 最近着ていない服を少し優先して、手持ちをまんべんなく活かす
  score += last ? Math.min(daysSince(last, ctx.today), 30) / 10 : 2;

  if (ctx.rainy && item.kind === 'shoes' && /長靴|レイン/.test(item.mercariLeaf || item.name || '')) score += 3;
  return score;
}

function colorPenalty(item, chosen) {
  const accents = new Set();
  for (const c of chosen.flatMap((i) => i.colors || [])) if (!NEUTRALS.has(c)) accents.add(c);
  let penalty = 0;
  for (const c of item.colors || []) {
    if (!NEUTRALS.has(c) && !accents.has(c)) {
      accents.add(c);
      if (accents.size > 2) penalty += 2;
    }
  }
  return penalty;
}

// スコアの高いものを優先しつつ、毎回同じにならないようにランダムに選ぶ
function pick(candidates, chosen, rand) {
  const scored = candidates
    .map(({ item, score }) => ({ item, score: score - colorPenalty(item, chosen) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  if (!scored.length) return null;
  const weights = scored.map((s) => Math.exp((s.score - scored[0].score) / 1.5));
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < scored.length; i++) {
    r -= weights[i];
    if (r <= 0) return scored[i].item;
  }
  return scored[scored.length - 1].item;
}

function warmthDiff(item, warmths) {
  return warmths ? Math.min(...warmths.map((w) => Math.abs((item.warmth || 2) - w))) : 0;
}

function candidatesFor(pool, kind, ctx, warmths) {
  const list = pool
    .filter((i) => i.kind === kind)
    .map((item) => ({ item, score: baseScore(item, ctx, warmths), diff: warmthDiff(item, warmths) }))
    .filter((c) => c.score != null);
  // ちょうどよい暖かさの服があれば、それだけから選ぶ
  const exact = list.filter((c) => c.diff === 0);
  return exact.length ? exact : list;
}

/**
 * @param items  提案に使う服（持ち主で絞り込み済み）
 * @param opts   { temp, low, occasion, rainy, today, count, rand }
 * @returns      { plan, suggestions: [{ items: [{item, role}], notes }], missing: [] }
 */
export function suggestOutfits(items, opts) {
  const rand = opts.rand || Math.random;
  const ctx = {
    occasion: opts.occasion || '',
    season: currentSeason(new Date(opts.today)),
    today: opts.today,
    rainy: !!opts.rainy,
  };
  const plan = planFor(opts.temp);
  // 朝晩との寒暖差が大きい日は、羽織りを持っていけるようにする
  if (plan.outer === 'none' && opts.low != null && opts.temp - opts.low >= 8) {
    plan.outer = 'optional';
    plan.outerWarmth = planFor(opts.low).outerWarmth.length ? planFor(opts.low).outerWarmth : [1, 2];
    plan.layerNote = '朝晩は冷えそうなので、羽織りがあると安心です';
  }

  const pool = items.filter((i) => (i.status || 'own') === 'own');
  const tops = candidatesFor(pool, 'tops', ctx, plan.tops);
  const bottoms = candidatesFor(pool, 'bottoms', ctx, plan.bottoms);
  const onepieces = candidatesFor(pool, 'onepiece', ctx, plan.tops);
  const outers = candidatesFor(pool, 'outer', ctx, plan.outerWarmth);
  const shoes = candidatesFor(pool, 'shoes', ctx, null);
  const bags = candidatesFor(pool, 'bag', ctx, null);

  const missing = [];
  const canSeparates = tops.length && bottoms.length;
  if (!canSeparates && !onepieces.length) {
    if (!tops.length) missing.push('トップス');
    if (!bottoms.length) missing.push('ボトムス');
  }
  if (plan.outer === 'required' && !outers.length) missing.push('アウター');

  const suggestions = [];
  const seen = new Set();
  let sleeveBlocked = false;
  const count = opts.count || 3;
  for (let attempt = 0; attempt < count * 8 && suggestions.length < count; attempt++) {
    const chosen = [];
    const add = (item, role) => item && chosen.push({ item, role });
    const items = () => chosen.map((c) => c.item);

    const useOnepiece = onepieces.length && (!canSeparates || rand() < onepieces.length / (onepieces.length + tops.length));
    if (useOnepiece) {
      add(pick(onepieces, items(), rand), 'ワンピース');
    } else if (canSeparates) {
      add(pick(tops, items(), rand), 'トップス');
      add(pick(bottoms, items(), rand), 'ボトムス');
    } else {
      break;
    }
    if (plan.outer !== 'none' && outers.length) {
      const inner = items();
      const fitting = outers.filter((c) => !sleeveConflict(inner, c.item));
      if (fitting.length) {
        add(pick(fitting, inner, rand), plan.outer === 'optional' ? '羽織り（お好みで）' : 'アウター');
      } else if (plan.outer === 'required') {
        // 上に合わせられるアウターがないトップスは、寒い日には選ばない
        sleeveBlocked = true;
        continue;
      }
    }
    add(pick(shoes, items(), rand), 'シューズ');
    add(pick(bags, items(), rand), 'バッグ');

    const key = chosen.map((c) => c.item.id).sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);

    const notes = [];
    if (plan.layerNote) notes.push(plan.layerNote);
    if (plan.outer === 'required' && !outers.length) notes.push('アウターを登録すると、寒い日の提案ができます');
    if (ctx.rainy) notes.push('雨の予報です。傘を忘れずに');
    if (ctx.occasion && !chosen.some((c) => c.item.occasions?.includes(ctx.occasion))) {
      notes.push(`「${ctx.occasion}」に登録された服がないので、シーン未設定の服から選んでいます`);
    }
    suggestions.push({ items: chosen, notes });
  }

  if (!suggestions.length && sleeveBlocked) missing.push('長袖の上に羽織れるアウター');
  return { plan, suggestions, missing };
}
