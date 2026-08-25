const { authenticate, allParts } = require('./_lib/mps');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    await authenticate();
    const result = await allParts(1, 3);

    let parts = [];
    if (Array.isArray(result)) parts = result;
    else if (Array.isArray(result?.Items)) parts = result.Items;
    else if (Array.isArray(result?.Item)) parts = result.Item;
    else if (Array.isArray(result?.Parts)) parts = result.Parts;

    const sample = parts[0] || {};
    const imageSample = Array.isArray(sample.Images) && sample.Images.length ? sample.Images[0] : null;

    return res.status(200).json({
      ok: true,
      message: 'MobileParts.shop / 2Service connection is working.',
      catalogRequest: 'successful',
      sampleCount: parts.length,
      resultKeys: result && typeof result === 'object' ? Object.keys(result).sort() : [],
      partKeys: Object.keys(sample).sort(),
      imageKeys: imageSample && typeof imageSample === 'object' ? Object.keys(imageSample).sort() : [],
      fieldPresence: {
        id: sample.Id != null,
        partNumber: !!sample.PartNumber,
        description: !!sample.Description,
        manufacturer: !!sample.Manufacturer,
        availableStockQuantity: sample.AvailableStockQuantity != null,
        unitPrice: sample.UnitPrice != null,
        eanNumber: sample.EanNumber != null,
        canBeOrdered: sample.CanBeOrdered != null,
        images: Array.isArray(sample.Images)
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'MobileParts.shop / 2Service connection failed.',
      error: error.message
    });
  }
};
