import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BASE  = process.env.KINTONE_BASE_URL;      // 例: https://xxx.cybozu.com
const APP_ID = process.env.KINTONE_APP_ID;       // 数値 or 文字列
const TOKEN  = process.env.KINTONE_API_TOKEN;    // APIトークン
const GUEST  = process.env.KINTONE_GUEST_SPACE_ID;

if (!BASE || !APP_ID || !TOKEN) {
  console.error('[ENV ERROR] KINTONE_BASE_URL, KINTONE_APP_ID, KINTONE_API_TOKEN は必須');
  process.exit(1);
}

// フィールドコード（.env で上書き可：FIELD_CODE_CODE / FIELD_CODE_NAME / FIELD_CODE_PRICE）
const FIELDS = {
  CODE: process.env.FIELD_CODE_CODE  || '商品コード',
  NAME: process.env.FIELD_CODE_NAME  || '商品名',
  PRICE: process.env.FIELD_CODE_PRICE || '上代',
};

function getRecordsEndpoint() {
  return GUEST
    ? `${BASE}/k/guest/${GUEST}/v1/records.json`
    : `${BASE}/k/v1/records.json`;
}

// 検索API：商品コード/商品名/上代（3列＋$idを返す）
app.get('/api/search', async (req, res) => {
  try {
    const { keyword = '', limit = 50, offset = 0, order = '更新日時 desc' } = req.query;

    const maybeNumber = Number(keyword);
    const priceCond = Number.isFinite(maybeNumber) ? `${FIELDS.PRICE} = ${maybeNumber}` : '';

    const q = keyword
      ? [ `${FIELDS.CODE} like "${keyword}"`,
          `${FIELDS.NAME} like "${keyword}"`,
          priceCond
        ].filter(Boolean).join(' or ')
      : '';

    const params = {
      app: APP_ID,
      query: [q, `order by ${order}`, `limit ${Number(limit)}`, `offset ${Number(offset)}`]
              .filter(Boolean).join(' '),
     fields: ['$id', 'レコード番号',FIELDS.CODE, FIELDS.NAME, FIELDS.PRICE,'記号', '内箱入数', 'ロケーション', '差引実']
    };

    const resp = await axios.get(getRecordsEndpoint(), {
      headers: { 'X-Cybozu-API-Token': TOKEN },
      params,
    });

    res.json({
      ok: true,
      totalCount: resp.data.totalCount ?? undefined,
      records: resp.data.records || [],
      nextOffset: Number(offset) + Number(limit)
    });
  } catch (err) {
    res.status(err.response?.status || 500).json({ ok: false, error: err.response?.data || err.message });
  }
});

// 詳細API：行クリック時に $id で1件取得
app.get('/api/record', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ ok:false, error:'id is required' });
  try {
    const params = { app: APP_ID, query: `$id = ${Number(id)} limit 1` };
    const resp = await axios.get(getRecordsEndpoint(), {
      headers: { 'X-Cybozu-API-Token': TOKEN },
      params
    });
    const rec = (resp.data.records || [])[0];
    res.json({ ok:true, record: rec || null });
  } catch (err) {
    res.status(err.response?.status || 500).json({ ok:false, error: err.response?.data || err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running: http://localhost:${port}`));
