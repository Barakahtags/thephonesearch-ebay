const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');

module.exports=async function(req,res){
  if(!guard(req,res)) return;
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'POST required'});
  try{
    const marketplace=process.env.EBAY_MARKETPLACE_ID||'EBAY_DE';
    const deCharge=Number(process.env.EBAY_CUSTOMER_SHIPPING_DE||4.99).toFixed(2);
    const euChargeRaw=Number(process.env.EBAY_CUSTOMER_SHIPPING_EU);
    const euConfigured=Number.isFinite(euChargeRaw)&&euChargeRaw>0;
    const euCharge=euConfigured?euChargeRaw.toFixed(2):null;
    const name='ThePhoneSearch Combined Shipping DE-EU';

    try {
      const existing=await ebay.api(`/sell/account/v1/fulfillment_policy/get_by_policy_name?marketplace_id=${encodeURIComponent(marketplace)}&name=${encodeURIComponent(name)}`);
      if(existing?.fulfillmentPolicyId) return res.status(200).json({ok:true,created:false,fulfillmentPolicyId:existing.fulfillmentPolicyId,name,deCharge,euCharge,euConfigured,note:euConfigured?'DE + EU configured':'DE configured; EU awaits actual MobileParts EU shipping cost'});
    } catch(e) { if(e.status!==404) throw e; }

    const shippingOptions=[{
      optionType:'DOMESTIC',costType:'FLAT_RATE',shippingServices:[{
        sortOrder:1,shippingCarrierCode:'UPS_DE',shippingServiceCode:'DE_UPSStandard',
        shippingCost:{value:deCharge,currency:'EUR'},
        // Combined shipping: first item pays 4.99, every additional item in the same shipment adds 0.00.
        additionalShippingCost:{value:'0.00',currency:'EUR'},freeShipping:false
      }]
    }];

    // Never invent the EU amount. International service is added only after the actual customer-facing EU charge is configured.
    if(euConfigured){
      shippingOptions.push({optionType:'INTERNATIONAL',costType:'FLAT_RATE',shippingServices:[{
        sortOrder:1,shippingServiceCode:'InternationalStandardShipping',
        shippingCost:{value:euCharge,currency:'EUR'},additionalShippingCost:{value:'0.00',currency:'EUR'},
        shipToLocations:{regionIncluded:[{regionName:'Europe'}]},freeShipping:false
      }]});
    }

    const body={name,description:'ThePhoneSearch dropship policy: combined shipping; additional items in same customer shipment are free of extra delivery charge.',marketplaceId:marketplace,categoryTypes:[{name:'ALL_EXCLUDING_MOTORS_VEHICLES'}],handlingTime:{value:1,unit:'DAY'},shippingOptions};
    const created=await ebay.api('/sell/account/v1/fulfillment_policy',{method:'POST',body:JSON.stringify(body)});
    res.status(200).json({ok:true,created:true,name,deCharge,euCharge,euConfigured,...created});
  }catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};
