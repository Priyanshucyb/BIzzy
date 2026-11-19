// Business OS v2 — frontend logic (vanilla JS, served by the backend)
'use strict';

const $ = (id) => document.getElementById(id);
let token = localStorage.getItem('bos_token') || null;
let me = null; // { user, business }
let setupLang = 'en';
let setLangSel = 'en';

// ---------- server connection banner (Stage 6) ----------
// The whole app talks only to the local server on this computer. If that
// server is not running, fetch() throws — show ONE clear banner instead of
// silent/blank screens. Any successful call hides it again.
function showConnBanner() { const b = $('connBanner'); if (b) b.classList.remove('hidden'); }
function hideConnBanner() { const b = $('connBanner'); if (b) b.classList.add('hidden'); }
const connBannerCloseBtn = $('connBannerClose');
if (connBannerCloseBtn) connBannerCloseBtn.addEventListener('click', hideConnBanner);

// ---------- API base (split deploy: frontend on Vercel, backend on Render) ----------
// frontend/config.js sets window.BOS_API_BASE. Empty (local / single-service
// deploy) → requests stay relative to this origin, exactly as before. Set →
// every API call goes to that backend. A trailing slash in the configured
// value is stripped here so paths can always start with '/api/...'.
function apiBase() {
  const b = String(window.BOS_API_BASE || '');
  return b.endsWith('/') ? b.slice(0, -1) : b;
}
function apiUrl(path) { return apiBase() + path; }

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    showConnBanner();
    throw Object.assign(new Error('server_unreachable'), { status: 0 });
  }
  hideConnBanner();
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty */ }
  if (!res.ok) throw Object.assign(new Error(data.error || 'request_failed'), { status: res.status, data });
  return data;
}

function showErr(id, msg) { const e = $(id); if (!e) return; e.textContent = msg; e.style.display = 'block'; }
function hideErr(id) { const e = $(id); if (e) e.style.display = 'none'; }
function friendly(err) {
  const map = {
    'invalid email or password': 'Wrong email or password. / ईमेल या पासवर्ड गलत है।',
    'email already registered': 'This email is already registered. Log in instead. / ये ईमेल पहले से registered है।',
    'password must be at least 6 characters': 'Password must be at least 6 characters. / पासवर्ड कम से कम 6 अक्षरों का हो।',
    'owner_only': 'Only the owner can do this. / ये सिर्फ़ owner कर सकता है।',
    'email_not_verified': 'Email not verified yet. Enter the 6-digit code sent to your email. / ईमेल अभी verify नहीं हुआ — ईमेल पर भेजा 6 अंकों का code डालो।',
    'email_pending_verification': 'This email is waiting for verification. Enter the code sent to it, or resend it. / ये ईमेल verification का इंतज़ार कर रहा है — भेजा हुआ code डालो, या फिर से भेजो।',
    'invalid_otp': 'Wrong code. Check and try again. / Code गलत है, देखकर फिर डालो।',
    'otp_expired': 'This code has expired (10 minutes). Resend a new code. / ये code expire हो गया (10 मिनट) — नया code भेजो।',
    'otp_not_found': 'No active code for this email. Resend a new code. / इस ईमेल के लिए कोई active code नहीं — नया code भेजो।',
    'otp_attempts_exceeded': 'Too many wrong attempts. Resend a new code. / बहुत ज़्यादा गलत कोशिशें — नया code भेजो।',
    'otp_resend_too_soon': 'Wait a few seconds before resending the code. / Code फिर भेजने से पहले कुछ seconds रुको।',
    'not_pending_verification': 'This account is already verified. Just log in. / ये खाता पहले से verified है — बस लॉगिन करो।',
    'account_not_found': 'No account with this email. / इस ईमेल से कोई खाता नहीं है।',
    'subscription_expired': 'Your subscription has ended — the app is read-only. Renew from Settings → Subscription & plan. / तुम्हारा subscription ख़त्म हो गया — app सिर्फ़ देखने के लिए है। Settings → Subscription & plan से renew करो।',
    'gateway_not_configured': 'Online card/UPI payment is not live yet — please pay by UPI and submit the claim below. / Online payment अभी live नहीं है — UPI से payment करके नीचे claim भेजो।',
    'plan_price_not_set': 'Plan price is not set yet. / Plan की price अभी set नहीं है।',
    'invalid_upi_id': 'UPI ID sahi nahi lag raha — aise hona chahiye: yourname@okhdfc / UPI ID format galat hai.',
    'top_plan_required': 'Ye feature (E-Way Bill / E-Invoice file) sirf top plan me hai. Plan upgrade karne par khul jayega. / This is a top-plan feature — upgrade to unlock.',
    'gst_not_enabled': 'Is business ke liye GST OFF hai — pehle Settings me GST on karo. / GST is OFF for this business.',
    'missing_fields': 'File banane ke liye kuch data missing hai — apna GSTIN (Settings) aur products ke HSN code check karo. / Some data is missing — check your GSTIN (Settings) and product HSN codes.',
    'empty_file': 'File khali hai ya padhi nahi gayi — sahi CSV file chunein. / The file is empty or unreadable — pick a proper CSV file.',
    'name_column_not_found': 'File me Name wala column nahi mila — pehli row me column ke naam hone chahiye (jaise Item Name, Party Name). / No Name column found — the first row must hold column names (like Item Name, Party Name).',
    'too_many_rows': 'File bahut badi hai — ek baar me zyada se zyada 5000 rows import hoti hain. File ko do hisso me baant kar lao. / Too many rows — at most 5000 rows per import. Split the file and import in parts.',
    'no_valid_rows': 'Ek bhi sahi row nahi mili — neeche wali galtiyan dekhkar file theek karein. / No valid rows found — fix the errors shown and try again.',
    'import_failed': 'Import nahi ho paya — kuch change nahi hua hai. / The import failed — nothing was changed.',
    'already_converted': 'Ye estimate pehle hi bill ban chuka hai. / This estimate has already been converted to a bill.',
    'invalid due_date': 'Due date sahi nahi hai — sahi date chuno. / The due date is not valid — pick a proper date.',
    'link_not_found': 'Ye hisab link band hai ya galat hai. / This hisab link is off or wrong.',
    'shop_phone_missing': 'Dukaan ka phone number Settings me nahi hai — pehle wahan number bharo. / The shop phone number is not set in Settings — add it there first.',
    'server_unreachable': 'Server se connection nahi ho raha — start-business-os.bat chala hua hai, ye check karein.'
  };
  return map[err.message] || ('Something went wrong: ' + err.message);
}

// ---------- language ----------
function applyLang(lang) {
  const hi = lang === 'hi';
  document.querySelectorAll('[data-en]').forEach((el) => { el.textContent = hi ? el.dataset.hi : el.dataset.en; });
  document.querySelectorAll('[data-en-ph]').forEach((el) => { el.placeholder = hi ? el.dataset.hiPh : el.dataset.enPh; });
  $('langEn') && $('langEn').classList.toggle('on', !hi);
  $('langHi') && $('langHi').classList.toggle('on', hi);
  document.documentElement.lang = hi ? 'hi' : 'en';
}
async function setLanguage(lang) {
  if (!me) { applyLang(lang); return; }
  me.business.language = lang;
  applyLang(lang);
  renderShellBits();
  if (me.user.role === 'owner') {
    try { const r = await api('PUT', '/api/business', { language: lang }); me.business = r.business; renderShellBits(); }
    catch (e) { /* UI already switched locally */ }
  }
}

// ---------- view switching ----------
function showView(name) {
  ['view-login', 'view-signup', 'view-otp', 'view-forgot', 'view-admin', 'view-setup', 'view-app'].forEach((v) => $(v).classList.toggle('hidden', v !== name));
}
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
  const el = $('screen-' + name);
  if (el) el.classList.add('on');
}

// ---------- shell rendering ----------
function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
function renderShellBits() {
  if (!me) return;
  const b = me.business, u = me.user;
  $('sideBizName').textContent = b.name || '—';
  $('sideBizCity').textContent = b.city || (b.language === 'hi' ? 'शहर सेट नहीं' : 'City not set');
  $('sideUserName').textContent = u.name;
  $('sideUserRole').textContent = u.role === 'owner'
    ? (b.language === 'hi' ? 'मालिक (Owner)' : 'Owner')
    : (b.language === 'hi' ? 'स्टाफ · ' : 'Staff · ') + u.access;
  $('avatarInit').textContent = initials(u.name);
  const gstBadge = $('gstBadge');
  gstBadge.textContent = b.gst_enabled ? 'GST: ON' : 'GST: OFF';
  gstBadge.classList.toggle('pill-off', !b.gst_enabled);
  $('dashBizName').textContent = b.name || '—';
  $('dashOwner').textContent = b.owner_name || u.name;
  $('dashGst').textContent = b.gst_enabled ? ('ON' + (b.gstin ? ' · ' + b.gstin : '')) : 'OFF';
  $('dashLang').textContent = b.language === 'hi' ? 'हिंदी' : 'English';
  $('welcomeTitle').textContent = (b.language === 'hi' ? 'नमस्ते, ' : 'Namaste, ') + (b.owner_name || u.name);
  applyLang(b.language);
}

async function enterApp() {
  showView('view-app');
  renderShellBits();
  applyNavLocks();
  showScreen('dashboard');
  document.querySelectorAll('#nav .nav-item').forEach((n) => n.classList.toggle('active', n.dataset.screen === 'dashboard'));
  $('pageTitle').textContent = me.business.language === 'hi' ? 'डैशबोर्ड' : 'Dashboard';
  fillSettings();
  loadSyncStatus();
  loadDashboardStock();
  loadDashboardSummary();
  loadDashboardFinance();
  if (me.user.role === 'owner') { loadStaff(); loadSubscription(); }
  else { $('dashTeam').textContent = '—'; $('subBanner').classList.add('hidden'); }
  loadOnboarding(); // Updates Stage D: staff bhi apni dukaan ki checklist dekh sakte hain
  loadAlerts(); // Feature 5: Due & Alerts hamesha dashboard ke upar
  loadDayEndDash(); // Feature 3: Day-End card (owner-only, function khud chhupata hai)
}

// Stage 4 finance screens are owner-only (founder's rule: staff never see
// profit). The nav shows a 🔒 for staff; the server 403 is the real guard.
function applyNavLocks() {
  if (!me) return;
  const staff = me.user.role !== 'owner';
  document.querySelectorAll('#nav .nav-item').forEach((btn) => {
    const s = btn.dataset.screen;
    if (s !== 'expenses' && s !== 'reports' && s !== 'history') return;
    btn.classList.toggle('locked', staff);
    if (staff) {
      btn.dataset.locked = '1';
      if (!btn.querySelector('.soon')) {
        const t = document.createElement('span');
        t.className = 'soon'; t.textContent = '🔒';
        btn.appendChild(t);
      }
    } else {
      delete btn.dataset.locked;
      const t = btn.querySelector('.soon');
      if (t) t.remove();
    }
  });
}

async function boot() {
  $('todayLine').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (!token) { showView('view-login'); applyLang('en'); return; }
  try {
    me = await api('GET', '/api/me');
    if (me.user.role === 'superadmin') { enterAdmin(); return; }
    if (!me.business.setup_complete && me.user.role === 'owner') { openSetup(); return; }
    await enterApp();
  } catch (e) {
    token = null; localStorage.removeItem('bos_token'); me = null;
    showView('view-login'); applyLang('en');
  }
}

// ---------- setup ----------
function openSetup() {
  showView('view-setup');
  const b = me.business;
  $('setupOwner').value = b.owner_name || me.user.name;
  $('setupName').value = b.name || '';
  $('setupPhone').value = b.phone || '';
  $('setupCity').value = b.city || '';
  $('setupGst').checked = !!b.gst_enabled;
  $('setupGstin').value = b.gstin || '';
  $('setupGstinWrap').classList.toggle('hidden', !b.gst_enabled);
  setupLang = b.language || 'en';
  document.querySelectorAll('#view-setup .lang-card').forEach((c) => c.classList.toggle('sel', c.dataset.lang === setupLang));
  applyLang(setupLang);
}
$('setupGst').addEventListener('change', (e) => $('setupGstinWrap').classList.toggle('hidden', !e.target.checked));
document.querySelectorAll('#view-setup .lang-card').forEach((c) => c.addEventListener('click', () => {
  setupLang = c.dataset.lang;
  document.querySelectorAll('#view-setup .lang-card').forEach((x) => x.classList.toggle('sel', x === c));
  applyLang(setupLang);
}));
$('setupForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('setupErr');
  try {
    const r = await api('PUT', '/api/business', {
      name: $('setupName').value, owner_name: $('setupOwner').value, phone: $('setupPhone').value,
      city: $('setupCity').value, gst_enabled: $('setupGst').checked,
      gstin: $('setupGst').checked ? $('setupGstin').value : '', language: setupLang
    });
    me.business = r.business;
    await enterApp();
  } catch (err) { showErr('setupErr', friendly(err)); }
});

// ---------- auth ----------
$('goSignup').addEventListener('click', () => { showView('view-signup'); });
$('goLogin').addEventListener('click', () => { showView('view-login'); });

$('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('signupErr');
  try {
    // SaaS Stage 2: signup no longer logs in directly — it creates a
    // PENDING account and emails an OTP. Verification starts the trial.
    const r = await api('POST', '/api/auth/signup', { name: $('suName').value, email: $('suEmail').value, password: $('suPass').value });
    openOtpView(r.email || $('suEmail').value.trim(), r.mail_configured);
  } catch (err) {
    if (err.message === 'email_pending_verification') {
      openOtpView($('suEmail').value.trim(), undefined);
      showErr('otpErr', friendly(err));
    } else showErr('signupErr', friendly(err));
  }
});

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('loginErr');
  try {
    const r = await api('POST', '/api/auth/login', { email: $('loginEmail').value, password: $('loginPass').value });
    token = r.token; localStorage.setItem('bos_token', token);
    me = { user: r.user, business: r.business };
    if (me.user.role === 'superadmin') { enterAdmin(); return; }
    if (!me.business.setup_complete && me.user.role === 'owner') openSetup(); else await enterApp();
  } catch (err) {
    if (err.message === 'email_not_verified') {
      openOtpView($('loginEmail').value.trim(), undefined);
      showErr('otpErr', friendly(err));
    } else showErr('loginErr', friendly(err));
  }
});

// ---------- SaaS Stage 2: OTP verify view ----------
let otpEmail = '';
function openOtpView(email, mailConfigured) {
  otpEmail = email || '';
  $('otpEmailLabel').textContent = otpEmail || '—';
  $('otpCode').value = '';
  hideErr('otpErr'); $('otpOk').style.display = 'none';
  const note = $('otpDevNote');
  if (mailConfigured === false) {
    note.textContent = 'Note: email sending is not configured on this server yet, so no live email was sent. (On the founder\'s test setup the code appears in the server log.) / नोट: इस server पर email भेजना अभी configured नहीं है, इसलिए live email नहीं गया।';
    note.classList.remove('hidden');
  } else note.classList.add('hidden');
  showView('view-otp');
  setTimeout(() => $('otpCode').focus(), 50);
}
$('otpForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('otpErr');
  try {
    const r = await api('POST', '/api/auth/verify-otp', { email: otpEmail, otp: $('otpCode').value.trim() });
    token = r.token; localStorage.setItem('bos_token', token);
    me = { user: r.user, business: r.business };
    if (!me.business.setup_complete && me.user.role === 'owner') openSetup(); else await enterApp();
  } catch (err) { showErr('otpErr', friendly(err)); }
});
$('otpResend').addEventListener('click', async () => {
  hideErr('otpErr');
  try {
    const r = await api('POST', '/api/auth/resend-otp', { email: otpEmail, purpose: 'signup' });
    const ok = $('otpOk');
    ok.textContent = isHiLang() ? 'नया code भेजा गया ✓' : 'A new code was sent ✓';
    ok.style.display = 'block';
    if (r.mail_configured === false) $('otpDevNote').classList.remove('hidden');
  } catch (err) { showErr('otpErr', friendly(err)); }
});
$('otpBackLogin').addEventListener('click', () => { showView('view-login'); });
function isHiLang() { return document.documentElement.lang === 'hi'; }

// ---------- SaaS Stage 2: forgot / reset password ----------
$('goForgot').addEventListener('click', () => {
  $('fgEmail').value = $('loginEmail').value || '';
  $('resetForm').classList.add('hidden');
  hideErr('forgotErr'); $('forgotOk').style.display = 'none';
  showView('view-forgot');
});
$('forgotBackLogin').addEventListener('click', () => { showView('view-login'); });
$('forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('forgotErr');
  try {
    const r = await api('POST', '/api/auth/forgot-password', { email: $('fgEmail').value });
    const ok = $('forgotOk');
    ok.textContent = r.mail_configured === false
      ? 'Request noted. Note: email sending is not configured on this server yet, so no live email was sent. / नोट: email भेजना अभी configured नहीं है, इसलिए live email नहीं गया।'
      : 'Reset code sent to your email ✓ / Reset code तुम्हारे ईमेल पर भेजा गया ✓';
    ok.style.display = 'block';
    $('resetForm').classList.remove('hidden');
  } catch (err) { showErr('forgotErr', friendly(err)); }
});
$('fgResend').addEventListener('click', async () => {
  hideErr('forgotErr');
  try {
    await api('POST', '/api/auth/resend-otp', { email: $('fgEmail').value, purpose: 'reset' });
    const ok = $('forgotOk');
    ok.textContent = 'A new code was sent ✓ / नया code भेजा गया ✓';
    ok.style.display = 'block';
  } catch (err) { showErr('forgotErr', friendly(err)); }
});
$('resetForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('forgotErr');
  try {
    await api('POST', '/api/auth/reset-password', { email: $('fgEmail').value, otp: $('fgOtp').value.trim(), password: $('fgPass').value });
    const ok = $('forgotOk');
    ok.textContent = 'Password changed ✓ — now log in with the new password. / पासवर्ड बदल गया ✓ — अब नए पासवर्ड से लॉगिन करो।';
    ok.style.display = 'block';
    $('loginEmail').value = $('fgEmail').value;
    setTimeout(() => showView('view-login'), 900);
  } catch (err) { showErr('forgotErr', friendly(err)); }
});

$('logoutBtn').addEventListener('click', async () => {
  try { await api('POST', '/api/auth/logout'); } catch (e) { /* ignore */ }
  token = null; me = null; localStorage.removeItem('bos_token');
  showView('view-login'); applyLang('en');
});

// ---------- nav ----------
const screenTitles = {
  dashboard: ['Dashboard', 'डैशबोर्ड'], settings: ['Settings', 'सेटिंग'],
  products: ['Products / Stock', 'सामान / स्टॉक'], purchases: ['Purchases', 'खरीद'], suppliers: ['Suppliers', 'सप्लायर'],
  billing: ['New Bill', 'नया बिल'], estimates: ['Estimates', 'एस्टीमेट'], customers: ['Customers', 'ग्राहक'],
  expenses: ['Expenses', 'खर्चा'], reports: ['Reports', 'रिपोर्ट'],
  history: ['History', 'हिस्ट्री'], help: ['Help', 'मदद']
};
document.querySelectorAll('#nav .nav-item').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('#nav .nav-item').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  const s = btn.dataset.screen;
  const hi = me && me.business.language === 'hi';
  const label = btn.querySelector('[data-en]');
  const labelTxt = label ? (hi ? label.dataset.hi : label.dataset.en) : btn.textContent.trim();
  if (btn.dataset.locked) {
    $('soonTitle').textContent = '🔒 ' + labelTxt;
    $('soonText').textContent = hi
      ? 'खर्चा और मुनाफ़ा सिर्फ़ owner देख सकता है। Staff को ये हिस्सा नहीं दिखता — ये मालिक का नियम है।'
      : 'Expenses and profit are owner-only. Staff cannot see this part — that is the owner\'s rule.';
    $('pageTitle').textContent = labelTxt;
    showScreen('soon');
  } else if (s === 'soon') {
    $('soonTitle').textContent = labelTxt;
    $('soonText').textContent = hi
      ? `ये हिस्सा ${btn.dataset.stage} में बनेगा। लॉगिन, सेटअप, स्टॉक, बिलिंग और ग्राहक अभी चल रहे हैं।`
      : `This module is built in ${btn.dataset.stage}. Login, setup, stock, billing and customers are already live.`;
    $('pageTitle').textContent = labelTxt;
    showScreen('soon');
  } else {
    $('pageTitle').textContent = screenTitles[s] ? screenTitles[s][hi ? 1 : 0] : labelTxt;
    showScreen(s);
    if (s === 'settings') { fillSettings(); loadSyncStatus(); if (me && me.user.role === 'owner') { loadSubscription(); loadBackups(); } }
    if (s === 'history') { loadAudit(true); loadConflicts(); }
    if (s === 'help') loadHelp();
    if (s === 'products') loadProducts();
    if (s === 'suppliers') loadSuppliers();
    if (s === 'purchases') loadPurchases();
    if (s === 'billing') loadBilling();
    if (s === 'estimates') loadEstimates();
    if (s === 'customers') loadCustomers();
    if (s === 'expenses') loadExpenses();
    if (s === 'reports') loadReports();
    if (s === 'dashboard') { loadDashboardStock(); loadDashboardSummary(); loadDashboardFinance(); loadSyncStatus(); if (me && me.user.role === 'owner') loadSubscription(); loadOnboarding(); loadAlerts(); loadDayEndDash(); }
  }
}));

// ---------- language topbar ----------
$('langEn').addEventListener('click', () => setLanguage('en'));
$('langHi').addEventListener('click', () => setLanguage('hi'));

// ---------- global search (SaaS Stage 1) ----------
// One box in the topbar: products, customers, suppliers and bill numbers
// from the caller's own business (server enforces business + role rules).
function gotoScreen(name) {
  const btn = document.querySelector('#nav .nav-item[data-screen="' + name + '"]');
  if (btn) btn.click();
}
function hideGsResults() { const b = $('globalSearchResults'); if (b) b.classList.add('hidden'); }
let gsTimer = null;
$('globalSearch').addEventListener('input', () => {
  clearTimeout(gsTimer);
  const q = $('globalSearch').value.trim();
  if (q.length < 2 && !/^\d+$/.test(q)) { hideGsResults(); return; }
  gsTimer = setTimeout(() => runGlobalSearch(q), 250);
});
$('globalSearch').addEventListener('keydown', (e) => { if (e.key === 'Escape') hideGsResults(); });
document.addEventListener('click', (e) => { if (!e.target.closest('.gsearch')) hideGsResults(); });
async function runGlobalSearch(q) {
  const box = $('globalSearchResults');
  try {
    const r = await api('GET', '/api/search?q=' + encodeURIComponent(q));
    if ($('globalSearch').value.trim() !== q) return; // a newer search superseded this one
    box.innerHTML = '';
    let any = false;
    const section = (title) => {
      const h = document.createElement('div');
      h.className = 'gs-head'; h.textContent = title;
      box.appendChild(h);
    };
    const item = (main, sub, onClick) => {
      any = true;
      const d = document.createElement('div');
      d.className = 'gs-item';
      const b = document.createElement('b'); b.textContent = main;
      const s = document.createElement('span'); s.textContent = sub || '';
      d.append(b, s);
      d.addEventListener('click', () => { hideGsResults(); $('globalSearch').value = ''; onClick(); });
      box.appendChild(d);
    };
    if (r.products.length) {
      section(isHi() ? 'सामान' : 'Products');
      r.products.forEach((p) => item(p.name, `${fmt(p.sell_price)} · ${isHi() ? 'स्टॉक' : 'stock'} ${fmtQty(p.stock_qty)}`, () => {
        $('prodSearch').value = p.name;
        gotoScreen('products');
      }));
    }
    if (r.customers.length) {
      section(isHi() ? 'ग्राहक' : 'Customers');
      r.customers.forEach((c) => item(c.name, (c.phone || '') + (c.pending > 0 ? ` · ${isHi() ? 'बाकी' : 'pending'} ${fmt(c.pending)}` : ''), () => {
        gotoScreen('customers');
        openCustomerDetail(c.id);
      }));
    }
    if (r.suppliers.length) {
      section(isHi() ? 'सप्लायर' : 'Suppliers');
      r.suppliers.forEach((s) => item(s.name, (s.phone || '') + (s.pending > 0 ? ` · ${isHi() ? 'देना बाकी' : 'to pay'} ${fmt(s.pending)}` : ''), () => {
        gotoScreen('suppliers');
      }));
    }
    if (r.invoices.length) {
      section(isHi() ? 'बिल' : 'Bills');
      r.invoices.forEach((inv) => item(`#${inv.bill_no} · ${inv.customer_name}`, `${inv.date} · ${fmt(inv.total)} · ${inv.status}`, () => {
        gotoScreen('billing');
        openInvoiceDetail(inv.id);
      }));
    }
    if (!any) {
      const d = document.createElement('div');
      d.className = 'gs-item gs-empty';
      d.textContent = isHi() ? 'कुछ नहीं मिला' : 'Nothing found';
      box.appendChild(d);
    }
    box.classList.remove('hidden');
  } catch (e) { hideGsResults(); }
}

// ---------- settings ----------
function fillSettings() {
  if (!me) return;
  const b = me.business;
  $('setName').value = b.name || '';
  $('setOwner').value = b.owner_name || '';
  $('setPhone').value = b.phone || '';
  $('setCity').value = b.city || '';
  $('setGst').checked = !!b.gst_enabled;
  $('setGstin').value = b.gstin || '';
  $('setGstinWrap').classList.toggle('hidden', !b.gst_enabled);
  $('setUpiId').value = b.upi_id || '';
  $('setUpiName').value = b.upi_payee_name || '';
  setLangSel = b.language || 'en';
  $('setLangEn').classList.toggle('sel', setLangSel === 'en');
  $('setLangHi').classList.toggle('sel', setLangSel === 'hi');
  const owner = me.user.role === 'owner';
  ['setName', 'setOwner', 'setPhone', 'setCity', 'setGst', 'setGstin', 'setUpiId', 'setUpiName'].forEach((id) => { $(id).disabled = !owner; });
  $('setSaveBtn').disabled = !owner;
  $('staffReadonlyNote').classList.toggle('hidden', owner);
  $('staffCard').classList.toggle('hidden', !owner);
  $('backupCard').classList.toggle('hidden', !owner);
  $('importCard').classList.toggle('hidden', !owner);
  $('subCard').classList.toggle('hidden', !owner);
  $('syncCard').classList.toggle('hidden', false);
}
$('setGst').addEventListener('change', (e) => $('setGstinWrap').classList.toggle('hidden', !e.target.checked));
$('setLangEn').addEventListener('click', () => { setLangSel = 'en'; $('setLangEn').classList.add('sel'); $('setLangHi').classList.remove('sel'); });
$('setLangHi').addEventListener('click', () => { setLangSel = 'hi'; $('setLangHi').classList.add('sel'); $('setLangEn').classList.remove('sel'); });

$('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('setErr'); $('setOk').style.display = 'none';
  try {
    const r = await api('PUT', '/api/business', {
      name: $('setName').value, owner_name: $('setOwner').value, phone: $('setPhone').value,
      city: $('setCity').value, gst_enabled: $('setGst').checked,
      gstin: $('setGst').checked ? $('setGstin').value : '', language: setLangSel,
      upi_id: $('setUpiId').value, upi_payee_name: $('setUpiName').value
    });
    me.business = r.business;
    renderShellBits(); fillSettings();
    const ok = $('setOk');
    ok.textContent = me.business.language === 'hi' ? 'सेटिंग सेव हो गई ✓' : 'Settings saved ✓';
    ok.style.display = 'block';
  } catch (err) { showErr('setErr', friendly(err)); }
});

// ---------- staff ----------
const accessLabel = { all: 'All work', billing: 'Billing only', stock: 'Stock only' };
async function loadStaff() {
  try {
    const r = await api('GET', '/api/staff');
    $('dashTeam').textContent = r.staff.length;
    const tb = $('staffRows');
    tb.innerHTML = '';
    r.staff.forEach((u) => {
      const tr = document.createElement('tr');
      const roleTag = u.role === 'owner' ? '<span class="tag tag-paid">Owner</span>' : '<span class="tag tag-part">Staff</span>';
      tr.innerHTML = `<td><b></b></td><td></td><td>${roleTag}</td><td>${u.role === 'owner' ? 'All' : (accessLabel[u.access] || u.access)}</td><td></td>`;
      tr.children[0].querySelector('b').textContent = u.name;
      tr.children[1].textContent = u.email;
      if (u.role !== 'owner') {
        const btn = document.createElement('button');
        btn.className = 'btn btn-danger btn-sm';
        btn.textContent = me.business.language === 'hi' ? 'हटाओ' : 'Remove';
        btn.addEventListener('click', async () => {
          if (!confirm('Remove ' + u.name + '?')) return;
          try { await api('DELETE', '/api/staff/' + u.id); loadStaff(); } catch (err) { showErr('staffErr', friendly(err)); }
        });
        tr.children[4].appendChild(btn);
      }
      tb.appendChild(tr);
    });
  } catch (e) { /* staff list is owner-only; ignore for staff */ }
}
$('staffForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('staffErr');
  try {
    await api('POST', '/api/staff', { name: $('stName').value, email: $('stEmail').value, password: $('stPass').value, access: $('stAccess').value });
    e.target.reset();
    loadStaff();
  } catch (err) { showErr('staffErr', friendly(err)); }
});

// =====================================================================
// ---------- SaaS Stage 2: subscription, onboarding, super admin ----------
// =====================================================================
const subStatusLabel = {
  trial: ['Free trial', 'Free trial'], active: ['Active', 'चालू'],
  grace: ['Grace period', 'Grace period'], expired: ['Expired — read-only', 'ख़त्म — सिर्फ़ देख सकते हो'],
  blocked: ['Blocked — read-only', 'Blocked — सिर्फ़ देख सकते हो']
};
function fmtDateOnly(ts) { return ts ? String(ts).slice(0, 10) : '—'; }

let subCache = null;
async function loadSubscription() {
  if (!me || me.user.role !== 'owner') return;
  try {
    const r = await api('GET', '/api/subscription');
    subCache = r;
    renderSubBanner(r.subscription);
    renderSubCard(r);
  } catch (e) { /* banner/card simply stay as-is */ }
}
function renderSubBanner(s) {
  const b = $('subBanner');
  if (!b) return;
  const hi = isHi();
  const lbl = (subStatusLabel[s.status] || [s.status, s.status])[hi ? 1 : 0];
  let show = false, bg = '#e8f5e9', msg = '';
  if (s.status === 'trial' && s.days_left <= 7) {
    show = true; bg = '#fff8e1';
    msg = hi ? `⏳ Free trial: ${s.days_left} दिन बाकी (${fmtDateOnly(s.ends_at)} तक)। Plan लेने के लिए Settings → Subscription & plan।`
      : `⏳ Free trial: ${s.days_left} day(s) left (till ${fmtDateOnly(s.ends_at)}). Renew from Settings → Subscription & plan.`;
  } else if (s.status === 'active' && s.days_left <= 7 && s.days_left >= 0) {
    show = true; bg = '#fff8e1';
    msg = hi ? `⏳ Plan: ${s.days_left} दिन बाकी (${fmtDateOnly(s.ends_at)} तक)। समय पर renew कर लो।`
      : `⏳ Plan: ${s.days_left} day(s) left (till ${fmtDateOnly(s.ends_at)}). Renew in time.`;
  } else if (s.status === 'grace') {
    show = true; bg = '#fff3e0';
    msg = hi ? `⚠️ Plan ख़त्म हो गया है — grace period चल रहा है। Renew न किया तो app सिर्फ़ देखने के लिए रह जाएगा। Settings → Subscription & plan।`
      : `⚠️ Your plan has ended — grace period is running. Renew soon or the app becomes read-only. Settings → Subscription & plan.`;
  } else if (s.read_only) {
    show = true; bg = '#fdecea';
    msg = hi ? `🔒 Subscription ख़त्म — app read-only है। पुराना data देख सकते हो, नया bill नहीं बनेगा। Renew: Settings → Subscription & plan।`
      : `🔒 Subscription ended — the app is read-only. You can see old data but cannot add new bills. Renew: Settings → Subscription & plan.`;
  }
  b.classList.toggle('hidden', !show);
  if (show) { b.style.background = bg; b.textContent = msg; }
}
function renderSubCard(r) {
  const s = r.subscription, hi = isHi();
  const lbl = (subStatusLabel[s.status] || [s.status, s.status])[hi ? 1 : 0];
  $('subStatus').innerHTML =
    `<div class="check-row"><span>${hi ? 'हालत' : 'Status'}</span><b style="margin-left:auto">${esc(lbl)}</b></div>` +
    `<div class="check-row"><span>${hi ? 'Plan' : 'Plan'}</span><b style="margin-left:auto">${esc(s.plan_code || (hi ? 'कोई नहीं (trial)' : 'None (trial)'))}</b></div>` +
    `<div class="check-row"><span>${hi ? 'कब तक' : 'Valid till'}</span><b style="margin-left:auto">${fmtDateOnly(s.ends_at)}${s.days_left >= 0 ? ` (${s.days_left} ${hi ? 'दिन' : 'day(s)'})` : ''}</b></div>` +
    `<div class="check-row"><span>Grace</span><b style="margin-left:auto">${s.grace_days} ${hi ? 'दिन' : 'day(s)'}</b></div>`;
  $('subPlans').innerHTML = r.plans.map((p) =>
    `<div class="check-row"><span>${esc(p.name)} · ${p.duration_days} ${hi ? 'दिन' : 'days'}</span><b style="margin-left:auto">${Number(p.price) > 0 ? fmt(p.price) : (hi ? 'Price अभी set नहीं' : 'Price not set yet')}</b></div>`
  ).join('');
  const sel = $('claimPlan');
  const cur = sel.value;
  sel.innerHTML = r.plans.map((p) => `<option value="${esc(p.code)}">${esc(p.name)} — ${Number(p.price) > 0 ? fmt(p.price) : (hi ? 'price set नहीं' : 'price not set')}</option>`).join('');
  if (cur) sel.value = cur;
  syncClaimAmount();
  $('subGatewayNote').textContent = r.gateway_configured
    ? (hi ? 'Online payment (Razorpay) चालू है — payment के बाद plan अपने आप बढ़ेगा।' : 'Online payment (Razorpay) is live — your plan extends automatically after payment.')
    : (hi ? 'ℹ️ Online card/UPI gateway अभी live नहीं है (Razorpay key बाकी है)। UPI से payment करके ऊपर claim भेजो — verify होते ही plan चालू होगा।' : 'ℹ️ The online payment gateway is not live yet (Razorpay keys pending). Pay by UPI and submit the claim above — your plan activates after verification.');
  const payBox = $('subPayments');
  if (!r.payments.length) { payBox.innerHTML = `<div class="hint">${hi ? 'अभी कोई payment नहीं।' : 'No payments yet.'}</div>`; return; }
  payBox.innerHTML = '';
  const tbl = document.createElement('table');
  tbl.innerHTML = `<thead><tr><th>${hi ? 'तारीख़' : 'Date'}</th><th>Plan</th><th>${hi ? 'रकम' : 'Amount'}</th><th>${hi ? 'हालत' : 'Status'}</th><th>Invoice</th></tr></thead>`;
  const tb = document.createElement('tbody');
  r.payments.forEach((p) => {
    const tr = document.createElement('tr');
    const invCell = document.createElement('td');
    if (p.status === 'approved' && p.invoice_no) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-soft btn-sm';
      btn.textContent = '🖨 ' + p.invoice_no;
      btn.addEventListener('click', () => printSubInvoice(p.id));
      invCell.appendChild(btn);
    } else invCell.textContent = '—';
    tr.innerHTML = `<td></td><td></td><td></td><td></td>`;
    tr.children[0].textContent = fmtDateOnly(p.created_at);
    tr.children[1].textContent = p.plan_code;
    tr.children[2].textContent = fmt(p.amount);
    tr.children[3].textContent = p.status;
    tr.appendChild(invCell);
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  payBox.appendChild(tbl);
}
function syncClaimAmount() {
  if (!subCache) return;
  const p = subCache.plans.find((x) => x.code === $('claimPlan').value);
  if (p) $('claimAmount').value = Number(p.price) || 0;
}
$('claimPlan').addEventListener('change', syncClaimAmount);
$('claimForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('subErr'); $('subOk').style.display = 'none';
  try {
    await api('POST', '/api/subscription/claim', {
      plan_code: $('claimPlan').value,
      amount: Number($('claimAmount').value) || 0,
      reference: $('claimRef').value.trim()
    });
    $('claimRef').value = '';
    const ok = $('subOk');
    ok.textContent = isHi() ? 'Claim भेजा गया ✓ — DILIGENCE verify करके plan चालू करेगा।' : 'Claim sent ✓ — DILIGENCE will verify and activate your plan.';
    ok.style.display = 'block';
    loadSubscription();
  } catch (err) { showErr('subErr', friendly(err)); }
});
async function printSubInvoice(paymentId) {
  try {
    const r = await api('GET', '/api/subscription/invoice/' + paymentId);
    const inv = r.invoice;
    $('prBiz').textContent = 'DILIGENCE';
    $('prTitle').textContent = (isHi() ? 'सब्सक्रिप्शन इनवॉइस' : 'Subscription Invoice') + ' — ' + inv.invoice_no;
    $('prSub').textContent = `${inv.date} · Business OS plan: ${inv.plan_name}`;
    $('prBody').innerHTML =
      `<table><thead><tr><th>Detail</th><th class="pb-num">Amount ₹</th></tr></thead><tbody>` +
      `<tr><td>Billed to</td><td class="pb-num">${esc(inv.business ? inv.business.name || inv.business.owner_name : '')}</td></tr>` +
      `<tr><td>Plan</td><td class="pb-num">${esc(inv.plan_name)} (${esc(inv.plan_code)})</td></tr>` +
      `<tr><td>Period</td><td class="pb-num">${fmtDateOnly(inv.period_from)} → ${fmtDateOnly(inv.period_to)}</td></tr>` +
      `<tr><td>Payment (${esc(inv.method)}${inv.reference ? ' · ref ' + esc(inv.reference) : ''})</td><td class="pb-num">${fmt(inv.amount)}</td></tr>` +
      `<tr><td><b>Total paid</b></td><td class="pb-num"><b>${fmt(inv.amount)}</b></td></tr>` +
      `</tbody></table>`;
    document.body.classList.add('printing-report');
    const done = () => { document.body.classList.remove('printing-report'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1000);
  } catch (err) { showErr('subErr', friendly(err)); }
}

// ---------- Guided onboarding (Updates Stage D) ----------
// Server-derived 8 steps: the card shows a progress bar, highlights the
// NEXT undone step with its "samjho" line + a button that jumps to the
// exact screen, and expands to the full checklist. Staff see it too
// (view + navigate); dismiss and the manual WhatsApp tick are owner-only.
let onboardExpanded = false;
async function loadOnboarding() {
  if (!me) return;
  try {
    const r = await api('GET', '/api/onboarding');
    const card = $('onboardCard');
    if (!r.show) { card.classList.add('hidden'); return; }
    const hi = isHi();
    const owner = me.user.role === 'owner';
    $('onboardDismiss').classList.toggle('hidden', !owner);
    $('onboardPct').textContent = `${r.progress.done}/${r.progress.total} · ${r.progress.pct}%`;
    $('onboardBarFill').style.width = r.progress.pct + '%';
    const complete = r.progress.done === r.progress.total;
    $('onboardDone').classList.toggle('hidden', !complete);
    $('onboardBody').classList.toggle('hidden', complete);
    if (complete) { card.classList.remove('hidden'); return; }
    const go = (step) => {
      gotoScreen(step.target);
      if (step.key === 'data') openProductForm(null);
    };
    const mkBtn = (txt, cls, fn) => {
      const b = document.createElement('button');
      b.className = 'btn ' + cls + ' btn-sm'; b.textContent = txt;
      b.addEventListener('click', fn);
      return b;
    };
    // Next-step highlight
    const next = r.steps.find((s) => !s.done);
    const nbox = $('onboardNext');
    nbox.innerHTML = '';
    if (next) {
      const t = document.createElement('div');
      t.className = 'ob-next-title';
      t.textContent = (hi ? 'अगला step: ' : 'Next step: ') + (hi ? next.title_hi : next.title_en);
      const d = document.createElement('div');
      d.className = 'hint'; d.style.margin = '2px 0 8px';
      d.textContent = hi ? next.desc_hi : next.desc_en;
      nbox.append(t, d, mkBtn(hi ? 'अभी करो →' : 'Do it now →', 'btn-blue', () => go(next)));
      if (next.manual && owner) {
        const tick = mkBtn(hi ? '✓ हो गया' : '✓ Done', 'btn-soft', async () => {
          try { await api('POST', '/api/onboarding/whatsapp-done'); loadOnboarding(); } catch (e) { /* ignore */ }
        });
        tick.style.marginLeft = '8px';
        nbox.appendChild(tick);
      }
    }
    // Full checklist
    const box = $('onboardSteps');
    box.innerHTML = '';
    r.steps.forEach((s, i) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'check-row ob-row' + (s.done ? ' ob-done' : '');
      const mark = document.createElement('span');
      mark.textContent = s.done ? '✅' : '⬜';
      const txt = document.createElement('span');
      txt.className = 'ob-row-txt';
      const title = document.createElement('b');
      title.textContent = `${i + 1}. ${hi ? s.title_hi : s.title_en}`;
      const desc = document.createElement('span');
      desc.className = 'hint ob-row-desc';
      desc.textContent = hi ? s.desc_hi : s.desc_en;
      txt.append(title, document.createElement('br'), desc);
      rowEl.append(mark, txt);
      if (!s.done) {
        const btns = document.createElement('span');
        btns.className = 'ob-row-btns';
        btns.appendChild(mkBtn(hi ? 'करो →' : 'Do →', 'btn-soft', () => go(s)));
        if (s.manual && owner) {
          const tick = mkBtn('✓', 'btn-soft', async () => {
            try { await api('POST', '/api/onboarding/whatsapp-done'); loadOnboarding(); } catch (e) { /* ignore */ }
          });
          tick.title = hi ? 'हो गया mark करो' : 'Mark done';
          tick.style.marginLeft = '6px';
          btns.appendChild(tick);
        }
        rowEl.appendChild(btns);
      }
      box.appendChild(rowEl);
    });
    card.classList.remove('hidden');
  } catch (e) { /* checklist is best-effort */ }
}
$('onboardToggle').addEventListener('click', () => {
  onboardExpanded = !onboardExpanded;
  $('onboardSteps').classList.toggle('hidden', !onboardExpanded);
  const t = $('onboardToggle');
  t.textContent = onboardExpanded
    ? (isHi() ? 'Steps छिपाओ' : 'Hide steps')
    : (isHi() ? 'सारे steps देखो' : 'See all steps');
});
$('onboardDismiss').addEventListener('click', async () => {
  try { await api('POST', '/api/onboarding/dismiss'); } catch (e) { /* ignore */ }
  $('onboardCard').classList.add('hidden');
});

// ---------- DILIGENCE super admin ----------
function enterAdmin() {
  showView('view-admin');
  loadAdmin();
}
async function loadAdmin() {
  hideErr('adminErr');
  try {
    const [sum, biz, plans, claims, settings] = await Promise.all([
      api('GET', '/api/admin/summary'),
      api('GET', '/api/admin/businesses'),
      api('GET', '/api/admin/plans'),
      api('GET', '/api/admin/payments?status=pending'),
      api('GET', '/api/admin/settings')
    ]);
    $('admTotal').textContent = sum.total_businesses;
    const stuckEl = $('admStuck'); if (stuckEl) stuckEl.textContent = sum.onboarding_stuck != null ? sum.onboarding_stuck : '—';
    $('admRevenue').textContent = fmt(sum.revenue_total);
    $('admPending').textContent = sum.pending_claims;
    $('admByStatus').textContent = Object.entries(sum.by_status).map(([k, v]) => `${k}: ${v}`).join(' · ');
    // Admin overview (growth + attention) — all from the same summary call.
    const s7 = $('admSignups7'); if (s7) s7.textContent = sum.signups_last_7d != null ? sum.signups_last_7d : '—';
    const tso = $('admTrialsSoon'); if (tso) tso.textContent = sum.trials_ending_soon ? sum.trials_ending_soon.length : '—';
    const mrr = $('admMrr'); if (mrr) mrr.textContent = fmt(sum.mrr_estimate || 0);
    renderAdmAttention(sum);
    renderAdmTrend(sum.signup_trend_14d || []);
    renderAdmRecent(sum.recent_signups || []);
    renderAdmClaimsHistory(sum.claims_history || []);
    if (admDetailFor) openAdmDetail(admDetailFor);
    // businesses table (Updates Stage D: + onboarding progress column,
    // cached so the search box can re-render without a refetch)
    admBizCache = biz.businesses;
    renderAdmBiz();
    // pending claims
    const cb = $('admClaims');
    if (!claims.payments.length) cb.innerHTML = '<div class="hint">No pending claims.</div>';
    else {
      cb.innerHTML = '';
      claims.payments.forEach((p) => {
        const d = document.createElement('div');
        d.className = 'check-row';
        const s = document.createElement('span');
        s.textContent = `${p.business_name || ('#' + p.business_id)} · ${p.plan_code} · ${fmt(p.amount)} · ref ${p.reference} · ${fmtDateOnly(p.created_at)}`;
        d.appendChild(s);
        const ok = document.createElement('button');
        ok.className = 'btn btn-blue btn-sm'; ok.style.marginLeft = 'auto'; ok.textContent = 'Approve';
        ok.addEventListener('click', () => adminAction(() => api('POST', `/api/admin/payments/${p.id}/approve`)));
        const no = document.createElement('button');
        no.className = 'btn btn-danger btn-sm'; no.style.marginLeft = '6px'; no.textContent = 'Reject';
        no.addEventListener('click', () => adminAction(() => api('POST', `/api/admin/payments/${p.id}/reject`)));
        d.append(ok, no);
        cb.appendChild(d);
      });
    }
    // plans editor
    const pb = $('admPlans');
    pb.innerHTML = '';
    plans.plans.forEach((p) => {
      const f = document.createElement('form');
      f.className = 'row2'; f.style.alignItems = 'end'; f.style.marginBottom = '8px';
      f.innerHTML =
        `<div class="field" style="margin:0"><label>${esc(p.name)} (${esc(p.code)}) — price ₹</label><input class="input" type="number" min="0" step="0.01" value="${Number(p.price)}"></div>` +
        `<div class="field" style="margin:0"><label>Grace days</label><input class="input" type="number" min="0" step="1" value="${Number(p.grace_days)}"></div>`;
      const btn = document.createElement('button');
      btn.className = 'btn btn-blue'; btn.type = 'submit'; btn.textContent = 'Save';
      f.appendChild(btn);
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        await adminAction(() => api('PUT', '/api/admin/plans/' + p.code, {
          price: Number(f.children[0].querySelector('input').value) || 0,
          grace_days: Number(f.children[1].querySelector('input').value) || 0
        }));
      });
      pb.appendChild(f);
    });
    $('admSupportWa').value = settings.settings.support_whatsapp || '';
    const hv = $('admHelpVideo'); if (hv) hv.value = settings.settings.help_video_url || '';
    const tp = $('admTopPlan'); if (tp) tp.value = settings.settings.top_plan_code || '';
  } catch (err) { showErr('adminErr', friendly(err)); }
}
async function adminAction(fn) {
  hideErr('adminErr');
  try { await fn(); loadAdmin(); }
  catch (err) { showErr('adminErr', friendly(err)); }
}
// ---------- Admin overview sections (growth + attention) ----------
function admRow(text) {
  const d = document.createElement('div');
  d.className = 'check-row';
  const s = document.createElement('span');
  s.textContent = text;
  d.appendChild(s);
  return d;
}
function renderAdmAttention(sum) {
  const tl = $('admTrialsList');
  if (tl) {
    tl.innerHTML = '';
    const trials = sum.trials_ending_soon || [];
    if (!trials.length) tl.innerHTML = '<div class="hint">No trials ending in the next 3 days.</div>';
    trials.forEach((t) => tl.appendChild(admRow(
      `${t.shop || '(no name set)'} · ${t.owner_email || ''} · trial ends ${fmtDateOnly(t.trial_ends_at)} · ${t.days_left} day(s) left`
    )));
  }
  const sl = $('admStuckList');
  if (sl) {
    sl.innerHTML = '';
    const stuck = sum.onboarding_stuck_list || [];
    if (!stuck.length) sl.innerHTML = '<div class="hint">No shop is stuck in onboarding.</div>';
    stuck.forEach((s) => sl.appendChild(admRow(
      `${s.shop || '(no name set)'} · onboarding ${s.pct}% · ${s.days_since_signup} day(s) since signup · ${s.status}`
    )));
  }
}
function renderAdmTrend(trend) {
  const el = $('admTrend');
  if (!el) return;
  el.innerHTML = '';
  if (!trend.length) { el.innerHTML = '<div class="hint">No signup data yet.</div>'; return; }
  const max = Math.max(1, ...trend.map((t) => Number(t.count) || 0));
  const bars = document.createElement('div');
  bars.className = 'trend';
  const labels = document.createElement('div');
  labels.className = 'trend-labels';
  trend.forEach((t) => {
    const col = document.createElement('div');
    col.className = 'trend-col';
    const cnt = document.createElement('div');
    cnt.className = 'trend-count';
    cnt.textContent = t.count ? String(t.count) : '';
    const bar = document.createElement('div');
    bar.className = 'trend-bar';
    bar.style.height = Math.max(4, Math.round(((Number(t.count) || 0) / max) * 100)) + '%';
    bar.title = `${t.date}: ${t.count} signup(s)`;
    col.append(cnt, bar);
    bars.appendChild(col);
    const lb = document.createElement('div');
    lb.className = 'trend-label';
    lb.textContent = `${String(t.date).slice(8, 10)}/${String(t.date).slice(5, 7)}`;
    lb.title = t.date;
    labels.appendChild(lb);
  });
  el.append(bars, labels);
}
function renderAdmRecent(list) {
  const tb = $('admRecentRows');
  if (!tb) return;
  tb.innerHTML = '';
  if (!list.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5; td.className = 'hint';
    td.textContent = 'No shops yet — pehli dukaan signup karegi to yahan dikhegi.';
    tr.appendChild(td); tb.appendChild(tr);
    return;
  }
  list.forEach((b) => {
    const tr = document.createElement('tr');
    const ob = b.onboarding || { done: 0, total: 8, pct: 0 };
    const cells = [
      `${b.shop || '(no name set)'} (#${b.id})`,
      `${b.owner_name || ''} · ${b.owner_email || ''}`,
      fmtDateOnly(b.created_at),
      b.status,
      `${ob.done}/${ob.total} steps · ${ob.pct}%`
    ];
    cells.forEach((c) => { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); });
    tb.appendChild(tr);
  });
}
function renderAdmClaimsHistory(list) {
  const el = $('admClaimsHistory');
  if (!el) return;
  el.innerHTML = '';
  if (!list.length) { el.innerHTML = '<div class="hint">No claims yet — koi payment claim aayega to yahan dikhega.</div>'; return; }
  list.forEach((p) => el.appendChild(admRow(
    `${p.business_name || ('#' + p.business_id)} · ${p.plan_code} · ${fmt(p.amount)} · ${p.status}` +
    ` · claimed ${fmtDateOnly(p.created_at)}` +
    (p.decided_at ? ` · decided ${fmtDateOnly(p.decided_at)}` : '') +
    (p.invoice_no ? ` · ${p.invoice_no}` : '') +
    (p.reference ? ` · ref ${p.reference}` : '')
  )));
}
// ---------- Shop detail panel (metadata only) ----------
let admDetailFor = null;
async function openAdmDetail(id) {
  const box = $('admDetail');
  if (!box) return;
  box.classList.remove('hidden');
  box.innerHTML = '<div class="hint">Loading…</div>';
  try {
    const d = await api('GET', `/api/admin/businesses/${id}/detail`);
    admDetailFor = id;
    renderAdmDetail(d);
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    showErr('adminErr', friendly(err));
    box.classList.add('hidden');
  }
}
function closeAdmDetail() {
  admDetailFor = null;
  const box = $('admDetail');
  if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
}
function renderAdmDetail(d) {
  const box = $('admDetail');
  if (!box) return;
  const b = d.business, s = d.subscription;
  const ob = d.onboarding || { done: 0, total: 8, pct: 0 };
  box.innerHTML = '';
  const head = document.createElement('div');
  head.style.display = 'flex'; head.style.alignItems = 'center'; head.style.gap = '10px';
  const title = document.createElement('b');
  title.style.fontSize = '16px';
  title.textContent = `${b.name || '(no name set)'} — shop detail`;
  const close = document.createElement('button');
  close.className = 'btn btn-ghost btn-sm'; close.style.marginLeft = 'auto'; close.textContent = '✕ Close';
  close.addEventListener('click', closeAdmDetail);
  head.append(title, close);
  const meta = document.createElement('div');
  meta.className = 'hint'; meta.style.marginTop = '6px';
  meta.textContent = `#${b.id} · ${b.owner_name || ''} · ${b.owner_email || ''} · ${b.phone || ''} · ${b.city || ''} · joined ${fmtDateOnly(b.created_at)}`;
  const sub = document.createElement('div');
  sub.style.marginTop = '6px'; sub.style.fontSize = '13.5px';
  sub.textContent = `Status: ${s.status}${s.read_only ? ' (read-only)' : ''} · Plan: ${s.plan_code || 'trial'} · Ends: ${fmtDateOnly(s.ends_at)} · Onboarding: ${ob.done}/${ob.total} steps (${ob.pct}%)`;
  box.append(head, meta, sub);
  const h1 = document.createElement('h4');
  h1.textContent = 'Subscription'; h1.style.margin = '14px 0 4px';
  box.appendChild(h1);
  const rows = d.subscription_rows || [];
  if (!rows.length) box.appendChild(admRow('No subscription record.'));
  rows.forEach((r) => box.appendChild(admRow(
    `${r.plan_code || 'trial'} · ${r.status} · trial ends ${fmtDateOnly(r.trial_ends_at)} · paid until ${fmtDateOnly(r.paid_until)} · grace ${r.grace_days}d · blocked: ${r.blocked ? 'yes' : 'no'}`
  )));
  const h2 = document.createElement('h4');
  h2.textContent = 'Payments'; h2.style.margin = '14px 0 4px';
  box.appendChild(h2);
  const pays = d.payments || [];
  if (!pays.length) box.appendChild(admRow('No payments yet.'));
  pays.forEach((p) => box.appendChild(admRow(
    `${fmt(p.amount)} · ${p.plan_code} · ${p.status} · ${fmtDateOnly(p.created_at)}` +
    (p.invoice_no ? ` · ${p.invoice_no}` : '') +
    (p.reference ? ` · ref ${p.reference}` : '')
  )));
}
// Updates Stage D: shops table renderer with name/email search filter.
let admBizCache = [];
function renderAdmBiz() {
  const tb = $('admBizRows');
  if (!tb) return;
  const q = ($('admSearch') ? $('admSearch').value : '').trim().toLowerCase();
  tb.innerHTML = '';
  const list = admBizCache.filter((b) => !q
    || String(b.name || '').toLowerCase().includes(q)
    || String(b.owner_email || '').toLowerCase().includes(q)
    || String(b.owner_name || '').toLowerCase().includes(q));
  if (!list.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7; td.className = 'hint'; td.textContent = 'No shops match.';
    tr.appendChild(td); tb.appendChild(tr);
    return;
  }
  list.forEach((b) => {
    const s = b.subscription;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><b></b><br><span class="hint"></span></td><td></td><td></td><td></td><td></td><td></td><td></td>`;
    tr.children[0].querySelector('b').textContent = b.name || '(no name set)';
    tr.children[0].querySelector('span').textContent = `#${b.id} · ${b.city || ''}`;
    tr.children[1].textContent = `${b.owner_name || ''} · ${b.owner_email || ''}`;
    tr.children[2].textContent = s.status + (s.read_only ? ' (read-only)' : '');
    tr.children[3].textContent = s.plan_code || 'trial';
    tr.children[4].textContent = fmtDateOnly(s.ends_at);
    const ob = b.onboarding || { done: 0, total: 8, pct: 0 };
    tr.children[5].textContent = `${ob.done}/${ob.total} steps · ${ob.pct}%`;
    tr.children[5].style.color = ob.pct >= 100 ? 'var(--green)' : (ob.pct >= 50 ? 'inherit' : 'var(--amber)');
    const act = tr.children[6];
    const mkBtn = (txt, fn) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-soft btn-sm'; btn.style.margin = '0 4px 4px 0'; btn.textContent = txt;
      btn.addEventListener('click', fn);
      act.appendChild(btn);
    };
    mkBtn('View', () => openAdmDetail(b.id));
    mkBtn('+ Monthly', async () => { await adminAction(() => api('POST', `/api/admin/businesses/${b.id}/extend`, { plan_code: 'monthly' })); });
    mkBtn('+ Yearly', async () => { await adminAction(() => api('POST', `/api/admin/businesses/${b.id}/extend`, { plan_code: 'yearly' })); });
    mkBtn(s.blocked ? 'Unblock' : 'Block', async () => { await adminAction(() => api('POST', `/api/admin/businesses/${b.id}/block`, { blocked: !s.blocked })); });
    tb.appendChild(tr);
  });
}
const admSearchEl = $('admSearch');
if (admSearchEl) admSearchEl.addEventListener('input', renderAdmBiz);
$('admSettingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await adminAction(() => api('PUT', '/api/admin/settings', { support_whatsapp: $('admSupportWa').value.trim(), help_video_url: ($('admHelpVideo') ? $('admHelpVideo').value.trim() : ''), top_plan_code: ($('admTopPlan') ? $('admTopPlan').value.trim() : '') }));
  const ok = $('admSettingsOk');
  ok.textContent = 'Saved ✓'; ok.style.display = 'block';
});
$('adminLogoutBtn').addEventListener('click', async () => {
  try { await api('POST', '/api/auth/logout'); } catch (e) { /* ignore */ }
  token = null; me = null; localStorage.removeItem('bos_token');
  showView('view-login'); applyLang('en');
});

// ---------- Stage 6: data backup download (owner-only card) ----------
// The backup endpoint needs the login token, so fetch it as a blob and
// save it as a file (a plain link could not send the token).
$('backupBtn').addEventListener('click', async () => {
  hideErr('backupErr');
  let res;
  try {
    res = await fetch(apiUrl('/api/backup'), { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  } catch (e) {
    showConnBanner();
    showErr('backupErr', friendly(Object.assign(new Error('server_unreachable'), { status: 0 })));
    return;
  }
  hideConnBanner();
  if (!res.ok) { showErr('backupErr', isHi() ? 'बैकअप नहीं बन पाया। दोबारा कोशिश करें।' : 'Could not create the backup. Please try again.'); return; }
  try {
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'business-os-backup-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.db';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) { showErr('backupErr', isHi() ? 'बैकअप डाउनलोड नहीं हुआ। दोबारा कोशिश करें।' : 'Backup download failed. Please try again.'); }
});

// =====================================================================
// ---------- Stage 2: Products / Suppliers / Purchases ----------
// =====================================================================
function isHi() { return me && me.business.language === 'hi'; }
function fmt(n) { return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function fmtQty(n) { return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function stage2Friendly(err) {
  const map = {
    'stock_access_only': 'Your login has Billing access only — stock work is not allowed. / तुम्हारे login को सिर्फ़ Billing access है — stock का काम नहीं मिलेगा।',
    'supplier_has_purchases': 'This supplier has purchases, so it cannot be deleted. / इस सप्लायर की खरीद दर्ज है, इसलिए delete नहीं होगा।',
    'product_used_in_purchases': 'This product is used in purchases, so it cannot be deleted. / ये सामान खरीद में इस्तेमाल हुआ है, इसलिए delete नहीं होगा।',
    'payment is more than the pending amount': 'Payment is more than the pending amount. / पेमेंट बाकी रकम से ज़्यादा है।'
  };
  return map[err.message] || friendly(err);
}
function statusTag(st) {
  if (st === 'ok' || st === 'paid') return `<span class="tag tag-paid">${st === 'ok' ? 'OK' : 'Paid'}</span>`;
  if (st === 'low') return `<span class="tag tag-part">${isHi() ? 'स्टॉक कम' : 'Low stock'}</span>`;
  if (st === 'partial') return `<span class="tag tag-part">Partial</span>`;
  if (st === 'out') return `<span class="tag tag-pend">${isHi() ? 'ख़त्म' : 'Out of stock'}</span>`;
  return `<span class="tag tag-pend">Pending</span>`;
}

let allProducts = [];   // cache for purchase form + stats
let allSuppliers = [];
let currentPurchaseId = null;

// ---------- dashboard stock bits ----------
async function loadDashboardStock() {
  if (!me) return;
  try {
    const [low, all] = await Promise.all([api('GET', '/api/low-stock'), api('GET', '/api/products')]);
    let value = 0, lowC = 0, outC = 0;
    all.products.forEach((p) => {
      value += Number(p.stock_qty) * Number(p.buy_price);
      if (p.status === 'low') lowC++;
      if (p.status === 'out') outC++;
    });
    $('dashProdCount').textContent = all.products.length;
    $('dashStockValue').textContent = fmt(value);
    $('dashLowCount').textContent = lowC;
    $('dashOutCount').textContent = outC;
    const box = $('dashLowStock');
    box.innerHTML = '';
    if (!low.products.length) {
      box.innerHTML = `<div class="offline-note" style="margin-top:0">🟢 ${isHi() ? 'सब स्टॉक ठीक है — कोई सामान कम नहीं है।' : 'All stock is fine — nothing is running low.'}</div>`;
    } else {
      low.products.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'alert-row';
        row.innerHTML = `<span></span><span class="qty ${p.status === 'low' ? 'amber' : ''}"></span>`;
        row.children[0].textContent = p.name;
        row.children[1].textContent = fmtQty(p.stock_qty) + ' ' + p.unit + (isHi() ? ' बचे' : ' left');
        box.appendChild(row);
      });
    }
  } catch (e) {
    $('dashLowStock').innerHTML = `<div class="hint">${esc(stage2Friendly(e))}</div>`;
    $('dashProdCount').textContent = '—'; $('dashStockValue').textContent = '—';
    $('dashLowCount').textContent = '—'; $('dashOutCount').textContent = '—';
  }
}
$('dashGoProducts').addEventListener('click', () => {
  document.querySelector('#nav .nav-item[data-screen="products"]').click();
});

// ---------- products ----------
async function loadProducts() {
  hideErr('prodErr');
  try {
    const q = $('prodSearch').value.trim();
    const r = await api('GET', '/api/products' + (q ? '?search=' + encodeURIComponent(q) : ''));
    if (!q) allProducts = r.products;
    renderProducts(r.products);
    // stats always on the full list
    const full = q ? (await api('GET', '/api/products')).products : r.products;
    if (q) allProducts = full;
    let value = 0, lowC = 0, outC = 0;
    full.forEach((p) => { value += Number(p.stock_qty) * Number(p.buy_price); if (p.status === 'low') lowC++; if (p.status === 'out') outC++; });
    $('prodStatTotal').textContent = full.length;
    $('prodStatValue').textContent = fmt(value);
    $('prodStatLow').textContent = lowC;
    $('prodStatOut').textContent = outC;
  } catch (e) { showErr('prodErr', stage2Friendly(e)); }
}
function renderProducts(list) {
  const tb = $('prodRows');
  tb.innerHTML = '';
  $('prodEmpty').classList.toggle('hidden', list.length > 0);
  list.forEach((p) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><b></b></td><td></td><td></td><td>${fmt(p.buy_price)}</td><td>${fmt(p.sell_price)}</td><td>${Number(p.gst_rate)}%</td><td>${statusTag(p.status)}</td><td style="white-space:nowrap"></td>`;
    tr.children[0].querySelector('b').textContent = p.name;
    tr.children[1].textContent = p.category || '—';
    tr.children[2].textContent = fmtQty(p.stock_qty) + ' ' + p.unit;
    const edit = document.createElement('button');
    edit.className = 'btn btn-ghost btn-sm'; edit.textContent = isHi() ? 'बदलो' : 'Edit';
    edit.addEventListener('click', () => openProductForm(p));
    const del = document.createElement('button');
    del.className = 'btn btn-danger btn-sm'; del.textContent = isHi() ? 'हटाओ' : 'Delete';
    del.addEventListener('click', async () => {
      if (!confirm((isHi() ? 'हटाना है: ' : 'Delete ') + p.name + '?')) return;
      try { await api('DELETE', '/api/products/' + p.id); loadProducts(); } catch (err) { showErr('prodErr', stage2Friendly(err)); }
    });
    tr.children[7].append(edit, del);
    tb.appendChild(tr);
  });
}
function openProductForm(p) {
  hideErr('pfErr');
  $('productFormCard').classList.remove('hidden');
  $('pfId').value = p ? p.id : '';
  $('pfTitle').textContent = p ? (isHi() ? 'सामान बदलो' : 'Edit product') : (isHi() ? 'सामान जोड़ो' : 'Add product');
  $('pfName').value = p ? p.name : '';
  $('pfCategory').value = p ? p.category : '';
  $('pfUnit').value = p ? p.unit : 'piece';
  $('pfGst').value = p ? String(Number(p.gst_rate)) : '0';
  $('pfHsn').value = p ? (p.hsn_code || '') : '';
  $('pfBuy').value = p ? p.buy_price : 0;
  $('pfSell').value = p ? p.sell_price : 0;
  $('pfLowLimit').value = p ? p.low_stock_limit : 5;
  $('pfOpening').value = 0;
  $('pfOpeningWrap').classList.toggle('hidden', !!p);
  $('pfName').focus();
}
$('addProductBtn').addEventListener('click', () => openProductForm(null));
$('pfCancel').addEventListener('click', () => $('productFormCard').classList.add('hidden'));
$('productForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('pfErr');
  const id = $('pfId').value;
  const body = {
    name: $('pfName').value, category: $('pfCategory').value, unit: $('pfUnit').value,
    gst_rate: Number($('pfGst').value), buy_price: Number($('pfBuy').value),
    sell_price: Number($('pfSell').value), low_stock_limit: Number($('pfLowLimit').value),
    hsn_code: $('pfHsn').value.trim()
  };
  try {
    if (id) { await api('PUT', '/api/products/' + id, body); }
    else { body.stock_qty = Number($('pfOpening').value) || 0; await api('POST', '/api/products', body); }
    $('productFormCard').classList.add('hidden');
    loadProducts();
  } catch (err) { showErr('pfErr', stage2Friendly(err)); }
});
$('prodSearch').addEventListener('input', () => { clearTimeout(window._psT); window._psT = setTimeout(loadProducts, 250); });

// ---------- suppliers ----------
async function loadSuppliers() {
  hideErr('supErr');
  try {
    const r = await api('GET', '/api/suppliers');
    allSuppliers = r.suppliers;
    const tb = $('supRows');
    tb.innerHTML = '';
    $('supEmpty').classList.toggle('hidden', r.suppliers.length > 0);
    r.suppliers.forEach((s) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><b></b></td><td></td><td></td><td>${fmt(s.total_purchased)}</td><td>${fmt(s.total_paid)}</td><td>${s.pending > 0 ? `<span class="pend-amt">${fmt(s.pending)}</span>` : fmt(0)}</td><td style="white-space:nowrap"></td>`;
      tr.children[0].querySelector('b').textContent = s.name;
      tr.children[1].textContent = s.phone || '—';
      tr.children[2].textContent = s.city || '—';
      const edit = document.createElement('button');
      edit.className = 'btn btn-ghost btn-sm'; edit.textContent = isHi() ? 'बदलो' : 'Edit';
      edit.addEventListener('click', () => openSupplierForm(s));
      const del = document.createElement('button');
      del.className = 'btn btn-danger btn-sm'; del.textContent = isHi() ? 'हटाओ' : 'Delete';
      del.addEventListener('click', async () => {
        if (!confirm((isHi() ? 'हटाना है: ' : 'Delete ') + s.name + '?')) return;
        try { await api('DELETE', '/api/suppliers/' + s.id); loadSuppliers(); } catch (err) { showErr('supErr', stage2Friendly(err)); }
      });
      tr.children[6].append(edit, del);
      tb.appendChild(tr);
    });
  } catch (e) { showErr('supErr', stage2Friendly(e)); }
}
function openSupplierForm(s) {
  hideErr('sfErr');
  $('supplierFormCard').classList.remove('hidden');
  $('sfId').value = s ? s.id : '';
  $('sfTitle').textContent = s ? (isHi() ? 'सप्लायर बदलो' : 'Edit supplier') : (isHi() ? 'सप्लायर जोड़ो' : 'Add supplier');
  $('sfName').value = s ? s.name : '';
  $('sfPhone').value = s ? s.phone : '';
  $('sfCity').value = s ? s.city : '';
  $('sfName').focus();
}
$('addSupplierBtn').addEventListener('click', () => openSupplierForm(null));
$('sfCancel').addEventListener('click', () => $('supplierFormCard').classList.add('hidden'));
$('supplierForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('sfErr');
  const id = $('sfId').value;
  const body = { name: $('sfName').value, phone: $('sfPhone').value, city: $('sfCity').value };
  try {
    if (id) await api('PUT', '/api/suppliers/' + id, body); else await api('POST', '/api/suppliers', body);
    $('supplierFormCard').classList.add('hidden');
    loadSuppliers();
  } catch (err) { showErr('sfErr', stage2Friendly(err)); }
});

// ---------- purchases ----------
async function loadPurchases() {
  hideErr('purErr');
  try {
    const [pr, sr, ps] = await Promise.all([api('GET', '/api/purchases'), api('GET', '/api/suppliers'), api('GET', '/api/products')]);
    allSuppliers = sr.suppliers; allProducts = ps.products;
    const tb = $('purRows');
    tb.innerHTML = '';
    $('purEmpty').classList.toggle('hidden', pr.purchases.length > 0);
    pr.purchases.forEach((p) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(p.date)}</td><td><b></b></td><td>${esc(p.bill_no || '—')}</td><td>${fmt(p.total)}</td><td>${fmt(p.paid_amount)}</td><td>${p.pending_amount > 0 ? `<span class="pend-amt">${fmt(p.pending_amount)}</span>` : fmt(0)}</td><td>${statusTag(p.status)}</td><td style="white-space:nowrap"></td>`;
      tr.children[1].querySelector('b').textContent = p.supplier_name || '—';
      const view = document.createElement('button');
      view.className = 'btn btn-soft btn-sm'; view.textContent = isHi() ? 'देखो / पेमेंट' : 'View / Pay';
      view.addEventListener('click', () => openPurchaseDetail(p.id));
      tr.children[7].appendChild(view);
      tb.appendChild(tr);
    });
  } catch (e) { showErr('purErr', stage2Friendly(e)); }
}
function purItemRow() {
  const row = document.createElement('div');
  row.className = 'item-row';
  const opts = allProducts.map((p) => `<option value="${p.id}" data-buy="${Number(p.buy_price)}">${esc(p.name)} (${esc(p.unit)})</option>`).join('');
  row.innerHTML = `
    <div class="field" style="margin:0"><label>${isHi() ? 'सामान' : 'Product'}</label><select class="input pi-prod">${opts}</select></div>
    <div class="field" style="margin:0"><label>Qty</label><input class="input pi-qty" type="number" min="0" step="0.01" value="1"></div>
    <div class="field" style="margin:0"><label>${isHi() ? 'खरीद ₹' : 'Buy ₹'}</label><input class="input pi-price" type="number" min="0" step="0.01" value="0"></div>
    <div class="amt-cell pi-amt">₹0</div>
    <button type="button" class="btn btn-danger btn-sm rm">✕</button>`;
  const sel = row.querySelector('.pi-prod');
  const priceIn = row.querySelector('.pi-price');
  const syncPrice = () => { const o = sel.selectedOptions[0]; if (o) priceIn.value = o.dataset.buy || 0; purRecalc(); };
  sel.addEventListener('change', syncPrice);
  row.querySelector('.pi-qty').addEventListener('input', purRecalc);
  priceIn.addEventListener('input', purRecalc);
  row.querySelector('.rm').addEventListener('click', () => { row.remove(); purRecalc(); });
  syncPrice();
  return row;
}
function purRecalc() {
  let total = 0;
  document.querySelectorAll('#purItems .item-row').forEach((row) => {
    const q = Number(row.querySelector('.pi-qty').value) || 0;
    const pr = Number(row.querySelector('.pi-price').value) || 0;
    const amt = q * pr;
    row.querySelector('.pi-amt').textContent = fmt(amt);
    total += amt;
  });
  $('purGrandTotal').textContent = fmt(total);
  return total;
}
async function openPurchaseForm() {
  hideErr('purFormErr');
  try {
    const [sr, ps] = await Promise.all([api('GET', '/api/suppliers'), api('GET', '/api/products')]);
    allSuppliers = sr.suppliers; allProducts = ps.products;
  } catch (e) { showErr('purErr', stage2Friendly(e)); return; }
  if (!allSuppliers.length) { showErr('purErr', isHi() ? 'पहले एक सप्लायर जोड़ो।' : 'Add a supplier first.'); document.querySelector('#nav .nav-item[data-screen="suppliers"]').click(); return; }
  if (!allProducts.length) { showErr('purErr', isHi() ? 'पहले सामान जोड़ो।' : 'Add a product first.'); document.querySelector('#nav .nav-item[data-screen="products"]').click(); return; }
  $('purSupplier').innerHTML = allSuppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('purBillNo').value = ''; $('purPaid').value = 0; $('purDueDate').value = '';
  $('purItems').innerHTML = '';
  $('purItems').appendChild(purItemRow());
  purRecalc();
  $('purchaseFormCard').classList.remove('hidden');
}
$('addPurchaseBtn').addEventListener('click', openPurchaseForm);
$('purCancel').addEventListener('click', () => $('purchaseFormCard').classList.add('hidden'));
$('purAddItem').addEventListener('click', () => { $('purItems').appendChild(purItemRow()); purRecalc(); });
$('purchaseForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('purFormErr');
  const items = [];
  let bad = false;
  document.querySelectorAll('#purItems .item-row').forEach((row) => {
    const product_id = Number(row.querySelector('.pi-prod').value);
    const qty = Number(row.querySelector('.pi-qty').value);
    const buy_price = Number(row.querySelector('.pi-price').value);
    if (!product_id || !(qty > 0)) bad = true;
    items.push({ product_id, qty, buy_price });
  });
  if (bad || !items.length) { showErr('purFormErr', isHi() ? 'हर सामान की quantity 0 से ज़्यादा रखो।' : 'Every item needs a quantity above 0.'); return; }
  try {
    const purBody = {
      supplier_id: Number($('purSupplier').value), bill_no: $('purBillNo').value,
      paid_amount: Number($('purPaid').value) || 0, items
    };
    if ($('purDueDate').value) purBody.due_date = $('purDueDate').value;
    await api('POST', '/api/purchases', purBody);
    $('purchaseFormCard').classList.add('hidden');
    loadPurchases();
    loadDashboardStock();
  } catch (err) { showErr('purFormErr', stage2Friendly(err)); }
});
async function openPurchaseDetail(id) {
  hideErr('pdErr');
  try {
    const r = await api('GET', '/api/purchases/' + id);
    currentPurchaseId = id;
    const p = r.purchase;
    $('pdTitle').textContent = (isHi() ? 'खरीद #' : 'Purchase #') + p.id + ' · ' + (p.supplier_name || '');
    $('pdMeta').textContent = `${p.date} · ${isHi() ? 'कुल' : 'Total'} ${fmt(p.total)} · ${isHi() ? 'दिया' : 'Paid'} ${fmt(p.paid_amount)} · ${isHi() ? 'बाकी' : 'Pending'} ${fmt(p.pending_amount)} · ${p.status}`;
    const ib = $('pdItems'); ib.innerHTML = '';
    r.items.forEach((it) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td></td><td>${fmtQty(it.qty)} ${esc(it.product_unit || '')}</td><td>${fmt(it.buy_price)}</td><td>${fmt(it.amount)}</td>`;
      tr.children[0].textContent = it.product_name || ('#' + it.product_id);
      ib.appendChild(tr);
    });
    const pb = $('pdPayments'); pb.innerHTML = '';
    if (!r.payments.length) {
      pb.innerHTML = `<tr><td colspan="3" style="color:var(--muted)">${isHi() ? 'अभी कोई पेमेंट नहीं।' : 'No payments yet.'}</td></tr>`;
    }
    r.payments.forEach((pay) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(pay.date)}</td><td>${esc(pay.mode)}</td><td>${fmt(pay.amount)}</td>`;
      pb.appendChild(tr);
    });
    $('pdPendingLine').textContent = p.pending_amount > 0
      ? (isHi() ? `बाकी देना है: ${fmt(p.pending_amount)}` : `Still pending: ${fmt(p.pending_amount)}`)
      : (isHi() ? 'पूरा पेमेंट हो गया ✓' : 'Fully paid ✓');
    $('pdDueDate').value = p.due_date || '';
    $('payAmount').value = p.pending_amount > 0 ? p.pending_amount : '';
    $('purchaseDetailCard').classList.remove('hidden');
    $('purchaseDetailCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { showErr('purErr', stage2Friendly(e)); }
}
$('pdClose').addEventListener('click', () => { $('purchaseDetailCard').classList.add('hidden'); currentPurchaseId = null; });
// Feature 5: purchase ki due date badlo / hatao.
$('pdDueSave').addEventListener('click', async () => {
  if (!currentPurchaseId) return;
  hideErr('pdErr');
  try {
    await api('POST', `/api/purchases/${currentPurchaseId}/due-date`, { due_date: $('pdDueDate').value || null });
    openPurchaseDetail(currentPurchaseId);
    loadAlerts();
  } catch (err) { showErr('pdErr', friendly(err)); }
});
$('payForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('pdErr');
  if (!currentPurchaseId) return;
  try {
    const r = await api('POST', `/api/purchases/${currentPurchaseId}/payments`, { amount: Number($('payAmount').value), mode: $('payMode').value });
    openPurchaseDetail(currentPurchaseId);
    loadPurchases();
    loadSuppliers();
    return r;
  } catch (err) { showErr('pdErr', stage2Friendly(err)); }
});

// =====================================================================
// ---------- Stage 3: Billing / Customers / Payments ----------
// =====================================================================
function stage3Friendly(err) {
  if (err.message === 'insufficient_stock') {
    const p = err.data && err.data.product ? err.data.product : '';
    return (isHi() ? 'स्टॉक कम है' : 'Not enough stock') + (p ? ' — ' + p : '') +
      (isHi() ? '। पहले खरीद (purchase) करो या quantity कम करो।' : '. Add a purchase first, or reduce the quantity.');
  }
  const map = {
    'billing_access_only': 'Your login has Stock access only — billing work is not allowed. / तुम्हारे login को सिर्फ़ Stock access है — बिलिंग का काम नहीं मिलेगा।',
    'customer_has_invoices': 'This customer has bills, so it cannot be deleted. / इस ग्राहक के बिल हैं, इसलिए delete नहीं होगा।',
    'payment is more than the pending amount': 'Payment is more than the pending amount. / पेमेंट बाकी रकम से ज़्यादा है।'
  };
  return map[err.message] || stage2Friendly(err);
}

// ---------- dashboard summary ----------
async function loadDashboardSummary() {
  if (!me) return;
  try {
    const s = await api('GET', '/api/dashboard-summary');
    $('dashSaleVal').textContent = fmt(s.todays_sale);
    $('dashSaleSub').textContent = s.todays_bills > 0
      ? `${s.todays_bills} ${isHi() ? 'बिल आज बने' : 'bills today'}`
      : (isHi() ? 'आज अभी कोई बिल नहीं' : 'No bills yet today');
    $('dashCollectVal').textContent = fmt(s.total_pending_collection);
    $('dashCollectSub').textContent = s.total_pending_collection > 0
      ? `${s.pending_customer_count} ${isHi() ? 'ग्राहकों का बाकी है' : 'customers pending'}`
      : (isHi() ? 'कुछ बाकी नहीं' : 'Nothing pending');
    const rb = $('dashRecentBills');
    rb.innerHTML = '';
    if (!s.recent_bills.length) {
      rb.innerHTML = `<div class="hint">${isHi() ? 'अभी कोई बिल नहीं बना। पहला बिल Billing से बनाओ।' : 'No bills yet. Make your first bill from Billing.'}</div>`;
    } else {
      const tbl = document.createElement('table');
      tbl.innerHTML = `<thead><tr><th>${isHi() ? 'बिल' : 'Bill'}</th><th>${isHi() ? 'ग्राहक' : 'Customer'}</th><th>${isHi() ? 'कुल' : 'Total'}</th><th>${isHi() ? 'हालत' : 'Status'}</th><th></th></tr></thead>`;
      const tb = document.createElement('tbody');
      s.recent_bills.forEach((inv) => {
        const tr = document.createElement('tr');
        tr.className = 'clickable';
        tr.innerHTML = `<td>#${inv.bill_no}</td><td></td><td>${fmt(inv.total)}</td><td>${statusTag(inv.status)}${syncBadge(inv)}</td><td></td>`;
        tr.children[1].textContent = inv.customer_name;
        tr.addEventListener('click', () => {
          document.querySelector('#nav .nav-item[data-screen="billing"]').click();
          openInvoiceDetail(inv.id);
        });
        const wa = document.createElement('button');
        wa.className = 'btn btn-wa btn-sm'; wa.textContent = '💬 WhatsApp';
        wa.addEventListener('click', (ev) => {
          ev.stopPropagation();
          sendBillWhatsApp(inv.id, 'dashSaleSub', () => {
            document.querySelector('#nav .nav-item[data-screen="billing"]').click();
            openInvoiceDetail(inv.id).then(() => showWaPhonePrompt());
          });
        });
        tr.children[4].appendChild(wa);
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      rb.appendChild(tbl);
    }
    const pc = $('dashPendingCust');
    pc.innerHTML = '';
    if (!s.pending_customers.length) {
      pc.innerHTML = `<div class="offline-note" style="margin-top:0">🟢 ${isHi() ? 'किसी का उधार बाकी नहीं है।' : 'Nobody has pending udhaar.'}</div>`;
    } else {
      s.pending_customers.forEach((c) => {
        const row = document.createElement('div');
        row.className = 'pend-row';
        row.innerHTML = `<span></span><span class="amt"></span>`;
        row.children[0].textContent = c.customer_name;
        row.children[1].textContent = fmt(c.pending);
        if (c.customer_id) {
          const rem = document.createElement('button');
          rem.className = 'btn btn-wa btn-sm';
          rem.textContent = isHi() ? 'रिमाइंडर' : 'Remind';
          rem.addEventListener('click', () => sendReminderWhatsApp(c.customer_id, 'dashCollectSub', () => loadDashboardSummary()));
          row.appendChild(rem);
        }
        pc.appendChild(row);
      });
    }
    if (Array.isArray(s.week_sales)) renderBarChart($('dashWeekChart'), s.week_sales, 'weekday');
  } catch (e) { /* dashboard summary is best-effort; stock card reports its own errors */ }
}

// Shared bar chart (dashboard week + reports daily sale).
function compactMoney(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return '₹' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return fmt(v);
}
function renderBarChart(box, days, labelMode) {
  if (!box) return;
  box.innerHTML = '';
  box.classList.toggle('dense', days.length > 10);
  const max = Math.max(...days.map((d) => Number(d.total) || 0), 0);
  days.forEach((d, idx) => {
    const dt = new Date(d.date + 'T00:00:00');
    const lbl = labelMode === 'weekday'
      ? dt.toLocaleDateString('en-IN', { weekday: 'short' })
      : String(dt.getDate());
    const h = max > 0 ? Math.max(5, Math.round((Number(d.total) || 0) / max * 96)) : 5;
    const col = document.createElement('div');
    col.className = 'bar-col';
    col.innerHTML = `<b>${compactMoney(d.total)}</b><div class="bar ${idx === days.length - 1 ? 'today' : ''}" style="height:${h}px"></div><small>${lbl}</small>`;
    box.appendChild(col);
  });
}

// ---------- billing ----------
let billProducts = [];
let billCustomers = [];
let billMode = 'Cash';
let lastInvoiceId = null;
let currentInvoiceId = null;
let currentInvoiceDetail = null;

function updateBillGstHint() {
  const on = me && me.business.gst_enabled;
  $('billGstHint').textContent = on
    ? (isHi() ? `GST बिल · GSTIN ${me.business.gstin || '—'} · भावों में GST शामिल है` : `GST bill · GSTIN ${me.business.gstin || '—'} · Prices include GST`)
    : (isHi() ? 'सादा बिल · GST बंद है (Settings में OFF)' : 'Simple bill · GST is OFF (in Settings)');
  $('sumGstNote').textContent = on
    ? (isHi() ? 'भावों में GST शामिल है।' : 'Prices include GST.')
    : (isHi() ? 'GST बंद है — बिल में GST नहीं लगेगा।' : 'GST is OFF — no GST on this bill.');
}

async function loadBilling() {
  hideErr('billErr'); hideErr('invListErr');
  updateBillGstHint();
  try {
    const [pr, cr, ir] = await Promise.all([
      api('GET', '/api/billing-products'), api('GET', '/api/customers'), api('GET', '/api/invoices')
    ]);
    billProducts = pr.products;
    billCustomers = cr.customers;
    fillBillCustomerSelect();
    if (!$('billDueDate').value) $('billDueDate').value = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
    if (!$('billItems').children.length) $('billItems').appendChild(billItemRow());
    else document.querySelectorAll('#billItems .bill-item-row').forEach(refreshBillRowOptions);
    billRecalc();
    renderInvoiceList(ir.invoices);
    loadReturns();
  } catch (e) { showErr('billErr', stage3Friendly(e)); }
}

// ---------- Feature 2: returns list (billing screen) ----------
async function loadReturns() {
  const tb = $('retRows');
  if (!tb) return;
  hideErr('retListErr');
  try {
    const r = await api('GET', '/api/returns');
    tb.innerHTML = '';
    $('retEmpty').classList.toggle('hidden', r.returns.length > 0);
    r.returns.forEach((rt) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><b>CN${rt.return_no}</b></td><td>${esc(rt.date)}</td><td>#${rt.bill_no}</td><td></td><td>${fmt(rt.total_amount)}</td><td>${fmt(rt.gst_amount)}</td><td style="white-space:nowrap"></td>`;
      tr.children[3].textContent = rt.customer_name || 'Walk-in';
      const wa = document.createElement('button');
      wa.className = 'btn btn-wa btn-sm'; wa.textContent = '💬 WhatsApp';
      wa.addEventListener('click', () => sendReturnWhatsApp(rt.id, 'retListErr'));
      tr.children[6].appendChild(wa);
      tb.appendChild(tr);
    });
  } catch (e) { showErr('retListErr', stage3Friendly(e)); }
}
// =====================================================================
// ---------- Feature 1: Estimates / Quotations ----------
// Billing jaisa hi form + hisab, par estimate se stock/hisab par koi
// asar nahi — Convert dabane par hi asli bill banta hai.
// =====================================================================
let estProducts = [], estCustomers = [], currentEstimateId = null, currentEstimate = null;
async function loadEstimates() {
  hideErr('estErr'); hideErr('estListErr');
  try {
    const [pr, cr, er] = await Promise.all([
      api('GET', '/api/billing-products'), api('GET', '/api/customers'), api('GET', '/api/estimates')
    ]);
    estProducts = pr.products;
    estCustomers = cr.customers;
    fillEstCustomerSelect();
    if (!$('estItems').children.length) $('estItems').appendChild(estItemRow());
    else document.querySelectorAll('#estItems .bill-item-row').forEach(refreshEstRowOptions);
    estRecalc();
    renderEstimateList(er.estimates);
  } catch (e) { showErr('estErr', stage3Friendly(e)); }
}
function fillEstCustomerSelect() {
  const sel = $('estCustomer');
  const cur = sel.value;
  sel.innerHTML = '';
  const walk = document.createElement('option');
  walk.value = ''; walk.textContent = isHi() ? 'वॉक-इन ग्राहक (बिना नाम)' : 'Walk-in customer';
  sel.appendChild(walk);
  estCustomers.forEach((c) => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name + (c.phone ? ' · ' + c.phone : '');
    sel.appendChild(o);
  });
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
function estProductOptions(sel) {
  sel.innerHTML = estProducts.map((p) =>
    `<option value="${p.id}" data-sell="${Number(p.sell_price)}" data-gst="${Number(p.gst_rate)}" data-stock="${Number(p.stock_qty)}">${esc(p.name)} (${esc(p.unit)}) · ${fmt(p.sell_price)} · ${isHi() ? 'स्टॉक' : 'stock'} ${fmtQty(p.stock_qty)}</option>`
  ).join('');
}
function estItemRow() {
  const row = document.createElement('div');
  row.className = 'bill-item-row';
  row.innerHTML = `
    <div class="field" style="margin:0"><label>${isHi() ? 'सामान' : 'Product'}</label><input class="input bi-search" type="text" autocomplete="off" placeholder="${isHi() ? 'सामान खोजो…' : 'Search product…'}" style="margin-bottom:6px"><select class="input bi-prod"></select></div>
    <div class="field" style="margin:0"><label>Qty</label><input class="input bi-qty" type="number" min="0" step="0.01" value="1"></div>
    <div class="field" style="margin:0"><label>${isHi() ? 'भाव ₹' : 'Rate ₹'}</label><input class="input bi-rate" type="number" min="0" step="0.01" value="0"></div>
    <div class="gst-cell bi-gst">—</div>
    <div class="amt-cell bi-amt">₹0</div>
    <button type="button" class="btn btn-danger btn-sm rm">✕</button>`;
  const sel = row.querySelector('.bi-prod');
  estProductOptions(sel);
  const syncRate = () => {
    const o = sel.selectedOptions[0];
    if (o) row.querySelector('.bi-rate').value = o.dataset.sell || 0;
    estRecalc();
  };
  sel.addEventListener('change', syncRate);
  const searchIn = row.querySelector('.bi-search');
  searchIn.addEventListener('input', () => {
    const q = searchIn.value.trim().toLowerCase();
    let first = null;
    [...sel.options].forEach((o) => {
      const hit = !q || o.textContent.toLowerCase().includes(q);
      o.hidden = !hit;
      if (hit && !first) first = o;
    });
    if (first) { sel.value = first.value; syncRate(); }
  });
  row.querySelector('.bi-qty').addEventListener('input', estRecalc);
  row.querySelector('.bi-rate').addEventListener('input', estRecalc);
  row.querySelector('.rm').addEventListener('click', () => { row.remove(); estRecalc(); });
  syncRate();
  return row;
}
function refreshEstRowOptions(row) {
  const sel = row.querySelector('.bi-prod');
  const cur = sel.value;
  estProductOptions(sel);
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
function estRecalc() {
  if (!me) return { subtotal: 0, total: 0, gst: 0 };
  const gstOn = !!me.business.gst_enabled;
  let subtotal = 0, gst = 0;
  document.querySelectorAll('#estItems .bill-item-row').forEach((row) => {
    const sel = row.querySelector('.bi-prod');
    const o = sel.selectedOptions[0];
    const qty = Number(row.querySelector('.bi-qty').value) || 0;
    const rate = Number(row.querySelector('.bi-rate').value) || 0;
    const amt = qty * rate;
    row.querySelector('.bi-amt').textContent = fmt(amt);
    const gr = o ? Number(o.dataset.gst) : 0;
    row.querySelector('.bi-gst').textContent = gstOn ? (gr + '% GST') : '—';
    subtotal += amt;
    if (gstOn && gr > 0) gst += amt * gr / (100 + gr);
  });
  gst = Math.round(gst * 100) / 100;
  const discount = Number($('estDiscount').value) || 0;
  const total = Math.max(subtotal - discount, 0);
  $('estSumSubtotal').textContent = fmt(subtotal);
  $('estSumGst').textContent = gstOn ? fmt(gst) : (isHi() ? 'GST बंद है' : 'GST OFF');
  $('estSumTotal').textContent = fmt(total);
  return { subtotal, total, gst };
}
$('estAddItem').addEventListener('click', () => { $('estItems').appendChild(estItemRow()); estRecalc(); });
$('estDiscount').addEventListener('input', estRecalc);
$('estRefresh').addEventListener('click', loadEstimates);
$('estForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('estErr');
  const items = [];
  let bad = false;
  document.querySelectorAll('#estItems .bill-item-row').forEach((row) => {
    const product_id = Number(row.querySelector('.bi-prod').value);
    const qty = Number(row.querySelector('.bi-qty').value);
    const price = Number(row.querySelector('.bi-rate').value);
    if (!product_id || !(qty > 0)) bad = true;
    items.push({ product_id, qty, price });
  });
  if (bad || !items.length) { showErr('estErr', isHi() ? 'हर सामान चुनो और quantity 0 से ज़्यादा रखो।' : 'Choose a product for every row and keep quantity above 0.'); return; }
  try {
    const cv = $('estCustomer').value;
    const r = await api('POST', '/api/estimates', {
      customer_id: cv ? Number(cv) : null,
      discount: Number($('estDiscount').value) || 0, items
    });
    $('estItems').innerHTML = '';
    $('estItems').appendChild(estItemRow());
    $('estDiscount').value = 0;
    estRecalc();
    const er = await api('GET', '/api/estimates');
    renderEstimateList(er.estimates);
    openEstimateDetail(r.estimate.id);
  } catch (err) { showErr('estErr', stage3Friendly(err)); }
});
function estimateStatusTag(e) {
  return e.status === 'converted'
    ? `<span class="tag tag-paid">${isHi() ? 'बिल बन गया' : 'Converted'}</span>`
    : `<span class="tag tag-part">${isHi() ? 'खुला है' : 'Open'}</span>`;
}
function renderEstimateList(estimates) {
  const tb = $('estRows');
  tb.innerHTML = '';
  $('estEmpty').classList.toggle('hidden', estimates.length > 0);
  estimates.forEach((e) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><b>#${e.estimate_no}</b></td><td>${esc(e.date)}</td><td></td><td>${fmt(e.total)}</td><td>${estimateStatusTag(e)}</td><td style="white-space:nowrap"></td>`;
    tr.children[2].textContent = e.customer_name;
    const view = document.createElement('button');
    view.className = 'btn btn-soft btn-sm'; view.textContent = isHi() ? 'देखो' : 'View';
    view.addEventListener('click', () => openEstimateDetail(e.id));
    tr.children[5].appendChild(view);
    tb.appendChild(tr);
  });
}
async function openEstimateDetail(id) {
  hideErr('edErr'); hideErr('edWaErr');
  try {
    const r = await api('GET', '/api/estimates/' + id);
    currentEstimateId = id;
    currentEstimate = r.estimate;
    const e = r.estimate;
    $('edTitle').textContent = `${isHi() ? 'एस्टीमेट' : 'Estimate'} #${e.estimate_no} · ${e.customer_name}`;
    $('edMeta').textContent = `${e.date} · ${e.status === 'converted' ? (isHi() ? 'बिल बन गया' : 'Converted to bill') : (isHi() ? 'खुला है' : 'Open')}`;
    const ib = $('edItems'); ib.innerHTML = '';
    r.items.forEach((it) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td></td><td>${fmtQty(it.qty)}</td><td>${fmt(it.sell_price)}</td><td>${e.gst_enabled ? Number(it.gst_rate) + '%' : '—'}</td><td>${fmt(it.amount)}</td>`;
      tr.children[0].textContent = it.product_name;
      ib.appendChild(tr);
    });
    $('edSubtotal').textContent = fmt(e.subtotal);
    $('edGstRow').style.display = e.gst_enabled ? '' : 'none';
    $('edGst').textContent = fmt(e.gst_amount);
    $('edDiscount').textContent = fmt(e.discount);
    $('edTotal').textContent = fmt(e.total);
    $('edConvert').classList.toggle('hidden', e.status === 'converted');
    $('edWaPhoneWrap').classList.add('hidden');
    $('estimateDetailCard').classList.remove('hidden');
    $('estimateDetailCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { showErr('estListErr', stage3Friendly(err)); }
}
$('edClose').addEventListener('click', () => { $('estimateDetailCard').classList.add('hidden'); currentEstimateId = null; currentEstimate = null; });
$('edConvert').addEventListener('click', async () => {
  if (!currentEstimateId) return;
  hideErr('edErr');
  try {
    const r = await api('POST', `/api/estimates/${currentEstimateId}/convert`, {});
    const inv = r.invoice;
    $('estimateDetailCard').classList.add('hidden');
    currentEstimateId = null; currentEstimate = null;
    const er = await api('GET', '/api/estimates');
    renderEstimateList(er.estimates);
    gotoScreen('billing');
    openInvoiceDetail(inv.id);
  } catch (err) { showErr('edErr', stage3Friendly(err)); }
});
async function sendEstimateWhatsApp(estimateId, errId, onNeedPhone) {
  hideErr(errId);
  try {
    const r = await api('GET', `/api/estimates/${estimateId}/whatsapp-link`);
    window.open(r.url, '_blank');
  } catch (err) {
    if (err.message === 'customer_phone_missing' && onNeedPhone) { onNeedPhone(); return; }
    showErr(errId, stage5Friendly(err));
  }
}
$('edWa').addEventListener('click', () => {
  if (!currentEstimateId) return;
  sendEstimateWhatsApp(currentEstimateId, 'edWaErr', () => {
    $('edWaPhoneWrap').classList.remove('hidden');
    $('edWaPhone').focus();
  });
});
$('edWaGo').addEventListener('click', async () => {
  if (!currentEstimateId) return;
  hideErr('edWaErr');
  const p = $('edWaPhone').value.trim();
  if (!p) { showErr('edWaErr', isHi() ? 'Pehle WhatsApp number likho।' : 'Write the WhatsApp number first.'); return; }
  try {
    const r = await api('GET', `/api/estimates/${currentEstimateId}/whatsapp-link?phone=${encodeURIComponent(p)}`);
    window.open(r.url, '_blank');
  } catch (err) { showErr('edWaErr', stage5Friendly(err)); }
});

$('retRefresh').addEventListener('click', loadReturns);
// Credit note WhatsApp — bill wale pattern par hi (server text banata hai).
async function sendReturnWhatsApp(returnId, errId) {
  hideErr(errId);
  try {
    const r = await api('GET', `/api/returns/${returnId}/whatsapp-link`);
    window.open(r.url, '_blank');
  } catch (err) { showErr(errId, stage5Friendly(err)); }
}
function fillBillCustomerSelect() {
  const sel = $('billCustomer');
  const cur = sel.value;
  sel.innerHTML = '';
  const walk = document.createElement('option');
  walk.value = ''; walk.textContent = isHi() ? 'वॉक-इन ग्राहक (बिना नाम)' : 'Walk-in customer';
  sel.appendChild(walk);
  billCustomers.forEach((c) => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name + (c.phone ? ' · ' + c.phone : '');
    sel.appendChild(o);
  });
  const nw = document.createElement('option');
  nw.value = '__new__'; nw.textContent = isHi() ? '＋ नया ग्राहक बनाओ' : '＋ New customer';
  sel.appendChild(nw);
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  $('newCustWrap').classList.toggle('hidden', sel.value !== '__new__');
}
$('billCustomer').addEventListener('change', () => {
  $('newCustWrap').classList.toggle('hidden', $('billCustomer').value !== '__new__');
});
function billProductOptions(sel) {
  sel.innerHTML = billProducts.map((p) =>
    `<option value="${p.id}" data-sell="${Number(p.sell_price)}" data-gst="${Number(p.gst_rate)}" data-stock="${Number(p.stock_qty)}">${esc(p.name)} (${esc(p.unit)}) · ${fmt(p.sell_price)} · ${isHi() ? 'स्टॉक' : 'stock'} ${fmtQty(p.stock_qty)}</option>`
  ).join('');
}
function billItemRow() {
  const row = document.createElement('div');
  row.className = 'bill-item-row';
  row.innerHTML = `
    <div class="field" style="margin:0"><label>${isHi() ? 'सामान' : 'Product'}</label><input class="input bi-search" type="text" autocomplete="off" placeholder="${isHi() ? 'सामान खोजो…' : 'Search product…'}" style="margin-bottom:6px"><select class="input bi-prod"></select><div class="qty-warn"></div></div>
    <div class="field" style="margin:0"><label>Qty</label><input class="input bi-qty" type="number" min="0" step="0.01" value="1"></div>
    <div class="field" style="margin:0"><label>${isHi() ? 'भाव ₹' : 'Rate ₹'}</label><input class="input bi-rate" type="number" min="0" step="0.01" value="0"></div>
    <div class="gst-cell bi-gst">—</div>
    <div class="amt-cell bi-amt">₹0</div>
    <button type="button" class="btn btn-danger btn-sm rm">✕</button>`;
  const sel = row.querySelector('.bi-prod');
  billProductOptions(sel);
  const syncRate = () => {
    const o = sel.selectedOptions[0];
    if (o) row.querySelector('.bi-rate').value = o.dataset.sell || 0;
    billRecalc();
  };
  sel.addEventListener('change', syncRate);
  // SaaS Stage 1: search-as-you-type in the product picker — typing filters
  // the dropdown options live and selects the first match. The underlying
  // <select> (and all billing math) is untouched.
  const searchIn = row.querySelector('.bi-search');
  searchIn.addEventListener('input', () => {
    const q = searchIn.value.trim().toLowerCase();
    let first = null;
    [...sel.options].forEach((o) => {
      const hit = !q || o.textContent.toLowerCase().includes(q);
      o.hidden = !hit;
      if (hit && !first) first = o;
    });
    if (first) { sel.value = first.value; syncRate(); }
  });
  row.querySelector('.bi-qty').addEventListener('input', billRecalc);
  row.querySelector('.bi-rate').addEventListener('input', billRecalc);
  row.querySelector('.rm').addEventListener('click', () => { row.remove(); billRecalc(); });
  syncRate();
  return row;
}
function refreshBillRowOptions(row) {
  const sel = row.querySelector('.bi-prod');
  const cur = sel.value;
  billProductOptions(sel);
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
function billRecalc() {
  if (!me) return { subtotal: 0, total: 0, gst: 0 };
  const gstOn = !!me.business.gst_enabled;
  let subtotal = 0, gst = 0;
  document.querySelectorAll('#billItems .bill-item-row').forEach((row) => {
    const sel = row.querySelector('.bi-prod');
    const o = sel.selectedOptions[0];
    const qty = Number(row.querySelector('.bi-qty').value) || 0;
    const rate = Number(row.querySelector('.bi-rate').value) || 0;
    const amt = qty * rate;
    row.querySelector('.bi-amt').textContent = fmt(amt);
    const stock = o ? Number(o.dataset.stock) : 0;
    const warn = row.querySelector('.qty-warn');
    const over = qty > stock;
    warn.classList.toggle('show', over);
    if (over) warn.textContent = isHi() ? `स्टॉक सिर्फ़ ${fmtQty(stock)} है` : `Only ${fmtQty(stock)} in stock`;
    const gr = o ? Number(o.dataset.gst) : 0;
    row.querySelector('.bi-gst').textContent = gstOn ? (gr + '% GST') : '—';
    subtotal += amt;
    if (gstOn && gr > 0) gst += amt * gr / (100 + gr);
  });
  gst = Math.round(gst * 100) / 100;
  const discount = Number($('billDiscount').value) || 0;
  const total = Math.max(subtotal - discount, 0);
  $('sumSubtotal').textContent = fmt(subtotal);
  $('sumGst').textContent = gstOn ? fmt(gst) : (isHi() ? 'GST बंद है' : 'GST OFF');
  $('sumTotal').textContent = fmt(total);
  const paid = Number($('billPaid').value) || 0;
  $('sumBalance').textContent = fmt(Math.max(total - paid, 0));
  return { subtotal, total, gst };
}
$('billAddItem').addEventListener('click', () => { $('billItems').appendChild(billItemRow()); billRecalc(); });
$('billDiscount').addEventListener('input', billRecalc);
$('billPaid').addEventListener('input', billRecalc);
document.querySelectorAll('#billModes button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#billModes button').forEach((x) => x.classList.remove('on'));
  b.classList.add('on');
  billMode = b.dataset.mode;
  if (billMode === 'Udhaar') { $('billPaid').value = 0; billRecalc(); }
}));
function resetBillForm() {
  $('billItems').innerHTML = '';
  $('billItems').appendChild(billItemRow());
  $('billDiscount').value = 0;
  $('billPaid').value = 0;
  billMode = 'Cash';
  document.querySelectorAll('#billModes button').forEach((x) => x.classList.toggle('on', x.dataset.mode === 'Cash'));
  $('billCustomer').value = '';
  $('newCustWrap').classList.add('hidden');
  $('ncName').value = ''; $('ncPhone').value = '';
  // Feature 5: due date pehle se bill date + 15 din bhara rehta hai.
  $('billDueDate').value = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
  billRecalc();
}
$('billForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('billErr');
  const items = [];
  let bad = false;
  document.querySelectorAll('#billItems .bill-item-row').forEach((row) => {
    const product_id = Number(row.querySelector('.bi-prod').value);
    const qty = Number(row.querySelector('.bi-qty').value);
    const sell_price = Number(row.querySelector('.bi-rate').value);
    if (!product_id || !(qty > 0)) bad = true;
    items.push({ product_id, qty, sell_price });
  });
  if (bad || !items.length) { showErr('billErr', isHi() ? 'हर सामान चुनो और quantity 0 से ज़्यादा रखो।' : 'Choose a product for every row and keep quantity above 0.'); return; }
  try {
    let customer_id = null;
    const cv = $('billCustomer').value;
    if (cv === '__new__') {
      const nm = $('ncName').value.trim();
      if (!nm) { showErr('billErr', isHi() ? 'नए ग्राहक का नाम लिखो।' : 'Write the new customer name.'); return; }
      const cr = await api('POST', '/api/customers', { name: nm, phone: $('ncPhone').value.trim() });
      customer_id = cr.customer.id;
    } else if (cv) customer_id = Number(cv);
    const billBody = {
      customer_id, discount: Number($('billDiscount').value) || 0,
      paid_amount: Number($('billPaid').value) || 0, payment_mode: billMode, items
    };
    // Feature 5: due date sirf tab bhejo jab balance rahega — poora
    // payment wale bill par due date nahi lagti. Field khali = saaf
    // taur par koi due date nahi (server ka default tab nahi chalega).
    const billTotals = billRecalc();
    if (billTotals.total - billBody.paid_amount > 0) {
      billBody.due_date = $('billDueDate').value || '';
    }
    const r = await api('POST', '/api/invoices', billBody);
    lastInvoiceId = r.invoice.id;
    const inv = r.invoice;
    $('bsTitle').textContent = `✓ ${isHi() ? 'बिल' : 'Bill'} #${inv.bill_no} ${isHi() ? 'बन गया' : 'saved'}`;
    $('bsText').textContent = `${inv.customer_name} · ${isHi() ? 'कुल' : 'Total'} ${fmt(inv.total)} · ${isHi() ? 'मिला' : 'Paid'} ${fmt(inv.paid_amount)} · ${isHi() ? 'बाकी' : 'Balance'} ${fmt(inv.pending_amount)} · ${inv.status}`;
    hideErr('bsErr');
    $('bsWaPhoneWrap').classList.add('hidden');
    $('bsWaPhone').value = '';
    $('billSuccess').classList.remove('hidden');
    $('billSuccess').scrollIntoView({ behavior: 'smooth', block: 'start' });
    resetBillForm();
    const ir = await api('GET', '/api/invoices');
    renderInvoiceList(ir.invoices);
    const pr = await api('GET', '/api/billing-products');
    billProducts = pr.products;
    document.querySelectorAll('#billItems .bill-item-row').forEach(refreshBillRowOptions);
    billRecalc();
    loadDashboardSummary();
  } catch (err) { showErr('billErr', stage3Friendly(err)); }
});
$('bsNew').addEventListener('click', () => { $('billSuccess').classList.add('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('bsView').addEventListener('click', () => { if (lastInvoiceId) openInvoiceDetail(lastInvoiceId); });
$('bsPrint').addEventListener('click', () => { if (lastInvoiceId) printInvoice(lastInvoiceId); });
$('bsPdf').addEventListener('click', () => { if (lastInvoiceId) printInvoice(lastInvoiceId); });
$('bsWhatsApp').addEventListener('click', () => {
  if (!lastInvoiceId) return;
  sendBillWhatsApp(lastInvoiceId, 'bsErr', () => {
    $('bsWaPhoneWrap').classList.remove('hidden');
    $('bsWaPhone').focus();
  });
});
$('bsWaGo').addEventListener('click', () => {
  if (!lastInvoiceId) return;
  sendBillWhatsAppWithPhone(lastInvoiceId, $('bsWaPhone').value, 'bsErr');
});
$('billRefresh').addEventListener('click', loadBilling);
// Stage C: an imported opening balance (kind='opening', bill_no 0) is
// labeled plainly wherever bills are listed — never as a fake "Bill #0".
function billNoLabel(inv) {
  if (inv && inv.kind === 'opening') return isHi() ? 'पिछला बाकी' : 'Opening Balance';
  return '#' + (inv ? inv.bill_no : '');
}
function renderInvoiceList(invoices) {
  const tb = $('invRows');
  tb.innerHTML = '';
  $('invEmpty').classList.toggle('hidden', invoices.length > 0);
  invoices.forEach((inv) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><b>${billNoLabel(inv)}</b></td><td>${esc(inv.date)}</td><td></td><td>${fmt(inv.total)}</td><td>${fmt(inv.paid_amount)}</td><td>${inv.pending_amount > 0 ? `<span class="pend-amt">${fmt(inv.pending_amount)}</span>` : fmt(0)}</td><td>${statusTag(inv.status)}${syncBadge(inv)}</td><td style="white-space:nowrap"></td>`;
    tr.children[2].textContent = inv.customer_name;
    const view = document.createElement('button');
    view.className = 'btn btn-soft btn-sm'; view.textContent = isHi() ? 'देखो / पेमेंट' : 'View / Pay';
    view.addEventListener('click', () => openInvoiceDetail(inv.id));
    tr.children[7].appendChild(view);
    const wa = document.createElement('button');
    wa.className = 'btn btn-wa btn-sm'; wa.textContent = '💬 WhatsApp';
    wa.addEventListener('click', () => sendBillWhatsApp(inv.id, 'invListErr', () => openInvoiceDetail(inv.id).then(() => showWaPhonePrompt())));
    tr.children[7].appendChild(wa);
    tb.appendChild(tr);
  });
}
async function openInvoiceDetail(id) {
  hideErr('idErr');
  try {
    const r = await api('GET', '/api/invoices/' + id);
    currentInvoiceId = id;
    currentInvoiceDetail = r;
    const inv = r.invoice;
    $('idTitle').textContent = inv.kind === 'opening'
      ? `${isHi() ? 'पिछला बाकी (Opening Balance)' : 'Opening Balance'} · ${inv.customer_name}`
      : `${isHi() ? 'बिल' : 'Bill'} #${inv.bill_no} · ${inv.customer_name}`;
    $('idMeta').textContent = `${inv.date} · ${inv.status}${inv.gst_enabled ? ' · GST bill' : ''}`;
    const ib = $('idItems'); ib.innerHTML = '';
    r.items.forEach((it) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td></td><td>${fmtQty(it.qty)}</td><td>${fmt(it.sell_price)}</td><td>${inv.gst_enabled ? Number(it.gst_rate) + '%' : '—'}</td><td>${fmt(it.amount)}</td>`;
      tr.children[0].textContent = it.product_name;
      ib.appendChild(tr);
    });
    $('idSubtotal').textContent = fmt(inv.subtotal);
    $('idGstRow').style.display = inv.gst_enabled ? '' : 'none';
    $('idGst').textContent = fmt(inv.gst_amount);
    $('idDiscount').textContent = fmt(inv.discount);
    $('idTotal').textContent = fmt(inv.total);
    const pb = $('idPayments'); pb.innerHTML = '';
    if (!r.payments.length) {
      pb.innerHTML = `<tr><td colspan="3" style="color:var(--muted)">${isHi() ? 'अभी कोई पेमेंट नहीं मिली।' : 'No payments received yet.'}</td></tr>`;
    }
    r.payments.forEach((pay) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(pay.date)}</td><td>${esc(pay.mode)}</td><td>${fmt(pay.amount)}</td>`;
      pb.appendChild(tr);
    });
    // Feature 2: returns ke baad ka net pending hi asli baaki hai.
    const hasReturns = Number(r.returns_total || 0) > 0;
    const netPend = hasReturns ? Number(r.net_pending) : inv.pending_amount;
    $('idPendingLine').textContent = netPend > 0
      ? (isHi() ? `बाकी लेना है: ${fmt(netPend)}` : `Still to collect: ${fmt(netPend)}`) + (hasReturns ? (isHi() ? ' (वापसी घटाकर)' : ' (after returns)') : '')
      : (isHi() ? 'पूरा पेमेंट मिल गया ✓' : 'Fully paid ✓');
    // Feature 5: due date editor.
    hideErr('idDueErr');
    $('idDueDate').value = inv.due_date || '';
    // Feature 2: returns section — purani wapsiyan + nayi wapsi ka form.
    renderInvoiceReturns(r);
    // Updates Stage A: scan-to-pay QR — the server sends upi_qr only when
    // a UPI ID is set AND a balance is due; otherwise the box stays hidden.
    const uqBox = $('idUpiQr');
    if (r.upi_qr && r.upi_qr.svg) {
      uqBox.innerHTML = '';
      const svgHolder = document.createElement('div');
      svgHolder.className = 'upi-qr-svg';
      svgHolder.innerHTML = r.upi_qr.svg; // server-generated SVG (our own vendored generator — contains no user text)
      const cap = document.createElement('div');
      cap.className = 'hint';
      cap.textContent = isHi()
        ? `📷 QR स्कैन करके ${fmt(netPend)} UPI से भेजें`
        : `📷 Scan the QR to pay ${fmt(netPend)} by UPI`;
      uqBox.appendChild(svgHolder);
      uqBox.appendChild(cap);
      uqBox.classList.remove('hidden');
    } else {
      uqBox.innerHTML = '';
      uqBox.classList.add('hidden');
    }
    // Updates Stage B: E-Way / E-Invoice portal docs — top-plan users get
    // the download buttons + portal links; everyone else sees an honest
    // upgrade note (no broken buttons). Readiness warnings come from the
    // server (portal_docs) so the user knows what to fix before filing.
    hideErr('idPortalErr');
    const pd = r.portal_docs || {};
    const readyBox = $('idPortalReady');
    const warns = [];
    if (pd.business_gstin_missing) warns.push(isHi() ? '⚠️ Tumhara GSTIN Settings me nahi bhara — file ke liye GSTIN zaroori hai.' : '⚠️ Your GSTIN is not set in Settings — the file needs it.');
    if (pd.items_missing_hsn > 0) warns.push(isHi() ? `⚠️ Is bill ke ${pd.items_missing_hsn} item(s) par HSN code nahi hai — Products me bharo, warna file nahi banegi.` : `⚠️ ${pd.items_missing_hsn} item(s) on this bill have no HSN code — add them in Products, otherwise the file cannot be made.`);
    if (warns.length) { readyBox.textContent = warns.join(' '); readyBox.classList.remove('hidden'); }
    else { readyBox.textContent = ''; readyBox.classList.add('hidden'); }
    if (pd.top_plan) {
      $('idPortalBtns').classList.remove('hidden');
      $('idPortalUpgrade').classList.add('hidden');
    } else {
      $('idPortalBtns').classList.add('hidden');
      const up = $('idPortalUpgrade');
      up.textContent = isHi()
        ? `🔒 Ye feature sirf top plan${pd.top_plan_name ? ' (' + pd.top_plan_name + ')' : ''} me hai. Generation portal par free hota hai — plan upgrade karne par ready file yahi se mil jayegi.`
        : `🔒 This feature is part of the top plan${pd.top_plan_name ? ' (' + pd.top_plan_name + ')' : ''}. Generation is free on the government portal — upgrade and the ready file will be right here.`;
      up.classList.remove('hidden');
    }
    // Stage 5: reminder only when paisa baaki hai AND a registered customer hai.
    hideErr('idWaErr');
    $('idWaPhoneWrap').classList.add('hidden');
    $('idWaPhone').value = '';
    $('idWaRemind').classList.toggle('hidden', !(inv.pending_amount > 0 && inv.customer_id));
    $('invPayAmount').value = inv.pending_amount > 0 ? inv.pending_amount : '';
    $('invoiceDetailCard').classList.remove('hidden');
    $('invoiceDetailCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { showErr('invListErr', stage3Friendly(e)); }
}
$('idClose').addEventListener('click', () => { $('invoiceDetailCard').classList.add('hidden'); currentInvoiceId = null; currentInvoiceDetail = null; });
// Feature 5: bill ki due date badlo / hatao.
$('idDueSave').addEventListener('click', async () => {
  if (!currentInvoiceId) return;
  hideErr('idDueErr');
  try {
    await api('POST', `/api/invoices/${currentInvoiceId}/due-date`, { due_date: $('idDueDate').value || null });
    openInvoiceDetail(currentInvoiceId);
    loadAlerts();
  } catch (err) { showErr('idDueErr', friendly(err)); }
});
// ---------- Feature 2: invoice detail — returns render + submit ----------
function renderInvoiceReturns(r) {
  hideErr('idReturnErr');
  const inv = r.invoice;
  const list = $('idReturnsList');
  list.innerHTML = '';
  const rets = r.returns || [];
  if (rets.length) {
    const tbl = document.createElement('table');
    tbl.innerHTML = `<thead><tr><th>Credit Note</th><th>${isHi() ? 'तारीख़' : 'Date'}</th><th>${isHi() ? 'वापसी कुल' : 'Return total'}</th><th>GST</th><th></th></tr></thead>`;
    const tb = document.createElement('tbody');
    rets.forEach((rt) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><b>CN${rt.return_no}</b>${rt.reason ? `<div style="color:var(--muted);font-size:12px"></div>` : ''}</td><td>${esc(rt.date)}</td><td>${fmt(rt.total_amount)}</td><td>${fmt(rt.gst_amount)}</td><td style="white-space:nowrap"></td>`;
      if (rt.reason) tr.children[0].querySelector('div').textContent = rt.reason;
      const wa = document.createElement('button');
      wa.className = 'btn btn-wa btn-sm'; wa.textContent = '💬 WhatsApp';
      wa.addEventListener('click', () => sendReturnWhatsApp(rt.id, 'idReturnErr'));
      tr.children[4].appendChild(wa);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    list.appendChild(tbl);
  }
  $('idReturnsRow').classList.toggle('hidden', !rets.length);
  $('idNetRow').classList.toggle('hidden', !rets.length);
  $('idReturnsTotal').textContent = fmt(r.returns_total || 0);
  $('idNetTotal').textContent = fmt(r.net_total !== undefined ? r.net_total : inv.total);
  // Return form: sirf woh items jinki returnable qty bachi hai.
  const box = $('idReturnItems');
  box.innerHTML = '';
  const returnable = (r.items || []).filter((it) => Number(it.returnable_qty) > 0);
  $('idReturnForm').style.display = returnable.length ? '' : 'none';
  returnable.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'row2';
    row.style.alignItems = 'end';
    row.innerHTML = `<div class="field" style="margin:0"><label></label><div class="hint" style="margin:0"></div></div>
      <div class="field" style="margin:0"><label>${isHi() ? 'वापसी Qty' : 'Return qty'}</label><input class="input ri-qty" type="number" min="0" step="0.01" value="0" max="${Number(it.returnable_qty)}" data-item="${it.id}"></div>`;
    row.querySelector('label').textContent = it.product_name;
    row.querySelector('.hint').textContent = `${isHi() ? 'बिका' : 'Sold'} ${fmtQty(it.qty)} · ${isHi() ? 'पहले वापस' : 'already returned'} ${fmtQty(it.returned_qty || 0)} · ${isHi() ? 'अब वापस हो सकता है' : 'returnable now'} ${fmtQty(it.returnable_qty)}`;
    box.appendChild(row);
  });
  $('idReturnReason').value = '';
}
$('idReturnBtn').addEventListener('click', async () => {
  if (!currentInvoiceId) return;
  hideErr('idReturnErr');
  const items = [];
  document.querySelectorAll('#idReturnItems .ri-qty').forEach((inp) => {
    const q = Number(inp.value) || 0;
    if (q > 0) items.push({ invoice_item_id: Number(inp.dataset.item), qty: q });
  });
  if (!items.length) { showErr('idReturnErr', isHi() ? 'Kam se kam ek item ki wapsi qty likho।' : 'Write a return quantity for at least one item.'); return; }
  try {
    await api('POST', `/api/invoices/${currentInvoiceId}/returns`, {
      items, reason: $('idReturnReason').value.trim() || undefined
    });
    openInvoiceDetail(currentInvoiceId);
    const ir = await api('GET', '/api/invoices');
    renderInvoiceList(ir.invoices);
    loadReturns();
    loadDashboardSummary();
  } catch (err) {
    if (err.message === 'return_qty_exceeds' && err.data && Array.isArray(err.data.items)) {
      const names = err.data.items.map((x) => `${x.product_name} (${isHi() ? 'बिका' : 'sold'} ${fmtQty(x.sold)}, ${isHi() ? 'पहले वापस' : 'returned'} ${fmtQty(x.already_returned)})`).join(', ');
      showErr('idReturnErr', (isHi() ? 'Itni wapsi nahi ho sakti: ' : 'Return quantity is more than sold: ') + names);
    } else {
      showErr('idReturnErr', stage3Friendly(err));
    }
  }
});
$('idPrint').addEventListener('click', () => { if (currentInvoiceId) printInvoice(currentInvoiceId); });
$('idPdf').addEventListener('click', () => { if (currentInvoiceId) printInvoice(currentInvoiceId); });
$('idEwayBtn').addEventListener('click', async () => {
  if (!currentInvoiceId) return;
  hideErr('idPortalErr');
  try { await downloadAuthed('/api/invoices/' + currentInvoiceId + '/eway-json', 'eway-bill.json'); }
  catch (e) { showErr('idPortalErr', friendly(e)); }
});
$('idEinvoiceBtn').addEventListener('click', async () => {
  if (!currentInvoiceId) return;
  hideErr('idPortalErr');
  try { await downloadAuthed('/api/invoices/' + currentInvoiceId + '/einvoice-json', 'einvoice.json'); }
  catch (e) { showErr('idPortalErr', friendly(e)); }
});
function showWaPhonePrompt() {
  $('idWaPhoneWrap').classList.remove('hidden');
  $('idWaPhone').focus();
}
$('idWaBill').addEventListener('click', () => {
  if (!currentInvoiceId) return;
  sendBillWhatsApp(currentInvoiceId, 'idWaErr', showWaPhonePrompt);
});
$('idWaGo').addEventListener('click', () => {
  if (!currentInvoiceId) return;
  sendBillWhatsAppWithPhone(currentInvoiceId, $('idWaPhone').value, 'idWaErr');
});
$('idWaRemind').addEventListener('click', () => {
  if (!currentInvoiceDetail || !currentInvoiceDetail.invoice.customer_id) return;
  sendReminderWhatsApp(currentInvoiceDetail.invoice.customer_id, 'idWaErr', () => {
    if (currentInvoiceId) openInvoiceDetail(currentInvoiceId);
  });
});
$('invPayForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('idErr');
  if (!currentInvoiceId) return;
  try {
    await api('POST', `/api/invoices/${currentInvoiceId}/payments`, { amount: Number($('invPayAmount').value), mode: $('invPayMode').value });
    openInvoiceDetail(currentInvoiceId);
    const ir = await api('GET', '/api/invoices');
    renderInvoiceList(ir.invoices);
    loadDashboardSummary();
  } catch (err) { showErr('idErr', stage3Friendly(err)); }
});

// ---------- bill print view ----------
async function printInvoice(id) {
  try {
    const r = await api('GET', '/api/invoices/' + id);
    const inv = r.invoice, biz = r.business;
    $('pbBiz').textContent = biz.name || 'Business OS';
    $('pbBizSub').textContent = [biz.city, biz.phone ? 'Phone: ' + biz.phone : ''].filter(Boolean).join(' · ') || ' ';
    $('pbGstin').textContent = inv.gst_enabled && biz.gstin ? 'GSTIN: ' + biz.gstin : '';
    $('pbNo').textContent = '#' + inv.bill_no;
    $('pbDate').textContent = inv.date;
    $('pbCust').textContent = inv.customer_name;
    $('pbCustPhone').textContent = r.customer && r.customer.phone ? 'Mobile: ' + r.customer.phone : '';
    const tb = $('pbItems'); tb.innerHTML = '';
    r.items.forEach((it) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td></td><td class="pb-num">${fmtQty(it.qty)}</td><td class="pb-num">${Number(it.sell_price).toLocaleString('en-IN')}</td><td class="pb-num">${inv.gst_enabled ? Number(it.gst_rate) + '%' : '—'}</td><td class="pb-num">${Number(it.amount).toLocaleString('en-IN')}</td>`;
      tr.children[0].textContent = it.product_name;
      tb.appendChild(tr);
    });
    $('pbSubtotal').textContent = fmt(inv.subtotal);
    $('pbGstRow').style.display = inv.gst_enabled ? '' : 'none';
    $('pbGst').textContent = fmt(inv.gst_amount);
    // CGST/SGST: the two equal halves of the same included GST (sgst takes
    // the rounding remainder, so the halves always add back to gst_amount).
    const cgst = Math.round((Number(inv.gst_amount) / 2) * 100) / 100;
    $('pbCgstRow').style.display = inv.gst_enabled ? '' : 'none';
    $('pbSgstRow').style.display = inv.gst_enabled ? '' : 'none';
    $('pbCgst').textContent = fmt(cgst);
    $('pbSgst').textContent = fmt(Math.round((Number(inv.gst_amount) - cgst) * 100) / 100);
    $('pbDiscount').textContent = fmt(inv.discount);
    $('pbTotal').textContent = fmt(inv.total);
    $('pbPaid').textContent = fmt(inv.paid_amount);
    $('pbBalance').textContent = fmt(inv.pending_amount);
    // Updates Stage A: the same server-generated QR goes on the printed /
    // PDF bill — only when upi_qr came back (UPI ID set + balance due).
    const pbQr = $('pbUpiQr');
    if (r.upi_qr && r.upi_qr.svg) {
      pbQr.innerHTML = `<div class="pb-upi-svg">${r.upi_qr.svg}</div><div style="font-size:12.5px">Scan to pay ${fmt(inv.pending_amount)} by UPI</div>`;
      pbQr.classList.remove('hidden');
    } else {
      pbQr.innerHTML = '';
      pbQr.classList.add('hidden');
    }
    window.print();
  } catch (e) { showErr('billErr', stage3Friendly(e)); }
}

// ---------- customers ----------
async function loadCustomers() {
  hideErr('custErr');
  try {
    const r = await api('GET', '/api/customers');
    const tb = $('custRows');
    tb.innerHTML = '';
    $('custEmpty').classList.toggle('hidden', r.customers.length > 0);
    r.customers.forEach((c) => {
      const tr = document.createElement('tr');
      tr.className = 'clickable';
      tr.innerHTML = `<td><b></b></td><td></td><td></td><td>${fmt(c.total_billed)}</td><td>${fmt(c.total_received)}</td><td>${c.pending > 0 ? `<span class="pend-amt">${fmt(c.pending)}</span>` : (c.pending < 0 ? `<span style="color:var(--green);font-weight:700">${fmt(c.pending)} ${isHi() ? '(credit)' : '(credit)'}</span>` : fmt(0))}</td><td style="white-space:nowrap"></td>`;
      tr.children[0].querySelector('b').textContent = c.name;
      tr.children[1].textContent = c.phone || '—';
      tr.children[2].textContent = c.city || '—';
      tr.addEventListener('click', () => openCustomerDetail(c.id));
      const edit = document.createElement('button');
      edit.className = 'btn btn-ghost btn-sm'; edit.textContent = isHi() ? 'बदलो' : 'Edit';
      edit.addEventListener('click', (ev) => { ev.stopPropagation(); openCustomerForm(c); });
      const del = document.createElement('button');
      del.className = 'btn btn-danger btn-sm'; del.textContent = isHi() ? 'हटाओ' : 'Delete';
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm((isHi() ? 'हटाना है: ' : 'Delete ') + c.name + '?')) return;
        try { await api('DELETE', '/api/customers/' + c.id); loadCustomers(); } catch (err) { showErr('custErr', stage3Friendly(err)); }
      });
      tr.children[6].append(edit, del);
      if (c.pending > 0) {
        const wa = document.createElement('button');
        wa.className = 'btn btn-wa btn-sm'; wa.textContent = isHi() ? '💬 WhatsApp रिमाइंडर' : '💬 WhatsApp Reminder';
        wa.addEventListener('click', (ev) => { ev.stopPropagation(); sendReminderWhatsApp(c.id, 'custErr', () => loadCustomers()); });
        tr.children[6].appendChild(wa);
      }
      tb.appendChild(tr);
    });
  } catch (e) { showErr('custErr', stage3Friendly(e)); }
}
function openCustomerForm(c) {
  hideErr('cfErr');
  $('customerFormCard').classList.remove('hidden');
  $('cfId').value = c ? c.id : '';
  $('cfTitle').textContent = c ? (isHi() ? 'ग्राहक बदलो' : 'Edit customer') : (isHi() ? 'ग्राहक जोड़ो' : 'Add customer');
  $('cfName').value = c ? c.name : '';
  $('cfPhone').value = c ? c.phone : '';
  $('cfCity').value = c ? c.city : '';
  $('cfGstin').value = c ? (c.gstin || '') : '';
  $('cfName').focus();
}
$('addCustomerBtn').addEventListener('click', () => openCustomerForm(null));
$('cfCancel').addEventListener('click', () => $('customerFormCard').classList.add('hidden'));
$('customerForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('cfErr');
  const id = $('cfId').value;
  const body = { name: $('cfName').value, phone: $('cfPhone').value, city: $('cfCity').value, gstin: $('cfGstin').value.trim() };
  try {
    if (id) await api('PUT', '/api/customers/' + id, body); else await api('POST', '/api/customers', body);
    $('customerFormCard').classList.add('hidden');
    loadCustomers();
  } catch (err) { showErr('cfErr', stage3Friendly(err)); }
});
let currentCustomerId = null;
async function openCustomerDetail(id) {
  try {
    const r = await api('GET', '/api/customers/' + id);
    const c = r.customer;
    currentCustomerId = id;
    hideErr('cdErr');
    $('cdWaRemind').classList.toggle('hidden', !(c.pending > 0));
    $('cdTitle').textContent = c.name;
    $('cdMeta').textContent = [c.phone, c.city, c.gstin ? 'GSTIN: ' + c.gstin : ''].filter(Boolean).join(' · ') || '—';
    $('cdBilled').textContent = fmt(c.total_billed);
    $('cdReceived').textContent = fmt(c.total_received);
    // Feature 2: wapsi alag line me, pending hamesha returns ghata kar.
    $('cdReturnsRow').classList.toggle('hidden', !(Number(c.total_returns || 0) > 0));
    $('cdReturns').textContent = '−' + fmt(c.total_returns || 0);
    $('cdPending').textContent = fmt(c.pending) + (c.pending < 0 ? (isHi() ? ' (customer ka credit hai)' : ' (customer credit)') : '');
    // Feature 5: agli due date.
    if (r.due_info) {
      $('cdDueRow').classList.remove('hidden');
      $('cdDue').textContent = `${r.due_info.next_due_date} · ${fmt(r.due_info.amount)}` +
        (Number(r.due_info.total_due_amount) !== Number(r.due_info.amount) ? ` (${isHi() ? 'kul due' : 'total due'} ${fmt(r.due_info.total_due_amount)})` : '');
    } else {
      $('cdDueRow').classList.add('hidden');
    }
    // Feature 4: hisab link box — har baar band haal se shuru; "banao /
    // dekho" dabane par server se maujooda (ya naya) link aata hai.
    currentCustomer = c;
    currentHisabUrl = '';
    hideErr('cdHisabErr');
    $('cdHisabLinkWrap').classList.add('hidden');
    $('cdHisabWa').classList.add('hidden');
    $('cdHisabRegen').classList.add('hidden');
    $('cdHisabOff').classList.add('hidden');
    $('cdHisabMake').textContent = c.hisab_enabled
      ? (isHi() ? 'Hisab link dekho' : 'See hisab link')
      : (isHi() ? 'Hisab link banao' : 'Make hisab link');
    const tb = $('cdInvoices'); tb.innerHTML = '';
    if (!r.invoices.length) {
      tb.innerHTML = `<tr><td colspan="6" style="color:var(--muted)">${isHi() ? 'इस ग्राहक का अभी कोई बिल नहीं।' : 'No bills for this customer yet.'}</td></tr>`;
    }
    r.invoices.forEach((inv) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><b>${billNoLabel(inv)}</b></td><td>${esc(inv.date)}</td><td>${fmt(inv.total)}</td><td>${fmt(inv.paid_amount)}</td><td>${inv.pending_amount > 0 ? `<span class="pend-amt">${fmt(inv.pending_amount)}</span>` : fmt(0)}</td><td>${statusTag(inv.status)}${syncBadge(inv)}</td>`;
      tb.appendChild(tr);
    });
    $('customerDetailCard').classList.remove('hidden');
    $('customerDetailCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { showErr('custErr', stage3Friendly(e)); }
}
$('cdClose').addEventListener('click', () => { $('customerDetailCard').classList.add('hidden'); currentCustomerId = null; });
$('cdWaRemind').addEventListener('click', () => {
  if (!currentCustomerId) return;
  sendReminderWhatsApp(currentCustomerId, 'cdErr', () => {
    $('customerDetailCard').classList.add('hidden');
    currentCustomerId = null;
    loadCustomers();
  });
});

// ---------- Feature 4: customer hisab link actions ----------
// Poora URL frontend banata hai: page BACKEND par khulta hai (wahi
// origin jahan API hai), isliye base = apiBase() (split deploy me
// Vercel wale page se API origin), warna isi origin se.
let currentCustomer = null;
let currentHisabUrl = '';
function hisabFullUrl(urlPath) { return (apiBase() || location.origin) + urlPath; }
function showHisabUrl(url) {
  currentHisabUrl = url;
  $('cdHisabUrl').value = url;
  $('cdHisabLinkWrap').classList.remove('hidden');
  $('cdHisabWa').classList.remove('hidden');
  $('cdHisabRegen').classList.remove('hidden');
  $('cdHisabOff').classList.remove('hidden');
}
$('cdHisabMake').addEventListener('click', async () => {
  if (!currentCustomerId) return;
  hideErr('cdHisabErr');
  try {
    const r = await api('POST', `/api/customers/${currentCustomerId}/hisab-link`, {});
    showHisabUrl(hisabFullUrl(r.url_path));
    if (currentCustomer) currentCustomer.hisab_enabled = true;
  } catch (err) { showErr('cdHisabErr', stage3Friendly(err)); }
});
$('cdHisabCopy').addEventListener('click', async () => {
  if (!currentHisabUrl) return;
  try { await navigator.clipboard.writeText(currentHisabUrl); $('cdHisabCopy').textContent = isHi() ? 'Copy ho gaya ✓' : 'Copied ✓'; setTimeout(() => { $('cdHisabCopy').textContent = isHi() ? 'लिंक copy करो' : 'Copy link'; }, 1500); }
  catch (e) { $('cdHisabUrl').select(); document.execCommand && document.execCommand('copy'); }
});
$('cdHisabWa').addEventListener('click', () => {
  if (!currentHisabUrl) return;
  const phone = currentCustomer ? waNum(currentCustomer.phone) : '';
  if (!phone) { showErr('cdHisabErr', isHi() ? 'Customer ka mobile number nahi hai — pehle number jodo.' : 'The customer has no mobile number — add it first.'); return; }
  hideErr('cdHisabErr');
  const msg = isHi()
    ? `Namaste ${currentCustomer.name} ji, ${me.business.name} se — aapka pura hisab yahan dekh sakte hain (bills, payments aur baaki): ${currentHisabUrl}`
    : `Namaste ${currentCustomer.name} ji, from ${me.business.name} — you can see your full hisab here (bills, payments and balance): ${currentHisabUrl}`;
  window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(msg), '_blank');
});
$('cdHisabRegen').addEventListener('click', async () => {
  if (!currentCustomerId) return;
  if (!confirm(isHi() ? 'Naya link banega aur PURANA link turant band ho jayega. Pakka?' : 'A new link will be made and the OLD link will stop working at once. Sure?')) return;
  hideErr('cdHisabErr');
  try {
    const r = await api('POST', `/api/customers/${currentCustomerId}/hisab-link/regenerate`, {});
    showHisabUrl(hisabFullUrl(r.url_path));
  } catch (err) { showErr('cdHisabErr', stage3Friendly(err)); }
});
$('cdHisabOff').addEventListener('click', async () => {
  if (!currentCustomerId) return;
  if (!confirm(isHi() ? 'Hisab link band kar dein? Customer phir hisab nahi dekh payega.' : 'Turn the hisab link off? The customer will no longer see their hisab.')) return;
  hideErr('cdHisabErr');
  try {
    await api('POST', `/api/customers/${currentCustomerId}/hisab-link/disable`, {});
    currentHisabUrl = '';
    $('cdHisabLinkWrap').classList.add('hidden');
    $('cdHisabWa').classList.add('hidden');
    $('cdHisabRegen').classList.add('hidden');
    $('cdHisabOff').classList.add('hidden');
    if (currentCustomer) currentCustomer.hisab_enabled = false;
    $('cdHisabMake').textContent = isHi() ? 'Hisab link banao' : 'Make hisab link';
  } catch (err) { showErr('cdHisabErr', stage3Friendly(err)); }
});

// =====================================================================
// ---------- Stage 4: Expenses / Reports / Profit (owner-only) ----------
// =====================================================================
function stage4Friendly(err) { return stage3Friendly(err); }

// =====================================================================
// ---------- Stage 5: WhatsApp click-to-send ----------
// The server builds a wa.me link with a ready TEXT message (bills cannot
// attach a PDF through wa.me — Print stays the PDF route). Clicking only
// OPENS WhatsApp; the owner presses send. Nothing is auto-sent.
// =====================================================================
function stage5Friendly(err) {
  const map = {
    'customer_phone_missing': 'Customer ka mobile number nahi hai. Pehle number jodo (customer ko Edit karo) ya bill detail me number daal kar bhejo. / Customer\'s mobile number is missing. Add the number first, or type it in the bill detail.',
    'no_pending': 'Is customer ka ab kuchh baaki nahi hai. / Nothing is pending for this customer now.'
  };
  return map[err.message] || stage4Friendly(err);
}

// Opens the WhatsApp bill for an invoice. On customer_phone_missing it calls
// onNeedPhone() (each screen shows its own inline number input there).
async function sendBillWhatsApp(invoiceId, errId, onNeedPhone) {
  hideErr(errId);
  try {
    const r = await api('GET', `/api/invoices/${invoiceId}/whatsapp-link`);
    window.open(r.url, '_blank');
  } catch (err) {
    if (err.message === 'customer_phone_missing' && onNeedPhone) { onNeedPhone(); return; }
    showErr(errId, stage5Friendly(err));
  }
}
// Retry of the bill send with a manually typed number (?phone= override).
async function sendBillWhatsAppWithPhone(invoiceId, phone, errId) {
  hideErr(errId);
  const p = (phone || '').trim();
  if (!p) { showErr(errId, isHi() ? 'Pehle WhatsApp number likho।' : 'Pehle WhatsApp number likho.'); return; }
  try {
    const r = await api('GET', `/api/invoices/${invoiceId}/whatsapp-link?phone=${encodeURIComponent(p)}`);
    window.open(r.url, '_blank');
  } catch (err) { showErr(errId, stage5Friendly(err)); }
}
// Opens the WhatsApp udhaar reminder for a customer. onNoPending lets the
// caller refresh its list when everything is already collected.
async function sendReminderWhatsApp(customerId, errId, onNoPending) {
  hideErr(errId);
  try {
    const r = await api('GET', `/api/customers/${customerId}/reminder-link`);
    window.open(r.url, '_blank');
  } catch (err) {
    if (err.message === 'no_pending' && onNoPending) { onNoPending(); return; }
    showErr(errId, stage5Friendly(err));
  }
}

// =====================================================================
// ---------- Feature 5: Due & Alerts (dashboard top) ----------
// Automation = SURFACING: late/due/low-stock khud upar aa jata hai.
// WhatsApp hamesha ek click par khulta hai — apne aap kuch nahi jata.
// =====================================================================
function waNum(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;
  return d;
}
async function loadAlerts() {
  const box = $('alertsBody');
  if (!box || !me) return;
  hideErr('alertsErr');
  try {
    const a = await api('GET', '/api/alerts');
    box.innerHTML = '';
    let any = false;
    const head = (txt, color) => {
      const h = document.createElement('div');
      h.style.cssText = 'font-weight:700;margin:10px 0 4px;color:' + color;
      h.textContent = txt;
      box.appendChild(h);
    };
    const custRow = (g, kind) => {
      any = true;
      const row = document.createElement('div');
      row.className = 'alert-row';
      const when = kind === 'overdue'
        ? `<span style="color:var(--red);font-weight:700">${g.days} ${isHi() ? 'din late' : 'days late'}</span>`
        : kind === 'today'
          ? `<span style="color:var(--amber);font-weight:700">${isHi() ? 'Aaj dena hai' : 'Due today'}</span>`
          : `<span>${g.days} ${isHi() ? 'din me dena hai' : 'days left'} · ${esc(g.oldest_due_date)}</span>`;
      row.innerHTML = `<span><b></b> · ${fmt(g.amount)} · ${g.bill_count} ${isHi() ? 'bill' : 'bills'} · ${when}</span>`;
      row.querySelector('b').textContent = g.customer_name;
      const rem = document.createElement('button');
      rem.className = 'btn btn-wa btn-sm';
      rem.textContent = isHi() ? '💬 रिमाइंडर' : '💬 Remind';
      rem.addEventListener('click', () => sendReminderWhatsApp(g.customer_id, 'alertsErr', () => loadAlerts()));
      row.appendChild(rem);
      box.appendChild(row);
    };
    const supRow = (g, kind) => {
      any = true;
      const row = document.createElement('div');
      row.className = 'alert-row';
      const when = kind === 'overdue'
        ? `<span style="color:var(--red);font-weight:700">${g.days} ${isHi() ? 'din late' : 'days late'}</span>`
        : kind === 'today'
          ? `<span style="color:var(--amber);font-weight:700">${isHi() ? 'Aaj dena hai' : 'Due today'}</span>`
          : `<span>${g.days} ${isHi() ? 'din me dena hai' : 'days left'} · ${esc(g.oldest_due_date)}</span>`;
      row.innerHTML = `<span>🚚 <b></b> · ${fmt(g.amount)} · ${when}</span>`;
      row.querySelector('b').textContent = g.supplier_name;
      if (g.phone) {
        const wa = document.createElement('button');
        wa.className = 'btn btn-wa btn-sm';
        wa.textContent = '💬 WhatsApp';
        wa.addEventListener('click', () => {
          const msg = isHi()
            ? `Namaste, ${me.business.name} se — aapko ${fmt(g.amount)} dena baaki hai. Hisab ke liye dhanyavaad.`
            : `Namaste, from ${me.business.name} — ${fmt(g.amount)} is pending to you. Thank you.`;
          window.open('https://wa.me/' + waNum(g.phone) + '?text=' + encodeURIComponent(msg), '_blank');
        });
        row.appendChild(wa);
      }
      box.appendChild(row);
    };
    const cd = a.customer_due || { overdue: [], due_today: [], due_soon: [] };
    const sd = a.supplier_due || { overdue: [], due_today: [], due_soon: [] };
    if (cd.overdue.length) { head(isHi() ? '🔴 Late hai — pehle inko dekho' : '🔴 Overdue — see these first', 'var(--red)'); cd.overdue.forEach((g) => custRow(g, 'overdue')); }
    if (cd.due_today.length) { head(isHi() ? '🟠 Aaj due hai' : '🟠 Due today', 'var(--amber)'); cd.due_today.forEach((g) => custRow(g, 'today')); }
    if (cd.due_soon.length) { head(isHi() ? '🟡 Aane wale 3 din me due' : '🟡 Due in the next 3 days', 'var(--ink)'); cd.due_soon.forEach((g) => custRow(g, 'soon')); }
    if (sd.overdue.length || sd.due_today.length || sd.due_soon.length) {
      head(isHi() ? '🚚 Supplier ko dena hai' : '🚚 To pay suppliers', 'var(--ink)');
      sd.overdue.forEach((g) => supRow(g, 'overdue'));
      sd.due_today.forEach((g) => supRow(g, 'today'));
      sd.due_soon.forEach((g) => supRow(g, 'soon'));
    }
    if (a.low_stock && a.low_stock.length) {
      any = true;
      head(isHi() ? '📦 Stock kam hai' : '📦 Low stock', 'var(--amber)');
      const chips = document.createElement('div');
      chips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      a.low_stock.forEach((p) => {
        const c = document.createElement('span');
        c.className = 'tag tag-part';
        c.textContent = `${p.name} — ${isHi() ? 'sirf' : 'only'} ${fmtQty(p.stock_qty)} ${isHi() ? 'bacha' : 'left'}`;
        chips.appendChild(c);
      });
      box.appendChild(chips);
    }
    if (!any) {
      box.innerHTML = `<div class="offline-note" style="margin-top:0">🟢 ${isHi() ? 'Sab clear — koi due nahi, stock theek hai.' : 'Sab clear — koi due nahi, stock theek hai.'}</div>`;
    }
  } catch (e) {
    box.innerHTML = `<div class="hint">${isHi() ? 'Alerts nahi aaye.' : 'Alerts could not load.'}</div>`;
  }
}

// =====================================================================
// ---------- Feature 3: Day-End report (dashboard card + Reports view) ----------
// Poora hisab data se khud banta hai — koi manual entry nahi hai.
// =====================================================================
function dayEndRowsHtml(r) {
  const collLine = `${fmt(r.collections.total)} <span style="color:var(--muted)">(Cash ${fmt(r.collections.cash)} · UPI ${fmt(r.collections.upi)}${r.collections.other > 0 ? ' · ' + (isHi() ? 'doosra' : 'Other') + ' ' + fmt(r.collections.other) : ''})</span>`;
  return `<div class="sum-row"><span>🧾 ${isHi() ? 'Bikri' : 'Sale'} (${r.sales.bills_count} ${isHi() ? 'bill' : 'bills'})</span><b>${fmt(r.sales.total)}</b></div>` +
    (r.sales.returns_total > 0 ? `<div class="sum-row"><span>↩️ ${isHi() ? 'Wapsi (returns)' : 'Returns'}</span><span>−${fmt(r.sales.returns_total)}</span></div>` : '') +
    `<div class="sum-row"><span>💵 ${isHi() ? 'Vasooli (aaj mili)' : 'Collections (received today)'}</span><span>${collLine}</span></div>` +
    `<div class="sum-row"><span>📕 ${isHi() ? 'Naya udhaar diya' : 'New credit given'}</span><span>${fmt(r.new_credit_given)}</span></div>` +
    `<div class="sum-row"><span>💸 ${isHi() ? 'Kharcha' : 'Expenses'} (${r.expenses.count})</span><span>${fmt(r.expenses.total)}</span></div>` +
    `<div class="sum-row"><span>🚚 ${isHi() ? 'Supplier ko diya' : 'Paid to suppliers'}</span><span>${fmt(r.supplier_payments.total)}</span></div>`;
}
async function loadDayEndDash() {
  const card = $('dayEndDashCard');
  if (!card || !me) return;
  if (me.user.role !== 'owner') { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  try {
    const r = await api('GET', '/api/reports/day-end');
    $('dayEndDashBody').innerHTML = dayEndRowsHtml(r);
  } catch (e) {
    $('dayEndDashBody').innerHTML = `<div class="hint">${isHi() ? 'Day-end report nahi aayi.' : 'Day-end report could not load.'}</div>`;
  }
}
$('dayEndDashWa').addEventListener('click', async () => {
  hideErr('dayEndDashErr');
  try {
    const r = await api('GET', '/api/reports/day-end/whatsapp-link');
    window.open(r.url, '_blank');
  } catch (err) { showErr('dayEndDashErr', friendly(err)); }
});
async function loadDayEndReport() {
  const inp = $('deDate');
  if (!inp) return;
  if (!inp.value) inp.value = new Date().toISOString().slice(0, 10);
  hideErr('deErr');
  try {
    const r = await api('GET', '/api/reports/day-end?date=' + encodeURIComponent(inp.value));
    $('deBody').innerHTML = dayEndRowsHtml(r);
  } catch (e) { showErr('deErr', friendly(e)); }
}
$('deDate').addEventListener('change', loadDayEndReport);
$('deWaBtn').addEventListener('click', async () => {
  hideErr('deErr');
  try {
    const d = $('deDate').value || new Date().toISOString().slice(0, 10);
    const r = await api('GET', '/api/reports/day-end/whatsapp-link?date=' + encodeURIComponent(d));
    window.open(r.url, '_blank');
  } catch (err) { showErr('deErr', friendly(err)); }
});

// ---------- dashboard finance cards (owner sees numbers, staff sees lock) ----------
async function loadDashboardFinance() {
  if (!me) return;
  if (me.user.role !== 'owner') {
    $('dashExpVal').textContent = '🔒';
    $('dashExpSub').textContent = isHi() ? 'सिर्फ़ owner के लिए' : 'Sirf owner ke liye';
    $('dashProfitVal').textContent = '🔒';
    $('dashProfitSub').textContent = isHi() ? 'सिर्फ़ owner के लिए' : 'Sirf owner ke liye';
    return;
  }
  try {
    const f = await api('GET', '/api/dashboard-finance');
    $('dashExpVal').textContent = fmt(f.todays_expense);
    $('dashExpSub').textContent = isHi() ? 'आज के सारे खर्चे' : "All of today's expenses";
    const pv = $('dashProfitVal');
    pv.textContent = fmt(f.todays_net_profit);
    pv.style.color = f.todays_net_profit < 0 ? 'var(--red)' : 'var(--green)';
    $('dashProfitSub').textContent = isHi() ? 'बिक्री − बिके माल की लागत − खर्चा' : 'Sale − cost of goods sold − expenses';
  } catch (e) { /* best-effort card */ }
}

// ---------- expenses ----------
const EXP_CATS = {
  Rent: ['Rent', 'किराया'], Salary: ['Salary', 'तनख़्वाह'], Electricity: ['Electricity', 'बिजली'],
  Transport: ['Transport', 'आना-जाना / भाड़ा'], Packing: ['Packing', 'पैकिंग'], Food: ['Food', 'खाना-पीना'],
  Maintenance: ['Maintenance', 'मरम्मत'], Other: ['Other', 'अन्य']
};
function catLabel(key) { const c = EXP_CATS[key]; return c ? (isHi() ? c[1] : c[0]) : key; }
let expYM = null; // 'YYYY-MM' being viewed
function ymNow() { return new Date().toISOString().slice(0, 7); }
function ymRange(ym) {
  const parts = ym.split('-').map(Number);
  const last = new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate();
  return { from: ym + '-01', to: ym + '-' + String(last).padStart(2, '0') };
}
function ymShift(ym, delta) {
  const parts = ym.split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
async function loadExpenses() {
  if (!expYM) expYM = ymNow();
  $('expMonth').value = expYM;
  hideErr('expErr');
  const range = ymRange(expYM);
  const monthName = new Date(expYM + '-02T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  $('expMonthName').textContent = monthName;
  try {
    const r = await api('GET', `/api/expenses?from=${range.from}&to=${range.to}`);
    $('expMonthTotal').textContent = fmt(r.total);
    // category quick totals from the same list
    const byCat = {};
    r.expenses.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount); });
    const catBox = $('expCatTotals');
    catBox.innerHTML = '';
    const cats = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
    if (!cats.length) {
      catBox.innerHTML = `<div class="hint">${isHi() ? 'इस महीने कोई खर्चा नहीं।' : 'No expenses this month.'}</div>`;
    } else {
      const max = Math.max(...cats.map((c) => byCat[c]));
      cats.forEach((c) => {
        const row = document.createElement('div');
        row.className = 'cat-row';
        row.innerHTML = `<span style="min-width:110px"></span><span class="cat-track"><span class="cat-fill" style="width:${Math.max(4, Math.round(byCat[c] / max * 100))}%"></span></span><span class="cat-amt">${fmt(byCat[c])}</span>`;
        row.children[0].textContent = catLabel(c);
        catBox.appendChild(row);
      });
    }
    const tb = $('expRows');
    tb.innerHTML = '';
    $('expEmpty').classList.toggle('hidden', r.expenses.length > 0);
    r.expenses.forEach((e) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(e.date)}</td><td><b></b><div style="color:var(--muted);font-size:12px"></div></td><td><span class="tag tag-part"></span></td><td>${esc(e.payment_mode)}</td><td><b>${fmt(e.amount)}</b></td><td style="white-space:nowrap"></td>`;
      tr.children[1].querySelector('b').textContent = e.title;
      tr.children[1].querySelector('div').textContent = e.notes || '';
      tr.children[2].querySelector('.tag').textContent = catLabel(e.category);
      const edit = document.createElement('button');
      edit.className = 'btn btn-ghost btn-sm'; edit.textContent = isHi() ? 'बदलो' : 'Edit';
      edit.addEventListener('click', () => openExpenseForm(e));
      const del = document.createElement('button');
      del.className = 'btn btn-danger btn-sm'; del.textContent = isHi() ? 'हटाओ' : 'Delete';
      del.addEventListener('click', async () => {
        if (!confirm((isHi() ? 'खर्चा हटाना है: ' : 'Delete expense: ') + e.title + '?')) return;
        try { await api('DELETE', '/api/expenses/' + e.id); loadExpenses(); } catch (err) { showErr('expErr', stage4Friendly(err)); }
      });
      tr.children[5].append(edit, del);
      tb.appendChild(tr);
    });
  } catch (e) { showErr('expErr', stage4Friendly(e)); }
}
function openExpenseForm(e) {
  hideErr('efErr');
  $('expenseFormCard').classList.remove('hidden');
  $('efId').value = e ? e.id : '';
  $('efTitle').textContent = e ? (isHi() ? 'खर्चा बदलो' : 'Edit expense') : (isHi() ? 'खर्चा जोड़ो' : 'Add expense');
  $('efName').value = e ? e.title : '';
  $('efCategory').value = e ? e.category : 'Other';
  $('efAmount').value = e ? e.amount : '';
  $('efDate').value = e ? e.date : new Date().toISOString().slice(0, 10);
  $('efMode').value = e ? e.payment_mode : 'Cash';
  $('efNotes').value = e ? e.notes : '';
  $('efName').focus();
  $('expenseFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('addExpenseBtn').addEventListener('click', () => openExpenseForm(null));
$('efCancel').addEventListener('click', () => $('expenseFormCard').classList.add('hidden'));
$('expenseForm').addEventListener('submit', async (e) => {
  e.preventDefault(); hideErr('efErr');
  const id = $('efId').value;
  const body = {
    title: $('efName').value, category: $('efCategory').value,
    amount: Number($('efAmount').value), date: $('efDate').value || undefined,
    payment_mode: $('efMode').value, notes: $('efNotes').value
  };
  try {
    if (id) await api('PUT', '/api/expenses/' + id, body); else await api('POST', '/api/expenses', body);
    // If the saved expense is in another month, jump to that month so it is visible.
    if (body.date) expYM = body.date.slice(0, 7);
    $('expenseFormCard').classList.add('hidden');
    loadExpenses();
  } catch (err) { showErr('efErr', stage4Friendly(err)); }
});
$('expMonth').addEventListener('change', () => { expYM = $('expMonth').value || ymNow(); loadExpenses(); });
$('expPrev').addEventListener('click', () => { expYM = ymShift(expYM || ymNow(), -1); loadExpenses(); });
$('expNext').addEventListener('click', () => { expYM = ymShift(expYM || ymNow(), 1); loadExpenses(); });

// ---------- reports ----------
let repPreset = 'month';
let repCustomRange = null;
function isoOf(d) { return d.toISOString().slice(0, 10); }
function repComputeRange() {
  const now = new Date();
  const today = isoOf(now);
  if (repPreset === 'today') return { from: today, to: today };
  if (repPreset === 'week') {
    const dow = (now.getUTCDay() + 6) % 7; // Monday-start week
    return { from: isoOf(new Date(now.getTime() - dow * 86400000)), to: today };
  }
  if (repPreset === 'lastmonth') {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { from: isoOf(from), to: isoOf(to) };
  }
  if (repPreset === 'custom' && repCustomRange) return repCustomRange;
  return { from: today.slice(0, 8) + '01', to: today };
}
async function loadReports() {
  hideErr('repErr');
  const range = repComputeRange();
  $('repRangeLabel').textContent = range.from + ' → ' + range.to;
  try {
    const [sum, daily, cats, pend] = await Promise.all([
      api('GET', `/api/reports/summary?from=${range.from}&to=${range.to}`),
      api('GET', `/api/reports/daily-sales?from=${range.from}&to=${range.to}`),
      api('GET', `/api/reports/expense-categories?from=${range.from}&to=${range.to}`),
      api('GET', '/api/reports/pending')
    ]);
    $('repSale').textContent = fmt(sum.sale_total);
    $('repBills').textContent = `${sum.bills_count} ${isHi() ? 'बिल' : 'bills'}`;
    const gv = $('repGross');
    gv.textContent = fmt(sum.gross_profit);
    gv.style.color = sum.gross_profit < 0 ? 'var(--red)' : 'var(--ink)';
    $('repExpTotal').textContent = fmt(sum.expenses_total);
    const nv = $('repNet');
    nv.textContent = fmt(sum.net_profit);
    nv.style.color = sum.net_profit < 0 ? 'var(--red)' : 'var(--green)';
    $('repLena').textContent = fmt(sum.pending_collection);
    $('repDena').textContent = fmt(sum.pending_supplier);
    $('repStockValue').textContent = fmt(sum.stock_value);
    renderBarChart($('repDailyChart'), Array.isArray(daily) ? daily : [], 'dayofmonth');
    // expense categories
    const cb = $('repCatList');
    cb.innerHTML = '';
    const catArr = Array.isArray(cats) ? cats : [];
    if (!catArr.length) {
      cb.innerHTML = `<div class="hint">${isHi() ? 'इस समय में कोई खर्चा नहीं।' : 'No expenses in this period.'}</div>`;
    } else {
      const max = Math.max(...catArr.map((c) => Number(c.total)));
      catArr.forEach((c) => {
        const row = document.createElement('div');
        row.className = 'cat-row';
        row.innerHTML = `<span style="min-width:110px"></span><span class="cat-track"><span class="cat-fill" style="width:${Math.max(4, Math.round(Number(c.total) / max * 100))}%"></span></span><span class="cat-amt">${fmt(c.total)}</span>`;
        row.children[0].textContent = catLabel(c.category);
        cb.appendChild(row);
      });
    }
    // pending lists
    const fillPend = (boxId, rows, emptyMsg, withRemind) => {
      const box = $(boxId);
      box.innerHTML = '';
      if (!rows.length) {
        box.innerHTML = `<div class="offline-note" style="margin-top:0">🟢 ${emptyMsg}</div>`;
        return;
      }
      rows.forEach((r) => {
        const row = document.createElement('div');
        row.className = 'pend-row';
        row.innerHTML = `<span></span><span class="amt"></span>`;
        row.children[0].textContent = r.name + (r.phone ? ' · ' + r.phone : '');
        row.children[1].textContent = fmt(r.pending);
        if (withRemind && r.id) {
          const rem = document.createElement('button');
          rem.className = 'btn btn-wa btn-sm';
          rem.textContent = isHi() ? 'रिमाइंडर' : 'Remind';
          rem.addEventListener('click', () => sendReminderWhatsApp(r.id, 'repErr', () => loadReports()));
          row.appendChild(rem);
        }
        box.appendChild(row);
      });
    };
    fillPend('repPendCust', pend.customers || [], isHi() ? 'किसी ग्राहक का उधार बाकी नहीं है।' : 'No customer has pending udhaar.', true);
    fillPend('repPendSup', pend.suppliers || [], isHi() ? 'किसी सप्लायर को कुछ देना बाकी नहीं है।' : 'Nothing pending to any supplier.');
    loadMonthlyReport();
    loadGstReport();
    loadGstr1();
    loadDayEndReport();
  } catch (e) { showErr('repErr', stage4Friendly(e)); }
}
document.querySelectorAll('#repPresets button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#repPresets button').forEach((x) => x.classList.remove('on'));
  b.classList.add('on');
  repPreset = b.dataset.preset;
  $('repCustomWrap').classList.toggle('hidden', repPreset !== 'custom');
  if (repPreset === 'custom') {
    const r = repComputeRange.call(null) || {};
    const base = (() => { const t = isoOf(new Date()); return { from: t.slice(0, 8) + '01', to: t }; })();
    $('repFrom').value = (repCustomRange && repCustomRange.from) || base.from;
    $('repTo').value = (repCustomRange && repCustomRange.to) || base.to;
    return; // wait for Apply
  }
  loadReports();
}));
$('repApply').addEventListener('click', () => {
  const from = $('repFrom').value, to = $('repTo').value;
  if (!from || !to || from > to) { showErr('repErr', isHi() ? 'सही तारीख़ चुनो — From, To से पहले हो।' : 'Pick valid dates — From must be before To.'); return; }
  repCustomRange = { from, to };
  loadReports();
});

// ---------- monthly + GST reports (SaaS Stage 1) ----------
let lastGstReport = null;
let lastMonthlyReport = null;
function monthLabel(ym) {
  return new Date(ym + '-02T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
async function loadMonthlyReport() {
  const inp = $('repMonth');
  if (!inp || !inp.value) { if (inp) inp.value = ymNow(); else return; }
  try {
    const r = await api('GET', '/api/reports/monthly?month=' + encodeURIComponent(inp.value));
    lastMonthlyReport = r;
    const s = r.summary;
    $('repMonthlySummary').innerHTML =
      `<div class="sum-row"><span>${isHi() ? 'बिक्री' : 'Sale'} (${s.bills_count} ${isHi() ? 'बिल' : 'bills'})</span><b>${fmt(s.sale_total)}</b></div>` +
      `<div class="sum-row"><span>${isHi() ? 'खर्चा' : 'Expenses'}</span><span>${fmt(s.expenses_total)}</span></div>` +
      `<div class="sum-row total"><span>${isHi() ? 'असली मुनाफ़ा' : 'Net Profit'}</span><span style="color:${s.net_profit < 0 ? 'var(--red)' : 'var(--green)'}">${fmt(s.net_profit)}</span></div>`;
    const tb = $('repMonthlyBody');
    tb.innerHTML = '';
    [...r.months].reverse().forEach((m) => {
      const tr = document.createElement('tr');
      if (m.month === r.month) tr.style.background = '#F7FAFF';
      tr.innerHTML = `<td>${m.month === r.month ? '<b>' + monthLabel(m.month) + '</b>' : monthLabel(m.month)}</td><td>${fmt(m.sale_total)}</td><td>${fmt(m.expenses_total)}</td><td style="font-weight:700;color:${m.net_profit < 0 ? 'var(--red)' : 'var(--green)'}">${fmt(m.net_profit)}</td>`;
      tb.appendChild(tr);
    });
  } catch (e) {
    $('repMonthlySummary').innerHTML = `<div class="hint">${isHi() ? 'महीने की रिपोर्ट नहीं आई।' : 'Monthly report could not load.'}</div>`;
  }
}
$('repMonth').addEventListener('change', loadMonthlyReport);

async function loadGstReport() {
  const inp = $('gstMonth');
  if (!inp) return;
  if (!inp.value) inp.value = ymNow();
  const box = $('gstReportBody');
  try {
    const r = await api('GET', '/api/reports/gst?month=' + encodeURIComponent(inp.value));
    lastGstReport = r;
    if (!r.gst_enabled) {
      box.innerHTML = `<div class="offline-note" style="margin-top:0">ℹ️ ${isHi() ? 'इस बिज़नेस के लिए GST बंद (OFF) है — इसलिए GST रिपोर्ट लागू नहीं है। GST चालू करना हो तो Settings में जाओ।' : 'GST is OFF for this business — the GST report does not apply. To turn it on, go to Settings.'}</div>`;
      return;
    }
    let html =
      `<div class="sum-row"><span>${isHi() ? 'कुल बिक्री' : 'Total sale'} (${r.bills_count} ${isHi() ? 'बिल' : 'bills'})</span><b>${fmt(r.total_sales)}</b></div>` +
      `<div class="sum-row"><span>${isHi() ? 'Taxable value (GST हटाकर)' : 'Taxable value (without GST)'}</span><span>${fmt(r.taxable_value)}</span></div>` +
      `<div class="sum-row"><span>${isHi() ? 'Output GST (बिक्री पर)' : 'Output GST (on sales)'}</span><b>${fmt(r.output_gst)}</b></div>` +
      `<div class="sum-row"><span>· CGST</span><span>${fmt(r.cgst)}</span></div>` +
      `<div class="sum-row"><span>· SGST</span><span>${fmt(r.sgst)}</span></div>` +
      (r.returns_count > 0 ? `<div class="sum-row"><span>↩️ ${isHi() ? 'Wapsi / Credit Notes' : 'Returns / Credit Notes'} (${r.returns_count})</span><span>−${fmt(r.returns_total)} · GST −${fmt(r.returns_gst)}</span></div><div class="hint">${isHi() ? 'Upar wali Output GST aur taxable value me is mahine ki wapsi pehle se ghata hui hai (credit note usi mahine me ginta hai jis mahine wapsi hui).' : 'The Output GST and taxable value above are already net of this month\'s returns (a credit note counts in the month the return happened).'}</div>` : '') +
      `<div class="sum-row"><span>${isHi() ? 'Input GST (खरीद पर, सामान के GST % से गिना)' : 'Input GST (on purchases, from product GST %)'}</span><span>${fmt(r.input_gst)}</span></div>` +
      `<div class="sum-row total"><span>${isHi() ? 'देना GST (Output − Input)' : 'Net GST payable (Output − Input)'}</span><span>${fmt(r.net_gst_payable)}</span></div>`;
    if (r.by_rate.length) {
      html += `<table style="margin-top:10px"><thead><tr><th>GST %</th><th>${isHi() ? 'रकम (GST सहित)' : 'Amount (incl. GST)'}</th><th>Taxable</th><th>GST</th><th>CGST</th><th>SGST</th></tr></thead><tbody>` +
        r.by_rate.map((x) => `<tr><td>${Number(x.rate)}%</td><td>${fmt(x.amount)}</td><td>${fmt(x.taxable_value)}</td><td>${fmt(x.gst)}</td><td>${fmt(x.cgst)}</td><td>${fmt(x.sgst)}</td></tr>`).join('') +
        `</tbody></table>`;
    } else {
      html += `<div class="hint" style="margin-top:8px">${isHi() ? 'इस महीने कोई GST बिल नहीं बना।' : 'No GST bills in this month.'}</div>`;
    }
    box.innerHTML = html;
  } catch (e) {
    box.innerHTML = `<div class="hint">${isHi() ? 'GST रिपोर्ट नहीं आई।' : 'GST report could not load.'}</div>`;
  }
}
$('gstMonth').addEventListener('change', loadGstReport);

// ---------- Updates Stage B: GSTR-1 portal-ready output (owner-only) ----------
async function loadGstr1() {
  const card = $('gstr1Card');
  if (!card) return;
  if (!me || me.user.role !== 'owner') { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  const inp = $('gstr1Month');
  if (!inp.value) inp.value = ($('gstMonth') && $('gstMonth').value) || ymNow();
  hideErr('gstr1Err');
  const box = $('gstr1Body');
  try {
    const r = await api('GET', '/api/reports/gstr1?month=' + encodeURIComponent(inp.value));
    if (!r.gst_enabled) {
      box.innerHTML = `<div class="offline-note" style="margin-top:0">ℹ️ ${isHi() ? 'इस बिज़नेस के लिए GST बंद (OFF) है — GSTR-1 लागू नहीं है।' : 'GST is OFF for this business — GSTR-1 does not apply.'}</div>`;
      return;
    }
    let html =
      `<div class="sum-row"><span>${isHi() ? 'कुल बिक्री' : 'Total sale'} (${r.bills_count} ${isHi() ? 'बिल' : 'bills'})</span><b>${fmt(r.total_sales)}</b></div>` +
      `<div class="sum-row"><span>${isHi() ? 'Taxable value' : 'Taxable value'}</span><span>${fmt(r.taxable_value)}</span></div>` +
      `<div class="sum-row"><span>${isHi() ? 'Output GST (GST report se mila hua)' : 'Output GST (matches the GST report)'}</span><b>${fmt(r.output_gst)}</b></div>` +
      `<div class="sum-row"><span>· B2B (${r.b2b.invoices} ${isHi() ? 'बिल' : 'bills'} — ${isHi() ? 'जिन ग्राहकों का GSTIN hai' : 'customers with GSTIN'})</span><span>${fmt(r.b2b.value)} · GST ${fmt(r.b2b.tax)}</span></div>` +
      `<div class="sum-row"><span>· B2C (${r.b2c.invoices} ${isHi() ? 'बिल' : 'bills'})</span><span>${fmt(r.b2c.value)} · GST ${fmt(r.b2c.tax)}</span></div>`;
    if (r.credit_notes && r.credit_notes.count > 0) {
      const cn = r.credit_notes;
      html += `<div class="sum-row"><span>↩️ ${isHi() ? 'Credit Notes (wapsi)' : 'Credit Notes (returns)'} (${cn.count})</span><span>−${fmt(cn.total_value)} · GST −${fmt(cn.tax)}</span></div>` +
        `<div class="hint">${isHi() ? 'Upar wali taxable value aur Output GST in credit notes ko ghata kar hai. Portal file (JSON) me ye CDNR/CDNUR section me jate hain, CSV register me bhi alag section me dikhte hain.' : 'The taxable value and Output GST above are net of these credit notes. In the portal JSON they appear in the CDNR/CDNUR sections, and in the CSV register as a labeled section.'}</div>` +
        `<table style="margin-top:8px"><thead><tr><th>Credit Note</th><th>${isHi() ? 'तारीख़' : 'Date'}</th><th>${isHi() ? 'असली बिल' : 'Original Bill'}</th><th>Taxable</th><th>GST</th><th>${isHi() ? 'कुल' : 'Total'}</th></tr></thead><tbody>` +
        cn.notes.map((n) => `<tr><td>CN${n.return_no}</td><td>${esc(n.date)}</td><td>#${n.bill_no}</td><td>${fmt(n.taxable_value)}</td><td>${fmt(n.gst_amount)}</td><td>${fmt(n.total)}</td></tr>`).join('') +
        `</tbody></table>`;
    }
    if (r.hsn_summary && r.hsn_summary.length) {
      html += `<table style="margin-top:10px"><thead><tr><th>HSN</th><th>${isHi() ? 'सामान' : 'Item'}</th><th>Qty</th><th>Taxable</th><th>GST</th></tr></thead><tbody>` +
        r.hsn_summary.map((h) => `<tr><td>${esc(h.hsn_code || '—')}</td><td>${esc(h.description || '')}</td><td>${fmtQty(h.qty)}</td><td>${fmt(h.taxable_value)}</td><td>${fmt(h.total_tax)}</td></tr>`).join('') +
        `</tbody></table>`;
    }
    const rd = r.readiness || {};
    const warns = [];
    if (rd.business_gstin_missing) warns.push(isHi() ? 'तुम्हारा GSTIN Settings me nahi bhara hai — file me seller GSTIN khaali jayega.' : 'Your GSTIN is not set in Settings — the file will have a blank seller GSTIN.');
    if (rd.products_missing_hsn > 0) warns.push(isHi() ? `${rd.products_missing_hsn} product(s) par HSN code nahi hai${rd.products_missing_hsn_names && rd.products_missing_hsn_names.length ? ': ' + rd.products_missing_hsn_names.join(', ') : ''} — portal par HSN zaroori hota hai, Products me jaakar bharo.` : `${rd.products_missing_hsn} product(s) have no HSN code — add them in Products before filing.`);
    if (rd.customers_invoiced_without_gstin > 0) warns.push(isHi() ? `Is mahine ke ${rd.customers_invoiced_without_gstin} graahak bina GSTIN ke B2C me gaye hain — koi business customer hai to uska GSTIN Customers me bharo, woh B2B ho jayega.` : `${rd.customers_invoiced_without_gstin} customer(s) this month went to B2C without a GSTIN — add GSTINs in Customers for business buyers.`);
    if (rd.customers_with_invalid_gstin > 0) warns.push(isHi() ? `${rd.customers_with_invalid_gstin} graahak ka GSTIN format galat lag raha hai — woh bhi B2C me gaya hai, GSTIN check karo.` : `${rd.customers_with_invalid_gstin} customer(s) have a GSTIN that looks invalid — they were counted as B2C. Check the GSTIN.`);
    if (warns.length) {
      html += `<div class="offline-note" style="margin-top:10px">⚠️ ${warns.join('<br>⚠️ ')}</div>`;
    } else {
      html += `<div class="hint" style="margin-top:10px">✅ ${isHi() ? 'Sab ready hai — GSTIN aur HSN pure hain.' : 'All ready — GSTIN and HSN are complete.'}</div>`;
    }
    html += `<div class="hint" style="margin-top:8px">${esc(r.note || '')}</div>`;
    box.innerHTML = html;
  } catch (e) {
    box.innerHTML = `<div class="hint">${isHi() ? 'GSTR-1 नहीं आया।' : 'GSTR-1 could not load.'}</div>`;
  }
}
$('gstr1Month').addEventListener('change', loadGstr1);
$('gstr1JsonBtn').addEventListener('click', async () => {
  hideErr('gstr1Err');
  try { await downloadAuthed('/api/reports/gstr1/download?format=json&month=' + encodeURIComponent($('gstr1Month').value || ymNow()), 'gstr1.json'); }
  catch (e) { showErr('gstr1Err', friendly(e)); }
});
$('gstr1CsvBtn').addEventListener('click', async () => {
  hideErr('gstr1Err');
  try { await downloadAuthed('/api/reports/gstr1/download?format=csv&month=' + encodeURIComponent($('gstr1Month').value || ymNow()), 'gstr1-register.csv'); }
  catch (e) { showErr('gstr1Err', friendly(e)); }
});
$('gstPrintBtn').addEventListener('click', async () => {
  if (!lastGstReport || lastGstReport.month !== $('gstMonth').value) await loadGstReport();
  printGstReport();
});
function printGstReport() {
  const r = lastGstReport;
  if (!r) return;
  $('prBiz').textContent = (me && me.business.name) || 'Business OS';
  $('prTitle').textContent = (isHi() ? 'GST रिपोर्ट' : 'GST Report') + ' — ' + monthLabel(r.month);
  $('prSub').textContent = r.gst_enabled
    ? `${r.from} → ${r.to}${r.gstin ? ' · GSTIN: ' + r.gstin : ''}`
    : `${r.from} → ${r.to}`;
  let html = '';
  if (!r.gst_enabled) {
    html = `<p style="font-size:14px">GST is OFF for this business — GST report does not apply. / इस बिज़नेस के लिए GST बंद है।</p>`;
  } else {
    html = `<table><thead><tr><th>Detail</th><th class="pb-num">Amount ₹</th></tr></thead><tbody>` +
      `<tr><td>Total sale (${r.bills_count} bills)</td><td class="pb-num">${fmt(r.total_sales)}</td></tr>` +
      `<tr><td>Taxable value (without GST)</td><td class="pb-num">${fmt(r.taxable_value)}</td></tr>` +
      `<tr><td>Output GST (on sales)</td><td class="pb-num">${fmt(r.output_gst)}</td></tr>` +
      `<tr><td>· CGST</td><td class="pb-num">${fmt(r.cgst)}</td></tr>` +
      `<tr><td>· SGST</td><td class="pb-num">${fmt(r.sgst)}</td></tr>` +
      `<tr><td>Input GST (on purchases, from product GST %)</td><td class="pb-num">${fmt(r.input_gst)}</td></tr>` +
      `<tr><td><b>Net GST payable (Output − Input)</b></td><td class="pb-num"><b>${fmt(r.net_gst_payable)}</b></td></tr>` +
      `</tbody></table>`;
    if (r.by_rate.length) {
      html += `<h3 style="margin:16px 0 6px;font-size:14px">Rate-wise breakup</h3><table><thead><tr><th>GST %</th><th class="pb-num">Amount (incl. GST) ₹</th><th class="pb-num">Taxable ₹</th><th class="pb-num">GST ₹</th><th class="pb-num">CGST ₹</th><th class="pb-num">SGST ₹</th></tr></thead><tbody>` +
        r.by_rate.map((x) => `<tr><td>${Number(x.rate)}%</td><td class="pb-num">${fmt(x.amount)}</td><td class="pb-num">${fmt(x.taxable_value)}</td><td class="pb-num">${fmt(x.gst)}</td><td class="pb-num">${fmt(x.cgst)}</td><td class="pb-num">${fmt(x.sgst)}</td></tr>`).join('') +
        `</tbody></table>`;
    }
  }
  $('prBody').innerHTML = html;
  document.body.classList.add('printing-report');
  const done = () => { document.body.classList.remove('printing-report'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1000);
}

boot();

// =====================================================================
// ---------- SaaS Stage 3: Bharosa wala hisa (frontend) ----------
// Backups/restore UI, CSV exports, sync status + pending badge,
// audit/history, conflicts, help & support.
// =====================================================================

// ---------- file download helper (token-authenticated) ----------
async function downloadAuthed(path, fallbackName) {
  let res;
  try {
    res = await fetch(apiUrl(path), { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  } catch (e) { showConnBanner(); throw new Error('server_unreachable'); }
  hideConnBanner();
  if (!res.ok) {
    let msg = 'request_failed';
    try { const d = await res.json(); if (d.error) msg = d.error; } catch (e) { /* ignore */ }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = /filename="([^"]+)"/.exec(cd);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = m ? m[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------- CSV export buttons (data-export="products|customers|…") ----------
document.querySelectorAll('[data-export]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const kind = btn.dataset.export;
    try { await downloadAuthed('/api/export/' + kind, kind + '.csv'); }
    catch (e) { alert(friendly(e)); }
  });
});

// ---------- backups (owner-only card in Settings) ----------
async function loadBackups() {
  if (!me || me.user.role !== 'owner') return;
  const list = $('backupList');
  if (!list) return;
  try {
    const r = await api('GET', '/api/backups');
    const info = $('backupAutoInfo');
    if (info) {
      info.textContent = isHi()
        ? `ऑटो-बैकअप चालू है — आख़री ${r.auto_backup.retention} snapshots रहते हैं।${r.auto_backup.last_auto_at ? ' आख़री auto-backup: ' + r.auto_backup.last_auto_at : ' अभी कोई auto-backup नहीं बना।'}`
        : `Auto-backup is ON — the last ${r.auto_backup.retention} snapshots are kept.${r.auto_backup.last_auto_at ? ' Last auto-backup: ' + r.auto_backup.last_auto_at : ' No auto-backup yet.'}`;
    }
    list.innerHTML = '';
    if (!r.snapshots.length) {
      list.innerHTML = `<div class="hint">${isHi() ? 'अभी कोई snapshot नहीं।' : 'No snapshots yet.'}</div>`;
      return;
    }
    const tbl = document.createElement('table');
    tbl.innerHTML = `<thead><tr><th>${isHi() ? 'समय' : 'Time'}</th><th>${isHi() ? 'प्रकार' : 'Kind'}</th><th>${isHi() ? 'साइज़' : 'Size'}</th><th></th></tr></thead>`;
    const tb = document.createElement('tbody');
    r.snapshots.forEach((s) => {
      const tr = document.createElement('tr');
      const kindLbl = s.kind === 'auto' ? (isHi() ? 'ऑटो' : 'Auto') : s.kind === 'manual' ? (isHi() ? 'मैन्युअल' : 'Manual') : (isHi() ? 'Restore से पहले' : 'Pre-restore');
      tr.innerHTML = `<td>${esc(s.created_at)}</td><td>${kindLbl}</td><td>${Math.max(1, Math.round(s.size / 1024))} KB</td><td style="white-space:nowrap"></td>`;
      const dl = document.createElement('button');
      dl.className = 'btn btn-soft btn-sm'; dl.type = 'button'; dl.textContent = '⬇';
      dl.title = isHi() ? 'डाउनलोड' : 'Download';
      dl.addEventListener('click', async () => {
        try { await downloadAuthed('/api/backups/' + s.id + '/download', 'backup-' + s.id + '.json'); }
        catch (e) { showErr('backupErr', friendly(e)); }
      });
      const rs = document.createElement('button');
      rs.className = 'btn btn-soft btn-sm'; rs.type = 'button';
      rs.textContent = isHi() ? 'Restore' : 'Restore';
      rs.addEventListener('click', () => restoreBackup(s));
      tr.children[3].append(dl, document.createTextNode(' '), rs);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    list.appendChild(tbl);
  } catch (e) { showErr('backupErr', friendly(e)); }
}

async function restoreBackup(s) {
  const msg = isHi()
    ? `Pakka? ${s.created_at} wala data wapas aa jayega — abhi ka data usse badal jayega. (Restore se pehle abhi ke data ka snapshot apne aap ban jayega.)`
    : `Sure? Your shop data will go back to ${s.created_at} — current data will be replaced. (A snapshot of the current data is taken first, automatically.)`;
  if (!window.confirm(msg)) return;
  hideErr('backupErr');
  try {
    await api('POST', '/api/backups/' + s.id + '/restore');
    alert(isHi() ? 'Restore ho gaya ✓ — purana data wapas aa gaya।' : 'Restored ✓ — your data is back to that snapshot.');
    loadBackups();
    loadDashboardSummary();
    loadDashboardStock();
  } catch (e) { showErr('backupErr', friendly(e)); }
}

const backupNowBtn = $('backupNowBtn');
if (backupNowBtn) backupNowBtn.addEventListener('click', async () => {
  hideErr('backupErr');
  try { await api('POST', '/api/backups'); loadBackups(); }
  catch (e) { showErr('backupErr', friendly(e)); }
});

// ---------- sync status ----------
let syncConfigured = false;
function syncBadge(inv) {
  if (!syncConfigured || !inv || inv.sync_status === 'synced') return '';
  return ` <span class="tag" style="background:#fef3c7;color:#92400e" title="${isHi() ? 'Ye bill abhi cloud par sync nahi hua — number provisional hai' : 'This bill has not synced to the cloud yet — its number is provisional'}">${isHi() ? '⏳ Pending sync' : '⏳ Pending sync'}</span>`;
}
function renderSyncStatus(st) {
  syncConfigured = !!st.configured;
  const dash = $('syncDashCard');
  if (dash) dash.classList.toggle('hidden', !st.configured);
  const body = $('syncStatusBody');
  const dashBody = $('syncDashBody');
  let html;
  if (!st.configured) {
    html = `<div class="hint">${isHi() ? 'Sync set nahi hai — ye copy akeli chal rahi hai (cloud hub connect nahi)।' : 'Sync is not set up — this copy runs on its own (no cloud hub connected).'}</div>`;
  } else if (st.last_result && st.last_result.startsWith('offline')) {
    html = `<div>⚠️ <b>${isHi() ? 'Hub offline hai' : 'Hub is offline'}</b> — ${isHi() ? 'billing chalti rahegi, net aate hi sync ho jayega।' : 'billing keeps working; sync will catch up when the hub is back.'}</div>
      <div class="hint">${isHi() ? 'Pending' : 'Pending'}: ${st.pending_count} · ${isHi() ? 'आख़री sync' : 'Last sync'}: ${esc(st.last_sync_at || '—')}</div>`;
  } else if (st.pending_count > 0) {
    html = `<div>⏳ <b>${st.pending_count} ${isHi() ? 'cheezein sync honi baki hain' : 'items waiting to sync'}</b></div>
      <div class="hint">${isHi() ? 'आख़री sync' : 'Last sync'}: ${esc(st.last_sync_at || '—')} · ${isHi() ? 'टकराव' : 'Conflicts'}: ${st.conflicts_count}</div>`;
  } else {
    html = `<div>✅ <b>${isHi() ? 'Sab sync hai' : 'Everything is synced'}</b></div>
      <div class="hint">${isHi() ? 'आख़री sync' : 'Last sync'}: ${esc(st.last_sync_at || '—')} · ${isHi() ? 'टकराव' : 'Conflicts'}: ${st.conflicts_count}</div>`;
  }
  if (body) body.innerHTML = html;
  if (dashBody) dashBody.innerHTML = html;
}
async function loadSyncStatus() {
  if (!me || me.user.role === 'superadmin') return;
  try {
    const st = await api('GET', '/api/sync/status');
    renderSyncStatus(st);
  } catch (e) { /* status is best-effort UI */ }
}
async function doSyncNow() {
  hideErr('syncErr');
  try {
    const r = await api('POST', '/api/sync/run');
    if (r && r.ok === false) {
      showErr('syncErr', isHi() ? 'Hub se connection nahi hua — billing chalti rahegi, baad me phir try karo।' : 'Could not reach the hub — billing keeps working, try again later.');
    }
    loadSyncStatus();
    loadBilling();
  } catch (e) {
    if (e.message === 'sync_not_configured') {
      showErr('syncErr', isHi() ? 'Sync set nahi hai (SYNC_HUB_URL server par set hota hai)।' : 'Sync is not set up (SYNC_HUB_URL is configured on the server).');
    } else showErr('syncErr', friendly(e));
  }
}
const syncNowBtn = $('syncNowBtn');
if (syncNowBtn) syncNowBtn.addEventListener('click', doSyncNow);
const syncNowBtnDash = $('syncNowBtnDash');
if (syncNowBtnDash) syncNowBtnDash.addEventListener('click', doSyncNow);

// ---------- audit / history (owner-only) ----------
let auditOffset = 0;
const AUDIT_PAGE = 50;
async function loadAudit(reset) {
  if (!me || me.user.role !== 'owner') return;
  if (reset) auditOffset = 0;
  hideErr('auditErr');
  try {
    const r = await api('GET', `/api/audit?limit=${AUDIT_PAGE}&offset=${auditOffset}`);
    const tb = $('auditRows');
    if (reset) tb.innerHTML = '';
    r.entries.forEach((e) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td style="white-space:nowrap">${esc(e.created_at)}</td><td></td><td></td>`;
      tr.children[1].textContent = e.user_name || '—';
      const act = document.createElement('span');
      act.textContent = `${e.action} · ${e.entity}`;
      const sum = document.createElement('div');
      sum.textContent = e.summary || '';
      sum.style.color = 'var(--muted)';
      tr.children[2].append(act, sum);
      tb.appendChild(tr);
    });
    auditOffset += r.entries.length;
    $('auditEmpty').classList.toggle('hidden', r.total > 0);
    $('auditMore').classList.toggle('hidden', auditOffset >= r.total);
  } catch (e) { showErr('auditErr', friendly(e)); }
}
const auditMoreBtn = $('auditMore');
if (auditMoreBtn) auditMoreBtn.addEventListener('click', () => loadAudit(false));

async function loadConflicts() {
  if (!me || me.user.role !== 'owner') return;
  const box = $('conflictList');
  if (!box) return;
  try {
    const r = await api('GET', '/api/sync/conflicts');
    if (!r.conflicts.length) {
      box.innerHTML = `<div class="hint">${isHi() ? 'कोई टकराव नहीं — sab saaf hai।' : 'No conflicts — all clean.'}</div>`;
      return;
    }
    box.innerHTML = '';
    r.conflicts.forEach((c) => {
      const d = document.createElement('div');
      d.className = 'check-row';
      const s = document.createElement('span');
      s.textContent = `${c.created_at} · ${c.table_name} · ${c.summary}`;
      d.appendChild(s);
      box.appendChild(d);
    });
  } catch (e) { box.innerHTML = ''; }
}

// ---------- help & support ----------
async function loadHelp() {
  try {
    const r = await api('GET', '/api/help');
    const wa = $('helpWaBtn');
    if (wa) {
      if (r.support_link) { wa.href = r.support_link; wa.classList.remove('hidden'); }
      else wa.classList.add('hidden');
    }
    const vid = $('helpVideoBtn');
    if (vid) {
      if (r.help_video_url) { vid.href = r.help_video_url; vid.classList.remove('hidden'); }
      else vid.classList.add('hidden');
    }
  } catch (e) { /* help articles are static; buttons are best-effort */ }
}

// =====================================================================
// ---------- Updates Stage C: Data Import (frontend) ----------
// Owner-only card in Settings. The file is read as TEXT in the browser
// and posted as JSON — the server re-parses everything on commit, so
// this preview is a courtesy, never the authority.
// =====================================================================
let importPreviewState = null; // { type, content, duplicate }

function importDupStrategy() {
  const r = document.querySelector('input[name="importDup"]:checked');
  return r && r.value === 'update' ? 'update' : 'skip';
}
function invalidateImportPreview() {
  importPreviewState = null;
  const btn = $('importCommitBtn');
  if (btn) btn.classList.add('hidden');
}
['importType', 'importFile'].forEach((id) => {
  const el = $(id);
  if (el) el.addEventListener('change', () => { invalidateImportPreview(); $('importResult').innerHTML = ''; hideErr('importErr'); });
});
document.querySelectorAll('input[name="importDup"]').forEach((el) => {
  el.addEventListener('change', invalidateImportPreview);
});

function readImportFileText(file) {
  if (file.text) return file.text();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(new Error('empty_file'));
    fr.readAsText(file);
  });
}

const importPreviewBtn = $('importPreviewBtn');
if (importPreviewBtn) importPreviewBtn.addEventListener('click', async () => {
  hideErr('importErr');
  const okEl = $('importOk'); if (okEl) okEl.style.display = 'none';
  const file = $('importFile').files && $('importFile').files[0];
  if (!file) { showErr('importErr', isHi() ? 'Pehle CSV file chunein।' : 'Pehle CSV file chunein — choose a file first.'); return; }
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    showErr('importErr', isHi()
      ? 'Ye Excel (.xlsx) file hai — Excel me kholkar "Save As → CSV" karke save karein, phir wo CSV upload karein।'
      : 'Ye Excel (.xlsx) file hai — use Excel me kholkar "Save As → CSV" karke save karein, phir wo CSV upload karein.');
    return;
  }
  const type = $('importType').value;
  try {
    const content = await readImportFileText(file);
    const r = await api('POST', '/api/import/' + type + '/preview', { content, duplicate: importDupStrategy() });
    importPreviewState = { type, content, duplicate: importDupStrategy() };
    renderImportPreview(r);
    $('importCommitBtn').classList.remove('hidden');
  } catch (e) { invalidateImportPreview(); showErr('importErr', friendly(e)); }
});

function renderImportPreview(r) {
  const box = $('importResult');
  const hi = isHi();
  const mapEntries = Object.entries(r.mapping || {});
  let html = `<div class="hint" style="margin-bottom:6px">${hi ? 'Columns aise samjhe gaye:' : 'Columns aise samjhe gaye (mapping):'} ` +
    (mapEntries.length ? mapEntries.map(([f, h]) => `<b>${esc(f)}</b> ← ${esc(h)}`).join(' · ') : '—') + '</div>';
  html += `<div>${hi ? 'Kul rows' : 'Kul rows'}: <b>${r.total_rows}</b> · ${hi ? 'Sahi' : 'Sahi (valid)'}: <b>${r.valid_count}</b> · Duplicate: <b>${r.duplicate_count}</b> · ${hi ? 'Galat' : 'Galat (error)'}: <b>${r.error_count}</b></div>`;
  if (r.duplicates && r.duplicates.length) {
    html += `<div class="hint" style="margin-top:6px">${hi ? 'Duplicate (kuch):' : 'Duplicate (kuch):'} ${r.duplicates.map((d) => esc(d.name)).join(', ')}</div>`;
  }
  if (r.errors && r.errors.length) {
    html += `<div style="margin-top:8px"><b>${hi ? 'Galat rows (ye nahi chadegi):' : 'Galat rows (ye import nahi hongi):'}</b>` +
      r.errors.map((e) => `<div class="hint" style="color:var(--red,#c0392b)">Row ${e.row}: ${esc(e.reason)}</div>`).join('') + '</div>';
  }
  if (r.sample && r.sample.length) {
    const cols = Object.keys(r.sample[0]).filter((k) => k !== 'row' && k !== 'duplicate');
    html += `<div style="margin-top:8px;overflow-x:auto"><table><thead><tr><th>Row</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}<th></th></tr></thead><tbody>` +
      r.sample.map((s) => `<tr><td>${s.row}</td>${cols.map((c) => `<td>${s[c] === null || s[c] === undefined ? '' : esc(s[c])}</td>`).join('')}<td>${s.duplicate ? '<span class="pend-amt">duplicate</span>' : ''}</td></tr>`).join('') +
      '</tbody></table></div>';
  }
  html += `<div class="hint" style="margin-top:6px">${hi ? 'Sab theek lage to upar "Import karo" dabayein — import se pehle ek backup snapshot apne aap banega।' : 'Sab theek lage to "Import karo" dabayein — import se pehle ek backup snapshot apne aap ban jayega.'}</div>`;
  box.innerHTML = html;
}

const importCommitBtn = $('importCommitBtn');
if (importCommitBtn) importCommitBtn.addEventListener('click', async () => {
  hideErr('importErr');
  if (!importPreviewState) { showErr('importErr', isHi() ? 'Pehle Preview dekho।' : 'Pehle Preview dekho — preview first.'); return; }
  const st = importPreviewState;
  importCommitBtn.disabled = true;
  try {
    const r = await api('POST', '/api/import/' + st.type + '/commit', { content: st.content, duplicate: st.duplicate });
    invalidateImportPreview();
    const box = $('importResult');
    box.innerHTML = `<div class="ok-msg" style="display:block">${isHi() ? 'Import ho gaya ✓' : 'Import ho gaya ✓'} — ` +
      `${isHi() ? 'Naye' : 'Naye'}: <b>${r.created}</b> · Update: <b>${r.updated}</b> · Skip: <b>${r.skipped}</b> · Galat: <b>${r.error_count}</b>` +
      (r.opening_ignored_on_update ? `<br>${isHi() ? 'Note:' : 'Note:'} ${r.opening_ignored_on_update} ${isHi() ? 'purane parties ka opening balance dobara nahi joda gaya।' : 'purane parties ka opening balance dobara nahi joda gaya (double udhaar nahi hota).'}` : '') +
      `<br>${isHi() ? 'Safety backup snapshot' : 'Safety backup snapshot'} #${r.snapshot_id} ${isHi() ? 'ban gaya hai — kuch galat lage to Settings → Data Backup se restore kar sakte ho।' : 'ban gaya hai — kuch galat lage to Settings → Data Backup se restore kar sakte ho.'}</div>`;
    loadBackups();
    loadDashboardSummary();
  } catch (e) { showErr('importErr', friendly(e)); }
  importCommitBtn.disabled = false;
});
