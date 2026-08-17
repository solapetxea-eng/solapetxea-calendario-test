CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  unit TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  name TEXT NOT NULL,
  discount_type TEXT NOT NULL,
  discount_value REAL NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_offers_unit_enabled ON offers(unit, enabled);
CREATE INDEX IF NOT EXISTS idx_offers_dates ON offers(start_date, end_date);
