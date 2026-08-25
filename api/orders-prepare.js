const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');
const mps=require('./_lib/mps');

module.exports=async function(req,res){
  if(!guard(req,res)) return;
  try{
    const data=await ebay.api('/sell/fulfillment/v1/order?limit=50');
    const orders=data.orders||[];
    const prepared=[];
    for(const order of orders){
      const lines=[];
      for(const li of (order.lineItems||[])){
        const sku=String(li.sku||li.legacyItemId||'').trim();
        let match=null;
        if(sku){
          try{
            const found=await mps.searchParts(sku,1,1,10);
            match=(found.Parts||[]).find(p=>String(p.PartNumber)===sku)||found.Parts?.[0]||null;
          }catch(e){}
        }
        lines.push({
          ebayLineItemId:li.lineItemId,
          sku,
          title:li.title,
          quantity:Number(li.quantity||1),
          mobileParts:match?{id:match.Id,partNumber:match.PartNumber,description:match.Description,stock:match.AvailableStockQuantity,costExVat:match.UnitPrice,canBeOrdered:match.CanBeOrdered}:null,
          ready:!!match && !!match.CanBeOrdered && Number(match.AvailableStockQuantity||0)>=Number(li.quantity||1)
        });
      }
      const ship=order.fulfillmentStartInstructions?.find(x=>x.shippingStep)?.shippingStep?.shipTo||{};
      prepared.push({
        ebayOrderId:order.orderId,
        paymentStatus:order.orderPaymentStatus,
        fulfillmentStatus:order.orderFulfillmentStatus,
        buyer:order.buyer?.username,
        shipTo:{name:ship.fullName||ship.contactAddress?.fullName,addressLine1:ship.contactAddress?.addressLine1,addressLine2:ship.contactAddress?.addressLine2,city:ship.contactAddress?.city,state:ship.contactAddress?.stateOrProvince,postalCode:ship.contactAddress?.postalCode,country:ship.contactAddress?.countryCode,phone:ship.primaryPhone?.phoneNumber},
        lines,
        ready:lines.length>0 && lines.every(x=>x.ready),
        action:'PREPARE_ONLY'
      });
    }
    res.status(200).json({ok:true,total:prepared.length,ready:prepared.filter(x=>x.ready).length,orders:prepared,placeOrderLocked:true,note:'Safe preparation only. This endpoint does not submit or pay for any MobileParts order.'});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
};