LISTING_PAGE_SIZE=100;

function listingProfit(p){
  const saved=Number(p.pricing?.netProfit);
  if(Number.isFinite(saved))return saved;
  const price=Number(p.calculatedPrice),cost=Number(p.costExVat);
  if(!Number.isFinite(price)||!Number.isFinite(cost))return null;
  const customerShipping=4.20,totalRevenue=price+customerShipping;
  const salesVat=totalRevenue*.19/1.19;
  const ebayCharges=(price*.15*1.19)+(customerShipping*.15*1.19)+.35;
  const preTaxProfit=totalRevenue-cost-8.40-salesVat-ebayCharges;
  return Math.round((preTaxProfit-Math.max(0,preTaxProfit)*.19)*100)/100;
}

listingCard=function(p,i){
  const r=stateFor(p),len=r.title.length,checked=SELECTED.has(p.sku)?' checked':'',pricingReady=p.pricing?.pricingVersion==='fixed-profit-strong-v1'&&p.listingStatus==='GOOD_TO_LIST'&&Number.isFinite(Number(p.calculatedPrice)),notProfitable=p.listingStatus==='NOT_PROFITABLE',profit=pricingReady?listingProfit(p):null;
  return `<article id="card-${i}" class="compactListing">
    <div class="compactRow">
      <input aria-label="Select ${esc(p.sku)}" type="checkbox" onchange="toggleListing('${esc(p.sku)}',this.checked)"${checked}>
      ${p.images?.[0]?`<img class="compactThumb" src="${esc(p.images[0])}" referrerpolicy="no-referrer">`:'<div class="compactThumb"></div>'}
      <div class="compactSupplier"><div class="compactSku">${esc(p.sku)} · ${esc(p.manufacturer||'')}</div><b>${esc(p.supplierTitle||p.title||p.sku)}</b></div>
      <div class="compactPrice"><span class="label">eBay price</span><b>${pricingReady?money(p.calculatedPrice):notProfitable?'Do not list':'Pricing pending'}</b><small class="muted">Cost ${money(p.costExVat)}${pricingReady?` · <strong class="${profit>=0?'good':'bad'}">Profit ${money(profit)}</strong>`:''}</small><small class="muted">${pricingReady?`Fixed target ${money(p.pricing.targetProfit)} after tax`:notProfitable?'Market price cannot support the fixed profit target':'Waiting for reliable market matches'}</small></div>
      <div class="compactStock"><span class="label">Stock</span><b>${esc(p.stock??0)}</b></div>
      <div class="compactTitleCell"><div class="label">eBay title <span id="count-${i}" class="${len>80?'bad':'good'}">${len}/80</span></div><input id="title-${i}" class="compactTitleInput" maxlength="80" value="${esc(r.title)}" oninput="editTitle('${esc(p.sku)}',${i},this.value)"></div>
      <div class="compactActions"><button class="btn secondary" onclick="toggleCompactEdit(${i})">Description</button></div>
    </div>
    <div id="compact-edit-${i}" class="compactEdit"><div class="label">Automatic eBay description — editable</div><textarea id="desc-${i}" placeholder="The automatic AI description will appear here" oninput="editDesc('${esc(p.sku)}',${i},this.value)">${esc(r.description)}</textarea></div>
  </article>`;
};

function toggleCompactEdit(i){document.getElementById('compact-edit-'+i)?.classList.toggle('open')}
