function n(v,fallback=0){const x=Number(v);return Number.isFinite(x)?x:fallback}
function round(v){return Math.round((n(v)+Number.EPSILON)*100)/100}

function config(overrides={}){
  return {
    minimumMargin:n(overrides.minimumMargin, n(process.env.MIN_NET_MARGIN,30)/100),
    ebayProductFeeRate:n(overrides.ebayProductFeeRate,n(process.env.EBAY_PRODUCT_FEE_RATE,.11)),
    ebayShippingFeeRate:n(overrides.ebayShippingFeeRate,n(process.env.EBAY_SHIPPING_FEE_RATE,.10)),
    feeVatRate:n(overrides.feeVatRate,n(process.env.EBAY_FEE_VAT_RATE,.19)),
    fixedFee:n(overrides.fixedFee,n(process.env.EBAY_FIXED_FEE,.35)),
    supplierShipping:n(overrides.supplierShipping,n(process.env.MPS_SHIPPING_DE,0)),
    customerShipping:n(overrides.customerShipping,n(process.env.EBAY_CUSTOMER_SHIPPING_DE,0))
  }
}

function breakdown(itemPrice,supplierCost,overrides={}){
  const c=config(overrides), p=Math.max(0,n(itemPrice)), cost=Math.max(0,n(supplierCost));
  const customerShipping=Math.max(0,c.customerShipping), supplierShipping=Math.max(0,c.supplierShipping);
  const productFee=p*c.ebayProductFeeRate;
  const productFeeVat=productFee*c.feeVatRate;
  const shippingFee=customerShipping*c.ebayShippingFeeRate;
  const shippingFeeVat=shippingFee*c.feeVatRate;
  const totalEbayCharges=productFee+productFeeVat+c.fixedFee+shippingFee+shippingFeeVat;
  const totalRevenue=p+customerShipping;
  const totalCosts=cost+supplierShipping+totalEbayCharges;
  const netProfit=totalRevenue-totalCosts;
  const netMargin=totalRevenue?netProfit/totalRevenue:0;
  return {
    itemPrice:round(p),customerShipping:round(customerShipping),totalRevenue:round(totalRevenue),
    supplierCost:round(cost),supplierShipping:round(supplierShipping),
    ebayProductFee:round(productFee),ebayProductFeeVat:round(productFeeVat),ebayFixedFee:round(c.fixedFee),
    ebayShippingFee:round(shippingFee),ebayShippingFeeVat:round(shippingFeeVat),totalEbayCharges:round(totalEbayCharges),
    totalCosts:round(totalCosts),netProfit:round(netProfit),netMargin:Number((netMargin*100).toFixed(2)),
    minimumMarginTarget:Number((c.minimumMargin*100).toFixed(2)),marginPass:netMargin+1e-9>=c.minimumMargin,
    shippingConfigured:c.supplierShipping>0||c.customerShipping>0,
    assumptions:{ebayProductFeeRate:c.ebayProductFeeRate,ebayShippingFeeRate:c.ebayShippingFeeRate,feeVatRate:c.feeVatRate,fixedFee:c.fixedFee}
  }
}

function minimumItemPrice(supplierCost,overrides={}){
  const c=config(overrides), cost=Math.max(0,n(supplierCost));
  const a=c.ebayProductFeeRate*(1+c.feeVatRate);
  const b=c.ebayShippingFeeRate*(1+c.feeVatRate);
  const denominator=1-a-c.minimumMargin;
  if(denominator<=0) throw new Error('Pricing configuration cannot produce the requested minimum margin.');
  const numerator=cost+c.supplierShipping+c.fixedFee-c.customerShipping*(1-b-c.minimumMargin);
  let raw=Math.max(0,numerator/denominator);
  let price=Math.ceil(raw*100)/100;
  let result=breakdown(price,cost,c);
  while(!result.marginPass){price=round(price+.01);result=breakdown(price,cost,c)}
  return {...result,minimumItemPrice:price};
}

function recommendedPrice(supplierCost,marketPrice=null,overrides={}){
  const floor=minimumItemPrice(supplierCost,overrides);
  const market=n(marketPrice,NaN);
  const chosen=Number.isFinite(market)&&market>floor.minimumItemPrice?market:floor.minimumItemPrice;
  return {...breakdown(chosen,supplierCost,overrides),minimumItemPrice:floor.minimumItemPrice,marketPrice:Number.isFinite(market)?round(market):null,priceReason:Number.isFinite(market)&&market>floor.minimumItemPrice?'market-upside':'30%-margin-floor'};
}

module.exports={config,breakdown,minimumItemPrice,recommendedPrice};
