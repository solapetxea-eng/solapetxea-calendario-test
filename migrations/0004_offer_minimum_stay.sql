-- Optional offer-specific minimum stay. NULL preserves the normal calendar minimum.
ALTER TABLE offers
ADD COLUMN minimum_stay INTEGER
CHECK (minimum_stay IS NULL OR (minimum_stay >= 1 AND minimum_stay <= 60));
