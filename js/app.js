import * as db from './db.js';
import { compressImage, blobToDataURL, dataURLToBlob } from './image.js';
import { MERCARI, TOPS, KINDS, KIND_KEYS, CONDITIONS, kindOf, categoryPath, fromLegacyCategory } from './categories.js';
import { WARMTH, OCCASIONS, suggestOutfits } from './suggest.js';
import { getPosition, fetchWeather, weatherLabel } from './weather.js';
import { listingTitle, listingDescription } from './listing.js';
import { guessFromCategory, detectColors } from './autofill.js';

// ---------- 定数 ----------

const COLORS = [
  { name: '白', hex: '#ffffff' },
  { name: '黒', hex: '#222222' },
  { name: 'グレー', hex: '#9a9a9a' },
  { name: 'ベージュ', hex: '#d9c4a3' },
  { name: 'ブラウン', hex: '#7b5233' },
  { name: '赤', hex: '#d0352b' },
  { name: 'ピンク', hex: '#f2a0b8' },
  { name: 'オレンジ', hex: '#ef8a2e' },
  { name: '黄', hex: '#f2d03b' },
  { name: '緑', hex: '#4f9a5a' },
  { name: '青', hex: '#4d8fd6' },
  { name: 'ネイビー', hex: '#24345c' },
  { name: '紫', hex: '#8a5cb8' },
  { name: '柄・その他', hex: 'conic-gradient(#d0352b, #f2d03b, #4f9a5a, #4d8fd6, #8a5cb8, #d0352b)' },
];

const SEASONS = ['春', '夏', '秋', '冬'];
const STATUS_LABELS = { own: '所持中', selling: '出品中', sold: '売却済み' };

// 端末ごとの設定（消えても困らないものだけ localStorage に置く）
const KEYS = {
  lastBackup: 'wardrobe:lastBackup',
  member: 'wardrobe:member',
  location: 'wardrobe:location',
};

// ---------- 状態 ----------

const state = {
  view: 'closet',
  members: [],
  memberId: null,
  items: [],
  outfits: [],
  filter: { q: '', kind: '', color: '', season: '', status: 'active', sort: 'new' },
  suggest: { temp: 20, low: null, rainy: false, occasion: '普段着', weather: null, results: null },
};

const photoURLs = new Map(); // item.id -> object URL

// ---------- ユーティリティ ----------

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child != null && child !== false) node.append(child);
  }
  return node;
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function lastWorn(entity) {
  const dates = entity.wornDates || [];
  return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
}

function describeWear(entity) {
  const count = (entity.wornDates || []).length;
  if (!count) return '未着用';
  const last = lastWorn(entity);
  const days = Math.round((new Date(today()) - new Date(last)) / 86400000);
  const when = days === 0 ? '今日' : days === 1 ? '昨日' : `${days}日前`;
  return `${count}回 · ${when}`;
}

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 保存できなくても動作に影響しない */ }
}

function swatch(colorName) {
  const color = COLORS.find((c) => c.name === colorName);
  return el('span', { class: 'swatch', style: `background:${color ? color.hex : '#ccc'}` });
}

function photoURL(item) {
  if (!item.photo) return null;
  if (!photoURLs.has(item.id)) photoURLs.set(item.id, URL.createObjectURL(item.photo));
  return photoURLs.get(item.id);
}

function forgetPhoto(id) {
  const url = photoURLs.get(id);
  if (url) URL.revokeObjectURL(url);
  photoURLs.delete(id);
}

function itemLabel(item) {
  if (item.draft && !item.name) return '未入力の服';
  return item.name || item.mercariLeaf || KINDS[item.kind] || '服';
}

function thumb(item) {
  const url = item && photoURL(item);
  return el('div', { class: 'thumb' }, url
    ? el('img', { src: url, alt: '', loading: 'lazy' })
    : el('span', { text: item ? KINDS[item.kind] : '' }));
}

let toastTimer;
function toast(message) {
  const node = $('#toast');
  // ダイアログが開いているときは、その上に表示されるようにダイアログの中へ移す
  const openDialogs = [...document.querySelectorAll('dialog[open]')];
  (openDialogs.at(-1) || document.body).append(node);
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
}

function chip(label, { pressed, role, onclick, prefix } = {}) {
  const attrs = { type: 'button', class: 'chip', onclick };
  if (role === 'radio') {
    attrs.role = 'radio';
    attrs['aria-checked'] = String(!!pressed);
  } else {
    attrs['aria-pressed'] = String(!!pressed);
  }
  return el('button', attrs, [prefix, label]);
}

function segmented(container, options, selected, onSelect) {
  container.replaceChildren(...options.map((opt) => el('button', {
    type: 'button',
    role: 'radio',
    'aria-checked': String(opt.value === selected),
    onclick: () => onSelect(opt.value),
  }, [opt.label, opt.hint ? el('small', { text: opt.hint }) : null])));
}

function currentMember() {
  return state.members.find((m) => m.id === state.memberId) || state.members[0];
}

function memberItems() {
  return state.items.filter((i) => i.memberId === state.memberId);
}

function memberOutfits() {
  return state.outfits.filter((o) => o.memberId === state.memberId);
}

// ---------- 正規化（古いデータ・読み込んだデータを今の形にそろえる） ----------

const strArr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

function normalizeMember(raw) {
  return {
    id: String(raw.id || uid()),
    name: String(raw.name || 'メンバー').slice(0, 20),
    top: TOPS.includes(raw.top) ? raw.top : 'レディース',
    createdAt: Number(raw.createdAt) || Date.now(),
  };
}

function normalizeItem(raw, fallbackMember) {
  const member = state.members.find((m) => m.id === raw.memberId) || fallbackMember;
  let { kind, mercariTop, mercariMid, mercariLeaf } = raw;
  if (!TOPS.includes(mercariTop)) mercariTop = member.top;
  if (!MERCARI[mercariTop][mercariMid]) mercariMid = '';
  if (!mercariMid || !MERCARI[mercariTop][mercariMid].leaves.includes(mercariLeaf)) mercariLeaf = '';
  if (!KIND_KEYS.includes(kind)) {
    // バージョン1のデータ（カテゴリ8種類）から引き継ぐ
    const legacy = fromLegacyCategory(raw.category, mercariTop);
    kind = legacy.kind;
    if (!mercariMid) mercariMid = legacy.mercariMid;
  }
  const warmth = Number(raw.warmth);
  return {
    id: String(raw.id || uid()),
    memberId: member.id,
    name: String(raw.name || ''),
    kind,
    mercariTop,
    mercariMid,
    mercariLeaf,
    colors: strArr(raw.colors),
    seasons: strArr(raw.seasons),
    warmth: warmth >= 1 && warmth <= 4 ? warmth : 2,
    occasions: strArr(raw.occasions).filter((o) => OCCASIONS.includes(o)),
    brand: String(raw.brand || ''),
    size: String(raw.size || ''),
    price: String(raw.price || ''),
    condition: CONDITIONS.includes(raw.condition) ? raw.condition : '',
    status: STATUS_LABELS[raw.status] ? raw.status : 'own',
    draft: !!raw.draft,
    memo: String(raw.memo || ''),
    listingNote: String(raw.listingNote || ''),
    photo: raw.photo instanceof Blob ? raw.photo : null,
    wornDates: strArr(raw.wornDates),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

function normalizeOutfit(raw, fallbackMember) {
  const member = state.members.find((m) => m.id === raw.memberId) || fallbackMember;
  return {
    id: String(raw.id || uid()),
    memberId: member.id,
    name: String(raw.name || ''),
    itemIds: strArr(raw.itemIds),
    memo: String(raw.memo || ''),
    wornDates: strArr(raw.wornDates),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

// ---------- 描画：ヘッダー ----------

function renderMemberSwitch() {
  const select = $('#memberSelect');
  select.replaceChildren(...state.members.map((m) => el('option', { value: m.id, text: m.name })));
  select.value = state.memberId;
  $('#memberSwitch').hidden = state.members.length < 2 || state.view === 'settings';
}

function updateHeader() {
  const section = $(`#view-${state.view}`);
  $('#viewTitle').textContent = section.dataset.title;
  const count = state.view === 'closet'
    ? `${memberItems().filter((i) => i.status !== 'sold').length}着`
    : state.view === 'outfits' ? `${memberOutfits().length}件` : '';
  $('#viewCount').textContent = count;
  renderMemberSwitch();
}

// ---------- 描画：クローゼット ----------

function filteredItems() {
  const { q, kind, color, season, status, sort } = state.filter;
  const query = q.trim().toLowerCase();
  const list = memberItems().filter((item) => {
    if (status === 'active' && item.status === 'sold') return false;
    if (!['active', 'all'].includes(status) && item.status !== status) return false;
    if (kind === 'draft') { if (!item.draft) return false; } else if (kind && item.kind !== kind) return false;
    if (color && !item.colors.includes(color)) return false;
    if (season && !item.seasons.includes(season)) return false;
    if (query && !`${item.name} ${item.brand} ${item.memo} ${item.mercariLeaf}`.toLowerCase().includes(query)) return false;
    return true;
  });

  const count = (i) => i.wornDates.length;
  if (sort === 'most') {
    list.sort((a, b) => count(b) - count(a) || b.createdAt - a.createdAt);
  } else if (sort === 'least') {
    // 一度も着ていない服 → 最後に着た日が古い順
    list.sort((a, b) => (lastWorn(a) || '').localeCompare(lastWorn(b) || '') || a.createdAt - b.createdAt);
  } else {
    list.sort((a, b) => b.createdAt - a.createdAt);
  }
  return list;
}

function renderKindFilter() {
  const counts = {};
  const items = memberItems().filter((i) => i.status !== 'sold');
  for (const item of items) if (!item.draft) counts[item.kind] = (counts[item.kind] || 0) + 1;
  const drafts = items.filter((i) => i.draft).length;
  if (state.filter.kind === 'draft' && !drafts) state.filter.kind = '';
  $('#kindFilter').replaceChildren(
    chip(`すべて ${items.length}`, {
      pressed: !state.filter.kind,
      onclick: () => { state.filter.kind = ''; renderCloset(); },
    }),
    ...(drafts ? [chip(`未入力 ${drafts}`, {
      pressed: state.filter.kind === 'draft',
      onclick: () => { state.filter.kind = state.filter.kind === 'draft' ? '' : 'draft'; renderCloset(); },
    })] : []),
    ...KIND_KEYS.filter((k) => counts[k]).map((k) => chip(`${KINDS[k]} ${counts[k]}`, {
      pressed: state.filter.kind === k,
      onclick: () => { state.filter.kind = state.filter.kind === k ? '' : k; renderCloset(); },
    })),
  );
}

function itemCard(item) {
  return el('button', {
    type: 'button',
    class: `item-card${item.status === 'sold' ? ' is-sold' : ''}`,
    onclick: () => openItemDialog(item),
  }, [
    thumb(item),
    item.draft
      ? el('span', { class: 'badge draft', text: '未入力' })
      : item.status !== 'own' ? el('span', { class: `badge ${item.status}`, text: STATUS_LABELS[item.status] }) : null,
    el('div', { class: 'meta' }, [
      el('div', { class: 'name', text: itemLabel(item) }),
      el('div', { class: 'sub', text: [item.brand, describeWear(item)].filter(Boolean).join(' · ') }),
      item.colors.length ? el('div', { class: 'dots' }, item.colors.map(swatch)) : null,
    ]),
  ]);
}

function renderCloset() {
  renderKindFilter();
  const items = filteredItems();
  $('#itemGrid').replaceChildren(...items.map(itemCard));

  const empty = $('#itemEmpty');
  if (!memberItems().length) {
    empty.textContent = `${currentMember().name}さんの服はまだ登録されていません。\n右下の ＋ から最初の1着を登録しましょう。`;
    empty.hidden = false;
  } else if (!items.length) {
    empty.textContent = '条件に合う服がありません。';
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }
  updateHeader();
}

// ---------- 描画：コーデ提案 ----------

function renderSuggestControls() {
  const s = state.suggest;
  $('#tempRange').value = s.temp;
  $('#tempValue').textContent = `${s.temp}℃`;
  $('#occasionPicker').replaceChildren(...OCCASIONS.map((o) => chip(o, {
    role: 'radio',
    pressed: s.occasion === o,
    onclick: () => { s.occasion = o; renderSuggestControls(); runSuggest(); },
  })));
  if (s.weather) {
    const w = s.weather;
    $('#weatherText').textContent = `今日は${weatherLabel(w.code)} · 最高${Math.round(w.max)}℃`;
    $('#weatherSub').textContent = `最低${Math.round(w.min)}℃ · 降水確率${w.rain ?? '-'}% · 現在${Math.round(w.current)}℃`;
  }
}

function runSuggest() {
  const s = state.suggest;
  s.results = suggestOutfits(memberItems(), {
    temp: s.temp,
    low: s.low,
    rainy: s.rainy,
    occasion: s.occasion,
    today: today(),
    count: 3,
  });
  renderSuggestResults();
}

function renderSuggestResults() {
  const box = $('#suggestResults');
  const r = state.suggest.results;
  if (!r) {
    box.replaceChildren();
    return;
  }
  const cards = [];
  if (!r.suggestions.length) {
    const what = r.missing.length ? r.missing.join('・') : 'この条件に合う服';
    cards.push(el('div', { class: 'card' }, [
      el('p', { text: `${what}が見つからないため、提案できませんでした。` }),
      el('p', { class: 'muted small', text: '服の「暖かさ」や「シーン」を登録すると、提案に使えるようになります。シーンを変えたり、気温を調整したりもしてみてください。' }),
    ]));
  }
  r.suggestions.forEach((sg, index) => {
    cards.push(el('div', { class: 'suggest-card' }, [
      el('h3', { text: `提案 ${index + 1}` }),
      el('div', { class: 'suggest-items' }, sg.items.map(({ item, role }) => el('button', {
        type: 'button',
        class: 'suggest-item',
        onclick: () => openItemDialog(item),
      }, [
        thumb(item),
        el('div', { class: 'role', text: role }),
        el('div', { class: 'name', text: itemLabel(item) }),
      ]))),
      sg.notes.length ? el('ul', { class: 'notes' }, sg.notes.map((n) => el('li', { text: n }))) : null,
      el('div', { class: 'actions' }, [
        el('button', { type: 'button', class: 'btn', text: 'コーデに保存', onclick: () => saveSuggestion(sg) }),
        el('button', { type: 'button', class: 'btn primary', text: '今日これを着る', onclick: () => wearSuggestion(sg) }),
      ]),
    ]));
  });
  if (r.suggestions.length) {
    cards.push(el('button', { type: 'button', class: 'btn wide', text: 'ほかの組み合わせを見る', onclick: runSuggest }));
  }
  box.replaceChildren(...cards);
}

async function saveSuggestion(sg) {
  const now = Date.now();
  const outfit = {
    id: uid(),
    memberId: state.memberId,
    name: `${state.suggest.occasion} ${state.suggest.temp}℃`,
    itemIds: sg.items.map(({ item }) => item.id),
    memo: '',
    wornDates: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.put('outfits', outfit);
  state.outfits.push(outfit);
  toast('コーデに保存しました');
}

async function wearSuggestion(sg) {
  const d = today();
  const items = sg.items.map(({ item }) => item);
  for (const item of items) if (!item.wornDates.includes(d)) item.wornDates.push(d);
  await db.putMany('items', items);
  toast('今日の着用を記録しました');
}

async function loadWeather({ ask }) {
  const btn = $('#weatherBtn');
  btn.disabled = true;
  btn.textContent = '取得中…';
  try {
    let loc = null;
    try { loc = JSON.parse(safeGet(KEYS.location)); } catch { /* 無視 */ }
    if (ask || !loc) {
      loc = await getPosition();
      safeSet(KEYS.location, JSON.stringify(loc));
    }
    const w = await fetchWeather(loc);
    const s = state.suggest;
    s.weather = w;
    s.temp = Math.round(w.max);
    s.low = Math.round(w.min);
    s.rainy = (w.rain ?? 0) >= 50;
    renderSuggestControls();
    runSuggest();
  } catch (err) {
    if (ask) alert(err.message || '天気を取得できませんでした');
  } finally {
    btn.disabled = false;
    btn.textContent = state.suggest.weather ? '更新' : '現在地の天気';
  }
}

function renderSuggest() {
  renderSuggestControls();
  renderSuggestResults();
  updateHeader();
  // 前に現在地を使ったことがあれば、開いたときに自動で天気を取る
  if (!state.suggest.weather && safeGet(KEYS.location)) loadWeather({ ask: false });
}

// ---------- 描画：コーデ ----------

function collage(outfit) {
  const items = outfit.itemIds.map((id) => state.items.find((i) => i.id === id)).filter(Boolean);
  const shown = items.length > 4 ? items.slice(0, 3) : items;
  const n = Math.max(1, Math.min(items.length, 4));
  const cells = shown.map(thumb);
  if (items.length > 4) cells.push(el('div', { class: 'more', text: `+${items.length - 3}` }));
  if (!cells.length) cells.push(thumb(null));
  return el('div', { class: `collage n${n}` }, cells);
}

function renderOutfits() {
  const list = memberOutfits().sort((a, b) => b.createdAt - a.createdAt);
  $('#outfitList').replaceChildren(...list.map((outfit) => el('button', {
    type: 'button',
    class: 'outfit-card',
    onclick: () => openOutfitDialog(outfit),
  }, [
    collage(outfit),
    el('div', { class: 'meta' }, [
      el('div', { class: 'name', text: outfit.name || `${outfit.itemIds.length}アイテムのコーデ` }),
      el('div', { class: 'sub', text: describeWear(outfit) }),
    ]),
  ])));

  const empty = $('#outfitEmpty');
  empty.hidden = list.length > 0;
  empty.textContent = memberItems().length
    ? 'まだコーデがありません。\n右下の ＋ から服を組み合わせるか、「提案」タブから保存しましょう。'
    : 'まずはクローゼットに服を登録してから、\nコーデを作ってみましょう。';
  updateHeader();
}

// ---------- 描画：設定 ----------

async function renderSettings() {
  $('#memberList').replaceChildren(...state.members.map((m) => {
    const count = state.items.filter((i) => i.memberId === m.id && i.status !== 'sold').length;
    return el('button', { type: 'button', class: 'member-row', onclick: () => openMemberDialog(m) }, [
      el('span', { class: 'name', text: m.name }),
      el('span', { class: 'muted small', text: m.top }),
      el('span', { class: 'sub', text: `${count}着 ›` }),
    ]);
  }));

  const last = safeGet(KEYS.lastBackup);
  $('#lastBackup').textContent = last
    ? `最後に書き出した日：${last}`
    : 'まだバックアップを書き出していません。';

  const info = $('#storageInfo');
  info.textContent = `メンバー ${state.members.length}人 · 服 ${state.items.length}着 · コーデ ${state.outfits.length}件`;
  if (navigator.storage?.estimate) {
    try {
      const { usage } = await navigator.storage.estimate();
      info.textContent += ` · 使用容量 約${(usage / 1024 / 1024).toFixed(1)}MB`;
    } catch { /* 取得できなくても問題ない */ }
  }
  updateHeader();
}

function render() {
  if (state.view === 'closet') renderCloset();
  else if (state.view === 'suggest') renderSuggest();
  else if (state.view === 'outfits') renderOutfits();
  else renderSettings();
}

function switchView(view) {
  state.view = view;
  for (const section of document.querySelectorAll('.view')) {
    section.hidden = section.id !== `view-${view}`;
  }
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  $('#fab').hidden = view === 'settings' || view === 'suggest';
  $('#fab').setAttribute('aria-label', view === 'outfits' ? 'コーデを作成' : '服を登録');
  window.scrollTo(0, 0);
  render();
}

function switchMember(id) {
  state.memberId = id;
  safeSet(KEYS.member, id);
  state.filter.kind = '';
  state.suggest.results = null;
  render();
}

// ---------- 服の登録・編集 ----------

const itemDraft = {
  id: null, photo: null, memberId: null,
  top: 'レディース', mid: '', leaf: '', colors: [], seasons: [], warmth: 2, occasions: [],
  // 利用者が自分で触った項目は、自動入力で上書きしない
  touched: { colors: false, seasons: false, warmth: false },
  autoNotes: new Set(),
};

function renderAutoHint() {
  const hint = $('#itemAutoHint');
  hint.hidden = !itemDraft.autoNotes.size;
  hint.textContent = `${[...itemDraft.autoNotes].join('・')}を自動で選びました。違うときはタップして直せます。`;
}

function applyCategoryGuess() {
  const d = itemDraft;
  const guess = guessFromCategory(d.mid, d.leaf);
  if (!guess) return;
  if (!d.touched.warmth) { d.warmth = guess.warmth; d.autoNotes.add('暖かさ'); }
  if (!d.touched.seasons) { d.seasons = guess.seasons; d.autoNotes.add('季節'); }
}

async function applyColorGuess(blob) {
  const d = itemDraft;
  if (d.touched.colors || d.colors.length) return;
  try {
    const colors = await detectColors(blob);
    if (!colors.length || d.touched.colors || d.photo !== blob) return;
    d.colors = colors;
    d.autoNotes.add('色');
    renderItemChoices();
  } catch { /* 色が分からなくても登録はできる */ }
}

function renderItemChoices() {
  const d = itemDraft;
  segmented($('#itemTop'), TOPS.map((t) => ({ value: t, label: t })), d.top, (top) => {
    if (top !== d.top) { d.top = top; d.mid = ''; d.leaf = ''; }
    renderItemChoices();
  });

  const mids = Object.keys(MERCARI[d.top]);
  $('#itemMid').replaceChildren(...mids.map((mid) => chip(mid, {
    role: 'radio',
    pressed: d.mid === mid,
    onclick: () => { d.mid = d.mid === mid ? '' : mid; d.leaf = ''; applyCategoryGuess(); renderItemChoices(); },
  })));

  const node = MERCARI[d.top][d.mid];
  $('#itemLeafWrap').hidden = !node;
  if (node) {
    $('#itemLeafLabel').textContent = `${d.mid} の種類`;
    $('#itemLeaf').replaceChildren(...node.leaves.map((leaf) => chip(leaf, {
      role: 'radio',
      pressed: d.leaf === leaf,
      onclick: () => { d.leaf = d.leaf === leaf ? '' : leaf; applyCategoryGuess(); renderItemChoices(); },
    })));
  }

  const toggle = (list, value, field) => {
    const i = list.indexOf(value);
    if (i >= 0) list.splice(i, 1); else list.push(value);
    if (field) d.touched[field] = true;
    renderItemChoices();
  };
  $('#itemColors').replaceChildren(...COLORS.map((c) => chip(c.name, {
    pressed: d.colors.includes(c.name),
    prefix: swatch(c.name),
    onclick: () => toggle(d.colors, c.name, 'colors'),
  })));
  $('#itemSeasons').replaceChildren(...SEASONS.map((s) => chip(s, {
    pressed: d.seasons.includes(s),
    onclick: () => toggle(d.seasons, s, 'seasons'),
  })));
  segmented($('#itemWarmth'), WARMTH, d.warmth, (w) => { d.warmth = w; d.touched.warmth = true; renderItemChoices(); });
  $('#itemOccasions').replaceChildren(...OCCASIONS.map((o) => chip(o, {
    pressed: d.occasions.includes(o),
    onclick: () => toggle(d.occasions, o),
  })));
  renderAutoHint();
}

let draftPhotoURL = null;
function setDraftPhoto(blob) {
  if (draftPhotoURL) URL.revokeObjectURL(draftPhotoURL);
  draftPhotoURL = blob ? URL.createObjectURL(blob) : null;
  itemDraft.photo = blob;
  const img = $('#itemPhotoPreview');
  img.hidden = !blob;
  if (blob) img.src = draftPhotoURL; else img.removeAttribute('src');
  $('#itemPhotoPlaceholder').hidden = !!blob;
}

function renderItemWear(item) {
  const worn = item.wornDates.includes(today());
  $('#itemWearInfo').textContent = `着用：${describeWear(item)}`;
  $('#itemWearBtn').textContent = worn ? '今日の記録を取り消す' : '今日着た';
  $('#itemWearBtn').classList.toggle('primary', !worn);
}

function openItemDialog(item = null) {
  const member = currentMember();
  const d = itemDraft;
  d.id = item?.id ?? null;
  d.memberId = item?.memberId ?? member.id;
  d.top = item?.mercariTop ?? member.top;
  d.mid = item?.mercariMid ?? '';
  d.leaf = item?.mercariLeaf ?? '';
  d.colors = [...(item?.colors ?? [])];
  d.seasons = [...(item?.seasons ?? [])];
  d.warmth = item?.warmth ?? 2;
  d.occasions = [...(item?.occasions ?? [])];
  // 登録済みの服は入力済みの値を尊重する（まとめて登録した未入力の服は自動入力の対象）
  const filled = item && !item.draft;
  d.touched = { colors: !!filled, seasons: !!filled || !!item?.seasons.length, warmth: !!filled };
  d.autoNotes = new Set();
  setDraftPhoto(item?.photo ?? null);

  $('#itemName').value = item?.name ?? '';
  $('#itemMemo').value = item?.memo ?? '';
  $('#itemBrand').value = item?.brand ?? '';
  $('#itemSize').value = item?.size ?? '';
  $('#itemPrice').value = item?.price ?? '';
  $('#itemCondition').value = item?.condition ?? '';
  $('#itemStatus').value = item?.status ?? 'own';
  $('#itemDetails').open = !!(item?.brand || item?.size || item?.condition || item?.price);

  $('#itemMember').replaceChildren(...state.members.map((m) => el('option', { value: m.id, text: m.name })));
  $('#itemMember').value = d.memberId;
  $('#itemMemberField').hidden = state.members.length < 2;

  const draftsLeft = memberItems().filter((i) => i.draft).length;
  $('#itemDialogTitle').textContent = item?.draft
    ? `未入力の服（残り${draftsLeft}件）`
    : item ? '服の詳細' : '服を登録';
  $('#itemDeleteBtn').hidden = !item;
  $('#itemListingBtn').hidden = !item;
  $('#itemWearSection').hidden = !item;
  if (item) renderItemWear(item);
  renderItemChoices();
  $('#itemDialog').showModal();
  $('#itemDialog .sheet-body').scrollTop = 0;
}

function readItemForm(existing) {
  const d = itemDraft;
  const now = Date.now();
  const kind = kindOf(d.top, d.mid, d.leaf) ?? existing?.kind ?? 'other';
  return {
    ...existing,
    id: existing?.id ?? uid(),
    memberId: $('#itemMember').value || d.memberId,
    name: $('#itemName').value.trim(),
    kind,
    mercariTop: d.top,
    mercariMid: d.mid,
    mercariLeaf: d.leaf,
    colors: [...d.colors],
    seasons: [...d.seasons],
    warmth: d.warmth,
    occasions: [...d.occasions],
    brand: $('#itemBrand').value.trim(),
    size: $('#itemSize').value.trim(),
    price: $('#itemPrice').value.replace(/[^\d]/g, ''),
    condition: $('#itemCondition').value,
    status: $('#itemStatus').value,
    memo: $('#itemMemo').value.trim(),
    listingNote: existing?.listingNote ?? '',
    draft: false,
    photo: d.photo,
    wornDates: existing?.wornDates ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

async function saveItem({ close = true } = {}) {
  if (!itemDraft.mid) {
    alert('カテゴリを選んでください。');
    return null;
  }
  const existing = state.items.find((i) => i.id === itemDraft.id);
  const existingWasDraft = existing?.draft;
  const item = readItemForm(existing);
  await db.put('items', item);
  if (existing) {
    if (existing.photo !== item.photo) forgetPhoto(item.id);
    Object.assign(existing, item);
  } else {
    state.items.push(item);
    itemDraft.id = item.id;
  }
  const wasDraft = !!existingWasDraft;
  if (close) {
    $('#itemDialog').close();
    // 一覧と同じ並び（新しい順）で次の未入力の服を開く
    const next = wasDraft && memberItems().filter((i) => i.draft).sort((a, b) => b.createdAt - a.createdAt)[0];
    render();
    if (next) {
      openItemDialog(next);
      toast('保存しました。次の服です');
    } else {
      toast(wasDraft ? 'まとめて登録した服の入力がすべて終わりました' : existing ? '保存しました' : '登録しました');
    }
    return existing ?? item;
  }
  render();
  return existing ?? item;
}

// ---------- まとめて登録 ----------

async function bulkRegister(files) {
  const member = currentMember();
  const label = $('#bulkLabel');
  const original = label.textContent;
  let done = 0;
  let failed = 0;
  const now = Date.now();
  for (const [index, file] of files.entries()) {
    label.textContent = `登録中… ${index + 1}/${files.length}`;
    try {
      const photo = await compressImage(file);
      const colors = await detectColors(photo).catch(() => []);
      const item = normalizeItem({
        id: uid(),
        memberId: member.id,
        kind: 'other',
        mercariTop: member.top,
        colors,
        photo,
        draft: true,
        // 選んだ順に並ぶよう、少しずつ時刻をずらす
        createdAt: now + index,
        updatedAt: now + index,
      }, member);
      await db.put('items', item);
      state.items.push(item);
      done++;
    } catch (err) {
      console.error(err);
      failed++;
    }
  }
  label.textContent = original;
  state.filter.kind = done ? 'draft' : state.filter.kind;
  render();
  if (!done) {
    alert('写真を読み込めませんでした。');
    return;
  }
  toast(failed
    ? `${done}着を登録しました（${failed}枚は読み込めませんでした）`
    : `${done}着を登録しました。服をタップして、カテゴリなどを入れてください`);
}

async function deleteItem() {
  const item = state.items.find((i) => i.id === itemDraft.id);
  if (!item) return;
  const used = state.outfits.filter((o) => o.itemIds.includes(item.id));
  const message = used.length
    ? `「${itemLabel(item)}」を削除しますか？\n${used.length}件のコーデからも外れます。\n（売った服は、ステータスを「売却済み」にすると記録を残せます）`
    : `「${itemLabel(item)}」を削除しますか？\n（売った服は、ステータスを「売却済み」にすると記録を残せます）`;
  if (!confirm(message)) return;

  for (const outfit of used) {
    outfit.itemIds = outfit.itemIds.filter((id) => id !== item.id);
  }
  if (used.length) await db.putMany('outfits', used);
  await db.remove('items', item.id);
  state.items = state.items.filter((i) => i.id !== item.id);
  forgetPhoto(item.id);
  $('#itemDialog').close();
  render();
  toast('削除しました');
}

function toggleWornToday(entity) {
  const d = today();
  if (entity.wornDates.includes(d)) {
    entity.wornDates = entity.wornDates.filter((x) => x !== d);
    return false;
  }
  entity.wornDates.push(d);
  return true;
}

async function toggleItemWear() {
  const item = state.items.find((i) => i.id === itemDraft.id);
  if (!item) return;
  toggleWornToday(item);
  await db.put('items', item);
  renderItemWear(item);
  render();
}

// ---------- メルカリ出品用 ----------

let listingItem = null;

function refreshListingText() {
  const item = { ...listingItem, listingNote: $('#listingNote').value.trim() };
  $('#listingDesc').value = listingDescription(item);
}

async function openListingDialog() {
  // 入力途中の内容も反映させるため、先に保存する
  const item = await saveItem({ close: false });
  if (!item) return;
  listingItem = item;
  $('#listingCategory').textContent = categoryPath(item) || '未設定';
  $('#listingCondition').textContent = item.condition || '未設定（「ブランド・サイズ・状態など」で選べます）';
  $('#listingTitle').value = listingTitle(item);
  $('#listingTitleCount').textContent = `${$('#listingTitle').value.length}/40`;
  $('#listingNote').value = item.listingNote;
  refreshListingText();
  $('#listingPhotoBtn').disabled = !item.photo;
  $('#listingSellingBtn').hidden = item.status !== 'own';
  $('#listingDialog').showModal();
  $('#listingDialog .sheet-body').scrollTop = 0;
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 古いブラウザ向け
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    button.closest('dialog').append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const label = button.textContent;
  button.textContent = 'コピーしました ✓';
  setTimeout(() => { button.textContent = label; }, 1500);
}

async function saveListingPhoto() {
  if (!listingItem?.photo) return;
  const file = new File([listingItem.photo], `${listingTitle(listingItem) || 'photo'}.jpg`, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = el('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function persistListingNote() {
  if (!listingItem) return;
  const note = $('#listingNote').value.trim();
  if (note === listingItem.listingNote) return;
  listingItem.listingNote = note;
  await db.put('items', listingItem);
}

async function markSelling() {
  listingItem.status = 'selling';
  await persistListingNote();
  await db.put('items', listingItem);
  $('#itemStatus').value = 'selling';
  $('#listingSellingBtn').hidden = true;
  render();
  toast('出品中にしました');
}

// ---------- コーデの作成・編集 ----------

const outfitDraft = { id: null, itemIds: [], kind: '' };

function renderOutfitPicker() {
  const available = memberItems().filter((i) => i.status !== 'sold' || outfitDraft.itemIds.includes(i.id));
  const counts = {};
  for (const item of available) counts[item.kind] = (counts[item.kind] || 0) + 1;
  $('#outfitPickerFilter').replaceChildren(
    chip('すべて', { pressed: !outfitDraft.kind, onclick: () => { outfitDraft.kind = ''; renderOutfitPicker(); } }),
    ...KIND_KEYS.filter((k) => counts[k]).map((k) => chip(KINDS[k], {
      pressed: outfitDraft.kind === k,
      onclick: () => { outfitDraft.kind = outfitDraft.kind === k ? '' : k; renderOutfitPicker(); },
    })),
  );

  const items = available
    .filter((i) => !outfitDraft.kind || i.kind === outfitDraft.kind)
    .sort((a, b) => KIND_KEYS.indexOf(a.kind) - KIND_KEYS.indexOf(b.kind) || b.createdAt - a.createdAt);

  $('#outfitPicker').replaceChildren(...items.map((item) => el('button', {
    type: 'button',
    class: 'item-card',
    'aria-pressed': String(outfitDraft.itemIds.includes(item.id)),
    onclick: () => {
      const ids = outfitDraft.itemIds;
      const i = ids.indexOf(item.id);
      if (i >= 0) ids.splice(i, 1); else ids.push(item.id);
      renderOutfitPicker();
    },
  }, [
    thumb(item),
    el('div', { class: 'meta' }, el('div', { class: 'name', text: itemLabel(item) })),
  ])));

  $('#outfitPickerEmpty').hidden = available.length > 0;
  $('#outfitPickerFilter').hidden = available.length === 0;
  $('#outfitSelectedCount').textContent = outfitDraft.itemIds.length ? `${outfitDraft.itemIds.length}点選択中` : '';
}

function renderOutfitWear(outfit) {
  const worn = outfit.wornDates.includes(today());
  $('#outfitWearInfo').textContent = `着用：${describeWear(outfit)}`;
  $('#outfitWearBtn').textContent = worn ? '今日の記録を取り消す' : '今日着た';
  $('#outfitWearBtn').classList.toggle('primary', !worn);
}

function openOutfitDialog(outfit = null) {
  outfitDraft.id = outfit?.id ?? null;
  outfitDraft.itemIds = [...(outfit?.itemIds ?? [])];
  outfitDraft.kind = '';
  $('#outfitName').value = outfit?.name ?? '';
  $('#outfitMemo').value = outfit?.memo ?? '';
  $('#outfitDialogTitle').textContent = outfit ? 'コーデの詳細' : 'コーデを作成';
  $('#outfitDeleteBtn').hidden = !outfit;
  $('#outfitWearSection').hidden = !outfit;
  if (outfit) renderOutfitWear(outfit);
  renderOutfitPicker();
  $('#outfitDialog').showModal();
  $('#outfitDialog .sheet-body').scrollTop = 0;
}

async function saveOutfit() {
  if (!outfitDraft.itemIds.length) {
    alert('コーデに入れる服を1つ以上選んでください。');
    return;
  }
  const existing = state.outfits.find((o) => o.id === outfitDraft.id);
  const now = Date.now();
  const outfit = {
    id: existing?.id ?? uid(),
    memberId: existing?.memberId ?? state.memberId,
    name: $('#outfitName').value.trim(),
    itemIds: [...outfitDraft.itemIds],
    memo: $('#outfitMemo').value.trim(),
    wornDates: existing?.wornDates ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.put('outfits', outfit);
  if (existing) Object.assign(existing, outfit);
  else state.outfits.push(outfit);
  $('#outfitDialog').close();
  render();
  toast(existing ? '保存しました' : 'コーデを作成しました');
}

async function deleteOutfit() {
  const outfit = state.outfits.find((o) => o.id === outfitDraft.id);
  if (!outfit) return;
  if (!confirm(`「${outfit.name || 'このコーデ'}」を削除しますか？\n（服そのものは削除されません）`)) return;
  await db.remove('outfits', outfit.id);
  state.outfits = state.outfits.filter((o) => o.id !== outfit.id);
  $('#outfitDialog').close();
  render();
  toast('削除しました');
}

async function toggleOutfitWear() {
  const outfit = state.outfits.find((o) => o.id === outfitDraft.id);
  if (!outfit) return;
  const d = today();
  const nowWorn = toggleWornToday(outfit);
  // コーデを着た日は、含まれる服それぞれにも記録する（取り消しも同様）
  const items = state.items.filter((i) => outfit.itemIds.includes(i.id));
  for (const item of items) {
    const has = item.wornDates.includes(d);
    if (nowWorn && !has) item.wornDates.push(d);
    if (!nowWorn && has) item.wornDates = item.wornDates.filter((x) => x !== d);
  }
  await db.put('outfits', outfit);
  await db.putMany('items', items);
  renderOutfitWear(outfit);
  render();
}

// ---------- メンバー ----------

const memberDraft = { id: null, top: 'レディース' };

function renderMemberTop() {
  segmented($('#memberTop'), TOPS.map((t) => ({ value: t, label: t })), memberDraft.top, (top) => {
    memberDraft.top = top;
    renderMemberTop();
  });
}

function openMemberDialog(member = null) {
  memberDraft.id = member?.id ?? null;
  memberDraft.top = member?.top ?? 'レディース';
  $('#memberName').value = member?.name ?? '';
  $('#memberDialogTitle').textContent = member ? 'メンバーを編集' : 'メンバーを追加';
  $('#memberDeleteBtn').hidden = !member || state.members.length < 2;
  renderMemberTop();
  $('#memberDialog').showModal();
}

async function saveMember() {
  const name = $('#memberName').value.trim();
  if (!name) return;
  const existing = state.members.find((m) => m.id === memberDraft.id);
  const member = normalizeMember({ ...existing, id: memberDraft.id ?? uid(), name, top: memberDraft.top });
  await db.put('members', member);
  if (existing) Object.assign(existing, member);
  else state.members.push(member);
  $('#memberDialog').close();
  if (!existing) switchMember(member.id);
  else render();
  toast(existing ? '保存しました' : `${member.name}さんを追加しました`);
}

async function deleteMember() {
  const member = state.members.find((m) => m.id === memberDraft.id);
  if (!member || state.members.length < 2) return;
  const items = state.items.filter((i) => i.memberId === member.id);
  const outfits = state.outfits.filter((o) => o.memberId === member.id);
  const detail = items.length || outfits.length
    ? `\n${member.name}さんの服 ${items.length}着・コーデ ${outfits.length}件もすべて削除されます。\n残したい服は、先に服の詳細で持ち主を変えてください。`
    : '';
  if (!confirm(`${member.name}さんを削除しますか？${detail}`)) return;
  if (detail && !confirm('本当に削除しますか？元に戻せません。')) return;

  for (const item of items) { await db.remove('items', item.id); forgetPhoto(item.id); }
  for (const outfit of outfits) await db.remove('outfits', outfit.id);
  await db.remove('members', member.id);
  state.items = state.items.filter((i) => i.memberId !== member.id);
  state.outfits = state.outfits.filter((o) => o.memberId !== member.id);
  state.members = state.members.filter((m) => m.id !== member.id);
  $('#memberDialog').close();
  if (state.memberId === member.id) switchMember(state.members[0].id);
  else render();
  toast('削除しました');
}

// ---------- バックアップ ----------

async function exportBackup() {
  const btn = $('#exportBtn');
  btn.disabled = true;
  try {
    const items = await Promise.all(state.items.map(async (item) => ({
      ...item,
      photo: item.photo ? await blobToDataURL(item.photo) : null,
    })));
    const data = {
      app: 'wardrobe-manager',
      version: 2,
      exportedAt: new Date().toISOString(),
      members: state.members,
      items,
      outfits: state.outfits,
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const filename = `wardrobe-backup-${today()}.json`;
    const file = new File([blob], filename, { type: 'application/json' });

    // スマホでは共有シートから「ファイルに保存」できるようにする
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        markBackedUp();
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    markBackedUp();
  } catch (err) {
    console.error(err);
    alert('バックアップを書き出せませんでした。');
  } finally {
    btn.disabled = false;
  }
}

function markBackedUp() {
  safeSet(KEYS.lastBackup, today());
  renderSettings();
  toast('バックアップを書き出しました');
}

async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    alert('ファイルを読み込めませんでした。バックアップのファイルを選んでください。');
    return;
  }
  if (data?.app !== 'wardrobe-manager' || !Array.isArray(data.items) || !Array.isArray(data.outfits)) {
    alert('このアプリのバックアップファイルではないようです。');
    return;
  }
  const memberCount = Array.isArray(data.members) ? data.members.length : 0;
  const memberNote = memberCount ? `メンバー ${memberCount}人・` : `（${currentMember().name}さんの服として）`;
  if (!confirm(`${memberNote}服 ${data.items.length}着・コーデ ${data.outfits.length}件を読み込みます。\n同じデータがある場合は、バックアップの内容で上書きされます。`)) return;

  try {
    const members = (data.members || []).map(normalizeMember);
    // 服もコーデもない初期メンバーだけの状態なら、バックアップのメンバーで置き換える
    if (members.length && !state.items.length && !state.outfits.length) {
      for (const m of state.members) if (!members.some((x) => x.id === m.id)) await db.remove('members', m.id);
      state.members = [];
    }
    await db.putMany('members', members);
    for (const m of members) {
      const i = state.members.findIndex((x) => x.id === m.id);
      if (i >= 0) state.members[i] = m; else state.members.push(m);
    }
    // 古いバックアップ（メンバーなし）は、いま選んでいるメンバーの服として読み込む
    const fallback = currentMember();
    const items = await Promise.all(data.items.map(async (raw) => normalizeItem({
      ...raw,
      photo: typeof raw.photo === 'string' && raw.photo.startsWith('data:image/') ? await dataURLToBlob(raw.photo) : null,
    }, fallback)));
    const outfits = data.outfits.map((o) => normalizeOutfit(o, fallback));
    await db.putMany('items', items);
    await db.putMany('outfits', outfits);
    for (const item of items) forgetPhoto(item.id);
    await loadAll();
    render();
    toast('バックアップを読み込みました');
  } catch (err) {
    console.error(err);
    alert('読み込み中にエラーが起きました。');
  }
}

async function wipeAll() {
  if (!confirm('家族全員の服とコーデをすべて削除します。元に戻せません。よろしいですか？')) return;
  if (!confirm('本当に削除しますか？')) return;
  await db.clearAll();
  for (const id of [...photoURLs.keys()]) forgetPhoto(id);
  await loadAll();
  render();
  toast('すべて削除しました');
}

// ---------- 初期化 ----------

async function loadAll() {
  const [members, items, outfits] = await Promise.all([
    db.getAll('members'), db.getAll('items'), db.getAll('outfits'),
  ]);
  state.members = members.map(normalizeMember).sort((a, b) => a.createdAt - b.createdAt);
  if (!state.members.length) {
    const first = normalizeMember({ id: uid(), name: 'わたし', top: 'レディース' });
    await db.put('members', first);
    state.members = [first];
  }
  const saved = safeGet(KEYS.member);
  state.memberId = state.members.some((m) => m.id === saved) ? saved : state.members[0].id;

  const fallback = currentMember();
  state.items = items.map((raw) => normalizeItem(raw, fallback));
  state.outfits = outfits.map((raw) => normalizeOutfit(raw, fallback));

  // 古い形式のデータが残っていたら、今の形式で保存しなおす
  const outdated = items.filter((raw) => !raw.memberId || !raw.kind);
  if (outdated.length) {
    await db.putMany('items', state.items.filter((i) => outdated.some((o) => o.id === i.id)));
  }
  if (outfits.some((raw) => !raw.memberId)) await db.putMany('outfits', state.outfits);
}

function setupFilters() {
  $('#colorFilter').replaceChildren(
    el('option', { value: '', text: '色：すべて' }),
    ...COLORS.map((c) => el('option', { value: c.name, text: c.name })),
  );
  $('#seasonFilter').replaceChildren(
    el('option', { value: '', text: '季節：すべて' }),
    ...SEASONS.map((s) => el('option', { value: s, text: s })),
  );
  $('#itemCondition').replaceChildren(
    el('option', { value: '', text: '未設定' }),
    ...CONDITIONS.map((c) => el('option', { value: c, text: c })),
  );
  $('#searchInput').addEventListener('input', (e) => { state.filter.q = e.target.value; renderCloset(); });
  $('#colorFilter').addEventListener('change', (e) => { state.filter.color = e.target.value; renderCloset(); });
  $('#seasonFilter').addEventListener('change', (e) => { state.filter.season = e.target.value; renderCloset(); });
  $('#statusFilter').addEventListener('change', (e) => { state.filter.status = e.target.value; renderCloset(); });
  $('#sortSelect').addEventListener('change', (e) => { state.filter.sort = e.target.value; renderCloset(); });
}

function setupEvents() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  }
  $('#memberSelect').addEventListener('change', (e) => switchMember(e.target.value));
  $('#fab').addEventListener('click', () => {
    if (state.view === 'outfits') openOutfitDialog();
    else openItemDialog();
  });

  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => button.closest('dialog').close());
  }

  $('#itemPhotoInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const blob = await compressImage(file);
      setDraftPhoto(blob);
      await applyColorGuess(blob);
    } catch (err) {
      alert(err.message);
    }
  });
  $('#bulkPhotoInput').addEventListener('change', (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (files.length) bulkRegister(files);
  });
  $('#itemForm').addEventListener('submit', (e) => { e.preventDefault(); saveItem(); });
  $('#itemDeleteBtn').addEventListener('click', deleteItem);
  $('#itemWearBtn').addEventListener('click', toggleItemWear);
  $('#itemListingBtn').addEventListener('click', openListingDialog);

  $('#listingTitle').addEventListener('input', (e) => {
    $('#listingTitleCount').textContent = `${e.target.value.length}/40`;
  });
  $('#listingNote').addEventListener('input', refreshListingText);
  $('#listingNote').addEventListener('change', persistListingNote);
  $('#listingDialog').addEventListener('close', persistListingNote);
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', () => copyText($(`#${button.dataset.copy}`).value, button));
  }
  $('#listingPhotoBtn').addEventListener('click', saveListingPhoto);
  $('#listingSellingBtn').addEventListener('click', markSelling);

  $('#outfitForm').addEventListener('submit', (e) => { e.preventDefault(); saveOutfit(); });
  $('#outfitDeleteBtn').addEventListener('click', deleteOutfit);
  $('#outfitWearBtn').addEventListener('click', toggleOutfitWear);

  $('#tempRange').addEventListener('input', (e) => {
    state.suggest.temp = Number(e.target.value);
    state.suggest.low = null; // 手動で変えたら寒暖差の判定は使わない
    $('#tempValue').textContent = `${state.suggest.temp}℃`;
  });
  $('#tempRange').addEventListener('change', runSuggest);
  $('#weatherBtn').addEventListener('click', () => loadWeather({ ask: true }));
  $('#suggestBtn').addEventListener('click', runSuggest);

  $('#addMemberBtn').addEventListener('click', () => openMemberDialog());
  $('#memberForm').addEventListener('submit', (e) => { e.preventDefault(); saveMember(); });
  $('#memberDeleteBtn').addEventListener('click', deleteMember);

  $('#exportBtn').addEventListener('click', exportBackup);
  $('#importInput').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) importBackup(file);
  });
  $('#wipeBtn').addEventListener('click', wipeAll);
}

async function init() {
  setupFilters();
  setupEvents();
  try {
    await loadAll();
  } catch (err) {
    console.error(err);
    alert('データを読み込めませんでした。プライベートブラウズでは保存できない場合があります。');
    return;
  }
  switchView('closet');

  // ブラウザが容量不足のときに勝手にデータを消さないようお願いする
  navigator.storage?.persist?.().catch(() => {});

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
