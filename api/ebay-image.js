const sharp = require('sharp');

function sourceUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:') throw new Error('Only HTTPS supplier image URLs are accepted');
  const host = url.hostname.toLowerCase();
  const extras = String(process.env.MPS_IMAGE_ALLOWED_HOSTS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  const allowed = host === 'mobileparts.shop' || host.endsWith('.mobileparts.shop') ||
    host === '2service.nl' || host.endsWith('.2service.nl') || extras.includes(host);
  if (!allowed) throw new Error('Image host is not an approved MobileParts supplier host');
  return url.toString();
}

module.exports = async function imageForEbay(req, res) {
  try {
    const source = sourceUrl(req.query?.src);
    const upstream = await fetch(source, {
      headers: {accept: 'image/avif,image/webp,image/*,*/*;q=0.8', 'user-agent': 'MobilePartsDE eBay image processor'}
    });
    if (!upstream.ok) throw new Error('Supplier image returned HTTP ' + upstream.status);
    const type = String(upstream.headers.get('content-type') || '');
    if (!type.startsWith('image/')) throw new Error('Supplier URL did not return an image');
    const input = Buffer.from(await upstream.arrayBuffer());
    if (!input.length || input.length > 20 * 1024 * 1024) throw new Error('Supplier image size is invalid');

    // trim removes the unused supplier canvas; the exact product pixels remain
    // untouched apart from colour-safe resampling and a light output sharpen.
    const output = await sharp(input, {limitInputPixels: 40_000_000, failOn: 'none'})
      .rotate()
      .trim({background: {r: 255, g: 255, b: 255, alpha: 1}, threshold: 10})
      .resize(1600, 1600, {fit: 'contain', background: {r: 255, g: 255, b: 255, alpha: 1}, withoutEnlargement: false})
      .sharpen({sigma: 1.1, m1: 0.8, m2: 1.4, x1: 2, y2: 10, y3: 20})
      .jpeg({quality: 92, chromaSubsampling: '4:4:4', progressive: true})
      .toBuffer();

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Image-Processing', 'trim-1600-square-sharpen');
    return res.status(200).send(output);
  } catch (error) {
    return res.status(400).json({ok: false, error: String(error?.message || error)});
  }
};
