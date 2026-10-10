/**
 * PIN-only sign-in (2026-10-09) - RETIRED 2026-10-10.
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
 * WHAT IT HELD. It held the PIN rules (claimed tries, the 4-digit rule, the burst race), the refusal of a Google session at requireUser / the analytics gate / op=me, and the rail offering only the mobile panel - every one of which is now the opposite of the product's rule.
 *
 * WHERE THE SECURITY PROPERTIES WENT. tests/google-only-signin.spec.js
 * executes the switch-off itself (op=enter refused for every method with no
 * store or network touched; a LIVE Neon session, the old device principal, a
 * Supabase phone account and a forged JWT all refused; no phone or PIN control
 * on any page in any state; a stored phone session ended on boot with its
 * device brands kept). tests/agents-executed.spec.js, tests/agents-review.spec.js
 * and tests/standalone-no-database.spec.js hold "no anonymous or phone caller
 * reaches a model or a store" for every agent action. The file's last version
 * is in git history (`git log -- tests/pin-only-signin.spec.js`).
 */
