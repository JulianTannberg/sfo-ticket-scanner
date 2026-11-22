-- SturmKnoten 2027 / Ticketverwaltung
-- Migration 0001: database structure only. No real customer or ticket data.
-- Use with D1 migrations after verifying the target database.
-- Buyer and eventual ticket holder are distinct: a buyer may order several tickets.
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  address_line1 TEXT,
  address_line2 TEXT,
  postal_code TEXT,
  city TEXT,
  country TEXT NOT NULL DEFAULT 'DE',
  email TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  external_order_id TEXT UNIQUE,
  sales_channel TEXT NOT NULL DEFAULT 'manual',
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','partial','paid','refunded')),
  shipping_status TEXT NOT NULL DEFAULT 'not_ready'
    CHECK (shipping_status IN ('not_ready','ready','sent','handed_over','cancelled')),
  paid_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount_cents >= 0),
  total_amount_cents INTEGER CHECK (total_amount_cents IS NULL OR total_amount_cents >= 0),
  postage_cents INTEGER CHECK (postage_cents IS NULL OR postage_cents >= 0),
  shipped_at TEXT,
  tracking_reference TEXT,
  internal_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tickets (
  code TEXT PRIMARY KEY,
  qr_url TEXT NOT NULL UNIQUE,
  ticket_type TEXT NOT NULL CHECK (ticket_type IN ('Kombi','Matrosen','Seemann')),
  print_batch TEXT,
  order_id TEXT REFERENCES orders(id) ON DELETE RESTRICT,
  holder_name TEXT,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','assigned','blocked','void')),
  assigned_at TEXT,
  admitted_at TEXT,
  admitted_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status <> 'assigned' OR order_id IS NOT NULL),
  CHECK (status <> 'available' OR order_id IS NULL)
);

CREATE TABLE IF NOT EXISTS scan_events (
  id TEXT PRIMARY KEY,
  ticket_code TEXT,
  scan_value TEXT,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('accepted','duplicate','unknown','blocked','check_only','reversed')),
  operator_id TEXT,
  device_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note TEXT,
  FOREIGN KEY (ticket_code) REFERENCES tickets(code) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_shipping ON orders(shipping_status,created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_order ON tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status_type ON tickets(status,ticket_type);
CREATE INDEX IF NOT EXISTS idx_scans_ticket_time ON scan_events(ticket_code,occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity_time ON audit_events(entity_type,entity_id,occurred_at);
