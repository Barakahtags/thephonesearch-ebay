const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');
const mps=require('./_lib/mps');

function enabled(name){return String(process.env[name]||'').toLowerCase()==='true';}
function paid(o){return o?.orderPaymentStatus==='PAID'||(o?.paymentSummary?.payments||[]).some(p=>p.paymentStatus==='PAID');}
function deliveryAddress(shipTo){
  const a=shipTo?.contactAddress||{};
  return {
    Name: shipTo?.fullName||'',
    AddressLine1:a.addressLine1||'',
    AddressLine2:a.addressLine2||'',
    PostalCode:a.postalCode||'',
    City:a.city||'',
    State:a.stateOrProvince||'',
    CountryCode:a.countryCode||'DE'
  };
}
function trackingRows(x){
  const out=[]; const seen=new Set();
  function walk(v){
    if(!v)return;
    if(Array.isArray(v)){v.forEach(walk);return;}
    if(typeof v!=='object')return;
    const tracking=v.TrackingNumber||v.TrackAndTrace||v.TrackingCode||v.trackingNumber||v.trackAndTrace;
    const carrier=v.Carrier||v.CarrierCode||v.ShippingCompany||v.carrier||v.shippingCarrierCode;
    if(tracking&&!seen.has(String(tracking))){seen.add(String(tracking));out.push({trackingNumber:String(tracking),shippingCarrierCode:String(carrier||'OTHER')});}
    Object.values(v).forEach(walk);
  }
  walk(x); return out;
}
async function alreadyFulfilled(orderId,trackingNumber){
  try{const x=await ebay.api(`/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`);return (x.fulfillments||[]).some(f=>String(f.shipmentTrackingNumber||f.trackingNumber||'')===String(trackingNumber));}catch(e){if(e.status===404)return false;throw e;}
}
module.exports=async function(req,res){
  if(!guard(req,res))return;
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'POST required'});
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const orderId=String(body.orderId||'').trim();
    if(!orderId)return res.status(400).json({ok:false,error:'orderId required'});
    const order=await ebay.api(`/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`);
    if(!paid(order))return res.status(409).json({ok:false,error:'Order is not paid; supplier purchase blocked.'});
    if(order.orderFulfillmentStatus==='FULFILLED')return res.status(200).json({ok:true,orderId,status:'ALREADY_FULFILLED'});
    const shipTo=order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
    const items=[];
    for(const li of order.lineItems||[]){
      if(!li.sku)throw new Error(`Line item ${li.lineItemId} has no SKU`);
      const p=await mps.part(li.sku),qty=Math.max(1,Number(li.quantity||1));
      if(!p||p.CanBeOrdered===false||Number(p.AvailableStockQuantity||0)<qty)throw new Error(`Supplier stock unavailable for ${li.sku}`);
      items.push({PartNumber:p.PartNumber||li.sku,Quantity:qty});
    }
    if(!items.length)throw new Error('Order has no supplier items');
    const purchaseEnabled=enabled('MPS_AUTO_PURCHASE');
    const trackingEnabled=enabled('EBAY_AUTO_TRACKING');
    let supplierOrderNumber=String(body.supplierOrderNumber||'').trim(),supplierResult=null;
    if(!supplierOrderNumber){
      if(!purchaseEnabled)return res.status(200).json({ok:true,orderId,status:'READY_TO_PURCHASE',purchaseEnabled:false,trackingEnabled,items,deliveryAddress:deliveryAddress(shipTo),note:'Validated only. Set MPS_AUTO_PURCHASE=true to permit supplier ordering.'});
      supplierResult=await mps.placeOrder(items,deliveryAddress(shipTo),true);
      supplierOrderNumber=String(supplierResult?.OrderNumber||supplierResult?.orderNumber||supplierResult?.Number||'').trim();
      if(!supplierOrderNumber)throw new Error('MobileParts order was accepted but no order number was returned; automatic retry is blocked to avoid duplicate purchase.');
    }
    const tracking=await mps.orderTracking(supplierOrderNumber);
    const rows=trackingRows(tracking);
    if(!rows.length)return res.status(200).json({ok:true,orderId,status:'WAITING_FOR_TRACKING',supplierOrderNumber,supplierResult,trackingEnabled});
    if(!trackingEnabled)return res.status(200).json({ok:true,orderId,status:'TRACKING_READY',supplierOrderNumber,tracking:rows,trackingEnabled:false,note:'Tracking found but eBay write is locked. Set EBAY_AUTO_TRACKING=true when ready.'});
    const lineItems=(order.lineItems||[]).map(li=>({lineItemId:li.lineItemId,quantity:Number(li.quantity||1)}));
    const written=[];
    for(const t of rows){
      if(await alreadyFulfilled(orderId,t.trackingNumber)){written.push({...t,duplicate:true});continue;}
      const payload={lineItems,shippingCarrierCode:t.shippingCarrierCode,trackingNumber:t.trackingNumber};
      await ebay.api(`/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`,{method:'POST',body:JSON.stringify(payload)});
      written.push({...t,duplicate:false});
    }
    return res.status(200).json({ok:true,orderId,status:'TRACKING_SENT_TO_EBAY',supplierOrderNumber,tracking:written});
  }catch(e){return res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};
