const ebay=require('./_lib/ebay');

module.exports=async function(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'GET required'});
  try{
    const t=await ebay.token();
    const r=await fetch('https://apiz.ebay.com/commerce/identity/v1/user/',{
      headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}
    });
    const text=await r.text();
    let data=null;
    try{data=text?JSON.parse(text):null;}catch{data=text;}
    if(!r.ok) return res.status(r.status).json({ok:false,status:r.status,details:data});
    res.status(200).json({
      ok:true,
      username:data?.username||null,
      userId:data?.userId||null,
      accountType:data?.accountType||null,
      registrationMarketplaceId:data?.registrationMarketplaceId||null,
      status:data?.status||null
    });
  }catch(e){res.status(500).json({ok:false,error:e.message});}
};
