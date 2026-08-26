const {guard}=require('./_lib/admin');
const mps=require('./_lib/mps');
const ebay=require('./_lib/ebay');
const {optimizeListing}=require('./_lib/ai-listing');
const pricing=require('./_lib/pricing');

async function liveFiveAudit(){
  const marketplace=process.env.EBAY_MARKETPLACE_ID||'EBAY_DE';
  const data=await ebay.api(`/sell/inventory/v1/offer?marketplace_id=${encodeURIComponent(marketplace)}&limit=200`);
  const live=(data?.offers||[]).filter(x=>x.status==='PUBLISHED').slice(0,5);
  const rows=[];
  for(const offer of live){
    let inv=null,supplier=null,error=null;
    try{inv=await ebay.api(`/sell/inventory/v1/inventory_item/${encodeURIComponent(offer.sku)}`);}catch(e){error=e.message;}
    try{supplier=await mps.part(offer.sku);}catch(e){error=error||e.message;}
    let optimized=null,calc=null;
    if(supplier){optimized=await optimizeListing(supplier);calc=pricing.recommendedPrice(supplier.UnitPrice);}
    rows.push({
      offerId:offer.offerId,
      listingId:offer.listing?.listingId||null,
      sku:offer.sku,
      status:offer.status,
      current:{
        title:inv?.product?.title||null,
        description:inv?.product?.description||offer.listingDescription||null,
        price:Number(offer.pricingSummary?.price?.value||0),
        currency:offer.pricingSummary?.price?.currency||'EUR',
        fulfillmentPolicyId:offer.listingPolicies?.fulfillmentPolicyId||null,
        quantity:Number(offer.availableQuantity||inv?.availability?.shipToLocationAvailability?.quantity||0)
      },
      supplierFound:!!supplier,
      supplier:supplier?{title:supplier.Description||null,cost:Number(supplier.UnitPrice||0),stock:Number(supplier.AvailableStockQuantity||0),orderable:supplier.CanBeOrdered!==false}:null,
      recommended:supplier?{
        title:optimized.title,
        description:optimized.description,
        contentSource:optimized.source,
        confidence:optimized.confidence??null,
        itemPrice:Number(calc.itemPrice),
        customerShipping:Number(calc.customerShipping),
        buyerTotal:Number(calc.totalRevenue),
        supplierShipping:Number(calc.supplierShipping),
        netProfit:Number(calc.netProfit),
        netMargin:Number(calc.netMargin),
        marginPass:!!calc.marginPass
      }:null,
      readyToFix:!!supplier&&supplier.CanBeOrdered!==false&&Number(supplier.AvailableStockQuantity||0)>0&&!!calc?.marginPass,
      error
    });
  }
  return rows;
}

async function fixLiveFive(){
  const rows=await liveFiveAudit();
  const marketplace=process.env.EBAY_MARKETPLACE_ID||'EBAY_DE';
  const policy=await ebay.policies(marketplace);
  const desiredFulfillment=process.env.EBAY_FULFILLMENT_POLICY_ID||policy.fulfillmentPolicyId;
  const results=[];
  for(const row of rows){
    if(!row.readyToFix){results.push({sku:row.sku,ok:false,skipped:'Supplier match/stock/margin validation failed'});continue;}
    try{
      const inv=await ebay.api(`/sell/inventory/v1/inventory_item/${encodeURIComponent(row.sku)}`);
      const supplier=await mps.part(row.sku);
      const opt=await optimizeListing(supplier);
      const calc=pricing.recommendedPrice(supplier.UnitPrice);
      const images=(supplier.Images||[]).map(x=>x?.ImageUrl).filter(Boolean).slice(0,12);
      const product={...(inv.product||{}),title:String(opt.title||row.current.title||row.sku).slice(0,80),description:String(opt.description||row.current.description||'')};
      if(images.length)product.imageUrls=images;
      if(supplier.EanNumber)product.ean=[String(supplier.EanNumber)];
      const inventory={
        availability:{shipToLocationAvailability:{quantity:Math.max(0,Number(supplier.AvailableStockQuantity||0))}},
        condition:inv.condition||'NEW',
        product
      };
      await ebay.api(`/sell/inventory/v1/inventory_item/${encodeURIComponent(row.sku)}`,{method:'PUT',body:JSON.stringify(inventory)});

      const offer=await ebay.api(`/sell/inventory/v1/offer/${encodeURIComponent(row.offerId)}`);
      const body={
        sku:row.sku,
        marketplaceId:offer.marketplaceId||marketplace,
        format:offer.format||'FIXED_PRICE',
        listingDuration:offer.listingDuration||'GTC',
        availableQuantity:Math.max(0,Number(supplier.AvailableStockQuantity||0)),
        categoryId:offer.categoryId,
        merchantLocationKey:offer.merchantLocationKey,
        listingDescription:String(opt.description||row.current.description||''),
        listingPolicies:{
          ...(offer.listingPolicies||{}),
          fulfillmentPolicyId:desiredFulfillment,
          paymentPolicyId:offer.listingPolicies?.paymentPolicyId||policy.paymentPolicyId,
          returnPolicyId:offer.listingPolicies?.returnPolicyId||policy.returnPolicyId
        },
        pricingSummary:{price:{currency:'EUR',value:Number(calc.itemPrice).toFixed(2)}}
      };
      await ebay.api(`/sell/inventory/v1/offer/${encodeURIComponent(row.offerId)}`,{method:'PUT',body:JSON.stringify(body)});
      results.push({sku:row.sku,offerId:row.offerId,ok:true,title:product.title,price:Number(calc.itemPrice),customerShipping:Number(calc.customerShipping),buyerTotal:Number(calc.totalRevenue),netMargin:Number(calc.netMargin),fulfillmentPolicyId:desiredFulfillment});
    }catch(e){results.push({sku:row.sku,offerId:row.offerId,ok:false,error:e.message,details:e.data||null});}
  }
  return results;
}

module.exports=async function(req,res){
  if(!guard(req,res)) return;
  try{
    const action=String(req.query?.action||'').toLowerCase();
    if(action==='audit-live-five'){
      const rows=await liveFiveAudit();
      return res.status(200).json({ok:true,action,count:rows.length,liveListings:rows,writePerformed:false});
    }
    if(action==='fix-live-five'){
      if(req.method!=='POST')return res.status(405).json({ok:false,error:'POST required'});
      const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
      if(body.confirm!=='FIX_LIVE_5')return res.status(400).json({ok:false,error:'Confirmation value FIX_LIVE_5 required'});
      const results=await fixLiveFive();
      return res.status(results.every(x=>x.ok)?200:207).json({ok:results.every(x=>x.ok),action,count:results.length,results});
    }

    if(req.method!=='POST') return res.status(405).json({ok:false,error:'POST required'});
    const live=String(process.env.SYNC_MODE||'preview').toLowerCase()==='live';
    if(!live) return res.status(403).json({ok:false,error:'Live sync is locked. Set SYNC_MODE=live after reviewing the dry run. No listings were changed.'});

    const limit=Math.min(5,Math.max(1,Number(req.query.limit||5)));
    const minPrice=Math.max(0,Number(process.env.MIN_SELLING_PRICE||5));
    const results=[];let page=1,hasMore=true;
    while(results.length<limit&&hasMore&&page<=20){
      const data=await mps.allParts(page,100);hasMore=!!data?.HasMoreRecords;
      for(const summary of (data?.Parts||[])){
        if(results.length>=limit)break;
        if(!summary?.CanBeOrdered||Number(summary?.AvailableStockQuantity||0)<=0)continue;
        if(Number(ebay.sellingPrice(summary?.UnitPrice||0))<minPrice)continue;
        try{
          const detailed=await mps.part(summary.PartNumber).catch(()=>null),p=detailed||summary;
          if(!p?.CanBeOrdered||Number(p?.AvailableStockQuantity||0)<=0){results.push({ok:true,sku:summary.PartNumber,skipped:'no longer orderable/in stock'});continue;}
          if(Number(ebay.sellingPrice(p?.UnitPrice||0))<minPrice){results.push({ok:true,sku:summary.PartNumber,skipped:`calculated price below ${minPrice}`});continue;}
          results.push({ok:true,...await ebay.upsertPart(p)});
        }catch(e){results.push({ok:false,sku:summary.PartNumber,error:e.message,details:e.data||null});}
      }
      page++;
    }
    res.status(200).json({ok:results.every(x=>x.ok!==false),live:true,requestedLimit:limit,minSellingPrice:minPrice,publishedEnabled:String(process.env.EBAY_PUBLISH||'').toLowerCase()==='true',results});
  }catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};
