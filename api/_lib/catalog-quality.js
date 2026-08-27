const QUALITY_RULES=Object.freeze(['NO_RESIN','NO_TRAINING_PRODUCTS','IMAGE_REQUIRED']);

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
  if(/\b(training|trainings|e[- ]?learning|course|courses|schulung|schulungen|kurs|kurse|opleiding)\b/i.test(searchable))return 'TRAINING_PRODUCT';
  if(!imageUrls(part).length)return 'MISSING_PRODUCT_IMAGE';
  return null;
}

function isSellableCatalogueItem(part){
  return !exclusionReason(part);
}

module.exports={QUALITY_RULES,clean,imageUrls,exclusionReason,isSellableCatalogueItem};
