CREATE TABLE IF NOT EXISTS supplier_connections (
  supplier_code TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  access_token_secret TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
