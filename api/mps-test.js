const { authenticate, allParts, part } = require('./_lib/mps');
const ebay = require('./_lib/ebay');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    await authenticate();
    const selected = [];
    let pagesScanned = 0;
    let totalParts = null;
    let hasMore = true;

    for (let page = 1; page <= 20 && selected.length < 5 && hasMore; page++) {
      const result = await allParts(page, 100);
      pagesScanned = page;
      totalParts = result?.TotalNumberOfParts ?? totalParts;
      const parts = Array.isArray(result?.Parts) ? result.Parts : [];
      for (const p of parts) {
        if (selected.length >= 5) break;
        if (p?.CanBeOrdered && Number(p?.AvailableStockQuantity || 0) > 0) selected.push(p);
      }
      hasMore = !!result?.HasMoreRecords;
    }

    const candidates = [];
    for (const p of selected) {
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

    const categoryChecks = {};
    for (const id of [...new Set(candidates.map(x => x.categoryId).filter(Boolean))]) {
      try {
        const aspects = await ebay.categoryAspects(id);
        categoryChecks[id] = {
          required: aspects.filter(a => a.required).map(a => ({ name: a.name, mode: a.mode, values: a.values.slice(0, 10) })),
          totalAspects: aspects.length
        };
      } catch (e) {
        categoryChecks[id] = { error: e.message };
      }
    }

    let policies = null, policiesError = null, inventoryLocation = null, inventoryLocationError = null;
    try { policies = await ebay.policies(); } catch (e) { policiesError = e.message; }
    try { inventoryLocation = await ebay.firstInventoryLocation(); } catch (e) { inventoryLocationError = e.message; }

    return res.status(200).json({
      ok: true,
      message: 'Five-item eBay dry-run validation complete. Nothing was uploaded.',
      catalogRequest: 'successful',
      pagesScanned,
      totalParts,
      candidateCount: candidates.length,
      candidates,
      categoryChecks,
      policies,
      policiesError,
      inventoryLocation,
      inventoryLocationError,
      uploadPerformed: false
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: 'Five-item dry-run validation failed.', error: error.message, uploadPerformed: false });
  }
};
