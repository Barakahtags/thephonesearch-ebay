const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');

module.exports=async function(req,res){
  if(!guard(req,res)) return;
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'POST required'});
  try{
    const marketplace=process.env.EBAY_MARKETPLACE_ID||'EBAY_DE';
    const name='MobileParts UPS Test 8.40';
    try {
      const existing=await ebay.api(`/sell/account/v1/fulfillment_policy/get_by_policy_name?marketplace_id=${encodeURIComponent(marketplace)}&name=${encodeURIComponent(name)}`);
      if(existing?.fulfillmentPolicyId) return res.status(200).json({ok:true,created:false,fulfillmentPolicyId:existing.fulfillmentPolicyId,name});
    } catch(e) { if(e.status!==404) throw e; }
    const body={
      name,
      description:'MobileParts test shipping policy - UPS Standard, EUR 8.40 flat rate',
      marketplaceId:marketplace,
      categoryTypes:[{name:'ALL_EXCLUDING_MOTORS_VEHICLES'}],
      handlingTime:{value:1,unit:'DAY'},
      shippingOptions:[{
        optionType:'DOMESTIC',
        costType:'FLAT_RATE',
        shippingServices:[{
          sortOrder:1,
          shippingCarrierCode:'UPS',
          shippingServiceCode:'UPSStandard',
          shippingCost:{value:'8.40',currency:'EUR'},
          additionalShippingCost:{value:'8.40',currency:'EUR'},
          freeShipping:false
        }]
      }]
    };
    const created=await ebay.api('/sell/account/v1/fulfillment_policy',{method:'POST',body:JSON.stringify(body)});
    res.status(200).json({ok:true,created:true,name,...created});
  }catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};
