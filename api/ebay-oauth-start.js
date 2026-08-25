const crypto = require('crypto');

module.exports = async (req, res) => {
  const clientId = process.env.EBAY_CLIENT_ID;
  const ruName = process.env.EBAY_RUNAME;
  if (!clientId || !ruName) return res.status(500).send('Missing EBAY_CLIENT_ID or EBAY_RUNAME');

  const state = crypto.randomBytes(24).toString('hex');
  const scopes = [
    'https://api.ebay.com/oauth/api_scope',
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.account',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment'
  ].join(' ');

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: ruName,
    scope: scopes,
    state
  });

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', `ebay_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  return res.redirect(`https://auth.ebay.com/oauth2/authorize?${params.toString()}`);
};
