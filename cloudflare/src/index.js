const PAGE_SIZE = 100;
// MobileParts currently reports more than 500 pages for Ersatzteile. Keep a
// defensive ceiling, but never truncate the legitimate supplier feed at 250.
const MAX_PAGES_PER_TYPE = 1000;
// D1 limits the total bound values accepted by a single batch request.  A page
// can generate both product writes and stock events, so submit small batches.
const D1_BATCH_SIZE = 20;
const D1_LOOKUP_SIZE = 50;

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
  const now = new Date().toISOString();
  const state = await env.DB.prepare('SELECT * FROM sync_state WHERE id=1').first();
  const articleType = Number(state?.cursor_type || 1) === 3 ? 3 : 1;
  const page = Math.max(1, Number(state?.cursor_page || 1));
  const cycleStartedAt = state?.cycle_started_at || now;
  const previousSeen = Number(state?.products_seen || 0);
  await env.DB.prepare("UPDATE sync_state SET status='running', started_at=COALESCE(started_at, ?), cycle_started_at=?, error=NULL WHERE id=1")
    .bind(now, cycleStartedAt).run();
  try {
    const result = await fetchPage(env, articleType, page);
    const unique = new Map();
    for (const item of Array.isArray(result.items) ? result.items : []) {
      const sku = String(item.sku || '').trim();
      if (sku) unique.set(sku, item);
    }
    const skus = [...unique.keys()];
    const oldBySku = new Map();
    for (let index = 0; index < skus.length; index += D1_LOOKUP_SIZE) {
      const skuBatch = skus.slice(index, index + D1_LOOKUP_SIZE);
      const placeholders = skuBatch.map(() => '?').join(',');
      const oldRows = await env.DB.prepare(`SELECT sku, stock FROM products WHERE sku IN (${placeholders})`).bind(...skuBatch).all();
      for (const old of oldRows.results || []) oldBySku.set(old.sku, old);
    }
    const writes = [];
    let newOnPage = 0;
    for (const [sku, item] of unique) {
      const old = oldBySku.get(sku);
      const stock = Math.max(0, Math.floor(Number(item.stock || 0)));
      if (!old) newOnPage += 1;
      writes.push(env.DB.prepare(`INSERT INTO products
        (sku, article_type, supplier_title, manufacturer, stock, supplier_payload, first_seen_at, last_seen_at, out_of_stock_at, is_new)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ?=0 THEN ? ELSE NULL END, ?)
        ON CONFLICT(sku) DO UPDATE SET article_type=excluded.article_type,
        supplier_title=excluded.supplier_title, manufacturer=excluded.manufacturer,
        stock=excluded.stock, supplier_payload=excluded.supplier_payload,
        last_seen_at=excluded.last_seen_at,
        out_of_stock_at=CASE WHEN excluded.stock=0 THEN COALESCE(products.out_of_stock_at, excluded.last_seen_at) ELSE NULL END`)
        .bind(sku, articleType, item.title || '', item.manufacturer || '', stock,
          JSON.stringify(item), now, cycleStartedAt, stock, now, previousSeen > 0 ? 1 : 0));
      if (!old) {
        if (previousSeen > 0) {
          writes.push(env.DB.prepare("INSERT INTO sync_events (event_type, sku, current_stock, details, created_at) VALUES ('NEW_ITEM', ?, ?, ?, ?)")
            .bind(sku, stock, item.title || '', now));
        }
      } else if (Number(old.stock) !== stock) {
        const eventType = stock === 0 ? 'OUT_OF_STOCK' : Number(old.stock) === 0 ? 'RESTOCKED' : 'STOCK_CHANGED';
        writes.push(env.DB.prepare('INSERT INTO sync_events (event_type, sku, previous_stock, current_stock, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(eventType, sku, Number(old.stock), stock, now));
      }
    }
    for (let index = 0; index < writes.length; index += D1_BATCH_SIZE) {
      await env.DB.batch(writes.slice(index, index + D1_BATCH_SIZE));
    }

    const typeFinished = !result.hasMore || page >= MAX_PAGES_PER_TYPE;
    if (!typeFinished || articleType === 1) {
      const nextType = typeFinished ? 3 : articleType;
      const nextPage = typeFinished ? 1 : page + 1;
      const expected = articleType === 1 ? Math.max(Number(state?.expected_supplier_total || 0), Number(result.total || 0)) : Number(state?.expected_supplier_total || 0);
      const excluded = Math.max(0, Number(result.excludedOnPage || 0));
      const received = unique.size + excluded;
      await env.DB.prepare("UPDATE sync_state SET status='running', cursor_type=?, cursor_page=?, new_items=new_items+?, expected_supplier_total=?, pages_completed=pages_completed+1, last_page_received=?, last_page_accepted=?, last_page_added=?, last_page_excluded=?, error=NULL WHERE id=1")
        .bind(nextType, nextPage, previousSeen > 0 ? newOnPage : 0, expected, received, unique.size, newOnPage, excluded).run();
      return { ok: true, continuing: true, articleType, page, nextType, nextPage, stored: unique.size, eBayWrites: false };
    }

    const seenRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM products WHERE last_seen_at=?').bind(cycleStartedAt).first();
    const seen = Number(seenRow?.count || 0);
    const minimumSafeCount = previousSeen > 0 ? Math.max(1, Math.floor(previousSeen * 0.8)) : 1;
    if (previousSeen > 0 && seen < minimumSafeCount) {
      const reason = `Safety block: supplier returned ${seen} products; expected at least ${minimumSafeCount} from previous ${previousSeen}`;
      await env.DB.prepare("UPDATE sync_state SET status='safety_blocked', finished_at=?, previous_products_seen=?, safety_blocked=1, error=?, cursor_type=1, cursor_page=1, cycle_started_at=NULL WHERE id=1")
        .bind(now, previousSeen, reason).run();
      throw new Error(reason);
    }
    if (seen) await env.DB.prepare('UPDATE products SET stock=0, out_of_stock_at=COALESCE(out_of_stock_at, ?) WHERE last_seen_at<>?').bind(now, cycleStartedAt).run();
    const out = await env.DB.prepare('SELECT COUNT(*) AS count FROM products WHERE stock=0').first();
    const newTotal = previousSeen > 0 ? Number(state?.new_items || 0) + newOnPage : 0;
    await env.DB.prepare(`UPDATE sync_state SET status='ok', finished_at=?, previous_products_seen=?, products_seen=?, new_items=?, out_of_stock_items=?, safety_blocked=0, error=NULL, cursor_type=1, cursor_page=1, cycle_started_at=NULL, started_at=NULL, pages_completed=pages_completed+1 WHERE id=1`)
      .bind(now, previousSeen, seen, newTotal, Number(out?.count || 0)).run();
    return { ok: true, cycleComplete: true, productsSeen: seen, newItems: newTotal, outOfStock: Number(out?.count || 0), eBayWrites: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE sync_state SET status=CASE WHEN status='safety_blocked' THEN status ELSE 'error' END, finished_at=?, error=? WHERE id=1")
      .bind(now, message.slice(0, 1000)).run();
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
      r.ebay_title, r.ebay_description, r.review_status, r.content_source, r.updated_at AS review_updated_at,
      r.calculated_price, r.buyer_total, r.pricing_json, r.competitor_pricing_json,
      r.listing_status, r.auto_processed_at, r.auto_error
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
      updatedAt: row.review_updated_at || null,
      calculatedPrice: row.calculated_price,
      buyerTotal: row.buyer_total,
      pricing: row.pricing_json ? JSON.parse(row.pricing_json) : null,
      competitorPricing: row.competitor_pricing_json ? JSON.parse(row.competitor_pricing_json) : null,
      listingStatus: row.listing_status || null,
      autoProcessedAt: row.auto_processed_at || null,
      autoError: row.auto_error || null
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
      (sku, ebay_title, ebay_description, review_status, content_source, updated_at,
       calculated_price, buyer_total, pricing_json, competitor_pricing_json, listing_status, auto_processed_at, auto_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sku) DO UPDATE SET ebay_title=excluded.ebay_title,
      ebay_description=excluded.ebay_description, review_status=excluded.review_status,
      content_source=excluded.content_source, updated_at=excluded.updated_at,
      calculated_price=excluded.calculated_price, buyer_total=excluded.buyer_total,
      pricing_json=excluded.pricing_json, competitor_pricing_json=excluded.competitor_pricing_json,
      listing_status=excluded.listing_status, auto_processed_at=excluded.auto_processed_at,
      auto_error=excluded.auto_error`)
      .bind(sku, String(review.title || '').slice(0, 80), String(review.description || '').slice(0, 100000), status, String(review.contentSource || ''), now,
        Number.isFinite(Number(review.calculatedPrice)) ? Number(review.calculatedPrice) : null,
        Number.isFinite(Number(review.buyerTotal)) ? Number(review.buyerTotal) : null,
        review.pricing ? JSON.stringify(review.pricing) : null,
        review.competitorPricing ? JSON.stringify(review.competitorPricing) : null,
        String(review.listingStatus || ''), String(review.autoProcessedAt || ''), String(review.autoError || '').slice(0, 2000)).run();
    saved += 1;
  }
  return json({ ok: true, saved, updatedAt: now }, 200, env.DASHBOARD_ORIGIN);
}

async function listEvents(request, env) {
  const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get('limit') || 50)));
  const rows = await env.DB.prepare('SELECT * FROM sync_events ORDER BY created_at DESC LIMIT ?').bind(limit).all();
  return json({ ok: true, events: rows.results || [] }, 200, env.DASHBOARD_ORIGIN);
}

async function pendingAI(request, env) {
  const limit = Math.min(5, Math.max(1, Number(new URL(request.url).searchParams.get('limit') || 1)));
  const [rows, count] = await Promise.all([
    env.DB.prepare(`SELECT p.supplier_payload FROM products p
      LEFT JOIN listing_reviews r ON r.sku=p.sku
      WHERE p.stock>0 AND (r.auto_processed_at IS NULL OR r.auto_processed_at='')
      ORDER BY p.first_seen_at ASC LIMIT ?`).bind(limit).all(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM products p
      LEFT JOIN listing_reviews r ON r.sku=p.sku
      WHERE p.stock>0 AND (r.auto_processed_at IS NULL OR r.auto_processed_at='')`).first()
  ]);
  return json({ok:true,remaining:Number(count?.count||0),items:(rows.results||[]).map(row=>JSON.parse(row.supplier_payload))},200,env.DASHBOARD_ORIGIN);
}

async function triggerAutomaticAI(env) {
  try {
    const response = await fetch(`${env.DASHBOARD_ORIGIN}/api/auto-enrich`, {method:'POST',headers:{'x-admin-token':env.TPS_ADMIN_TOKEN}});
    if (!response.ok) console.error(JSON.stringify({event:'automatic_ai',ok:false,status:response.status,error:await response.text()}));
  } catch (error) {
    console.error(JSON.stringify({event:'automatic_ai',ok:false,error:String(error?.message||error)}));
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return json({ ok: true }, 200, env.DASHBOARD_ORIGIN);
    const url = new URL(request.url);
    if (url.pathname === '/public-health' && request.method === 'GET') {
      const [state, totals] = await Promise.all([
        env.DB.prepare('SELECT status, finished_at, products_seen, new_items, out_of_stock_items, safety_blocked, error, cursor_type, cursor_page, cycle_started_at, expected_supplier_total, pages_completed, last_page_received, last_page_accepted, last_page_added, last_page_excluded FROM sync_state WHERE id=1').first(),
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
    if (url.pathname === '/ai-pending' && request.method === 'GET') return pendingAI(request, env);
    if (url.pathname === '/events' && request.method === 'GET') return listEvents(request, env);
    if (url.pathname === '/sync' && request.method === 'POST') {
      const result = await syncCatalogue(env);
      return json(result);
    }
    return json({ ok: false, error: 'Not found' }, 404);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async()=>{try{await syncCatalogue(env)}catch(error){console.error(JSON.stringify({event:'scheduled_sync',ok:false,error:String(error?.message||error)}))}await triggerAutomaticAI(env)})());
  }
};
