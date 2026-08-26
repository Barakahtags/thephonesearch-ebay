const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');

function demoOrder(){
  const itemSale=99.99;
  const shippingCharged=8.40;
  const supplierCost=50.00;
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
  return {
    orderId:'TEST-EBAY-100001',
    creationDate:new Date().toISOString(),
    orderFulfillmentStatus:'NOT_STARTED',
    orderPaymentStatus:'PAID',
    paymentSummary:{payments:[{paymentStatus:'PAID'}]},
    buyer:{username:'test-buyer'},
    shipTo:{fullName:'Test Customer',contactAddress:{addressLine1:'Neusalzerweg 2b',city:'Düsseldorf',stateOrProvince:'NRW',postalCode:'40627',countryCode:'DE'}},
    pricingSummary:{total:{value:money(totalRevenue).toFixed(2),currency:'EUR'}},
    lineItems:[{lineItemId:'TEST-LINE-1',sku:'TEST-MPS-SKU',title:'TEST — iPhone 17 Pro Max Display Replacement Part',quantity:1,total:{value:itemSale.toFixed(2),currency:'EUR'}}],
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
    if(demo) orders=[demoOrder()];
    res.status(200).json({ok:true,total:orders.length,orders,demo,placeOrderLocked:true,note:demo?'TEST ORDER ONLY. No real eBay or MobileParts purchase exists.':'Live eBay orders shown in preview mode. Automatic supplier purchasing remains locked.'});
  }catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};