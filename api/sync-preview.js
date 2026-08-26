const {guard}=require('./_lib/admin');
const mps=require('./_lib/mps');
const ebay=require('./_lib/ebay');
const pricing=require('./_lib/pricing');
const {optimizeListing}=require('./_lib/ai-listing');

module.exports=async function(req,res){
  if(!guard(req,res)) return;
  try{
    const requested=Math.min(25,Math.max(1,Number(req.query.limit||10)));
    const minPrice=Math.max(0,Number(process.env.MIN_SELLING_PRICE||5));
    const items=[];
    let page=1;
    let hasMore=true;

    while(items.length<requested && hasMore && page<=20){
      const data=await mps.allParts(page,100);
      hasMore=!!data?.HasMoreRecords;
      for(const summary of (data?.Parts||[])){
        if(items.length>=requested) break;
        if(!summary?.CanBeOrdered || Number(summary?.AvailableStockQuantity||0)<=0) continue;

        const summaryPricing=pricing.recommendedPrice(summary?.UnitPrice||0);
        if(Number(summaryPricing.itemPrice)<minPrice) continue;

        const detailed=await mps.part(summary.PartNumber).catch(()=>null);
        const p=detailed||summary;
        if(!p?.CanBeOrdered || Number(p?.AvailableStockQuantity||0)<=0) continue;

        const price=pricing.recommendedPrice(p?.UnitPrice||0);
        if(Number(price.itemPrice)<minPrice) continue;

        const optimized=await optimizeListing(p);
        let categoryId=null,categoryError=null;
        try{categoryId=process.env.EBAY_DEFAULT_CATEGORY_ID||await ebay.suggestedCategory(`${p.Manufacturer||''} ${optimized.title||p.Description||p.PartNumber}`);}catch(e){categoryError=e.message;}
        items.push({
          sku:p.PartNumber,
          supplierTitle:optimized.supplierTitle||p.Description,
          title:optimized.title||p.Description,
          optimizedTitle:optimized.title||p.Description,
          description:optimized.description||String(p.Description||''),
          contentSource:optimized.source,
          aiError:optimized.aiError||null,
          stock:p.AvailableStockQuantity,
          costExVat:p.UnitPrice,
          calculatedPrice:price.itemPrice,
          minimumPrice:price.minimumItemPrice,
          pricing:price,
          categoryId,categoryError,
          images:(p.Images||[]).map(x=>x.ImageUrl).filter(Boolean).slice(0,12)
        });
      }
      page++;
    }

    const pol=await ebay.policies().catch(e=>({error:e.message}));
    const loc=await ebay.firstInventoryLocation().catch(()=>null);
    const ebayOk=!pol?.error && !!loc && items.every(x=>!x.categoryError);
    res.status(ebayOk?200:207).json({
      ok:ebayOk,
      dryRun:true,
      aiConfigured:!!process.env.OPENAI_API_KEY,
      marketplace:process.env.EBAY_MARKETPLACE_ID||'EBAY_DE',
      currency:process.env.EBAY_CURRENCY||'EUR',
      minSellingPrice:minPrice,
      pricingConfig:pricing.config(),
      policies:pol,
      inventoryLocation:loc,
      items
    });
  }catch(e){res.status(500).json({ok:false,error:e.message,details:e.data||null});}
};
