# Free Competitor Lifecycle Engine

A zero-/low-cost competitor benchmarking pipeline that captures rival brands' **mailers, ads, and landing pages** without Gmail botting. Every component runs on a free or free-tier plan.

## Architecture

```
                         ┌─────────────────────────────┐
  Competitor newsletters │  Cloudflare Email Routing    │  (free custom-address forwarding)
  (you subscribe with    │  benchmark@yourdomain.com →  │
   a catch-all address)  │  forwards every message      │
                         └──────────────┬──────────────┘
                                        │  email forwarded
                                        ▼
                         ┌─────────────────────────────┐
                         │  n8n (self-hosted CE)        │  (free, open-source automation)
                         │  IMAP/Email trigger → parse  │
                         │  → HTTP POST                 │
                         └──────────────┬──────────────┘
                                        │  POST /api/competitor?action=ingest
                                        ▼
                         ┌─────────────────────────────┐
                         │  Lifecycle OS (Vercel)       │
                         │  core.ingestEmail() → Sheet  │  (Google Sheets = free intelligence DB)
                         └─────────────────────────────┘

  Ads:      /api/competitor?action=adlibrary  → Meta Ad Library (free) / Apify free plan
  Brands:   /api/competitor?action=discover   → AI brand discovery (existing)
  Landing:  Competitor Benchmarking ▸ Landing Pages → deep-links to each brand's live site
```

Nothing here scrapes Gmail or automates a logged-in inbox. You subscribe to competitor lists with a **Cloudflare-routed address**; Cloudflare forwards each email; n8n parses and POSTs it to the app; the app stores it in the same Google Sheet the benchmarking UI already reads.

## Components (all free / free-tier)

| Component | Role | Plan |
|---|---|---|
| **Cloudflare Email Routing** | Free custom addresses + forwarding for competitor signups | Free |
| **n8n (self-hosted Community Edition)** | Parse the forwarded email → POST to the app | Free / OSS (GitHub) |
| **Google Sheets** (or Notion/Airtable) | The intelligence database (mailers + brand universe) | Free tier |
| **Meta Ad Library** | Public active-ad discovery per brand | Free |
| **Apify (optional)** | Structured creative scraping where legally allowed | Free $0 plan (monthly credits) |

> Use Apify's free plan only for limited scraping where it's legally allowed. The app degrades gracefully to public deep-links when no `APIFY_TOKEN` is set.

## Setup

### 1. Cloudflare Email Routing (capture inbox)
1. Add your domain to Cloudflare (free plan is fine).
2. **Email ▸ Email Routing ▸ Get started.** Add the MX/TXT records it generates.
3. Create a routing rule: `benchmark@yourdomain.com` → forward to a mailbox n8n can read (e.g. a dedicated Gmail/IMAP inbox *you own*, or n8n's email node). A **catch-all** rule (`*@yourdomain.com`) lets you give every competitor a unique address (e.g. `kickstradomis@yourdomain.com`) so the sender is unambiguous.
4. Subscribe to each competitor's newsletter using one of these addresses.

### 2. n8n workflow (parse + forward)
Self-host n8n CE (Docker one-liner or any free host):
```bash
docker run -it --rm -p 5678:5678 -v ~/.n8n:/home/node/.n8n n8nio/n8n
```
Build a 2-node workflow:
- **Trigger:** *Email Trigger (IMAP)* on the mailbox Cloudflare forwards to — or an *n8n Email* node.
- **Action:** *HTTP Request* →
  - Method `POST`
  - URL `https://<your-app>.vercel.app/api/competitor?action=ingest`
  - Header `x-ingest-token: <INGEST_TOKEN>` (optional, see below)
  - JSON body:
    ```json
    {
      "from": "{{$json.from.address}}",
      "fromName": "{{$json.from.name}}",
      "subject": "{{$json.subject}}",
      "html": "{{$json.html}}",
      "text": "{{$json.text}}",
      "receivedAt": "{{$json.date}}"
    }
    ```
The app's `ingestEmail()` runs the **same** noise filter, brand-name cleaning, promo-code extraction, preview, and dedup as the legacy IMAP sync — then appends one row and re-sorts newest-first.

### 3. App environment variables (Vercel)
| Var | Purpose | Required |
|---|---|---|
| `INGEST_TOKEN` | Shared secret; if set, `action=ingest` requires header `x-ingest-token` | Recommended |
| `APIFY_TOKEN` | Apify free-plan token to pull structured Meta ads (else deep-link only) | Optional |
| `APIFY_META_ADS_ACTOR` | Override the Apify actor (default `curious_coder~facebook-ads-library-scraper`) | Optional |
| `GOOGLE_*` | Existing Sheets credentials already used by competitor sync | Existing |

### 4. Verify
```bash
# Ingest a test mailer
curl -X POST "https://<your-app>.vercel.app/api/competitor?action=ingest" \
  -H "Content-Type: application/json" -H "x-ingest-token: $INGEST_TOKEN" \
  -d '{"from":"news@kickstradomis.com","fromName":"Kickstradomis","subject":"New custom drop this week","html":"<h1>Fresh drop</h1>","receivedAt":"2026-06-09T08:00:00Z"}'

# Pull a brand's active Meta ads (deep-link if no APIFY_TOKEN)
curl "https://<your-app>.vercel.app/api/competitor?action=adlibrary&brand=Kickstradomis&country=US&limit=20"
```
Then open **Competitor Benchmarking** in the app — the test mailer appears under *Mailers*, ads under *Meta Ads*, brands under *Discover Brands*, and landing pages under *Landing Pages*.

## API surface added

| Action | Method | Purpose |
|---|---|---|
| `?action=ingest` | POST | Store one forwarded competitor email (free capture path) |
| `?action=adlibrary&brand=&country=&limit=` | GET | Active Meta ads via Apify free, else public deep-link |

Existing actions (`list`, `html`, `poll`, `sync`, `brands`, `seed`, `discover`) are unchanged — the legacy Gmail/IMAP `sync` still works, so you can run both paths during migration.

## Cost summary
At expected volumes this runs at **$0/month**: Cloudflare Email Routing (free), n8n self-hosted (free), Google Sheets (free tier), Meta Ad Library (free). Apify's free plan is optional and only used for structured creative pulls within its monthly credit allowance.
