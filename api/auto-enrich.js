const {guard}=require('./_lib/admin');
const mps=require('./_lib/mps');
const pricing=require('./_lib/pricing');
const market=require('./_lib/market-pricing');
const {optimizeListing}=require('./_lib/ai-listing');
const {exclusionReason}=require('./_lib/catalog-quality');

const worker=()=>process.env.CATALOGUE_WORKER_ORIGIN||'https://thephonesearch-stock-sync.thephonesearchpk.workers.dev';
async function workerCall(path,options={}){const r=await fetch(worker()+path,{...options,headers:{'x-admin-token':process.env.ADMIN_TOKEN,'Content-Type':'application/json',...(options.headers||{})}}),text=await r.text();let data;try{data=text?JSON.parse(text):{}}catch{data={error:text}}if(!r.ok)throw new Error(data.error||`Catalogue worker HTTP ${r.status}`);return data}

module.exports=async function(req,res){
  if(!guard(req,res))return;
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'POST required'});
  try{
    const pending=await workerCall('/ai-pending?limit=1'),record=pending.items?.[0];
    if(!record)return res.status(200).json({ok:true,idle:true,processed:0,remaining:0,writePerformed:false,note:'Automatic AI backlog is complete.'});
    const sku=String(record.sku||record.PartNumber||''),p=await mps.part(sku),excluded=exclusionReason(p);
    if(excluded)throw new Error(excluded==='RESIN_PRODUCT'?'Resin products are excluded':'A valid product image is required');
    const optimized=await optimizeListing(p),competitor=await market.competitorPrice(p,optimized.title),calculation=pricing.breakdown(competitor.recommendedItemPrice,p.UnitPrice),now=new Date().toISOString();
    const review={sku,title:String(optimized.title||p.Description||sku).slice(0,80),description:optimized.description||String(p.Description||''),status:'review',contentSource:'Automatic AI title, description and market pricing',calculatedPrice:calculation.itemPrice,buyerTotal:calculation.totalRevenue,pricing:calculation,competitorPricing:competitor,listingStatus:competitor.status,autoProcessedAt:now,autoError:''};
    await workerCall('/reviews',{method:'POST',body:JSON.stringify({reviews:[review]})});
    return res.status(200).json({ok:true,idle:false,processed:1,remaining:Math.max(0,Number(pending.remaining||1)-1),writePerformed:false,review});
  }catch(e){return res.status(500).json({ok:false,error:e.message,writePerformed:false});}
};
