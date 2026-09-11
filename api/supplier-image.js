const mps=require('./_lib/mps');
const {imageUrls}=require('./_lib/catalog-quality');

function safeSku(value){
  const sku=String(value||'').trim();
  return /^[A-Za-z0-9._-]{1,80}$/.test(sku)?sku:null;
}

module.exports=async function(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const sku=safeSku(req.query?.sku);
  const index=Math.max(0,Math.min(11,Number(req.query?.index||0)));
  if(!sku)return res.status(400).json({ok:false,error:'Valid product SKU required'});
  try{
    const part=await mps.part(sku);
    const source=imageUrls(part)[index];
    if(!source)return res.status(404).json({ok:false,error:'Supplier image not found'});
    const upstream=await fetch(source,{headers:{Accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'}});
    if(!upstream.ok)return res.status(502).json({ok:false,error:'Supplier image unavailable',status:upstream.status});
    const body=Buffer.from(await upstream.arrayBuffer());
    const type=String(upstream.headers.get('content-type')||'image/jpeg').split(';')[0];
    if(!/^image\/(?:jpeg|png|gif|webp|avif)$/i.test(type))return res.status(502).json({ok:false,error:'Supplier returned an invalid image'});
    res.setHeader('Content-Type',type);
    res.setHeader('Cache-Control','public, max-age=86400, s-maxage=86400');
    res.setHeader('Content-Length',String(body.length));
    return res.status(200).send(body);
  }catch(error){
    return res.status(502).json({ok:false,error:'Supplier image retrieval failed'});
  }
};
