const BANNED_BRANDS=Object.freeze(['promiz','all phones','minim','lifewire','impact']);
const QUALITY_RULES=Object.freeze(['NO_RESIN','NO_TRAINING_PRODUCTS','NO_LONG_DELIVERY','NO_BANNED_BRANDS','NO_COMPLETE_HANDSETS','IMAGE_REQUIRED']);

function clean(value){
  return String(value||'').replace(/\s+/g,' ').trim();
}

function imageUrls(part){
  return (part?.Images||[])
    .map(image=>clean(image?.ImageUrl))
    .filter(url=>/^https?:\/\//i.test(url));
}

function isCompleteHandset(part){
  const text=clean([part?.Description,part?.Manufacturer].join(' ')).toLowerCase();
  const handsetCondition=/\b(?:slightly|intensively|lightly)?\s*used\b|\bgrade\s*[abc]\b|\brefurbished phone\b/.test(text);
  const storage=/\b\d{1,4}\s?gb\b/.test(text);
  const part=/\b(display|screen|lcd|oled|touchscreen|back\s*(?:cover|glass)|battery\s*cover|housing|frame|battery|akku|camera|charging|connector|flex|speaker|microphone|sim\s*(?:tray|reader)|button|key|adhesive|protector|case|cover)\b/.test(text);
  return !part&&(handsetCondition||storage&&/\b(?:iphone|samsung|galaxy|xiaomi|redmi|poco|huawei|honor|google pixel|oneplus|oppo|nokia|sony|motorola|cat)\b/.test(text));
}

function exclusionReason(part){
  const searchable=[part?.Description,part?.Manufacturer,part?.StatusText].map(clean).join(' ');
  if(BANNED_BRANDS.some(brand=>new RegExp(`(^|[^a-z0-9])${brand.replace(/ /g,'\\s+')}(?=$|[^a-z0-9])`,'i').test(searchable)))return 'BANNED_BRAND';
  if(isCompleteHandset(part))return 'COMPLETE_HANDSET';
  if(/\bresin\b/i.test(searchable))return 'RESIN_PRODUCT';
  if(/\b(training|trainings|e[- ]?learning|course|courses|schulung|schulungen|kurs|kurse|opleiding)\b/i.test(searchable))return 'TRAINING_PRODUCT';
  if(/longer\s+delivery|long\s+delivery|langere\s+levertijd|längere\s+lieferzeit/i.test(searchable))return 'LONG_DELIVERY';
  if(!imageUrls(part).length)return 'MISSING_PRODUCT_IMAGE';
  return null;
}

function isSellableCatalogueItem(part){
  return !exclusionReason(part);
}

module.exports={BANNED_BRANDS,QUALITY_RULES,clean,imageUrls,isCompleteHandset,exclusionReason,isSellableCatalogueItem};
