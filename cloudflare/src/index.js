const PAGE_SIZE = 100;
// MobileParts currently reports more than 500 pages for Ersatzteile. Keep a
// defensive ceiling, but never truncate the legitimate supplier feed at 250.
const MAX_PAGES_PER_TYPE = 1000;
// D1 limits the total bound values accepted by a single batch request.  A page
// can generate both product writes and stock events, so submit small batches.
const D1_BATCH_SIZE = 20;
const D1_LOOKUP_SIZE = 50;
// One scheduled invocation now advances several supplier pages while retaining
// a single D1 lease. This is deliberately bounded: it is materially faster
// than one page per minute without recreating the previous D1 CPU spikes.
const SCHEDULED_PAGES_PER_RUN = 3;
const SCHEDULED_SYNC_BUDGET_MS = 45_000;
// A completed catalogue is a snapshot, not a reason to immediately begin the
// same 500+ page import again. Stock monitoring continues on an hourly cycle.
const FULL_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const BANNED_BRAND_TERMS = ['promiz', 'all phones', 'minim', 'lifewire', 'impact', 'mobile skin', 'dust plug'];
const isBannedBrand = (item) => {
  const text = [item?.title, item?.manufacturer, item?.Description, item?.Manufacturer].join(' ').toLowerCase();
  return BANNED_BRAND_TERMS.some((brand) => text.includes(brand));
};
const isCompleteHandset = (item) => {
  const text = [item?.title, item?.manufacturer, item?.Description, item?.Manufacturer].join(' ').toLowerCase();
  const condition = /\b(?:slightly|intensively|lightly)?\s*used\b|\bgrade\s*[abc]\b|\brefurbished phone\b/.test(text);
  const storage = /\b\d{1,4}\s?gb\b/.test(text);
  const part = /\b(display|screen|lcd|oled|touchscreen|back\s*(?:cover|glass)|battery\s*cover|housing|frame|battery|akku|camera|charging|connector|flex|speaker|microphone|sim\s*(?:tray|reader)|button|key|adhesive|protector|case|cover)\b/.test(text);
  const phone = /\b(?:iphone|samsung|galaxy|xiaomi|redmi|poco|huawei|honor|google pixel|oneplus|oppo|nokia|sony|motorola|cat)\b/.test(text);
  return !part && (condition || storage && phone);
};
const catalogueQualitySql = (column = 'supplier_payload') =>
  `LOWER(${column}) NOT LIKE '%training%' AND LOWER(${column}) NOT LIKE '%e-learning%' AND LOWER(${column}) NOT LIKE '%course%' AND LOWER(${column}) NOT LIKE '%schulung%' AND LOWER(${column}) NOT LIKE '%opleiding%' AND LOWER(${column}) NOT LIKE '%longer delivery%' AND LOWER(${column}) NOT LIKE '%long delivery%' AND LOWER(${column}) NOT LIKE '%langere levertijd%' AND LOWER(${column}) NOT LIKE '%längere lieferzeit%' AND LOWER(${column}) NOT LIKE '%promiz%' AND LOWER(${column}) NOT LIKE '%all phones%' AND LOWER(${column}) NOT LIKE '%minim%' AND LOWER(${column}) NOT LIKE '%lifewire%' AND LOWER(${column}) NOT LIKE '%impact%'`;

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

async function syncCatalogue(env, options = {}) {
  const reuseLease = options.reuseLease === true;
  const releaseLease = options.releaseLease !== false;
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + 70_000).toISOString();
  if (!reuseLease) {
    const lock = await env.DB.prepare(`UPDATE sync_state
      SET status='running', started_at=COALESCE(started_at, ?), error=NULL, sync_lease_until=?
      WHERE id=1 AND (sync_lease_until IS NULL OR sync_lease_until < ?)`)
      .bind(now, leaseUntil, now).run();
    if (Number(lock.meta?.changes || 0) !== 1) {
      const state = await env.DB.prepare('SELECT status, cursor_type, cursor_page, sync_lease_until FROM sync_state WHERE id=1').first();
      return { ok: true, skipped: true, reason: 'A catalogue page is already importing', state, eBayWrites: false };
    }
  }
  const state = await env.DB.prepare('SELECT * FROM sync_state WHERE id=1').first();
  const articleType = Number(state?.cursor_type || 1) === 3 ? 3 : 1;
  const page = Math.max(1, Number(state?.cursor_page || 1));
  const activeCycle = Boolean(state?.cycle_started_at) && (articleType !== 1 || page > 1);
  // A safety-blocked catalogue must stay paused. Previously the cron changed
  // the status back to running and restarted another complete 515-page scan,
  // which could loop forever while the supplier population stayed lower. An
  // already-started verification cycle is allowed to finish from its cursor.
  if (Number(state?.safety_blocked || 0) === 1 && !activeCycle && options.allowSafetyRetry !== true) {
    const reason = String(state?.error || 'Safety review required before another full catalogue scan');
    await env.DB.prepare("UPDATE sync_state SET status='safety_blocked', error=?, sync_lease_until=NULL WHERE id=1")
      .bind(reason).run();
    return {ok:true,skipped:true,reason,requiresSafetyReview:true,state:{...state,status:'safety_blocked'},eBayWrites:false};
  }
  const finishedAt = Date.parse(String(state?.finished_at || ''));
  if (!activeCycle && Number(state?.safety_blocked || 0) === 0 && Number.isFinite(finishedAt) && Date.now() - finishedAt < FULL_SYNC_INTERVAL_MS) {
    const nextSyncAt = new Date(finishedAt + FULL_SYNC_INTERVAL_MS).toISOString();
    await env.DB.prepare("UPDATE sync_state SET status='ok', error=NULL, sync_lease_until=NULL WHERE id=1").run();
    return {ok:true,skipped:true,reason:'Catalogue is current',nextSyncAt,state:{...state,status:'ok'},eBayWrites:false};
  }
  const cycleStartedAt = state?.cycle_started_at || now;
  const previousSeen = Number(state?.products_seen || 0);
  const startsNewCycle = !state?.cycle_started_at && articleType === 1 && page === 1;
  await env.DB.prepare("UPDATE sync_state SET cycle_started_at=?, new_items=CASE WHEN ?=1 THEN 0 ELSE new_items END, sync_lease_until=? WHERE id=1")
    .bind(cycleStartedAt, startsNewCycle ? 1 : 0, leaseUntil).run();
  try {
    const result = await fetchPage(env, articleType, page);
    const unique = new Map();
    for (const item of Array.isArray(result.items) ? result.items : []) {
      if (isBannedBrand(item) || isCompleteHandset(item)) continue;
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
        writes.push(env.DB.prepare(`INSERT INTO stock_sync_queue
          (sku, supplier_stock, orderable, event_type, updated_at, attempts, last_error)
          VALUES (?, ?, ?, ?, ?, 0, NULL)
          ON CONFLICT(sku) DO UPDATE SET supplier_stock=excluded.supplier_stock,
          orderable=excluded.orderable, event_type=excluded.event_type,
          updated_at=excluded.updated_at, attempts=0, last_error=NULL`)
          .bind(sku, stock, item.orderable === false ? 0 : 1, eventType, now));
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
      await env.DB.prepare("UPDATE sync_state SET status='running', cursor_type=?, cursor_page=?, new_items=new_items+?, expected_supplier_total=?, pages_completed=pages_completed+1, last_page_received=?, last_page_accepted=?, last_page_added=?, last_page_excluded=?, error=NULL, sync_lease_until=? WHERE id=1")
        .bind(nextType, nextPage, previousSeen > 0 ? newOnPage : 0, expected, received, unique.size, newOnPage, excluded, releaseLease ? null : leaseUntil).run();
      return { ok: true, continuing: true, articleType, page, nextType, nextPage, stored: unique.size, eBayWrites: false };
    }

    const [seenRow, baselineRow] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS count FROM products WHERE last_seen_at=?').bind(cycleStartedAt).first(),
      // Compare like with like: the most recent completed/attempted filtered
      // catalogue population. products_seen may contain the old unfiltered
      // population and caused a false safety block after exclusions were added.
      env.DB.prepare(`SELECT last_seen_at, COUNT(*) AS count FROM products
        WHERE last_seen_at<>? GROUP BY last_seen_at ORDER BY last_seen_at DESC LIMIT 1`)
        .bind(cycleStartedAt).first()
    ]);
    const seen = Number(seenRow?.count || 0);
    const comparableBaseline = Number(baselineRow?.count || 0);
    const safetyBaseline = comparableBaseline > 0 ? comparableBaseline : previousSeen;
    const minimumSafeCount = safetyBaseline > 0 ? Math.max(1, Math.floor(safetyBaseline * 0.8)) : 1;
    if (safetyBaseline > 0 && seen < minimumSafeCount) {
      const reason = `Safety block: filtered supplier catalogue returned ${seen} products; expected at least ${minimumSafeCount} from comparable previous ${safetyBaseline}`;
      await env.DB.prepare("UPDATE sync_state SET status='safety_blocked', finished_at=?, previous_products_seen=?, safety_blocked=1, error=?, cursor_type=1, cursor_page=1, cycle_started_at=NULL, sync_lease_until=NULL WHERE id=1")
        .bind(now, previousSeen, reason).run();
      throw new Error(reason);
    }
    if (seen) {
      await env.DB.prepare(`INSERT OR REPLACE INTO stock_sync_queue
        (sku, supplier_stock, orderable, event_type, updated_at, attempts, last_error)
        SELECT sku, 0, 0, 'MISSING_FROM_SUPPLIER_FEED', ?, 0, NULL
        FROM products WHERE last_seen_at<>? AND stock>0`).bind(now, cycleStartedAt).run();
      await env.DB.prepare('UPDATE products SET stock=0, out_of_stock_at=COALESCE(out_of_stock_at, ?) WHERE last_seen_at<>?').bind(now, cycleStartedAt).run();
    }
    const out = await env.DB.prepare('SELECT COUNT(*) AS count FROM products WHERE stock=0').first();
    const newTotal = previousSeen > 0 ? Number(state?.new_items || 0) + newOnPage : 0;
    await env.DB.prepare(`UPDATE sync_state SET status='ok', finished_at=?, previous_products_seen=?, products_seen=?, new_items=?, out_of_stock_items=?, safety_blocked=0, error=NULL, cursor_type=1, cursor_page=1, cycle_started_at=NULL, started_at=NULL, sync_lease_until=NULL, pages_completed=pages_completed+1 WHERE id=1`)
      .bind(now, previousSeen, seen, newTotal, Number(out?.count || 0)).run();
    return { ok: true, cycleComplete: true, productsSeen: seen, newItems: newTotal, outOfStock: Number(out?.count || 0), eBayWrites: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE sync_state SET status=CASE WHEN status='safety_blocked' THEN status ELSE 'error' END, finished_at=?, error=?, sync_lease_until=NULL WHERE id=1")
      .bind(now, message.slice(0, 1000)).run();
    console.error(JSON.stringify({ event: 'catalogue_sync', ok: false, error: message }));
    throw error;
  }
}

async function syncCatalogueBurst(env, maxPages = SCHEDULED_PAGES_PER_RUN) {
  const startedAt = Date.now();
  const results = [];
  const pageLimit = Math.max(1, Math.min(5, Number(maxPages) || 1));
  for (let index = 0; index < pageLimit; index += 1) {
    const lastAllowedPage = index === pageLimit - 1 || Date.now() - startedAt >= SCHEDULED_SYNC_BUDGET_MS;
    const result = await syncCatalogue(env, {
      reuseLease: index > 0,
      releaseLease: lastAllowedPage
    });
    results.push(result);
    if (result.skipped || result.cycleComplete || lastAllowedPage) break;
  }
  const last = results[results.length - 1] || {ok: true, skipped: true};
  console.log(JSON.stringify({
    event: 'catalogue_sync_burst',
    ok: true,
    pagesProcessed: results.filter(item => !item.skipped).length,
    durationMs: Date.now() - startedAt,
    cursor: last.cycleComplete ? {articleType: 1, page: 1} : {articleType: last.nextType, page: last.nextPage}
  }));
  return {...last, pagesProcessedThisRun: results.filter(item => !item.skipped).length};
}

async function listProducts(request, env) {
  const url = new URL(request.url);
  const view = url.searchParams.get('view') || 'all';
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
  const quality = `(${catalogueQualitySql()})`;
  const viewFilter = view === 'out' ? 'stock=0' : view === 'new' ? 'is_new=1 AND stock>0' : 'stock>0';
  const where = `WHERE ${quality}${viewFilter?` AND ${viewFilter}`:''}`;
  const [rows, count, state] = await Promise.all([
    env.DB.prepare(`SELECT p.supplier_payload, p.first_seen_at, p.last_seen_at, p.out_of_stock_at, p.is_new,
      r.ebay_title, r.ebay_description, r.review_status, r.content_source, r.updated_at AS review_updated_at,
      r.calculated_price, r.buyer_total, r.pricing_json, r.competitor_pricing_json,
      r.listing_status, r.auto_processed_at, r.auto_error
      FROM products p LEFT JOIN listing_reviews r ON r.sku=p.sku ${where.replaceAll('supplier_payload','p.supplier_payload').replaceAll('stock','p.stock').replaceAll('is_new','p.is_new')}
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

// The dashboard uses this small delta feed after its initial load.  Reloading
// the whole catalogue every minute turned one open dashboard into thousands of
// Worker requests per hour and exhausted the free daily Worker allowance.
async function listChanges(request, env) {
  const url = new URL(request.url);
  const since = String(url.searchParams.get('since') || '1970-01-01T00:00:00.000Z');
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 200)));
  const quality = `(${catalogueQualitySql('p.supplier_payload')})`;
  const rows = await env.DB.prepare(`SELECT p.supplier_payload, p.first_seen_at, p.last_seen_at, p.out_of_stock_at, p.is_new,
      r.ebay_title, r.ebay_description, r.review_status, r.content_source, r.updated_at AS review_updated_at,
      r.calculated_price, r.buyer_total, r.pricing_json, r.competitor_pricing_json,
      r.listing_status, r.auto_processed_at, r.auto_error
      FROM products p LEFT JOIN listing_reviews r ON r.sku=p.sku
      WHERE ${quality} AND (p.last_seen_at>? OR p.out_of_stock_at>? OR r.updated_at>?)
      ORDER BY MAX(p.last_seen_at, COALESCE(p.out_of_stock_at,''), COALESCE(r.updated_at,'')) ASC LIMIT ?`)
    .bind(since, since, since, limit).all();
  const items = (rows.results || []).map((row) => ({
    ...JSON.parse(row.supplier_payload),
    isNew: row.is_new === 1,
    outOfStock: Boolean(row.out_of_stock_at),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    outOfStockAt: row.out_of_stock_at,
    review: {
      title: row.ebay_title || '', description: row.ebay_description || '', status: row.review_status || 'review',
      contentSource: row.content_source || '', updatedAt: row.review_updated_at || null,
      calculatedPrice: row.calculated_price, buyerTotal: row.buyer_total,
      pricing: row.pricing_json ? JSON.parse(row.pricing_json) : null,
      competitorPricing: row.competitor_pricing_json ? JSON.parse(row.competitor_pricing_json) : null,
      listingStatus: row.listing_status || null, autoProcessedAt: row.auto_processed_at || null,
      autoError: row.auto_error || null
    }
  }));
  return json({ ok: true, items, checkedAt: new Date().toISOString() }, 200, env.DASHBOARD_ORIGIN);
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
      ON CONFLICT(sku) DO UPDATE SET
      ebay_title=CASE WHEN excluded.ebay_title<>'' THEN excluded.ebay_title ELSE listing_reviews.ebay_title END,
      ebay_description=CASE WHEN excluded.ebay_description<>'' THEN excluded.ebay_description ELSE listing_reviews.ebay_description END,
      review_status=excluded.review_status,
      content_source=excluded.content_source, updated_at=excluded.updated_at,
      calculated_price=COALESCE(excluded.calculated_price, listing_reviews.calculated_price),
      buyer_total=COALESCE(excluded.buyer_total, listing_reviews.buyer_total),
      pricing_json=COALESCE(excluded.pricing_json, listing_reviews.pricing_json),
      competitor_pricing_json=COALESCE(excluded.competitor_pricing_json, listing_reviews.competitor_pricing_json),
      listing_status=CASE WHEN excluded.listing_status<>'' THEN excluded.listing_status ELSE listing_reviews.listing_status END,
      auto_processed_at=excluded.auto_processed_at,
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
  const limit = Math.min(30, Math.max(1, Number(new URL(request.url).searchParams.get('limit') || 10)));
  // A failed record must not sit at the head of the queue every minute. New or
  // outdated successful work is processed immediately; failures cool down for
  // one day before a retry so the rest of the catalogue can continue.
  const pendingCondition = `(
    r.sku IS NULL
    OR ((r.auto_processed_at IS NULL OR r.auto_processed_at='') AND (r.auto_error IS NULL OR r.auto_error=''))
    OR (r.pricing_json IS NOT NULL AND r.pricing_json NOT LIKE '%"pricingVersion":"ebay-lowest-undercut-v6"%')
    OR (r.ebay_description LIKE '%ThePhoneSearch%')
    OR (LOWER(p.supplier_payload) LIKE '%refurb%' AND (LOWER(r.ebay_title) LIKE 'for %' OR LOWER(r.ebay_title) LIKE 'für %'))
    OR (r.listing_status IN ('INSUFFICIENT_MARKET_DATA','FALLBACK_FIXED_PROFIT','MARKET_CHECK_ERROR') AND datetime(r.auto_processed_at)<=datetime('now','-1 day'))
    OR (r.auto_error IS NOT NULL AND r.auto_error<>'')
  )`;
  const [rows, count] = await Promise.all([
    env.DB.prepare(`SELECT p.supplier_payload FROM products p
      LEFT JOIN listing_reviews r ON r.sku=p.sku
      WHERE p.stock>0 AND ${catalogueQualitySql('p.supplier_payload')} AND ${pendingCondition}
      ORDER BY CASE WHEN r.listing_status IN ('INSUFFICIENT_MARKET_DATA','MARKET_CHECK_ERROR') THEN 0 ELSE 1 END, p.first_seen_at DESC LIMIT ?`).bind(limit).all(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM products p
      LEFT JOIN listing_reviews r ON r.sku=p.sku
      WHERE p.stock>0 AND ${catalogueQualitySql('p.supplier_payload')} AND ${pendingCondition}`).first()
  ]);
  return json({ok:true,remaining:Number(count?.count||0),items:(rows.results||[]).map(row=>JSON.parse(row.supplier_payload))},200,env.DASHBOARD_ORIGIN);
}

function recommendationText(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9+]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function exactModelMatch(title, model) {
  const haystack = recommendationText(title);
  const needle = recommendationText(model);
  if (!needle || needle.length < 3) return false;
  const index = haystack.indexOf(needle);
  if (index < 0) return false;
  const after = haystack.slice(index + needle.length).trim();
  const requestedTail = needle.split(' ').pop();
  const conflictingSuffix = /^(?:max|plus|ultra|pro|mini|lite|fe|5g|4g)\b/;
  return !conflictingSuffix.test(after) || ['max', 'plus', 'ultra', 'pro', 'mini', 'lite', 'fe', '5g', '4g'].includes(requestedTail);
}

function relatedPriority(currentPartType, title) {
  const text = recommendationText(title);
  const adhesive = /adhesive|klebe|glue|tape/.test(text);
  const back = /rear cover|back cover|back glass|battery cover|akkudeckel|ruckseite/.test(text);
  const display = /display|screen|lcd|oled|touchscreen/.test(text);
  const battery = /battery|akku/.test(text);
  const cameraGlass = /camera (?:glass|lens)|kameraglas/.test(text);
  const protector = /protector|schutzglas|tempered glass/.test(text);
  const tool = /tool|werkzeug|opening|spudger|screwdriver/.test(text);
  if (currentPartType === 'Display') return adhesive && !back ? 0 : protector ? 1 : battery ? 2 : back ? 3 : tool ? 4 : 9;
  if (currentPartType === 'Akkudeckel') return adhesive && back ? 0 : cameraGlass ? 1 : battery ? 2 : tool ? 3 : 9;
  if (currentPartType === 'Akku') return adhesive && battery ? 0 : back ? 1 : display ? 2 : tool ? 3 : 9;
  if (currentPartType === 'Kamera' || currentPartType === 'Kameraglas') return cameraGlass ? 0 : back ? 1 : adhesive ? 2 : tool ? 3 : 9;
  return adhesive ? 0 : battery ? 1 : display ? 2 : back ? 3 : tool ? 4 : 9;
}

async function recommendationsBatch(request, env) {
  const body = await request.json().catch(() => ({}));
  const requests = (Array.isArray(body?.requests) ? body.requests : []).slice(0, 20).map(item => ({
    sku: String(item?.sku || '').trim(),
    model: String(item?.model || '').trim().slice(0, 80),
    partType: String(item?.partType || '').trim().slice(0, 40)
  })).filter(item => item.sku && item.model.length >= 3);
  if (!requests.length) return json({ok: true, matches: {}}, 200, env.DASHBOARD_ORIGIN);
  const models = [...new Set(requests.map(item => item.model.toLowerCase()))];
  const clauses = models.map(() => "supplier_title LIKE ? ESCAPE '\\' COLLATE NOCASE").join(' OR ');
  const binds = models.map(model => `%${model.replace(/[\\%_]/g, '\\$&')}%`);
  const quality = `(${catalogueQualitySql()})`;
  const rows = await env.DB.prepare(`SELECT supplier_payload FROM products WHERE stock>0 AND ${quality} AND (${clauses}) LIMIT 800`).bind(...binds).all();
  const catalogue = (rows.results || []).map(row => {
    try { return JSON.parse(row.supplier_payload); } catch { return null; }
  }).filter(Boolean);
  const matches = {};
  for (const requestItem of requests) {
    matches[requestItem.sku] = catalogue
      .filter(item => String(item.sku || '') !== requestItem.sku && exactModelMatch(item.title, requestItem.model))
      .map(item => ({item, rank: relatedPriority(requestItem.partType, item.title)}))
      .filter(entry => entry.rank < 9)
      .sort((a, b) => a.rank - b.rank || Number(b.item.stock || 0) - Number(a.item.stock || 0))
      .slice(0, 8)
      .map(({item}) => ({sku: item.sku, title: item.title, manufacturer: item.manufacturer, stock: Number(item.stock || 0), imageUrl: Array.isArray(item.images) ? item.images[0] : '', costExVat: item.costExVat}));
  }
  return json({ok: true, matches}, 200, env.DASHBOARD_ORIGIN);
}

async function triggerAutomaticAI(env) {
  try {
    const response = await fetch(`${env.DASHBOARD_ORIGIN}/api/auto-enrich`, {method:'POST',headers:{'x-admin-token':env.TPS_ADMIN_TOKEN}});
    if (!response.ok) console.error(JSON.stringify({event:'automatic_ai',ok:false,status:response.status,error:await response.text()}));
  } catch (error) {
    console.error(JSON.stringify({event:'automatic_ai',ok:false,error:String(error?.message||error)}));
  }
}

async function flushStockQueue(env) {
  const pending = await env.DB.prepare('SELECT sku, supplier_stock, orderable FROM stock_sync_queue ORDER BY updated_at ASC LIMIT 25').all();
  const changes = (pending.results || []).map(row => ({sku: row.sku, stock: Number(row.supplier_stock || 0), orderable: row.orderable === 1}));
  if (!changes.length) return {ok: true, processed: 0};
  try {
    const response = await fetch(`${env.DASHBOARD_ORIGIN}/api/sync?action=stock-delta`, {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-admin-token': env.TPS_ADMIN_TOKEN},
      body: JSON.stringify({changes})
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch {}
    if (response.status === 403) return {ok: true, locked: true, processed: 0};
    if (!response.ok && response.status !== 207) throw new Error(body?.error || `Stock delta HTTP ${response.status}`);
    const completed = (body?.results || []).filter(item => item.ok).map(item => String(item.sku || '')).filter(Boolean);
    for (let index = 0; index < completed.length; index += D1_LOOKUP_SIZE) {
      const batch = completed.slice(index, index + D1_LOOKUP_SIZE);
      await env.DB.prepare(`DELETE FROM stock_sync_queue WHERE sku IN (${batch.map(() => '?').join(',')})`).bind(...batch).run();
    }
    const failed = (body?.results || []).filter(item => !item.ok);
    for (const item of failed) await env.DB.prepare('UPDATE stock_sync_queue SET attempts=attempts+1, last_error=? WHERE sku=?').bind(String(item.error || 'Stock update failed').slice(0, 1000), item.sku).run();
    return {ok: failed.length === 0, processed: completed.length, failed: failed.length};
  } catch (error) {
    console.error(JSON.stringify({event:'stock_queue',ok:false,error:String(error?.message||error)}));
    return {ok: false, processed: 0, error: String(error?.message || error)};
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return json({ ok: true }, 200, env.DASHBOARD_ORIGIN);
    const url = new URL(request.url);
    if (url.pathname === '/public-health' && request.method === 'GET') {
      // Keep the pricing counter public and read-only: it contains counts only,
      // never catalogue data or credentials.  The predicate intentionally
      // matches /ai-pending so "remaining" means work still in the live queue.
      const pendingCondition = `(r.sku IS NULL OR ((r.auto_processed_at IS NULL OR r.auto_processed_at='') AND (r.auto_error IS NULL OR r.auto_error='')) OR (r.pricing_json IS NOT NULL AND r.pricing_json NOT LIKE '%"pricingVersion":"ebay-lowest-undercut-v6"%') OR (r.ebay_description LIKE '%ThePhoneSearch%') OR (LOWER(p.supplier_payload) LIKE '%refurb%' AND (LOWER(r.ebay_title) LIKE 'for %' OR LOWER(r.ebay_title) LIKE 'für %')) OR (r.listing_status IN ('INSUFFICIENT_MARKET_DATA','FALLBACK_FIXED_PROFIT','MARKET_CHECK_ERROR') AND datetime(r.auto_processed_at)<=datetime('now','-1 day')) OR (r.auto_error IS NOT NULL AND r.auto_error<>'' AND datetime(r.auto_processed_at)<=datetime('now','-1 day')))`;
      const [state, totals, stockQueue, pricing] = await Promise.all([
        env.DB.prepare('SELECT status, finished_at, products_seen, new_items, out_of_stock_items, safety_blocked, error, cursor_type, cursor_page, cycle_started_at, expected_supplier_total, pages_completed, last_page_received, last_page_accepted, last_page_added, last_page_excluded FROM sync_state WHERE id=1').first(),
        env.DB.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN stock>0 THEN 1 ELSE 0 END) AS in_stock FROM products').first(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM stock_sync_queue').first(),
        env.DB.prepare(`SELECT COUNT(*) AS eligible, SUM(CASE WHEN ${pendingCondition} THEN 1 ELSE 0 END) AS remaining, SUM(CASE WHEN r.pricing_json LIKE '%"pricingVersion":"ebay-lowest-undercut-v6"%' AND r.calculated_price IS NOT NULL AND (r.auto_error IS NULL OR r.auto_error='') THEN 1 ELSE 0 END) AS priced, SUM(CASE WHEN r.auto_error IS NOT NULL AND r.auto_error<>'' THEN 1 ELSE 0 END) AS needs_review FROM products p LEFT JOIN listing_reviews r ON r.sku=p.sku WHERE p.stock>0 AND ${catalogueQualitySql('p.supplier_payload')}`).first()
      ]);
      return json({
        ok: true,
        service: 'ServicePack stock monitor',
        catalogue: {
          total: Number(totals?.total || 0),
          inStock: Number(totals?.in_stock || 0)
        },
        pricing: {
          eligible: Number(pricing?.eligible || 0),
          priced: Number(pricing?.priced || 0),
          remaining: Number(pricing?.remaining || 0),
          needsReview: Number(pricing?.needs_review || 0)
        },
        sync: state,
        pendingEbayStockUpdates: Number(stockQueue?.count || 0),
        eBayWrites: false
      }, 200, env.DASHBOARD_ORIGIN);
    }
    const authorized = await isAuthorized(request, env);
    if (!authorized) return json({ ok: false, error: 'Unauthorized' }, 401, env.DASHBOARD_ORIGIN);
    if (url.pathname === '/health') {
      const state = await env.DB.prepare('SELECT * FROM sync_state WHERE id=1').first();
      return json({ ok: true, service: 'ServicePack stock monitor', sync: state, eBayWrites: false });
    }
    if (url.pathname === '/products' && request.method === 'GET') return listProducts(request, env);
    if (url.pathname === '/changes' && request.method === 'GET') return listChanges(request, env);
    if (url.pathname === '/reviews' && request.method === 'POST') return saveReviews(request, env);
    if (url.pathname === '/ai-pending' && request.method === 'GET') return pendingAI(request, env);
    if (url.pathname === '/recommendations-batch' && request.method === 'POST') return recommendationsBatch(request, env);
    if (url.pathname === '/events' && request.method === 'GET') return listEvents(request, env);
    if (url.pathname === '/sync' && request.method === 'POST') {
      const result = await syncCatalogueBurst(env);
      return json(result);
    }
    return json({ ok: false, error: 'Not found' }, 404);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async()=>{try{await syncCatalogueBurst(env)}catch(error){console.error(JSON.stringify({event:'scheduled_sync',ok:false,error:String(error?.message||error)}))}await flushStockQueue(env);await triggerAutomaticAI(env)})());
  }
};
