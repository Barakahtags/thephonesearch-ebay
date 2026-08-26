const {guard}=require('./_lib/admin');
const mps=require('./_lib/mps');
const ebay=require('./_lib/ebay');
const {imageUrls,exclusionReason}=require('./_lib/catalog-quality');
module.exports=async function(req,res){
  if(!guard(req,res)) return;
  try{
    const page=Math.max(1,Number(req.query.page||1));
    const pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize||25)));
    const q=String(req.query.q||'').trim();
    const articleType=Math.max(1,Math.min(4,Number(req.query.articleType||1)));
    const data=q?await mps.searchParts(q,articleType,page,pageSize):await mps.allParts(page,pageSize);
    const source=data.Parts||[],excludedOnPage=source.filter(exclusionReason).length;
    const items=source.filter(p=>!exclusionReason(p)).map(p=>({id:p.Id,sku:p.PartNumber,title:p.Description,manufacturer:p.Manufacturer,stock:p.AvailableStockQuantity,costExVat:p.UnitPrice,eBayPrice:ebay.sellingPrice(p.UnitPrice),ean:p.EanNumber,orderable:p.CanBeOrdered,statusText:p.StatusText,averageDeliveryInDays:p.AverageDeliveryInDays,images:imageUrls(p)}));
    res.status(200).json({ok:true,q,articleType,page,pageSize,total:data.TotalNumberOfParts,hasMore:data.HasMoreRecords,excludedOnPage,qualityRules:['NO_RESIN','IMAGE_REQUIRED'],items});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
};
