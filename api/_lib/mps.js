const BASE = 'https://services.2service.nl';

async function jsonFetch(url, options = {}) {
  const r = await fetch(url, { ...options, headers: { Accept: 'application/json', ...(options.headers || {}) } });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error(`MPS HTTP ${r.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

async function authenticate() {
  const user = process.env.MPS_USERNAME;
  const pass = process.env.MPS_PASSWORD;
  if (!user || !pass) throw new Error('Missing MPS_USERNAME or MPS_PASSWORD');
  const u = new URL(`${BASE}/dealers/authenticate`);
  u.searchParams.set('UserName', user);
  u.searchParams.set('Password', pass);
  const data = await jsonFetch(u, { method: 'POST' });
  if (!data?.IsSuccessful || !data?.Result?.SessionToken) throw new Error(data?.ErrorMessage || 'MPS authentication failed');
  return data.Result.SessionToken;
}

async function allParts(page = 1, pageSize = 100) {
  const token = await authenticate();
  const u = new URL(`${BASE}/dealers/all-parts`);
  u.searchParams.set('PageSize', Math.min(100, Math.max(1, Number(pageSize) || 100)));
  u.searchParams.set('Page', Math.max(1, Number(page) || 1));
  u.searchParams.set('SessionToken', token);
  const data = await jsonFetch(u);
  if (!data?.IsSuccessful) throw new Error(data?.ErrorMessage || 'MPS all-parts failed');
  return data.Result;
}

async function searchParts(searchText, articleType = 1, page = 1, pageSize = 100) {
  const token = await authenticate();
  const u = new URL(`${BASE}/dealers/parts/search`);
  u.searchParams.set('SearchText', String(searchText || '').trim());
  u.searchParams.set('ArticleType', Math.max(1, Math.min(4, Number(articleType) || 1)));
  u.searchParams.set('PageSize', Math.min(100, Math.max(1, Number(pageSize) || 100)));
  u.searchParams.set('Page', Math.max(1, Number(page) || 1));
  u.searchParams.set('SessionToken', token);
  const data = await jsonFetch(u);
  if (!data?.IsSuccessful) throw new Error(data?.ErrorMessage || 'MPS parts search failed');
  return data.Result;
}

async function part(partNumber) {
  const token = await authenticate();
  const u = new URL(`${BASE}/dealers/part`);
  u.searchParams.set('PartNumber', partNumber);
  u.searchParams.set('SessionToken', token);
  const data = await jsonFetch(u);
  if (!data?.IsSuccessful) throw new Error(data?.ErrorMessage || 'MPS part lookup failed');
  return data.Result;
}

async function placeOrder(items, deliveryAddress, useDropshipment = true) {
  const token = await authenticate();
  const u = new URL(`${BASE}/dealers/order`);
  u.searchParams.set('SessionToken', token);
  const payload = { Items: { Capacity: items.length, Count: items.length, Item: items.length === 1 ? items[0] : items }, UseDropshipment: !!useDropshipment, DeliveryAddress: deliveryAddress };
  const data = await jsonFetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!data?.IsSuccessful) throw new Error(data?.ErrorMessage || 'MPS order failed');
  return data.Result;
}

module.exports = { authenticate, allParts, searchParts, part, placeOrder };
