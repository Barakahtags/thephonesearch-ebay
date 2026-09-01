const {guard}=require('./_lib/admin');
const ebay=require('./_lib/ebay');
const mps=require('./_lib/mps');
const pricing=require('./_lib/pricing');

const amount=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
const isoStart=value=>{const d=value?new Date(`${value}T00:00:00.000Z`):new Date(new Date().getUTCFullYear(),new Date().getUTCMonth(),1);return Number.isNaN(d.valueOf())?null:d.toISOString()};
const isoEnd=value=>{const d=value?new Date(`${value}T23:59:59.999Z`):new Date();return Number.isNaN(d.valueOf())?null:d.toISOString()};

function paymentStatusPaid(order){return String(order?.orderPaymentStatus||'').toUpperCase()==='PAID'}
function cancelled(order){return /CANCELLED|CANCELED/i.test(String(order?.orderFulfillmentStatus||''))}
function orderShipping(order){
  const p=order?.pricingSummary||{};
  return Number(p.deliveryCost?.value??p.shippingCost?.value??p.shippingAndHandling?.value??process.env.EBAY_CUSTOMER_SHIPPING_DE??4.99);
}
async function ordersForPeriod(from,to){
  const filter=encodeURIComponent(`creationdate:[${from}..${to}]`),orders=[];
  for(let offset=0;offset<5000;offset+=200){
    const page=await ebay.api(`/sell/fulfillment/v1/order?filter=${filter}&limit=200&offset=${offset}`);
    const batch=page?.orders||[];orders.push(...batch);
    if(!batch.length||batch.length<200||orders.length>=Number(page?.total||Infinity))break;
  }return orders;
}
async function buildLine(order,partCache){
  let supplierCost=0,supplierMissing=false;
  for(const item of order.lineItems||[]){
    const sku=String(item?.sku||'').trim(),qty=Math.max(1,Number(item?.quantity||1));
    if(!sku){supplierMissing=true;continue}
    if(!partCache.has(sku)){try{partCache.set(sku,await mps.part(sku));}catch{partCache.set(sku,null)}}
    const part=partCache.get(sku);if(!part){supplierMissing=true;continue}
    supplierCost+=Number(part.UnitPrice||0)*qty;
  }
  const saleGross=Number(order?.pricingSummary?.total?.value||0),customerShipping=orderShipping(order);
  const financials=pricing.breakdown(Math.max(0,saleGross-customerShipping),supplierCost,{customerShipping});
  return {orderId:order.orderId,creationDate:order.creationDate,paymentStatus:order.orderPaymentStatus,fulfillmentStatus:order.orderFulfillmentStatus,saleGross:amount(saleGross),supplierPurchaseCost:amount(supplierCost),supplierCostStatus:supplierMissing?'MISSING_SUPPLIER_COST':'MOBILEPARTS_CATALOGUE_COST',financials};
}
function sum(rows,key){return amount(rows.reduce((total,row)=>total+Number(row?.financials?.[key]??row?.[key]??0),0))}
module.exports=async function(req,res){
  if(!guard(req,res))return;
  const from=isoStart(req.query?.from),to=isoEnd(req.query?.to);
  if(!from||!to||from>to)return res.status(400).json({ok:false,error:'Use a valid report date range.'});
  try{
    const all=await ordersForPeriod(from,to),paid=all.filter(order=>paymentStatusPaid(order)&&!cancelled(order)),partCache=new Map(),rows=[];
    for(const order of paid)rows.push(await buildLine(order,partCache));
    const supplierCosts=rows.filter(row=>row.supplierCostStatus==='MOBILEPARTS_CATALOGUE_COST').length;
    const salesGross=sum(rows,'totalRevenue'),salesVat=sum(rows,'salesVat'),salesNet=sum(rows,'salesNetRevenue');
    const eBayFeesNet=sum(rows,'ebayFeesNet'),eBayFeeVat=sum(rows,'ebayFeeInputVat'),eBayFeesGross=sum(rows,'totalEbayCharges');
    const mobilepartsProducts=sum(rows,'supplierCost'),mobilepartsShipping=sum(rows,'supplierShipping');
    const acquisitionVat=sum(rows,'euAcquisitionVat'),vatPayableEstimate=sum(rows,'vatPayableEstimate'),profit=sum(rows,'netProfit');
    res.status(200).json({ok:true,period:{from,to},basis:'PAID_EBAY_ORDERS',generatedAt:new Date().toISOString(),summary:{orders:rows.length,salesGross,salesNet,salesVat,vatPayableEstimate,mobilepartsProducts,mobilepartsShipping,mobilepartsPaymentsEstimated:amount(mobilepartsProducts+mobilepartsShipping),euAcquisitionVatDeclared:acquisitionVat,euAcquisitionInputVat:acquisitionVat,eBayFeesNet,eBayFeeVatInputEstimate:eBayFeeVat,eBayFeesGross,tradingProfit:profit,supplierCostCoverage:{matched:supplierCosts,total:rows.length}},rows,notes:['Sales are live paid eBay orders in the selected period.','MobileParts goods and shipping use the configured MobileParts catalogue price and your €8.40 delivery charge for each separate customer order. Keep the supplier invoice as proof of the payment.','The intra-Community acquisition VAT and corresponding input VAT are displayed at equal amounts for a normal VAT-registered business; their net cash effect is €0.','VAT payable is sales VAT minus configured deductible/reverse-charge-neutral eBay fee VAT. Your accountant must use actual eBay and supplier invoices for the VAT return.','Income tax is not included: it is based on your overall annual business profit, not a fixed 19% per order.']});
  }catch(error){res.status(error.status||500).json({ok:false,error:error.message,details:error.data||null});}
};