# Business OS v2 — Demo Guide (10 minute me customer ko dikhao)

by DILIGENCE · Ye guide founder ke liye hai: kis order me kya dikhana hai, aur kahan kya bolna hai.

---

## Pehle: Demo data load karo (sirf 1 baar, 2 minute)

1. Agar app (server wali kaali window) chal raha hai to use **band** kar do.
2. **`load-demo.bat`** par double-click karo. Ek dukaan ka ready data load ho jayega — **Sharma General Store**.
   - Dobara chalane par kuch nahi bigdega — "Demo pehle se hai" bolke ruk jayega.
   - Tumhara asli data ho to wo bilkul safe rahega — demo ek **alag business** bankar load hota hai, asli data ko haath nahi lagta.
3. **`start-business-os.bat`** chalao, browser me http://localhost:4000 khulega.

### Demo logins

| Login | Email | Password | Kya dikhega |
|---|---|---|---|
| **Owner** | `demo@businessos.app` | `demo1234` | Sab kuch — sale, kharcha, **profit** |
| **Staff (Billing)** | `counter@businessos.app` | `staff1234` | Sirf billing/customers — **profit gayab** |

Dukaan me pehle se hai: 8 products, 2 suppliers, 4 customers, pichhle 7 din ke 9 bills, is mahine ke kharche.
Aaj ki sale **₹1,128** (3 bills) dikhegi. Kul udhaar **₹1,620** baaki hai — sabse bada Ramesh Gupta ka **₹1,470**.

---

## Demo ka order (isi sequence me dikhao)

### 1. Dashboard — "ek nazar me poori dukaan" (1 min)
Login (owner) karke Dashboard dikhao: aaj ki sale, aaj ka kharcha, aaj ka profit, lena hai (udhaar) — sab ek screen par.
Neeche **low-stock alert** dikhao: *Chai Patti sirf 3 bacha hai, Surf Excel khatm ho gaya.*
Bolna: **"Subah dukaan kholte hi ye ek screen — kal kya hua, aaj kya haal hai, sab saaf."**

### 2. LIVE bill banao — 30 second wala moment (2 min)
Billing me jao → customer chuno (Ramesh Gupta) → 1–2 saaman add karo → paisa likho → Save.
Stock khud kam ho jayega — Products me jaakar dikha do.
Bolna: **"Bill bana, stock apne aap kam. Koi alag register nahi, koi double entry nahi."**
GST on hai (demo dukaan me), isliye bill par "GST included" khud dikhega. Settings me GST band karne par bill bina GST ka banta hai — har dukaan apne hisaab se.

### 3. WhatsApp par bill (1 min)
Bill bante hi **"💬 WhatsApp par bill bhejo"** button dabao — WhatsApp khulega, poora bill message me taiyaar milega, bas Send dabana hai.
Bolna (imaandari wali line): **"Bill WhatsApp par seedha text message ki tarah jata hai — customer ke phone par turant khulta hai. PDF chahiye to bill ke Print button se PDF banakar usi chat me attach kar sakte ho. Kuch bhi khud-se auto-send nahi hota — bhejna tumhare haath me hai."**

### 4. Udhaar + Reminder — Khatabook wala dard, khatm (1 min)
Dashboard ya Customers me **Ramesh Gupta** dikhao — ₹1,470 baaki. **Remind** button dabao — WhatsApp par vinamr reminder taiyaar: kul baaki + bill-wise hisaab.
Bolna: **"Udhaar likhna bhi apne aap, yaad dilana bhi ek tap. Paisa pura mil jaye to reminder khud band ho jata hai — galti se nahi jayega."**

### 5. Stock / Purchase + Low-stock alert (1 min)
Products screen: har saaman ka stock, OK / Low / Khatm status. Purchases me dikhao — supplier se khareed likhte hi stock badhta hai, aur supplier ko kitna diya/kitna baaki (Fresh Supply Co ko **₹2,300** dena baaki hai) khud hisaab rehta hai.
Bolna: **"Maal aaya, entry ki, stock badh gaya. Khatm hone se pehle app khud chetawni deta hai — dukaan kabhi khali nahi milegi."**

### 6. Kharcha (30 sec)
Expenses screen: kiraya ₹8,000, salary ₹12,000, bijli ₹1,450 — category ke saath poora mahine ka kharcha.
Bolna: **"Jo kharcha likha, wahi profit me se katega. Kuch chhupa nahi, kuch andaza nahi."**

### 7. Profit Report — OWNER MOMENT (1.5 min)
Reports kholo → This Month: **Sale − bika hua maal ki laagat − kharcha = Net Profit**, roz ki sale ka chart, Lena hai / Dena hai ki list.
Bolna: **"Ye wo number hai jo koi register nahi deta — asal me kitna kamaya. Ek sach ye bhi: demo me poori salary aur kiraya is mahine ke kharche me hai, isliye net abhi negative dikh sakta hai. App ghata ko bhi ghata hi dikhata hai, ghuma ke profit nahi banata — hisaab imaandaar hai. Aur dhyaan do: maal ki KHARID kharcha nahi gini — sirf BIKA hua maal profit me kat-ta hai."**

### 8. Staff login — STAFF MOMENT (1 min)
Logout karke **staff login** (`counter@businessos.app / staff1234`) karo. Wahi dukaan, lekin: profit wala hissa **gayab**, kharcha/reports band, sirf billing aur customers.
Bolna: **"Counter wala ladka bill banayega, lekin tumhara munafa kabhi nahi dekhega. Ye setting nahi, server par band hai — chahe to bhi nahi khulega."**

### 9. Backup — data ki suraksha (30 sec)
Owner login → Settings → **Data Backup** download dabao. Poori dukaan ka data ek file me aa jayega.
Bolna: **"Data tumhare computer par rehta hai, aur backup bhi tumhare paas. Computer kharab ho jaye to isi file se sab wapas."**

### 10. Offline wali baat — aakhri dhakka (30 sec)
Ho sake to asal me karke dikhao: **internet band karo (Wi-Fi off), phir ek bill banao** — bill banega, sab chalega.
Bolna: **"Ye app poora tumhare computer par chalta hai. Internet jaye ya aaye, dukaan nahi rukti. Koi cloud nahi, isliye koi monthly server wala jhanjhat bhi nahi."**

---

## Imaandari wali lines (customer se yahi bolna hai)

- **WhatsApp:** "Bill text message ki tarah jata hai, ek tap me. **PDF khud-se attach nahi hota** — Print se PDF banakar chat me lagana hota hai. Auto-send wala official WhatsApp API paid hota hai — wo baad ka add-on hai, jab chahiye hoga tab."
- **Printing:** "Bill ki print abhi browser ke Print se hoti hai (PDF bhi wahin se banta hai). Thermal printer wala direct print abhi nahi hai."
- **Mobile app:** "Abhi app computer/laptop ke liye hai. Mobile app baad ke plan me hai."
- **Cloud/sync:** "Data ek hi computer par rehta hai — dusre device se dekhna ya cloud sync is version me nahi hai (Phase 2)."
- **Pricing:** **"Price abhi decide nahi hua hai — pehle product pura banaya hai, price uske baad tay hoga."** Koi number mat bolo, koi vaada mat karo.
- **Service business** (salon/clinic/repair — appointment/order wale): "Unke liye alag module Phase 2 me aayega. Ye version dukaan/product wale business ke liye perfect hai."

## Demo ke baad

- Customer ka apna data daalna ho to: naya **Signup** karo — uski dukaan bilkul alag banegi, demo dukaan se koi lena-dena nahi.
- Demo data dobara fresh karna ho to: app band karke `backend/data/business-os.db` file delete karo, phir `load-demo.bat` chalao — saaf demo wapas.
