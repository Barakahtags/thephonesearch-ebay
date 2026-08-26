const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');

function demoOrder(index){
  const products=[
    'iPhone 17 Pro Max Display Replacement Part',
    'iPhone 16 Pro Battery',
    'Samsung Galaxy S25 Ultra Display',
    'Google Pixel 10 Pro XL Display',
    'iPhone 15 Pro Max Charging Port'
  ];
  const itemSale=99.99+(index%5)*10;
  const shippingCharged=8.40;
  const supplierCost=50.00+(index%4)*3;
  const supplierShipping=8.40;
  const ebayProductFeeRate=0.11;
  const ebayShippingFeeRate=0.10;
  const feeVatRate=0.19;
  const fixedFee=0.35;
  const ebayProductFee=itemSale*ebayProductFeeRate;
  const ebayProductFeeVat=ebayProductFee*feeVatRate;
  const ebayShippingFee=shippingCharged*ebayShippingFeeRate;
  const ebayShippingFeeVat=ebayShippingFee*feeVatRate;
  const totalEbayCharges=ebayProductFee+ebayProductFeeVat+fixedFee+ebayShippingFee+ebayShippingFeeVat;
  const totalRevenue=itemSale+shippingCharged;
  const totalCosts=supplierCost+supplierShipping+totalEbayCharges;
  const netProfit=totalRevenue-totalCosts;
  const netMargin=(netProfit/totalRevenue)*100;
  const money=n=>Number(n.toFixed(2));
  const n=String(index+1).padStart(2,'0');
  return {
    orderId:`TEST-EBAY-1000${n}`,
    creationDate:new Date(Date.now()-index*15*60*1000).toISOString(),
    orderFulfillmentStatus:'NOT_STARTED',
    orderPaymentStatus:'PAID',
    paymentSummary:{payments:[{paymentStatus:'PAID'}]},
    buyer:{username:`test-buyer-${n}`},
    shipTo:{fullName:`Test Customer ${n}`,contactAddress:{addressLine1:'Neusalzerweg 2b',city:'Düsseldorf',stateOrProvince:'NRW',postalCode:'40627',countryCode:'DE'}},
    pricingSummary:{total:{value:money(totalRevenue).toFixed(2),currency:'EUR'}},
    lineItems:[{lineItemId:`TEST-LINE-${n}`,sku:`TEST-MPS-SKU-${n}`,title:`TEST — ${products[index%products.length]}`,quantity:1,total:{value:itemSale.toFixed(2),currency:'EUR'}}],
    financials:{
      supplierCost:money(supplierCost),itemSale:money(itemSale),shippingCharged:money(shippingCharged),supplierShipping:money(supplierShipping),
      ebayProductFee:money(ebayProductFee),ebayProductFeeVat:money(ebayProductFeeVat),ebayFixedFee:money(fixedFee),
      ebayShippingFee:money(ebayShippingFee),ebayShippingFeeVat:money(ebayShippingFeeVat),totalEbayCharges:money(totalEbayCharges),
      totalRevenue:money(totalRevenue),totalCosts:money(totalCosts),netProfit:money(netProfit),netMargin:Number(netMargin.toFixed(2)),
      minimumMarginTarget:30,marginPass:netMargin>=30
    },
    demo:true,supplierAction:'PREPARE_ONLY'
  };
}

module.exports=async function(req,res){
  if(!guard(req,res)) return;
  try{
    const filter=encodeURIComponent('orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}');
    const data=await ebay.api(`/sell/fulfillment/v1/order?filter=${filter}&limit=50`);
    let orders=(data.orders||[]).map(o=>({orderId:o.orderId,creationDate:o.creationDate,orderFulfillmentStatus:o.orderFulfillmentStatus,orderPaymentStatus:o.orderPaymentStatus,paymentSummary:o.paymentSummary,pricingSummary:o.pricingSummary,buyer:o.buyer,shipTo:o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo,lineItems:(o.lineItems||[]).map(li=>({lineItemId:li.lineItemId,sku:li.sku,title:li.title,quantity:li.quantity,total:li.total}))}));
    const demo=orders.length===0;
    if(demo) orders=Array.from({length:20},(_,i)=>demoOrder(i));
    res.status(200).json({ok:true,total:orders.length,orders,demo,placeOrderLocked:true,note:demo?'20 TEST ORDERS ONLY. No real eBay or MobileParts purchases exist.':'Live eBay orders shown in preview mode. Automatic supplier purchasing remains locked.'});
  }catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};