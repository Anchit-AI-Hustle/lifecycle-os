# Competitor Intelligence Hub

Automated competitor-email benchmarking. A Vercel Cron job reads an inbox over
IMAP, extracts structured data + assets, stores everything in **Google Sheets**
(database) and **Google Drive** (screenshots/attachments), and serves a premium
**Next.js dashboard** with fuzzy search, multi-filters, sorting, and a detail
slide-over.

```
IMAP inbox ──▶ /api/sync-emails (cron) ──▶ Google Drive (assets + screenshots)
                                      └──▶ Google Sheet (one row per email)
                                                   │
                          /dashboard ◀── /api/emails (reads the sheet)
```

## Tech stack
- **Next.js 14 (App Router, TypeScript)** on Vercel
- **Tailwind CSS + shadcn/ui + lucide-react** for UI
- **@tanstack/react-table** + **SWR** for the data grid
- **imapflow + mailparser** for email ingestion
- **googleapis** (Sheets v4 + Drive v3) for storage
- **HCTI / URLBox** for HTML→image screenshots

## Project structure
```
competitor-intelligence-hub/
├── app/
│   ├── layout.tsx                  # Root layout
│   ├── page.tsx                    # Redirects / → /dashboard
│   ├── globals.css                 # Tailwind + shadcn theme tokens
│   ├── dashboard/
│   │   └── page.tsx                # Server Component dashboard (stats + table)
│   └── api/
│       ├── sync-emails/route.ts    # PART 1 — cron automation engine
│       └── emails/route.ts         # Read endpoint for SWR refresh
├── components/
│   ├── email-table.tsx             # TanStack table + filters + search
│   ├── columns.tsx                 # Column definitions
│   ├── email-detail-sheet.tsx      # Slide-over detail view
│   └── ui/                         # shadcn primitives (button, sheet, table…)
├── lib/
│   ├── google-client.ts            # Sheets + Drive helpers (service account)
│   ├── imap.ts                     # imapflow fetch + mailparser
│   ├── screenshot.ts               # HCTI/URLBox render → buffer
│   ├── extract.ts                  # brand/promo/body text extraction
│   ├── types.ts                    # CompetitorEmail + sheet column contract
│   └── utils.ts                    # cn(), Drive URL + date helpers
├── .env.example                    # All required env vars
├── vercel.json                     # Cron schedule + function maxDuration
└── package.json
```

---

## Setup — step by step

### 1. Install & run locally
```bash
cd competitor-intelligence-hub
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev                  # http://localhost:3000 → /dashboard
```

### 2. Create the Google Sheet (the database)
1. Create a blank Google Sheet named **`Competitive Mails Reader`**.
2. Rename the bottom tab to **`Emails`** (or set `GOOGLE_SHEET_TAB` to match).
3. Copy the **Sheet ID** from the URL and put it in `GOOGLE_SHEET_ID`:
   `https://docs.google.com/spreadsheets/d/`**`THIS_LONG_ID`**`/edit`
4. You don't need to add headers — the sync job writes the header row on first run.

### 3. Google Cloud Console — service account
1. Go to <https://console.cloud.google.com/> → create (or pick) a project.
2. **APIs & Services → Library** → enable **Google Sheets API** and **Google Drive API**.
3. **APIs & Services → Credentials → Create Credentials → Service account**.
   Give it a name (e.g. `intel-hub-bot`), create, and skip the optional grants.
4. Open the new service account → **Keys → Add key → Create new key → JSON**.
   A `.json` file downloads. From it you need:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key`  → `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
5. **Share access with the service account** (this is the step everyone forgets):
   - Open the Google **Sheet** → **Share** → paste the `client_email` → role **Editor**.
   - Create a Drive folder named **`Competitor_Benchmarking_Hub`**, **Share** it with the
     same `client_email` as **Editor**. Optionally copy its folder ID into
     `GOOGLE_DRIVE_ROOT_FOLDER_ID` (otherwise the app finds/creates it by name).

> The `private_key` contains real newlines. When pasting into `.env.local`, wrap it
> in double quotes and keep the `\n` escapes, e.g.
> `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"`.
> The code normalizes `\n` → real newlines automatically.

### 4. Gmail App Password (for the monitored inbox)
1. Sign in to **ojhapraneet@gmail.com**.
2. **Google Account → Security → 2-Step Verification** → turn it **ON**.
3. Go to <https://myaccount.google.com/apppasswords>.
4. App = **Other (custom name)** → name it `Vercel Email Hub` → **Generate**.
5. Copy the 16-character password into `GMAIL_IMAP_PASSWORD` (remove spaces).
   Set `GMAIL_IMAP_USER=ojhapraneet@gmail.com`.
   IMAP is enabled by default on Gmail; no extra toggle needed.

### 5. Screenshot provider (HCTI — recommended)
1. Sign up at <https://htmlcsstoimage.com/> (free tier available).
2. Copy your **User ID** and **API Key** into `HCTI_USER_ID` / `HCTI_API_KEY`.
3. Keep `SCREENSHOT_PROVIDER=hcti`. (To use URLBox instead, set it to `urlbox`
   and fill `URLBOX_API_KEY` / `URLBOX_API_SECRET`.)

If screenshots are not configured or a render fails, the row is still written with
`Failed` in the Screenshot column — nothing breaks.

### 6. Cron secret
Generate a random secret and set `CRON_SECRET`:
```bash
openssl rand -hex 32
```
Vercel Cron automatically sends it as `Authorization: Bearer <CRON_SECRET>`, and the
route also accepts `?secret=<CRON_SECRET>` for manual browser triggering.

---

## Deploy to Vercel
1. Push this folder to its own GitHub repo.
2. In Vercel: **Add New → Project → Import** the repo. Framework auto-detects Next.js.
3. **Settings → Environment Variables** — add every key from `.env.example`
   (Production + Preview). Paste the private key exactly as in `.env.local`.
4. **Deploy.** The `vercel.json` cron registers `/api/sync-emails` to run every
   15 minutes (`*/15 * * * *`).
   - **Hobby plan note:** Cron on Hobby runs at most **once per day**, and function
     `maxDuration` caps at 60s. For 15-minute syncing + 300s runs, use **Pro**.
     To stay on Hobby, change the schedule to `0 9 * * *` (daily 9am UTC).
5. **Test the engine manually** (before waiting for cron):
   ```
   https://<your-app>.vercel.app/api/sync-emails?secret=<CRON_SECRET>
   ```
   It returns JSON like `{ "ok": true, "processed": 3, "appended": 3, ... }`.
6. Open `https://<your-app>.vercel.app/dashboard`.

---

## How it works (per email)
1. **Fetch** unseen messages over IMAP, mark them `\Seen` (prevents reprocessing).
2. **Extract** brand (cleaned from sender), sender address, timestamp, subject,
   preview, plain-text body (HTML stripped), and promo codes (regex + context).
3. **Drive**: inline images → `Inline_Images/`, attachments → `Attachments/`,
   each made *anyone-with-link* and logged as a `webViewLink`.
4. **Screenshot**: full HTML rendered to an image, downloaded, and stored in
   `Screenshots/`. Embedded in the dashboard detail view via a Drive preview iframe.
5. **Sheet**: one new row appended with all fields + Drive links. Missing data is
   logged as `None`; failed steps as `Failed`.

## Error handling guarantees (PART 3)
- A single bad email, asset, or screenshot never aborts the batch.
- Missing attachments → `None`. Failed screenshot → `Failed`. Missing credentials
  on the dashboard → an actionable on-page notice instead of a crash.
- De-dupe is belt-and-braces: `\Seen` flag **and** a `sender|subject|date` key check.

## Environment variables
See [`.env.example`](./.env.example) for the full annotated list.
```
GMAIL_IMAP_USER, GMAIL_IMAP_PASSWORD, GMAIL_IMAP_HOST, GMAIL_IMAP_PORT
GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
GOOGLE_SHEET_ID, GOOGLE_SHEET_TAB, GOOGLE_DRIVE_ROOT_FOLDER_ID
SCREENSHOT_PROVIDER, HCTI_USER_ID, HCTI_API_KEY, URLBOX_API_KEY, URLBOX_API_SECRET
CRON_SECRET
```
