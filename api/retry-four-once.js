const mps=require('./_lib/mps');
const ebay=require('./_lib/ebay');

module.exports=async function(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'GET required'});
  const skus=['02350VAS','02351AYY','02351DMD','02351EUD'];
  const results=[];
  process.env.EBAY_PUBLISH='true';
  for(const sku of skus){
    try{
      const p=await mps.part(sku);
      results.push({ok:true,...await ebay.upsertPart(p)});
    }catch(e){
      results.push({ok:false,sku,error:e.message,details:e.data||null});
    }
  }
  return res.status(200).json({ok:results.every(x=>x.ok!==false),count:results.length,results});
};
