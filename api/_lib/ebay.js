const EBAY='https://api.ebay.com';
const {optimizeListing}=require('./ai-listing');
const pricing=require('./pricing');
const {exclusionReason}=require('./catalog-quality');
const {assertCapability}=require('./live-control');
async function parseResponse(r){const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok){const err=new Error(`eBay HTTP ${r.status}`);err.status=r.status;err.data=data;throw err}return data}
async function refreshAccessToken(){const clientId=process.env.EBAY_CLIENT_ID||'AmeerAli-Thephone-PRD-925367676-a01057b2',secret=process.env.EBAY_CLIENT_SECRET,refresh=process.env.EBAY_REFRESH_TOKEN;if(!secret||!refresh)return null;const basic=Buffer.from(`${clientId}:${secret}`).toString('base64'),body=new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh});if(process.env.EBAY_OAUTH_SCOPES)body.set('scope',process.env.EBAY_OAUTH_SCOPES);return (await parseResponse(await fetch(`${EBAY}/identity/v1/oauth2/token`,{method:'POST',headers:{Authorization:`Basic ${basic}`,'Content-Type':'application/x-www-form-urlencoded'},body}))).access_token}
async function token(){const refreshed=await refreshAccessToken();if(refreshed)return refreshed;if(process.env.EBAY_USER_TOKEN)return process.env.EBAY_USER_TOKEN;throw new Error('No usable eBay token. Configure refresh token credentials.')}
async function api(path,options={}){const t=await token(),language=process.env.EBAY_CONTENT_LANGUAGE||'de-DE';return parseResponse(await fetch(`${EBAY}${path}`,{...options,headers:{Authorization:`Bearer ${t}`,Accept:'application/json','Accept-Language':process.env.EBAY_ACCEPT_LANGUAGE||language,'Content-Type':'application/json','Content-Language':language,...(options.headers||{})}}))}
async function policies(marketplace=process.env.EBAY_MARKETPLACE_ID||'EBAY_DE'){
  const [fulfillment,payment,returns]=await Promise.all([api(`/sell/account/v1/fulfillment_policy?marketplace_id=${encodeURIComponent(marketplace)}`),api(`/sell/account/v1/payment_policy?marketplace_id=${encodeURIComponent(marketplace)}`),api(`/sell/account/v1/return_policy?marketplace_id=${encodeURIComponent(marketplace)}`)]);
  const fulfillmentPolicyName=String(process.env.EBAY_FULFILLMENT_POLICY_NAME||'mobileparts').trim();
  let named=(fulfillment?.fulfillmentPolicies||[]).find(p=>String(p?.name||'').trim().toLowerCase()===fulfillmentPolicyName.toLowerCase());
  if(!named?.fulfillmentPolicyId)throw new Error(`Required eBay shipping profile "${fulfillmentPolicyName}" was not found for ${marketplace}`);
  const usesInvalidBrief=(named.shippingOptions||[]).some(option=>(option.shippingServices||[]).some(service=>String(service.shippingServiceCode||'')==='DE_DeutschePostBrief'&&Number(service.shippingCost?.value||0)>1));
  if(usesInvalidBrief){
    const dhlName=`${fulfillmentPolicyName}-dhl-499`;
    const existing=(fulfillment?.fulfillmentPolicies||[]).find(p=>String(p?.name||'').trim().toLowerCase()===dhlName.toLowerCase());
    if(existing?.fulfillmentPolicyId)named=existing;
    else{
      const {fulfillmentPolicyId,...template}=named;
      const shippingOptions=(template.shippingOptions||[]).map(option=>({...option,shippingServices:[{shippingServiceCode:'DE_DHLPaket',shippingCost:{currency:'EUR',value:'4.99'},additionalShippingCost:{currency:'EUR',value:'0.00'}}]}));
      named=await api('/sell/account/v1/fulfillment_policy',{method:'POST',body:JSON.stringify({...template,name:dhlName,marketplaceId:template.marketplaceId||marketplace,shippingOptions})});
    }
  }
  return{fulfillmentPolicyId:named.fulfillmentPolicyId,fulfillmentPolicyName:named.name||fulfillmentPolicyName,paymentPolicyId:process.env.EBAY_PAYMENT_POLICY_ID||payment?.paymentPolicies?.[0]?.paymentPolicyId,returnPolicyId:process.env.EBAY_RETURN_POLICY_ID||returns?.returnPolicies?.[0]?.returnPolicyId,counts:{fulfillment:fulfillment?.fulfillmentPolicies?.length||0,payment:payment?.paymentPolicies?.length||0,returns:returns?.returnPolicies?.length||0}};
}
async function firstInventoryLocation(){const data=await api('/sell/inventory/v1/location?limit=100'),loc=(data?.locations||[]).find(x=>x.merchantLocationStatus==='ENABLED')||data?.locations?.[0];return process.env.EBAY_MERCHANT_LOCATION_KEY||loc?.merchantLocationKey||null}
async function defaultCategoryTreeId(marketplace=process.env.EBAY_MARKETPLACE_ID||'EBAY_DE'){const data=await api(`/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${encodeURIComponent(marketplace)}`);if(!data?.categoryTreeId)throw new Error(`No category tree found for ${marketplace}`);return data.categoryTreeId}
async function suggestedCategory(query,marketplace=process.env.EBAY_MARKETPLACE_ID||'EBAY_DE'){const treeId=await defaultCategoryTreeId(marketplace),data=await api(`/commerce/taxonomy/v1/category_tree/${encodeURIComponent(treeId)}/get_category_suggestions?q=${encodeURIComponent(String(query||'').trim())}`),suggestion=data?.categorySuggestions?.[0]?.category;if(!suggestion?.categoryId)throw new Error('No suggested eBay category found');return suggestion.categoryId}
async function categoryAspects(categoryId,marketplace=process.env.EBAY_MARKETPLACE_ID||'EBAY_DE'){const treeId=await defaultCategoryTreeId(marketplace),data=await api(`/commerce/taxonomy/v1/category_tree/${encodeURIComponent(treeId)}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`);return(data?.aspects||[]).map(a=>({name:a?.localizedAspectName,required:!!a?.aspectConstraint?.aspectRequired,mode:a?.aspectConstraint?.aspectMode,values:(a?.aspectValues||[]).slice(0,100).map(v=>v?.localizedValue).filter(Boolean)}))}
function ebaySku(sourceSku){const raw=String(sourceSku||'').trim(),clean=raw.replace(/[^A-Za-z0-9]/g,'');if(!clean)throw new Error('Supplier SKU has no letters or numbers');return ('MP'+clean).slice(0,50)}
function processedImageUrl(source){const configured=String(process.env.EBAY_IMAGE_PROXY_ORIGIN||'https://ie-verified-phones-ebay-hook.vercel.app');const origin=configured.endsWith('/')?configured.slice(0,-1):configured;return origin+'/api/sync-preview?action=ebay-image&src='+encodeURIComponent(String(source));}
async function verifiedEbayImages(product){
  const sources=[...(product?.Images||[])].map(x=>x?.ImageUrl).filter(Boolean).slice(0,20);
  if(!sources.length)throw new Error('Listing blocked: no supplier product images were provided.');
  const sharp=require('sharp'),crypto=require('crypto'),accepted=[],seen=new Set();
  for(const source of sources){
    try{
      const response=await fetch(String(source),{headers:{accept:'image/*','user-agent':'MobilePartsDE source-image verifier'}});
      if(!response.ok)continue;
      const data=Buffer.from(await response.arrayBuffer()),meta=await sharp(data,{failOn:'none'}).metadata();
      const width=Number(meta.width||0),height=Number(meta.height||0),shortest=Math.min(width,height);
      // Never invent detail by enlarging a supplier image. Premium listings need a
      // genuine high-resolution source on its shortest edge.
      if(shortest<1200)continue;
      const fingerprint=crypto.createHash('sha256').update(data).digest('hex');
      if(seen.has(fingerprint))continue;
      seen.add(fingerprint);
      accepted.push({source,width,height,area:width*height});
    }catch{}
  }
  if(!accepted.length)throw new Error('Listing blocked: MobileParts did not provide a genuine high-resolution image (minimum 1200px on the shortest edge). No blurred image was sent to eBay.');
  // Highest-resolution, non-duplicate supplier photos first; no image is generated,
  // enlarged or substituted.
  return accepted.sort((a,b)=>b.area-a.area).slice(0,12).map(image=>processedImageUrl(image.source));
}
function sellingPrice(unitPrice){return pricing.recommendedPrice(unitPrice).itemPrice.toFixed(2)}
function inferCompatibility(description,manufacturer){const text=String(description||'').trim(),comma=text.lastIndexOf(',');let model=comma>=0?text.slice(comma+1).trim():text;model=model.replace(/^for\s+/i,'').replace(/^für\s+/i,'').trim();return{brand:manufacturer||'Markenlos',brandCompatibility:manufacturer?`Für ${manufacturer}`:'Universell',modelCompatibility:model||'Universal'}}
function inferProductType(description){const t=String(description||'').toLowerCase();if(t.includes('display')||t.includes('screen')||t.includes('lcd'))return'Bildschirm: LCD-Screen';if(t.includes('rear cover')||t.includes('back cover')||t.includes('battery cover'))return'Akkufachdeckel';if(t.includes('charging')||t.includes('charge')||t.includes('usb')||t.includes('connector'))return'Ladebuchse / Ladeplatine';if(t.includes('camera'))return'Kamera';if(t.includes('flex'))return'Flex-Kabel';if(t.includes('antenna'))return'Antenne';if(t.includes('button')||t.includes('key'))return'Ersatztasten';return'Sonstiges Ersatzteil'}
function ebayAspects(p){
  const c=inferCompatibility(p.Description,p.Manufacturer);
  return {'Marke':[c.brand],'Markenkompatibilität':[c.brandCompatibility],'Modellkompatibilität':[c.modelCompatibility],'Produktart':[inferProductType(p.Description)],'Herstellernummer':[String(p.PartNumber||p.Id)]};
}
const categoryAspectCache=new Map();
function normalized(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function detectedDisplaySize(product,title){
  const text=`${title||''} ${product?.Description||''}`;
  const mac=text.match(/(?:macbook(?:\s+pro|\s+air)?\s*)(1[3-6])\b/i)||text.match(/\b(1[3-6])\s*(?:["″]|zoll|inch|in\b)/i);
  return mac?String(mac[1]):null;
}
async function categoryAspectsCached(categoryId,marketplace){
  const key=`${marketplace||''}:${categoryId}`;
  if(!categoryAspectCache.has(key))categoryAspectCache.set(key,categoryAspects(categoryId,marketplace));
  return categoryAspectCache.get(key);
}
async function requiredDisplayAspects(product,title,categoryId,marketplace,base){
  const aspects={...base},size=detectedDisplaySize(product,title);
  if(!size)return aspects;
  const specifications=await categoryAspectsCached(categoryId,marketplace);
  for(const spec of specifications){
    if(!spec?.required||aspects[spec.name])continue;
    const aspectName=normalized(spec.name);
    if(aspectName==='bildschirmgrosse'&&size){
      const permitted=(spec.values||[]).find(value=>new RegExp(`(^|[^0-9])${size}(?:[.,]0)?(?:[^0-9]|$)`).test(String(value)));
      if(permitted)aspects[spec.name]=[permitted];
    }
    // eBay DE's manual listing flow uses the category's own "Nicht zutreffend"
    // value for GTIN-exempt spare parts. Do not invent a barcode in product.ean.
    if(aspectName==='ean'&&!/^(?:\\d{8}|\\d{12,14})$/.test(String(product?.EanNumber||product?.EAN||'').replace(/\\D/g,''))){
      const exempt=(spec.values||[]).find(value=>/nicht\\s*zutreffend|not\\s*applicable/i.test(String(value)));
      if(exempt)aspects[spec.name]=[exempt];
    }
  }
  return aspects;
}
async function orderFulfillments(orderId){return api(`/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`)}
async function createShippingFulfillment(orderId,lineItems,carrier,trackingNumber){assertCapability('trackingWrites');const existing=await orderFulfillments(orderId).catch(()=>({fulfillments:[]}));if((existing?.fulfillments||[]).some(f=>String(f?.shipmentTrackingNumber||'')===String(trackingNumber||'')))return{duplicate:true,skipped:true};return api(`/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`,{method:'POST',body:JSON.stringify({lineItems:(lineItems||[]).map(x=>({lineItemId:x.lineItemId,quantity:Number(x.quantity||1)})),shippingCarrierCode:String(carrier||'Other'),trackingNumber:String(trackingNumber||'')})})}
async function setInventoryQuantityIfExists(sku,quantity){assertCapability('stockPriceSync');const sourceSku=String(sku||''),inventorySku=ebaySku(sourceSku),path=`/sell/inventory/v1/inventory_item/${encodeURIComponent(inventorySku)}`;let inventory;try{inventory=await api(path)}catch(error){if(error.status===404)return{sku:sourceSku,ebaySku:inventorySku,ok:true,managed:false,quantity:null,action:'NOT_AN_EBAY_INVENTORY_ITEM'};throw error}const safeQuantity=Math.max(0,Math.floor(Number(quantity||0))),body={...inventory,availability:{...(inventory.availability||{}),shipToLocationAvailability:{...(inventory.availability?.shipToLocationAvailability||{}),quantity:safeQuantity}}};await api(path,{method:'PUT',body:JSON.stringify(body)});return{sku:sourceSku,ebaySku:inventorySku,ok:true,managed:true,quantity:safeQuantity,action:safeQuantity===0?'EBAY_QUANTITY_ZERO':'EBAY_QUANTITY_UPDATED'}}
async function upsertPart(p){
  assertCapability('listingWrites');
  const marketplace=process.env.EBAY_MARKETPLACE_ID||'EBAY_DE',
    currency=process.env.EBAY_CURRENCY||'EUR',
    sourceSku=String(p.PartNumber||p.Id),
    sku=ebaySku(sourceSku),
    optimized=await optimizeListing(p),
    o=p._listingOverrides||{},
    title=String(o.title||optimized.title||p.Description||sku).replace(/\s+/g,' ').trim().slice(0,80),
    listingDescription=(String(o.description||optimized.description||p.Description||title).trim()||title).slice(0,4000),
    images=await verifiedEbayImages(p),
    qty=Math.max(0,Number(p.AvailableStockQuantity||0)),
    rawEan=String(p.EanNumber||p.EAN||'').replace(/\D/g,''),
    categoryId=process.env.EBAY_DEFAULT_CATEGORY_ID||process.env.EBAY_MOBILE_PARTS_CATEGORY_ID||'43304',
    aspects=await requiredDisplayAspects(p,title,categoryId,marketplace,ebayAspects(p)),
    product={title,description:listingDescription,imageUrls:images,aspects};
  if(/^(?:\d{8}|\d{12,14})$/.test(rawEan))product.ean=[rawEan];
  const inventory={availability:{shipToLocationAvailability:{quantity:qty}},condition:'NEW',product};
  await api(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,{method:'PUT',body:JSON.stringify(inventory)});
  const loc=await firstInventoryLocation();
  if(!loc)throw new Error('No enabled eBay inventory location found.');
  const pol=await policies(marketplace);
  if(!pol.fulfillmentPolicyId||!pol.paymentPolicyId||!pol.returnPolicyId)throw new Error(`Missing eBay business policies for ${marketplace}`);
  const price=Number(o.price||pricing.recommendedPrice(p.UnitPrice).itemPrice).toFixed(2),
    offerBody={sku,marketplaceId:marketplace,format:'FIXED_PRICE',listingDuration:'GTC',availableQuantity:qty,categoryId,merchantLocationKey:loc,listingDescription,listingPolicies:{fulfillmentPolicyId:pol.fulfillmentPolicyId,paymentPolicyId:pol.paymentPolicyId,returnPolicyId:pol.returnPolicyId},pricingSummary:{price:{currency,value:price}}};
  let found={offers:[]};
  try{found=await api(`/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${encodeURIComponent(marketplace)}&limit=20`)}catch(e){if(e.status!==404)throw e}
  const existingOffer=found?.offers?.[0]||null,alreadyPublished=existingOffer?.status==='PUBLISHED';
  let offerId=existingOffer?.offerId;
  if(offerId)await api(`/sell/inventory/v1/offer/${offerId}`,{method:'PUT',body:JSON.stringify(offerBody)});
  else{const created=await api('/sell/inventory/v1/offer',{method:'POST',body:JSON.stringify(offerBody)});offerId=created?.offerId;if(!offerId)throw new Error('eBay did not return an offerId.')}
  let publish=null;
  if(!alreadyPublished)publish=await api(`/sell/inventory/v1/offer/${offerId}/publish`,{method:'POST',body:'{}'});
  const confirmedOffer=await api(`/sell/inventory/v1/offer/${offerId}`);
  const listingId=confirmedOffer?.listing?.listingId||publish?.listingId||null;
  const published=confirmedOffer?.status==='PUBLISHED'&&!!listingId;
  if(!published)throw new Error('eBay did not confirm a live listing ID after publish.');
  return{sku:sourceSku,ebaySku:sku,title,description:listingDescription,contentSource:optimized.source,offerId,listingId,categoryId,quantity:qty,price:offerBody.pricingSummary.price,pricing:pricing.recommendedPrice(p.UnitPrice),published,publish};
}
async function safeUpsertPart(part){const excluded=exclusionReason(part);if(excluded){const error=new Error(excluded==='RESIN_PRODUCT'?'Resin products are excluded from eBay':'A valid product image is required for eBay');error.status=422;throw error}return upsertPart(part)}
module.exports={api,token,ebaySku,policies,firstInventoryLocation,defaultCategoryTreeId,suggestedCategory,categoryAspects,sellingPrice,ebayAspects,orderFulfillments,createShippingFulfillment,setInventoryQuantityIfExists,upsertPart:safeUpsertPart,pricing};
