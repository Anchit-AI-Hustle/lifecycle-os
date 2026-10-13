// The address a background chain calls ITSELF on (2026-10-13).
//
// Production: every chain (catalogue import, context pack, prebuild queue)
// called `https://${VERCEL_URL}`, the deployment's generated *.vercel.app
// address. The project has Vercel Standard Protection on every address but its
// custom domains, and Vercel's docs say VERCEL_URL "cannot be used in
// conjunction with Standard Deployment Protection": the self-call met the
// protection page, the next step never ran, and the import still said "It is
// continuing by itself". Executed: the shipped helper inside a real request
// scope, and the catalogue chain's own fireNext() against a recording fetch.
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const scope = require(path.join(ROOT, 'api/_shared/request-scope.js'));
const self = require(path.join(ROOT, 'api/_shared/self-url.js'));
const imp = require(path.join(ROOT, 'api/_shared/catalog-import.js'));

const KEYS = ['SELF_BASE_URL', 'VERCEL_URL', 'VERCEL_ENV', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_AUTOMATION_BYPASS_SECRET', 'CRON_SECRET'];
let saved;
test.beforeEach(() => { saved = {}; for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
test.afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const inRequest = (host, fn) => scope.run({ headers: { host, 'x-forwarded-host': host } }, fn);

test('a request that came in on the custom domain is answered there, never on the protected generated address', async () => {
  process.env.VERCEL_URL = 'lifecycle-abc123-team.vercel.app';
  process.env.VERCEL_ENV = 'production';
  const got = await inRequest('lifecycle-os.anchit-tandon.com', async () => self.selfBaseUrl());
  expect(got).toBe('https://lifecycle-os.anchit-tandon.com');
});

test('a request on a generated address uses the production domain on production, and VERCEL_URL only where nothing better is known', async () => {
  process.env.VERCEL_URL = 'lifecycle-abc123-team.vercel.app';
  process.env.VERCEL_ENV = 'production';
  process.env.VERCEL_PROJECT_PRODUCTION_URL = 'lifecycle-os.anchit-tandon.com';
  expect(await inRequest('lifecycle-abc123-team.vercel.app', async () => self.selfBaseUrl())).toBe('https://lifecycle-os.anchit-tandon.com');
  // No request at all (a cron worker): the production domain still wins.
  expect(self.selfBaseUrl()).toBe('https://lifecycle-os.anchit-tandon.com');
  // A preview has no production domain to use.
  process.env.VERCEL_ENV = 'preview';
  expect(self.selfBaseUrl()).toBe('https://lifecycle-abc123-team.vercel.app');
  // An explicit override always wins.
  process.env.SELF_BASE_URL = 'https://override.example/';
  expect(self.selfBaseUrl()).toBe('https://override.example');
});

test('the catalogue chain fires its next step at that address, with the bypass header when the project has one', async () => {
  process.env.VERCEL_URL = 'lifecycle-abc123-team.vercel.app';
  process.env.VERCEL_ENV = 'production';
  process.env.CRON_SECRET = 'cron-secret-for-the-chain-0123456789';
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'bypass-secret-fixture';
  const calls = [];
  const was = global.fetch;
  global.fetch = async (url, init) => { calls.push({ url: String(url), headers: (init && init.headers) || {} }); return { ok: true, status: 200 }; };
  try {
    const out = await inRequest('lifecycle-os.anchit-tandon.com', () => imp.fireNext({ workspace_id: 'ws-1', token: 't', depth: 2 }));
    expect(out.fired).toBe(true);
  } finally { global.fetch = was; }
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('https://lifecycle-os.anchit-tandon.com/api/public-config?action=brand&op=catalog-chain');
  expect(calls[0].url).not.toContain('vercel.app');
  expect(calls[0].headers['x-vercel-protection-bypass']).toBe('bypass-secret-fixture');
  expect(calls[0].headers.Authorization).toBe('Bearer cron-secret-for-the-chain-0123456789');
});
