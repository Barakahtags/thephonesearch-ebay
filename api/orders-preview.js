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

const financeAmount=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
const financeStart=value=>{const d=value?new Date(`${value}T00:00:00.000Z`):new Date(new Date().getUTCFullYear(),new Date().getUTCMonth(),1);return Number.isNaN(d.valueOf())?null:d.toISOString()};
const financeEnd=value=>{const d=value?new Date(`${value}T23:59:59.999Z`):new Date();return Number.isNaN(d.valueOf())?null:d.toISOString()};
const financeSum=(rows,key)=>financeAmount(rows.reduce((sum,row)=>sum+Number(row.financials?.[key]||0),0));
async function financeReport(req,res){
 const from=financeStart(req.query?.from),to=financeEnd(req.query?.to);
 if(!from||!to||from>to)return res.status(400).json({ok:false,error:'Use a valid report date range.'});
 const filter=encodeURIComponent(`creationdate:[${from}..${to}]`),all=[];
 for(let offset=0;offset<5000;offset+=200){const page=await ebay.api(`/sell/fulfillment/v1/order?filter=${filter}&limit=200&offset=${offset}`),batch=page?.orders||[];all.push(...batch);if(batch.length<200||all.length>=Number(page?.total||Infinity))break}
 const rows=[];
 for(const order of all){
  if(String(order.orderPaymentStatus||'').toUpperCase()!=='PAID'||/CANCELLED|CANCELED/i.test(String(order.orderFulfillmentStatus||'')))continue;
  const enriched=await enrichOrder(order),f=enriched.financials;
  rows.push({orderId:enriched.orderId,creationDate:enriched.creationDate,paymentStatus:enriched.orderPaymentStatus,fulfillmentStatus:enriched.orderFulfillmentStatus,supplierCostStatus:enriched.lineItems.every(i=>i.supplierMatch)?'MOBILEPARTS_CATALOGUE_COST':'MISSING_SUPPLIER_COST',financials:f});
 }
 const salesGross=financeSum(rows,'totalRevenue'),salesVat=financeSum(rows,'salesVat'),salesNet=financeSum(rows,'salesNetRevenue'),products=financeSum(rows,'supplierCost'),shipping=financeSum(rows,'supplierShipping'),ebayNet=financeSum(rows,'ebayFeesNet'),ebayVat=financeSum(rows,'ebayFeeInputVat'),acqVat=financeSum(rows,'euAcquisitionVat');
 return res.status(200).json({ok:true,period:{from,to},basis:'PAID_EBAY_ORDERS',generatedAt:new Date().toISOString(),summary:{orders:rows.length,salesGross,salesNet,salesVat,vatPayableEstimate:financeSum(rows,'vatPayableEstimate'),mobilepartsProducts:products,mobilepartsShipping:shipping,mobilepartsPaymentsEstimated:financeAmount(products+shipping),euAcquisitionVatDeclared:acqVat,euAcquisitionInputVat:acqVat,eBayFeesNet:ebayNet,eBayFeeVatInputEstimate:ebayVat,eBayFeesGross:financeSum(rows,'totalEbayCharges'),tradingProfit:financeSum(rows,'netProfit'),supplierCostCoverage:{matched:rows.filter(r=>r.supplierCostStatus==='MOBILEPARTS_CATALOGUE_COST').length,total:rows.length}},rows,notes:['Sales are live paid eBay orders in the selected period.','MobileParts goods and shipping use the configured MobileParts catalogue price and your €8.40 delivery charge for each separate customer order. Keep the supplier invoice as proof of payment.','The intra-Community acquisition VAT and corresponding input VAT are shown at equal amounts for a normal VAT-registered business; their net cash effect is €0.','VAT payable is sales VAT minus configured deductible/reverse-charge-neutral eBay fee VAT. Your accountant must use actual eBay and supplier invoices for the VAT return.','Income tax is not included: it is based on your overall annual business profit, not a fixed 19% per order.']});
}

module.exports=async function(req,res){
  if(!guard(req,res)) return;
  try{
    if(req.query?.finance==='1')return await financeReport(req,res);
    if(req.query?.mpsOrderNumber){
      const tracking=await mps.orderTracking(req.query.mpsOrderNumber);
      return res.status(200).json({ok:true,readOnly:true,mpsOrderNumber:req.query.mpsOrderNumber,tracking,ebayTrackingWriteLocked:!snapshot().capabilities.trackingWrites.enabled});
    }
    const filter=encodeURIComponent('orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}'),data=await ebay.api(`/sell/fulfillment/v1/order?filter=${filter}&limit=50`);
    let orders=[];for(const o of (data.orders||[]))orders.push(await enrichOrder(o));
    res.status(200).json({ok:true,total:orders.length,orders,demo:false,placeOrderLocked:true,trackingReadReady:true,trackingWriteLocked:!snapshot().capabilities.trackingWrites.enabled,note:orders.length?'Live eBay orders are matched to MobileParts SKU/stock/cost and prepared for review. MobileParts tracking retrieval is ready; supplier purchasing remains locked until durable idempotency storage is configured.':'No open live eBay orders were found.'});
  }catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};
