# KNICKGASM — Offers & Mechanics Playbook

How KNICKGASM frames offers, replenishment, gifting, and shipping across categories. The governing principle: **one-time commission framing for every hand-painted pair, replenishment framing for the accessories and care line that create a rhythm, and discount discipline everywhere.**

## Framing by category

### One-time commission — every hand-painted pair

A one-of-one pair is painted once, for one person. It cannot be restocked, bundled into a repeat plan, or discounted as inventory. So the default frame for the whole design library (coffee-ART, anime, football, cars, gaming, celebrity, occasion, bling, embroidery) is a **single made-to-order commission**.

- **Lead with the build, not the deal.** Original Nike / Jordan / Adidas / Converse base, hand-painted by India's best artists, layered and sealed so the finish is water and scratch resistant.
- **Own the 10 to 15 day window.** State the made-to-order timeline up front and treat it as proof of craft. Never dress it up as scarcity and never use false urgency.
- **Value framing, not price framing.** Compare a pair to the sneaker plus a commissioned artwork, never to a stock retail pair. Never claim to be cheapest.
- **Entry silhouette to grail path.** Nike Court Vision (roughly $107 to $132) is the on-ramp; Air Force 1 is the workhorse; Air Jordan 1 Lows and Adidas Sambas are the grail tier ($175 to $226 and $192 to $204). Move buyers up that path over time rather than discounting down it.
- **Free gifts as added value.** Commissions ship with a free-gift bundle worth **~$48 (US) / ~£40 (UK)**, positioned as added value rather than a price cut. Confirm the current bundle contents against the live store before naming them in output.

### Replenishment-first — accessories & care

The **Ultimate Sneaker Care Kit** ($17.13), **Chunky Rope Laces For Sneakers** ($7.91), and **Lace Tags (Custom)** ($9.14) are the only genuinely repeatable SKUs, so they carry the recurring frame.

- **Loop Subscriptions** is the recurring engine and it sits on this line. In the US it accounts for **7.6% of revenue at a $39.83 AOV** (trailing 12 months): a meaningful, lower-AOV recurring base with room to grow.
- **Care rhythm** — lead with the care kit for anyone whose pair is a few months old; frame around keeping hand-painted artwork looking studio-fresh, not around running out.
- **Accessories as the on-ramp** — a $7.91 lace set or a $9.14 custom lace tag converts a browser into a first-time buyer and warms them for a full commission.
- **B2G1 on accessories** — Buy-2-Get-1 is the standing value mechanic on rope laces and lace tags. It rewards stock-up buying on the cheap, repeatable line without ever discounting a one-of-one pair.

> Legacy note: the `subscription_priority` flag in `api/_shared/lifecycle-cohorts.js` and `api/_shared/social-core.js` resolves to this accessories-and-care line. Custom pairs are always one-time.

## Free-shipping thresholds

KNICKGASM ships express from Mumbai to 60+ countries. Free shipping is offered above a market-appropriate order-value threshold and is the primary basket-building lever (raise AOV rather than cut price) — typically by adding laces, a lace tag, or a care kit to a commission. Present it as a natural nudge ("add to reach free shipping"), not as urgency. Confirm the current threshold value per market against the live store before quoting a number in output.

## Gifting & occasion mechanics

- **Wedding and occasion pairs** anchor the gifting range: **Wedding Carnival (customisable with the outfit) x Nike Air Force 1** ($234.08) is the hero, alongside anniversary and birthday commissions and the **denim jackets** ($64.35). Occasion & Gifting is a top-5 US category, so Q4 and wedding season are both major windows.
- Gifting mechanics: pairs customised to a couple's outfit, accessories as low-commitment gifts, gift bundles that double as a first taste of the studio.
- **Plan around the build window.** Any gifting or occasion beat must be scheduled so the 10 to 15 day made-to-order timeline clears the date. This is the single most important gifting-calendar rule.
- Seasonal beats to plan around: Q4 holiday gifting, Indian and international wedding seasons, fandom moments (anime releases, football tournaments, tour announcements), and new-year restore/balance.
- Gift-occasion buyers should be nurtured toward self-purchase and, for accessories, into the replenishment rhythm after the occasion.

## Discount discipline (important)

Discounts are **not** a default lever. Champions, Loyal, VIP, and best-customer cohorts (including UK Cohort F) are grown with recognition, early access to drops, bespoke commission access, and B2G1 accessory stock-up mechanics — **not** price cuts.

> **Rule:** Straight discounts are reserved for **The Curious Switcher** and the **discount-responsive** behavioral cohort (and the coldest reactivation cases, e.g. UK Cohort A entrants and At-Risk / Can-not-Lose-Them win-backs where an incentive is genuinely justified). Everyone else gets value framing, not markdowns.

This protects margin and brand perception: KNICKGASM sells origin and ritual, and habitual discounting erodes both — especially on a product where the price reflects an artist's hours. When an incentive is used, it must respect the banned-phrase list (no "hurry," "last chance," "LIMITED TIME," etc.).

## Quick offer-selection guide

| Cohort / avatar | Default mechanic |
|---|---|
| Champions / Loyal / VIP / Cohort F | Early access to drops, grail-tier and bespoke commissions, B2G1 accessories. No discount. |
| Accessory & care repeaters | Convert to a Loop replenishment plan; care kit; B2G1 laces and lace tags. |
| Fandom & coffee-ART buyers | One-time commission, new-design-in-your-collection education; free-shipping nudge with an accessory. |
| Gifting Connector | Occasion pairs, wedding customs, denim jackets, ~$48/£40 free-gift value, build-window planning. |
| Curious Switcher / discount-responsive | Entry silhouette or accessory entry, considered discount, discovery framing. |
| Win-back (At-Risk / Can-not-Lose-Them / Cohort A) | Strongest reason-to-return; restoration and touch-up offer; justified incentive only. |
