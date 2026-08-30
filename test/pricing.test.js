const test=require('node:test');
const assert=require('node:assert/strict');
const pricing=require('../api/_lib/pricing');

test('fixed after-tax profit tiers match the seller rules',()=>{
  assert.equal(pricing.fixedProfitTarget(9.99),5);
  assert.equal(pricing.fixedProfitTarget(10),10);
  assert.equal(pricing.fixedProfitTarget(49.99),10);
  assert.equal(pricing.fixedProfitTarget(50),15);
  assert.equal(pricing.fixedProfitTarget(99.99),15);
  assert.equal(pricing.fixedProfitTarget(100),20);
});

test('custom target is used for the final price and survives in the breakdown',()=>{
  const result=pricing.itemPriceForProfit(19.15,23.45);
  assert.equal(result.targetProfit,23.45);
  assert.ok(result.afterTaxProfit>=23.45);
  assert.equal(result.profitPass,true);
  assert.equal(result.customerShipping,4.99);
  assert.equal(result.supplierShipping,8.4);
});

test('full item calculation exposes VAT, eBay fees, reserve, costs and margin',()=>{
  const result=pricing.itemPriceForProfit(36,15);
  for(const key of ['salesVat','ebayProductFee','ebayProductFeeVat','ebayFixedFee','ebayFixedFeeVat','ebayShippingFee','ebayShippingFeeVat','totalEbayCharges','preTaxProfit','profitTaxReserve','totalCosts','afterTaxProfit','netMargin']){
    assert.equal(Number.isFinite(result[key]),true,key);
  }
  assert.equal(result.assumptions.salesVatRate,.19);
  assert.equal(result.assumptions.feeVatRate,.19);
  assert.equal(result.assumptions.profitTaxReserveRate,.19);
});
