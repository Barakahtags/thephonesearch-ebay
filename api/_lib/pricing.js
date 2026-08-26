function n(v,fallback=0){const x=Number(v);return Number.isFinite(x)?x:fallback}
function round(v){return Math.round((n(v)+Number.EPSILON)*100)/100}

function config(overrides={}){
  return {
    minimumMargin:n(overrides.minimumMargin,n(process.env.MIN_NET_MARGIN,30)/100),
    ebayProductFeeRate:n(overrides.ebayProductFeeRate,n(process.env.EBAY_PRODUCT_FEE_RATE,.11)),
    ebayShippingFeeRate:n(overrides.ebayShippingFeeRate,n(process.env.EBAY_SHIPPING_FEE_RATE,.10)),
    feeVatRate:n(overrides.feeVatRate,n(process.env.EBAY_FEE_VAT_RATE,.19)),
    fixedFee:n(overrides.fixedFee,n(process.env.EBAY_FIXED_FEE,.35)),
    // Germany dropship profile: MobileParts charges 8.40 once per customer shipment.
    supplierShipping:n(overrides.supplierShipping,n(process.env.MPS_SHIPPING_DE,8.40)),
    // Buyer sees 4.99 once per combined eBay order/shipment. Remaining supplier delivery cost is absorbed by item pricing.
    customerShipping:n(overrides.customerShipping,n(process.env.EBAY_CUSTOMER_SHIPPING_DE,4.99)),
    combinedShipping:true
  }
}

function shippingPlan(supplierCost,overrides={}){
  const c=config(overrides);
  return {supplierShipping:round(c.supplierShipping),customerShipping:round(c.customerShipping),embeddedShippingCost:round(Math.max(0,c.supplierShipping-c.customerShipping)),mode:'DE_4.99_COMBINED',combinedShipping:true};
}

function breakdown(itemPrice,supplierCost,overrides={}){
  const c=config(overrides),p=Math.max(0,n(itemPrice)),cost=Math.max(0,n(supplierCost)),ship=shippingPlan(cost,c);
  const customerShipping=ship.customerShipping,supplierShipping=ship.supplierShipping;
  const productFee=p*c.ebayProductFeeRate,productFeeVat=productFee*c.feeVatRate;
  const shippingFee=customerShipping*c.ebayShippingFeeRate,shippingFeeVat=shippingFee*c.feeVatRate;
  const totalEbayCharges=productFee+productFeeVat+c.fixedFee+shippingFee+shippingFeeVat;
  const totalRevenue=p+customerShipping,totalCosts=cost+supplierShipping+totalEbayCharges;
  const netProfit=totalRevenue-totalCosts,netMargin=totalRevenue?netProfit/totalRevenue:0;
  return {itemPrice:round(p),customerShipping:round(customerShipping),totalRevenue:round(totalRevenue),supplierCost:round(cost),supplierShipping:round(supplierShipping),embeddedShippingCost:ship.embeddedShippingCost,shippingMode:ship.mode,combinedShipping:ship.combinedShipping,ebayProductFee:round(productFee),ebayProductFeeVat:round(productFeeVat),ebayFixedFee:round(c.fixedFee),ebayShippingFee:round(shippingFee),ebayShippingFeeVat:round(shippingFeeVat),totalEbayCharges:round(totalEbayCharges),totalCosts:round(totalCosts),netProfit:round(netProfit),netMargin:Number((netMargin*100).toFixed(2)),minimumMarginTarget:Number((c.minimumMargin*100).toFixed(2)),marginPass:netMargin+1e-9>=c.minimumMargin,shippingConfigured:c.supplierShipping>0,assumptions:{ebayProductFeeRate:c.ebayProductFeeRate,ebayShippingFeeRate:c.ebayShippingFeeRate,feeVatRate:c.feeVatRate,fixedFee:c.fixedFee,shippingAllocation:'one supplier shipping charge per customer shipment',customerShippingRule:'4.99 once for combined DE order'}}
}

function minimumItemPrice(supplierCost,overrides={}){
  const c=config(overrides),cost=Math.max(0,n(supplierCost)),customerShipping=c.customerShipping,supplierShipping=c.supplierShipping;
  const a=c.ebayProductFeeRate*(1+c.feeVatRate),b=c.ebayShippingFeeRate*(1+c.feeVatRate),denominator=1-a-c.minimumMargin;
  if(denominator<=0)throw new Error('Pricing configuration cannot produce the requested minimum margin.');
  const numerator=cost+supplierShipping+c.fixedFee-customerShipping*(1-b-c.minimumMargin);
  let price=Math.ceil(Math.max(0,numerator/denominator)*100)/100,result=breakdown(price,cost,c);
  while(!result.marginPass){price=round(price+.01);result=breakdown(price,cost,c)}
  return {...result,minimumItemPrice:price};
}

function recommendedPrice(supplierCost,marketPrice=null,overrides={}){
  const floor=minimumItemPrice(supplierCost,overrides),market=n(marketPrice,NaN),chosen=Number.isFinite(market)&&market>floor.minimumItemPrice?market:floor.minimumItemPrice;
  return {...breakdown(chosen,supplierCost,overrides),minimumItemPrice:floor.minimumItemPrice,marketPrice:Number.isFinite(market)?round(market):null,priceReason:Number.isFinite(market)&&market>floor.minimumItemPrice?'market-upside':'30%-margin-floor'};
}

module.exports={config,shippingPlan,breakdown,minimumItemPrice,recommendedPrice};
