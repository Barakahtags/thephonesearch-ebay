const {guard}=require('./_lib/admin');
const mps=require('./_lib/mps');
const ebay=require('./_lib/ebay');
const liveControl=require('./_lib/live-control');
const allowedCataloguePaths = new Set(['/products', '/changes', '/reviews', '/sync', '/public-health', '/restart-full-image-refresh']);
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
module.exports=async function(req,res){
  if(String(req.query.action||'')==='catalogue') return catalogueBridge(req,res);
  if(!guard(req,res)) return;
  const on=n=>String(process.env[n]||'false').toLowerCase()==='true';
  const out={ok:true,time:new Date().toISOString(),liveControl:liveControl.snapshot(),config:{mpsCredentials:!!(process.env.MPS_USERNAME&&process.env.MPS_PASSWORD),ebayStaticToken:!!process.env.EBAY_USER_TOKEN,ebayRefreshReady:!!(process.env.EBAY_CLIENT_SECRET&&process.env.EBAY_REFRESH_TOKEN),marketplace:process.env.EBAY_MARKETPLACE_ID||'EBAY_DE',currency:process.env.EBAY_CURRENCY||'EUR',publish:on('EBAY_PUBLISH'),syncMode:process.env.SYNC_MODE||'preview',automation:{supplierPurchase:false,ebayTracking:on('EBAY_AUTO_TRACKING'),listingPublish:on('EBAY_PUBLISH')}}};
  try{await ebay.api('/sell/account/v1/privilege/');out.ebay={ok:true};}catch(e){out.ok=false;out.ebay={ok:false,error:e.message,details:e.data||null};}
  try{const t=await mps.authenticate();out.mps={ok:true,sessionTokenReceived:!!t};}catch(e){out.ok=false;out.mps={ok:false,error:e.message};}
  try{out.policies=await ebay.policies();}catch(e){out.policies={error:e.message,details:e.data||null};}
  try{out.inventoryLocation=await ebay.firstInventoryLocation();}catch(e){out.inventoryLocation=null;out.inventoryLocationError=e.message;}
  res.status(out.ok?200:207).json(out);
};
