const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');
const mps=require('./_lib/mps');
const pricing=require('./_lib/pricing');
const {exclusionReason}=require('./_lib/catalog-quality');

const workerOrigin=()=>process.env.CATALOGUE_WORKER_ORIGIN||'https://thephonesearch-stock-sync.thephonesearchpk.workers.dev';
async function catalogueSample(limit=20){
  let eligible=[];
  try{
    const response=await fetch(`${workerOrigin()}/products?view=all&limit=200&offset=0`,{headers:{'x-admin-token':process.env.ADMIN_TOKEN}});
    const text=await response.text();let data=null;try{data=JSON.parse(text)}catch{}
    if(!response.ok||!data?.ok)throw new Error(`Catalogue storage unavailable (${response.status})`);
    eligible=(data.items||[]).filter(p=>Number(p.stock||p.AvailableStockQuantity||0)>0&&Number.isFinite(Number(p.costExVat??p.UnitPrice)));
  }catch(error){
    console.warn(JSON.stringify({event:'orders_catalogue_fallback',reason:String(error?.message||error)}));
    for(let page=1;page<=10&&eligible.length<limit;page++){
      const data=await mps.allParts(page,100);
      eligible.push(...(data?.Parts||[]).filter(p=>p?.CanBeOrdered!==false&&Number(p?.AvailableStockQuantity||0)>0&&Number.isFinite(Number(p?.UnitPrice))&&!exclusionReason(p)));
      if(!data?.HasMoreRecords)break;
    }
  }
  if(eligible.length<limit)throw new Error(`Only ${eligible.length} in-stock MobileParts products were available for the test orders`);
  const step=Math.max(1,Math.floor(eligible.length/limit));return Array.from({length:limit},(_,i)=>eligible[i*step]);
}

function demoOrder(product,index){
  const supplierCost=Number((product.costExVat??product.UnitPrice)||0),savedPrice=Number(product.review?.calculatedPrice),hasApprovedPrice=product.review?.listingStatus==='GOOD_TO_LIST'&&Number.isFinite(savedPrice)&&savedPrice>0;
  const calc=hasApprovedPrice?pricing.breakdown(savedPrice,supplierCost):pricing.minimumItemPrice(supplierCost),n=String(index+1).padStart(2,'0');
  const sku=String(product.sku||product.PartNumber||`CATALOGUE-${n}`),title=String(product.review?.title||product.title||product.Description||sku).slice(0,80);
  return {orderId:`TEST-CATALOGUE-${n}`,creationDate:new Date(Date.now()-index*15*60*1000).toISOString(),orderFulfillmentStatus:'NOT_STARTED',orderPaymentStatus:'PAID',paymentSummary:{payments:[{paymentStatus:'PAID'}]},buyer:{username:`test-buyer-${n}`},shipTo:{fullName:`Test Customer ${n}`,contactAddress:{addressLine1:'TEST ADDRESS — NO SHIPMENT',city:'Düsseldorf',stateOrProvince:'NRW',postalCode:'40000',countryCode:'DE'}},pricingSummary:{total:{value:calc.totalRevenue.toFixed(2),currency:'EUR'}},lineItems:[{lineItemId:`TEST-LINE-${n}`,sku,title:`TEST — ${title}`,quantity:1,total:{value:calc.itemPrice.toFixed(2),currency:'EUR'}}],financials:{...calc,itemSale:calc.itemPrice,shippingCharged:calc.customerShipping},demo:true,testOnly:true,catalogueProduct:true,supplierAction:'NONE',supplierPurchaseLocked:true};
}

async function enrichOrder(o){
  const shipTo=o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
  const lines=[];let supplierSubtotal=0,stockReady=true;
  for(const li of (o.lineItems||[])){
    let supplier=null,error=null;
    if(li.sku){try{supplier=await mps.part(li.sku);}catch(e){error=e.message;}}
    const qty=Math.max(1,Number(li.quantity||1)),unitCost=Number(supplier?.UnitPrice||0),available=Number(supplier?.AvailableStockQuantity||0);
    supplierSubtotal+=unitCost*qty;if(!supplier||available<qty||supplier?.CanBeOrdered===false)stockReady=false;
    lines.push({lineItemId:li.lineItemId,sku:li.sku,title:li.title,quantity:qty,total:li.total,supplierMatch:!!supplier,supplierPartNumber:supplier?.PartNumber||li.sku||null,supplierUnitCost:unitCost,supplierAvailableStock:available,supplierCanBeOrdered:supplier?.CanBeOrdered!==false,supplierError:error});
  }
  const saleTotal=Number(o.pricingSummary?.total?.value||0),customerShipping=Number(process.env.EBAY_CUSTOMER_SHIPPING_DE||4.99),itemSale=Math.max(0,saleTotal-customerShipping),calc=pricing.breakdown(itemSale,supplierSubtotal);
  return {orderId:o.orderId,creationDate:o.creationDate,orderFulfillmentStatus:o.orderFulfillmentStatus,orderPaymentStatus:o.orderPaymentStatus,paymentSummary:o.paymentSummary,pricingSummary:o.pricingSummary,buyer:o.buyer,shipTo,lineItems:lines,financials:{...calc,itemSale:calc.itemPrice,shippingCharged:calc.customerShipping},demo:false,testOnly:false,supplierAction:'PREPARE_ONLY',supplierPurchaseLocked:true,supplierPlan:{ready:stockReady&&lines.length>0,stockReady,supplierSubtotal:Number(supplierSubtotal.toFixed(2)),supplierShipping:calc.supplierShipping,deliveryAddress:shipTo,items:lines.map(x=>({PartNumber:x.supplierPartNumber,Quantity:x.quantity})),note:'Prepared only. No MobileParts order has been submitted.'}};
}

module.exports=async function(req,res){
  if(!guard(req,res)) return;
  try{
    if(req.query?.mpsOrderNumber){
      const tracking=await mps.orderTracking(req.query.mpsOrderNumber);
      return res.status(200).json({ok:true,readOnly:true,mpsOrderNumber:req.query.mpsOrderNumber,tracking,ebayTrackingWriteLocked:String(process.env.ENABLE_TRACKING_WRITE||'').toLowerCase()!=='true'});
    }
    const filter=encodeURIComponent('orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}'),data=await ebay.api(`/sell/fulfillment/v1/order?filter=${filter}&limit=50`);
    let orders=[];for(const o of (data.orders||[]))orders.push(await enrichOrder(o));
    const demo=orders.length===0;if(demo){const products=await catalogueSample(20);orders=products.map(demoOrder);}
    res.status(200).json({ok:true,total:orders.length,orders,demo,placeOrderLocked:true,trackingReadReady:true,trackingWriteLocked:String(process.env.ENABLE_TRACKING_WRITE||'').toLowerCase()!=='true',note:demo?'20 TEST ORDERS built from real in-stock catalogue products. No eBay order, stock update, MobileParts basket, supplier purchase or fulfilment action was created.':'Live eBay orders are matched to MobileParts SKU/stock/cost and prepared for review. MobileParts tracking retrieval is ready; supplier purchasing and eBay tracking writes remain locked until durable idempotency storage is configured.'});
  }catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};
