// Business OS v3 — Stage A (Cloud Backend) on top of the complete v2 feature set:
// Stage 1 (Foundation) + Stage 2 (Stock flow) + Stage 3 (Billing flow)
// + Stage 4 (Expenses, Reports & Profit — owner-only finance)
// + Stage 5 (WhatsApp click-to-send: text bill + udhaar reminder via wa.me links)
// + Stage 6 (Offline kasauti + staff-access audit + polish: owner DB backup,
// JSON 404/500 for the API)
// + Stage 7 (Sell-ready pack: demo seed — backend/seed-demo.js / load-demo.bat,
// DEMO-GUIDE.md, final README).
// + SaaS Stage 1 (Kaam wala hisa): GST report + monthly reports (owner-only,
// same finance formula), global search (per-role sections, own business only).
// + SaaS Stage 3 (Bharosa wala hisa): auto-backup snapshots + restore
// (pre-restore safety snapshot, owner-only), CSV/Excel exports, audit /
// history log, in-app Help (Hindi articles + admin-configured WhatsApp
// support), and the Stage B sync engine — a local instance pushes/pulls
// over HTTP to a hub instance of this same app (SYNC_HUB_URL), uuid-mapped
// rows (sync_ids, no ALTERs), append-only entries, master-data
// last-write-wins with an owner-only conflict history, hub-assigned final
// bill numbers, and stock that only ever moves as stock_movements.
// + SaaS Stage 2 (SaaS wala hisa): email-OTP signup + OTP forgot-password
// (mailer.js; dev mode logs the code when no mail config — never in API
// responses), 30-day free trial + plans/subscription with grace → read-only
// enforcement, manual/UPI payment claims + Razorpay-ready gateway endpoints
// (501 until the founder's keys are configured), DILIGENCE super admin
// (platform_admins — separate from business users), 5-minute onboarding
// checklist. Pre-existing users/businesses are treated as verified and get
// a trial from migration day — nobody is locked out by this stage arriving.
// + Updates Stage B (GST Portal Pack): GSTR-1 portal-ready output for ALL
// plans (owner-only; summary reconciles with the Stage 1 GST report by
// construction, download is the official offline-tool JSON shape or a flat
// CSV register — the file is filed ON the GST portal, never in-app), plus
// E-Way Bill / E-Invoice portal-ready JSON per invoice, gated to the TOP
// PLAN only (403 top_plan_required otherwise; generation itself is free
// on the government portals — these endpoints only prepare the file).
// New additive fields customers.gstin + products.hsn_code feed the B2B/B2C
// split and the HSN summary (see db.js Stage B migration).
// + Updates Stage A (UPI QR + payment link): owner-set UPI ID / payee name
// in business settings; every bill with a balance gets a scan-to-pay QR
// (payload upi://pay?pa=..&pn=..&am=<balance>&cu=INR&tn=Bill <no>) rendered
// in the bill detail screen and the print/PDF view, generated LOCALLY by
// the vendored pure-JS generator in qrcode.js — no CDN, no external call,
// the offline rule is untouched. WhatsApp bill/reminder texts carry the
// UPI ID + pay link when an ID is set; no ID set → no QR, no pay line,
// nothing faked.
// + Updates Stage C (Data Import): owner-only CSV/TSV import of products,
// customers and suppliers with Vyapar/Tally-style header auto-mapping,
// preview (kuch write nahi hota) + one-transaction commit, a safety
// backup snapshot before every commit, and opening balances carried as
// kind='opening' invoice/purchase rows (bill_no 0, gst_enabled 0, no
// items) — they count in every pending total and are payable through the
// NORMAL payment endpoints, while every sale-side report query filters
// kind='sale', so sales / profit / GST / GSTR-1 only ever see real bills.
// No xlsx parser exists in node_modules, so .xlsx is honestly NOT
// supported — the UI asks for "Save As CSV" instead of faking it.
// + Admin overview + split deploy (founder ask 2026-11-20): the super
// admin summary also carries growth/attention metadata (signup counts +
// 14-day trend, trials ending soon, plan distribution, MRR estimate,
// onboarding-stuck + recent-signup lists, claims history) and a per-shop
// detail endpoint — still strictly metadata-only. CORS is hand-rolled
// from ALLOWED_ORIGINS and the frontend reads its API base from
// frontend/config.js (window.BOS_API_BASE), so the same code runs
// single-service (unchanged) or split: frontend on Vercel, backend here.
// v3 Stage A: the SAME app runs in two modes, chosen by environment —
//   LOCAL (no DATABASE_URL): SQLite file, exactly v2 behavior (zero outbound
//   network calls; the only external string is the wa.me URL handed to the
//   browser in Stage 5 link responses).
//   CLOUD (DATABASE_URL set): all data in PostgreSQL via the dual-engine
//   data layer (see db.js); local mode is untouched.
// Auth (bcrypt + session tokens), business setup (GST + language), staff foundation,
// products/inventory, suppliers, purchases with stock movements + supplier payments,
// customers, GST-aware invoices with stock decrease + customer payments (udhaar),
// expenses, and profit reports: Sale − COGS (bika maal ki laagat) − Expenses.
// Purchases are stock, NOT an expense — they never enter the profit formula.
// Every protected query is scoped by the session's business_id — server-enforced isolation.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { db, TABLES } = require('./db');
const { sendMail, mailConfig } = require('./mailer');
const { qrSvg } = require('./qrcode');

const app = express();
const PORT = process.env.PORT || 4000;

// ---------- CORS (split deploy: frontend on Vercel, backend on Render) ----------
// Hand-rolled, no new dependency. ALLOWED_ORIGINS (comma-separated) set →
// only those origins are reflected; unset → any Origin is reflected
// (local/dev + single-service default; production split deploys MUST set
// it — see DEPLOY-GUIDE.md). Requests without an Origin header (curl,
// server-to-server sync hub calls, same-origin browser calls) pass
// through untouched, and same-origin behavior is unaffected either way:
// the browser only enforces CORS cross-origin.
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (!ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  // Preflight is answered here, before any auth — the browser sends it
  // without credentials by design.
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// 10mb body limit: Stage C import posts a whole CSV file as JSON text
// (up to 5000 rows) — the 100kb default would reject real Vyapar exports.
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend'), {
  setHeaders(res, filePath) {
    // Code + manifest + service worker must always revalidate so updates and
    // the PWA land immediately; images are content-stable and can cache a day.
    if (/\.(html|js|css|webmanifest)$/i.test(filePath) || /sw\.js$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (/\.(png|jpe?g|svg|ico|webp|gif)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// Express 4 does not forward rejected promises from async handlers to the
// error middleware — wrap the verb methods so every async route/middleware
// registered below gets its rejections routed to next(err). Arity is
// preserved because Express treats 4-arg functions as error handlers.
function wrapAsync(fn) {
  if (typeof fn !== 'function') return fn;
  if (fn.length === 4) {
    return function (err, req, res, next) {
      const r = fn(err, req, res, next);
      if (r && typeof r.catch === 'function') r.catch(next);
    };
  }
  return function (req, res, next) {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  };
}
for (const m of ['get', 'post', 'put', 'delete', 'use']) {
  const orig = app[m].bind(app);
  app[m] = (...args) => orig(...args.map(wrapAsync));
}

// ---------- helpers ----------
function makeToken() { return crypto.randomBytes(32).toString('hex'); }

function publicUser(u) {
  return { id: u.id, business_id: u.business_id, name: u.name, email: u.email, role: u.role, access: u.access, blocked: !!u.blocked };
}
function publicBusiness(b) {
  if (!b) return null;
  return {
    id: b.id, name: b.name, owner_name: b.owner_name, phone: b.phone, city: b.city,
    gst_enabled: !!b.gst_enabled, gstin: b.gstin,
    upi_id: b.upi_id || '', upi_payee_name: b.upi_payee_name || '',
    payment_qr: b.payment_qr || null,
    language: ['hi', 'hg'].includes(b.language) ? b.language : 'en',
    setup_complete: !!(b.name && b.name.trim()),
    updated_at: b.updated_at, sync_status: b.sync_status
  };
}
async function getBusiness(id) { return await db.get('SELECT * FROM businesses WHERE id = ?', id); }

// ---------- auth middleware ----------
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  const row = await db.get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
  , token);
  if (row) {
    // Admin Panel upgrade: a user blocked by the super admin is locked
    // out immediately — every request with their (still-existing) token
    // is refused, so a block takes effect without waiting for logout.
    if (row.blocked) return res.status(403).json({ error: 'account_blocked' });
    req.user = row;
    req.token = token;
    return next();
  }
  // SaaS Stage 2: DILIGENCE super-admin sessions live in admin_sessions and
  // resolve to a platform_admins row — business_id is null, role is
  // 'superadmin', and every business-scoped guard below treats it as an
  // outsider (requireOwner 403s it; admin routes require it explicitly).
  const arow = await db.get(
    `SELECT a.* FROM admin_sessions s JOIN platform_admins a ON a.id = s.admin_id WHERE s.token = ?`
  , token);
  if (!arow) return res.status(401).json({ error: 'unauthorized' });
  req.user = { id: arow.id, business_id: null, name: arow.name, email: arow.email, role: 'superadmin', access: 'all' };
  req.token = token;
  req.isAdmin = true;
  next();
}
function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'owner_only' });
  next();
}

// ---------- health ----------
app.get('/api/health', async (req, res) => {
  res.json({ ok: true, mode: db.mode, db: db.engine, stage: 'A', app: 'BizYour by DILIGENCE', modules: ['workspace', 'business-mart'] });
});

// ---------- auth API ----------
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
  const emailNorm = String(email).trim().toLowerCase();
  const existing = await db.get('SELECT * FROM users WHERE email = ?', emailNorm);
  if (existing) {
    // A half-finished signup (OTP never verified) is not "registered" —
    // point the caller at the OTP step instead of a dead end.
    const pend = await db.get('SELECT id FROM pending_signups WHERE user_id = ?', existing.id);
    if (pend) return res.status(409).json({ error: 'email_pending_verification' });
    return res.status(409).json({ error: 'email already registered' });
  }

  // Create empty business + owner user together — but PENDING: the user
  // row gets a pending_signups marker, no session is issued, and login
  // refuses until the email OTP is verified (see verify-otp below, which
  // is also when the free trial starts).
  const biz = await db.run(
    `INSERT INTO businesses (name, owner_name) VALUES ('', ?)`
  , String(name).trim());
  const hash = bcrypt.hashSync(String(password), 10);
  const user = await db.run(
    `INSERT INTO users (business_id, name, email, password_hash, role, access) VALUES (?, ?, ?, ?, 'owner', 'all')`
  , biz.lastInsertRowid, String(name).trim(), emailNorm, hash);
  await db.run('INSERT INTO pending_signups (user_id, email) VALUES (?, ?)', user.lastInsertRowid, emailNorm);

  const issued = await issueOtp(emailNorm, 'signup');
  if (issued.error) return res.status(429).json(issued);
  res.status(201).json({
    pending_verification: true, email: emailNorm,
    mail_configured: issued.mail_configured, otp_sent: issued.sent
  });
});

// Verify the signup OTP → account activates, trial starts, session issued.
app.post('/api/auth/verify-otp', async (req, res) => {
  const { email, otp } = req.body || {};
  if (!email || !otp) return res.status(400).json({ error: 'email and otp are required' });
  const emailNorm = String(email).trim().toLowerCase();
  const u = await db.get('SELECT * FROM users WHERE email = ?', emailNorm);
  if (!u) return res.status(404).json({ error: 'account_not_found' });
  const pend = await db.get('SELECT id FROM pending_signups WHERE user_id = ?', u.id);
  if (!pend) return res.status(400).json({ error: 'not_pending_verification' });
  const v = await verifyOtp(emailNorm, 'signup', otp);
  if (v.error) return res.status(400).json(v);
  await db.run('DELETE FROM pending_signups WHERE user_id = ?', u.id);
  await ensureSubscription(u.business_id); // 30-day trial starts at verification
  const token = makeToken();
  await db.run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', token, u.id);
  res.json({ token, user: publicUser(u), business: publicBusiness(await getBusiness(u.business_id)) });
});

// Resend an OTP (signup verification or password reset). Cooldown applies.
app.post('/api/auth/resend-otp', async (req, res) => {
  const { email, purpose } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });
  const emailNorm = String(email).trim().toLowerCase();
  const p = purpose === 'reset' ? 'reset' : 'signup';
  const u = await db.get('SELECT * FROM users WHERE email = ?', emailNorm);
  if (p === 'signup') {
    if (!u) return res.status(404).json({ error: 'account_not_found' });
    const pend = await db.get('SELECT id FROM pending_signups WHERE user_id = ?', u.id);
    if (!pend) return res.status(400).json({ error: 'not_pending_verification' });
  } else {
    // Reset resend never reveals whether the email exists.
    if (!u) return res.json({ ok: true, mail_configured: mailConfig().configured });
    const pend = await db.get('SELECT id FROM pending_signups WHERE user_id = ?', u.id);
    if (pend) return res.status(400).json({ error: 'email_not_verified' });
  }
  const issued = await issueOtp(emailNorm, p);
  if (issued.error) return res.status(429).json(issued);
  res.json({ ok: true, mail_configured: issued.mail_configured, otp_sent: issued.sent });
});

// Forgot password: issue a reset OTP. Response is the same shape whether
// or not the email exists (no account enumeration); mail_configured is
// always reported honestly.
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });
  const emailNorm = String(email).trim().toLowerCase();
  const u = await db.get('SELECT * FROM users WHERE email = ?', emailNorm);
  let configured = mailConfig().configured;
  if (u) {
    const pend = await db.get('SELECT id FROM pending_signups WHERE user_id = ?', u.id);
    if (!pend) {
      const issued = await issueOtp(emailNorm, 'reset');
      if (issued.error) return res.status(429).json(issued);
      configured = issued.mail_configured;
    }
  }
  res.json({ ok: true, mail_configured: configured });
});

// Reset password with the OTP → new bcrypt hash, all sessions killed.
app.post('/api/auth/reset-password', async (req, res) => {
  const { email, otp, password } = req.body || {};
  if (!email || !otp || !password) return res.status(400).json({ error: 'email, otp and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
  const emailNorm = String(email).trim().toLowerCase();
  const u = await db.get('SELECT * FROM users WHERE email = ?', emailNorm);
  if (!u) return res.status(404).json({ error: 'account_not_found' });
  const v = await verifyOtp(emailNorm, 'reset', otp);
  if (v.error) return res.status(400).json(v);
  await db.run(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`
  , bcrypt.hashSync(String(password), 10), u.id);
  await db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
  res.json({ ok: true });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  const emailNorm = String(email).trim().toLowerCase();
  const u = await db.get('SELECT * FROM users WHERE email = ?', emailNorm);
  if (u && bcrypt.compareSync(String(password), u.password_hash)) {
    // SaaS Stage 2: an OTP-pending account cannot log in yet.
    const pend = await db.get('SELECT id FROM pending_signups WHERE user_id = ?', u.id);
    if (pend) return res.status(403).json({ error: 'email_not_verified' });
    // Admin Panel upgrade: a user blocked by the super admin cannot log in.
    if (u.blocked) return res.status(403).json({ error: 'account_blocked' });
    const token = makeToken();
    await db.run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', token, u.id);
    return res.json({ token, user: publicUser(u), business: publicBusiness(await getBusiness(u.business_id)) });
  }
  // SaaS Stage 2: the same login form serves the DILIGENCE super admin
  // (seeded from SUPER_ADMIN_* env into platform_admins at boot).
  const adm = await db.get('SELECT * FROM platform_admins WHERE email = ?', emailNorm);
  if (adm && bcrypt.compareSync(String(password), adm.password_hash)) {
    const token = makeToken();
    await db.run('INSERT INTO admin_sessions (token, admin_id) VALUES (?, ?)', token, adm.id);
    return res.json({
      token,
      user: { id: adm.id, business_id: null, name: adm.name, email: adm.email, role: 'superadmin', access: 'all' },
      business: null
    });
  }
  return res.status(401).json({ error: 'invalid email or password' });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  if (req.isAdmin) await db.run('DELETE FROM admin_sessions WHERE token = ?', req.token);
  else await db.run('DELETE FROM sessions WHERE token = ?', req.token);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  if (req.isAdmin) return res.json({ user: publicUser(req.user), business: null });
  const b = await getBusiness(req.user.business_id);
  res.json({ user: publicUser(req.user), business: publicBusiness(b) });
});

// =====================================================================
// ---------- SaaS Stage 2: OTP, subscriptions, payments, admin ----------
// =====================================================================
// Timestamp helpers — the app stores UTC text 'YYYY-MM-DD HH:MM:SS'
// everywhere (see db.js parity note); all SaaS dates follow the same
// format so string comparison is chronological in both engines.
function fmtTs(d) { return d.toISOString().replace('T', ' ').slice(0, 19); }
function parseTs(t) { return new Date(String(t).replace(' ', 'T') + 'Z'); }
function addDaysTs(t, days) { const d = parseTs(t); d.setUTCDate(d.getUTCDate() + Number(days)); return fmtTs(d); }

// ---------- email OTP machinery (signup + reset share it) ----------
const OTP_TTL_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SEC = 60;

// Issues a fresh OTP for (email, purpose): any previous code for the same
// pair is replaced (one active OTP per email+purpose). The code is stored
// bcrypt-hashed; the plain code leaves the server ONLY inside the email
// (or, with no mail config, the server console log via mailer.js).
async function issueOtp(email, purpose) {
  const last = await db.get(
    `SELECT * FROM email_otps WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1`
  , email, purpose);
  if (last) {
    const ageSec = (Date.now() - parseTs(last.created_at).getTime()) / 1000;
    if (ageSec < OTP_RESEND_COOLDOWN_SEC) {
      return { error: 'otp_resend_too_soon', retry_after: Math.ceil(OTP_RESEND_COOLDOWN_SEC - ageSec) };
    }
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const hash = bcrypt.hashSync(code, 10);
  const expires = fmtTs(new Date(Date.now() + OTP_TTL_MIN * 60000));
  await db.run('DELETE FROM email_otps WHERE email = ? AND purpose = ?', email, purpose);
  await db.run(
    `INSERT INTO email_otps (email, purpose, code_hash, expires_at) VALUES (?, ?, ?, ?)`
  , email, purpose, hash, expires);
  const subject = purpose === 'reset'
    ? 'BizYour — password reset code'
    : 'BizYour — verify your email';
  const mail = await sendMail(email, subject,
    `Your BizYour code is ${code}. It is valid for ${OTP_TTL_MIN} minutes. If you did not ask for this, ignore this email.`);
  return { ok: true, mail_configured: mail.mail_configured, sent: mail.sent };
}

// Verifies (and on success consumes) the active OTP for (email, purpose).
async function verifyOtp(email, purpose, code) {
  const row = await db.get(
    `SELECT * FROM email_otps WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1`
  , email, purpose);
  if (!row) return { error: 'otp_not_found' };
  if (fmtTs(new Date()) > row.expires_at) {
    await db.run('DELETE FROM email_otps WHERE id = ?', row.id);
    return { error: 'otp_expired' };
  }
  if (Number(row.attempts) >= OTP_MAX_ATTEMPTS) {
    await db.run('DELETE FROM email_otps WHERE id = ?', row.id);
    return { error: 'otp_attempts_exceeded' };
  }
  if (!bcrypt.compareSync(String(code), row.code_hash)) {
    const attempts = Number(row.attempts) + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await db.run('DELETE FROM email_otps WHERE id = ?', row.id);
      return { error: 'otp_attempts_exceeded' };
    }
    await db.run(`UPDATE email_otps SET attempts = ?, updated_at = datetime('now') WHERE id = ?`, attempts, row.id);
    return { error: 'invalid_otp', attempts_left: OTP_MAX_ATTEMPTS - attempts };
  }
  await db.run('DELETE FROM email_otps WHERE id = ?', row.id);
  return { ok: true };
}

// ---------- subscriptions ----------
// One row per business. Status is COMPUTED from stored dates + the
// admin block flag, so time alone moves trial → grace → expired:
//   blocked flag            → 'blocked'  (read-only)
//   now ≤ paid_until        → 'active'
//   now ≤ paid_until+grace  → 'grace'    (full access)
//   paid_until in past      → 'expired'  (read-only)
//   now ≤ trial_ends_at     → 'trial'
//   now ≤ trial_end+grace   → 'grace'
//   otherwise               → 'expired'
// Read-only = expired or blocked. Grace keeps full access.
const TRIAL_DAYS = 30; // founder call (2026-11-22): free trial is 30 days
async function ensureSubscription(bizId) {
  let sub = await db.get('SELECT * FROM subscriptions WHERE business_id = ?', bizId);
  if (!sub) {
    // New business — or a pre-Stage-2 business meeting this code for the
    // first time: a fresh 30-day trial starts NOW (migration rule — the
    // demo seed and every existing shop keep full access). Existing
    // subscriptions keep their stored trial_ends_at untouched — the new
    // length applies only when a row is first created here.
    await db.run(
      `INSERT INTO subscriptions (business_id, trial_ends_at, grace_days) VALUES (?, ?, 7)`
    , bizId, addDaysTs(fmtTs(new Date()), TRIAL_DAYS));
    sub = await db.get('SELECT * FROM subscriptions WHERE business_id = ?', bizId);
  }
  return sub;
}
function subscriptionState(sub) {
  const now = fmtTs(new Date());
  const grace = Number(sub.grace_days || 7);
  let status;
  if (sub.blocked) status = 'blocked';
  else if (sub.paid_until && now <= sub.paid_until) status = 'active';
  else if (sub.paid_until && now <= addDaysTs(sub.paid_until, grace)) status = 'grace';
  else if (sub.paid_until) status = 'expired';
  else if (sub.trial_ends_at && now <= sub.trial_ends_at) status = 'trial';
  else if (sub.trial_ends_at && now <= addDaysTs(sub.trial_ends_at, grace)) status = 'grace';
  else status = 'expired';
  const endsAt = sub.paid_until || sub.trial_ends_at || null;
  const daysLeft = endsAt ? Math.ceil((parseTs(endsAt).getTime() - Date.now()) / 86400000) : 0;
  return {
    status, plan_code: sub.plan_code || null,
    trial_ends_at: sub.trial_ends_at || null, paid_until: sub.paid_until || null,
    grace_days: grace, blocked: !!sub.blocked,
    ends_at: endsAt, days_left: daysLeft,
    read_only: status === 'expired' || status === 'blocked'
  };
}
async function getSubscriptionState(bizId) {
  return subscriptionState(await ensureSubscription(bizId));
}
function publicPlan(p) {
  return {
    code: p.code, name: p.name, duration_days: Number(p.duration_days),
    price: round2(p.price), grace_days: Number(p.grace_days), is_active: !!p.is_active
  };
}
function publicSubPayment(p) {
  return {
    id: p.id, business_id: p.business_id, plan_code: p.plan_code,
    amount: round2(p.amount), method: p.method, reference: p.reference,
    status: p.status, invoice_no: p.invoice_no,
    period_from: p.period_from, period_to: p.period_to, created_at: p.created_at
  };
}

// Extends a business's subscription by a plan period — shared by manual
// claim approval, gateway verification and admin extend is separate (no
// payment row, so revenue is never faked). Extension base: the current
// end (paid_until, else trial end) when still in the future, else today.
async function extendSubscription(bizId, plan) {
  const sub = await ensureSubscription(bizId);
  const now = fmtTs(new Date());
  const currentEnd = sub.paid_until || sub.trial_ends_at;
  const base = currentEnd && currentEnd > now ? currentEnd : now;
  const newEnd = addDaysTs(base, plan.duration_days);
  await db.run(
    `UPDATE subscriptions SET plan_code = ?, paid_until = ?, blocked = 0, grace_days = ?,
       updated_at = datetime('now'), sync_status = 'local' WHERE business_id = ?`
  , plan.code, newEnd, Number(plan.grace_days || 7), bizId);
  return { period_from: base, period_to: newEnd };
}
async function nextInvoiceNo() {
  const row = await db.get(`SELECT COUNT(*) AS c FROM subscription_payments WHERE status = 'approved'`);
  return `SUB-${new Date().getUTCFullYear()}-${String(Number(row.c) + 1).padStart(4, '0')}`;
}

// Admin Panel upgrade: extend by a plain number of DAYS (the admin
// detail's +7/+30 buttons) without changing the shop's plan. A paid
// period extends paid_until; a trial shop extends its trial end. The
// base is the current end when still in the future, else today — the
// same rule as extendSubscription — and extending also unblocks.
async function extendSubscriptionDays(bizId, days) {
  const sub = await ensureSubscription(bizId);
  const now = fmtTs(new Date());
  if (sub.paid_until) {
    const base = sub.paid_until > now ? sub.paid_until : now;
    await db.run(
      `UPDATE subscriptions SET paid_until = ?, blocked = 0,
         updated_at = datetime('now'), sync_status = 'local' WHERE business_id = ?`
    , addDaysTs(base, days), bizId);
  } else {
    const end = sub.trial_ends_at || now;
    const base = end > now ? end : now;
    await db.run(
      `UPDATE subscriptions SET trial_ends_at = ?, blocked = 0,
         updated_at = datetime('now'), sync_status = 'local' WHERE business_id = ?`
    , addDaysTs(base, days), bizId);
  }
}

async function approvePayment(pay) {
  const plan = await db.get('SELECT * FROM plans WHERE code = ?', pay.plan_code);
  if (!plan) throw new Error('plan_not_found');
  const ext = await extendSubscription(pay.business_id, plan);
  const invoiceNo = await nextInvoiceNo();
  await db.run(
    `UPDATE subscription_payments SET status = 'approved', invoice_no = ?, period_from = ?, period_to = ?,
       updated_at = datetime('now') WHERE id = ?`
  , invoiceNo, ext.period_from, ext.period_to, pay.id);
  return await db.get('SELECT * FROM subscription_payments WHERE id = ?', pay.id);
}

// ---------- app settings (platform-level key/value) ----------
async function getSetting(key) {
  const row = await db.get('SELECT * FROM app_settings WHERE key = ?', key);
  return row ? row.value : '';
}
async function setSetting(key, value) {
  const row = await db.get('SELECT * FROM app_settings WHERE key = ?', key);
  if (row) await db.run(`UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = ?`, String(value), key);
  else await db.run('INSERT INTO app_settings (key, value) VALUES (?, ?)', key, String(value));
}

// ---------- owner subscription API ----------
app.get('/api/subscription', requireAuth, requireOwner, async (req, res) => {
  const bizId = req.user.business_id;
  const state = await getSubscriptionState(bizId);
  const plans = await db.all('SELECT * FROM plans WHERE is_active = 1 ORDER BY duration_days ASC');
  const payments = await db.all(
    'SELECT * FROM subscription_payments WHERE business_id = ? ORDER BY id DESC LIMIT 20'
  , bizId);
  res.json({
    subscription: state,
    plans: plans.map(publicPlan),
    payments: payments.map(publicSubPayment),
    gateway_configured: razorpayConfigured(),
    mail_configured: mailConfig().configured
  });
});

// Manual/UPI payment claim: owner says "I paid" → pending → super admin
// approves in the admin panel → subscription extends + invoice issued.
app.post('/api/subscription/claim', requireAuth, requireOwner, async (req, res) => {
  const { plan_code, amount, reference } = req.body || {};
  const plan = await db.get('SELECT * FROM plans WHERE code = ? AND is_active = 1', String(plan_code || ''));
  if (!plan) return res.status(400).json({ error: 'plan_not_found' });
  const amt = amount !== undefined ? Number(amount) : Number(plan.price);
  if (!validNum(amt) || amt < 0) return res.status(400).json({ error: 'amount must be a number >= 0' });
  if (!reference || !String(reference).trim()) {
    return res.status(400).json({ error: 'payment reference (UPI / UTR number) is required' });
  }
  const r = await db.run(
    `INSERT INTO subscription_payments (business_id, plan_code, amount, method, reference, status)
     VALUES (?, ?, ?, 'upi_manual', ?, 'pending')`
  , req.user.business_id, plan.code, round2(amt), String(reference).trim());
  const pay = await db.get('SELECT * FROM subscription_payments WHERE id = ?', r.lastInsertRowid);
  await auditLog(req, 'create', 'subscription', pay.id, `Subscription payment claim bheja: ${plan.code} · ${fmtAuditAmt(pay.amount)} · ref ${pay.reference}`);
  res.status(201).json({ payment: publicSubPayment(pay) });
});

// Printable subscription invoice data (owner-only, approved payments only).
app.get('/api/subscription/invoice/:id', requireAuth, requireOwner, async (req, res) => {
  const p = await db.get(
    'SELECT * FROM subscription_payments WHERE id = ? AND business_id = ?'
  , req.params.id, req.user.business_id);
  if (!p || p.status !== 'approved' || !p.invoice_no) return res.status(404).json({ error: 'invoice_not_found' });
  const b = await getBusiness(req.user.business_id);
  const plan = await db.get('SELECT * FROM plans WHERE code = ?', p.plan_code);
  res.json({
    invoice: {
      invoice_no: p.invoice_no, date: String(p.created_at).slice(0, 10),
      seller: 'DILIGENCE', plan_code: p.plan_code,
      plan_name: plan ? plan.name : p.plan_code,
      amount: round2(p.amount), method: p.method, reference: p.reference,
      period_from: p.period_from, period_to: p.period_to,
      business: b ? { name: b.name, owner_name: b.owner_name, phone: b.phone, city: b.city } : null
    }
  });
});

// ---------- Razorpay-ready gateway ----------
// Live ONLY with the founder's own keys in env. Without keys the endpoints
// answer 501 gateway_not_configured and nothing pretends to be paid.
function razorpayConfigured() {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}
function razorpayCreateOrder(amountPaise, receipt) {
  const https = require('https');
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const payload = JSON.stringify({ amount: amountPaise, currency: 'INR', receipt });
  return new Promise((resolve, reject) => {
    const rq = https.request({
      hostname: 'api.razorpay.com', path: '/v1/orders', method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + auth, 'Content-Length': Buffer.byteLength(payload) }
    }, (rs) => {
      let data = '';
      rs.on('data', (c) => { data += c; });
      rs.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (rs.statusCode >= 200 && rs.statusCode < 300 && j.id) resolve(j);
          else reject(new Error('razorpay_order_failed'));
        } catch (e) { reject(new Error('razorpay_order_failed')); }
      });
    });
    rq.on('error', () => reject(new Error('razorpay_unreachable')));
    rq.write(payload);
    rq.end();
  });
}
app.post('/api/subscription/gateway/order', requireAuth, requireOwner, async (req, res) => {
  if (!razorpayConfigured()) return res.status(501).json({ error: 'gateway_not_configured' });
  const { plan_code } = req.body || {};
  const plan = await db.get('SELECT * FROM plans WHERE code = ? AND is_active = 1', String(plan_code || ''));
  if (!plan) return res.status(400).json({ error: 'plan_not_found' });
  if (!(Number(plan.price) > 0)) return res.status(400).json({ error: 'plan_price_not_set' });
  let order;
  try {
    order = await razorpayCreateOrder(Math.round(Number(plan.price) * 100), `sub_${req.user.business_id}_${Date.now()}`);
  } catch (e) {
    return res.status(502).json({ error: e.message || 'razorpay_order_failed' });
  }
  const r = await db.run(
    `INSERT INTO subscription_payments (business_id, plan_code, amount, method, reference, status, gateway_order_id)
     VALUES (?, ?, ?, 'razorpay', '', 'gateway_pending', ?)`
  , req.user.business_id, plan.code, round2(plan.price), order.id);
  res.status(201).json({
    order_id: order.id, amount: order.amount, currency: 'INR',
    key_id: process.env.RAZORPAY_KEY_ID, record_id: r.lastInsertRowid
  });
});
app.post('/api/subscription/gateway/verify', requireAuth, requireOwner, async (req, res) => {
  if (!razorpayConfigured()) return res.status(501).json({ error: 'gateway_not_configured' });
  const { order_id, payment_id, signature } = req.body || {};
  if (!order_id || !payment_id || !signature) {
    return res.status(400).json({ error: 'order_id, payment_id and signature are required' });
  }
  const pay = await db.get(
    `SELECT * FROM subscription_payments WHERE gateway_order_id = ? AND business_id = ?`
  , String(order_id), req.user.business_id);
  if (!pay) return res.status(404).json({ error: 'payment_not_found' });
  if (pay.status === 'approved') {
    return res.json({ ok: true, payment: publicSubPayment(pay), subscription: await getSubscriptionState(req.user.business_id) });
  }
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(String(order_id) + '|' + String(payment_id)).digest('hex');
  const ok = expected.length === String(signature).length
    && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
  if (!ok) {
    await db.run(
      `UPDATE subscription_payments SET status = 'gateway_failed', gateway_payment_id = ?, updated_at = datetime('now') WHERE id = ?`
    , String(payment_id), pay.id);
    return res.status(400).json({ error: 'invalid_signature' });
  }
  await db.run(
    `UPDATE subscription_payments SET gateway_payment_id = ?, updated_at = datetime('now') WHERE id = ?`
  , String(payment_id), pay.id);
  const fresh = await db.get('SELECT * FROM subscription_payments WHERE id = ?', pay.id);
  const approved = await approvePayment(fresh);
  res.json({ ok: true, payment: publicSubPayment(approved), subscription: await getSubscriptionState(req.user.business_id) });
});

// ---------- DILIGENCE super admin ----------
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') return res.status(403).json({ error: 'admin_only' });
  next();
}

// Admin Panel upgrade: audit trail for ADMIN actions. The shop-scoped
// auditLog() helper skips superadmin requests (their business_id is
// null), so admin actions write into the TARGET shop's history instead —
// the shop owner can see in their own audit log that DILIGENCE Admin did
// it, and the entry lives/dies with the shop like all its other history.
// user_id stays NULL (platform admin ids are not users-table ids);
// user_name carries who acted. Best-effort, like auditLog().
async function adminAudit(req, bizId, action, entity, entityId, summary) {
  try {
    await db.run(
      `INSERT INTO audit_log (business_id, user_id, user_name, action, entity, entity_id, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    , bizId, null, `DILIGENCE Admin (${req.user.email})`, action, entity,
      entityId === undefined || entityId === null ? '' : String(entityId),
      String(summary || '').slice(0, 300));
  } catch (e) { console.error('admin audit write failed:', e.message); }
}
app.get('/api/admin/businesses', requireAuth, requireSuperAdmin, async (req, res) => {
  // Metadata ONLY (shop identity + subscription state) — never a shop's
  // invoices, products or customers.
  const rows = await db.all(
    `SELECT b.id, b.name, b.owner_name, b.phone, b.city, b.created_at, u.email AS owner_email
     FROM businesses b
     LEFT JOIN users u ON u.business_id = b.id AND u.role = 'owner'
     ORDER BY b.id ASC`
  );
  const out = [];
  for (const b of rows) {
    const prog = await onboardingProgress(b.id);
    out.push({
      id: b.id, name: b.name, owner_name: b.owner_name, owner_email: b.owner_email,
      phone: b.phone, city: b.city, created_at: b.created_at,
      subscription: await getSubscriptionState(b.id),
      // Updates Stage D: onboarding progress (counts only — the same
      // metadata-only privacy rule; never the shop's actual data).
      onboarding: prog.progress
    });
  }
  res.json({ businesses: out });
});
app.get('/api/admin/businesses/:id/detail', requireAuth, requireSuperAdmin, async (req, res) => {
  // One shop, platform metadata only — identity, subscription state +
  // stored subscription row(s), onboarding counts, and the shop's
  // subscription PAYMENTS (amounts/dates are platform billing metadata).
  // Never the shop's products, bills, customers or stock.
  const biz = await db.get(
    `SELECT b.id, b.name, b.owner_name, b.phone, b.city, b.created_at, u.email AS owner_email
     FROM businesses b
     LEFT JOIN users u ON u.business_id = b.id AND u.role = 'owner'
     WHERE b.id = ?`
  , req.params.id);
  if (!biz) return res.status(404).json({ error: 'business_not_found' });
  const subRows = await db.all(
    'SELECT * FROM subscriptions WHERE business_id = ? ORDER BY id ASC'
  , biz.id);
  const payRows = await db.all(
    'SELECT * FROM subscription_payments WHERE business_id = ? ORDER BY id DESC'
  , biz.id);
  const prog = await onboardingProgress(biz.id);
  res.json({
    business: {
      id: biz.id, name: biz.name, owner_name: biz.owner_name,
      owner_email: biz.owner_email, phone: biz.phone, city: biz.city,
      created_at: biz.created_at
    },
    subscription: await getSubscriptionState(biz.id),
    subscription_rows: subRows.map((r) => ({
      plan_code: r.plan_code || null, status: subscriptionState(r).status,
      trial_ends_at: r.trial_ends_at || null, paid_until: r.paid_until || null,
      grace_days: Number(r.grace_days || 7), blocked: !!r.blocked,
      created_at: r.created_at, updated_at: r.updated_at
    })),
    onboarding: prog.progress,
    payments: payRows.map((p) => ({
      ...publicSubPayment(p),
      decided_at: (p.status === 'approved' || p.status === 'rejected') ? p.updated_at : null
    }))
  });
});
app.get('/api/admin/summary', requireAuth, requireSuperAdmin, async (req, res) => {
  // Platform metadata ONLY — the same rule as every admin route: shop
  // identity, owner email, plan, dates, onboarding counts, subscription
  // payment amounts/dates. Never a shop's business data.
  const bizRows = await db.all(
    `SELECT b.id, b.name, b.owner_name, b.created_at, u.email AS owner_email
     FROM businesses b
     LEFT JOIN users u ON u.business_id = b.id AND u.role = 'owner'
     ORDER BY b.id ASC`
  );
  const counts = { trial: 0, active: 0, grace: 0, expired: 0, blocked: 0 };
  let onboardingStuck = 0;
  const states = new Map();
  for (const b of bizRows) {
    const st = await getSubscriptionState(b.id);
    states.set(b.id, st);
    counts[st.status]++;
    // Updates Stage D aggregate: shops stuck mid-onboarding while their
    // free trial is still running — the ones a nudge can still save.
    if (st.status === 'trial') {
      const prog = await onboardingProgress(b.id);
      if (prog.progress.pct < 100) onboardingStuck++;
    }
  }
  const rev = await db.get(
    `SELECT COALESCE(SUM(amount),0) AS s FROM subscription_payments WHERE status = 'approved'`
  );
  const pend = await db.get(
    `SELECT COUNT(*) AS c FROM subscription_payments WHERE status = 'pending'`
  );

  // ---- Admin overview (growth + attention) ----
  const nowMs = Date.now();
  const dayMs = 86400000;
  // Signup trend: last 14 days (UTC date of businesses.created_at),
  // zero-filled so quiet days show as honest gaps, plus a 7-day count.
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    trend.push({ date: new Date(nowMs - i * dayMs).toISOString().slice(0, 10), count: 0 });
  }
  const trendByDate = new Map(trend.map((t) => [t.date, t]));
  const cutoff7 = new Date(nowMs - 7 * dayMs).toISOString().slice(0, 10);
  let signupsLast7 = 0;
  for (const b of bizRows) {
    const d = String(b.created_at || '').slice(0, 10);
    const t = trendByDate.get(d);
    if (t) t.count++;
    if (d >= cutoff7) signupsLast7++;
  }
  // Trials ending within 3 days (still on trial), soonest first.
  const trialsEndingSoon = [];
  // Plan distribution (current plan per shop) + MRR estimate: sum over
  // ACTIVE paid subscriptions of the plan's monthly-equivalent price
  // (price × 30 / duration_days). Prices are founder-set; while they are
  // 0 this honestly returns 0 — nothing is invented.
  const planDist = new Map();
  const planRows = await db.all('SELECT * FROM plans');
  const planByCode = new Map(planRows.map((p) => [p.code, p]));
  let mrr = 0;
  for (const b of bizRows) {
    const st = states.get(b.id);
    const code = st.plan_code || 'none';
    planDist.set(code, (planDist.get(code) || 0) + 1);
    if (st.status === 'trial' && st.days_left >= 0 && st.days_left <= 3) {
      trialsEndingSoon.push({
        id: b.id, shop: b.name, owner_email: b.owner_email,
        trial_ends_at: st.trial_ends_at, days_left: st.days_left
      });
    }
    if (st.status === 'active' && st.plan_code) {
      const plan = planByCode.get(st.plan_code);
      if (plan && Number(plan.price) > 0 && Number(plan.duration_days) > 0) {
        mrr += Number(plan.price) * 30 / Number(plan.duration_days);
      }
    }
  }
  trialsEndingSoon.sort((a, b) => a.days_left - b.days_left);
  // Revenue actually collected, grouped by plan (approved claims only).
  const revPlanRows = await db.all(
    `SELECT plan_code, COALESCE(SUM(amount),0) AS s FROM subscription_payments
     WHERE status = 'approved' GROUP BY plan_code ORDER BY plan_code ASC`
  );
  // Onboarding-stuck list: any live shop (not blocked/expired) below
  // 100%, longest-waiting first — the ones a nudge can still save.
  const stuckList = [];
  for (const b of bizRows) {
    const st = states.get(b.id);
    if (st.status === 'blocked' || st.status === 'expired') continue;
    const prog = await onboardingProgress(b.id);
    if (prog.progress.pct < 100) {
      stuckList.push({
        id: b.id, shop: b.name, owner_name: b.owner_name, owner_email: b.owner_email,
        pct: prog.progress.pct, done: prog.progress.done, total: prog.progress.total,
        days_since_signup: Math.max(0, Math.floor((nowMs - parseTs(b.created_at).getTime()) / dayMs)),
        status: st.status
      });
    }
  }
  stuckList.sort((a, b) => (b.days_since_signup - a.days_since_signup) || (a.pct - b.pct));
  // Recent signups (newest first).
  const recentSignups = [];
  for (const b of [...bizRows].sort((a, b) => b.id - a.id).slice(0, 10)) {
    const prog = await onboardingProgress(b.id);
    recentSignups.push({
      id: b.id, shop: b.name, owner_name: b.owner_name, owner_email: b.owner_email,
      created_at: b.created_at, status: states.get(b.id).status,
      onboarding: prog.progress
    });
  }
  // Claims history: latest 20 subscription payments, every status.
  // decided_at = the row's updated_at once a decision exists (approve /
  // reject stamp it), null while pending.
  const claimRows = await db.all(
    `SELECT p.*, b.name AS business_name FROM subscription_payments p
     JOIN businesses b ON b.id = p.business_id ORDER BY p.id DESC LIMIT 20`
  );
  res.json({
    total_businesses: bizRows.length, by_status: counts,
    revenue_total: round2(rev.s), pending_claims: pend.c,
    onboarding_stuck: onboardingStuck,
    signups_last_7d: signupsLast7,
    trials_ending_soon: trialsEndingSoon,
    signup_trend_14d: trend,
    plan_distribution: [...planDist.entries()].map(([plan_code, count]) => ({ plan_code, count })),
    mrr_estimate: round2(mrr),
    revenue_by_plan: revPlanRows.map((r) => ({ plan_code: r.plan_code, amount: round2(r.s) })),
    onboarding_stuck_list: stuckList.slice(0, 10),
    recent_signups: recentSignups,
    claims_history: claimRows.map((p) => ({
      ...publicSubPayment(p), business_name: p.business_name,
      decided_at: (p.status === 'approved' || p.status === 'rejected') ? p.updated_at : null
    }))
  });
});
app.get('/api/admin/plans', requireAuth, requireSuperAdmin, async (req, res) => {
  const plans = await db.all('SELECT * FROM plans ORDER BY duration_days ASC');
  res.json({ plans: plans.map(publicPlan) });
});
app.put('/api/admin/plans/:code', requireAuth, requireSuperAdmin, async (req, res) => {
  const plan = await db.get('SELECT * FROM plans WHERE code = ?', req.params.code);
  if (!plan) return res.status(404).json({ error: 'plan_not_found' });
  const b = req.body || {};
  const next = {
    name: b.name !== undefined ? String(b.name).trim() : plan.name,
    price: b.price !== undefined ? Number(b.price) : Number(plan.price),
    duration_days: b.duration_days !== undefined ? Number(b.duration_days) : Number(plan.duration_days),
    grace_days: b.grace_days !== undefined ? Number(b.grace_days) : Number(plan.grace_days),
    is_active: b.is_active !== undefined ? (b.is_active ? 1 : 0) : plan.is_active
  };
  if (!validNum(next.price) || next.price < 0) return res.status(400).json({ error: 'price must be a number >= 0' });
  if (!Number.isInteger(next.duration_days) || next.duration_days <= 0) return res.status(400).json({ error: 'duration_days must be a positive whole number' });
  if (!Number.isInteger(next.grace_days) || next.grace_days < 0) return res.status(400).json({ error: 'grace_days must be a whole number >= 0' });
  await db.run(
    `UPDATE plans SET name = ?, price = ?, duration_days = ?, grace_days = ?, is_active = ?,
       updated_at = datetime('now') WHERE code = ?`
  , next.name, round2(next.price), next.duration_days, next.grace_days, next.is_active, plan.code);
  res.json({ plan: publicPlan(await db.get('SELECT * FROM plans WHERE code = ?', plan.code)) });
});
app.get('/api/admin/payments', requireAuth, requireSuperAdmin, async (req, res) => {
  const status = String(req.query.status || '');
  const rows = status
    ? await db.all(
      `SELECT p.*, b.name AS business_name FROM subscription_payments p
       JOIN businesses b ON b.id = p.business_id WHERE p.status = ? ORDER BY p.id DESC LIMIT 100`
    , status)
    : await db.all(
      `SELECT p.*, b.name AS business_name FROM subscription_payments p
       JOIN businesses b ON b.id = p.business_id ORDER BY p.id DESC LIMIT 100`
    );
  res.json({ payments: rows.map((p) => ({ ...publicSubPayment(p), business_name: p.business_name })) });
});
app.post('/api/admin/payments/:id/approve', requireAuth, requireSuperAdmin, async (req, res) => {
  const pay = await db.get('SELECT * FROM subscription_payments WHERE id = ?', req.params.id);
  if (!pay) return res.status(404).json({ error: 'payment_not_found' });
  if (pay.status !== 'pending') return res.status(400).json({ error: 'payment_not_pending' });
  const approved = await approvePayment(pay);
  res.json({
    payment: publicSubPayment(approved),
    subscription: await getSubscriptionState(pay.business_id)
  });
});
app.post('/api/admin/payments/:id/reject', requireAuth, requireSuperAdmin, async (req, res) => {
  const pay = await db.get('SELECT * FROM subscription_payments WHERE id = ?', req.params.id);
  if (!pay) return res.status(404).json({ error: 'payment_not_found' });
  if (pay.status !== 'pending') return res.status(400).json({ error: 'payment_not_pending' });
  await db.run(
    `UPDATE subscription_payments SET status = 'rejected', updated_at = datetime('now') WHERE id = ?`
  , pay.id);
  res.json({ payment: publicSubPayment(await db.get('SELECT * FROM subscription_payments WHERE id = ?', pay.id)) });
});
app.post('/api/admin/businesses/:id/extend', requireAuth, requireSuperAdmin, async (req, res) => {
  const biz = await getBusiness(req.params.id);
  if (!biz) return res.status(404).json({ error: 'business_not_found' });
  // Admin Panel upgrade: {days: N} extends by N days, plan unchanged
  // (the detail panel's +7/+30 buttons). The original {plan_code} shape
  // is untouched for existing callers.
  const days = Number((req.body || {}).days);
  if (Number.isInteger(days) && days > 0 && days <= 3650) {
    await extendSubscriptionDays(biz.id, days);
    await adminAudit(req, biz.id, 'update', 'subscription', biz.id,
      `Admin ne subscription ${days} din badhaya: ${biz.name || '(no name)'}`);
    return res.json({ subscription: await getSubscriptionState(biz.id) });
  }
  const plan = await db.get('SELECT * FROM plans WHERE code = ?', String((req.body || {}).plan_code || ''));
  if (!plan) return res.status(400).json({ error: 'plan_not_found' });
  await extendSubscription(biz.id, plan); // also unblocks
  res.json({ subscription: await getSubscriptionState(biz.id) });
});
app.post('/api/admin/businesses/:id/block', requireAuth, requireSuperAdmin, async (req, res) => {
  const biz = await getBusiness(req.params.id);
  if (!biz) return res.status(404).json({ error: 'business_not_found' });
  await ensureSubscription(biz.id);
  const blocked = (req.body || {}).blocked ? 1 : 0;
  await db.run(
    `UPDATE subscriptions SET blocked = ?, updated_at = datetime('now') WHERE business_id = ?`
  , blocked, biz.id);
  await adminAudit(req, biz.id, blocked ? 'block' : 'unblock', 'business', biz.id,
    `Admin ne shop ${blocked ? 'BLOCK' : 'UNBLOCK'} kiya: ${biz.name || '(no name)'}`);
  res.json({ subscription: await getSubscriptionState(biz.id) });
});
// ---------- Admin Panel upgrade: full account control ----------
// User shape for admin responses — NEVER the password hash.
function publicAdminUser(u) {
  return {
    id: u.id, business_id: u.business_id, name: u.name, email: u.email,
    role: u.role, access: u.access, blocked: !!u.blocked, created_at: u.created_at
  };
}
// Every table that carries a business_id and belongs to ONE shop — the
// delete-shop cascade. (TABLES in db.js is the backup-export list; the
// Stage 3 platform tables below carry business_id too and are the shop's
// data as well, so a permanent delete takes them along.)
// ORDER IS LOAD-BEARING: SQLite enforces the schema's REFERENCES, so a
// parent row may only be deleted after every child row that points at
// it. The list therefore runs leaf-first —
//   return_items → returns / invoice_items / products,
//   estimate_items → estimates / products,
//   invoice_items + customer_payments → invoices → customers,
//   purchase_items + supplier_payments → purchases → suppliers,
//   stock_movements → products —
// and the business-only tables (expenses, subscriptions, …) come last.
// (The Postgres DDL strips REFERENCES, so PG cannot FK-fail here, but it
// runs this same list — one cascade, both engines.) A populated shop
// deleted parent-first dies on the very first statement (suppliers,
// while purchases still reference them) — keep children before parents
// when adding tables here.
const SHOP_DATA_TABLES = [
  'return_items', 'estimate_items', 'invoice_items',
  'customer_payments', 'supplier_payments', 'purchase_items', 'stock_movements',
  'returns', 'estimates', 'invoices', 'purchases',
  'customers', 'products', 'suppliers',
  'expenses',
  'subscriptions', 'subscription_payments', 'onboarding',
  'backup_snapshots', 'audit_log', 'sync_ids', 'sync_conflicts', 'sync_tombstones'
];

app.get('/api/admin/businesses/:id/users', requireAuth, requireSuperAdmin, async (req, res) => {
  const biz = await getBusiness(req.params.id);
  if (!biz) return res.status(404).json({ error: 'business_not_found' });
  const rows = await db.all(
    `SELECT id, business_id, name, email, role, access, blocked, created_at FROM users
     WHERE business_id = ? ORDER BY (role = 'owner') DESC, id ASC`
  , biz.id);
  res.json({ users: rows.map(publicAdminUser) });
});

// Permanently delete a shop and ALL its data, in one transaction.
app.delete('/api/admin/businesses/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const biz = await getBusiness(req.params.id);
  if (!biz) return res.status(404).json({ error: 'business_not_found' });
  // The audit entry is written BEFORE the delete (the shop's history is
  // part of its data and is removed with it — the write still happens,
  // in the shop's own log, like every other admin action).
  await adminAudit(req, biz.id, 'delete', 'business', biz.id,
    `Admin ne shop PERMANENT DELETE kiya: ${biz.name || '(no name)'} · owner ${biz.owner_name || ''}`);
  const shopUsers = await db.all('SELECT id FROM users WHERE business_id = ?', biz.id);
  const userIds = shopUsers.map((u) => u.id);
  const tx = await db.begin();
  try {
    if (userIds.length) {
      const ph = userIds.map(() => '?').join(',');
      await tx.run(`DELETE FROM sessions WHERE user_id IN (${ph})`, ...userIds);
      await tx.run(`DELETE FROM pending_signups WHERE user_id IN (${ph})`, ...userIds);
    }
    for (const t of SHOP_DATA_TABLES) {
      await tx.run(`DELETE FROM ${t} WHERE business_id = ?`, biz.id);
    }
    await tx.run('DELETE FROM users WHERE business_id = ?', biz.id);
    await tx.run('DELETE FROM businesses WHERE id = ?', biz.id);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  res.json({ ok: true });
});

// Assign / change a shop's plan NOW: a fresh period of the plan's
// duration starts today (status active) and any block is lifted. The
// 'trial' plan code instead restarts the trial clock (trial end set,
// paid period cleared). No payment row is created — revenue is never
// faked; this is the admin granting a plan by hand.
app.post('/api/admin/businesses/:id/plan', requireAuth, requireSuperAdmin, async (req, res) => {
  const biz = await getBusiness(req.params.id);
  if (!biz) return res.status(404).json({ error: 'business_not_found' });
  const plan = await db.get('SELECT * FROM plans WHERE code = ?', String((req.body || {}).plan_code || ''));
  if (!plan) return res.status(400).json({ error: 'plan_not_found' });
  await ensureSubscription(biz.id);
  const now = fmtTs(new Date());
  if (plan.code === 'trial') {
    await db.run(
      `UPDATE subscriptions SET plan_code = 'trial', trial_ends_at = ?, paid_until = NULL,
         blocked = 0, grace_days = ?, updated_at = datetime('now'), sync_status = 'local'
       WHERE business_id = ?`
    , addDaysTs(now, plan.duration_days), Number(plan.grace_days || 7), biz.id);
  } else {
    await db.run(
      `UPDATE subscriptions SET plan_code = ?, paid_until = ?, blocked = 0, grace_days = ?,
         updated_at = datetime('now'), sync_status = 'local' WHERE business_id = ?`
    , plan.code, addDaysTs(now, plan.duration_days), Number(plan.grace_days || 7), biz.id);
  }
  await adminAudit(req, biz.id, 'update', 'subscription', biz.id,
    `Admin ne plan badla: ${plan.code} (${plan.name || plan.code}) · shop ${biz.name || '(no name)'}`);
  res.json({ ok: true, subscription: await getSubscriptionState(biz.id) });
});

// Block / unblock ONE user of a shop. Super admins live in
// platform_admins, never in users, so no users row can be a superadmin —
// the role check below is belt-and-braces only.
app.post('/api/admin/users/:id/block', requireAuth, requireSuperAdmin, async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!target) return res.status(404).json({ error: 'user_not_found' });
  if (target.role === 'superadmin') return res.status(400).json({ error: 'cannot_block_superadmin' });
  const blocked = (req.body || {}).blocked ? 1 : 0;
  await db.run(
    `UPDATE users SET blocked = ?, updated_at = datetime('now') WHERE id = ?`
  , blocked, target.id);
  // Live sessions are NOT deleted: requireAuth checks this flag on every
  // request, so the user's existing tokens stop working at once (403
  // account_blocked) and work again if the admin unblocks.
  await adminAudit(req, target.business_id, blocked ? 'block' : 'unblock', 'user', target.id,
    `Admin ne user ${blocked ? 'BLOCK' : 'UNBLOCK'} kiya: ${target.name} (${target.email})`);
  res.json({ user: publicAdminUser(await db.get('SELECT * FROM users WHERE id = ?', target.id)) });
});

// Change a shop user's role and/or access level.
app.put('/api/admin/users/:id/role', requireAuth, requireSuperAdmin, async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!target) return res.status(404).json({ error: 'user_not_found' });
  if (target.role === 'superadmin') return res.status(400).json({ error: 'cannot_change_superadmin' });
  const b = req.body || {};
  const role = b.role !== undefined ? String(b.role) : target.role;
  let access = b.access !== undefined ? String(b.access) : target.access;
  if (!['owner', 'staff'].includes(role)) return res.status(400).json({ error: 'invalid_role' });
  if (!['all', 'billing', 'stock'].includes(access)) return res.status(400).json({ error: 'invalid_access' });
  if (target.role === 'owner' && role !== 'owner') {
    // A shop must always keep at least one owner.
    const owners = await db.get(
      `SELECT COUNT(*) AS c FROM users WHERE business_id = ? AND role = 'owner'`
    , target.business_id);
    if (Number(owners.c) <= 1) return res.status(400).json({ error: 'last_owner' });
  }
  if (role === 'owner') access = 'all'; // owners always have full access (signup invariant)
  await db.run(
    `UPDATE users SET role = ?, access = ?, updated_at = datetime('now') WHERE id = ?`
  , role, access, target.id);
  await adminAudit(req, target.business_id, 'update', 'user', target.id,
    `Admin ne user ka role/access badla: ${target.name} (${target.email}) · ${target.role}/${target.access} → ${role}/${access}`);
  res.json({ user: publicAdminUser(await db.get('SELECT * FROM users WHERE id = ?', target.id)) });
});

// Remove ONE user from a shop (their sessions + any pending-signup
// marker go with them). The shop's only owner cannot be removed.
app.delete('/api/admin/users/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!target) return res.status(404).json({ error: 'user_not_found' });
  if (target.role === 'superadmin') return res.status(400).json({ error: 'cannot_delete_superadmin' });
  if (target.role === 'owner') {
    const owners = await db.get(
      `SELECT COUNT(*) AS c FROM users WHERE business_id = ? AND role = 'owner'`
    , target.business_id);
    if (Number(owners.c) <= 1) return res.status(400).json({ error: 'last_owner' });
  }
  await adminAudit(req, target.business_id, 'delete', 'user', target.id,
    `Admin ne user hataya: ${target.name} (${target.email}) · role ${target.role}`);
  await db.run('DELETE FROM sessions WHERE user_id = ?', target.id);
  await db.run('DELETE FROM pending_signups WHERE user_id = ?', target.id);
  await db.run('DELETE FROM users WHERE id = ?', target.id);
  res.json({ ok: true });
});
app.get('/api/admin/settings', requireAuth, requireSuperAdmin, async (req, res) => {
  res.json({ settings: { support_whatsapp: await getSetting('support_whatsapp'), help_video_url: await getSetting('help_video_url'), top_plan_code: await getSetting('top_plan_code') } });
});
app.put('/api/admin/settings', requireAuth, requireSuperAdmin, async (req, res) => {
  const b = req.body || {};
  if (b.support_whatsapp !== undefined) await setSetting('support_whatsapp', String(b.support_whatsapp).trim());
  if (b.help_video_url !== undefined) await setSetting('help_video_url', String(b.help_video_url).trim());
  // Updates Stage B: which plan counts as the TOP plan (e-way / e-invoice
  // gate). Empty = auto (highest price, then longest duration).
  if (b.top_plan_code !== undefined) await setSetting('top_plan_code', String(b.top_plan_code).trim());
  res.json({ settings: { support_whatsapp: await getSetting('support_whatsapp'), help_video_url: await getSetting('help_video_url'), top_plan_code: await getSetting('top_plan_code') } });
});

// ---------- Guided onboarding (SaaS Stage 2 → Updates Stage D) ----------
// The app TEACHES its own features, checklist-style: 8 steps, each with a
// one-line explanation (EN + HI), a done-state DERIVED from real data and
// a target screen. Steps are never fake ticks — each `done` below reads
// the shop's actual tables. The single exception is the WhatsApp step: it
// turns done when a bill's WhatsApp link is genuinely generated (the
// whatsapp-link route sets onboarding.wa_done at that moment) or when the
// owner manually ticks it (POST /api/onboarding/whatsapp-done) — it is a
// "try karo" step, labelled manual in its payload. The onboarding row
// stores ONLY the owner's dismiss choice + that wa_done flag.
const ONBOARDING_STEP_DEFS = [
  {
    key: 'profile', target: 'settings',
    title_en: 'Complete your shop details', title_hi: 'दुकान की details पूरी करो',
    desc_en: 'Shop name, city/phone — and GSTIN if GST billing is on. This prints on every bill.',
    desc_hi: 'दुकान का नाम, शहर/फ़ोन — और GST चालू है तो GSTIN भी। यही हर bill पर छपता है।'
  },
  {
    key: 'upi', target: 'settings',
    title_en: 'Set your UPI ID', title_hi: 'अपना UPI ID set करो',
    desc_en: 'Every bill gets a payment QR of its exact balance — customers scan and pay you directly.',
    desc_hi: 'हर bill पर उसकी exact रकम का payment QR बनेगा — ग्राहक scan करके सीधा तुम्हें pay करेगा।'
  },
  {
    key: 'data', target: 'products',
    title_en: 'Add your first product (or import old data)', title_hi: 'पहला product जोड़ो (या पुराना data import करो)',
    desc_en: 'Add items you sell — or bring products, customers and old credit from Vyapar/Tally/Excel in one import (Settings → Import).',
    desc_hi: 'जो सामान बेचते हो वो जोड़ो — या Vyapar/Tally/Excel से products, ग्राहक और पुराना उधार एक import में ले आओ (Settings → Import)।'
  },
  {
    key: 'customer', target: 'customers',
    title_en: 'Add your first customer', title_hi: 'पहला ग्राहक जोड़ो',
    desc_en: 'Save customer name + phone once — bills, credit and WhatsApp reminders then take one tap.',
    desc_hi: 'ग्राहक का नाम + फ़ोन एक बार save करो — फिर bill, उधार और WhatsApp reminder एक tap में जाएगा।'
  },
  {
    key: 'bill', target: 'billing',
    title_en: 'Make your first bill', title_hi: 'पहला bill बनाओ',
    desc_en: 'Pick items, add payment — stock adjusts itself and the bill is ready to send on WhatsApp.',
    desc_hi: 'सामान चुनो, payment डालो — stock अपने आप घटेगा और bill WhatsApp पर भेजने के लिए तैयार।'
  },
  {
    key: 'expense', target: 'expenses',
    title_en: 'Add your first expense', title_hi: 'पहला खर्चा जोड़ो',
    desc_en: 'Rent, salary, electricity — expenses you record here make the profit report honest.',
    desc_hi: 'किराया, तनख्वाह, बिजली — यहाँ दर्ज खर्चे ही profit report को सच्चा बनाते हैं।'
  },
  {
    key: 'staff', target: 'settings',
    title_en: 'Add your team (staff)', title_hi: 'अपनी team (staff) जोड़ो',
    desc_en: 'Give counter staff their own login — they can bill, but never see your profit.',
    desc_hi: 'Counter staff को अलग login दो — वो bill बना सकेंगे, पर तुम्हारा profit कभी नहीं देखेंगे।'
  },
  {
    key: 'whatsapp', target: 'billing', manual: true,
    title_en: 'Send a bill on WhatsApp', title_hi: 'एक bill WhatsApp पर भेजो',
    desc_en: 'Open any bill and tap WhatsApp — the customer gets the full bill with a UPI pay line. Tick this yourself once you have tried it.',
    desc_hi: 'कोई bill खोलकर WhatsApp दबाओ — ग्राहक को पूरा bill UPI pay line के साथ मिलेगा। Try कर लो तो खुद tick कर दो।'
  }
];
async function ensureOnboardingRow(bizId) {
  let row = await db.get('SELECT * FROM onboarding WHERE business_id = ?', bizId);
  if (!row) {
    await db.run('INSERT INTO onboarding (business_id) VALUES (?)', bizId);
    row = await db.get('SELECT * FROM onboarding WHERE business_id = ?', bizId);
  }
  return row;
}
// Derivation only — no row creation, so admin aggregates stay read-only.
async function onboardingProgress(bizId) {
  const biz = await getBusiness(bizId);
  const row = await db.get('SELECT * FROM onboarding WHERE business_id = ?', bizId);
  const count = async (sql, ...args) => Number((await db.get(sql, ...args)).c);
  const doneMap = {
    profile: !!(biz && String(biz.name || '').trim()
      && (String(biz.city || '').trim() || String(biz.phone || '').trim())
      && (!biz.gst_enabled || String(biz.gstin || '').trim())),
    upi: !!(biz && String(biz.upi_id || '').trim()),
    data: (await count('SELECT COUNT(*) AS c FROM products WHERE business_id = ?', bizId)) > 0,
    customer: (await count('SELECT COUNT(*) AS c FROM customers WHERE business_id = ?', bizId)) > 0,
    // Stage C: an imported opening-balance row is not a real bill.
    bill: (await count("SELECT COUNT(*) AS c FROM invoices WHERE business_id = ? AND kind = 'sale'", bizId)) > 0,
    expense: (await count('SELECT COUNT(*) AS c FROM expenses WHERE business_id = ?', bizId)) > 0,
    staff: (await count('SELECT COUNT(*) AS c FROM users WHERE business_id = ?', bizId)) > 1,
    whatsapp: !!(row && row.wa_done)
  };
  const steps = ONBOARDING_STEP_DEFS.map((d) => ({ ...d, done: !!doneMap[d.key] }));
  const doneCount = steps.filter((s) => s.done).length;
  return {
    steps,
    progress: { done: doneCount, total: steps.length, pct: Math.round((doneCount / steps.length) * 100) }
  };
}
async function onboardingState(bizId) {
  const row = await ensureOnboardingRow(bizId);
  const { steps, progress } = await onboardingProgress(bizId);
  const done = progress.done === progress.total;
  // `show` drives the dashboard card: visible until the owner dismisses
  // it (a finished shop sees the slim "ready" strip until dismissed).
  return { steps, progress, done, dismissed: !!row.dismissed, show: !row.dismissed };
}
app.get('/api/onboarding', requireAuth, async (req, res) => {
  // Owner AND staff of the shop may view their own checklist (the founder
  // wants the app to teach everyone on the counter); platform admins have
  // no shop, so they stay out. Dismiss remains owner-only.
  if (!req.user.business_id) return res.status(403).json({ error: 'no_business' });
  res.json(await onboardingState(req.user.business_id));
});
app.post('/api/onboarding/dismiss', requireAuth, requireOwner, async (req, res) => {
  await ensureOnboardingRow(req.user.business_id);
  await db.run(
    `UPDATE onboarding SET dismissed = 1, updated_at = datetime('now') WHERE business_id = ?`
  , req.user.business_id);
  res.json(await onboardingState(req.user.business_id));
});
app.post('/api/onboarding/whatsapp-done', requireAuth, requireOwner, async (req, res) => {
  // Manual tick for the soft "try karo" WhatsApp step (also set for real
  // by the whatsapp-link route when a link is generated).
  await ensureOnboardingRow(req.user.business_id);
  await db.run(
    `UPDATE onboarding SET wa_done = 1, updated_at = datetime('now') WHERE business_id = ?`
  , req.user.business_id);
  res.json(await onboardingState(req.user.business_id));
});

// ---------- read-only enforcement (SaaS Stage 2) ----------
// Registered AFTER the auth / subscription / payment / admin / onboarding
// routes above and BEFORE every business-data route below: when a
// business's subscription is expired (past grace) or admin-blocked, all
// business-data WRITES stop with 403 subscription_expired while every
// GET keeps working (old data stays visible/exportable). The exempt
// routes are exactly the ones registered before this line — auth,
// subscription, payments, gateway, admin, onboarding — plus logout.
async function subscriptionGuard(req, res, next) {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return next();
  // SaaS Stage 3 exemption: sync push/pull/run and backup create/restore
  // stay open even when a subscription is expired/read-only — an expired
  // shop must still be able to push its old data up to the hub and to
  // restore its own backups. These routes do their own auth/owner checks.
  const p = String(req.originalUrl || '').split('?')[0];
  if (p.startsWith('/api/sync/') || p.startsWith('/api/backups')) return next();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(); // the route's own requireAuth will 401
  const row = await db.get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
  , token);
  if (!row) return next(); // admin token or unknown — routes decide
  const state = await getSubscriptionState(row.business_id);
  if (state.read_only) {
    return res.status(403).json({ error: 'subscription_expired', subscription_status: state.status });
  }
  next();
}
app.use('/api', subscriptionGuard);

// ---------- business setup API (own business only) ----------
app.get('/api/business', requireAuth, async (req, res) => {
  res.json({ business: publicBusiness(await getBusiness(req.user.business_id)) });
});

// Business settings are owner-only (staff get 403).
// Updates Stage A: a UPI virtual payment address looks like name@bank —
// validated loosely on purpose (handles vary); empty clears the setting.
const UPI_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,}@[A-Za-z][A-Za-z0-9.]{1,}$/;
app.put('/api/business', requireAuth, requireOwner, async (req, res) => {
  const body = req.body || {};
  const cur = await getBusiness(req.user.business_id);
  if (!cur) return res.status(404).json({ error: 'business not found' });

  const next = {
    name: body.name !== undefined ? String(body.name).trim() : cur.name,
    owner_name: body.owner_name !== undefined ? String(body.owner_name).trim() : cur.owner_name,
    phone: body.phone !== undefined ? String(body.phone).trim() : cur.phone,
    city: body.city !== undefined ? String(body.city).trim() : cur.city,
    gst_enabled: body.gst_enabled !== undefined ? (body.gst_enabled ? 1 : 0) : cur.gst_enabled,
    gstin: body.gstin !== undefined ? String(body.gstin).trim().toUpperCase() : cur.gstin,
    upi_id: body.upi_id !== undefined ? String(body.upi_id).trim() : (cur.upi_id || ''),
    upi_payee_name: body.upi_payee_name !== undefined ? String(body.upi_payee_name).trim() : (cur.upi_payee_name || ''),
    language: body.language !== undefined ? (['hi', 'hg'].includes(body.language) ? body.language : 'en') : cur.language
  };
  if (next.upi_id && !UPI_ID_RE.test(next.upi_id)) {
    return res.status(400).json({ error: 'invalid_upi_id' });
  }
  // Payment QR (bill PDF): the shop's OWN uploaded UPI QR image, stored
  // as a JPEG/PNG data URL exactly like Mart listing photos (client-side
  // canvas resize, ~400KB cap). '' / null clears it; anything that is
  // not an image data URL is rejected, never stored.
  let paymentQr = cur.payment_qr || null;
  if (body.payment_qr !== undefined) {
    if (body.payment_qr === null || body.payment_qr === '') paymentQr = null;
    else if (typeof body.payment_qr === 'string' && /^data:image\/(jpeg|jpg|png);base64,/.test(body.payment_qr)) {
      if (body.payment_qr.length > 560000) return res.status(400).json({ error: 'qr_image_too_large' });
      paymentQr = body.payment_qr;
    } else return res.status(400).json({ error: 'invalid_qr_image' });
  }
  if (!next.gst_enabled) next.gstin = body.gstin !== undefined ? next.gstin : cur.gstin;
  await db.run(
    `UPDATE businesses SET name=?, owner_name=?, phone=?, city=?, gst_enabled=?, gstin=?, upi_id=?, upi_payee_name=?, language=?, payment_qr=?,
       updated_at=datetime('now'), sync_status='local' WHERE id=?`
  , next.name, next.owner_name, next.phone, next.city, next.gst_enabled, next.gstin, next.upi_id, next.upi_payee_name, next.language, paymentQr, req.user.business_id);
  res.json({ business: publicBusiness(await getBusiness(req.user.business_id)) });
});

// ---------- Stage 6: data backup (owner-only) ----------
// LOCAL mode (SQLite): streams a consistent copy of the database FILE as a
// download — VACUUM INTO writes a transactionally consistent snapshot to a
// temp file (safe while the app is running); the temp file is deleted after.
// CLOUD mode (Postgres): there is no local file to copy, so the honest
// equivalent is a JSON export of the CALLER'S business data — every table's
// rows for that business (sessions of the business's own users included).
app.get('/api/backup', requireAuth, requireOwner, async (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  if (db.engine === 'postgres') {
    const bizId = req.user.business_id;
    try {
      const users = await db.all('SELECT * FROM users WHERE business_id = ?', bizId);
      const userIds = users.map((u) => u.id);
      const out = {
        app: 'Business OS v3', export_type: 'business-json', business_id: bizId,
        exported_at: new Date().toISOString(), tables: {}
      };
      for (const t of TABLES) {
        if (t === 'businesses') {
          const b = await getBusiness(bizId);
          out.tables.businesses = b ? [b] : [];
        } else if (t === 'users') {
          out.tables.users = users;
        } else if (t === 'sessions') {
          out.tables.sessions = userIds.length
            ? await db.all(`SELECT * FROM sessions WHERE user_id IN (${userIds.map(() => '?').join(',')})`, ...userIds)
            : [];
        } else {
          out.tables[t] = await db.all(`SELECT * FROM ${t} WHERE business_id = ?`, bizId);
        }
      }
      const filename = `business-os-backup-${stamp}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.type('application/json').send(JSON.stringify(out, null, 2));
    } catch (e) {
      console.error('backup failed:', e);
      return res.status(500).json({ error: 'backup_failed' });
    }
  }
  const filename = `business-os-backup-${stamp}.db`;
  const tmpPath = path.join(os.tmpdir(), `business-os-backup-${process.pid}-${Date.now()}.db`);
  try {
    await db.vacuumInto(tmpPath);
  } catch (e) {
    console.error('backup failed:', e);
    return res.status(500).json({ error: 'backup_failed' });
  }
  res.download(tmpPath, filename, (err) => {
    fs.unlink(tmpPath, () => { /* best-effort cleanup */ });
    if (err) console.error('backup download failed:', err);
  });
});

// ---------- staff foundation (owner-only) ----------
app.get('/api/staff', requireAuth, requireOwner, async (req, res) => {
  const rows = await db.all(
    `SELECT id, business_id, name, email, role, access, created_at FROM users WHERE business_id = ? ORDER BY (role='owner') DESC, id ASC`
  , req.user.business_id);
  res.json({ staff: rows });
});

app.post('/api/staff', requireAuth, requireOwner, async (req, res) => {
  const { name, email, password, access } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
  const emailNorm = String(email).trim().toLowerCase();
  const existing = await db.get('SELECT id FROM users WHERE email = ?', emailNorm);
  if (existing) return res.status(409).json({ error: 'email already registered' });
  const acc = ['all', 'billing', 'stock'].includes(access) ? access : 'all';
  const hash = bcrypt.hashSync(String(password), 10);
  const r = await db.run(
    `INSERT INTO users (business_id, name, email, password_hash, role, access) VALUES (?, ?, ?, ?, 'staff', ?)`
  , req.user.business_id, String(name).trim(), emailNorm, hash, acc);
  const u = await db.get('SELECT id, business_id, name, email, role, access FROM users WHERE id = ?', r.lastInsertRowid);
  await auditLog(req, 'create', 'staff', r.lastInsertRowid, `Staff joda: ${u.name} (${u.access})`);
  res.status(201).json({ user: u });
});

app.delete('/api/staff/:id', requireAuth, requireOwner, async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id = ? AND business_id = ?', req.params.id, req.user.business_id);
  if (!target) return res.status(404).json({ error: 'user not found' });
  if (target.role === 'owner') return res.status(400).json({ error: 'owner cannot be removed' });
  await db.run('DELETE FROM sessions WHERE user_id = ?', target.id);
  await db.run('DELETE FROM users WHERE id = ? AND business_id = ?', target.id, req.user.business_id);
  await auditLog(req, 'delete', 'staff', target.id, `Staff hataya: ${target.name}`);
  res.json({ ok: true });
});

// =====================================================================
// ---------- Stage 2: Products / Suppliers / Purchases (stock flow) ----------
// Access: owner, or staff with access 'all' or 'stock'. Billing-only staff → 403.
// =====================================================================
function requireStockAccess(req, res, next) {
  if (req.user.role === 'owner') return next();
  if (['all', 'stock'].includes(req.user.access)) return next();
  return res.status(403).json({ error: 'stock_access_only' });
}

const round2 = (n) => { const r = Math.round((Number(n) + Number.EPSILON) * 100) / 100; return r === 0 ? 0 : r; };
function validNum(v) { return v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)); }

function productStatus(p) {
  if (Number(p.stock_qty) === 0) return 'out';
  if (Number(p.stock_qty) <= Number(p.low_stock_limit)) return 'low';
  return 'ok';
}
function publicProduct(p) {
  return {
    id: p.id, business_id: p.business_id, name: p.name, category: p.category, unit: p.unit,
    buy_price: p.buy_price, sell_price: p.sell_price, gst_rate: p.gst_rate,
    hsn_code: p.hsn_code || '',
    stock_qty: p.stock_qty, low_stock_limit: p.low_stock_limit, status: productStatus(p),
    updated_at: p.updated_at, sync_status: p.sync_status
  };
}
async function getOwnedProduct(bizId, id) {
  return await db.get('SELECT * FROM products WHERE id = ? AND business_id = ?', id, bizId);
}
function purchaseStatus(p) {
  if (Number(p.paid_amount) >= Number(p.total)) return 'paid';
  if (Number(p.paid_amount) > 0) return 'partial';
  return 'pending';
}
function publicPurchase(p) {
  return {
    id: p.id, business_id: p.business_id, supplier_id: p.supplier_id,
    supplier_name: p.supplier_name || null, bill_no: p.bill_no, date: p.date,
    due_date: p.due_date || null,
    kind: p.kind || 'purchase',
    total: p.total, paid_amount: p.paid_amount,
    pending_amount: round2(Number(p.total) - Number(p.paid_amount)),
    status: purchaseStatus(p),
    updated_at: p.updated_at, sync_status: p.sync_status
  };
}

// ---------- products ----------
app.get('/api/products', requireAuth, requireStockAccess, async (req, res) => {
  const search = (req.query.search || '').toString().trim();
  let rows;
  if (search) {
    rows = await db.all(
      `SELECT * FROM products WHERE business_id = ? AND (name LIKE ? OR category LIKE ?) ORDER BY name ASC`
    , req.user.business_id, `%${search}%`, `%${search}%`);
  } else {
    rows = await db.all('SELECT * FROM products WHERE business_id = ? ORDER BY name ASC', req.user.business_id);
  }
  res.json({ products: rows.map(publicProduct) });
});

app.post('/api/products', requireAuth, requireStockAccess, async (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'product name is required' });
  if (b.buy_price !== undefined && (!validNum(b.buy_price) || Number(b.buy_price) < 0)) return res.status(400).json({ error: 'buy_price must be a number >= 0' });
  if (b.sell_price !== undefined && (!validNum(b.sell_price) || Number(b.sell_price) < 0)) return res.status(400).json({ error: 'sell_price must be a number >= 0' });
  if (b.gst_rate !== undefined && (!validNum(b.gst_rate) || Number(b.gst_rate) < 0)) return res.status(400).json({ error: 'gst_rate must be a number >= 0' });
  if (b.low_stock_limit !== undefined && (!validNum(b.low_stock_limit) || Number(b.low_stock_limit) < 0)) return res.status(400).json({ error: 'low_stock_limit must be a number >= 0' });
  if (b.stock_qty !== undefined && (!validNum(b.stock_qty) || Number(b.stock_qty) < 0)) return res.status(400).json({ error: 'stock_qty must be a number >= 0' });

  const opening = b.stock_qty !== undefined ? Number(b.stock_qty) : 0;
  const tx = await db.begin();
  try {
    const r = await tx.run(
      `INSERT INTO products (business_id, name, category, unit, buy_price, sell_price, gst_rate, hsn_code, stock_qty, low_stock_limit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    , req.user.business_id, String(b.name).trim(), String(b.category || '').trim(),
      String(b.unit || 'piece').trim() || 'piece',
      b.buy_price !== undefined ? Number(b.buy_price) : 0,
      b.sell_price !== undefined ? Number(b.sell_price) : 0,
      b.gst_rate !== undefined ? Number(b.gst_rate) : 0,
      String(b.hsn_code || '').trim(),
      opening, b.low_stock_limit !== undefined ? Number(b.low_stock_limit) : 5);
    const pid = r.lastInsertRowid;
    if (opening > 0) {
      await tx.run(
        `INSERT INTO stock_movements (business_id, product_id, type, qty_change, ref_id) VALUES (?, ?, 'opening', ?, NULL)`
      , req.user.business_id, pid, opening);
    }
    await tx.commit();
    const createdProduct = await getOwnedProduct(req.user.business_id, pid);
    await auditLog(req, 'create', 'product', pid, `Product banaya: ${createdProduct.name} · sell ${fmtAuditAmt(createdProduct.sell_price)}`);
    return res.status(201).json({ product: publicProduct(createdProduct) });
  } catch (e) {
    await tx.rollback();
    return res.status(500).json({ error: 'could not create product' });
  }
});

app.put('/api/products/:id', requireAuth, requireStockAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const cur = await getOwnedProduct(bizId, req.params.id);
  if (!cur) return res.status(404).json({ error: 'product not found' });
  const b = req.body || {};
  if (b.name !== undefined && !String(b.name).trim()) return res.status(400).json({ error: 'product name cannot be empty' });
  for (const f of ['buy_price', 'sell_price', 'gst_rate', 'low_stock_limit']) {
    if (b[f] !== undefined && (!validNum(b[f]) || Number(b[f]) < 0)) return res.status(400).json({ error: `${f} must be a number >= 0` });
  }
  // Note: stock_qty is NOT editable here — stock changes only via purchases/movements.
  await db.run(
    `UPDATE products SET name=?, category=?, unit=?, buy_price=?, sell_price=?, gst_rate=?, hsn_code=?, low_stock_limit=?,
       updated_at=datetime('now'), sync_status='local' WHERE id=? AND business_id=?`
  , b.name !== undefined ? String(b.name).trim() : cur.name,
    b.category !== undefined ? String(b.category).trim() : cur.category,
    b.unit !== undefined ? (String(b.unit).trim() || 'piece') : cur.unit,
    b.buy_price !== undefined ? Number(b.buy_price) : cur.buy_price,
    b.sell_price !== undefined ? Number(b.sell_price) : cur.sell_price,
    b.gst_rate !== undefined ? Number(b.gst_rate) : cur.gst_rate,
    b.hsn_code !== undefined ? String(b.hsn_code).trim() : (cur.hsn_code || ''),
    b.low_stock_limit !== undefined ? Number(b.low_stock_limit) : cur.low_stock_limit,
    cur.id, bizId);
  const updProduct = await getOwnedProduct(bizId, cur.id);
  await auditLog(req, 'update', 'product', cur.id, `Product badla: ${updProduct.name} · sell ${fmtAuditAmt(updProduct.sell_price)}`);
  res.json({ product: publicProduct(updProduct) });
});

app.delete('/api/products/:id', requireAuth, requireStockAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const cur = await getOwnedProduct(bizId, req.params.id);
  if (!cur) return res.status(404).json({ error: 'product not found' });
  const used = await db.get('SELECT COUNT(*) AS c FROM purchase_items WHERE product_id = ? AND business_id = ?', cur.id, bizId);
  if (used.c > 0) return res.status(400).json({ error: 'product_used_in_purchases' });
  await recordTombstone(bizId, 'products', cur.id);
  const tx = await db.begin();
  try {
    await tx.run('DELETE FROM stock_movements WHERE product_id = ? AND business_id = ?', cur.id, bizId);
    await tx.run('DELETE FROM products WHERE id = ? AND business_id = ?', cur.id, bizId);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    return res.status(500).json({ error: 'could not delete product' });
  }
  await auditLog(req, 'delete', 'product', cur.id, `Product delete kiya: ${cur.name}`);
  res.json({ ok: true });
});

// ---------- low stock ----------
app.get('/api/low-stock', requireAuth, requireStockAccess, async (req, res) => {
  const rows = await db.all(
    `SELECT * FROM products WHERE business_id = ? AND stock_qty <= low_stock_limit ORDER BY stock_qty ASC, name ASC`
  , req.user.business_id);
  res.json({ products: rows.map(publicProduct) });
});

// ---------- suppliers ----------
function publicSupplier(s) {
  return {
    id: s.id, business_id: s.business_id, name: s.name, phone: s.phone, city: s.city,
    total_purchased: round2(s.total_purchased || 0), total_paid: round2(s.total_paid || 0),
    pending: round2((s.total_purchased || 0) - (s.total_paid || 0)),
    updated_at: s.updated_at, sync_status: s.sync_status
  };
}
async function supplierRow(bizId, id) {
  return await db.get(
    `SELECT s.*, COALESCE(SUM(p.total),0) AS total_purchased, COALESCE(SUM(p.paid_amount),0) AS total_paid
     FROM suppliers s LEFT JOIN purchases p ON p.supplier_id = s.id AND p.business_id = s.business_id
     WHERE s.id = ? AND s.business_id = ? GROUP BY s.id`
  , id, bizId);
}

app.get('/api/suppliers', requireAuth, requireStockAccess, async (req, res) => {
  const rows = await db.all(
    `SELECT s.*, COALESCE(SUM(p.total),0) AS total_purchased, COALESCE(SUM(p.paid_amount),0) AS total_paid
     FROM suppliers s LEFT JOIN purchases p ON p.supplier_id = s.id AND p.business_id = s.business_id
     WHERE s.business_id = ? GROUP BY s.id ORDER BY s.name ASC`
  , req.user.business_id);
  res.json({ suppliers: rows.map(publicSupplier) });
});

app.post('/api/suppliers', requireAuth, requireStockAccess, async (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'supplier name is required' });
  const r = await db.run(
    `INSERT INTO suppliers (business_id, name, phone, city) VALUES (?, ?, ?, ?)`
  , req.user.business_id, String(b.name).trim(), String(b.phone || '').trim(), String(b.city || '').trim());
  const newSupplier = await supplierRow(req.user.business_id, r.lastInsertRowid);
  await auditLog(req, 'create', 'supplier', r.lastInsertRowid, `Supplier banaya: ${newSupplier.name}`);
  res.status(201).json({ supplier: publicSupplier(newSupplier) });
});

app.put('/api/suppliers/:id', requireAuth, requireStockAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const cur = await supplierRow(bizId, req.params.id);
  if (!cur) return res.status(404).json({ error: 'supplier not found' });
  const b = req.body || {};
  if (b.name !== undefined && !String(b.name).trim()) return res.status(400).json({ error: 'supplier name cannot be empty' });
  await db.run(
    `UPDATE suppliers SET name=?, phone=?, city=?, updated_at=datetime('now'), sync_status='local' WHERE id=? AND business_id=?`
  , b.name !== undefined ? String(b.name).trim() : cur.name,
    b.phone !== undefined ? String(b.phone).trim() : cur.phone,
    b.city !== undefined ? String(b.city).trim() : cur.city,
    cur.id, bizId);
  const updSupplier = await supplierRow(bizId, cur.id);
  await auditLog(req, 'update', 'supplier', cur.id, `Supplier badla: ${updSupplier.name}`);
  res.json({ supplier: publicSupplier(updSupplier) });
});

app.delete('/api/suppliers/:id', requireAuth, requireStockAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const cur = await db.get('SELECT * FROM suppliers WHERE id = ? AND business_id = ?', req.params.id, bizId);
  if (!cur) return res.status(404).json({ error: 'supplier not found' });
  const used = await db.get('SELECT COUNT(*) AS c FROM purchases WHERE supplier_id = ? AND business_id = ?', cur.id, bizId);
  if (used.c > 0) return res.status(400).json({ error: 'supplier_has_purchases' });
  await recordTombstone(bizId, 'suppliers', cur.id);
  await db.run('DELETE FROM suppliers WHERE id = ? AND business_id = ?', cur.id, bizId);
  await auditLog(req, 'delete', 'supplier', cur.id, `Supplier delete kiya: ${cur.name}`);
  res.json({ ok: true });
});

// ---------- purchases ----------
app.get('/api/purchases', requireAuth, requireStockAccess, async (req, res) => {
  const rows = await db.all(
    `SELECT p.*, s.name AS supplier_name FROM purchases p
     LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.business_id = p.business_id
     WHERE p.business_id = ? ORDER BY p.id DESC`
  , req.user.business_id);
  res.json({ purchases: rows.map(publicPurchase) });
});

app.get('/api/purchases/:id', requireAuth, requireStockAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const p = await db.get(
    `SELECT p.*, s.name AS supplier_name FROM purchases p
     LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.business_id = p.business_id
     WHERE p.id = ? AND p.business_id = ?`
  , req.params.id, bizId);
  if (!p) return res.status(404).json({ error: 'purchase not found' });
  const items = await db.all(
    `SELECT pi.*, pr.name AS product_name, pr.unit AS product_unit FROM purchase_items pi
     LEFT JOIN products pr ON pr.id = pi.product_id AND pr.business_id = pi.business_id
     WHERE pi.purchase_id = ? AND pi.business_id = ? ORDER BY pi.id ASC`
  , p.id, bizId);
  const payments = await db.all(
    `SELECT * FROM supplier_payments WHERE purchase_id = ? AND business_id = ? ORDER BY id ASC`
  , p.id, bizId);
  res.json({ purchase: publicPurchase(p), items, payments });
});

app.post('/api/purchases', requireAuth, requireStockAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const b = req.body || {};
  if (!b.supplier_id) return res.status(400).json({ error: 'supplier_id is required' });
  const supplier = await db.get('SELECT * FROM suppliers WHERE id = ? AND business_id = ?', b.supplier_id, bizId);
  if (!supplier) return res.status(404).json({ error: 'supplier not found' });
  if (!Array.isArray(b.items) || b.items.length === 0) return res.status(400).json({ error: 'at least one item is required' });

  // Validate all items first (ownership + numbers) before touching stock.
  const items = [];
  for (const it of b.items) {
    if (!it || !it.product_id) return res.status(400).json({ error: 'each item needs a product_id' });
    const prod = await getOwnedProduct(bizId, it.product_id);
    if (!prod) return res.status(404).json({ error: 'product not found' });
    if (!validNum(it.qty) || Number(it.qty) <= 0) return res.status(400).json({ error: 'qty must be greater than 0' });
    const price = it.buy_price !== undefined ? it.buy_price : prod.buy_price;
    if (!validNum(price) || Number(price) < 0) return res.status(400).json({ error: 'buy_price must be a number >= 0' });
    items.push({ product_id: prod.id, qty: Number(it.qty), buy_price: Number(price), amount: round2(Number(it.qty) * Number(price)) });
  }
  const total = round2(items.reduce((s, i) => s + i.amount, 0));
  const paid = b.paid_amount !== undefined ? Number(b.paid_amount) : 0;
  if (!Number.isFinite(paid) || paid < 0 || round2(paid) > total) {
    return res.status(400).json({ error: 'paid_amount must be between 0 and the purchase total' });
  }
  const date = b.date ? String(b.date).trim() : new Date().toISOString().slice(0, 10);
  const modes = ['Cash', 'UPI', 'Bank'];
  const mode = modes.includes(b.paid_mode) ? b.paid_mode : 'Cash';
  // Feature 5: optional due date (no auto-default for purchases — the
  // owner sets it when the supplier has given a payment date).
  const purDue = parseDueDateInput(b);
  if (purDue.error) return res.status(400).json({ error: purDue.error });

  const tx = await db.begin();
  try {
    const r = await tx.run(
      `INSERT INTO purchases (business_id, supplier_id, bill_no, date, total, paid_amount, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)`
    , bizId, supplier.id, String(b.bill_no || '').trim(), date, total, round2(paid), purDue.given ? purDue.value : null);
    const purchaseId = r.lastInsertRowid;
    const insItemSql =
      `INSERT INTO purchase_items (business_id, purchase_id, product_id, qty, buy_price, amount) VALUES (?, ?, ?, ?, ?, ?)`;
    const updStockSql =
      `UPDATE products SET stock_qty = stock_qty + ?, updated_at=datetime('now'), sync_status='local' WHERE id=? AND business_id=?`;
    const insMoveSql =
      `INSERT INTO stock_movements (business_id, product_id, type, qty_change, ref_id) VALUES (?, ?, 'purchase', ?, ?)`;
    for (const it of items) {
      await tx.run(insItemSql, bizId, purchaseId, it.product_id, it.qty, it.buy_price, it.amount);
      await tx.run(updStockSql, it.qty, it.product_id, bizId);
      await tx.run(insMoveSql, bizId, it.product_id, it.qty, purchaseId);
    }
    if (paid > 0) {
      await tx.run(
        `INSERT INTO supplier_payments (business_id, purchase_id, amount, mode, date) VALUES (?, ?, ?, ?, ?)`
      , bizId, purchaseId, round2(paid), mode, date);
    }
    await tx.commit();
    const p = await db.get(
      `SELECT p.*, s.name AS supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`
    , purchaseId);
    await auditLog(req, 'create', 'purchase', purchaseId, `Purchase banayi: ${supplier.name} · kul ${fmtAuditAmt(total)}`);
    queueSync();
    return res.status(201).json({ purchase: publicPurchase(p) });
  } catch (e) {
    await tx.rollback();
    return res.status(500).json({ error: 'could not save purchase' });
  }
});

app.post('/api/purchases/:id/payments', requireAuth, requireStockAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const p = await db.get('SELECT * FROM purchases WHERE id = ? AND business_id = ?', req.params.id, bizId);
  if (!p) return res.status(404).json({ error: 'purchase not found' });
  const b = req.body || {};
  if (!validNum(b.amount) || Number(b.amount) <= 0) return res.status(400).json({ error: 'amount must be greater than 0' });
  const amount = round2(Number(b.amount));
  if (round2(Number(p.paid_amount) + amount) > round2(Number(p.total))) {
    return res.status(400).json({ error: 'payment is more than the pending amount' });
  }
  const modes = ['Cash', 'UPI', 'Bank'];
  const mode = modes.includes(b.mode) ? b.mode : 'Cash';
  const date = b.date ? String(b.date).trim() : new Date().toISOString().slice(0, 10);
  const tx = await db.begin();
  try {
    const r = await tx.run(
      `INSERT INTO supplier_payments (business_id, purchase_id, amount, mode, date) VALUES (?, ?, ?, ?, ?)`
    , bizId, p.id, amount, mode, date);
    await tx.run(
      `UPDATE purchases SET paid_amount = paid_amount + ?, updated_at=datetime('now'), sync_status='local' WHERE id=? AND business_id=?`
    , amount, p.id, bizId);
    await tx.commit();
    const payment = await db.get('SELECT * FROM supplier_payments WHERE id = ?', r.lastInsertRowid);
    const updated = await db.get(
      `SELECT p.*, s.name AS supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`
    , p.id);
    await auditLog(req, 'create', 'supplier_payment', r.lastInsertRowid, `Supplier payment diya: ${fmtAuditAmt(amount)} · purchase #${p.id}`);
    queueSync();
    return res.status(201).json({ payment, purchase: publicPurchase(updated) });
  } catch (e) {
    await tx.rollback();
    return res.status(500).json({ error: 'could not record payment' });
  }
});

// Feature 5: set / change / clear a purchase's due date after creation.
app.post('/api/purchases/:id/due-date', requireAuth, requireStockAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const p = await db.get('SELECT * FROM purchases WHERE id = ? AND business_id = ?', req.params.id, bizId);
  if (!p) return res.status(404).json({ error: 'purchase not found' });
  const parsed = parseDueDateInput(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (!parsed.given) return res.status(400).json({ error: 'due_date is required' });
  await db.run(
    `UPDATE purchases SET due_date = ?, updated_at = datetime('now'), sync_status = 'local' WHERE id = ? AND business_id = ?`
  , parsed.value, p.id, bizId);
  await auditLog(req, 'update', 'purchase', p.id, `Purchase #${p.id} ki due date ${parsed.value ? 'lagayi: ' + parsed.value : 'hatayi'}`);
  queueSync();
  const updated = await db.get(
    `SELECT p.*, s.name AS supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`
  , p.id);
  res.json({ purchase: publicPurchase(updated) });
});

// =====================================================================
// ---------- Stage 3: Customers / Invoices / Customer payments ----------
// Access: owner, or staff with access 'all' or 'billing'. Stock-only staff → 403.
// Sell prices are GST-inclusive (MRP style): an item's GST part is
// amount × rate/(100+rate), and only when the business has GST ON.
// =====================================================================
function requireBillingAccess(req, res, next) {
  if (req.user.role === 'owner') return next();
  if (['all', 'billing'].includes(req.user.access)) return next();
  return res.status(403).json({ error: 'billing_access_only' });
}

// ---------- customers ----------
function publicCustomer(c) {
  return {
    id: c.id, business_id: c.business_id, name: c.name, phone: c.phone, city: c.city,
    gstin: c.gstin || '',
    total_billed: round2(c.total_billed || 0), total_received: round2(c.total_received || 0),
    // Feature 2: sales returns net out of pending EVERYWHERE pending is
    // shown — pending = billed − received − returns. A customer whose
    // returns exceed their balance goes net-credit (negative pending),
    // and that is shown as-is, consistently, in every view.
    total_returns: round2(c.total_returns || 0),
    pending: round2((c.total_billed || 0) - (c.total_received || 0) - (c.total_returns || 0)),
    // Feature 4: only WHETHER a hisab link is live — the token itself is
    // returned solely by the hisab-link endpoints, never in list payloads.
    hisab_enabled: !!c.share_token,
    updated_at: c.updated_at, sync_status: c.sync_status
  };
}
// The returns total rides along as a scalar subquery so every caller of
// customerRow / the customers list gets the same pending math.
const CUSTOMER_RETURNS_SQL =
  `COALESCE((SELECT SUM(r.total_amount) FROM returns r WHERE r.customer_id = c.id AND r.business_id = c.business_id), 0) AS total_returns`;
async function customerRow(bizId, id) {
  return await db.get(
    `SELECT c.*, COALESCE(SUM(i.total),0) AS total_billed, COALESCE(SUM(i.paid_amount),0) AS total_received,
       ${CUSTOMER_RETURNS_SQL}
     FROM customers c LEFT JOIN invoices i ON i.customer_id = c.id AND i.business_id = c.business_id AND i.cancelled_at IS NULL
     WHERE c.id = ? AND c.business_id = ? GROUP BY c.id`
  , id, bizId);
}

app.get('/api/customers', requireAuth, requireBillingAccess, async (req, res) => {
  const rows = await db.all(
    `SELECT c.*, COALESCE(SUM(i.total),0) AS total_billed, COALESCE(SUM(i.paid_amount),0) AS total_received,
       ${CUSTOMER_RETURNS_SQL}
     FROM customers c LEFT JOIN invoices i ON i.customer_id = c.id AND i.business_id = c.business_id AND i.cancelled_at IS NULL
     WHERE c.business_id = ? GROUP BY c.id ORDER BY c.name ASC`
  , req.user.business_id);
  res.json({ customers: rows.map(publicCustomer) });
});

app.post('/api/customers', requireAuth, requireBillingAccess, async (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'customer name is required' });
  const r = await db.run(
    `INSERT INTO customers (business_id, name, phone, city, gstin) VALUES (?, ?, ?, ?, ?)`
  , req.user.business_id, String(b.name).trim(), String(b.phone || '').trim(), String(b.city || '').trim(),
    String(b.gstin || '').trim().toUpperCase());
  const newCustomer = await customerRow(req.user.business_id, r.lastInsertRowid);
  await auditLog(req, 'create', 'customer', r.lastInsertRowid, `Customer banaya: ${newCustomer.name}`);
  res.status(201).json({ customer: publicCustomer(newCustomer) });
});

app.get('/api/customers/:id', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const c = await customerRow(bizId, req.params.id);
  if (!c) return res.status(404).json({ error: 'customer not found' });
  const rows = await db.all(
    `SELECT * FROM invoices WHERE customer_id = ? AND business_id = ? ORDER BY id DESC`
  , c.id, bizId);
  // Feature 5: this customer's next due date + the amount falling due
  // that day (unpaid bills with a due date set), for the detail screen.
  const due = await db.get(
    `SELECT MIN(due_date) AS next_due_date,
       COALESCE(SUM(total - paid_amount), 0) AS total_due_amount,
       COALESCE(SUM(CASE WHEN due_date = (SELECT MIN(due_date) FROM invoices
         WHERE business_id = ? AND customer_id = ? AND due_date IS NOT NULL AND paid_amount < total AND cancelled_at IS NULL)
         THEN total - paid_amount ELSE 0 END), 0) AS amount_on_next
     FROM invoices
     WHERE business_id = ? AND customer_id = ? AND due_date IS NOT NULL AND paid_amount < total AND cancelled_at IS NULL`
  , bizId, c.id, bizId, c.id);
  const dueInfo = due && due.next_due_date ? {
    next_due_date: due.next_due_date,
    amount: round2(due.amount_on_next),
    total_due_amount: round2(due.total_due_amount)
  } : null;
  res.json({ customer: publicCustomer(c), invoices: rows.map(publicInvoice), due_info: dueInfo });
});

// ---------- Feature 4: Customer Hisab public link ----------
// The owner mints a per-customer share token; anyone holding the link
// sees ONLY that customer's own bills/payments/baaki on a public page
// served by this backend (GET /hisab/:token). The token is a credential:
// it is never exposed in list payloads (publicCustomer carries only
// hisab_enabled), regenerating kills the old link, disabling clears it.
function newShareToken() { return crypto.randomBytes(24).toString('hex'); }

app.post('/api/customers/:id/hisab-link', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const c = await customerRow(bizId, req.params.id);
  if (!c) return res.status(404).json({ error: 'customer not found' });
  let token = c.share_token || null;
  if (!token) {
    token = newShareToken();
    await db.run(
      `UPDATE customers SET share_token = ?, updated_at = datetime('now') WHERE id = ? AND business_id = ?`
    , token, c.id, bizId);
    await auditLog(req, 'create', 'hisab_link', c.id, `Hisab link banaya: ${c.name}`);
  }
  res.json({ token, url_path: '/hisab/' + token });
});

app.post('/api/customers/:id/hisab-link/regenerate', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const c = await customerRow(bizId, req.params.id);
  if (!c) return res.status(404).json({ error: 'customer not found' });
  const token = newShareToken();
  await db.run(
    `UPDATE customers SET share_token = ?, updated_at = datetime('now') WHERE id = ? AND business_id = ?`
  , token, c.id, bizId);
  await auditLog(req, 'update', 'hisab_link', c.id, `Hisab link naya banaya (purana band): ${c.name}`);
  res.json({ token, url_path: '/hisab/' + token });
});

async function disableHisabLink(req, res) {
  const bizId = req.user.business_id;
  const c = await customerRow(bizId, req.params.id);
  if (!c) return res.status(404).json({ error: 'customer not found' });
  await db.run(
    `UPDATE customers SET share_token = NULL, updated_at = datetime('now') WHERE id = ? AND business_id = ?`
  , c.id, bizId);
  await auditLog(req, 'update', 'hisab_link', c.id, `Hisab link band kiya: ${c.name}`);
  res.json({ ok: true });
}
app.post('/api/customers/:id/hisab-link/disable', requireAuth, requireBillingAccess, disableHisabLink);
app.delete('/api/customers/:id/hisab-link', requireAuth, requireBillingAccess, disableHisabLink);

// Public hisab JSON — NO auth, keyed by the share token alone. Returns
// exactly one customer's data and nothing else; the pending figure uses
// the same computation as the app's own customer pending (returns incl.).
app.get('/api/public/hisab/:token', async (req, res) => {
  const token = String(req.params.token || '');
  if (!token) return res.status(404).json({ error: 'link_not_found' });
  const c = await db.get('SELECT * FROM customers WHERE share_token = ?', token);
  if (!c) return res.status(404).json({ error: 'link_not_found' });
  const bizId = c.business_id;
  const biz = await getBusiness(bizId);
  const full = await customerRow(bizId, c.id);
  const pub = publicCustomer(full);
  const bills = await db.all(
    `SELECT bill_no, date, total, paid_amount, kind FROM invoices
     WHERE customer_id = ? AND business_id = ? AND cancelled_at IS NULL ORDER BY id DESC`
  , c.id, bizId);
  const payments = await db.all(
    `SELECT cp.date AS date, cp.amount AS amount, cp.mode AS mode
     FROM customer_payments cp JOIN invoices i ON i.id = cp.invoice_id AND i.business_id = cp.business_id
     WHERE i.customer_id = ? AND cp.business_id = ? ORDER BY cp.id DESC`
  , c.id, bizId);
  res.json({
    business: { name: biz ? biz.name : '', language: biz && ['hi', 'hg'].includes(biz.language) ? biz.language : 'en' },
    customer: { name: c.name },
    pending: pub.pending,
    total_billed: pub.total_billed,
    total_received: pub.total_received,
    total_returns: pub.total_returns,
    bills: bills.map((b) => ({
      bill_no: b.bill_no, date: b.date, total: round2(b.total), paid: round2(b.paid_amount),
      balance: round2(Number(b.total) - Number(b.paid_amount)), kind: b.kind || 'sale'
    })),
    payments: payments.map((p) => ({ date: p.date, amount: round2(p.amount), mode: p.mode }))
  });
});

app.put('/api/customers/:id', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const cur = await customerRow(bizId, req.params.id);
  if (!cur) return res.status(404).json({ error: 'customer not found' });
  const b = req.body || {};
  if (b.name !== undefined && !String(b.name).trim()) return res.status(400).json({ error: 'customer name cannot be empty' });
  await db.run(
    `UPDATE customers SET name=?, phone=?, city=?, gstin=?, updated_at=datetime('now'), sync_status='local' WHERE id=? AND business_id=?`
  , b.name !== undefined ? String(b.name).trim() : cur.name,
    b.phone !== undefined ? String(b.phone).trim() : cur.phone,
    b.city !== undefined ? String(b.city).trim() : cur.city,
    b.gstin !== undefined ? String(b.gstin).trim().toUpperCase() : (cur.gstin || ''),
    cur.id, bizId);
  const updCustomer = await customerRow(bizId, cur.id);
  await auditLog(req, 'update', 'customer', cur.id, `Customer badla: ${updCustomer.name}`);
  res.json({ customer: publicCustomer(updCustomer) });
});

app.delete('/api/customers/:id', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const cur = await db.get('SELECT * FROM customers WHERE id = ? AND business_id = ?', req.params.id, bizId);
  if (!cur) return res.status(404).json({ error: 'customer not found' });
  const used = await db.get('SELECT COUNT(*) AS c FROM invoices WHERE customer_id = ? AND business_id = ?', cur.id, bizId);
  if (used.c > 0) return res.status(400).json({ error: 'customer_has_invoices' });
  await recordTombstone(bizId, 'customers', cur.id);
  await db.run('DELETE FROM customers WHERE id = ? AND business_id = ?', cur.id, bizId);
  await auditLog(req, 'delete', 'customer', cur.id, `Customer delete kiya: ${cur.name}`);
  res.json({ ok: true });
});

// ---------- invoices ----------
function invoiceStatus(inv) {
  if (inv.cancelled_at) return 'cancelled';
  if (Number(inv.paid_amount) >= Number(inv.total)) return 'paid';
  if (Number(inv.paid_amount) > 0) return 'partial';
  return 'pending';
}
// ---------- Features 1+2: estimate / return serializers ----------
function publicEstimate(e) {
  return {
    id: e.id, business_id: e.business_id, customer_id: e.customer_id || null,
    customer_name: e.customer_name, estimate_no: e.estimate_no, date: e.date,
    subtotal: round2(e.subtotal), discount: round2(e.discount),
    gst_enabled: !!e.gst_enabled, gst_amount: round2(e.gst_amount),
    total: round2(e.total), status: e.status,
    converted_invoice_id: e.converted_invoice_id || null,
    created_by: e.created_by || null, created_at: e.created_at, updated_at: e.updated_at
  };
}
function publicReturn(r) {
  return {
    id: r.id, business_id: r.business_id, invoice_id: r.invoice_id,
    customer_id: r.customer_id || null, return_no: r.return_no, date: r.date,
    total_amount: round2(r.total_amount), gst_amount: round2(r.gst_amount),
    reason: r.reason || null, created_by: r.created_by || null,
    created_at: r.created_at, updated_at: r.updated_at
  };
}

function publicInvoice(inv) {
  return {
    id: inv.id, business_id: inv.business_id, bill_no: inv.bill_no,
    customer_id: inv.customer_id, customer_name: inv.customer_name, date: inv.date,
    subtotal: inv.subtotal, discount: inv.discount,
    gst_enabled: !!inv.gst_enabled, gst_amount: inv.gst_amount,
    total: inv.total, paid_amount: inv.paid_amount,
    pending_amount: round2(Number(inv.total) - Number(inv.paid_amount)),
    status: invoiceStatus(inv), payment_mode: inv.payment_mode || null,
    due_date: inv.due_date || null,
    kind: inv.kind || 'sale',
    cancelled: !!inv.cancelled_at,
    cancelled_at: inv.cancelled_at || null,
    cancel_reason: inv.cancel_reason || null,
    updated_at: inv.updated_at, sync_status: inv.sync_status
  };
}
async function getOwnedInvoice(bizId, id) {
  return await db.get('SELECT * FROM invoices WHERE id = ? AND business_id = ?', id, bizId);
}

// ---------- Updates Stage A: UPI payment URI + QR ----------
// The payee name defaults to the business name; upi_payee_name overrides
// it when the owner wants a different name shown inside UPI apps. The
// amount is always the exact amount still to collect, formatted to 2
// decimals as UPI apps expect. No UPI ID set (or nothing due) → null,
// and callers render/send NOTHING — a QR is never faked.
function upiPayeeName(biz) {
  const custom = biz && biz.upi_payee_name ? String(biz.upi_payee_name).trim() : '';
  return custom || (biz && biz.name ? String(biz.name).trim() : '') || 'BizYour';
}
function buildUpiUri(biz, amount, billNo) {
  if (!biz || !biz.upi_id) return null;
  const am = round2(Number(amount) || 0);
  if (!(am > 0)) return null;
  let uri = `upi://pay?pa=${encodeURIComponent(biz.upi_id)}&pn=${encodeURIComponent(upiPayeeName(biz))}&am=${am.toFixed(2)}&cu=INR`;
  if (billNo !== undefined && billNo !== null) uri += `&tn=${encodeURIComponent('Bill ' + billNo)}`;
  return uri;
}
function upiQrFor(biz, amount, billNo) {
  const uri = buildUpiUri(biz, amount, billNo);
  if (!uri) return null;
  const svg = qrSvg(uri); // vendored local generator — zero external calls
  return svg ? { payload: uri, svg } : null;
}

// Minimal product picker for the billing screen. /api/products stays
// stock-gated (Stage 2 rule), so billing users get their own read-only list.
app.get('/api/billing-products', requireAuth, requireBillingAccess, async (req, res) => {
  const rows = await db.all(
    `SELECT id, name, unit, sell_price, gst_rate, stock_qty FROM products WHERE business_id = ? ORDER BY name ASC`
  , req.user.business_id);
  res.json({ products: rows });
});

app.get('/api/invoices', requireAuth, requireBillingAccess, async (req, res) => {
  const rows = await db.all(
    `SELECT * FROM invoices WHERE business_id = ? ORDER BY id DESC`
  , req.user.business_id);
  res.json({ invoices: rows.map(publicInvoice) });
});

// ---------- Recent items strip (New Bill screen) ----------
// The shop's most recently billed distinct products (latest bill first,
// ~10), each with the rate it was last billed at. Cancelled bills are
// excluded. Billing is staff-allowed, so this is too.
app.get('/api/billing/recent-items', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  // Portable across SQLite + Postgres: newest bill lines first, keep
  // the first (latest) line per product until 10 distinct products.
  const rows = await db.all(
    `SELECT ii.product_id AS product_id, ii.product_name AS name,
            ii.sell_price AS last_rate, p.unit AS unit
     FROM invoice_items ii
     JOIN invoices i ON i.id = ii.invoice_id AND i.business_id = ii.business_id
     LEFT JOIN products p ON p.id = ii.product_id AND p.business_id = ii.business_id
     WHERE ii.business_id = ? AND i.kind = 'sale' AND i.cancelled_at IS NULL AND ii.product_id IS NOT NULL
     ORDER BY i.id DESC, ii.id DESC
     LIMIT 300`
  , bizId);
  const seen = new Set();
  const items = [];
  for (const r of rows) {
    if (seen.has(r.product_id)) continue;
    seen.add(r.product_id);
    items.push({
      product_id: r.product_id, name: r.name,
      last_rate: Number(r.last_rate), unit: r.unit || 'pcs'
    });
    if (items.length >= 10) break;
  }
  res.json({ items });
});

app.get('/api/invoices/:id', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const inv = await getOwnedInvoice(bizId, req.params.id);
  if (!inv) return res.status(404).json({ error: 'invoice not found' });
  const biz = await getBusiness(bizId);
  const items = await db.all(
    `SELECT ii.*, p.hsn_code AS hsn_code, p.unit AS p_unit
     FROM invoice_items ii
     LEFT JOIN products p ON p.id = ii.product_id AND p.business_id = ii.business_id
     WHERE ii.invoice_id = ? AND ii.business_id = ? ORDER BY ii.id ASC`
  , inv.id, bizId);
  const payments = await db.all(
    `SELECT * FROM customer_payments WHERE invoice_id = ? AND business_id = ? ORDER BY id ASC`
  , inv.id, bizId);
  // Feature 2: this bill's returns (credit notes) + per-item returned
  // quantities, so the detail screen can show the net picture and cap
  // the return form at what is actually returnable.
  const invReturns = await db.all(
    `SELECT * FROM returns WHERE invoice_id = ? AND business_id = ? ORDER BY id ASC`
  , inv.id, bizId);
  const retQtyRows = await db.all(
    `SELECT ri.invoice_item_id AS iid, COALESCE(SUM(ri.qty), 0) AS q
     FROM return_items ri JOIN returns r ON r.id = ri.return_id AND r.business_id = ri.business_id
     WHERE r.invoice_id = ? AND ri.business_id = ? GROUP BY ri.invoice_item_id`
  , inv.id, bizId);
  const retQtyByItem = new Map(retQtyRows.map((x) => [Number(x.iid), Number(x.q)]));
  items.forEach((it) => {
    it.returned_qty = retQtyByItem.get(Number(it.id)) || 0;
    it.returnable_qty = round2(Number(it.qty) - it.returned_qty);
  });
  const returnsTotal = round2(invReturns.reduce((s, r) => s + Number(r.total_amount), 0));
  const netTotal = round2(Number(inv.total) - returnsTotal);
  const netPending = round2(netTotal - Number(inv.paid_amount));
  // Updates Stage B: E-Way / E-Invoice portal docs are a TOP-PLAN feature;
  // the detail screen needs the gate state + data readiness up front so it
  // can show either the download buttons or an honest upgrade note.
  const topPlanNow = await getTopPlan();
  const portalDocs = {
    top_plan: await isTopPlan(bizId),
    top_plan_name: topPlanNow ? topPlanNow.name : null,
    business_gstin_missing: !(biz && String(biz.gstin || '').trim()),
    items_missing_hsn: items.filter((it) => !String(it.hsn_code || '').trim()).length
  };
  const customer = inv.customer_id ? await customerRow(bizId, inv.customer_id) : null;
  const pubInv = publicInvoice(inv);
  res.json({
    invoice: pubInv,
    business: {
      name: biz ? biz.name : '', owner_name: biz ? biz.owner_name : '',
      phone: biz ? biz.phone : '', city: biz ? biz.city : '',
      gstin: biz ? biz.gstin : '', gst_enabled: !!inv.gst_enabled,
      // Bill PDF redesign: the shop's UPI ID + its OWN uploaded payment
      // QR image — the printed bill shows ONLY the uploaded QR (never an
      // amount-generated one), and no QR block at all when none is set.
      upi_id: biz ? (biz.upi_id || '') : '',
      payment_qr: biz ? (biz.payment_qr || null) : null
    },
    // Updates Stage A: scan-to-pay QR for the exact balance due — null
    // when no UPI ID is set or the bill is fully paid (nothing is shown).
    // Feature 2: the amount is the NET balance (returns subtracted) —
    // with no returns this is exactly the old pending_amount.
    upi_qr: inv.cancelled_at ? null : upiQrFor(biz, netPending, inv.bill_no),
    // Updates Stage B: top-plan gate + readiness for the portal-docs area.
    portal_docs: portalDocs,
    customer: customer ? publicCustomer(customer) : null,
    // Feature 2: credit notes on this bill + net figures.
    returns: invReturns.map(publicReturn),
    returns_total: returnsTotal,
    net_total: netTotal,
    net_pending: netPending,
    items, payments
  });
});

// ---------- Updates Stage B: E-Way / E-Invoice portal files (TOP PLAN) ----------
// These endpoints only PREPARE a portal-ready JSON from the bill. The
// actual generation happens free on the government portals (the UI links
// there); there is deliberately NO server-side call to any portal/GSP.
async function loadPortalDocData(bizId, invId) {
  const inv = await getOwnedInvoice(bizId, invId);
  if (!inv) return null;
  const biz = await getBusiness(bizId);
  const items = await db.all(
    `SELECT ii.*, p.hsn_code AS hsn_code, p.unit AS p_unit
     FROM invoice_items ii
     LEFT JOIN products p ON p.id = ii.product_id AND p.business_id = ii.business_id
     WHERE ii.invoice_id = ? AND ii.business_id = ? ORDER BY ii.id ASC`
  , inv.id, bizId);
  const customer = inv.customer_id
    ? await db.get('SELECT * FROM customers WHERE id = ? AND business_id = ?', inv.customer_id, bizId)
    : null;
  return { inv, biz, items, customer };
}
function portalMissingFields(d, kind) {
  const missing = [];
  if (!d.biz || !String(d.biz.gstin || '').trim()) missing.push('business_gstin');
  const noHsn = d.items.filter((it) => !String(it.hsn_code || '').trim());
  if (noHsn.length) missing.push('items_missing_hsn: ' + noHsn.map((i) => i.product_name).join(', '));
  if (kind === 'einvoice' && !d.inv.gst_enabled) missing.push('gst_invoice_required');
  return missing;
}
function sendJsonDownload(res, filename, obj) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(JSON.stringify(obj, null, 2));
}

app.get('/api/invoices/:id/eway-json', requireAuth, requireBillingAccess, requireTopPlan, async (req, res) => {
  const d = await loadPortalDocData(req.user.business_id, req.params.id);
  if (d && d.inv && d.inv.cancelled_at) return res.status(400).json({ error: 'invoice_cancelled' });
  if (!d) return res.status(404).json({ error: 'invoice not found' });
  const missing = portalMissingFields(d, 'eway');
  if (missing.length) return res.status(400).json({ error: 'missing_fields', missing_fields: missing });
  const { inv, biz, items, customer } = d;
  const fromGstin = String(biz.gstin).trim().toUpperCase();
  const toGstin = customer && validGstin(customer.gstin) ? String(customer.gstin).trim().toUpperCase() : 'URP';
  const fromState = Number(fromGstin.slice(0, 2)) || null;
  const math = invoiceLineMath(inv, items);
  const taxTotal = round2(math.net.reduce((s, l) => s + l.tax, 0));
  const split = splitCgstSgst(taxTotal);
  // Approximates the NIC e-way bill bulk-upload JSON. Business OS stores
  // no pincodes, so from/to pincode fields are omitted — the portal asks
  // for them during generation (see the Stage B report).
  const doc = {
    userGstin: fromGstin,
    supplyType: 'O', subSupplyType: '1', subSupplyDesc: '',
    docType: 'INV', docNo: String(inv.bill_no), docDate: ddmmyyyy(inv.date),
    fromGstin, fromTrdName: biz.name || '', fromAddr1: '', fromPlace: biz.city || '',
    fromStateCode: fromState, actFromStateCode: fromState,
    toGstin, toTrdName: inv.customer_name || 'Walk-in', toAddr1: '',
    toPlace: customer ? (customer.city || '') : '',
    toStateCode: toGstin !== 'URP' ? (Number(toGstin.slice(0, 2)) || fromState) : fromState,
    actToStateCode: toGstin !== 'URP' ? (Number(toGstin.slice(0, 2)) || fromState) : fromState,
    transactionType: 1,
    totalValue: round2(math.net.reduce((s, l) => s + l.taxable, 0)),
    cgstValue: split.cgst, sgstValue: split.sgst, igstValue: 0, cessValue: 0, cessNonAdvolValue: 0,
    totInvValue: round2(inv.total),
    transMode: '', transDistance: '', transporterName: '', transporterId: '',
    transDocNo: '', transDocDate: '', vehicleNo: '', vehicleType: '',
    itemList: math.net.map((l) => ({
      productName: l.item.product_name, productDesc: l.item.product_name,
      hsnCode: /^\d+$/.test(String(l.item.hsn_code).trim()) ? Number(String(l.item.hsn_code).trim()) : String(l.item.hsn_code).trim(),
      quantity: Number(l.item.qty), qtyUnit: uqcFor(l.item.p_unit),
      cgstRate: round2(l.rate / 2), sgstRate: round2(l.rate / 2), igstRate: 0,
      cessRate: 0, cessNonAdvol: 0, taxableAmount: l.taxable
    }))
  };
  return sendJsonDownload(res, `eway-bill-${inv.bill_no}.json`, doc);
});

app.get('/api/invoices/:id/einvoice-json', requireAuth, requireBillingAccess, requireTopPlan, async (req, res) => {
  const d = await loadPortalDocData(req.user.business_id, req.params.id);
  if (d && d.inv && d.inv.cancelled_at) return res.status(400).json({ error: 'invoice_cancelled' });
  if (!d) return res.status(404).json({ error: 'invoice not found' });
  const missing = portalMissingFields(d, 'einvoice');
  if (missing.length) return res.status(400).json({ error: 'missing_fields', missing_fields: missing });
  const { inv, biz, items, customer } = d;
  const sellerGstin = String(biz.gstin).trim().toUpperCase();
  const buyerGstin = customer && validGstin(customer.gstin) ? String(customer.gstin).trim().toUpperCase() : 'URP';
  const buyerState = buyerGstin !== 'URP' ? buyerGstin.slice(0, 2) : sellerGstin.slice(0, 2);
  const math = invoiceLineMath(inv, items);
  const taxTotal = round2(math.net.reduce((s, l) => s + l.tax, 0));
  const split = splitCgstSgst(taxTotal);
  // IRP e-invoice schema v1.1 shape. Pin codes are not stored in Business
  // OS, so Seller/Buyer Pin is omitted — the portal asks at upload time.
  const doc = {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: buyerGstin === 'URP' ? 'B2C' : 'B2B', RegRev: 'N', EcmGstin: null },
    DocDtls: { Typ: 'INV', No: String(inv.bill_no), Dt: ddmmyyyy(inv.date) },
    SellerDtls: {
      Gstin: sellerGstin, LglNm: biz.name || '', TrdNm: biz.name || '',
      Addr1: '', Loc: biz.city || '', Stcd: sellerGstin.slice(0, 2), Ph: biz.phone || '', Em: ''
    },
    BuyerDtls: {
      Gstin: buyerGstin, LglNm: inv.customer_name || 'Walk-in', Pos: buyerState,
      Addr1: '', Loc: customer ? (customer.city || '') : '', Stcd: buyerState
    },
    ItemList: math.net.map((l, i) => {
      const s = splitCgstSgst(l.tax);
      return {
        SlNo: String(i + 1), PrdDesc: l.item.product_name, IsServc: 'N',
        HsnCd: String(l.item.hsn_code).trim(),
        Qty: Number(l.item.qty), Unit: uqcFor(l.item.p_unit),
        UnitPrice: round2(l.item.sell_price), TotAmt: round2(l.item.amount),
        Discount: l.discount, AssAmt: l.taxable, GstRt: l.rate,
        IgstAmt: 0, CgstAmt: s.cgst, SgstAmt: s.sgst,
        CesRt: 0, CesAmt: 0, CesNonAdvlAmt: 0, StateCesRt: 0, StateCesAmt: 0, StateCesNonAdvlAmt: 0,
        OthChrg: 0, TotItemVal: round2(l.taxable + l.tax)
      };
    }),
    ValDtls: {
      AssVal: round2(math.net.reduce((s, l) => s + l.taxable, 0)),
      CgstVal: split.cgst, SgstVal: split.sgst, IgstVal: 0, CesVal: 0, StCesVal: 0,
      Discount: round2(inv.discount), OthChrg: 0, RndOffAmt: 0, TotInvVal: round2(inv.total)
    }
  };
  return sendJsonDownload(res, `einvoice-${inv.bill_no}.json`, doc);
});

// ---------- shared bill math + creation (invoices AND estimate conversion) ----------
// ONE math path for every sale document: GST-inclusive prices, an item's
// GST part = amount × rate/(100+rate) (rate snapshot from the product,
// only when the business has GST ON), total = subtotal − discount.
// Estimates price their lines through priceLines() too — an estimate's
// numbers are computed exactly like a bill's; only stock/reports differ.
function priceLines(gstOn, rawLines) {
  const lines = rawLines.map((l) => ({
    prod: l.prod, qty: Number(l.qty), sell_price: Number(l.sell_price),
    amount: round2(Number(l.qty) * Number(l.sell_price)), gst_rate: 0
  }));
  let gstAmount = 0;
  for (const l of lines) {
    l.gst_rate = gstOn ? Number(l.prod.gst_rate) : 0;
    if (l.gst_rate > 0) gstAmount += l.amount * l.gst_rate / (100 + l.gst_rate);
  }
  return { lines, subtotal: round2(lines.reduce((s, l) => s + l.amount, 0)), gstAmount: round2(gstAmount) };
}
function addDaysToDateStr(dateStr, days) {
  const d = new Date(Date.parse(dateStr));
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}
// Feature 5: due_date input parsing shared by invoice/purchase routes.
// undefined → not given; ''/null → explicitly none; a valid date string
// → that date; anything else → error.
function parseDueDateInput(b) {
  if (!b || b.due_date === undefined) return { given: false };
  if (b.due_date === null || b.due_date === '') return { given: true, value: null };
  const s = String(b.due_date).trim();
  if (!isDateStr(s)) return { error: 'invalid due_date' };
  return { given: true, value: s };
}

// Creates a REAL sale invoice in one transaction (stock check → insert →
// items → stock decrease + 'sale' movements → opening payment). Used by
// POST /api/invoices and by estimate conversion, so a converted estimate
// is indistinguishable from a hand-made bill. dueDate semantics:
// undefined → default rule (balance rahe to bill date + 15 din);
// null/string → exactly that. onCreated(tx, invoiceId) runs inside the
// transaction (estimate conversion marks itself converted there).
// Returns { invoice } | { error: 'discount_range' | 'paid_range' } |
// { error: 'insufficient_stock', product } — throws on real DB failures.
async function createSaleInvoice(bizId, opts) {
  const biz = await getBusiness(bizId);
  const gstOn = !!(biz && biz.gst_enabled);
  const { lines, subtotal, gstAmount } = priceLines(gstOn, opts.rawLines);
  const discount = opts.discount !== undefined ? Number(opts.discount) : 0;
  if (!Number.isFinite(discount) || discount < 0 || round2(discount) > subtotal) return { error: 'discount_range' };
  const total = round2(subtotal - discount);
  const paid = opts.paid !== undefined ? Number(opts.paid) : 0;
  if (!Number.isFinite(paid) || paid < 0 || round2(paid) > total) return { error: 'paid_range' };
  const payMode = paid > 0 ? (opts.payMode || 'Cash') : null;
  const date = opts.date || new Date().toISOString().slice(0, 10);
  let dueDate;
  if (opts.dueDate !== undefined) dueDate = opts.dueDate;
  else dueDate = paid < total ? addDaysToDateStr(date, 15) : null;

  const qtyByProduct = new Map();
  lines.forEach((l) => qtyByProduct.set(l.prod.id, (qtyByProduct.get(l.prod.id) || 0) + l.qty));

  const tx = await db.begin();
  try {
    // Stock check inside the transaction — reject the WHOLE bill, change nothing.
    for (const [pid, need] of qtyByProduct) {
      const prod = await tx.get('SELECT * FROM products WHERE id = ? AND business_id = ?', pid, bizId);
      if (Number(prod.stock_qty) < need) {
        await tx.rollback();
        return { error: 'insufficient_stock', product: prod.name };
      }
    }
    const mx = await tx.get('SELECT COALESCE(MAX(bill_no),0) AS m FROM invoices WHERE business_id = ?', bizId);
    const billNo = Number(mx.m) + 1;
    const r = await tx.run(
      `INSERT INTO invoices (business_id, bill_no, customer_id, customer_name, date, subtotal, discount,
         gst_enabled, gst_amount, total, paid_amount, payment_mode, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    , bizId, billNo, opts.customer ? opts.customer.id : null, opts.customer ? opts.customer.name : 'Walk-in',
      date, subtotal, round2(discount), gstOn ? 1 : 0, gstAmount, total, round2(paid), payMode, dueDate);
    const invoiceId = r.lastInsertRowid;
    const insItemSql =
      `INSERT INTO invoice_items (business_id, invoice_id, product_id, product_name, qty, sell_price, buy_price, gst_rate, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const decStockSql =
      `UPDATE products SET stock_qty = stock_qty - ?, updated_at=datetime('now'), sync_status='local' WHERE id=? AND business_id=?`;
    const insMoveSql =
      `INSERT INTO stock_movements (business_id, product_id, type, qty_change, ref_id) VALUES (?, ?, 'sale', ?, ?)`;
    for (const l of lines) {
      await tx.run(insItemSql, bizId, invoiceId, l.prod.id, l.prod.name, l.qty, l.sell_price, Number(l.prod.buy_price), l.gst_rate, l.amount);
      await tx.run(decStockSql, l.qty, l.prod.id, bizId);
      await tx.run(insMoveSql, bizId, l.prod.id, -l.qty, invoiceId);
    }
    if (paid > 0) {
      await tx.run(
        `INSERT INTO customer_payments (business_id, invoice_id, amount, mode, date) VALUES (?, ?, ?, ?, ?)`
      , bizId, invoiceId, round2(paid), payMode, date);
    }
    if (opts.onCreated) await opts.onCreated(tx, invoiceId);
    await tx.commit();
    const invoice = await getOwnedInvoice(bizId, invoiceId);
    return { invoice, billNo, total };
  } catch (e) {
    await tx.rollback(); // no-op if the stock-check path already rolled back
    throw e;
  }
}

app.post('/api/invoices', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const b = req.body || {};
  if (!Array.isArray(b.items) || b.items.length === 0) return res.status(400).json({ error: 'at least one item is required' });

  // Customer (optional — Walk-in when not given).
  let customer = null;
  if (b.customer_id) {
    customer = await db.get('SELECT * FROM customers WHERE id = ? AND business_id = ?', b.customer_id, bizId);
    if (!customer) return res.status(404).json({ error: 'customer not found' });
  }

  // Validate items (ownership + numbers) before any math or writes.
  const rawLines = [];
  for (const it of b.items) {
    if (!it || !it.product_id) return res.status(400).json({ error: 'each item needs a product_id' });
    const prod = await getOwnedProduct(bizId, it.product_id);
    if (!prod) return res.status(404).json({ error: 'product not found' });
    if (!validNum(it.qty) || Number(it.qty) <= 0) return res.status(400).json({ error: 'qty must be greater than 0' });
    const price = it.sell_price !== undefined ? it.sell_price : prod.sell_price;
    if (!validNum(price) || Number(price) < 0) return res.status(400).json({ error: 'sell_price must be a number >= 0' });
    rawLines.push({ prod, qty: Number(it.qty), sell_price: Number(price) });
  }

  const dueParsed = parseDueDateInput(b);
  if (dueParsed.error) return res.status(400).json({ error: dueParsed.error });
  const modes = ['Cash', 'UPI', 'Bank', 'Udhaar'];
  const paidRaw = b.paid_amount !== undefined ? Number(b.paid_amount) : 0;
  const payMode = paidRaw > 0 ? (modes.includes(b.payment_mode) ? b.payment_mode : 'Cash') : null;
  const date = b.date ? String(b.date).trim() : new Date().toISOString().slice(0, 10);

  let out;
  try {
    out = await createSaleInvoice(bizId, {
      customer, rawLines, date,
      discount: b.discount !== undefined ? Number(b.discount) : 0,
      paid: paidRaw, payMode,
      dueDate: dueParsed.given ? dueParsed.value : undefined
    });
  } catch (e) {
    return res.status(500).json({ error: 'could not save bill' });
  }
  if (out.error === 'discount_range') return res.status(400).json({ error: 'discount must be between 0 and the subtotal' });
  if (out.error === 'paid_range') return res.status(400).json({ error: 'paid_amount must be between 0 and the bill total' });
  if (out.error === 'insufficient_stock') return res.status(400).json({ error: 'insufficient_stock', product: out.product });
  await auditLog(req, 'create', 'invoice', out.invoice.id, `Bill #${out.billNo} banaya: ${out.invoice.customer_name} · kul ${fmtAuditAmt(out.total)}`);
  queueSync();
  return res.status(201).json({ invoice: publicInvoice(out.invoice) });
});

// Feature 5: set / change / clear a bill's due date after creation.
app.post('/api/invoices/:id/due-date', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const inv = await getOwnedInvoice(bizId, req.params.id);
  if (!inv) return res.status(404).json({ error: 'invoice not found' });
  if (inv.cancelled_at) return res.status(400).json({ error: 'invoice_cancelled' });
  const parsed = parseDueDateInput(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (!parsed.given) return res.status(400).json({ error: 'due_date is required' });
  await db.run(
    `UPDATE invoices SET due_date = ?, updated_at = datetime('now'), sync_status = 'local' WHERE id = ? AND business_id = ?`
  , parsed.value, inv.id, bizId);
  await auditLog(req, 'update', 'invoice', inv.id, `Bill #${inv.bill_no} ki due date ${parsed.value ? 'lagayi: ' + parsed.value : 'hatayi'}`);
  queueSync();
  res.json({ invoice: publicInvoice(await getOwnedInvoice(bizId, inv.id)) });
});

app.post('/api/invoices/:id/payments', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const inv = await getOwnedInvoice(bizId, req.params.id);
  if (!inv) return res.status(404).json({ error: 'invoice not found' });
  if (inv.cancelled_at) return res.status(400).json({ error: 'invoice_cancelled' });
  const b = req.body || {};
  if (!validNum(b.amount) || Number(b.amount) <= 0) return res.status(400).json({ error: 'amount must be greater than 0' });
  const amount = round2(Number(b.amount));
  if (round2(Number(inv.paid_amount) + amount) > round2(Number(inv.total))) {
    return res.status(400).json({ error: 'payment is more than the pending amount' });
  }
  const modes = ['Cash', 'UPI', 'Bank'];
  const mode = modes.includes(b.mode) ? b.mode : 'Cash';
  const date = b.date ? String(b.date).trim() : new Date().toISOString().slice(0, 10);
  const tx = await db.begin();
  try {
    const r = await tx.run(
      `INSERT INTO customer_payments (business_id, invoice_id, amount, mode, date) VALUES (?, ?, ?, ?, ?)`
    , bizId, inv.id, amount, mode, date);
    await tx.run(
      `UPDATE invoices SET paid_amount = paid_amount + ?, updated_at=datetime('now'), sync_status='local' WHERE id=? AND business_id=?`
    , amount, inv.id, bizId);
    await tx.commit();
    const payment = await db.get('SELECT * FROM customer_payments WHERE id = ?', r.lastInsertRowid);
    await auditLog(req, 'create', 'customer_payment', r.lastInsertRowid, `Bill #${inv.bill_no} par payment aaya: ${fmtAuditAmt(amount)}`);
    queueSync();
    return res.status(201).json({ payment, invoice: publicInvoice(await getOwnedInvoice(bizId, inv.id)) });
  } catch (e) {
    await tx.rollback();
    return res.status(500).json({ error: 'could not record payment' });
  }
});

// ---------- Bill cancel / edit (owner-only) ----------
// Cancel = exact reversal: the bill's stock goes back through stock
// movements ('adjustment', same pattern as manual stock corrections),
// its customer_payments rows are removed (so day-end collections and
// hisab stay consistent) and cancelled_at/cancel_reason mark the row.
// Every aggregate query filters cancelled_at IS NULL, so a cancelled
// bill drops out of sales / pending / GST / GSTR-1 / day-end / hisab /
// dashboard — but stays visible in History with its reason.
// Edit = one transaction: reverse the old bill (stock back, payments
// removed), then apply the new lines with the SAME bill id + bill_no.
// A bill that already has sales returns can neither be cancelled nor
// edited — the return rows point at its items; error 'has_returns'.
app.post('/api/invoices/:id/cancel', requireAuth, requireOwner, async (req, res) => {
  const bizId = req.user.business_id;
  const inv = await getOwnedInvoice(bizId, req.params.id);
  if (!inv) return res.status(404).json({ error: 'invoice not found' });
  const reason = String((req.body || {}).reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'cancel_reason_required' });
  if (inv.cancelled_at) return res.status(400).json({ error: 'already_cancelled' });
  const retCount = await db.get('SELECT COUNT(*) AS c FROM returns WHERE invoice_id = ? AND business_id = ?', inv.id, bizId);
  if (Number(retCount.c) > 0) return res.status(400).json({ error: 'has_returns' });
  const items = await db.all('SELECT * FROM invoice_items WHERE invoice_id = ? AND business_id = ?', inv.id, bizId);
  const tx = await db.begin();
  try {
    for (const it of items) {
      if (!it.product_id) continue;
      await tx.run(
        `INSERT INTO stock_movements (business_id, product_id, type, qty_change, ref_id)
         VALUES (?, ?, 'adjustment', ?, ?)`
      , bizId, it.product_id, Number(it.qty), inv.id);
      await tx.run('UPDATE products SET stock_qty = stock_qty + ? WHERE id = ? AND business_id = ?', Number(it.qty), it.product_id, bizId);
    }
    await tx.run('DELETE FROM customer_payments WHERE invoice_id = ? AND business_id = ?', inv.id, bizId);
    await tx.run(
      `UPDATE invoices SET cancelled_at = datetime('now'), cancel_reason = ?, paid_amount = 0, payment_mode = NULL,
         updated_at = datetime('now'), sync_status = 'local' WHERE id = ? AND business_id = ?`
    , reason, inv.id, bizId);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    return res.status(500).json({ error: 'could not cancel bill' });
  }
  await auditLog(req, 'cancel', 'invoice', inv.id, `Bill #${inv.bill_no} CANCEL hua — wajah: ${reason}`);
  queueSync();
  res.json({ invoice: publicInvoice(await getOwnedInvoice(bizId, inv.id)) });
});

app.put('/api/invoices/:id', requireAuth, requireOwner, async (req, res) => {
  const bizId = req.user.business_id;
  const inv = await getOwnedInvoice(bizId, req.params.id);
  if (!inv) return res.status(404).json({ error: 'invoice not found' });
  if (inv.cancelled_at) return res.status(400).json({ error: 'invoice_cancelled' });
  if ((inv.kind || 'sale') !== 'sale') return res.status(400).json({ error: 'only_sale_bills_editable' });
  const retCount = await db.get('SELECT COUNT(*) AS c FROM returns WHERE invoice_id = ? AND business_id = ?', inv.id, bizId);
  if (Number(retCount.c) > 0) return res.status(400).json({ error: 'has_returns' });
  const b = req.body || {};
  if (!Array.isArray(b.items) || b.items.length === 0) {
    return res.status(400).json({ error: 'at least one item is required' });
  }
  // Price the new lines EXACTLY like a fresh bill (same priceLines path
  // as createSaleInvoice / estimates).
  const rawLines = [];
  for (const it of b.items) {
    if (!it || !it.product_id) return res.status(400).json({ error: 'each item needs a product_id' });
    const prod = await getOwnedProduct(bizId, it.product_id);
    if (!prod) return res.status(404).json({ error: 'product not found' });
    if (!validNum(it.qty) || Number(it.qty) <= 0) return res.status(400).json({ error: 'qty must be greater than 0' });
    const price = it.price !== undefined ? it.price : (it.sell_price !== undefined ? it.sell_price : prod.sell_price);
    if (!validNum(price) || Number(price) < 0) return res.status(400).json({ error: 'sell_price must be a number >= 0' });
    rawLines.push({ prod, qty: Number(it.qty), sell_price: Number(price) });
  }
  const biz = await getBusiness(bizId);
  const gstOn = !!(biz && biz.gst_enabled);
  const { lines, subtotal, gstAmount } = priceLines(gstOn, rawLines);
  const discount = b.discount === undefined || b.discount === null || b.discount === '' ? 0 : Number(b.discount);
  if (!Number.isFinite(discount) || discount < 0 || round2(discount) > subtotal) {
    return res.status(400).json({ error: 'discount must be between 0 and the subtotal' });
  }
  const total = round2(subtotal - discount);
  const newPaid = b.paid_amount === undefined || b.paid_amount === null || b.paid_amount === ''
    ? Number(inv.paid_amount) : Number(b.paid_amount);
  if (!Number.isFinite(newPaid) || newPaid < 0 || round2(newPaid) > total) {
    return res.status(400).json({ error: 'paid_amount must be between 0 and the bill total' });
  }
  const modes = ['Cash', 'UPI', 'Bank'];
  const newMode = modes.includes(b.payment_mode) ? b.payment_mode : (inv.payment_mode || 'Cash');
  // Customer: keep, change or clear (walk-in). Same rule as create.
  let customerId = inv.customer_id || null;
  let customerName = inv.customer_name || 'Walk-in Customer';
  if (b.customer_id !== undefined) {
    if (b.customer_id) {
      const cust = await db.get('SELECT * FROM customers WHERE id = ? AND business_id = ?', b.customer_id, bizId);
      if (!cust) return res.status(400).json({ error: 'customer not found' });
      customerId = cust.id; customerName = cust.name;
    } else { customerId = null; customerName = 'Walk-in Customer'; }
  }
  const oldItems = await db.all('SELECT * FROM invoice_items WHERE invoice_id = ? AND business_id = ?', inv.id, bizId);
  const oldPaid = Number(inv.paid_amount);
  const qtyByProduct = new Map();
  lines.forEach((l) => qtyByProduct.set(l.prod.id, (qtyByProduct.get(l.prod.id) || 0) + l.qty));
  const tx = await db.begin();
  try {
    // 1) Reverse the old bill's stock (movements pattern: 'adjustment').
    for (const it of oldItems) {
      if (!it.product_id) continue;
      await tx.run(
        `INSERT INTO stock_movements (business_id, product_id, type, qty_change, ref_id)
         VALUES (?, ?, 'adjustment', ?, ?)`
      , bizId, it.product_id, Number(it.qty), inv.id);
      await tx.run('UPDATE products SET stock_qty = stock_qty + ? WHERE id = ? AND business_id = ?', Number(it.qty), it.product_id, bizId);
    }
    await tx.run('DELETE FROM invoice_items WHERE invoice_id = ? AND business_id = ?', inv.id, bizId);
    // 2) Stock check against the RESTORED stock (aggregated per product,
    //    same as createSaleInvoice) — reject the whole edit, change nothing.
    for (const [pid, need] of qtyByProduct) {
      const prod = await tx.get('SELECT * FROM products WHERE id = ? AND business_id = ?', pid, bizId);
      if (!prod || Number(prod.stock_qty) < need) {
        await tx.rollback();
        return res.status(400).json({ error: 'insufficient_stock', product: prod ? prod.name : '' });
      }
    }
    // 3) Apply the new lines.
    const insItemSql =
      `INSERT INTO invoice_items (business_id, invoice_id, product_id, product_name, qty, sell_price, buy_price, gst_rate, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    for (const l of lines) {
      await tx.run(insItemSql, bizId, inv.id, l.prod.id, l.prod.name, l.qty, l.sell_price, Number(l.prod.buy_price), l.gst_rate, l.amount);
      await tx.run('UPDATE products SET stock_qty = stock_qty - ? WHERE id = ? AND business_id = ?', l.qty, l.prod.id, bizId);
      await tx.run(
        `INSERT INTO stock_movements (business_id, product_id, type, qty_change, ref_id) VALUES (?, ?, 'sale', ?, ?)`
      , bizId, l.prod.id, -l.qty, inv.id);
    }
    // 4) Payments: adjust by the difference so customer_payments stays
    //    the single source for collections / day-end / hisab.
    const diff = round2(newPaid - oldPaid);
    if (diff > 0) {
      await tx.run(
        `INSERT INTO customer_payments (business_id, invoice_id, amount, mode, date) VALUES (?, ?, ?, ?, ?)`
      , bizId, inv.id, diff, newMode, inv.date);
    } else if (diff < 0) {
      let remaining = -diff;
      const pays = await tx.all(
        'SELECT * FROM customer_payments WHERE invoice_id = ? AND business_id = ? ORDER BY id DESC', inv.id, bizId);
      for (const p of pays) {
        if (remaining <= 0) break;
        const cut = Math.min(remaining, Number(p.amount));
        if (round2(Number(p.amount) - cut) <= 0) {
          await tx.run('DELETE FROM customer_payments WHERE id = ? AND business_id = ?', p.id, bizId);
        } else {
          await tx.run('UPDATE customer_payments SET amount = ? WHERE id = ? AND business_id = ?', round2(Number(p.amount) - cut), p.id, bizId);
        }
        remaining = round2(remaining - cut);
      }
    }
    // Due date: fully paid → none; balance hai aur pehle set nahi tha →
    // bill date + 15 din (create wali rule); warna purani hi rehti hai.
    let dueDate = inv.due_date || null;
    if (round2(total - newPaid) <= 0) dueDate = null;
    else if (!dueDate) dueDate = addDaysToDateStr(inv.date, 15);
    await tx.run(
      `UPDATE invoices SET customer_id = ?, customer_name = ?, subtotal = ?, discount = ?, gst_enabled = ?,
         gst_amount = ?, total = ?, paid_amount = ?, payment_mode = ?, due_date = ?,
         updated_at = datetime('now'), sync_status = 'local' WHERE id = ? AND business_id = ?`
    , customerId, customerName, subtotal, round2(discount), gstOn ? 1 : 0, gstAmount, total,
      round2(newPaid), newPaid > 0 ? newMode : null, dueDate, inv.id, bizId);
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch (_) {}
    return res.status(500).json({ error: 'could not edit bill' });
  }
  await auditLog(req, 'update', 'invoice', inv.id,
    `Bill #${inv.bill_no} EDIT hua — naya total ${fmtAuditAmt(total)} (purana ${fmtAuditAmt(Number(inv.total))})`);
  queueSync();
  res.json({ invoice: publicInvoice(await getOwnedInvoice(bizId, inv.id)) });
});

// =====================================================================
// ---------- Stage 5: WhatsApp click-to-send (wa.me links) ----------
// HONEST MECHANICS: wa.me links carry a pre-filled TEXT message only —
// a PDF cannot be auto-attached through wa.me, so the WhatsApp bill is a
// formatted TEXT bill (the Stage 3 print view stays the PDF route).
// Nothing is auto-sent: the link opens WhatsApp with the message ready
// and the owner presses send. Billing gate — owner, 'all' or 'billing'.
// =====================================================================
function normalizePhone(raw) {
  if (raw === undefined || raw === null) return null;
  const d = String(raw).replace(/\D/g, '');
  if (d.length === 10) return '91' + d;
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1);
  if (d.length === 12 && d.startsWith('91')) return d;
  return null;
}
function msgAmt(n) { return String(round2(Number(n) || 0)); }
function msgQty(n) { return String(Number(n) || 0); }

// =====================================================================
// ---------- Feature 1: Estimates / Quotations ----------
// Separate tables, same bill math (priceLines). Estimates never touch
// stock and never appear in any sale/GST/finance report — they become
// real money only through /convert, which runs the normal invoice path.
// =====================================================================
async function getOwnedEstimate(bizId, id) {
  return await db.get('SELECT * FROM estimates WHERE id = ? AND business_id = ?', id, bizId);
}

app.post('/api/estimates', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const b = req.body || {};
  if (!Array.isArray(b.items) || b.items.length === 0) return res.status(400).json({ error: 'at least one item is required' });
  let customer = null;
  if (b.customer_id) {
    customer = await db.get('SELECT * FROM customers WHERE id = ? AND business_id = ?', b.customer_id, bizId);
    if (!customer) return res.status(404).json({ error: 'customer not found' });
  }
  const rawLines = [];
  for (const it of b.items) {
    if (!it || !it.product_id) return res.status(400).json({ error: 'each item needs a product_id' });
    const prod = await getOwnedProduct(bizId, it.product_id);
    if (!prod) return res.status(404).json({ error: 'product not found' });
    if (!validNum(it.qty) || Number(it.qty) <= 0) return res.status(400).json({ error: 'qty must be greater than 0' });
    const price = it.price !== undefined ? it.price : (it.sell_price !== undefined ? it.sell_price : prod.sell_price);
    if (!validNum(price) || Number(price) < 0) return res.status(400).json({ error: 'sell_price must be a number >= 0' });
    rawLines.push({ prod, qty: Number(it.qty), sell_price: Number(price) });
  }
  const biz = await getBusiness(bizId);
  const gstOn = !!(biz && biz.gst_enabled);
  const { lines, subtotal, gstAmount } = priceLines(gstOn, rawLines);
  const discount = b.discount !== undefined ? Number(b.discount) : 0;
  if (!Number.isFinite(discount) || discount < 0 || round2(discount) > subtotal) {
    return res.status(400).json({ error: 'discount must be between 0 and the subtotal' });
  }
  const total = round2(subtotal - discount);
  const date = b.date ? String(b.date).trim() : new Date().toISOString().slice(0, 10);

  const tx = await db.begin();
  try {
    const mx = await tx.get('SELECT COALESCE(MAX(estimate_no),0) AS m FROM estimates WHERE business_id = ?', bizId);
    const estNo = Number(mx.m) + 1;
    const r = await tx.run(
      `INSERT INTO estimates (business_id, customer_id, customer_name, estimate_no, date, subtotal, discount,
         gst_enabled, gst_amount, total, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`
    , bizId, customer ? customer.id : null, customer ? customer.name : 'Walk-in',
      estNo, date, subtotal, round2(discount), gstOn ? 1 : 0, gstAmount, total, req.user.id);
    const estId = r.lastInsertRowid;
    const insItem =
      `INSERT INTO estimate_items (business_id, estimate_id, product_id, product_name, qty, sell_price, buy_price, gst_rate, hsn_code, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    for (const l of lines) {
      await tx.run(insItem, bizId, estId, l.prod.id, l.prod.name, l.qty, l.sell_price,
        Number(l.prod.buy_price), l.gst_rate, l.prod.hsn_code || '', l.amount);
    }
    await tx.commit();
    const est = await getOwnedEstimate(bizId, estId);
    await auditLog(req, 'create', 'estimate', estId, `Estimate #${estNo} banaya: ${est.customer_name} · kul ${fmtAuditAmt(total)}`);
    res.status(201).json({ estimate: publicEstimate(est) });
  } catch (e) {
    await tx.rollback();
    res.status(500).json({ error: 'could not save estimate' });
  }
});

app.get('/api/estimates', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const rows = await db.all('SELECT * FROM estimates WHERE business_id = ? ORDER BY id DESC', bizId);
  res.json({ estimates: rows.map(publicEstimate) });
});

app.get('/api/estimates/:id', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const est = await getOwnedEstimate(bizId, req.params.id);
  if (!est) return res.status(404).json({ error: 'estimate not found' });
  const items = await db.all(
    'SELECT * FROM estimate_items WHERE estimate_id = ? AND business_id = ? ORDER BY id ASC'
  , est.id, bizId);
  const biz = await getBusiness(bizId);
  res.json({
    estimate: publicEstimate(est),
    business: {
      name: biz ? biz.name : '', owner_name: biz ? biz.owner_name : '',
      phone: biz ? biz.phone : '', city: biz ? biz.city : '',
      gstin: biz ? biz.gstin : '', gst_enabled: !!est.gst_enabled
    },
    items
  });
});

// Convert → a real sale invoice through the normal path (stock check,
// stock decrease, normal bill_no). The estimate's quoted prices are
// honored; GST rates re-read from the CURRENT products + business GST
// setting, exactly like a fresh bill made today. One transaction: if
// stock is short the whole conversion fails and the estimate stays open.
app.post('/api/estimates/:id/convert', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const est = await getOwnedEstimate(bizId, req.params.id);
  if (!est) return res.status(404).json({ error: 'estimate not found' });
  if (est.status === 'converted') return res.status(400).json({ error: 'already_converted' });
  const estItems = await db.all(
    'SELECT * FROM estimate_items WHERE estimate_id = ? AND business_id = ? ORDER BY id ASC'
  , est.id, bizId);
  const rawLines = [];
  for (const ei of estItems) {
    const prod = await getOwnedProduct(bizId, ei.product_id);
    if (!prod) return res.status(404).json({ error: 'product not found' });
    rawLines.push({ prod, qty: Number(ei.qty), sell_price: Number(ei.sell_price) });
  }
  const customer = est.customer_id
    ? await db.get('SELECT * FROM customers WHERE id = ? AND business_id = ?', est.customer_id, bizId)
    : null;
  let out;
  try {
    out = await createSaleInvoice(bizId, {
      customer, rawLines,
      date: new Date().toISOString().slice(0, 10),
      discount: Number(est.discount || 0), paid: 0, payMode: null,
      onCreated: async (tx, invoiceId) => {
        await tx.run(
          `UPDATE estimates SET status = 'converted', converted_invoice_id = ?, updated_at = datetime('now')
           WHERE id = ? AND business_id = ?`
        , invoiceId, est.id, bizId);
      }
    });
  } catch (e) {
    return res.status(500).json({ error: 'could not convert estimate' });
  }
  if (out.error === 'insufficient_stock') return res.status(400).json({ error: 'insufficient_stock', product: out.product });
  if (out.error) return res.status(400).json({ error: out.error });
  await auditLog(req, 'create', 'invoice', out.invoice.id,
    `Estimate #${est.estimate_no} se Bill #${out.billNo} banaya: ${out.invoice.customer_name} · kul ${fmtAuditAmt(out.total)}`);
  queueSync();
  res.status(201).json({ invoice: publicInvoice(out.invoice) });
});

// WhatsApp share for an estimate — plain quotation text, same shape as
// the bill link ({ phone, url, message }). NO UPI pay line and NO QR:
// an estimate is not payable.
app.get('/api/estimates/:id/whatsapp-link', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const est = await getOwnedEstimate(bizId, req.params.id);
  if (!est) return res.status(404).json({ error: 'estimate not found' });
  let rawPhone = req.query.phone !== undefined ? String(req.query.phone) : null;
  if (!rawPhone && est.customer_id) {
    const cust = await db.get('SELECT phone FROM customers WHERE id = ? AND business_id = ?', est.customer_id, bizId);
    if (cust) rawPhone = cust.phone;
  }
  const phone = normalizePhone(rawPhone);
  if (!phone) return res.status(400).json({ error: 'customer_phone_missing' });
  const biz = await getBusiness(bizId);
  const bizName = (biz && biz.name) || 'BizYour';
  const hi = !!(biz && biz.language === 'hi');
  const hg = !!(biz && biz.language === 'hg');
  const items = await db.all(
    'SELECT * FROM estimate_items WHERE estimate_id = ? AND business_id = ? ORDER BY id ASC'
  , est.id, bizId);
  const lines = items.map((it) => `${it.product_name} ×${msgQty(it.qty)} — ₹${msgAmt(it.amount)}`);
  const sep = '--------------------------';
  let msg;
  if (hi) {
    msg = `📋 *${bizName}* — एस्टीमेट #${est.estimate_no} (${est.date})\n${sep}\n${lines.join('\n')}\n${sep}`;
    if (Number(est.discount) > 0) msg += `\nछूट: −₹${msgAmt(est.discount)}`;
    msg += `\nकुल: ₹${msgAmt(est.total)}`;
    msg += `\n(ये सिर्फ़ एस्टीमेट है — बिल नहीं है।)`;
    msg += `\nधन्यवाद! 🙏`;
  } else if (hg) {
    msg = `📋 *${bizName}* — Estimate #${est.estimate_no} (${est.date})\n${sep}\n${lines.join('\n')}\n${sep}`;
    if (Number(est.discount) > 0) msg += `\nChhoot: −₹${msgAmt(est.discount)}`;
    msg += `\nKul: ₹${msgAmt(est.total)}`;
    msg += `\n(Ye sirf estimate hai — bill nahi hai.)`;
    msg += `\nDhanyavaad! 🙏`;
  } else {
    msg = `📋 *${bizName}* — Estimate #${est.estimate_no} (${est.date})\n${sep}\n${lines.join('\n')}\n${sep}`;
    if (Number(est.discount) > 0) msg += `\nDiscount: −₹${msgAmt(est.discount)}`;
    msg += `\nTotal: ₹${msgAmt(est.total)}`;
    msg += `\n(This is an estimate only — not a bill.)`;
    msg += `\nThank you! 🙏`;
  }
  res.json({ phone, url: 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg), message: msg });
});

// =====================================================================
// ---------- Feature 2: Sales Returns / Credit Notes ----------
// A return hangs off ONE invoice. One transaction: validate every line
// against (sold − already returned), restock with 'return' movements,
// store the credit note with GST-inclusive pro-rata totals. Pending,
// GST and finance all net returns out (see the reports section).
// =====================================================================
app.post('/api/invoices/:id/returns', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const inv = await getOwnedInvoice(bizId, req.params.id);
  if (!inv) return res.status(404).json({ error: 'invoice not found' });
  if (inv.cancelled_at) return res.status(400).json({ error: 'invoice_cancelled' });
  const b = req.body || {};
  if (!Array.isArray(b.items) || b.items.length === 0) return res.status(400).json({ error: 'at least one item is required' });

  // Aggregate duplicate lines for the same invoice item first.
  const want = new Map();
  for (const it of b.items) {
    if (!it || !it.invoice_item_id) return res.status(400).json({ error: 'each item needs an invoice_item_id' });
    if (!validNum(it.qty) || Number(it.qty) <= 0) return res.status(400).json({ error: 'qty must be greater than 0' });
    want.set(Number(it.invoice_item_id), (want.get(Number(it.invoice_item_id)) || 0) + Number(it.qty));
  }
  const invItems = await db.all(
    'SELECT * FROM invoice_items WHERE invoice_id = ? AND business_id = ?', inv.id, bizId);
  const byId = new Map(invItems.map((ii) => [Number(ii.id), ii]));
  const alreadyRows = await db.all(
    `SELECT ri.invoice_item_id AS iid, COALESCE(SUM(ri.qty), 0) AS q
     FROM return_items ri JOIN returns r ON r.id = ri.return_id AND r.business_id = ri.business_id
     WHERE r.invoice_id = ? AND ri.business_id = ? GROUP BY ri.invoice_item_id`
  , inv.id, bizId);
  const alreadyByItem = new Map(alreadyRows.map((x) => [Number(x.iid), Number(x.q)]));

  const offenders = [];
  const lines = [];
  for (const [iid, qty] of want) {
    const ii = byId.get(iid);
    if (!ii) return res.status(400).json({ error: 'item does not belong to this invoice', invoice_item_id: iid });
    const already = alreadyByItem.get(iid) || 0;
    if (qty > Number(ii.qty) - already) {
      offenders.push({
        invoice_item_id: iid, product_name: ii.product_name,
        sold: Number(ii.qty), already_returned: already, requested: qty
      });
    }
    const amount = round2(qty * Number(ii.sell_price));
    const gstRate = Number(ii.gst_rate) || 0;
    const gstPart = gstRate > 0 ? round2(amount * gstRate / (100 + gstRate)) : 0;
    lines.push({ ii, qty, amount, gstRate, gstPart });
  }
  if (offenders.length) return res.status(400).json({ error: 'return_qty_exceeds', items: offenders });

  const totalAmount = round2(lines.reduce((s, l) => s + l.amount, 0));
  const gstTotal = round2(lines.reduce((s, l) => s + l.gstPart, 0));
  const date = b.date ? String(b.date).trim() : new Date().toISOString().slice(0, 10);
  if (!isDateStr(date)) return res.status(400).json({ error: 'invalid date' });
  const reason = b.reason ? String(b.reason).trim().slice(0, 200) : null;

  const tx = await db.begin();
  try {
    const mx = await tx.get('SELECT COALESCE(MAX(return_no),0) AS m FROM returns WHERE business_id = ?', bizId);
    const returnNo = Number(mx.m) + 1;
    const r = await tx.run(
      `INSERT INTO returns (business_id, invoice_id, customer_id, return_no, date, total_amount, gst_amount, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    , bizId, inv.id, inv.customer_id || null, returnNo, date, totalAmount, gstTotal, reason, req.user.id);
    const returnId = r.lastInsertRowid;
    const insItem =
      `INSERT INTO return_items (business_id, return_id, invoice_item_id, product_id, qty, price, gst_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const incStock =
      `UPDATE products SET stock_qty = stock_qty + ?, updated_at = datetime('now'), sync_status = 'local' WHERE id = ? AND business_id = ?`;
    const insMove =
      `INSERT INTO stock_movements (business_id, product_id, type, qty_change, ref_id) VALUES (?, ?, 'return', ?, ?)`;
    for (const l of lines) {
      await tx.run(insItem, bizId, returnId, l.ii.id, l.ii.product_id, l.qty, Number(l.ii.sell_price), l.gstRate);
      await tx.run(incStock, l.qty, l.ii.product_id, bizId);
      await tx.run(insMove, bizId, l.ii.product_id, l.qty, returnId);
    }
    await tx.commit();
    const saved = await db.get('SELECT * FROM returns WHERE id = ? AND business_id = ?', returnId, bizId);
    await auditLog(req, 'create', 'return', returnId,
      `Return/Credit Note #${returnNo} (Bill #${inv.bill_no}): ${inv.customer_name} · kul ${fmtAuditAmt(totalAmount)}`);
    queueSync();
    res.status(201).json({ return: publicReturn(saved) });
  } catch (e) {
    await tx.rollback();
    res.status(500).json({ error: 'could not save return' });
  }
});

app.get('/api/returns', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const rows = await db.all(
    `SELECT r.*, i.bill_no AS bill_no, i.customer_name AS customer_name
     FROM returns r JOIN invoices i ON i.id = r.invoice_id AND i.business_id = r.business_id
     WHERE r.business_id = ? ORDER BY r.id DESC`
  , bizId);
  res.json({
    returns: rows.map((r) => Object.assign(publicReturn(r), {
      bill_no: r.bill_no, customer_name: r.customer_name
    }))
  });
});

app.get('/api/returns/:id', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const r = await db.get(
    `SELECT r.*, i.bill_no AS bill_no, i.customer_name AS customer_name
     FROM returns r JOIN invoices i ON i.id = r.invoice_id AND i.business_id = r.business_id
     WHERE r.id = ? AND r.business_id = ?`
  , req.params.id, bizId);
  if (!r) return res.status(404).json({ error: 'return not found' });
  const items = await db.all(
    `SELECT ri.*, ii.product_name AS product_name
     FROM return_items ri JOIN invoice_items ii ON ii.id = ri.invoice_item_id AND ii.business_id = ri.business_id
     WHERE ri.return_id = ? AND ri.business_id = ? ORDER BY ri.id ASC`
  , r.id, bizId);
  const biz = await getBusiness(bizId);
  res.json({
    return: Object.assign(publicReturn(r), { bill_no: r.bill_no, customer_name: r.customer_name }),
    business: { name: biz ? biz.name : '', gst_enabled: biz ? !!biz.gst_enabled : false },
    items
  });
});

// WhatsApp share for a credit note (manual wa.me, same { phone, url,
// message } shape as the bill link).
app.get('/api/returns/:id/whatsapp-link', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const r = await db.get(
    `SELECT r.*, i.bill_no AS bill_no, i.customer_name AS customer_name
     FROM returns r JOIN invoices i ON i.id = r.invoice_id AND i.business_id = r.business_id
     WHERE r.id = ? AND r.business_id = ?`
  , req.params.id, bizId);
  if (!r) return res.status(404).json({ error: 'return not found' });
  let rawPhone = req.query.phone !== undefined ? String(req.query.phone) : null;
  if (!rawPhone && r.customer_id) {
    const cust = await db.get('SELECT phone FROM customers WHERE id = ? AND business_id = ?', r.customer_id, bizId);
    if (cust) rawPhone = cust.phone;
  }
  const phone = normalizePhone(rawPhone);
  if (!phone) return res.status(400).json({ error: 'customer_phone_missing' });
  const biz = await getBusiness(bizId);
  const bizName = (biz && biz.name) || 'BizYour';
  const hi = !!(biz && biz.language === 'hi');
  const hg = !!(biz && biz.language === 'hg');
  const items = await db.all(
    `SELECT ri.*, ii.product_name AS product_name
     FROM return_items ri JOIN invoice_items ii ON ii.id = ri.invoice_item_id AND ii.business_id = ri.business_id
     WHERE ri.return_id = ? AND ri.business_id = ? ORDER BY ri.id ASC`
  , r.id, bizId);
  const lines = items.map((it) => `${it.product_name} ×${msgQty(it.qty)} — ₹${msgAmt(round2(it.qty * it.price))}`);
  const sep = '--------------------------';
  let msg;
  if (hi) {
    msg = `↩️ *${bizName}* — क्रेडिट नोट #${r.return_no} (बिल #${r.bill_no}, ${r.date})\n${sep}\n${lines.join('\n')}\n${sep}`;
    msg += `\nवापसी कुल: ₹${msgAmt(r.total_amount)}`;
    msg += `\nये रकम आपके हिसाब से कम कर दी गई है।`;
    msg += `\nधन्यवाद! 🙏`;
  } else if (hg) {
    msg = `↩️ *${bizName}* — Credit Note #${r.return_no} (Bill #${r.bill_no}, ${r.date})\n${sep}\n${lines.join('\n')}\n${sep}`;
    msg += `\nWapsi kul: ₹${msgAmt(r.total_amount)}`;
    msg += `\nYe rakam aapke hisaab se kam kar di gayi hai.`;
    msg += `\nDhanyavaad! 🙏`;
  } else {
    msg = `↩️ *${bizName}* — Credit Note #${r.return_no} (Bill #${r.bill_no}, ${r.date})\n${sep}\n${lines.join('\n')}\n${sep}`;
    msg += `\nReturn total: ₹${msgAmt(r.total_amount)}`;
    msg += `\nThis amount has been adjusted in your account.`;
    msg += `\nThank you! 🙏`;
  }
  res.json({ phone, url: 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg), message: msg });
});

// =====================================================================
// ---------- Feature 5: Due-date alerts (computed live) ----------
// Automation here = SURFACING, never auto-sending: the dashboard shows
// who is late / due today / due soon so the owner taps one WhatsApp
// reminder himself. Buckets aggregate per customer/supplier over
// UNPAID documents that carry a due_date.
// =====================================================================
function dayDiffStr(fromStr, toStr) {
  return Math.round((Date.parse(toStr) - Date.parse(fromStr)) / 86400000);
}
function bucketDueRows(rows, todayStr) {
  const overdue = [], dueToday = [], dueSoon = [];
  for (const g of rows) {
    const diff = dayDiffStr(todayStr, g.oldest_due_date); // due − today
    const entry = Object.assign({}, g, { days: Math.abs(diff) });
    if (diff < 0) overdue.push(entry);
    else if (diff === 0) dueToday.push(entry);
    else if (diff <= 3) dueSoon.push(entry);
  }
  overdue.sort((a, b) => b.days - a.days);
  const byDate = (a, b) => (a.oldest_due_date < b.oldest_due_date ? -1 : 1);
  dueToday.sort(byDate); dueSoon.sort(byDate);
  return { overdue, due_today: dueToday, due_soon: dueSoon };
}

// ---------- One-tap vasuli (customer-level payment from alerts) -----
// Records money received from a customer and allocates it FIFO (oldest
// bill first) across that customer's bills with NET pending > 0 — net
// of any sales returns on the bill, cancelled bills skipped. Amount
// omitted = the customer's full net pending. One customer_payments row
// per touched bill, so day-end / hisab / reports stay exact. Same
// permission as recording a payment on a single bill.
app.post('/api/customers/:id/vasuli', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const cust = await db.get('SELECT * FROM customers WHERE id = ? AND business_id = ?', req.params.id, bizId);
  if (!cust) return res.status(404).json({ error: 'customer not found' });
  const full = await customerRow(bizId, cust.id);
  const netPending = round2(Number(full.total_billed || 0) - Number(full.total_received || 0) - Number(full.total_returns || 0));
  const b = req.body || {};
  let amount = (b.amount === undefined || b.amount === null || b.amount === '') ? netPending : Number(b.amount);
  if (!validNum(amount) || amount <= 0) return res.status(400).json({ error: 'amount must be greater than 0' });
  amount = round2(amount);
  if (amount > netPending) return res.status(400).json({ error: 'amount_more_than_pending' });
  const modes = ['Cash', 'UPI', 'Bank'];
  const mode = modes.includes(b.mode) ? b.mode : 'Cash';
  const date = b.date ? String(b.date).trim() : new Date().toISOString().slice(0, 10);
  const bills = await db.all(
    `SELECT i.*, COALESCE((SELECT SUM(r.total_amount) FROM returns r WHERE r.invoice_id = i.id AND r.business_id = i.business_id), 0) AS returns_total
     FROM invoices i
     WHERE i.business_id = ? AND i.customer_id = ? AND i.cancelled_at IS NULL AND i.paid_amount < i.total
     ORDER BY i.id ASC`
  , bizId, cust.id);
  const tx = await db.begin();
  try {
    let remaining = amount;
    const allocations = [];
    for (const inv of bills) {
      if (remaining <= 0) break;
      const due = round2(Number(inv.total) - Number(inv.returns_total) - Number(inv.paid_amount));
      if (due <= 0) continue;
      const take = Math.min(due, remaining);
      await tx.run(
        `INSERT INTO customer_payments (business_id, invoice_id, amount, mode, date) VALUES (?, ?, ?, ?, ?)`
      , bizId, inv.id, take, mode, date);
      await tx.run(
        `UPDATE invoices SET paid_amount = paid_amount + ?, updated_at = datetime('now'), sync_status = 'local' WHERE id = ? AND business_id = ?`
      , take, inv.id, bizId);
      allocations.push({ invoice_id: inv.id, bill_no: inv.bill_no, amount: take });
      remaining = round2(remaining - take);
    }
    if (remaining > 0) { await tx.rollback(); return res.status(400).json({ error: 'amount_more_than_pending' }); }
    await tx.commit();
    await auditLog(req, 'create', 'customer_payment', cust.id,
      `${cust.name} se vasuli: ${fmtAuditAmt(amount)} (${allocations.length} bill me bantaa)`);
    queueSync();
    const after = await customerRow(bizId, cust.id);
    return res.status(201).json({ received: amount, allocations, customer: publicCustomer(after) });
  } catch (e) {
    try { await tx.rollback(); } catch (_) {}
    return res.status(500).json({ error: 'could not record vasuli' });
  }
});

app.get('/api/alerts', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const todayStr = new Date().toISOString().slice(0, 10);
  const custRows = await db.all(
    `SELECT i.customer_id AS customer_id, c.name AS customer_name, c.phone AS mobile,
       COALESCE(SUM(i.total - i.paid_amount), 0) AS amount,
       MIN(i.due_date) AS oldest_due_date, COUNT(*) AS bill_count
     FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.business_id = i.business_id
     WHERE i.business_id = ? AND i.customer_id IS NOT NULL AND i.due_date IS NOT NULL AND i.cancelled_at IS NULL
       AND i.paid_amount < i.total AND i.kind IN ('sale', 'opening')
     GROUP BY i.customer_id, c.name, c.phone`
  , bizId);
  const supRows = await db.all(
    `SELECT p.supplier_id AS supplier_id, s.name AS supplier_name, s.phone AS phone,
       COALESCE(SUM(p.total - p.paid_amount), 0) AS amount,
       MIN(p.due_date) AS oldest_due_date, COUNT(*) AS bill_count
     FROM purchases p JOIN suppliers s ON s.id = p.supplier_id AND s.business_id = p.business_id
     WHERE p.business_id = ? AND p.due_date IS NOT NULL AND p.paid_amount < p.total
     GROUP BY p.supplier_id, s.name, s.phone`
  , bizId);
  const normCust = custRows.map((g) => ({
    customer_id: g.customer_id, customer_name: g.customer_name, mobile: g.mobile || '',
    amount: round2(g.amount), oldest_due_date: g.oldest_due_date, bill_count: Number(g.bill_count)
  }));
  const normSup = supRows.map((g) => ({
    supplier_id: g.supplier_id, supplier_name: g.supplier_name, phone: g.phone || '',
    amount: round2(g.amount), oldest_due_date: g.oldest_due_date, bill_count: Number(g.bill_count)
  }));
  // Low stock — the app's existing definition (dashboard-summary uses
  // the same rule): stock_qty at or below the product's low_stock_limit.
  const lowStock = await db.all(
    `SELECT id AS product_id, name, stock_qty, low_stock_limit FROM products
     WHERE business_id = ? AND stock_qty <= low_stock_limit ORDER BY name ASC`
  , bizId);
  res.json({
    date: todayStr,
    customer_due: bucketDueRows(normCust, todayStr),
    supplier_due: bucketDueRows(normSup, todayStr),
    low_stock: lowStock.map((p) => ({
      product_id: p.product_id, name: p.name,
      stock_qty: Number(p.stock_qty), low_stock_limit: Number(p.low_stock_limit)
    }))
  });
});

app.get('/api/invoices/:id/whatsapp-link', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const inv = await getOwnedInvoice(bizId, req.params.id);
  if (!inv) return res.status(404).json({ error: 'invoice not found' });
  if (inv.cancelled_at) return res.status(400).json({ error: 'invoice_cancelled' });

  // Recipient: ?phone= override wins, else the invoice customer's stored phone.
  let rawPhone = req.query.phone !== undefined ? String(req.query.phone) : null;
  if (!rawPhone && inv.customer_id) {
    const cust = await db.get('SELECT phone FROM customers WHERE id = ? AND business_id = ?', inv.customer_id, bizId);
    if (cust) rawPhone = cust.phone;
  }
  const phone = normalizePhone(rawPhone);
  if (!phone) return res.status(400).json({ error: 'customer_phone_missing' });

  const biz = await getBusiness(bizId);
  const bizName = (biz && biz.name) || 'BizYour';
  const hi = !!(biz && biz.language === 'hi');
  const hg = !!(biz && biz.language === 'hg');
  const pub = publicInvoice(inv);
  const items = await db.all(
    `SELECT * FROM invoice_items WHERE invoice_id = ? AND business_id = ? ORDER BY id ASC`
  , inv.id, bizId);
  const lines = items.map((it) => `${it.product_name} ×${msgQty(it.qty)} — ₹${msgAmt(it.amount)}`);
  const sep = '--------------------------';
  let msg;
  if (hi) {
    msg = `🧾 *${bizName}* — बिल #${inv.bill_no} (${inv.date})\n${sep}\n${lines.join('\n')}\n${sep}`;
    if (Number(inv.discount) > 0) msg += `\nछूट: −₹${msgAmt(inv.discount)}`;
    msg += `\nकुल: ₹${msgAmt(inv.total)}`;
    msg += `\nजमा: ₹${msgAmt(inv.paid_amount)} · बाकी: ₹${msgAmt(pub.pending_amount)}`;
    if (inv.gst_enabled) msg += `\n(GST शामिल: ₹${msgAmt(inv.gst_amount)})`;
    msg += `\nधन्यवाद! 🙏`;
  } else if (hg) {
    msg = `🧾 *${bizName}* — Bill #${inv.bill_no} (${inv.date})\n${sep}\n${lines.join('\n')}\n${sep}`;
    if (Number(inv.discount) > 0) msg += `\nChhoot: −₹${msgAmt(inv.discount)}`;
    msg += `\nKul: ₹${msgAmt(inv.total)}`;
    msg += `\nJama: ₹${msgAmt(inv.paid_amount)} · Baaki: ₹${msgAmt(pub.pending_amount)}`;
    if (inv.gst_enabled) msg += `\n(GST shaamil: ₹${msgAmt(inv.gst_amount)})`;
    msg += `\nDhanyavaad! 🙏`;
  } else {
    msg = `🧾 *${bizName}* — Bill #${inv.bill_no} (${inv.date})\n${sep}\n${lines.join('\n')}\n${sep}`;
    if (Number(inv.discount) > 0) msg += `\nDiscount: −₹${msgAmt(inv.discount)}`;
    msg += `\nTotal: ₹${msgAmt(inv.total)}`;
    msg += `\nPaid: ₹${msgAmt(inv.paid_amount)} · Balance: ₹${msgAmt(pub.pending_amount)}`;
    if (inv.gst_enabled) msg += `\n(GST included: ₹${msgAmt(inv.gst_amount)})`;
    msg += `\nThank you! 🙏`;
  }
  // Updates Stage A: payment line for THIS bill's balance — only when a
  // UPI ID is set and a balance is due (buildUpiUri is null otherwise).
  const billPayUri = buildUpiUri(biz, pub.pending_amount, inv.bill_no);
  if (billPayUri) {
    msg += hi
      ? `\nUPI से पेमेंट करें: ${biz.upi_id}\n${billPayUri}`
      : hg ? `\nUPI se payment karein: ${biz.upi_id}\n${billPayUri}`
      : `\nPay on UPI: ${biz.upi_id}\n${billPayUri}`;
  }
  // Updates Stage D: generating a bill's WhatsApp link IS the onboarding
  // WhatsApp step happening for real — mark it done (best-effort only;
  // the link response must never fail because of the checklist).
  try {
    await ensureOnboardingRow(bizId);
    await db.run(
      `UPDATE onboarding SET wa_done = 1, updated_at = datetime('now') WHERE business_id = ?`
    , bizId);
  } catch (e) { /* onboarding tick is best-effort */ }
  res.json({ phone, url: 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg), message: msg });
});

app.get('/api/customers/:id/reminder-link', requireAuth, requireBillingAccess, async (req, res) => {
  const bizId = req.user.business_id;
  const c = await customerRow(bizId, req.params.id);
  if (!c) return res.status(404).json({ error: 'customer not found' });
  const pub = publicCustomer(c);
  if (!(pub.pending > 0)) return res.status(400).json({ error: 'no_pending' });
  const phone = normalizePhone(c.phone);
  if (!phone) return res.status(400).json({ error: 'customer_phone_missing' });

  const biz = await getBusiness(bizId);
  const bizName = (biz && biz.name) || 'BizYour';
  const hi = !!(biz && biz.language === 'hi');
  const hg = !!(biz && biz.language === 'hg');
  const open = await db.all(
    `SELECT * FROM invoices WHERE customer_id = ? AND business_id = ? AND total > paid_amount ORDER BY id ASC`
  , c.id, bizId);
  const billLines = open.map((i) => {
    const p = publicInvoice(i);
    // Stage C: an imported opening balance is not a bill — label it
    // plainly instead of printing a fake "Bill #0" line.
    if (i.kind === 'opening') {
      return hi
        ? `पिछला बाकी (Opening Balance) — ₹${msgAmt(p.pending_amount)}`
        : hg ? `Pichhla baaki (Opening Balance) — ₹${msgAmt(p.pending_amount)}`
        : `Previous balance (Opening Balance) — ₹${msgAmt(p.pending_amount)}`;
    }
    return hi
      ? `बिल #${i.bill_no} (${i.date}) — ₹${msgAmt(p.pending_amount)}`
      : `Bill #${i.bill_no} (${i.date}) — ₹${msgAmt(p.pending_amount)}`;
  });
  let msg;
  if (hi) {
    msg = `नमस्ते ${pub.name} जी 🙏\n${bizName} की तरफ से याद दिलाना था — आपके कुल ₹${msgAmt(pub.pending)} बाकी हैं:\n${billLines.join('\n')}\nजब समय मिले, कृपया भेज दीजिएगा। धन्यवाद!`;
  } else if (hg) {
    msg = `Namaste ${pub.name} ji 🙏\n${bizName} se yaad dilana tha — aapke kul ₹${msgAmt(pub.pending)} baaki hain:\n${billLines.join('\n')}\nJab samay mile, kripya bhej dijiyega. Dhanyavaad!`;
  } else {
    msg = `Hello ${pub.name} 🙏\nA friendly reminder from ${bizName} — a total of ₹${msgAmt(pub.pending)} is pending:\n${billLines.join('\n')}\nPlease pay when convenient. Thank you!`;
  }
  // Updates Stage A: payment line for the customer's TOTAL pending —
  // only when a UPI ID is set (buildUpiUri is null otherwise).
  const remindPayUri = buildUpiUri(biz, pub.pending, null);
  if (remindPayUri) {
    msg += hi
      ? `\nUPI से पेमेंट करें: ${biz.upi_id}\n${remindPayUri}`
      : hg ? `\nUPI se payment karein: ${biz.upi_id}\n${remindPayUri}`
      : `\nPay on UPI: ${biz.upi_id}\n${remindPayUri}`;
  }
  res.json({ phone, url: 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg), message: msg });
});

// =====================================================================
// ---------- Stage 4: Expenses / Reports / Profit ----------
// OWNER-ONLY finance (founder's Q9 rule: staff must never see profit).
// Profit = Sale − COGS − Expenses, where COGS = Σ invoice_items.qty ×
// buy_price snapshot. Purchases are stock, NOT an expense — never subtracted.
// =====================================================================
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isDateStr(s) { return typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s)); }
function rangeFromQuery(req) {
  const today = new Date().toISOString().slice(0, 10);
  const from = req.query.from !== undefined ? String(req.query.from) : today.slice(0, 8) + '01';
  const to = req.query.to !== undefined ? String(req.query.to) : today;
  if (!isDateStr(from) || !isDateStr(to) || from > to) return null;
  return { from, to };
}

// ---------- expenses ----------
const EXPENSE_CATEGORIES = ['Rent', 'Salary', 'Electricity', 'Transport', 'Packing', 'Food', 'Maintenance', 'Other'];
const EXPENSE_MODES = ['Cash', 'UPI', 'Bank'];
function publicExpense(e) {
  return {
    id: e.id, business_id: e.business_id, title: e.title, category: e.category,
    amount: round2(e.amount), date: e.date, payment_mode: e.payment_mode, notes: e.notes,
    updated_at: e.updated_at, sync_status: e.sync_status
  };
}
async function getOwnedExpense(bizId, id) {
  return await db.get('SELECT * FROM expenses WHERE id = ? AND business_id = ?', id, bizId);
}
function validExpenseBody(b, partial) {
  // Returns an error string, or null when valid. partial=true allows omitted fields (PUT).
  if (!partial || b.title !== undefined) {
    if (!b.title || !String(b.title).trim()) return 'expense title is required';
  }
  if (b.category !== undefined && !EXPENSE_CATEGORIES.includes(b.category)) {
    return 'category must be one of: ' + EXPENSE_CATEGORIES.join(', ');
  }
  if (!partial || b.amount !== undefined) {
    if (!validNum(b.amount) || Number(b.amount) <= 0) return 'amount must be greater than 0';
  }
  if (b.date !== undefined && !isDateStr(String(b.date))) return 'date must be YYYY-MM-DD';
  if (b.payment_mode !== undefined && !EXPENSE_MODES.includes(b.payment_mode)) {
    return 'payment_mode must be Cash, UPI or Bank';
  }
  return null;
}

app.get('/api/expenses', requireAuth, requireOwner, async (req, res) => {
  const bizId = req.user.business_id;
  let rows;
  if (req.query.from !== undefined || req.query.to !== undefined) {
    const range = rangeFromQuery(req);
    if (!range) return res.status(400).json({ error: 'invalid date range' });
    rows = await db.all(
      `SELECT * FROM expenses WHERE business_id = ? AND date >= ? AND date <= ? ORDER BY date DESC, id DESC`
    , bizId, range.from, range.to);
  } else {
    rows = await db.all(
      `SELECT * FROM expenses WHERE business_id = ? ORDER BY date DESC, id DESC`
    , bizId);
  }
  const total = round2(rows.reduce((s, e) => s + Number(e.amount), 0));
  res.json({ expenses: rows.map(publicExpense), total });
});

app.post('/api/expenses', requireAuth, requireOwner, async (req, res) => {
  const b = req.body || {};
  const err = validExpenseBody(b, false);
  if (err) return res.status(400).json({ error: err });
  const date = b.date ? String(b.date) : new Date().toISOString().slice(0, 10);
  const r = await db.run(
    `INSERT INTO expenses (business_id, title, category, amount, date, payment_mode, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  , req.user.business_id, String(b.title).trim(),
    b.category !== undefined ? b.category : 'Other',
    round2(Number(b.amount)), date,
    b.payment_mode !== undefined ? b.payment_mode : 'Cash',
    String(b.notes || '').trim());
  const newExpense = await getOwnedExpense(req.user.business_id, r.lastInsertRowid);
  await auditLog(req, 'create', 'expense', r.lastInsertRowid, `Kharcha joda: ${newExpense.title} · ${fmtAuditAmt(newExpense.amount)}`);
  res.status(201).json({ expense: publicExpense(newExpense) });
});

app.put('/api/expenses/:id', requireAuth, requireOwner, async (req, res) => {
  const bizId = req.user.business_id;
  const cur = await getOwnedExpense(bizId, req.params.id);
  if (!cur) return res.status(404).json({ error: 'expense not found' });
  const b = req.body || {};
  const err = validExpenseBody(b, true);
  if (err) return res.status(400).json({ error: err });
  await db.run(
    `UPDATE expenses SET title=?, category=?, amount=?, date=?, payment_mode=?, notes=?,
       updated_at=datetime('now'), sync_status='local' WHERE id=? AND business_id=?`
  , b.title !== undefined ? String(b.title).trim() : cur.title,
    b.category !== undefined ? b.category : cur.category,
    b.amount !== undefined ? round2(Number(b.amount)) : cur.amount,
    b.date !== undefined ? String(b.date) : cur.date,
    b.payment_mode !== undefined ? b.payment_mode : cur.payment_mode,
    b.notes !== undefined ? String(b.notes).trim() : cur.notes,
    cur.id, bizId);
  const updExpense = await getOwnedExpense(bizId, cur.id);
  await auditLog(req, 'update', 'expense', cur.id, `Kharcha badla: ${updExpense.title} · ${fmtAuditAmt(updExpense.amount)}`);
  res.json({ expense: publicExpense(updExpense) });
});

app.delete('/api/expenses/:id', requireAuth, requireOwner, async (req, res) => {
  const bizId = req.user.business_id;
  const cur = await getOwnedExpense(bizId, req.params.id);
  if (!cur) return res.status(404).json({ error: 'expense not found' });
  await recordTombstone(bizId, 'expenses', cur.id);
  await db.run('DELETE FROM expenses WHERE id = ? AND business_id = ?', cur.id, bizId);
  await auditLog(req, 'delete', 'expense', cur.id, `Kharcha delete kiya: ${cur.title} · ${fmtAuditAmt(cur.amount)}`);
  res.json({ ok: true });
});

// ---------- reports / profit ----------
async function financeSummary(bizId, from, to) {
  // Stage C: kind='sale' filter — imported opening-balance rows
  // (kind='opening', no items) are udhaar, never sales/COGS.
  const sale = await db.get(
    `SELECT COALESCE(SUM(total),0) AS s, COUNT(*) AS c FROM invoices
     WHERE business_id = ? AND date >= ? AND date <= ? AND kind = 'sale' AND cancelled_at IS NULL`
  , bizId, from, to);
  const cogsRow = await db.get(
    `SELECT COALESCE(SUM(ii.qty * ii.buy_price),0) AS s FROM invoice_items ii
     JOIN invoices i ON i.id = ii.invoice_id AND i.business_id = ii.business_id
     WHERE i.business_id = ? AND i.date >= ? AND i.date <= ? AND i.kind = 'sale' AND i.cancelled_at IS NULL`
  , bizId, from, to);
  // Feature 2: returns net out by their RETURN date (credit-note month
  // rule) — sale drops by the returned value, COGS drops by the returned
  // items' cost on the same buy_price snapshot basis as sales.
  const retRow = await db.get(
    `SELECT COALESCE(SUM(total_amount),0) AS s FROM returns
     WHERE business_id = ? AND date >= ? AND date <= ?`
  , bizId, from, to);
  const retCogsRow = await db.get(
    `SELECT COALESCE(SUM(ri.qty * ii.buy_price),0) AS s FROM return_items ri
     JOIN invoice_items ii ON ii.id = ri.invoice_item_id AND ii.business_id = ri.business_id
     JOIN returns r ON r.id = ri.return_id AND r.business_id = ri.business_id
     WHERE ri.business_id = ? AND r.date >= ? AND r.date <= ?`
  , bizId, from, to);
  const expRow = await db.get(
    `SELECT COALESCE(SUM(amount),0) AS s FROM expenses
     WHERE business_id = ? AND date >= ? AND date <= ?`
  , bizId, from, to);
  const saleTotal = round2(Number(sale.s) - Number(retRow.s));
  const cogs = round2(Number(cogsRow.s) - Number(retCogsRow.s));
  const expTotal = round2(expRow.s);
  const gross = round2(saleTotal - cogs);
  return {
    sale_total: saleTotal, bills_count: sale.c, cogs,
    gross_profit: gross, expenses_total: expTotal,
    net_profit: round2(gross - expTotal)
  };
}
async function pendingTotals(bizId) {
  // Feature 2: customer pending nets returns out. The old query summed
  // only bills with total > paid (pending could never go negative);
  // with returns a customer CAN be net-credit, so the filter is gone
  // and the returns total is subtracted. Identical result when there
  // are no returns (paid_amount never exceeds total on any invoice).
  const c = await db.get(
    `SELECT COALESCE(SUM(total - paid_amount),0) AS s FROM invoices WHERE business_id = ? AND cancelled_at IS NULL`
  , bizId);
  const rt = await db.get(
    `SELECT COALESCE(SUM(total_amount),0) AS s FROM returns WHERE business_id = ?`
  , bizId);
  const s = await db.get(
    `SELECT COALESCE(SUM(total - paid_amount),0) AS s FROM purchases WHERE business_id = ? AND total > paid_amount`
  , bizId);
  return { pending_collection: round2(Number(c.s) - Number(rt.s)), pending_supplier: round2(s.s) };
}

app.get('/api/reports/summary', requireAuth, requireOwner, async (req, res) => {
  const range = rangeFromQuery(req);
  if (!range) return res.status(400).json({ error: 'invalid date range' });
  const bizId = req.user.business_id;
  const fin = await financeSummary(bizId, range.from, range.to);
  const pend = await pendingTotals(bizId);
  const stock = await db.get(
    `SELECT COALESCE(SUM(stock_qty * buy_price),0) AS s FROM products WHERE business_id = ?`
  , bizId);
  res.json({
    from: range.from, to: range.to,
    sale_total: fin.sale_total, bills_count: fin.bills_count,
    cogs: fin.cogs, gross_profit: fin.gross_profit,
    expenses_total: fin.expenses_total, net_profit: fin.net_profit,
    pending_collection: pend.pending_collection,
    pending_supplier: pend.pending_supplier,
    stock_value: round2(stock.s)
  });
});

app.get('/api/reports/daily-sales', requireAuth, requireOwner, async (req, res) => {
  const range = rangeFromQuery(req);
  if (!range) return res.status(400).json({ error: 'invalid date range' });
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1;
  if (days > 366) return res.status(400).json({ error: 'range too large (max 366 days)' });
  const rows = await db.all(
    `SELECT date, COALESCE(SUM(total),0) AS t, COUNT(*) AS c FROM invoices
     WHERE business_id = ? AND date >= ? AND date <= ? AND kind = 'sale' AND cancelled_at IS NULL GROUP BY date`
  , req.user.business_id, range.from, range.to);
  const map = {};
  rows.forEach((r) => { map[r.date] = { total: round2(r.t), bills: r.c }; });
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.parse(range.from) + i * 86400000).toISOString().slice(0, 10);
    out.push({ date: d, total: map[d] ? map[d].total : 0, bills: map[d] ? map[d].bills : 0 });
  }
  res.json(out);
});

app.get('/api/reports/expense-categories', requireAuth, requireOwner, async (req, res) => {
  const range = rangeFromQuery(req);
  if (!range) return res.status(400).json({ error: 'invalid date range' });
  const rows = await db.all(
    `SELECT category, COALESCE(SUM(amount),0) AS t FROM expenses
     WHERE business_id = ? AND date >= ? AND date <= ?
     GROUP BY category HAVING SUM(amount) > 0 ORDER BY t DESC`
  , req.user.business_id, range.from, range.to);
  res.json(rows.map((r) => ({ category: r.category, total: round2(r.t) })));
});

app.get('/api/reports/pending', requireAuth, requireOwner, async (req, res) => {
  const bizId = req.user.business_id;
  // Feature 2: per-customer pending = bill balances − that customer's
  // returns (same computation as the customers list). A net-credit
  // customer drops out of this "baaki hai" list but still counts in the
  // totals and shows negative in Customers.
  const cust = await db.all(
    `SELECT c.id AS id, c.name AS name, c.phone AS phone,
       COALESCE(SUM(i.total - i.paid_amount), 0) - COALESCE(rt.total_returns, 0) AS pending
     FROM customers c
     LEFT JOIN invoices i ON i.customer_id = c.id AND i.business_id = c.business_id AND i.cancelled_at IS NULL
     LEFT JOIN (SELECT customer_id, SUM(total_amount) AS total_returns FROM returns
                WHERE business_id = ? GROUP BY customer_id) rt ON rt.customer_id = c.id
     WHERE c.business_id = ?
     GROUP BY c.id, c.name, c.phone, rt.total_returns
     HAVING COALESCE(SUM(i.total - i.paid_amount), 0) - COALESCE(rt.total_returns, 0) > 0
     ORDER BY pending DESC`
  , bizId, bizId);
  const sup = await db.all(
    `SELECT s.id AS id, s.name AS name, s.phone AS phone, SUM(p.total - p.paid_amount) AS pending
     FROM purchases p JOIN suppliers s ON s.id = p.supplier_id AND s.business_id = p.business_id
     WHERE p.business_id = ? AND p.total > p.paid_amount
     GROUP BY s.id HAVING SUM(p.total - p.paid_amount) > 0 ORDER BY pending DESC`
  , bizId);
  const pend = await pendingTotals(bizId);
  res.json({
    customers: cust.map((r) => ({ id: r.id, name: r.name, phone: r.phone, pending: round2(r.pending) })),
    suppliers: sup.map((r) => ({ id: r.id, name: r.name, phone: r.phone, pending: round2(r.pending) })),
    total_collection: pend.pending_collection,
    total_payable: pend.pending_supplier
  });
});

// =====================================================================
// ---------- SaaS Stage 1: GST report / Monthly reports / Global search ----------
// GST math REUSES the invoice-creation formula exactly (see POST /api/invoices):
// prices are GST-inclusive and an item's GST part = amount × rate/(100+rate),
// counted only for invoices created while the business had GST ON (the
// invoice row snapshots gst_enabled + gst_amount at creation time).
// =====================================================================
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
function monthFromQuery(req) {
  const cur = new Date().toISOString().slice(0, 7);
  const m = req.query.month !== undefined ? String(req.query.month) : cur;
  if (!MONTH_RE.test(m)) return null;
  const parts = m.split('-').map(Number);
  const last = new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate();
  return { month: m, from: m + '-01', to: m + '-' + String(last).padStart(2, '0') };
}
function shiftMonth(month, delta) {
  const parts = month.split('-').map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1 + delta, 1)).toISOString().slice(0, 7);
}
// CGST/SGST are the two equal halves of the same GST total (intra-state
// split); sgst takes the rounding remainder so cgst + sgst == gst exactly.
function splitCgstSgst(gst) {
  const cgst = round2(gst / 2);
  return { cgst, sgst: round2(gst - cgst) };
}

// ---------- GST report (owner-only, like every finance report) ----------
app.get('/api/reports/gst', requireAuth, requireOwner, async (req, res) => {
  const range = monthFromQuery(req);
  if (!range) return res.status(400).json({ error: 'invalid month (use YYYY-MM)' });
  const bizId = req.user.business_id;
  const biz = await getBusiness(bizId);
  const base = {
    month: range.month, from: range.from, to: range.to,
    gst_enabled: !!(biz && biz.gst_enabled), gstin: biz ? (biz.gstin || '') : ''
  };
  if (!base.gst_enabled) {
    // GST is OFF for this business — say so plainly, all figures zero.
    return res.json({
      ...base, bills_count: 0, total_sales: 0, subtotal: 0, discount: 0,
      taxable_value: 0, output_gst: 0, cgst: 0, sgst: 0, by_rate: [],
      returns_count: 0, returns_total: 0, returns_gst: 0, returns_taxable: 0,
      input_gst: 0, input_by_rate: [], net_gst_payable: 0
    });
  }
  // Output GST: the stored per-invoice gst_amount is the authority — the
  // report total reconciles with the sum of GST on the month's invoices
  // by construction.
  const tot = await db.get(
    `SELECT COALESCE(SUM(total),0) AS sales, COALESCE(SUM(subtotal),0) AS sub,
       COALESCE(SUM(discount),0) AS disc, COALESCE(SUM(gst_amount),0) AS gst, COUNT(*) AS c
     FROM invoices WHERE business_id = ? AND date >= ? AND date <= ? AND gst_enabled = 1 AND kind = 'sale' AND cancelled_at IS NULL`
  , bizId, range.from, range.to);
  const outputGst = round2(tot.gst);
  // Rate-wise breakup from invoice_items, same inclusive formula per rate.
  const rateRows = await db.all(
    `SELECT ii.gst_rate AS rate, COALESCE(SUM(ii.amount),0) AS amt
     FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id AND i.business_id = ii.business_id
     WHERE i.business_id = ? AND i.date >= ? AND i.date <= ? AND i.gst_enabled = 1 AND i.cancelled_at IS NULL
     GROUP BY ii.gst_rate ORDER BY ii.gst_rate ASC`
  , bizId, range.from, range.to);
  const byRate = rateRows.map((r) => {
    const rate = Number(r.rate), amt = round2(r.amt);
    const gst = rate > 0 ? round2(amt * rate / (100 + rate)) : 0;
    const split = splitCgstSgst(gst);
    return { rate, amount: amt, taxable_value: round2(amt - gst), gst, cgst: split.cgst, sgst: split.sgst };
  });
  // Per-rate rounding can drift a paisa from the stored invoice total —
  // fold the difference into the biggest rate slab so the breakup sums
  // EXACTLY to output_gst.
  const rateGstSum = round2(byRate.reduce((s, r) => s + r.gst, 0));
  const diff = round2(outputGst - rateGstSum);
  if (diff !== 0 && byRate.length) {
    let big = byRate[0];
    byRate.forEach((r) => { if (r.gst > big.gst) big = r; });
    big.gst = round2(big.gst + diff);
    big.taxable_value = round2(big.amount - big.gst);
    const split = splitCgstSgst(big.gst);
    big.cgst = split.cgst; big.sgst = split.sgst;
  }
  // Feature 2: credit notes (sales returns) whose RETURN date falls in
  // this month reduce output GST + taxable value (credit-note month
  // rule). Computed per returned item from the return_items snapshots
  // with the same inclusive formula, then folded into by_rate so the
  // breakup stays internally exact (Σ by_rate gst == net output_gst).
  const retItemRows = await db.all(
    `SELECT ri.gst_rate AS rate, ri.qty AS qty, ri.price AS price
     FROM return_items ri JOIN returns r ON r.id = ri.return_id AND r.business_id = ri.business_id
     WHERE ri.business_id = ? AND r.date >= ? AND r.date <= ?`
  , bizId, range.from, range.to);
  const retByRate = new Map();
  retItemRows.forEach((ri) => {
    const rate = Number(ri.rate) || 0;
    const amt = round2(Number(ri.qty) * Number(ri.price));
    const gst = rate > 0 ? round2(amt * rate / (100 + rate)) : 0;
    const cur = retByRate.get(rate) || { rate, amount: 0, gst: 0 };
    cur.amount = round2(cur.amount + amt);
    cur.gst = round2(cur.gst + gst);
    retByRate.set(rate, cur);
  });
  const returnsGst = round2([...retByRate.values()].reduce((s, x) => s + x.gst, 0));
  const returnsTaxable = round2([...retByRate.values()].reduce((s, x) => s + round2(x.amount - x.gst), 0));
  const retTotRow = await db.get(
    `SELECT COUNT(*) AS c, COALESCE(SUM(total_amount),0) AS t FROM returns
     WHERE business_id = ? AND date >= ? AND date <= ?`
  , bizId, range.from, range.to);
  retByRate.forEach((x) => {
    let row = byRate.find((r) => r.rate === x.rate);
    if (!row) {
      row = { rate: x.rate, amount: 0, taxable_value: 0, gst: 0, cgst: 0, sgst: 0 };
      byRate.push(row);
      byRate.sort((a, b) => a.rate - b.rate);
    }
    row.amount = round2(row.amount - x.amount);
    row.gst = round2(row.gst - x.gst);
    row.taxable_value = round2(row.amount - row.gst);
    const split = splitCgstSgst(row.gst);
    row.cgst = split.cgst; row.sgst = split.sgst;
  });
  const outputGstNet = round2(outputGst - returnsGst);
  const cgst = round2(byRate.reduce((s, r) => s + r.cgst, 0));
  const sgst = round2(byRate.reduce((s, r) => s + r.sgst, 0));
  const taxable = round2(byRate.reduce((s, r) => s + r.taxable_value, 0));
  // Input GST (purchases): purchase rows carry NO gst snapshot, so the only
  // rate available is the product's gst_rate — same inclusive formula on the
  // purchase item amounts. Flagged in the payload so nobody mistakes it for
  // a supplier-bill figure.
  const inRows = await db.all(
    `SELECT pr.gst_rate AS rate, COALESCE(SUM(pi.amount),0) AS amt
     FROM purchase_items pi
     JOIN purchases p ON p.id = pi.purchase_id AND p.business_id = pi.business_id
     JOIN products pr ON pr.id = pi.product_id AND pr.business_id = pi.business_id
     WHERE pi.business_id = ? AND p.date >= ? AND p.date <= ?
     GROUP BY pr.gst_rate ORDER BY pr.gst_rate ASC`
  , bizId, range.from, range.to);
  const inputByRate = inRows.map((r) => {
    const rate = Number(r.rate), amt = round2(r.amt);
    const gst = rate > 0 ? round2(amt * rate / (100 + rate)) : 0;
    return { rate, amount: amt, gst };
  }).filter((r) => r.gst > 0);
  const inputGst = round2(inputByRate.reduce((s, r) => s + r.gst, 0));
  res.json({
    ...base,
    bills_count: tot.c, total_sales: round2(tot.sales), subtotal: round2(tot.sub),
    discount: round2(tot.disc), taxable_value: taxable,
    output_gst: outputGstNet, cgst, sgst, by_rate: byRate,
    // Feature 2: this month's credit notes (returns), for the UI note.
    returns_count: Number(retTotRow.c), returns_total: round2(retTotRow.t),
    returns_gst: returnsGst, returns_taxable: returnsTaxable,
    input_gst: inputGst, input_by_rate: inputByRate, input_gst_source: 'product_gst_rate',
    net_gst_payable: round2(outputGstNet - inputGst)
  });
});

// =====================================================================
// ---------- Updates Stage B: GSTR-1 output + top-plan portal docs ----------
// =====================================================================
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
function validGstin(g) { return GSTIN_RE.test(String(g || '').trim().toUpperCase()); }
// GST-system unit codes for the units this app sells in.
function uqcFor(unit) {
  const map = { piece: 'NOS', pack: 'PAC', kg: 'KGS', litre: 'LTR', box: 'BOX', dozen: 'DOZ' };
  return map[String(unit || '').toLowerCase()] || 'OTH';
}
function ddmmyyyy(iso) { const p = String(iso || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(iso || ''); }

// Per-invoice line math, shared by the GSTR-1 file and the portal docs.
// Prices are GST-inclusive (app-wide rule). Two views of the same lines:
//  gross — discount NOT allocated: taxable = amount × 100/(100+rate). This
//          is the Stage 1 GST-report basis (the stored invoice gst_amount
//          is computed on the pre-discount subtotal), so gross figures
//          reconcile with the GST report exactly.
//  net   — the invoice discount allocated pro-rata across lines (standard
//          accounting practice): every line keeps its exact rate and the
//          file stays internally consistent (Σ taxable + Σ tax == invoice
//          total). Used ONLY inside downloaded portal files.
// Rounding drift is folded into the biggest line so per-invoice sums land
// exactly on the invoice's own numbers.
function invoiceLineMath(inv, items) {
  const subtotal = Number(inv.subtotal) || 0;
  const discount = Number(inv.discount) || 0;
  const keep = subtotal > 0 ? (subtotal - discount) / subtotal : 1;
  const build = (netBasis) => items.map((it) => {
    const rate = Number(it.gst_rate) || 0;
    const grossAmt = Number(it.amount) || 0;
    const amt = netBasis ? grossAmt * keep : grossAmt;
    const taxable = rate > 0 ? amt * 100 / (100 + rate) : amt;
    return { item: it, rate, amount: amt, taxable, tax: amt - taxable, discount: grossAmt - amt };
  });
  const finish = (lines, targetTaxable, targetTax) => {
    lines.forEach((l) => { l.amount = round2(l.amount); l.taxable = round2(l.taxable); l.tax = round2(l.tax); l.discount = round2(l.discount); });
    if (lines.length) {
      let bi = 0;
      lines.forEach((l, i) => { if (l.amount > lines[bi].amount) bi = i; });
      lines[bi].taxable = round2(lines[bi].taxable + round2(targetTaxable - lines.reduce((s, l) => s + l.taxable, 0)));
      lines[bi].tax = round2(lines[bi].tax + round2(targetTax - lines.reduce((s, l) => s + l.tax, 0)));
    }
    return lines;
  };
  const gstAmt = Number(inv.gst_amount) || 0;
  const gross = finish(build(false), round2(subtotal - gstAmt), gstAmt);
  const netRaw = build(true);
  const netTax = round2(netRaw.reduce((s, l) => s + (round2(l.tax)), 0));
  const net = finish(netRaw, round2(Number(inv.total) - netTax), netTax);
  return { gross, net };
}

// ---------- top plan ----------
// Rule (least invasive, no schema change): the super admin may pin a plan
// code in app_settings.top_plan_code; when unset (or pointing at a
// missing/inactive plan) the top plan is DERIVED — highest price wins,
// ties break to the longest duration, then to the lowest code. With the
// seeded prices (both 0 = "not set") that makes 'yearly' the top plan.
// A business is "top plan" only while its subscription's plan_code IS
// that plan AND the subscription is not read-only — trial (no plan_code)
// and expired/blocked businesses are never top plan; grace keeps full
// access, exactly like every other feature (SaaS Stage 2 semantics).
async function getTopPlan() {
  const plans = await db.all('SELECT * FROM plans WHERE is_active = 1');
  if (!plans.length) return null;
  const wanted = (await getSetting('top_plan_code')).trim();
  if (wanted) {
    const pinned = plans.find((p) => p.code === wanted);
    if (pinned) return pinned;
  }
  return plans.slice().sort((a, b) =>
    (Number(b.price) - Number(a.price)) ||
    (Number(b.duration_days) - Number(a.duration_days)) ||
    (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))[0];
}
async function isTopPlan(bizId) {
  const sub = await ensureSubscription(bizId);
  if (!sub.plan_code) return false;
  if (subscriptionState(sub).read_only) return false;
  const top = await getTopPlan();
  return !!top && sub.plan_code === top.code;
}
async function requireTopPlan(req, res, next) {
  if (await isTopPlan(req.user.business_id)) return next();
  const top = await getTopPlan();
  return res.status(403).json({
    error: 'top_plan_required', top_plan: top ? top.code : null,
    message: 'E-Way Bill / E-Invoice portal files sirf top plan me hain. Plan upgrade karne par ye khul jayega.'
  });
}

// ---------- GSTR-1 builder ----------
// Headline figures come from the SAME aggregate queries as
// GET /api/reports/gst, so the GSTR-1 summary reconciles with the GST
// report by construction (Nov-2026 demo: sales ₹4,011, output GST
// ₹228.15). The B2B/B2C split keys off the customer's GSTIN (valid format
// → B2B; missing or malformed → B2C, and the malformed ones are counted
// in readiness so the owner can fix them).
async function buildGstr1(bizId, range) {
  const biz = await getBusiness(bizId);
  const base = {
    month: range.month, from: range.from, to: range.to,
    gst_enabled: !!(biz && biz.gst_enabled), gstin: biz ? (biz.gstin || '') : ''
  };
  if (!base.gst_enabled) return { ...base, gst_off: true };
  // --- headline: identical queries/formula to the GST report ---
  const tot = await db.get(
    `SELECT COALESCE(SUM(total),0) AS sales, COALESCE(SUM(subtotal),0) AS sub,
       COALESCE(SUM(discount),0) AS disc, COALESCE(SUM(gst_amount),0) AS gst, COUNT(*) AS c
     FROM invoices WHERE business_id = ? AND date >= ? AND date <= ? AND gst_enabled = 1 AND kind = 'sale' AND cancelled_at IS NULL`
  , bizId, range.from, range.to);
  const outputGst = round2(tot.gst);
  const rateRows = await db.all(
    `SELECT ii.gst_rate AS rate, COALESCE(SUM(ii.amount),0) AS amt
     FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id AND i.business_id = ii.business_id
     WHERE i.business_id = ? AND i.date >= ? AND i.date <= ? AND i.gst_enabled = 1 AND i.cancelled_at IS NULL
     GROUP BY ii.gst_rate ORDER BY ii.gst_rate ASC`
  , bizId, range.from, range.to);
  const byRate = rateRows.map((r) => {
    const rate = Number(r.rate), amt = round2(r.amt);
    const gst = rate > 0 ? round2(amt * rate / (100 + rate)) : 0;
    return { rate, amount: amt, taxable_value: round2(amt - gst), gst };
  });
  const rateGstSum = round2(byRate.reduce((s, r) => s + r.gst, 0));
  const diff = round2(outputGst - rateGstSum);
  if (diff !== 0 && byRate.length) {
    let big = byRate[0];
    byRate.forEach((r) => { if (r.gst > big.gst) big = r; });
    big.gst = round2(big.gst + diff);
    big.taxable_value = round2(big.amount - big.gst);
  }
  const taxable = round2(byRate.reduce((s, r) => s + r.taxable_value, 0));
  const headSplit = splitCgstSgst(outputGst);
  // --- invoices + items (with customer GSTIN + product HSN) ---
  const invRows = await db.all(
    `SELECT i.*, c.gstin AS cust_gstin
     FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id AND c.business_id = i.business_id
     WHERE i.business_id = ? AND i.date >= ? AND i.date <= ? AND i.gst_enabled = 1 AND i.cancelled_at IS NULL
     ORDER BY i.id ASC`
  , bizId, range.from, range.to);
  const itemRows = await db.all(
    `SELECT ii.*, p.hsn_code AS hsn_code, p.unit AS p_unit
     FROM invoice_items ii
     JOIN invoices i ON i.id = ii.invoice_id AND i.business_id = ii.business_id
     LEFT JOIN products p ON p.id = ii.product_id AND p.business_id = ii.business_id
     WHERE i.business_id = ? AND i.date >= ? AND i.date <= ? AND i.gst_enabled = 1 AND i.cancelled_at IS NULL
     ORDER BY ii.invoice_id ASC, ii.id ASC`
  , bizId, range.from, range.to);
  const itemsByInv = new Map();
  itemRows.forEach((r) => {
    if (!itemsByInv.has(r.invoice_id)) itemsByInv.set(r.invoice_id, []);
    itemsByInv.get(r.invoice_id).push(r);
  });
  const pos = base.gstin ? base.gstin.slice(0, 2) : '';
  const invoices = invRows.map((inv) => {
    const items = itemsByInv.get(inv.id) || [];
    const math = invoiceLineMath(inv, items);
    const raw = String(inv.cust_gstin || '').trim().toUpperCase();
    const b2b = validGstin(raw);
    return { inv, items, gross: math.gross, net: math.net, b2b, cust_gstin: b2b ? raw : '', gstin_raw: raw };
  });
  const bucket = (list) => ({
    invoices: list.length,
    value: round2(list.reduce((s, x) => s + Number(x.inv.total), 0)),
    taxable_value: round2(list.reduce((s, x) => s + x.gross.reduce((a, l) => a + l.taxable, 0), 0)),
    tax: round2(list.reduce((s, x) => s + Number(x.inv.gst_amount), 0)),
    igst: 0
  });
  const b2bList = invoices.filter((x) => x.b2b);
  const b2cList = invoices.filter((x) => !x.b2b);
  const b2b = bucket(b2bList);
  const b2c = bucket(b2cList);
  // Fold split drift so B2B + B2C taxable lands exactly on the headline.
  const splitTaxable = round2(b2b.taxable_value + b2c.taxable_value);
  if (splitTaxable !== taxable) {
    const target = b2b.taxable_value >= b2c.taxable_value ? b2b : b2c;
    target.taxable_value = round2(target.taxable_value + round2(taxable - splitTaxable));
  }
  [b2b, b2c].forEach((b) => { const s = splitCgstSgst(b.tax); b.cgst = s.cgst; b.sgst = s.sgst; });
  // --- Feature 2: credit notes — returns whose RETURN date is in this
  // month (credit-note month rule, same as the GST report). The headline
  // output_gst / taxable_value below are NET of these; the b2b/b2c
  // buckets above stay gross (they describe the invoices themselves).
  const cnRows = await db.all(
    `SELECT r.*, i.bill_no AS orig_bill_no, i.date AS orig_date, i.customer_name AS orig_customer_name,
       c.gstin AS cust_gstin
     FROM returns r JOIN invoices i ON i.id = r.invoice_id AND i.business_id = r.business_id
     LEFT JOIN customers c ON c.id = r.customer_id AND c.business_id = r.business_id
     WHERE r.business_id = ? AND r.date >= ? AND r.date <= ? ORDER BY r.id ASC`
  , bizId, range.from, range.to);
  const cnItemRows = await db.all(
    `SELECT ri.* FROM return_items ri JOIN returns r ON r.id = ri.return_id AND r.business_id = ri.business_id
     WHERE ri.business_id = ? AND r.date >= ? AND r.date <= ? ORDER BY ri.id ASC`
  , bizId, range.from, range.to);
  const cnItemsByRet = new Map();
  cnItemRows.forEach((ri) => {
    if (!cnItemsByRet.has(ri.return_id)) cnItemsByRet.set(ri.return_id, []);
    cnItemsByRet.get(ri.return_id).push(ri);
  });
  const cnNotes = cnRows.map((r) => {
    const items = (cnItemsByRet.get(r.id) || []).map((ri) => {
      const rate = Number(ri.gst_rate) || 0;
      const amt = round2(Number(ri.qty) * Number(ri.price));
      const tax = rate > 0 ? round2(amt * rate / (100 + rate)) : 0;
      return { rate, taxable: round2(amt - tax), tax, amount: amt };
    });
    const raw = String(r.cust_gstin || '').trim().toUpperCase();
    return {
      return_id: r.id, return_no: r.return_no, date: r.date,
      invoice_id: r.invoice_id, bill_no: r.orig_bill_no, orig_date: r.orig_date,
      customer_id: r.customer_id || null, customer_name: r.orig_customer_name,
      total: round2(r.total_amount), gst_amount: round2(r.gst_amount),
      taxable_value: round2(items.reduce((s, x) => s + x.taxable, 0)),
      items, cust_gstin: validGstin(raw) ? raw : ''
    };
  });
  const cnTaxTotal = round2(cnNotes.reduce((s, n) => s + n.items.reduce((a, x) => a + x.tax, 0), 0));
  const cnTaxableTotal = round2(cnNotes.reduce((s, n) => s + n.taxable_value, 0));
  const cnSplit = splitCgstSgst(cnTaxTotal);
  const creditNotes = {
    count: cnNotes.length,
    total_value: round2(cnNotes.reduce((s, n) => s + n.total, 0)),
    taxable_value: cnTaxableTotal, tax: cnTaxTotal,
    cgst: cnSplit.cgst, sgst: cnSplit.sgst, notes: cnNotes
  };
  // --- HSN summary (gross basis — the GST-report world) ---
  const hsnMap = new Map();
  invoices.forEach((x) => x.gross.forEach((l) => {
    const code = String(l.item.hsn_code || '').trim();
    if (!hsnMap.has(code)) {
      hsnMap.set(code, { hsn_code: code, description: l.item.product_name, uqc: uqcFor(l.item.p_unit), qty: 0, taxable_value: 0, tax: 0 });
    }
    const h = hsnMap.get(code);
    h.qty = round2(h.qty + Number(l.item.qty));
    h.taxable_value = round2(h.taxable_value + l.taxable);
    h.tax = round2(h.tax + l.tax);
  }));
  const hsnSummary = [...hsnMap.values()].map((h) => {
    const s = splitCgstSgst(h.tax);
    return { ...h, cgst: s.cgst, sgst: s.sgst, igst: 0, total_tax: h.tax };
  });
  // --- readiness: what the owner should fix before filing ---
  const missHsn = await db.get(
    `SELECT COUNT(*) AS c FROM products WHERE business_id = ? AND TRIM(COALESCE(hsn_code, '')) = ''`
  , bizId);
  const missHsnNames = await db.all(
    `SELECT name FROM products WHERE business_id = ? AND TRIM(COALESCE(hsn_code, '')) = '' ORDER BY name ASC LIMIT 10`
  , bizId);
  const readiness = {
    business_gstin_missing: !base.gstin,
    products_missing_hsn: Number(missHsn.c),
    products_missing_hsn_names: missHsnNames.map((r) => r.name),
    customers_invoiced_without_gstin: new Set(invoices.filter((x) => x.inv.customer_id && !x.gstin_raw).map((x) => x.inv.customer_id)).size,
    customers_with_invalid_gstin: new Set(invoices.filter((x) => x.inv.customer_id && x.gstin_raw && !x.b2b).map((x) => x.inv.customer_id)).size
  };
  // --- portal file (net basis — internally consistent for upload) ---
  const file = {
    gstin: base.gstin, fp: range.month.slice(5, 7) + range.month.slice(0, 4),
    gt: 0, cur_gt: 0, b2b: [], b2cs: [], hsn: { data: [] }
  };
  const byCtin = new Map();
  b2bList.forEach((x) => {
    if (!byCtin.has(x.cust_gstin)) byCtin.set(x.cust_gstin, []);
    byCtin.get(x.cust_gstin).push({
      inum: String(x.inv.bill_no), idt: ddmmyyyy(x.inv.date).replace(/\//g, '-'),
      val: round2(x.inv.total), pos, rchrg: 'N', inv_typ: 'R',
      itms: x.net.map((l, i) => {
        const s = splitCgstSgst(l.tax);
        return { num: i + 1, itm_det: { rt: l.rate, txval: l.taxable, camt: s.cgst, samt: s.sgst, iamt: 0, csamt: 0 } };
      })
    });
  });
  file.b2b = [...byCtin.entries()].map(([ctin, inv]) => ({ ctin, inv }));
  const fileByRate = new Map();
  b2cList.forEach((x) => x.net.forEach((l) => {
    if (!fileByRate.has(l.rate)) fileByRate.set(l.rate, { taxable: 0, tax: 0 });
    const g = fileByRate.get(l.rate);
    g.taxable = round2(g.taxable + l.taxable);
    g.tax = round2(g.tax + l.tax);
  }));
  file.b2cs = [...fileByRate.entries()].sort((a, b) => a[0] - b[0]).map(([rt, g]) => {
    const s = splitCgstSgst(g.tax);
    return { sply_ty: 'INTRA', pos, typ: 'OE', rt, txval: g.taxable, camt: s.cgst, samt: s.sgst, iamt: 0, csamt: 0 };
  });
  const fileHsn = new Map();
  invoices.forEach((x) => x.net.forEach((l) => {
    const code = String(l.item.hsn_code || '').trim();
    if (!fileHsn.has(code)) {
      fileHsn.set(code, { hsn_sc: code, desc: l.item.product_name, uqc: uqcFor(l.item.p_unit), qty: 0, txval: 0, tax: 0 });
    }
    const h = fileHsn.get(code);
    h.qty = round2(h.qty + Number(l.item.qty));
    h.txval = round2(h.txval + l.taxable);
    h.tax = round2(h.tax + l.tax);
  }));
  file.hsn.data = [...fileHsn.values()].map((h, i) => {
    const s = splitCgstSgst(h.tax);
    return { num: i + 1, hsn_sc: h.hsn_sc, desc: h.desc, uqc: h.uqc, qty: h.qty, txval: h.txval, iamt: 0, camt: s.cgst, samt: s.sgst, csamt: 0 };
  });
  // Feature 2: credit notes in the portal file too (cdnr for registered
  // customers, cdnur for the rest) — per-item values come from the
  // return snapshots; returns carry no discount, so no net/gross split.
  const cdnrByCtin = new Map();
  const cdnur = [];
  cnNotes.forEach((n) => {
    const itms = n.items.map((x, i) => {
      const s = splitCgstSgst(x.tax);
      return { num: i + 1, itm_det: { rt: x.rate, txval: x.taxable, camt: s.cgst, samt: s.sgst, iamt: 0, csamt: 0 } };
    });
    const entry = {
      nt_num: 'CN' + n.return_no, nt_dt: ddmmyyyy(n.date).replace(/\//g, '-'),
      inum: String(n.bill_no), idt: ddmmyyyy(n.orig_date).replace(/\//g, '-'),
      val: n.total, ntty: 'C', rsn: 'Sales Return', itms
    };
    if (n.cust_gstin) {
      if (!cdnrByCtin.has(n.cust_gstin)) cdnrByCtin.set(n.cust_gstin, []);
      cdnrByCtin.get(n.cust_gstin).push(entry);
    } else {
      cdnur.push(Object.assign({ pos }, entry));
    }
  });
  if (cdnrByCtin.size) file.cdnr = [...cdnrByCtin.entries()].map(([ctin, nt]) => ({ ctin, nt }));
  if (cdnur.length) file.cdnur = cdnur;
  const portalFileTotals = {
    taxable_value: round2(file.hsn.data.reduce((s, h) => s + h.txval, 0)),
    tax: round2(file.hsn.data.reduce((s, h) => s + h.camt + h.samt, 0))
  };
  // Headline figures are NET of this month's credit notes so GSTR-1
  // reconciles with the GST report; buckets/HSN stay gross (invoices).
  const netOutputGst = round2(outputGst - cnTaxTotal);
  const netHeadSplit = splitCgstSgst(netOutputGst);
  return {
    ...base, bills_count: Number(tot.c), total_sales: round2(tot.sales),
    taxable_value: round2(taxable - cnTaxableTotal), output_gst: netOutputGst,
    cgst: netHeadSplit.cgst, sgst: netHeadSplit.sgst,
    b2b, b2c, credit_notes: creditNotes, hsn_summary: hsnSummary, readiness,
    portal_file: file, portal_file_totals: portalFileTotals, invoices
  };
}

const GSTR1_NOTES = {
  en: 'This is a portal-ready file — filing happens on the GST portal, not inside the app. Inside the file, a bill discount is spread across its items, so the file\'s total GST can differ from the GST report total by the tax share of discounts; in months without discounts the two match exactly.',
  hi: 'ये portal के लिए तैयार file है — filing GST portal पर होगी, app के अंदर नहीं। File में बिल की छूट (discount) items पर बँटती है, इसलिए file का कुल GST ऊपर वाले GST report से छूट के tax हिस्से जितना अलग हो सकता है; बिना छूट वाले महीने में दोनों बिल्कुल बराबर होते हैं।',
  hg: 'Ye portal-ready file hai — filing GST portal par hogi, app ke andar nahi. File ke andar bill ki chhoot (discount) items par bant-ti hai, isliye file ka kul GST upar wale GST-report kul se chhoot ke tax hisse jitna alag ho sakta hai; bina chhoot wale mahine me dono bilkul barabar hote hain.'
};

app.get('/api/reports/gstr1', requireAuth, requireOwner, async (req, res) => {
  const range = monthFromQuery(req);
  if (!range) return res.status(400).json({ error: 'invalid month (use YYYY-MM)' });
  const g = await buildGstr1(req.user.business_id, range);
  if (g.gst_off) {
    // Same behavior as the GST report: GST off → plain zeros, no file.
    return res.json({
      month: g.month, from: g.from, to: g.to, gst_enabled: false, gstin: g.gstin,
      bills_count: 0, total_sales: 0, taxable_value: 0, output_gst: 0, cgst: 0, sgst: 0,
      b2b: { invoices: 0, value: 0, taxable_value: 0, tax: 0, cgst: 0, sgst: 0, igst: 0 },
      b2c: { invoices: 0, value: 0, taxable_value: 0, tax: 0, cgst: 0, sgst: 0, igst: 0 },
      credit_notes: { count: 0, total_value: 0, taxable_value: 0, tax: 0, cgst: 0, sgst: 0, notes: [] },
      hsn_summary: [], readiness: null, portal_file_totals: null,
      note: 'GST is OFF for this business — GSTR-1 does not apply.'
    });
  }
  const { portal_file, invoices, ...summary } = g;
  const gb = await getBusiness(req.user.business_id);
  res.json({ ...summary, note: GSTR1_NOTES[(gb && gb.language) || 'en'] || GSTR1_NOTES.en });
});

app.get('/api/reports/gstr1/download', requireAuth, requireOwner, async (req, res) => {
  const range = monthFromQuery(req);
  if (!range) return res.status(400).json({ error: 'invalid month (use YYYY-MM)' });
  const format = String(req.query.format || 'json').toLowerCase();
  if (!['json', 'csv'].includes(format)) return res.status(400).json({ error: 'format must be json or csv' });
  const g = await buildGstr1(req.user.business_id, range);
  if (g.gst_off) return res.status(400).json({ error: 'gst_not_enabled' });
  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="gstr1-${range.month}.json"`);
    return res.send(JSON.stringify(g.portal_file, null, 2));
  }
  // CSV = flat invoice register (the JSON above is the portal-upload file).
  const rows = g.invoices.map((x) => {
    const taxable = round2(x.gross.reduce((s, l) => s + l.taxable, 0));
    const s = splitCgstSgst(Number(x.inv.gst_amount));
    return [x.inv.bill_no, x.inv.date, x.inv.customer_name, x.b2b ? x.cust_gstin : '',
      x.b2b ? 'B2B' : 'B2C', taxable, s.cgst, s.sgst, 0, round2(x.inv.total)];
  });
  // Feature 2: credit notes (returns by RETURN date) as a clearly
  // labeled section under the invoice register.
  if (g.credit_notes && g.credit_notes.count > 0) {
    rows.push([]);
    rows.push(['Credit Notes (Sales Returns) — is mahine ki wapsi']);
    rows.push(['Credit Note No', 'Return Date', 'Original Bill No', 'Customer', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Credit Note Value']);
    g.credit_notes.notes.forEach((n) => {
      const s = splitCgstSgst(n.items.reduce((a, x) => a + x.tax, 0));
      rows.push(['CN' + n.return_no, n.date, n.bill_no, n.customer_name, n.taxable_value, s.cgst, s.sgst, 0, n.total]);
    });
  }
  return sendCsv(res, `gstr1-register-${range.month}.csv`,
    ['Bill No', 'Date', 'Customer', 'Customer GSTIN', 'Type', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Invoice Value'],
    rows);
});

// ---------- Monthly reports (owner-only) ----------
// Selected month's summary + the last 6 months side by side. Every figure
// comes from financeSummary — Net = Sale − COGS − Expenses, purchases are
// NOT an expense (unchanged Stage 4 formula).
app.get('/api/reports/monthly', requireAuth, requireOwner, async (req, res) => {
  const range = monthFromQuery(req);
  if (!range) return res.status(400).json({ error: 'invalid month (use YYYY-MM)' });
  const bizId = req.user.business_id;
  const summary = await financeSummary(bizId, range.from, range.to);
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const m = shiftMonth(range.month, -i);
    const parts = m.split('-').map(Number);
    const last = new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate();
    const fin = await financeSummary(bizId, m + '-01', m + '-' + String(last).padStart(2, '0'));
    months.push({
      month: m, sale_total: fin.sale_total, bills_count: fin.bills_count,
      expenses_total: fin.expenses_total, net_profit: fin.net_profit
    });
  }
  res.json({ month: range.month, from: range.from, to: range.to, summary, months });
});

// ---------- Global search (all roles, per-role sections) ----------
// One box for products / customers / suppliers / bill numbers, always
// scoped to the caller's own business. Sections follow the SAME access
// rules as their screens: customers + invoices need billing access,
// suppliers need stock access; products are name/price only (no buy
// price — cost data never leaks to billing-only staff here either).
app.get('/api/search', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const out = { query: q, products: [], customers: [], suppliers: [], invoices: [] };
  // Min 2 chars — except a pure number, which is a bill-number search
  // (bill #8 is a perfectly good query).
  if (q.length < 2 && !/^\d+$/.test(q)) return res.json(out);
  const bizId = req.user.business_id;
  const like = `%${q}%`;
  const canStock = req.user.role === 'owner' || ['all', 'stock'].includes(req.user.access);
  const canBilling = req.user.role === 'owner' || ['all', 'billing'].includes(req.user.access);
  if (canStock || canBilling) {
    const rows = await db.all(
      `SELECT id, name, unit, sell_price, stock_qty FROM products
       WHERE business_id = ? AND (name LIKE ? OR category LIKE ?) ORDER BY name ASC LIMIT 8`
    , bizId, like, like);
    out.products = rows.map((p) => ({
      id: p.id, name: p.name, unit: p.unit,
      sell_price: round2(p.sell_price), stock_qty: p.stock_qty
    }));
  }
  if (canBilling) {
    const crows = await db.all(
      `SELECT c.*, COALESCE(SUM(i.total),0) AS total_billed, COALESCE(SUM(i.paid_amount),0) AS total_received
       FROM customers c LEFT JOIN invoices i ON i.customer_id = c.id AND i.business_id = c.business_id AND i.cancelled_at IS NULL
       WHERE c.business_id = ? AND (c.name LIKE ? OR c.phone LIKE ?) GROUP BY c.id ORDER BY c.name ASC LIMIT 8`
    , bizId, like, like);
    out.customers = crows.map(publicCustomer);
    const irows = await db.all(
      `SELECT * FROM invoices WHERE business_id = ? AND (customer_name LIKE ? OR CAST(bill_no AS TEXT) LIKE ?)
       ORDER BY id DESC LIMIT 8`
    , bizId, like, like);
    out.invoices = irows.map(publicInvoice);
  }
  if (canStock) {
    const srows = await db.all(
      `SELECT s.*, COALESCE(SUM(p.total),0) AS total_purchased, COALESCE(SUM(p.paid_amount),0) AS total_paid
       FROM suppliers s LEFT JOIN purchases p ON p.supplier_id = s.id AND p.business_id = s.business_id
       WHERE s.business_id = ? AND (s.name LIKE ? OR s.phone LIKE ?) GROUP BY s.id ORDER BY s.name ASC LIMIT 8`
    , bizId, like, like);
    out.suppliers = srows.map(publicSupplier);
  }
  res.json(out);
});

// ---------- dashboard finance (owner-only): today's expense + profit ----------
app.get('/api/dashboard-finance', requireAuth, requireOwner, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const fin = await financeSummary(req.user.business_id, today, today);
  res.json({
    date: today,
    todays_expense: fin.expenses_total,
    todays_cogs: fin.cogs,
    todays_gross_profit: fin.gross_profit,
    todays_net_profit: fin.net_profit
  });
});

// ---------- dashboard summary (all roles; deliberately NO profit/cost data) ----------
app.get('/api/dashboard-summary', requireAuth, async (req, res) => {
  const bizId = req.user.business_id;
  const today = new Date().toISOString().slice(0, 10);
  const t = await db.get(
    `SELECT COALESCE(SUM(total),0) AS sale, COUNT(*) AS bills FROM invoices WHERE business_id = ? AND date = ? AND kind = 'sale' AND cancelled_at IS NULL`
  , bizId, today);
  // Feature 2: every sale/pending figure here is NET of returns — today's
  // sale minus today's returns (by return date), pending minus all
  // returns per customer (a net-credit customer drops off the list).
  const todayRet = await db.get(
    `SELECT COALESCE(SUM(total_amount),0) AS s FROM returns WHERE business_id = ? AND date = ?`
  , bizId, today);
  const balRows = await db.all(
    `SELECT customer_id, customer_name, COALESCE(SUM(total - paid_amount),0) AS bal
     FROM invoices WHERE business_id = ? AND cancelled_at IS NULL GROUP BY customer_id, customer_name`
  , bizId);
  const retRows = await db.all(
    `SELECT customer_id, COALESCE(SUM(total_amount),0) AS s FROM returns
     WHERE business_id = ? GROUP BY customer_id`
  , bizId);
  const retByCust = new Map(retRows.map((r) => [r.customer_id === null ? 'null' : String(r.customer_id), Number(r.s)]));
  const netPend = balRows.map((r) => ({
    customer_id: r.customer_id, customer_name: r.customer_name,
    pending: round2(Number(r.bal) - (retByCust.get(r.customer_id === null ? 'null' : String(r.customer_id)) || 0))
  }));
  const totalPending = round2(netPend.reduce((s, x) => s + x.pending, 0));
  const pendPositive = netPend.filter((x) => x.pending > 0)
    .sort((a, b) => b.pending - a.pending);
  const recent = await db.all(
    `SELECT * FROM invoices WHERE business_id = ? ORDER BY id DESC LIMIT 5`
  , bizId);
  // Last 7 days of sale totals (oldest → today), zero-filled. Sale figures
  // only — still no profit/cost/expense data in this all-roles payload.
  const weekDays = [];
  for (let i = 6; i >= 0; i--) weekDays.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  const wRows = await db.all(
    `SELECT date, COALESCE(SUM(total),0) AS t FROM invoices
     WHERE business_id = ? AND date >= ? AND date <= ? AND kind = 'sale' AND cancelled_at IS NULL GROUP BY date`
  , bizId, weekDays[0], today);
  const wRetRows = await db.all(
    `SELECT date, COALESCE(SUM(total_amount),0) AS t FROM returns
     WHERE business_id = ? AND date >= ? AND date <= ? GROUP BY date`
  , bizId, weekDays[0], today);
  const wMap = {};
  wRows.forEach((r) => { wMap[r.date] = round2(r.t); });
  wRetRows.forEach((r) => { wMap[r.date] = round2((wMap[r.date] || 0) - Number(r.t)); });
  res.json({
    date: today,
    todays_sale: round2(Number(t.sale) - Number(todayRet.s)), todays_bills: t.bills,
    total_pending_collection: totalPending,
    pending_customer_count: pendPositive.length,
    pending_customers: pendPositive.slice(0, 5).map((r) => ({
      customer_id: r.customer_id, customer_name: r.customer_name, pending: r.pending
    })),
    recent_bills: recent.map(publicInvoice),
    week_sales: weekDays.map((d) => ({ date: d, total: wMap[d] || 0 }))
  });
});

// =====================================================================
// ---------- Feature 3: Day-End Report (owner-only) ----------
// "Aaj ka hisab" — everything derived LIVE from the day's rows; nothing
// is stored and nothing is typed in by hand. Collections are the
// customer_payments RECEIVED that day (any bill, old udhaar included),
// split by the payment row's mode. new_credit_given = that day's sales
// − payments received against THAT day's bills, floored at 0, with the
// raw components exposed for audit.
// =====================================================================
async function dayEndReport(bizId, date) {
  const salesRow = await db.get(
    `SELECT COALESCE(SUM(total),0) AS s, COUNT(*) AS c FROM invoices
     WHERE business_id = ? AND date = ? AND kind = 'sale' AND cancelled_at IS NULL`
  , bizId, date);
  const retRow = await db.get(
    `SELECT COALESCE(SUM(total_amount),0) AS s, COUNT(*) AS c FROM returns
     WHERE business_id = ? AND date = ?`
  , bizId, date);
  const grossSale = round2(salesRow.s);
  const returnsTotal = round2(retRow.s);
  const collRows = await db.all(
    `SELECT mode, COALESCE(SUM(amount),0) AS s, COUNT(*) AS c FROM customer_payments
     WHERE business_id = ? AND date = ? GROUP BY mode`
  , bizId, date);
  const collections = { cash: 0, upi: 0, other: 0, total: 0, count: 0 };
  collRows.forEach((r) => {
    const m = String(r.mode || '').toLowerCase();
    const amt = round2(r.s);
    if (m === 'cash') collections.cash = round2(collections.cash + amt);
    else if (m === 'upi') collections.upi = round2(collections.upi + amt);
    else collections.other = round2(collections.other + amt);
    collections.total = round2(collections.total + amt);
    collections.count += Number(r.c);
  });
  const onToday = await db.get(
    `SELECT COALESCE(SUM(cp.amount),0) AS s FROM customer_payments cp
     JOIN invoices i ON i.id = cp.invoice_id AND i.business_id = cp.business_id
     WHERE cp.business_id = ? AND cp.date = ? AND i.date = ? AND i.kind = 'sale' AND i.cancelled_at IS NULL`
  , bizId, date, date);
  const expRow = await db.get(
    `SELECT COALESCE(SUM(amount),0) AS s, COUNT(*) AS c FROM expenses
     WHERE business_id = ? AND date = ?`
  , bizId, date);
  const supRow = await db.get(
    `SELECT COALESCE(SUM(amount),0) AS s, COUNT(*) AS c FROM supplier_payments
     WHERE business_id = ? AND date = ?`
  , bizId, date);
  const salesNet = round2(grossSale - returnsTotal);
  const paidOnTodaysBills = round2(onToday.s);
  return {
    date,
    sales: {
      bills_count: Number(salesRow.c), gross_total: grossSale,
      returns_total: returnsTotal, returns_count: Number(retRow.c),
      total: salesNet
    },
    collections,
    new_credit_given: Math.max(0, round2(salesNet - paidOnTodaysBills)),
    new_credit_raw: {
      sales_total: salesNet,
      payments_on_todays_bills: paidOnTodaysBills,
      difference: round2(salesNet - paidOnTodaysBills)
    },
    expenses: { total: round2(expRow.s), count: Number(expRow.c) },
    supplier_payments: { total: round2(supRow.s), count: Number(supRow.c) }
  };
}

// ---------- Monthly Business Report Card (owner-only) ----------
// All headline figures come from financeSummary() — the SAME math the
// monthly report uses (Net = Sale − COGS − Expenses, returns netted).
// Stock value is the CURRENT stock value (historical month-end stock
// is not reconstructed) and is labelled as such in the response.
const RC_MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
async function buildReportCard(bizId, range) {
  const { from, to } = range;
  const fin = await financeSummary(bizId, from, to);
  const retRow = await db.get(
    `SELECT COALESCE(SUM(total_amount),0) AS s FROM returns
     WHERE business_id = ? AND date >= ? AND date <= ?`
  , bizId, from, to);
  const topProducts = await db.all(
    `SELECT ii.product_name AS name, COALESCE(SUM(ii.qty),0) AS qty, COALESCE(SUM(ii.amount),0) AS amount
     FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id AND i.business_id = ii.business_id
     WHERE ii.business_id = ? AND i.date >= ? AND i.date <= ? AND i.kind = 'sale' AND i.cancelled_at IS NULL
     GROUP BY ii.product_name ORDER BY amount DESC LIMIT 3`
  , bizId, from, to);
  const pend = await pendingTotals(bizId);
  const topPending = await db.all(
    `SELECT c.name AS name, COALESCE(SUM(i.total),0) - COALESCE(SUM(i.paid_amount),0)
       - COALESCE((SELECT SUM(r.total_amount) FROM returns r WHERE r.customer_id = c.id AND r.business_id = c.business_id), 0) AS pending
     FROM customers c JOIN invoices i ON i.customer_id = c.id AND i.business_id = c.business_id AND i.cancelled_at IS NULL
     WHERE c.business_id = ? GROUP BY c.id, c.name HAVING pending > 0 ORDER BY pending DESC LIMIT 3`
  , bizId);
  const stockRow = await db.get(
    'SELECT COALESCE(SUM(stock_qty * buy_price),0) AS v FROM products WHERE business_id = ?', bizId);
  // Udhaar diya = this month's bills still unpaid (their total − what
  // was paid against them); Vasuli = ALL customer payments actually
  // received in the month (any bill). Both labelled plainly in the UI.
  const diyaRow = await db.get(
    `SELECT COALESCE(SUM(total - paid_amount),0) AS v FROM invoices
     WHERE business_id = ? AND date >= ? AND date <= ? AND kind = 'sale' AND cancelled_at IS NULL`
  , bizId, from, to);
  const vasuliRow = await db.get(
    `SELECT COALESCE(SUM(amount),0) AS v FROM customer_payments
     WHERE business_id = ? AND date >= ? AND date <= ?`
  , bizId, from, to);
  return {
    month: range.month, from, to,
    sale: fin.sale_total, cogs: fin.cogs, expenses: fin.expenses_total, net: fin.net_profit,
    bills_count: fin.bills_count, returns_total: round2(Number(retRow.s)),
    top_products: topProducts.map((r) => ({ name: r.name, qty: Number(r.qty), amount: round2(Number(r.amount)) })),
    top_pending_customers: topPending.map((r) => ({ name: r.name, pending: round2(Number(r.pending)) })),
    total_pending: pend.pending_collection,
    stock_value: round2(Number(stockRow.v)), stock_value_label: 'aaj ka stock value',
    udhaar_diya: round2(Number(diyaRow.v)),
    vasuli: round2(Number(vasuliRow.v))
  };
}

app.get('/api/reports/report-card', requireAuth, requireOwner, async (req, res) => {
  const range = monthFromQuery(req);
  if (!range) return res.status(400).json({ error: 'month must be YYYY-MM' });
  res.json({ report_card: await buildReportCard(req.user.business_id, range) });
});

// WhatsApp-ready summary of the Report Card — same wa.me pattern as
// the day-end link: goes to the SHOP's OWN number, manual send only.
app.get('/api/reports/report-card/whatsapp-link', requireAuth, requireOwner, async (req, res) => {
  const bizId = req.user.business_id;
  const range = monthFromQuery(req);
  if (!range) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const biz = await db.get('SELECT * FROM businesses WHERE id = ?', bizId);
  const phone = normalizePhone(biz && biz.phone);
  if (!phone) return res.status(400).json({ error: 'no_business_phone' });
  const rc = await buildReportCard(bizId, range);
  const mp = range.month.split('-').map(Number);
  const monthName = RC_MONTH_NAMES[mp[1] - 1] + ' ' + mp[0];
  const lines = [
    `*${biz.name} — Report Card*`,
    `Mahina: ${monthName}`,
    '',
    `Kul Sale: ${msgAmt(rc.sale)} (${rc.bills_count} bill)`,
    `Kharcha (maal + kharche): ${msgAmt(round2(rc.cogs + rc.expenses))}`,
    `*Munafa (Net): ${msgAmt(rc.net)}*`,
    `Abhi kul udhaar baaki: ${msgAmt(rc.total_pending)}`,
    `Stock value (aaj ka): ${msgAmt(rc.stock_value)}`
  ];
  if (rc.top_products.length) {
    lines.push('', '*Sabse zyada bike:*');
    rc.top_products.forEach((tp, i) => lines.push(`${i + 1}. ${tp.name} — ${msgAmt(tp.amount)}`));
  }
  const message = lines.join('\n');
  res.json({ phone, url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`, message });
});

app.get('/api/reports/day-end', requireAuth, requireOwner, async (req, res) => {
  const date = req.query.date ? String(req.query.date).trim() : new Date().toISOString().slice(0, 10);
  if (!isDateStr(date)) return res.status(400).json({ error: 'invalid date (use YYYY-MM-DD)' });
  res.json(await dayEndReport(req.user.business_id, date));
});

// Day-end WhatsApp share (manual wa.me to the shop's own number, the
// same { phone, url, message } shape as the other share links).
app.get('/api/reports/day-end/whatsapp-link', requireAuth, requireOwner, async (req, res) => {
  const bizId = req.user.business_id;
  const date = req.query.date ? String(req.query.date).trim() : new Date().toISOString().slice(0, 10);
  if (!isDateStr(date)) return res.status(400).json({ error: 'invalid date (use YYYY-MM-DD)' });
  const biz = await getBusiness(bizId);
  const phone = normalizePhone(req.query.phone !== undefined ? String(req.query.phone) : (biz ? biz.phone : ''));
  if (!phone) return res.status(400).json({ error: 'shop_phone_missing' });
  const bizName = (biz && biz.name) || 'BizYour';
  const hi = !!(biz && biz.language === 'hi');
  const hg = !!(biz && biz.language === 'hg');
  const r = await dayEndReport(bizId, date);
  let msg;
  if (hi) {
    msg = `🌙 *${bizName} — दिन का हिसाब* (${date})`;
    msg += `\nबिक्री: ₹${msgAmt(r.sales.total)} (${r.sales.bills_count} बिल)`;
    if (r.sales.returns_total > 0) msg += `\nवापसी: −₹${msgAmt(r.sales.returns_total)}`;
    msg += `\nवसूली: ₹${msgAmt(r.collections.total)} (Cash ₹${msgAmt(r.collections.cash)} · UPI ₹${msgAmt(r.collections.upi)}${r.collections.other > 0 ? ` · बाकी ₹${msgAmt(r.collections.other)}` : ''})`;
    msg += `\nनया उधार दिया: ₹${msgAmt(r.new_credit_given)}`;
    msg += `\nखर्चा: ₹${msgAmt(r.expenses.total)}`;
    msg += `\nसप्लायर को दिया: ₹${msgAmt(r.supplier_payments.total)}`;
  } else if (hg) {
    msg = `🌙 *${bizName} — Aaj ka hisaab* (${date})`;
    msg += `\nBikri: ₹${msgAmt(r.sales.total)} (${r.sales.bills_count} bill)`;
    if (r.sales.returns_total > 0) msg += `\nWapsi: −₹${msgAmt(r.sales.returns_total)}`;
    msg += `\nVasooli: ₹${msgAmt(r.collections.total)} (Cash ₹${msgAmt(r.collections.cash)} · UPI ₹${msgAmt(r.collections.upi)}${r.collections.other > 0 ? ` · Anya ₹${msgAmt(r.collections.other)}` : ''})`;
    msg += `\nNaya udhaar diya: ₹${msgAmt(r.new_credit_given)}`;
    msg += `\nKharcha: ₹${msgAmt(r.expenses.total)}`;
    msg += `\nSupplier ko diya: ₹${msgAmt(r.supplier_payments.total)}`;
  } else {
    msg = `🌙 *${bizName} — Day-End Report* (${date})`;
    msg += `\nSale: ₹${msgAmt(r.sales.total)} (${r.sales.bills_count} bills)`;
    if (r.sales.returns_total > 0) msg += `\nReturns: −₹${msgAmt(r.sales.returns_total)}`;
    msg += `\nCollections: ₹${msgAmt(r.collections.total)} (Cash ₹${msgAmt(r.collections.cash)} · UPI ₹${msgAmt(r.collections.upi)}${r.collections.other > 0 ? ` · Other ₹${msgAmt(r.collections.other)}` : ''})`;
    msg += `\nNew credit given: ₹${msgAmt(r.new_credit_given)}`;
    msg += `\nExpenses: ₹${msgAmt(r.expenses.total)}`;
    msg += `\nPaid to suppliers: ₹${msgAmt(r.supplier_payments.total)}`;
  }
  res.json({ phone, url: 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg), message: msg });
});

// =====================================================================
// ---------- SaaS Stage 3: Bharosa wala hisa ----------
// Backups+restore, CSV exports, audit/history, help, and the Stage B
// sync engine. Design choices where the plan left room:
//  * Snapshots are the SAME business-json shape as the cloud /api/backup
//    payload, stored in backup_snapshots — one approach that works in
//    BOTH engines (a .db file snapshot cannot exist in cloud mode).
//  * Sync identity = sync_ids uuid mapping (no ALTER of existing tables).
//  * Hub linking = the shop instance logs in to the hub with the shop's
//    own account (SYNC_HUB_EMAIL / SYNC_HUB_PASSWORD env) on every sync
//    run and uses that short-lived session token for push/pull.
// =====================================================================

// ---------- audit / history ----------
// Small helper called from route handlers after a successful change.
// Best-effort by design: an audit failure must never fail the real work.
async function auditLog(req, action, entity, entityId, summary) {
  try {
    if (!req || !req.user || !req.user.business_id) return;
    await db.run(
      `INSERT INTO audit_log (business_id, user_id, user_name, action, entity, entity_id, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    , req.user.business_id, req.user.id, req.user.name || '', action, entity,
      entityId === undefined || entityId === null ? '' : String(entityId),
      String(summary || '').slice(0, 300));
  } catch (e) { console.error('audit write failed:', e.message); }
}

function fmtAuditAmt(n) { return '₹' + String(round2(Number(n) || 0)); }

app.get('/api/audit', requireAuth, requireOwner, async (req, res) => {
  const bizId = req.user.business_id;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const total = await db.get('SELECT COUNT(*) AS c FROM audit_log WHERE business_id = ?', bizId);
  const rows = await db.all(
    `SELECT * FROM audit_log WHERE business_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`
  , bizId, limit, offset);
  res.json({
    total: Number(total.c),
    entries: rows.map((r) => ({
      id: r.id, user_id: r.user_id, user_name: r.user_name, action: r.action,
      entity: r.entity, entity_id: r.entity_id, summary: r.summary, created_at: r.created_at
    }))
  });
});

// ---------- backups: snapshots + restore ----------
// The export builder mirrors the cloud branch of GET /api/backup exactly
// (same TABLES walk), so a snapshot payload and a backup download agree.
async function buildBusinessExport(bizId) {
  const users = await db.all('SELECT * FROM users WHERE business_id = ?', bizId);
  const userIds = users.map((u) => u.id);
  const out = {
    app: 'Business OS v3', export_type: 'business-json', business_id: bizId,
    exported_at: new Date().toISOString(), tables: {}
  };
  for (const t of TABLES) {
    if (t === 'businesses') {
      const b = await getBusiness(bizId);
      out.tables.businesses = b ? [b] : [];
    } else if (t === 'users') {
      out.tables.users = users;
    } else if (t === 'sessions') {
      out.tables.sessions = userIds.length
        ? await db.all(`SELECT * FROM sessions WHERE user_id IN (${userIds.map(() => '?').join(',')})`, ...userIds)
        : [];
    } else {
      out.tables[t] = await db.all(`SELECT * FROM ${t} WHERE business_id = ?`, bizId);
    }
  }
  return out;
}

const AUTO_BACKUP_RETENTION = 7;
async function createSnapshot(bizId, kind) {
  const payload = await buildBusinessExport(bizId);
  const text = JSON.stringify(payload);
  const r = await db.run(
    `INSERT INTO backup_snapshots (business_id, kind, payload, size) VALUES (?, ?, ?, ?)`
  , bizId, kind, text, text.length);
  if (kind === 'auto') {
    // Retention: keep only the newest AUTO snapshots per business;
    // manual and pre-restore snapshots are never auto-deleted.
    const rows = await db.all(
      `SELECT id FROM backup_snapshots WHERE business_id = ? AND kind = 'auto' ORDER BY id DESC`
    , bizId);
    for (const old of rows.slice(AUTO_BACKUP_RETENTION)) {
      await db.run('DELETE FROM backup_snapshots WHERE id = ?', old.id);
    }
  }
  return await db.get('SELECT id, business_id, kind, size, created_at FROM backup_snapshots WHERE id = ?', r.lastInsertRowid);
}

// Auto-backup sweep: on boot and then hourly — a business gets a fresh
// auto snapshot when its newest auto snapshot is over 24h old (or none).
async function autoBackupSweep() {
  try {
    const bizs = await db.all('SELECT id FROM businesses');
    const cutoff = fmtTs(new Date(Date.now() - 24 * 3600 * 1000));
    for (const b of bizs) {
      const last = await db.get(
        `SELECT created_at FROM backup_snapshots WHERE business_id = ? AND kind = 'auto' ORDER BY id DESC LIMIT 1`
      , b.id);
      if (!last || String(last.created_at) < cutoff) await createSnapshot(b.id, 'auto');
    }
  } catch (e) { console.error('auto-backup sweep failed:', e.message); }
}

function publicSnapshot(s) {
  return { id: s.id, kind: s.kind, size: Number(s.size || 0), created_at: s.created_at };
}

app.get('/api/backups', requireAuth, requireOwner, async (req, res) => {
  const rows = await db.all(
    `SELECT id, business_id, kind, size, created_at FROM backup_snapshots
     WHERE business_id = ? ORDER BY id DESC LIMIT 50`
  , req.user.business_id);
  const lastAuto = rows.find((r) => r.kind === 'auto');
  res.json({
    snapshots: rows.map(publicSnapshot),
    auto_backup: { enabled: true, retention: AUTO_BACKUP_RETENTION, last_auto_at: lastAuto ? lastAuto.created_at : null }
  });
});

app.post('/api/backups', requireAuth, requireOwner, async (req, res) => {
  const snap = await createSnapshot(req.user.business_id, 'manual');
  res.status(201).json({ snapshot: publicSnapshot(snap) });
});

app.get('/api/backups/:id/download', requireAuth, requireOwner, async (req, res) => {
  const snap = await db.get(
    'SELECT * FROM backup_snapshots WHERE id = ? AND business_id = ?'
  , req.params.id, req.user.business_id);
  if (!snap) return res.status(404).json({ error: 'snapshot_not_found' });
  const stamp = String(snap.created_at || '').slice(0, 10).replace(/-/g, '');
  res.setHeader('Content-Disposition', `attachment; filename="business-os-backup-${stamp}-${snap.id}.json"`);
  return res.type('application/json').send(snap.payload);
});

// Restore replaces ONLY the restoring business's operational tables.
// Users and sessions are deliberately NOT restored (logins keep working
// exactly as they do now; password hashes in the payload are ignored),
// and the business row keeps its id — only its profile fields return.
// Sync uuid mappings are cleared: restored rows are a different lineage,
// and stale mappings would corrupt the next sync.
const RESTORE_COLUMNS = {
  suppliers: ['id', 'business_id', 'name', 'phone', 'city', 'created_at', 'updated_at', 'sync_status'],
  products: ['id', 'business_id', 'name', 'category', 'unit', 'buy_price', 'sell_price', 'gst_rate', 'hsn_code', 'stock_qty', 'low_stock_limit', 'created_at', 'updated_at', 'sync_status'],
  customers: ['id', 'business_id', 'name', 'phone', 'city', 'gstin', 'share_token', 'created_at', 'updated_at', 'sync_status'],
  purchases: ['id', 'business_id', 'supplier_id', 'bill_no', 'date', 'total', 'paid_amount', 'due_date', 'kind', 'created_at', 'updated_at', 'sync_status'],
  purchase_items: ['id', 'business_id', 'purchase_id', 'product_id', 'qty', 'buy_price', 'amount', 'created_at', 'updated_at', 'sync_status'],
  supplier_payments: ['id', 'business_id', 'purchase_id', 'amount', 'mode', 'date', 'created_at', 'updated_at', 'sync_status'],
  invoices: ['id', 'business_id', 'bill_no', 'customer_id', 'customer_name', 'date', 'subtotal', 'discount', 'gst_enabled', 'gst_amount', 'total', 'paid_amount', 'payment_mode', 'due_date', 'kind', 'cancelled_at', 'cancel_reason', 'created_at', 'updated_at', 'sync_status'],
  invoice_items: ['id', 'business_id', 'invoice_id', 'product_id', 'product_name', 'qty', 'sell_price', 'buy_price', 'gst_rate', 'amount', 'created_at', 'updated_at', 'sync_status'],
  customer_payments: ['id', 'business_id', 'invoice_id', 'amount', 'mode', 'date', 'created_at', 'updated_at', 'sync_status'],
  stock_movements: ['id', 'business_id', 'product_id', 'type', 'qty_change', 'ref_id', 'created_at', 'updated_at', 'sync_status'],
  expenses: ['id', 'business_id', 'title', 'category', 'amount', 'date', 'payment_mode', 'notes', 'created_at', 'updated_at', 'sync_status'],
  subscriptions: ['id', 'business_id', 'plan_code', 'trial_ends_at', 'paid_until', 'grace_days', 'blocked', 'created_at', 'updated_at', 'sync_status'],
  subscription_payments: ['id', 'business_id', 'plan_code', 'amount', 'method', 'reference', 'status', 'invoice_no', 'gateway_order_id', 'gateway_payment_id', 'period_from', 'period_to', 'created_at', 'updated_at', 'sync_status'],
  onboarding: ['id', 'business_id', 'dismissed', 'wa_done', 'created_at', 'updated_at', 'sync_status'],
  // Features 1+2: estimates + returns restore with the rest of the
  // business data (an older snapshot without these tables restores as
  // empty — payload.tables[t] is simply absent → zero rows).
  estimates: ['id', 'business_id', 'customer_id', 'customer_name', 'estimate_no', 'date', 'subtotal', 'discount', 'gst_enabled', 'gst_amount', 'total', 'status', 'converted_invoice_id', 'created_by', 'created_at', 'updated_at', 'sync_status'],
  estimate_items: ['id', 'business_id', 'estimate_id', 'product_id', 'product_name', 'qty', 'sell_price', 'buy_price', 'gst_rate', 'hsn_code', 'amount', 'created_at', 'updated_at', 'sync_status'],
  returns: ['id', 'business_id', 'invoice_id', 'customer_id', 'return_no', 'date', 'total_amount', 'gst_amount', 'reason', 'created_by', 'created_at', 'updated_at', 'sync_status'],
  return_items: ['id', 'business_id', 'return_id', 'invoice_item_id', 'product_id', 'qty', 'price', 'gst_rate', 'created_at', 'updated_at', 'sync_status']
};
const RESTORE_DELETE_ORDER = ['estimate_items', 'estimates', 'return_items', 'returns', 'invoice_items', 'customer_payments', 'stock_movements', 'purchase_items', 'supplier_payments', 'invoices', 'purchases', 'expenses', 'subscription_payments', 'subscriptions', 'onboarding', 'products', 'customers', 'suppliers'];
const RESTORE_INSERT_ORDER = ['suppliers', 'products', 'customers', 'purchases', 'purchase_items', 'supplier_payments', 'invoices', 'invoice_items', 'customer_payments', 'stock_movements', 'expenses', 'subscriptions', 'subscription_payments', 'onboarding', 'estimates', 'estimate_items', 'returns', 'return_items'];

function parseSnapshotPayload(snap) {
  let payload;
  try { payload = JSON.parse(snap.payload); } catch (e) { return null; }
  if (!payload || typeof payload !== 'object' || !payload.tables || typeof payload.tables !== 'object') return null;
  let any = false;
  for (const t of Object.keys(RESTORE_COLUMNS)) {
    if (payload.tables[t] !== undefined) {
      if (!Array.isArray(payload.tables[t])) return null;
      any = true;
    }
  }
  if (payload.tables.businesses !== undefined && !Array.isArray(payload.tables.businesses)) return null;
  return any ? payload : null;
}

app.post('/api/backups/:id/restore', requireAuth, requireOwner, async (req, res) => {
  const bizId = req.user.business_id;
  const snap = await db.get(
    'SELECT * FROM backup_snapshots WHERE id = ? AND business_id = ?'
  , req.params.id, bizId);
  if (!snap) return res.status(404).json({ error: 'snapshot_not_found' });
  const payload = parseSnapshotPayload(snap);
  if (!payload) return res.status(400).json({ error: 'invalid_backup' });

  // Safety first: snapshot the CURRENT state before touching anything,
  // so a mistaken restore can itself be undone.
  const pre = await createSnapshot(bizId, 'pre-restore');

  const counts = {};
  const tx = await db.begin();
  try {
    for (const t of RESTORE_DELETE_ORDER) {
      await tx.run(`DELETE FROM ${t} WHERE business_id = ?`, bizId);
    }
    await tx.run('DELETE FROM sync_ids WHERE business_id = ?', bizId);
    await tx.run('DELETE FROM sync_tombstones WHERE business_id = ?', bizId);
    for (const t of RESTORE_INSERT_ORDER) {
      const rows = payload.tables[t] || [];
      const cols = RESTORE_COLUMNS[t];
      let n = 0;
      for (const row of rows) {
        if (!row || !Number.isFinite(Number(row.id))) continue;
        const useCols = cols.filter((c) => row[c] !== undefined);
        const vals = useCols.map((c) => (c === 'business_id' ? bizId : row[c]));
        await tx.run(
          `INSERT INTO ${t} (${useCols.join(', ')}) VALUES (${useCols.map(() => '?').join(', ')})`
        , ...vals);
        n++;
      }
      counts[t] = n;
    }
    const brow = (payload.tables.businesses || [])[0];
    if (brow) {
      // Updates Stage A: UPI settings return with the profile ONLY when
      // the snapshot actually carries them — a pre-Stage-A backup must
      // not silently wipe a UPI ID the owner set after taking it.
      let bizSql = 'UPDATE businesses SET name=?, owner_name=?, phone=?, city=?, gst_enabled=?, gstin=?, language=?';
      const bizVals = [brow.name || '', brow.owner_name || '', brow.phone || '', brow.city || '',
        brow.gst_enabled ? 1 : 0, brow.gstin || '', (['hi', 'hg'].includes(brow.language) ? brow.language : 'en')];
      if (brow.upi_id !== undefined || brow.upi_payee_name !== undefined) {
        bizSql += ', upi_id=?, upi_payee_name=?';
        bizVals.push(brow.upi_id || '', brow.upi_payee_name || '');
      }
      bizSql += ' WHERE id=?';
      bizVals.push(bizId);
      await tx.run(bizSql, ...bizVals);
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    console.error('restore failed:', e);
    return res.status(500).json({ error: 'restore_failed' });
  }
  await auditLog(req, 'restore', 'backup', snap.id, `Backup restore kiya — snapshot #${snap.id} (${snap.kind}, ${snap.created_at}); pehle current data ka snapshot #${pre.id} bana`);
  res.json({ ok: true, restored: counts, pre_restore_snapshot_id: pre.id });
});

// ---------- CSV / Excel exports ----------
// Plain-number amounts (no ₹ sign) so Excel can sum them; a UTF-8 BOM
// + CRLF + standard quoting so the file opens cleanly in Excel.
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function sendCsv(res, filename, header, rows) {
  const body = '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(body);
}
const csvStamp = () => new Date().toISOString().slice(0, 10);

app.get('/api/export/products', requireAuth, requireStockAccess, async (req, res) => {
  const rows = await db.all('SELECT * FROM products WHERE business_id = ? ORDER BY name ASC', req.user.business_id);
  return sendCsv(res, `products-${csvStamp()}.csv`,
    ['Name', 'Category', 'Unit', 'Buy Price', 'Sell Price', 'GST %', 'Stock Qty', 'Low Stock Limit', 'Status'],
    rows.map((p) => [p.name, p.category, p.unit, round2(p.buy_price), round2(p.sell_price), p.gst_rate, p.stock_qty, p.low_stock_limit, productStatus(p)]));
});

app.get('/api/export/customers', requireAuth, requireBillingAccess, async (req, res) => {
  const rows = await db.all(
    `SELECT c.*, COALESCE(SUM(i.total),0) AS total_billed, COALESCE(SUM(i.paid_amount),0) AS total_received
     FROM customers c LEFT JOIN invoices i ON i.customer_id = c.id AND i.business_id = c.business_id AND i.cancelled_at IS NULL
     WHERE c.business_id = ? GROUP BY c.id ORDER BY c.name ASC`
  , req.user.business_id);
  return sendCsv(res, `customers-${csvStamp()}.csv`,
    ['Name', 'Phone', 'City', 'Total Billed', 'Total Received', 'Pending'],
    rows.map((c) => [c.name, c.phone, c.city, round2(c.total_billed), round2(c.total_received), round2(Number(c.total_billed) - Number(c.total_received))]));
});

app.get('/api/export/suppliers', requireAuth, requireStockAccess, async (req, res) => {
  const rows = await db.all(
    `SELECT s.*, COALESCE(SUM(p.total),0) AS total_purchased, COALESCE(SUM(p.paid_amount),0) AS total_paid
     FROM suppliers s LEFT JOIN purchases p ON p.supplier_id = s.id AND p.business_id = s.business_id
     WHERE s.business_id = ? GROUP BY s.id ORDER BY s.name ASC`
  , req.user.business_id);
  return sendCsv(res, `suppliers-${csvStamp()}.csv`,
    ['Name', 'Phone', 'City', 'Total Purchased', 'Total Paid', 'Pending'],
    rows.map((s) => [s.name, s.phone, s.city, round2(s.total_purchased), round2(s.total_paid), round2(Number(s.total_purchased) - Number(s.total_paid))]));
});

app.get('/api/export/sales', requireAuth, requireOwner, async (req, res) => {
  const rows = await db.all('SELECT * FROM invoices WHERE business_id = ? ORDER BY id ASC', req.user.business_id);
  return sendCsv(res, `sales-register-${csvStamp()}.csv`,
    ['Bill No', 'Date', 'Customer', 'Subtotal', 'Discount', 'GST Amount', 'Total', 'Paid', 'Pending', 'Payment Mode', 'Status'],
    rows.map((i) => [i.bill_no, i.date, i.customer_name, round2(i.subtotal), round2(i.discount), round2(i.gst_amount), round2(i.total), round2(i.paid_amount), round2(Number(i.total) - Number(i.paid_amount)), i.payment_mode || '', invoiceStatus(i)]));
});

app.get('/api/export/expenses', requireAuth, requireOwner, async (req, res) => {
  const rows = await db.all('SELECT * FROM expenses WHERE business_id = ? ORDER BY date ASC, id ASC', req.user.business_id);
  return sendCsv(res, `expenses-${csvStamp()}.csv`,
    ['Date', 'Title', 'Category', 'Amount', 'Payment Mode', 'Notes'],
    rows.map((e) => [e.date, e.title, e.category, round2(e.amount), e.payment_mode, e.notes]));
});

app.get('/api/export/purchases', requireAuth, requireOwner, async (req, res) => {
  const rows = await db.all(
    `SELECT p.*, s.name AS supplier_name FROM purchases p
     LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.business_id = p.business_id
     WHERE p.business_id = ? ORDER BY p.id ASC`
  , req.user.business_id);
  return sendCsv(res, `purchases-${csvStamp()}.csv`,
    ['Date', 'Supplier', 'Supplier Bill No', 'Total', 'Paid', 'Pending', 'Status'],
    rows.map((p) => [p.date, p.supplier_name || '', p.bill_no, round2(p.total), round2(p.paid_amount), round2(Number(p.total) - Number(p.paid_amount)), purchaseStatus(p)]));
});

// =====================================================================
// ---------- Updates Stage C: Data Import ----------
// Owner-only. The browser reads the chosen file as TEXT and posts it as
// JSON ({ content, duplicate }) — no multipart, no new dependency.
// Formats: CSV / TSV / TXT (delimiter auto-detected). .xlsx is NOT
// supported — node_modules has no xlsx parser and none may be faked;
// the UI honestly asks the owner to "Save As CSV" from Excel first.
// Flow: preview (parse + map + validate + duplicate check; writes
// NOTHING, takes NO snapshot) → commit (safety snapshot first, then ONE
// transaction; any failure imports nothing).
// =====================================================================
const IMPORT_TYPES = ['products', 'customers', 'suppliers'];
const IMPORT_MAX_ROWS = 5000;

// Delimited-text parser: quoted fields ("" = literal quote), commas
// inside quotes, UTF-8 BOM, CRLF / LF / CR endings, blank lines dropped.
// Delimiter: TAB when the first non-empty line has tabs and no commas
// (a TSV export), otherwise comma.
function parseDelimited(text) {
  let s = String(text === undefined || text === null ? '' : text);
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  const firstLine = s.split(/\r\n|\r|\n/).find((l) => l.trim() !== '') || '';
  const delim = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows = [];
  let row = [], field = '', inQ = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') { inQ = true; continue; }
    if (ch === delim) { pushField(); continue; }
    if (ch === '\r') { if (s[i + 1] === '\n') i++; pushRow(); continue; }
    if (ch === '\n') { pushRow(); continue; }
    field += ch;
  }
  if (field !== '' || row.length) pushRow();
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

// Header matching is case-insensitive on a punctuation-stripped form, so
// "Item Name", "ITEM_NAME" and "item-name" all land on the same synonym.
function normHeader(h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
const IMPORT_SYNONYMS = {
  products: {
    name: ['name', 'itemname', 'product', 'productname', 'item'],
    sell_price: ['salesprice', 'sellingprice', 'saleprice', 'sellprice', 'mrp', 'price', 'rate', 'salesrate'],
    buy_price: ['purchaseprice', 'buyprice', 'cost', 'costprice', 'buyingprice', 'purchaserate'],
    stock: ['openingstock', 'openingstockqty', 'stockqty', 'stock', 'qty', 'quantity', 'currentstock', 'openingqty', 'stockquantity'],
    gst_rate: ['gst', 'gstrate', 'gsttax', 'tax', 'taxrate'],
    unit: ['unit', 'uom', 'units'],
    category: ['category', 'group', 'itemgroup'],
    hsn_code: ['hsn', 'hsncode']
  },
  customers: {
    name: ['name', 'partyname', 'customer', 'customername', 'party'],
    phone: ['phone', 'mobile', 'contact', 'mobileno', 'phoneno', 'mobilenumber', 'phonenumber', 'contactno'],
    city: ['city', 'place'],
    gstin: ['gstin', 'gstno', 'gstnumber', 'gst'],
    opening: ['openingbalance', 'opening', 'udhaar', 'pending', 'balancedue', 'balance', 'amountdue', 'due', 'bakaya', 'baaki']
  },
  suppliers: {
    name: ['name', 'partyname', 'supplier', 'suppliername', 'party'],
    phone: ['phone', 'mobile', 'contact', 'mobileno', 'phoneno', 'mobilenumber', 'phonenumber', 'contactno'],
    city: ['city', 'place'],
    opening: ['openingbalance', 'opening', 'payable', 'openingpayable', 'pending', 'balancedue', 'balance', 'amountdue', 'due', 'dena', 'bakaya', 'baaki']
  }
};
const IMPORT_FIELD_LABEL = {
  name: 'Name', sell_price: 'Sell Price', buy_price: 'Buy Price', stock: 'Stock',
  gst_rate: 'GST %', unit: 'Unit', category: 'Category', hsn_code: 'HSN',
  phone: 'Phone', city: 'City', gstin: 'GSTIN', opening: 'Opening Balance'
};

// Indian-format tolerant number parse: "1,200", "₹500", "18%" all read.
// Returns { empty:true } | { error:true } | { value }.
function parseImportNum(raw) {
  if (raw === undefined || raw === null) return { empty: true };
  const s = String(raw).replace(/[₹,%\s]/g, '').replace(/,/g, '');
  if (s === '' || s === '-') return { empty: true };
  const n = Number(s);
  return Number.isFinite(n) ? { value: n } : { error: true };
}

// Parses one data row into typed values. Numeric fields come back as a
// number, or null when the cell was empty (create → default, update →
// leave unchanged). Returns { data } or { error: '<reason>' }.
function parseImportRow(type, get) {
  const name = get('name');
  if (!name) return { error: 'Naam (name) khali hai — ye row nahi chadegi' };
  const data = { name };
  const numField = (f) => {
    const raw = get(f);
    if (raw === undefined) return undefined; // column hi nahi hai
    const p = parseImportNum(raw);
    if (p.error) return { error: `${IMPORT_FIELD_LABEL[f]} number nahi hai: "${raw}"` };
    if (!p.empty && p.value < 0) return { error: `${IMPORT_FIELD_LABEL[f]} negative nahi ho sakta: "${raw}"` };
    return p.empty ? null : round2(p.value);
  };
  if (type === 'products') {
    for (const f of ['sell_price', 'buy_price', 'stock', 'gst_rate']) {
      const v = numField(f);
      if (v && v.error) return v;
      if (v !== undefined) data[f] = v;
    }
    if (get('unit') !== undefined) data.unit = get('unit') || null;
    if (get('category') !== undefined) data.category = get('category') || null;
    if (get('hsn_code') !== undefined) data.hsn_code = get('hsn_code') || null;
    return { data };
  }
  // customers / suppliers
  const phone = get('phone');
  if (phone !== undefined) {
    if (phone) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 13) {
        return { error: `Phone number galat lag raha hai: "${phone}"` };
      }
    }
    data.phone = phone || null;
  }
  if (get('city') !== undefined) data.city = get('city') || null;
  if (type === 'customers' && get('gstin') !== undefined) {
    data.gstin = get('gstin') ? get('gstin').toUpperCase() : null;
  }
  const op = numField('opening');
  if (op && op.error) return op;
  if (op !== undefined) data.opening = op === null ? 0 : op;
  return { data };
}

// Duplicate identity: products by name; parties by phone when a phone
// exists, else by name — always within the caller's own business.
function importDupKey(type, data) {
  if (type !== 'products' && data.phone) {
    const digits = String(data.phone).replace(/\D/g, '');
    if (digits) return 'p:' + digits;
  }
  return 'n:' + String(data.name || '').trim().toLowerCase();
}
async function loadImportKeys(bizId, type) {
  const set = new Set();
  if (type === 'products') {
    const rows = await db.all('SELECT name FROM products WHERE business_id = ?', bizId);
    rows.forEach((r) => set.add('n:' + String(r.name).trim().toLowerCase()));
  } else {
    const rows = await db.all(`SELECT name, phone FROM ${type} WHERE business_id = ?`, bizId);
    rows.forEach((r) => set.add(importDupKey(type, r)));
  }
  return set;
}

// Shared parse/map/validate pass for preview AND commit (commit never
// trusts a stale preview — it re-runs this on the posted content).
async function analyzeImport(bizId, type, content) {
  if (typeof content !== 'string' || !content.trim()) return { error: 'empty_file' };
  const rows = parseDelimited(content);
  if (!rows.length) return { error: 'empty_file' };
  return analyzeImportRows(bizId, type, rows);
}

// XLSX (Excel) import: the SAME pipeline as CSV/TSV — the workbook's
// first sheet becomes the same row grid (row 1 = header), so column
// mapping, validation, duplicate detection and row numbers (sheet row
// numbers) are identical. The xlsx package is required lazily so a
// missing install degrades to a clean error, never a boot crash; a
// malformed workbook returns 'invalid_xlsx', never a 500.
async function analyzeImportXlsx(bizId, type, base64) {
  let XLSX;
  try { XLSX = require('xlsx'); } catch (e) { return { error: 'xlsx_not_available' }; }
  let wb;
  try {
    const buf = Buffer.from(String(base64 || ''), 'base64');
    if (!buf.length) return { error: 'empty_file' };
    // A real .xlsx is a ZIP archive ('PK\x03\x04'). SheetJS alone would
    // happily parse a plain-text file as a one-column sheet, so check
    // the signature first — a renamed text/CSV file gets a clean
    // 'invalid_xlsx' instead of a confusing column error.
    if (!(buf[0] === 0x50 && buf[1] === 0x4B)) return { error: 'invalid_xlsx' };
    wb = XLSX.read(buf, { type: 'buffer' });
  } catch (e) { return { error: 'invalid_xlsx' }; }
  const sheetName = wb.SheetNames && wb.SheetNames[0];
  if (!sheetName) return { error: 'empty_file' };
  let rows;
  try {
    rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: true });
  } catch (e) { return { error: 'invalid_xlsx' }; }
  rows = (rows || []).map((r) => (r || []).map((c) => {
    if (c === null || c === undefined) return '';
    if (c instanceof Date) return c.toISOString().slice(0, 10);
    return String(c);
  }));
  while (rows.length && rows[rows.length - 1].every((c) => String(c).trim() === '')) rows.pop();
  if (!rows.length) return { error: 'empty_file' };
  return analyzeImportRows(bizId, type, rows);
}

async function analyzeImportRows(bizId, type, rows) {
  const headers = rows[0].map((h) => String(h || '').trim());
  const syn = IMPORT_SYNONYMS[type];
  const colOf = {}, labelOf = {};
  headers.forEach((h, idx) => {
    const nh = normHeader(h);
    if (!nh) return;
    for (const f of Object.keys(syn)) {
      if (colOf[f] === undefined && syn[f].includes(nh)) { colOf[f] = idx; labelOf[f] = h; break; }
    }
  });
  if (colOf.name === undefined) {
    return { error: 'name_column_not_found', headers };
  }
  const dataRows = rows.slice(1);
  if (dataRows.length > IMPORT_MAX_ROWS) {
    return { error: 'too_many_rows', limit: IMPORT_MAX_ROWS, rows_found: dataRows.length };
  }
  const existing = await loadImportKeys(bizId, type);
  const seenInFile = new Set();
  const valid = [], errors = [], duplicates = [];
  dataRows.forEach((cells, i) => {
    const rowNo = i + 2; // 1-based, header is row 1
    const get = (f) => colOf[f] === undefined ? undefined : String(cells[colOf[f]] === undefined || cells[colOf[f]] === null ? '' : cells[colOf[f]]).trim();
    const parsed = parseImportRow(type, get);
    if (parsed.error) { errors.push({ row: rowNo, reason: parsed.error }); return; }
    const key = importDupKey(type, parsed.data);
    const duplicate = existing.has(key) || seenInFile.has(key);
    if (duplicate) duplicates.push({ row: rowNo, name: parsed.data.name });
    else seenInFile.add(key);
    valid.push({ row: rowNo, key, duplicate, data: parsed.data });
  });
  return { mapping: labelOf, total_rows: dataRows.length, valid, errors, duplicates };
}

app.post('/api/import/:type/preview', requireAuth, requireOwner, async (req, res) => {
  const type = String(req.params.type || '');
  if (!IMPORT_TYPES.includes(type)) return res.status(404).json({ error: 'unknown_import_type' });
  const body0 = req.body || {};
  const a = body0.format === 'xlsx'
    ? await analyzeImportXlsx(req.user.business_id, type, body0.content)
    : await analyzeImport(req.user.business_id, type, body0.content);
  if (a.error) {
    return res.status(400).json({ error: a.error, headers: a.headers, limit: a.limit, rows_found: a.rows_found });
  }
  res.json({
    type,
    mapping: a.mapping,
    total_rows: a.total_rows,
    valid_count: a.valid.length,
    error_count: a.errors.length,
    duplicate_count: a.duplicates.length,
    errors: a.errors.slice(0, 100),
    duplicates: a.duplicates.slice(0, 20),
    sample: a.valid.slice(0, 20).map((v) => ({ row: v.row, duplicate: v.duplicate, ...v.data }))
  });
});

app.post('/api/import/:type/commit', requireAuth, requireOwner, async (req, res) => {
  const type = String(req.params.type || '');
  if (!IMPORT_TYPES.includes(type)) return res.status(404).json({ error: 'unknown_import_type' });
  const bizId = req.user.business_id;
  const body = req.body || {};
  const strategy = body.duplicate === 'update' ? 'update' : 'skip';
  const a = body.format === 'xlsx'
    ? await analyzeImportXlsx(bizId, type, body.content)
    : await analyzeImport(bizId, type, body.content);
  if (a.error) {
    return res.status(400).json({ error: a.error, headers: a.headers, limit: a.limit, rows_found: a.rows_found });
  }
  if (!a.valid.length) {
    return res.status(400).json({ error: 'no_valid_rows', errors: a.errors.slice(0, 100) });
  }

  // Safety first: a restorable snapshot of the CURRENT data, taken
  // before a single row changes (kind 'manual' — the snapshot schema's
  // CHECK allows only auto/manual/pre-restore).
  const snap = await createSnapshot(bizId, 'manual');
  const today = new Date().toISOString().slice(0, 10);
  let created = 0, updated = 0, skipped = 0, openingIgnored = 0;

  const tx = await db.begin();
  try {
    if (type === 'products') {
      const byKey = new Map();
      (await tx.all('SELECT * FROM products WHERE business_id = ?', bizId))
        .forEach((p) => byKey.set('n:' + String(p.name).trim().toLowerCase(), p));
      for (const v of a.valid) {
        const d = v.data;
        const cur = byKey.get(v.key);
        if (cur) {
          if (strategy === 'skip') { skipped++; continue; }
          const next = {
            category: d.category !== undefined && d.category !== null ? d.category : cur.category,
            unit: d.unit !== undefined && d.unit !== null ? d.unit : cur.unit,
            buy_price: d.buy_price !== undefined && d.buy_price !== null ? d.buy_price : cur.buy_price,
            sell_price: d.sell_price !== undefined && d.sell_price !== null ? d.sell_price : cur.sell_price,
            gst_rate: d.gst_rate !== undefined && d.gst_rate !== null ? d.gst_rate : cur.gst_rate,
            hsn_code: d.hsn_code !== undefined && d.hsn_code !== null ? d.hsn_code : (cur.hsn_code || '')
          };
          await tx.run(
            `UPDATE products SET category=?, unit=?, buy_price=?, sell_price=?, gst_rate=?, hsn_code=?,
               updated_at=datetime('now'), sync_status='local' WHERE id=? AND business_id=?`
          , next.category, next.unit, next.buy_price, next.sell_price, next.gst_rate, next.hsn_code, cur.id, bizId);
          // Stock on update: the file's figure is the dukaan's counted
          // stock — set it, and record the difference as an adjustment
          // movement (the same ledger every other stock change uses).
          if (d.stock !== undefined && d.stock !== null) {
            const delta = round2(Number(d.stock) - Number(cur.stock_qty));
            if (delta !== 0) {
              await tx.run(
                `UPDATE products SET stock_qty = ?, updated_at=datetime('now'), sync_status='local' WHERE id=? AND business_id=?`
              , Number(d.stock), cur.id, bizId);
              await tx.run(
                `INSERT INTO stock_movements (business_id, product_id, type, qty_change, ref_id) VALUES (?, ?, 'adjustment', ?, NULL)`
              , bizId, cur.id, delta);
            }
            cur.stock_qty = Number(d.stock);
          }
          Object.assign(cur, next);
          updated++;
          continue;
        }
        const r = await tx.run(
          `INSERT INTO products (business_id, name, category, unit, buy_price, sell_price, gst_rate, hsn_code, stock_qty, low_stock_limit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        , bizId, d.name, d.category || '', (d.unit || 'piece') || 'piece',
          d.buy_price || 0, d.sell_price || 0, d.gst_rate || 0, d.hsn_code || '',
          d.stock || 0, 5);
        const pid = r.lastInsertRowid;
        if (Number(d.stock) > 0) {
          await tx.run(
            `INSERT INTO stock_movements (business_id, product_id, type, qty_change, ref_id) VALUES (?, ?, 'opening', ?, NULL)`
          , bizId, pid, Number(d.stock));
        }
        byKey.set(v.key, {
          id: pid, name: d.name, category: d.category || '', unit: d.unit || 'piece',
          buy_price: d.buy_price || 0, sell_price: d.sell_price || 0,
          gst_rate: d.gst_rate || 0, hsn_code: d.hsn_code || '', stock_qty: d.stock || 0
        });
        created++;
      }
    } else {
      // customers / suppliers — identical shape, different balance home.
      const byKey = new Map();
      (await tx.all(`SELECT * FROM ${type} WHERE business_id = ?`, bizId))
        .forEach((p) => byKey.set(importDupKey(type, p), p));
      for (const v of a.valid) {
        const d = v.data;
        const cur = byKey.get(v.key);
        if (cur) {
          if (strategy === 'skip') { skipped++; continue; }
          await tx.run(
            type === 'customers'
              ? `UPDATE customers SET name=?, phone=?, city=?, gstin=?, updated_at=datetime('now'), sync_status='local' WHERE id=? AND business_id=?`
              : `UPDATE suppliers SET name=?, phone=?, city=?, updated_at=datetime('now'), sync_status='local' WHERE id=? AND business_id=?`
          , ...(type === 'customers'
            ? [d.name, d.phone !== undefined && d.phone !== null ? d.phone : cur.phone,
               d.city !== undefined && d.city !== null ? d.city : cur.city,
               d.gstin !== undefined && d.gstin !== null ? d.gstin : (cur.gstin || ''), cur.id, bizId]
            : [d.name, d.phone !== undefined && d.phone !== null ? d.phone : cur.phone,
               d.city !== undefined && d.city !== null ? d.city : cur.city, cur.id, bizId]));
          // An opening balance is applied ONCE, when the party is first
          // created — re-importing the same file must never double the
          // udhaar, so on update the opening figure is reported, not added.
          if (Number(d.opening) > 0) openingIgnored++;
          updated++;
          continue;
        }
        const r = type === 'customers'
          ? await tx.run(
              `INSERT INTO customers (business_id, name, phone, city, gstin) VALUES (?, ?, ?, ?, ?)`
            , bizId, d.name, d.phone || '', d.city || '', d.gstin || '')
          : await tx.run(
              `INSERT INTO suppliers (business_id, name, phone, city) VALUES (?, ?, ?, ?)`
            , bizId, d.name, d.phone || '', d.city || '');
        const partyId = r.lastInsertRowid;
        if (Number(d.opening) > 0) {
          // THE opening-balance row: a kind='opening' invoice/purchase
          // with no items and gst off. Every pending total in the app is
          // SUM(total − paid) over these tables, so the baaki shows up
          // everywhere automatically and is payable via the normal
          // POST /invoices/:id/payments (resp. /purchases/:id/payments)
          // flow — while kind='sale' filters keep it out of sales,
          // profit, GST and GSTR-1 (audited query by query).
          if (type === 'customers') {
            await tx.run(
              `INSERT INTO invoices (business_id, bill_no, customer_id, customer_name, date, subtotal, discount,
                 gst_enabled, gst_amount, total, paid_amount, payment_mode, kind)
               VALUES (?, 0, ?, ?, ?, ?, 0, 0, 0, ?, 0, NULL, 'opening')`
            , bizId, partyId, d.name, today, Number(d.opening), Number(d.opening));
          } else {
            await tx.run(
              `INSERT INTO purchases (business_id, supplier_id, bill_no, date, total, paid_amount, kind)
               VALUES (?, ?, 'Opening', ?, ?, 0, 'opening')`
            , bizId, partyId, today, Number(d.opening));
          }
        }
        byKey.set(v.key, {
          id: partyId, name: d.name, phone: d.phone || '', city: d.city || '', gstin: d.gstin || ''
        });
        created++;
      }
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    console.error('import commit failed:', e);
    return res.status(500).json({ error: 'import_failed' });
  }
  await auditLog(req, 'import', type, '',
    `Data import (${type}): ${created} naye, ${updated} update, ${skipped} skip, ${a.errors.length} galat rows · pehle snapshot #${snap.id} bana`);
  queueSync();
  res.json({
    ok: true, type, strategy,
    created, updated, skipped,
    error_count: a.errors.length, errors: a.errors.slice(0, 100),
    opening_ignored_on_update: openingIgnored,
    snapshot_id: snap.id
  });
});

// ---------- help / support ----------
// Support number + help video come from app_settings (super admin sets
// them). Nothing is invented: unset → the UI hides both.
app.get('/api/help', requireAuth, async (req, res) => {
  const wa = normalizePhone(await getSetting('support_whatsapp'));
  res.json({
    support_whatsapp: wa || '',
    support_link: wa ? 'https://wa.me/' + wa : '',
    help_video_url: await getSetting('help_video_url')
  });
});

// ---------- sync engine (Stage B plan) ----------
// Row identity across instances = sync_ids (table_name + local id → uuid),
// assigned lazily. Synced field sets deliberately EXCLUDE products.stock_qty
// (stock only ever travels as stock_movements; receivers recompute it) and
// exclude every engine-local column (id, business_id, created_at).
const SYNC_ORDER = ['suppliers', 'customers', 'products', 'expenses', 'purchases', 'purchase_items', 'supplier_payments', 'invoices', 'invoice_items', 'customer_payments', 'estimates', 'estimate_items', 'returns', 'return_items', 'stock_movements'];
const SYNC_FIELDS = {
  suppliers: ['name', 'phone', 'city'],
  customers: ['name', 'phone', 'city', 'share_token'],
  products: ['name', 'category', 'unit', 'buy_price', 'sell_price', 'gst_rate', 'low_stock_limit'],
  expenses: ['title', 'category', 'amount', 'date', 'payment_mode', 'notes'],
  purchases: ['bill_no', 'date', 'total', 'paid_amount', 'kind', 'due_date'],
  purchase_items: ['qty', 'buy_price', 'amount'],
  supplier_payments: ['amount', 'mode', 'date'],
  invoices: ['bill_no', 'customer_name', 'date', 'subtotal', 'discount', 'gst_enabled', 'gst_amount', 'total', 'paid_amount', 'payment_mode', 'kind', 'due_date', 'cancelled_at', 'cancel_reason'],
  invoice_items: ['product_name', 'qty', 'sell_price', 'buy_price', 'gst_rate', 'amount'],
  customer_payments: ['amount', 'mode', 'date'],
  estimates: ['customer_name', 'estimate_no', 'date', 'subtotal', 'discount', 'gst_enabled', 'gst_amount', 'total', 'status', 'created_by'],
  estimate_items: ['product_name', 'qty', 'sell_price', 'buy_price', 'gst_rate', 'hsn_code', 'amount'],
  returns: ['return_no', 'date', 'total_amount', 'gst_amount', 'reason', 'created_by'],
  return_items: ['qty', 'price', 'gst_rate'],
  stock_movements: ['type', 'qty_change']
};
const SYNC_FKS = {
  purchases: { supplier_id: 'suppliers' },
  purchase_items: { purchase_id: 'purchases', product_id: 'products' },
  supplier_payments: { purchase_id: 'purchases' },
  invoices: { customer_id: 'customers' },
  invoice_items: { invoice_id: 'invoices', product_id: 'products' },
  customer_payments: { invoice_id: 'invoices' },
  estimates: { customer_id: 'customers' },
  estimate_items: { estimate_id: 'estimates', product_id: 'products' },
  returns: { invoice_id: 'invoices', customer_id: 'customers' },
  return_items: { return_id: 'returns', invoice_item_id: 'invoice_items', product_id: 'products' },
  stock_movements: { product_id: 'products' }
};
const SYNC_MASTER_TABLES = new Set(['suppliers', 'customers', 'products', 'expenses']);
// Append-only rows are never overwritten — except the payment-progress
// column, which legitimately grows after the row first syncs.
const SYNC_UPDATABLE = { invoices: ['paid_amount', 'due_date', 'cancelled_at', 'cancel_reason'], purchases: ['paid_amount', 'due_date'], estimates: ['status'] };
const BUSINESS_SYNC_FIELDS = ['name', 'owner_name', 'phone', 'city', 'gst_enabled', 'gstin', 'language', 'upi_id', 'upi_payee_name'];

async function getMeta(key) {
  const r = await db.get('SELECT value FROM sync_meta WHERE key = ?', key);
  return r ? r.value : '';
}
async function setMeta(key, value) {
  const r = await db.get('SELECT id FROM sync_meta WHERE key = ?', key);
  if (r) await db.run(`UPDATE sync_meta SET value = ?, updated_at = datetime('now') WHERE key = ?`, String(value), key);
  else await db.run('INSERT INTO sync_meta (key, value) VALUES (?, ?)', key, String(value));
}
async function getDeviceId() {
  let d = await getMeta('device_id');
  if (!d) {
    d = 'dev-' + crypto.randomUUID().slice(0, 8);
    await setMeta('device_id', d);
  }
  return d;
}

async function syncUuidFor(bizId, table, rowId) {
  const ex = await db.get('SELECT uuid FROM sync_ids WHERE table_name = ? AND row_id = ?', table, rowId);
  if (ex) return ex.uuid;
  const uuid = crypto.randomUUID();
  try {
    await db.run('INSERT INTO sync_ids (business_id, table_name, row_id, uuid) VALUES (?, ?, ?, ?)', bizId, table, rowId, uuid);
    return uuid;
  } catch (e) {
    const again = await db.get('SELECT uuid FROM sync_ids WHERE table_name = ? AND row_id = ?', table, rowId);
    if (again) return again.uuid;
    throw e;
  }
}
async function syncRowIdFor(uuid) {
  const r = await db.get('SELECT row_id FROM sync_ids WHERE uuid = ?', uuid);
  return r ? Number(r.row_id) : null;
}
async function recordSyncConflict(bizId, table, uuid, summary, deviceId) {
  await db.run(
    `INSERT INTO sync_conflicts (business_id, table_name, uuid, summary, device_id) VALUES (?, ?, ?, ?, ?)`
  , bizId, table, uuid || '', String(summary || '').slice(0, 300), deviceId || '');
}

// Called from delete handlers BEFORE the row goes, so a deletion can be
// pushed later. No uuid yet (row never synced) → nothing to propagate.
async function recordTombstone(bizId, table, rowId) {
  try {
    const m = await db.get('SELECT uuid FROM sync_ids WHERE table_name = ? AND row_id = ?', table, rowId);
    if (!m) return;
    const ex = await db.get('SELECT id FROM sync_tombstones WHERE table_name = ? AND uuid = ?', table, m.uuid);
    if (!ex) {
      await db.run('INSERT INTO sync_tombstones (business_id, table_name, uuid, origin) VALUES (?, ?, ?, ?)', bizId, table, m.uuid, 'local');
    }
    await db.run('DELETE FROM sync_ids WHERE table_name = ? AND row_id = ?', table, rowId);
  } catch (e) { console.error('tombstone write failed:', e.message); }
}

async function recomputeStockFromMovements(bizId, productId) {
  const r = await db.get(
    'SELECT COALESCE(SUM(qty_change),0) AS s FROM stock_movements WHERE business_id = ? AND product_id = ?'
  , bizId, productId);
  const p = await db.get('SELECT stock_qty FROM products WHERE id = ? AND business_id = ?', productId, bizId);
  if (p && Number(p.stock_qty) !== Number(r.s)) {
    await db.run(
      `UPDATE products SET stock_qty = ?, updated_at = datetime('now') WHERE id = ? AND business_id = ?`
    , Number(r.s), productId, bizId);
  }
}

function syncFieldDiff(table, cur, fields) {
  return SYNC_FIELDS[table].filter((f) => String(cur[f] === null || cur[f] === undefined ? '' : cur[f]) !== String(fields[f] === null || fields[f] === undefined ? '' : fields[f]));
}

async function applyMasterRow(t, bizId, e, deviceId, res) {
  const existingId = await syncRowIdFor(e.uuid);
  if (existingId) {
    const cur = await db.get(`SELECT * FROM ${t} WHERE id = ? AND business_id = ?`, existingId, bizId);
    if (!cur) {
      // Stale mapping (row was restored/deleted locally) — drop and insert.
      await db.run('DELETE FROM sync_ids WHERE uuid = ?', e.uuid);
      return applyMasterRow(t, bizId, e, deviceId, res);
    }
    const diff = syncFieldDiff(t, cur, e.fields || {});
    if (!diff.length) {
      if (cur.sync_status !== 'synced') await db.run(`UPDATE ${t} SET sync_status = 'synced' WHERE id = ?`, cur.id);
      return cur.id;
    }
    if (String(e.updated_at || '') >= String(cur.updated_at || '')) {
      await recordSyncConflict(bizId, t, e.uuid,
        `${t}: doosri copy ne badla (${diff.join(', ')}) — last-write-wins se aayi hui value lagi`, deviceId);
      res.conflicts++;
      const cols = SYNC_FIELDS[t];
      await db.run(
        `UPDATE ${t} SET ${cols.map((c) => c + '=?').join(', ')}, updated_at = ?, sync_status = 'synced' WHERE id = ? AND business_id = ?`
      , ...cols.map((c) => e.fields[c]), e.updated_at, cur.id, bizId);
      res.applied++;
    } else {
      await recordSyncConflict(bizId, t, e.uuid,
        `${t}: purani sync copy aayi thi (${diff.join(', ')}) — is copy ki nayi value rakhi gayi (last-write-wins)`, deviceId);
      res.conflicts++;
    }
    return cur.id;
  }
  const cols = SYNC_FIELDS[t];
  const r = await db.run(
    `INSERT INTO ${t} (business_id, ${cols.join(', ')}, updated_at, sync_status)
     VALUES (?, ${cols.map(() => '?').join(', ')}, ?, 'synced')`
  , bizId, ...cols.map((c) => e.fields[c]), e.updated_at || fmtTs(new Date()));
  await db.run('INSERT INTO sync_ids (business_id, table_name, row_id, uuid) VALUES (?, ?, ?, ?)', bizId, t, r.lastInsertRowid, e.uuid);
  res.applied++;
  return r.lastInsertRowid;
}

async function applyAppendRow(t, bizId, e, deviceId, res, affectedProducts) {
  const existingId = await syncRowIdFor(e.uuid);
  if (existingId) {
    const cur = await db.get(`SELECT * FROM ${t} WHERE id = ? AND business_id = ?`, existingId, bizId);
    if (cur) {
      for (const f of (SYNC_UPDATABLE[t] || [])) {
        if (String(cur[f]) !== String(e.fields[f])) {
          await db.run(
            `UPDATE ${t} SET ${f} = ?, updated_at = ?, sync_status = 'synced' WHERE id = ? AND business_id = ?`
          , e.fields[f], e.updated_at || cur.updated_at, cur.id, bizId);
          res.applied++;
        }
      }
      return cur.id;
    }
    await db.run('DELETE FROM sync_ids WHERE uuid = ?', e.uuid);
  }
  // Resolve foreign keys through the uuid map; a missing parent means the
  // parent has not arrived yet — skip now, a later sync round retries.
  const fkVals = {};
  for (const [col, parent] of Object.entries(SYNC_FKS[t] || {})) {
    const fu = e.fks ? e.fks[col] : null;
    if (fu === null || fu === undefined) { fkVals[col] = null; continue; }
    const rid = await syncRowIdFor(fu);
    if (!rid) { res.skipped++; return null; }
    fkVals[col] = rid;
  }
  const fields = { ...(e.fields || {}) };
  if (t === 'invoices') {
    const clash = await db.get('SELECT id FROM invoices WHERE business_id = ? AND bill_no = ?', bizId, fields.bill_no);
    if (clash) {
      const mx = await db.get('SELECT COALESCE(MAX(bill_no),0) AS m FROM invoices WHERE business_id = ?', bizId);
      fields.bill_no = Number(mx.m) + 1;
      res.bill_map.push({ uuid: e.uuid, bill_no: fields.bill_no });
    }
  }
  // Same number-clash renumbering for estimate / return numbers (the
  // local display number moves; the uuid identity never changes).
  if (t === 'estimates' || t === 'returns') {
    const col = t === 'estimates' ? 'estimate_no' : 'return_no';
    const clash = await db.get(`SELECT id FROM ${t} WHERE business_id = ? AND ${col} = ?`, bizId, fields[col]);
    if (clash) {
      const mx = await db.get(`SELECT COALESCE(MAX(${col}),0) AS m FROM ${t} WHERE business_id = ?`, bizId);
      fields[col] = Number(mx.m) + 1;
    }
  }
  const cols = [...SYNC_FIELDS[t], ...Object.keys(SYNC_FKS[t] || {})];
  const vals = cols.map((c) => (SYNC_FIELDS[t].includes(c) ? fields[c] : fkVals[c]));
  if (t === 'stock_movements') {
    cols.push('ref_id');
    let refId = null;
    if (e.ref_uuid) {
      const rt = fields.type === 'sale' ? 'invoices' : fields.type === 'purchase' ? 'purchases' : null;
      if (rt) refId = await syncRowIdFor(e.ref_uuid);
    }
    vals.push(refId);
  }
  const r = await db.run(
    `INSERT INTO ${t} (business_id, ${cols.join(', ')}, updated_at, sync_status)
     VALUES (?, ${cols.map(() => '?').join(', ')}, ?, 'synced')`
  , bizId, ...vals, e.updated_at || fmtTs(new Date()));
  await db.run('INSERT INTO sync_ids (business_id, table_name, row_id, uuid) VALUES (?, ?, ?, ?)', bizId, t, r.lastInsertRowid, e.uuid);
  res.applied++;
  if (t === 'stock_movements' && fkVals.product_id) affectedProducts.add(fkVals.product_id);
  return r.lastInsertRowid;
}

async function applyTombstone(bizId, tb, deviceId, res, affectedProducts) {
  if (!SYNC_MASTER_TABLES.has(tb.table_name)) return;
  const ex = await db.get('SELECT id FROM sync_tombstones WHERE table_name = ? AND uuid = ?', tb.table_name, tb.uuid);
  if (!ex) {
    await db.run('INSERT INTO sync_tombstones (business_id, table_name, uuid, origin, acked) VALUES (?, ?, ?, ?, 1)', bizId, tb.table_name, tb.uuid, deviceId || 'remote');
  }
  const rowId = await syncRowIdFor(tb.uuid);
  if (!rowId) return;
  if (tb.table_name === 'products') {
    // Mirror the UI delete: the product's movements go with it.
    const moves = await db.all('SELECT id FROM stock_movements WHERE product_id = ? AND business_id = ?', rowId, bizId);
    for (const m of moves) await db.run('DELETE FROM sync_ids WHERE table_name = ? AND row_id = ?', 'stock_movements', m.id);
    await db.run('DELETE FROM stock_movements WHERE product_id = ? AND business_id = ?', rowId, bizId);
  }
  await db.run(`DELETE FROM ${tb.table_name} WHERE id = ? AND business_id = ?`, rowId, bizId);
  await db.run('DELETE FROM sync_ids WHERE uuid = ?', tb.uuid);
  res.applied++;
}

// Applies a push/pull payload to ONE business on this instance. Shared by
// the hub endpoints (payload from a shop) and the shop's pull handler
// (payload from the hub) — the rules are identical in both directions.
async function applySyncPayload(bizId, payload, deviceId) {
  const res = { applied: 0, skipped: 0, bill_map: [], conflicts: 0 };
  const affectedProducts = new Set();
  if (payload.business && payload.business.fields) {
    const cur = await getBusiness(bizId);
    const inc = payload.business;
    if (cur) {
      const diff = BUSINESS_SYNC_FIELDS.filter((f) => String(cur[f] === null ? '' : cur[f]) !== String(inc.fields[f] === null || inc.fields[f] === undefined ? '' : inc.fields[f]));
      if (diff.length && String(inc.updated_at || '') >= String(cur.updated_at || '')) {
        await recordSyncConflict(bizId, 'businesses', '', `Business settings doosri copy ne badli (${diff.join(', ')}) — last-write-wins`, deviceId);
        res.conflicts++;
        await db.run(
          `UPDATE businesses SET name=?, owner_name=?, phone=?, city=?, gst_enabled=?, gstin=?, language=?, upi_id=?, upi_payee_name=?, updated_at=?, sync_status='synced' WHERE id=?`
        , inc.fields.name || '', inc.fields.owner_name || '', inc.fields.phone || '', inc.fields.city || '',
          inc.fields.gst_enabled ? 1 : 0, inc.fields.gstin || '', (['hi', 'hg'].includes(inc.fields.language) ? inc.fields.language : 'en'),
          inc.fields.upi_id || '', inc.fields.upi_payee_name || '',
          inc.updated_at, bizId);
        res.applied++;
      } else if (diff.length && String(inc.updated_at || '') < String(cur.updated_at || '')) {
        await recordSyncConflict(bizId, 'businesses', '', `Business settings ki purani copy aayi thi (${diff.join(', ')}) — is copy ki value rakhi gayi`, deviceId);
        res.conflicts++;
      }
    }
  }
  const tables = payload.tables || {};
  for (const t of SYNC_ORDER) {
    for (const e of (tables[t] || [])) {
      if (!e || !e.uuid || !e.fields) { res.skipped++; continue; }
      if (SYNC_MASTER_TABLES.has(t)) await applyMasterRow(t, bizId, e, deviceId, res);
      else await applyAppendRow(t, bizId, e, deviceId, res, affectedProducts);
    }
  }
  for (const tb of (payload.tombstones || [])) {
    if (tb && tb.table_name && tb.uuid) await applyTombstone(bizId, tb, deviceId, res, affectedProducts);
  }
  for (const pid of affectedProducts) await recomputeStockFromMovements(bizId, pid);
  return res;
}

// Collects this instance's rows for one business in wire shape.
// mode 'push' → only rows still marked sync_status='local' (shop → hub).
// mode 'pull' → rows changed at/after `since` (hub → shop).
async function buildSyncPayload(bizId, mode, since) {
  const out = { business: null, tables: {} };
  const biz = await getBusiness(bizId);
  if (biz) {
    const wanted = mode === 'push' ? biz.sync_status === 'local' : (!since || String(biz.updated_at) >= String(since));
    if (wanted) {
      const fields = {};
      for (const f of BUSINESS_SYNC_FIELDS) fields[f] = biz[f];
      out.business = { fields, updated_at: biz.updated_at };
    }
  }
  for (const t of SYNC_ORDER) {
    const rows = mode === 'push'
      ? await db.all(`SELECT * FROM ${t} WHERE business_id = ? AND sync_status = 'local' ORDER BY id ASC`, bizId)
      : await db.all(`SELECT * FROM ${t} WHERE business_id = ? AND updated_at >= ? ORDER BY id ASC`, bizId, since || '');
    const arr = [];
    for (const row of rows) {
      const e = { uuid: await syncUuidFor(bizId, t, row.id), updated_at: row.updated_at, fields: {}, fks: {} };
      for (const f of SYNC_FIELDS[t]) e.fields[f] = row[f];
      for (const [col, parent] of Object.entries(SYNC_FKS[t] || {})) {
        e.fks[col] = row[col] === null || row[col] === undefined ? null : await syncUuidFor(bizId, parent, row[col]);
      }
      if (t === 'stock_movements') {
        e.ref_uuid = null;
        if (row.ref_id) {
          const rt = row.type === 'sale' ? 'invoices' : row.type === 'purchase' ? 'purchases' : null;
          if (rt) e.ref_uuid = await syncUuidFor(bizId, rt, row.ref_id);
        }
      }
      arr.push(e);
    }
    if (arr.length) out.tables[t] = arr;
  }
  return out;
}

// ---------- hub endpoints (any instance can be a hub) ----------
app.post('/api/sync/push', requireAuth, requireOwner, async (req, res) => {
  const body = req.body || {};
  const result = await applySyncPayload(req.user.business_id, body, body.device_id || '');
  res.json({ ok: true, ...result, server_time: fmtTs(new Date()) });
});

app.get('/api/sync/pull', requireAuth, requireOwner, async (req, res) => {
  const bizId = req.user.business_id;
  const since = String(req.query.since || '');
  const payload = await buildSyncPayload(bizId, 'pull', since);
  const tombs = since
    ? await db.all('SELECT table_name, uuid, created_at FROM sync_tombstones WHERE business_id = ? AND created_at >= ? ORDER BY id ASC', bizId, since)
    : await db.all('SELECT table_name, uuid, created_at FROM sync_tombstones WHERE business_id = ? ORDER BY id ASC', bizId);
  res.json({
    ok: true, server_time: fmtTs(new Date()),
    business: payload.business, tables: payload.tables,
    tombstones: tombs.map((t) => ({ table_name: t.table_name, uuid: t.uuid }))
  });
});

// ---------- shop side: run a sync against the configured hub ----------
const SYNC_HUB_URL = String(process.env.SYNC_HUB_URL || '').replace(/\/+$/, '');
let syncRunning = false;

async function hubLogin() {
  const r = await fetch(SYNC_HUB_URL + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.SYNC_HUB_EMAIL || '', password: process.env.SYNC_HUB_PASSWORD || '' })
  });
  if (!r.ok) throw new Error('hub_login_failed_' + r.status);
  const d = await r.json();
  if (!d.token) throw new Error('hub_login_no_token');
  return d.token;
}

async function runSync(bizId) {
  if (!SYNC_HUB_URL) return { configured: false };
  if (syncRunning) return { configured: true, already_running: true };
  syncRunning = true;
  try {
    const deviceId = await getDeviceId();
    const token = await hubLogin();
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    // 1) push local changes + pending tombstones
    const payload = await buildSyncPayload(bizId, 'push');
    const tombs = await db.all("SELECT table_name, uuid FROM sync_tombstones WHERE business_id = ? AND origin = 'local' AND acked = 0", bizId);
    const pr = await fetch(SYNC_HUB_URL + '/api/sync/push', {
      method: 'POST', headers,
      body: JSON.stringify({ device_id: deviceId, business: payload.business, tables: payload.tables, tombstones: tombs })
    });
    if (!pr.ok) throw new Error('hub_push_failed_' + pr.status);
    const pushRes = await pr.json();
    // hub-assigned final bill numbers come home first
    for (const m of (pushRes.bill_map || [])) {
      const rowId = await syncRowIdFor(m.uuid);
      if (rowId) {
        await db.run(`UPDATE invoices SET bill_no = ?, sync_status = 'synced' WHERE id = ? AND business_id = ?`, m.bill_no, rowId, bizId);
      }
    }
    // mark pushed rows synced — only when untouched since collection
    for (const t of Object.keys(payload.tables || {})) {
      for (const e of payload.tables[t]) {
        const rowId = await syncRowIdFor(e.uuid);
        if (rowId) {
          await db.run(`UPDATE ${t} SET sync_status = 'synced' WHERE id = ? AND business_id = ? AND updated_at = ?`, rowId, bizId, e.updated_at);
        }
      }
    }
    if (payload.business) {
      await db.run(`UPDATE businesses SET sync_status = 'synced' WHERE id = ? AND updated_at = ?`, bizId, payload.business.updated_at);
    }
    if (tombs.length) {
      await db.run("UPDATE sync_tombstones SET acked = 1 WHERE business_id = ? AND origin = 'local' AND acked = 0", bizId);
    }
    // 2) pull hub changes since the last pull
    const since = await getMeta('last_pull_ts');
    const plr = await fetch(SYNC_HUB_URL + '/api/sync/pull?since=' + encodeURIComponent(since), { headers });
    if (!plr.ok) throw new Error('hub_pull_failed_' + plr.status);
    const pullRes = await plr.json();
    const applied = await applySyncPayload(bizId, pullRes, 'hub');
    if (pullRes.server_time) await setMeta('last_pull_ts', pullRes.server_time);
    const now = fmtTs(new Date());
    await setMeta('last_sync_at', now);
    await setMeta('last_result', 'ok');
    return {
      configured: true, ok: true, device_id: deviceId,
      pushed: Object.values(payload.tables || {}).reduce((s, a) => s + a.length, 0),
      bill_map: pushRes.bill_map || [],
      pulled_applied: applied.applied, conflicts: (pushRes.conflicts || 0) + applied.conflicts,
      server_time: pullRes.server_time
    };
  } catch (e) {
    await setMeta('last_result', 'offline: ' + e.message).catch(() => {});
    return { configured: true, ok: false, error: 'hub_unreachable', detail: e.message };
  } finally {
    syncRunning = false;
  }
}

// Best-effort background sync after billing activity — never blocks or
// fails the business write that triggered it.
let syncTimer = null;
function queueSync() {
  if (!SYNC_HUB_URL) return;
  if (syncTimer) return;
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    try {
      const bizs = await db.all('SELECT id FROM businesses');
      for (const b of bizs) await runSync(b.id);
    } catch (e) { /* status endpoint reports the honest state */ }
  }, 3000);
  if (syncTimer.unref) syncTimer.unref();
}

app.post('/api/sync/run', requireAuth, requireOwner, async (req, res) => {
  if (!SYNC_HUB_URL) return res.status(400).json({ error: 'sync_not_configured' });
  const result = await runSync(req.user.business_id);
  res.json(result);
});

app.get('/api/sync/status', requireAuth, async (req, res) => {
  const bizId = req.user.business_id;
  let pending = 0;
  const byTable = {};
  for (const t of SYNC_ORDER) {
    const r = await db.get(`SELECT COUNT(*) AS c FROM ${t} WHERE business_id = ? AND sync_status = 'local'`, bizId);
    byTable[t] = Number(r.c);
    pending += Number(r.c);
  }
  const tomb = await db.get("SELECT COUNT(*) AS c FROM sync_tombstones WHERE business_id = ? AND origin = 'local' AND acked = 0", bizId);
  pending += Number(tomb.c);
  const conf = await db.get('SELECT COUNT(*) AS c FROM sync_conflicts WHERE business_id = ?', bizId);
  res.json({
    configured: !!SYNC_HUB_URL,
    hub_url: SYNC_HUB_URL || null,
    device_id: await getDeviceId(),
    pending_count: pending,
    pending_by_table: byTable,
    conflicts_count: Number(conf.c),
    last_sync_at: (await getMeta('last_sync_at')) || null,
    last_result: (await getMeta('last_result')) || null
  });
});

app.get('/api/sync/conflicts', requireAuth, requireOwner, async (req, res) => {
  const rows = await db.all(
    `SELECT * FROM sync_conflicts WHERE business_id = ? ORDER BY id DESC LIMIT 100`
  , req.user.business_id);
  res.json({
    conflicts: rows.map((r) => ({
      id: r.id, table_name: r.table_name, uuid: r.uuid, summary: r.summary,
      device_id: r.device_id, created_at: r.created_at
    }))
  });
});

// ---------- BizYour: Business Mart (B2B marketplace) ----------
// Lives in mart.js; registered here so it sits behind the subscription
// guard (read-only shops cannot post/quote/order) and before the 404.
require('./mart').registerMart(app, { db, requireAuth, requireOwner, auditLog, round2, validNum, queueSync });

// ---------- Stage 6: API fallbacks ----------
// Unknown /api/* routes get a JSON 404 (never the SPA HTML).
app.use('/api', async (req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// ---------- Feature 4: public hisab page (served by the BACKEND) ----------
// Deliberately NOT part of the SPA: the frontend may be hosted on
// Vercel while this page + its JSON live on the API origin, so the link
// the owner shares always points at the backend. Mobile-first, inline
// CSS/JS, values rendered via textContent only (no HTML injection from
// shop/customer names). noindex: a customer's hisab is not for search.
const HISAB_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/brand/favicon-32.png" sizes="32x32" type="image/png">
<title>Mera Hisab</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background: #f4f6fb; color: #16213a; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 18px 14px 30px; }
  .shop { font-size: 13px; letter-spacing: .04em; text-transform: uppercase; color: #5b6b8c; text-align: center; }
  h1 { font-size: 22px; text-align: center; margin: 6px 0 2px; }
  .sub { text-align: center; color: #5b6b8c; font-size: 13px; margin-bottom: 16px; }
  .baaki { background: #fff; border: 1px solid #e3e8f4; border-radius: 14px; padding: 16px; text-align: center; margin-bottom: 14px; }
  .baaki .lbl { font-size: 13px; color: #5b6b8c; }
  .baaki .amt { font-size: 34px; font-weight: 800; color: #b42318; }
  .baaki .amt.clear { color: #12805c; }
  .card { background: #fff; border: 1px solid #e3e8f4; border-radius: 14px; padding: 6px 14px; margin-bottom: 14px; }
  .card h2 { font-size: 15px; margin: 10px 0 4px; }
  .row { display: flex; justify-content: space-between; gap: 10px; padding: 9px 0; border-top: 1px solid #eef1f8; font-size: 14px; }
  .row:first-of-type { border-top: none; }
  .row .meta { color: #5b6b8c; font-size: 12px; }
  .row .r { text-align: right; white-space: nowrap; }
  .bal { color: #b42318; font-weight: 700; }
  .paid { color: #12805c; font-weight: 700; }
  .foot { text-align: center; color: #8494b3; font-size: 12px; margin-top: 18px; }
  .err { background: #fff; border: 1px solid #f0d4d0; color: #b42318; border-radius: 14px; padding: 18px; text-align: center; font-size: 15px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="shop" id="shopName">…</div>
  <h1 id="custName">…</h1>
  <div class="sub" id="subLine"></div>
  <div id="content"><div class="sub">…</div></div>
  <div class="foot" id="foot"></div>
</div>
<script>
(function () {
  var token = location.pathname.split('/').filter(Boolean).pop() || '';
  function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  var S = {
    en: { sub: 'Bills and payments — live account', title: 'Account', due: 'Total balance (to pay)', credit: 'You have a credit', clear: 'Account is clear', bills: 'Bills', noBills: 'No bills', opening: 'Previous balance (Opening Balance)', bal: 'Balance ', paid: 'Fully paid', pays: 'Payments (made by you)', noPays: 'No payments yet', foot: function (n) { return 'This account is live from ' + n + "'s app"; }, off: 'Link is off', offMsg: 'This account link no longer works. Please ask the shop for a new link.' },
    hi: { sub: 'बिल और पेमेंट — लाइव हिसाब', title: 'हिसाब', due: 'कुल बाकी (देना है)', credit: 'आपका जमा है', clear: 'हिसाब साफ़ है', bills: 'बिल', noBills: 'कोई बिल नहीं है', opening: 'पिछला बाकी (Opening Balance)', bal: 'बाकी ', paid: 'पूरा मिला', pays: 'पेमेंट (जो आपने दिए)', noPays: 'अभी कोई पेमेंट नहीं है', foot: function (n) { return 'ये हिसाब ' + n + ' के app से लाइव है'; }, off: 'लिंक बंद है', offMsg: 'ये हिसाब लिंक अब काम नहीं कर रहा। दुकान से नया लिंक माँगें।' },
    hg: { sub: 'Bills aur payments — live hisaab', title: 'Hisaab', due: 'Kul baaki (dena hai)', credit: 'Aapka credit hai', clear: 'Hisaab clear hai', bills: 'Bills', noBills: T.noBills, opening: T.opening, bal: 'Baaki ', paid: 'Poora mila', pays: T.pays, noPays: T.noPays, foot: function (n) { return 'Ye hisaab ' + n + ' ke app se live hai'; }, off: 'Link band hai', offMsg: 'Ye hisaab link ab kaam nahi kar raha. Dukaan se naya link maangein.' }
  };
  var T = S.en;
  fetch('/api/public/hisab/' + encodeURIComponent(token))
    .then(function (r) { if (!r.ok) throw new Error('nf'); return r.json(); })
    .then(function (d) {
      T = S[d.business.language] || S.en;
      document.documentElement.lang = d.business.language === 'hi' ? 'hi' : 'en';
      document.getElementById('subLine').textContent = T.sub;
      document.getElementById('shopName').textContent = d.business.name;
      document.getElementById('custName').textContent = d.customer.name;
      document.title = d.customer.name + ' — ' + T.title + ' · ' + d.business.name;
      var c = document.getElementById('content');
      c.textContent = '';
      var b = el('div', 'baaki');
      b.appendChild(el('div', 'lbl', d.pending > 0 ? T.due : (d.pending < 0 ? T.credit : T.clear)));
      var amt = el('div', 'amt' + (d.pending <= 0 ? ' clear' : ''), inr(Math.abs(d.pending)));
      b.appendChild(amt);
      c.appendChild(b);
      var bills = el('div', 'card');
      bills.appendChild(el('h2', null, T.bills));
      if (!d.bills.length) bills.appendChild(el('div', 'row', T.noBills));
      d.bills.forEach(function (x) {
        var row = el('div', 'row');
        var left = el('div');
        left.appendChild(el('div', null, (x.kind === 'opening' ? T.opening : 'Bill #' + x.bill_no)));
        left.appendChild(el('div', 'meta', x.date));
        var right = el('div', 'r');
        right.appendChild(el('div', null, inr(x.total)));
        right.appendChild(el('div', 'meta', x.balance > 0 ? '' : ''));
        var st = el('div', x.balance > 0 ? 'bal' : 'paid', x.balance > 0 ? T.bal + inr(x.balance) : T.paid);
        right.appendChild(st);
        row.appendChild(left); row.appendChild(right);
        bills.appendChild(row);
      });
      c.appendChild(bills);
      var pays = el('div', 'card');
      pays.appendChild(el('h2', null, T.pays));
      if (!d.payments.length) pays.appendChild(el('div', 'row', T.noPays));
      d.payments.forEach(function (p) {
        var row = el('div', 'row');
        var left = el('div');
        left.appendChild(el('div', null, p.mode || 'Cash'));
        left.appendChild(el('div', 'meta', p.date));
        row.appendChild(left);
        row.appendChild(el('div', 'r paid', inr(p.amount)));
        pays.appendChild(row);
      });
      c.appendChild(pays);
      document.getElementById('foot').textContent = T.foot(d.business.name);
    })
    .catch(function () {
      document.getElementById('shopName').textContent = '';
      document.getElementById('custName').textContent = T.off;
      var c = document.getElementById('content');
      c.textContent = '';
      c.appendChild(el('div', 'err', T.offMsg));
    });
})();
</script>
</body>
</html>`;

app.get('/hisab/:token', async (req, res) => {
  const token = String(req.params.token || '');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!/^[a-f0-9]{48}$/.test(token)) return res.status(404).type('html').send('Link not found');
  res.type('html').send(HISAB_PAGE_HTML);
});

// ---------- fallback: SPA ----------
app.get(/^\/(?!api\/).*/, async (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Final error handler: JSON 500, no stack traces in the response
// (the stack is logged on the server only).
app.use((err, req, res, next) => {
  console.error('server error:', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'server_error' });
});

// ---------- SaaS Stage 2 boot seed ----------
// Idempotent, runs on every boot: (1) the two plans exist with price 0 =
// "not set" (the founder has NOT decided pricing — the super admin sets
// real prices from the admin panel; nothing is hard-coded here);
// (2) the DILIGENCE super admin exists when SUPER_ADMIN_* env is set (its
// password follows the env value); (3) every pre-existing business gets
// its migration trial (ensureSubscription is a no-op once a row exists).
async function ensureSaaSBoot() {
  const planSeeds = [
    { code: 'monthly', name: 'Monthly', duration_days: 30 },
    { code: 'yearly', name: 'Yearly', duration_days: 365 }
  ];
  for (const p of planSeeds) {
    const ex = await db.get('SELECT id FROM plans WHERE code = ?', p.code);
    if (!ex) {
      await db.run(
        `INSERT INTO plans (code, name, duration_days, price, grace_days) VALUES (?, ?, ?, 0, 7)`
      , p.code, p.name, p.duration_days);
    }
  }
  const adminEmail = String(process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPass = String(process.env.SUPER_ADMIN_PASSWORD || '');
  if (adminEmail && adminPass) {
    const ex = await db.get('SELECT * FROM platform_admins WHERE email = ?', adminEmail);
    if (!ex) {
      await db.run(
        `INSERT INTO platform_admins (name, email, password_hash) VALUES ('DILIGENCE Admin', ?, ?)`
      , adminEmail, bcrypt.hashSync(adminPass, 10));
    } else if (!bcrypt.compareSync(adminPass, ex.password_hash)) {
      await db.run(
        `UPDATE platform_admins SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`
      , bcrypt.hashSync(adminPass, 10), ex.id);
    }
  }
  const bizs = await db.all('SELECT id FROM businesses');
  for (const b of bizs) await ensureSubscription(b.id);
}

// ---------- boot: init the data layer (creates schema), then listen ----------
db.init().then(async () => {
  await ensureSaaSBoot();
  // SaaS Stage 3 jobs: auto-backup sweep on boot + hourly (a snapshot is
  // taken when the newest auto one is >24h old, retention 7), and — only
  // when this instance is a syncing shop — a first sync shortly after
  // boot plus the ~2-minute auto-sync from the Stage B plan.
  autoBackupSweep();
  const bkTimer = setInterval(autoBackupSweep, 3600 * 1000);
  if (bkTimer.unref) bkTimer.unref();
  if (SYNC_HUB_URL) {
    setTimeout(queueSync, 5000);
    const syTimer = setInterval(queueSync, 120 * 1000);
    if (syTimer.unref) syTimer.unref();
  }
  app.listen(PORT, () => {
    console.log(`BizYour (Workspace + Business Mart) running at http://localhost:${PORT} — mode: ${db.mode}, db: ${db.engine}`);
  });
}).catch((e) => {
  console.error('Database init failed:', e);
  process.exit(1);
});
