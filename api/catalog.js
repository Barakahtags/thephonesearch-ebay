const {guard}=require('./_lib/admin');
const mps=require('./_lib/mps');
const ebay=require('./_lib/ebay');
module.exports=async function(req,res){
  if(!guard(req,res)) return;
  try{
    const page=Math.max(1,Number(req.query.page||1)); const pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize||25)));
    const data=await mps.allParts(page,pageSize);
    const items=(data.Parts||[]).map(p=>({id:p.Id,sku:p.PartNumber,title:p.Description,manufacturer:p.Manufacturer,stock:p.AvailableStockQuantity,costExVat:p.UnitPrice,eBayPrice:ebay.sellingPrice(p.UnitPrice),ean:p.EanNumber,orderable:p.CanBeOrdered,images:(p.Images||[]).map(x=>x.ImageUrl).filter(Boolean)}));
    res.status(200).json({ok:true,page,pageSize,total:data.TotalNumberOfParts,hasMore:data.HasMoreRecords,items});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
};
