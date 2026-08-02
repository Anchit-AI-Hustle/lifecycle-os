-- Seed: KNICKGASM .in vs .com strategic teardown as durable, TAGGED knowledge the
-- shared agents can search (search_knowledge_base → kb_knowledge). Source is an
-- observed cross-store teardown (competitor/own-brand intel), not KNICKGASM approved
-- product facts — figures are attributed as observed, never as verified claims.
-- Idempotent: re-running updates in place on url_hash.
INSERT INTO public.kb_knowledge (url, url_hash, source_type, title, summary, key_points, tags, market, vertical, status, added_by, processed_at)
VALUES
(
  'knickgasm-intel://in-vs-us/web-push-capture', 'intel_in_webpush_v1', 'note',
  'KNICKGASM.in top-of-funnel: single-click Web Push capture + discount ladder',
  'Observed on knickgasm.in: a low-friction bottom-left soft-prompt offers an instant discount code for a 2-click browser push opt-in (no keyboard, unlike email popups). It fuels a downstream discount-ladder automation: an abandoned cart triggers a push ~20 min later with the discount pre-applied to the link. Reported outcome (their figure): recovered orders run ~26.5% higher AOV than standard. This bypasses Meta pixel retargeting cost by recovering carts via free browser clicks.',
  '["2-click web-push opt-in beats email popups on mobile (no typing)","Abandoned-cart push ~20 min post-bounce, discount pre-applied to link","Reported +26.5% AOV on push-recovered orders (observed claim)","Bypasses paid Meta retargeting with free owned push"]'::jsonb,
  '["web-push","cart-recovery","offer-architecture","retention"]'::jsonb, 'IN', 'Streetwear', 'summarized', 'strategy-teardown', now()
),
(
  'knickgasm-intel://in-vs-us/clinical-social-proof', 'intel_in_socialproof_v1', 'note',
  'KNICKGASM.in PDP: result-first hero review + Western social-proof ticker',
  'Observed on the knickgasm.in Embroidery Curcumin PDP: the hero is a large emotional customer transformation quote next to the product image (e.g. "I used to go in search of lifts. But after taking this for a month, I climbed the stairs." — Ramya R.), NOT an ingredient list. Below the CTA fold runs a credibility ticker of Western validation: Rohit Sharma''s Favorite Things (2018 & 2019), Featured on The Ellen Show, 7 Million Customers — historical US validation used to sell into the domestic Indian market.',
  '["Transformation story ABOVE clinical facts on the PDP","Hero = emotional customer quote, not the bottle","Social-proof ticker: Rohit Sharma / Ellen / 7M customers (observed)","Reuse historical US validation cross-market"]'::jsonb,
  '["pdp","result-first-copy","social-proof","conversion"]'::jsonb, 'IN', 'Supplements', 'summarized', 'strategy-teardown', now()
),
(
  'knickgasm-intel://in-vs-us/day-kit-bundling', 'intel_in_daykit_v1', 'note',
  'KNICKGASM.in merchandising: Day-Kits + capsule-count tiered bundling',
  'Observed on knickgasm.in streetwear/finish items: heavy use of "Day Kits" (10/20/30/60-day) and capsule counts (90 vs 180). The lowest tier is shown prominently to keep the entry barrier small, while per-unit cost is heavily slashed on higher-day kits to push buyers toward multi-pack purchases. Products framed as daily-routine packs ("Lean & Fit Finish", "Digestive Comfort") vs the US .com''s luxury hand-painted / gift-box framing.',
  '["Day-Kits (10/20/30/60) + capsule counts (90/180) as the variant axis","Low entry tier prominent; per-unit slashed on bigger kits","Routine-pack framing beats luxury-SKU framing for repeat","Merchandise around the daily habit, not the gift occasion"]'::jsonb,
  '["bundling","pricing","subscription","merchandising"]'::jsonb, 'IN', 'Streetwear', 'summarized', 'strategy-teardown', now()
),
(
  'knickgasm-intel://in-vs-us/comparison-matrix', 'intel_in_vs_us_matrix_v1', 'note',
  'KNICKGASM .in vs .com architecture comparison (feature-vector matrix)',
  'Side-by-side of the Indian (.in) vs current US (.com) architecture. Top-of-funnel: .in uses single-click web push + email capture; .com uses intrusive email popups that disrupt mobile shopping. Pacing/urgency: .in runs multi-tier announcement bars ("10% off over ₹1699", "5% off over ₹999"); .com shows a passive single-line free-shipping notice. Merchandising: .in frames daily routine packs / health kits; .com frames luxury hand-painted + high-ticket gift boxes. Retargeting: .in bypasses Meta pixel cost via automated free browser-push cart recovery; .com is fully dependent on expensive Meta retargeting + crowded email inboxes.',
  '["TOF: .in web push+email vs .com intrusive email popups","Urgency: .in multi-tier announcement bars vs .com passive shipping line","Merch: .in routine/health kits vs .com luxury hand-painted + gift boxes","Retargeting: .in free owned push vs .com paid Meta dependence"]'::jsonb,
  '["benchmark","architecture","conversion","retention"]'::jsonb, 'US', 'Sneaker', 'summarized', 'strategy-teardown', now()
),
(
  'knickgasm-intel://in-vs-us/us-adaptation-blueprint', 'intel_us_blueprint_v1', 'note',
  'US blueprint: translate .in high-velocity levers to US privacy/brand expectations',
  'How to adapt the Indian levers for US consumers (privacy-sensitive, "spammy"-averse). (1) Elegant web push: minimalist brand-colored card, and pivot the hook from pure discount to exclusivity/VIP — "Want VIP access? Tap allow for limited-edition design drops, back-in-stock alerts, and exclusive subscriber pricing." (2) Result-first PDP hierarchy: transformation outcome above clinical facts — e.g. "One Month. Real Mobility. (How Sarah, 42, got back to morning runs without joint stiffness)" instead of "Organic Embroidery Curcumin Capsules." (3) Push frequency guardrail: cap US browser push at MAX 3/week/user, high-intent only — abandoned-cart (20 min, instant-discount button), price-drop on an item viewed >3×, and one educational longevity tip to a high-converting blog.',
  '["US push hook = exclusivity/VIP, not raw discount","Elegant brand-styled prompt, not neon","Result-first PDP: outcome headline above ingredients","Cap US push at 3/week/user; abandoned-cart + price-drop + edu triggers"]'::jsonb,
  '["web-push","us-market","pdp","frequency-cap","acquisition"]'::jsonb, 'US', 'Streetwear', 'summarized', 'strategy-teardown', now()
)
ON CONFLICT (url_hash) DO UPDATE SET
  title = EXCLUDED.title, summary = EXCLUDED.summary, key_points = EXCLUDED.key_points,
  tags = EXCLUDED.tags, market = EXCLUDED.market, vertical = EXCLUDED.vertical,
  status = EXCLUDED.status, processed_at = now();
