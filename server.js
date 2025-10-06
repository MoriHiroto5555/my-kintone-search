// server.js
import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// ==== 環境変数 ====
const BASE   = (process.env.KINTONE_BASE_URL || '').trim();          // 例: https://xxx.cybozu.com
const APP_ID = (process.env.KINTONE_APP_ID || '').trim();            // 数値 or 文字列
const TOKEN  = (process.env.KINTONE_API_TOKEN || '').trim();         // APIトークン
const GUEST  = (process.env.KINTONE_GUEST_SPACE_ID || '').trim();    // 任意

console.log('[ENV CHECK]', { BASE: !!BASE, APP_ID: !!APP_ID, TOKEN: !!TOKEN });
if (!BASE || !APP_ID || !TOKEN) {
  console.error('[ENV ERROR] KINTONE_BASE_URL, KINTONE_APP_ID, KINTONE_API_TOKEN は必須');
  process.exit(1);
}

// 検索カードで使うフィールドコード（必要なら .env で上書き）
const FIELDS = {
  CODE:  process.env.FIELD_CODE_CODE  || '商品コード',
  NAME:  process.env.FIELD_CODE_NAME  || '商品名',
  PRICE: process.env.FIELD_CODE_PRICE || '上代',
};

// kintone REST endpoint
function getRecordsEndpoint() {
  return GUEST
    ? `${BASE}/k/guest/${GUEST}/v1/records.json`
    : `${BASE}/k/v1/records.json`;
}

// --- Dropbox画像プロキシ（iOSでも確実に表示させる：MIME を明示） ---
function normalizeDropboxForFetch(href) {
  try {
    const u = new URL(String(href).trim());
    const host = u.hostname.toLowerCase();
    // Dropbox 以外は拒否（SSRF対策）
    if (host.endsWith('dropbox.com') || host.endsWith('dropboxusercontent.com')) {
      u.hostname = 'dl.dropboxusercontent.com';
      u.searchParams.delete('dl');           // dl=1 はダウンロードになることがある
      u.searchParams.set('raw', '1');        // インライン表示
      return u.toString();
    }
  } catch (_) {}
  return null;
}

function guessMimeFromExt(href) {
  try {
    const pathname = new URL(String(href)).pathname.toLowerCase();
    const ext = pathname.split('.').pop() || '';
    const map = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
      png: 'image/png', gif: 'image/gif', webp: 'image/webp',
      bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif',
      heic: 'image/heic'
    };
    return map[ext] || null;
  } catch { return null; }
}

app.get('/img', async (req, res) => {
  const href = req.query.url;
  if (!href) return res.status(400).send('url required');

  const finalUrl = normalizeDropboxForFetch(href);
  if (!finalUrl) return res.status(400).send('unsupported host');

  try {
    // arraybuffer で受け取り、Content-Type をこちらで決める
    const upstream = await axios.get(finalUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': 'kintone-image-proxy/1.0'
      }
    });

    // MIME の明示（Dropbox が octet-stream を返すことがある）
    let ctype = upstream.headers['content-type'];
    const guessed = guessMimeFromExt(href);
    if (!ctype || /octet-stream/i.test(ctype)) ctype = guessed || 'image/jpeg';

    res.setHeader('Content-Type', ctype);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const filename = encodeURIComponent(new URL(href).pathname.split('/').pop() || 'image');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${filename}`);

    res.end(Buffer.from(upstream.data));
  } catch (err) {
    res.status(err.response?.status || 502).send('image fetch failed');
  }
});

// ===== API: 動作確認 =====
app.get('/api/ping', (req, res) => res.json({ ok: true }));

// ===== API: 検索（カード用）=====
app.get('/api/search', async (req, res) => {
  try {
    const { keyword = '', limit = 50, offset = 0, order = '更新日時 desc' } = req.query;

    const q = keyword
      ? [
          `${FIELDS.CODE} like "${keyword}"`,
          `${FIELDS.NAME} like "${keyword}"`

        ].filter(Boolean).join(' or ')
      : '';

    const params = {
      app: APP_ID,
      query: [q, `order by ${order}`, `limit ${Number(limit)}`, `offset ${Number(offset)}`]
        .filter(Boolean).join(' '),
      fields: [
        '$id', 'レコード番号',
        FIELDS.CODE, FIELDS.NAME, FIELDS.PRICE,
        '記号', '内箱入数', 'ロケーション', '差引実', '商品CD'
      ],
    };

    const resp = await axios.get(getRecordsEndpoint(), {
      headers: { 'X-Cybozu-API-Token': TOKEN },
      params,
    });

    res.json({
      ok: true,
      totalCount: resp.data.totalCount ?? undefined,
      records: resp.data.records || [],
      nextOffset: Number(offset) + Number(limit),
    });
  } catch (err) {
    res.status(err.response?.status || 500).json({ ok: false, error: err.response?.data || err.message });
  }
});

// ===== API: 詳細（指定フィールドだけ取得可能）=====
app.get('/api/record', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ ok:false, error:'id is required' });

  try {
    const params = { app: APP_ID, query: `$id = ${Number(id)} limit 1` };

    // fields は "A,B" でも fields=A&fields=B... でもOK
    let fields = req.query.fields;
    if (Array.isArray(fields)) {
      params.fields = fields.map(s => String(s).trim()).filter(Boolean);
    } else if (typeof fields === 'string' && fields.trim()) {
      params.fields = fields.split(',').map(s => s.trim()).filter(Boolean);
    }

    const resp = await axios.get(getRecordsEndpoint(), {
      headers: { 'X-Cybozu-API-Token': TOKEN },
      params,
    });
    const rec = (resp.data.records || [])[0];
    res.json({ ok:true, record: rec || null });
  } catch (err) {
    res.status(err.response?.status || 500).json({ ok:false, error: err.response?.data || err.message });
  }
});

// 未定義の /api/* は JSON 404（HTML を返さない）
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'Not Found' });
});

// --- 最後に静的配信 ---
app.use(express.static(path.join(__dirname, 'public')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running: http://localhost:${port}`));
