/**
 * Sign in with a mobile number and a 4-digit PIN (2026-09-28) - RETIRED 2026-10-10.
 * ---------------------------------------------------------------------------
 * WHY RETIRED. The owner's words: "No signin with mobile number - only Google
 * signin pls". The mobile number + PIN sign-in is switched OFF, not hidden:
 * there is no panel, `public-config.js?action=auth&op=enter` answers 410
 * `pin_signin_removed` before any database, rate limit or GoTrue call, and
 * every gate refuses a phone or device token exactly like no token at all.
 * Nothing this file exercised can be reached from the product any more, so
 * its claims are not "still true" or "now false" - they describe a sign-in
 * that does not exist.
 *
 * WHAT IT HELD. It drove the PIN state machine (server and device copies, their parity, the lockout and its races), the rail's inline panel, the Neon session store and op=enter/me/signout through the shipped handler, and the review findings on all of them.
 *
 * WHERE THE SECURITY PROPERTIES WENT. tests/google-only-signin.spec.js
 * executes the switch-off itself (op=enter refused for every method with no
 * store or network touched; a LIVE Neon session, the old device principal, a
 * Supabase phone account and a forged JWT all refused; no phone or PIN control
 * on any page in any state; a stored phone session ended on boot with its
 * device brands kept). tests/agents-executed.spec.js, tests/agents-review.spec.js
 * and tests/standalone-no-database.spec.js hold "no anonymous or phone caller
 * reaches a model or a store" for every agent action. The file's last version
 * is in git history (`git log -- tests/mobile-pin-signin.spec.js`).
 */
