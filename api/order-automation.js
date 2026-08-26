const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');
const mps=require('./_lib/mps');
const {assertCapability,snapshot}=require('./_lib/live-control');

function enabled(name){return String(process.env[name]||'').toLowerCase()==='true';}
function paid(o){return o?.orderPaymentStatus==='PAID'||(o?.paymentSummary?.payments||[]).some(p=>p.paymentStatus==='PAID');}
function deliveryAddress(shipTo){
  const a=shipTo?.contactAddress||{};
  return {Name:shipTo?.fullName||'',AddressLine1:a.addressLine1||'',AddressLine2:a.addressLine2||'',PostalCode:a.postalCode||'',City:a.city||'',State:a.stateOrProvince||'',CountryCode:a.countryCode||'DE'};
}
function trackingRows(x){
  const out=[],seen=new Set();
  function walk(v){
    if(!v)return;if(Array.isArray(v)){v.forEach(walk);return;}if(typeof v!=='object')return;
    const tracking=v.TrackingNumber||v.TrackAndTrace||v.TrackingCode||v.trackingNumber||v.trackAndTrace;
    const carrier=v.Carrier||v.CarrierCode||v.ShippingCompany||v.carrier||v.shippingCarrierCode;
    if(tracking&&!seen.has(String(tracking))){seen.add(String(tracking));out.push({trackingNumber:String(tracking),shippingCarrierCode:String(carrier||'OTHER')});}
    Object.values(v).forEach(walk);
  }
  walk(x);return out;
}
async function alreadyFulfilled(orderId,trackingNumber){
  try{const x=await ebay.api(`/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`);return (x.fulfillments||[]).some(f=>String(f.shipmentTrackingNumber||f.trackingNumber||'')===String(trackingNumber));}catch(e){if(e.status===404)return false;throw e;}
}
async function validatedOrder(orderId){
  const order=await ebay.api(`/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`);
  if(!paid(order))throw Object.assign(new Error('Order is not paid; supplier preparation blocked.'),{status:409});
  const shipTo=order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
  const items=[];
  for(const li of order.lineItems||[]){
    if(!li.sku)throw new Error(`Line item ${li.lineItemId} has no SKU`);
    const p=await mps.part(li.sku),qty=Math.max(1,Number(li.quantity||1));
    if(!p||p.CanBeOrdered===false||Number(p.AvailableStockQuantity||0)<qty)throw Object.assign(new Error(`Supplier stock unavailable for ${li.sku}`),{status:409});
    items.push({PartNumber:p.PartNumber||li.sku,Quantity:qty,Description:p.Description||p.Name||li.title||'',SupplierStock:Number(p.AvailableStockQuantity||0)});
  }
  if(!items.length)throw new Error('Order has no supplier items');
  return {order,items,deliveryAddress:deliveryAddress(shipTo)};
}
module.exports=async function(req,res){
  if(!guard(req,res))return;
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'POST required'});
  try{
    assertCapability('supplierOrderPreparation');
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{}),orderId=String(body.orderId||'').trim();
    if(!orderId)return res.status(400).json({ok:false,error:'orderId required'});
    const {order,items,deliveryAddress:address}=await validatedOrder(orderId);
    if(order.orderFulfillmentStatus==='FULFILLED')return res.status(200).json({ok:true,orderId,status:'ALREADY_FULFILLED'});
    const supplierOrderNumber=String(body.supplierOrderNumber||'').trim();
    // Financial safety: supplier checkout stays manual until a durable idempotency database exists.
    // This endpoint prepares exact basket/address data; the operator enters the resulting supplier order number after checkout.
    if(!supplierOrderNumber)return res.status(200).json({ok:true,orderId,status:'READY_FOR_MOBILEPARTS_BASKET',purchaseMode:'MANUAL_CHECKOUT',items,deliveryAddress:address,note:'Add these exact lines to the MobileParts basket and checkout once. Then submit the returned supplierOrderNumber here. Automatic purchasing is intentionally disabled to prevent duplicate supplier orders.'});
    const tracking=await mps.orderTracking(supplierOrderNumber),rows=trackingRows(tracking),trackingEnabled=snapshot().capabilities.trackingWrites.enabled;
    if(!rows.length)return res.status(200).json({ok:true,orderId,status:'WAITING_FOR_TRACKING',supplierOrderNumber,trackingEnabled});
    if(!trackingEnabled)return res.status(200).json({ok:true,orderId,status:'TRACKING_READY',supplierOrderNumber,tracking:rows,trackingEnabled:false,note:'Tracking found. eBay write remains locked until EBAY_AUTO_TRACKING=true.'});
    assertCapability('trackingWrites');
    const lineItems=(order.lineItems||[]).map(li=>({lineItemId:li.lineItemId,quantity:Number(li.quantity||1)})),written=[];
    for(const t of rows){
      if(await alreadyFulfilled(orderId,t.trackingNumber)){written.push({...t,duplicate:true});continue;}
      await ebay.api(`/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`,{method:'POST',body:JSON.stringify({lineItems,shippingCarrierCode:t.shippingCarrierCode,trackingNumber:t.trackingNumber})});
      written.push({...t,duplicate:false});
    }
    return res.status(200).json({ok:true,orderId,status:'TRACKING_SENT_TO_EBAY',supplierOrderNumber,tracking:written});
  }catch(e){return res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};
