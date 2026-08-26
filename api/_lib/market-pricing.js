const ebay=require('./ebay');
const pricing=require('./pricing');

function num(x){const n=Number(x);return Number.isFinite(n)?n:null;}
function round2(x){return Math.round((Number(x)+Number.EPSILON)*100)/100;}
function median(values){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function percentile(values,p){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const i=(a.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return a[lo]+(a[hi]-a[lo])*(i-lo);}
function cleanQuery(p,title){return String([p.Manufacturer,p.EanNumber,p.PartNumber,title||p.Description].filter(Boolean).join(' ')).replace(/\s+/g,' ').trim().slice(0,180);}

async function competitorPrice(p,title,minimumItemPrice){
  const marketplace=process.env.EBAY_MARKETPLACE_ID||'EBAY_DE',currency=process.env.EBAY_CURRENCY||'EUR';
  const q=cleanQuery(p,title),params=new URLSearchParams({q,limit:String(Math.min(50,Math.max(10,Number(process.env.EBAY_COMPETITOR_LIMIT||30))))});
  params.set('filter','buyingOptions:{FIXED_PRICE|BEST_OFFER},conditions:{NEW}');
  const data=await ebay.api(`/buy/browse/v1/item_summary/search?${params.toString()}`,{headers:{'X-EBAY-C-MARKETPLACE-ID':marketplace}});
  const rows=(data?.itemSummaries||[]).map(x=>{const price=num(x?.price?.value),ship=num(x?.shippingOptions?.[0]?.shippingCost?.value)||0;return{itemId:x.itemId,title:x.title,price,shipping:ship,total:price==null?null:round2(price+ship),currency:x?.price?.currency||currency,condition:x.condition,webUrl:x.itemWebUrl};}).filter(x=>x.total!=null&&x.currency===currency);
  const totals=rows.map(x=>x.total),q1=percentile(totals,.25),q3=percentile(totals,.75),iqr=q1!=null&&q3!=null?q3-q1:null;
  const filtered=iqr==null?rows:rows.filter(x=>x.total>=q1-1.5*iqr&&x.total<=q3+1.5*iqr);
  const marketMedian=median(filtered.map(x=>x.total)),marketLow=percentile(filtered.map(x=>x.total),.25);
  const ownShipping=pricing.config().customerShipping;
  const minimumBuyerTotal=Number(minimumItemPrice)+ownShipping;
  const targetBuyerTotal=marketMedian==null?minimumBuyerTotal:Math.max(minimumBuyerTotal,marketMedian);
  const recommendedItemPrice=Math.max(Number(minimumItemPrice),targetBuyerTotal-ownShipping);
  const gap=marketMedian==null?null:minimumBuyerTotal-marketMedian;
  let status='GOOD_TO_LIST';
  if(filtered.length<3)status='NOT_ENOUGH_COMPETITOR_DATA';
  else if(gap!=null&&gap>Math.max(2,marketMedian*.12))status='PRICE_HIGH_VS_MARKET';
  return {query:q,resultCount:rows.length,usableCount:filtered.length,marketLow:marketLow==null?null:round2(marketLow),marketMedian:marketMedian==null?null:round2(marketMedian),competitorBuyerTotal:marketMedian==null?null:round2(marketMedian),ourShipping:round2(ownShipping),minimumItemPrice:round2(minimumItemPrice),minimumBuyerTotal:round2(minimumBuyerTotal),recommendedItemPrice:round2(recommendedItemPrice),recommendedBuyerTotal:round2(recommendedItemPrice+ownShipping),status,strategy:marketMedian==null?'30_PERCENT_FLOOR_ONLY':recommendedItemPrice>Number(minimumItemPrice)?'MARKET_MEDIAN_TOTAL_ABOVE_FLOOR':'30_PERCENT_FLOOR',sample:filtered.slice(0,8)};
}

module.exports={competitorPrice};
