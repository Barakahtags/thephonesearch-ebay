const {guard}=require('./_lib/admin');
const mps=require('./_lib/mps');
const ebay=require('./_lib/ebay');
const pricing=require('./_lib/pricing');
const market=require('./_lib/market-pricing');
const {optimizeListing}=require('./_lib/ai-listing');
const {imageUrls,exclusionReason}=require('./_lib/catalog-quality');

module.exports=async function(req,res){
  if(!guard(req,res)) return;
  try{
    if(req.method==='POST'&&String(req.query.action||'').toLowerCase()==='optimize-selected'){
      const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
      const mode=String(body.mode||'').toLowerCase();
      if(!['title','description','price','profit','auto'].includes(mode))return res.status(400).json({ok:false,error:'mode must be title, description, price, profit or auto'});
      const skus=[...new Set((Array.isArray(body.skus)?body.skus:[]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,['price','profit','auto'].includes(mode)?10:100);
      const profitTargets=body.profitTargets&&typeof body.profitTargets==='object'?body.profitTargets:{};
      if(!skus.length)return res.status(400).json({ok:false,error:'Select at least one product'});
      const processSku=async sku=>{
        try{
          const p=await mps.part(sku),excluded=exclusionReason(p);
          if(excluded)throw new Error(excluded==='RESIN_PRODUCT'?'Resin products are excluded':excluded==='TRAINING_PRODUCT'?'Training products are excluded':'A valid product image is required');
          if(mode==='profit'){
            const target=Number(profitTargets[sku]);
            if(!Number.isFinite(target)||target<0||target>10000)throw new Error('After-tax profit target must be between €0 and €10,000');
            const calculation={...pricing.itemPriceForProfit(p.UnitPrice,target),minimumItemPrice:pricing.minimumItemPrice(p.UnitPrice).itemPrice,customProfitTarget:true,priceSource:'CUSTOM_AFTER_TAX_PROFIT'};
            return{ok:true,sku,calculatedPrice:calculation.itemPrice,buyerTotal:calculation.totalRevenue,pricing:calculation,listingStatus:'CUSTOM_PROFIT_TARGET',source:'Custom after-tax profit target',confidence:'MANUAL'};
          }
          const optimized=await optimizeListing(p);
          if(mode==='price'||mode==='auto'){
            const competitor=await market.competitorPrice(p,optimized.title),fallback=competitor.recommendedItemPrice==null;
            const calculation={...pricing.recommendedPrice(p.UnitPrice,fallback?null:competitor.recommendedItemPrice),fallback,priceSource:fallback?'FIXED_PROFIT_FALLBACK':'EBAY_LOWEST_MINUS_0_50'};
            const listingStatus=fallback?'FALLBACK_FIXED_PROFIT':competitor.status;
            return{ok:true,sku,...(mode==='auto'?{title:String(optimized.title||p.Description||sku).slice(0,80),description:optimized.description||String(p.Description||'')}:{calculatedPrice:calculation.itemPrice}),calculatedPrice:calculation.itemPrice,buyerTotal:calculation.totalRevenue,pricing:calculation,competitorPricing:competitor,listingStatus,source:mode==='auto'?'Automatic AI title, description and competitive pricing':fallback?'Protected fixed-profit fallback pricing':'eBay lowest-price undercut pricing',confidence:competitor.confidence};
          }
          return{ok:true,sku,...(mode==='title'?{title:String(optimized.title||p.Description||sku).slice(0,80)}:{description:optimized.description||String(p.Description||'')}),source:optimized.source,confidence:optimized.confidence};
        }catch(e){return{ok:false,sku,error:e.message};}
      };
      const results=await Promise.all(skus.map(processSku));
      return res.status(results.every(x=>x.ok)?200:207).json({ok:results.every(x=>x.ok),dryRun:true,writePerformed:false,mode,count:results.length,results});
    }
    if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET or optimize-selected POST required'});
    const requested=Math.min(25,Math.max(1,Number(req.query.limit||10)));
    const minPrice=Math.max(0,Number(process.env.MIN_SELLING_PRICE||5));
    const items=[];
    let page=1,hasMore=true;
    while(items.length<requested && hasMore && page<=20){
      const data=await mps.allParts(page,100);hasMore=!!data?.HasMoreRecords;
      for(const summary of (data?.Parts||[])){
        if(items.length>=requested) break;
        if(!summary?.CanBeOrdered||Number(summary?.AvailableStockQuantity||0)<=0) continue;
        const summaryFloor=pricing.recommendedPrice(summary?.UnitPrice||0);
        if(Number(summaryFloor.itemPrice)<minPrice) continue;
        const detailed=await mps.part(summary.PartNumber).catch(()=>null),p=detailed||summary;
        if(!p?.CanBeOrdered||Number(p?.AvailableStockQuantity||0)<=0||exclusionReason(p)) continue;
        const floor=pricing.recommendedPrice(p?.UnitPrice||0);
        if(Number(floor.itemPrice)<minPrice) continue;
        const optimized=await optimizeListing(p);
        let categoryId=null,categoryError=null;
        try{categoryId=process.env.EBAY_DEFAULT_CATEGORY_ID||await ebay.suggestedCategory(`${p.Manufacturer||''} ${optimized.title||p.Description||p.PartNumber}`);}catch(e){categoryError=e.message;}
        let competitor=null,competitorError=null;
        try{competitor=await market.competitorPrice(p,optimized.title);}catch(e){competitorError=e.message;}
        const listingStatus=competitor?.status||'MARKET_CHECK_ERROR';
        const marketUnavailable=competitor?.recommendedItemPrice==null;
        const finalPricing={...pricing.recommendedPrice(p?.UnitPrice||0,marketUnavailable?null:competitor.recommendedItemPrice),fallback:marketUnavailable,priceSource:marketUnavailable?'FIXED_PROFIT_FALLBACK':'EBAY_LOWEST_MINUS_0_50'};
        items.push({sku:p.PartNumber,supplierTitle:optimized.supplierTitle||p.Description,title:optimized.title||p.Description,optimizedTitle:optimized.title||p.Description,description:optimized.description||String(p.Description||''),contentSource:optimized.source,aiError:optimized.aiError||null,stock:p.AvailableStockQuantity,costExVat:p.UnitPrice,calculatedPrice:finalPricing.itemPrice,buyerTotal:finalPricing.totalRevenue,minimumPrice:floor.minimumItemPrice,pricing:finalPricing,competitorPricing:competitor,competitorError,listingStatus:marketUnavailable?'FALLBACK_FIXED_PROFIT':listingStatus,categoryId,categoryError,images:imageUrls(p).slice(0,12)});
      }
      page++;
    }
    const pol=await ebay.policies().catch(e=>({error:e.message}));
    const loc=await ebay.firstInventoryLocation().catch(()=>null);
    const ebayOk=!pol?.error&&!!loc&&items.every(x=>!x.categoryError);
    res.status(ebayOk?200:207).json({ok:ebayOk,dryRun:true,competitorPricing:true,aiConfigured:!!process.env.OPENAI_API_KEY,marketplace:process.env.EBAY_MARKETPLACE_ID||'EBAY_DE',currency:process.env.EBAY_CURRENCY||'EUR',minSellingPrice:minPrice,pricingConfig:pricing.config(),policies:pol,inventoryLocation:loc,items});
  }catch(e){res.status(500).json({ok:false,error:e.message,details:e.data||null});}
};
