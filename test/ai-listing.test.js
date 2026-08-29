const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {optimizeListing} = require('../api/_lib/ai-listing');
const {fixedProfitTarget} = require('../api/_lib/pricing');

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

test('treats refurbished displays as original refurbished without For or Für', async () => {
  const listing = await optimizeListing({PartNumber: 'IP13-REF', Manufacturer: 'Apple', Description: 'Refurbished OLED Display for iPhone 13'});
  assert.equal(listing.classification.qualityCode, 'refurbished');
  assert.match(listing.title, /^Original Apple iPhone 13/);
  assert.match(listing.title, /Refurbished/);
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
