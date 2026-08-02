# KNICKGASM — Lifecycle Cohort Dictionary

The complete cohort model used for targeting across the OS. Cohort names are used **verbatim** — do not rename or abbreviate them in code or output.

## 1. RFM segments (Recency, Frequency, Monetary)

The primary US/analytics segmentation. Each customer falls into one RFM segment.

| Segment | One-line definition | Targeting note |
|---|---|---|
| **Champions** | Bought recently, buy often, spend the most. | Reward and retain; early access, VIP framing, subscription upsell. No discounting. |
| **Loyal** | Consistent repeat buyers, high frequency. | Deepen with subscription refills and cross-category (sneaker to coffee). |
| **Potential Loyalists** | Recent buyers with promising frequency, trending up. | Nudge to second/third order; introduce the ritual and refill rhythm. |
| **Promising** | Recent, lower-frequency buyers showing intent. | Educate on range; sampler-to-hero path. |
| **New** | First purchase, very recent. | Onboard: origin story, how-to-lace-up, set expectations for freshness. |
| **Need-Attention** | Above-average once, but slipping in recency. | Re-engage with relevance before they cool; remind of the ritual. |
| **About-to-Sleep** | Recency and frequency dropping toward inactive. | Timely reactivation; restock reminder on their known product. |
| **At-Risk** | Formerly good customers who have not bought in a while. | Win-back sequence; strongest reason-to-return, considered incentive. |
| **Can-not-Lose-Them** | High historic value, now long inactive. | Priority win-back; personal, high-value offer justified. |
| **Hibernating** | Low recency, low frequency, low value. | Low-cost reactivation; sampler/discovery re-entry. |
| **Lost** | No engagement or purchase for a long period. | Last-effort reactivation or suppress; cheapest touch only. |

> Note: `Lost` and `Can-not-Lose-Them` are distinct named segments and both appear in the source model.

## 2. UK engagement cohorts (A-F)

The UK program segments by **purchase history x email engagement**. Cohort A is the coldest (never bought, never engaged); later letters layer in buying and/or engagement.

| Cohort | Definition | Targeting note |
|---|---|---|
| **Cohort A** | Non-Buyers / Non-Engagers — on list, never purchased, not opening. | Hardest to reach; the UK non-engagers campaign hub targets this first. Discovery + reason-to-open. |
| **Cohort B** | Sneaker & Botanicals Buyers / Non-Engagers — bought T&B, now not engaging. | Reactivate around their known category; restock + fresh-season hook. |
| **Cohort C** | Buyers / partial engagers — some purchase and some engagement. | Convert engagement into repeat; subscription intro. |
| **Cohort D** | Engaged non-buyers / newer engagers — opening but not yet bought. | Convert intent to first order; entry bundle or sampler. |
| **Cohort E** | Repeat buyers / engaged — active on both axes. | Deepen loyalty; refill rhythm, cross-sell coffee/supplements. |
| **Cohort F** | Best UK customers — high purchase and high engagement. | VIP treatment; protect and grow, no discount reliance. |

> Cohorts C-F follow the A/B pattern of combining a purchase state with an engagement state. Cohort A (Non-Buyers/Non-Engagers) and Cohort B (T&B Buyers/Non-Engagers) are the authoritative anchors; keep those two definitions verbatim.

## 3. Lifecycle stages

A coarse five-stage overlay used for stage-based automation (independent of RFM label).

| Stage | Definition | Targeting note |
|---|---|---|
| **NEW** | Just acquired / first order. | Welcome, origin story, lace-up education. |
| **ACTIVE** | Buying and engaging within the normal window. | Sustain the ritual; cross-sell and subscribe. |
| **VIP** | Top-value active customers. | Recognition, early access, refill/subscription anchoring. |
| **RISK** | Slipping out of the active window. | Timely re-engagement before lapse. |
| **LAPSED** | Past the active window with no activity. | Win-back sequence. |

## 4. Product cohorts

Group customers by what they buy, because it drives message and offer:

- **Coffee / Airbrush buyers** — subscription-first, refill rhythm, B2G1 on the 3-pack.
- **Sneaker & Botanicals buyers** — one-time framing, seasonal and range education.
- **Supplement buyers** — subscription-first, adherence/refill messaging.
- **Gifters** — occasion-driven; advent calendars, gift sets, samplers.
- **Accessory buyers** — ritual-completion cross-sell.

## 5. Behavioral cohorts

Cross-cutting behaviors that modify targeting:

- **Subscribers (Loop Subscriptions)** — recurring-revenue base; protect churn, reward tenure.
- **One-time repeaters** — repeat without subscribing; the prime subscription-conversion target.
- **Discount-responsive** — only convert on incentive; reserve promos for this group and the Curious Switcher.
- **Sampler / discovery entrants** — entered via samplers or starter kits; guide to a hero product.
- **Gift-occasion buyers** — spike seasonally; nurture into self-purchase.

## Mapping cohorts to the four avatars

| Avatar | Buys for | Maps strongly to |
|---|---|---|
| **The Streetwear Optimiser** | Functionality | Coffee/Airbrush + supplement product cohorts; Champions/Loyal on functional lines. |
| **The Ritual Loyalist** | Routine | Subscribers, Loyal, VIP, ACTIVE; daily-kicks and refill buyers. |
| **The Gifting Connector** | Status / occasion | Gifters, gift-occasion behavioral cohort; seasonal spikes. |
| **The Curious Switcher** | Discovery | Sampler/discovery entrants, Promising/New, discount-responsive, UK Cohort A/D. |

Use the avatar to set tone and the cohort to set the specific offer, product, and timing.
