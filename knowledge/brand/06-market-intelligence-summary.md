# KNICKGASM — Market Intelligence Summary

A concise pointer to the deeper market and competitor intelligence available to the OS, plus the real performance headlines that ground every plan.

## US performance headlines (trailing 12 months)

| Metric | Value |
|---|---|
| Orders | 20,620 |
| Total sales | $1,120,765 |
| AOV | $51.10 |
| Returning-customer rate | 46.3% |
| Top product | Coffee Collection (~$115,600 net) |
| Online Store share of revenue | 89% |
| Loop Subscriptions share | 7.6% at $39.83 AOV |

Top US categories (in order): **Coffee, Black Sneakers (Hand-painted), Kicks Sneakers (Hand-painted), Themed Sneakers (Lace Sets), Christmas Gifts.**

Read: coffee/functional leads, the heritage sneaker range is the broad base, and gifting spikes seasonally. The ~46% returning-customer rate and a growing (but still 7.6%) subscription base are the two biggest retention levers — converting one-time repeaters into Loop subscribers is the headline opportunity.

## UK performance headlines (trailing 12 months)

| Metric | Value |
|---|---|
| Orders | 25,001 |
| Total sales | £818,515 |
| AOV | £33.70 |
| Top products | Coffee Collection franchise — Refill, base, Starter Kit |

Read: the UK ships more orders than the US at a lower AOV, and its bestsellers are almost entirely the Coffee Collection franchise. UK growth centers on the coffee franchise plus the engagement-cohort program (Cohorts A-F, `03-lifecycle-cohorts.md`), where reactivating non-engagers (Cohort A/B) is the standing challenge.

## Deeper market intelligence

- **`docs/market-intelligence/us-coffee-d2c-landscape.md`** — the primary reference for the US coffee / functional-coffee D2C landscape (category dynamics, positioning of rivals, where Coffee Collection fits). Consult this before planning any US coffee campaign.

## Competitor-intelligence data engine

KNICKGASM runs a dedicated inbound competitor-mailer capture pipeline, separate from this repo's competitor router:

- **Project:** `knickgasm_dtc_data_engine`
- **In-app route:** /data-engine (native, part of the Lifecycle OS)
- **Repo:** https://github.com/Anchit-AI-Hustle/knickgasm_dtc_data_engine

### How it works

1. A **Cloudflare email worker** receives competitor marketing emails (forwarded/subscribed inboxes).
2. It posts them to a **FastAPI `/v1/incoming-mail` endpoint**.
3. Messages are parsed and stored in a **Postgres `competitor_mailers` table**, with the raw **HTML snapshotted to S3**.
4. A **React `CompetitorMailViewer`** renders the captured mailers for browsing and analysis.

This gives the growth team a searchable, timestamped archive of what competitors are actually sending — offers, cadence, seasonal beats, and creative — to benchmark KNICKGASM's own lifecycle program against real market activity.

### In-repo competitor tooling (complementary)

Inside this repo, `api/competitor.js` (`?action=list|html|poll|sync`, logic in `_shared/competitor-core.js`) captures competitor emails via Gmail IMAP into a Google Sheet, surfaced in `competitor-benchmarking.html` (`/competitor`) and the `/competitor` command. The external data engine above is the larger, purpose-built capture-and-view system; the in-repo router is the lightweight, OS-integrated view.
