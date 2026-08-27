ALTER TABLE sync_state ADD COLUMN expected_supplier_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_state ADD COLUMN pages_completed INTEGER NOT NULL DEFAULT 0;
