# Audit: v83 vs. 10-Phase Master Spec

**Date**: 2026-05-03
**Build**: `audit-additions-v83`
**Stacks on**: v82 (multi-stage pipeline + Outlook compat + image fix + score improvements + divergence hardening)
**Verdict**: A- → A. The remote v80-v82 work added the multi-stage pipeline, multi-key OpenAI cascade, and divergence hardening that closed most Phase 8/9 gaps. v83 adds the observability layer (health endpoint, Web Vitals, audit docs).

---

## Phase 1-3 — Browser Init + DNS + TLS

| Spec item | Status | Evidence |
|---|---|---|
| Service Worker registered | ⚠️ Not used | No SW in `<head>` |
| Storage availability check | ✅ Implicit | `localStorage` calls wrapped in try/catch |
| TLS via Vercel | ✅ Auto | Vercel issues + auto-renews certs |
| HSTS header | ✅ | `vercel.json` headers `Strict-Transport-Security: max-age=31536000` |

---

## Phase 4-5 — HTTP + HTML/CSS Parse

| Spec item | Status | Evidence |
|---|---|---|
| HTML compression | ✅ | Vercel auto-applies brotli/gzip |
| Inline critical CSS | ✅ | `<style>` block in `<head>` is inline |
| Cache-Control on HTML | ✅ | `vercel.json` sets `must-revalidate` |
| Cache-Control on `/api/*` | ✅ v81 | `no-store` set |

---

## Phase 6 — JS Execute + Hydrate

| Spec item | Status | Evidence |
|---|---|---|
| Defer non-critical scripts | ⚠️ Mixed | Supabase async, app inline |
| `DOMContentLoaded` listener | ✅ | App init in DOM-ready handler |
| **Web Vitals tracking** | ✅ NEW v83 | `PerformanceObserver` → `window.__VITALS` (FCP/LCP/CLS/TTFB) |

---

## Phase 7 — User Action

| Spec item | Status |
|---|---|
| Disable button on click | ✅ |
| Client validation < 50ms | ✅ |
| Show loading state | ✅ |
| Prevent double-submit | ✅ |
| **gen_seed regen divergence** | ✅ v81 |

**Verdict**: Phase 7 fully covered.

---

## Phase 8 — API Request

| Spec item | Status | Evidence |
|---|---|---|
| Timeout (30s/90s) | ✅ | AbortController in HTML + serverless functions |
| Retry with exponential backoff | ⚠️ Partial | One-shot retry on parse fail; pipeline retries on quota |
| Multi-key OpenAI cascade | ✅ v82 | `OPENAI_API_KEY` → `_KEY_2` → `_KEY_3` → Pollinations |
| Stage logging on all LLM calls | ✅ v81 | Every pipeline stage logs |

---

## Phase 9 — Backend Processing

| Spec item | Status | Evidence |
|---|---|---|
| Multi-stage pipeline | ✅ v80 | `/api/ai/pipeline/{strategy,variant,images,html,score}` separate functions |
| Pipeline health endpoint | ✅ v80 | `/api/ai/pipeline/health` |
| **Top-level health endpoint** | ✅ NEW v83 | `/api/health` returns build, providers, env state for monitoring |
| Input validation | ✅ | mode whitelist, body size, prompt length |
| Generic error to client | ✅ | typed error strings, no stack traces |
| Quota fallback (gpt-image-1 → Pollinations) | ✅ v82 | `quota_warning` flag in response |

**Verdict**: Phase 9 hardened across v80-v83.

---

## Phase 10 — Response + UI

| Spec item | Status |
|---|---|
| Parse response · check status | ✅ |
| Status-code dispatch (400/401/429/500) | ✅ |
| Network/timeout handling | ✅ |
| Cleanup in `finally` | ✅ |
| **Outlook compat** | ✅ v82 | HTML emit hardened for Outlook desktop rendering |

---

## Health & Observability

| Item | Status | Endpoint / Where |
|---|---|---|
| `/api/health` | ✅ NEW v83 | Returns build / region / env / configured providers (text + image waterfall, supabase) |
| `/api/ai/pipeline/health` | ✅ v80 | Pipeline-specific health |
| Web Vitals reporting | ✅ NEW v83 | `window.__VITALS` (browser-side) |
| Stage logging | ✅ v81 | All LLM and image calls log stage |
| Score improvements | ✅ v82 | Concept scoring + divergence hardening |
| Implementation Forensics modal | ✅ v70 | "🔬 Explain Logic" button on dashboard, runs heuristic + optional LLM analysis on last 5 records |

---

## Final Score

| Phase | v76 | v82 | v83 |
|---|---|---|---|
| 1-3 (browser/network) | A- | A- | A- |
| 4-5 (HTTP/HTML/CSS) | B+ | A- | A- |
| 6 (JS/hydrate) | B | B+ | A- (Web Vitals) |
| 7 (user action) | A | A | A |
| 8 (API request) | B | A (cascade + retry) | A |
| 9 (backend) | C+ | A (pipeline) | A (health endpoint) |
| 10 (response/UI) | A- | A (Outlook fix) | A |

**Overall**: B+ → **A**.

---

## Remaining Backlog

- Service Worker for offline mode (low priority — current scale doesn't need it)
- Structured log shipping (Sentry / Datadog) — currently `console.log` only
- `loading="lazy"` on below-fold KB product images
- Lighthouse score automation in CI (run on every PR)
- Pingdom / UptimeRobot wired to `/api/health` for uptime monitoring
