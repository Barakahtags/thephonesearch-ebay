const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');
const mps=require('./_lib/mps');
const pricing=require('./_lib/pricing');
const {snapshot}=require('./_lib/live-control');

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
      return res.status(200).json({ok:true,readOnly:true,mpsOrderNumber:req.query.mpsOrderNumber,tracking,ebayTrackingWriteLocked:!snapshot().capabilities.trackingWrites.enabled});
    }
    const filter=encodeURIComponent('orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}'),data=await ebay.api(`/sell/fulfillment/v1/order?filter=${filter}&limit=50`);
    let orders=[];for(const o of (data.orders||[]))orders.push(await enrichOrder(o));
    res.status(200).json({ok:true,total:orders.length,orders,demo:false,placeOrderLocked:true,trackingReadReady:true,trackingWriteLocked:!snapshot().capabilities.trackingWrites.enabled,note:orders.length?'Live eBay orders are matched to MobileParts SKU/stock/cost and prepared for review. MobileParts tracking retrieval is ready; supplier purchasing remains locked until durable idempotency storage is configured.':'No open live eBay orders were found.'});
  }catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};
