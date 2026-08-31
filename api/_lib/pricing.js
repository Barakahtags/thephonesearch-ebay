const PRICING_VERSION='ebay-lowest-undercut-v6';
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const round=v=>Math.round((Number(v)+Number.EPSILON)*100)/100;

function config(o={}){
  return {
    salesVatRate:n(o.salesVatRate,n(process.env.GERMAN_SALES_VAT_RATE,.19)),
    ebayProductFeeRate:n(o.ebayProductFeeRate,n(process.env.EBAY_PRODUCT_FEE_RATE,.15)),
    ebayShippingFeeRate:n(o.ebayShippingFeeRate,n(process.env.EBAY_SHIPPING_FEE_RATE,.15)),
    feeVatRate:n(o.feeVatRate,n(process.env.EBAY_FEE_VAT_RATE,.19)),
    profitTaxReserveRate:n(o.profitTaxReserveRate,n(process.env.PROFIT_TAX_RESERVE_RATE,.19)),
    fixedFee:n(o.fixedFee,n(process.env.EBAY_FIXED_FEE,.35)),
    supplierShipping:n(o.supplierShipping,n(process.env.MPS_SHIPPING_DE,8.40)),
    customerShipping:n(o.customerShipping,n(process.env.EBAY_CUSTOMER_SHIPPING_DE,4.99)),
    undercutAmount:n(o.undercutAmount,n(process.env.EBAY_UNDERCUT_AMOUNT,.50)),
    combinedShipping:false,
    pricingVersion:PRICING_VERSION
  };
}

function fixedProfitTarget(supplierCost){
  const cost=Math.max(0,n(supplierCost));
  if(cost<10)return 5;
  if(cost<50)return 10;
  if(cost<100)return 15;
  return 20;
}

function shippingPlan(_cost,c){return{customerShipping:c.customerShipping,supplierShipping:c.supplierShipping,embeddedShippingCost:round(Math.max(0,c.supplierShipping-c.customerShipping)),mode:'split customer/product'};}

function breakdown(itemPrice,supplierCost,o={}){
  const c=config(o),p=Math.max(0,n(itemPrice)),cost=Math.max(0,n(supplierCost)),ship=shippingPlan(cost,c);
  const customerShipping=ship.customerShipping,supplierShipping=ship.supplierShipping,totalRevenue=p+customerShipping;
  const salesVat=totalRevenue*c.salesVatRate/(1+c.salesVatRate),productFee=p*c.ebayProductFeeRate,productFeeVat=productFee*c.feeVatRate;
  const shippingFee=customerShipping*c.ebayShippingFeeRate,shippingFeeVat=shippingFee*c.feeVatRate;
  const fixedFeeVat=c.fixedFee*c.feeVatRate,totalEbayCharges=productFee+productFeeVat+c.fixedFee+fixedFeeVat+shippingFee+shippingFeeVat;
  const totalCostsBeforeProfitTax=cost+supplierShipping+salesVat+totalEbayCharges,preTaxProfit=totalRevenue-totalCostsBeforeProfitTax;
  const profitTaxReserve=0,netProfit=preTaxProfit,totalCosts=totalCostsBeforeProfitTax;
  const targetProfit=fixedProfitTarget(cost),netMargin=totalRevenue?netProfit/totalRevenue:0;
  const profitPass=round(netProfit)+1e-9>=round(targetProfit);
  return {pricingVersion:PRICING_VERSION,itemPrice:round(p),customerShipping:round(customerShipping),totalRevenue:round(totalRevenue),salesVat:round(salesVat),supplierCost:round(cost),supplierShipping:round(supplierShipping),embeddedShippingCost:ship.embeddedShippingCost,shippingMode:ship.mode,combinedShipping:false,ebayProductFee:round(productFee),ebayProductFeeVat:round(productFeeVat),ebayFixedFee:round(c.fixedFee),ebayFixedFeeVat:round(fixedFeeVat),ebayShippingFee:round(shippingFee),ebayShippingFeeVat:round(shippingFeeVat),totalEbayCharges:round(totalEbayCharges),totalCostsBeforeProfitTax:round(totalCostsBeforeProfitTax),preTaxProfit:round(preTaxProfit),profitTaxReserve:round(profitTaxReserve),totalCosts:round(totalCosts),netProfit:round(netProfit),afterTaxProfit:round(netProfit),netMargin:Number((netMargin*100).toFixed(2)),targetProfit:round(targetProfit),profitPass,marginPass:profitPass,assumptions:{salesVatRate:c.salesVatRate,ebayProductFeeRate:c.ebayProductFeeRate,ebayShippingFeeRate:c.ebayShippingFeeRate,feeVatRate:c.feeVatRate,fixedFee:c.fixedFee,shippingAllocation:'8.40 reserved for every separate MPS customer shipment',customerShippingRule:'4.99 charged to the customer in Germany only',shippingDestination:'Germany only until verified international rates are configured',profitSchedule:'Profit after supplier cost, shipping, eBay fees and German VAT'}};
}

function itemPriceForProfit(supplierCost,targetProfit,o={}){
  const target=Math.max(0,n(targetProfit)),c=config(o);
  let low=0,high=Math.max(20,n(supplierCost)+c.supplierShipping+target+20);
  while(breakdown(high,supplierCost,c).netProfit<target&&high<100000)high*=2;
  for(let i=0;i<80;i++){const mid=(low+high)/2;if(breakdown(mid,supplierCost,c).netProfit>=target)high=mid;else low=mid;}
  return breakdown(Math.ceil(high*100)/100,supplierCost,c);
}

function minimumItemPrice(supplierCost,o={}){const result=itemPriceForProfit(supplierCost,fixedProfitTarget(supplierCost),o);return{...result,minimumItemPrice:result.itemPrice};}
function recommendedPrice(supplierCost,requestedPrice=null,o={}){const floor=minimumItemPrice(supplierCost,o);if(requestedPrice==null)return floor;const result=breakdown(Math.max(Number(requestedPrice)||0,floor.itemPrice),supplierCost,o);return{...result,minimumItemPrice:floor.itemPrice};}
function blockedPricing(supplierCost,blockedReason,o={}){const c=config(o),floor=minimumItemPrice(supplierCost,c);return{pricingVersion:PRICING_VERSION,blocked:true,pending:false,blockedReason:String(blockedReason||'MARKET_PRICE_UNAVAILABLE'),supplierCost:round(Math.max(0,n(supplierCost))),supplierShipping:round(c.supplierShipping),customerShipping:round(c.customerShipping),targetProfit:round(fixedProfitTarget(supplierCost)),minimumItemPrice:floor.itemPrice,itemPrice:null,totalRevenue:null,netProfit:null,afterTaxProfit:null,profitPass:false,marginPass:false};}

module.exports={PRICING_VERSION,config,fixedProfitTarget,shippingPlan,breakdown,itemPriceForProfit,minimumItemPrice,recommendedPrice,blockedPricing};
