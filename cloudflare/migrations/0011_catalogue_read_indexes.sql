-- Ordered indexes avoid rescanning and sorting the catalogue for each page.
CREATE INDEX IF NOT EXISTS products_in_stock_page_idx ON products(first_seen_at DESC,sku) WHERE stock>0;
CREATE INDEX IF NOT EXISTS products_sold_out_page_idx ON products(stock,first_seen_at DESC,sku) WHERE stock=0;
CREATE INDEX IF NOT EXISTS products_new_stock_page_idx ON products(is_new,first_seen_at DESC,sku) WHERE stock>0 AND is_new=1;
ANALYZE products;
