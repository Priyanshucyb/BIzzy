// BizYour — Business Mart DEMO seed.
// Run AFTER seed-demo.js:  node backend/seed-mart-demo.js   (load-demo.bat runs both)
//
// Adds a small living marketplace around the "Sharma General Store" demo so
// both sides of Business Mart can be shown with REAL logins (no fake replies):
//   - 3 wholesale SELLER businesses, each with its own owner login, Mart
//     profile and listings:
//       Fresh Supply Co        fresh@bizyour.demo   / demo1234   (Delhi · FMCG, Staples, Oil & Ghee)
//       Annapurna Rice Mills   rice@bizyour.demo    / demo1234   (Karnal · Staples · All India)
//       Gupta Traders          gupta@bizyour.demo   / demo1234   (Delhi · Tea, Spices, Staples)
//   - 2 more BUYER businesses with open inquiries (leads for the sellers):
//       Verma Kirana           verma@bizyour.demo   / demo1234
//       Hotel Saffron          saffron@bizyour.demo / demo1234
//   - Sharma General Store gets a Mart profile (buyer) and one open inquiry
//     (500 kg Sona Masoori rice) that already has 3 real quotes + a chat.
//
// Idempotent: if fresh@bizyour.demo already exists, nothing changes.
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const fmtTs = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
const hoursAgo = (h) => fmtTs(new Date(Date.now() - h * 3600e3));
const dayStr = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);

async function main() {
  await db.init();
  if (await db.get('SELECT id FROM users WHERE email = ?', 'fresh@bizyour.demo')) {
    console.log('\n  Business Mart demo pehle se hai — kuch change nahi hua.\n');
    process.exit(0);
  }
  const sharmaUser = await db.get('SELECT business_id FROM users WHERE email = ?', 'demo@businessos.app');
  const hash = bcrypt.hashSync('demo1234', 10);
  const trialEnd = fmtTs(new Date(Date.now() + 30 * 86400e3));

  const tx = await db.begin();
  try {
    async function makeBiz(b) {
      const r = await tx.run(
        `INSERT INTO businesses (name, owner_name, phone, city, gst_enabled, gstin, language, created_at) VALUES (?, ?, ?, ?, ?, ?, 'en', ?)`
      , b.name, b.owner, b.phone, b.city, b.gstin ? 1 : 0, b.gstin || '', b.since + '-04-01 10:00:00');
      const id = r.lastInsertRowid;
      await tx.run(`INSERT INTO users (business_id, name, email, password_hash, role, access) VALUES (?, ?, ?, ?, 'owner', 'all')`, id, b.owner, b.email, hash);
      await tx.run(`INSERT INTO subscriptions (business_id, trial_ends_at, grace_days) VALUES (?, ?, 7)`, id, trialEnd);
      await tx.run(`INSERT INTO onboarding (business_id, dismissed) VALUES (?, 1)`, id);
      await tx.run(
        `INSERT INTO mart_profiles (business_id, display_name, city, area, about, categories, service_cities, all_india, is_seller) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      , id, b.name, b.city, b.area || '', b.about || '', (b.cats || []).join(','), (b.serves || []).join(','), b.allIndia ? 1 : 0, b.seller ? 1 : 0);
      return id;
    }

    const fresh = await makeBiz({ name: 'Fresh Supply Co', owner: 'Rakesh Jain', email: 'fresh@bizyour.demo', phone: '9810011001', city: 'Delhi', area: 'Naya Bazar', gstin: '07AAFFS1234K1Z2', since: '2014', seller: true, cats: ['FMCG', 'Staples', 'Oil & Ghee'], serves: ['Gurugram', 'Noida', 'Faridabad', 'Ghaziabad'], about: 'Wholesale FMCG & staples. Same/next-day delivery across Delhi NCR.' });
    const rice = await makeBiz({ name: 'Annapurna Rice Mills', owner: 'Harpreet Singh', email: 'rice@bizyour.demo', phone: '9810011002', city: 'Karnal', area: 'Haryana', gstin: '06AAKCA5678M1Z9', since: '2001', seller: true, cats: ['Staples'], allIndia: true, about: 'Rice mill — Sona Masoori, 1121 Basmati, Parmal. 25 kg & 50 kg bags.' });
    const gupta = await makeBiz({ name: 'Gupta Traders', owner: 'Anil Gupta', email: 'gupta@bizyour.demo', phone: '9810011003', city: 'Delhi', area: 'Khari Baoli', gstin: '', since: '2009', seller: true, cats: ['Tea & Beverages', 'Spices', 'Staples'], serves: ['Gurugram', 'Noida'], about: 'Chai patti, masale, dal — Khari Baoli wholesale.' });
    const verma = await makeBiz({ name: 'Verma Kirana', owner: 'Sunil Verma', email: 'verma@bizyour.demo', phone: '9810011004', city: 'Delhi', area: 'Rohini', since: '2018' });
    const saffron = await makeBiz({ name: 'Hotel Saffron', owner: 'Meena Arora', email: 'saffron@bizyour.demo', phone: '9810011005', city: 'Delhi', area: 'Paharganj', gstin: '07AAHCS4321P1Z3', since: '2016' });

    // Listings (what sellers show in Browse)
    const L = [
      [fresh, 'Surf Excel 1kg', 'FMCG', 'pack', 112, 24], [fresh, 'Sona Masoori Rice', 'Staples', 'kg', 47.5, 100],
      [fresh, 'Mustard Oil 15L Tin', 'Oil & Ghee', 'tin', 2150, 5], [fresh, 'Wheat Atta 50kg', 'Staples', 'bag', 1420, 10],
      [rice, 'Sona Masoori Rice', 'Staples', 'kg', 46, 250], [rice, 'Basmati Rice (1121)', 'Staples', 'kg', 78, 250], [rice, 'Parmal Rice', 'Staples', 'kg', 38, 500],
      [gupta, 'Chai Patti 500g', 'Tea & Beverages', 'pack', 198, 20], [gupta, 'Assam CTC Tea (loose)', 'Tea & Beverages', 'kg', 340, 25],
      [gupta, 'Toor Dal', 'Staples', 'kg', 128, 100], [gupta, 'Haldi Powder', 'Spices', 'kg', 180, 25]
    ];
    for (const [biz, name, cat, unit, price, moq] of L) {
      await tx.run(`INSERT INTO mart_listings (business_id, name, category, unit, price, moq, active) VALUES (?, ?, ?, ?, ?, ?, 1)`, biz, name, cat, unit, price, moq);
    }

    // Other buyers' open inquiries (leads for sellers)
    async function inquiry(biz, o) {
      const r = await tx.run(
        `INSERT INTO mart_inquiries (business_id, product, category, qty, unit, target_price, city, need_by, frequency, notes, show_name, verified_only, status, source, notified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'manual', ?, ?, ?)`
      , biz, o.product, o.cat, o.qty, o.unit, o.target, o.city, o.needBy, o.freq, o.notes || '', o.showName === false ? 0 : 1, o.verifiedOnly ? 1 : 0, o.notified || 0, o.at, o.at);
      return r.lastInsertRowid;
    }
    const iAtta = await inquiry(verma, { product: 'Wheat Atta 50kg', cat: 'Staples', qty: 20, unit: 'bag', target: 1400, city: 'Delhi', needBy: dayStr(3), freq: 'Weekly', notes: 'Chakki fresh, any good brand', notified: 3, at: hoursAgo(1) });
    const iBasmati = await inquiry(saffron, { product: 'Basmati Rice (1121)', cat: 'Staples', qty: 300, unit: 'kg', target: 75, city: 'Delhi', needBy: dayStr(6), freq: 'Monthly', notes: 'Long grain, aged. Hotel use.', verifiedOnly: true, notified: 2, at: hoursAgo(3) });
    await inquiry(verma, { product: 'Mustard Oil 15L Tin', cat: 'Oil & Ghee', qty: 6, unit: 'tin', target: null, city: 'Delhi', needBy: dayStr(4), freq: 'One-time', showName: false, notified: 1, at: hoursAgo(6) });
    for (const [biz, inq] of [[fresh, iAtta], [rice, iAtta], [gupta, iAtta], [fresh, iBasmati], [rice, iBasmati]]) {
      await tx.run(`INSERT INTO mart_notifications (business_id, kind, text, link_view, link_id, created_at) VALUES (?, 'lead', ?, 'lead', ?, ?)`
      , biz, inq === iAtta ? 'New lead: Verma Kirana needs 20 bag Wheat Atta 50kg (Delhi)' : 'New lead: Hotel Saffron needs 300 kg Basmati Rice (1121) (Delhi)', inq, hoursAgo(inq === iAtta ? 1 : 3));
    }
    // Annapurna already quoted Hotel Saffron
    await tx.run(`INSERT INTO mart_quotes (inquiry_id, seller_business_id, price, moq, delivery_days, payment_terms, valid_days, note, status, created_at, updated_at) VALUES (?, ?, 76, 250, 3, '50% advance', 5, 'Aged 1121, 25kg bags.', 'sent', ?, ?)`
    , iBasmati, rice, hoursAgo(2), hoursAgo(2));

    // Sharma General Store — buyer side of the demo
    if (sharmaUser) {
      const sharma = sharmaUser.business_id;
      const hasProfile = await tx.get('SELECT id FROM mart_profiles WHERE business_id = ?', sharma);
      if (!hasProfile) {
        await tx.run(`INSERT INTO mart_profiles (business_id, display_name, city, area, is_seller) VALUES (?, 'Sharma General Store', 'Delhi', 'Karol Bagh', 0)`, sharma);
      }
      const iRice = await inquiry(sharma, { product: 'Sona Masoori Rice', cat: 'Staples', qty: 500, unit: 'kg', target: 48, city: 'Delhi', needBy: dayStr(4), freq: 'Monthly', notes: 'New crop, 25kg bags, clean & sorted', notified: 3, at: hoursAgo(6) });
      const q = async (seller, price, moq, days, terms, note, h) => (await tx.run(
        `INSERT INTO mart_quotes (inquiry_id, seller_business_id, price, moq, delivery_days, payment_terms, valid_days, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 5, ?, 'sent', ?, ?)`
      , iRice, seller, price, moq, days, terms, note, hoursAgo(h), hoursAgo(h))).lastInsertRowid;
      const qRice = await q(rice, 46, 250, 3, '50% advance', 'Fresh 2026 crop. Free delivery above 400 kg.', 5);
      await q(gupta, 49, 100, 1, 'Cash on delivery', 'Can deliver tomorrow morning.', 4);
      await q(fresh, 47.5, 100, 2, '7-day credit', 'Regular customer rate — 7 din udhaar.', 2);
      await tx.run(`INSERT INTO mart_messages (quote_id, sender_business_id, kind, body, created_at) VALUES (?, ?, 'text', ?, ?)`
      , qRice, rice, 'Namaste ji, new crop Sona Masoori available in 25kg bags. Sample bhej sakte hain.', hoursAgo(5));
      for (const [seller, txt, h] of [[rice, 'Annapurna Rice Mills quoted ₹46/kg for Sona Masoori Rice', 5], [gupta, 'Gupta Traders quoted ₹49/kg for Sona Masoori Rice', 4], [fresh, 'Fresh Supply Co quoted ₹47.5/kg for Sona Masoori Rice', 2]]) {
        await tx.run(`INSERT INTO mart_notifications (business_id, kind, text, link_view, link_id, created_at) VALUES (?, 'quote', ?, 'inquiry', ?, ?)`, sharma, txt, iRice, hoursAgo(h));
        await tx.run(`INSERT INTO mart_views (inquiry_id, business_id) VALUES (?, ?)`, iRice, seller);
      }
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    console.error('\n  Business Mart demo load NAHI hua: ' + e.message + '\n');
    process.exit(1);
  }
  console.log('');
  console.log('  ============================================================');
  console.log('  BUSINESS MART DEMO LOAD HO GAYA');
  console.log('  ============================================================');
  console.log('  Buyer   (Sharma General Store):  demo@businessos.app / demo1234');
  console.log('  Seller  (Fresh Supply Co):       fresh@bizyour.demo    / demo1234');
  console.log('  Seller  (Annapurna Rice Mills):  rice@bizyour.demo     / demo1234');
  console.log('  Seller  (Gupta Traders):         gupta@bizyour.demo    / demo1234');
  console.log('  Buyers  (Verma Kirana / Hotel Saffron): verma@bizyour.demo / saffron@bizyour.demo — demo1234');
  if (!sharmaUser) console.log('  Note: Sharma demo nahi mila — pehle seed-demo.js chalao, phir ye.');
  console.log('');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
