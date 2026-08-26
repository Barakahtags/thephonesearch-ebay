const PAGE_SIZE = 100;
const MAX_PAGES_PER_TYPE = 250;

function json(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'access-control-allow-headers': 'content-type,x-admin-token',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'cache-control': 'no-store'
    }
  });
}

async function sameSecret(actual, expected) {
  const encoder = new TextEncoder();
  const a = encoder.encode(String(actual || ''));
  const b = encoder.encode(String(expected || ''));
  if (a.byteLength !== b.byteLength) return false;
  const key = await crypto.subtle.importKey('raw', b, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const [left, right] = await Promise.all([
    crypto.subtle.sign('HMAC', key, a),
    crypto.subtle.sign('HMAC', key, b)
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let mismatch = 0;
  for (let i = 0; i < x.length; i += 1) mismatch |= x[i] ^ y[i];
  return mismatch === 0;
}

async function fetchPage(env, articleType, page) {
  const url = new URL('/api/catalog', env.DASHBOARD_ORIGIN);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  url.searchParams.set('articleType', String(articleType));
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'x-admin-token': env.TPS_ADMIN_TOKEN }
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!response.ok || !body?.ok) {
    throw new Error(`Catalogue ${articleType}/${page} failed (${response.status}): ${body?.error || text.slice(0, 300)}`);
  }
  return body;
}

async function syncCatalogue(env) {
  const startedAt = new Date().toISOString();
  await env.DB.prepare("UPDATE sync_state SET status='running', started_at=?, error=NULL WHERE id=1")
    .bind(startedAt).run();
  const seen = new Set();
  let newItems = 0;
  try {
    for (const articleType of [1, 3]) {
      for (let page = 1; page <= MAX_PAGES_PER_TYPE; page += 1) {
        const result = await fetchPage(env, articleType, page);
        const rows = Array.isArray(result.items) ? result.items : [];
        for (const item of rows) {
          const sku = String(item.sku || '').trim();
          if (!sku || seen.has(sku)) continue;
          seen.add(sku);
          const old = await env.DB.prepare('SELECT sku FROM products WHERE sku=?').bind(sku).first();
          if (!old) newItems += 1;
          const stock = Math.max(0, Math.floor(Number(item.stock || 0)));
          await env.DB.prepare(`
            INSERT INTO products
              (sku, article_type, supplier_title, manufacturer, stock, supplier_payload, first_seen_at, last_seen_at, out_of_stock_at, is_new)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ?=0 THEN ? ELSE NULL END, 1)
            ON CONFLICT(sku) DO UPDATE SET
              article_type=excluded.article_type,
              supplier_title=excluded.supplier_title,
              manufacturer=excluded.manufacturer,
              stock=excluded.stock,
              supplier_payload=excluded.supplier_payload,
              last_seen_at=excluded.last_seen_at,
              out_of_stock_at=CASE
                WHEN excluded.stock=0 THEN COALESCE(products.out_of_stock_at, excluded.last_seen_at)
                ELSE NULL
              END
          `).bind(sku, articleType, item.title || '', item.manufacturer || '', stock,
            JSON.stringify(item), startedAt, startedAt, stock, startedAt).run();
        }
        if (!result.hasMore) break;
      }
    }

    if (seen.size) {
      await env.DB.prepare('UPDATE products SET stock=0, out_of_stock_at=COALESCE(out_of_stock_at, ?) WHERE last_seen_at<>?')
        .bind(startedAt, startedAt).run();
    }
    const out = await env.DB.prepare('SELECT COUNT(*) AS count FROM products WHERE stock=0').first();
    await env.DB.prepare(`UPDATE sync_state SET status='ok', finished_at=?, products_seen=?, new_items=?, out_of_stock_items=?, error=NULL WHERE id=1`)
      .bind(new Date().toISOString(), seen.size, newItems, Number(out?.count || 0)).run();
    console.log(JSON.stringify({ event: 'catalogue_sync', ok: true, seen: seen.size, newItems, outOfStock: Number(out?.count || 0) }));
    return { ok: true, productsSeen: seen.size, newItems, outOfStock: Number(out?.count || 0), eBayWrites: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE sync_state SET status='error', finished_at=?, error=? WHERE id=1")
      .bind(new Date().toISOString(), message.slice(0, 1000)).run();
    console.error(JSON.stringify({ event: 'catalogue_sync', ok: false, error: message }));
    throw error;
  }
}

async function listProducts(request, env) {
  const url = new URL(request.url);
  const view = url.searchParams.get('view') || 'all';
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
  const where = view === 'new' ? 'WHERE is_new=1 AND stock>0' : view === 'out' ? 'WHERE stock=0' : '';
  const [rows, count, state] = await Promise.all([
    env.DB.prepare(`SELECT supplier_payload, first_seen_at, last_seen_at, out_of_stock_at, is_new FROM products ${where} ORDER BY first_seen_at DESC LIMIT ? OFFSET ?`).bind(limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM products ${where}`).first(),
    env.DB.prepare('SELECT * FROM sync_state WHERE id=1').first()
  ]);
  const items = (rows.results || []).map((row) => ({
    ...JSON.parse(row.supplier_payload),
    isNew: row.is_new === 1,
    outOfStock: Boolean(row.out_of_stock_at),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    outOfStockAt: row.out_of_stock_at
  }));
  return json({ ok: true, view, total: Number(count?.count || 0), limit, offset, items, sync: state }, 200, env.DASHBOARD_ORIGIN);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return json({ ok: true }, 200, env.DASHBOARD_ORIGIN);
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      const state = await env.DB.prepare('SELECT * FROM sync_state WHERE id=1').first();
      return json({ ok: true, service: 'ThePhoneSearch stock monitor', sync: state, eBayWrites: false });
    }
    if (url.pathname === '/products' && request.method === 'GET') return listProducts(request, env);
    if (url.pathname === '/sync' && request.method === 'POST') {
      if (!(await sameSecret(request.headers.get('x-admin-token'), env.TPS_ADMIN_TOKEN))) return json({ ok: false, error: 'Unauthorized' }, 401);
      const result = await syncCatalogue(env);
      return json(result);
    }
    return json({ ok: false, error: 'Not found' }, 404);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(syncCatalogue(env));
  }
};
