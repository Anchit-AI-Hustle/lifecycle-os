# Ad Campaigns Master Knowledge Base — KNICKGASM USA (Target + Costco)

Compiled 2026-07-25 from the KT handover files + live connector reads (Snowflake, Supabase, Klaviyo, Google Drive).
Canonical machine-readable copy: `data/ads/master-kb.json` (rendered at `/ads-master`).
Ad-level export: `data/ads/target-ads-meta-2026-07-20.json` (125 Meta ads, reporting window ends 2026-07-20).

Zero fabrication: every figure below is from a KT file or a live connector read, and every link is either
verified live, taken verbatim from an email, or explicitly marked **pending access** (never invented).

## 1. KT sources

| Source | Type | Window |
|---|---|---|
| Email thread: UGC Dashboard Automation (Aviral, Samvita, Anchit, Vinya) | PDF | Jul 14–16 |
| Email thread: Dark Stories Ads for Costco Launch | PDF | Jul 11–17 |
| Email thread: Data Request (consultant repository, Srishti/Sneha/Megan) | PDF | Jul 15–24 |
| Ad Spends May → 20th July (Meta + TikTok).xlsx | XLSX | to Jul 20 |
| Social Update USA — 17th July 2026.pptx (28 slides) | PPTX | to Jul 17 |

## 2. Paid spend (Target account)

| Month | Total | Meta | TikTok |
|---|---:|---:|---:|
| May 2026 | $3,608.06 | $3,608.06 | $0.00 |
| June 2026 | $18,778.01 | $14,422.93 | $4,355.08 |
| July 2026 (to 20th) | $23,484.54 | $23,484.54 | $0.00 |
| **Total** | **$45,870.61** | **$41,515.53** | **$4,355.08** |

Ad-level sheet: 125 Meta ads totalling $41,515.58 across 13 campaigns.
Objective mix: Sales $29,113.85 (83 ads) · Traffic $8,946.82 (26) · Awareness $3,344.45 (15) · Engagement $110.46 (1).

## 3. Benchmarks (derived from the KT workbook)

| Segment | CTR | CPC | Cost per key result |
|---|---:|---:|---|
| Sales — in-house statics (In-house Sales PageDeck) | 4.85% | $0.27 | $0.80 / initiate checkout |
| Sales — scored UGC videos (JoinBrands) | 4.39% | $0.36 | $1.01 / initiate checkout |
| Sales — influencer whitelisted (Page Deck) | 5.21% | $0.32 | $0.73 / initiate checkout |
| Traffic — statics (broad + store pincodes) | 5.08% | $0.14 | $0.13 / link click |
| Traffic — JoinBrands UGC (40+ US) | 12.18% | $0.07 | $0.07 / link click |
| Awareness (all) — ⚠ portfolio drag | 0.08% | $2.15 | $1.86 CPM |
| Video thumb-stop (winners) | — | — | 0.45–0.68 TSR |
| Organic creator cost per reach | — | — | $0.04–0.05 / reach |

Scaled paid winners: "goodbye menopausal weight gain" ($2,960 · $0.62/IC), "women over 50 calm grail-drop"
($2,111 · $0.81), "GLP-1 no thanks" ($1,446 · $0.67), "say hello toned arms" ($2,010 · $0.80),
"what i bought at target" UGC static ($2,847 · $0.86), AI video "woman in car with knickgasm pair" ($2,223 · $0.90).
All 10 worst ads (spend ≥ $100) are Awareness/unscored social (CTR 0.03–0.10%, CPC $2–9).

## 4. Creative learnings (Social Update deck, 17 Jul)

1. **Identity-first hooks win** — "I am a mom / I am 76 / I am an herbalist / I shop at Target" →
   relatable routine or problem → curiosity → product reveal → one transformation → proof (taste or science) → simple CTA.
2. **Specific curiosity beats withholding** — Rydel July (coffee popsicle premise) 100.5K reach vs June mystery hook 73.7K (+36%).
3. **Three organic retention modes** — comedy earns retention (Maryandbri), authentic messengers lower skip (Nadja, 34%),
   education wins saves (Jess: herbalist authority + grail-drop science).
4. **Hook fixed the funnel in June** — skip rate 57.5% → 45.3%; passed-hook 38% → 57%; 75%+ watched views +53% (32K → 49K);
   cost per reach $0.065 → $0.057. Only ~6% of views reach 75% of the video.

## 5. Organic & UGC (Apr → 17 Jul)

Totals: 3.59M views · 1.58M reach · 69 influencers ($107,648; 62 live) · 367 UGC videos ($43,308, parked for 400 creators)
· total creator cost $150,956 (utilized $69,948).

June was the peak (2.14M views, 775K reach, CPR $0.04); July tracking low (293K views to the 17th).
June UGC live content: 136 pieces — Target shelf 41, Grail-Drop 30, Over 40 20, Gummies vs coffee 16, Taste 16,
countering-mushroom 13 (TikTok 70 / IG 60 / YT 6). ~300+ UGC pieces produced per month; JoinBrands approvals reviewed daily.

Top creators (Jul): Rydelfunk (1.6M followers, 100K reach, 56.9% skip), Jess (945K, 67K, 48%),
Nadja (531K, 51K, 34%), Maryandbri (199K, 23.7K, 34.5%, 42% post-reveal retention @25s).

Next line-up: 10 influencers + 500 UGC creators (5 BAU + 2 KOL/doctor + 2 Target pages; quotes $12k/2 reels, $3.5k, $3.5k, $3k, $2.5k).
Costco Bay Area: 12 influencers (10 Costco pages + 2 Bay Area) + 100 UGC.

## 6. Ops runbooks

### UGC dashboard automation (Aviral)
One skill builds the creator-performance sheet (columns A→AN): JoinBrands posts (IG Reels + TikTok) + Meta/TikTok ad spend
join + organic scores + ad-recommendation logic → Excel. Prerequisites:
1) run the skill; 2) keep the **Video ID → Ad ID mapping sheet** current (the one ongoing manual task — ad tables don't
store video IDs); 3) Snowflake connected per user (Meta `KNICKGASM_DB.MAPLEMONK`, TikTok `DATON.RAW`);
4) one-time Chrome connector signed into JoinBrands + Instagram.
Owners: automation Aviral · ads next step Samvita + Anchit · output validation Vinya.

### Costco dark-post launch
6 Story + 6 Carousel dark posts → Indian diaspora US. LP: Instacart PDP 80435594. Objective Traffic (link clicks), $100/day.
Static buckets: Value Pack / Summer Drink / Social Proof / Indian Diaspora / Benefit-Led; videos Indian Diaspora Ad-1/2.
Open: targeting parameters, conversion-objective question, founder-ads RCA (closed via mail to Bala with receipt date).

### Consultant data request (Megan)
Repository collated by Ishita; **Kritagya is the go-forward source for all ad-campaign information**.
Priorities: Spins coffee seasonality (only 52-week combined exists), Aug demo slots (50 shared, brand-funded),
Ibotta media evaluation + Goli/airbrush redeemer targeting, USA DTC email announcing coffee launch + Target placement.

## 7. Platform data sources (live-verified 2026-07-25)

| Platform | Status | Key facts |
|---|---|---|
| Snowflake | connected | `KNICKGASM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS` 129,741 rows (2024-05-15 → 2026-07-25, fresh); TikTok `DATON.RAW.TIKTOK_ADS_USA_*_REPORT_DAILY`; Google `GOOGLE_ADS_US_AD_GROUP_AD_REPORT` 91,135 rows (app default fixed — `GOOGLE_ADS_USA` did not exist) |
| Supabase | connected | project `lifecycle-os` (fswdwmkgggzyxrdzabnh), 57 public tables; `ads_generated`/`landing_pages_generated` mirrors NOT found; RLS advisory on `ci_user_subscriptions`, `ci_notification_log` |
| Klaviyo | connected (UK) | account UZL5NY KNICKGASM UK — the USA DTC coffee-launch email needs the USA account or `KLAVIYO_API_KEY` |
| Shopify | storefront-only | Admin connector not authorized; US/UK/Global public storefronts + built catalogs |
| Vercel | deployed | knickgasm.vercel.app; this dashboard is static JSON (no new function, 12-limit untouched) |
| GitHub | active | anchit-ai-hustle/lifecycle-os |

## 8. Link registry

54 catalogued links live in `data/ads/master-kb.json` and render with Open buttons at `/ads-master#kb` —
verified Drive links (Target Paid Ads Update deck, KNICKGASM_UGC_Master_v6, Costco US Ads folder, fallback CSV),
email-verbatim links (UGC output snapshot, mapping sheet, Instacart LP, consultant doc, Snowflake console),
11 UGC example posts from the deck, and 27 named-but-unshared documents marked pending-access with their owner
(Meta Ad Reports May/June/July, TikTok June report, Day-wise update, social calendar, scripts, trackers,
Aisle/Ibotta/Roundel exports, daily sales tracker).

## 9. Gaps & risks

- **HIGH** — Snowflake credentials were shared in plain text in the UGC email thread: rotate the password, per-user access only.
- July TikTok spend reads $0 while Meta ran $23,485 — paused or unreported?
- 27 referenced documents pending link access (owners listed).
- `ads_generated` / `landing_pages_generated` mirror tables missing from live Supabase schema.
- Klaviyo USA account not connected (UK is).
- Spins monthly seasonality split missing (Tushar checking).
- Supabase RLS disabled on 2 `ci_*` tables.
