-- ── Razorpay: one payment id marks one order paid, ever ─────────────────────
-- api/_shared/razorpay-credits.js records a Razorpay purchase as an ordinary
-- credit_orders row with provider = 'razorpay'. Its provider_ref holds
-- Razorpay's ORDER id while the purchase is pending and the PAYMENT id once
-- credit_fulfil_order() marks it paid (that function writes p_ref over it).
--
-- The application already credits a purchase once: credit_fulfil_order() is a
-- compare-and-set on status = 'pending', and credit_ledger_topup_once_idx
-- refuses a second top-up for one order. This index is the backstop for the
-- other direction: the same Razorpay id can never sit on two orders, so one
-- payment can never pay for two packs, whatever a caller sends.
--
-- Additive and idempotent. The code does not depend on it being applied: a
-- database without it still credits once per order.

create unique index if not exists credit_orders_razorpay_ref_once_idx
  on public.credit_orders (provider_ref)
  where provider = 'razorpay' and provider_ref is not null;

-- Lookups by Razorpay id (the callback and the webhook carry no session).
create index if not exists credit_orders_provider_ref_idx
  on public.credit_orders (provider, provider_ref)
  where provider_ref is not null;
