CREATE TABLE IF NOT EXISTS products (
  sku TEXT PRIMARY KEY,
  article_type INTEGER NOT NULL,
  supplier_title TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0,
  supplier_payload TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  out_of_stock_at TEXT,
  is_new INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS products_status_idx
  ON products (stock, is_new, last_seen_at);

CREATE TABLE IF NOT EXISTS sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'never',
  started_at TEXT,
  finished_at TEXT,
  products_seen INTEGER NOT NULL DEFAULT 0,
  new_items INTEGER NOT NULL DEFAULT 0,
  out_of_stock_items INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

INSERT OR IGNORE INTO sync_state (id) VALUES (1);
