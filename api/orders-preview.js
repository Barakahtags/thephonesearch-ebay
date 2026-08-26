const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');
const mps=require('./_lib/mps');
const pricing=require('./_lib/pricing');

function demoOrder(index){
  const products=['iPhone 17 Pro Max Display Replacement Part','iPhone 16 Pro Battery','Samsung Galaxy S25 Ultra Display','Google Pixel 10 Pro XL Display','iPhone 15 Pro Max Charging Port'];
  const supplierCost=50+(index%4)*3,calc=pricing.recommendedPrice(supplierCost,99.99+(index%5)*10),n=String(index+1).padStart(2,'0');
  return {orderId:`TEST-EBAY-1000${n}`,creationDate:new Date(Date.now()-index*15*60*1000).toISOString(),orderFulfillmentStatus:'NOT_STARTED',orderPaymentStatus:'PAID',paymentSummary:{payments:[{paymentStatus:'PAID'}]},buyer:{username:`test-buyer-${n}`},shipTo:{fullName:`Test Customer ${n}`,contactAddress:{addressLine1:'Neusalzerweg 2b',city:'Düsseldorf',stateOrProvince:'NRW',postalCode:'40627',countryCode:'DE'}},pricingSummary:{total:{value:calc.totalRevenue.toFixed(2),currency:'EUR'}},lineItems:[{lineItemId:`TEST-LINE-${n}`,sku:`TEST-MPS-SKU-${n}`,title:`TEST — ${products[index%products.length]}`,quantity:1,total:{value:calc.itemPrice.toFixed(2),currency:'EUR'}}],financials:{supplierCost:calc.supplierCost,itemSale:calc.itemPrice,shippingCharged:calc.customerShipping,supplierShipping:calc.supplierShipping,ebayProductFee:calc.ebayProductFee,ebayProductFeeVat:calc.ebayProductFeeVat,ebayFixedFee:calc.ebayFixedFee,ebayShippingFee:calc.ebayShippingFee,ebayShippingFeeVat:calc.ebayShippingFeeVat,totalEbayCharges:calc.totalEbayCharges,totalRevenue:calc.totalRevenue,totalCosts:calc.totalCosts,netProfit:calc.netProfit,netMargin:calc.netMargin,minimumMarginTarget:calc.minimumMarginTarget,marginPass:calc.marginPass},demo:true,testOnly:true,supplierAction:'PREPARE_ONLY',supplierPurchaseLocked:true};
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
    const demo=orders.length===0;if(demo)orders=Array.from({length:20},(_,i)=>demoOrder(i));
    res.status(200).json({ok:true,total:orders.length,orders,demo,placeOrderLocked:true,trackingReadReady:true,trackingWriteLocked:String(process.env.ENABLE_TRACKING_WRITE||'').toLowerCase()!=='true',note:demo?'20 TEST ORDERS ONLY. Germany shipping is €4.99 customer-facing and €8.40 supplier cost. No real supplier purchase or eBay fulfilment can be triggered.':'Live eBay orders are matched to MobileParts SKU/stock/cost and prepared for review. MobileParts tracking retrieval is ready; supplier purchasing and eBay tracking writes remain locked until durable idempotency storage is configured.'});
  }catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};