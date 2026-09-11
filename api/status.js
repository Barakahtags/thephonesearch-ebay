const {guard}=require('./_lib/admin');
const mps=require('./_lib/mps');
const ebay=require('./_lib/ebay');
const liveControl=require('./_lib/live-control');
const allowedCataloguePaths = new Set(['/products', '/changes', '/reviews', '/sync', '/public-health', '/restart-full-image-refresh', '/mobilesentrix/status']);
function sameOrigin(req) {
  const origin = String(req.headers.origin || ''), host = String(req.headers.host || '');
  if (!origin) return req.method === 'GET';
  try { return new URL(origin).host === host; } catch { return false; }
}
async function catalogueBridge(req, res) {
  if (!sameOrigin(req)) return res.status(403).json({ok:false,error:'Catalogue request origin is not allowed'});
  const path = String(req.query.path || '');
  if (!allowedCataloguePaths.has(path)) return res.status(400).json({ok:false,error:'Unsupported catalogue request'});
  const secret = process.env.ADMIN_TOKEN || process.env.EBAY_VERIFICATION_TOKEN;
  if (!secret) return res.status(503).json({ok:false,error:'Catalogue bridge is not configured'});
  try {
    const root = String(process.env.CATALOGUE_WORKER_ORIGIN || 'https://thephonesearch-stock-sync.thephonesearchpk.workers.dev').replace(/\/$/, '');
    const target = new URL(root + path);
    for (const [key,value] of Object.entries(req.query || {})) if (!['action','path'].includes(key) && value != null) target.searchParams.set(key,String(value));
    const method=String(req.method||'GET').toUpperCase();
    const options={method,headers:{'x-admin-token':secret,accept:'application/json'}};
    if(method==='POST'){options.headers['content-type']='application/json';options.body=JSON.stringify(req.body||{});}
    const upstream=await fetch(target,options),body=await upstream.text();
    res.status(upstream.status).setHeader('content-type',upstream.headers.get('content-type')||'application/json; charset=utf-8');
    return res.send(body);
  } catch(error) { return res.status(502).json({ok:false,error:'Catalogue bridge unavailable: '+String(error?.message||error)}); }
}
function mobileSentrixHtml(res, title, message, status = 200) {
  res.status(status).setHeader('content-type', 'text/html; charset=utf-8');
  return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><body style="margin:0;background:#070b14;color:#f4f7fb;font:16px system-ui;padding:40px"><main style="max-width:620px;margin:auto;border:1px solid #34435b;border-radius:16px;padding:28px;background:#0d1422"><h1 style="margin-top:0">'+title+'</h1><p>'+message+'</p><p><a style="color:#f3c95f" href="/app.html">Return to ServicePack</a></p></main></body>');
}
function mobileSentrixOrigin(req) {
  const host = String(req.headers.host || 'ie-verified-phones-ebay-hook.vercel.app');
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  return proto+'://'+host;
}
function mobileSentrixRequired(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error('MobileSentrix connection is not configured yet');
  return value;
}
async function mobileSentrixImport(req,res) {
  if (!sameOrigin(req)) return res.status(403).json({ok:false,error:'MobileSentrix import origin is not allowed'});
  try {
    const consumerKey=mobileSentrixRequired('MOBILESENTRIX_CONSUMER_KEY'),consumerSecret=mobileSentrixRequired('MOBILESENTRIX_CONSUMER_SECRET');
    const worker=String(process.env.CATALOGUE_WORKER_ORIGIN||'https://thephonesearch-stock-sync.thephonesearchpk.workers.dev').replace(/\/$/,'');
    const adminToken=String(process.env.ADMIN_TOKEN||process.env.EBAY_VERIFICATION_TOKEN||'');
    const upstream=await fetch(worker+'/mobilesentrix/import',{method:'POST',headers:{'content-type':'application/json','x-admin-token':adminToken},body:JSON.stringify({consumerKey,consumerSecret})});
    const data=await upstream.json().catch(()=>({ok:false,error:'Invalid import response'}));
    return res.status(upstream.status).json(data);
  } catch { return res.status(503).json({ok:false,error:'MobileSentrix import is not configured'}); }
}
async function mobileSentrixCatalogueTest(req,res) {
  if (!sameOrigin(req)) return res.status(403).json({ok:false,error:'MobileSentrix test origin is not allowed'});
  try {
    const consumerKey=mobileSentrixRequired('MOBILESENTRIX_CONSUMER_KEY');
    const consumerSecret=mobileSentrixRequired('MOBILESENTRIX_CONSUMER_SECRET');
    const worker=String(process.env.CATALOGUE_WORKER_ORIGIN||'https://thephonesearch-stock-sync.thephonesearchpk.workers.dev').replace(/\/$/,'');
    const adminToken=String(process.env.ADMIN_TOKEN||process.env.EBAY_VERIFICATION_TOKEN||'');
    if(!adminToken) throw new Error('ServicePack secure catalogue bridge is not configured.');
    const upstream=await fetch(worker+'/mobilesentrix/test',{method:'POST',headers:{'content-type':'application/json','x-admin-token':adminToken},body:JSON.stringify({consumerKey,consumerSecret})});
    const data=await upstream.json().catch(()=>({ok:false,error:'Invalid catalogue test response'}));
    return res.status(upstream.status).json(data);
  } catch (error) {
    return res.status(503).json({ok:false,error:'MobileSentrix catalogue test is not configured'});
  }
}
async function mobileSentrixOAuth(req,res) {
  const step=String(req.query.step||'start');
  let stage='configuration';
  try {
    const consumerName=mobileSentrixRequired('MOBILESENTRIX_CONSUMER_NAME');
    const consumerKey=mobileSentrixRequired('MOBILESENTRIX_CONSUMER_KEY');
    const consumerSecret=mobileSentrixRequired('MOBILESENTRIX_CONSUMER_SECRET');
    const base=String(process.env.MOBILESENTRIX_BASE_URL||'https://www.mobilesentrix.eu').replace(/\/$/,'');
    const callback=String(process.env.MOBILESENTRIX_CALLBACK_URL||mobileSentrixOrigin(req)+'/api/status?action=mobilesentrix-oauth&step=callback');
    if(step==='start'){
      const target=new URL(base+'/oauth/authorize/identifier');
      target.searchParams.set('consumer',consumerName);target.searchParams.set('authtype','1');target.searchParams.set('flowentry','SignIn');
      target.searchParams.set('consumer_key',consumerKey);target.searchParams.set('consumer_secret',consumerSecret);target.searchParams.set('callback',callback);
      res.statusCode=302;res.setHeader('location',target.toString());return res.end();
    }
    if(step!=='callback') return mobileSentrixHtml(res,'MobileSentrix','Unsupported connection action.',400);
    const oauthToken=String(req.query.oauth_token||'').trim(),oauthVerifier=String(req.query.oauth_verifier||'').trim();
    if(!oauthToken||!oauthVerifier)return mobileSentrixHtml(res,'MobileSentrix connection','MobileSentrix did not return the approval details. Please start the connection again.',400);
    stage='access-token exchange';
    const exchange=await fetch(base+'/oauth/authorize/identifiercallback',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({consumer_key:consumerKey,consumer_secret:consumerSecret,oauth_token:oauthToken,oauth_verifier:oauthVerifier})});
    const data=await exchange.json().catch(()=>({})),accessToken=String(data?.data?.access_token||'').trim(),accessTokenSecret=String(data?.data?.access_token_secret||'').trim();
    if(!exchange.ok||!accessToken||!accessTokenSecret)throw new Error('MobileSentrix did not return a usable access token.');
    const worker=String(process.env.CATALOGUE_WORKER_ORIGIN||'https://thephonesearch-stock-sync.thephonesearchpk.workers.dev').replace(/\/$/,'');
    const adminToken=String(process.env.ADMIN_TOKEN||process.env.EBAY_VERIFICATION_TOKEN||'');if(!adminToken)throw new Error('ServicePack secure catalogue bridge is not configured.');
    stage='secure token save';
    const saved=await fetch(worker+'/mobilesentrix/credentials',{method:'POST',headers:{'content-type':'application/json','x-admin-token':adminToken},body:JSON.stringify({accessToken,accessTokenSecret})});
    if(!saved.ok)throw new Error('ServicePack could not save the MobileSentrix connection.');
    return mobileSentrixHtml(res,'MobileSentrix connected','Your MobileSentrix Europe account is connected. The supplier catalogue remains separate and nothing has been published to eBay.');
  } catch (error) { console.error('MobileSentrix OAuth failed at '+stage); return mobileSentrixHtml(res,'MobileSentrix connection unavailable','The connection stopped during '+stage+'. No token was saved. Please return to ServicePack and try once more after this fix.',503); }
}
module.exports=async function(req,res){
  if(String(req.query.action||'')==='catalogue') return catalogueBridge(req,res);
  if(String(req.query.action||'')==='mobilesentrix-oauth') return mobileSentrixOAuth(req,res);
  if(String(req.query.action||'')==='mobilesentrix-test') return mobileSentrixCatalogueTest(req,res);
  if(String(req.query.action||'')==='mobilesentrix-import') return mobileSentrixImport(req,res);
  if(!guard(req,res)) return;
  const on=n=>String(process.env[n]||'false').toLowerCase()==='true';
  const out={ok:true,time:new Date().toISOString(),liveControl:liveControl.snapshot(),config:{mpsCredentials:!!(process.env.MPS_USERNAME&&process.env.MPS_PASSWORD),ebayStaticToken:!!process.env.EBAY_USER_TOKEN,ebayRefreshReady:!!(process.env.EBAY_CLIENT_SECRET&&process.env.EBAY_REFRESH_TOKEN),marketplace:process.env.EBAY_MARKETPLACE_ID||'EBAY_DE',currency:process.env.EBAY_CURRENCY||'EUR',publish:on('EBAY_PUBLISH'),syncMode:process.env.SYNC_MODE||'preview',automation:{supplierPurchase:false,ebayTracking:on('EBAY_AUTO_TRACKING'),listingPublish:on('EBAY_PUBLISH')}}};
  try{await ebay.api('/sell/account/v1/privilege/');out.ebay={ok:true};}catch(e){out.ok=false;out.ebay={ok:false,error:e.message,details:e.data||null};}
  try{const t=await mps.authenticate();out.mps={ok:true,sessionTokenReceived:!!t};}catch(e){out.ok=false;out.mps={ok:false,error:e.message};}
  try{out.policies=await ebay.policies();}catch(e){out.policies={error:e.message,details:e.data||null};}
  try{out.inventoryLocation=await ebay.firstInventoryLocation();}catch(e){out.inventoryLocation=null;out.inventoryLocationError=e.message;}
  res.status(out.ok?200:207).json(out);
};
