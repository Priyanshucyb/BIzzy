// Business OS v3 — dual-engine data layer (Stage A: Cloud Backend)
// ONE async interface, two engines, chosen by environment:
//   - DATABASE_URL set   → PostgreSQL (cloud mode) via the `pg` driver
//   - DATABASE_URL unset → SQLite via Node's built-in node:sqlite (local mode,
//                          exactly the v2 behavior — file backend/data/business-os.db)
// server.js / seed-demo.js only ever call: init(), get(), all(), run(), exec(),
// begin() → tx{get,all,run,commit,rollback}. All SQL in the app is written in the
// SQLite dialect with `?` placeholders; this layer translates for Postgres:
//   `?` → $1..$n (outside string literals), datetime('now') → UTC text timestamp,
//   LIKE → ILIKE (SQLite LIKE is case-insensitive for ASCII; PG LIKE is not),
//   INSERT … → appends RETURNING id (tables with an id column) so run() can
//   report lastInsertRowid exactly like SQLite.
// Parity decisions (deliberate, so cloud numbers/behavior == local, bit for bit):
//   - Date/time values stay TEXT in Postgres too: dates 'YYYY-MM-DD' and
//     timestamps 'YYYY-MM-DD HH24:MI:SS' (UTC) — the app groups/reports by
//     these strings, so they must be byte-identical across engines.
//   - Money/qty columns are DOUBLE PRECISION (= SQLite REAL) in Postgres.
//   - The Postgres schema declares NO foreign-key constraints: v2's SQLite
//     schema wrote REFERENCES but SQLite never enforced them (no FK pragma),
//     and the app enforces ownership/scoping in code. Enforcing FKs only in
//     cloud would change edge behavior (e.g. product delete) between modes.
//   - COUNT(*) comes back from Postgres as int8 (a string in node-pg) — a type
//     parser below converts int8/numeric to JS numbers like SQLite returns.
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || '';
const ENGINE = DATABASE_URL ? 'postgres' : 'sqlite';
const MODE = ENGINE === 'postgres' ? 'cloud' : 'local';

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = ENGINE === 'sqlite' ? path.join(DATA_DIR, 'business-os.db') : null;

// All app tables, in FK-safe order (parents before children) — used by the
// cloud backup export and by migrate-to-cloud.js.
const TABLES = [
  'businesses', 'users', 'sessions',
  'suppliers', 'products', 'customers',
  'purchases', 'purchase_items', 'supplier_payments',
  'invoices', 'invoice_items', 'customer_payments',
  'stock_movements', 'expenses',
  // Features 1–2 (2026-11-20): estimates/quotations and sales returns /
  // credit notes travel with the per-business backup export too.
  'estimates', 'estimate_items', 'returns', 'return_items',
  // SaaS Stage 2: business-scoped SaaS data travels with backup / migration.
  // Platform tables (plans, app_settings, email_otps, pending_signups,
  // platform_admins, admin_sessions) are deliberately NOT here — they are
  // not one business's data (no business_id) and must not enter the
  // per-business backup export.
  'subscriptions', 'subscription_payments', 'onboarding'
];

// ---------- schema (single source; Postgres DDL is derived from the SQLite DDL) ----------
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    owner_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    landmark TEXT NOT NULL DEFAULT '',
    pincode TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    workspace_activated_at TEXT,
    gst_enabled INTEGER NOT NULL DEFAULT 0,
    gstin TEXT NOT NULL DEFAULT '',
    upi_id TEXT NOT NULL DEFAULT '',
    upi_payee_name TEXT NOT NULL DEFAULT '',
    payment_qr TEXT,
    language TEXT NOT NULL DEFAULT 'en',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    mobile TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','staff')),
    access TEXT NOT NULL DEFAULT 'all' CHECK (access IN ('all','billing','stock')),
    blocked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_users_business ON users(business_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  -- ===== Stage 2: stock flow (products, suppliers, purchases) =====
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'piece',
    buy_price REAL NOT NULL DEFAULT 0,
    sell_price REAL NOT NULL DEFAULT 0,
    gst_rate REAL NOT NULL DEFAULT 0,
    hsn_code TEXT NOT NULL DEFAULT '',
    stock_qty REAL NOT NULL DEFAULT 0,
    low_stock_limit REAL NOT NULL DEFAULT 5,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    bill_no TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT (date('now')),
    total REAL NOT NULL DEFAULT 0,
    paid_amount REAL NOT NULL DEFAULT 0,
    due_date TEXT,
    kind TEXT NOT NULL DEFAULT 'purchase',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    purchase_id INTEGER NOT NULL REFERENCES purchases(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty REAL NOT NULL,
    buy_price REAL NOT NULL,
    amount REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS supplier_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    purchase_id INTEGER NOT NULL REFERENCES purchases(id),
    amount REAL NOT NULL,
    mode TEXT NOT NULL DEFAULT 'Cash',
    date TEXT NOT NULL DEFAULT (date('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    type TEXT NOT NULL CHECK (type IN ('purchase','opening','sale','adjustment','return')),
    qty_change REAL NOT NULL,
    ref_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id);
  CREATE INDEX IF NOT EXISTS idx_suppliers_business ON suppliers(business_id);
  CREATE INDEX IF NOT EXISTS idx_purchases_business ON purchases(business_id);
  CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
  CREATE INDEX IF NOT EXISTS idx_items_purchase ON purchase_items(purchase_id);
  CREATE INDEX IF NOT EXISTS idx_payments_purchase ON supplier_payments(purchase_id);
  CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id);

  -- ===== Stage 3: billing flow (customers, invoices, customer payments) =====
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    gstin TEXT NOT NULL DEFAULT '',
    share_token TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    bill_no INTEGER NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    customer_name TEXT NOT NULL DEFAULT 'Walk-in',
    date TEXT NOT NULL DEFAULT (date('now')),
    subtotal REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    gst_enabled INTEGER NOT NULL DEFAULT 0,
    gst_amount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    paid_amount REAL NOT NULL DEFAULT 0,
    payment_mode TEXT,
    due_date TEXT,
    kind TEXT NOT NULL DEFAULT 'sale',
    cancelled_at TEXT,
    cancel_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL DEFAULT '',
    qty REAL NOT NULL,
    sell_price REAL NOT NULL,
    buy_price REAL NOT NULL DEFAULT 0,
    gst_rate REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS customer_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    amount REAL NOT NULL,
    mode TEXT NOT NULL DEFAULT 'Cash',
    date TEXT NOT NULL DEFAULT (date('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_business ON invoices(business_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
  CREATE INDEX IF NOT EXISTS idx_inv_items_invoice ON invoice_items(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_cust_payments_invoice ON customer_payments(invoice_id);

  -- ===== Stage 4: expenses (kharcha) — reports/profit are computed from
  -- invoices + invoice_items + expenses, so no extra tables are needed. =====
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Other',
    amount REAL NOT NULL DEFAULT 0,
    date TEXT NOT NULL DEFAULT (date('now')),
    payment_mode TEXT NOT NULL DEFAULT 'Cash',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE INDEX IF NOT EXISTS idx_expenses_business ON expenses(business_id);
  CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(business_id, date);

  -- ===== Features 1–2 (2026-11-20): Estimates/Quotations + Sales Returns =====
  -- Estimates are structurally SEPARATE from invoices: no stock movement,
  -- no report ever reads them — an estimate becomes money only when it is
  -- converted, and conversion runs the normal invoice-creation path.
  -- Totals mirror invoice math exactly (GST-inclusive prices, item GST =
  -- amount × rate/(100+rate), total = subtotal − discount).
  CREATE TABLE IF NOT EXISTS estimates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    customer_id INTEGER REFERENCES customers(id),
    customer_name TEXT NOT NULL DEFAULT 'Walk-in',
    estimate_no INTEGER NOT NULL DEFAULT 0,
    date TEXT NOT NULL DEFAULT (date('now')),
    subtotal REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    gst_enabled INTEGER NOT NULL DEFAULT 0,
    gst_amount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','converted')),
    converted_invoice_id INTEGER,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS estimate_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    estimate_id INTEGER NOT NULL REFERENCES estimates(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL DEFAULT '',
    qty REAL NOT NULL,
    sell_price REAL NOT NULL,
    buy_price REAL NOT NULL DEFAULT 0,
    gst_rate REAL NOT NULL DEFAULT 0,
    hsn_code TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  -- Returns / credit notes: a return hangs off ONE invoice, restocks via
  -- stock_movements type 'return', and nets out of the customer's pending
  -- and the month's sale/GST by its RETURN date (credit-note month rule).
  -- Item rows snapshot the original invoice item's price + GST rate, so
  -- the return's totals are reproducible pro-rata forever.
  CREATE TABLE IF NOT EXISTS returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    customer_id INTEGER REFERENCES customers(id),
    return_no INTEGER NOT NULL DEFAULT 0,
    date TEXT NOT NULL DEFAULT (date('now')),
    total_amount REAL NOT NULL DEFAULT 0,
    gst_amount REAL NOT NULL DEFAULT 0,
    reason TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS return_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    return_id INTEGER NOT NULL REFERENCES returns(id),
    invoice_item_id INTEGER NOT NULL REFERENCES invoice_items(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty REAL NOT NULL,
    price REAL NOT NULL,
    gst_rate REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE INDEX IF NOT EXISTS idx_estimates_business ON estimates(business_id);
  CREATE INDEX IF NOT EXISTS idx_est_items_estimate ON estimate_items(estimate_id);
  CREATE INDEX IF NOT EXISTS idx_returns_business ON returns(business_id);
  CREATE INDEX IF NOT EXISTS idx_returns_invoice ON returns(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_returns_customer ON returns(customer_id);
  CREATE INDEX IF NOT EXISTS idx_ret_items_return ON return_items(return_id);
  CREATE INDEX IF NOT EXISTS idx_ret_items_invitem ON return_items(invoice_item_id);
  -- NOTE: the unique index on customers(share_token) is created in the
  -- engine init migrations, NOT here — SCHEMA_SQL runs before the
  -- share_token ALTER on older DBs, and an index on a not-yet-existing
  -- column would fail the whole boot.

  -- ===== SaaS Stage 2: OTP auth, subscriptions, super admin, onboarding =====
  -- Design rule for this stage: NO changes to existing tables (no ALTER —
  -- the dual-engine layer only runs this CREATE IF NOT EXISTS schema, and
  -- live local + cloud DBs must pick the stage up by simply rebooting).
  -- Consequences, deliberately chosen:
  --  * "Email not verified" is a row in pending_signups (keyed by user_id).
  --    Pre-existing users (incl. the demo seed) have no row → verified,
  --    nobody is locked out by this stage arriving.
  --  * The DILIGENCE super admin lives in platform_admins, NOT in users:
  --    users.business_id is NOT NULL and users.role has a CHECK
  --    ('owner','staff') in both engines, so a business-less superadmin row
  --    cannot be inserted there. Admin sessions mirror sessions in
  --    admin_sessions. Business isolation is untouched.
  --  * Every new table carries an id PK so the Postgres translator's
  --    INSERT … RETURNING id works unchanged.
  CREATE TABLE IF NOT EXISTS email_otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'signup' CHECK (purpose IN ('signup','reset')),
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS pending_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS platform_admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'DILIGENCE Admin',
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    admin_id INTEGER NOT NULL REFERENCES platform_admins(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT
  );

  -- ===== Session-expiry + login-lockout + workspace workflow (2026-11-22) =====
  -- login_attempts: per-identifier / per-IP failed-login counters with a
  -- lockout stamp (platform table — no business_id, never in backups).
  -- app_migrations: one-time data migrations are recorded here so they
  -- run exactly once per database (e.g. the workspace_activated_at
  -- backfill for pre-existing named shops).
  CREATE TABLE IF NOT EXISTS login_attempts (
    key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    last_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    duration_days INTEGER NOT NULL DEFAULT 30,
    price REAL NOT NULL DEFAULT 0,
    grace_days INTEGER NOT NULL DEFAULT 7,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    plan_code TEXT,
    trial_ends_at TEXT,
    paid_until TEXT,
    grace_days INTEGER NOT NULL DEFAULT 7,
    blocked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS subscription_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    plan_code TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    method TEXT NOT NULL DEFAULT 'upi_manual' CHECK (method IN ('upi_manual','razorpay')),
    reference TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','gateway_pending','gateway_failed')),
    invoice_no TEXT NOT NULL DEFAULT '',
    gateway_order_id TEXT NOT NULL DEFAULT '',
    gateway_payment_id TEXT NOT NULL DEFAULT '',
    period_from TEXT,
    period_to TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS onboarding (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    dismissed INTEGER NOT NULL DEFAULT 0,
    wa_done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  -- ===== SaaS Stage 3: backups, audit, sync (Bharosa wala hisa) =====
  -- Same additive rule as Stage 2: new tables only, NO ALTER of existing
  -- tables. Sync identity lives in sync_ids (table_name + local row id →
  -- client-generated uuid) so existing tables keep their exact shape in
  -- both engines; a row's uuid is assigned lazily the first time it syncs.
  CREATE TABLE IF NOT EXISTS backup_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    kind TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('auto','manual','pre-restore')),
    payload TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    user_id INTEGER,
    user_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '',
    entity TEXT NOT NULL DEFAULT '',
    entity_id TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS sync_ids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    table_name TEXT NOT NULL,
    row_id INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS sync_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    table_name TEXT NOT NULL DEFAULT '',
    uuid TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    device_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS sync_tombstones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    table_name TEXT NOT NULL,
    uuid TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'local',
    acked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE TABLE IF NOT EXISTS sync_meta (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status TEXT NOT NULL DEFAULT 'local'
  );

  CREATE INDEX IF NOT EXISTS idx_backups_business ON backup_snapshots(business_id, id);
  CREATE INDEX IF NOT EXISTS idx_audit_business ON audit_log(business_id, id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_ids_uuid ON sync_ids(uuid);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_ids_row ON sync_ids(table_name, row_id);
  CREATE INDEX IF NOT EXISTS idx_sync_conf_business ON sync_conflicts(business_id, id);
  CREATE INDEX IF NOT EXISTS idx_sync_tomb_business ON sync_tombstones(business_id, id);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_user ON pending_signups(user_id);
  CREATE INDEX IF NOT EXISTS idx_otps_email ON email_otps(email, purpose);
  CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_subs_business ON subscriptions(business_id);
  CREATE INDEX IF NOT EXISTS idx_subpay_business ON subscription_payments(business_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_business ON onboarding(business_id);

  -- ===== BizYour — Business Mart (B2B marketplace between businesses) =====
  -- Same additive rule: new tables only, NO ALTER of existing tables.
  -- Unlike every table above, Mart rows are CROSS-business by design (a
  -- buyer's inquiry is seen by many sellers, a quote links two businesses),
  -- so they are deliberately NOT in TABLES (the per-business backup/restore
  -- walk) — restoring one shop must never delete other shops' quotes.
  -- They ARE in MART_TABLES so migrate-to-cloud.js copies them.
  -- The only bridge into a shop's private Workspace data is the buyer's own
  -- "Mark received" action, which writes a normal purchase (stock goes up
  -- through stock_movements exactly like a manual purchase).
  CREATE TABLE IF NOT EXISTS mart_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    display_name TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL DEFAULT '',
    about TEXT NOT NULL DEFAULT '',
    categories TEXT NOT NULL DEFAULT '',
    service_cities TEXT NOT NULL DEFAULT '',
    all_india INTEGER NOT NULL DEFAULT 0,
    is_seller INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mart_inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    product TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    qty REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'kg',
    target_price REAL,
    city TEXT NOT NULL DEFAULT '',
    need_by TEXT,
    frequency TEXT NOT NULL DEFAULT 'One-time',
    notes TEXT NOT NULL DEFAULT '',
    show_name INTEGER NOT NULL DEFAULT 1,
    verified_only INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    source TEXT NOT NULL DEFAULT 'manual',
    product_id INTEGER,
    target_business_id INTEGER,
    group_id TEXT,
    notified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mart_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inquiry_id INTEGER NOT NULL REFERENCES mart_inquiries(id),
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mart_quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inquiry_id INTEGER NOT NULL REFERENCES mart_inquiries(id),
    seller_business_id INTEGER NOT NULL REFERENCES businesses(id),
    price REAL NOT NULL DEFAULT 0,
    moq REAL NOT NULL DEFAULT 0,
    delivery_days INTEGER NOT NULL DEFAULT 1,
    payment_terms TEXT NOT NULL DEFAULT 'Cash on delivery',
    advance_percent REAL,
    credit_days INTEGER,
    valid_days INTEGER NOT NULL DEFAULT 3,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'sent',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mart_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id INTEGER NOT NULL REFERENCES mart_quotes(id),
    sender_business_id INTEGER NOT NULL REFERENCES businesses(id),
    kind TEXT NOT NULL DEFAULT 'text',
    body TEXT NOT NULL DEFAULT '',
    amount REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mart_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inquiry_id INTEGER NOT NULL REFERENCES mart_inquiries(id),
    quote_id INTEGER NOT NULL REFERENCES mart_quotes(id),
    buyer_business_id INTEGER NOT NULL REFERENCES businesses(id),
    seller_business_id INTEGER NOT NULL REFERENCES businesses(id),
    product TEXT NOT NULL DEFAULT '',
    qty REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    payment_terms TEXT NOT NULL DEFAULT '',
    advance_percent REAL,
    credit_days INTEGER,
    delivery_days INTEGER NOT NULL DEFAULT 1,
    expected_delivery_date TEXT,
    transporter_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'placed',
    purchase_id INTEGER,
    rating INTEGER,
    review TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mart_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    product_id INTEGER,
    name TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'kg',
    price REAL NOT NULL DEFAULT 0,
    moq REAL NOT NULL DEFAULT 1,
    photo TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mart_favourites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    seller_business_id INTEGER NOT NULL REFERENCES businesses(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mart_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    kind TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    link_view TEXT NOT NULL DEFAULT '',
    link_id INTEGER,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_mart_profile_biz ON mart_profiles(business_id);
  CREATE INDEX IF NOT EXISTS idx_mart_inq_biz ON mart_inquiries(business_id, id);
  CREATE INDEX IF NOT EXISTS idx_mart_inq_status ON mart_inquiries(status, category);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_mart_views_once ON mart_views(inquiry_id, business_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_mart_quote_once ON mart_quotes(inquiry_id, seller_business_id);
  CREATE INDEX IF NOT EXISTS idx_mart_quote_seller ON mart_quotes(seller_business_id);
  CREATE INDEX IF NOT EXISTS idx_mart_msg_quote ON mart_messages(quote_id, id);
  CREATE INDEX IF NOT EXISTS idx_mart_orders_buyer ON mart_orders(buyer_business_id, id);
  CREATE INDEX IF NOT EXISTS idx_mart_orders_seller ON mart_orders(seller_business_id, id);
  CREATE INDEX IF NOT EXISTS idx_mart_listings_biz ON mart_listings(business_id);
  CREATE INDEX IF NOT EXISTS idx_mart_notif_biz ON mart_notifications(business_id, id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_mart_fav_once ON mart_favourites(business_id, seller_business_id);
  CREATE INDEX IF NOT EXISTS idx_mart_fav_biz ON mart_favourites(business_id, id);
`;

// Business Mart tables (cross-business — see the schema note above). Copied
// by migrate-to-cloud.js after TABLES; never part of a one-shop backup.
const MART_TABLES = [
  'mart_profiles', 'mart_inquiries', 'mart_views', 'mart_quotes',
  'mart_messages', 'mart_orders', 'mart_listings', 'mart_notifications',
  'mart_favourites'
];

// SQLite datetime('now') is UTC 'YYYY-MM-DD HH:MM:SS' text — the Postgres
// expression below produces the exact same text from the clock.
const PG_NOW_TS = "to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')";
const PG_TODAY = "to_char(timezone('utc', now()), 'YYYY-MM-DD')";

// Derive the Postgres DDL from the SQLite DDL (keeps ONE schema source).
// FK REFERENCES are stripped for behavioral parity (see header note).
const PG_SCHEMA_SQL = SCHEMA_SQL
  .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY')
  .replace(/datetime\('now'\)/g, PG_NOW_TS)
  .replace(/date\('now'\)/g, PG_TODAY)
  .replace(/\bREAL\b/g, 'DOUBLE PRECISION')
  .replace(/\s+REFERENCES\s+\w+\(id\)/g, '');

// ---------- SQL translation for Postgres ----------
const NO_ID_TABLES = new Set(['sessions', 'login_attempts', 'app_migrations']); // tables whose PK is not `id`
function translatePg(sql) {
  let out = '';
  let n = 0;
  let i = 0;
  let inStr = false; // inside a '...' literal
  while (i < sql.length) {
    const ch = sql[i];
    if (inStr) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") { out += "'"; i += 2; continue; } // '' escape
        inStr = false;
      }
      i++;
      continue;
    }
    if (ch === "'") { inStr = true; out += ch; i++; continue; }
    if (ch === '?') { n++; out += '$' + n; i++; continue; }
    if (sql.startsWith("datetime('now')", i)) { out += PG_NOW_TS; i += "datetime('now')".length; continue; }
    if (sql.startsWith(' LIKE ', i)) { out += ' ILIKE '; i += 6; continue; }
    out += ch;
    i++;
  }
  return out;
}

// =====================================================================
// SQLite engine (local mode — v2 behavior, sync driver under an async skin)
// =====================================================================
let sdb = null;
function sqliteLayer() {
  const q = {
    async get(sql, ...params) { return sdb.prepare(sql).get(...params); },
    async all(sql, ...params) { return sdb.prepare(sql).all(...params); },
    async run(sql, ...params) {
      const r = sdb.prepare(sql).run(...params);
      return { lastInsertRowid: r.lastInsertRowid !== undefined ? Number(r.lastInsertRowid) : undefined, changes: r.changes };
    },
    async exec(sql) { sdb.exec(sql); },
    async begin() {
      sdb.exec('BEGIN');
      let done = false;
      return {
        get: q.get, all: q.all, run: q.run,
        async commit() { if (!done) { done = true; sdb.exec('COMMIT'); } },
        async rollback() { if (!done) { done = true; try { sdb.exec('ROLLBACK'); } catch (_) { /* already closed */ } } }
      };
    },
    // SQLite-only: consistent file snapshot for the local backup download.
    async vacuumInto(filePath) { sdb.exec(`VACUUM INTO '${String(filePath).replace(/'/g, "''")}'`); }
  };
  return q;
}

// =====================================================================
// Postgres engine (cloud mode)
// =====================================================================
let pool = null;
function pgLayer() {
  function prepare(sql) {
    let text = translatePg(sql);
    let wantId = false;
    const m = /^\s*INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i.exec(sql);
    if (m && !NO_ID_TABLES.has(m[1].toLowerCase()) && !/RETURNING/i.test(sql)) {
      text += ' RETURNING id';
      wantId = true;
    }
    return { text, wantId };
  }
  function makeQ(executor) {
    const q = {
      async get(sql, ...params) {
        const r = await executor.query(translatePg(sql), params);
        return r.rows[0]; // undefined when no row — same as SQLite .get()
      },
      async all(sql, ...params) {
        const r = await executor.query(translatePg(sql), params);
        return r.rows;
      },
      async run(sql, ...params) {
        const { text, wantId } = prepare(sql);
        const r = await executor.query(text, params);
        return {
          lastInsertRowid: wantId && r.rows[0] ? r.rows[0].id : undefined,
          changes: r.rowCount
        };
      },
      async exec(sql) { await executor.query(translatePg(sql)); }
    };
    return q;
  }
  const base = makeQ(pool);
  return {
    ...base,
    async begin() {
      const client = await pool.connect();
      const txq = makeQ(client);
      let done = false;
      try { await client.query('BEGIN'); } catch (e) { client.release(); throw e; }
      return {
        get: txq.get, all: txq.all, run: txq.run,
        async commit() {
          if (done) return; done = true;
          try { await client.query('COMMIT'); } finally { client.release(); }
        },
        async rollback() {
          if (done) return; done = true;
          try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ } finally { client.release(); }
        }
      };
    },
    async vacuumInto() { throw new Error('vacuumInto is SQLite-only'); }
  };
}

// =====================================================================
// Layer assembly + init
// =====================================================================
let layer = null;
async function init() {
  if (layer) return layer;
  if (ENGINE === 'sqlite') {
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    sdb = new DatabaseSync(DB_PATH);
    sdb.exec(SCHEMA_SQL);
    // Updates Stage A migration: CREATE TABLE IF NOT EXISTS never adds
    // columns to a businesses table created by an older build, so add the
    // UPI settings columns idempotently — pre-existing local DBs boot with
    // their data untouched and simply gain two empty settings.
    const bizCols = sdb.prepare('PRAGMA table_info(businesses)').all().map((c) => c.name);
    if (!bizCols.includes('upi_id')) sdb.exec("ALTER TABLE businesses ADD COLUMN upi_id TEXT NOT NULL DEFAULT ''");
    if (!bizCols.includes('upi_payee_name')) sdb.exec("ALTER TABLE businesses ADD COLUMN upi_payee_name TEXT NOT NULL DEFAULT ''");
    // Updates Stage B migration (same idempotent pattern): GSTR-1 / e-way /
    // e-invoice files need a per-product HSN code and a per-customer GSTIN.
    // Older local DBs gain two empty columns; data is untouched.
    const prodCols = sdb.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
    if (!prodCols.includes('hsn_code')) sdb.exec("ALTER TABLE products ADD COLUMN hsn_code TEXT NOT NULL DEFAULT ''");
    const custCols = sdb.prepare('PRAGMA table_info(customers)').all().map((c) => c.name);
    if (!custCols.includes('gstin')) sdb.exec("ALTER TABLE customers ADD COLUMN gstin TEXT NOT NULL DEFAULT ''");
    // Updates Stage C migration (same idempotent pattern): data import
    // marks opening-balance rows — invoices.kind 'sale'|'opening',
    // purchases.kind 'purchase'|'opening'. Older local DBs gain the two
    // columns with the real-row defaults; existing data is untouched.
    const invCols = sdb.prepare('PRAGMA table_info(invoices)').all().map((c) => c.name);
    if (!invCols.includes('kind')) sdb.exec("ALTER TABLE invoices ADD COLUMN kind TEXT NOT NULL DEFAULT 'sale'");
    const purCols = sdb.prepare('PRAGMA table_info(purchases)').all().map((c) => c.name);
    if (!purCols.includes('kind')) sdb.exec("ALTER TABLE purchases ADD COLUMN kind TEXT NOT NULL DEFAULT 'purchase'");
    // Updates Stage D migration (same idempotent pattern): the guided
    // onboarding's WhatsApp step is marked done in onboarding.wa_done —
    // set when a bill's WhatsApp link is actually generated, or ticked
    // manually by the owner. Older local DBs gain the column as 0.
    const obCols = sdb.prepare('PRAGMA table_info(onboarding)').all().map((c) => c.name);
    if (!obCols.includes('wa_done')) sdb.exec("ALTER TABLE onboarding ADD COLUMN wa_done INTEGER NOT NULL DEFAULT 0");
    // Features 4+5 migration (same idempotent pattern): the customer
    // hisab public-link token and due dates on invoices/purchases are
    // nullable columns — older local DBs gain them as NULL (no token =
    // link off, no due date = no alert); existing data is untouched.
    if (!custCols.includes('share_token')) sdb.exec("ALTER TABLE customers ADD COLUMN share_token TEXT");
    sdb.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_share_token ON customers(share_token)");
    // Admin Panel upgrade migration (same idempotent pattern): the super
    // admin can block an individual USER (not just a whole shop) — users
    // gain a blocked flag; existing users stay unblocked (0).
    const userCols = sdb.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    if (!userCols.includes('blocked')) sdb.exec("ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0");
    // Mobile-login migration (same idempotent pattern): users gain a
    // nullable login mobile (normalized 10-digit, set at signup or later
    // from Settings). Existing users stay NULL — a UNIQUE index still
    // allows any number of NULLs in SQLite, so old rows never collide;
    // the index only stops two accounts sharing one real number.
    if (!userCols.includes('mobile')) sdb.exec("ALTER TABLE users ADD COLUMN mobile TEXT");
    sdb.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile)");
    if (!invCols.includes('due_date')) sdb.exec("ALTER TABLE invoices ADD COLUMN due_date TEXT");
    if (!purCols.includes('due_date')) sdb.exec("ALTER TABLE purchases ADD COLUMN due_date TEXT");
    // Bill edit/cancel migration (same idempotent pattern): a cancelled
    // bill keeps its row (History shows it with the reason) but leaves
    // every total — cancelled_at/cancel_reason are nullable, existing
    // bills stay NULL = active. Data untouched.
    if (!invCols.includes('cancelled_at')) sdb.exec("ALTER TABLE invoices ADD COLUMN cancelled_at TEXT");
    if (!invCols.includes('cancel_reason')) sdb.exec("ALTER TABLE invoices ADD COLUMN cancel_reason TEXT");
    // Payment QR migration (same idempotent pattern): the shop's OWN
    // uploaded UPI QR image (JPEG data URL) for the printed bill —
    // nullable, older local DBs gain it as NULL (no QR on bills).
    if (!bizCols.includes('payment_qr')) sdb.exec("ALTER TABLE businesses ADD COLUMN payment_qr TEXT");
    // Feature 2 migration: stock_movements gains the 'return' movement
    // type. A CHECK constraint cannot be ALTERed in SQLite, so an older
    // table is rebuilt in place (rows copied verbatim, index recreated).
    const smRow = sdb.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'stock_movements'").get();
    if (smRow && smRow.sql && !smRow.sql.includes("'return'")) {
      sdb.exec(`
        CREATE TABLE stock_movements_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          business_id INTEGER NOT NULL REFERENCES businesses(id),
          product_id INTEGER NOT NULL REFERENCES products(id),
          type TEXT NOT NULL CHECK (type IN ('purchase','opening','sale','adjustment','return')),
          qty_change REAL NOT NULL,
          ref_id INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          sync_status TEXT NOT NULL DEFAULT 'local'
        );
        INSERT INTO stock_movements_new (id, business_id, product_id, type, qty_change, ref_id, created_at, updated_at, sync_status)
          SELECT id, business_id, product_id, type, qty_change, ref_id, created_at, updated_at, sync_status FROM stock_movements;
        DROP TABLE stock_movements;
        ALTER TABLE stock_movements_new RENAME TO stock_movements;
        CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id);
      `);
    }
    // Business Mart v2 migration (same idempotent pattern): quote payment
    // terms (advance % / credit days), order dispatch details (expected
    // date / transporter), bulk-inquiry grouping and listing photos are
    // nullable columns — older local DBs gain them as NULL; the new
    // mart_favourites table comes from SCHEMA_SQL above. Data untouched.
    const mqCols = sdb.prepare('PRAGMA table_info(mart_quotes)').all().map((c) => c.name);
    if (!mqCols.includes('advance_percent')) sdb.exec("ALTER TABLE mart_quotes ADD COLUMN advance_percent REAL");
    if (!mqCols.includes('credit_days')) sdb.exec("ALTER TABLE mart_quotes ADD COLUMN credit_days INTEGER");
    const moCols = sdb.prepare('PRAGMA table_info(mart_orders)').all().map((c) => c.name);
    if (!moCols.includes('advance_percent')) sdb.exec("ALTER TABLE mart_orders ADD COLUMN advance_percent REAL");
    if (!moCols.includes('credit_days')) sdb.exec("ALTER TABLE mart_orders ADD COLUMN credit_days INTEGER");
    if (!moCols.includes('expected_delivery_date')) sdb.exec("ALTER TABLE mart_orders ADD COLUMN expected_delivery_date TEXT");
    if (!moCols.includes('transporter_name')) sdb.exec("ALTER TABLE mart_orders ADD COLUMN transporter_name TEXT NOT NULL DEFAULT ''");
    const miCols = sdb.prepare('PRAGMA table_info(mart_inquiries)').all().map((c) => c.name);
    if (!miCols.includes('group_id')) sdb.exec("ALTER TABLE mart_inquiries ADD COLUMN group_id TEXT");
    const mlCols = sdb.prepare('PRAGMA table_info(mart_listings)').all().map((c) => c.name);
    if (!mlCols.includes('photo')) sdb.exec("ALTER TABLE mart_listings ADD COLUMN photo TEXT");
    // Session-expiry migration (same idempotent pattern): sessions and
    // admin_sessions gain a nullable expires_at. Rows that already exist
    // are backfilled to created_at + 30 days so NOBODY is logged out by
    // this deploy — the 30-day clock for old logins simply starts from
    // when they logged in.
    const sessCols = sdb.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
    if (!sessCols.includes('expires_at')) sdb.exec("ALTER TABLE sessions ADD COLUMN expires_at TEXT");
    sdb.exec("UPDATE sessions SET expires_at = datetime(created_at, '+30 days') WHERE expires_at IS NULL");
    const aSessCols = sdb.prepare('PRAGMA table_info(admin_sessions)').all().map((c) => c.name);
    if (!aSessCols.includes('expires_at')) sdb.exec("ALTER TABLE admin_sessions ADD COLUMN expires_at TEXT");
    sdb.exec("UPDATE admin_sessions SET expires_at = datetime(created_at, '+30 days') WHERE expires_at IS NULL");
    // Workspace-workflow migration (same idempotent pattern): businesses
    // gain the shop-setup fields (category / full address / PIN / state)
    // and the workspace_activated_at stamp. All empty/NULL on old rows —
    // the one-time backfill below stamps the shops that already exist.
    if (!bizCols.includes('category')) sdb.exec("ALTER TABLE businesses ADD COLUMN category TEXT NOT NULL DEFAULT ''");
    if (!bizCols.includes('address')) sdb.exec("ALTER TABLE businesses ADD COLUMN address TEXT NOT NULL DEFAULT ''");
    if (!bizCols.includes('landmark')) sdb.exec("ALTER TABLE businesses ADD COLUMN landmark TEXT NOT NULL DEFAULT ''");
    if (!bizCols.includes('pincode')) sdb.exec("ALTER TABLE businesses ADD COLUMN pincode TEXT NOT NULL DEFAULT ''");
    if (!bizCols.includes('state')) sdb.exec("ALTER TABLE businesses ADD COLUMN state TEXT NOT NULL DEFAULT ''");
    if (!bizCols.includes('workspace_activated_at')) sdb.exec("ALTER TABLE businesses ADD COLUMN workspace_activated_at TEXT");
    // ONE-TIME backfill (app_migrations marker): every pre-existing shop
    // that already has a name was set up under the old flow — stamp its
    // workspace as activated from its creation date so nothing about its
    // access changes. Account-only businesses (name still '') stay
    // un-activated, exactly as the two-stage workflow intends.
    const wsMark = sdb.prepare("SELECT name FROM app_migrations WHERE name = 'ws_backfill_v1'").get();
    if (!wsMark) {
      sdb.exec("UPDATE businesses SET workspace_activated_at = created_at WHERE name <> '' AND workspace_activated_at IS NULL");
      sdb.exec("INSERT INTO app_migrations (name) VALUES ('ws_backfill_v1')");
    }
    layer = sqliteLayer();
  } else {
    const { Pool, types } = require('pg');
    // Postgres returns int8 (COUNT, SUM of ints) and numeric as strings;
    // SQLite returns numbers. Parse them to numbers for identical payloads.
    types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));   // int8
    types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));   // numeric
    const isLocalHost = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
    pool = new Pool({
      connectionString: DATABASE_URL,
      // Hosted Postgres (Neon/Supabase/Render) expects TLS; a local test
      // Postgres (embedded/docker on localhost) usually has none.
      ssl: isLocalHost ? false : { rejectUnauthorized: false }
    });
    const client = await pool.connect();
    try {
      await client.query(PG_SCHEMA_SQL);
      // Updates Stage A migration (same as the SQLite branch): existing
      // cloud databases gain the UPI settings columns; fresh ones already
      // have them from the DDL above, so this is a no-op there.
      await client.query("ALTER TABLE businesses ADD COLUMN IF NOT EXISTS upi_id TEXT NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE businesses ADD COLUMN IF NOT EXISTS upi_payee_name TEXT NOT NULL DEFAULT ''");
      // Updates Stage B migration (same as the SQLite branch).
      await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS hsn_code TEXT NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS gstin TEXT NOT NULL DEFAULT ''");
      // Updates Stage C migration (same as the SQLite branch).
      await client.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'sale'");
      await client.query("ALTER TABLE purchases ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'purchase'");
      // Updates Stage D migration (same as the SQLite branch).
      await client.query("ALTER TABLE onboarding ADD COLUMN IF NOT EXISTS wa_done INTEGER NOT NULL DEFAULT 0");
      // Features 4+5 migration (same as the SQLite branch): hisab share
      // token + due dates, all nullable, existing rows stay NULL.
      await client.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS share_token TEXT");
      await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_share_token ON customers(share_token)");
      // Admin Panel upgrade migration (same as the SQLite branch): users
      // gain the per-user blocked flag; existing users stay unblocked.
      await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked INTEGER NOT NULL DEFAULT 0");
      // Mobile-login migration (same as the SQLite branch): nullable
      // login mobile on users; existing rows stay NULL (Postgres unique
      // indexes allow multiple NULLs, exactly like SQLite).
      await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile TEXT");
      await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile)");
      await client.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date TEXT");
      await client.query("ALTER TABLE purchases ADD COLUMN IF NOT EXISTS due_date TEXT");
      // Bill edit/cancel migration (same as the SQLite branch): nullable
      // cancellation stamp + reason on invoices; existing bills stay NULL.
      await client.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_at TEXT");
      await client.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancel_reason TEXT");
      // Payment QR migration (same as the SQLite branch): the shop's own
      // uploaded UPI QR image for the printed bill; NULL = no QR shown.
      await client.query("ALTER TABLE businesses ADD COLUMN IF NOT EXISTS payment_qr TEXT");
      // Feature 2 migration: widen the stock_movements type CHECK to
      // include 'return' (drop + re-add is a no-op outcome on fresh DBs,
      // whose DDL already carries the wider check).
      await client.query("ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check");
      await client.query("ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check CHECK (type IN ('purchase','opening','sale','adjustment','return'))");
      // Business Mart v2 migration (same as the SQLite branch): quote
      // payment terms, order dispatch details, bulk-inquiry grouping and
      // listing photos — all nullable, existing rows stay NULL.
      await client.query("ALTER TABLE mart_quotes ADD COLUMN IF NOT EXISTS advance_percent DOUBLE PRECISION");
      await client.query("ALTER TABLE mart_quotes ADD COLUMN IF NOT EXISTS credit_days INTEGER");
      await client.query("ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS advance_percent DOUBLE PRECISION");
      await client.query("ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS credit_days INTEGER");
      await client.query("ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS expected_delivery_date TEXT");
      await client.query("ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS transporter_name TEXT NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE mart_inquiries ADD COLUMN IF NOT EXISTS group_id TEXT");
      await client.query("ALTER TABLE mart_listings ADD COLUMN IF NOT EXISTS photo TEXT");
      // Session-expiry migration (same as the SQLite branch): nullable
      // expires_at on both session tables; existing rows backfilled to
      // created_at + 30 days so nobody is logged out by this deploy.
      await client.query("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at TEXT");
      await client.query("UPDATE sessions SET expires_at = to_char(created_at::timestamp + interval '30 days', 'YYYY-MM-DD HH24:MI:SS') WHERE expires_at IS NULL");
      await client.query("ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS expires_at TEXT");
      await client.query("UPDATE admin_sessions SET expires_at = to_char(created_at::timestamp + interval '30 days', 'YYYY-MM-DD HH24:MI:SS') WHERE expires_at IS NULL");
      // Workspace-workflow migration (same as the SQLite branch).
      await client.query("ALTER TABLE businesses ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE businesses ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE businesses ADD COLUMN IF NOT EXISTS landmark TEXT NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE businesses ADD COLUMN IF NOT EXISTS pincode TEXT NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE businesses ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE businesses ADD COLUMN IF NOT EXISTS workspace_activated_at TEXT");
      // ONE-TIME backfill (app_migrations marker) — see the SQLite branch.
      const wsMark = await client.query("SELECT name FROM app_migrations WHERE name = 'ws_backfill_v1'");
      if (!wsMark.rows.length) {
        await client.query("UPDATE businesses SET workspace_activated_at = created_at WHERE name <> '' AND workspace_activated_at IS NULL");
        await client.query("INSERT INTO app_migrations (name) VALUES ('ws_backfill_v1')");
      }
    } finally { client.release(); }
    layer = pgLayer();
  }
  layer.engine = ENGINE;
  layer.mode = MODE;
  layer.DB_PATH = DB_PATH;
  return layer;
}

// `db` is a proxy that forwards to the initialized layer, so callers can
// `const { db } = require('./db')` once and just `await db.init()` at boot.
const db = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'engine') return ENGINE;
    if (prop === 'mode') return MODE;
    if (prop === 'DB_PATH') return DB_PATH;
    if (prop === 'init') return init;
    if (!layer) throw new Error('db used before init() — call await db.init() first');
    const v = layer[prop];
    return typeof v === 'function' ? v.bind(layer) : v;
  }
});

module.exports = { db, DB_PATH, ENGINE, MODE, TABLES, MART_TABLES, SCHEMA_SQL, PG_SCHEMA_SQL };
