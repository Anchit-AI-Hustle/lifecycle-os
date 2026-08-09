-- ═══════════════════════════════════════════════════════════════════════════
-- Seed: brand_kit (from official PDF) + market_config (7 markets)
-- Truth source: the live knickgasm.com theme (--color-primary #D0473E) + verified
-- company records. Palette is exactly 4 colours; typography Montserrat + Instrument Sans.
-- ═══════════════════════════════════════════════════════════════════════════

-- BRAND KIT (singleton row) --------------------------------------------------
-- >>> BRAND-SYNC:brand_kit — generated from data/brands/_default.json, do not edit by hand
INSERT INTO public.knickgasm_brand_kit (id, palette, typography, voice, footer_blocks, guide_pdf_url)
VALUES (
  1,
  '{"primary":"#D0473E","accent":"#6A33D8","bg":"#FFFFFF","text":"#111111"}'::jsonb,
  '{"primary":{"family":"Montserrat","stack":"''Montserrat'',''Raleway'',Arial,sans-serif","usage":["headings","titles","hero text"],"weights":["600","700","800"]},"secondary":{"family":"Instrument Sans","stack":"''Instrument Sans'',''Helvetica Neue'',Arial,sans-serif","usage":["body","buttons","labels","nav"],"weights":["400","500","600"]}}'::jsonb,
  '{"tone":"bold, energetic, youth street-culture; confident and playful, never corporate","tagline":"India''s Largest Sneaker Customisers","dos":["India''s largest sneaker customisers","Made on 100% original brand sneakers","Hand-painted by India''s best artists","Water and scratch resistant designs","Express shipping worldwide to 60+ countries","Free shipping in India and worldwide"],"donts":["wellness journey","transform","liquid gold","game-changer","LIMITED TIME","hurry","don''t miss out","last chance","while supplies last","replica","knock-off","first copy","fake pair"]}'::jsonb,
  '{"legal":"KNICKGASM PRIVATE LIMITED, Ghatkopar West, Mumbai 400086, India","contact":{"email":"hello@knickgasm.com"},"social":[{"platform":"instagram","url":"https://www.instagram.com/knickgasm/"}],"links":{"privacy_policy":"/pages/privacy-policy","shipping":"/pages/shipping-policy","returns":"/pages/returns-and-refunds"}}'::jsonb,
  null
)
ON CONFLICT (id) DO UPDATE SET
  palette = EXCLUDED.palette, typography = EXCLUDED.typography, voice = EXCLUDED.voice,
  footer_blocks = EXCLUDED.footer_blocks, updated_at = now();
-- <<< BRAND-SYNC:brand_kit

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
