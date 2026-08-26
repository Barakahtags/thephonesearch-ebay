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
    const articleType=Number(req.query.articleType||1);
    if(![1,3].includes(articleType))return res.status(400).json({ok:false,error:'Only Ersatzteile and Werkzeuge are available'});
    const data=q?await mps.searchParts(q,articleType,page,pageSize):await mps.catalogueParts(articleType,page,pageSize);
    let source=data.Parts||[];
    if(String(req.query.details||'').toLowerCase()==='true'){
      const chunks=[];
      for(let i=0;i<source.length;i+=100)chunks.push(source.slice(i,i+100).map(p=>p.PartNumber));
      const detailed=(await Promise.all(chunks.map(chunk=>mps.multipleParts(chunk))).catch(()=>[])).flat(),bySku=new Map(detailed.map(p=>[String(p.PartNumber),p]));
      source=source.map(p=>bySku.get(String(p.PartNumber))||p);
    }
    const excludedOnPage=source.filter(exclusionReason).length;
    const items=source.filter(p=>!exclusionReason(p)).map(p=>({id:p.Id,sku:p.PartNumber,title:p.Description,manufacturer:p.Manufacturer,stock:p.AvailableStockQuantity,costExVat:p.UnitPrice,eBayPrice:ebay.sellingPrice(p.UnitPrice),ean:p.EanNumber,orderable:p.CanBeOrdered,statusText:p.StatusText,averageDeliveryInDays:p.AverageDeliveryInDays,images:imageUrls(p)}));
    res.status(200).json({ok:true,q,articleType,articleTypeName:articleType===1?'Ersatzteile':'Werkzeuge',page,pageSize,total:data.TotalNumberOfParts,hasMore:data.HasMoreRecords,excludedOnPage,qualityRules:['PARTS_AND_TOOLS_ONLY','NO_RESIN','IMAGE_REQUIRED'],items});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
};
