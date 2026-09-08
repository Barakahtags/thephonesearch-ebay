const BASE = 'https://services.2service.nl';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let cachedToken=null,cachedTokenUntil=0,authenticationInFlight=null;

async function jsonFetch(url, options = {}, attempt = 0) {
  let r,text,data;
  try {
    r = await fetch(url, { ...options, headers: { Accept: 'application/json', ...(options.headers || {}) } });
    text = await r.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  } catch (error) {
    if (attempt < 3) { await delay(300 * (2 ** attempt)); return jsonFetch(url, options, attempt + 1); }
    throw error;
  }
  if (!r.ok) {
    if ([429,502,503,504].includes(r.status) && attempt < 3) {
      await delay(300 * (2 ** attempt));
      return jsonFetch(url, options, attempt + 1);
    }
    throw new Error(`MPS HTTP ${r.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function authenticate() {
  if(cachedToken && Date.now()<cachedTokenUntil)return cachedToken;
  if(authenticationInFlight)return authenticationInFlight;
  authenticationInFlight=(async()=>{
    const user = process.env.MPS_USERNAME;
    const pass = process.env.MPS_PASSWORD;
    if (!user || !pass) throw new Error('Missing MPS_USERNAME or MPS_PASSWORD');
    const u = new URL(`${BASE}/dealers/authenticate`);
    u.searchParams.set('UserName', user);
    u.searchParams.set('Password', pass);
    const data = await jsonFetch(u, { method: 'POST' });
    if (!data?.IsSuccessful || !data?.Result?.SessionToken) throw new Error(data?.ErrorMessage || 'MPS authentication failed');
    cachedToken=data.Result.SessionToken;
    cachedTokenUntil=Date.now()+8*60*1000;
    return cachedToken;
  })();
  try{return await authenticationInFlight}finally{authenticationInFlight=null}
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

async function catalogueParts(articleType = 1, page = 1, pageSize = 100) {
  const type=Number(articleType);
  if(![1,3].includes(type))throw Object.assign(new Error('Only Ersatzteile and Werkzeuge are allowed'),{status:400});
  if(type===1)return allParts(page,pageSize);
  const searches=await Promise.all(['a','e','i','o','u','y'].map(term=>searchParts(term,3,page,pageSize)));
  const unique=new Map();
  for(const result of searches)for(const part of (result.Parts||[]))unique.set(String(part.PartNumber||part.Id),part);
  return {
    TotalNumberOfParts:unique.size,
    HasMoreRecords:searches.some(result=>result.HasMoreRecords),
    Parts:[...unique.values()]
  };
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
