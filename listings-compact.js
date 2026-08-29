LISTING_PAGE_SIZE=100;

function listingProfit(p){
  const saved=Number(p.pricing?.netProfit);
  if(Number.isFinite(saved))return saved;
  const price=Number(p.calculatedPrice),cost=Number(p.costExVat);
  if(!Number.isFinite(price)||!Number.isFinite(cost))return null;
  const customerShipping=4.99,totalRevenue=price+customerShipping;
  const salesVat=totalRevenue*.19/1.19;
  const ebayCharges=(price*.15*1.19)+(customerShipping*.15*1.19)+(.35*1.19);
  const preTaxProfit=totalRevenue-cost-8.40-salesVat-ebayCharges;
  return Math.round((preTaxProfit-Math.max(0,preTaxProfit)*.19)*100)/100;
}

function pricingMessage(p,pricingReady){
  if(pricingReady){const market=p.competitorPricing||{};return Number.isFinite(Number(market.marketLowest))?`Cheapest reliable eBay total ${money(market.marketLowest)} · our buyer total ${money(p.buyerTotal)} (${money(market.undercutAmount||.5)} lower)`:'Competitive eBay price verified';}
  if(p.listingStatus==='NOT_PROFITABLE')return 'The €0.50 undercut price falls below the protected profit floor';
  if(p.listingStatus==='INSUFFICIENT_MARKET_DATA')return 'Fewer than 2 reliable eBay matches · blocked and retried daily';
  if(p.listingStatus==='MARKET_CHECK_ERROR')return 'eBay market check failed · blocked and retried daily';
  return 'Automatic eBay market check is queued';
}

function costChart(p,pricingReady){
  const f=p.pricing||{};
  if(!pricingReady)return `<div class="compactCostChart"><span>Safe minimum</span><b>${money(f.minimumItemPrice)}</b><span>Reliable matches</span><b>${esc(p.competitorPricing?.usableCount??0)}</b></div>`;
  return `<div class="compactCostChart">
    <span>MobileParts item</span><b>${money(f.supplierCost)}</b>
    <span>MobileParts delivery</span><b>${money(f.supplierShipping)}</b>
    <span>German sales VAT</span><b>${money(f.salesVat)}</b>
    <span>eBay fees incl. fee VAT</span><b>${money(f.totalEbayCharges)}</b>
    <span>19% profit-tax reserve</span><b>${money(f.profitTaxReserve)}</b>
    <span>Net profit</span><b class="${Number(f.netProfit)>=0?'good':'bad'}">${money(f.netProfit)}</b>
  </div>`;
}

listingCard=function(p,i){
  const r=stateFor(p),len=r.title.length,checked=SELECTED.has(p.sku)?' checked':'',pricingReady=p.pricing?.pricingVersion==='ebay-lowest-undercut-v3'&&p.listingStatus==='GOOD_TO_LIST'&&Number.isFinite(Number(p.calculatedPrice)),notProfitable=p.listingStatus==='NOT_PROFITABLE',blocked=['INSUFFICIENT_MARKET_DATA','MARKET_CHECK_ERROR'].includes(p.listingStatus),profit=pricingReady?listingProfit(p):null;
  return `<article id="card-${i}" class="compactListing">
    <div class="compactRow">
      <input aria-label="Select ${esc(p.sku)}" type="checkbox" onchange="toggleListing('${esc(p.sku)}',this.checked)"${checked}>
      ${p.images?.[0]?`<img class="compactThumb" src="${esc(p.images[0])}" referrerpolicy="no-referrer">`:'<div class="compactThumb"></div>'}
      <div class="compactSupplier"><div class="compactSku">${esc(p.sku)} · ${esc(p.manufacturer||'')}</div><b>${esc(p.supplierTitle||p.title||p.sku)}</b></div>
      <div class="compactPrice"><span class="label">Final eBay item price</span><b class="${blocked||notProfitable?'bad':''}">${pricingReady?money(p.calculatedPrice):notProfitable?'Do not list':blocked?'Price blocked':'Repricing…'}</b><small class="muted">Customer shipping ${money(p.pricing?.customerShipping??4.99)}${pricingReady?` · <strong class="${profit>=0?'good':'bad'}">Profit ${money(profit)}</strong>`:''}</small><small class="muted">${esc(pricingMessage(p,pricingReady))}</small>${costChart(p,pricingReady)}</div>
      <div class="compactStock"><span class="label">Stock</span><b>${esc(p.stock??0)}</b></div>
      <div class="compactTitleCell"><div class="label">eBay title <span id="count-${i}" class="${len>80?'bad':'good'}">${len}/80</span></div><input id="title-${i}" class="compactTitleInput" maxlength="80" value="${esc(r.title)}" oninput="editTitle('${esc(p.sku)}',${i},this.value)"></div>
      <div class="compactActions"><button class="btn secondary" onclick="toggleCompactEdit(${i})">Description</button></div>
    </div>
    <div id="compact-edit-${i}" class="compactEdit"><div class="label">Automatic eBay description — editable</div><textarea id="desc-${i}" placeholder="The automatic AI description will appear here" oninput="editDesc('${esc(p.sku)}',${i},this.value)">${esc(r.description)}</textarea></div>
  </article>`;
};

function toggleCompactEdit(i){document.getElementById('compact-edit-'+i)?.classList.toggle('open')}
