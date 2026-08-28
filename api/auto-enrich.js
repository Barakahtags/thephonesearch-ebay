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
    const batchSize=Math.min(10,Math.max(1,Number(process.env.AUTO_ENRICH_BATCH_SIZE||5)));
    const pending=await workerCall(`/ai-pending?limit=${batchSize}`),records=pending.items||[];
    if(!records.length)return res.status(200).json({ok:true,idle:true,processed:0,remaining:0,writePerformed:false,note:'Automatic AI backlog is complete.'});
    const processRecord=async record=>{
      const sku=String(record.sku||record.PartNumber||'');
      try{
        const p=await mps.part(sku),excluded=exclusionReason(p);
        if(excluded)throw new Error(excluded==='RESIN_PRODUCT'?'Resin products are excluded':excluded==='TRAINING_PRODUCT'?'Training products are excluded':'A valid product image is required');
        const optimized=await optimizeListing(p),competitor=await market.competitorPrice(p,optimized.title),calculation=competitor.recommendedItemPrice==null?{pricingVersion:pricing.PRICING_VERSION,pending:true,targetProfit:pricing.fixedProfitTarget(p.UnitPrice),netProfit:null}:pricing.breakdown(competitor.recommendedItemPrice,p.UnitPrice),now=new Date().toISOString();
        return{sku,title:String(optimized.title||p.Description||sku).slice(0,80),description:optimized.description||String(p.Description||''),status:'review',contentSource:'Automatic title, description and fixed-profit pricing',calculatedPrice:calculation.itemPrice??null,buyerTotal:calculation.totalRevenue??null,pricing:calculation,competitorPricing:competitor,listingStatus:competitor.status,autoProcessedAt:now,autoError:''};
      }catch(error){return{sku,status:'review',autoProcessedAt:new Date().toISOString(),autoError:String(error?.message||error),contentSource:'Automatic processing needs review'};}
    };
    const outcomes=await Promise.all(records.map(processRecord)),reviews=outcomes.filter(x=>!x.autoError),failures=outcomes.length-reviews.length;
    const saved=reviews.length?await workerCall('/reviews',{method:'POST',body:JSON.stringify({reviews})}):{saved:0};
    console.log(JSON.stringify({event:'automatic_ai',ok:true,requested:records.length,saved:saved.saved,failures,remaining:Math.max(0,Number(pending.remaining||records.length)-records.length)}));
    return res.status(failures?207:200).json({ok:failures===0,idle:false,processed:reviews.length,failed:failures,saved:saved.saved,remaining:Math.max(0,Number(pending.remaining||records.length)-reviews.length),writePerformed:false,reviews,errors:outcomes.filter(x=>x.autoError).map(x=>({sku:x.sku,error:x.autoError}))});
  }catch(e){console.error(JSON.stringify({event:'automatic_ai',ok:false,error:String(e?.message||e)}));return res.status(500).json({ok:false,error:e.message,writePerformed:false});}
};
