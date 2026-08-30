const {guard}=require('./_lib/admin');
const mps=require('./_lib/mps');
const ebay=require('./_lib/ebay');
const {QUALITY_RULES,imageUrls,catalogueExclusionReason}=require('./_lib/catalog-quality');

function mapPart(p){
  const images=imageUrls(p);
  return {id:p.Id,sku:p.PartNumber,title:p.Description,manufacturer:p.Manufacturer,stock:p.AvailableStockQuantity,costExVat:p.UnitPrice,eBayPrice:ebay.sellingPrice(p.UnitPrice),ean:p.EanNumber,orderable:p.CanBeOrdered,statusText:p.StatusText,averageDeliveryInDays:p.AverageDeliveryInDays,images,imageRecovery:images.length?{status:'SUPPLIER_IMAGE',source:'MOBILEPARTS_API',rightsBasis:'SUPPLIER_API'}:{status:'RECOVERY_REQUIRED'},stockQuantities:p.StockQuantities||[],secondaryArticleNumbers:p.SecondaryArticleNumbers||[],replacementArticleNumbers:p.ReplacementArticleNumbers||[]};
}

module.exports=async function(req,res){
  if(!guard(req,res)) return;
  try{
    const pageSize=100;
    const q=String(req.query.q||'').trim();
    const articleType=Number(req.query.articleType||1);
    if(![1,3].includes(articleType))return res.status(400).json({ok:false,error:'Only Ersatzteile and Werkzeuge are available'});
    const maxPages=Math.min(250,Math.max(1,Number(req.query.maxPages||250)));
    let page=1,items=[],total=0,excluded=0,hasMore=true;
    while(hasMore && page<=maxPages){
      const data=q?await mps.searchParts(q,articleType,page,pageSize):await mps.catalogueParts(articleType,page,pageSize);
      total=Number(data.TotalNumberOfParts||total||0);
      const source=data.Parts||[];
      excluded+=source.filter(catalogueExclusionReason).length;
      items.push(...source.filter(p=>!catalogueExclusionReason(p)).map(mapPart));
      hasMore=!!data.HasMoreRecords;
      page++;
    }
    res.status(200).json({ok:true,q,articleType,articleTypeName:articleType===1?'Ersatzteile':'Werkzeuge',pageSize,total,retrieved:items.length,excluded,qualityRules:['PARTS_AND_TOOLS_ONLY',...QUALITY_RULES],complete:!hasMore,pagesFetched:page-1,items});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
};
