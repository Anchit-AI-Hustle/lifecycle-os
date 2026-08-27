-- ── Credit pack prices ──────────────────────────────────────────────────────
-- What a recharge pack COSTS IN MONEY, set by whoever operates the deployment.
--
-- credit-catalog.js declares how many CREDITS each pack grants — that is this
-- platform's own internal unit and belongs in versioned code. It deliberately
-- declares NO money price: a price depends on the operator's costs, market and
-- currency, and a plausible number written into the repo would read as a
-- decided one. So the price lives here, and a pack with no row is not
-- purchasable and says so rather than rendering a buy button.
--
-- `credit_orders` has carried `amount_minor` and `currency` since the first
-- credits migration and nothing ever populated them. Now createOrder does.

create table if not exists public.credit_pack_prices (
  pack_key     text primary key,
  currency     text   not null check (currency ~ '^[A-Z]{3}$'),
  -- The smallest unit of that currency: paise, cents. Never a major-unit float.
  -- Money in a float is a rounding error waiting for a reconciliation.
  amount_minor bigint not null check (amount_minor >= 0),
  note         text,
  updated_at   timestamptz not null default now()
);

comment on column public.credit_pack_prices.amount_minor is
  'Price in the smallest unit of `currency` (paise for INR, cents for USD). '
  'The exponent is resolved with Intl at render time, so a zero-decimal '
  'currency such as JPY is not silently multiplied by a hundred.';

alter table public.credit_pack_prices enable row level security;

-- Readable by any signed-in user: a price is something a buyer must be able to
-- see. Writes are service-role only — the same rule as credit_prices, and the
-- reason there is no insert/update policy here at all.
do $$ begin
  create policy "pack prices readable by all signed-in" on public.credit_pack_prices
    for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;

-- No seed rows. Seeding this table with example figures would put a fabricated
-- price in front of a real buyer on the first deploy, which is exactly what
-- leaving the catalog price null exists to prevent.
