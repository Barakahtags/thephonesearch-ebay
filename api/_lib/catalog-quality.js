const BANNED_BRANDS=Object.freeze(['promiz','all phones','minim','lifewire','impact']);
const QUALITY_RULES=Object.freeze(['NO_RESIN','NO_TRAINING_PRODUCTS','NO_LONG_DELIVERY','NO_BANNED_BRANDS','IMAGE_REQUIRED']);

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
  if(BANNED_BRANDS.some(brand=>new RegExp(`(^|[^a-z0-9])${brand.replace(/ /g,'\\s+')}(?=$|[^a-z0-9])`,'i').test(searchable)))return 'BANNED_BRAND';
  if(/\bresin\b/i.test(searchable))return 'RESIN_PRODUCT';
  if(/\b(training|trainings|e[- ]?learning|course|courses|schulung|schulungen|kurs|kurse|opleiding)\b/i.test(searchable))return 'TRAINING_PRODUCT';
  if(/longer\s+delivery|long\s+delivery|langere\s+levertijd|längere\s+lieferzeit/i.test(searchable))return 'LONG_DELIVERY';
  if(!imageUrls(part).length)return 'MISSING_PRODUCT_IMAGE';
  return null;
}

function isSellableCatalogueItem(part){
  return !exclusionReason(part);
}

module.exports={BANNED_BRANDS,QUALITY_RULES,clean,imageUrls,exclusionReason,isSellableCatalogueItem};
