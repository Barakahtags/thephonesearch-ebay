const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');
const {assertCapability}=require('./_lib/live-control');

const safeQuantity=value=>Math.max(0,Math.floor(Number(value||0))-Math.max(0,Number(process.env.MPS_STOCK_SAFETY_BUFFER||1)));

module.exports=async function(req,res){
  if(!guard(req,res))return;
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'POST required'});
  try{
    assertCapability('stockPriceSync');
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const changes=(Array.isArray(body.changes)?body.changes:[]).slice(0,50);
    if(!changes.length)return res.status(200).json({ok:true,processed:0,results:[]});
    const results=await Promise.all(changes.map(async change=>{
      const sku=String(change?.sku||'').trim();
      if(!sku)return{sku,ok:false,error:'Missing SKU'};
      const supplierStock=change?.orderable===false?0:Number(change?.stock||0);
      try{return{supplierStock,...await ebay.setInventoryQuantityIfExists(sku,supplierStock<=0?0:safeQuantity(supplierStock))};}
      catch(error){return{sku,ok:false,error:String(error?.message||error)};}
    }));
    const ok=results.every(item=>item.ok);
    console.log(JSON.stringify({event:'stock_delta',ok,received:changes.length,zeroed:results.filter(x=>x.quantity===0&&x.managed).length,updated:results.filter(x=>x.quantity>0&&x.managed).length,unmanaged:results.filter(x=>x.managed===false).length}));
    return res.status(ok?200:207).json({ok,processed:results.filter(x=>x.ok).length,results});
  }catch(error){
    console.error(JSON.stringify({event:'stock_delta',ok:false,error:String(error?.message||error)}));
    return res.status(error.status||500).json({ok:false,error:error.message,liveControl:error.liveControl||undefined});
  }
};
