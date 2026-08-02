# KNICKGASM Mailer Studio — Architecture Reference

The 10-phase web-application execution model + production checklists this app is benchmarked against. Pasted from the v3 master spec on 2026-05-03.

> **Status of this app vs. the spec** — see [`./AUDIT.md`](./AUDIT.md) for the gap analysis and phase-by-phase coverage.

---

## The 10 Execution Phases

| Phase | Timing | Location | What Happens |
|-------|--------|----------|--------------|
| 1 | 0-100ms | Browser | Service worker check, storage test, device capabilities |
| 2 | 50-300ms | DNS | Domain → IP resolution |
| 3 | 50-500ms | Network | TCP + TLS handshake, certificate validation |
| 4 | 50-5000ms | Server | HTTP request + decompressed response |
| 5 | 100-500ms | Browser | HTML parse, critical CSS, First Contentful Paint |
| 6 | 100-1000ms | Browser | JS execute, hydrate, Time-to-Interactive |
| 7 | 0ms + async | Browser | User action, validation, prepare request |
| 8 | 100-5000ms | Network | API request with timeout + retry |
| 9 | 150-1000ms | Server | Rate limit, validate, query, hash, sign, log |
| 10 | 10-100ms | Browser | Parse response, update UI, redirect |

**Total**: 600-10,000ms (slow path) · 600-2,000ms (fast path).

---

## Performance Targets

| Metric | Target | Good | Excellent |
|---|---|---|---|
| FCP | < 1.8s | < 1.0s | < 0.5s |
| LCP | < 2.5s | < 1.5s | < 0.8s |
| FID/INP | < 100ms | < 50ms | < 20ms |
| CLS | < 0.1 | < 0.05 | < 0.025 |
| TTI | < 3.8s | < 2.5s | < 1.5s |
| API Response | < 1.0s | < 500ms | < 200ms |
| Form Validation | < 50ms | < 20ms | < 10ms |
| Error Rate | < 1% | < 0.5% | < 0.1% |

---

## Error Classification

| Type | Status Codes | Strategy |
|---|---|---|
| **Transient** (retry with backoff 1s → 2s → 4s → 8s) | timeout · 500 · 503 · network reset · DNS timeout | Up to 3-5 retries with exponential backoff + jitter |
| **Permanent** (don't retry) | 400 · 401 · 404 · 410 · malformed | Show error, let user fix |
| **Rate-limited** (special handling) | 429 with `Retry-After` | Lock UI for the specified duration, show countdown, let user retry after |

---

## The 10 Key Rules

1. ✅ **Validate on client** (instant feedback < 50ms)
2. ✅ **Validate on server** (required for security — never trust client)
3. ✅ **Use exponential backoff** (1s → 2s → 4s → 8s, max 5 retries)
4. ✅ **Never leak auth info** (generic "Invalid credentials" message)
5. ✅ **Disable button after click** (prevent double-submit)
6. ✅ **Set timeout on API** (30s standard, 90s for image gen)
7. ✅ **Show loading state** (user knows something happening)
8. ✅ **Handle every error code** (400, 401, 429, 500, 503, timeout, network)
9. ✅ **Log everything** (debugging + security audit)
10. ✅ **Monitor in production** (FCP, LCP, TTI, error rates)

---

## Security Checklist

### Authentication (N/A for this app — no user accounts)
- bcrypt for passwords · JWT signing · 2FA · session DB · CSRF tokens

### Input Validation (applies)
- Validate format on client AND server
- Sanitize all inputs (strip HTML chars)
- Parameterized queries (N/A here, no SQL)
- Reject oversized payloads
- Whitelist allowed characters (don't blacklist)

### API Security (applies)
- HTTPS only · POST for sensitive data · Rate limiting · Request size limits
- `X-Content-Type-Options: nosniff` · `Cache-Control: no-store` on `/api/*`

### Error Handling (applies)
- Never leak internal error details to client
- Send to error tracking (Sentry-style)
- Generic error message + correlation ID for support lookup
- Alert ops on critical errors

---

## Deployment Checklist (used per release)

### Before
- All tests pass · Security scan · Lighthouse score · Error handling reviewed · Load test · DB migration tested · Rollback plan

### Day-of
- Deploy to staging first · Smoke test · Monitor logs · Deploy in low-traffic window · Ops on standby · Real-device testing · Rollback ready

### After
- Monitor for 24h · Error rate < 1% · Response times meet targets · CPU/memory healthy · Review user feedback · Update runbook · Post-mortem if needed
