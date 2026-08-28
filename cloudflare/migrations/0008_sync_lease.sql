-- Only one catalogue import may write to D1 at a time. Browser refreshes and
-- cron runs previously overlapped and could exceed D1's CPU budget.
ALTER TABLE sync_state ADD COLUMN sync_lease_until TEXT;
