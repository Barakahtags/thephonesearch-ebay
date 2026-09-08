// Browser-safe bridge to the protected Cloudflare catalogue worker.
// The worker secret never reaches app.html: Vercel adds it on the server.
const workerOrigin = () => String(process.env.CATALOGUE_WORKER_ORIGIN || 'https://thephonesearch-stock-sync.thephonesearchpk.workers.dev').replace(/\/$/, '');
const allowed = new Set(['/products', '/changes', '/reviews', '/sync', '/public-health']);

function clientOriginAllowed(req) {
  const origin = String(req.headers.origin || '');
  const host = String(req.headers.host || '');
  if (!origin) return req.method === 'GET';
  try { return new URL(origin).host === host; } catch { return false; }
}

module.exports = async function catalogueProxy(req, res) {
  if (!clientOriginAllowed(req)) return res.status(403).json({ok: false, error: 'Catalogue request origin is not allowed'});
  const path = String(req.query.path || '');
  if (!allowed.has(path)) return res.status(400).json({ok: false, error: 'Unsupported catalogue request'});
  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) return res.status(405).json({ok: false, error: 'GET or POST required'});
  const secret = process.env.ADMIN_TOKEN || process.env.EBAY_VERIFICATION_TOKEN;
  if (!secret) return res.status(503).json({ok: false, error: 'Catalogue bridge is not configured'});
  try {
    const target = new URL(workerOrigin() + path);
    for (const [key, value] of Object.entries(req.query || {})) if (key !== 'path' && value != null) target.searchParams.set(key, String(value));
    const options = {method, headers: {'x-admin-token': secret, accept: 'application/json'}};
    if (method === 'POST') {
      options.headers['content-type'] = 'application/json';
      options.body = JSON.stringify(req.body || {});
    }
    const upstream = await fetch(target, options);
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    return res.send(body);
  } catch (error) {
    return res.status(502).json({ok: false, error: `Catalogue bridge unavailable: ${String(error?.message || error)}`});
  }
};
