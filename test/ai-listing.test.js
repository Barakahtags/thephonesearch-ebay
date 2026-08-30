const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {optimizeListing} = require('../api/_lib/ai-listing');
const {fixedProfitTarget} = require('../api/_lib/pricing');
const {catalogueExclusionReason,exclusionReason,imageIdentityKeys,imageUrls} = require('../api/_lib/catalog-quality');

test('uses the configured fixed after-tax profit tiers', () => {
  assert.equal(fixedProfitTarget(9.99), 5);
  assert.equal(fixedProfitTarget(10), 10);
  assert.equal(fixedProfitTarget(49.99), 10);
  assert.equal(fixedProfitTarget(50), 15);
  assert.equal(fixedProfitTarget(99.99), 15);
  assert.equal(fixedProfitTarget(100), 20);
  assert.equal(fixedProfitTarget(500), 20);
});

test('uses Für only for explicitly compatible products', async () => {
  const compatible = await optimizeListing({PartNumber: 'IP13-B3', Manufacturer: 'Apple', Description: 'Compatible Soft OLED Display for iPhone 13'});
  const original = await optimizeListing({PartNumber: 'GH82-20793A', Manufacturer: 'Samsung', Description: 'Display (Original), Samsung Galaxy S20'});
  assert.match(compatible.title, /^Für /);
  assert.doesNotMatch(original.title, /^Für /);
  assert.match(original.title, /^Original /);
});

test('treats pulled parts as original and preserves the exact model', async () => {
  const listing = await optimizeListing({PartNumber: 'XT2429-A', Manufacturer: 'Motorola', Description: 'Rear cover Pulled A (Original) - Forest Blue, Motorola Edge 50 Fusion; XT2429'});
  assert.match(listing.title, /^Original Motorola Edge 50 Fusion/);
  assert.equal(listing.classification.qualityCode, 'pulled');
  assert.equal(listing.classification.model, 'Edge 50 Fusion');
});

test('supplier For wording cannot override Pulled original classification', async () => {
  const listing = await optimizeListing({PartNumber:'MACP13191001GRB',Manufacturer:'For iPhone/iPad',Description:'Display with Rear Cover (Pulled A+) - Space Gray, For MacBook Pro 13 (2019); A2159'});
  assert.equal(listing.classification.qualityCode, 'pulled');
  assert.match(listing.title, /^Original\b/);
  assert.doesNotMatch(listing.title, /^(?:For|Für)\b/i);
});

test('excludes blocked companies and complete phones but keeps phone parts', () => {
  const image=[{ImageUrl:'https://supplier.example/item.jpg'}];
  for(const Manufacturer of ['Promiz','Minim','LifeWire','Impact'])assert.equal(exclusionReason({Manufacturer,Description:'Accessory',Images:image}),'BLOCKED_COMPANY');
  assert.equal(exclusionReason({Manufacturer:'Samsung',Description:'Refurbished smartphone Galaxy S22',Images:image}),'COMPLETE_PHONE');
  assert.equal(exclusionReason({Manufacturer:'Samsung',Description:'Display for smartphone Galaxy S22',Images:image}),null);
});

test('missing-image parts enter recovery but remain blocked from listing', () => {
  const part={PartNumber:'GH96-11759A',Manufacturer:'Samsung',Description:'Display Original Samsung Galaxy Note 9',Images:[]};
  assert.equal(catalogueExclusionReason(part),null);
  assert.equal(exclusionReason(part),'MISSING_PRODUCT_IMAGE');
});

test('image recovery only creates exact normalized identifier keys', () => {
  const keys=imageIdentityKeys({PartNumber:'GH96-11759A',EanNumber:'8 801 234',SecondaryArticleNumbers:['GH96 11759A'],ReplacementArticleNumbers:[{PartNumber:'GH96-11759B'}]});
  assert.deepEqual(keys,['sku:GH9611759A','ean:8801234','xref:GH9611759A','xref:GH9611759B']);
  assert.deepEqual(imageUrls({images:['https://supplier.example/part.png','javascript:bad']}),['https://supplier.example/part.png']);
});

test('treats refurbished displays as original refurbished without For or Für', async () => {
  const listing = await optimizeListing({PartNumber: 'IP13-REF', Manufacturer: 'Apple', Description: 'Refurbished OLED Display for iPhone 13'});
  assert.equal(listing.classification.qualityCode, 'refurbished');
  assert.match(listing.title, /^Original Apple iPhone 13/);
  assert.match(listing.title, /\bRefurb\b/);
  assert.doesNotMatch(listing.title, /^(?:For|Für)\b/i);
  assert.match(listing.description, /Original Refurbished|Originaldisplay/);
});

test('removes all forbidden supplier and importer names', async () => {
  const listing = await optimizeListing({PartNumber: 'X-1', Manufacturer: '2Service', Description: 'MobileParts.shop Service2B Compatible battery for iPhone 12'});
  assert.doesNotMatch(`${listing.title} ${listing.description}`, /Mobile\s*Parts|MobileParts|2Service|Service2B/i);
});

test('adds responsive CSS, images and exact catalogue recommendations', async () => {
  const listing = await optimizeListing({
    PartNumber: 'XT2429-COVER', Manufacturer: 'Motorola', Description: 'Rear cover Pulled A (Original), Motorola Edge 50 Fusion',
    Images: [{ImageUrl: 'https://example.com/cover-front.jpg'}, {ImageUrl: 'https://example.com/cover-back.jpg'}],
    _recommendations: [{sku: 'XT2429-TAPE', title: 'Adhesive tape rear cover, Motorola Edge 50 Fusion', imageUrl: 'https://example.com/tape.jpg'}]
  });
  assert.match(listing.description, /@media\(max-width:640px\)/);
  assert.match(listing.description, /XT2429-TAPE/);
  assert.match(listing.description, /Passend für diese Reparatur/);
  assert.equal((listing.description.match(/<img /g) || []).length, 3);
});

test('keeps every generated eBay title within 80 characters', async () => {
  const listing = await optimizeListing({PartNumber: 'IP14PM-B3-FLEX', Manufacturer: 'Apple', Description: 'Compatible Soft OLED Display with sensor flex for iPhone 14 Pro Max, premium replacement screen'});
  assert.ok(listing.title.length <= 80);
});

test('standalone example has narrow-phone layout and no forbidden names', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'listing-template-example.html'), 'utf8');
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /@media\(max-width:760px\)/);
  assert.match(html, /@media\(max-width:390px\)/);
  assert.match(html, /max-width:100%;overflow-x:hidden/);
  assert.match(html, /\.related-grid\{grid-template-columns:1fr\}/);
  assert.doesNotMatch(html, /Mobile\s*Parts|MobileParts|2Service|Service2B/i);
});

test('dashboard has verified image fallback and page selection counts', () => {
  const html=fs.readFileSync(path.join(__dirname,'..','app.html'),'utf8');
  assert.match(html,/function verifiedImageCandidates/);
  assert.match(html,/Image recovery pending/);
  assert.match(html,/Select page \('/);
  assert.match(html,/Page selected \('/);
});

test('dashboard renders and saves the complete per-item profit calculation', () => {
  const html=fs.readFileSync(path.join(__dirname,'..','app.html'),'utf8');
  const compact=fs.readFileSync(path.join(__dirname,'..','listings-compact.js'),'utf8');
  for(const label of ['Supplier item cost','Supplier postage','19% sales MwSt','eBay item fee','19% MwSt on eBay item fee','eBay fixed fee','eBay postage fee','19% profit-tax reserve','Total costs','Final after-tax profit','After-tax profit margin'])assert.match(html,new RegExp(label));
  for(const label of ['Supplier item cost','Supplier postage','19% sales MwSt','eBay item fee','19% MwSt on eBay item fee','eBay fixed fee','eBay postage fee','19% profit-tax reserve','Total costs','Final after-tax profit','After-tax profit margin'])assert.match(compact,new RegExp(label));
  assert.match(html,/After-tax profit target \(€\)/);
  assert.match(compact,/fixed-after-tax-profit-v6/);
  assert.match(html,/mode:'profit'/);
  assert.match(html,/Recalculate &amp; save/);
  assert.doesNotMatch(html+compact,/DO NOT LIST|Do not list|Price blocked/);
});

test('pricing API always falls back to a final fixed-profit price', () => {
  const source=fs.readFileSync(path.join(__dirname,'..','api','sync-preview.js'),'utf8');
  assert.match(source,/CUSTOM_PROFIT_TARGET/);
  assert.match(source,/FIXED_PROFIT_FINAL/);
  assert.doesNotMatch(source,/pricing\.blockedPricing/);
});

test('publishing preserves the saved custom after-tax profit target', () => {
  const source=fs.readFileSync(path.join(__dirname,'..','api','sync.js'),'utf8');
  assert.match(source,/customProfitTarget===true/);
  assert.match(source,/pricing\.itemPriceForProfit\(p\.UnitPrice,customTarget\)/);
  assert.match(source,/CUSTOM_AFTER_TAX_PROFIT/);
});

test('Cloudflare queue uses indexed flags instead of repeated supplier JSON scans', () => {
  const source=fs.readFileSync(path.join(__dirname,'..','cloudflare','src','index.js'),'utf8');
  assert.match(source,/p\.is_sellable=1/);
  assert.match(source,/r\.needs_ai=1/);
  assert.doesNotMatch(source,/WHERE p\.stock>0 AND LOWER\(p\.supplier_payload\)/);
});

test('Cloudflare image recovery is rights-scoped and excludes unresolved images from AI listing work', () => {
  const worker=fs.readFileSync(path.join(__dirname,'..','cloudflare','src','index.js'),'utf8');
  const migration=fs.readFileSync(path.join(__dirname,'..','cloudflare','migrations','0011_rights_safe_image_recovery.sql'),'utf8');
  assert.match(worker,/EXACT_IDENTIFIER_RECOVERY/);
  assert.match(worker,/rights_basis: 'SUPPLIER_API'/);
  assert.match(worker,/p\.has_approved_image=1/);
  assert.match(worker,/requiresWhiteBackground !== true/);
  assert.match(worker,/No rights-approved exact SKU, EAN or cross-reference image match/);
  for(const brand of ['promiz','minim','lifewire','impact'])assert.match(migration,new RegExp(brand));
  assert.match(migration,/DELETE FROM listing_reviews WHERE sku IN/);
  assert.match(migration,/DELETE FROM stock_sync_queue WHERE sku IN/);
});

test('publishing rejects missing images and accepts only approved recovered image overrides', () => {
  const ebay=fs.readFileSync(path.join(__dirname,'..','api','_lib','ebay.js'),'utf8');
  const sync=fs.readFileSync(path.join(__dirname,'..','api','sync.js'),'utf8');
  assert.match(ebay,/rights-approved exact-product image is required/);
  assert.match(sync,/EXACT_IDENTIFIER_RECOVERY/);
  assert.match(sync,/chosen\?\.imageReady===true/);
});
