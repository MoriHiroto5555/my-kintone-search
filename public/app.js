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

// ▼ 画像URLが入っているフィールドコード（文字列1行）
//   フィールド“名”ではなく“フィールドコード”を指定してください。
const IMAGE_FIELDS = ['DropBox'];

// 詳細モーダルに表示するフィールドコード（この順で表示）
const DETAIL_FIELDS = [
  '商品CD','商品名','上代','特別上代','記号','裸差引','詰差引','定番差引','差引実',
  '頁CD','行CD','ロケーション','荷姿','CT入数','内箱入数','JAN','主倉庫CD',
  '仕入先名','原産地','磁器陶器','材質_Bshop','材質備考_Bshop','容量_Bshop',
  '商品重量_Bshop','発注残','受注残合計'
];

// （任意）表示ラベルを変えたいときだけ指定。未指定はコード名をそのまま表示。
const DETAIL_LABELS = {
  // 例: '商品CD': '商品コード'
};

// フィールド別フォーマッタ
const yenFmt = new Intl.NumberFormat('ja-JP');
const numFmt = new Intl.NumberFormat('ja-JP');
const CURRENCY_FIELDS = new Set(['上代','特別上代']);
const NUMBER_FIELDS   = new Set(['裸差引','詰差引','定番差引','差引実','CT入数','内箱入数','商品重量_Bshop','発注残','受注残合計']);
// ※ JAN は先頭ゼロ保持のため数値化しません
function formatByField(code, raw) {
  if (raw === '' || raw === null || raw === undefined) return '';
  if (CURRENCY_FIELDS.has(code) && !isNaN(raw)) return `¥${yenFmt.format(Number(raw))}`;
  if (NUMBER_FIELDS.has(code)   && !isNaN(raw)) return numFmt.format(Number(String(raw).replace(/,/g,'')));
  return String(raw);
}

// 空欄の行は非表示（表示したいなら true）
const SHOW_EMPTY = false;

// ---- 既存UIロジック ----
const form = document.getElementById('searchForm');
const keywordInput = document.getElementById('keyword');
const cards = document.getElementById('cards');
const detailDialog = document.getElementById('detailDialog');
const detailBody = document.getElementById('detailBody');
const detailClose = document.getElementById('detailClose');

// 1回で取得する最大件数（必要に応じて調整）
const limit = 500;
const yen = new Intl.NumberFormat('ja-JP'); // 価格用
const num = new Intl.NumberFormat('ja-JP'); // 件数や在庫など一般数値用

function formatNum(v) {
  if (v === '' || v === undefined || v === null) return v ?? '';
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? num.format(n) : String(v);
}

async function search() {
  const keyword = keywordInput.value.trim();
  const params = new URLSearchParams({ keyword, limit, offset: 0 });
  setBusy(true);
  try {
    const resp = await fetch(`/api/search?${params.toString()}`);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error?.message || JSON.stringify(data.error));
    renderCards(data.records || []);
  } catch (e) {
    alert('検索に失敗しました\n' + e.message);
  } finally {
    setBusy(false);
  }
}

function renderCards(records) {
  cards.innerHTML = '';
  if (!records.length) {
    cards.innerHTML = '<p style="grid-column:1/-1; color:#64748b;">該当データがありません</p>';
    return;
  }
  for (const r of records) {
    const code     = r[FIELDS.CODE]?.value ?? '';
    const name     = r[FIELDS.NAME]?.value ?? '';
    const priceRaw = r[FIELDS.PRICE]?.value ?? '';
    const symbol   = r[FIELDS.SYMBOL]?.value ?? '';
    const innerQty = r[FIELDS.INNER_QTY]?.value ?? '';
    const location = r[FIELDS.LOCATION]?.value ?? '';
    const balance  = r[FIELDS.BALANCE]?.value ?? '';

    const price = priceRaw !== '' && !isNaN(priceRaw) ? `¥${yen.format(Number(priceRaw))}` : priceRaw;

    const card = document.createElement('div');
    card.className = 'card';
    card.tabIndex = 0;
    card.role = 'button';
    card.setAttribute('aria-label', `詳細を表示: ${name || code || '商品'}`);

    card.innerHTML = `
      <div class="card-header">
        <div class="code">${escapeHtml(code)}</div>
        <div class="price">${escapeHtml(price)}</div>
      </div>
      <div class="card-title">${escapeHtml(name)}</div>
      <div class="card-kvs">
        <div class="k">記号</div><div class="v">${escapeHtml(symbol)}</div>
        <div class="k">内箱入数</div><div class="v">${escapeHtml(formatNum(innerQty))}</div>
        <div class="k">ロケーション</div><div class="v">${escapeHtml(location)}</div>
        <div class="k">差引実</div><div class="v">${escapeHtml(formatNum(balance))}</div>
      </div>
      <div class="card-meta">クリックまたはEnterで詳細</div>
    `;

    card.addEventListener('click', () => openDetail(r));
    card.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDetail(r); }
    });

    cards.appendChild(card);
  }
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

// ---- Dropbox画像対応（ダウンロードさせない版：raw=1 を使用）----
function normalizeDropboxUrl(u) {
  try {
    const url = new URL(String(u).trim());
    if (url.hostname.endsWith('dropbox.com')) {
      // 画像表示用に dl.dropboxusercontent.com を使用し、強制DL(dl)は消して raw=1 でインライン表示
      url.hostname = 'dl.dropboxusercontent.com';
      url.searchParams.delete('dl');
      url.searchParams.set('raw', '1');
      return url.toString();
    }
    return url.toString();
  } catch {
    return String(u || '');
  }
}
function isImageLikeUrl(s) {
  const v = String(s || '');
  return /^https?:\/\//i.test(v) &&
         (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(v) || /dropbox\.com/i.test(v));
}
function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }
function findImageUrlsFromRecord(detail) {
  const urls = [];
  // まず指定フィールドから
  for (const code of IMAGE_FIELDS) {
    const cell = detail?.[code];
    const raw  = cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell;
    if (isImageLikeUrl(raw)) urls.push(normalizeDropboxUrl(raw));
  }
  // 指定が空/未検出なら自動検出（任意）
  if (urls.length === 0) {
    for (const cell of Object.values(detail || {})) {
      const raw = cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell;
      if (isImageLikeUrl(raw)) urls.push(normalizeDropboxUrl(raw));
    }
  }
  return uniq(urls);
}

// ---- 詳細モーダル ----
form.addEventListener('submit', (e) => { e.preventDefault(); search(); });

async function openDetail(record) {
  const rid = record?.$id?.value || record?.['レコード番号']?.value;
  let detail = record;

  try {
    if (rid) {
      // 詳細 + 画像フィールドだけ取得
      const fieldsToRequest = uniq([...(DETAIL_FIELDS || []), ...IMAGE_FIELDS]);
      const p = new URLSearchParams();
      p.set('id', rid);
      fieldsToRequest.forEach(f => p.append('fields', f)); // fields=A&fields=B... で送る
      const resp = await fetch(`/api/record?${p.toString()}`);
      const data = await resp.json();
      if (data?.ok && data.record) detail = data.record;
    }
  } catch (_) {}

  // 画像URLを抽出（Dropbox共有リンクは直リンク化：raw=1）
  const imageUrls = findImageUrlsFromRecord(detail);

  // 指定順でテーブル行を作成
  const rowsHtml = (DETAIL_FIELDS || []).map((code) => {
    const cell = detail?.[code];
    const raw  = (cell && typeof cell === 'object' && 'value' in cell) ? cell.value : '';
    if (!SHOW_EMPTY && (raw === '' || raw === null || raw === undefined)) return '';
    const label = (DETAIL_LABELS && DETAIL_LABELS[code]) || code;
    const val   = formatByField(code, raw);
    return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(val)}</td></tr>`;
  }).filter(Boolean).join('');

  // 画像があれば最上段に1行差し込む（表示は直リンク、クリックも同じ直リンク）
  const imagesRow = imageUrls.length
    ? `<tr class="detail-images-row">
         <td colspan="2">
           <div class="detail-images">
             ${imageUrls.map(src =>
               `<a href="${escapeHtml(src)}" target="_blank" rel="noopener">
                  <img src="${escapeHtml(src)}" alt="product image" loading="lazy" />
                </a>`
             ).join('')}
           </div>
         </td>
       </tr>`
    : '';

  detailBody.innerHTML = (imagesRow + rowsHtml) || '<tr><td colspan="2">詳細データがありません</td></tr>';
  if (detailDialog?.showModal) detailDialog.showModal();
}

detailClose?.addEventListener('click', () => detailDialog?.close && detailDialog.close());

// 初期表示
search();
