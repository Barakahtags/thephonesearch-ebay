const ebay=require('./ebay');
const pricing=require('./pricing');
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const r=v=>Math.round((Number(v)+Number.EPSILON)*100)/100;
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const pct=(values,p)=>{const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const i=(a.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return a[l]+(a[h]-a[l])*(i-l);};
const words=v=>new Set(clean(v).toLowerCase().replace(/[^a-z0-9äöüß-]+/g,' ').split(/\s+/).filter(x=>x.length>2));

function identifier(p){return clean(p.PartNumber||p.Mpn||p.ManufacturerPartNumber||'');}
function fallbackQuery(p,title){return clean([String(p.Manufacturer||'').toLowerCase()==='other'?'':p.Manufacturer,title||p.Description].filter(Boolean).join(' ')).slice(0,100);}
function relevance(row,p,title){
  const hay=clean(row.title).toLowerCase(),id=identifier(p).toLowerCase();
  if(id&&hay.includes(id))return 10;
  const wanted=words(fallbackQuery(p,title)),found=words(row.title);let overlap=0;
  for(const w of wanted)if(found.has(w))overlap++;
  return wanted.size?overlap/wanted.size*5:0;
}
async function search(query,marketplace,currency){
  const params=new URLSearchParams({q:query,limit:String(Math.min(50,Math.max(10,Number(process.env.EBAY_COMPETITOR_LIMIT||30))))});
  params.set('filter','buyingOptions:{FIXED_PRICE|BEST_OFFER},conditions:{NEW}');
  const data=await ebay.api(`/buy/browse/v1/item_summary/search?${params}`,{headers:{'X-EBAY-C-MARKETPLACE-ID':marketplace}});
  const rows=(data?.itemSummaries||[]).map(x=>{const price=num(x?.price?.value),shipping=num(x?.shippingOptions?.[0]?.shippingCost?.value)||0;return{itemId:x.itemId,title:x.title,price,shipping,total:price==null?null:r(price+shipping),currency:x?.price?.currency||currency,condition:x.condition,webUrl:x.itemWebUrl};}).filter(x=>x.total!=null&&x.currency===currency);
  return {count:(data?.itemSummaries||[]).length,rows};
}

async function competitorPrice(p,title){
  const c=pricing.config(),marketplace=process.env.EBAY_MARKETPLACE_ID||'EBAY_DE',currency=process.env.EBAY_CURRENCY||'EUR';
  const id=identifier(p),primaryQuery=id||fallbackQuery(p,title),primary=await search(primaryQuery,marketplace,currency);
  let query=primaryQuery,resultCount=primary.count,rows=primary.rows.map(x=>({...x,relevance:relevance(x,p,title)})).filter(x=>x.relevance>=3);
  if(rows.length<2&&id){const fallback=fallbackQuery(p,title);if(fallback&&fallback.toLowerCase()!==id.toLowerCase()){const second=await search(fallback,marketplace,currency);query=`${id} | ${fallback}`;resultCount+=second.count;rows=[...rows,...second.rows.map(x=>({...x,relevance:relevance(x,p,title)})).filter(x=>x.relevance>=2.1)];}}
  rows=[...new Map(rows.map(x=>[x.itemId,x])).values()];
  let totals=rows.map(x=>x.total),q1=pct(totals,.25),q3=pct(totals,.75),iqr=q1!=null&&q3!=null?q3-q1:null;
  if(iqr!=null)rows=rows.filter(x=>x.total>=q1-1.5*iqr&&x.total<=q3+1.5*iqr);
  totals=rows.map(x=>x.total);const marketLow=pct(totals,.25),marketMedian=pct(totals,.5),marketHigh=pct(totals,.75);
  const targetProfit=pricing.fixedProfitTarget(p.UnitPrice),target=pricing.itemPriceForProfit(p.UnitPrice,targetProfit,c),marketItem=marketMedian==null?null:Math.max(0,marketMedian-c.customerShipping);
  const base={pricingVersion:pricing.PRICING_VERSION,query,resultCount,usableCount:rows.length,exactIdentifierMatches:rows.filter(x=>x.relevance>=10).length,marketLow:marketLow==null?null:r(marketLow),marketMedian:marketMedian==null?null:r(marketMedian),marketHigh:marketHigh==null?null:r(marketHigh),ourShipping:r(c.customerShipping),targetProfit:r(targetProfit),minimumItemPrice:target.itemPrice,strategy:'FIXED_PROFIT',sample:rows.slice(0,8)};
  if(rows.length<2)return{...base,recommendedItemPrice:null,recommendedBuyerTotal:null,expectedProfit:null,status:'PRICING_PENDING',confidence:'LOW',reason:'Not enough reliable eBay matches to validate the fixed profit price.'};
  if(marketItem+0.01<target.itemPrice)return{...base,recommendedItemPrice:null,recommendedBuyerTotal:null,expectedProfit:null,status:'NOT_PROFITABLE',confidence:rows.length>=4?'MEDIUM':'LOW',reason:'The current eBay market cannot support the fixed after-tax profit target.'};
  return{...base,recommendedItemPrice:target.itemPrice,recommendedBuyerTotal:target.totalRevenue,expectedProfit:target.netProfit,preTaxProfit:target.preTaxProfit,profitTaxReserve:target.profitTaxReserve,status:'GOOD_TO_LIST',confidence:rows.length>=4?'HIGH':'MEDIUM',reason:'The eBay market supports the fixed after-tax profit target.'};
}

module.exports={competitorPrice};
