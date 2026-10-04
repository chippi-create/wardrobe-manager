import * as db from './db.js';
import { compressImage, blobToDataURL, dataURLToBlob } from './image.js';

// ---------- 定数 ----------

const CATEGORIES = ['トップス', 'アウター', 'ボトムス', 'ワンピース', 'シューズ', 'バッグ', 'アクセサリー', 'その他'];

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

const LAST_BACKUP_KEY = 'wardrobe:lastBackup';

// ---------- 状態 ----------

const state = {
  view: 'closet',
  items: [],
  outfits: [],
  filter: { q: '', category: '', color: '', season: '', sort: 'new' },
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
    if (child != null) node.append(child);
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

function thumb(item) {
  const url = item && photoURL(item);
  return el('div', { class: 'thumb' }, url
    ? el('img', { src: url, alt: '', loading: 'lazy' })
    : el('span', { text: item ? item.category : '' }));
}

let toastTimer;
function toast(message) {
  const node = $('#toast');
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

// ---------- 描画：クローゼット ----------

function filteredItems() {
  const { q, category, color, season, sort } = state.filter;
  const query = q.trim().toLowerCase();
  const list = state.items.filter((item) => {
    if (category && item.category !== category) return false;
    if (color && !item.colors.includes(color)) return false;
    if (season && !item.seasons.includes(season)) return false;
    if (query && !`${item.name} ${item.memo}`.toLowerCase().includes(query)) return false;
    return true;
  });

  const count = (i) => (i.wornDates || []).length;
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

function renderCategoryFilter() {
  const row = $('#categoryFilter');
  const counts = {};
  for (const item of state.items) counts[item.category] = (counts[item.category] || 0) + 1;
  row.replaceChildren(
    chip(`すべて ${state.items.length}`, {
      pressed: !state.filter.category,
      onclick: () => { state.filter.category = ''; renderCloset(); },
    }),
    ...CATEGORIES.filter((c) => counts[c]).map((c) => chip(`${c} ${counts[c]}`, {
      pressed: state.filter.category === c,
      onclick: () => { state.filter.category = state.filter.category === c ? '' : c; renderCloset(); },
    })),
  );
}

function renderCloset() {
  renderCategoryFilter();
  const items = filteredItems();
  const grid = $('#itemGrid');
  grid.replaceChildren(...items.map((item) => el('button', {
    type: 'button',
    class: 'item-card',
    onclick: () => openItemDialog(item),
  }, [
    thumb(item),
    el('div', { class: 'meta' }, [
      el('div', { class: 'name', text: item.name || item.category }),
      el('div', { class: 'sub', text: describeWear(item) }),
      item.colors.length ? el('div', { class: 'dots' }, item.colors.map(swatch)) : null,
    ]),
  ])));

  const empty = $('#itemEmpty');
  if (!state.items.length) {
    empty.textContent = 'まだ服が登録されていません。\n右下の ＋ から最初の1着を登録しましょう。';
    empty.hidden = false;
  } else if (!items.length) {
    empty.textContent = '条件に合う服がありません。';
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }
  updateHeader();
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
  const list = [...state.outfits].sort((a, b) => b.createdAt - a.createdAt);
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
  empty.textContent = state.items.length
    ? 'まだコーデがありません。\n右下の ＋ から服を組み合わせて保存しましょう。'
    : 'まずはクローゼットに服を登録してから、\nコーデを作ってみましょう。';
  updateHeader();
}

// ---------- 描画：設定 ----------

async function renderSettings() {
  const last = safeGet(LAST_BACKUP_KEY);
  $('#lastBackup').textContent = last
    ? `最後に書き出した日：${last}`
    : 'まだバックアップを書き出していません。';

  const info = $('#storageInfo');
  info.textContent = `服 ${state.items.length}着 · コーデ ${state.outfits.length}件`;
  if (navigator.storage?.estimate) {
    try {
      const { usage } = await navigator.storage.estimate();
      info.textContent += ` · 使用容量 約${(usage / 1024 / 1024).toFixed(1)}MB`;
    } catch { /* 取得できなくても問題ない */ }
  }
  updateHeader();
}

function updateHeader() {
  const section = $(`#view-${state.view}`);
  $('#viewTitle').textContent = section.dataset.title;
  const count = state.view === 'closet'
    ? `${state.items.length}着`
    : state.view === 'outfits' ? `${state.outfits.length}件` : '';
  $('#viewCount').textContent = count;
}

function render() {
  if (state.view === 'closet') renderCloset();
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
  $('#fab').hidden = view === 'settings';
  $('#fab').setAttribute('aria-label', view === 'outfits' ? 'コーデを作成' : '服を登録');
  window.scrollTo(0, 0);
  render();
}

// ---------- 服の登録・編集 ----------

const itemDraft = { id: null, photo: null, category: CATEGORIES[0], colors: [], seasons: [] };

function renderItemChoices() {
  $('#itemCategory').replaceChildren(...CATEGORIES.map((c) => chip(c, {
    role: 'radio',
    pressed: itemDraft.category === c,
    onclick: () => { itemDraft.category = c; renderItemChoices(); },
  })));
  const toggle = (list, value) => {
    const i = list.indexOf(value);
    if (i >= 0) list.splice(i, 1); else list.push(value);
    renderItemChoices();
  };
  $('#itemColors').replaceChildren(...COLORS.map((c) => chip(c.name, {
    pressed: itemDraft.colors.includes(c.name),
    prefix: swatch(c.name),
    onclick: () => toggle(itemDraft.colors, c.name),
  })));
  $('#itemSeasons').replaceChildren(...SEASONS.map((s) => chip(s, {
    pressed: itemDraft.seasons.includes(s),
    onclick: () => toggle(itemDraft.seasons, s),
  })));
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
  const worn = (item.wornDates || []).includes(today());
  $('#itemWearInfo').textContent = `着用：${describeWear(item)}`;
  $('#itemWearBtn').textContent = worn ? '今日の記録を取り消す' : '今日着た';
  $('#itemWearBtn').classList.toggle('primary', !worn);
}

function openItemDialog(item = null) {
  itemDraft.id = item?.id ?? null;
  itemDraft.category = item?.category ?? (state.filter.category || CATEGORIES[0]);
  itemDraft.colors = [...(item?.colors ?? [])];
  itemDraft.seasons = [...(item?.seasons ?? [])];
  setDraftPhoto(item?.photo ?? null);
  $('#itemName').value = item?.name ?? '';
  $('#itemMemo').value = item?.memo ?? '';
  $('#itemDialogTitle').textContent = item ? '服の詳細' : '服を登録';
  $('#itemDeleteBtn').hidden = !item;
  $('#itemWearSection').hidden = !item;
  if (item) renderItemWear(item);
  renderItemChoices();
  $('#itemDialog').showModal();
  $('#itemDialog .sheet-body').scrollTop = 0;
}

async function saveItem() {
  const existing = state.items.find((i) => i.id === itemDraft.id);
  const now = Date.now();
  const item = {
    id: existing?.id ?? uid(),
    name: $('#itemName').value.trim(),
    category: itemDraft.category,
    colors: [...itemDraft.colors],
    seasons: [...itemDraft.seasons],
    memo: $('#itemMemo').value.trim(),
    photo: itemDraft.photo,
    wornDates: existing?.wornDates ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.put('items', item);
  if (existing) {
    if (existing.photo !== item.photo) forgetPhoto(item.id);
    Object.assign(existing, item);
  } else {
    state.items.push(item);
  }
  $('#itemDialog').close();
  render();
  toast(existing ? '保存しました' : '登録しました');
}

async function deleteItem() {
  const item = state.items.find((i) => i.id === itemDraft.id);
  if (!item) return;
  const used = state.outfits.filter((o) => o.itemIds.includes(item.id));
  const message = used.length
    ? `「${item.name || item.category}」を削除しますか？\n${used.length}件のコーデからも外れます。`
    : `「${item.name || item.category}」を削除しますか？`;
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
  entity.wornDates = entity.wornDates || [];
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

// ---------- コーデの作成・編集 ----------

const outfitDraft = { id: null, itemIds: [], category: '' };

function renderOutfitPicker() {
  const counts = {};
  for (const item of state.items) counts[item.category] = (counts[item.category] || 0) + 1;
  $('#outfitPickerFilter').replaceChildren(
    chip('すべて', { pressed: !outfitDraft.category, onclick: () => { outfitDraft.category = ''; renderOutfitPicker(); } }),
    ...CATEGORIES.filter((c) => counts[c]).map((c) => chip(c, {
      pressed: outfitDraft.category === c,
      onclick: () => { outfitDraft.category = outfitDraft.category === c ? '' : c; renderOutfitPicker(); },
    })),
  );

  const items = state.items
    .filter((i) => !outfitDraft.category || i.category === outfitDraft.category)
    .sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || b.createdAt - a.createdAt);

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
    el('div', { class: 'meta' }, el('div', { class: 'name', text: item.name || item.category })),
  ])));

  $('#outfitPickerEmpty').hidden = state.items.length > 0;
  $('#outfitPickerFilter').hidden = state.items.length === 0;
  $('#outfitSelectedCount').textContent = outfitDraft.itemIds.length ? `${outfitDraft.itemIds.length}点選択中` : '';
}

function renderOutfitWear(outfit) {
  const worn = (outfit.wornDates || []).includes(today());
  $('#outfitWearInfo').textContent = `着用：${describeWear(outfit)}`;
  $('#outfitWearBtn').textContent = worn ? '今日の記録を取り消す' : '今日着た';
  $('#outfitWearBtn').classList.toggle('primary', !worn);
}

function openOutfitDialog(outfit = null) {
  outfitDraft.id = outfit?.id ?? null;
  outfitDraft.itemIds = [...(outfit?.itemIds ?? [])];
  outfitDraft.category = '';
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
    item.wornDates = item.wornDates || [];
    const has = item.wornDates.includes(d);
    if (nowWorn && !has) item.wornDates.push(d);
    if (!nowWorn && has) item.wornDates = item.wornDates.filter((x) => x !== d);
  }
  await db.put('outfits', outfit);
  await db.putMany('items', items);
  renderOutfitWear(outfit);
  render();
}

// ---------- バックアップ ----------

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 保存できなくても動作に影響しない */ }
}

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
      version: 1,
      exportedAt: new Date().toISOString(),
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
  safeSet(LAST_BACKUP_KEY, today());
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
  if (!confirm(`服 ${data.items.length}着・コーデ ${data.outfits.length}件を読み込みます。\n同じデータがある場合は、バックアップの内容で上書きされます。`)) return;

  try {
    const items = await Promise.all(data.items.map(async (raw) => normalizeItem({
      ...raw,
      photo: typeof raw.photo === 'string' && raw.photo.startsWith('data:image/') ? await dataURLToBlob(raw.photo) : null,
    })));
    const outfits = data.outfits.map(normalizeOutfit);
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

function normalizeItem(raw) {
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return {
    id: String(raw.id || uid()),
    name: String(raw.name || ''),
    category: CATEGORIES.includes(raw.category) ? raw.category : 'その他',
    colors: arr(raw.colors),
    seasons: arr(raw.seasons),
    memo: String(raw.memo || ''),
    photo: raw.photo instanceof Blob ? raw.photo : null,
    wornDates: arr(raw.wornDates),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

function normalizeOutfit(raw) {
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return {
    id: String(raw.id || uid()),
    name: String(raw.name || ''),
    itemIds: arr(raw.itemIds),
    memo: String(raw.memo || ''),
    wornDates: arr(raw.wornDates),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

async function wipeAll() {
  if (!confirm('すべての服とコーデを削除します。元に戻せません。よろしいですか？')) return;
  if (!confirm('本当に削除しますか？')) return;
  await db.clearAll();
  for (const id of [...photoURLs.keys()]) forgetPhoto(id);
  state.items = [];
  state.outfits = [];
  render();
  toast('すべて削除しました');
}

// ---------- 初期化 ----------

async function loadAll() {
  const [items, outfits] = await Promise.all([db.getAll('items'), db.getAll('outfits')]);
  state.items = items.map(normalizeItem);
  state.outfits = outfits.map(normalizeOutfit);
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
  $('#searchInput').addEventListener('input', (e) => { state.filter.q = e.target.value; renderCloset(); });
  $('#colorFilter').addEventListener('change', (e) => { state.filter.color = e.target.value; renderCloset(); });
  $('#seasonFilter').addEventListener('change', (e) => { state.filter.season = e.target.value; renderCloset(); });
  $('#sortSelect').addEventListener('change', (e) => { state.filter.sort = e.target.value; renderCloset(); });
}

function setupEvents() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  }
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
      setDraftPhoto(await compressImage(file));
    } catch (err) {
      alert(err.message);
    }
  });
  $('#itemForm').addEventListener('submit', (e) => { e.preventDefault(); saveItem(); });
  $('#itemDeleteBtn').addEventListener('click', deleteItem);
  $('#itemWearBtn').addEventListener('click', toggleItemWear);

  $('#outfitForm').addEventListener('submit', (e) => { e.preventDefault(); saveOutfit(); });
  $('#outfitDeleteBtn').addEventListener('click', deleteOutfit);
  $('#outfitWearBtn').addEventListener('click', toggleOutfitWear);

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
  }
  switchView('closet');

  // ブラウザが容量不足のときに勝手にデータを消さないようお願いする
  navigator.storage?.persist?.().catch(() => {});

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
