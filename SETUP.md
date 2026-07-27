# Lot Ledger — Setup Guide

Two parts: (1) connect a Google Sheet as your database, (2) put the app online so you can install it on your phone. Both are free. Takes about 10 minutes.

---

## Part 1 — Connect Google Sheets (5 min)

1. Go to [sheets.google.com](https://sheets.google.com) and create a **new blank spreadsheet**. Name it something like `Parking Rent Ledger`.
2. In the sheet, click **Extensions → Apps Script**.
3. Delete any code in the editor and paste in the entire contents of `Code.gs` (included in your download).
4. Near the top of the script, change this line to your own secret password:
   ```js
   var API_KEY = "CHANGE-THIS-SECRET-KEY";
   ```
   Pick anything memorable, e.g. `"kannan-parking-2026"`. You'll enter this same key inside the app later.
5. In the function dropdown at the top of the Apps Script editor, choose **setup**, then click **Run** (▶). The first time, Google will ask you to authorize the script — click through **Advanced → Go to (project name) → Allow**. This creates three sheets for you: `Properties`, `Tenants`, `Payments`.
6. Click **Deploy → New deployment**.
   - Click the gear icon next to "Select type" and choose **Web app**.
   - Description: anything, e.g. "Lot Ledger API".
   - Execute as: **Me**.
   - Who has access: **Anyone**. (Don't worry — without your secret key from step 4, nobody can read or write your data.)
   - Click **Deploy**.
7. Copy the **Web app URL** it gives you (looks like `https://script.google.com/macros/s/AKfycb.../exec`). You'll paste this into the app's Settings screen.

That's it — your Google Sheet is now a live database.

> **Updating the script later:** if you ever edit `Code.gs` again, use **Deploy → Manage deployments → Edit (pencil) → New version → Deploy** so your changes go live.

---

## Part 2 — Put the app online

The app is a set of static files (`index.html`, `style.css`, `app.js`, etc.) — it needs to be hosted somewhere so your phone can open it and you can "Add to Home Screen." The easiest free option:

### Option A: GitHub Pages (recommended, free, your own URL)
1. Create a free account at [github.com](https://github.com) if you don't have one.
2. Create a new repository (e.g. `lot-ledger`), and upload **all the files** from this download (keeping the `icons` folder as a folder).
3. Go to the repo's **Settings → Pages**, set Source to `main` branch / root, and save.
4. After a minute, GitHub gives you a URL like `https://yourname.github.io/lot-ledger/`. Open it on your phone.

### Option B: Netlify Drop (fastest, no account needed for a quick test)
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag the whole project folder onto the page.
3. You'll instantly get a live URL you can open on your phone.
   (Create a free account if you want the URL to stay online long-term.)

---

## Part 3 — Install it like an app on your phone

1. Open your app's URL in **Chrome (Android)** or **Safari (iPhone)**.
2. Go to **Settings** (gear icon, top right) inside the app and paste in:
   - Your Apps Script **Web app URL** from Part 1, step 7
   - Your **API key** from Part 1, step 4
   - Your business name & phone (shown on receipts)
3. Tap **Save & connect** — you should see "Connected — live data."
4. Now install it:
   - **Android/Chrome:** tap the ⋮ menu → **Add to Home screen**.
   - **iPhone/Safari:** tap the Share icon → **Add to Home Screen**.
5. It now opens full-screen like a native app, with its own icon.

---

## Using the app

- **Add a lot** first (e.g. "Anna Nagar Car Park"), then **add tenants** under each lot with their monthly rent and start date.
- The app automatically works out what each tenant owes — rent accumulates month by month from their start date, and every payment (full or partial) reduces the balance. Missed months simply carry forward, exactly like your Excel sheet.
- Tap any tenant to see their full payment history, record a new payment, or **share a balance statement** image reminding them what's due.
- After saving a payment, a receipt image is generated automatically — tap **Share** to send it straight to WhatsApp, or **Download** to save it.
- Everything is stored in your Google Sheet, so you can always open the sheet directly to double check or export data.

## Troubleshooting

- **"Couldn't reach the sheet"** — double check the Web app URL and API key in Settings match exactly what's in `Code.gs`, and that the deployment's access is set to "Anyone."
- **Changes in the sheet aren't showing** — tap Settings → **Refresh from Google Sheet**.
- **Icon/install option missing** — the site must be opened over `https://` (both GitHub Pages and Netlify give you this automatically).
