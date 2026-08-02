---
description: Design and (optionally) build a Knickgasm lifecycle email/SMS flow in Klaviyo.
argument-hint: "[flow, e.g. 'post-purchase ritual education series, 4 emails']"
---

# Lifecycle email/SMS flow

Design the flow described in `$ARGUMENTS`.

## Method
1. Run **`marketing:email-sequence`** to structure the sequence (triggers, timing, branching, goals).
2. Ground it in **Klaviyo** (connector — authenticate via the Klaviyo MCP if not connected): inspect existing flows/segments/metrics so you extend rather than duplicate; identify the trigger event and target segment.
3. For each email, generate the creative via **`/mailer`** (brand-locked HTML). For SMS, write tight on-brand copy (no banned phrases, P01 happiness-first).

## Output
- Sequence map: step → delay → audience → content → success metric.
- The mailer HTML for each step.
- If authorized, push templates/flow scaffolding into Klaviyo; otherwise hand off copy + HTML ready to paste.

Tie measurement back to `/analytics`.
