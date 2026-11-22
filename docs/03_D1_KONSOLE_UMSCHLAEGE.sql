CREATE TABLE IF NOT EXISTS envelope_progress (
  order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
  printed_at TEXT,
  packed_at TEXT,
  updated_by TEXT,
  CHECK (packed_at IS NULL OR printed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_envelope_progress_printed ON envelope_progress(printed_at,packed_at);
