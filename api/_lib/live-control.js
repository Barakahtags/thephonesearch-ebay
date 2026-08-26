const CAPABILITIES = Object.freeze({
  listingWrites: 'TPS_LIVE_LISTINGS',
  stockPriceSync: 'TPS_LIVE_STOCK_PRICE_SYNC',
  trackingWrites: 'TPS_LIVE_TRACKING',
  shippingPolicyWrites: 'TPS_LIVE_SHIPPING_POLICY',
  supplierOrderPreparation: 'TPS_SUPPLIER_ORDER_PREPARATION'
});

function enabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function snapshot() {
  const masterEnabled = enabled(process.env.TPS_LIVE_MASTER) &&
    String(process.env.SYNC_MODE || 'preview').toLowerCase() === 'live';
  const capabilities = {};

  for (const [name, envName] of Object.entries(CAPABILITIES)) {
    const independentlyEnabled = name === 'supplierOrderPreparation'
      ? process.env[envName] === undefined || enabled(process.env[envName])
      : enabled(process.env[envName]);
    capabilities[name] = {
      enabled: name === 'supplierOrderPreparation'
        ? independentlyEnabled
        : masterEnabled && independentlyEnabled,
      requested: independentlyEnabled,
      environmentKey: envName
    };
  }

  return {
    mode: masterEnabled ? 'LIVE' : 'SAFE',
    masterEnabled,
    durableRuntimeControl: false,
    persistence: 'environment-configuration',
    capabilities: {
      ...capabilities,
      supplierAutoPurchase: {
        enabled: false,
        requested: false,
        locked: true,
        reason: 'Durable idempotency and an approved payment design are required.'
      }
    }
  };
}

function assertCapability(name) {
  const state = snapshot();
  const capability = state.capabilities[name];
  if (!capability) throw Object.assign(new Error(`Unknown live capability: ${name}`), { status: 500 });
  if (!capability.enabled) {
    throw Object.assign(new Error(`${name} is locked by the centralized SAFE/LIVE policy. No external write was performed.`), {
      status: 403,
      liveControl: state
    });
  }
  return state;
}

module.exports = { CAPABILITIES, snapshot, assertCapability };
