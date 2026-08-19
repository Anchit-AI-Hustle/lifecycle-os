# Asset contracts

*Each asset type is built to its own medium's logic, and the finished artefact
is checked against it.*

Source: `api/_shared/asset-contracts.js`. Tests: `tests/asset-contracts.spec.js`.

---

## The problem this solved

`api/_shared/asset-specs.js` has held the real dimensions, safe areas and copy
limits for every placement for a long time. Exactly **one** file consumed it:
`master-prompt.js`, which pastes it into a prompt.

So the rules reached the model as prose, and three things followed:

1. **Every renderer re-typed the numbers.** `scripts/lib/ad-creative.js` clamped
   to its own literal `125` / `40` / `30` and `30` / `90`. The spec and the thing
   that actually shipped could drift apart with nothing to notice.
2. **One copy pass wrote everything.** Email, landing page and all three ad
   platforms came out of a single call, so an ad was mailer thinking poured into
   an ad-shaped field rather than something designed as an ad.
3. **Nothing checked the finished asset.** A Google headline three characters
   over the limit was discovered by Google.

---

## What a contract is

For one asset type:

| Part | Meaning |
|---|---|
| `structure` | The ordered slots that asset has **in its medium**, each with its limit and the reason the medium imposes it. |
| `design` | Layout rules that belong to that surface and no other. |
| `algorithm` | The ordered steps by which this asset type is made. |
| `validate()` | The finished artefact, judged against all of the above. |

Six contracts today: `email.mailer`, `ad.meta.static`, `ad.meta.video`,
`ad.google.rsa`, `ad.tiktok.video`, `landing.page`.

---

## The mediums are genuinely different

This is the point of the split, and a test asserts it has not collapsed back
into one set of rules relabelled.

| Asset | The logic that is actually its own |
|---|---|
| **Email** | No JavaScript. Outlook renders with the Word engine, so the layout is tables at a fixed column width. It must be **complete with images disabled**, and an animation may only hide content inside the same gated block that animates it — or a client that strips animation paints the mailer permanently invisible. |
| **Landing page** | The only surface that owns its scroll and runs scripts, so scroll-driven reveals and pointer effects live here and nowhere else. Content must still be present with JavaScript off. |
| **Google RSA** | **No layout at all.** Google assembles the combination, so every headline must stand alone, no two may repeat, and any pair may appear together. |
| **Meta static** | Placement-first: the safe area changes what can be composed, and the primary text sits behind a *More* link, so the frame must carry the message with the copy unread. |
| **Meta / TikTok video** | Judged on the first second, must work silent, and must have an artefact that can actually be played. A storyboard is not an asset. |

---

## Two rules that keep it honest

### 1. Numbers are read, never re-typed

Every limit is pulled from `asset-specs.js` at require time. A slot the spec has
no number for is **declared unbounded** rather than quietly given one:

```js
{ slot: 'intro_paragraph', required: true,
  ...unbounded('Length is an editorial choice, not a platform limit.') }
```

If a contract wants a number the spec does not carry, that is a gap in the spec
and it is declared as one. One number, one place.

### 2. A limit this repo cannot source does not block

A constraint is `verified` only where this repo **already refuses to send** copy
that breaks it:

| Constraint | Why it is verified |
|---|---|
| Google headline ≤ 30 | `google-ads-adapter.js` **drops** headlines over 30 rather than truncating them |
| Google description ≤ 90 | same adapter drops them |
| Google headlines ≤ 15 | the adapter caps the array before building the request |
| Google path ≤ 15 | the adapter slices `path1`/`path2` |

Everything else is **advisory** and reports as `warn`. A gate that blocks on a
number nobody checked is worse than no gate, and this deployment cannot reach the
platforms' own documentation to confirm the rest.

A test walks every `verified` claim and fails if the file it names does not
contain the enforcement — otherwise "verified" is just a more confident guess.

### Validation never rewrites copy

Truncating to fit is how a sentence becomes a fragment nobody wrote. The
operator sees what is wrong and which rule it broke.

---

## Where it runs

- **Briefing.** `brandSystem()` in `smart-brain-plan.js` briefs the copywriter
  with `contracts.brief(id)` per asset type — the same rules the validator
  applies, so the writer and the check cannot disagree.
- **Checking.** `checkAssetContracts(campaign)` runs after the assets are built,
  attaches `contract_check` to each asset and a summary to the campaign.

```js
const { check } = require('./asset-contracts.js');

check({ platform: 'google', headlines: ['…'], descriptions: ['…'] });
// → { ok, contract: 'ad.google.rsa', violations: [{level, slot, message}], blocking }
```

An asset type with no contract yet returns `contract: null` **and says so**,
rather than reading as approved.

### Routing is per creative type, not per platform

`contractFor()` picks the contract from `platform` **and** `creative_type`. It
used to send every TikTok ad to `ad.tiktok.video`, while Meta beside it branched
correctly — and the ad builder produces an A/B pair per platform, one video and
one static. So every TikTok still was judged as a video and reported three
violations it could not satisfy: a script, a video caption limit, and a motion
artefact a still image does not have.

A false block is not a safe failure. Blocks are overridable by design, and a
gate that routinely blocks things it misread teaches the operator that
overriding is routine — which is exactly the habit the next real block has to
survive. `ad.tiktok.static` exists for this, built from the same `asset-specs`
numbers as everything else: `asset-specs` records one produced TikTok placement,
in-feed 9:16, noted "video / cover", so the still this app builds for TikTok is
a cover frame judged on the frame and the safe areas, and on nothing that only a
video has.

## The app builds to its own contracts

The check is worth as much as what it is pointed at. Running one campaign
through the real builders on the **noLLM** path — the offline republish, and any
run where the provider cascade is unkeyed or rate-limited — reported seven
blocking violations and a warning against the app's own output. All five causes
were real, and all had shipped:

- The template mailer was `<main>`/`<section>` with `max-width` and an
  inline-block `<a>`. Outlook on Windows renders with the **Word** engine: it
  ignores `max-width`, so the email spanned the window, and it drops background
  on an inline-block anchor, so the CTA arrived as underlined text with no
  button behind it. It is now a 600px table with `bgcolor` beside every CSS
  background and a CTA whose colour comes from its `<td>`.
- The landing page's call to action was a `<button>` with no form and no
  handler. The one thing the page exists to do did nothing when clicked.
- Video ads carried a caption and a hook but no `primary_text` and no
  `headline` — the fields Meta requires on a video ad exactly as on a static
  one. Two blocking violations on every build.
- TikTok stills were routed to the video contract (above).
- `attachMotionCreative` ran only inside the LLM branch, so every noLLM build
  shipped video ads with nothing to play — despite the artefact needing no model
  to build. It now runs on both paths and skips any ad that already has one.

`tests/generation-quality.spec.js` builds a campaign and asserts the app's own
output reaches **zero blocking violations and zero warnings**, so the floor
cannot quietly drop again.

---

## Adding a contract

1. Add the placement's real numbers to `asset-specs.js` if they are not there.
2. Add the contract to `CONTRACTS`, reading limits from the spec.
3. Mark a constraint `verified` **only** if this repo enforces it somewhere, and
   name that file in `VERIFIED_SOURCES`.
4. Teach `contractFor()` how to recognise the asset.
5. Add the medium-specific failure to the test file — the one that is unique to
   that surface, not another length check.
