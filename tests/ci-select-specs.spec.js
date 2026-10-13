// @ts-check
'use strict';
// scripts/ci-select-specs.js, EXECUTED (2026-10-13): which specs a PR runs.
// CI took over an hour because every PR ran all 173 spec files on one runner;
// a PR now runs what its diff reaches, and main runs everything.
const { test, expect } = require('@playwright/test');
const { selectSpecs } = require('../scripts/ci-select-specs.js');

const specs = {
  'tests/llm-chain.spec.js': "const llm = require('../api/_shared/llm.js');",
  'tests/router-brain.spec.js': "H.serve('api/brain.js')",
  'tests/studio.spec.js': "page.goto('/lifecycle_mailer_architect_v34.html')",
  'tests/credits.spec.js': "require('../api/_shared/credits-core.js')",
};
const sources = {
  'api/brain.js': "const credits = require('./_shared/credits-core.js'); const llm = require('./_shared/llm');",
  'api/_shared/credits-core.js': "const scope = require('./request-scope.js');",
  'api/_shared/llm.js': '',
  'api/_shared/request-scope.js': '',
};
const sel = (changed, event) => selectSpecs({ event: event || 'pull_request', changed, specs, sources });

test('main, a push or a dispatch runs everything', () => {
  for (const ev of ['push', 'workflow_dispatch', 'schedule']) expect(sel(['api/_shared/llm.js'], ev).mode).toBe('ALL');
});

test('a file every spec shares (package.json, the harness, the config, ci.yml, auth.js) runs everything', () => {
  for (const f of ['package-lock.json', 'tests/lib/fake-supabase.js', 'tests/router-harness.js', 'tests/playwright.config.js', '.github/workflows/ci.yml', 'auth.js']) {
    const r = sel(['docs/x.md', f]);
    expect(r.mode, f).toBe('ALL');
    expect(r.reason).toContain(f);
  }
});

test('a changed module reaches its own specs and, two levels up, the routers that load it', () => {
  const r = sel(['api/_shared/request-scope.js']);
  expect(r.mode).toBe('LIST');
  // request-scope -> credits-core (level 1) -> brain.js (level 2): its spec and credits' spec run.
  expect(r.specs).toEqual(['tests/credits.spec.js', 'tests/router-brain.spec.js']);
});

test('a require by stem (no .js) still counts', () => {
  expect(sel(['api/_shared/llm.js']).specs).toEqual(['tests/llm-chain.spec.js', 'tests/router-brain.spec.js']);
});

test('a changed spec runs itself; a page reaches the spec that opens it; docs alone run nothing', () => {
  expect(sel(['tests/studio.spec.js']).specs).toEqual(['tests/studio.spec.js']);
  expect(sel(['lifecycle_mailer_architect_v34.html']).specs).toEqual(['tests/studio.spec.js']);
  expect(sel(['docs/notes.md', 'README.md']).mode).toBe('NONE');
});

test('a deleted spec is not selected (it is not on disk to run)', () => {
  expect(sel(['tests/gone.spec.js']).mode).toBe('NONE');
});
