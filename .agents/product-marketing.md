# Product Marketing Context

> Read by every marketing skill before it writes anything. This file describes
> the ACTIVE brand of the Lifecycle OS workspace this repo runs. The platform
> is multi-tenant: if the task names a different brand (The Times of India,
> Times Health+, The Economic Times, Apple, VAHDAM…), IGNORE the brand facts
> below and pull that brand's record instead — `data/brands/presets/<slug>.json`
> or the `brand_workspaces` row. Never mix one brand's facts, vocabulary,
> catalogue or claims into another brand's output. A missing fact is written as
> `[DATA REQUIRED BEFORE LAUNCH: field, product, region]`, never invented.

## What we sell (tenant zero: KNICKGASM)

Custom, hand-painted one-of-one sneakers — plus custom-painted game
controllers (PS5/Xbox), sneaker care and accessories, and gift cards. Every
pair is painted to order on a 100% original base sneaker (Air Force 1, Jordan,
Dunk). ~436 live products at knickgasm.com. Made to order in 10–15 days,
shipped worldwide.

- Site: https://knickgasm.com · IG: https://www.instagram.com/knickgasm/ · hello@knickgasm.com
- Legal entity: KNICKGASM PRIVATE LIMITED, Ghatkopar West, Mumbai 400086, India
- Markets: India first (₹), plus US ($) and UK (£) storefront pricing

## Who buys

Sneakerheads and fandom buyers 18–34 (anime, football, F1/cars, gaming,
Bollywood/pop culture), gift-buyers, and couples ordering wedding pairs.
Semantic catalogue segments: Anime & Fandom, Sport & Auto, Wedding & Couples,
Gaming/Controllers, Pets, Bling/Statement, Gifts, Care & Accessories.

## Positioning

The emotional end-state, never the technique: "the only pair on earth", "your
fandom on your feet". A hand-painted one-of-one on an original silhouette —
identity and status, not shoe-painting as a craft service. Specs (sealants,
airbrush, embroidery) appear only as the reason the payoff is believable.

## Verifiable claims (the ONLY facts assertable as fact)

- India's largest sneaker customisers
- Made on 100% original brand sneakers
- Hand-painted by India's best artists
- Water and scratch resistant designs
- Express shipping worldwide to 60+ countries
- Free shipping in India and worldwide

Never claim: B-Corp, certifications, review counts, ratings, revenue or any
number not in `data/market/knickgasm-verified-metrics.md`.

## Voice

Bold, energetic, youth street-culture; confident and playful, never corporate.
Testimonials read like a friend flexing a new pair, not a review.

- PREFERRED words: custom, hand-painted, one-of-one, grail, canvas, colorway, drop, rotation, crafted, original
- BANNED phrases: wellness journey, transform, liquid gold, game-changer, LIMITED TIME, hurry, don't miss out, last chance, while supplies last, replica, knock-off, first copy, fake pair
- No em/en dashes in output copy — commas, colons or plain hyphens.
- Never imply the pairs are replicas: hand-painted on 100% original sneakers.

## Design system

Palette (only these): #D0473E lava red primary · #6A33D8 purple accent ·
#111111 ink · #FFFFFF surface. Headings Montserrat, body Instrument Sans.
Never a black/dark-neutral section background; WCAG AA on every pairing.

## Competitors

Direct (India custom studios): Moreiarty, Sneak Peek Shoes, The Leather Works,
Shoes Your Daddy, Sneakboo, Courtside, MD Customs. Wallet-share: VegNonVeg,
Superkicks, CrepDog Crew, Hype Fly, FindYourKicks, Mainstreet. Global
benchmarks: The Shoe Surgeon, Kickstradomis, Nike By You. Controllers:
ColorWare, Xbox Design Lab. Full set in the `competitor_brands` table
(workspace-scoped).

## Proof and channels

Market study with sources: `data/market/` + the Market Study feature (India
sneaker market USD 3.88B FY2024 → 5.93B FY2032, Markets & Data via Business
Today). Primary channels: Instagram/Meta, TikTok-style short video, email
lifecycle (this platform), WhatsApp for order updates.
