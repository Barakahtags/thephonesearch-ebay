-- Switch to targeted part searches without deleting products or saved reviews.
UPDATE sync_state SET status='restart_requested', cursor_type=1, cursor_page=1,
 cycle_started_at=NULL, started_at=NULL, finished_at=NULL, sync_lease_until=NULL,
 safety_blocked=0, error=NULL, pages_completed=0, expected_supplier_total=0,
 products_seen=0, previous_products_seen=0, new_items=0, out_of_stock_items=0
WHERE id=1;
