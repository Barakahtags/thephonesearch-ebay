ALTER TABLE products ADD COLUMN is_sellable INTEGER NOT NULL DEFAULT 1;

UPDATE products
SET is_sellable = CASE
  WHEN LOWER(supplier_payload) LIKE '%promiz%'
    OR LOWER(supplier_payload) LIKE '%minim%'
    OR LOWER(supplier_payload) LIKE '%lifewire%'
    OR LOWER(supplier_payload) LIKE '%impact%'
    OR LOWER(supplier_payload) LIKE '%training%'
    OR LOWER(supplier_payload) LIKE '%e-learning%'
    OR LOWER(supplier_payload) LIKE '%course%'
    OR LOWER(supplier_payload) LIKE '%schulung%'
    OR LOWER(supplier_payload) LIKE '%opleiding%'
    OR LOWER(supplier_payload) LIKE '%longer delivery%'
    OR LOWER(supplier_payload) LIKE '%long delivery%'
    OR LOWER(supplier_payload) LIKE '%langere levertijd%'
    OR LOWER(supplier_payload) LIKE '%längere lieferzeit%'
    OR (
      (LOWER(supplier_title) LIKE '%smartphone%' OR LOWER(supplier_title) LIKE '%mobile phone%' OR LOWER(supplier_title) LIKE '%feature phone%' OR LOWER(supplier_title) LIKE '%refurbished phone%' OR LOWER(supplier_title) LIKE '%used phone%' OR LOWER(supplier_title) LIKE '%complete phone%' OR LOWER(supplier_title) LIKE '%handset%')
      AND LOWER(supplier_title) NOT LIKE '%display%'
      AND LOWER(supplier_title) NOT LIKE '%screen%'
      AND LOWER(supplier_title) NOT LIKE '%lcd%'
      AND LOWER(supplier_title) NOT LIKE '%oled%'
      AND LOWER(supplier_title) NOT LIKE '%battery%'
      AND LOWER(supplier_title) NOT LIKE '%akku%'
      AND LOWER(supplier_title) NOT LIKE '%cover%'
      AND LOWER(supplier_title) NOT LIKE '%housing%'
      AND LOWER(supplier_title) NOT LIKE '%frame%'
      AND LOWER(supplier_title) NOT LIKE '%flex%'
      AND LOWER(supplier_title) NOT LIKE '%camera%'
      AND LOWER(supplier_title) NOT LIKE '%speaker%'
      AND LOWER(supplier_title) NOT LIKE '%microphone%'
      AND LOWER(supplier_title) NOT LIKE '%charging%'
      AND LOWER(supplier_title) NOT LIKE '%connector%'
      AND LOWER(supplier_title) NOT LIKE '%sim tray%'
      AND LOWER(supplier_title) NOT LIKE '%button%'
      AND LOWER(supplier_title) NOT LIKE '%glass%'
      AND LOWER(supplier_title) NOT LIKE '%lens%'
      AND LOWER(supplier_title) NOT LIKE '%case%'
      AND LOWER(supplier_title) NOT LIKE '%cable%'
      AND LOWER(supplier_title) NOT LIKE '%adhesive%'
      AND LOWER(supplier_title) NOT LIKE '%tape%'
      AND LOWER(supplier_title) NOT LIKE '%protector%'
      AND LOWER(supplier_title) NOT LIKE '%spare part%'
      AND LOWER(supplier_title) NOT LIKE '%ersatzteil%'
    )
  THEN 0 ELSE 1 END;

CREATE INDEX IF NOT EXISTS products_sellable_status_idx
  ON products (is_sellable, stock, is_new, last_seen_at);

ALTER TABLE listing_reviews ADD COLUMN pricing_version TEXT;
ALTER TABLE listing_reviews ADD COLUMN needs_ai INTEGER NOT NULL DEFAULT 1;

UPDATE listing_reviews
SET pricing_version = CASE
      WHEN pricing_json LIKE '%"pricingVersion":"ebay-lowest-undercut-v5"%' THEN 'ebay-lowest-undercut-v5'
      ELSE ''
    END,
    needs_ai = CASE
      WHEN auto_processed_at IS NULL OR auto_processed_at=''
        OR pricing_json IS NULL
        OR pricing_json NOT LIKE '%"pricingVersion":"ebay-lowest-undercut-v5"%'
        OR ebay_description LIKE '%ThePhoneSearch%'
        OR listing_status='NOT_PROFITABLE'
        OR (auto_error IS NOT NULL AND auto_error<>'')
      THEN 1 ELSE 0 END;

UPDATE listing_reviews
SET needs_ai=1
WHERE sku IN (
  SELECT r.sku FROM listing_reviews r
  JOIN products p ON p.sku=r.sku
  WHERE (LOWER(p.supplier_payload) LIKE '%refurb%' OR LOWER(p.supplier_payload) LIKE '%pulled%')
    AND (LOWER(r.ebay_title) LIKE 'for %' OR LOWER(r.ebay_title) LIKE 'für %')
);

CREATE INDEX IF NOT EXISTS listing_reviews_ai_queue_idx
  ON listing_reviews (needs_ai, listing_status, auto_processed_at);
