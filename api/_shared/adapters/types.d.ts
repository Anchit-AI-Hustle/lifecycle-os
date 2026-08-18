/**
 * adapters/types.d.ts — the adapter contract as actual TypeScript.
 *
 * The runtime here is plain CommonJS with no build step, so these are
 * declarations over the JavaScript rather than the source of it. They are the
 * checkable version of the JSDoc in base-adapter.js: `tsc --noEmit` over this
 * file verifies the shape, and an editor picks it up for completion against the
 * .js modules without anything being transpiled at request time.
 *
 * Keep this in step with base-adapter.js. tests/adapter-contract.spec.js asserts
 * that every method named here exists on the base class, so a drift fails CI
 * rather than becoming a lie in a type file.
 */

export type ErrorClass =
  | 'rate_limited'
  | 'auth'
  | 'validation'
  | 'transient'
  | 'permanent'
  | 'blocked';

export type DispatchMode = 'publish' | 'schedule' | 'draft';

export type PreflightVerdict = 'pass' | 'warn' | 'block';

export interface AdapterCredentials {
  access_token?: string;
  refresh_token?: string;
  api_key?: string;
  client_id?: string;
  client_secret?: string;
  developer_token?: string;
  customer_id?: string;
  login_customer_id?: string;
  account_id?: string;
  licence_code?: string;
  site_id?: string;
  region?: string;
  revision?: string;
  scopes?: string[];
  expires_at?: string;
  [key: string]: unknown;
}

export interface DispatchContext {
  workspaceId: string;
  credentials: AdapterCredentials;
  connection?: Record<string, unknown>;
  dryRun?: boolean;
  publishEnabled?: boolean;
  validateOnly?: boolean;
  idempotencyKey?: string;
}

export interface WouldRequest {
  method: string;
  url: string;
  body?: unknown;
}

export interface DispatchResult {
  ok: boolean;
  /** False when nothing left the process: a dry run, or a refusal. */
  sent?: boolean;
  external_id?: string;
  status?: string;
  would_request?: WouldRequest;
  error?: string;
  error_class?: ErrorClass;
  retry_after_ms?: number;
  /** State a retry can resume from instead of duplicating (e.g. an IG container id). */
  resume?: Record<string, string>;
  endpoint_unverified?: boolean;
  note?: string;
  raw?: unknown;
}

export interface MappingResult {
  ok: boolean;
  payload: Record<string, unknown>;
  warnings: string[];
  /** `[DATA REQUIRED BEFORE LAUNCH: …]` markers. Never placeholder values. */
  missing: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface CredentialCheck {
  ok: boolean;
  account?: Record<string, unknown> | null;
  scopes?: string[];
  expires_at?: string | null;
  note?: string;
}

export interface RefreshResult {
  ok: boolean;
  supported: boolean;
  /** True when the grant is gone for good and retrying only burns rate limit. */
  terminal?: boolean;
  credentials?: AdapterCredentials;
  expires_at?: string | null;
  note?: string;
}

export interface WebhookVerification {
  verified: boolean;
  note: string;
  event?: unknown;
}

export interface ChannelDescriptor {
  id: string;
  label: string;
  asset_kinds: string[];
  constraints: Record<string, unknown>;
  supported?: boolean;
}

export interface AuthDescriptor {
  kind: 'oauth' | 'api_key';
  endpoints: Record<string, unknown>;
  scopes: Array<{ value: string; why: string }>;
  default_scopes?: string[];
  pkce?: { required: boolean; method: string; [k: string]: unknown } | null;
  scope_separator?: string;
  platform_prereq?: Record<string, unknown> | null;
  token_lifetime?: Record<string, unknown> | null;
  /** Where each endpoint above came from, or an admitted gap. */
  sources: string[];
}

export interface BasePlatformAdapter {
  readonly ctx: DispatchContext;
  readonly credentials: AdapterCredentials;
  readonly workspaceId: string;

  validateCredentials(): Promise<CredentialCheck>;
  refreshCredentials(): Promise<RefreshResult>;
  map(asset: unknown, mapping: unknown): MappingResult;
  validatePayload(channelId: string, payload: unknown): ValidationResult;
  dispatch(channelId: string, payload: unknown): Promise<DispatchResult>;
  fetchStatus(externalId: string): Promise<{ ok: boolean; status?: string; detail?: unknown }>;
  verifyWebhook(headers: unknown, rawBody: string): WebhookVerification;
  gap(field: string, extra?: string): string;
}

export interface AdPlatformAdapter extends BasePlatformAdapter {
  listAdAccounts(): Promise<{ ok: boolean; accounts?: Array<{ id: string; name: string }>; note?: string }>;
  createCampaign(spec: unknown): Promise<DispatchResult>;
  createAdSet(spec: unknown): Promise<DispatchResult>;
  createAd(spec: unknown): Promise<DispatchResult>;
  /**
   * A read of a PUBLIC archive. `ok:false` with `searched:false` means the
   * archive could not be queried at all — which is never the same statement as
   * "this advertiser runs no ads".
   */
  searchAdLibrary(query: unknown): Promise<{ ok: boolean; searched?: boolean; ads?: unknown[]; source?: string; coverage_note?: string; note?: string }>;
}

export interface CrmPlatformAdapter extends BasePlatformAdapter {
  listAudiences(): Promise<{ ok: boolean; audiences?: Array<{ id: string; name: string }>; note?: string }>;
  listSegments(): Promise<{ ok: boolean; segments?: Array<{ id: string; name: string; profile_count?: number }>; note?: string }>;
  createTemplate(spec: unknown): Promise<DispatchResult>;
  createCampaign(spec: unknown): Promise<DispatchResult>;
  scheduleCampaign(id: string, whenIso: string): Promise<DispatchResult>;
  triggerFlow(spec: unknown): Promise<DispatchResult>;
  suppressProfiles(profileIds: string[], reason: string): Promise<DispatchResult>;
}

/* ── deliverability ───────────────────────────────────────────────────────── */

export interface DnsRecordAudit {
  type: 'SPF' | 'DKIM' | 'DMARC' | 'MX' | 'BIMI';
  found: boolean;
  raw: string | null;
  parsed: Record<string, unknown> | null;
  passed: boolean;
  findings: Array<{ level: 'ok' | 'warn' | 'fail'; message: string; remediation?: string }>;
  resolver: string;
}

export interface DomainHealth {
  domain: string;
  score: number;
  grade: string;
  records: DnsRecordAudit[];
  blacklists: {
    checked: boolean;
    listed: string[];
    note: string;
  };
  breakdown: Array<{ key: string; points: number; max: number; why: string }>;
  checked_at: string;
}

export interface PreflightCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'block' | 'skip';
  detail: string;
  remediation?: string;
}

export interface PreflightReport {
  verdict: PreflightVerdict;
  score: number;
  checks: PreflightCheck[];
  blocking: string[];
}

/* ── cohorts ──────────────────────────────────────────────────────────────── */

export type CohortKey = 'champions' | 'engaged_30' | 'engaged_60' | 'slipping' | 'inactive';

export interface SubscriberScore {
  external_profile_id: string;
  recency_days: number | null;
  frequency_90d: number;
  monetary: number;
  r_score: number;
  f_score: number;
  m_score: number;
  engagement_score: number;
  cohort_key: CohortKey;
  suppressed: boolean;
  suppressed_reason?: string;
  best_send_hour: number | null;
}

export interface SegmentHealth {
  score: number;
  size: number;
  eligible: number;
  suppressed: number;
  estimated_bounce_risk: number;
  verdict: PreflightVerdict;
  reasons: string[];
}
