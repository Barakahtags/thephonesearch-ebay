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
  if(pricingReady){const market=p.competitorPricing||{};if(p.pricing?.customProfitTarget)return `Custom after-tax profit target ${money(p.pricing.targetProfit)}`;if(p.pricing?.fallback||p.listingStatus==='FALLBACK_FIXED_PROFIT')return 'Protected fixed-profit price used · eBay market is rechecked daily';return Number.isFinite(Number(market.marketLowest))?`Cheapest reliable eBay total ${money(market.marketLowest)} · our buyer total ${money(p.buyerTotal)} (${money(market.undercutAmount||.5)} lower)`:'Protected final price calculated';}
  if(p.listingStatus==='NOT_PROFITABLE')return 'Old blocked price queued for fixed-profit repair';
  if(p.listingStatus==='INSUFFICIENT_MARKET_DATA')return 'Fixed-profit fallback is being saved · eBay market rechecked daily';
  if(p.listingStatus==='MARKET_CHECK_ERROR')return 'Fixed-profit fallback is being saved · eBay market rechecked daily';
  return 'Automatic price calculation is queued';
}

function costChart(p,pricingReady){
  const f=p.pricing||{},sku=encodeURIComponent(String(p.sku||'')),target=Number.isFinite(Number(f.targetProfit))?Number(f.targetProfit):defaultProfitTarget(p.costExVat),amount=v=>pricingMoney(v);
  if(!pricingReady)return `<div class="compactCostChart"><span>Fixed-profit price</span><b>${amount(f.minimumItemPrice)}</b><span>Reliable matches</span><b>${esc(p.competitorPricing?.usableCount??0)}</b><div class="compactProfitEditor"><label>After-tax profit target (€)<input id="profit-target-${sku}" type="number" min="0" max="10000" step="0.01" value="${target.toFixed(2)}" onkeydown="if(event.key==='Enter')saveItemProfitTarget('${sku}')"></label><button id="profit-save-${sku}" class="btn approve" onclick="saveItemProfitTarget('${sku}')">Recalculate &amp; save</button></div></div>`;
  return `<div class="compactCostChart">
    <span>Final eBay item price</span><b>${amount(f.itemPrice??p.calculatedPrice)}</b>
    <span>Customer pays (+ €4.99 postage)</span><b>${amount(f.totalRevenue??p.buyerTotal)}</b>
    <span>Supplier item cost</span><b>${amount(f.supplierCost??p.costExVat)}</b>
    <span>Supplier postage</span><b>${amount(f.supplierShipping)}</b>
    <span>19% sales MwSt</span><b>${amount(f.salesVat)}</b>
    <span>eBay item fee</span><b>${amount(f.ebayProductFee)}</b>
    <span>19% MwSt on eBay item fee</span><b>${amount(f.ebayProductFeeVat)}</b>
    <span>eBay fixed fee</span><b>${amount(f.ebayFixedFee)}</b>
    <span>19% MwSt on eBay fixed fee</span><b>${amount(f.ebayFixedFeeVat)}</b>
    <span>eBay postage fee</span><b>${amount(f.ebayShippingFee)}</b>
    <span>19% MwSt on eBay postage fee</span><b>${amount(f.ebayShippingFeeVat)}</b>
    <span>Total paid to eBay</span><b>${amount(f.totalEbayCharges)}</b>
    <span>Profit before 19% reserve</span><b>${amount(f.preTaxProfit)}</b>
    <span>19% profit-tax reserve</span><b>${amount(f.profitTaxReserve)}</b>
    <span class="totalLine">Total costs</span><b class="totalLine">${amount(f.totalCosts)}</b>
    <span>Final after-tax profit</span><b class="${Number(f.afterTaxProfit??f.netProfit)>=0?'good':'bad'}">${amount(f.afterTaxProfit??f.netProfit)}</b>
    <span>After-tax profit margin</span><b class="good">${Number.isFinite(Number(f.netMargin))?Number(f.netMargin).toFixed(2)+'%':'—'}</b>
    <div class="compactProfitEditor"><label>After-tax profit target (€)<input id="profit-target-${sku}" type="number" min="0" max="10000" step="0.01" value="${target.toFixed(2)}" onkeydown="if(event.key==='Enter')saveItemProfitTarget('${sku}')"></label><button id="profit-save-${sku}" class="btn approve" onclick="saveItemProfitTarget('${sku}')">Recalculate &amp; save</button></div>
  </div>`;
}

listingCard=function(p,i){
  const r=stateFor(p),len=r.title.length,checked=SELECTED.has(p.sku)?' checked':'',pricingReady=p.pricing?.pricingVersion==='ebay-lowest-undercut-v5'&&Number.isFinite(Number(p.calculatedPrice))&&!p.pricing?.blocked,profit=pricingReady?listingProfit(p):null,urls=verifiedImageCandidates(p),image=urls.length?`<img class="compactThumb" src="${esc(urls[0])}" data-index="0" data-images="${esc(encodeURIComponent(JSON.stringify(urls)))}" onerror="nextVerifiedImage(this)" referrerpolicy="no-referrer">`:'<div class="compactThumb" style="display:grid;place-items:center;color:#6b7280;font-size:9px;text-align:center;padding:4px">Image recovery pending</div>',imageState=p.imageRecovery?.status==='EXACT_IDENTIFIER_RECOVERY'?'Exact identifier image recovered':p.imageRecovery?.status==='SUPPLIER_IMAGE'?'Supplier image':p.imageRecovery?.status==='MANUAL_REVIEW_REQUIRED'?'Manual image review required':'Image check pending';
  return `<article id="card-${i}" class="compactListing">
    <div class="compactRow">
      <input aria-label="Select ${esc(p.sku)}" type="checkbox" onchange="toggleListing('${esc(p.sku)}',this.checked)"${checked}>
      ${image}
      <div class="compactSupplier"><div class="compactSku">${esc(p.sku)} · ${esc(p.manufacturer||'')}</div><b>${esc(p.supplierTitle||p.title||p.sku)}</b><small class="muted">${esc(imageState)}${p.imageRecovery?.requiresWhiteBackground?' · white-background review pending':''}</small></div>
      <div class="compactPrice"><span class="label">Final eBay item price</span><b class="${pricingReady?'good':'warn'}">${pricingReady?money(p.calculatedPrice):'Fixed-profit repricing…'}</b><small class="muted">Customer shipping ${money(p.pricing?.customerShipping??4.99)}${pricingReady?` · <strong class="${profit>=0?'good':'bad'}">Profit ${money(profit)}</strong>`:''}</small><small class="muted">${esc(pricingMessage(p,pricingReady))}</small>${costChart(p,pricingReady)}</div>
      <div class="compactStock"><span class="label">Stock</span><b>${esc(p.stock??0)}</b></div>
      <div class="compactTitleCell"><div class="label">eBay title <span id="count-${i}" class="${len>80?'bad':'good'}">${len}/80</span></div><input id="title-${i}" class="compactTitleInput" maxlength="80" value="${esc(r.title)}" oninput="editTitle('${esc(p.sku)}',${i},this.value)"></div>
      <div class="compactActions"><button class="btn secondary" onclick="toggleCompactEdit(${i})">Description</button></div>
    </div>
    <div id="compact-edit-${i}" class="compactEdit"><div class="label">Automatic eBay description — editable</div><textarea id="desc-${i}" placeholder="The automatic AI description will appear here" oninput="editDesc('${esc(p.sku)}',${i},this.value)">${esc(r.description)}</textarea></div>
  </article>`;
};

function toggleCompactEdit(i){document.getElementById('compact-edit-'+i)?.classList.toggle('open')}
