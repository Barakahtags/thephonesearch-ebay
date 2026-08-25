const ebay=require('./_lib/ebay');

module.exports=async function(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'GET required'});
  try{
    const marketplace=process.env.EBAY_MARKETPLACE_ID||'EBAY_DE';
    const data=await ebay.api(`/sell/metadata/v1/shipping/marketplace/${encodeURIComponent(marketplace)}/get_shipping_services`);
    const services=Array.isArray(data?.shippingServices)?data.shippingServices:[];
    const ups=services.filter(x=>JSON.stringify(x).toLowerCase().includes('ups'));
    res.status(200).json({ok:true,marketplace,total:services.length,ups});
  }catch(e){
    res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});
  }
};
