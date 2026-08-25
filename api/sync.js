const {guard}=require('./_lib/admin');
const mps=require('./_lib/mps');
const ebay=require('./_lib/ebay');
module.exports=async function(req,res){
  if(!guard(req,res)) return;
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'POST required'});
  const live=String(process.env.SYNC_MODE||'preview').toLowerCase()==='live';
  if(!live) return res.status(403).json({ok:false,error:'Live sync is locked. Set SYNC_MODE=live after reviewing /api/sync-preview. No listings were changed.'});
  try{
    const limit=Math.min(20,Math.max(1,Number(req.query.limit||5))); const page=Math.max(1,Number(req.query.page||1));
    const data=await mps.allParts(page,limit); const results=[];
    for(const p of (data.Parts||[]).slice(0,limit)){
      if(!p.CanBeOrdered){results.push({sku:p.PartNumber,skipped:'not orderable'});continue;}
      try{results.push({ok:true,...await ebay.upsertPart(p)});}catch(e){results.push({ok:false,sku:p.PartNumber,error:e.message,details:e.data||null});}
    }
    res.status(200).json({ok:results.every(x=>x.ok!==false),live:true,page,limit,results});
  }catch(e){res.status(500).json({ok:false,error:e.message,details:e.data||null});}
};
