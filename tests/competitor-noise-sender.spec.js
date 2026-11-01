// The competitor mail archive skips mail from the operator's own inboxes and from
// notification services. On 2026-11-01 the history rewrite replaced a personal username
// in that list with the word "owner", which made every competitor whose sender name or
// address contains "owner" (a "Store Owner" sign-off, owners@...) read as our own mail and
// be dropped. Executed against the shipped function.
const { test, expect } = require('@playwright/test');
const core = require('../api/_shared/competitor-core.js');

test('a competitor whose sender mentions "owner" is kept', () => {
  expect(core.isNoiseSender('owners@brownerie.example', 'Brownerie Store Owner')).toBe(false);
  expect(core.isNoiseSender('hello@ownerdrive.example', 'OwnerDrive')).toBe(false);
});

test('our own mail is still skipped', () => {
  expect(core.isNoiseSender('team@knickgasm.com', 'KNICKGASM')).toBe(true);
  expect(core.isNoiseSender('anchit@example.com', 'Anchit')).toBe(true);
});
