const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');
const mps=require('./_lib/mps');
const pricing=require('./_lib/pricing');

function flag(name,pass,detail,severity='blocker'){return {name,pass:!!pass,detail,severity};}
module.exports=async function(req,res){
 if(!guard(req,res))return;
 try{
  const checks=[];
  const marketplace=process.env.EBAY_MARKETPLACE_ID||'EBAY_DE';
  const syncMode=String(process.env.SYNC_MODE||'preview').toLowerCase();
  const publish=String(process.env.EBAY_PUBLISH||'false').toLowerCase()==='true';
  const autoTracking=String(process.env.EBAY_AUTO_TRACKING||'false').toLowerCase()==='true';
  checks.push(flag('Preview safety lock',syncMode!=='live',`SYNC_MODE=${syncMode}`,'safety'));
  checks.push(flag('Publishing safety lock',!publish,`EBAY_PUBLISH=${publish}`,'safety'));
  checks.push(flag('Supplier purchasing locked',true,'Automatic MobileParts purchasing is not enabled until durable idempotency exists.','safety'));
  checks.push(flag('Admin protection',!!(process.env.ADMIN_TOKEN||process.env.EBAY_VERIFICATION_TOKEN),'Protected admin routes require a secret.'));
  checks.push(flag('MobileParts credentials',!!process.env.MPS_USERNAME&&!!process.env.MPS_PASSWORD,'Supplier credentials configured.'));
  checks.push(flag('eBay OAuth',!!process.env.EBAY_USER_TOKEN||!!(process.env.EBAY_REFRESH_TOKEN&&process.env.EBAY_CLIENT_SECRET),'Static token or refresh-token flow configured.'));
  const pc=pricing.config();
  checks.push(flag('DE supplier shipping',Number(pc.supplierShipping)===8.40,`Configured supplier shipping €${Number(pc.supplierShipping).toFixed(2)}.`));
  checks.push(flag('DE customer shipping',Number(pc.customerShipping)===4.99,`Configured buyer shipping €${Number(pc.customerShipping).toFixed(2)}.`));
  const profitTiers=[{cost:9.99,target:5},{cost:10,target:10},{cost:50,target:15},{cost:100,target:20}];
  const tiersPass=profitTiers.every(({cost,target})=>pricing.fixedProfitTarget(cost)===target&&pricing.minimumItemPrice(cost).profitPass);
  checks.push(flag('Fixed after-tax profit tiers',tiersPass,'Under €10: €5; €10–€49.99: €10; €50–€99.99: €15; €100+: €20 after configured costs and reserves.'));
  const euSupplier=Number(process.env.MPS_SHIPPING_EU),euCustomer=Number(process.env.EBAY_CUSTOMER_SHIPPING_EU);
  checks.push(flag('EU shipping rates',Number.isFinite(euSupplier)&&euSupplier>0&&Number.isFinite(euCustomer)&&euCustomer>0,Number.isFinite(euSupplier)&&euSupplier>0&&Number.isFinite(euCustomer)&&euCustomer>0?`Supplier €${euSupplier.toFixed(2)}, buyer €${euCustomer.toFixed(2)}.`:'Waiting for real MobileParts EU supplier cost and chosen buyer charge.','launch'));
  try{const policy=await ebay.policies(marketplace);checks.push(flag('eBay shipping profile',!!policy.fulfillmentPolicyId,`Using "${policy.fulfillmentPolicyName}" for ${marketplace}.`));}catch(e){checks.push(flag('eBay shipping profile',false,e.message));}
  try{await mps.login();checks.push(flag('MobileParts API access',true,'Supplier session can be created.'));}catch(e){checks.push(flag('MobileParts API access',false,e.message));}
  const blockers=checks.filter(x=>!x.pass&&x.severity==='blocker');
  const launchItems=checks.filter(x=>!x.pass&&x.severity==='launch');
  res.status(200).json({ok:true,marketplace,readyForSafePreview:blockers.length===0,readyForFullDELaunch:blockers.length===0,readyForEULaunch:blockers.length===0&&launchItems.length===0,safety:{syncMode,publish,autoTracking,supplierPurchase:false},checks,remaining:{blockers:blockers.map(x=>x.name),launch:launchItems.map(x=>x.name)}});
 }catch(e){res.status(e.status||500).json({ok:false,error:e.message,details:e.data||null});}
};
