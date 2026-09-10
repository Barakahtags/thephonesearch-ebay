function html(res, title, message, status = 200) {
  res.status(status).setHeader('content-type', 'text/html; charset=utf-8');
  return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><body style="margin:0;background:#070b14;color:#f4f7fb;font:16px system-ui;padding:40px"><main style="max-width:620px;margin:auto;border:1px solid #34435b;border-radius:16px;padding:28px;background:#0d1422"><h1 style="margin-top:0">'+title+'</h1><p>'+message+'</p><p><a style="color:#f3c95f" href="/app.html">Return to ServicePack</a></p></main></body>');
}
function origin(req) {
  const host = String(req.headers.host || 'ie-verified-phones-ebay-hook.vercel.app');
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  return proto+'://'+host;
}
function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error('MobileSentrix connection is not configured yet: '+name);
  return value;
}
module.exports = async function(req, res) {
  const action = String(req.query.action || 'start');
  try {
    const consumerName = required('MOBILESENTRIX_CONSUMER_NAME');
    const consumerKey = required('MOBILESENTRIX_CONSUMER_KEY');
    const consumerSecret = required('MOBILESENTRIX_CONSUMER_SECRET');
    const base = String(process.env.MOBILESENTRIX_BASE_URL || 'https://www.mobilesentrix.eu').replace(/\/$/, '');
    const callback = String(process.env.MOBILESENTRIX_CALLBACK_URL || origin(req) + '/api/mobilesentrix-oauth?action=callback');
    if (action === 'start') {
      const url = new URL(base + '/oauth/authorize/identifier');
      url.searchParams.set('consumer', consumerName);
      url.searchParams.set('authtype', '1');
      url.searchParams.set('flowentry', 'SignIn');
      url.searchParams.set('consumer_key', consumerKey);
      url.searchParams.set('consumer_secret', consumerSecret);
      url.searchParams.set('callback', callback);
      res.statusCode = 302;
      res.setHeader('location', url.toString());
      return res.end();
    }
    if (action !== 'callback') return html(res, 'MobileSentrix', 'Unsupported connection action.', 400);
    const oauthToken = String(req.query.oauth_token || '').trim();
    const oauthVerifier = String(req.query.oauth_verifier || '').trim();
    if (!oauthToken || !oauthVerifier) return html(res, 'MobileSentrix connection', 'MobileSentrix did not return the approval details. Please start the connection again.', 400);
    const exchange = await fetch(base + '/oauth/authorize/identifiercallback', {
      method: 'POST',
      headers: {'content-type':'application/json',accept:'application/json'},
      body: JSON.stringify({consumer_key:consumerKey,consumer_secret:consumerSecret,oauth_token:oauthToken,oauth_verifier:oauthVerifier})
    });
    const data = await exchange.json().catch(() => ({}));
    const accessToken = String(data?.data?.access_token || '').trim();
    const accessTokenSecret = String(data?.data?.access_token_secret || '').trim();
    if (!exchange.ok || !accessToken || !accessTokenSecret) throw new Error('MobileSentrix did not return a usable access token.');
    const worker = String(process.env.CATALOGUE_WORKER_ORIGIN || 'https://thephonesearch-stock-sync.thephonesearchpk.workers.dev').replace(/\/$/, '');
    const adminToken = String(process.env.ADMIN_TOKEN || process.env.EBAY_VERIFICATION_TOKEN || '');
    if (!adminToken) throw new Error('ServicePack secure catalogue bridge is not configured.');
    const saved = await fetch(worker + '/mobilesentrix/credentials', {
      method:'POST',
      headers:{'content-type':'application/json','x-admin-token':adminToken},
      body:JSON.stringify({accessToken,accessTokenSecret})
    });
    if (!saved.ok) throw new Error('ServicePack could not save the MobileSentrix connection.');
    return html(res, 'MobileSentrix connected', 'Your MobileSentrix Europe account is connected. The supplier catalogue remains separate and nothing has been published to eBay.');
  } catch (error) {
    return html(res, 'MobileSentrix connection unavailable', 'The connection could not start safely. Check the secure MobileSentrix settings and try again.', 503);
  }
};
