ALTER TABLE listing_reviews ADD COLUMN calculated_price REAL;
ALTER TABLE listing_reviews ADD COLUMN buyer_total REAL;
ALTER TABLE listing_reviews ADD COLUMN pricing_json TEXT;
ALTER TABLE listing_reviews ADD COLUMN competitor_pricing_json TEXT;
ALTER TABLE listing_reviews ADD COLUMN listing_status TEXT;
ALTER TABLE listing_reviews ADD COLUMN auto_processed_at TEXT;
ALTER TABLE listing_reviews ADD COLUMN auto_error TEXT;
