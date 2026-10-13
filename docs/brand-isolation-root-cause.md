# Two live brand records mixed brands: root cause and guard (2026-10-13)

PR #222 repaired the two live rows with a migration (`20261012180000_repair_mixed_brand_records.sql`).
This note explains how they got that way, and what now stops it from happening again.

## What the rows held

The data below was read with read-only SELECTs on 2026-10-11 (`tests/fixtures/live-mixed-brands-2026-10-11.json`).

| Row | Website | Slug | What came from another brand |
|---|---|---|---|
| "Lenskart" (created 2026-10-05) | lenskart.com | `mamaearth` | <ul><li>palette primary `#ffa517` (Deli Chic's orange)</li><li>name and tagline read from mamaearth.in</li><li>logo and icon from delichic.co.in</li><li>Nike's hosts in `asset_hosts`</li><li>56 Deli Chic products</li></ul> |
| "Nykaa" (created 2026-10-11) | nykaa.com | `othertea-teas` | <ul><li>type scale read from othertea.com</li><li>region code `IND`</li></ul> |

## Root cause: one row was reused for four brands

1. **The rows were renamed and re-pointed instead of being created new.**
   - The Lenskart row's history (`field_origins`, `brand_extraction.applied`, `coherence.overrides`) shows one workspace id going through four brands: Mamaearth (mamaearth.in), then a website on nike.in, then DelhiChic / Deli Chic (delichic.co.in), then Lenskart (lenskart.com).
   - Each step kept the row's id, its slug (a slug follows the name only on create) and every value the next brand's read did not overwrite.
   - The Nykaa row was started from an othertea.com read, then renamed and pointed at nykaa.com.
2. **The guard only covered "established" records.** `brand-coherence.identityChangeRefusal()` refused a re-point or rename only when the record's name agreed with its site. These records were already mixed: the Lenskart row's name had been read from mamaearth.in while its website was elsewhere. So the guard returned `null` and every later change went through.
3. **Overrides made the mix permanent.**
   - The operator activated with `coherence_override` (reason: a URL) and pressed "Keep this" on cross-domain values: Nike asset hosts, a Mamaearth palette slot.
   - These choices are recorded and permitted by design, so activation and generation stopped reporting the conflict.
4. **The region code was saved as typed.** `normalizeRegions()` upper-cased the code and kept it, so `IND` was stored. No catalogue lookup reads `IND` as India.
5. **Nothing below the application checked any of it.** The database accepted any website change from any writer.

Each of these paths existed before the 2026-10-11 coherence work. That work (sections "A brand set up or changed uses ONLY its current context" and "A catalogue import reads THIS brand's store" in CLAUDE.md) closed some of them: it sets aside a foreign read, refuses a typed off-site URL, and makes a catalogue on another site never reach generation. It did not close (2), (4) or (5).

## Guards added

### Runtime assertion (app)

`identityChangeRefusal()` now applies to every record that has a website. The block is byte-identical in `api/_shared/brand-coherence.js` and `brand-context.js`, so the server and the device enforce the same rule.

- **Changing the website** is allowed only when the new site is:
  - the same brand (`sameBrand`, for example nike.in to nike.com), or
  - the site the record's name was read from (the repair of a mixed record), or
  - a site the current name fits.

  Anything else is `409 brand_change_refused`: start a new brand.
- **Renaming** is refused when the new name neither fits the site nor shares a word with the old name.
- **Region codes** are saved in their one market spelling (`brand-locale.family`: IND becomes IN, GB becomes UK), on the server and the device.

### Database check (migration)

`20261013010000_brand_identity_guard.sql` adds trigger `brand_workspaces_identity_guard`, which refuses the same writes for every writer: an old tab, a script, or the SQL editor.

- **Website re-point:** refused when the new site is a different registrable brand, unless it is a site the current name fits or the site the name was read from.
- **Region code:** refused unless it is two capital letters or `GLOBAL`.
- **Escape hatch:** an operator-approved repair runs inside its transaction with `select set_config('lifecycle.brand_repoint', 'repair', true);`.
- **Parity:** the SQL brand label is parity-tested against `brand-coherence.js`.

### Tests

`tests/brand-identity-guard-sql.spec.js`, executed on PGlite:

- the live Lenskart sequence, replayed, is refused at the re-point;
- the allowed cases pass;
- `IND` is refused;
- the repair setting is transaction-local;
- the SQL and JS brand labels agree on 13 host shapes;
- the 2026-10-12 repair still applies with the trigger installed;
- the app rule and region canonicalisation are executed too.

## Live state after the repair (read-only, 2026-10-13)

- **Workspaces:** two.
  - Lenskart: slug `lenskart`, website lenskart.com.
  - Nykaa: slug `nykaa`, website nykaa.com.
- **Catalogue:** the 56 Deli Chic products under Lenskart are marked `stale_at`. They are kept, but never served or used.
