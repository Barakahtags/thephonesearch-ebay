function n(v,fallback=0){const x=Number(v);return Number.isFinite(x)?x:fallback}
function round(v){return Math.round((n(v)+Number.EPSILON)*100)/100}

function config(overrides={}){
  return {
    minimumMargin:n(overrides.minimumMargin,n(process.env.MIN_NET_MARGIN,30)/100),
    ebayProductFeeRate:n(overrides.ebayProductFeeRate,n(process.env.EBAY_PRODUCT_FEE_RATE,.11)),
    ebayShippingFeeRate:n(overrides.ebayShippingFeeRate,n(process.env.EBAY_SHIPPING_FEE_RATE,.10)),
    feeVatRate:n(overrides.feeVatRate,n(process.env.EBAY_FEE_VAT_RATE,.19)),
    fixedFee:n(overrides.fixedFee,n(process.env.EBAY_FIXED_FEE,.35)),
    // MobileParts charges delivery once per supplier order, NOT once per line item.
    supplierOrderShipping:n(overrides.supplierOrderShipping,n(process.env.MPS_SHIPPING_DE,8.40)),
    // Conservative pre-sale reserve: assume this many sale lines share one supplier shipment.
    expectedLinesPerSupplierOrder:Math.max(1,n(overrides.expectedLinesPerSupplierOrder,n(process.env.MPS_EXPECTED_LINES_PER_ORDER,4))),
    // Customer-facing hybrid shipping. Cheap products carry a small visible charge; higher-value items can be free delivery.
    cheapItemThreshold:n(overrides.cheapItemThreshold,n(process.env.SHIPPING_CHEAP_ITEM_THRESHOLD,20)),
    cheapItemCustomerShipping:n(overrides.cheapItemCustomerShipping,n(process.env.EBAY_CHEAP_ITEM_SHIPPING_DE,3.49)),
    standardCustomerShipping:n(overrides.standardCustomerShipping,n(process.env.EBAY_CUSTOMER_SHIPPING_DE,0))
  }
}

function shippingPlan(supplierCost,overrides={}){
  const c=config(overrides),cost=Math.max(0,n(supplierCost));
  const supplierShippingReserve=c.supplierOrderShipping/c.expectedLinesPerSupplierOrder;
  const customerShipping=cost<c.cheapItemThreshold?c.cheapItemCustomerShipping:c.standardCustomerShipping;
  return {supplierShippingReserve:round(supplierShippingReserve),customerShipping:round(customerShipping),supplierOrderShipping:round(c.supplierOrderShipping),expectedLinesPerSupplierOrder:c.expectedLinesPerSupplierOrder,mode:customerShipping>0?'HYBRID_PAID':'FREE_SHIPPING'};
}

function breakdown(itemPrice,supplierCost,overrides={}){
  const c=config(overrides),p=Math.max(0,n(itemPrice)),cost=Math.max(0,n(supplierCost)),ship=shippingPlan(cost,c);
  const customerShipping=ship.customerShipping,supplierShipping=ship.supplierShippingReserve;
  const productFee=p*c.ebayProductFeeRate,productFeeVat=productFee*c.feeVatRate;
  const shippingFee=customerShipping*c.ebayShippingFeeRate,shippingFeeVat=shippingFee*c.feeVatRate;
  const totalEbayCharges=productFee+productFeeVat+c.fixedFee+shippingFee+shippingFeeVat;
  const totalRevenue=p+customerShipping,totalCosts=cost+supplierShipping+totalEbayCharges;
  const netProfit=totalRevenue-totalCosts,netMargin=totalRevenue?netProfit/totalRevenue:0;
  return {itemPrice:round(p),customerShipping:round(customerShipping),totalRevenue:round(totalRevenue),supplierCost:round(cost),supplierShipping:round(supplierShipping),supplierOrderShipping:ship.supplierOrderShipping,shippingMode:ship.mode,expectedLinesPerSupplierOrder:ship.expectedLinesPerSupplierOrder,ebayProductFee:round(productFee),ebayProductFeeVat:round(productFeeVat),ebayFixedFee:round(c.fixedFee),ebayShippingFee:round(shippingFee),ebayShippingFeeVat:round(shippingFeeVat),totalEbayCharges:round(totalEbayCharges),totalCosts:round(totalCosts),netProfit:round(netProfit),netMargin:Number((netMargin*100).toFixed(2)),minimumMarginTarget:Number((c.minimumMargin*100).toFixed(2)),marginPass:netMargin+1e-9>=c.minimumMargin,shippingConfigured:c.supplierOrderShipping>0,assumptions:{ebayProductFeeRate:c.ebayProductFeeRate,ebayShippingFeeRate:c.ebayShippingFeeRate,feeVatRate:c.feeVatRate,fixedFee:c.fixedFee,shippingAllocation:'order-level-reserve'}}
}

function minimumItemPrice(supplierCost,overrides={}){
  const c=config(overrides),cost=Math.max(0,n(supplierCost)),ship=shippingPlan(cost,c),customerShipping=ship.customerShipping,supplierShipping=ship.supplierShippingReserve;
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

// After supplier checkout, replace the reserve with the ACTUAL one-time shipping charge allocated across that supplier order.
function actualOrderAllocation(lines,actualShipping){
  const rows=(lines||[]).map(x=>({...x,supplierCost:Math.max(0,n(x.supplierCost))})),total=rows.reduce((s,x)=>s+x.supplierCost,0),shipping=Math.max(0,n(actualShipping));
  return rows.map(x=>({...x,allocatedSupplierShipping:round(total?shipping*(x.supplierCost/total):shipping/Math.max(1,rows.length))}));
}

module.exports={config,shippingPlan,breakdown,minimumItemPrice,recommendedPrice,actualOrderAllocation};
