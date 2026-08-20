# Creative evidence

`api/_shared/creative-evidence.js`

Generation used to be grounded in **rules**. It is now also grounded in
**evidence**: what this brand's own audience actually responded to.

## The gap this closed

The planner already did the hard part. It worked out which of the brand's own
campaigns cleared its performance thresholds, pulled their hooks, and stamped
the winner onto the calendar slot as `ownDataReference`. That reached the
confidence score, the rationale and the review panel.

It never reached the copywriter.

Both prompt builders — `strategyPrompt()` and `copyPrompt()` — briefed the
writer with the market, the cohort, the product, the offer, and a flat list of
**competitor** hooks. Every send was written from rules and from other people's
angles, while the evidence sat one field away on the same object.

## The three kinds of evidence

They are not interchangeable, and the brief keeps them apart:

| | What it is | How the writer is told to use it |
|---|---|---|
| **WORKED** | This brand's own campaigns that cleared its own thresholds, quoted with the figures that qualified them | Build on the *pattern* — the angle, the structure, the promise — never reuse the wording |
| **TIRING** | Campaigns below this brand's own median click rate | Do not re-run these angles |
| **COMPETITOR** | Angles rivals repeat, grouped and counted | Awareness only; never copy, never present a rival's claim as ours |

## The rules

Each one is a way this could quietly start lying to the model. They matter more
than the feature.

**A win carries its numbers, or it is not a win.** "Top performer" with nothing
behind it is the most dangerous line you can hand a model: it reads as evidence
and is a claim. Every win prints the metric that qualified it. A campaign whose
metrics are missing is dropped, not promoted on its name.

**ROAS is null for owned email, not zero.** There is no spend behind a lifecycle
send, so return on ad spend is undefined. `normalizeMetric` already returns null
rather than a sentinel; the brief says so rather than printing `0`, which a
model would read as a campaign that lost money.

**No evidence is a state, not an empty string.** A brand that just onboarded has
no history. The brief then *says* there is none and tells the writer to work
from the brand rules — explicitly forbidding an invented past campaign, result,
benchmark or figure. A section that simply vanished would invite the model to
supply its own.

**Fatigue is measured against what we actually have.** The industry phrasing is
"CTR down 20% from peak", which needs a per-creative time series this repo does
not store. That number is therefore not claimed. What *is* computable is a
campaign sitting below this brand's own median, and that is what is reported, in
those words. Under three campaigns there is no median, and fatigue returns
`available: false` with the reason.

**A competitor set that could not be read is not an empty one.** Same rule the
competitor universe already follows: `searched: false` never renders as "no
competitor activity", and the brief says so rather than letting the model
conclude the category is quiet.

## Two defects found by running it

Both would have misled the writer, and neither was visible by reading the code:

1. **A campaign appeared in WORKED and TIRING at once** — the writer was told to
   build on the very angle it was told not to re-run. Whatever the caller
   passes, anything under the brand's own median is not a win here.
2. **Competitor counts were inflated ~4x.** `competitorContext` carries the same
   global trending-hook list on *every* channel row, so summing multiplied one
   sighting by the channel count: a hook seen 4 times was reported as "seen
   16x". Inflating evidence is the same defect as inventing it. Counted with
   `max` now.

## What feeds it

`evidenceFor(entry)` reads only what the planner already stamps on the slot, so
it needs no new plumbing and works inside the existing ~180-slot prebuild queue:

- `entry.ownEvidence.campaigns` — the campaign **set** (trimmed to 8). The
  single rotating `ownDataReference` stays for the rationale: it made a fine
  citation and a poor brief, because a writer needs enough spread to tell a
  strong angle from a tiring one.
- `entry.competitorContext` — per-channel benchmarks and trending hooks.

## What this repo cannot do, and does not pretend to

The common description of this workflow includes "pull every active ad from any
competitor in the Meta Ads Library". **That is not available for commercial D2C
ads outside the EU**, and `meta-adapter.js` already documents it: the
`ads_archive` endpoint covers social issue, electoral and political ads only,
and an empty result "is not evidence that the advertiser runs no ads".

So competitor creative evidence here comes from the sources this repo genuinely
holds — the competitor universe, the captured competitor email archive, and the
channel benchmarks — and is labelled as such. Nothing in the brief claims a
completeness the data does not have.

Likewise, per-creative **fatigue curves**, **audience-overlap CPM premiums** and
**budget pacing** need live ad-account time series. Where a workspace connects
those accounts they become available through the Paid Media tab; until then the
brief reports what is measurable and names what is not.

## Tests

`tests/creative-evidence.spec.js` (18) runs the module rather than reading it:
each rule above has a test, both discovered defects have one, and one test
builds a real campaign to confirm evidence attaches without breaking the asset
contracts. Both defects were re-introduced to confirm the tests catch them.
