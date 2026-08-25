const {guard}=require('./_lib/admin');
const mps=require('./_lib/mps');
const ebay=require('./_lib/ebay');
module.exports=async function(req,res){
  if(!guard(req,res)) return;
  const out={ok:true,time:new Date().toISOString(),config:{mpsCredentials:!!(process.env.MPS_USERNAME&&process.env.MPS_PASSWORD),ebayStaticToken:!!process.env.EBAY_USER_TOKEN,ebayRefreshReady:!!(process.env.EBAY_CLIENT_SECRET&&process.env.EBAY_REFRESH_TOKEN),marketplace:process.env.EBAY_MARKETPLACE_ID||'EBAY_DE',currency:process.env.EBAY_CURRENCY||'EUR',publish:String(process.env.EBAY_PUBLISH||'false').toLowerCase()==='true',syncMode:process.env.SYNC_MODE||'preview'}};
  try{await ebay.api('/sell/account/v1/privilege/');out.ebay={ok:true};}catch(e){out.ok=false;out.ebay={ok:false,error:e.message,details:e.data||null};}
  try{const t=await mps.authenticate();out.mps={ok:true,sessionTokenReceived:!!t};}catch(e){out.ok=false;out.mps={ok:false,error:e.message};}
  try{out.policies=await ebay.policies();}catch(e){out.policies={error:e.message,details:e.data||null};}
  try{out.inventoryLocation=await ebay.firstInventoryLocation();}catch(e){out.inventoryLocation=null;out.inventoryLocationError=e.message;}
  res.status(out.ok?200:207).json(out);
};
