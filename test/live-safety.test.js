const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const liveControl = require('../api/_lib/live-control');

const ENV_KEYS = [
  'TPS_LIVE_MASTER',
  'SYNC_MODE',
  'TPS_LIVE_LISTINGS',
  'EBAY_PUBLISH',
  'TPS_LIVE_STOCK_PRICE_SYNC',
  'TPS_LIVE_TRACKING',
  'EBAY_AUTO_TRACKING',
  'TPS_LIVE_SHIPPING_POLICY',
  'TPS_SUPPLIER_ORDER_PREPARATION'
];

function withEnvironment(values, run) {
  const original = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  try {
    return run();
  } finally {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

test('SAFE mode locks every external write while leaving manual basket preparation available', () => {
  withEnvironment({}, () => {
    const state = liveControl.snapshot();
    assert.equal(state.mode, 'SAFE');
    assert.equal(state.capabilities.listingWrites.enabled, false);
    assert.equal(state.capabilities.stockPriceSync.enabled, false);
    assert.equal(state.capabilities.trackingWrites.enabled, false);
    assert.equal(state.capabilities.shippingPolicyWrites.enabled, false);
    assert.equal(state.capabilities.supplierOrderPreparation.enabled, true);
    assert.equal(state.capabilities.supplierAutoPurchase.enabled, false);
  });
});

test('listing writes require both the master capability and EBAY_PUBLISH', () => {
  withEnvironment({
    TPS_LIVE_MASTER: 'true',
    SYNC_MODE: 'live',
    TPS_LIVE_LISTINGS: 'true',
    EBAY_PUBLISH: 'false'
  }, () => {
    const state = liveControl.snapshot();
    assert.equal(state.capabilities.listingWrites.requested, true);
    assert.equal(state.capabilities.listingWrites.prerequisite.enabled, false);
    assert.equal(state.capabilities.listingWrites.enabled, false);
    assert.throws(() => liveControl.assertCapability('listingWrites'), /locked/);
  });

  withEnvironment({
    TPS_LIVE_MASTER: 'true',
    SYNC_MODE: 'live',
    TPS_LIVE_LISTINGS: 'true',
    EBAY_PUBLISH: 'true'
  }, () => {
    assert.equal(liveControl.snapshot().capabilities.listingWrites.enabled, true);
  });
});

test('tracking writes require both the master capability and EBAY_AUTO_TRACKING', () => {
  withEnvironment({
    TPS_LIVE_MASTER: 'true',
    SYNC_MODE: 'live',
    TPS_LIVE_TRACKING: 'true',
    EBAY_AUTO_TRACKING: 'false'
  }, () => {
    assert.equal(liveControl.snapshot().capabilities.trackingWrites.enabled, false);
  });

  withEnvironment({
    TPS_LIVE_MASTER: 'true',
    SYNC_MODE: 'live',
    TPS_LIVE_TRACKING: 'true',
    EBAY_AUTO_TRACKING: 'true'
  }, () => {
    assert.equal(liveControl.snapshot().capabilities.trackingWrites.enabled, true);
  });
});

test('sync routes do not publish an offer a second time after upsert', () => {
  const source = fs.readFileSync(path.join(__dirname, '../api/sync.js'), 'utf8');
  assert.doesNotMatch(source, /offer\/.+?\/publish/);
  assert.match(source, /SYNC_5_LIVE/);
});
