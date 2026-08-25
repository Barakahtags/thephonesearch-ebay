const {guard}=require('./_lib/admin');
const mps=require('./_lib/mps');
const ebay=require('./_lib/ebay');
module.exports=async function(req,res){
  if(!guard(req,res)) return;
  try{
    const requested=Math.min(25,Math.max(1,Number(req.query.limit||10)));
    const data=await mps.allParts(1,requested);
    const items=[];
    for(const p of (data.Parts||[]).slice(0,requested)){
      let categoryId=null,categoryError=null;
      try{categoryId=process.env.EBAY_DEFAULT_CATEGORY_ID||await ebay.suggestedCategory(`${p.Manufacturer||''} ${p.Description||p.PartNumber}`);}catch(e){categoryError=e.message;}
      items.push({sku:p.PartNumber,title:p.Description,stock:p.AvailableStockQuantity,costExVat:p.UnitPrice,calculatedPrice:ebay.sellingPrice(p.UnitPrice),categoryId,categoryError,images:(p.Images||[]).map(x=>x.ImageUrl).filter(Boolean).slice(0,12)});
    }
    const pol=await ebay.policies().catch(e=>({error:e.message})); const loc=await ebay.firstInventoryLocation().catch(()=>null);
    res.status(200).json({ok:true,dryRun:true,marketplace:process.env.EBAY_MARKETPLACE_ID||'EBAY_DE',currency:process.env.EBAY_CURRENCY||'EUR',policies:pol,inventoryLocation:loc,items});
  }catch(e){res.status(500).json({ok:false,error:e.message,details:e.data||null});}
};
