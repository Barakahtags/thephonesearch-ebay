const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');

function demoOrder(){
  return {
    orderId:'TEST-EBAY-100001',
    creationDate:new Date().toISOString(),
    orderFulfillmentStatus:'NOT_STARTED',
    orderPaymentStatus:'PAID',
    paymentSummary:{payments:[{paymentStatus:'PAID'}]},
    buyer:{username:'test-buyer'},
    shipTo:{fullName:'Test Customer',contactAddress:{addressLine1:'Neusalzerweg 2b',city:'Düsseldorf',stateOrProvince:'NRW',postalCode:'40627',countryCode:'DE'}},
    pricingSummary:{total:{value:'89.99',currency:'EUR'}},
    lineItems:[{lineItemId:'TEST-LINE-1',sku:'TEST-MPS-SKU',title:'TEST — iPhone 17 Pro Max Display Replacement Part',quantity:1,total:{value:'89.99',currency:'EUR'}}],
    demo:true,
    supplierAction:'PREPARE_ONLY'
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
    res.status(200).json({ok:true,total:orders.length,orders,demo,placeOrderLocked:true,note:demo?'No live eBay orders were returned, so the dashboard is showing one clearly marked fake test order. Nothing can be purchased.':'Live eBay orders shown in preview mode. Automatic supplier purchasing remains locked.'});
  }catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};
