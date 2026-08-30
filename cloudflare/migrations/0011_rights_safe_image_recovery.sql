ALTER TABLE products ADD COLUMN has_approved_image INTEGER NOT NULL DEFAULT 0;

UPDATE products
SET has_approved_image = CASE
  WHEN supplier_payload LIKE '%"images":["http%' OR supplier_payload LIKE '%"images": ["http%' THEN 1
  ELSE 0
END;

CREATE TABLE IF NOT EXISTS image_registry (
  identity_key TEXT PRIMARY KEY,
  source_sku TEXT NOT NULL,
  image_url TEXT NOT NULL,
  source TEXT NOT NULL,
  rights_basis TEXT NOT NULL,
  white_background INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS image_registry_source_idx ON image_registry (source_sku, updated_at);
CREATE INDEX IF NOT EXISTS products_image_ready_idx ON products (is_sellable, has_approved_image, stock);

UPDATE products
SET is_sellable=0, stock=0, out_of_stock_at=COALESCE(out_of_stock_at, datetime('now'))
WHERE LOWER(supplier_payload) LIKE '%promiz%'
   OR LOWER(supplier_payload) LIKE '%minim%'
   OR LOWER(supplier_payload) LIKE '%lifewire%'
   OR LOWER(supplier_payload) LIKE '%impact%'
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
     AND LOWER(supplier_title) NOT LIKE '%charging%'
     AND LOWER(supplier_title) NOT LIKE '%connector%'
     AND LOWER(supplier_title) NOT LIKE '%sim tray%'
     AND LOWER(supplier_title) NOT LIKE '%glass%'
     AND LOWER(supplier_title) NOT LIKE '%lens%'
     AND LOWER(supplier_title) NOT LIKE '%adhesive%'
     AND LOWER(supplier_title) NOT LIKE '%tape%'
     AND LOWER(supplier_title) NOT LIKE '%spare part%'
     AND LOWER(supplier_title) NOT LIKE '%ersatzteil%'
   );

DELETE FROM listing_reviews WHERE sku IN (SELECT sku FROM products WHERE is_sellable=0);
DELETE FROM stock_sync_queue WHERE sku IN (SELECT sku FROM products WHERE is_sellable=0);
