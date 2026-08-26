LISTING_PAGE_SIZE=100;

listingCard=function(p,i){
  const r=stateFor(p),len=r.title.length,checked=SELECTED.has(p.sku)?' checked':'';
  return `<article id="card-${i}" class="compactListing">
    <div class="compactRow">
      <input aria-label="Select ${esc(p.sku)}" type="checkbox" onchange="toggleListing('${esc(p.sku)}',this.checked)"${checked}>
      ${p.images?.[0]?`<img class="compactThumb" src="${esc(p.images[0])}" referrerpolicy="no-referrer">`:'<div class="compactThumb"></div>'}
      <div class="compactSupplier"><div class="compactSku">${esc(p.sku)} · ${esc(p.manufacturer||'')}</div><b>${esc(p.supplierTitle||p.title||p.sku)}</b></div>
      <div class="compactPrice"><span class="label">eBay price</span><b>${money(p.calculatedPrice)}</b><small class="muted">Cost ${money(p.costExVat)}</small></div>
      <div class="compactStock"><span class="label">Stock</span><b>${esc(p.stock??0)}</b></div>
      <div class="compactTitleCell"><div class="label">eBay title <span id="count-${i}" class="${len>80?'bad':'good'}">${len}/80</span></div><input id="title-${i}" class="compactTitleInput" maxlength="80" value="${esc(r.title)}" oninput="editTitle('${esc(p.sku)}',${i},this.value)"></div>
      <div class="compactActions"><button class="btn secondary" onclick="toggleCompactEdit(${i})">Description</button></div>
    </div>
    <div id="compact-edit-${i}" class="compactEdit"><div class="label">eBay description — edited separately</div><textarea id="desc-${i}" placeholder="Select this row and use AI Description Editor, or type here" oninput="editDesc('${esc(p.sku)}',${i},this.value)">${esc(r.description)}</textarea></div>
  </article>`;
};

function toggleCompactEdit(i){document.getElementById('compact-edit-'+i)?.classList.toggle('open')}
