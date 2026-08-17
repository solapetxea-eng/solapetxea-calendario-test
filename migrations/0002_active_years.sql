CREATE TABLE IF NOT EXISTS active_years (
  year INTEGER PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Inicializa con los años actuales
INSERT OR IGNORE INTO active_years (year, enabled) VALUES (2026, 1), (2027, 1);
