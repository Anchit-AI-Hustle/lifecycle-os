// A brand you can create but not edit or remove is a brand you are stuck with.
//
// Two things were missing. The brand list offered only "Switch" - no way to
// edit a brand or delete one, though the wizard could already edit via `?id=`
// and the server already had `op=delete`. And the delete itself reported a
// success it did not have: it fired the DELETE with `return=minimal` and
// returned {ok:true, deleted:id} unconditionally. RLS restricts deletion to
// `owner_id = auth.uid()`, so a non-owner - and any bad id - got a 204 with
// ZERO rows removed and was told the brand was gone. It was still there on the
// next load.
//
// Run: npx playwright test tests/brand-crud.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CORE = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'), 'utf8');
const ONBOARDING = fs.readFileSync(path.join(ROOT, 'onboarding.html'), 'utf8');

/* ═══ the delete tells the truth ═══════════════════════════════════════════ */

test('deleteWorkspace verifies a row actually went before reporting success', () => {
  const fn = CORE.slice(CORE.indexOf('async function deleteWorkspace'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);

  // `return=minimal` gives back nothing, so success cannot be distinguished
  // from a policy silently removing zero rows.
  expect(body, 'the delete must be able to see what it removed').not.toMatch(/return=minimal/);
  expect(body).toMatch(/return=representation/);

  // And it must actually check.
  expect(body, 'an unchecked representation is the same bug with extra steps').toMatch(/rows\.length/);
});

test('a non-owner is refused with a reason, not a false success', () => {
  const fn = CORE.slice(CORE.indexOf('async function deleteWorkspace'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
  expect(body).toMatch(/owner_id/);
  expect(body).toMatch(/403/);
  // "not found" and "not yours" are different answers to the user.
  expect(body).toMatch(/404/);
});

test('the delete reports what it could NOT remove', () => {
  const fn = CORE.slice(CORE.indexOf('async function deleteWorkspace'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
  // Every brand-owned table cascades, but Storage has no foreign key reaching
  // it. Re-hosted review media would be orphaned silently otherwise.
  expect(body, 'orphaned storage must be stated, not silently left behind').toMatch(/brand-review-media/);
});

/* ═══ the list offers edit and delete ══════════════════════════════════════ */

test('every brand row offers switch, edit and delete', () => {
  const list = ONBOARDING.slice(ONBOARDING.indexOf('async function loadWorkspaces'));
  const block = list.slice(0, 4000);
  for (const act of ['switch', 'edit', 'delete']) {
    expect(block, `the brand list must offer "${act}"`).toMatch(new RegExp(`data-act="${act}"`));
  }
});

test('edit reuses the wizard\'s own ?id= path rather than a second seeding route', () => {
  const list = ONBOARDING.slice(ONBOARDING.indexOf('async function loadWorkspaces'));
  const block = list.slice(0, 5000);
  expect(block).toMatch(/\/onboarding\?id=/);
  // boot() is what makes that URL mean "edit": it loads the row and retitles.
  expect(ONBOARDING).toMatch(/\$\('title'\)\.textContent = 'Edit ' \+ brand\.name/);
});

test('delete requires the brand name, not a single OK', () => {
  const list = ONBOARDING.slice(ONBOARDING.indexOf('async function loadWorkspaces'));
  const block = list.slice(0, 6000);
  // A confirm() is too cheap for something that removes a catalogue, stored
  // credentials and a credit ledger.
  expect(block).toMatch(/window\.prompt/);
  expect(block, 'a mistyped name must delete nothing').toMatch(/Nothing was deleted/);
  // The warning has to name what else goes, or "delete brand" reads as a label
  // change rather than the cascade it is.
  expect(block).toMatch(/catalogue/i);
  expect(block).toMatch(/credit ledger/i);
});

test('deleting the ACTIVE brand warns that it is the active one', () => {
  const list = ONBOARDING.slice(ONBOARDING.indexOf('async function loadWorkspaces'));
  const block = list.slice(0, 6000);
  expect(block).toMatch(/alsoActive/);
  expect(block).toMatch(/ACTIVE brand/);
});

test('a row action does not also trigger the row switch', () => {
  const list = ONBOARDING.slice(ONBOARDING.indexOf('async function loadWorkspaces'));
  const block = list.slice(0, 6000);
  // Without this, pressing Delete would switch to the brand and then delete
  // it, leaving the app pointed at a workspace that no longer exists.
  expect(block).toMatch(/stopPropagation/);
});
