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

async function isAuthorized(request, env) {
  const token = String(request.headers.get('x-admin-token') || '');
  if (!token) return false;
  if (await sameSecret(token, env.TPS_ADMIN_TOKEN)) return true;
  try {
    const url = new URL('/api/status', env.DASHBOARD_ORIGIN);
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', 'x-admin-token': token }
    });
    return response.ok;
  } catch {
    return false;
  }
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
  const previousState = await env.DB.prepare('SELECT products_seen FROM sync_state WHERE id=1').first();
  const previousSeen = Number(previousState?.products_seen || 0);
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
          const old = await env.DB.prepare('SELECT sku, stock, out_of_stock_at FROM products WHERE sku=?').bind(sku).first();
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
          if (!old) {
            await env.DB.prepare("INSERT INTO sync_events (event_type, sku, current_stock, details, created_at) VALUES ('NEW_ITEM', ?, ?, ?, ?)")
              .bind(sku, stock, item.title || '', startedAt).run();
          } else if (Number(old.stock) !== stock) {
            const eventType = stock === 0 ? 'OUT_OF_STOCK' : Number(old.stock) === 0 ? 'RESTOCKED' : 'STOCK_CHANGED';
            await env.DB.prepare('INSERT INTO sync_events (event_type, sku, previous_stock, current_stock, created_at) VALUES (?, ?, ?, ?, ?)')
              .bind(eventType, sku, Number(old.stock), stock, startedAt).run();
          }
        }
        if (!result.hasMore) break;
      }
    }

    const minimumSafeCount = previousSeen > 0 ? Math.max(1, Math.floor(previousSeen * 0.8)) : 1;
    if (previousSeen > 0 && seen.size < minimumSafeCount) {
      const reason = `Safety block: supplier returned ${seen.size} products; expected at least ${minimumSafeCount} from previous ${previousSeen}`;
      await env.DB.prepare("UPDATE sync_state SET status='safety_blocked', finished_at=?, previous_products_seen=?, safety_blocked=1, error=? WHERE id=1")
        .bind(new Date().toISOString(), previousSeen, reason).run();
      await env.DB.prepare("INSERT INTO sync_events (event_type, details, created_at) VALUES ('SYNC_SAFETY_BLOCKED', ?, ?)")
        .bind(reason, startedAt).run();
      throw new Error(reason);
    }
    if (seen.size) {
      await env.DB.prepare('UPDATE products SET stock=0, out_of_stock_at=COALESCE(out_of_stock_at, ?) WHERE last_seen_at<>?')
        .bind(startedAt, startedAt).run();
    }
    const out = await env.DB.prepare('SELECT COUNT(*) AS count FROM products WHERE stock=0').first();
    await env.DB.prepare(`UPDATE sync_state SET status='ok', finished_at=?, previous_products_seen=?, products_seen=?, new_items=?, out_of_stock_items=?, safety_blocked=0, error=NULL WHERE id=1`)
      .bind(new Date().toISOString(), previousSeen, seen.size, newItems, Number(out?.count || 0)).run();
    console.log(JSON.stringify({ event: 'catalogue_sync', ok: true, seen: seen.size, newItems, outOfStock: Number(out?.count || 0) }));
    return { ok: true, productsSeen: seen.size, newItems, outOfStock: Number(out?.count || 0), eBayWrites: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE sync_state SET status=CASE WHEN status='safety_blocked' THEN status ELSE 'error' END, finished_at=?, error=? WHERE id=1")
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
    env.DB.prepare(`SELECT p.supplier_payload, p.first_seen_at, p.last_seen_at, p.out_of_stock_at, p.is_new,
      r.ebay_title, r.ebay_description, r.review_status, r.content_source, r.updated_at AS review_updated_at
      FROM products p LEFT JOIN listing_reviews r ON r.sku=p.sku ${where.replaceAll('stock','p.stock').replaceAll('is_new','p.is_new')}
      ORDER BY p.first_seen_at DESC LIMIT ? OFFSET ?`).bind(limit, offset).all(),
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
    ,review: {
      title: row.ebay_title || '',
      description: row.ebay_description || '',
      status: row.review_status || 'review',
      contentSource: row.content_source || '',
      updatedAt: row.review_updated_at || null
    }
  }));
  return json({ ok: true, view, total: Number(count?.count || 0), limit, offset, items, sync: state }, 200, env.DASHBOARD_ORIGIN);
}

async function saveReviews(request, env) {
  const body = await request.json();
  const reviews = Array.isArray(body?.reviews) ? body.reviews.slice(0, 200) : [];
  if (!reviews.length) return json({ ok: false, error: 'No reviews supplied' }, 400, env.DASHBOARD_ORIGIN);
  const now = new Date().toISOString();
  let saved = 0;
  for (const review of reviews) {
    const sku = String(review?.sku || '').trim();
    if (!sku) continue;
    const exists = await env.DB.prepare('SELECT sku FROM products WHERE sku=?').bind(sku).first();
    if (!exists) continue;
    const status = ['review', 'approved', 'skipped'].includes(review.status) ? review.status : 'review';
    await env.DB.prepare(`INSERT INTO listing_reviews
      (sku, ebay_title, ebay_description, review_status, content_source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(sku) DO UPDATE SET ebay_title=excluded.ebay_title,
      ebay_description=excluded.ebay_description, review_status=excluded.review_status,
      content_source=excluded.content_source, updated_at=excluded.updated_at`)
      .bind(sku, String(review.title || '').slice(0, 80), String(review.description || '').slice(0, 100000), status, String(review.contentSource || ''), now).run();
    saved += 1;
  }
  return json({ ok: true, saved, updatedAt: now }, 200, env.DASHBOARD_ORIGIN);
}

async function listEvents(request, env) {
  const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get('limit') || 50)));
  const rows = await env.DB.prepare('SELECT * FROM sync_events ORDER BY created_at DESC LIMIT ?').bind(limit).all();
  return json({ ok: true, events: rows.results || [] }, 200, env.DASHBOARD_ORIGIN);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return json({ ok: true }, 200, env.DASHBOARD_ORIGIN);
    const url = new URL(request.url);
    if (url.pathname === '/public-health' && request.method === 'GET') {
      const [state, totals] = await Promise.all([
        env.DB.prepare('SELECT status, finished_at, products_seen, new_items, out_of_stock_items, safety_blocked, error FROM sync_state WHERE id=1').first(),
        env.DB.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN stock>0 THEN 1 ELSE 0 END) AS in_stock FROM products').first()
      ]);
      return json({
        ok: true,
        service: 'ThePhoneSearch stock monitor',
        catalogue: {
          total: Number(totals?.total || 0),
          inStock: Number(totals?.in_stock || 0)
        },
        sync: state,
        eBayWrites: false
      }, 200, env.DASHBOARD_ORIGIN);
    }
    const authorized = await isAuthorized(request, env);
    if (!authorized) return json({ ok: false, error: 'Unauthorized' }, 401, env.DASHBOARD_ORIGIN);
    if (url.pathname === '/health') {
      const state = await env.DB.prepare('SELECT * FROM sync_state WHERE id=1').first();
      return json({ ok: true, service: 'ThePhoneSearch stock monitor', sync: state, eBayWrites: false });
    }
    if (url.pathname === '/products' && request.method === 'GET') return listProducts(request, env);
    if (url.pathname === '/reviews' && request.method === 'POST') return saveReviews(request, env);
    if (url.pathname === '/events' && request.method === 'GET') return listEvents(request, env);
    if (url.pathname === '/sync' && request.method === 'POST') {
      const result = await syncCatalogue(env);
      return json(result);
    }
    return json({ ok: false, error: 'Not found' }, 404);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(syncCatalogue(env));
  }
};
