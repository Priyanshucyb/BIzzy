// BizYour — Business Mart backend (B2B marketplace between businesses).
//
// Registered from server.js via registerMart(app, deps) BEFORE the /api 404
// fallback and AFTER the subscription guard, so:
//   - every route needs a normal business login (requireAuth),
//   - an expired/read-only subscription cannot post/quote/order (403
//     subscription_expired from the existing guard), GETs keep working,
//   - all SQL is the same SQLite dialect the dual-engine layer translates
//     for Postgres (`?` placeholders, no engine-specific functions).
//
// Model (one row = one real thing, nothing simulated):
//   mart_profiles      a business's Mart identity (seller categories, area served)
//   mart_inquiries     a buyer's purchase requirement (public to sellers)
//   mart_quotes        one seller's offer on one inquiry (one per seller)
//   mart_messages      chat + counter-offers on a quote (buyer <-> that seller)
//   mart_orders        an accepted quote; Placed → Confirmed → Dispatched → Delivered
//   mart_listings      products a seller shows in Browse
//   mart_notifications in-app inbox per business
//
// Workspace bridge (the ONLY place Mart touches a shop's private data):
//   GET  /api/mart/restock          reads the buyer's own low-stock products
//   POST /api/mart/orders/:id/receive  writes a normal purchase into the
//        buyer's Workspace (supplier found/created by name, product linked/
//        found/created), stock goes up through stock_movements exactly like
//        POST /api/purchases. Seller-side Workspace data is never touched.

const CATEGORIES = ['Staples', 'FMCG', 'Tea & Beverages', 'Oil & Ghee', 'Spices', 'Dairy', 'Snacks & Sweets', 'Packaging', 'Hardware', 'Electrical', 'Stationery', 'Textiles', 'Other'];
const UNITS = ['kg', 'quintal', 'ton', 'gram', 'litre', 'pack', 'piece', 'box', 'bag', 'tin', 'dozen', 'carton'];
const FREQUENCIES = ['One-time', 'Weekly', 'Monthly'];
const TERMS = ['Cash on delivery', 'UPI on delivery', '7-day credit', '15-day credit', '30-day credit', '50% advance', 'Full advance'];
const ORDER_STEPS = ['placed', 'confirmed', 'dispatched', 'delivered'];

// Keyword guess: Workspace product category/name → Mart category (prefill only).
const CAT_GUESS = [
  [/rice|chawal|atta|aata|flour|daal|dal\b|dal |pulse|cheeni|sugar|namak|salt|besan|maida|suji|poha|grain/i, 'Staples'],
  [/tel\b|oil|ghee|vanaspati/i, 'Oil & Ghee'],
  [/chai|tea|coffee|patti|juice|drink|beverage/i, 'Tea & Beverages'],
  [/masala|haldi|mirch|jeera|spice|dhaniya|garam/i, 'Spices'],
  [/milk|doodh|paneer|curd|dahi|butter|cheese/i, 'Dairy'],
  [/biscuit|namkeen|chips|snack|sweet|mithai|chocolate/i, 'Snacks & Sweets'],
  [/surf|soap|sabun|shampoo|detergent|toothpaste|cleaner|fmcg/i, 'FMCG'],
  [/bag|box|packing|packaging|carton|wrap/i, 'Packaging'],
  [/wire|bulb|switch|led|electric/i, 'Electrical'],
  [/screw|nail|tool|pipe|paint|hardware/i, 'Hardware'],
  [/pen|copy|notebook|paper|stationery/i, 'Stationery'],
  [/cloth|kapda|fabric|textile|saree|shirt/i, 'Textiles']
];
function guessCategory(...texts) {
  const s = texts.filter(Boolean).join(' ');
  for (const [re, cat] of CAT_GUESS) if (re.test(s)) return cat;
  return 'Other';
}

function registerMart(app, deps) {
  const { db, requireAuth, requireOwner, auditLog, round2, validNum, queueSync } = deps;

  // ---------- small helpers ----------
  const today = () => new Date().toISOString().slice(0, 10);
  const norm = (s) => String(s || '').trim().toLowerCase();
  const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
  const orderNo = (id) => 'BM-' + String(id).padStart(4, '0');
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function parseTs(t) { return new Date(String(t).replace(' ', 'T') + 'Z'); }
  function quoteExpired(q) {
    const base = parseTs(q.updated_at || q.created_at);
    return Date.now() > base.getTime() + Number(q.valid_days || 0) * 86400000;
  }
  function inquiryState(inq) {
    if (inq.status === 'open' && inq.need_by && inq.need_by < today()) return 'expired';
    return inq.status;
  }
  function waPhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 10) d = '91' + d;
    return d.length >= 11 ? d : '';
  }

  function requireMart(req, res, next) {
    if (!req.user || !req.user.business_id) return res.status(403).json({ error: 'business_login_required' });
    if (req.user.role === 'owner' || ['all', 'stock'].includes(req.user.access)) return next();
    return res.status(403).json({ error: 'mart_access_only' });
  }
  const guard = [requireAuth, requireMart];

  async function getBiz(id) { return await db.get('SELECT * FROM businesses WHERE id = ?', id); }

  async function ensureProfile(bizId) {
    let p = await db.get('SELECT * FROM mart_profiles WHERE business_id = ?', bizId);
    if (!p) {
      const b = await getBiz(bizId);
      await db.run(
        `INSERT INTO mart_profiles (business_id, display_name, city) VALUES (?, ?, ?)`
      , bizId, (b && b.name) || '', (b && b.city) || '');
      p = await db.get('SELECT * FROM mart_profiles WHERE business_id = ?', bizId);
    }
    return p;
  }

  // "Verified" is earned, never assigned: a real-format GSTIN on the
  // business + a phone number + a city. Computed fresh wherever a profile
  // is serialized — no admin step, no stored flag to game.
  const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  function isVerifiedBiz(b, p) {
    if (!b) return false;
    const gstin = String(b.gstin || '').trim().toUpperCase();
    return GSTIN_RE.test(gstin) &&
      !!String(b.phone || '').trim() &&
      !!String((p && p.city) || b.city || '').trim();
  }

  async function sellerStats(bizId) {
    const r = await db.get(
      `SELECT COUNT(*) AS deals FROM mart_orders WHERE seller_business_id = ? AND status = 'delivered'`, bizId);
    const rr = await db.get(
      `SELECT AVG(rating) AS avg, COUNT(*) AS n FROM mart_orders WHERE seller_business_id = ? AND rating IS NOT NULL`, bizId);
    const rb = await db.get(
      `SELECT COUNT(*) AS c FROM (
         SELECT buyer_business_id FROM mart_orders
         WHERE seller_business_id = ? AND status = 'delivered'
         GROUP BY buyer_business_id HAVING COUNT(*) >= 2
       ) repeat_buyers`, bizId);
    return {
      deals: Number((r && r.deals) || 0),
      rating: rr && rr.n ? Math.round(Number(rr.avg) * 10) / 10 : null,
      ratings_count: Number((rr && rr.n) || 0),
      repeat_buyers: Number((rb && rb.c) || 0)
    };
  }

  // Public seller card. Phone is only shared once two businesses have an order.
  async function publicSeller(bizId, cache, opts = {}) {
    if (cache && cache.has(bizId)) return cache.get(bizId);
    const b = await getBiz(bizId);
    const p = await ensureProfile(bizId);
    const st = await sellerStats(bizId);
    const out = {
      business_id: bizId,
      name: p.display_name || (b && b.name) || 'Business',
      city: p.city || (b && b.city) || '',
      area: p.area || '',
      about: p.about || '',
      categories: list(p.categories),
      service_cities: list(p.service_cities),
      all_india: !!p.all_india,
      is_seller: !!p.is_seller,
      gst_registered: !!(b && b.gstin && String(b.gstin).trim()),
      verified: isVerifiedBiz(b, p),
      since: b && b.created_at ? String(b.created_at).slice(0, 4) : '',
      ...st
    };
    if (opts.withPhone) out.phone = (b && b.phone) || '';
    if (cache) cache.set(bizId, out);
    return out;
  }

  function serves(profile, city) {
    if (profile.all_india) return true;
    const c = norm(city);
    if (!c) return true;
    if (norm(profile.city) === c) return true;
    return list(profile.service_cities).some((x) => norm(x) === c);
  }

  // Sellers who should be told about an inquiry.
  async function matchSellers(inq) {
    const rows = await db.all(
      `SELECT mp.*, b.gstin AS gstin FROM mart_profiles mp JOIN businesses b ON b.id = mp.business_id
       WHERE mp.is_seller = 1 AND mp.business_id <> ?`, inq.business_id);
    return rows.filter((p) =>
      list(p.categories).includes(inq.category) &&
      serves(p, inq.city) &&
      (!inq.verified_only || (p.gstin && String(p.gstin).trim())));
  }

  // text may be a plain string or { en, hi, hg } — the recipient's own
  // language (businesses.language) decides which one is stored.
  async function notify(bizId, kind, text, view, linkId) {
    try {
      if (text && typeof text === 'object') {
        const rb = await getBiz(bizId);
        const lang = rb && ['hi', 'hg'].includes(rb.language) ? rb.language : 'en';
        text = text[lang] || text.en;
      }
      await db.run(
        `INSERT INTO mart_notifications (business_id, kind, text, link_view, link_id) VALUES (?, ?, ?, ?, ?)`
      , bizId, kind, String(text).slice(0, 300), view || '', linkId == null ? null : linkId);
    } catch (e) { console.error('mart notify failed:', e.message); }
  }

  async function hiddenName(city, viewerBizId) {
    const vb = viewerBizId ? await getBiz(viewerBizId) : null;
    const l = vb && vb.language;
    return l === 'hi' ? `${city} का एक business` : l === 'hg' ? `${city} ka ek business` : `A business in ${city}`;
  }
  async function buyerLabel(inq, viewerBizId) {
    const b = await getBiz(inq.business_id);
    const p = await ensureProfile(inq.business_id);
    let reveal = !!inq.show_name || viewerBizId === inq.business_id;
    if (!reveal && viewerBizId) {
      const o = await db.get(
        `SELECT id FROM mart_orders WHERE inquiry_id = ? AND seller_business_id = ?`, inq.id, viewerBizId);
      reveal = !!o;
    }
    return {
      name: reveal ? (p.display_name || (b && b.name) || 'Business') : await hiddenName(inq.city || (b && b.city) || 'India', viewerBizId),
      hidden: !reveal,
      gst_registered: !!(b && b.gstin && String(b.gstin).trim()),
      verified: isVerifiedBiz(b, p)
    };
  }

  function publicInquiry(inq) {
    return {
      id: inq.id, product: inq.product, category: inq.category, qty: inq.qty, unit: inq.unit,
      target_price: inq.target_price, city: inq.city, need_by: inq.need_by, frequency: inq.frequency,
      notes: inq.notes, show_name: !!inq.show_name, verified_only: !!inq.verified_only,
      status: inquiryState(inq), source: inq.source, product_id: inq.product_id,
      target_business_id: inq.target_business_id, group_id: inq.group_id || null, notified: inq.notified,
      created_at: inq.created_at, updated_at: inq.updated_at
    };
  }
  function publicQuote(q) {
    const expired = q.status === 'sent' && quoteExpired(q);
    return {
      id: q.id, inquiry_id: q.inquiry_id, seller_business_id: q.seller_business_id,
      price: q.price, moq: q.moq, delivery_days: q.delivery_days, payment_terms: q.payment_terms,
      advance_percent: q.advance_percent == null ? null : Number(q.advance_percent),
      credit_days: q.credit_days == null ? null : Number(q.credit_days),
      valid_days: q.valid_days, note: q.note, status: expired ? 'expired' : q.status,
      created_at: q.created_at, updated_at: q.updated_at
    };
  }
  async function publicOrder(o, viewerBizId, cache) {
    const isBuyer = o.buyer_business_id === viewerBizId;
    const otherId = isBuyer ? o.seller_business_id : o.buyer_business_id;
    const other = await publicSeller(otherId, cache, { withPhone: true });
    return {
      id: o.id, order_no: orderNo(o.id), inquiry_id: o.inquiry_id, quote_id: o.quote_id,
      role: isBuyer ? 'buyer' : 'seller',
      product: o.product, qty: o.qty, unit: o.unit, price: o.price, total: o.total,
      payment_terms: o.payment_terms,
      advance_percent: o.advance_percent == null ? null : Number(o.advance_percent),
      credit_days: o.credit_days == null ? null : Number(o.credit_days),
      delivery_days: o.delivery_days,
      expected_delivery_date: o.expected_delivery_date || null,
      transporter_name: o.transporter_name || '',
      status: o.status, step: ORDER_STEPS.indexOf(o.status),
      purchase_id: o.purchase_id, rating: o.rating, review: o.review,
      other_party: { business_id: other.business_id, name: other.name, city: other.city, phone: other.phone || '', gst_registered: other.gst_registered, verified: other.verified, rating: other.rating },
      created_at: o.created_at, updated_at: o.updated_at
    };
  }

  // ===================== meta / profile =====================
  app.get('/api/mart/meta', requireAuth, async (req, res) => {
    res.json({ categories: CATEGORIES, units: UNITS, frequencies: FREQUENCIES, payment_terms: TERMS });
  });

  app.get('/api/mart/profile', ...guard, async (req, res) => {
    const p = await ensureProfile(req.user.business_id);
    const b = await getBiz(req.user.business_id);
    res.json({
      profile: {
        display_name: p.display_name, city: p.city, area: p.area, about: p.about,
        categories: list(p.categories), service_cities: list(p.service_cities),
        all_india: !!p.all_india, is_seller: !!p.is_seller,
        gst_registered: !!(b && b.gstin && String(b.gstin).trim()),
        verified: isVerifiedBiz(b, p),
        phone: (b && b.phone) || ''
      }
    });
  });

  app.put('/api/mart/profile', ...guard, requireOwner, async (req, res) => {
    const b = req.body || {};
    await ensureProfile(req.user.business_id);
    const cats = (Array.isArray(b.categories) ? b.categories : []).filter((c) => CATEGORIES.includes(c));
    const svc = (Array.isArray(b.service_cities) ? b.service_cities : list(b.service_cities)).map((c) => str(c, 40)).filter(Boolean).slice(0, 30);
    const isSeller = !!b.is_seller;
    if (isSeller && cats.length === 0) return res.status(400).json({ error: 'pick_categories' });
    const name = str(b.display_name, 80);
    if (!name) return res.status(400).json({ error: 'display_name_required' });
    await db.run(
      `UPDATE mart_profiles SET display_name=?, city=?, area=?, about=?, categories=?, service_cities=?, all_india=?, is_seller=?, updated_at=datetime('now')
       WHERE business_id = ?`
    , name, str(b.city, 60), str(b.area, 80), str(b.about, 400), cats.join(','), svc.join(','), b.all_india ? 1 : 0, isSeller ? 1 : 0, req.user.business_id);
    await auditLog(req, 'update', 'mart_profile', req.user.business_id, `Business Mart profile update${isSeller ? ' (seller: ' + cats.join(', ') + ')' : ''}`);
    res.json({ ok: true });
  });

  // ===================== summary (badges + home) =====================
  app.get('/api/mart/summary', ...guard, async (req, res) => {
    const bizId = req.user.business_id;
    const t = today();
    const profile = await ensureProfile(bizId);
    const myOpen = await db.all(
      `SELECT id FROM mart_inquiries WHERE business_id = ? AND status = 'open' AND (need_by IS NULL OR need_by >= ?)`, bizId, t);
    let newQuotes = 0;
    if (myOpen.length) {
      const ids = myOpen.map((r) => r.id);
      const r = await db.get(
        `SELECT COUNT(*) AS c FROM mart_quotes WHERE status = 'sent' AND inquiry_id IN (${ids.map(() => '?').join(',')})`, ...ids);
      newQuotes = Number(r.c || 0);
    }
    const buyOrders = await db.get(
      `SELECT COUNT(*) AS c FROM mart_orders WHERE buyer_business_id = ? AND status IN ('placed','confirmed','dispatched')`, bizId);
    const spend = await db.get(
      `SELECT COALESCE(SUM(total),0) AS s FROM mart_orders WHERE buyer_business_id = ? AND status <> 'cancelled'`, bizId);
    const sellOrders = await db.get(
      `SELECT COUNT(*) AS c FROM mart_orders WHERE seller_business_id = ? AND status IN ('placed','confirmed','dispatched')`, bizId);
    const sales = await db.get(
      `SELECT COALESCE(SUM(total),0) AS s FROM mart_orders WHERE seller_business_id = ? AND status <> 'cancelled'`, bizId);
    const sent = await db.get(`SELECT COUNT(*) AS c FROM mart_quotes WHERE seller_business_id = ?`, bizId);
    const won = await db.get(`SELECT COUNT(*) AS c FROM mart_quotes WHERE seller_business_id = ? AND status = 'accepted'`, bizId);
    const unread = await db.get(`SELECT COUNT(*) AS c FROM mart_notifications WHERE business_id = ? AND is_read = 0`, bizId);
    let newLeads = 0;
    if (profile.is_seller) newLeads = (await leadsFor(bizId, 'matched')).filter((l) => !l.my_quote).length;
    res.json({
      buying: { open_inquiries: myOpen.length, new_quotes: newQuotes, active_orders: Number(buyOrders.c || 0), spend: round2(spend.s) },
      selling: { is_seller: !!profile.is_seller, new_leads: newLeads, quotes_sent: Number(sent.c || 0), won: Number(won.c || 0), active_orders: Number(sellOrders.c || 0), sales: round2(sales.s) },
      unread: Number(unread.c || 0)
    });
  });

  // ===================== restock from Workspace data =====================
  app.get('/api/mart/restock', ...guard, async (req, res) => {
    const bizId = req.user.business_id;
    const prods = await db.all(
      `SELECT * FROM products WHERE business_id = ? AND stock_qty <= low_stock_limit ORDER BY stock_qty ASC, name ASC`, bizId);
    const out = [];
    for (const p of prods) {
      const last = await db.get(
        `SELECT pi.qty, pi.buy_price, s.name AS supplier_name, pu.date FROM purchase_items pi
         JOIN purchases pu ON pu.id = pi.purchase_id
         LEFT JOIN suppliers s ON s.id = pu.supplier_id
         WHERE pi.business_id = ? AND pi.product_id = ? ORDER BY pu.date DESC, pi.id DESC LIMIT 1`, bizId, p.id);
      const open = await db.get(
        `SELECT id FROM mart_inquiries WHERE business_id = ? AND product_id = ? AND status = 'open' AND (need_by IS NULL OR need_by >= ?)`, bizId, p.id, today());
      const unit = UNITS.includes(p.unit) ? p.unit : (p.unit === 'piece' ? 'piece' : 'pack');
      out.push({
        product_id: p.id, name: p.name, unit, stock_qty: p.stock_qty, low_stock_limit: p.low_stock_limit,
        suggested_qty: last ? Number(last.qty) : Math.max(10, Math.ceil(Number(p.low_stock_limit || 5) * 3)),
        last_price: last ? Number(last.buy_price) : Number(p.buy_price || 0) || null,
        last_supplier: last ? last.supplier_name : null,
        last_date: last ? last.date : null,
        category: guessCategory(p.category, p.name),
        open_inquiry_id: open ? open.id : null
      });
    }
    res.json({ items: out });
  });

  // ===================== inquiries (buyer) =====================
  app.get('/api/mart/match-preview', ...guard, async (req, res) => {
    const inq = {
      business_id: req.user.business_id,
      category: String(req.query.category || ''),
      city: String(req.query.city || ''),
      verified_only: req.query.verified_only === '1'
    };
    const m = await matchSellers(inq);
    const cache = new Map();
    const sellers = [];
    for (const p of m.slice(0, 12)) sellers.push(await publicSeller(p.business_id, cache));
    res.json({ count: m.length, sellers });
  });

  app.post('/api/mart/inquiries', ...guard, async (req, res) => {
    const bizId = req.user.business_id;
    const b = req.body || {};
    const product = str(b.product, 120);
    if (!product) return res.status(400).json({ error: 'product_required' });
    if (!CATEGORIES.includes(b.category)) return res.status(400).json({ error: 'invalid_category' });
    if (!validNum(b.qty) || Number(b.qty) <= 0) return res.status(400).json({ error: 'qty must be greater than 0' });
    const unit = UNITS.includes(b.unit) ? b.unit : 'kg';
    let target = null;
    if (b.target_price !== undefined && b.target_price !== null && b.target_price !== '') {
      if (!validNum(b.target_price) || Number(b.target_price) < 0) return res.status(400).json({ error: 'invalid_target_price' });
      target = round2(b.target_price);
    }
    const city = str(b.city, 60);
    if (!city) return res.status(400).json({ error: 'city_required' });
    let needBy = b.need_by ? String(b.need_by) : null;
    if (needBy && (!DATE_RE.test(needBy) || needBy < today())) return res.status(400).json({ error: 'invalid_need_by' });
    const freq = FREQUENCIES.includes(b.frequency) ? b.frequency : 'One-time';
    const source = ['manual', 'stock', 'listing', 'reorder'].includes(b.source) ? b.source : 'manual';
    let productId = null;
    if (b.product_id) {
      const own = await db.get('SELECT id FROM products WHERE id = ? AND business_id = ?', b.product_id, bizId);
      if (own) productId = own.id;
    }
    let targetBiz = null;
    if (b.target_business_id && Number(b.target_business_id) !== bizId) {
      const tb = await db.get('SELECT business_id FROM mart_profiles WHERE business_id = ? AND is_seller = 1', b.target_business_id);
      if (tb) targetBiz = tb.business_id;
    }
    const r = await db.run(
      `INSERT INTO mart_inquiries (business_id, product, category, qty, unit, target_price, city, need_by, frequency, notes, show_name, verified_only, status, source, product_id, target_business_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
    , bizId, product, b.category, Number(b.qty), unit, target, city, needBy, freq, str(b.notes, 500),
      b.show_name === false ? 0 : 1, b.verified_only ? 1 : 0, source, productId, targetBiz);
    const inq = await db.get('SELECT * FROM mart_inquiries WHERE id = ?', r.lastInsertRowid);
    const matches = await matchSellers(inq);
    const told = new Set(matches.map((m) => m.business_id));
    if (targetBiz) told.add(targetBiz);
    await db.run('UPDATE mart_inquiries SET notified = ? WHERE id = ?', told.size, inq.id);
    const who = await buyerLabel(inq, null);
    for (const sid of told) {
      await notify(sid, 'lead', { en: `New lead: ${who.name} needs ${inq.qty} ${inq.unit} ${inq.product} (${inq.city})`, hi: `नई lead: ${who.name} को ${inq.qty} ${inq.unit} ${inq.product} चाहिए (${inq.city})`, hg: `Nayi lead: ${who.name} ko ${inq.qty} ${inq.unit} ${inq.product} chahiye (${inq.city})` }, 'lead', inq.id);
    }
    await auditLog(req, 'create', 'mart_inquiry', inq.id, `Business Mart inquiry: ${inq.qty} ${inq.unit} ${inq.product}`);
    res.status(201).json({ inquiry: publicInquiry({ ...inq, notified: told.size }), notified: told.size });
  });

  // Bulk inquiry: ONE requirement, many sellers. Creates one targeted
  // inquiry per chosen seller, all sharing a group_id, so the buyer can
  // compare the returning quotes side by side. Each seller is notified
  // only about their own copy.
  app.post('/api/mart/inquiries/bulk', ...guard, async (req, res) => {
    const bizId = req.user.business_id;
    const b = req.body || {};
    const product = str(b.product, 120);
    if (!product) return res.status(400).json({ error: 'product_required' });
    if (!CATEGORIES.includes(b.category)) return res.status(400).json({ error: 'invalid_category' });
    if (!validNum(b.qty) || Number(b.qty) <= 0) return res.status(400).json({ error: 'qty must be greater than 0' });
    const unit = UNITS.includes(b.unit) ? b.unit : 'kg';
    let target = null;
    if (b.target_price !== undefined && b.target_price !== null && b.target_price !== '') {
      if (!validNum(b.target_price) || Number(b.target_price) < 0) return res.status(400).json({ error: 'invalid_target_price' });
      target = round2(b.target_price);
    }
    const city = str(b.city, 60);
    if (!city) return res.status(400).json({ error: 'city_required' });
    let needBy = b.need_by ? String(b.need_by) : null;
    if (needBy && (!DATE_RE.test(needBy) || needBy < today())) return res.status(400).json({ error: 'invalid_need_by' });
    const freq = FREQUENCIES.includes(b.frequency) ? b.frequency : 'One-time';
    const rawIds = Array.isArray(b.seller_ids) ? b.seller_ids : [];
    const sellerIds = [...new Set(rawIds.map((x) => Number(x)).filter((x) => x && x !== bizId))].slice(0, 20);
    if (!sellerIds.length) return res.status(400).json({ error: 'pick_sellers' });
    const sellers = [];
    for (const sid of sellerIds) {
      const p = await db.get('SELECT business_id FROM mart_profiles WHERE business_id = ? AND is_seller = 1', sid);
      if (p) sellers.push(sid);
    }
    if (!sellers.length) return res.status(400).json({ error: 'pick_sellers' });
    const groupId = 'grp-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    const created = [];
    for (const sid of sellers) {
      const r = await db.run(
        `INSERT INTO mart_inquiries (business_id, product, category, qty, unit, target_price, city, need_by, frequency, notes, show_name, verified_only, status, source, product_id, target_business_id, group_id, notified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'bulk', NULL, ?, ?, 1)`
      , bizId, product, b.category, Number(b.qty), unit, target, city, needBy, freq, str(b.notes, 500),
        b.show_name === false ? 0 : 1, b.verified_only ? 1 : 0, sid, groupId);
      const inq = await db.get('SELECT * FROM mart_inquiries WHERE id = ?', r.lastInsertRowid);
      created.push(inq);
      const who = await buyerLabel(inq, null);
      await notify(sid, 'lead', { en: `New lead: ${who.name} needs ${inq.qty} ${inq.unit} ${inq.product} (${inq.city})`, hi: `नई lead: ${who.name} को ${inq.qty} ${inq.unit} ${inq.product} चाहिए (${inq.city})`, hg: `Nayi lead: ${who.name} ko ${inq.qty} ${inq.unit} ${inq.product} chahiye (${inq.city})` }, 'lead', inq.id);
    }
    await auditLog(req, 'create', 'mart_inquiry', created[0].id, `Business Mart bulk inquiry (${sellers.length} sellers): ${Number(b.qty)} ${unit} ${product}`);
    res.status(201).json({ group_id: groupId, inquiries: created.map(publicInquiry), notified: sellers.length });
  });

  app.get('/api/mart/inquiries', ...guard, async (req, res) => {
    const bizId = req.user.business_id;
    const rows = await db.all('SELECT * FROM mart_inquiries WHERE business_id = ? ORDER BY id DESC LIMIT 200', bizId);
    const out = [];
    for (const inq of rows) {
      const qs = await db.all('SELECT * FROM mart_quotes WHERE inquiry_id = ?', inq.id);
      const live = qs.map(publicQuote).filter((q) => !['withdrawn'].includes(q.status));
      const prices = live.filter((q) => ['sent', 'accepted'].includes(q.status)).map((q) => q.price);
      const v = await db.get('SELECT COUNT(*) AS c FROM mart_views WHERE inquiry_id = ?', inq.id);
      out.push({
        ...publicInquiry(inq),
        quotes_count: live.length,
        new_quotes: live.filter((q) => q.status === 'sent').length,
        best_price: prices.length ? Math.min(...prices) : null,
        views: Number(v.c || 0)
      });
    }
    res.json({ inquiries: out });
  });

  app.get('/api/mart/inquiries/:id', ...guard, async (req, res) => {
    const bizId = req.user.business_id;
    const inq = await db.get('SELECT * FROM mart_inquiries WHERE id = ?', req.params.id);
    if (!inq) return res.status(404).json({ error: 'inquiry_not_found' });
    const cache = new Map();
    const v = await db.get('SELECT COUNT(*) AS c FROM mart_views WHERE inquiry_id = ?', inq.id);
    if (inq.business_id === bizId) {
      const qs = await db.all('SELECT * FROM mart_quotes WHERE inquiry_id = ? ORDER BY price ASC, id ASC', inq.id);
      const quotes = [];
      for (const q of qs) {
        if (q.status === 'withdrawn') continue;
        const m = await db.get('SELECT COUNT(*) AS c FROM mart_messages WHERE quote_id = ?', q.id);
        quotes.push({ ...publicQuote(q), seller: await publicSeller(q.seller_business_id, cache), messages: Number(m.c || 0) });
      }
      const order = await db.get('SELECT * FROM mart_orders WHERE inquiry_id = ? ORDER BY id DESC LIMIT 1', inq.id);
      return res.json({
        role: 'buyer', inquiry: { ...publicInquiry(inq), views: Number(v.c || 0) }, quotes,
        order: order ? await publicOrder(order, bizId, cache) : null
      });
    }
    // Seller view: record a unique view, show the buyer (masked if asked) and my own quote.
    if (inquiryState(inq) === 'open') {
      const seen = await db.get('SELECT id FROM mart_views WHERE inquiry_id = ? AND business_id = ?', inq.id, bizId);
      if (!seen) { try { await db.run('INSERT INTO mart_views (inquiry_id, business_id) VALUES (?, ?)', inq.id, bizId); } catch (_) { /* race: unique index */ } }
    }
    const mine = await db.get('SELECT * FROM mart_quotes WHERE inquiry_id = ? AND seller_business_id = ?', inq.id, bizId);
    const others = await db.get(
      `SELECT COUNT(*) AS c FROM mart_quotes WHERE inquiry_id = ? AND status IN ('sent','accepted')`, inq.id);
    const me = await db.get(`SELECT mp.*, b.gstin FROM mart_profiles mp JOIN businesses b ON b.id = mp.business_id WHERE mp.business_id = ?`, bizId);
    const canQuote = inquiryState(inq) === 'open' && !!(me && me.is_seller) &&
      (!inq.verified_only || !!(me && me.gstin && String(me.gstin).trim()));
    res.json({
      role: 'seller',
      inquiry: { ...publicInquiry(inq), views: Number(v.c || 0) },
      buyer: await buyerLabel(inq, bizId),
      my_quote: mine ? publicQuote(mine) : null,
      quotes_count: Number(others.c || 0),
      can_quote: canQuote,
      cannot_quote_reason: canQuote ? null : (!me || !me.is_seller ? 'not_seller' : (inquiryState(inq) !== 'open' ? 'closed' : 'gst_required'))
    });
  });

  async function ownInquiry(req, res) {
    const inq = await db.get('SELECT * FROM mart_inquiries WHERE id = ? AND business_id = ?', req.params.id, req.user.business_id);
    if (!inq) { res.status(404).json({ error: 'inquiry_not_found' }); return null; }
    return inq;
  }

  app.post('/api/mart/inquiries/:id/close', ...guard, async (req, res) => {
    const inq = await ownInquiry(req, res); if (!inq) return;
    if (inq.status !== 'open') return res.status(400).json({ error: 'inquiry_not_open' });
    await db.run(`UPDATE mart_inquiries SET status='closed', updated_at=datetime('now') WHERE id = ?`, inq.id);
    const qs = await db.all(`SELECT * FROM mart_quotes WHERE inquiry_id = ? AND status = 'sent'`, inq.id);
    await db.run(`UPDATE mart_quotes SET status='closed', updated_at=datetime('now') WHERE inquiry_id = ? AND status = 'sent'`, inq.id);
    for (const q of qs) await notify(q.seller_business_id, 'closed', { en: `Buyer closed the inquiry for ${inq.product} — your quote is closed.`, hi: `Buyer ने ${inq.product} की inquiry बंद कर दी — आपका quote बंद हो गया।`, hg: `Buyer ne ${inq.product} ki inquiry band kar di — aapka quote band ho gaya.` }, 'sent', q.id);
    res.json({ ok: true });
  });

  app.get('/api/mart/inquiries/:id/share', ...guard, async (req, res) => {
    const inq = await ownInquiry(req, res); if (!inq) return;
    const text = `Need ${inq.qty} ${inq.unit} ${inq.product} in ${inq.city}${inq.need_by ? ' by ' + inq.need_by : ''}.` +
      (inq.target_price ? ` Target ₹${inq.target_price}/${inq.unit}.` : '') +
      ` Send your quote on BizYour Business Mart — ref BM-INQ-${inq.id}.`;
    res.json({ text, wa_url: 'https://wa.me/?text=' + encodeURIComponent(text) });
  });

  // ===================== leads (seller) =====================
  async function leadsFor(bizId, scope) {
    const me = await db.get(`SELECT mp.*, b.gstin FROM mart_profiles mp JOIN businesses b ON b.id = mp.business_id WHERE mp.business_id = ?`, bizId);
    const rows = await db.all(
      `SELECT * FROM mart_inquiries WHERE status = 'open' AND business_id <> ? AND (need_by IS NULL OR need_by >= ?) ORDER BY id DESC LIMIT 300`
    , bizId, today());
    const out = [];
    for (const inq of rows) {
      const matched = !!(me && me.is_seller && list(me.categories).includes(inq.category) && serves(me, inq.city)) || inq.target_business_id === bizId;
      if (scope === 'matched' && !matched) continue;
      const mine = await db.get('SELECT * FROM mart_quotes WHERE inquiry_id = ? AND seller_business_id = ?', inq.id, bizId);
      const cnt = await db.get(`SELECT COUNT(*) AS c FROM mart_quotes WHERE inquiry_id = ? AND status IN ('sent','accepted')`, inq.id);
      out.push({
        ...publicInquiry(inq),
        buyer: await buyerLabel(inq, bizId),
        matched,
        direct: inq.target_business_id === bizId,
        quotes_count: Number(cnt.c || 0),
        my_quote: mine ? publicQuote(mine) : null,
        can_quote: !!(me && me.is_seller) && (!inq.verified_only || !!(me && me.gstin && String(me.gstin).trim()))
      });
    }
    return out;
  }
  app.get('/api/mart/leads', ...guard, async (req, res) => {
    const scope = req.query.scope === 'all' ? 'all' : 'matched';
    res.json({ leads: await leadsFor(req.user.business_id, scope) });
  });

  // ===================== quotes =====================
  function validateQuoteBody(b) {
    if (!validNum(b.price) || Number(b.price) <= 0) return 'price must be greater than 0';
    if (b.moq !== undefined && b.moq !== '' && (!validNum(b.moq) || Number(b.moq) < 0)) return 'invalid_moq';
    if (!validNum(b.delivery_days) || Number(b.delivery_days) < 0 || Number(b.delivery_days) > 90) return 'invalid_delivery_days';
    if (b.payment_terms && !TERMS.includes(b.payment_terms)) return 'invalid_payment_terms';
    if (b.valid_days !== undefined && b.valid_days !== '' && (!validNum(b.valid_days) || Number(b.valid_days) < 1 || Number(b.valid_days) > 30)) return 'invalid_valid_days';
    if (b.advance_percent !== undefined && b.advance_percent !== null && b.advance_percent !== '' && (!validNum(b.advance_percent) || Number(b.advance_percent) < 0 || Number(b.advance_percent) > 100)) return 'invalid_advance_percent';
    if (b.credit_days !== undefined && b.credit_days !== null && b.credit_days !== '' && (!validNum(b.credit_days) || Number(b.credit_days) < 0 || Number(b.credit_days) > 120)) return 'invalid_credit_days';
    return null;
  }
  // Optional payment-term split on a quote: null = seller didn't specify.
  function quoteTerms(b) {
    return {
      advance_percent: b.advance_percent === undefined || b.advance_percent === null || b.advance_percent === '' ? null : Math.round(Number(b.advance_percent) * 100) / 100,
      credit_days: b.credit_days === undefined || b.credit_days === null || b.credit_days === '' ? null : Math.round(Number(b.credit_days))
    };
  }

  app.post('/api/mart/inquiries/:id/quotes', ...guard, async (req, res) => {
    const bizId = req.user.business_id;
    const inq = await db.get('SELECT * FROM mart_inquiries WHERE id = ?', req.params.id);
    if (!inq) return res.status(404).json({ error: 'inquiry_not_found' });
    if (inq.business_id === bizId) return res.status(400).json({ error: 'own_inquiry' });
    if (inquiryState(inq) !== 'open') return res.status(400).json({ error: 'inquiry_not_open' });
    const me = await db.get(`SELECT mp.*, b.gstin FROM mart_profiles mp JOIN businesses b ON b.id = mp.business_id WHERE mp.business_id = ?`, bizId);
    if (!me || !me.is_seller) return res.status(403).json({ error: 'not_seller' });
    if (inq.verified_only && !(me.gstin && String(me.gstin).trim())) return res.status(403).json({ error: 'gst_required' });
    const b = req.body || {};
    const bad = validateQuoteBody(b); if (bad) return res.status(400).json({ error: bad });
    const terms = quoteTerms(b);
    const vals = [round2(b.price), validNum(b.moq) ? Number(b.moq) : 0, Math.round(Number(b.delivery_days)),
      TERMS.includes(b.payment_terms) ? b.payment_terms : TERMS[0], terms.advance_percent, terms.credit_days, validNum(b.valid_days) ? Math.round(Number(b.valid_days)) : 3, str(b.note, 400)];
    const existing = await db.get('SELECT * FROM mart_quotes WHERE inquiry_id = ? AND seller_business_id = ?', inq.id, bizId);
    let qid;
    if (existing) {
      if (existing.status === 'accepted') return res.status(400).json({ error: 'quote_locked' });
      await db.run(
        `UPDATE mart_quotes SET price=?, moq=?, delivery_days=?, payment_terms=?, advance_percent=?, credit_days=?, valid_days=?, note=?, status='sent', updated_at=datetime('now') WHERE id = ?`
      , ...vals, existing.id);
      qid = existing.id;
    } else {
      const r = await db.run(
        `INSERT INTO mart_quotes (inquiry_id, seller_business_id, price, moq, delivery_days, payment_terms, advance_percent, credit_days, valid_days, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      , inq.id, bizId, ...vals);
      qid = r.lastInsertRowid;
    }
    const seller = await publicSeller(bizId);
    await notify(inq.business_id, 'quote', { en: `${seller.name} quoted ₹${vals[0]}/${inq.unit} for ${inq.product}`, hi: `${seller.name} ने ${inq.product} के लिए ₹${vals[0]}/${inq.unit} का quote भेजा`, hg: `${seller.name} ne ${inq.product} ke liye ₹${vals[0]}/${inq.unit} ka quote bheja` }, 'inquiry', inq.id);
    await auditLog(req, existing ? 'update' : 'create', 'mart_quote', qid, `Quote bheja: ${inq.product} @ ₹${vals[0]}/${inq.unit}`);
    const q = await db.get('SELECT * FROM mart_quotes WHERE id = ?', qid);
    res.status(existing ? 200 : 201).json({ quote: publicQuote(q) });
  });

  async function quoteWithParties(id) {
    const q = await db.get('SELECT * FROM mart_quotes WHERE id = ?', id);
    if (!q) return null;
    const inq = await db.get('SELECT * FROM mart_inquiries WHERE id = ?', q.inquiry_id);
    return { q, inq };
  }

  // Seller edits price/terms of a live quote (e.g. answering a counter-offer).
  app.put('/api/mart/quotes/:id', ...guard, async (req, res) => {
    const x = await quoteWithParties(req.params.id);
    if (!x || x.q.seller_business_id !== req.user.business_id) return res.status(404).json({ error: 'quote_not_found' });
    if (x.q.status !== 'sent' || inquiryState(x.inq) !== 'open') return res.status(400).json({ error: 'quote_locked' });
    const b = { ...x.q, ...(req.body || {}) };
    const bad = validateQuoteBody(b); if (bad) return res.status(400).json({ error: bad });
    const price = round2(b.price);
    const terms = quoteTerms(b);
    await db.run(
      `UPDATE mart_quotes SET price=?, moq=?, delivery_days=?, payment_terms=?, advance_percent=?, credit_days=?, valid_days=?, note=?, updated_at=datetime('now') WHERE id = ?`
    , price, Number(b.moq) || 0, Math.round(Number(b.delivery_days)), TERMS.includes(b.payment_terms) ? b.payment_terms : x.q.payment_terms,
      terms.advance_percent, terms.credit_days, Math.round(Number(b.valid_days)) || 3, str(b.note, 400), x.q.id);
    if (price !== x.q.price) {
      await db.run(`INSERT INTO mart_messages (quote_id, sender_business_id, kind, body, amount) VALUES (?, ?, 'update', ?, ?)`
      , x.q.id, req.user.business_id, `Updated price to ₹${price}/${x.inq.unit}`, price);
    }
    const seller = await publicSeller(req.user.business_id);
    await notify(x.inq.business_id, 'quote_update', { en: `${seller.name} updated their quote to ₹${price}/${x.inq.unit} for ${x.inq.product}`, hi: `${seller.name} ने ${x.inq.product} का quote बदलकर ₹${price}/${x.inq.unit} किया`, hg: `${seller.name} ne ${x.inq.product} ka quote badal kar ₹${price}/${x.inq.unit} kiya` }, 'inquiry', x.inq.id);
    res.json({ quote: publicQuote(await db.get('SELECT * FROM mart_quotes WHERE id = ?', x.q.id)) });
  });

  app.post('/api/mart/quotes/:id/withdraw', ...guard, async (req, res) => {
    const x = await quoteWithParties(req.params.id);
    if (!x || x.q.seller_business_id !== req.user.business_id) return res.status(404).json({ error: 'quote_not_found' });
    if (x.q.status !== 'sent') return res.status(400).json({ error: 'quote_locked' });
    await db.run(`UPDATE mart_quotes SET status='withdrawn', updated_at=datetime('now') WHERE id = ?`, x.q.id);
    res.json({ ok: true });
  });

  app.post('/api/mart/quotes/:id/decline', ...guard, async (req, res) => {
    const x = await quoteWithParties(req.params.id);
    if (!x || x.inq.business_id !== req.user.business_id) return res.status(404).json({ error: 'quote_not_found' });
    if (x.q.status !== 'sent') return res.status(400).json({ error: 'quote_locked' });
    await db.run(`UPDATE mart_quotes SET status='declined', updated_at=datetime('now') WHERE id = ?`, x.q.id);
    await notify(x.q.seller_business_id, 'declined', { en: `Your quote for ${x.inq.product} was not selected this time.`, hi: `${x.inq.product} के लिए आपका quote इस बार नहीं चुना गया।`, hg: `${x.inq.product} ke liye aapka quote is baar nahi chuna gaya.` }, 'sent', x.q.id);
    res.json({ ok: true });
  });

  app.post('/api/mart/quotes/:id/accept', ...guard, async (req, res) => {
    const bizId = req.user.business_id;
    const x = await quoteWithParties(req.params.id);
    if (!x || x.inq.business_id !== bizId) return res.status(404).json({ error: 'quote_not_found' });
    if (inquiryState(x.inq) !== 'open') return res.status(400).json({ error: 'inquiry_not_open' });
    if (x.q.status !== 'sent') return res.status(400).json({ error: 'quote_locked' });
    if (quoteExpired(x.q)) return res.status(400).json({ error: 'quote_expired' });
    if (Number(x.q.moq) > 0 && Number(x.inq.qty) < Number(x.q.moq)) return res.status(400).json({ error: 'below_moq' });
    const total = round2(Number(x.inq.qty) * Number(x.q.price));
    const tx = await db.begin();
    let orderId;
    try {
      await tx.run(`UPDATE mart_quotes SET status='accepted', updated_at=datetime('now') WHERE id = ?`, x.q.id);
      await tx.run(`UPDATE mart_quotes SET status='closed', updated_at=datetime('now') WHERE inquiry_id = ? AND id <> ? AND status = 'sent'`, x.inq.id, x.q.id);
      await tx.run(`UPDATE mart_inquiries SET status='ordered', updated_at=datetime('now') WHERE id = ?`, x.inq.id);
      const r = await tx.run(
        `INSERT INTO mart_orders (inquiry_id, quote_id, buyer_business_id, seller_business_id, product, qty, unit, price, total, payment_terms, advance_percent, credit_days, delivery_days, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'placed')`
      , x.inq.id, x.q.id, bizId, x.q.seller_business_id, x.inq.product, x.inq.qty, x.inq.unit, x.q.price, total, x.q.payment_terms,
        x.q.advance_percent == null ? null : Number(x.q.advance_percent), x.q.credit_days == null ? null : Number(x.q.credit_days), x.q.delivery_days);
      orderId = r.lastInsertRowid;
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      return res.status(500).json({ error: 'could_not_place_order' });
    }
    const buyer = await buyerLabel({ ...x.inq, show_name: 1 }, null);
    await notify(x.q.seller_business_id, 'order', { en: `🎉 New order ${orderNo(orderId)} from ${buyer.name}: ${x.inq.qty} ${x.inq.unit} ${x.inq.product} · ₹${total}`, hi: `🎉 नया order ${orderNo(orderId)} — ${buyer.name}: ${x.inq.qty} ${x.inq.unit} ${x.inq.product} · ₹${total}`, hg: `🎉 Naya order ${orderNo(orderId)} — ${buyer.name}: ${x.inq.qty} ${x.inq.unit} ${x.inq.product} · ₹${total}` }, 'order', orderId);
    const losers = await db.all(`SELECT seller_business_id, id FROM mart_quotes WHERE inquiry_id = ? AND status = 'closed'`, x.inq.id);
    for (const l of losers) await notify(l.seller_business_id, 'closed', { en: `The buyer chose another seller for ${x.inq.product}.`, hi: `Buyer ने ${x.inq.product} के लिए दूसरा seller चुना।`, hg: `Buyer ne ${x.inq.product} ke liye doosra seller chuna.` }, 'sent', l.id);
    await auditLog(req, 'create', 'mart_order', orderId, `Business Mart order ${orderNo(orderId)}: ${x.inq.product} · ₹${total}`);
    const o = await db.get('SELECT * FROM mart_orders WHERE id = ?', orderId);
    res.status(201).json({ order: await publicOrder(o, bizId, new Map()) });
  });

  app.get('/api/mart/quotes-sent', ...guard, async (req, res) => {
    const bizId = req.user.business_id;
    const rows = await db.all('SELECT * FROM mart_quotes WHERE seller_business_id = ? ORDER BY updated_at DESC, id DESC LIMIT 200', bizId);
    const out = [];
    for (const q of rows) {
      const inq = await db.get('SELECT * FROM mart_inquiries WHERE id = ?', q.inquiry_id);
      const order = await db.get('SELECT id, status FROM mart_orders WHERE quote_id = ?', q.id);
      out.push({ ...publicQuote(q), inquiry: publicInquiry(inq), buyer: await buyerLabel(inq, bizId), order: order ? { id: order.id, order_no: orderNo(order.id), status: order.status } : null });
    }
    res.json({ quotes: out });
  });

  // ---------- messages (chat + counter-offers) on one quote ----------
  async function quoteParty(req, res) {
    const x = await quoteWithParties(req.params.id);
    const bizId = req.user.business_id;
    if (!x || (x.q.seller_business_id !== bizId && x.inq.business_id !== bizId)) { res.status(404).json({ error: 'quote_not_found' }); return null; }
    return { ...x, side: x.inq.business_id === bizId ? 'buyer' : 'seller' };
  }
  app.get('/api/mart/quotes/:id/messages', ...guard, async (req, res) => {
    const x = await quoteParty(req, res); if (!x) return;
    const rows = await db.all('SELECT * FROM mart_messages WHERE quote_id = ? ORDER BY id ASC', x.q.id);
    const cache = new Map();
    const seller = await publicSeller(x.q.seller_business_id, cache);
    const buyer = await buyerLabel(x.inq, req.user.business_id);
    res.json({
      side: x.side, quote: publicQuote(x.q), inquiry: publicInquiry(x.inq),
      seller: { name: seller.name }, buyer: { name: buyer.name },
      messages: rows.map((m) => ({ id: m.id, mine: m.sender_business_id === req.user.business_id, kind: m.kind, body: m.body, amount: m.amount, created_at: m.created_at }))
    });
  });
  app.post('/api/mart/quotes/:id/messages', ...guard, async (req, res) => {
    const x = await quoteParty(req, res); if (!x) return;
    const b = req.body || {};
    let kind = 'text', amount = null, body = str(b.body, 600);
    if (b.counter_price !== undefined && b.counter_price !== null && b.counter_price !== '') {
      if (x.side !== 'buyer') return res.status(400).json({ error: 'only_buyer_counters' });
      if (!validNum(b.counter_price) || Number(b.counter_price) <= 0) return res.status(400).json({ error: 'invalid_counter_price' });
      if (x.q.status !== 'sent') return res.status(400).json({ error: 'quote_locked' });
      kind = 'counter'; amount = round2(b.counter_price);
      body = body || `Can you do ₹${amount}/${x.inq.unit}?`;
    }
    if (!body) return res.status(400).json({ error: 'message_required' });
    await db.run(`INSERT INTO mart_messages (quote_id, sender_business_id, kind, body, amount) VALUES (?, ?, ?, ?, ?)`
    , x.q.id, req.user.business_id, kind, body, amount);
    if (x.side === 'buyer') {
      const who = await buyerLabel(x.inq, x.q.seller_business_id);
      await notify(x.q.seller_business_id, kind === 'counter' ? 'counter' : 'message',
        kind === 'counter' ? { en: `${who.name} counter-offered ₹${amount}/${x.inq.unit} on ${x.inq.product}`, hi: `${who.name} ने ${x.inq.product} पर ₹${amount}/${x.inq.unit} का counter-offer भेजा`, hg: `${who.name} ne ${x.inq.product} par ₹${amount}/${x.inq.unit} ka counter-offer bheja` } : `${who.name}: ${body.slice(0, 80)}`, 'chat', x.q.id);
    } else {
      const s = await publicSeller(x.q.seller_business_id);
      await notify(x.inq.business_id, 'message', `${s.name}: ${body.slice(0, 80)}`, 'chat', x.q.id);
    }
    res.status(201).json({ ok: true });
  });

  // ===================== orders =====================
  app.get('/api/mart/orders', ...guard, async (req, res) => {
    const bizId = req.user.business_id;
    const role = req.query.role === 'seller' ? 'seller' : 'buyer';
    const col = role === 'seller' ? 'seller_business_id' : 'buyer_business_id';
    const rows = await db.all(`SELECT * FROM mart_orders WHERE ${col} = ? ORDER BY id DESC LIMIT 200`, bizId);
    const cache = new Map();
    const out = [];
    for (const o of rows) out.push(await publicOrder(o, bizId, cache));
    res.json({ orders: out });
  });

  async function partyOrder(req, res) {
    const o = await db.get('SELECT * FROM mart_orders WHERE id = ?', req.params.id);
    const bizId = req.user.business_id;
    if (!o || (o.buyer_business_id !== bizId && o.seller_business_id !== bizId)) { res.status(404).json({ error: 'order_not_found' }); return null; }
    return { o, side: o.buyer_business_id === bizId ? 'buyer' : 'seller' };
  }

  app.post('/api/mart/orders/:id/status', ...guard, async (req, res) => {
    const x = await partyOrder(req, res); if (!x) return;
    const body = req.body || {};
    const to = String(body.status || '');
    const from = x.o.status;
    const allowed =
      (x.side === 'seller' && ((from === 'placed' && to === 'confirmed') || (from === 'confirmed' && to === 'dispatched') || (['placed', 'confirmed'].includes(from) && to === 'cancelled'))) ||
      (x.side === 'buyer' && from === 'placed' && to === 'cancelled');
    if (!allowed) return res.status(400).json({ error: 'invalid_status_change' });
    if (to === 'dispatched') {
      // Dispatch details ride along with the status change: when the goods
      // are expected, and who is carrying them. Both optional.
      let expDate = body.expected_delivery_date ? String(body.expected_delivery_date) : null;
      if (expDate && (!DATE_RE.test(expDate) || expDate < today())) return res.status(400).json({ error: 'invalid_expected_date' });
      await db.run(
        `UPDATE mart_orders SET status='dispatched', expected_delivery_date=?, transporter_name=?, updated_at=datetime('now') WHERE id = ?`
      , expDate, str(body.transporter_name, 80), x.o.id);
    } else {
      await db.run(`UPDATE mart_orders SET status=?, updated_at=datetime('now') WHERE id = ?`, to, x.o.id);
    }
    if (to === 'cancelled') {
      // Re-open the buyer's inquiry so other sellers' quotes become live again.
      await db.run(`UPDATE mart_quotes SET status='cancelled', updated_at=datetime('now') WHERE id = ?`, x.o.quote_id);
      await db.run(`UPDATE mart_quotes SET status='sent', updated_at=datetime('now') WHERE inquiry_id = ? AND status = 'closed'`, x.o.inquiry_id);
      await db.run(`UPDATE mart_inquiries SET status='open', updated_at=datetime('now') WHERE id = ?`, x.o.inquiry_id);
    }
    const otherId = x.side === 'seller' ? x.o.buyer_business_id : x.o.seller_business_id;
    const lbl = { confirmed: ['confirmed', 'पक्का हुआ', 'pakka hua'], dispatched: ['dispatched 🚚', 'भेज दिया गया 🚚', 'bhej diya gaya 🚚'], cancelled: ['cancelled', 'cancel हुआ', 'cancel hua'] }[to];
    let extra = '';
    if (to === 'dispatched') {
      const fresh = await db.get('SELECT expected_delivery_date, transporter_name FROM mart_orders WHERE id = ?', x.o.id);
      if (fresh && fresh.expected_delivery_date) extra = ` · expected by ${fresh.expected_delivery_date}`;
      if (fresh && fresh.transporter_name) extra += ` · via ${fresh.transporter_name}`;
    }
    await notify(otherId, 'order_status', { en: `Order ${orderNo(x.o.id)} (${x.o.product}) was ${lbl[0]}${extra}`, hi: `Order ${orderNo(x.o.id)} (${x.o.product}) ${lbl[1]}${extra}`, hg: `Order ${orderNo(x.o.id)} (${x.o.product}) ${lbl[2]}${extra}` }, 'order', x.o.id);
    await auditLog(req, 'update', 'mart_order', x.o.id, `Order ${orderNo(x.o.id)} → ${to}`);
    res.json({ order: await publicOrder(await db.get('SELECT * FROM mart_orders WHERE id = ?', x.o.id), req.user.business_id, new Map()) });
  });

  // Buyer marks goods received → normal Workspace purchase (stock goes up).
  app.post('/api/mart/orders/:id/receive', ...guard, async (req, res) => {
    const x = await partyOrder(req, res); if (!x) return;
    if (x.side !== 'buyer') return res.status(403).json({ error: 'buyer_only' });
    if (x.o.purchase_id) return res.status(400).json({ error: 'already_received' });
    if (!['placed', 'confirmed', 'dispatched'].includes(x.o.status)) return res.status(400).json({ error: 'invalid_status_change' });
    const bizId = req.user.business_id;
    const o = x.o;
    const b = req.body || {};
    const paid = b.paid_amount === undefined || b.paid_amount === '' ? 0 : Number(b.paid_amount);
    if (!Number.isFinite(paid) || paid < 0 || round2(paid) > round2(o.total)) return res.status(400).json({ error: 'paid_amount must be between 0 and the purchase total' });
    const mode = ['Cash', 'UPI', 'Bank'].includes(b.paid_mode) ? b.paid_mode : 'Cash';
    const inq = await db.get('SELECT * FROM mart_inquiries WHERE id = ?', o.inquiry_id);
    const seller = await publicSeller(o.seller_business_id, null, { withPhone: true });
    const date = today();

    const tx = await db.begin();
    try {
      // Supplier: reuse by name, else create from the seller's Mart profile.
      let sup = await tx.get('SELECT id FROM suppliers WHERE business_id = ? AND lower(name) = lower(?)', bizId, seller.name);
      if (!sup) {
        const r = await tx.run(`INSERT INTO suppliers (business_id, name, phone, city) VALUES (?, ?, ?, ?)`, bizId, seller.name, seller.phone || '', seller.city || '');
        sup = { id: r.lastInsertRowid };
      }
      // Product: the one the inquiry came from, else same name, else new.
      let prodId = null;
      if (inq && inq.product_id) {
        const p = await tx.get('SELECT id FROM products WHERE id = ? AND business_id = ?', inq.product_id, bizId);
        if (p) prodId = p.id;
      }
      if (!prodId) {
        const p = await tx.get('SELECT id FROM products WHERE business_id = ? AND lower(name) = lower(?)', bizId, o.product);
        if (p) prodId = p.id;
      }
      let createdProduct = false;
      if (!prodId) {
        const r = await tx.run(
          `INSERT INTO products (business_id, name, category, unit, buy_price, sell_price, gst_rate, stock_qty, low_stock_limit) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 5)`
        , bizId, o.product, (inq && inq.category) || '', o.unit, o.price);
        prodId = r.lastInsertRowid; createdProduct = true;
      }
      const amount = round2(Number(o.qty) * Number(o.price));
      const pr = await tx.run(
        `INSERT INTO purchases (business_id, supplier_id, bill_no, date, total, paid_amount, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)`
      , bizId, sup.id, orderNo(o.id), date, amount, round2(paid), null);
      const purchaseId = pr.lastInsertRowid;
      await tx.run(`INSERT INTO purchase_items (business_id, purchase_id, product_id, qty, buy_price, amount) VALUES (?, ?, ?, ?, ?, ?)`
      , bizId, purchaseId, prodId, Number(o.qty), Number(o.price), amount);
      await tx.run(`UPDATE products SET stock_qty = stock_qty + ?, updated_at=datetime('now'), sync_status='local' WHERE id=? AND business_id=?`
      , Number(o.qty), prodId, bizId);
      await tx.run(`INSERT INTO stock_movements (business_id, product_id, type, qty_change, ref_id) VALUES (?, ?, 'purchase', ?, ?)`
      , bizId, prodId, Number(o.qty), purchaseId);
      if (paid > 0) {
        await tx.run(`INSERT INTO supplier_payments (business_id, purchase_id, amount, mode, date) VALUES (?, ?, ?, ?, ?)`
        , bizId, purchaseId, round2(paid), mode, date);
      }
      await tx.run(`UPDATE mart_orders SET status='delivered', purchase_id=?, updated_at=datetime('now') WHERE id = ?`, purchaseId, o.id);
      await tx.commit();
      await auditLog(req, 'create', 'purchase', purchaseId, `Purchase (Business Mart ${orderNo(o.id)}): ${seller.name} · kul ₹${amount}`);
      await notify(o.seller_business_id, 'order_status', { en: `Order ${orderNo(o.id)} (${o.product}) was received by the buyer ✅`, hi: `Order ${orderNo(o.id)} (${o.product}) buyer को मिल गया ✅`, hg: `Order ${orderNo(o.id)} (${o.product}) buyer ko mil gaya ✅` }, 'order', o.id);
      queueSync();
      res.json({
        ok: true, purchase_id: purchaseId, created_product: createdProduct,
        order: await publicOrder(await db.get('SELECT * FROM mart_orders WHERE id = ?', o.id), bizId, new Map())
      });
    } catch (e) {
      await tx.rollback();
      console.error('mart receive failed:', e);
      res.status(500).json({ error: 'could not save purchase' });
    }
  });

  app.post('/api/mart/orders/:id/rate', ...guard, async (req, res) => {
    const x = await partyOrder(req, res); if (!x) return;
    if (x.side !== 'buyer') return res.status(403).json({ error: 'buyer_only' });
    if (x.o.status !== 'delivered') return res.status(400).json({ error: 'not_delivered' });
    if (x.o.rating) return res.status(400).json({ error: 'already_rated' });
    const r = Math.round(Number((req.body || {}).rating));
    if (!(r >= 1 && r <= 5)) return res.status(400).json({ error: 'invalid_rating' });
    await db.run(`UPDATE mart_orders SET rating=?, review=?, updated_at=datetime('now') WHERE id = ?`, r, str((req.body || {}).review, 300), x.o.id);
    await notify(x.o.seller_business_id, 'rating', { en: `You got a ${r}★ rating for order ${orderNo(x.o.id)}`, hi: `Order ${orderNo(x.o.id)} पर आपको ${r}★ rating मिली`, hg: `Order ${orderNo(x.o.id)} par aapko ${r}★ rating mili` }, 'order', x.o.id);
    res.json({ ok: true });
  });

  app.get('/api/mart/orders/:id/whatsapp-link', ...guard, async (req, res) => {
    const x = await partyOrder(req, res); if (!x) return;
    const otherId = x.side === 'buyer' ? x.o.seller_business_id : x.o.buyer_business_id;
    const other = await getBiz(otherId);
    const phone = waPhone(other && other.phone);
    if (!phone) return res.status(400).json({ error: 'other_phone_missing' });
    const meP = await publicSeller(req.user.business_id);
    const text = `Namaste! ${meP.name} here, about BizYour order ${orderNo(x.o.id)}: ${x.o.qty} ${x.o.unit} ${x.o.product} @ ₹${x.o.price}/${x.o.unit} (total ₹${x.o.total}).`;
    res.json({ url: `https://wa.me/${phone}?text=${encodeURIComponent(text)}` });
  });

  // Repeat order: one tap on a past order creates a FRESH inquiry to the
  // same seller, prefilled with the same item + quantity. Rates are never
  // carried over as an order — the seller quotes again, like always.
  app.post('/api/mart/orders/:id/repeat', ...guard, async (req, res) => {
    const x = await partyOrder(req, res); if (!x) return;
    if (x.side !== 'buyer') return res.status(403).json({ error: 'buyer_only' });
    if (x.o.status === 'cancelled') return res.status(400).json({ error: 'order_cancelled' });
    const bizId = req.user.business_id;
    const o = x.o;
    const orig = await db.get('SELECT * FROM mart_inquiries WHERE id = ?', o.inquiry_id);
    const prof = await ensureProfile(bizId);
    const biz = await getBiz(bizId);
    const needBy = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const r = await db.run(
      `INSERT INTO mart_inquiries (business_id, product, category, qty, unit, target_price, city, need_by, frequency, notes, show_name, verified_only, status, source, product_id, target_business_id, notified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'One-time', ?, 1, 0, 'open', 'reorder', ?, ?, 1)`
    , bizId, o.product, (orig && orig.category) || guessCategory(o.product), Number(o.qty), o.unit,
      null, prof.city || (biz && biz.city) || '', needBy,
      `Repeat of order ${orderNo(o.id)}`, orig && orig.product_id ? orig.product_id : null, o.seller_business_id);
    const inq = await db.get('SELECT * FROM mart_inquiries WHERE id = ?', r.lastInsertRowid);
    const who = await buyerLabel(inq, null);
    await notify(o.seller_business_id, 'lead', { en: `Repeat order request: ${who.name} needs ${inq.qty} ${inq.unit} ${inq.product} again`, hi: `दोबारा order की request: ${who.name} को फिर ${inq.qty} ${inq.unit} ${inq.product} चाहिए`, hg: `Dobara order ki request: ${who.name} ko phir ${inq.qty} ${inq.unit} ${inq.product} chahiye` }, 'lead', inq.id);
    await auditLog(req, 'create', 'mart_inquiry', inq.id, `Business Mart repeat inquiry from ${orderNo(o.id)}: ${inq.qty} ${inq.unit} ${inq.product}`);
    res.status(201).json({ inquiry: publicInquiry(inq) });
  });

  // Mart margin report (buyer): what Mart buying looks like against the
  // CURRENT Workspace sell price of the matched product. The margin is an
  // estimate at today's sell rate — the UI labels it exactly that way.
  app.get('/api/mart/report', ...guard, async (req, res) => {
    const bizId = req.user.business_id;
    const rows = await db.all(
      `SELECT * FROM mart_orders WHERE buyer_business_id = ? AND status = 'delivered' ORDER BY id DESC LIMIT 200`, bizId);
    const spendAll = await db.get(
      `SELECT COALESCE(SUM(total),0) AS s FROM mart_orders WHERE buyer_business_id = ? AND status <> 'cancelled'`, bizId);
    const cache = new Map();
    const out = [];
    let spendDelivered = 0, expectedMargin = 0, marginKnown = 0;
    for (const o of rows) {
      spendDelivered += Number(o.total) || 0;
      let prod = null;
      if (o.purchase_id) {
        const pi = await db.get('SELECT product_id FROM purchase_items WHERE purchase_id = ? ORDER BY id ASC LIMIT 1', o.purchase_id);
        if (pi) prod = await db.get('SELECT id, name, sell_price FROM products WHERE id = ? AND business_id = ?', pi.product_id, bizId);
      }
      if (!prod) prod = await db.get('SELECT id, name, sell_price FROM products WHERE business_id = ? AND lower(name) = lower(?)', bizId, o.product);
      const sell = prod && Number(prod.sell_price) > 0 ? Number(prod.sell_price) : null;
      const mpu = sell == null ? null : round2(sell - Number(o.price));
      const exp = sell == null ? null : round2((sell - Number(o.price)) * Number(o.qty));
      if (exp != null) { expectedMargin += exp; marginKnown++; }
      const seller = await publicSeller(o.seller_business_id, cache);
      out.push({
        order_id: o.id, order_no: orderNo(o.id), product: o.product, qty: o.qty, unit: o.unit,
        buy_rate: Number(o.price), total: Number(o.total), seller_name: seller.name,
        product_id: prod ? prod.id : null, sell_price: sell,
        margin_per_unit: mpu, expected_margin: exp,
        delivered_at: o.updated_at, purchase_id: o.purchase_id
      });
    }
    res.json({
      orders: out,
      totals: {
        delivered_orders: rows.length,
        spend_delivered: round2(spendDelivered),
        spend_all: round2(spendAll.s),
        expected_margin: round2(expectedMargin),
        margin_known_orders: marginKnown
      }
    });
  });

  // ===================== listings + sellers (browse) =====================
  function publicListing(l) {
    return { id: l.id, business_id: l.business_id, product_id: l.product_id, name: l.name, category: l.category, unit: l.unit, price: l.price, moq: l.moq, photo: l.photo || null, active: !!l.active, updated_at: l.updated_at };
  }
  // One photo per listing, stored as a client-resized JPEG/PNG/WebP data
  // URL. Anything else (or an oversized payload) is rejected, never stored.
  function validPhoto(v) {
    if (v === undefined || v === null || v === '') return { photo: null };
    if (typeof v !== 'string' || v.length > 400000) return { error: 'invalid_photo' };
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) return { error: 'invalid_photo' };
    return { photo: v };
  }
  async function viewerCity(bizId) {
    const p = await db.get('SELECT city FROM mart_profiles WHERE business_id = ?', bizId);
    if (p && p.city) return p.city;
    const b = await getBiz(bizId);
    return (b && b.city) || '';
  }
  app.get('/api/mart/listings', ...guard, async (req, res) => {
    const cat = String(req.query.category || '');
    const q = String(req.query.q || '').trim();
    const myCity = await viewerCity(req.user.business_id);
    let sql = `SELECT l.* FROM mart_listings l JOIN mart_profiles mp ON mp.business_id = l.business_id WHERE l.active = 1 AND mp.is_seller = 1`;
    const params = [];
    if (cat && CATEGORIES.includes(cat)) { sql += ' AND l.category = ?'; params.push(cat); }
    if (q) { sql += ' AND (l.name LIKE ? OR mp.display_name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    // Area-first: the viewer's own city before everyone else, then freshest.
    sql += ' ORDER BY CASE WHEN lower(mp.city) = lower(?) THEN 0 ELSE 1 END, l.updated_at DESC, l.id DESC LIMIT 200';
    params.push(myCity);
    const rows = await db.all(sql, ...params);
    const cache = new Map();
    const out = [];
    for (const l of rows) out.push({ ...publicListing(l), mine: l.business_id === req.user.business_id, seller: await publicSeller(l.business_id, cache) });
    res.json({ listings: out });
  });
  app.get('/api/mart/my-listings', ...guard, async (req, res) => {
    const rows = await db.all('SELECT * FROM mart_listings WHERE business_id = ? ORDER BY id DESC', req.user.business_id);
    res.json({ listings: rows.map(publicListing) });
  });
  function validListing(b) {
    if (!str(b.name, 120)) return 'name_required';
    if (!CATEGORIES.includes(b.category)) return 'invalid_category';
    if (!validNum(b.price) || Number(b.price) <= 0) return 'price must be greater than 0';
    if (!validNum(b.moq) || Number(b.moq) <= 0) return 'invalid_moq';
    return null;
  }
  app.post('/api/mart/listings', ...guard, async (req, res) => {
    const b = req.body || {};
    const prof = await ensureProfile(req.user.business_id);
    if (!prof.is_seller) return res.status(403).json({ error: 'not_seller' });
    const bad = validListing(b); if (bad) return res.status(400).json({ error: bad });
    const ph = validPhoto(b.photo); if (ph.error) return res.status(400).json({ error: ph.error });
    let pid = null;
    if (b.product_id) { const p = await db.get('SELECT id FROM products WHERE id = ? AND business_id = ?', b.product_id, req.user.business_id); if (p) pid = p.id; }
    const r = await db.run(
      `INSERT INTO mart_listings (business_id, product_id, name, category, unit, price, moq, photo, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    , req.user.business_id, pid, str(b.name, 120), b.category, UNITS.includes(b.unit) ? b.unit : 'kg', round2(b.price), Number(b.moq), ph.photo);
    res.status(201).json({ listing: publicListing(await db.get('SELECT * FROM mart_listings WHERE id = ?', r.lastInsertRowid)) });
  });
  app.put('/api/mart/listings/:id', ...guard, async (req, res) => {
    const l = await db.get('SELECT * FROM mart_listings WHERE id = ? AND business_id = ?', req.params.id, req.user.business_id);
    if (!l) return res.status(404).json({ error: 'listing_not_found' });
    const raw = req.body || {};
    const b = { ...l, ...raw };
    const bad = validListing(b); if (bad) return res.status(400).json({ error: bad });
    // Photo is only touched when the client sends the field (null removes).
    let photo = l.photo;
    if (Object.prototype.hasOwnProperty.call(raw, 'photo')) {
      const ph = validPhoto(raw.photo); if (ph.error) return res.status(400).json({ error: ph.error });
      photo = ph.photo;
    }
    await db.run(`UPDATE mart_listings SET name=?, category=?, unit=?, price=?, moq=?, photo=?, active=?, updated_at=datetime('now') WHERE id = ?`
    , str(b.name, 120), b.category, UNITS.includes(b.unit) ? b.unit : l.unit, round2(b.price), Number(b.moq), photo, b.active ? 1 : 0, l.id);
    res.json({ listing: publicListing(await db.get('SELECT * FROM mart_listings WHERE id = ?', l.id)) });
  });
  app.delete('/api/mart/listings/:id', ...guard, async (req, res) => {
    const r = await db.run('DELETE FROM mart_listings WHERE id = ? AND business_id = ?', req.params.id, req.user.business_id);
    if (!r.changes) return res.status(404).json({ error: 'listing_not_found' });
    res.json({ ok: true });
  });

  async function favouriteSet(bizId) {
    const rows = await db.all('SELECT seller_business_id FROM mart_favourites WHERE business_id = ?', bizId);
    return new Set(rows.map((r) => r.seller_business_id));
  }
  app.get('/api/mart/sellers', ...guard, async (req, res) => {
    const cat = String(req.query.category || '');
    const q = norm(req.query.q);
    const rows = await db.all('SELECT business_id, display_name, categories FROM mart_profiles WHERE is_seller = 1 ORDER BY display_name ASC');
    const cache = new Map();
    const favs = await favouriteSet(req.user.business_id);
    const out = [];
    for (const p of rows) {
      if (cat && CATEGORIES.includes(cat) && !list(p.categories).includes(cat)) continue;
      if (q && !norm(p.display_name).includes(q)) continue;
      out.push({ ...(await publicSeller(p.business_id, cache)), mine: p.business_id === req.user.business_id, is_favourite: favs.has(p.business_id) });
    }
    // Area-first: sellers in the viewer's own city first (name order kept
    // inside each group), then everyone else.
    const myCity = norm(await viewerCity(req.user.business_id));
    if (myCity) out.sort((a, b) => (norm(b.city) === myCity ? 1 : 0) - (norm(a.city) === myCity ? 1 : 0));
    res.json({ sellers: out });
  });
  app.get('/api/mart/sellers/:id', ...guard, async (req, res) => {
    const p = await db.get('SELECT * FROM mart_profiles WHERE business_id = ? AND is_seller = 1', req.params.id);
    if (!p) return res.status(404).json({ error: 'seller_not_found' });
    const seller = await publicSeller(p.business_id);
    const favs = await favouriteSet(req.user.business_id);
    seller.is_favourite = favs.has(p.business_id);
    const listings = await db.all('SELECT * FROM mart_listings WHERE business_id = ? AND active = 1 ORDER BY name ASC', p.business_id);
    const reviews = await db.all(
      `SELECT rating, review, product, updated_at FROM mart_orders WHERE seller_business_id = ? AND rating IS NOT NULL ORDER BY updated_at DESC LIMIT 20`, p.business_id);
    res.json({ seller, listings: listings.map(publicListing), reviews });
  });

  // ===================== favourites (Mere Wholesaler) =====================
  app.get('/api/mart/favourites', ...guard, async (req, res) => {
    const rows = await db.all('SELECT seller_business_id FROM mart_favourites WHERE business_id = ? ORDER BY id DESC', req.user.business_id);
    const cache = new Map();
    const out = [];
    for (const r of rows) out.push({ ...(await publicSeller(r.seller_business_id, cache)), is_favourite: true });
    res.json({ favourites: out });
  });
  app.post('/api/mart/favourites/:sellerId', ...guard, async (req, res) => {
    const bizId = req.user.business_id;
    const sid = Number(req.params.sellerId);
    if (!sid || sid === bizId) return res.status(400).json({ error: 'invalid_seller' });
    const p = await db.get('SELECT business_id FROM mart_profiles WHERE business_id = ? AND is_seller = 1', sid);
    if (!p) return res.status(404).json({ error: 'seller_not_found' });
    const exists = await db.get('SELECT id FROM mart_favourites WHERE business_id = ? AND seller_business_id = ?', bizId, sid);
    if (!exists) await db.run('INSERT INTO mart_favourites (business_id, seller_business_id) VALUES (?, ?)', bizId, sid);
    res.json({ ok: true, is_favourite: true });
  });
  app.delete('/api/mart/favourites/:sellerId', ...guard, async (req, res) => {
    await db.run('DELETE FROM mart_favourites WHERE business_id = ? AND seller_business_id = ?', req.user.business_id, Number(req.params.sellerId));
    res.json({ ok: true, is_favourite: false });
  });

  // ===================== notifications =====================
  app.get('/api/mart/notifications', ...guard, async (req, res) => {
    const rows = await db.all('SELECT * FROM mart_notifications WHERE business_id = ? ORDER BY id DESC LIMIT 60', req.user.business_id);
    res.json({ notifications: rows.map((n) => ({ id: n.id, kind: n.kind, text: n.text, link_view: n.link_view, link_id: n.link_id, read: !!n.is_read, created_at: n.created_at })) });
  });
  app.post('/api/mart/notifications/read-all', ...guard, async (req, res) => {
    await db.run('UPDATE mart_notifications SET is_read = 1 WHERE business_id = ? AND is_read = 0', req.user.business_id);
    res.json({ ok: true });
  });
}

module.exports = { registerMart, MART_CATEGORIES: CATEGORIES, MART_UNITS: UNITS, guessCategory };
