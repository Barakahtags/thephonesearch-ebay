const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');

module.exports=async function(req,res){
  if(!guard(req,res)) return;
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'POST required'});
  try{
    const marketplace=process.env.EBAY_MARKETPLACE_ID||'EBAY_DE';
    const deCharge=Number(process.env.EBAY_CUSTOMER_SHIPPING_DE||4.99).toFixed(2);
    const euChargeRaw=Number(process.env.EBAY_CUSTOMER_SHIPPING_EU);
    const euSupplierRaw=Number(process.env.MPS_SHIPPING_EU);
    const euConfigured=Number.isFinite(euChargeRaw)&&euChargeRaw>0&&Number.isFinite(euSupplierRaw)&&euSupplierRaw>0;
    const euCharge=euConfigured?euChargeRaw.toFixed(2):null;
    const name='ThePhoneSearch Combined Shipping DE-EU';
    const shippingOptions=[{optionType:'DOMESTIC',costType:'FLAT_RATE',shippingServices:[{sortOrder:1,shippingCarrierCode:'UPS_DE',shippingServiceCode:'DE_UPSStandard',shippingCost:{value:deCharge,currency:'EUR'},additionalShippingCost:{value:'0.00',currency:'EUR'},freeShipping:false}]}];
    if(euConfigured) shippingOptions.push({optionType:'INTERNATIONAL',costType:'FLAT_RATE',shippingServices:[{sortOrder:1,shippingServiceCode:'InternationalStandardShipping',shippingCost:{value:euCharge,currency:'EUR'},additionalShippingCost:{value:'0.00',currency:'EUR'},shipToLocations:{regionIncluded:[{regionName:'Europe'}]},freeShipping:false}]});
    const body={name,description:'ThePhoneSearch dropship policy: one delivery charge per combined customer shipment; additional eligible items add 0.00 shipping.',marketplaceId:marketplace,categoryTypes:[{name:'ALL_EXCLUDING_MOTORS_VEHICLES'}],handlingTime:{value:1,unit:'DAY'},shippingOptions};
    let existing=null;
    try{existing=await ebay.api(`/sell/account/v1/fulfillment_policy/get_by_policy_name?marketplace_id=${encodeURIComponent(marketplace)}&name=${encodeURIComponent(name)}`);}catch(e){if(e.status!==404)throw e;}
    if(existing?.fulfillmentPolicyId){
      await ebay.api(`/sell/account/v1/fulfillment_policy/${encodeURIComponent(existing.fulfillmentPolicyId)}`,{method:'PUT',body:JSON.stringify(body)});
      return res.status(200).json({ok:true,created:false,updated:true,fulfillmentPolicyId:existing.fulfillmentPolicyId,name,deCharge,euCharge,euConfigured,note:euConfigured?'DE + EU combined shipping configured':'DE €4.99 combined shipping configured; EU remains disabled until real MobileParts EU supplier and customer rates are set'});
    }
    const created=await ebay.api('/sell/account/v1/fulfillment_policy',{method:'POST',body:JSON.stringify(body)});
    res.status(200).json({ok:true,created:true,updated:false,name,deCharge,euCharge,euConfigured,...created});
  }catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};