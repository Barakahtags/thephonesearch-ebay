const ebay=require('./_lib/ebay');
module.exports=async function(req,res){
  try{const privileges=await ebay.api('/sell/account/v1/privilege/');res.status(200).json({ok:true,message:'Production eBay OAuth connection is working.',refreshReady:!!(process.env.EBAY_CLIENT_SECRET&&process.env.EBAY_REFRESH_TOKEN),privileges});}
  catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null,refreshReady:!!(process.env.EBAY_CLIENT_SECRET&&process.env.EBAY_REFRESH_TOKEN)});}
};
