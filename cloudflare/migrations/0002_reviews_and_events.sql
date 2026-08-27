CREATE TABLE IF NOT EXISTS listing_reviews (
  sku TEXT PRIMARY KEY,
  ebay_title TEXT NOT NULL DEFAULT '',
  ebay_description TEXT NOT NULL DEFAULT '',
  review_status TEXT NOT NULL DEFAULT 'review',
  content_source TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (sku) REFERENCES products(sku) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  sku TEXT,
  previous_stock INTEGER,
  current_stock INTEGER,
  details TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_events_created_idx
  ON sync_events (created_at DESC);

ALTER TABLE sync_state ADD COLUMN previous_products_seen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_state ADD COLUMN safety_blocked INTEGER NOT NULL DEFAULT 0;
