# Lifecycle OS — Master Product, Engineering & Execution Specification
## Universal Brand Intelligence, Context Synchronization, Production-Grade Creative Pipeline & Guarded Multi-Channel Operations

---

## 1. Mission

Upgrade Lifecycle OS into an evidence-grounded, multi-tenant growth and creative operating system. The platform turns any public brand URL, approved merchant data, campaign objectives, and empirical performance metrics into verified, production-ready marketing assets across email, static ads, short-form video, landing pages, organic social, and brand audio.

Use Fastlane as a reference for seamless workflow progression (URL discovery → competitor intelligence → creative generation → batch review → distribution → performance loop), while adhering strictly to Lifecycle OS's architectural imperatives: zero-fabrication of facts or claims, hard tenant isolation, exact region/market scoping, deterministic contract validation, transparent credit accounting, and guarded live execution.

---

## 2. Repository Invariants & Non-Negotiable Rules

1. **Brand & Tenant Isolation**:
   - Every read and write resolves the authenticated user's active workspace on the server (`api/_shared/brand-workspace-core.js`).
   - Client-supplied workspace IDs are never trusted without server-side validation.
   - Another tenant's catalog, assets, claims, palette, or history must never be substituted as fallback data.
   - Switching brands immediately redirects subsequent operations to the new brand context.

2. **Factual Integrity & Zero Fabrication**:
   - The platform never invents products, SKUs, prices, discounts, testimonials, clinical claims, ratings, or campaign metrics.
   - Every material factual statement must link to an approved source record or be flagged with an unpadded marker (`[DATA REQUIRED BEFORE LAUNCH: <field>, <brand>]`).
   - System distinguishes observed facts, approved claims, creative hypotheses, model suggestions, and external competitor observations. Missing data remains explicitly visible.

3. **Execution Integrity**:
   - A generated prompt is not a finished asset.
   - A generated asset is not an approved asset.
   - An approved asset is not a published asset.
   - A queued task is not a confirmed publication.
   - A provider failure is reported truthfully; failed metered runs release credit reservations immediately.

4. **Architectural & Deployment Boundaries**:
   - Single Vercel deployment with Node.js CommonJS serverless functions under `api/`, shared modules under `api/_shared/`, and static frontend pages.
   - Strictly honor the 12-serverless-function hobby/deployment limit; new capabilities extend existing action routers or shared modules.
   - No plaintext secrets in browser code, client repositories, or committed files.

---

## 3. Brand URL Intelligence Engine

### 3.1 URL Intake & Safety
- **Normalization**: Canonicalize scheme, hostname, and path. Disallow local/loopback (`127.0.0.1`, `localhost`), link-local (`169.254.0.0/16`), private RFC 1918 ranges, and cloud metadata endpoints (`169.254.169.254`).
- **SSRF Defense**: Validate DNS resolution and re-verify IP addresses on every redirect hop (`assertPublicUrl`).
- **Resource Constraints**: Enforce request timeouts (10s max per page), response size limits (8MB max), strict crawl budgets (max 25 pages), and MIME type filters (`text/html`, `application/json`).
- **Prompt Injection Defense**: Untrusted crawled content is treated strictly as data payloads within delimited blocks, never as system instructions.

### 3.2 Discovery & Structured Extraction
- **Discovery Strategy**: Inspect homepage metadata, sitemap.xml, robots policy, navigation, footer links, product feeds (`/products.json`), and schema.org / JSON-LD markup.
- **Extraction Schema**:
  - *Identity*: Canonical brand name, legal name, domain, tagline, industry, business model.
  - *Visual Identity*: Logo (SVG/PNG), favicon, primary/accent/surface/ink palette (verified WCAG AA compliant), typography (heading and body font stacks).
  - *Voice & Messaging*: Tone dimensions, vocabulary, preferred phrases, prohibited phrases, value propositions, key differentiators.
  - *Product Catalog*: Product IDs, SKUs, titles, descriptions, options/variants, pricing (minor units), currencies, inventory availability, PDP URLs, and image URLs.
  - *Commercial Policies*: Shipping thresholds, return windows, warranty, subscription options, regional differences.
  - *Regulatory & Approved Claims*: Substantiated claims with source quotes, dates, and applicable market scopes.

### 3.3 Evidence, Provenance & Confidence
Every extracted field records:
```typescript
interface FieldProvenance {
  value: any;
  source_url: string;
  source_type: 'json_ld' | 'meta_tag' | 'pdp_body' | 'policy_page' | 'store_feed' | 'user_input';
  source_excerpt: string;
  captured_at: string; // ISO 8601 UTC
  content_hash: string;
  confidence: number; // 0.0 - 1.0
  state: 'discovered' | 'extracted' | 'verified' | 'approved' | 'needs_review' | 'unavailable';
  scope: {
    market?: string; // ISO 3166-1 alpha-2 (e.g., 'US', 'GB', 'IN')
    product_id?: string;
  };
  reviewed_by?: string;
  reviewed_at?: string;
}
```

### 3.4 Conflict Handling & Incremental Rescan
- When distinct pages report conflicting data (e.g. conflicting prices or promotional dates), mark the field as `needs_review` and display both candidates with their respective source URLs.
- Incremental rescans compute content hashes; only modified sections trigger change reviews, preserving previously human-approved attributes.

---

## 4. Shared Canonical Brand Context & Smart Brain

All generative modules (Mailer Studio, Ads Studio, Social Studio, Music Studio, Landing Page Studio, and Calendar) consume one immutable, versioned context object generated by `api/_shared/smart-brain-plan.js`:

```typescript
interface CanonicalBrandContext {
  workspace_id: string;
  brand_id: string;
  version: string;
  market: {
    code: string; // ISO-3166-1 alpha-2
    name: string;
    currency: string; // ISO-4217
    symbol: string;
    locale: string;
    timezone: string;
    is_home: boolean;
  };
  identity: {
    name: string;
    tagline: string;
    website: string;
    logo_url: string;
  };
  design_system: {
    palette: { primary: string; accent: string; surface: string; ink: string; surface_alt: string; muted: string };
    typography: { heading: { family: string; stack: string }; body: { family: string; stack: string } };
  };
  voice: {
    tone: string;
    preferred: string[];
    banned: string[];
  };
  catalog: Array<{
    id: string;
    title: string;
    sku: string;
    price: number; // integer minor units
    currency: string;
    image_url: string;
    pdp_url: string;
  }>;
  approved_claims: Array<{ id: string; claim: string; evidence: string; scope: string }>;
  campaign_brief?: {
    objective: string;
    offer: string;
    audience: string;
    key_message: string;
    cta_destination: string;
  };
}
```

---

## 5. Creative Production Pipeline & Asset Contracts

The production flow follows a rigorous multi-stage pipeline:
`Brief → Concepts → Layout & Draft → Render → Deterministic Validation → Quality Scoring → Review & Approval → Dispatch & Publish → Performance Measurement`

### 5.1 Per-Asset Contracts
1. **Email / Mailer Studio**:
   - Table-based responsive HTML, inline CSS, 600px desktop max-width, mobile full-width scaling.
   - Semantic images with alt text, plain-text fallback, CAN-SPAM / GDPR footer (unsubscribe & physical address), contrast AA compliant.
2. **Paid Static Ads (Meta, Google Display, Pinterest)**:
   - Placement dimensions: 1:1 (1080x1080), 9:16 (1080x1920), 4:5 (1080x1350), 1.91:1 (1200x628).
   - Safe zone preservation (top/bottom 15% clear of essential text), visual hierarchy, headline character limits, valid destination URL.
3. **Short-Form Video & AI UGC**:
   - Timed scene script, hook (0-3s), product showcase, objection handling, CTA.
   - Code-based rendering (`Mediabunny` + Chromium WebCodecs) for fallback when zero-GPU or no HF keys are configured.
   - Audio layer: human-like voiceover ducked over brand background audio track (-14 to -16 LUFS integrated).
4. **Landing Pages**:
   - Semantic HTML5 (`main`, `header`, `footer`, skip-to-content links).
   - Elaya design system principles: responsive typography, accessible contrast, hero column width capped at 680px, interactive CTA states.
5. **Brand Music & Audio**:
   - Composed via Lyria, ElevenLabs Music, Replicate (ACE-Step vocal / MusicGen instrumental), or The Third Eye procedural synthesizer (`third-eye-synth`).
   - Every track seeded with take parameter to guarantee uniqueness on consecutive generations.

---

## 6. Universal Country & Market Selection

1. **Canonical ISO-3166 Coverage**:
   - Complete 249 ISO-3166-1 alpha-2 countries supported through `window.RegionContext` and `api/_shared/brand-locale.js`.
   - Readable localized display names via `Intl.DisplayNames(['en'], { type: 'region' })`.
   - Accurate ISO-4217 currency codes, formatting rules, dial codes, and IANA timezone mappings.
2. **Persistent Market Synchronization**:
   - Brand's active market selection stored in scoped storage (`LCStore`).
   - Changing the active market updates product pricing, currency symbols, and promotional calendars globally across all open studio tools without cross-brand leakage.

---

## 7. Platform Integrations & OAuth Connectivity

1. **First-Class Connect Surfaces**:
   - Dedicated connection cards for **Shopify**, **Meta Ads**, **Google Ads**, **TikTok Ads**, and **Klaviyo** in `brand-connections.html` and `connectors.html`.
   - Each card clearly communicates data capabilities:
     - *Shopify*: Products, collections, live inventory, customers, order history, UTM attribution.
     - *Meta Ads*: Ad accounts, creative assets, spend history, CTR, ROAS, and campaign dispatch.
     - *Google Ads*: Search & Shopping campaigns, asset library, conversion metrics.
     - *TikTok Ads*: Performance metrics, video assets, audience analytics.
     - *Klaviyo*: Audiences, lists, segments, flow histories, and email assets.
2. **Transparent OAuth & Direct Token Pathways**:
   - When OAuth app credentials (`SHOPIFY_CLIENT_ID`, `META_APP_ID`, etc.) are configured, the user initiates standard OAuth authorization flows.
   - When OAuth credentials are not set on the deployment, the UI displays an actionable guidance panel and provides direct token/credential configuration fields, allowing immediate connectivity without blocking operations.

---

## 8. Billing, Credits & Operational Accounting

The platform maintains four strictly segregated accounting concepts:
1. **User Money / Payment Ledger**: Real currency transactions (INR, USD), recorded in integer minor units (paise/cents). Managed via Razorpay / Stripe adapters.
2. **Credit Wallet & Ledger**: Internal platform usage units. Immutable, append-only entries (`purchase`, `reservation`, `settlement`, `release`, `refund`).
3. **Feature Price Catalog**: Defined in `api/_shared/credit-catalog.js`. Publicly visible credit pricing per feature.
4. **Provider Cost & Operational Telemetry**: Wholesale API costs incurred with external providers (OpenAI, ElevenLabs, Replicate, Kling), monitored internally for margin analysis.

---

## 9. Comprehensive Acceptance Criteria

### Group A: Brand Intelligence & URL Scanning
- [ ] **A1 (URL Validation)**: `Given` an invalid, loopback, or private RFC1918 address (e.g. `http://127.0.0.1`, `http://169.254.169.254`), `When` submitted to brand extraction, `Then` the request fails immediately with code `invalid_origin` before attempting network fetch.
- [ ] **A2 (Structured Extraction)**: `Given` a valid public e-commerce store URL, `When` scanned, `Then` extraction returns brand identity, color palette, font stacks, products with prices/currencies, and store URLs without inventing missing fields.
- [ ] **A3 (Field Provenance)**: `Given` an extracted product or claim, `When` inspected in the brand profile, `Then` it displays its source URL, extraction timestamp, and confidence score.
- [ ] **A4 (Incremental Rescan)**: `Given` an existing approved brand record, `When` a rescan is executed, `Then` human-edited values are preserved, and newly detected changes are marked for review.

### Group B: Creative Production & Asset Validation
- [ ] **B1 (Mailer Studio Contract)**: `Given` a generated email asset, `When` rendered, `Then` it contains valid HTML table structures, inline styles, responsive media queries, alt tags, and an active unsubscribe footer.
- [ ] **B2 (Static Ad Dimensions)**: `Given` an ad generated for Instagram Feed (1:1) or Story (9:16), `When` validated, `Then` image aspect ratio matches exact platform specifications, and safe margins contain all headline text.
- [ ] **B3 (Music Composition & Regeneration)**: `Given` a music prompt on `/music.html`, `When` clicking "Generate" multiple times, `Then` each generation receives a distinct take parameter, generating unique compositions via connected models or the procedural audio synth.
- [ ] **B4 (Unauthenticated Song Composition)**: `Given` an unauthenticated visitor or demo brand, `When` composing a track on `/music.html`, `Then` the system allows generation via the procedural synth without blocking with `409 no_active_brand`.

### Group C: Market & Country Selection
- [ ] **C1 (Global Country Directory)**: `Given` `window.RegionContext.allCountries()`, `When` queried, `Then` it returns all 249 ISO-3166-1 alpha-2 countries with localized display names and currency mappings.
- [ ] **C2 (Readable Country Labels)**: `Given` any valid country code (e.g. `DE`, `FR`, `CA`, `JP`, `IN`), `When` displayed in the region picker, `Then` it renders the full readable country name (e.g. "Germany (DE)", "France (FR)") rather than an unadorned code.
- [ ] **C3 (Multi-Country Selection Sync)**: `Given` a brand with multiple selling regions, `When` selecting "All markets" or toggling individual countries, `Then` the active selection updates synchronously across all studio and calendar views.

### Group D: Platform Connectivity (Shopify, Meta, Google, TikTok)
- [ ] **D1 (Connection Cards Visibility)**: `Given` `brand-connections.html`, `When` loaded, `Then` cards for Shopify, Meta Ads, Google Ads, TikTok Ads, and Klaviyo render a prominent "Sign in to Connect" / "Connect" button.
- [ ] **D2 (Sync Capability Declarations)**: `Given` a connector card, `When` viewed, `Then` it explicitly lists what data is synced (e.g. products, orders, creative history, conversion metrics).
- [ ] **D3 (Direct Token Fallback)**: `Given` unconfigured platform OAuth keys, `When` clicking Connect, `Then` the interface provides immediate manual token entry fields to enable connection without failure.

### Group E: Billing, Wallets & Financial Integrity
- [ ] **E1 (Atomicity & Idempotency)**: `Given` a paid generation request, `When` initiated, `Then` credits are reserved atomically; upon successful completion, they are settled; upon provider failure, they are fully released.
- [ ] **E2 (Zero Double-Spend)**: `Given` a network timeout or duplicate retry, `When` processed by the credit engine, `Then` the operation idempotency key prevents duplicate charges.
- [ ] **E3 (Currency Isolation)**: `Given` user purchase transactions, `When` stored in the payment ledger, `Then` currency amounts are recorded in minor integer units and never equated with internal credit balances.

---

## 10. Verification & Operations Checklist

1. **Preflight Build Validation**:
   ```bash
   npm run build
   ```
2. **Automated Test Suite**:
   ```bash
   npx playwright test tests/market-codes.spec.js tests/brand-locale-defaults.spec.js tests/third-eye-music.spec.js tests/oauth-adapters.spec.js --project=desktop-1280
   ```
3. **Deployment Procedure**:
   - Push committed code to remote repository branch `main`.
   - Trigger production deployment via `vercel --prod`.
   - Verify health endpoints and public asset availability on production URL.
