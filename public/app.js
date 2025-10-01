// kintoneのフィールドコード（"表示名"ではなくフィールドコード）
const FIELDS = {
  CODE: '商品コード',
  NAME: '商品名',
  PRICE: '上代',
  SYMBOL: '記号',
  INNER_QTY: '内箱入数',
  LOCATION: 'ロケーション',
  BALANCE: '差引実',
};

// ▼ 画像URLが入っているフィールドコード（文字列1行：例「DropBox」）
const IMAGE_FIELDS = ['DropBox'];

// 詳細モーダルに表示するフィールドコード（この順で表示）
const DETAIL_FIELDS = [
  '商品CD','商品名','上代','特別上代','記号','裸差引','詰差引','定番差引','差引実',
  '頁CD','行CD','ロケーション','荷姿','CT入数','内箱入数','JAN','主倉庫CD',
  '仕入先名','原産地','磁器陶器','材質_Bshop','材質備考_Bshop','容量_Bshop',
  '商品重量_Bshop','発注残','受注残合計'
];

// （任意）表示ラベル
const DETAIL_LABELS = {};

// 書式
const yenFmt = new Intl.NumberFormat('ja-JP');
const numFmt = new Intl.NumberFormat('ja-JP');
const CURRENCY_FIELDS = new Set(['上代','特別上代']);
const NUMBER_FIELDS   = new Set(['裸差引','詰差引','定番差引','差引実','CT入数','内箱入数','商品重量_Bshop','発注残','受注残合計']);
function formatByField(code, raw) {
  if (raw === '' || raw === null || raw === undefined) return '';
  if (CURRENCY_FIELDS.has(code) && !isNaN(raw)) return `¥${yenFmt.format(Number(raw))}`;
  if (NUMBER_FIELDS.has(code)   && !isNaN(raw)) return numFmt.format(Number(String(raw).replace(/,/g,'')));
  return String(raw);
}
const SHOW_EMPTY = false;

// ---- UI要素 ----
const form = document.getElementById('searchForm');
const keywordInput = document.getElementById('keyword');
const cards = document.getElementById('cards');
const detailDialog = document.getElementById('detailDialog');
const detailBody = document.getElementById('detailBody');
const detailClose = document.getElementById('detailClose');

// ---- 取得/整形ヘルパ ----
const limit = 500;
const yen = new Intl.NumberFormat('ja-JP');
const num = new Intl.NumberFormat('ja-JP');

function formatNum(v) {
  if (v === '' || v === undefined || v === null) return v ?? '';
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? num.format(n) : String(v);
}

function setBusy(b) { cards.setAttribute('aria-busy', b ? 'true' : 'false'); }

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isImageLikeUrl(s) {
  const v = String(s || '');
  return /^https?:\/\//i.test(v) &&
         (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(v) || /dropbox\.com/i.test(v) || /dropboxusercontent\.com/i.test(v));
}
function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }

// レコードから共有URL（画像URL候補）を抽出
function findImageUrlsFromRecord(detail) {
  const urls = [];

  // 指定フィールドを優先
  for (const code of IMAGE_FIELDS) {
    const cell = detail?.[code];
    const raw  = cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell;
    if (isImageLikeUrl(raw)) urls.push(String(raw).trim());
  }

  // 見つからなければ全フィールドからURLらしき文字列を拾う
  if (urls.length === 0) {
    for (const cell of Object.values(detail || {})) {
      const raw = cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell;
      if (isImageLikeUrl(raw)) urls.push(String(raw).trim());
    }
  }
  return uniq(urls);
}

// 共有URL/直リンクを「Dropboxプレビュー用URL（www.dropbox.com）」へ変換（クリック先用）
function toDropboxPreviewUrl(u) {
  try {
    const url = new URL(String(u).trim());
    if (url.hostname.endsWith('dropboxusercontent.com')) {
      url.hostname = 'www.dropbox.com';
    }
    if (url.hostname
