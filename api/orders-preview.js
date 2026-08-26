const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');
const pricing=require('./_lib/pricing');

function demoOrder(index){
  const products=['iPhone 17 Pro Max Display Replacement Part','iPhone 16 Pro Battery','Samsung Galaxy S25 Ultra Display','Google Pixel 10 Pro XL Display','iPhone 15 Pro Max Charging Port'];
  const supplierCost=50+(index%4)*3;
  const calc=pricing.recommendedPrice(supplierCost,99.99+(index%5)*10);
  const n=String(index+1).padStart(2,'0');
  return {orderId:`TEST-EBAY-1000${n}`,creationDate:new Date(Date.now()-index*15*60*1000).toISOString(),orderFulfillmentStatus:'NOT_STARTED',orderPaymentStatus:'PAID',paymentSummary:{payments:[{paymentStatus:'PAID'}]},buyer:{username:`test-buyer-${n}`},shipTo:{fullName:`Test Customer ${n}`,contactAddress:{addressLine1:'Neusalzerweg 2b',city:'Düsseldorf',stateOrProvince:'NRW',postalCode:'40627',countryCode:'DE'}},pricingSummary:{total:{value:calc.totalRevenue.toFixed(2),currency:'EUR'}},lineItems:[{lineItemId:`TEST-LINE-${n}`,sku:`TEST-MPS-SKU-${n}`,title:`TEST — ${products[index%products.length]}`,quantity:1,total:{value:calc.itemPrice.toFixed(2),currency:'EUR'}}],financials:{supplierCost:calc.supplierCost,itemSale:calc.itemPrice,shippingCharged:calc.customerShipping,supplierShipping:calc.supplierShipping,ebayProductFee:calc.ebayProductFee,ebayProductFeeVat:calc.ebayProductFeeVat,ebayFixedFee:calc.ebayFixedFee,ebayShippingFee:calc.ebayShippingFee,ebayShippingFeeVat:calc.ebayShippingFeeVat,totalEbayCharges:calc.totalEbayCharges,totalRevenue:calc.totalRevenue,totalCosts:calc.totalCosts,netProfit:calc.netProfit,netMargin:calc.netMargin,minimumMarginTarget:calc.minimumMarginTarget,marginPass:calc.marginPass},demo:true,testOnly:true,supplierAction:'PREPARE_ONLY',supplierPurchaseLocked:true};
}

module.exports=async function(req,res){
  if(!guard(req,res)) return;
  try{
    const filter=encodeURIComponent('orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}');
    const data=await ebay.api(`/sell/fulfillment/v1/order?filter=${filter}&limit=50`);
    let orders=(data.orders||[]).map(o=>({orderId:o.orderId,creationDate:o.creationDate,orderFulfillmentStatus:o.orderFulfillmentStatus,orderPaymentStatus:o.orderPaymentStatus,paymentSummary:o.paymentSummary,pricingSummary:o.pricingSummary,buyer:o.buyer,shipTo:o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo,lineItems:(o.lineItems||[]).map(li=>({lineItemId:li.lineItemId,sku:li.sku,title:li.title,quantity:li.quantity,total:li.total}))}));
    const demo=orders.length===0;
    if(demo) orders=Array.from({length:20},(_,i)=>demoOrder(i));
    res.status(200).json({ok:true,total:orders.length,orders,demo,placeOrderLocked:true,trackingWriteLocked:true,note:demo?'20 TEST ORDERS ONLY. Germany shipping is €4.99 customer-facing and €8.40 supplier cost. No real supplier purchase or eBay fulfilment can be triggered.':'Live eBay orders shown. Supplier purchasing and tracking writes remain locked until durable idempotency storage is configured.'});
  }catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};