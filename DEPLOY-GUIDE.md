# Business OS v3 — Cloud Deploy Guide (Render + Neon, free tier)

App ko internet par dalne ke exact steps. Do cheezen chahiye:
**Neon** (cloud database — data wahan rahega) aur **Render** (app/server wahan chalega).
Dono ke **free plan** se shuruaat hogi. Kul time: lagbhag 15–20 minute.

> Sabse pehle ye samjho: **data Neon (Postgres) me rehta hai, Render ke server me nahi.**
> Isliye Render par redeploy/restart ho jaye to bhi **data reset NAHI hota** —
> v1 ke samay wali "SQLite Render par ud jata hai" wali dikkat yahan khatm hai.

---

## Step 0 — Code GitHub par

App ka code (ye poora folder) ek GitHub repo me hona chahiye — Render wahi se
code uthata hai. Apne tareeke se push karo (`git init`, commit, push), jaise
CareCompass ke samay kiya tha.

## Step 1 — Neon par database banao (5 minute)

1. https://neon.tech par jao → Sign up (Google/GitHub se ho jayega).
2. **New Project** → naam do: `business-os` → Region sabse paas wala chuno
   (Singapore chalega) → **Create Project**.
3. Project khulte hi **Connection String** dikhega. **Pooled connection**
   wali string copy karo — kuch aisi dikhegi:
   `postgres://user:pass@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/dbname?sslmode=require`
4. Is string ko safe rakho — yehi `DATABASE_URL` hai. **Kisi ko bhejna mat,
   GitHub par commit mat karna.**

## Step 2 — Render par app lagao (10 minute)

1. https://render.com par jao → Sign up/Login (GitHub se).
2. **New +** → do me se ek rasta:
   - **Blueprint** (easy): apna repo select karo — repo me `render.yaml`
     pehle se hai, Render settings khud utha lega.
   - **Web Service** (haath se): repo select karke ye settings bharo —
     **Root Directory:** `backend` · **Build Command:** `npm install` ·
     **Start Command:** `node server.js` · **Instance Type:** Free.
3. **Environment Variables** me ek variable dalo:
   - Key: `DATABASE_URL` · Value: Step 1 wali Neon string (poori, `?sslmode=require` ke saath).
4. **Create / Deploy** dabao. Pehli build me 2–4 minute lag sakte hain.

## Step 3 — Check karo sab chala

1. Render jo URL de (jaise `https://business-os-v3.onrender.com`) use kholo —
   Business OS ka login page aana chahiye.
2. URL ke aakhir me `/api/health` jodo — ye dikhna chahiye:
   `{"ok":true,"mode":"cloud","db":"postgres","stage":"A","app":"Business OS v3"}`
   `mode:"cloud"` + `db:"postgres"` dikha matlab cloud setup sahi hai.

## Step 4 — Demo data cloud par load karo

Cloud database me "Sharma General Store" demo dalna ho to **apne computer se**
ek baar ye chalao (Render ke free plan me Shell nahi milta, isliye yahi rasta hai):

Windows **PowerShell** me, `backend` folder ke andar:
```
$env:DATABASE_URL="postgres://...neon wali poori string..."
node seed-demo.js
```
Windows **CMD** me:
```
set DATABASE_URL=postgres://...neon wali poori string...
node seed-demo.js
```
Phir deployed URL par **demo@businessos.app / demo1234** se login karke dekho.
Seed dobara chalane se duplicate nahi banta ("Demo pehle se hai" aayega).

## Step 5 — Purana local data cloud par le jana (jab chaahe)

Kisi dukaan ka v2/local data cloud par uthana ho to:
```
$env:DATABASE_URL="postgres://...neon wali string..."
node migrate-to-cloud.js
```
Ye `backend/data/business-os.db` ka **saara** data (saari dukaanen, IDs same
rakh kar) Postgres me copy kar dega. Cloud me pehle se users hain to ye
**ruk jayega** (galti se overwrite na ho) — pakka ho to aakhir me `--force`
jodo; force me bhi purani rows overwrite nahi hoti, sirf nayi judti hain.

---

## Free tier ki sachai (pehle se jaan lo)

- **Render Free** web service ~15 minute khali rehne par **so jata hai**
  (spin down). Agli baar kholne par jagta hai — pehle khulne me
  **30–50 second** lag sakte hain. Ye band hona nahi hai, aur **data ko
  kuch nahi hota** (data Neon me hai).
- **Neon Free** database bhi khali rehne par **scale-to-zero** (so) jata hai;
  pehli query par kuch seconds me jag jata hai. Data wahan safe rehta hai.
- Dono free plans ki seemaen badal sakti hain — paying customer aane par
  pehle Render ka chhota paid plan (~$7/mo) lena sabse samajhdari hai,
  taaki app soye hi nahi.

## Local mode kabhi bhi

`DATABASE_URL` na set ho to wahi app **bilkul v2 ki tarah** isi computer par
(SQLite file me) chalta hai — `start-business-os.bat` double-click. Cloud aur
local dono mode ek hi code se chalte hain; chunav sirf is ek setting ka hai.

---

## Split deploy — Frontend Vercel par, Backend Render par (+ apna domain)

Upar wala tareeka (sab kuch Render par) sabse simple hai aur woh **ab bhi
bilkul waisa hi chalta hai**. Ye split wala rasta tab lo jab frontend ko
Vercel ki speed/CDN chahiye ya apna domain is hisaab se lagana hai:
**`app.<domain>`** → frontend (Vercel) · **`api.<domain>`** → backend (Render).
Data hamesha ki tarah Neon (Postgres) me hi rahega.

Dhyaan do: split mode me browser frontend wale domain se backend wale domain
ko call karta hai — isiliye do setting zaroori hain, dono neeche di hain:
backend par `ALLOWED_ORIGINS` (kaunsi website ko jawab mile) aur frontend ki
`config.js` me `BOS_API_BASE` (backend kahan hai). Ek bhi galat ho to login
nahi chalega.

### Step 1 — Backend Render par (API only mode)

1. Upar wale Step 0–2 ki tarah Render par Web Service banao —
   **Root Directory:** `backend` · **Build Command:** `npm install` ·
   **Start Command:** `node server.js` · **Instance Type:** Free.
2. **Environment Variables** me ye dalo:
   - `DATABASE_URL` — Neon wali poori string (upar Step 1 wali).
   - `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` — apna DILIGENCE admin
     login (yehi admin panel kholenge). Password strong rakho, kahin
     likh/commit mat karna.
   - `ALLOWED_ORIGINS` — `https://app.<tumhara-domain>` (sirf frontend
     wala origin; comma se alag karke aur bhi jod sakte ho). **Ye na dala
     to backend har origin ko jawab de dega** — local testing ke liye
     theek hai, production me hamesha set karo.
3. Deploy ke baad Render ka URL note karo (jaise
   `https://business-os-v3.onrender.com`) aur `…/api/health` kholkar
   `mode:"cloud"` check kar lo. Demo chahiye to upar wala Step 4 wala
   seed apne computer se chalao — wahi chalega.

### Step 2 — Frontend Vercel par

1. https://vercel.com par jao → **Add New → Project** → apna GitHub repo
   select karo.
2. **Root Directory:** `frontend` select karo. **Framework Preset:** Other ·
   **Build Command:** khali chhodo (koi build nahi hai) · **Output
   Directory:** khali chhodo (frontend folder hi site hai).
3. Deploy se **pehle** repo me `frontend/config.js` kholo aur backend ka
   URL dalo:
   ```js
   window.BOS_API_BASE = 'https://business-os-v3.onrender.com';
   ```
   (aakhir me `/` ho ya na ho, dono chalega.) Phir commit/push karke
   deploy karo — ya pehle deploy karke baad me ye file badal kar redeploy.
4. Vercel jo URL de use kholo — login page aayega aur login bhi chalega,
   kyunki saari API calls ab Render wale backend par jati hain.

### Step 3 — Apna domain lagao

1. **Frontend:** Vercel project → **Settings → Domains** → `app.<domain>`
   add karo. Vercel ek **CNAME** record dega — apne domain ke DNS me
   `app` → woh CNAME dalo.
2. **Backend:** Render service → **Settings → Custom Domains** →
   `api.<domain>` add karo. Render bhi ek **CNAME** dega — DNS me `api` →
   woh CNAME dalo. (Free plan par custom domain ki seema ho sakti hai —
   Render ke current plan rules check kar lena; na mile to paid plan ya
   sirf `*.onrender.com` URL hi chalega, app phir bhi chalegi.)
3. Domain active ho jaye (DNS + certificate, kuch minute) to **do jagah
   URL update** karo:
   - `frontend/config.js` → `window.BOS_API_BASE = 'https://api.<domain>';`
     phir Vercel par **redeploy** (config.js static file hai, redeploy
     bina purani file hi serve hogi — isiliye `vercel.json` me is file par
     no-cache header pehle se laga hai).
   - Render env → `ALLOWED_ORIGINS` = `https://app.<domain>` (purana
     vercel.app wala origin bhi rakhna ho to comma se jod do), phir
     backend **redeploy/restart**.
4. `https://app.<domain>` kholo, login karke bill bana kar dekho — sab
   waisa hi chalega, bas ab tumhare domain par.

### Split mode ki sachai

- **Render Free so jata hai** (~15 min khali rehne par): frontend Vercel
  par hamesha jagti rahegi, par pehli API call par backend jagta hai —
  **30–50 second** lag sakte hain. App is dauraan "server se connection
  nahi ho raha" wala banner dikha sakti hai; thoda ruk kar retry karne
  par sab chal jata hai. Data ko kuch nahi hota (Neon me hai).
- Domain/plan ke niyam Vercel aur Render samay ke saath badalte hain —
  koi step atke to unke dashboard ke current instructions hi final hain.
- **Single-service deploy** (sab kuch Render par, is guide ke upar wale
  steps) isse bilkul prabhavit nahi hota: `config.js` khali (`''`) rakho
  aur `ALLOWED_ORIGINS` set hi mat karo — app pehle ki tarah ek hi jagah
  se chalegi.
