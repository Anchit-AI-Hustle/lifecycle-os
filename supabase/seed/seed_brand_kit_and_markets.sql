-- ═══════════════════════════════════════════════════════════════════════════
-- Seed: brand_kit (from official PDF) + market_config (7 markets)
-- Truth source: Brand style guide.pdf — only 4 official colours, 2 fonts.
-- ═══════════════════════════════════════════════════════════════════════════

-- BRAND KIT (singleton row) --------------------------------------------------
INSERT INTO public.knickgasm_brand_kit (id, palette, typography, voice, footer_blocks, guide_pdf_url)
VALUES (
  1,
  -- Official 4-colour palette (from PDF page 11)
  '{
    "primary": "#6A33D8",
    "accent":  "#D0473E",
    "bg":      "#F7F5F2",
    "text":    "#111111"
  }'::jsonb,
  -- Official typography (from PDF pages 3-10)
  '{
    "primary": {
      "family": "Montserrat",
      "stack":  "''Montserrat'', Georgia, ''Times New Roman'', serif",
      "usage":  ["headings","sub-heading","titles","hero text"],
      "weights": ["regular","bold"]
    },
    "secondary": {
      "family": "Instrument Sans",
      "stack":  "''Instrument Sans'', ''Helvetica Neue'', Arial, sans-serif",
      "usage":  ["body","paragraph","captions","buttons","footer","labels","nav"],
      "weights": ["thin","light","regular","medium","semibold","bold","extrabold","black"]
    }
  }'::jsonb,
  -- Voice
  '{
    "tone": "Premium, warm, story-led, ethical sourcing. KNICKGASM® is disrupting the 200-year-old supply chain of sneaker.",
    "tagline": "We Care for You, our Farmers & the Environment.",
    "dos": [
      "Lead with farmer / origin story",
      "Cite one-of-one or single-studio provenance",
      "Mention freshness window (studio-to-pair)",
      "Use the ® mark on first KNICKGASM mention",
      "Premium, considered language — never shouty"
    ],
    "donts": [
      "Generic marketing fluff",
      "Aggressive CAPS sale-shouting",
      "Dilute the ® mark",
      "Use unofficial colours (only #6A33D8 / #D0473E / #F7F5F2 / #111111)",
      "Use fonts other than Montserrat (headings) or Instrument Sans (body)"
    ]
  }'::jsonb,
  -- Footer blocks
  '{
    "legal":   "KNICKGASM Pvt. Ltd., New Delhi, India",
    "contact": { "email": "hello@knickgasm.com" },
    "social": [
      { "platform": "instagram", "url": "https://www.instagram.com/knickgasm/" },
      { "platform": "facebook",  "url": "https://www.facebook.com/knickgasm/" },
      { "platform": "x",         "url": "https://twitter.com/knickgasm" }
    ],
    "links": {
      "unsubscribe":    "/pages/unsubscribe",
      "privacy_policy": "/pages/privacy-policy",
      "shipping":       "/pages/shipping-policy",
      "returns":        "/pages/returns-and-refunds"
    }
  }'::jsonb,
  null
)
ON CONFLICT (id) DO UPDATE SET
  palette        = EXCLUDED.palette,
  typography     = EXCLUDED.typography,
  voice          = EXCLUDED.voice,
  footer_blocks  = EXCLUDED.footer_blocks,
  updated_at     = now();

-- MARKET CONFIG (7 markets) --------------------------------------------------
INSERT INTO public.knickgasm_market_config
  (market, display_name, flag, base_url, currency, currency_symbol, shipping_note, language, collections, featured_heroes)
VALUES
  ('US',     'United States',  '🇺🇸', 'https://www.knickgasm.com',     'USD', '$',  'Free US shipping over $39',         'en',
   '{"kicks":"/collections/kicks-sneakers","streetwear":"/collections/streetwear-sneakers","gift":"/collections/sneaker-gift-sets","green":"/collections/green-sneakers","black":"/collections/black-sneakers","iced":"/collections/iced-sneaker","hightop":"/collections/hightop-sneakers","caffeineFree":"/collections/scuff-resistant","bestsellers":"/collections/bestsellers"}'::jsonb,
   '["India''s Original Hand-painted Kicks Sneaker","Embroidery Neon Themed Sneaker","Earl Grey Black Sneaker","Signature Green Sneaker"]'::jsonb),

  ('UK',     'United Kingdom', '🇬🇧', 'https://www.knickgasm.com',   'GBP', '£',  'Free UK shipping over £30',         'en',
   '{"kicks":"/collections/kicks-sneakers","streetwear":"/collections/streetwear-sneakers","gift":"/collections/sneaker-gift-sets","green":"/collections/green-sneakers","black":"/collections/black-sneakers","iced":"/collections/iced-sneaker","hightop":"/collections/hightop-sneakers","caffeineFree":"/collections/scuff-resistant","bestsellers":"/collections/bestsellers"}'::jsonb,
   '["India''s Original Hand-painted Kicks Sneaker","Earl Grey Black Sneaker","Jordan First Flush Black Sneaker","English Breakfast Black Sneaker"]'::jsonb),

  ('IN',     'India',          '🇮🇳', 'https://www.knickgasm.in',      'INR', '₹',  'Free shipping pan India over ₹599', 'en',
   '{"kicks":"/collections/kicks-sneakers","streetwear":"/collections/streetwear-sneakers","gift":"/collections/sneaker-gift-sets","green":"/collections/green-sneakers","black":"/collections/black-sneakers","iced":"/collections/iced-sneaker","hightop":"/collections/hightop-sneakers","caffeineFree":"/collections/scuff-resistant","bestsellers":"/collections/bestsellers"}'::jsonb,
   '["India''s Original Hand-painted Kicks Sneaker","Embroidery Neon Themed Sneaker","Chrome Hand-painted Kicks Sneaker","Matte Green Sneaker"]'::jsonb),

  ('Global', 'Global',         '🌍', 'https://www.knickgasm.com',  'USD', '$',  'Worldwide express shipping',        'en',
   '{"kicks":"/collections/kicks-sneakers","streetwear":"/collections/streetwear-sneakers","gift":"/collections/sneaker-gift-sets","green":"/collections/green-sneakers","black":"/collections/black-sneakers","iced":"/collections/iced-sneaker","hightop":"/collections/hightop-sneakers","caffeineFree":"/collections/scuff-resistant","bestsellers":"/collections/bestsellers"}'::jsonb,
   '["India''s Original Hand-painted Kicks Sneaker","Embroidery Neon Themed Sneaker","Earl Grey Black Sneaker","Crimson Cranberry Bling Kicks"]'::jsonb),

  ('ME',     'Middle East',    '🇦🇪', 'https://www.knickgasm.com',  'USD', '$',  'Express shipping to UAE / GCC',     'en',
   '{"kicks":"/collections/kicks-sneakers","streetwear":"/collections/streetwear-sneakers","gift":"/collections/sneaker-gift-sets"}'::jsonb,
   '["Chrome Hand-painted Kicks Sneaker","Goldleaf Kashmiri Sneaker","India''s Original Hand-painted Kicks Sneaker"]'::jsonb),

  ('AU',     'Australia',      '🇦🇺', 'https://www.knickgasm.com',  'USD', '$',  'Express shipping to Australia',     'en',
   '{"kicks":"/collections/kicks-sneakers","streetwear":"/collections/streetwear-sneakers","gift":"/collections/sneaker-gift-sets"}'::jsonb,
   '["India''s Original Hand-painted Kicks Sneaker","Embroidery Neon Themed Sneaker","Earl Grey Black Sneaker"]'::jsonb),

  ('EU',     'Europe',         '🇪🇺', 'https://www.knickgasm.com',  'EUR', '€',  'Express shipping across Europe',    'en',
   '{"kicks":"/collections/kicks-sneakers","streetwear":"/collections/streetwear-sneakers","gift":"/collections/sneaker-gift-sets"}'::jsonb,
   '["India''s Original Hand-painted Kicks Sneaker","Earl Grey Black Sneaker","Jordan First Flush Black Sneaker"]'::jsonb)
ON CONFLICT (market) DO UPDATE SET
  display_name    = EXCLUDED.display_name,
  flag            = EXCLUDED.flag,
  base_url        = EXCLUDED.base_url,
  currency        = EXCLUDED.currency,
  currency_symbol = EXCLUDED.currency_symbol,
  shipping_note   = EXCLUDED.shipping_note,
  collections     = EXCLUDED.collections,
  featured_heroes = EXCLUDED.featured_heroes,
  updated_at      = now();
