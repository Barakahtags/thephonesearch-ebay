const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');
const mps=require('./_lib/mps');
const {optimizeListing}=require('./_lib/ai-listing');
const pricing=require('./_lib/pricing');

module.exports=async function(req,res){
 if(!guard(req,res))return;
 try{
  const data=await ebay.api('/sell/inventory/v1/offer?marketplace_id=EBAY_DE&limit=200');
  const live=(data?.offers||[]).filter(x=>x.status==='PUBLISHED').slice(0,5);
  const rows=[];
  for(const offer of live){
   let inv=null,supplier=null,error=null;
   try{inv=await ebay.api(`/sell/inventory/v1/inventory_item/${encodeURIComponent(offer.sku)}`);}catch(e){error=e.message;}
   try{supplier=await mps.part(offer.sku);}catch(e){error=error||e.message;}
   let optimized=null,price=null;
   if(supplier){optimized=await optimizeListing(supplier);price=pricing.recommendedPrice(supplier.UnitPrice);}
   rows.push({offerId:offer.offerId,listingId:offer.listing?.listingId||null,sku:offer.sku,status:offer.status,current:{title:inv?.product?.title||null,description:inv?.product?.description||offer.listingDescription||null,price:offer.pricingSummary?.price||null,fulfillmentPolicyId:offer.listingPolicies?.fulfillmentPolicyId||null},supplierFound:!!supplier,recommended:supplier?{title:optimized.title,description:optimized.description,contentSource:optimized.source,itemPrice:price.itemPrice,customerShipping:price.customerShipping,buyerTotal:price.totalRevenue,netProfit:price.netProfit,netMargin:price.netMargin,marginPass:price.marginPass}:null,error});
  }
  res.status(200).json({ok:true,count:rows.length,liveListings:rows,writeLocked:true,note:'Audit only. Use guarded live update endpoint after reviewing recommendations.'});
 }catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};
