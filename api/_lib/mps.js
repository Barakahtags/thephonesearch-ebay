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

async function searchCatalogueTerms(articleType, page, pageSize) {
  const terms=['a','e','i','o','u','y','0','1','2','3','4','5','6','7','8','9'];
  const settled=await Promise.allSettled(terms.map(term=>searchParts(term,articleType,page,pageSize)));
  const searches=settled.filter(x=>x.status==='fulfilled'&&x.value).map(x=>x.value);
  const failures=settled.filter(x=>x.status==='rejected');
  if(!searches.length)throw failures[0]?.reason||new Error('MPS catalogue searches returned no usable responses');
  if(failures.length)console.warn('[mps.catalogueParts] partial supplier search failure',{articleType,page,failed:failures.length,total:terms.length,errors:failures.slice(0,3).map(x=>String(x.reason?.message||x.reason))});
  const unique=new Map();
  for(const result of searches)for(const part of (result?.Parts||[])){
    if(!part)continue;
    const key=String(part.PartNumber||part.Id||'').trim();
    if(key)unique.set(key,part);
  }
  return {TotalNumberOfParts:unique.size,HasMoreRecords:searches.some(result=>result?.HasMoreRecords),Parts:[...unique.values()]};
}

async function catalogueParts(articleType = 1, page = 1, pageSize = 100) {
  const type=Number(articleType);
  if(![1,3].includes(type))throw Object.assign(new Error('Only Ersatzteile and Werkzeuge are allowed'),{status:400});
  if(type===1){
    try{return await allParts(page,pageSize)}
    catch(error){console.warn('[mps.catalogueParts] all-parts failed; using resilient search fallback',{page,error:String(error?.message||error)});return searchCatalogueTerms(type,page,pageSize)}
  }
  return searchCatalogueTerms(type,page,pageSize);
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

async function multipleParts(partNumbers) {
  const numbers=[...new Set((partNumbers||[]).map(String).filter(Boolean))].slice(0,100);
  if(!numbers.length)return [];
  const token=await authenticate();
  const u=new URL(`${BASE}/dealers/parts`);
  numbers.forEach(number=>u.searchParams.append('PartNumbers',number));
  u.searchParams.set('SessionToken',token);
  const data=await jsonFetch(u);
  if(!data?.IsSuccessful)throw new Error(data?.ErrorMessage||'MPS multiple parts lookup failed');
  return data.Result||[];
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

async function orderTracking(orderNumber) {
  const token = await authenticate();
  const u = new URL(`${BASE}/dealers/order/tracking`);
  u.searchParams.set('OrderNumber', String(orderNumber || '').trim());
  u.searchParams.set('SessionToken', token);
  const data = await jsonFetch(u);
  if (!data?.IsSuccessful) throw new Error(data?.ErrorMessage || 'MPS order tracking failed');
  return data.Result;
}

async function shipments(dateFrom, dateTo = null) {
  const token = await authenticate();
  const u = new URL(`${BASE}/dealers/shipments`);
  u.searchParams.set('DateFrom', new Date(dateFrom).toISOString());
  if (dateTo) u.searchParams.set('DateTo', new Date(dateTo).toISOString());
  u.searchParams.set('SessionToken', token);
  const data = await jsonFetch(u);
  if (!data?.IsSuccessful) throw new Error(data?.ErrorMessage || 'MPS shipments lookup failed');
  return data.Result || [];
}

module.exports = { authenticate, allParts, searchParts, catalogueParts, part, multipleParts, placeOrder, orderTracking, shipments };
