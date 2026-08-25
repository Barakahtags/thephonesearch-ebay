const mps=require('./_lib/mps');
const ebay=require('./_lib/ebay');

module.exports=async function(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'GET required'});
  try{
    const marketplace=process.env.EBAY_MARKETPLACE_ID||'EBAY_DE';
    const policyName='MobileParts UPS Test 8.40';
    let policyId=null;
    try {
      const existing=await ebay.api(`/sell/account/v1/fulfillment_policy/get_by_policy_name?marketplace_id=${encodeURIComponent(marketplace)}&name=${encodeURIComponent(policyName)}`);
      policyId=existing?.fulfillmentPolicyId||null;
    } catch(e) { if(e.status!==404) throw e; }

    if(!policyId){
      const body={
        name:policyName,
        description:'MobileParts test shipping policy - UPS Standard, EUR 8.40 flat rate',
        marketplaceId:marketplace,
        categoryTypes:[{name:'ALL_EXCLUDING_MOTORS_VEHICLES'}],
        handlingTime:{value:1,unit:'DAY'},
        shippingOptions:[{
          optionType:'DOMESTIC',
          costType:'FLAT_RATE',
          shippingServices:[{
            sortOrder:1,
            shippingCarrierCode:'UPS_DE',
            shippingServiceCode:'DE_UPSStandard',
            shippingCost:{value:'8.40',currency:'EUR'},
            additionalShippingCost:{value:'8.40',currency:'EUR'},
            freeShipping:false
          }]
        }]
      };
      const created=await ebay.api('/sell/account/v1/fulfillment_policy',{method:'POST',body:JSON.stringify(body)});
      policyId=created.fulfillmentPolicyId;
    }
    if(!policyId) throw new Error('Could not resolve/create fulfillment policy');

    process.env.EBAY_FULFILLMENT_POLICY_ID=policyId;
    process.env.EBAY_PUBLISH='true';

    const results=[];
    let page=1, hasMore=true;
    while(results.length<5 && hasMore && page<=20){
      const data=await mps.allParts(page,100);
      hasMore=!!data?.HasMoreRecords;
      for(const summary of (data?.Parts||[])){
        if(results.length>=5) break;
        if(!summary?.CanBeOrdered || Number(summary?.AvailableStockQuantity||0)<=0) continue;
        if(Number(ebay.sellingPrice(summary?.UnitPrice||0))<5) continue;
        try{
          const detailed=await mps.part(summary.PartNumber).catch(()=>null);
          const p=detailed||summary;
          if(!p?.CanBeOrdered || Number(p?.AvailableStockQuantity||0)<=0) continue;
          if(Number(ebay.sellingPrice(p?.UnitPrice||0))<5) continue;
          const out=await ebay.upsertPart(p);
          results.push({ok:true,...out});
        }catch(e){
          results.push({ok:false,sku:summary.PartNumber,error:e.message,details:e.data||null});
        }
      }
      page++;
    }

    res.status(200).json({
      ok:results.every(x=>x.ok!==false),
      fulfillmentPolicyId:policyId,
      fulfillmentPolicyName:policyName,
      shipping:'UPS Standard EUR 8.40',
      attempted:results.length,
      results
    });
  }catch(e){
    res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});
  }
};
