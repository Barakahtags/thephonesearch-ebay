CREATE TABLE IF NOT EXISTS stock_sync_queue (
  sku TEXT PRIMARY KEY,
  supplier_stock INTEGER NOT NULL DEFAULT 0,
  orderable INTEGER NOT NULL DEFAULT 0,
  event_type TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS stock_sync_queue_updated_idx
  ON stock_sync_queue (updated_at ASC);

INSERT OR REPLACE INTO stock_sync_queue
  (sku, supplier_stock, orderable, event_type, updated_at, attempts, last_error)
SELECT sku, 0, 0, 'LONG_DELIVERY_EXCLUDED', datetime('now'), 0, NULL
FROM products
WHERE stock>0 AND (
  LOWER(supplier_payload) LIKE '%longer delivery%' OR
  LOWER(supplier_payload) LIKE '%long delivery%' OR
  LOWER(supplier_payload) LIKE '%langere levertijd%' OR
  LOWER(supplier_payload) LIKE '%längere lieferzeit%'
);

UPDATE products
SET stock=0, out_of_stock_at=COALESCE(out_of_stock_at, datetime('now'))
WHERE stock>0 AND (
  LOWER(supplier_payload) LIKE '%longer delivery%' OR
  LOWER(supplier_payload) LIKE '%long delivery%' OR
  LOWER(supplier_payload) LIKE '%langere levertijd%' OR
  LOWER(supplier_payload) LIKE '%längere lieferzeit%'
);
