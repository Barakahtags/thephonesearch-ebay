const mps=require('./_lib/mps');
const ebay=require('./_lib/ebay');

module.exports=async function(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'GET required'});
  const results=[];
  try{
    process.env.EBAY_PUBLISH='true';
    const limit=5;
    const minPrice=5;
    let page=1,hasMore=true;
    while(results.length<limit && hasMore && page<=20){
      const data=await mps.allParts(page,100);
      hasMore=!!data?.HasMoreRecords;
      for(const summary of (data?.Parts||[])){
        if(results.length>=limit) break;
        if(!summary?.CanBeOrdered || Number(summary?.AvailableStockQuantity||0)<=0) continue;
        if(Number(ebay.sellingPrice(summary?.UnitPrice||0))<minPrice) continue;
        try{
          const detailed=await mps.part(summary.PartNumber).catch(()=>null);
          const p=detailed||summary;
          if(!p?.CanBeOrdered || Number(p?.AvailableStockQuantity||0)<=0) continue;
          if(Number(ebay.sellingPrice(p?.UnitPrice||0))<minPrice) continue;
          results.push({ok:true,...await ebay.upsertPart(p)});
        }catch(e){
          results.push({ok:false,sku:summary.PartNumber,error:e.message,details:e.data||null});
        }
      }
      page++;
    }
    return res.status(200).json({ok:results.every(x=>x.ok!==false),publishedRequested:true,count:results.length,results});
  }catch(e){
    return res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null,results});
  }
};
