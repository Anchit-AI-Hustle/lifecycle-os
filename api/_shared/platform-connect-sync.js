'use strict';

const brand = require('./brand-workspace-core.js');
const registry = require('./adapters/registry.js');
const { liveConnectorsEnabled } = require('./live-connectors.js');

const ACCOUNT_FIELD = { meta: 'ad_account_id', google_ads: 'customer_id', linkedin: 'organization_id' };
const SOCIAL = new Set(['tiktok', 'pinterest', 'youtube']);

function supported(provider) {
  if (Object.hasOwn(ACCOUNT_FIELD, provider) || provider === 'klaviyo' || SOCIAL.has(provider)) return 'history';
  if (provider === 'webengage') return 'account';
  return null;
}

async function sync(auth, workspaceId, input) {
  await brand.assertCanWrite(auth, workspaceId, 'sync a connected platform');
  const provider = String(input.provider || '').toLowerCase();
  const Adapter = registry.adapterFor(provider);
  const mode = supported(provider);
  if (!Adapter || !mode) return { ok: false, note: 'This platform has no import available in the Integration hub.' };
  if (mode === 'history' && !liveConnectorsEnabled()) {
    return { ok: false, note: 'Platform data sync is disabled on this deployment.' };
  }
  const gateway = require('./social-gateway-core.js');
  const c = await gateway.credentialsFor(workspaceId, provider);
  if (!c.ok) return { ok: false, note: c.note, reconnect_required: c.reconnect_required };
  const adapter = new Adapter({ workspaceId, credentials: c.credentials, connection: c.conn });
  const field = ACCOUNT_FIELD[provider];
  let result;
  if (field) {
    const listed = provider === 'linkedin' ? await adapter.listOrganizations() : await adapter.listAdAccounts();
    if (!listed.ok) return { ok: false, note: `${Adapter.label} could not list the accounts available to this sign-in. Check its permissions and app access.` };
    const options = (listed.accounts || listed.organizations || []).map(({ id, name }) => ({ id: String(id), name: String(name || id) }));
    const configured = String(c.conn.config?.[field] || '');
    const comparable = (id) => provider === 'meta' ? adapter.actPath(id) : id;
    const requested = String(input.account_id || configured);
    const selected = requested ? options.find((row) => comparable(row.id) === comparable(requested)) : options.length === 1 ? options[0] : null;
    if (!selected) {
      return {
        ok: false, choose_account: options.length > 0, accounts: options,
        note: options.length ? 'Choose the account that belongs to this brand.' : 'This sign-in did not return an accessible account.',
      };
    }
    if (provider === 'linkedin') {
      const read = await adapter.listPosts({ organization_id: selected.id, count: 25 });
      if (!read.ok) return { ok: false, note: 'LinkedIn could not read posts for the selected company page.' };
      if (configured !== selected.id) await saveAccount(auth, workspaceId, c.conn, field, selected.id);
      result = { ok: true, count: read.posts.length, account: selected, records: read.posts, note: 'Recent company posts synced (up to 25).' };
    } else {
      const history = require('./ad-history.js');
      const out = await history.importFor(workspaceId, { days: 30, providers: [provider], accountId: selected.id, by: auth.user_id, source: 'manual' });
      const latest = out.platforms[0];
      if (!latest?.ok) return { ok: false, note: `${Adapter.label} could not import history for the selected account. Check the account’s permissions.` };
      if (configured !== selected.id) await saveAccount(auth, workspaceId, c.conn, field, selected.id);
      result = { ok: true, count: latest.ads, account: selected, note: `${latest.ads} ads imported. ${latest.note || ''}`.trim() };
    }
  } else if (provider === 'klaviyo') {
    const [email, sms] = await Promise.all(['email', 'sms'].map((channel) => adapter.listCampaigns(channel)));
    if (!email.ok && !sms.ok) return { ok: false, note: email.note };
    const records = [...(email.rows || []).map((row) => ({ ...row, channel: 'email' })), ...(sms.rows || []).map((row) => ({ ...row, channel: 'sms' }))];
    const note = `Read ${email.rows?.length || 0} email and ${sms.rows?.length || 0} SMS campaigns (up to 25 per channel).`;
    result = { ok: true, count: records.length, records, note: `${note}${!email.ok || !sms.ok ? ' ' + (email.ok ? sms.note : email.note) : ''}` };
  } else if (SOCIAL.has(provider)) {
    const read = await adapter.listPosts();
    if (!read.ok) return { ok: false, note: `${Adapter.label} could not read posts for this sign-in. Check its read permissions.` };
    result = { ok: true, count: read.posts.length, records: read.posts, note: `Read ${read.posts.length} recent posts (up to ${provider === 'tiktok' ? 20 : 25}).` };
  } else {
    const who = await adapter.validateCredentials();
    if (!who.ok) return { ok: false, note: `${Adapter.label} could not verify this connection. Check its account settings.` };
    return { ok: true, note: 'WebEngage settings saved. Historical sync uses WebEngage event exports.' };
  }
  result.at = new Date().toISOString();
  await gateway.syncLog(workspaceId, provider, 'connection_sync', true, result.count, result.note, {
    account: result.account, records: result.records, connection_id: c.conn.id,
  });
  return result;
}

async function latest(auth, workspaceId) {
  const rows = await brand.restAs(auth.token, `platform_sync_log?select=provider,records,note,detail,created_at&workspace_id=eq.${encodeURIComponent(workspaceId)}&operation=eq.connection_sync&ok=eq.true&order=created_at.desc&limit=60`);
  const results = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!supported(row.provider) || Object.hasOwn(results, row.provider)) continue;
    results[row.provider] = { count: row.records, note: row.note, records: row.detail?.records, connection_id: row.detail?.connection_id, at: row.created_at };
  }
  return { ok: true, results };
}

async function saveAccount(auth, workspaceId, conn, field, id) {
  await brand.restAs(auth.token, `workspace_connections?workspace_id=eq.${encodeURIComponent(workspaceId)}&id=eq.${encodeURIComponent(conn.id)}`, {
    method: 'PATCH', body: { config: { ...conn.config, [field]: id } }, prefer: 'return=minimal',
  });
}

module.exports = { supported, sync, latest };
