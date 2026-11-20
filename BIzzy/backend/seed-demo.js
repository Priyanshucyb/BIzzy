// Business OS v3 — DEMO DATA seed (v2 Stage 7 pack, v3 dual-engine)
// Run:  node backend/seed-demo.js      (or double-click load-demo.bat)
//       DATABASE_URL set ho to demo CLOUD (Postgres) me load hota hai;
//       warna local SQLite me (v2 wala behavior).
//
// Loads a living sample dukaan — "Sharma General Store" — as its OWN business,
// so a founder can demo the full app in 2 minutes. It writes directly into the
// same SQLite DB the server uses (schema comes from ./db.js) because demo bills
// need PAST dates, which the API deliberately cannot backdate.
//
// Safety:
//  - If demo@businessos.app already exists, this prints a message and exits
//    WITHOUT changing anything (idempotent — safe to run twice).
//  - Existing real businesses/users are never touched; the demo is a separate
//    business and server-enforced isolation keeps it apart.
//  - Every number is computed with the SAME rules the server uses
//    (GST-inclusive: item GST = amount × rate/(100+rate), totals = subtotal −
//    discount, COGS = qty × buy_price snapshot), so all API-derived values
//    (customer/supplier pending, product status, reports, profit) come out
//    exactly consistent.
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const round2 = (n) => { const r = Math.round((Number(n) + Number.EPSILON) * 100) / 100; return r === 0 ? 0 : r; };

// ---------- dates (same UTC convention as server.js) ----------
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const monthFrom = today.slice(0, 8) + '01';
const dayOfMonth = Number(today.slice(8, 10));
const monthDay = (d) => `${today.slice(0, 8)}${String(Math.min(d, dayOfMonth)).padStart(2, '0')}`;

async function main() {
await db.init();

// ---------- idempotency guard ----------
const existing = await db.get('SELECT id FROM users WHERE email = ?', 'demo@businessos.app');
if (existing) {
  console.log('');
  console.log('  Demo pehle se hai — demo data already loaded hai, kuch change nahi hua.');
  console.log('  Demo login: demo@businessos.app / demo1234');
  console.log('');
  process.exit(0);
}

// ---------- demo design (single source of truth for data + oracle numbers) ----------
const PRODUCTS = [
  // name, unit, buy, sell, gst%, low-limit, FINAL stock (after demo sales)
  { name: 'Atta 10kg',        unit: 'pack',  buy: 430, sell: 485, gst: 5,  low: 5, finalStock: 18, supplier: 'Gupta Traders' },
  { name: 'Cheeni 1kg',       unit: 'pack',  buy: 38,  sell: 45,  gst: 5,  low: 5, finalStock: 42, supplier: 'Gupta Traders' },
  { name: 'Sarso Tel 1L',     unit: 'litre', buy: 145, sell: 175, gst: 5,  low: 5, finalStock: 25, supplier: 'Fresh Supply Co' },
  { name: 'Arhar Daal 1kg',   unit: 'pack',  buy: 110, sell: 135, gst: 5,  low: 5, finalStock: 30, supplier: 'Fresh Supply Co' },
  { name: 'Basmati Chawal 5kg', unit: 'pack', buy: 320, sell: 399, gst: 5, low: 5, finalStock: 12, supplier: 'Fresh Supply Co' },
  { name: 'Tata Namak 1kg',   unit: 'pack',  buy: 24,  sell: 28,  gst: 5,  low: 5, finalStock: 55, supplier: 'Gupta Traders' },
  { name: 'Surf Excel 1kg',   unit: 'pack',  buy: 95,  sell: 115, gst: 18, low: 5, finalStock: 0,  supplier: 'Gupta Traders' },
  { name: 'Chai Patti 500g',  unit: 'pack',  buy: 210, sell: 260, gst: 5,  low: 5, finalStock: 3,  supplier: 'Fresh Supply Co' },
];
const CUSTOMERS = [
  { name: 'Ramesh Gupta', phone: '9811024681', city: 'Delhi' },
  { name: 'Sita Devi',    phone: '9811024682', city: 'Delhi' },
  { name: 'Mohd Salim',   phone: '9811024683', city: 'Delhi' },
  { name: 'Priya Sharma', phone: '9811024684', city: 'Delhi' },
];
// Chronological order — bill_no 1..9 is assigned in this order.
// paid: 'full' = poora paisa mila; a number = utna mila, baaki udhaar.
const INVOICES = [
  { daysAgo: 5, customer: 'Sita Devi',    items: [['Cheeni 1kg', 2], ['Tata Namak 1kg', 1]],                 discount: 0,  paid: 'full', mode: 'Cash' },
  { daysAgo: 5, customer: 'Mohd Salim',   items: [['Sarso Tel 1L', 1], ['Arhar Daal 1kg', 1]],               discount: 0,  paid: 'full', mode: 'UPI' },
  { daysAgo: 3, customer: 'Priya Sharma', items: [['Basmati Chawal 5kg', 1], ['Chai Patti 500g', 1]],        discount: 0,  paid: 'full', mode: 'UPI' },
  { daysAgo: 3, customer: 'Ramesh Gupta', items: [['Atta 10kg', 2], ['Surf Excel 1kg', 1]],                   discount: 0,  paid: 200,    mode: 'Cash' },
  { daysAgo: 1, customer: 'Sita Devi',    items: [['Sarso Tel 1L', 2], ['Cheeni 1kg', 1]],                    discount: 0,  paid: 'full', mode: 'Cash' },
  { daysAgo: 1, customer: 'Mohd Salim',   items: [['Tata Namak 1kg', 2], ['Chai Patti 500g', 1]],            discount: 0,  paid: 166,    mode: 'UPI' },
  { daysAgo: 0, customer: 'Ramesh Gupta', items: [['Atta 10kg', 1], ['Arhar Daal 1kg', 2]],                   discount: 0,  paid: 170,    mode: 'UPI' },
  { daysAgo: 0, customer: 'Priya Sharma', items: [['Surf Excel 1kg', 2], ['Cheeni 1kg', 2]],                  discount: 20, paid: 'full', mode: 'Cash' },
  { daysAgo: 0, customer: null,           items: [['Tata Namak 1kg', 1], ['Cheeni 1kg', 1]],                  discount: 0,  paid: 'full', mode: 'Cash' },
];
const SUPPLIER_PENDING_TARGET = 2300; // Fresh Supply Co ki khareed par itna dena baaki
const EXPENSES = [
  { title: 'Shop Rent',       category: 'Rent',        amount: 8000,  date: monthDay(1),  mode: 'Bank' },
  { title: 'Staff Salary',    category: 'Salary',      amount: 12000, date: monthDay(2),  mode: 'Cash' },
  { title: 'Bijli Bill',      category: 'Electricity', amount: 1450,  date: monthDay(5),  mode: 'UPI' },
  { title: 'Transport',       category: 'Transport',   amount: 600,   date: monthDay(8),  mode: 'Cash' },
  { title: 'Packing Material', category: 'Packing',    amount: 350,   date: monthDay(10), mode: 'Cash' },
  { title: 'Chai-Nashta',     category: 'Food',        amount: 120,   date: today,         mode: 'Cash' },
];

// ---------- derive invoice numbers exactly like the server ----------
const prodByName = {};
PRODUCTS.forEach((p) => { prodByName[p.name] = p; });
const soldQty = {};
PRODUCTS.forEach((p) => { soldQty[p.name] = 0; });

const billRows = INVOICES.map((spec) => {
  let subtotal = 0, gstRaw = 0, cogs = 0;
  const lines = spec.items.map(([pname, qty]) => {
    const p = prodByName[pname];
    const amount = round2(qty * p.sell);
    subtotal += amount;
    gstRaw += amount * p.gst / (100 + p.gst); // GST ON hai — server ka formula
    cogs += qty * p.buy;
    soldQty[pname] += qty;
    return { product: p, qty, amount };
  });
  const total = round2(round2(subtotal) - spec.discount);
  const paid = spec.paid === 'full' ? total : spec.paid;
  return {
    date: daysAgo(spec.daysAgo), customerName: spec.customer, lines,
    subtotal: round2(subtotal), discount: spec.discount,
    gst: round2(gstRaw), total, paid, cogs: round2(cogs), mode: spec.mode,
  };
});

// Purchase qty per product = final stock + sold qty (stock kabhi negative nahi hoga,
// kyunki dono purchases saari bikri se pehle ki date — 6 din pehle — par hain).
const purchaseDate = daysAgo(6);

// ---------- oracle numbers (script ki apni arithmetic — yahi print hoga) ----------
let todaysSale = 0, monthSale = 0, monthCogs = 0, pendingCollection = 0;
for (const b of billRows) {
  if (b.date === today) todaysSale += b.total;
  if (b.date >= monthFrom && b.date <= today) { monthSale += b.total; monthCogs += b.cogs; }
  pendingCollection += (b.total - b.paid);
}
const monthExpenses = EXPENSES.reduce((s, e) => s + e.amount, 0);
const monthNet = round2(round2(monthSale) - round2(monthCogs) - monthExpenses);
const stockValue = PRODUCTS.reduce((s, p) => s + p.finalStock * p.buy, 0);

// ---------- insert everything (one transaction) ----------
if (db.engine === 'sqlite') { try { await db.exec('PRAGMA busy_timeout = 5000'); } catch (_) { /* best effort */ } }
const tx = await db.begin();
try {
  const biz = await tx.run(
    `INSERT INTO businesses (name, owner_name, phone, city, gst_enabled, gstin, language)
     VALUES ('Sharma General Store', 'Sharma ji', '9811024680', 'Delhi', 1, '07ABCDE1234F1Z5', 'en')`
  );
  const bizId = biz.lastInsertRowid;

  const ownerHash = bcrypt.hashSync('demo1234', 10);
  await tx.run(
    `INSERT INTO users (business_id, name, email, password_hash, role, access)
     VALUES (?, 'Sharma ji', 'demo@businessos.app', ?, 'owner', 'all')`
  , bizId, ownerHash);
  const staffHash = bcrypt.hashSync('staff1234', 10);
  await tx.run(
    `INSERT INTO users (business_id, name, email, password_hash, role, access)
     VALUES (?, 'Counter Staff', 'counter@businessos.app', ?, 'staff', 'billing')`
  , bizId, staffHash);

  const prodId = {};
  for (const p of PRODUCTS) {
    const r = await tx.run(
      `INSERT INTO products (business_id, name, category, unit, buy_price, sell_price, gst_rate, stock_qty, low_stock_limit)
       VALUES (?, ?, 'Grocery', ?, ?, ?, ?, ?, ?)`
    , bizId, p.name, p.unit, p.buy, p.sell, p.gst, p.finalStock, p.low);
    prodId[p.name] = r.lastInsertRowid;
  }

  const supId = {};
  for (const sname of ['Gupta Traders', 'Fresh Supply Co']) {
    const r = await tx.run(
      `INSERT INTO suppliers (business_id, name, phone, city) VALUES (?, ?, ?, 'Delhi')`
    , bizId, sname, sname === 'Gupta Traders' ? '9811098765' : '9811076543');
    supId[sname] = r.lastInsertRowid;
  }

  // Purchases: supplier-wise items, qty = final stock + sold.
  const insPurchase =
    `INSERT INTO purchases (business_id, supplier_id, bill_no, date, total, paid_amount, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const insPItem =
    `INSERT INTO purchase_items (business_id, purchase_id, product_id, qty, buy_price, amount) VALUES (?, ?, ?, ?, ?, ?)`;
  const insSPay =
    `INSERT INTO supplier_payments (business_id, purchase_id, amount, mode, date) VALUES (?, ?, ?, ?, ?)`;
  const insMove =
    `INSERT INTO stock_movements (business_id, product_id, type, qty_change, ref_id) VALUES (?, ?, ?, ?, ?)`;
  const purchaseSpecs = [
    { supplier: 'Gupta Traders', billNo: 'GT-1024', paidMode: 'Cash', pending: 0 },
    { supplier: 'Fresh Supply Co', billNo: 'FS-518', paidMode: 'Bank', pending: SUPPLIER_PENDING_TARGET },
  ];
  let pendingSupplier = 0;
  for (const ps of purchaseSpecs) {
    const items = PRODUCTS.filter((p) => p.supplier === ps.supplier)
      .map((p) => ({ p, qty: p.finalStock + soldQty[p.name] }));
    const total = round2(items.reduce((s, i) => s + i.qty * i.p.buy, 0));
    const paid = round2(total - ps.pending);
    pendingSupplier += ps.pending;
    const r = await tx.run(insPurchase, bizId, supId[ps.supplier], ps.billNo, purchaseDate, total, paid,
      `${purchaseDate} 09:00:00`, `${purchaseDate} 09:00:00`);
    const purchaseId = r.lastInsertRowid;
    for (const i of items) {
      await tx.run(insPItem, bizId, purchaseId, prodId[i.p.name], i.qty, i.p.buy, round2(i.qty * i.p.buy));
      await tx.run(insMove, bizId, prodId[i.p.name], 'purchase', i.qty, purchaseId);
    }
    if (paid > 0) await tx.run(insSPay, bizId, purchaseId, paid, ps.paidMode, purchaseDate);
  }

  const custId = {};
  for (const c of CUSTOMERS) {
    const r = await tx.run(
      `INSERT INTO customers (business_id, name, phone, city) VALUES (?, ?, ?, ?)`
    , bizId, c.name, c.phone, c.city);
    custId[c.name] = r.lastInsertRowid;
  }

  const insInvoice =
    `INSERT INTO invoices (business_id, bill_no, customer_id, customer_name, date, subtotal, discount,
       gst_enabled, gst_amount, total, paid_amount, payment_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`;
  const insIItem =
    `INSERT INTO invoice_items (business_id, invoice_id, product_id, product_name, qty, sell_price, buy_price, gst_rate, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const insCPay =
    `INSERT INTO customer_payments (business_id, invoice_id, amount, mode, date) VALUES (?, ?, ?, ?, ?)`;
  for (let idx = 0; idx < billRows.length; idx++) {
    const b = billRows[idx];
    const billNo = idx + 1;
    const r = await tx.run(insInvoice, bizId, billNo,
      b.customerName ? custId[b.customerName] : null,
      b.customerName || 'Walk-in',
      b.date, b.subtotal, b.discount, b.gst, b.total, b.paid,
      b.paid > 0 ? b.mode : null, `${b.date} 11:00:00`, `${b.date} 11:00:00`);
    const invoiceId = r.lastInsertRowid;
    for (const l of b.lines) {
      await tx.run(insIItem, bizId, invoiceId, prodId[l.product.name], l.product.name, l.qty,
        l.product.sell, l.product.buy, l.product.gst, l.amount);
      await tx.run(insMove, bizId, prodId[l.product.name], 'sale', -l.qty, invoiceId);
    }
    if (b.paid > 0) await tx.run(insCPay, bizId, invoiceId, b.paid, b.mode, b.date);
  }

  const insExpense =
    `INSERT INTO expenses (business_id, title, category, amount, date, payment_mode, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`;
  for (const e of EXPENSES) {
    await tx.run(insExpense, bizId, e.title, e.category, e.amount, e.date, e.mode, `${e.date} 10:00:00`, `${e.date} 10:00:00`);
  }

  await tx.commit();

  // ---------- summary (insaan ke liye) + oracle (tests ke liye KEY=VALUE) ----------
  console.log('');
  console.log('  ============================================================');
  console.log('  DEMO DATA LOAD HO GAYA — Sharma General Store taiyaar hai!');
  console.log('  ============================================================');
  if (db.mode === 'cloud') console.log('  App chalao:  server ko usi DATABASE_URL ke saath start karo (ya deployed URL kholo).');
  else console.log('  App chalao:  start-business-os.bat  (http://localhost:4000)');
  console.log('');
  console.log('  Demo logins:');
  console.log('    Owner (sab kuch):  demo@businessos.app    / demo1234');
  console.log('    Staff (billing):   counter@businessos.app / staff1234');
  console.log('');
  console.log(`  Aaj ki sale (expected):        ₹${round2(todaysSale)}`);
  console.log(`  Is mahine ka net profit (${monthFrom} se ${today}): ₹${monthNet}`);
  console.log('    (Note: poori salary + kiraya is mahine ke kharche me hai,');
  console.log('     isliye net abhi negative dikh sakta hai — ye asli hisaab hai.)');
  console.log(`  Kul lena hai (udhaar pending): ₹${round2(pendingCollection)}`);
  console.log('    - Ramesh Gupta: ₹1470 (sabse bada udhaar)');
  console.log('    - Mohd Salim:   ₹150');
  console.log(`  Supplier ko dena baaki:        ₹${round2(pendingSupplier)} (Fresh Supply Co)`);
  console.log('  Low stock alert: Chai Patti 500g (sirf 3 bache), Surf Excel 1kg (khatm)');
  console.log('  Final stock: ' + PRODUCTS.map((p) => `${p.name} = ${p.finalStock}`).join(', '));
  console.log('');
  console.log('  Demo kaise dikhana hai: DEMO-GUIDE.md dekho.');
  console.log('');
  // Machine-readable oracle — parent/tests inhi numbers se API verify karte hain.
  console.log(`TODAY=${today}`);
  console.log(`TODAYS_SALE=${round2(todaysSale)}`);
  console.log(`MONTH_FROM=${monthFrom}`);
  console.log(`MONTH_TO=${today}`);
  console.log(`MONTH_SALE=${round2(monthSale)}`);
  console.log(`MONTH_COGS=${round2(monthCogs)}`);
  console.log(`MONTH_EXPENSES=${monthExpenses}`);
  console.log(`MONTH_NET_PROFIT=${monthNet}`);
  console.log(`PENDING_COLLECTION=${round2(pendingCollection)}`);
  console.log(`PENDING_SUPPLIER=${round2(pendingSupplier)}`);
  console.log(`STOCK_VALUE=${stockValue}`);
} catch (e) {
  try { await tx.rollback(); } catch (_) { /* ignore */ }
  console.error('');
  console.error('  Demo data load NAHI hua: ' + e.message);
  console.error('  Agar app (server) chal raha hai to pehle use band karo, phir dobara try karo.');
  console.error('');
  process.exit(1);
}
}

main().then(() => process.exit(0)).catch((e) => { console.error('  Seed error:', e); process.exit(1); });
