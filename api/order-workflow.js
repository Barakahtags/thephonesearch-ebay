const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');
const mps=require('./_lib/mps');

function paid(o){return o?.orderPaymentStatus==='PAID'||(o?.paymentSummary?.payments||[]).some(p=>p.paymentStatus==='PAID');}
function address(o){const s=o?.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo||{},a=s.contactAddress||{};return {name:s.fullName||'',addressLine1:a.addressLine1||'',addressLine2:a.addressLine2||'',postalCode:a.postalCode||'',city:a.city||'',state:a.stateOrProvince||'',countryCode:a.countryCode||'DE'};}
module.exports=async function(req,res){
 if(!guard(req,res))return;
 try{
  const orderId=String(req.query?.orderId||'').trim();
  if(!orderId)return res.status(400).json({ok:false,error:'orderId required'});
  const o=await ebay.api(`/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`);
  const rows=[];
  for(const li of o.lineItems||[]){
   let supplier=null,error=null;
   try{supplier=await mps.part(li.sku);}catch(e){error=e.message;}
   const qty=Math.max(1,Number(li.quantity||1));
   rows.push({lineItemId:li.lineItemId,sku:li.sku,title:li.title,quantity:qty,supplierFound:!!supplier,supplierStock:supplier?Number(supplier.AvailableStockQuantity||0):null,orderable:supplier?supplier.CanBeOrdered!==false:false,ready:!!supplier&&supplier.CanBeOrdered!==false&&Number(supplier.AvailableStockQuantity||0)>=qty,error});
  }
  const allReady=rows.length>0&&rows.every(x=>x.ready);
  res.status(200).json({ok:true,orderId,paymentStatus:o.orderPaymentStatus,paid:paid(o),fulfillmentStatus:o.orderFulfillmentStatus,shipTo:address(o),items:rows,readyForSupplierCheckout:paid(o)&&allReady,automation:{supplierPurchase:false,trackingWrite:String(process.env.EBAY_AUTO_TRACKING||'false').toLowerCase()==='true'},nextAction:!paid(o)?'WAIT_FOR_PAYMENT':!allReady?'SUPPLIER_REVIEW':'READY_FOR_MOBILEPARTS_CHECKOUT'});
 }catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};