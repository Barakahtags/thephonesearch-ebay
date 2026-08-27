-- Products present when the permanent catalogue was introduced are the baseline.
-- Only products first discovered after this migration should appear as new.
UPDATE products SET is_new = 0;
