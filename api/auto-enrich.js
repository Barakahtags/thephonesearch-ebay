const {guard} = require('./_lib/admin');
const mps = require('./_lib/mps');
const pricing = require('./_lib/pricing');
const market = require('./_lib/market-pricing');
const ebay = require('./_lib/ebay');
const {optimizeListing} = require('./_lib/ai-listing');
const {exclusionReason} = require('./_lib/catalog-quality');

const worker = () => process.env.CATALOGUE_WORKER_ORIGIN || 'https://thephonesearch-stock-sync.thephonesearchpk.workers.dev';

async function workerCall(path, options = {}) {
  const response = await fetch(worker() + path, {
    ...options,
    headers: {'x-admin-token': process.env.ADMIN_TOKEN, 'Content-Type': 'application/json', ...(options.headers || {})}
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = {error: text}; }
  if (!response.ok) throw new Error(data.error || `Catalogue worker HTTP ${response.status}`);
  return data;
}

function exclusionMessage(reason) {
  if (reason === 'RESIN_PRODUCT') return 'Resin products are excluded';
  if (reason === 'TRAINING_PRODUCT') return 'Training products are excluded';
  if (reason === 'LONG_DELIVERY') return 'Long-delivery products are excluded';
  return 'A valid product image is required';
}

module.exports = async function(req, res) {
  if (!guard(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ok: false, error: 'POST required'});
  try {
    // The Worker claim endpoint and this function both support 20 records per
    // request. Keeping one larger request avoids multiplying Worker invocations
    // (important on the current Cloudflare plan) while halving queue time.
    // 30 parallel checks stays below the supplier/eBay rate limits while
    // reducing the backlog by 50% faster than the original 20-item batch.
    const batchSize = 30;
    const pending = await workerCall(`/ai-pending?limit=${batchSize}`);
    const records = pending.items || [];
    if (!records.length) return res.status(200).json({ok: true, idle: true, processed: 0, remaining: 0, writePerformed: false, note: 'Automatic AI backlog is complete.'});

    const prepared = await Promise.all(records.map(async record => {
      const sku = String(record.sku || record.PartNumber || '');
      try {
        const part = await mps.part(sku);
        const excluded = exclusionReason(part);
        if (excluded) throw new Error(exclusionMessage(excluded));
        const preliminary = await optimizeListing(part);
        return {sku, part, preliminary};
      } catch (error) {
        return {sku, error: String(error?.message || error)};
      }
    }));

    // Product recommendations and seller-identity lookups are presentation
    // extras. They are deliberately excluded from the launch pricing path so
    // an auxiliary service outage cannot delay pricing or publishing.
    const recommendations = {};
    const sellerUsername = String(process.env.EBAY_SELLER_USERNAME || '').trim();

    const outcomes = await Promise.all(prepared.map(async item => {
      const now = new Date().toISOString();
      if (item.error) return {sku: item.sku, status: 'review', autoProcessedAt: now, autoError: item.error, contentSource: 'Automatic processing needs review'};
      try {
        const relatedItems = (recommendations[item.sku] || []).map(related => ({...related, sellerUsername}));
        const part = {...item.part, _recommendations: relatedItems};
        const optimized = await optimizeListing(part);
        // Market research must improve a price, never prevent the protected
        // cost/profit calculation from completing. eBay's Browse endpoint is
        // currently rejecting this token path, so fall back to the fixed-profit
        // price and record the lookup issue for a later retry.
        let competitor;
        try {
          competitor = await market.competitorPrice(part, optimized.title);
        } catch (marketError) {
          competitor = {status: 'INSUFFICIENT_MARKET_DATA', reason: `eBay market lookup unavailable: ${String(marketError?.message || marketError)}`, marketLookupError: String(marketError?.message || marketError)};
        }
        // A missing comparable must not leave a sellable product pending
        // forever. Use the protected fixed-profit floor as a final fallback,
        // while keeping genuinely unprofitable market matches blocked.
        const marketUnavailable = competitor.status === 'INSUFFICIENT_MARKET_DATA';
        const calculation = marketUnavailable
          ? {...pricing.recommendedPrice(part.UnitPrice), fallback: true, priceSource: 'FIXED_PROFIT_FALLBACK'}
          : competitor.recommendedItemPrice == null
            ? pricing.blockedPricing(part.UnitPrice, competitor.status)
            : {...pricing.recommendedPrice(part.UnitPrice, competitor.recommendedItemPrice), fallback: false, priceSource: 'EBAY_LOWEST_MINUS_0_50'};
        const listingStatus = marketUnavailable ? 'FALLBACK_FIXED_PROFIT' : competitor.status;
        return {
          sku: item.sku,
          title: String(optimized.title || part.Description || item.sku).slice(0, 80),
          description: optimized.description || String(part.Description || ''),
          status: 'review',
          contentSource: 'Automatic variant-aware title, premium responsive description, exact-model recommendations and eBay undercut pricing',
          calculatedPrice: calculation.itemPrice ?? null,
          buyerTotal: calculation.totalRevenue ?? null,
          pricing: calculation,
          competitorPricing: competitor,
          listingStatus,
          autoProcessedAt: now,
          autoError: ''
        };
      } catch (error) {
        return {sku: item.sku, status: 'review', autoProcessedAt: now, autoError: String(error?.message || error), contentSource: 'Automatic processing needs review'};
      }
    }));

    const reviews = outcomes;
    const failures = outcomes.filter(item => item.autoError).length;
    // Save failures too. Their timestamp gives them a 24-hour cooldown in the
    // Worker queue instead of letting the same broken SKU block every batch.
    const saved = reviews.length ? await workerCall('/reviews', {method: 'POST', body: JSON.stringify({reviews})}) : {saved: 0};
    const remaining = Math.max(0, Number(pending.remaining || records.length) - outcomes.length);
    console.log(JSON.stringify({event: 'automatic_ai', ok: true, requested: records.length, saved: saved.saved, failures, remaining, failureSamples: outcomes.filter(item => item.autoError).slice(0, 3).map(item => ({sku: item.sku, error: item.autoError}))}));
    return res.status(failures ? 207 : 200).json({ok: failures === 0, idle: false, attempted: outcomes.length, processed: outcomes.length - failures, failed: failures, saved: saved.saved, remaining, writePerformed: false, reviews, errors: outcomes.filter(item => item.autoError).map(item => ({sku: item.sku, error: item.autoError}))});
  } catch (error) {
    console.error(JSON.stringify({event: 'automatic_ai', ok: false, error: String(error?.message || error)}));
    return res.status(500).json({ok: false, error: error.message, writePerformed: false});
  }
};
