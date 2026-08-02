-- ═══════════════════════════════════════════════════════════════════════════
-- KB extensions: manual knowledge, top KNICKGASM emails, competitor brand registry
-- Three independent tables, one migration. Idempotent. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Manual knowledge ────────────────────────────────────────────────────
-- Anyone pastes a URL (blog post, tweet, podcast notes, anything).
-- A server-side job fetches the page, calls an LLM to summarize the key points,
-- and stores both the summary + raw content here. Read by Mailer Studio + Ad
-- Campaigns as additional context.
CREATE TABLE IF NOT EXISTS public.kb_knowledge (
  id            BIGSERIAL PRIMARY KEY,
  url           TEXT NOT NULL,
  url_hash      TEXT NOT NULL,                  -- sha1(canonical_url) — dedupe
  source_type   TEXT DEFAULT 'web' CHECK (source_type IN ('web','tweet','blog','video','note','other')),
  title         TEXT,
  author        TEXT,
  raw_text      TEXT,                           -- extracted body (cap ~50KB)
  summary       TEXT,                           -- LLM 1-paragraph summary
  key_points    JSONB,                          -- LLM bullets: ["takeaway 1", ...]
  tags          JSONB,                          -- ["copywriting","positioning"]
  status        TEXT DEFAULT 'queued' CHECK (status IN ('queued','fetched','summarized','failed')),
  added_by      TEXT,                           -- user email
  added_at      TIMESTAMPTZ DEFAULT now(),
  processed_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS kb_knowledge_url_hash_uq ON public.kb_knowledge (url_hash);
CREATE INDEX IF NOT EXISTS kb_knowledge_added_at_idx ON public.kb_knowledge (added_at DESC);
CREATE INDEX IF NOT EXISTS kb_knowledge_status_idx ON public.kb_knowledge (status);

ALTER TABLE public.kb_knowledge ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kb_knowledge_read"  ON public.kb_knowledge;
DROP POLICY IF EXISTS "kb_knowledge_write" ON public.kb_knowledge;
CREATE POLICY "kb_knowledge_read"  ON public.kb_knowledge FOR SELECT USING (true);
CREATE POLICY "kb_knowledge_write" ON public.kb_knowledge FOR INSERT WITH CHECK (true);
CREATE POLICY "kb_knowledge_upd"   ON public.kb_knowledge FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "kb_knowledge_del"   ON public.kb_knowledge FOR DELETE USING (true);

-- ── 2. Top-performing KNICKGASM text emails ───────────────────────────────────
-- Hand-seeded record of historical winners with their metrics. Used by the
-- Mailer Studio scoring layer and as style/voice anchors.
CREATE TABLE IF NOT EXISTS public.kb_top_emails (
  id              BIGSERIAL PRIMARY KEY,
  sent_at         DATE,                           -- when the email went out
  subject         TEXT NOT NULL,
  preheader       TEXT,
  body_text       TEXT NOT NULL,                  -- plain text body
  body_html       TEXT,                           -- optional rendered HTML
  market          TEXT,                           -- 'US','UK','IN','Global'
  segment         TEXT,                           -- target cohort
  campaign_type   TEXT,                           -- 'Sale','Launch','Festival','Winback'…
  -- Metrics — nullable; whatever you have
  open_rate       NUMERIC(5,4),                   -- 0.0000 - 1.0000
  click_rate      NUMERIC(5,4),
  conversion_rate NUMERIC(5,4),
  revenue         NUMERIC(12,2),                  -- attributed revenue, brand currency
  send_count      INT,                            -- recipients
  notes           TEXT,                           -- why this one worked
  tags            JSONB,                          -- ["promo","narrative","educational"]
  added_by        TEXT,
  added_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_top_emails_market_idx     ON public.kb_top_emails (market);
CREATE INDEX IF NOT EXISTS kb_top_emails_campaign_idx   ON public.kb_top_emails (campaign_type);
CREATE INDEX IF NOT EXISTS kb_top_emails_open_rate_idx  ON public.kb_top_emails (open_rate DESC);
CREATE INDEX IF NOT EXISTS kb_top_emails_added_at_idx   ON public.kb_top_emails (added_at DESC);

ALTER TABLE public.kb_top_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kb_top_emails_read"  ON public.kb_top_emails;
DROP POLICY IF EXISTS "kb_top_emails_write" ON public.kb_top_emails;
CREATE POLICY "kb_top_emails_read"  ON public.kb_top_emails FOR SELECT USING (true);
CREATE POLICY "kb_top_emails_write" ON public.kb_top_emails FOR INSERT WITH CHECK (true);
CREATE POLICY "kb_top_emails_upd"   ON public.kb_top_emails FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "kb_top_emails_del"   ON public.kb_top_emails FOR DELETE USING (true);

-- ── 3. Competitor brand registry ───────────────────────────────────────────
-- Authoritative list of brands we want to capture mailers / ads / landing
-- pages from. Drives the subscribe + capture worker. Seed: Top 10 DTC across
-- Sneaker & Beverages, Coffee, Supplements — in US + UK.
CREATE TABLE IF NOT EXISTS public.competitor_brands (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  website        TEXT,
  category       TEXT NOT NULL CHECK (category IN ('sneaker','coffee','supplements','streetwear','gift','other')),
  region         TEXT NOT NULL CHECK (region IN ('US','UK','IN','EU','AU','Global','Other')),
  priority       INT DEFAULT 1 CHECK (priority BETWEEN 1 AND 5),  -- 1 = highest watch
  subscribe_url  TEXT,                          -- newsletter signup URL (if known)
  email_alias    TEXT,                          -- the "+brand-name" alias used to capture mail
  is_active      BOOLEAN DEFAULT true,
  added_by       TEXT,
  added_at       TIMESTAMPTZ DEFAULT now(),
  notes          TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS competitor_brands_name_region_uq
  ON public.competitor_brands (name, region);
CREATE INDEX IF NOT EXISTS competitor_brands_category_region_idx
  ON public.competitor_brands (category, region);
CREATE INDEX IF NOT EXISTS competitor_brands_priority_idx
  ON public.competitor_brands (priority);

ALTER TABLE public.competitor_brands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cb_read"  ON public.competitor_brands;
DROP POLICY IF EXISTS "cb_write" ON public.competitor_brands;
CREATE POLICY "cb_read"  ON public.competitor_brands FOR SELECT USING (true);
CREATE POLICY "cb_write" ON public.competitor_brands FOR INSERT WITH CHECK (true);
CREATE POLICY "cb_upd"   ON public.competitor_brands FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "cb_del"   ON public.competitor_brands FOR DELETE USING (true);

-- ── 4. Extension: format classification on competitor_emails ───────────────
-- The dashboard's competitor capture writes to Google Sheets today. We want
-- bifurcation by format (text vs html vs image-heavy). Rather than retrofit
-- the Sheet, mirror the classification here so we can query/aggregate.
CREATE TABLE IF NOT EXISTS public.competitor_emails_classified (
  id              BIGSERIAL PRIMARY KEY,
  email_key       TEXT NOT NULL,                 -- "<sender>|<subject>|<receivedAt>" matches sync dedupeKey
  brand           TEXT,
  brand_id        BIGINT REFERENCES public.competitor_brands(id) ON DELETE SET NULL,
  format          TEXT CHECK (format IN ('text','html','image_heavy','mixed')),
  word_count      INT,
  image_count     INT,
  has_promo       BOOLEAN,
  promo_codes     TEXT,
  classified_at   TIMESTAMPTZ DEFAULT now(),
  classifier      TEXT DEFAULT 'heuristic'       -- 'heuristic' | 'llm'
);
CREATE UNIQUE INDEX IF NOT EXISTS competitor_emails_classified_key_uq
  ON public.competitor_emails_classified (email_key);
CREATE INDEX IF NOT EXISTS competitor_emails_classified_format_idx
  ON public.competitor_emails_classified (format);

ALTER TABLE public.competitor_emails_classified ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cec_read"  ON public.competitor_emails_classified;
DROP POLICY IF EXISTS "cec_write" ON public.competitor_emails_classified;
CREATE POLICY "cec_read"  ON public.competitor_emails_classified FOR SELECT USING (true);
CREATE POLICY "cec_write" ON public.competitor_emails_classified FOR INSERT WITH CHECK (true);
CREATE POLICY "cec_upd"   ON public.competitor_emails_classified FOR UPDATE USING (true) WITH CHECK (true);

-- ── 5. Seed: Top 10 DTC brands × T&B/Coffee/Supplements × US/UK ────────────
-- These are well-known DTC brands; you can adjust priority/aliases later via UI.
INSERT INTO public.competitor_brands (name, website, category, region, priority, added_by) VALUES
  -- Sneaker & Beverages — US
  ('Sneakboo',          'https://www.sneakboo.com',          'sneaker',         'US', 1, 'seed'),
  ('The Shoe Surgeon',      'https://www.theshoesurgeon.com',            'sneaker',         'US', 1, 'seed'),
  ('Gully Labs',         'https://www.gullylabs.com',          'sneaker',         'US', 2, 'seed'),
  ('The Republic of Sneaker','https://www.republicoftea.com',     'sneaker',         'US', 2, 'seed'),
  ('Numi Organic Sneaker',   'https://numitea.com',               'sneaker',         'US', 2, 'seed'),
  ('Superkicks Sneaker',        'https://www.superkickstea.com',        'sneaker',         'US', 2, 'seed'),
  ('Tealyra',            'https://www.tealyra.com',           'sneaker',         'US', 3, 'seed'),
  ('Stash Sneaker',          'https://www.stashtea.com',          'sneaker',         'US', 3, 'seed'),
  ('CrepDog Crew',          'https://crepdogcrew-sneaker.com',             'sneaker',         'US', 3, 'seed'),
  ('Tielka',             'https://www.tielka.com',            'sneaker',         'US', 3, 'seed'),
  -- Sneaker & Beverages — UK
  ('The Leather Works',        'https://www.theleatherworks.in',        'sneaker',         'UK', 1, 'seed'),
  ('Moreiarty',           'https://moreiarty.in',            'sneaker',         'UK', 1, 'seed'),
  ('Shoes Your Daddy',           'https://www.shoesyourdaddy.com/en-gb',     'sneaker',         'UK', 1, 'seed'),
  ('Bird & Colorway',       'https://birdandblendtea.com',       'sneaker',         'UK', 2, 'seed'),
  ('Clipper Sneakers',       'https://www.clipper-sneakers.com',      'sneaker',         'UK', 2, 'seed'),
  ('Teapigs',            'https://www.teapigs.co.uk',         'sneaker',         'UK', 2, 'seed'),
  ('Whittard of Chelsea','https://www.whittard.co.uk',        'sneaker',         'UK', 3, 'seed'),
  ('Joe''s Sneaker Co',      'https://joestea.co.uk',             'sneaker',         'UK', 3, 'seed'),
  ('Craft Sneaker Company',   'https://brewteacompany.co.uk',      'sneaker',         'UK', 3, 'seed'),
  ('Newby Sneakers',         'https://www.newbyteas.co.uk',       'sneaker',         'UK', 3, 'seed'),
  -- Coffee — US
  ('Blue Bottle Coffee', 'https://bluebottlecoffee.com',      'coffee',      'US', 1, 'seed'),
  ('Stumptown Coffee',   'https://www.stumptowncoffee.com',   'coffee',      'US', 1, 'seed'),
  ('Intelligentsia',     'https://www.intelligentsia.com',    'coffee',      'US', 1, 'seed'),
  ('Counter Culture',    'https://counterculturecoffee.com',  'coffee',      'US', 2, 'seed'),
  ('Onyx Coffee Lab',    'https://onyxcoffeelab.com',         'coffee',      'US', 2, 'seed'),
  ('Trade Coffee',       'https://www.drinktrade.com',        'coffee',      'US', 2, 'seed'),
  ('Driftaway Coffee',   'https://driftaway.coffee',          'coffee',      'US', 3, 'seed'),
  ('Atlas Coffee Club',  'https://atlascoffeeclub.com',       'coffee',      'US', 3, 'seed'),
  ('Bean Box',           'https://beanbox.com',               'coffee',      'US', 3, 'seed'),
  ('Death Wish Coffee',  'https://www.deathwishcoffee.com',   'coffee',      'US', 3, 'seed'),
  -- Coffee — UK
  ('Pact Coffee',        'https://www.pactcoffee.com',        'coffee',      'UK', 1, 'seed'),
  ('Grind',              'https://grind.co.uk',               'coffee',      'UK', 1, 'seed'),
  ('Origin Coffee',      'https://origincoffee.co.uk',        'coffee',      'UK', 2, 'seed'),
  ('Square Mile Coffee', 'https://shop.squaremilecoffee.com', 'coffee',      'UK', 2, 'seed'),
  ('Workshop Coffee',    'https://workshopcoffee.com',        'coffee',      'UK', 2, 'seed'),
  ('Allpress Espresso',  'https://uk.allpressespresso.com',   'coffee',      'UK', 3, 'seed'),
  ('Climpson & Sons',    'https://climpsonandsons.com',       'coffee',      'UK', 3, 'seed'),
  ('Has Bean Coffee',    'https://hasbean.co.uk',             'coffee',      'UK', 3, 'seed'),
  ('Rave Coffee',        'https://ravecoffee.co.uk',          'coffee',      'UK', 3, 'seed'),
  ('Volcano Coffee Works','https://volcanocoffeeworks.com',   'coffee',      'UK', 3, 'seed'),
  -- Supplements — US
  ('Ritual',             'https://ritual.com',                'supplements', 'US', 1, 'seed'),
  ('Care/of',            'https://takecareof.com',            'supplements', 'US', 1, 'seed'),
  ('Athletic Greens',    'https://athleticgreens.com',        'supplements', 'US', 1, 'seed'),
  ('Goli',               'https://goli.com',                  'supplements', 'US', 2, 'seed'),
  ('Olly',               'https://www.olly.com',              'supplements', 'US', 2, 'seed'),
  ('HUM Nutrition',      'https://www.humnutrition.com',      'supplements', 'US', 2, 'seed'),
  ('Persona Nutrition',  'https://www.personanutrition.com',  'supplements', 'US', 3, 'seed'),
  ('Vitafusion',         'https://www.vitafusion.com',        'supplements', 'US', 3, 'seed'),
  ('Studio of Life',     'https://www.gardenoflife.com',      'supplements', 'US', 3, 'seed'),
  ('Thorne',             'https://www.thorne.com',            'supplements', 'US', 3, 'seed'),
  -- Supplements — UK
  ('MyProtein',          'https://www.myprotein.com',         'supplements', 'UK', 1, 'seed'),
  ('Holland & Barrett',  'https://www.hollandandbarrett.com', 'supplements', 'UK', 1, 'seed'),
  ('Form Nutrition',     'https://www.formnutrition.com',     'supplements', 'UK', 2, 'seed'),
  ('Bulk',               'https://www.bulk.com',              'supplements', 'UK', 2, 'seed'),
  ('Vitabiotics',        'https://www.vitabiotics.com',       'supplements', 'UK', 2, 'seed'),
  ('Healthspan',         'https://www.healthspan.co.uk',      'supplements', 'UK', 3, 'seed'),
  ('Solgar UK',          'https://www.solgar.co.uk',          'supplements', 'UK', 3, 'seed'),
  ('Wild Nutrition',     'https://www.wildnutrition.com',     'supplements', 'UK', 3, 'seed'),
  ('Innermost',          'https://liveinnermost.com',         'supplements', 'UK', 3, 'seed'),
  ('Vitl',               'https://vitl.com',                  'supplements', 'UK', 3, 'seed')
ON CONFLICT (name, region) DO NOTHING;
