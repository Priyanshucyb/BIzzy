// BizYour — Business Mart frontend (vanilla JS, loaded after app.js).
// Uses app.js globals: $, api, me, fmt, fmtQty, esc, isHi, showScreen, friendly, gotoScreen.
// Every screen here reads/writes the real /api/mart/* endpoints — nothing is simulated.
(function () {
  'use strict';

  // ---------- state ----------
  const M = {
    module: 'workspace', mode: 'buy', view: 'home', arg: null,
    meta: null, profile: null, summary: null,
    browseTab: 'products', browseCat: '', browseQ: '', leadScope: 'matched',
    pollTimer: null, chatTimer: null
  };
  const L = (en, hi, hg) => tr(en, hi, hg);
  const ICON = { 'Staples': '🌾', 'FMCG': '🧴', 'Tea & Beverages': '🍵', 'Oil & Ghee': '🫙', 'Spices': '🌶️', 'Dairy': '🥛', 'Snacks & Sweets': '🍪', 'Packaging': '📦', 'Hardware': '🔩', 'Electrical': '💡', 'Stationery': '✏️', 'Textiles': '🧵', 'Other': '🏷️' };
  const ic = (c) => ICON[c] || '🏷️';
  const rs = (n) => fmt(n);

  function parseTs(t) { return new Date(String(t).replace(' ', 'T') + 'Z'); }
  function ago(t) {
    if (!t) return '';
    const m = Math.round((Date.now() - parseTs(t).getTime()) / 60000);
    if (m < 1) return L('just now', 'अभी');
    if (m < 60) return m + L(' min ago', ' मिनट पहले');
    const h = Math.round(m / 60);
    if (h < 24) return h + L(' hr ago', ' घंटे पहले');
    return Math.round(h / 24) + L(' d ago', ' दिन पहले');
  }
  function niceDate(s) { return s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'; }
  function dayPlus(n) { return new Date(Date.now() + n * 864e5).toISOString().slice(0, 10); }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'mk-toast'; el.textContent = msg;
    $('mkToasts').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }
  function errText(e) {
    const map = {
      below_moq: L('Your quantity is below this seller\'s minimum order. Increase the quantity in a new inquiry or ask the seller in chat.', 'आपकी मात्रा seller के minimum order से कम है। Chat में पूछो या नई inquiry डालो।'),
      quote_expired: L('This quote has expired. Ask the seller to update it.', 'ये quote expire हो गया है। Seller से update करवाओ।'),
      quote_locked: L('This quote can no longer be changed.', 'ये quote अब बदला नहीं जा सकता।'),
      inquiry_not_open: L('This inquiry is no longer open.', 'ये inquiry अब खुली नहीं है।'),
      not_seller: L('Turn on selling in your Mart profile first.', 'पहले Mart profile में selling चालू करो।'),
      gst_required: L('This buyer accepts quotes only from GST-registered sellers. Add your GSTIN in Settings.', 'ये buyer सिर्फ़ GST वाले sellers से quote लेता है। Settings में GSTIN डालो।'),
      pick_categories: L('Pick at least one category you sell.', 'कम से कम एक category चुनो।'),
      mart_access_only: L('Your staff access does not include Business Mart.', 'आपके staff access में Business Mart नहीं है।'),
      other_phone_missing: L('The other business has not added a phone number yet.', 'दूसरे business ने phone number नहीं डाला है।'),
      own_inquiry: L('You cannot quote on your own inquiry.', 'अपनी inquiry पर quote नहीं दे सकते।'),
      invalid_need_by: L('Pick a delivery date from today onwards.', 'आज या आगे की date चुनो।')
    };
    return map[e.message] || friendly(e);
  }

  // ---------- modal ----------
  function openModal(html) { $('mkModal').innerHTML = html; $('mkOverlay').classList.remove('hidden'); }
  function closeModal() { $('mkOverlay').classList.add('hidden'); $('mkModal').innerHTML = ''; if (M.chatTimer) { clearInterval(M.chatTimer); M.chatTimer = null; } }
  $('mkOverlay').addEventListener('click', (e) => { if (e.target.id === 'mkOverlay') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('mkOverlay').classList.contains('hidden')) closeModal(); });

  // Event delegation: elements carry data-act="name" data-*.
  const ACT = {};
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !(el.closest('#martView') || el.closest('#mkModal') || el.closest('#martNav'))) return;
    const fn = ACT[el.dataset.act];
    if (fn) { if (el.tagName !== 'INPUT') e.preventDefault(); fn(el.dataset, el); }
  });

  // ---------- module switching ----------
  function setModule(mod) {
    M.module = mod;
    $('modWorkspace').classList.toggle('on', mod === 'workspace');
    $('modMart').classList.toggle('on', mod === 'mart');
    $('nav').classList.toggle('hidden', mod === 'mart');
    $('martNav').classList.toggle('hidden', mod !== 'mart');
  }
  $('modWorkspace').addEventListener('click', () => { if (M.module !== 'workspace') { setModule('workspace'); gotoScreen('dashboard'); } });
  $('modMart').addEventListener('click', () => openMart());
  // Any Workspace nav click (incl. global search jumps) brings the Workspace module back.
  document.querySelectorAll('#nav .nav-item').forEach((b) => b.addEventListener('click', () => { if (M.module !== 'workspace') setModule('workspace'); }, true));
  $('dashGoMart').addEventListener('click', () => { M.mode = 'buy'; openMart('home'); });

  async function openMart(view) {
    setModule('mart');
    showScreen('mart');
    if (!M.meta) { try { M.meta = await api('GET', '/api/mart/meta'); } catch (e) { /* shown by view */ } }
    await loadProfile();
    go(view || (M.mode === 'buy' ? 'home' : 'leads'));
  }
  async function loadProfile() { try { M.profile = (await api('GET', '/api/mart/profile')).profile; } catch (e) { M.profile = null; } }

  async function refreshSummary() {
    if (!me || !token) return;
    try {
      M.summary = await api('GET', '/api/mart/summary');
      const s = M.summary;
      const dot = s.unread + s.buying.new_quotes + (s.selling.is_seller ? s.selling.new_leads : 0);
      $('martBadge').classList.toggle('hidden', !dot);
      $('martBadge').textContent = dot > 99 ? '99+' : (dot || '');
      if (M.module === 'mart') renderNav();
    } catch (e) { $('martBadge').classList.add('hidden'); }
  }

  // ---------- nav ----------
  const TITLES = {
    home: ['Business Mart', 'बिज़नेस मार्ट'], post: ['Post a purchase inquiry', 'खरीद की inquiry डालो'],
    bulk: ['Bulk inquiry — many sellers', 'Bulk inquiry — कई sellers'], favourites: ['Mere Wholesaler', 'मेरे Wholesaler'],
    seller: ['Seller rate list', 'Seller की rate list'], report: ['Mart Report', 'Mart Report'],
    inquiries: ['My inquiries', 'मेरी inquiries'], inquiry: ['Inquiry', 'Inquiry'], browse: ['Browse the Mart', 'Mart देखो'],
    orders: ['Mart orders', 'Mart ऑर्डर'], leads: ['Buyer leads', 'खरीदार leads'], sent: ['Quotes sent', 'भेजे गए quotes'],
    catalog: ['My Mart catalog', 'मेरा Mart catalog'], profile: ['Mart profile', 'Mart प्रोफ़ाइल'], notifs: ['Mart notifications', 'Mart सूचनाएं']
  };
  function renderNav() {
    const s = M.summary || { buying: {}, selling: {}, unread: 0 };
    const n = (v, icon, en, hi, ct) => `<button class="nav-item ${M.view === v || (v === 'inquiries' && M.view === 'inquiry') ? 'active' : ''}" data-act="nav" data-v="${v}"><span class="ic">${icon}</span><span>${L(en, hi)}</span>${ct ? `<span class="mk-ct">${ct}</span>` : ''}</button>`;
    $('martNav').innerHTML = `
      <div class="mk-seg"><button class="${M.mode === 'buy' ? 'on' : ''}" data-act="mode" data-m="buy">${L('Buying', 'खरीदना')}</button><button class="${M.mode === 'sell' ? 'on' : ''}" data-act="mode" data-m="sell">${L('Selling', 'बेचना')}</button></div>
      ${M.mode === 'buy'
        ? n('home', '🛒', 'Mart home', 'मार्ट होम') + n('post', '➕', 'Post inquiry', 'Inquiry डालो') + n('bulk', '📣', 'Bulk inquiry', 'Bulk inquiry') + n('inquiries', '📋', 'My inquiries', 'मेरी inquiries', s.buying.new_quotes) + n('browse', '🔍', 'Browse', 'देखो') + n('favourites', '⭐', 'Mere Wholesaler', 'मेरे Wholesaler') + n('orders', '🚚', 'Orders', 'ऑर्डर', s.buying.active_orders) + n('report', '📊', 'Mart Report', 'Mart Report')
        : n('leads', '🎯', 'Leads', 'Leads', s.selling.is_seller ? s.selling.new_leads : 0) + n('sent', '📤', 'Quotes sent', 'भेजे quotes') + n('orders', '🚚', 'Orders', 'ऑर्डर', s.selling.active_orders) + n('catalog', '🏷️', 'My catalog', 'मेरा catalog') + n('profile', '🪪', 'Mart profile', 'Mart प्रोफ़ाइल')}
      ${n('notifs', '🔔', 'Notifications', 'सूचनाएं', s.unread)}
      <button class="nav-item" data-act="logout"><span class="ic">🚪</span><span>${L('Log out', 'लॉगआउट')}</span></button>`;
  }
  ACT.nav = (d) => go(d.v);
  ACT.logout = () => { const b = $('logoutBtn'); if (b) b.click(); };
  ACT.mode = (d) => { M.mode = d.m; go(d.m === 'buy' ? 'home' : 'leads'); };

  async function go(view, arg) {
    M.view = view; M.arg = arg === undefined ? null : arg;
    renderNav();
    const t = TITLES[view] || TITLES.home;
    $('pageTitle').textContent = L(t[0], t[1]);
    $('martView').innerHTML = `<div class="hint" style="padding:30px;text-align:center">${L('Loading…', 'लोड हो रहा है…')}</div>`;
    window.scrollTo(0, 0);
    try { await (V[view] || V.home)(M.arg); }
    catch (e) { $('martView').innerHTML = `<div class="card"><div class="err" style="display:block">${esc(errText(e))}</div></div>`; }
    refreshSummary();
  }

  // ===================================================================
  // VIEWS
  // ===================================================================
  const V = {};
  const empty = (e, txt) => `<div class="mk-empty"><div class="e">${e}</div>${txt}</div>`;
  const gstBadge = (s) => s.gst_registered ? `<span class="mk-gst" title="${L('GSTIN added by this business', 'इस business ने GSTIN डाला है')}">✔ GST</span>` : '';
  const verifiedBadge = (s) => s && s.verified ? `<span class="mk-verified" title="${L('Verified: valid GSTIN, phone and city on file', 'Verified: सही GSTIN, phone और शहर दर्ज है')}">✓ Verified</span>` : '';
  // Payment-term split from a quote/order: "Advance 20% · 15 din credit".
  const termsTxt = (x) => {
    const parts = [];
    if (x.advance_percent != null) parts.push(`${L('Advance', 'Advance')} ${fmtQty(x.advance_percent)}%`);
    if (x.credit_days != null) parts.push(`${x.credit_days} ${L('days credit', 'दिन credit')}`);
    return parts.length ? `<span class="mk-terms">${parts.join(' · ')}</span>` : '';
  };
  const favBtn = (s) => `<button class="mk-fav ${s.is_favourite ? 'on' : ''}" data-act="fav" data-id="${s.business_id}" title="${L('Save to Mere Wholesaler', 'Mere Wholesaler में जोड़ो')}">${s.is_favourite ? '★' : '☆'}</button>`;
  ACT.fav = async (d, el) => {
    try {
      if (el.classList.contains('on')) { await api('DELETE', '/api/mart/favourites/' + d.id); toast(L('Removed from Mere Wholesaler', 'Mere Wholesaler से हटाया')); }
      else { await api('POST', '/api/mart/favourites/' + d.id); toast(`⭐ ${L('Saved to Mere Wholesaler', 'Mere Wholesaler में जुड़ा')}`); }
      if (M.view === 'browse') V.browse(); else if (M.view === 'seller') go('seller', M.arg); else if (M.view === 'favourites') V.favourites();
    } catch (e) { toast(errText(e)); }
  };
  const ratingTxt = (s) => s.rating ? `★ ${s.rating} (${s.ratings_count})` : (s.deals ? L('No ratings yet', 'अभी rating नहीं') : L('New on Mart', 'Mart पर नया'));
  const dealsTxt = (s) => `${s.deals} ${s.deals === 1 ? L('deal', 'सौदा') : L('deals', 'सौदे')}`;

  // ---------- BUY: home ----------
  V.home = async () => {
    const [sum, rs1, inqs, lst] = await Promise.all([
      api('GET', '/api/mart/summary'), api('GET', '/api/mart/restock'),
      api('GET', '/api/mart/inquiries'), api('GET', '/api/mart/listings')
    ]);
    M.summary = sum;
    const b = sum.buying;
    const withQuotes = inqs.inquiries.filter((i) => i.status === 'open' && i.quotes_count > 0).slice(0, 4);
    const popular = lst.listings.filter((l) => !l.mine).slice(0, 4);
    $('martView').innerHTML = `
      <div class="stats">
        <div class="stat"><div class="lbl">📋 ${L('Open inquiries', 'खुली inquiries')}</div><div class="val">${b.open_inquiries}</div><div class="sub">${L('Waiting for quotes or your decision', 'quotes या आपके फ़ैसले का इंतज़ार')}</div></div>
        <div class="stat"><div class="lbl">💬 ${L('Quotes to review', 'देखने वाले quotes')}</div><div class="val" style="color:var(--blue)">${b.new_quotes}</div><div class="sub">${L('From sellers', 'sellers से')}</div></div>
        <div class="stat"><div class="lbl">🚚 ${L('Active orders', 'चालू ऑर्डर')}</div><div class="val">${b.active_orders}</div><div class="sub">${L('Placed through the Mart', 'Mart से दिए गए')}</div></div>
        <div class="stat"><div class="lbl">💰 ${L('Bought via Mart', 'Mart से खरीदा')}</div><div class="val">${rs(b.spend)}</div><div class="sub">${L('All time', 'अब तक')}</div></div>
      </div>
      <div class="grid2" style="align-items:start">
        <div class="card mk-smart">
          <h3>✨ ${L('Restock from your Workspace data', 'Workspace के data से मंगाओ')}</h3>
          <div class="hint">${L('These products are low in your stock. One tap makes a ready inquiry with your usual quantity and last price.', 'ये सामान stock में कम है। एक tap में तैयार inquiry — आपकी usual मात्रा और पिछले भाव के साथ।')}</div>
          ${rs1.items.length ? rs1.items.map((p) => `
            <div class="mk-item">
              <div class="mk-ic">${ic(p.category)}</div>
              <div style="flex:1;min-width:0"><b>${esc(p.name)}</b><small>${fmtQty(p.stock_qty)} ${esc(p.unit)} ${L('left', 'बचे')} · ${L('usually', 'आमतौर पर')} ${fmtQty(p.suggested_qty)}${p.last_price ? ' · ' + L('last', 'पिछला') + ' ' + rs(p.last_price) : ''}${p.last_supplier ? ' ' + L('from', 'से') + ' ' + esc(p.last_supplier) : ''}</small></div>
              ${p.open_inquiry_id
                ? `<button class="btn btn-sm mk-wbtn" data-act="openInq" data-id="${p.open_inquiry_id}">${L('Inquiry open →', 'Inquiry खुली है →')}</button>`
                : `<button class="btn btn-sm mk-wbtn" data-act="restock" data-pid="${p.product_id}">${L('Create inquiry →', 'Inquiry बनाओ →')}</button>`}
            </div>`).join('') : `<div class="mk-item">${L('Nothing is running low right now. 👍', 'अभी कुछ भी कम नहीं है। 👍')}</div>`}
        </div>
        <div class="card">
          <h3>${L('How Business Mart works', 'Business Mart कैसे चलता है')}</h3>
          <div class="mk-how">
            <div><span>📝</span><b>${L('Post what you need', 'जो चाहिए वो डालो')}</b><small>${L('Product, quantity, target price, date', 'सामान, मात्रा, target भाव, date')}</small></div>
            <div><span>📣</span><b>${L('Matching sellers are notified', 'मिलते-जुलते sellers को सूचना')}</b><small>${L('Only sellers of that category who deliver to you', 'सिर्फ़ उसी category के sellers जो आप तक deliver करते हैं')}</small></div>
            <div><span>⚖️</span><b>${L('Compare quotes, negotiate', 'Quotes मिलाओ, मोल-भाव करो')}</b><small>${L('Price, delivery, credit side by side', 'भाव, delivery, उधार — साथ-साथ')}</small></div>
            <div><span>✅</span><b>${L('Accept → receive → Purchases', 'Accept → माल आया → खरीद')}</b><small>${L('Received goods land in Workspace stock', 'आया माल Workspace stock में जुड़ता है')}</small></div>
          </div>
          <button class="btn btn-blue" style="margin-top:12px" data-act="nav" data-v="post">+ ${L('Post inquiry', 'Inquiry डालो')}</button>
        </div>
      </div>
      <div class="grid2" style="grid-template-columns:1fr 1fr">
        <div class="card">
          <div class="mk-row"><h3>${L('Quotes on your inquiries', 'आपकी inquiries पर quotes')}</h3><button class="btn btn-ghost btn-sm" data-act="nav" data-v="inquiries">${L('All inquiries', 'सारी inquiries')}</button></div>
          ${withQuotes.length ? withQuotes.map((i) => `
            <div class="mk-li" data-act="openInq" data-id="${i.id}"><div class="mk-ic">${ic(i.category)}</div>
              <div style="flex:1"><b>${esc(i.product)}</b><small>${fmtQty(i.qty)} ${esc(i.unit)} · ${i.quotes_count} ${L('quotes', 'quotes')}${i.new_quotes ? ` · <span style="color:var(--blue)">${i.new_quotes} ${L('to review', 'देखने हैं')}</span>` : ''}</small></div>
              <div style="text-align:right"><b>${i.best_price != null ? rs(i.best_price) + '/' + esc(i.unit) : '—'}</b><small>${L('best price', 'सबसे कम भाव')}</small></div></div>`).join('')
            : empty('💬', L('No quotes yet. Post an inquiry to get quotes from sellers.', 'अभी कोई quote नहीं। Inquiry डालो, sellers quote भेजेंगे।'))}
        </div>
        <div class="card">
          <div class="mk-row"><h3>${L('On the Mart', 'Mart पर')}</h3><button class="btn btn-ghost btn-sm" data-act="nav" data-v="browse">${L('Browse', 'देखो')}</button></div>
          ${popular.length ? popular.map((l) => `
            <div class="mk-li">${l.photo ? `<img class="mk-thumb" src="${l.photo}" alt="">` : `<div class="mk-ic">${ic(l.category)}</div>`}
              <div style="flex:1"><b>${esc(l.name)}</b><small><a data-act="seller" data-id="${l.business_id}">${esc(l.seller.name)}</a>${verifiedBadge(l.seller)} · ${L('min', 'कम से कम')} ${fmtQty(l.moq)} ${esc(l.unit)}</small></div>
              <div style="text-align:right"><b>${rs(l.price)}/${esc(l.unit)}</b><div><button class="btn btn-soft btn-sm" style="margin-top:4px" data-act="quoteListing" data-id="${l.id}">${L('Get quote', 'Quote मांगो')}</button></div></div></div>`).join('')
            : empty('🏷️', L('No listings yet.', 'अभी कोई listing नहीं।'))}
        </div>
      </div>`;
    M._restock = rs1.items; M._listings = lst.listings;
  };
  ACT.restock = (d) => {
    const p = (M._restock || []).find((x) => String(x.product_id) === d.pid);
    if (!p) return;
    go('post', { product: p.name, category: p.category, qty: p.suggested_qty, unit: p.unit, target_price: p.last_price, product_id: p.product_id, source: 'stock', stockNote: p });
  };
  ACT.quoteListing = (d) => {
    const l = (M._listings || []).find((x) => String(x.id) === d.id);
    if (!l) return;
    closeModal();
    M.mode = 'buy';
    go('post', { product: l.name, category: l.category, qty: l.moq, unit: l.unit, target_price: l.price, source: 'listing', target_business_id: l.business_id, target_name: l.seller.name });
  };
  ACT.openInq = (d) => { M.mode = 'buy'; go('inquiry', Number(d.id)); };

  // ---------- BUY: post inquiry ----------
  V.post = async (pre) => {
    pre = pre || {};
    const meta = M.meta || (M.meta = await api('GET', '/api/mart/meta'));
    const city = (M.profile && M.profile.city) || (me.business.city) || '';
    const sn = pre.stockNote;
    $('martView').innerHTML = `
      <div class="grid2">
        <form class="card" id="mkPostForm">
          ${sn ? `<div class="mk-prefill">✨ ${L('Filled from your Workspace:', 'Workspace से भरा गया:')} <b>${esc(sn.name)}</b> — ${fmtQty(sn.stock_qty)} ${esc(sn.unit)} ${L('left', 'बचे')}. ${L('Quantity is your usual order; target is your last price.', 'मात्रा आपका usual order है; target आपका पिछला भाव।')}</div>` : ''}
          ${pre.target_name ? `<div class="mk-prefill">🏷️ ${L('Started from', 'शुरुआत')} <b>${esc(pre.target_name)}</b>${L("'s listing — they will be notified directly. Other matching sellers can also quote.", ' की listing से — उन्हें सीधे सूचना जाएगी। बाकी matching sellers भी quote कर सकते हैं।')}</div>` : ''}
          <div class="err" id="mkPostErr"></div>
          <div class="field"><label>${L('What do you want to buy? *', 'क्या खरीदना है? *')}</label><input class="input" name="product" required maxlength="120" value="${esc(pre.product || '')}" placeholder="${L('e.g. Sona Masoori Rice, 25kg bags', 'जैसे Sona Masoori Rice, 25kg bags')}"></div>
          <div class="row2">
            <div class="field"><label>${L('Category *', 'Category *')}</label><select class="input" name="category">${meta.categories.map((c) => `<option ${c === (pre.category || 'Staples') ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
            <div class="field"><label>${L('Quantity *', 'मात्रा *')}</label><div style="display:flex;gap:8px"><input class="input" name="qty" type="number" min="0.01" step="any" required value="${pre.qty || ''}"><select class="input" name="unit" style="width:120px">${meta.units.map((u) => `<option ${u === (pre.unit || 'kg') ? 'selected' : ''}>${u}</option>`).join('')}</select></div></div>
          </div>
          <div class="row2">
            <div class="field"><label>${L('Target price per unit (optional)', 'प्रति unit target भाव (optional)')}</label><input class="input" name="target_price" type="number" min="0" step="any" value="${pre.target_price || ''}" placeholder="₹"><div class="mk-hint">${L('Sellers see this. Leave blank for open quotes.', 'Sellers को दिखेगा। खाली छोड़ो तो खुले quotes आएंगे।')}</div></div>
            <div class="field"><label>${L('Need it by *', 'कब तक चाहिए *')}</label><input class="input" name="need_by" type="date" required min="${dayPlus(0)}" value="${dayPlus(3)}"></div>
          </div>
          <div class="row2">
            <div class="field"><label>${L('Deliver to (city) *', 'Delivery शहर *')}</label><input class="input" name="city" required value="${esc(city)}"></div>
            <div class="field"><label>${L('How often?', 'कितनी बार?')}</label><select class="input" name="frequency">${meta.frequencies.map((f) => `<option>${f}</option>`).join('')}</select><div class="mk-hint">${L('Repeat buyers usually get better rates.', 'बार-बार खरीदने पर अक्सर बेहतर भाव मिलता है।')}</div></div>
          </div>
          <div class="field"><label>${L('Quality, brand or packing details', 'Quality, brand या packing')}</label><textarea class="input" name="notes" rows="3" maxlength="500" placeholder="${L('e.g. New crop, 25kg bags, no broken grains', 'जैसे नई फसल, 25kg bags')}"></textarea></div>
          <div class="row2">
            <label class="tgl-row"><div class="t-txt"><b>${L('Show my business name', 'मेरा नाम दिखाओ')}</b><span>${L('Off = sellers see "A business in your city" until you order', 'Off = order तक sellers को "आपके शहर का एक business" दिखेगा')}</span></div><span class="switch"><input type="checkbox" name="show_name" checked><span class="slider"></span></span></label>
            <label class="tgl-row"><div class="t-txt"><b>${L('Only GST-registered sellers', 'सिर्फ़ GST वाले sellers')}</b><span>${L('Sellers who have added a GSTIN', 'जिन्होंने GSTIN डाला है')}</span></div><span class="switch"><input type="checkbox" name="verified_only"><span class="slider"></span></span></label>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn-ghost" data-act="nav" data-v="home">${L('Cancel', 'रद्द करो')}</button><button class="btn btn-blue" type="submit">${L('Post inquiry', 'Inquiry डालो')}</button></div>
        </form>
        <div>
          <div class="card"><h3>📣 ${L('Who gets notified', 'किसको सूचना जाएगी')}</h3><div class="hint">${L('Sellers of this category who deliver to your city.', 'इस category के sellers जो आपके शहर में deliver करते हैं।')}</div><div id="mkReach">…</div></div>
          <div class="card" style="margin-top:16px"><h3>${L('Tips for better quotes', 'अच्छे quotes के लिए')}</h3><div class="hint" style="line-height:1.8;margin:0">• ${L('Mention brand, size and packing', 'Brand, size और packing लिखो')}<br>• ${L('A realistic target price gets faster replies', 'सही target भाव से जल्दी जवाब आता है')}<br>• ${L('Your inquiry stays open till the need-by date', 'Inquiry need-by date तक खुली रहती है')}</div></div>
        </div>
      </div>`;
    const f = $('mkPostForm');
    let tm = null;
    const reach = () => {
      clearTimeout(tm);
      tm = setTimeout(async () => {
        try {
          const r = await api('GET', `/api/mart/match-preview?category=${encodeURIComponent(f.category.value)}&city=${encodeURIComponent(f.city.value.trim())}&verified_only=${f.verified_only.checked ? 1 : 0}`);
          $('mkReach').innerHTML = r.count
            ? `<div class="mk-big">${r.count} ${r.count === 1 ? L('seller', 'seller') : L('sellers', 'sellers')}</div>` + r.sellers.map((s) => `<div class="mk-mini">${ic(f.category.value)} <span style="flex:1">${esc(s.name)} ${gstBadge(s)}</span><span class="muted">${esc(s.city)}</span></div>`).join('') + `<div class="mk-hint" style="margin-top:8px">${L('Any seller on the Mart can still see and quote.', 'Mart का कोई भी seller देख और quote कर सकता है।')}</div>`
            : `<div class="mk-hint">${L('No matching sellers yet. Your inquiry is still public on the Mart, and you can share it on WhatsApp with your own suppliers.', 'अभी कोई matching seller नहीं। Inquiry फिर भी Mart पर public रहेगी, और आप अपने suppliers को WhatsApp पर भेज सकते हो।')}</div>`;
        } catch (e) { $('mkReach').textContent = errText(e); }
      }, 250);
    };
    ['category', 'city', 'verified_only'].forEach((k) => f[k].addEventListener(k === 'city' ? 'input' : 'change', reach));
    reach();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideErr('mkPostErr');
      const body = {
        product: f.product.value.trim(), category: f.category.value, qty: Number(f.qty.value), unit: f.unit.value,
        target_price: f.target_price.value === '' ? null : Number(f.target_price.value),
        need_by: f.need_by.value, city: f.city.value.trim(), frequency: f.frequency.value, notes: f.notes.value.trim(),
        show_name: f.show_name.checked, verified_only: f.verified_only.checked,
        source: pre.source || 'manual', product_id: pre.product_id || null, target_business_id: pre.target_business_id || null
      };
      try {
        const r = await api('POST', '/api/mart/inquiries', body);
        toast(`✅ ${L('Inquiry posted', 'Inquiry डाल दी')} · ${r.notified} ${L('sellers notified', 'sellers को सूचना गई')}`);
        go('inquiry', r.inquiry.id);
      } catch (err) { showErr('mkPostErr', errText(err)); }
    });
  };

  // ---------- BUY: my inquiries ----------
  const INQ_TAG = { open: ['Waiting', 'इंतज़ार', 'tag-part'], ordered: ['Ordered', 'ऑर्डर हुआ', 'tag-paid'], closed: ['Closed', 'बंद', 'mk-tag-grey'], expired: ['Expired', 'समय ख़त्म', 'mk-tag-grey'] };
  V.inquiries = async () => {
    const r = await api('GET', '/api/mart/inquiries');
    $('martView').innerHTML = `<div class="card">
      <div class="toolbar"><div style="flex:1"><h3>${L('All purchase inquiries', 'सारी खरीद inquiries')}</h3><div class="hint" style="margin:0">${L('Everything you have asked the market for', 'जो भी आपने मार्केट से मांगा')}</div></div><button class="btn btn-blue" data-act="nav" data-v="post">+ ${L('Post inquiry', 'Inquiry डालो')}</button></div>
      ${r.inquiries.length ? `<div class="mk-scroll"><table><thead><tr><th>${L('Product', 'सामान')}</th><th>${L('Qty', 'मात्रा')}</th><th>${L('Target', 'Target')}</th><th>${L('Need by', 'कब तक')}</th><th>${L('Quotes', 'Quotes')}</th><th>${L('Seen by', 'देखा')}</th><th>${L('Status', 'हालत')}</th></tr></thead><tbody>
      ${r.inquiries.map((i) => { const t = INQ_TAG[i.status] || INQ_TAG.open; const tg = i.status === 'open' && i.quotes_count ? ['Quotes in', 'Quotes आए', 'mk-tag-blue'] : t; return `
        <tr class="mk-click" data-act="openInq" data-id="${i.id}"><td>${ic(i.category)} <b>${esc(i.product)}</b>${i.group_id ? ` <span class="tag mk-tag-blue">${L('Bulk', 'Bulk')}</span>` : ''}<div class="mk-hint">BM-INQ-${i.id} · ${ago(i.created_at)}${i.source === 'stock' ? ' · ✨ ' + L('from stock', 'stock से') : ''}${i.source === 'reorder' ? ' · ↻ ' + L('repeat order', 'dobara order') : ''}${i.source === 'bulk' ? ' · 📣 ' + L('bulk inquiry', 'bulk inquiry') : ''}</div></td>
        <td>${fmtQty(i.qty)} ${esc(i.unit)}</td><td>${i.target_price != null ? rs(i.target_price) : '—'}</td><td>${niceDate(i.need_by)}</td>
        <td>${i.quotes_count}${i.best_price != null ? ` <span class="mk-hint">· ${L('best', 'सबसे कम')} ${rs(i.best_price)}</span>` : ''}</td><td>${i.views} ${L('sellers', 'sellers')}</td>
        <td><span class="tag ${tg[2]}">${L(tg[0], tg[1])}</span></td></tr>`; }).join('')}
      </tbody></table></div>` : empty('📋', L('No inquiries yet.', 'अभी कोई inquiry नहीं।'))}
    </div>`;
  };

  // ---------- BUY: inquiry detail with quote comparison ----------
  V.inquiry = async (id) => {
    const r = await api('GET', '/api/mart/inquiries/' + id);
    if (r.role !== 'buyer') { M.mode = 'sell'; return V.lead(id); }
    const i = r.inquiry;
    const live = r.quotes.filter((q) => q.status === 'sent');
    let best = null, cheapest = null, fastest = null;
    if (live.length > 1) {
      const minP = Math.min(...live.map((q) => q.price));
      const score = (q) => (q.price / minP) * 60 + q.delivery_days * 4 - (q.seller.rating || 3.5) * 5 - (q.seller.gst_registered ? 4 : 0) - (/credit/.test(q.payment_terms) ? 3 : 0);
      best = [...live].sort((a, b) => score(a) - score(b))[0].id;
      cheapest = [...live].sort((a, b) => a.price - b.price)[0].id;
      fastest = [...live].sort((a, b) => a.delivery_days - b.delivery_days)[0].id;
    }
    const tag = INQ_TAG[i.status] || INQ_TAG.open;
    M._inq = r;
    // Bulk inquiry? Show the sibling copies so all quotes compare in one place.
    let groupHtml = '';
    if (i.group_id) {
      try {
        const [all, sl] = await Promise.all([api('GET', '/api/mart/inquiries'), api('GET', '/api/mart/sellers')]);
        const sibs = all.inquiries.filter((x) => x.group_id === i.group_id);
        if (sibs.length > 1) {
          const nameOf = (bid) => { const s = sl.sellers.find((y) => y.business_id === bid); return s ? s.name : L('Seller', 'Seller'); };
          groupHtml = `<div class="card" style="margin-top:12px"><b>📣 ${L('This was a bulk inquiry', 'Ye ek bulk inquiry thi')}</b><div class="mk-hint">${L('The same requirement went to these sellers — compare every quote from here:', 'Wahi requirement in sellers ko gayi thi — saare quotes yahin se milao:')}</div><div class="mk-group-strip">${sibs.map((x) => x.id === i.id
            ? `<span class="mk-group-chip cur">${esc(nameOf(x.target_business_id))} · ${x.quotes_count} ${L('quote(s)', 'quote(s)')}${x.best_price != null ? ' · ' + L('best', 'sabse kam') + ' ' + rs(x.best_price) : ''} · ${L('you are here', 'aap yahan ho')}</span>`
            : `<a class="mk-group-chip" data-act="openInq" data-id="${x.id}">${esc(nameOf(x.target_business_id))} · ${x.quotes_count} ${L('quote(s)', 'quote(s)')}${x.best_price != null ? ' · ' + L('best', 'sabse kam') + ' ' + rs(x.best_price) : ''} →</a>`).join('')}</div></div>`;
        }
      } catch (e) { /* strip is optional */ }
    }
    $('martView').innerHTML = `
      <button class="btn btn-ghost btn-sm" data-act="nav" data-v="inquiries">← ${L('All inquiries', 'सारी inquiries')}</button>
      <div class="card" style="margin-top:12px">
        <div class="mk-row" style="align-items:flex-start;flex-wrap:wrap">
          <div><div class="mk-hint">BM-INQ-${i.id} · ${L('posted', 'डाली')} ${ago(i.created_at)} · <span class="tag ${tag[2]}">${L(tag[0], tag[1])}</span></div>
            <h3 style="font-size:19px;margin-top:4px">${ic(i.category)} ${esc(i.product)} — ${fmtQty(i.qty)} ${esc(i.unit)}</h3>
            <div class="mk-meta"><span>🎯 ${L('Target', 'Target')} ${i.target_price != null ? rs(i.target_price) + '/' + esc(i.unit) : L('open', 'खुला')}</span><span>📍 ${esc(i.city)}</span><span>📅 ${L('by', 'तक')} ${niceDate(i.need_by)}</span><span>🔁 ${esc(i.frequency)}</span><span>👁 ${i.views} ${L('sellers viewed', 'sellers ने देखा')}</span><span>📣 ${i.notified} ${L('notified', 'को सूचना')}</span>${i.verified_only ? `<span>✔ ${L('GST sellers only', 'सिर्फ़ GST sellers')}</span>` : ''}${!i.show_name ? `<span>🙈 ${L('Name hidden', 'नाम छिपा')}</span>` : ''}</div>
            ${i.notes ? `<div style="margin-top:8px;font-size:13.5px">“${esc(i.notes)}”</div>` : ''}</div>
          <div style="display:flex;gap:8px">${i.status === 'open' ? `<button class="btn btn-ghost btn-sm" data-act="shareInq" data-id="${i.id}">💬 ${L('Share on WhatsApp', 'WhatsApp पर भेजो')}</button><button class="btn btn-danger btn-sm" data-act="closeInq" data-id="${i.id}">${L('Close', 'बंद करो')}</button>` : ''}</div>
        </div>
        ${r.order ? `<div class="mk-prefill" style="margin-top:12px">✅ ${L('Ordered from', 'ऑर्डर दिया')} <b>${esc(r.order.other_party.name)}</b> — ${r.order.order_no} · ${rs(r.order.total)} · <a data-act="nav" data-v="orders">${L('Track order →', 'ऑर्डर देखो →')}</a></div>` : ''}
      </div>
      ${groupHtml}
      <div class="mk-row" style="margin:16px 0 10px"><h3>${L('Quotes', 'Quotes')} (${r.quotes.length})</h3>${live.length > 1 ? `<span class="mk-hint">${L('Best value weighs price, delivery, rating, GST and credit', 'Best value = भाव, delivery, rating, GST और उधार मिलाकर')}</span>` : ''}</div>
      ${r.quotes.length ? `<div class="mk-grid3">${r.quotes.map((q) => {
        const s = q.seller; const total = q.price * i.qty;
        const diff = i.target_price ? ((q.price - i.target_price) / i.target_price) * 100 : null;
        let tg = '';
        if (q.id === best) tg = `<span class="mk-flag mk-flag-g">★ ${L('Best value', 'Best value')}</span>`;
        else if (q.id === cheapest) tg = `<span class="mk-flag mk-flag-b">${L('Lowest price', 'सबसे कम भाव')}</span>`;
        else if (q.id === fastest) tg = `<span class="mk-flag mk-flag-a">${L('Fastest', 'सबसे जल्दी')}</span>`;
        const moqWarn = q.moq && i.qty < q.moq;
        const st = { accepted: ['✓ Accepted', '✓ Accept हुआ', 'tag-paid'], declined: ['Declined', 'मना किया', 'tag-pend'], closed: ['Closed', 'बंद', 'mk-tag-grey'], expired: ['Expired', 'समय ख़त्म', 'mk-tag-grey'], cancelled: ['Order cancelled', 'ऑर्डर रद्द', 'tag-pend'] }[q.status];
        return `<div class="mk-qcard ${q.id === best ? 'best' : ''}">${tg}
          <div class="mk-row"><a class="mk-sname" data-act="seller" data-id="${s.business_id}">${esc(s.name)}</a>${gstBadge(s)}${verifiedBadge(s)}</div>
          <div class="mk-hint">${ratingTxt(s)} · ${dealsTxt(s)}${s.repeat_buyers ? ` · ${s.repeat_buyers} ${L('repeat buyers', 'repeat buyers')}` : ''} · ${esc(s.city)}</div>
          <div class="mk-price">${rs(q.price)}<small>/${esc(i.unit)}</small>${diff !== null ? `<em style="color:${diff <= 0 ? 'var(--green)' : 'var(--red)'}">${diff <= 0 ? '▼' : '▲'} ${Math.abs(diff).toFixed(1)}% ${L('vs target', 'target से')}</em>` : ''}</div>
          <div class="mk-kv"><span>${L('Total', 'कुल')}</span><b>${rs(total)}</b><span>${L('Delivery', 'Delivery')}</span><b>${q.delivery_days} ${L('day(s)', 'दिन')}</b><span>${L('Payment', 'Payment')}</span><b>${esc(q.payment_terms)}</b>${(q.advance_percent != null || q.credit_days != null) ? `<span>${L('Advance / Credit', 'Advance / Credit')}</span><b>${termsTxt(q)}</b>` : ''}<span>${L('Min. order', 'कम से कम')}</span><b style="${moqWarn ? 'color:var(--red)' : ''}">${fmtQty(q.moq)} ${esc(i.unit)}</b><span>${L('Valid', 'Valid')}</span><b>${q.valid_days} ${L('days', 'दिन')}</b></div>
          ${moqWarn ? `<div class="mk-hint" style="color:var(--red)">${L('Your quantity is below this minimum.', 'आपकी मात्रा इस minimum से कम है।')}</div>` : ''}
          ${q.note ? `<div class="mk-hint">“${esc(q.note)}”</div>` : ''}
          ${st ? `<div style="margin-top:10px"><span class="tag ${st[2]}">${L(st[0], st[1])}</span>${q.messages ? ` <a class="mk-hint" data-act="chat" data-id="${q.id}">💬 ${q.messages}</a>` : ''}</div>`
            : `<div class="mk-actions"><button class="btn btn-sm mk-green" data-act="accept" data-id="${q.id}" ${moqWarn ? 'disabled' : ''}>${L('Accept', 'Accept')}</button><button class="btn btn-ghost btn-sm" data-act="chat" data-id="${q.id}">💬 ${L('Chat / Counter', 'Chat / मोल-भाव')}${q.messages ? ' (' + q.messages + ')' : ''}</button><button class="btn btn-ghost btn-sm" data-act="decline" data-id="${q.id}" title="${L('Decline', 'मना करो')}">✕</button></div>`}
        </div>`; }).join('')}</div>`
      : `<div class="card">${empty('⏳', `${L('Waiting for sellers to quote…', 'Sellers के quote का इंतज़ार…')}<div class="mk-hint" style="margin-top:6px">${i.notified} ${L('matching sellers were notified. Share it on WhatsApp to reach your own suppliers too.', 'matching sellers को सूचना गई। अपने suppliers तक पहुंचने के लिए WhatsApp पर भी भेजो।')}</div>`)}</div>`}`;
  };
  ACT.closeInq = async (d) => {
    openModal(`<h2>${L('Close this inquiry?', 'Inquiry बंद करें?')}</h2><div class="hint">${L('Sellers will be told it is closed and their quotes will close.', 'Sellers को बताया जाएगा और उनके quotes बंद हो जाएंगे।')}</div>
      <div class="mk-mfoot"><button class="btn btn-ghost" data-act="close">${L('Keep open', 'खुली रखो')}</button><button class="btn btn-danger" data-act="closeInqYes" data-id="${d.id}">${L('Close inquiry', 'बंद करो')}</button></div>`);
  };
  ACT.closeInqYes = async (d) => { try { await api('POST', `/api/mart/inquiries/${d.id}/close`); closeModal(); toast(L('Inquiry closed', 'Inquiry बंद')); go('inquiry', Number(d.id)); } catch (e) { toast(errText(e)); } };
  ACT.close = () => closeModal();
  ACT.shareInq = async (d) => {
    try {
      const r = await api('GET', `/api/mart/inquiries/${d.id}/share`);
      openModal(`<h2>${L('Share inquiry', 'Inquiry भेजो')}</h2><div class="hint">${L('Send it to your own supplier contacts on WhatsApp.', 'अपने supplier contacts को WhatsApp पर भेजो।')}</div>
        <textarea class="input" rows="4" readonly id="mkShareTxt">${esc(r.text)}</textarea>
        <div class="mk-mfoot"><button class="btn btn-ghost" data-act="close">${L('Close', 'बंद')}</button><button class="btn btn-ghost" data-act="copyShare">${L('Copy', 'Copy')}</button><a class="btn btn-wa" href="${esc(r.wa_url)}" target="_blank" rel="noopener" style="text-decoration:none">${L('Open WhatsApp', 'WhatsApp खोलो')}</a></div>`);
    } catch (e) { toast(errText(e)); }
  };
  ACT.copyShare = async () => { const t = $('mkShareTxt'); try { await navigator.clipboard.writeText(t.value); toast(L('Copied', 'Copy हो गया')); } catch (e) { t.select(); toast(L('Press Ctrl+C to copy', 'Copy के लिए Ctrl+C दबाओ')); } };
  ACT.decline = async (d) => { try { await api('POST', `/api/mart/quotes/${d.id}/decline`); toast(L('Quote declined — the seller has been told.', 'Quote मना किया — seller को बता दिया।')); go('inquiry', M.arg); } catch (e) { toast(errText(e)); } };
  ACT.accept = (d) => {
    const i = M._inq.inquiry; const q = M._inq.quotes.find((x) => String(x.id) === d.id);
    openModal(`<h2>${L('Place order with', 'ऑर्डर दें')} ${esc(q.seller.name)}?</h2><div class="hint">${L('The seller gets the order right away. When the goods arrive, mark it received and it is added to Workspace → Purchases with stock.', 'Seller को तुरंत ऑर्डर मिलेगा। माल आने पर "Received" करो — Workspace → खरीद और stock में जुड़ जाएगा।')}</div>
      <div class="mk-kv" style="margin:14px 0"><span>${L('Item', 'सामान')}</span><b>${esc(i.product)}</b><span>${L('Quantity', 'मात्रा')}</span><b>${fmtQty(i.qty)} ${esc(i.unit)}</b><span>${L('Rate', 'भाव')}</span><b>${rs(q.price)}/${esc(i.unit)}</b><span>${L('Payment', 'Payment')}</span><b>${esc(q.payment_terms)}</b>${(q.advance_percent != null || q.credit_days != null) ? `<span>${L('Advance / Credit', 'Advance / Credit')}</span><b>${termsTxt(q)}</b>` : ''}<span>${L('Delivery', 'Delivery')}</span><b>${q.delivery_days} ${L('day(s)', 'दिन')}</b><span style="color:var(--ink);font-weight:700">${L('Total', 'कुल')}</span><b style="font-size:17px">${rs(q.price * i.qty)}</b></div>
      <div class="mk-mfoot"><button class="btn btn-ghost" data-act="close">${L('Cancel', 'रद्द')}</button><button class="btn mk-green" data-act="acceptYes" data-id="${q.id}">${L('Confirm order', 'ऑर्डर पक्का करो')}</button></div>`);
  };
  ACT.acceptYes = async (d, el) => {
    el.disabled = true;
    try { const r = await api('POST', `/api/mart/quotes/${d.id}/accept`); closeModal(); toast(`✅ ${L('Order', 'ऑर्डर')} ${r.order.order_no} ${L('placed', 'दिया गया')}`); M.mode = 'buy'; go('orders'); }
    catch (e) { el.disabled = false; toast(errText(e)); }
  };

  // ---------- BUY: bulk inquiry (one requirement, many sellers) ----------
  V.bulk = async () => {
    const meta = M.meta || (M.meta = await api('GET', '/api/mart/meta'));
    const sl = await api('GET', '/api/mart/sellers');
    const sellers = sl.sellers.filter((s) => !s.mine);
    M._bulkSellers = sellers;
    const city = (M.profile && M.profile.city) || (me.business.city) || '';
    $('martView').innerHTML = `
      <div class="grid2">
        <form class="card" id="mkBulkForm">
          <div class="mk-prefill">📣 ${L('One inquiry goes separately to every seller you tick. Each seller quotes on their own copy — you compare all quotes together under My inquiries.', 'Ek inquiry har tick kiye seller ko alag jayegi. Har seller apni copy par quote dega — saare quotes My inquiries me ek saath milenge.')}</div>
          <div class="err" id="mkBulkErr"></div>
          <div class="field"><label>${L('What do you want to buy? *', 'क्या खरीदना है? *')}</label><input class="input" name="product" required maxlength="120" placeholder="${L('e.g. Toor Dal', 'जैसे Toor Dal')}"></div>
          <div class="row2">
            <div class="field"><label>${L('Category *', 'Category *')}</label><select class="input" name="category">${meta.categories.map((c) => `<option ${c === 'Staples' ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
            <div class="field"><label>${L('Quantity *', 'मात्रा *')}</label><div style="display:flex;gap:8px"><input class="input" name="qty" type="number" min="0.01" step="any" required><select class="input" name="unit" style="width:120px">${meta.units.map((u) => `<option ${u === 'kg' ? 'selected' : ''}>${u}</option>`).join('')}</select></div></div>
          </div>
          <div class="row2">
            <div class="field"><label>${L('Target price per unit (optional)', 'प्रति unit target भाव (optional)')}</label><input class="input" name="target_price" type="number" min="0" step="any" placeholder="₹"></div>
            <div class="field"><label>${L('Need it by *', 'कब तक चाहिए *')}</label><input class="input" name="need_by" type="date" required min="${dayPlus(0)}" value="${dayPlus(3)}"></div>
          </div>
          <div class="row2">
            <div class="field"><label>${L('Deliver to (city) *', 'Delivery शहर *')}</label><input class="input" name="city" required value="${esc(city)}"></div>
            <div class="field"><label>${L('How often?', 'कितनी बार?')}</label><select class="input" name="frequency">${meta.frequencies.map((f) => `<option>${f}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label>${L('Quality, brand or packing details', 'Quality, brand या packing')}</label><textarea class="input" name="notes" rows="2" maxlength="500"></textarea></div>
          <label class="tgl-row"><div class="t-txt"><b>${L('Show my business name', 'मेरा नाम दिखाओ')}</b><span>${L('Off = sellers see "A business in your city" until you order', 'Off = order तक sellers को "आपके शहर का एक business" दिखेगा')}</span></div><span class="switch"><input type="checkbox" name="show_name" checked><span class="slider"></span></span></label>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button type="button" class="btn btn-ghost" data-act="nav" data-v="home">${L('Cancel', 'रद्द करो')}</button><button class="btn btn-blue" type="submit">${L('Send to selected sellers', 'Chune sellers ko bhejo')}</button></div>
        </form>
        <div class="card">
          <div class="mk-row"><h3>${L('Choose sellers', 'Sellers chuno')}</h3><button type="button" class="btn btn-ghost btn-sm" id="mkBulkMatch">${L('Tick matching', 'Matching chuno')}</button></div>
          <div class="hint">${L('Matching = sells this category and delivers to your city. Your own city comes first.', 'Matching = is category ka bechta hai aur aapke sheher deliver karta hai. Aapka sheher pehle aata hai.')}</div>
          <input class="input" id="mkBulkSearch" placeholder="${L('Search seller or city…', 'Seller ya sheher khojo…')}" style="margin-bottom:10px">
          <div id="mkBulkList">${bulkSellerRows(sellers, '')}</div>
          <div class="mk-hint" id="mkBulkCount" style="margin-top:8px"></div>
        </div>
      </div>`;
    const f = $('mkBulkForm');
    const updCount = () => { const n = f.querySelectorAll('input[name="seller_ids"]:checked').length; $('mkBulkCount').textContent = `${n} ${L('seller(s) selected', 'seller chune')}`; };
    $('mkBulkList').addEventListener('change', updCount); updCount();
    $('mkBulkSearch').addEventListener('input', (e) => { $('mkBulkList').innerHTML = bulkSellerRows(sellers, e.target.value.trim().toLowerCase(), f); updCount(); });
    $('mkBulkMatch').addEventListener('click', () => {
      const cat = f.category.value, c = f.city.value.trim().toLowerCase();
      f.querySelectorAll('input[name="seller_ids"]').forEach((cb) => {
        const s = sellers.find((x) => String(x.business_id) === cb.value);
        if (s) cb.checked = s.categories.includes(cat) && (s.all_india || s.city.toLowerCase() === c || s.service_cities.some((x) => x.toLowerCase() === c));
      });
      updCount();
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); hideErr('mkBulkErr');
      const ids = [...f.querySelectorAll('input[name="seller_ids"]:checked')].map((cb) => Number(cb.value));
      if (!ids.length) { showErr('mkBulkErr', L('Tick at least one seller.', 'Kam se kam ek seller tick karo.')); return; }
      const body = {
        product: f.product.value.trim(), category: f.category.value, qty: Number(f.qty.value), unit: f.unit.value,
        target_price: f.target_price.value === '' ? null : Number(f.target_price.value),
        need_by: f.need_by.value, city: f.city.value.trim(), frequency: f.frequency.value, notes: f.notes.value.trim(),
        show_name: f.show_name.checked, seller_ids: ids
      };
      try {
        const r = await api('POST', '/api/mart/inquiries/bulk', body);
        toast(`📣 ${L('Inquiry sent to', 'Inquiry gayi')} ${r.notified} ${L('sellers', 'sellers ko')}`);
        go('inquiries');
      } catch (err) { showErr('mkBulkErr', errText(err)); }
    });
  };
  function bulkSellerRows(sellers, q, form) {
    const checked = form ? new Set([...form.querySelectorAll('input[name="seller_ids"]:checked')].map((cb) => cb.value)) : new Set();
    const rows = sellers.filter((s) => !q || s.name.toLowerCase().includes(q) || s.city.toLowerCase().includes(q));
    if (!rows.length) return `<div class="mk-hint">${L('No sellers found.', 'Koi seller nahi mila.')}</div>`;
    return rows.map((s) => `
      <label class="mk-li" style="cursor:pointer"><input type="checkbox" name="seller_ids" value="${s.business_id}" ${checked.has(String(s.business_id)) ? 'checked' : ''} style="width:17px;height:17px">
        <div style="flex:1"><b>${esc(s.name)}</b>${gstBadge(s)}${verifiedBadge(s)}<small>${esc(s.city)} · ${ratingTxt(s)} · ${s.categories.map(esc).join(', ')}</small></div></label>`).join('');
  }

  // ---------- BUY: Mere Wholesaler (favourites) ----------
  V.favourites = async () => {
    const r = await api('GET', '/api/mart/favourites');
    M._favs = r.favourites;
    $('martView').innerHTML = `<div class="card">
      <div class="toolbar"><div style="flex:1"><h3>⭐ ${L('Mere Wholesaler — your saved sellers', 'Mere Wholesaler — aapke save sellers')}</h3><div class="hint" style="margin:0">${L('The wholesalers you buy from again and again, one tap away.', 'Jin wholesalers se baar-baar kharidte ho, ek tap door.')}</div></div><button class="btn btn-blue" data-act="nav" data-v="browse">${L('Find sellers', 'Sellers khojo')}</button></div>
      ${r.favourites.length ? `<div class="mk-grid3">${r.favourites.map((s) => `
        <div class="card"><div class="mk-row"><a class="mk-sname" data-act="seller" data-id="${s.business_id}">${esc(s.name)}</a><span>${favBtn(s)}</span></div>
          <div>${gstBadge(s)}${verifiedBadge(s)}</div>
          <div class="mk-hint">${esc(s.area ? s.area + ', ' : '')}${esc(s.city)} · ${ratingTxt(s)} · ${dealsTxt(s)}${s.repeat_buyers ? ` · ${s.repeat_buyers} ${L('repeat buyers', 'repeat buyers')}` : ''}</div>
          <div class="mk-chips" style="margin:8px 0">${s.categories.map((c) => `<span class="mk-chip">${ic(c)} ${esc(c)}</span>`).join('')}</div>
          <div style="display:flex;gap:8px"><button class="btn btn-blue btn-sm" data-act="favInq" data-id="${s.business_id}">${L('Send inquiry', 'Inquiry bhejo')}</button><button class="btn btn-ghost btn-sm" data-act="seller" data-id="${s.business_id}">${L('Rate list', 'Rate list')}</button></div>
        </div>`).join('')}</div>`
      : empty('⭐', L('No saved wholesalers yet. Tap the ☆ star on any seller to save them here.', 'Abhi koi wholesaler save nahi. Kisi seller par ☆ star dabao, wo yahan aa jayega.'))}
    </div>`;
  };
  ACT.favInq = (d) => {
    const s = (M._favs || []).find((x) => String(x.business_id) === d.id);
    M.mode = 'buy';
    go('post', { target_business_id: Number(d.id), target_name: s ? s.name : '' });
  };

  // ---------- BUY: Mart margin report ----------
  V.report = async () => {
    const r = await api('GET', '/api/mart/report');
    const t = r.totals;
    $('martView').innerHTML = `
      <div class="stats">
        <div class="stat"><div class="lbl">💰 ${L('Total Mart spend', 'Mart par kul kharcha')}</div><div class="val">${rs(t.spend_all)}</div><div class="sub">${L('All orders, all time', 'Saare orders, ab tak')}</div></div>
        <div class="stat"><div class="lbl">📦 ${L('Delivered orders', 'Delivered orders')}</div><div class="val">${t.delivered_orders}</div><div class="sub">${rs(t.spend_delivered)} ${L('worth received', 'ka maal mila')}</div></div>
        <div class="stat"><div class="lbl">📈 ${L('Expected margin (estimate)', 'Andaaz margin')}</div><div class="val" style="color:var(--green)">${rs(t.expected_margin)}</div><div class="sub">${L('On', 'Sirf')} ${t.margin_known_orders} ${L('orders where sell price is set', 'orders par jahan sell price set hai')}</div></div>
      </div>
      <div class="card">
        <h3>${L('Order-wise margin', 'Order ke hisaab se margin')}</h3>
        <div class="mk-prefill">ℹ️ ${L('This margin is an estimate at TODAY\'S sell rate — the real profit is final when the goods actually sell.', 'Ye margin AAJ ke sell rate par ek andaaz hai — asal munafa maal bikne par pakka hota hai.')}</div>
        ${r.orders.length ? `<div class="mk-scroll"><table><thead><tr><th>${L('Order', 'Order')}</th><th>${L('Item', 'Saaman')}</th><th>${L('Seller', 'Seller')}</th><th>${L('Qty', 'Matra')}</th><th>${L('Mart rate', 'Mart bhaav')}</th><th>${L('Your sell rate', 'Aapka sell bhaav')}</th><th>${L('Margin / unit', 'Margin / unit')}</th><th>${L('Expected margin', 'Andaaz margin')}</th><th>${L('Order total', 'Order kul')}</th></tr></thead><tbody>
          ${r.orders.map((o) => `<tr><td><b>${o.order_no}</b><div class="mk-hint">${niceDate(String(o.delivered_at).slice(0, 10))}</div></td><td>${esc(o.product)}</td><td>${esc(o.seller_name)}</td><td>${fmtQty(o.qty)} ${esc(o.unit)}</td><td>${rs(o.buy_rate)}</td>
            <td>${o.sell_price == null ? '—' : rs(o.sell_price)}</td>
            <td>${o.margin_per_unit == null ? '—' : `<span style="color:${o.margin_per_unit >= 0 ? 'var(--green)' : 'var(--red)'}">${rs(o.margin_per_unit)}</span>`}</td>
            <td>${o.expected_margin == null ? '—' : `<b style="color:${o.expected_margin >= 0 ? 'var(--green)' : 'var(--red)'}">${rs(o.expected_margin)}</b>`}</td>
            <td>${rs(o.total)}</td></tr>`).join('')}
        </tbody></table></div>` : empty('📊', L('No delivered Mart orders yet. When you receive goods from a Mart order, its margin shows here.', 'Abhi koi delivered Mart order nahi. Mart order ka maal milte hi uska margin yahan dikhega.'))}
      </div>`;
  };

  // ---------- chat / counter (both sides) ----------
  ACT.chat = async (d) => { await openChat(Number(d.id)); };
  async function openChat(qid) {
    let r;
    try { r = await api('GET', `/api/mart/quotes/${qid}/messages`); } catch (e) { toast(errText(e)); return; }
    const other = r.side === 'buyer' ? r.seller.name : r.buyer.name;
    const live = r.quote.status === 'sent';
    openModal(`<div class="mk-row"><div><h2>${esc(other)}</h2><div class="mk-hint">${esc(r.inquiry.product)} · ${L('quote', 'quote')} ${rs(r.quote.price)}/${esc(r.inquiry.unit)} · ${fmtQty(r.inquiry.qty)} ${esc(r.inquiry.unit)}</div></div><button class="btn btn-ghost btn-sm" data-act="close">✕</button></div>
      <div class="mk-chat" id="mkChat">${chatHtml(r)}</div>
      <form id="mkChatForm" style="display:flex;gap:8px;margin-top:10px"><input class="input" id="mkChatIn" maxlength="600" placeholder="${L('Type a message…', 'Message लिखो…')}" autocomplete="off"><button class="btn btn-blue">${L('Send', 'भेजो')}</button></form>
      ${live && r.side === 'buyer' ? `<div class="mk-box"><b>${L('Make a counter-offer', 'मोल-भाव करो')}</b><div style="display:flex;gap:8px;align-items:center;margin-top:8px">₹<input class="input" id="mkCounter" type="number" step="any" min="0" style="width:130px" value="${Math.round(r.quote.price * 0.96 * 100) / 100}"><span class="mk-hint">/ ${esc(r.inquiry.unit)}</span><button class="btn btn-ghost" data-act="counter" data-id="${qid}">${L('Send counter', 'भेजो')}</button></div></div>` : ''}
      ${live && r.side === 'seller' ? `<div class="mk-box"><b>${L('Update my price', 'अपना भाव बदलो')}</b><div style="display:flex;gap:8px;align-items:center;margin-top:8px">₹<input class="input" id="mkNewPrice" type="number" step="any" min="0" style="width:130px" value="${r.quote.price}"><span class="mk-hint">/ ${esc(r.inquiry.unit)}</span><button class="btn btn-ghost" data-act="reprice" data-id="${qid}">${L('Update quote', 'Quote बदलो')}</button></div></div>` : ''}`);
    const box = $('mkChat'); box.scrollTop = box.scrollHeight;
    $('mkChatForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = $('mkChatIn').value.trim(); if (!v) return;
      try { await api('POST', `/api/mart/quotes/${qid}/messages`, { body: v }); $('mkChatIn').value = ''; refreshChat(qid); } catch (err) { toast(errText(err)); }
    });
    if (M.chatTimer) clearInterval(M.chatTimer);
    M.chatTimer = setInterval(() => refreshChat(qid), 8000);
  }
  function chatHtml(r) {
    if (!r.messages.length) return `<div class="mk-hint" style="text-align:center;padding:16px">${L('No messages yet. Ask about quality, packing or delivery.', 'अभी कोई message नहीं। Quality, packing या delivery के बारे में पूछो।')}</div>`;
    return r.messages.map((m) => `<div class="mk-msg ${m.mine ? 'me' : 'them'} ${m.kind !== 'text' ? 'sys' : ''}">${m.kind === 'counter' ? '💰 ' : m.kind === 'update' ? '🔄 ' : ''}${esc(m.body)}<small>${ago(m.created_at)}</small></div>`).join('');
  }
  async function refreshChat(qid) {
    const box = $('mkChat'); if (!box) { clearInterval(M.chatTimer); M.chatTimer = null; return; }
    try { const r = await api('GET', `/api/mart/quotes/${qid}/messages`); box.innerHTML = chatHtml(r); box.scrollTop = box.scrollHeight; } catch (e) { /* ignore */ }
  }
  ACT.counter = async (d) => {
    const v = Number($('mkCounter').value); if (!(v > 0)) return;
    try { await api('POST', `/api/mart/quotes/${d.id}/messages`, { counter_price: v }); toast(L('Counter-offer sent', 'मोल-भाव भेजा')); refreshChat(d.id); } catch (e) { toast(errText(e)); }
  };
  ACT.reprice = async (d) => {
    const v = Number($('mkNewPrice').value); if (!(v > 0)) return;
    try { await api('PUT', `/api/mart/quotes/${d.id}`, { price: v }); toast(L('Quote updated — buyer notified', 'Quote बदला — buyer को सूचना गई')); refreshChat(d.id); if (M.view === 'sent') go('sent'); } catch (e) { toast(errText(e)); }
  };

  // ---------- seller rate-list page ----------
  ACT.seller = (d) => { go('seller', Number(d.id)); };
  V.seller = async (id) => {
    const r = await api('GET', '/api/mart/sellers/' + id);
    const s = r.seller;
    M._seller = s;
    M._listings = r.listings.map((l) => ({ ...l, seller: s, business_id: s.business_id }));
    const mine = s.business_id === me.business.id;
    $('martView').innerHTML = `
      <button class="btn btn-ghost btn-sm" data-act="nav" data-v="browse">← ${L('Browse', 'देखो')}</button>
      <div class="card" style="margin-top:12px">
        <div class="mk-row" style="align-items:flex-start;flex-wrap:wrap">
          <div><h3 style="font-size:20px">${esc(s.name)} ${gstBadge(s)}${verifiedBadge(s)}</h3>
            <div class="mk-hint">${esc(s.area ? s.area + ', ' : '')}${esc(s.city)} · ${s.all_india ? L('delivers all India', 'पूरे भारत में delivery') : L('delivers to', 'डिलीवरी') + ' ' + esc([s.city].concat(s.service_cities).join(', '))}</div>
            ${s.about ? `<div style="font-size:13.5px;margin-top:6px">${esc(s.about)}</div>` : ''}</div>
          <div style="display:flex;gap:6px;align-items:center">${mine ? '' : `${favBtn(s)}<button class="btn btn-blue btn-sm" data-act="sellerInq" data-id="${s.business_id}">${L('Send inquiry', 'Inquiry bhejo')}</button>`}</div>
        </div>
        <div class="stats" style="grid-template-columns:repeat(4,1fr);margin:14px 0 4px">
          <div class="stat"><div class="lbl">${L('Rating', 'Rating')}</div><div class="val" style="font-size:20px">${s.rating ? '★ ' + s.rating : '—'}</div><div class="sub">${s.ratings_count} ${L('ratings', 'ratings')}</div></div>
          <div class="stat"><div class="lbl">${L('Deals done', 'सौदे')}</div><div class="val" style="font-size:20px">${s.deals}</div><div class="sub">${L('delivered orders', 'delivered orders')}</div></div>
          <div class="stat"><div class="lbl">${L('Repeat buyers', 'Repeat buyers')}</div><div class="val" style="font-size:20px">${s.repeat_buyers}</div><div class="sub">${L('bought 2+ times', '2+ बार खरीदा')}</div></div>
          <div class="stat"><div class="lbl">${L('On BizYour since', 'BizYour पर')}</div><div class="val" style="font-size:20px">${esc(s.since || '—')}</div></div>
        </div>
        <div class="mk-chips">${s.categories.map((c) => `<span class="mk-chip">${ic(c)} ${esc(c)}</span>`).join('')}</div>
      </div>
      <div class="card" style="margin-top:14px">
        <h3>${L('Rate list', 'Rate list')} — ${L('all products', 'सारा सामान')}</h3>
        ${r.listings.length ? `<div class="mk-scroll"><table><thead><tr><th></th><th>${L('Product', 'सामान')}</th><th>${L('Unit', 'Unit')}</th><th>${L('Wholesale rate', 'Wholesale भाव')}</th><th>${L('Min. order', 'कम से कम')}</th><th></th></tr></thead><tbody>
          ${r.listings.map((l) => `<tr><td>${l.photo ? `<img class="mk-thumb" src="${l.photo}" alt="">` : `<div class="mk-thumb" style="display:flex;align-items:center;justify-content:center;font-size:20px">${ic(l.category)}</div>`}</td><td><b>${esc(l.name)}</b><div class="mk-hint">${esc(l.category)}</div></td><td>${esc(l.unit)}</td><td><b>${rs(l.price)}</b>/${esc(l.unit)}</td><td>${fmtQty(l.moq)} ${esc(l.unit)}</td><td style="text-align:right">${mine ? '' : `<button class="btn btn-soft btn-sm" data-act="quoteListing" data-id="${l.id}">${L('Get quote', 'Quote मांगो')}</button>`}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="mk-hint">${L('No listings yet.', 'अभी कोई listing नहीं।')}</div>`}
      </div>
      ${r.reviews.length ? `<div class="card" style="margin-top:14px"><h3>${L('Buyer reviews', 'Buyers के reviews')}</h3>${r.reviews.map((rv) => `<div class="mk-mini"><span style="color:var(--amber)">${'★'.repeat(rv.rating)}</span> <span style="flex:1">${esc(rv.review || '')}</span><span class="mk-hint">${esc(rv.product)} · ${ago(rv.updated_at)}</span></div>`).join('')}</div>` : ''}
      <div class="mk-hint" style="margin-top:10px">${L('Phone numbers are shared once you place an order with each other.', 'Phone number ऑर्डर होने के बाद दिखता है।')}</div>`;
  };
  ACT.sellerInq = (d) => {
    M.mode = 'buy';
    go('post', { target_business_id: Number(d.id), target_name: M._seller ? M._seller.name : '' });
  };

  // ---------- BUY: browse ----------
  V.browse = async () => {
    const meta = M.meta || (M.meta = await api('GET', '/api/mart/meta'));
    const c = M.browseCat, q = M.browseQ;
    const chips = ['', ...meta.categories].map((x) => `<button class="mk-chip ${x === c ? 'on' : ''}" data-act="bcat" data-c="${esc(x)}">${x ? ic(x) + ' ' + esc(x) : L('All', 'सभी')}</button>`).join('');
    let body = '';
    if (M.browseTab === 'products') {
      const r = await api('GET', `/api/mart/listings?category=${encodeURIComponent(c)}&q=${encodeURIComponent(q)}`);
      M._listings = r.listings;
      body = r.listings.length ? `<div class="mk-grid4">${r.listings.map((l) => `
        <div class="card mk-prod"><div class="mk-pic">${l.photo ? `<img src="${l.photo}" alt="">` : ic(l.category)}</div><b>${esc(l.name)}</b>
          <div class="mk-hint"><a data-act="seller" data-id="${l.business_id}">${esc(l.seller.name)}</a> ${gstBadge(l.seller)}${verifiedBadge(l.seller)} · ${esc(l.seller.city)}</div>
          <div class="mk-price" style="margin:2px 0">${rs(l.price)}<small>/${esc(l.unit)}</small></div>
          <div class="mk-hint">${L('Min. order', 'कम से कम')} ${fmtQty(l.moq)} ${esc(l.unit)} · ${ratingTxt(l.seller)}</div>
          ${l.mine ? `<span class="tag mk-tag-grey" style="align-self:flex-start">${L('Your listing', 'आपकी listing')}</span>` : `<button class="btn btn-blue btn-sm" data-act="quoteListing" data-id="${l.id}">${L('Get quote', 'Quote मांगो')}</button>`}
        </div>`).join('')}</div>`
        : `<div class="card">${empty('🔍', L('Nothing found.', 'कुछ नहीं मिला।') + ` <a data-act="postQ">${L('Post an inquiry', 'Inquiry डालो')}</a> ${L('and let sellers come to you.', 'और sellers को आने दो।')}`)}</div>`;
    } else {
      const r = await api('GET', `/api/mart/sellers?category=${encodeURIComponent(c)}&q=${encodeURIComponent(q)}`);
      body = r.sellers.length ? `<div class="mk-grid3">${r.sellers.map((s) => `
        <div class="card"><div class="mk-row"><a class="mk-sname" data-act="seller" data-id="${s.business_id}">${esc(s.name)}</a><span>${gstBadge(s)}${verifiedBadge(s)}${s.mine ? '' : favBtn(s)}</span></div>
          <div class="mk-hint">${esc(s.area ? s.area + ', ' : '')}${esc(s.city)}${s.since ? ' · ' + L('since', 'से') + ' ' + esc(s.since) : ''}</div>
          <div class="mk-hint" style="margin:6px 0">${ratingTxt(s)} · ${dealsTxt(s)} · ${s.all_india ? L('All India', 'पूरा भारत') : esc([s.city].concat(s.service_cities).slice(0, 3).join(', '))}</div>
          <div class="mk-chips">${s.categories.map((x) => `<span class="mk-chip">${ic(x)} ${esc(x)}</span>`).join('')}</div>
          <button class="btn btn-ghost btn-sm" style="margin-top:10px" data-act="seller" data-id="${s.business_id}">${L('View profile', 'प्रोफ़ाइल देखो')}</button></div>`).join('')}</div>`
        : `<div class="card">${empty('🏭', L('No sellers found.', 'कोई seller नहीं मिला।'))}</div>`;
    }
    $('martView').innerHTML = `
      <div class="toolbar"><input class="input" id="mkBrowseQ" style="max-width:380px" value="${esc(q)}" placeholder="${L('Search products or sellers…', 'सामान या seller खोजो…')}"></div>
      <div class="mk-tabs"><button class="${M.browseTab === 'products' ? 'on' : ''}" data-act="btab" data-t="products">${L('Products', 'सामान')}</button><button class="${M.browseTab === 'sellers' ? 'on' : ''}" data-act="btab" data-t="sellers">${L('Sellers', 'Sellers')}</button></div>
      <div class="mk-chips" style="margin-bottom:14px">${chips}</div>${body}`;
    const inp = $('mkBrowseQ'); let tm = null;
    inp.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(async () => { M.browseQ = inp.value.trim(); await V.browse(); const n = $('mkBrowseQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 350); });
  };
  ACT.bcat = (d) => { M.browseCat = d.c; V.browse(); };
  ACT.btab = (d) => { M.browseTab = d.t; V.browse(); };
  ACT.postQ = () => go('post', { product: M.browseQ });

  // ---------- orders (both roles) ----------
  const STEP_LBL = [['Placed', 'दिया गया'], ['Confirmed', 'पक्का'], ['Dispatched', 'निकला'], ['Delivered', 'पहुंचा']];
  V.orders = async (focusId) => {
    const role = M.mode === 'sell' ? 'seller' : 'buyer';
    const r = await api('GET', '/api/mart/orders?role=' + role);
    M._orders = r.orders;
    $('martView').innerHTML = r.orders.length ? r.orders.map((o) => {
      const p = o.other_party;
      const cancelled = o.status === 'cancelled';
      let acts = '';
      if (role === 'buyer') {
        if (['placed', 'confirmed', 'dispatched'].includes(o.status)) acts += `<button class="btn btn-sm mk-green" data-act="receive" data-id="${o.id}">📦 ${L('Mark received', 'माल आ गया')}</button>`;
        if (o.status === 'placed') acts += `<button class="btn btn-ghost btn-sm" data-act="ostatus" data-id="${o.id}" data-s="cancelled">${L('Cancel order', 'ऑर्डर रद्द')}</button>`;
        if (o.status === 'delivered' && !o.rating) acts += `<span class="mk-hint">${L('Rate', 'Rating दो')} ${esc(p.name)}:</span><span class="mk-stars">${[1, 2, 3, 4, 5].map((n) => `<button data-act="rate" data-id="${o.id}" data-r="${n}">★</button>`).join('')}</span>`;
        if (o.rating) acts += `<span class="mk-hint">${L('You rated', 'आपकी rating')} ${'★'.repeat(o.rating)}</span>`;
        acts += `<button class="btn btn-ghost btn-sm" data-act="reorder" data-id="${o.id}">↻ ${L('Reorder', 'फिर मंगाओ')}</button>`;
      } else {
        if (o.status === 'placed') acts += `<button class="btn btn-sm btn-blue" data-act="ostatus" data-id="${o.id}" data-s="confirmed">✓ ${L('Confirm order', 'ऑर्डर पक्का करो')}</button>`;
        if (o.status === 'confirmed') acts += `<button class="btn btn-sm btn-blue" data-act="dispatch" data-id="${o.id}">🚚 ${L('Mark dispatched', 'माल भेज दिया')}</button>`;
        if (['placed', 'confirmed'].includes(o.status)) acts += `<button class="btn btn-ghost btn-sm" data-act="ostatus" data-id="${o.id}" data-s="cancelled">${L('Cancel', 'रद्द')}</button>`;
        if (o.rating) acts += `<span class="mk-hint">${L('Buyer rated you', 'Buyer की rating')} ${'★'.repeat(o.rating)}${o.review ? ' — “' + esc(o.review) + '”' : ''}</span>`;
      }
      if (!cancelled) acts += `<button class="btn btn-wa btn-sm" data-act="owa" data-id="${o.id}">💬 WhatsApp ${role === 'buyer' ? L('seller', 'seller') : L('buyer', 'buyer')}</button>`;
      return `<div class="card mk-order ${String(o.id) === String(focusId) ? 'focus' : ''}" style="margin-bottom:14px">
        <div class="mk-row" style="align-items:flex-start;flex-wrap:wrap">
          <div><b>${o.order_no}</b> <span class="mk-hint">· ${ago(o.created_at)}</span>
            <h3 style="margin-top:3px">${esc(o.product)} — ${fmtQty(o.qty)} ${esc(o.unit)}</h3>
            <div class="mk-hint">${role === 'buyer' ? L('Seller', 'Seller') : L('Buyer', 'Buyer')}: <b style="color:var(--ink)">${esc(p.name)}</b>${verifiedBadge(p)}${p.city ? ' · ' + esc(p.city) : ''}${p.phone ? ' · 📞 ' + esc(p.phone) : ''} · ${rs(o.price)}/${esc(o.unit)} · ${esc(o.payment_terms)}${termsTxt(o) ? ' · ' + termsTxt(o) : ''}</div></div>
          <div style="text-align:right"><div class="mk-big">${rs(o.total)}</div>${o.purchase_id && role === 'buyer' ? `<span class="tag tag-paid">✓ ${L('In Workspace → Purchases', 'Workspace → खरीद में')}</span>` : ''}${cancelled ? `<span class="tag tag-pend">${L('Cancelled', 'रद्द')}</span>` : ''}</div>
        </div>
        ${cancelled ? '' : `<div class="mk-steps">${STEP_LBL.map((s, k) => `<div class="mk-step ${k <= o.step ? 'done' : ''}"><div class="c">${k <= o.step ? '✓' : ''}</div>${L(s[0], s[1])}</div>`).join('')}</div>`}
        ${!cancelled && (o.expected_delivery_date || o.transporter_name) ? `<div class="mk-hint" style="margin-top:6px">🚚 ${L('Expected by', 'Pahunchne ki ummeed')} <b style="color:var(--ink)">${o.expected_delivery_date ? niceDate(o.expected_delivery_date) : '—'}</b>${o.transporter_name ? ' · ' + L('via', 'se') + ' ' + esc(o.transporter_name) : ''}</div>` : ''}
        <div class="mk-actions">${acts}</div>
      </div>`;
    }).join('') : `<div class="card">${empty('🚚', role === 'buyer' ? L('No orders yet. Accept a quote to place one.', 'अभी कोई ऑर्डर नहीं। Quote accept करो।') : L('No orders yet. Send quotes on leads to win orders.', 'अभी कोई ऑर्डर नहीं। Leads पर quote भेजो।'))}</div>`;
    if (focusId) { const el = document.querySelector('.mk-order.focus'); if (el) el.scrollIntoView({ block: 'center' }); }
  };
  ACT.ostatus = async (d, el) => {
    el.disabled = true;
    try { await api('POST', `/api/mart/orders/${d.id}/status`, { status: d.s }); toast({ confirmed: L('Order confirmed — buyer notified', 'ऑर्डर पक्का — buyer को सूचना'), dispatched: L('Marked dispatched — buyer notified', 'भेज दिया — buyer को सूचना'), cancelled: L('Order cancelled', 'ऑर्डर रद्द') }[d.s]); V.orders(); refreshSummary(); }
    catch (e) { el.disabled = false; toast(errText(e)); }
  };
  ACT.owa = async (d) => {
    try { const r = await api('GET', `/api/mart/orders/${d.id}/whatsapp-link`); window.open(r.url, '_blank', 'noopener'); } catch (e) { toast(errText(e)); }
  };
  ACT.reorder = async (d, el) => {
    el.disabled = true;
    try {
      const r = await api('POST', `/api/mart/orders/${d.id}/repeat`);
      toast(`↻ ${L('Fresh inquiry sent to the same seller — they will quote again', 'Usi seller ko nayi inquiry gayi — wo phir quote dega')}`);
      M.mode = 'buy'; go('inquiry', r.inquiry.id);
    } catch (e) { el.disabled = false; toast(errText(e)); }
  };
  ACT.dispatch = (d) => {
    const o = M._orders.find((x) => String(x.id) === d.id);
    openModal(`<h2>🚚 ${L('Mark dispatched', 'माल भेज दिया')} — ${o.order_no}</h2>
      <div class="hint">${esc(o.product)} · ${fmtQty(o.qty)} ${esc(o.unit)} → ${esc(o.other_party.name)}. ${L('The buyer sees these details on the order timeline.', 'Buyer ko ye details order timeline par dikhengi.')}</div>
      <div class="row2" style="margin-top:10px">
        <div class="field"><label>${L('Expected delivery date', 'Pahunchne ki expected date')}</label><input class="input" id="mkExpDate" type="date" min="${dayPlus(0)}" value="${dayPlus(o.delivery_days || 2)}"></div>
        <div class="field"><label>${L('Transporter / vehicle (optional)', 'Transporter / gaadi (optional)')}</label><input class="input" id="mkTransporter" maxlength="80" placeholder="${L('e.g. Sharma Transport', 'jaise Sharma Transport')}"></div>
      </div>
      <div class="mk-mfoot"><button class="btn btn-ghost" data-act="close">${L('Cancel', 'रद्द')}</button><button class="btn btn-blue" data-act="dispatchYes" data-id="${o.id}">🚚 ${L('Dispatched', 'Bhej diya')}</button></div>`);
  };
  ACT.dispatchYes = async (d, el) => {
    el.disabled = true;
    try {
      await api('POST', `/api/mart/orders/${d.id}/status`, { status: 'dispatched', expected_delivery_date: $('mkExpDate').value || null, transporter_name: $('mkTransporter').value.trim() });
      closeModal(); toast(L('Marked dispatched — buyer notified', 'Bhej diya — buyer ko soochna')); V.orders(); refreshSummary();
    } catch (e) { el.disabled = false; toast(errText(e)); }
  };
  ACT.rate = (d) => {
    const o = M._orders.find((x) => String(x.id) === d.id);
    let chosen = Number(d.r) || 5;
    openModal(`<h2>${L('Rate', 'Rating do')} ${esc(o.other_party.name)}</h2>
      <div class="hint">${o.order_no} · ${esc(o.product)} — ${L('only buyers with a delivered order can rate, once.', 'sirf delivered order wale buyer ek baar rating de sakte hain.')}</div>
      <div style="font-size:30px;margin:12px 0">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="mk-rate-star" data-r="${n}" style="background:none;border:none;cursor:pointer;font-size:30px;padding:0 2px;color:${n <= chosen ? 'var(--amber)' : '#C3CAD6'}">★</button>`).join('')}</div>
      <div class="field"><label>${L('Say a line (optional)', 'Ek line likho (optional)')}</label><input class="input" id="mkReview" maxlength="300" placeholder="${L('e.g. Good quality, on time', 'jaise Maal badhiya, time par')}"></div>
      <div class="mk-mfoot"><button class="btn btn-ghost" data-act="close">${L('Cancel', 'रद्द')}</button><button class="btn btn-blue" id="mkRateGo">${L('Give rating', 'Rating do')}</button></div>`);
    $('mkModal').querySelectorAll('.mk-rate-star').forEach((b) => b.addEventListener('click', () => {
      chosen = Number(b.dataset.r);
      $('mkModal').querySelectorAll('.mk-rate-star').forEach((x) => { x.style.color = Number(x.dataset.r) <= chosen ? 'var(--amber)' : '#C3CAD6'; });
    }));
    $('mkRateGo').addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try {
        await api('POST', `/api/mart/orders/${d.id}/rate`, { rating: chosen, review: $('mkReview').value.trim() });
        closeModal(); toast(L('Thanks! Ratings help other businesses choose.', 'धन्यवाद! Rating से दूसरे businesses को मदद मिलती है।')); V.orders();
      } catch (e) { ev.target.disabled = false; toast(errText(e)); }
    });
  };
  ACT.receive = (d) => {
    const o = M._orders.find((x) => String(x.id) === d.id);
    const def = o.payment_terms === 'Full advance' ? o.total : o.payment_terms === '50% advance' ? Math.round(o.total / 2 * 100) / 100 : 0;
    openModal(`<h2>${L('Goods received?', 'माल आ गया?')}</h2>
      <div class="hint">${L('This adds a purchase in Workspace → Purchases from', 'ये Workspace → खरीद में एक purchase जोड़ेगा —')} <b>${esc(o.other_party.name)}</b> (${o.order_no}) ${L('and increases stock of', 'और stock बढ़ेगा:')} <b>${esc(o.product)}</b> ${L('by', '')} ${fmtQty(o.qty)} ${esc(o.unit)}. ${L('If the supplier or product does not exist yet, it is created.', 'Supplier या सामान नहीं है तो बन जाएगा।')}</div>
      <div class="err" id="mkRecErr"></div>
      <div class="row2"><div class="field"><label>${L('Already paid ₹', 'पहले से दिया ₹')}</label><input class="input" id="mkRecPaid" type="number" min="0" max="${o.total}" step="any" value="${def}"><div class="mk-hint">${L('Total', 'कुल')} ${rs(o.total)} · ${esc(o.payment_terms)}. ${L('The rest shows as "to pay supplier".', 'बाकी "supplier को देना" में दिखेगा।')}</div></div>
      <div class="field"><label>${L('Paid by', 'कैसे दिया')}</label><select class="input" id="mkRecMode"><option>Cash</option><option>UPI</option><option>Bank</option></select></div></div>
      <div class="mk-mfoot"><button class="btn btn-ghost" data-act="close">${L('Not yet', 'अभी नहीं')}</button><button class="btn mk-green" data-act="receiveYes" data-id="${o.id}">${L('Yes, received', 'हाँ, आ गया')}</button></div>`);
  };
  ACT.receiveYes = async (d, el) => {
    el.disabled = true;
    try {
      const r = await api('POST', `/api/mart/orders/${d.id}/receive`, { paid_amount: Number($('mkRecPaid').value || 0), paid_mode: $('mkRecMode').value });
      closeModal();
      toast(`📦 ${L('Received — added to Purchases, stock updated', 'आ गया — खरीद में जुड़ा, stock बढ़ा')}${r.created_product ? ' · ' + L('new product created (set its sell price in Products)', 'नया सामान बना (Products में बिक्री भाव डालो)') : ''}`);
      V.orders(); refreshSummary();
    } catch (e) { el.disabled = false; showErr('mkRecErr', errText(e)); }
  };

  // ---------- SELL: leads ----------
  function sellerGate() {
    if (M.profile && M.profile.is_seller) return false;
    const owner = me.user.role === 'owner';
    $('martView').innerHTML = `<div class="card mk-smart" style="max-width:720px">
      <h3>🏪 ${L('Start selling on Business Mart', 'Business Mart पर बेचना शुरू करो')}</h3>
      <div class="hint">${L('Wholesaler, distributor or manufacturer? Turn on selling, pick what you sell and where you deliver. Matching purchase inquiries from shops will reach you as leads.', 'Wholesaler, distributor या manufacturer हो? Selling चालू करो, क्या बेचते हो और कहाँ deliver करते हो चुनो। दुकानों की matching inquiries आप तक leads बनकर आएंगी।')}</div>
      ${owner ? `<button class="btn mk-wbtn" data-act="nav" data-v="profile">${L('Set up seller profile →', 'Seller profile बनाओ →')}</button>` : `<div class="hint" style="color:#fff">${L('Ask the owner to turn on selling.', 'Owner से selling चालू करवाओ।')}</div>`}
    </div>`;
    return true;
  }
  V.leads = async () => {
    await loadProfile();
    if (sellerGate()) return;
    const r = await api('GET', '/api/mart/leads?scope=' + M.leadScope);
    const matchedCount = M.leadScope === 'matched' ? r.leads.length : null;
    $('martView').innerHTML = `<div class="card">
      <div class="toolbar" style="flex-wrap:wrap"><div style="flex:1"><h3>${L('Businesses looking to buy', 'खरीदने वाले businesses')}</h3><div class="hint" style="margin:0">${L('You get leads for', 'आपको leads मिलती हैं:')} ${M.profile.categories.map((c) => ic(c) + ' ' + esc(c)).join(', ')} · ${M.profile.all_india ? L('All India', 'पूरा भारत') : esc([M.profile.city].concat(M.profile.service_cities).filter(Boolean).join(', '))} — <a data-act="nav" data-v="profile">${L('edit', 'बदलो')}</a></div></div></div>
      <div class="mk-tabs"><button class="${M.leadScope === 'matched' ? 'on' : ''}" data-act="lscope" data-s="matched">${L('Matched to you', 'आपके लिए')}${matchedCount != null ? ' (' + matchedCount + ')' : ''}</button><button class="${M.leadScope === 'all' ? 'on' : ''}" data-act="lscope" data-s="all">${L('All open requests', 'सारी खुली requests')}</button></div>
      ${r.leads.length ? `<div class="mk-scroll"><table><thead><tr><th>${L('Buyer', 'Buyer')}</th><th>${L('Needs', 'चाहिए')}</th><th>${L('Qty', 'मात्रा')}</th><th>${L('Target', 'Target')}</th><th>${L('By', 'तक')}</th><th>${L('Quotes', 'Quotes')}</th><th></th></tr></thead><tbody>
      ${r.leads.map((l) => `<tr><td><b>${esc(l.buyer.name)}</b> ${l.buyer.gst_registered ? '<span class="mk-gst">✔ GST</span>' : ''}${l.buyer.verified ? '<span class="mk-verified">✓ Verified</span>' : ''}<div class="mk-hint">${esc(l.city)} · ${ago(l.created_at)} · ${esc(l.frequency)}</div></td>
        <td>${ic(l.category)} ${esc(l.product)} ${l.direct ? `<span class="tag mk-tag-blue">${L('Asked you', 'आपसे मांगा')}</span>` : l.matched && M.leadScope === 'all' ? `<span class="tag mk-tag-blue">${L('Match', 'Match')}</span>` : ''}${l.verified_only ? ` <span class="tag mk-tag-grey">${L('GST only', 'सिर्फ़ GST')}</span>` : ''}</td>
        <td>${fmtQty(l.qty)} ${esc(l.unit)}</td><td>${l.target_price != null ? rs(l.target_price) : '—'}</td><td>${niceDate(l.need_by)}</td><td>${l.quotes_count}</td>
        <td style="text-align:right">${l.my_quote ? `<span class="tag ${l.my_quote.status === 'sent' ? 'tag-paid' : 'mk-tag-grey'}">${L('Quoted', 'Quote भेजा')} ${rs(l.my_quote.price)}</span>` : l.can_quote ? `<button class="btn btn-blue btn-sm" data-act="lead" data-id="${l.id}">${L('Send quote', 'Quote भेजो')}</button>` : `<span class="mk-hint">${L('GST sellers only', 'सिर्फ़ GST sellers')}</span>`}</td></tr>`).join('')}
      </tbody></table></div>` : empty('🎯', M.leadScope === 'matched' ? L('No matching leads right now. Check "All open requests", or add more categories / cities in your profile.', 'अभी कोई matching lead नहीं। "सारी खुली requests" देखो या profile में categories / शहर जोड़ो।') : L('No open requests right now.', 'अभी कोई खुली request नहीं।'))}
    </div>`;
  };
  ACT.lscope = (d) => { M.leadScope = d.s; V.leads(); };
  ACT.lead = (d) => quoteModal(Number(d.id));
  V.lead = async (id) => { M.mode = 'sell'; await V.leads(); quoteModal(id); };

  async function quoteModal(inqId) {
    let r, mine = [];
    try { r = await api('GET', '/api/mart/inquiries/' + inqId); } catch (e) { toast(errText(e)); return; }
    if (r.role === 'buyer') { go('inquiry', inqId); return; }
    try { mine = (await api('GET', '/api/mart/my-listings')).listings; } catch (e) { /* optional */ }
    const meta = M.meta || (M.meta = await api('GET', '/api/mart/meta'));
    const i = r.inquiry, q = r.my_quote;
    const lst = mine.find((l) => l.name.toLowerCase() === i.product.toLowerCase());
    const price = q ? q.price : (lst ? lst.price : (i.target_price || ''));
    openModal(`<div class="mk-row"><div><h2>${L('Quote for', 'Quote:')} ${esc(r.buyer.name)}${r.buyer.verified ? ' <span class="mk-verified">✓ Verified</span>' : ''}</h2><div class="mk-hint">${ic(i.category)} ${esc(i.product)} · ${fmtQty(i.qty)} ${esc(i.unit)} · ${esc(i.city)} · ${L('by', 'तक')} ${niceDate(i.need_by)}${i.target_price != null ? ' · ' + L('target', 'target') + ' ' + rs(i.target_price) : ''} · ${r.quotes_count} ${L('quotes so far', 'quotes अब तक')}</div></div><button class="btn btn-ghost btn-sm" data-act="close">✕</button></div>
      ${i.notes ? `<div class="mk-box">“${esc(i.notes)}”</div>` : ''}
      ${!r.can_quote ? `<div class="err" style="display:block;margin-top:12px">${esc(errText(new Error(r.cannot_quote_reason === 'closed' ? 'inquiry_not_open' : r.cannot_quote_reason)))}</div>` : `
      <div class="err" id="mkQErr"></div>
      <form id="mkQuoteForm"><div class="row2" style="margin-top:12px">
        <div class="field"><label>${L('Your price per', 'आपका भाव प्रति')} ${esc(i.unit)} *</label><input class="input" name="price" type="number" step="any" min="0.01" required value="${price}">${lst ? `<div class="mk-hint">${L('Your listed price', 'आपकी listing का भाव')}: ${rs(lst.price)}</div>` : ''}</div>
        <div class="field"><label>${L('Delivery in (days) *', 'Delivery (दिन) *')}</label><input class="input" name="delivery_days" type="number" min="0" max="90" required value="${q ? q.delivery_days : 2}"></div>
        <div class="field"><label>${L('Minimum order', 'Minimum order')} (${esc(i.unit)})</label><input class="input" name="moq" type="number" min="0" step="any" value="${q ? q.moq : (lst ? Math.min(lst.moq, i.qty) : 0)}"></div>
        <div class="field"><label>${L('Payment terms', 'Payment शर्तें')}</label><select class="input" name="payment_terms">${meta.payment_terms.map((t) => `<option ${q && q.payment_terms === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label>${L('Advance % (optional)', 'Advance % (optional)')}</label><input class="input" name="advance_percent" type="number" min="0" max="100" step="any" value="${q && q.advance_percent != null ? q.advance_percent : ''}" placeholder="20"></div>
        <div class="field"><label>${L('Credit days (optional)', 'Credit din (optional)')}</label><input class="input" name="credit_days" type="number" min="0" max="120" value="${q && q.credit_days != null ? q.credit_days : ''}" placeholder="15"></div>
        <div class="field"><label>${L('Quote valid for', 'Quote कब तक valid')}</label><select class="input" name="valid_days">${[2, 3, 5, 7, 15].map((n) => `<option value="${n}" ${(q ? q.valid_days : 3) === n ? 'selected' : ''}>${n} ${L('days', 'दिन')}</option>`).join('')}</select></div>
        <div class="field"><label>${L('Total for buyer', 'Buyer का कुल')}</label><div class="mk-big" id="mkQTotal">—</div></div>
      </div>
      <div class="field"><label>${L('Message to buyer', 'Buyer को message')}</label><textarea class="input" name="note" rows="2" maxlength="400" placeholder="${L('Quality, brand, packing, free delivery…', 'Quality, brand, packing, free delivery…')}">${q ? esc(q.note) : ''}</textarea></div>
      <div class="mk-mfoot">${q && q.status === 'sent' ? `<button type="button" class="btn btn-ghost" data-act="chat" data-id="${q.id}">💬 ${L('Chat', 'Chat')}</button>` : ''}<button type="button" class="btn btn-ghost" data-act="close">${L('Cancel', 'रद्द')}</button><button class="btn btn-blue">${q ? L('Update quote', 'Quote बदलो') : L('Send quote', 'Quote भेजो')}</button></div></form>`}`);
    const f = $('mkQuoteForm'); if (!f) return;
    const upd = () => { $('mkQTotal').textContent = f.price.value ? rs(Number(f.price.value) * i.qty) : '—'; };
    f.price.addEventListener('input', upd); upd();
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); hideErr('mkQErr');
      const body = { price: Number(f.price.value), delivery_days: Number(f.delivery_days.value), moq: Number(f.moq.value || 0), payment_terms: f.payment_terms.value, valid_days: Number(f.valid_days.value), note: f.note.value.trim(),
        advance_percent: f.advance_percent.value === '' ? null : Number(f.advance_percent.value), credit_days: f.credit_days.value === '' ? null : Number(f.credit_days.value) };
      try {
        await api('POST', `/api/mart/inquiries/${inqId}/quotes`, body);
        closeModal(); toast(`📤 ${L('Quote sent to', 'Quote भेजा:')} ${r.buyer.name}`);
        if (M.view === 'sent') V.sent(); else V.leads();
        refreshSummary();
      } catch (err) { showErr('mkQErr', errText(err)); }
    });
  }

  // ---------- SELL: quotes sent ----------
  V.sent = async () => {
    await loadProfile();
    if (sellerGate()) return;
    const r = await api('GET', '/api/mart/quotes-sent');
    const tg = { sent: ['Waiting', 'इंतज़ार', 'tag-part'], accepted: ['Won 🎉', 'जीता 🎉', 'tag-paid'], declined: ['Not selected', 'नहीं चुना', 'tag-pend'], closed: ['Closed', 'बंद', 'mk-tag-grey'], withdrawn: ['Withdrawn', 'वापस लिया', 'mk-tag-grey'], expired: ['Expired', 'समय ख़त्म', 'mk-tag-grey'], cancelled: ['Order cancelled', 'ऑर्डर रद्द', 'tag-pend'] };
    $('martView').innerHTML = `<div class="card">${r.quotes.length ? `<div class="mk-scroll"><table><thead><tr><th>${L('Buyer', 'Buyer')}</th><th>${L('Product', 'सामान')}</th><th>${L('Your price', 'आपका भाव')}</th><th>${L('Total', 'कुल')}</th><th>${L('Terms', 'शर्तें')}</th><th>${L('Status', 'हालत')}</th><th></th></tr></thead><tbody>
      ${r.quotes.map((q) => { const t = tg[q.status] || tg.sent; return `<tr><td><b>${esc(q.buyer.name)}</b><div class="mk-hint">${ago(q.updated_at)}</div></td><td>${ic(q.inquiry.category)} ${esc(q.inquiry.product)} · ${fmtQty(q.inquiry.qty)} ${esc(q.inquiry.unit)}</td>
        <td>${rs(q.price)}/${esc(q.inquiry.unit)}</td><td>${rs(q.price * q.inquiry.qty)}</td><td class="mk-hint">${esc(q.payment_terms)}${termsTxt(q) ? ' · ' + termsTxt(q) : ''} · ${q.delivery_days}d</td>
        <td><span class="tag ${t[2]}">${L(t[0], t[1])}</span>${q.order ? `<div class="mk-hint">${q.order.order_no}</div>` : ''}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn btn-ghost btn-sm" data-act="chat" data-id="${q.id}">💬</button>${q.status === 'sent' ? `<button class="btn btn-ghost btn-sm" data-act="lead" data-id="${q.inquiry_id}">${L('Edit', 'बदलो')}</button><button class="btn btn-ghost btn-sm" data-act="withdraw" data-id="${q.id}">${L('Withdraw', 'वापस लो')}</button>` : ''}${q.order ? `<button class="btn btn-soft btn-sm" data-act="gotoOrder" data-id="${q.order.id}">${L('Order →', 'ऑर्डर →')}</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>` : empty('📤', L('No quotes sent yet.', 'अभी कोई quote नहीं भेजा।') + ` <a data-act="nav" data-v="leads">${L('See leads', 'Leads देखो')}</a>`)}</div>`;
  };
  ACT.withdraw = async (d) => { try { await api('POST', `/api/mart/quotes/${d.id}/withdraw`); toast(L('Quote withdrawn', 'Quote वापस लिया')); V.sent(); } catch (e) { toast(errText(e)); } };
  ACT.gotoOrder = (d) => { M.mode = 'sell'; go('orders', Number(d.id)); };

  // ---------- SELL: catalog ----------
  V.catalog = async () => {
    await loadProfile();
    if (sellerGate()) return;
    const r = await api('GET', '/api/mart/my-listings');
    $('martView').innerHTML = `<div class="card">
      <div class="toolbar"><div style="flex:1"><h3>${L('What you sell on the Mart', 'Mart पर आप क्या बेचते हो')}</h3><div class="hint" style="margin:0">${L('Listed products show in Browse. Buyers can ask you for a quote directly.', 'Listing Browse में दिखती है। Buyers सीधे आपसे quote मांग सकते हैं।')}</div></div><button class="btn btn-blue" data-act="addListing">+ ${L('Add product', 'सामान जोड़ो')}</button></div>
      ${r.listings.length ? `<table><thead><tr><th></th><th>${L('Product', 'सामान')}</th><th>${L('Category', 'Category')}</th><th>${L('Wholesale price', 'Wholesale भाव')}</th><th>${L('Min. order', 'कम से कम')}</th><th>${L('Visible', 'दिखेगा')}</th><th></th></tr></thead><tbody>
      ${r.listings.map((l) => `<tr><td>${l.photo ? `<img class="mk-thumb" src="${l.photo}" alt="">` : ''}</td><td>${ic(l.category)} <b>${esc(l.name)}</b>${l.product_id ? ` <span class="mk-hint">· ${L('linked to stock', 'stock से जुड़ा')}</span>` : ''}</td><td>${esc(l.category)}</td><td>${rs(l.price)}/${esc(l.unit)}</td><td>${fmtQty(l.moq)} ${esc(l.unit)}</td>
        <td><label class="switch" style="margin:0"><input type="checkbox" data-act="toggleListing" data-id="${l.id}" ${l.active ? 'checked' : ''}><span class="slider"></span></label></td>
        <td style="text-align:right"><button class="btn btn-ghost btn-sm" data-act="editListing" data-id="${l.id}">${L('Edit', 'बदलो')}</button><button class="btn btn-danger btn-sm" data-act="delListing" data-id="${l.id}">${L('Remove', 'हटाओ')}</button></td></tr>`).join('')}
      </tbody></table>` : empty('🏷️', L('No products listed yet.', 'अभी कोई सामान list नहीं किया।'))}
      <div class="mk-prefill" style="margin-top:14px">✨ ${L('Tip: pick from your Workspace stock when adding — name and unit fill in automatically.', 'Tip: जोड़ते समय Workspace stock से चुनो — नाम और unit अपने आप भरेंगे।')}</div>
    </div>`;
    M._myListings = r.listings;
  };
  ACT.toggleListing = async (d, el) => {
    const l = M._myListings.find((x) => String(x.id) === d.id);
    try { await api('PUT', `/api/mart/listings/${d.id}`, { ...l, active: el.checked }); toast(el.checked ? L('Listing visible', 'Listing दिख रही है') : L('Listing hidden', 'Listing छिपी')); } catch (e) { el.checked = !el.checked; toast(errText(e)); }
  };
  ACT.delListing = async (d) => { try { await api('DELETE', `/api/mart/listings/${d.id}`); toast(L('Removed', 'हटा दिया')); V.catalog(); } catch (e) { toast(errText(e)); } };
  ACT.addListing = () => listingModal(null);
  ACT.editListing = (d) => listingModal(M._myListings.find((x) => String(x.id) === d.id));
  async function listingModal(l) {
    const meta = M.meta || (M.meta = await api('GET', '/api/mart/meta'));
    let prods = [];
    try { prods = (await api('GET', '/api/products')).products; } catch (e) { /* stock access may be off */ }
    const cats = M.profile.categories.length ? M.profile.categories : meta.categories;
    openModal(`<h2>${l ? L('Edit product', 'सामान बदलो') : L('Add a product', 'सामान जोड़ो')}</h2><div class="err" id="mkLErr"></div>
      <form id="mkLForm"><div class="row2" style="margin-top:10px">
        <div class="field" style="grid-column:1/-1"><label>${L('Product name *', 'सामान का नाम *')}</label><input class="input" name="name" required maxlength="120" list="mkStockList" value="${l ? esc(l.name) : ''}"><datalist id="mkStockList">${prods.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
        <div class="field"><label>${L('Category', 'Category')}</label><select class="input" name="category">${meta.categories.map((c) => `<option ${(l ? l.category : cats[0]) === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label>${L('Unit', 'Unit')}</label><select class="input" name="unit">${meta.units.map((u) => `<option ${l && l.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
        <div class="field"><label>${L('Wholesale price ₹ *', 'Wholesale भाव ₹ *')}</label><input class="input" name="price" type="number" step="any" min="0.01" required value="${l ? l.price : ''}"></div>
        <div class="field"><label>${L('Minimum order *', 'कम से कम order *')}</label><input class="input" name="moq" type="number" step="any" min="0.01" required value="${l ? l.moq : 1}"></div>
      </div>
      <div class="field"><label>${L('Photo (optional)', 'Photo (optional)')}</label><input class="input" type="file" id="mkLPhoto" accept="image/*">
        <div id="mkLPhotoWrap">${l && l.photo ? `<img class="mk-photo-prev" src="${l.photo}" alt="">` : ''}</div>
        <div style="margin-top:6px">${l && l.photo ? `<button type="button" class="btn btn-ghost btn-sm" id="mkLPhotoDel">${L('Remove photo', 'Photo हटाओ')}</button>` : ''}<span class="mk-hint">${L('One photo per listing — it is shrunk automatically before saving.', 'Ek listing par ek photo — save hone se pehle apne aap chhoti ho jayegi.')}</span></div></div>
      <div class="mk-mfoot"><button type="button" class="btn btn-ghost" data-act="close">${L('Cancel', 'रद्द')}</button><button class="btn btn-blue">${L('Save', 'सेव करो')}</button></div></form>`);
    const f = $('mkLForm');
    const photoState = { value: l ? (l.photo || null) : null, touched: !l };
    $('mkLPhoto').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast(L('Please choose an image file.', 'Image file chuno.')); e.target.value = ''; return; }
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, 900 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * sc)); cv.height = Math.max(1, Math.round(img.height * sc));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(img.src);
        photoState.value = cv.toDataURL('image/jpeg', 0.82); photoState.touched = true;
        $('mkLPhotoWrap').innerHTML = `<img class="mk-photo-prev" src="${photoState.value}" alt="">`;
      };
      img.onerror = () => { URL.revokeObjectURL(img.src); toast(L('That file could not be read as an image.', 'Ye file image ki tarah nahi khuli.')); };
      img.src = URL.createObjectURL(file);
    });
    const delBtn = $('mkLPhotoDel');
    if (delBtn) delBtn.addEventListener('click', () => { photoState.value = null; photoState.touched = true; $('mkLPhotoWrap').innerHTML = ''; delBtn.remove(); });
    f.name.addEventListener('change', () => {
      const p = prods.find((x) => x.name === f.name.value);
      if (p) { if (meta.units.includes(p.unit)) f.unit.value = p.unit; if (!f.price.value && p.sell_price) f.price.value = p.sell_price; f.dataset.pid = p.id; }
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); hideErr('mkLErr');
      const body = { name: f.name.value.trim(), category: f.category.value, unit: f.unit.value, price: Number(f.price.value), moq: Number(f.moq.value), active: l ? l.active : true, product_id: f.dataset.pid ? Number(f.dataset.pid) : (l ? l.product_id : null) };
      if (photoState.touched) body.photo = photoState.value;
      try { if (l) await api('PUT', `/api/mart/listings/${l.id}`, body); else await api('POST', '/api/mart/listings', body); closeModal(); toast(L('Saved — visible in Browse', 'सेव हुआ — Browse में दिखेगा')); V.catalog(); }
      catch (err) { showErr('mkLErr', errText(err)); }
    });
  }

  // ---------- SELL: profile ----------
  V.profile = async () => {
    await loadProfile();
    const meta = M.meta || (M.meta = await api('GET', '/api/mart/meta'));
    const p = M.profile; const owner = me.user.role === 'owner';
    $('martView').innerHTML = `<form class="card" id="mkProfForm" style="max-width:820px">
      <h3>${L('Your Business Mart profile', 'आपकी Business Mart प्रोफ़ाइल')}</h3><div class="hint">${L('This is how other businesses see you on the Mart.', 'Mart पर दूसरे businesses आपको ऐसे देखेंगे।')}</div>
      ${!owner ? `<div class="mk-prefill">${L('Only the owner can change the Mart profile.', 'Mart profile सिर्फ़ owner बदल सकता है।')}</div>` : ''}
      <div class="err" id="mkPErr"></div>
      <div class="row2"><div class="field"><label>${L('Business name on Mart *', 'Mart पर नाम *')}</label><input class="input" name="display_name" required maxlength="80" value="${esc(p.display_name)}"></div>
        <div class="field"><label>${L('City', 'शहर')}</label><input class="input" name="city" maxlength="60" value="${esc(p.city)}"></div></div>
      <div class="row2"><div class="field"><label>${L('Area / market', 'इलाका / मार्केट')}</label><input class="input" name="area" maxlength="80" value="${esc(p.area)}" placeholder="${L('e.g. Naya Bazar', 'जैसे Naya Bazar')}"></div>
        <div class="field"><label>GST</label><div class="mk-hint" style="padding-top:10px">${p.gst_registered ? '✔ ' + L('GSTIN added — buyers see a GST badge', 'GSTIN डाला है — buyers को GST badge दिखेगा') : L('No GSTIN yet. Add it in Workspace → Settings to get the GST badge and quote on "GST sellers only" inquiries.', 'GSTIN नहीं है। Workspace → Settings में डालो — GST badge मिलेगा और "सिर्फ़ GST" inquiries पर quote कर सकोगे।')}</div>
        <div class="mk-hint" style="padding-top:4px">${p.verified ? '<span class="mk-verified">✓ Verified</span> ' + L('Your Verified badge is live — it shows with your name everywhere on the Mart.', 'Aapka Verified badge live hai — Mart par har jagah naam ke saath dikhta hai.') : L('Verified badge needs three things: a valid-format GSTIN (in Settings), a phone number and a city.', 'Verified badge ke liye teen cheezein chahiye: sahi format ka GSTIN (Settings me), phone number aur city.')}</div></div></div>
      <label class="tgl-row"><div class="t-txt"><b>${L('I sell on Business Mart', 'मैं Business Mart पर बेचता हूँ')}</b><span>${L('Wholesalers, distributors, manufacturers — get leads from businesses that need your products', 'Wholesaler, distributor, manufacturer — जिन्हें आपका सामान चाहिए उनसे leads पाओ')}</span></div><span class="switch"><input type="checkbox" name="is_seller" ${p.is_seller ? 'checked' : ''}><span class="slider"></span></span></label>
      <div id="mkSellerBits" class="${p.is_seller ? '' : 'hidden'}">
        <div class="field"><label>${L('What do you sell? (you get leads for these)', 'क्या बेचते हो? (इन्हीं की leads मिलेंगी)')}</label><div class="mk-chips" id="mkCats">${meta.categories.map((c) => `<button type="button" class="mk-chip ${p.categories.includes(c) ? 'on' : ''}" data-c="${esc(c)}">${ic(c)} ${esc(c)}</button>`).join('')}</div></div>
        <label class="tgl-row"><div class="t-txt"><b>${L('I deliver all over India', 'मैं पूरे भारत में deliver करता हूँ')}</b><span>${L('Otherwise only your city + the cities below', 'वरना सिर्फ़ आपका शहर + नीचे वाले शहर')}</span></div><span class="switch"><input type="checkbox" name="all_india" ${p.all_india ? 'checked' : ''}><span class="slider"></span></span></label>
        <div class="field"><label>${L('Other cities you deliver to (comma separated)', 'और किन शहरों में deliver करते हो (comma से)')}</label><input class="input" name="service_cities" value="${esc(p.service_cities.join(', '))}" placeholder="Gurugram, Noida, Faridabad"></div>
        <div class="field"><label>${L('About your business', 'आपके business के बारे में')}</label><textarea class="input" name="about" rows="2" maxlength="400" placeholder="${L('e.g. Wholesale FMCG, next-day delivery in NCR', 'जैसे Wholesale FMCG, NCR में अगले दिन delivery')}">${esc(p.about)}</textarea></div>
      </div>
      ${owner ? `<button class="btn btn-blue" type="submit">${L('Save profile', 'प्रोफ़ाइल सेव करो')}</button>` : ''}
    </form>`;
    const f = $('mkProfForm');
    f.is_seller.addEventListener('change', () => $('mkSellerBits').classList.toggle('hidden', !f.is_seller.checked));
    $('mkCats').addEventListener('click', (e) => { const b = e.target.closest('.mk-chip'); if (b) b.classList.toggle('on'); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); hideErr('mkPErr');
      const body = {
        display_name: f.display_name.value.trim(), city: f.city.value.trim(), area: f.area.value.trim(), about: f.about.value.trim(),
        is_seller: f.is_seller.checked, all_india: f.all_india.checked, service_cities: f.service_cities.value,
        categories: [...$('mkCats').querySelectorAll('.mk-chip.on')].map((b) => b.dataset.c)
      };
      try { await api('PUT', '/api/mart/profile', body); await loadProfile(); toast(L('Profile saved', 'प्रोफ़ाइल सेव हुई')); if (body.is_seller) { M.mode = 'sell'; go('leads'); } else go('profile'); }
      catch (err) { showErr('mkPErr', errText(err)); }
    });
  };

  // ---------- notifications ----------
  V.notifs = async () => {
    const r = await api('GET', '/api/mart/notifications');
    $('martView').innerHTML = `<div class="card">${r.notifications.length ? r.notifications.map((n) => `
      <div class="mk-li ${n.read ? '' : 'unread'}" data-act="notif" data-v="${esc(n.link_view)}" data-id="${n.link_id == null ? '' : n.link_id}" data-k="${esc(n.kind)}"><div class="mk-ic">${{ lead: '🎯', quote: '💬', quote_update: '🔄', order: '🎉', order_status: '🚚', counter: '💰', message: '✉️', declined: '🙏', closed: '🔒', rating: '⭐' }[n.kind] || '🔔'}</div>
        <div style="flex:1"><div>${esc(n.text)}</div><small>${ago(n.created_at)}</small></div></div>`).join('')
      : empty('🔔', L('No notifications yet.', 'अभी कोई सूचना नहीं।'))}</div>
      <div class="mk-hint" style="margin-top:10px">${L('Badges update every 30 seconds while BizYour is open. WhatsApp alerts can be added later with the WhatsApp Business API.', 'BizYour खुला हो तो badges हर 30 seconds में update होते हैं। WhatsApp alerts बाद में WhatsApp Business API से जुड़ सकते हैं।')}</div>`;
    if (r.notifications.some((n) => !n.read)) { try { await api('POST', '/api/mart/notifications/read-all'); } catch (e) { /* ignore */ } }
  };
  ACT.notif = async (d) => {
    const id = d.id ? Number(d.id) : null;
    if (d.v === 'inquiry') { M.mode = 'buy'; go('inquiry', id); }
    else if (d.v === 'lead') { M.mode = 'sell'; go('lead', id); }
    else if (d.v === 'chat') openChat(id);
    else if (d.v === 'sent') { M.mode = 'sell'; go('sent'); }
    else if (d.v === 'order') {
      // Find which side of the order we are on.
      try {
        const s = await api('GET', '/api/mart/orders?role=seller');
        M.mode = s.orders.some((o) => o.id === id) ? 'sell' : 'buy';
      } catch (e) { /* default */ }
      go('orders', id);
    }
  };

  // ===================================================================
  // hooks into app.js
  // ===================================================================
  const _enterApp = enterApp;
  enterApp = async function () {
    setModule('workspace');
    await _enterApp();
    M.profile = null; M.summary = null; M.mode = 'buy';
    refreshSummary();
    if (M.pollTimer) clearInterval(M.pollTimer);
    M.pollTimer = setInterval(() => {
      refreshSummary();
      if (M.module === 'mart' && $('mkOverlay').classList.contains('hidden') && ['home', 'inquiries', 'inquiry', 'leads', 'orders', 'sent'].includes(M.view) && document.visibilityState === 'visible') {
        (V[M.view])(M.arg).catch(() => {});
      }
    }, 30000);
  };
  $('logoutBtn').addEventListener('click', () => { if (M.pollTimer) clearInterval(M.pollTimer); setModule('workspace'); closeModal(); });
  const _applyLang = applyLang;
  applyLang = function (lang) {
    _applyLang(lang);
    if (M.module === 'mart' && me) { renderNav(); const t = TITLES[M.view]; if (t) $('pageTitle').textContent = L(t[0], t[1]); if ($('mkOverlay').classList.contains('hidden')) (V[M.view] || V.home)(M.arg).catch(() => {}); }
  };
})();
