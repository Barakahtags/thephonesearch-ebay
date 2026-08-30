const QUALITY_RULES=Object.freeze(['NO_RESIN','NO_BLOCKED_COMPANIES','NO_COMPLETE_PHONES','NO_TRAINING_PRODUCTS','NO_LONG_DELIVERY','RIGHTS_APPROVED_IMAGE_REQUIRED_FOR_LISTING']);

function clean(value){
  return String(value||'').replace(/\s+/g,' ').trim();
}

function imageUrls(part){
  const values=[
    ...(Array.isArray(part?.Images)?part.Images.map(image=>image?.ImageUrl||image?.Url):[]),
    ...(Array.isArray(part?.images)?part.images:[]),
    ...(Array.isArray(part?.imageUrls)?part.imageUrls:[])
  ];
  return values
    .map(image=>clean(image))
    .filter(url=>/^https?:\/\//i.test(url));
}

function identityValue(value){
  if(value&&typeof value==='object')value=value.PartNumber||value.ArticleNumber||value.Value||value.Number||value.Id||'';
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g,'');
}

function imageIdentityKeys(part){
  const keys=[];
  const add=(prefix,value)=>{const normalized=identityValue(value);if(normalized)keys.push(`${prefix}:${normalized}`)};
  add('sku',part?.PartNumber||part?.sku||part?.id);
  add('ean',part?.EanNumber||part?.ean);
  for(const value of [...(part?.SecondaryArticleNumbers||part?.secondaryArticleNumbers||[]),...(part?.ReplacementArticleNumbers||part?.replacementArticleNumbers||[])])add('xref',value);
  return [...new Set(keys)];
}

function isCompletePhone(part){
  const description=clean(part?.Description);
  const definitePhone=/\b(smartphone|mobile phone|feature phone|refurbished phone|used phone|complete phone|handset)\b/i.test(description);
  const definitePart=/\b(display|screen|lcd|oled|battery|akku|back\s*cover|rear\s*cover|housing|frame|flex|camera|speaker|microphone|charging|connector|sim\s*tray|button|glass|lens|case|cable|adhesive|tape|protector|spare\s*part|ersatzteil)\b/i.test(description);
  return definitePhone&&!definitePart;
}

function catalogueExclusionReason(part){
  const searchable=[part?.Description,part?.Manufacturer,part?.StatusText].map(clean).join(' ');
  if(/\bresin\b/i.test(searchable))return 'RESIN_PRODUCT';
  if(/\b(promiz|minim|lifewire|impact)\b/i.test(searchable))return 'BLOCKED_COMPANY';
  if(isCompletePhone(part))return 'COMPLETE_PHONE';
  if(/\b(training|trainings|e[- ]?learning|course|courses|schulung|schulungen|kurs|kurse|opleiding)\b/i.test(searchable))return 'TRAINING_PRODUCT';
  if(/longer\s+delivery|long\s+delivery|langere\s+levertijd|längere\s+lieferzeit/i.test(searchable))return 'LONG_DELIVERY';
  return null;
}

function exclusionReason(part){
  const catalogueReason=catalogueExclusionReason(part);
  if(catalogueReason)return catalogueReason;
  if(!imageUrls(part).length)return 'MISSING_PRODUCT_IMAGE';
  return null;
}

function isSellableCatalogueItem(part){
  return !exclusionReason(part);
}

module.exports={QUALITY_RULES,clean,imageUrls,imageIdentityKeys,catalogueExclusionReason,exclusionReason,isSellableCatalogueItem};
