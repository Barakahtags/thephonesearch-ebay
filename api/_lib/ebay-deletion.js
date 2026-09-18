const {createHash}=require('node:crypto');
const ENDPOINT='https://ie-verified-phones-ebay-hook.vercel.app/api/ebay-deletion';
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method==='GET'){
  const challenge=req.query?.challenge_code;
  if(typeof challenge!=='string'||!challenge)return res.status(400).json({error:'challenge_code required'});
  const token=process.env.EBAY_DELETION_VERIFICATION_TOKEN||process.env.EBAY_VERIFICATION_TOKEN;
  if(!token)return res.status(503).json({error:'Verification token is not configured'});
  return res.status(200).json({challengeResponse:createHash('sha256').update(challenge+token+(process.env.EBAY_DELETION_ENDPOINT||ENDPOINT)).digest('hex')});
 }
 if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).end();}
 try{
  let raw;
  if(req.body!==undefined)raw=Buffer.isBuffer(req.body)?req.body.toString('utf8'):typeof req.body==='string'?req.body:JSON.stringify(req.body);
  else {const chunks=[];let bytes=0;for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>65536)return res.status(413).end();chunks.push(Buffer.from(chunk));}raw=Buffer.concat(chunks).toString('utf8');}
  if(Buffer.byteLength(raw)>65536)return res.status(413).end();
  const body=JSON.parse(raw);
  if(body.metadata?.topic!=='MARKETPLACE_ACCOUNT_DELETION'||!body.notification?.notificationId)return res.status(400).json({error:'Invalid notification'});
  const secret=process.env.ADMIN_TOKEN||process.env.EBAY_VERIFICATION_TOKEN;
  if(!secret)return res.status(503).json({error:'Notification inbox is not configured'});
  const root=(process.env.CATALOGUE_WORKER_ORIGIN||'https://thephonesearch-stock-sync.thephonesearchpk.workers.dev').replace(/\/$/,'');
  const stored=await fetch(root+'/ebay-deletion-inbox',{method:'POST',headers:{'content-type':'application/json','x-admin-token':secret},body:JSON.stringify({payload:raw,signature:String(req.headers['x-ebay-signature']||'')}),signal:AbortSignal.timeout(8000)});
  if(!stored.ok)return res.status(503).json({error:'Notification could not be saved; retry required'});
  return res.status(202).json({accepted:true});
 }catch(error){
  console.error(JSON.stringify({event:'ebay_deletion_delivery_failed',type:error.name}));
  return res.status(error instanceof SyntaxError?400:503).json({error:'Notification was not accepted'});
 }
};

module.exports.config={api:{bodyParser:false}};
