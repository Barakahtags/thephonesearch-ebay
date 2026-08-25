const { authenticate, allParts, part } = require('./_lib/mps');
const ebay = require('./_lib/ebay');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    await authenticate();
    const result = await allParts(1, 10);
    const raw = Array.isArray(result?.Parts) ? result.Parts : [];
    const orderable = raw.filter(p => p?.CanBeOrdered && Number(p?.AvailableStockQuantity || 0) > 0).slice(0, 5);
    const candidates = [];

    for (const p of orderable) {
      let detail = null;
      let detailError = null;
      try { detail = await part(p.PartNumber); } catch (e) { detailError = e.message; }
      const d = detail || p;
      const images = (d?.Images || []).map(x => x?.ImageUrl).filter(Boolean);
      let categoryId = null;
      let categoryError = null;
      try { categoryId = await ebay.suggestedCategory(`${d?.Manufacturer || p?.Manufacturer || ''} ${d?.Description || p?.Description || p?.PartNumber}`); }
      catch (e) { categoryError = e.message; }
      candidates.push({
        sku: p.PartNumber,
        title: d?.Description || p.Description || p.PartNumber,
        manufacturer: d?.Manufacturer || p.Manufacturer || null,
        stock: Number(d?.AvailableStockQuantity ?? p.AvailableStockQuantity ?? 0),
        costExVat: Number(d?.UnitPrice ?? p.UnitPrice ?? 0),
        calculatedPrice: ebay.sellingPrice(d?.UnitPrice ?? p.UnitPrice ?? 0),
        ean: d?.EanNumber || p?.EanNumber || null,
        imageCount: images.length,
        categoryId,
        categoryError,
        detailKeys: detail && typeof detail === 'object' ? Object.keys(detail).sort() : [],
        detailError
      });
    }

    let policies = null;
    let policiesError = null;
    let inventoryLocation = null;
    let inventoryLocationError = null;
    try { policies = await ebay.policies(); } catch (e) { policiesError = e.message; }
    try { inventoryLocation = await ebay.firstInventoryLocation(); } catch (e) { inventoryLocationError = e.message; }

    return res.status(200).json({
      ok: true,
      message: 'Five-item eBay dry-run inspection complete. Nothing was uploaded.',
      catalogRequest: 'successful',
      candidateCount: candidates.length,
      candidates,
      policies,
      policiesError,
      inventoryLocation,
      inventoryLocationError,
      uploadPerformed: false
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'Five-item dry-run inspection failed.',
      error: error.message,
      uploadPerformed: false
    });
  }
};
