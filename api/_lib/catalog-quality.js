const BANNED_BRANDS=Object.freeze(['promiz','all phones','minim','lifewire','impact','mobile skin','dust plug']);
const QUALITY_RULES=Object.freeze(['NO_RESIN','NO_TRAINING_PRODUCTS','NO_LONG_DELIVERY','NO_BANNED_BRANDS','NO_COMPLETE_HANDSETS','IMAGE_REQUIRED']);

function clean(value){
  return String(value||'').replace(/\s+/g,' ').trim();
}

function imageUrls(part){
  const urls=new Set();
  const add=value=>{const url=clean(value);if(/^https?:\/\//i.test(url))urls.add(url)};
  const visit=(value,depth=0)=>{
    if(depth>5||value==null)return;
    if(typeof value==='string'){add(value);return}
    if(Array.isArray(value)){value.forEach(item=>visit(item,depth+1));return}
    if(typeof value!=='object')return;
    for(const key of ['ImageUrl','imageUrl','Url','url','URL','OriginalUrl','OriginalURL','LargeImageUrl','LargeUrl','SourceUrl','src'])add(value[key]);
    for(const key of ['Image','image','Images','images','Items','items','Item','item','Results','results','Value','value'])if(value[key]!==undefined)visit(value[key],depth+1);
  };
  visit(part?.Images);
  visit(part?.Image);
  visit(part?.ImageUrl);
  visit(part?.ImageUrls);
  visit(part?.ImagesUrl);
  visit(part?.MainImage);
  visit(part?.MainImageUrl);
  visit(part?.Picture);
  visit(part?.Pictures);
  return [...urls];
}

function isCompleteHandset(part){
  const text=clean([part?.Description,part?.Manufacturer].join(' ')).toLowerCase();
  const handsetCondition=/\b(?:slightly|intensively|lightly)?\s*used\b|\bgrade\s*[abc]\b|\brefurbished phone\b/.test(text);
  const storage=/\b\d{1,4}\s?gb\b/.test(text);
  const partKeyword=/\b(display|screen|lcd|oled|touchscreen|back\s*(?:cover|glass)|battery\s*cover|housing|frame|battery|akku|camera|charging|connector|flex|speaker|microphone|sim\s*(?:tray|reader)|button|key|adhesive|protector|case|cover)\b/.test(text);
  return !partKeyword&&(handsetCondition||storage&&/\b(?:iphone|samsung|galaxy|xiaomi|redmi|poco|huawei|honor|google pixel|oneplus|oppo|nokia|sony|motorola|cat)\b/.test(text));
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
