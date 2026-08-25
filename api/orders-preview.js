const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');
module.exports=async function(req,res){
  if(!guard(req,res)) return;
  try{
    const filter=encodeURIComponent('orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}');
    const data=await ebay.api(`/sell/fulfillment/v1/order?filter=${filter}&limit=50`);
    const orders=(data.orders||[]).map(o=>({orderId:o.orderId,creationDate:o.creationDate,orderFulfillmentStatus:o.orderFulfillmentStatus,paymentSummary:o.paymentSummary,buyer:o.buyer,shipTo:o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo,lineItems:(o.lineItems||[]).map(li=>({lineItemId:li.lineItemId,sku:li.sku,title:li.title,quantity:li.quantity,total:li.total}))}));
    res.status(200).json({ok:true,total:data.total||orders.length,orders,note:'Preview only. Automatic supplier ordering is intentionally locked until durable idempotency storage is configured, preventing duplicate dropship orders.'});
  }catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};
