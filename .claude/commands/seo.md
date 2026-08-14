---
name: seo
description: Run an SEO/AEO audit for the active brand's content or pages, backed by Ahrefs data.
argument-hint: "[target, e.g. '<collection> page' or a URL]"
---

# SEO / AEO audit

## Before you start — resolve the brand

Run `/brand-context` first (or confirm it has already run this session). Every
fact, product, price, URL, claim, colour and product noun below must come from
the ACTIVE brand's own record, never from tenant zero. A field the brand has not
published is written `[DATA REQUIRED BEFORE LAUNCH: field, product, region]` -
never filled with a plausible value.


Audit: `$ARGUMENTS`.

## Method
1. Pull keyword/backlink/ranking data from the **Ahrefs** connector (volumes, difficulty, gaps, competitor overlap).
2. Run **`marketing:seo-audit`** for the structured checklist (technical, on-page, content, intent).
3. For AI-answer surfaces, apply AEO best practices (structured data, answer-first content, EEAT).

## the active brand specifics
- Map to the right market store (`knickgasm.com`, `uk.`, `eu.`, etc.) and PDP/collection URL structure.
- Keep all suggested copy on-brand: no banned phrases, preferred lexicon (ritual, origin, one-of-one…), P01 happiness-first.

## Output
Prioritized findings (impact × effort) → keyword opportunities → on-page fixes → content recommendations that route into `/campaign-plan` or `/landing-page`.
