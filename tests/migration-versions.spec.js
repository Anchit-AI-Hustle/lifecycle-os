/**
 * Every migration has its own version, and none is from the future (2026-10-04).
 * ---------------------------------------------------------------------------
 * The Supabase CLI keys `supabase_migrations.schema_migrations` by the digits
 * before the first underscore of each file name. Two files with one version
 * are one migration to it: `supabase db push` refuses the set, or applies one
 * and records the other as done. That happened twice on one day - #132's
 * social gateway and #128's brand-document origin both took 20261004120000,
 * then #147's inbound-processing and #145's workspace save both took
 * 20261004170000 - and no test noticed either time, because every spec reads
 * the files it needs BY NAME and a name collision is not visible from inside
 * one file. This is a property of the SET of files, so a file check is the
 * right tool (CLAUDE.md, "A test that reads the source...": a claim about the
 * files, not about what code does).
 *
 *   - every `.sql` is `<14-digit version>_<name>.sql`, except the date-only
 *     files that predate that convention. They are a CLOSED list: they are
 *     already applied under their 8-digit versions, so renaming one would make
 *     the CLI apply it a second time. The list may only shrink;
 *   - every version is unique, and stays unique when a date-only version is
 *     padded to 14 digits (the self-hosted applier, scripts/selfhost-*, orders
 *     and ledgers that way, so `20260719` and `20260719000000` would collide);
 *   - every version is a real UTC timestamp no later than the newest commit:
 *     a version from the future sorts after migrations written later, and
 *     the CLI then refuses those as "older than the last applied".
 *
 * Run: npx playwright test tests/migration-versions.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');

/** Applied under 8-digit versions before the 14-digit convention. Never add to this list. */
const DATE_ONLY = [
  '20260527_init_lifecycle_os.sql',
  '20260528_app_users.sql',
  '20260530_app_users_profile_prompted.sql',
  '20260606_kb_storage_and_landing.sql',
  '20260608_kb_manual_top_emails_brands.sql',
  '20260617_competitive_intel_and_brain.sql',
  '20260620_smart_brain_retention.sql',
  '20260705_smart_brain_full.sql',
  '20260706_lifecycle_os_backbone.sql',
];

const files = () => fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const versionOf = (f) => (/^(\d+)_/.exec(f) || [])[1] || null;

/** YYYYMMDD[HHMMSS] as a UTC instant, or null when it is not a real date and time. */
function instantOf(version) {
  const v = String(version).padEnd(14, '0');
  const [y, mo, d, h, mi, s] = [v.slice(0, 4), v.slice(4, 6), v.slice(6, 8), v.slice(8, 10), v.slice(10, 12), v.slice(12, 14)].map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(t);
  const real = back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d
    && back.getUTCHours() === h && back.getUTCMinutes() === mi && back.getUTCSeconds() === s;
  return real ? t : null;
}

/** The newest commit's time; the clock only when there is no git checkout. */
function newestCommitMs() {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (/^\d+$/.test(out)) return Number(out) * 1000;
  } catch (_) { /* a tarball: fall back to the clock */ }
  return Date.now();
}

test('every migration file carries a version: 14 digits, or one of the closed list of date-only files', () => {
  const all = files();
  expect(all.length, 'the migrations directory was not found or is empty').toBeGreaterThan(50);
  const malformed = all.filter((f) => !/^\d{14}_[^\s]+\.sql$/.test(f) && !DATE_ONLY.includes(f));
  expect(malformed, 'a new migration needs a 14-digit version: YYYYMMDDHHMMSS_name.sql').toEqual([]);
  // The grandfathered list may shrink, never grow, and never names a file that is gone.
  for (const f of DATE_ONLY) {
    expect(f).toMatch(/^\d{8}_[^\s]+\.sql$/);
    expect(all, `${f} is listed as date-only but does not exist`).toContain(f);
  }
});

// The Supabase GitHub integration pushes with an older CLI that orders local
// files by NAME, where "_" sorts after every digit, but the remote history by
// VERSION. A date-only file beside a 14-digit file of the same day therefore
// lands at a different position on each side, and that CLI stops with "Remote
// migration versions not found in local migrations directory" (it named
// 20260609, 20260610, 20260703 and 20260719 on 2026-10-10, reproduced with
// CLI 2.10.0 against the live history). Those four are 14-digit now, and the
// remote history carries the same versions. A date-only file may never share
// its date with another migration again.
test('no date-only migration shares its date with another migration', () => {
  const all = files();
  const clash = [];
  for (const f of all) {
    const v = versionOf(f);
    if (v.length !== 8) continue;
    const same = all.filter((g) => g !== f && versionOf(g).slice(0, 8) === v);
    if (same.length) clash.push(`${f} shares ${v} with ${same.join(', ')}`);
  }
  expect(clash, 'the integration CLI reads these in a different order from the remote history').toEqual([]);
});

test('no two migrations share a version, as written or padded to 14 digits', () => {
  const byVersion = {};
  for (const f of files()) {
    const key = versionOf(f).padEnd(14, '0');
    (byVersion[key] = byVersion[key] || []).push(f);
  }
  const shared = Object.entries(byVersion).filter(([, fs2]) => fs2.length > 1).map(([v, fs2]) => `${v}: ${fs2.join(', ')}`);
  expect(shared, 'two files with one version are ONE migration to the Supabase CLI').toEqual([]);
});

test('every version is a real UTC timestamp no later than the newest commit', () => {
  const newest = newestCommitMs();
  const bad = [];
  for (const f of files()) {
    const t = instantOf(versionOf(f));
    if (t === null) bad.push(`${f}: not a real date and time`);
    else if (t > newest) bad.push(`${f}: ${new Date(t).toISOString()} is after the newest commit (${new Date(newest).toISOString()})`);
  }
  expect(bad).toEqual([]);
});
