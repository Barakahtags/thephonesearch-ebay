const EBAY = 'https://api.ebay.com';
const SITE_IDS = { EBAY_US:'0', EBAY_CA:'2', EBAY_GB:'3', EBAY_AU:'15', EBAY_DE:'77', EBAY_FR:'71', EBAY_IT:'101', EBAY_ES:'186', EBAY_IE:'205', EBAY_NL:'146' };

async function parseResponse(r) {
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const err = new Error(`eBay HTTP ${r.status}`);
    err.status = r.status; err.data = data; throw err;
  }
  return data;
}

async function refreshAccessToken() {
  const clientId = process.env.EBAY_CLIENT_ID || 'AmeerAli-Thephone-PRD-925367676-a01057b2';
  const secret = process.env.EBAY_CLIENT_SECRET;
  const refresh = process.env.EBAY_REFRESH_TOKEN;
  if (!secret || !refresh) return null;
  const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh });
  if (process.env.EBAY_OAUTH_SCOPES) body.set('scope', process.env.EBAY_OAUTH_SCOPES);
  const r = await fetch(`${EBAY}/identity/v1/oauth2/token`, { method:'POST', headers:{ Authorization:`Basic ${basic}`, 'Content-Type':'application/x-www-form-urlencoded' }, body });
  const data = await parseResponse(r);
  return data.access_token;
}

async function token() {
  const refreshed = await refreshAccessToken();
  if (refreshed) return refreshed;
  if (process.env.EBAY_USER_TOKEN) return process.env.EBAY_USER_TOKEN;
  throw new Error('No usable eBay token. Configure EBAY_REFRESH_TOKEN + EBAY_CLIENT_SECRET, or temporary EBAY_USER_TOKEN.');
}

async function api(path, options = {}) {
  const t = await token();
  const r = await fetch(`${EBAY}${path}`, { ...options, headers:{ Authorization:`Bearer ${t}`, Accept:'application/json', 'Content-Type':'application/json', 'Content-Language':process.env.EBAY_CONTENT_LANGUAGE || 'de-DE', ...(options.headers || {}) } });
  return parseResponse(r);
}

async function policies(marketplace = process.env.EBAY_MARKETPLACE_ID || 'EBAY_DE') {
  const [fulfillment, payment, returns] = await Promise.all([
    api(`/sell/account/v1/fulfillment_policy?marketplace_id=${encodeURIComponent(marketplace)}`),
    api(`/sell/account/v1/payment_policy?marketplace_id=${encodeURIComponent(marketplace)}`),
    api(`/sell/account/v1/return_policy?marketplace_id=${encodeURIComponent(marketplace)}`)
  ]);
  return {
    fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID || fulfillment?.fulfillmentPolicies?.[0]?.fulfillmentPolicyId,
    paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID || payment?.paymentPolicies?.[0]?.paymentPolicyId,
    returnPolicyId: process.env.EBAY_RETURN_POLICY_ID || returns?.returnPolicies?.[0]?.returnPolicyId,
    counts: { fulfillment: fulfillment?.fulfillmentPolicies?.length || 0, payment: payment?.paymentPolicies?.length || 0, returns: returns?.returnPolicies?.length || 0 }
  };
}

async function firstInventoryLocation() {
  const data = await api('/sell/inventory/v1/location?limit=100');
  const loc = (data?.locations || []).find(x => x.merchantLocationStatus === 'ENABLED') || data?.locations?.[0];
  return process.env.EBAY_MERCHANT_LOCATION_KEY || loc?.merchantLocationKey || null;
}

async function suggestedCategory(query, marketplace = process.env.EBAY_MARKETPLACE_ID || 'EBAY_DE') {
  const t = await token();
  const siteId = process.env.EBAY_SITE_ID || SITE_IDS[marketplace] || '77';
  const xml = `<?xml version="1.0" encoding="utf-8"?><GetSuggestedCategoriesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><Query>${String(query).replace(/[<>&'\"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','\"':'&quot;'}[c]))}</Query></GetSuggestedCategoriesRequest>`;
  const r = await fetch('https://api.ebay.com/ws/api.dll', { method:'POST', headers:{ 'X-EBAY-API-CALL-NAME':'GetSuggestedCategories','X-EBAY-API-SITEID':siteId,'X-EBAY-API-COMPATIBILITY-LEVEL':'967','X-EBAY-API-IAF-TOKEN':t,'Content-Type':'text/xml' }, body:xml });
  const text = await r.text();
  if (!r.ok) throw new Error(`eBay category HTTP ${r.status}`);
  const m = text.match(/<CategoryID>([^<]+)<\/CategoryID>/);
  if (!m) throw new Error('No suggested eBay category found');
  return m[1];
}

function sellingPrice(unitPrice) {
  const vat = Number(process.env.PRICE_VAT_RATE ?? '0.19');
  const markup = Number(process.env.PRICE_MARKUP_PERCENT ?? '25') / 100;
  const fixed = Number(process.env.PRICE_FIXED_ADD ?? '0');
  return Math.max(0, Number(unitPrice || 0) * (1 + vat) * (1 + markup) + fixed).toFixed(2);
}

async function upsertPart(p) {
  const marketplace = process.env.EBAY_MARKETPLACE_ID || 'EBAY_DE';
  const currency = process.env.EBAY_CURRENCY || 'EUR';
  const sku = String(p.PartNumber || p.Id);
  const title = String(p.Description || sku).replace(/\s+/g,' ').trim().slice(0,80);
  const images = (p.Images || []).map(x=>x.ImageUrl).filter(Boolean).slice(0,12);
  const inventory = { availability:{ shipToLocationAvailability:{ quantity: Math.max(0, Number(p.AvailableStockQuantity || 0)) } }, condition:'NEW', product:{ title, description:String(p.Description || title), imageUrls:images, aspects:{ Brand:[p.Manufacturer || 'Unbranded'], MPN:[sku] } } };
  if (p.EanNumber) inventory.product.ean = [String(p.EanNumber)];
  await api(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, { method:'PUT', body:JSON.stringify(inventory) });

  const loc = await firstInventoryLocation();
  if (!loc) throw new Error('No enabled eBay inventory location found. Create one in eBay or set EBAY_MERCHANT_LOCATION_KEY.');
  const pol = await policies(marketplace);
  if (!pol.fulfillmentPolicyId || !pol.paymentPolicyId || !pol.returnPolicyId) throw new Error(`Missing eBay business policies for ${marketplace}`);
  const categoryId = process.env.EBAY_DEFAULT_CATEGORY_ID || await suggestedCategory(`${p.Manufacturer || ''} ${p.Description || sku}`);
  const offerBody = { sku, marketplaceId:marketplace, format:'FIXED_PRICE', availableQuantity:Math.max(0, Number(p.AvailableStockQuantity || 0)), categoryId, merchantLocationKey:loc, listingDescription:String(p.Description || title), listingPolicies:{ fulfillmentPolicyId:pol.fulfillmentPolicyId, paymentPolicyId:pol.paymentPolicyId, returnPolicyId:pol.returnPolicyId }, pricingSummary:{ price:{ currency, value:sellingPrice(p.UnitPrice) } } };
  const found = await api(`/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${encodeURIComponent(marketplace)}&limit=20`);
  let offerId = found?.offers?.[0]?.offerId;
  if (offerId) await api(`/sell/inventory/v1/offer/${offerId}`, { method:'PUT', body:JSON.stringify(offerBody) });
  else { const created = await api('/sell/inventory/v1/offer', { method:'POST', body:JSON.stringify(offerBody) }); offerId = created.offerId; }
  let publish = null;
  if (String(process.env.EBAY_PUBLISH || '').toLowerCase() === 'true') publish = await api(`/sell/inventory/v1/offer/${offerId}/publish`, { method:'POST', body:'{}' });
  return { sku, title, offerId, categoryId, quantity:inventory.availability.shipToLocationAvailability.quantity, price:offerBody.pricingSummary.price, published:!!publish, publish };
}

module.exports = { api, token, policies, firstInventoryLocation, suggestedCategory, sellingPrice, upsertPart };
