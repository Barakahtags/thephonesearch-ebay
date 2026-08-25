module.exports = async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query || {};
  if (error) return res.status(400).send(`eBay authorization declined: ${errorDescription || error}`);
  if (!code) return res.status(400).send('No OAuth authorization code returned by eBay.');

  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf('=');
    return [v.slice(0, i), decodeURIComponent(v.slice(i + 1))];
  }));
  if (!state || !cookies.ebay_oauth_state || state !== cookies.ebay_oauth_state) {
    return res.status(400).send('OAuth state validation failed. Start again from /api/ebay-oauth-start.');
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const ruName = process.env.EBAY_RUNAME;
  if (!clientId || !clientSecret || !ruName) return res.status(500).send('Missing eBay OAuth environment variables.');

  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: ruName });
  const tokenResponse = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
    },
    body
  });

  const data = await tokenResponse.json();
  if (!tokenResponse.ok) return res.status(tokenResponse.status).json(data);

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', 'ebay_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');

  const refresh = String(data.refresh_token || '');
  const escaped = refresh.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return res.status(200).send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>eBay connected</title></head><body style="font-family:Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 20px"><h1>eBay authorization successful</h1><p>The seller account is connected.</p><p><strong>Refresh token:</strong></p><textarea readonly style="width:100%;height:130px">${escaped}</textarea><p>Store this value as <code>EBAY_REFRESH_TOKEN</code> in Vercel Production. The access token is intentionally not displayed.</p></body></html>`);
};
