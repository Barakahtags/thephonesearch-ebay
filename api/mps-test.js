const { authenticate, allParts } = require('./_lib/mps');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    await authenticate();
    const result = await allParts(1, 1);

    let sampleCount = 0;
    if (Array.isArray(result)) sampleCount = result.length;
    else if (Array.isArray(result?.Items)) sampleCount = result.Items.length;
    else if (Array.isArray(result?.Item)) sampleCount = result.Item.length;
    else if (Array.isArray(result?.Parts)) sampleCount = result.Parts.length;

    return res.status(200).json({
      ok: true,
      message: 'MobileParts.shop / 2Service connection is working.',
      catalogRequest: 'successful',
      sampleCount
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'MobileParts.shop / 2Service connection failed.',
      error: error.message
    });
  }
};
