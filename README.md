# Business OS v3

by DILIGENCE · **Pura business, ek hi app se — billing, inventory, customer aur payment sab ek jagah.**

Dukaan / product wale business ke liye bana hua pura system: bill banao (GST ke saath ya bina), stock apne aap ghatega-badhega, udhaar ka hisaab, supplier ko dena, roz ka kharcha, aur mahine ke aakhir me **asli profit** — sab ek hi app me, seedhi-saadi light-clean screens par, English ya Hindi me. App default me poora **tumhare apne computer par** chalta hai — internet ho ya na ho, dukaan nahi rukti. Aur v3 me wahi app **cloud par bhi** chal sakta hai (neeche "v3 — Cloud Mode" dekho).

## Chalana kaise hai (Windows)

**Sabse easy:** is folder me **`start-business-os.bat`** par double-click karo.
Browser khud khul jayega: http://localhost:4000

Pehli baar chalane par Signup karke apni dukaan banao (naam, GST on/off, language) — 1 minute ka kaam hai.

**Haath se chalana ho to:**
```
cd backend
npm install     (sirf pehli baar)
node server.js
```
Phir browser me http://localhost:4000 kholo.

## Demo dukaan (customer ko dikhane ke liye)

Ready-made sample dukaan ka data load karne ke liye: app band karke **`load-demo.bat`** par double-click karo, phir `start-business-os.bat` chalao.

| Login | Email | Password |
|---|---|---|
| Owner (sab kuch) | `demo@businessos.app` | `demo1234` |
| Staff (sirf billing) | `counter@businessos.app` | `staff1234` |

Demo dukaan "Sharma General Store" me 8 products, 2 suppliers, 4 customers, pichhle 7 din ke bills aur is mahine ke kharche pehle se bhare hain. Demo ek **alag business** bankar load hota hai — asli data bilkul safe rehta hai, aur `load-demo.bat` dobara chalane se kuch duplicate nahi hota.
**Demo kis order me dikhana hai — `DEMO-GUIDE.md` dekho (10 minute ka pura flow).**

## Zaruri (Requirement)

- **Node.js 22 ya usse naya** — https://nodejs.org se LTS install karo. (Database ke liye Node ka built-in SQLite use hota hai, isliye 22+ lazmi hai.)
- Node install karne ke baad **internet ki zarurat nahi** — app pura isi computer par (localhost) chalta hai.

## v3 — Cloud Mode (Stage A: Cloud Backend)

Ek hi app, do mode — chunav sirf ek setting (`DATABASE_URL`) ka hai:

| | **Local mode** (default) | **Cloud mode** |
|---|---|---|
| Kab | `DATABASE_URL` set NA ho | `DATABASE_URL` set ho |
| Data kahan | Isi computer ki SQLite file: `backend/data/business-os.db` | Cloud **PostgreSQL** (Neon/Supabase/Render) |
| Chalana | `start-business-os.bat` (port 4000) | Host par deploy — `DEPLOY-GUIDE.md` dekho; server host ke diye `PORT` par sunta hai |
| Kaam kiske liye | Ek computer wali dukaan (v2 wala pura behavior) | Internet par link se khulega; aage ke stages me mobile/sync isi par banega |

- **Cloud par chalana:** poora step-by-step tareeka **`DEPLOY-GUIDE.md`** me hai (Neon free database + Render free service). Health check `GET /api/health` batata hai app kis mode me hai: `{"mode":"cloud","db":"postgres",...}` ya `{"mode":"local","db":"sqlite",...}`.
- **Demo cloud me:** `DATABASE_URL` set karke `node backend/seed-demo.js` chalao — wahi Sharma General Store demo Postgres me load ho jayega (local `load-demo.bat` local mode ke liye hi hai).
- **Local data cloud par le jana:** `node backend/migrate-to-cloud.js` — local SQLite ka saara data (saari dukaanen, IDs same rakh kar) Postgres me copy karta hai. Cloud me pehle se users hon to ruk jata hai; `--force` par bhi purani rows overwrite nahi hoti.
- **Backup dono mode me:** Local me Settings se database **file** download hoti hai; cloud mode me wahi button tumhare business ke data ki **JSON file** deta hai (cloud me koi local file hoti hi nahi — ye uska sahi barabar hai).
- **Numbers bilkul wahi:** cloud mode me hisaab (GST, profit, stock, udhaar) local mode se **ek paisa bhi alag nahi** — dono engines par ek hi kasauti chalayi gayi hai.

## Kya-kya hai (Features)

- **Dashboard** — aaj ki sale, aaj ka kharcha, aaj ka profit, kul lena hai (udhaar), low-stock alerts, pichhle 7 din ki sale ka chart, taaza bills — ek nazar me poori dukaan.
- **Billing / Invoice** — customer chuno ya Walk-in bill; bill save hote hi stock apne aap kam. Bill ka status khud banta hai: Paid / Partial (udhaar) / Pending. Bill ki saaf print view — browser ke Print se chhapo ya **PDF** save karo.
- **GST tumhare haath me** — Settings me GST **ON/OFF** har business khud chunta hai. Bhaav GST-sahit (MRP style) hain; GST on ho to har bill par "kitna GST shaamil hai" alag se save hota hai (bill banne ke samay ki setting bill par jam/snapshot ho jati hai).
- **Products / Stock** — khareed bhaav, bikri bhaav, GST %, low-stock limit; har product ki haalat: OK / Low / Khatm. Stock sirf purchase aur bill se badalta hai — galti se haath se nahi bigadta.
- **Purchases + Suppliers** — supplier se khareed likhte hi stock badh jata hai; har supplier ka kul khareeda / kul diya / **dena baaki** hamesha saaf.
- **Customers + Udhaar** — har customer ka kul bill, kul mila, baaki udhaar; baad me payment darj karke bill Paid karo. Pending se zyada payment system leta hi nahi.
- **WhatsApp (click-to-send)** — bill aur udhaar reminder WhatsApp par ek tap me: message poora taiyaar (dukaan, bill no., saaman, kul, jama, baaki) business ki language me. Number 10-digit ho, `0` wala ho ya `+91` wala — app khud sahi kar deta hai.
- **Kharcha (Expenses)** — roz ka kharcha category ke saath (Kiraya, Salary, Bijli, Transport, Packing, Khana, Marammat, Anya), Cash/UPI/Bank, mahine ke hisaab se.
- **Reports** — Aaj / Hafta / Mahina / Pichla Mahina / apni dates: Sale, Gross Profit, Kharcha, **Net Profit**, roz ki sale ka chart, category-wise kharcha, aur **Lena hai / Dena hai** ki list. Stock ki keemat (khareed bhaav par) bhi wahin.
- **Monthly Report (SaaS Stage 1)** — Reports screen par mahina chuno: us mahine ki Sale / Kharcha / **Net Profit** aur pichhle 6 mahinon ki side-by-side list. Wahi purana formula: Net = Sale − COGS − Expenses (purchase kharcha nahi hai).
- **GST Report (SaaS Stage 1)** — mahine ke hisaab se: kul sale, taxable value, **CGST/SGST breakup** (GST-sahit bhaavon se wahi purani vidhi se back-calculate: `amount × rate/(100+rate)`), khareed par input GST (saaman ke GST % se gina — purchase par GST snapshot save nahi hota), aur **Net GST Payable**. GST OFF wali dukaan par report saaf likhti hai "GST band hai". Print / PDF view bhi hai. Sirf owner ko dikhti hai.
- **Global Search (SaaS Stage 1)** — upar search box se saaman, customer, supplier aur bill number — ek saath. Result par click seedha usi record/screen par le jata hai. Har user ko sirf apne access wala hissa dikhta hai (billing-only staff ko supplier nahi, stock-only staff ko customer/bill nahi) aur dusri dukaan ka data kabhi nahi.
- **PDF bill ek-click (SaaS Stage 1)** — bill detail aur bill-success par saaf **⬇ PDF Download** button: print view khulta hai, print window me **"Save as PDF"** chuno. Print bill par ab GST ke saath **CGST/SGST** hisaab bhi chhapta hai. (WhatsApp par bill ab bhi sirf text jata hai — PDF auto-attach nahi hota.)
- **Billing me tez search (SaaS Stage 1)** — bill banate samay saaman wale box me type karte hi dropdown filter hota hai (search-as-you-type) — lambi list me scroll nahi karna padta.
- **Owner + Staff access** — staff ko kaam ke hisaab se access (All / Billing only / Stock only). **Profit, kharcha aur reports sirf owner ko** — staff ko server se hi band hai, sirf button nahi chhupaya. Ek business ka data dusre business ko kabhi nahi dikhta.
- **Language** — English / हिंदी, Settings se kabhi bhi badlo. WhatsApp message bhi usi language me banta hai.
- **Poora offline (local mode)** — app internet par koi call hi nahi karta: koi CDN nahi, koi font download nahi, koi tracking nahi. Ek hi cheez "bahar" jati hai — WhatsApp button dabane par browser me wa.me link khulta hai, woh bhi tumhare dabane par.
- **Data Backup** — Settings (sirf owner) se ek click me poori database download: `business-os-backup-YYYYMMDD.db`.
- Signup/Login password encrypted (bcrypt) ke saath; server band ho jaye to app saaf banner me batata hai ki kya check karna hai.

## Profit ka formula (saaf-saaf)

`Net Profit = Sale − bika hua maal ki laagat (COGS) − Expenses`

- **Sale** = bills ka kul (discount ke baad wala total).
- **COGS** = bikey hue maal ki khareed-laagat (bill banne ke samay ki buy price).
- **Maal ki khareed (purchase) kharcha NAHI hai** — woh stock banta hai; sirf **bika** hua maal profit me ginta hai.
- Profit negative ho to **negative hi dikhega** — chhupaya ya ghumaya nahi jayega.

## Data kahan rehta hai + Backup / Restore

**Local mode:** data ek hi file me rehta hai: `backend/data/business-os.db` — isi computer par.
**Cloud mode:** data tumhare PostgreSQL (Neon) me rehta hai — provider khud uska backup rakhta hai.

- **Backup:** Settings → **Data Backup** (sirf owner) — local me poori database **file** download hoti hai; cloud mode me tumhare business ke data ki **JSON file** milti hai. **Apna data time-time par download karke safe rakhein** — pen-drive ya apne email me.
- **Auto-backup snapshots (SaaS Stage 3):** app har roz apne aap ek snapshot banata hai (dono mode me, server-side `backup_snapshots` table me; aakhri 7 auto rehte hain) — Settings → Data Backup me list, **Backup now**, kisi bhi snapshot ki download aur **one-click Restore**. Restore se pehle current data ka `pre-restore` snapshot apne aap banta hai, isliye restore bhi ulta ho sakta hai. Restore sirf usi dukaan ka operational data (bill/stock/customer/kharcha/subscription) badalta hai — **staff ke login aur sessions restore nahi hote**.
- **Restore (local, purana rasta):** app band karo, backup file ko `backend/data/business-os.db` naam se rakh do, app phir chalao — saara data wapas.
- **Saaf shuruaat (local):** app band karke `backend/data/business-os.db` delete kar do — agli baar chalane par nayi khali file ban jayegi.

## Abhi kya NAHI hai (imaandari se)

- **Pricing abhi tay nahi hai** — pehle product pura banaya hai, price baad me decide hoga.
- **Mobile app nahi hai** — app computer/laptop ke browser ke liye hai.
- **Bill printing (thermal/direct print) nahi hai** — bill ka print/PDF browser ke Print se banta hai.
- **WhatsApp auto-send / auto PDF attach nahi hai** — wa.me link sirf text message bhejta hai; PDF Print se banakar usi chat me haath se attach karna hota hai. Auto-send wala official WhatsApp Business API (paid) aage ka add-on hai. Abhi wala click-to-send bilkul free hai.
- **Mobile PWA abhi nahi hai** — local ↔ cloud sync SaaS Stage 3 me aa gaya hai (neeche dekho), lekin phone wala PWA layout aage ke stage ka kaam hai. Sync band (env na) ho to local mode me koi data apne aap kahin upload nahi hota.
- **Email OTP ka live mail SMTP config par hai** — `MAIL_*` env set hue bina OTP email NAHI jata (dev mode: code sirf server log me `[DEV-MAIL]` line me dikhta hai, API kabhi OTP return nahi karti).
- **Razorpay live payment founder ki keys par hai** — `RAZORPAY_KEY_*` env bina gateway band hai (endpoint 501 `gateway_not_configured`); tab tak UPI/manual claim + DILIGENCE admin approval se subscription chalta hai.
- **Service-business module** (salon/clinic/repair type ke appointment/order wale kaam) — Phase 2. Ye version dukaan/product wale business ke liye hai.

## Version notes

- **Stage 1** — Neenv: login/signup, business setup (GST + language), SQLite data layer, owner/staff roles.
- **Stage 2** — Stock flow: products/inventory, purchases, suppliers, low-stock alerts.
- **Stage 3** — Paise ka flow: billing (GST on/off), customers, payments/udhaar, bill print/PDF.
- **Stage 4** — Hisaab: expenses, reports (profit/loss), owner-only finance, pura dashboard.
- **Stage 5** — WhatsApp click-to-send: bill message + udhaar reminder.
- **Stage 6** — Offline kasauti (pura flow test), staff-access audit, data backup, polish.
- **Stage 7** — Sell-ready pack: demo dukaan data (`load-demo.bat`), DEMO-GUIDE, final README.
- **v3 Stage A** — Cloud Backend: ek hi app do mode me — local (SQLite) ya cloud (PostgreSQL, `DATABASE_URL` se); cloud deploy (Render + Neon) guide, cloud JSON backup, local→cloud migration tool. Numbers dono engines par kasauti kiye hue ek barabar.
- **SaaS Stage 1 (Kaam wala hisa)** — GST report (`GET /api/reports/gst?month=YYYY-MM`, owner-only), monthly reports (`GET /api/reports/monthly?month=YYYY-MM`, owner-only, pichhle 6 mahine ke saath), global search (`GET /api/search?q=`, role-wise sections, sirf apni dukaan), bill par ek-click **PDF Download** button + print bill par CGST/SGST, aur billing ke product picker me search-as-you-type. Koi nayi table nahi — saara hisaab maujooda data aur maujooda GST/profit formula se hi banta hai, isliye demo ke canonical numbers (aaj ki sale ₹1,128 · lena ₹1,620 · dena ₹2,300 · stock ₹22,051 · aaj ka profit +₹30) bilkul nahi badle.
- **SaaS Stage 2 (SaaS wala hisa)** — Bechne ka system:
  - **Email OTP signup** — signup par account PENDING banta hai; 6-digit email OTP (10 min expiry, max 5 attempts, 60-sec resend cooldown, code hashed) verify hue bina login nahi hota aur trial shuru nahi hota (`POST /api/auth/signup` → `/api/auth/verify-otp` → `/api/auth/resend-otp`). **Forgot password** bhi isi OTP se (`/api/auth/forgot-password` → `/api/auth/reset-password`, purane sessions band). Mail `MAIL_*` env (SMTP) se — config bina dev mode (code sirf server log me, API response me sirf `mail_configured:false` flag, OTP kabhi response me nahi).
  - **Trial + subscription** — verify hote hi **14-din free trial** (bina card). Plans: monthly/yearly (`plans` table) — **price admin-configurable hai, seed price 0 = "set nahi"; founder ne pricing abhi tay nahi ki, kuch hard-code nahi**. State: trial → active → grace (7 din, plan se) → expired par **read-only** (GET sab chalega, naya data POST/PUT/DELETE par `403 subscription_expired`). Purani dukaanon (demo samet) ko migration par trial usi din se mila — koi lockout nahi.
  - **Payment** — UPI/manual claim (owner reference deta hai → DILIGENCE admin approve → period badhta hai + `SUB-YYYY-NNNN` invoice, printable) + **Razorpay-ready** order/verify endpoints (HMAC signature check samet) jo keys bina `501 gateway_not_configured` dete hain — nakli success kahin nahi.
  - **DILIGENCE Super Admin** — `SUPER_ADMIN_EMAIL/PASSWORD` env se seeded alag admin (business users se alag `platform_admins` table; login page se hi login), admin panel: saari dukaanon ki list + status/plan/expiry, kul subscription revenue, pending claims approve/reject, dukaan extend/block, plan prices, support WhatsApp number (Stage 3 ke liye setting). Admin ko dukaanon ka operational data (bill/product/graahak) NAHI dikhta — sirf metadata.
  - **5-minute onboarding** — naye owner ke dashboard par 3-step checklist (dukaan details → pehla product → pehla bill; steps asli data se bante hain, dismiss ho sakta hai). Purani/demo dukaanon ko checklist nahi satata.
  - Renewal reminder in-app banner (7/3/1 din + grace/expired par) — WhatsApp/email auto-reminder NAHI hai.
- **SaaS Stage 3 (Bharosa wala hisa)** — Data, sync aur support:
  - **Auto-backup + restore** — roz server-side snapshot (retention: aakhri 7 auto) dono engines me; owner Settings se list/download/**restore**; restore se pehle current data ka apne-aap `pre-restore` snapshot; restore sirf apni dukaan ka data badalta hai, doosri dukaan ka snapshot 404, staff ko 403, kharab payload 400. Purana `GET /api/backup` download waisa hi hai.
  - **Excel/CSV export** — `GET /api/export/{products,customers,suppliers,sales,expenses,purchases}` (text/csv download, Excel-ready: BOM + quoting + plain-number rakam). Sales/Expenses/Purchases owner-only; baaki teen unhi rules par jo unke GET screens par hain. Buttons Products/Customers/Suppliers screens par aur Reports screen par hain.
  - **Sync engine (Stage B plan)** — local instance cloud (hub) instance se HTTP par sync karta hai: hub bhi yahi app hai (`POST /api/sync/push`, `GET /api/sync/pull`). Shop side `SYNC_HUB_URL` + dukaan ke apne hub account (`SYNC_HUB_EMAIL/PASSWORD`) se har sync par login karke token leta hai. Row ki pehchan `sync_ids` table me uuid se hoti hai (existing tables par koi ALTER nahi). Bills/payments/purchases/stock-movements **append-only** (uuid se dedupe); master data (product/customer/supplier/kharcha/business settings) **last-write-wins** — har takraav `sync_conflicts` me owner ke liye दर्ज (`GET /api/sync/conflicts`). **Stock number kabhi sync nahi hota** — sirf movements jate hain, dono taraf stock unhi se dobara banta hai. Offline bill ka number provisional rehta hai; hub par number takraye to hub **final number** deta hai aur shop apna bill usi number par kar leta hai (bill par "Pending sync" badge jab tak sync na ho). Sync boot par, har ~2 minute, bill/payment ke baad (best-effort) aur **Sync now** button se chalta hai; hub band ho to billing chalti rehti hai aur status saaf "offline" dikhata hai. Subscription expired (read-only) dukaan bhi sync aur restore kar sakti hai — ye raste jaan-boojh kar guard se bahar rakhe hain, warna purana data band dukaan me hi phans jata.
  - **Audit / History** — `audit_log` table: bill, payment, product, customer, supplier, purchase, kharcha, staff, subscription claim aur restore — kis user ne kab kya kiya, owner-only **History** screen (`GET /api/audit`).
  - **Help center** — **Help** screen: Hindi step-by-step guides (bill, udhaar reminder, backup/restore, subscription renew, stock/purchase), WhatsApp support button (super admin ke set kiye number par; number na ho to button gayab — koi number invent nahi hota) aur help-video link slot (`help_video_url` admin setting; khali ho to gayab).
  - **Imaandaari wali limits:** sync ki kasauti local SQLite par do instances chala kar ki gayi hai; **Postgres mode me Stage 3 ka code is stage me execute nahi hua** (saari SQL Stage 1/2 wale translator-safe patterns par hai, aur schema sirf CREATE TABLE IF NOT EXISTS hai). Hub par dukaan ka account pehle banana padta hai (signup + OTP verify hub par) — shop instance usi account se judta hai; do alag dukaanon ke beech sync jaan-boojh kar nahi hota (har instance apne business ka hi data bhejta/pata hai). Restore ke baad sync uuid mappings saaf ho jate hain — pehle se hub par gaya data dobara push ho sakta hai (append-only dedupe uuid se hota hai, isliye restore ke baad pehla sync dhyaan se, hub par duplicate ki jaanch ke saath karna chahiye).
