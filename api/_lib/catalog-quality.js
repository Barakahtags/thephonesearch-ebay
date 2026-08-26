const QUALITY_RULES=Object.freeze(['NO_RESIN','IMAGE_REQUIRED']);

function clean(value){
  return String(value||'').replace(/\s+/g,' ').trim();
}

function imageUrls(part){
  return (part?.Images||[])
    .map(image=>clean(image?.ImageUrl))
    .filter(url=>/^https?:\/\//i.test(url));
}

function exclusionReason(part){
  const searchable=[part?.Description,part?.Manufacturer,part?.StatusText].map(clean).join(' ');
  if(/\bresin\b/i.test(searchable))return 'RESIN_PRODUCT';
  if(!imageUrls(part).length)return 'MISSING_PRODUCT_IMAGE';
  return null;
}

function isSellableCatalogueItem(part){
  return !exclusionReason(part);
}

module.exports={QUALITY_RULES,clean,imageUrls,exclusionReason,isSellableCatalogueItem};
