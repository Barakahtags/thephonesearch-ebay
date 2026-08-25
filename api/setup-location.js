const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');

module.exports=async function(req,res){
  if(!guard(req,res)) return;
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'POST required'});
  const key='duesseldorf-neusalzerweg-2b';
  try{
    try{
      const existing=await ebay.api(`/sell/inventory/v1/location/${encodeURIComponent(key)}`);
      if(existing?.merchantLocationKey || existing?.name) return res.status(200).json({ok:true,created:false,key,location:existing});
    }catch(e){if(e.status!==404) throw e;}

    const body={
      location:{
        address:{
          addressLine1:'Neusalzer Weg 2B',
          city:'Düsseldorf',
          postalCode:'40627',
          country:'DE'
        }
      },
      locationTypes:['WAREHOUSE'],
      name:'ThePhoneSearch Düsseldorf',
      merchantLocationStatus:'ENABLED'
    };
    await ebay.api(`/sell/inventory/v1/location/${encodeURIComponent(key)}`,{method:'POST',body:JSON.stringify(body)});
    const location=await ebay.api(`/sell/inventory/v1/location/${encodeURIComponent(key)}`);
    return res.status(200).json({ok:true,created:true,key,location});
  }catch(e){
    return res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});
  }
};
