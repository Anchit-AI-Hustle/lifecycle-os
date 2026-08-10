# KNICKGASM — Lifecycle Cohort Dictionary

The complete cohort model used for targeting across the OS. Cohort names are used **verbatim** — do not rename or abbreviate them in code or output.

## 1. RFM segments (Recency, Frequency, Monetary)

The primary US/analytics segmentation. Each customer falls into one RFM segment.

| Segment | One-line definition | Targeting note |
|---|---|---|
| **Champions** | Bought recently, buy often, spend the most. | Reward and retain; early access to new drops, VIP framing, grail-tier upsell (Jordan Lows, Sambas). No discounting. |
| **Loyal** | Consistent repeat buyers, high frequency. | Deepen with a second pair in a new collection and with care/lace add-ons (sneaker to accessories, anime to football). |
| **Potential Loyalists** | Recent buyers with promising frequency, trending up. | Nudge to second/third commission; introduce the rotation and the care ritual. |
| **Promising** | Recent, lower-frequency buyers showing intent. | Educate on the collections; entry silhouette to grail path (Court Vision to AF1 to Jordan Low). |
| **New** | First purchase, very recent. | Onboard: studio story, what the 10 to 15 day build looks like, how to care for a hand-painted pair. |
| **Need-Attention** | Above-average once, but slipping in recency. | Re-engage with relevance before they cool; new designs in the collection they already bought. |
| **About-to-Sleep** | Recency and frequency dropping toward inactive. | Timely reactivation; new-drop alert in their known fandom. |
| **At-Risk** | Formerly good customers who have not bought in a while. | Win-back sequence; strongest reason-to-return, considered incentive. |
| **Can-not-Lose-Them** | High historic value, now long inactive. | Priority win-back; personal, high-value offer justified. Restoration/touch-up outreach works here. |
| **Hibernating** | Low recency, low frequency, low value. | Low-cost reactivation; accessories and entry-silhouette re-entry. |
| **Lost** | No engagement or purchase for a long period. | Last-effort reactivation or suppress; cheapest touch only. |

> Note: `Lost` and `Can-not-Lose-Them` are distinct named segments and both appear in the source model.

## 2. UK engagement cohorts (A-F)

The UK program segments by **purchase history x email engagement**. Cohort A is the coldest (never bought, never engaged); later letters layer in buying and/or engagement.

| Cohort | Definition | Targeting note |
|---|---|---|
| **Cohort A** | Non-Buyers / Non-Engagers — on list, never purchased, not opening. | Hardest to reach; the UK non-engagers campaign hub targets this first. Discovery + reason-to-open. |
| **Cohort B** | `T&B Buyers / Non-Engagers` — prior custom-sneaker buyers who have gone quiet. | Reactivate around the collection they already bought; new designs on the same base silhouette. |
| **Cohort C** | Buyers / partial engagers — some purchase and some engagement. | Convert engagement into a repeat commission; introduce the second-pair rotation. |
| **Cohort D** | Engaged non-buyers / newer engagers — opening but not yet bought. | Convert intent to first order; entry silhouette (Court Vision, Converse) or an accessory. |
| **Cohort E** | Repeat buyers / engaged — active on both axes. | Deepen loyalty; care-kit and rope-lace replenishment, cross-collection discovery. |
| **Cohort F** | Best UK customers — high purchase and high engagement. | VIP treatment; protect and grow, no discount reliance. Grail-tier and bespoke commissions. |

> Cohorts C-F follow the A/B pattern of combining a purchase state with an engagement state. Cohort A (Non-Buyers/Non-Engagers) and Cohort B (`T&B Buyers/Non-Engagers`) are the authoritative anchors; keep those two label strings verbatim. `T&B` is a legacy identifier retained because it is matched literally in `api/_shared/lifecycle-cohorts.js` and `api/_shared/calendar-export.js`; read it as "prior custom-sneaker buyers".

## 3. Lifecycle stages

A coarse five-stage overlay used for stage-based automation (independent of RFM label).

| Stage | Definition | Targeting note |
|---|---|---|
| **NEW** | Just acquired / first order. | Welcome, studio story, build-timeline expectations, care education. |
| **ACTIVE** | Buying and engaging within the normal window. | Sustain the ritual; cross-collection and add-on discovery. |
| **VIP** | Top-value active customers. | Recognition, early access to drops, bespoke commission access. |
| **RISK** | Slipping out of the active window. | Timely re-engagement before lapse. |
| **LAPSED** | Past the active window with no activity. | Win-back sequence. |

## 4. Product cohorts

Group customers by what they buy, because it drives message and offer:

- **Coffee-ART buyers** — the largest collection cohort; cross-sell within coffee-ART (AF1 to Jordan Low to Sambas) and into rope-lace pairings.
- **Fandom buyers (anime, football, gaming, cars)** — buy on identity; new-design-in-your-fandom alerts, one-time framing per pair.
- **Occasion buyers (wedding, anniversary, birthday)** — date-driven; the 10 to 15 day build window is the planning message.
- **Gifters** — occasion-driven; denim jackets, gift bundles, accessories as low-commitment gifts.
- **Accessory & care buyers** — rope laces, custom lace tags, the Ultimate Sneaker Care Kit. The one genuinely repeatable line; ritual-completion cross-sell.

## 5. Behavioral cohorts

Cross-cutting behaviors that modify targeting:

- **Subscribers (Loop Subscriptions)** — the recurring base, driven by care and lace replenishment; protect churn, reward tenure.
- **One-time repeaters** — commission a second pair without any standing plan; the prime cohort for the drop-club and replenishment conversion.
- **Discount-responsive** — only convert on incentive; reserve promos for this group and the Curious Switcher.
- **Entry-silhouette entrants** — came in on Court Vision, Converse, or an accessory; guide them up to an AF1 or a grail-tier pair.
- **Gift-occasion buyers** — spike seasonally; nurture into self-purchase.

## Mapping cohorts to the four avatars

| Avatar | Buys for | Maps strongly to |
|---|---|---|
| **The Streetwear Optimiser** | The build (base, technique, finish) | Coffee-ART and fandom cohorts; Champions/Loyal on grail-tier silhouettes. |
| **The Ritual Loyalist** | Routine | Subscribers, Loyal, VIP, ACTIVE; accessory and care buyers, daily-wear rotation. |
| **The Gifting Connector** | Status / occasion | Gifters, occasion buyers, gift-occasion behavioral cohort; seasonal spikes. |
| **The Curious Switcher** | Discovery | Entry-silhouette entrants, Promising/New, discount-responsive, UK Cohort A/D. |

Use the avatar to set tone and the cohort to set the specific collection, offer, and timing.
