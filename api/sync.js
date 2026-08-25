const {guard}=require('./_lib/admin');
const mps=require('./_lib/mps');
const ebay=require('./_lib/ebay');

module.exports=async function(req,res){
  if(!guard(req,res)) return;
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'POST required'});

  const live=String(process.env.SYNC_MODE||'preview').toLowerCase()==='live';
  if(!live) return res.status(403).json({ok:false,error:'Live sync is locked. Set SYNC_MODE=live after reviewing the dry run. No listings were changed.'});

  try{
    // Initial production test is intentionally capped at five items.
    const limit=Math.min(5,Math.max(1,Number(req.query.limit||5)));
    const minPrice=Math.max(0,Number(process.env.MIN_SELLING_PRICE||5));
    const results=[];
    let page=1;
    let hasMore=true;

    while(results.length<limit && hasMore && page<=20){
      const data=await mps.allParts(page,100);
      hasMore=!!data?.HasMoreRecords;
      for(const summary of (data?.Parts||[])){
        if(results.length>=limit) break;
        if(!summary?.CanBeOrdered || Number(summary?.AvailableStockQuantity||0)<=0) continue;
        if(Number(ebay.sellingPrice(summary?.UnitPrice||0))<minPrice) continue;

        try{
          // all-parts does not include image data; fetch full details before creating inventory.
          const detailed=await mps.part(summary.PartNumber).catch(()=>null);
          const p=detailed||summary;
          if(!p?.CanBeOrdered || Number(p?.AvailableStockQuantity||0)<=0){
            results.push({ok:true,sku:summary.PartNumber,skipped:'no longer orderable/in stock'});
            continue;
          }
          if(Number(ebay.sellingPrice(p?.UnitPrice||0))<minPrice){
            results.push({ok:true,sku:summary.PartNumber,skipped:`calculated price below ${minPrice}`});
            continue;
          }
          results.push({ok:true,...await ebay.upsertPart(p)});
        }catch(e){
          results.push({ok:false,sku:summary.PartNumber,error:e.message,details:e.data||null});
        }
      }
      page++;
    }

    res.status(200).json({
      ok:results.every(x=>x.ok!==false),
      live:true,
      requestedLimit:limit,
      minSellingPrice:minPrice,
      publishedEnabled:String(process.env.EBAY_PUBLISH||'').toLowerCase()==='true',
      results
    });
  }catch(e){
    res.status(500).json({ok:false,error:e.message,details:e.data||null});
  }
};
