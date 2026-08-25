function requireAdmin(req){
  const expected=process.env.ADMIN_TOKEN||process.env.EBAY_VERIFICATION_TOKEN;
  if(!expected) return {ok:false,status:503,error:'ADMIN_TOKEN is not configured'};
  const got=req.headers['x-admin-token']||'';
  if(got!==expected) return {ok:false,status:401,error:'Unauthorized'};
  return {ok:true};
}
function guard(req,res){const a=requireAdmin(req);if(!a.ok){res.status(a.status).json({ok:false,error:a.error});return false;}return true;}
module.exports={guard};
