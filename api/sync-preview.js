const {guard}=require('./_lib/admin');
const mps=require('./_lib/mps');
const ebay=require('./_lib/ebay');
const pricing=require('./_lib/pricing');
const market=require('./_lib/market-pricing');
const {optimizeListing}=require('./_lib/ai-listing');
const {imageUrls,exclusionReason}=require('./_lib/catalog-quality');

function approvedImageUrl(value){const url=new URL(String(value||''));if(url.protocol!=='https:')throw new Error('Only HTTPS supplier image URLs are accepted');const host=url.hostname.toLowerCase(),extras=String(process.env.MPS_IMAGE_ALLOWED_HOSTS||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);if(!(host==='mobileparts.shop'||host.endsWith('.mobileparts.shop')||host==='2service.nl'||host.endsWith('.2service.nl')||extras.includes(host)))throw new Error('Image host is not an approved MobileParts supplier host');return url.toString()}
async function serveEbayImage(req,res){try{const source=approvedImageUrl(req.query?.src),upstream=await fetch(source,{headers:{accept:'image/avif,image/webp,image/*,*/*;q=0.8','user-agent':'MobilePartsDE eBay image processor'}});if(!upstream.ok)throw new Error('Supplier image returned HTTP '+upstream.status);if(!String(upstream.headers.get('content-type')||'').startsWith('image/'))throw new Error('Supplier URL did not return an image');const input=Buffer.from(await upstream.arrayBuffer());if(!input.length||input.length>20*1024*1024)throw new Error('Supplier image size is invalid');const sharp=require('sharp'),output=await sharp(input,{limitInputPixels:40000000,failOn:'none'}).rotate().trim({background:{r:255,g:255,b:255,alpha:1},threshold:10}).resize(2000,2000,{fit:'contain',background:{r:255,g:255,b:255,alpha:1},withoutEnlargement:false})
        .sharpen({sigma:1.25,m1:1,m2:1.6,x1:2,y2:10,y3:20})
        .jpeg({quality:95,chromaSubsampling:'4:4:4',progressive:true}).toBuffer();res.setHeader('Content-Type','image/jpeg');res.setHeader('Cache-Control','public, max-age=31536000, immutable');res.setHeader('X-Image-Processing','trim-2000-square-sharpen');return res.status(200).send(output)}catch(error){return res.status(400).json({ok:false,error:String(error?.message||error)})}}

module.exports=async function(req,res){
  if(req.method==='GET'&&String(req.query?.action||'').toLowerCase()==='ebay-image')return serveEbayImage(req,res);
  if(!guard(req,res)) return;
  try{
    if(req.method==='POST'&&String(req.query.action||'').toLowerCase()==='optimize-selected'){
      const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
      const mode=String(body.mode||'').toLowerCase();
      if(!['title','description','price','auto'].includes(mode))return res.status(400).json({ok:false,error:'mode must be title, description, price or auto'});
      const skus=[...new Set((Array.isArray(body.skus)?body.skus:[]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,['price','auto'].includes(mode)?25:100);
      if(!skus.length)return res.status(400).json({ok:false,error:'Select at least one product'});
      const processSku=async sku=>{
        try{
          const p=await mps.part(sku),excluded=exclusionReason(p);
          if(excluded)throw new Error(excluded==='RESIN_PRODUCT'?'Resin products are excluded':excluded==='TRAINING_PRODUCT'?'Training products are excluded':'A valid product image is required');
          const optimized=await optimizeListing(p);
          if(mode==='price'||mode==='auto'){let competitor;try{competitor=await market.competitorPrice(p,optimized.title);}catch(error){competitor={status:'INSUFFICIENT_MARKET_DATA',reason:String(error?.message||error)};}const calculation=competitor.recommendedItemPrice==null?pricing.recommendedPrice(p.UnitPrice):pricing.recommendedPrice(p.UnitPrice,competitor.recommendedItemPrice);return{ok:true,sku,...(mode==='auto'?{title:String(optimized.title||p.Description||sku).slice(0,80),description:optimized.description||String(p.Description||'')}:{calculatedPrice:calculation.itemPrice}),calculatedPrice:calculation.itemPrice,buyerTotal:calculation.totalRevenue,pricing:calculation,competitorPricing:competitor,listingStatus:competitor.recommendedItemPrice==null?'FALLBACK_FIXED_PROFIT':competitor.status,source:mode==='auto'?'Automatic AI title, description and protected pricing':'Protected eBay pricing',confidence:competitor.confidence||'LOW'}}
          return{ok:true,sku,...(mode==='title'?{title:String(optimized.title||p.Description||sku).slice(0,80)}:{description:optimized.description||String(p.Description||'')}),source:optimized.source,confidence:optimized.confidence};
        }catch(e){return{ok:false,sku,error:e.message};}
      };
      const results=await Promise.all(skus.map(processSku));
      return res.status(results.every(x=>x.ok)?200:207).json({ok:results.every(x=>x.ok),dryRun:true,writePerformed:false,mode,count:results.length,results});
    }
    if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET or optimize-selected POST required'});
    const requested=Math.min(25,Math.max(1,Number(req.query.limit||10)));
    const minPrice=Math.max(0,Number(process.env.MIN_SELLING_PRICE||5));
    const items=[];
    let page=1,hasMore=true;
    while(items.length<requested && hasMore && page<=20){
      const data=await mps.allParts(page,100);hasMore=!!data?.HasMoreRecords;
      for(const summary of (data?.Parts||[])){
        if(items.length>=requested) break;
        if(!summary?.CanBeOrdered||Number(summary?.AvailableStockQuantity||0)<=0) continue;
        const summaryFloor=pricing.recommendedPrice(summary?.UnitPrice||0);
        if(Number(summaryFloor.itemPrice)<minPrice) continue;
        const detailed=await mps.part(summary.PartNumber).catch(()=>null),p=detailed||summary;
        if(!p?.CanBeOrdered||Number(p?.AvailableStockQuantity||0)<=0||exclusionReason(p)) continue;
        const floor=pricing.recommendedPrice(p?.UnitPrice||0);
        if(Number(floor.itemPrice)<minPrice) continue;
        const optimized=await optimizeListing(p);
        let categoryId=null,categoryError=null;
        try{categoryId=process.env.EBAY_DEFAULT_CATEGORY_ID||await ebay.suggestedCategory(`${p.Manufacturer||''} ${optimized.title||p.Description||p.PartNumber}`);}catch(e){categoryError=e.message;}
        let competitor=null,competitorError=null;
        try{competitor=await market.competitorPrice(p,optimized.title);}catch(e){competitorError=e.message;}
        const listingStatus=competitor?.status||'MARKET_CHECK_ERROR';
        const finalPricing=competitor?.recommendedItemPrice==null?pricing.blockedPricing(p?.UnitPrice||0,listingStatus):pricing.recommendedPrice(p?.UnitPrice||0,competitor.recommendedItemPrice);
        items.push({sku:p.PartNumber,supplierTitle:optimized.supplierTitle||p.Description,title:optimized.title||p.Description,optimizedTitle:optimized.title||p.Description,description:optimized.description||String(p.Description||''),contentSource:optimized.source,aiError:optimized.aiError||null,stock:p.AvailableStockQuantity,costExVat:p.UnitPrice,calculatedPrice:finalPricing.itemPrice??null,buyerTotal:finalPricing.totalRevenue??null,minimumPrice:floor.minimumItemPrice,pricing:finalPricing,competitorPricing:competitor,competitorError,listingStatus,categoryId,categoryError,images:imageUrls(p).slice(0,12)});
      }
      page++;
    }
    const pol=await ebay.policies().catch(e=>({error:e.message}));
    const loc=await ebay.firstInventoryLocation().catch(()=>null);
    const ebayOk=!pol?.error&&!!loc&&items.every(x=>!x.categoryError);
    res.status(ebayOk?200:207).json({ok:ebayOk,dryRun:true,competitorPricing:true,aiConfigured:!!process.env.OPENAI_API_KEY,marketplace:process.env.EBAY_MARKETPLACE_ID||'EBAY_DE',currency:process.env.EBAY_CURRENCY||'EUR',minSellingPrice:minPrice,pricingConfig:pricing.config(),policies:pol,inventoryLocation:loc,items});
  }catch(e){res.status(500).json({ok:false,error:e.message,details:e.data||null});}
};
