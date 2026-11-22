-- SturmKnoten ticket module: order quantities and auditable payments.
-- IMPORTANT: Run once on D1 after 0001 was installed; never store customer data in GitHub.
ALTER TABLE orders ADD COLUMN qty_kombi INTEGER NOT NULL DEFAULT 0 CHECK (qty_kombi >= 0);
ALTER TABLE orders ADD COLUMN qty_matrosen INTEGER NOT NULL DEFAULT 0 CHECK (qty_matrosen >= 0);
ALTER TABLE orders ADD COLUMN qty_seemann INTEGER NOT NULL DEFAULT 0 CHECK (qty_seemann >= 0);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('received','refunded')),
  method TEXT NOT NULL CHECK (method IN ('bank','cash','card','other')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reference TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_order_time ON payments(order_id,occurred_at);